"""
Region Genie: BBoxes to Masks and Mask Picker.

BBoxes to Masks turns the output of bbox prompt-layout nodes (MOSS-Image Prompt Builder KJ,
ComfyUI "Create Bounding Boxes", (Deno) Ideogram Director, Region Genie, ...) into masks,
plus the prompt of each box. Mask Picker does the same for a batch of masks (e.g. the exact
region masks of the Region Genie node).

Accepted bbox inputs (any nesting depth, JSON strings are parsed):
  pixel bboxes   {"x":..,"y":..,"width":..,"height":..}  (also "w"/"h", optional metadata.desc),
                 {"x1":..,"y1":..,"x2":..,"y2":..}, [x, y, w, h]
                 (values <= 1.0 everywhere are treated as 0-1 fractions)
  elements       {"type":"obj","bbox":[ymin,xmin,ymax,xmax],"desc":..}
                 bbox on a 0-1000 grid, Y FIRST (MOSS / Ideogram convention).
                 Also found inside {"compositional_deconstruction":{"elements":[..]}}.
                 Elements without a "bbox" (Deno "nobbox") have no area and are skipped.
  MOSS layouts   {"items":[{"label":..,"caption":..,"bbox":[ymin,xmin,ymax,xmax]}],
                  "bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}
                 pixels measured from the canvas centre, so width/height must match the builder's.
"""

import json
import logging

import numpy as np
import torch

LOG = "[Region Genie]"


# --------------------------------------------------------------------------- #
# parsing
# --------------------------------------------------------------------------- #
def _is_quad(v):
    return isinstance(v, (list, tuple)) and len(v) == 4 and all(
        isinstance(n, (int, float)) and not isinstance(n, bool) for n in v)


def _element_prompt(el):
    desc = str(el.get("desc", "") or "").strip()
    if not desc and el.get("type") == "text":
        desc = str(el.get("text", "") or "").strip()
    return desc


def _parse(obj, out, stats):
    """Collect entries: {"kind": "px"|"frac", "box": (x, y, w, h), "prompt": str|None, "type": str|None}."""
    if obj is None:
        return
    if isinstance(obj, str):
        try:
            obj = json.loads(obj)
        except (ValueError, TypeError):
            return
        _parse(obj, out, stats)
        return
    if isinstance(obj, dict):
        if isinstance(obj.get("items"), list) and ("bbox_coord_space" in obj or "summary" in obj
                                                    or "bbox_format" in obj):
            space = str(obj.get("bbox_coord_space", "abs_centralized"))
            fmt = str(obj.get("bbox_format", "yxyx"))
            for item in obj["items"]:
                if isinstance(item, dict):
                    _parse_moss_item(item, space, fmt, out, stats)
            return
        if ("caption" in obj or "label" in obj) and _is_quad(obj.get("bbox")) and "desc" not in obj:
            _parse_moss_item(obj, "abs_centralized", "yxyx", out, stats)
            return
        is_element = "desc" in obj or obj.get("type") in ("obj", "text")
        if is_element:
            if _is_quad(obj.get("bbox")):
                y0, x0, y1, x1 = (float(v) / 1000.0 for v in obj["bbox"])
                x0, x1 = sorted((x0, x1))
                y0, y1 = sorted((y0, y1))
                out.append({"kind": "frac", "box": (x0, y0, x1 - x0, y1 - y0),
                            "prompt": _element_prompt(obj), "type": obj.get("type"),
                            "text": obj.get("text"), "palette": obj.get("color_palette", obj.get("palette"))})
            else:
                stats["no_bbox"] = stats.get("no_bbox", 0) + 1
            return
        if all(k in obj for k in ("x1", "y1", "x2", "y2")):
            x1, y1, x2, y2 = (float(obj[k]) for k in ("x1", "y1", "x2", "y2"))
            out.append({"kind": "px", "box": (x1, y1, x2 - x1, y2 - y1), "prompt": None, "type": None})
            return
        if "x" in obj and "y" in obj:
            w = obj.get("width", obj.get("w"))
            h = obj.get("height", obj.get("h"))
            if w is not None and h is not None:
                meta = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
                desc = meta.get("desc")           # Create Bounding Boxes / Region Genie keep prompts here
                out.append({"kind": "px", "box": (float(obj["x"]), float(obj["y"]), float(w), float(h)),
                            "prompt": str(desc).strip() if desc is not None else None, "type": meta.get("type"),
                            "text": meta.get("text"), "palette": meta.get("palette")})
            return
        for key in ("compositional_deconstruction", "elements", "bboxes", "bbox", "boxes", "box"):
            if key in obj:
                _parse(obj[key], out, stats)
        return
    if isinstance(obj, (list, tuple)):
        if _is_quad(obj):
            out.append({"kind": "px", "box": tuple(float(v) for v in obj), "prompt": None, "type": None})
            return
        for item in obj:
            _parse(item, out, stats)


def _parse_moss_item(item, space, fmt, out, stats):
    """MOSS-Image layout item: bbox in pixels, [ymin, xmin, ymax, xmax] by default, measured
    from the canvas centre when bbox_coord_space is abs_centralized."""
    bb = item.get("bbox")
    if not _is_quad(bb):
        stats["no_bbox"] = stats.get("no_bbox", 0) + 1
        return
    a, b, c, d = (float(v) for v in bb)
    if fmt.lower().startswith("xy"):
        x0, y0, x1, y1 = a, b, c, d
    else:
        y0, x0, y1, x1 = a, b, c, d
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    prompt = str(item.get("caption", "") or "").strip()
    if not prompt:
        prompt = str(item.get("text", "") or "").strip()
    out.append({"kind": "center" if "central" in space.lower() else "px",
                "box": (x0, y0, x1 - x0, y1 - y0), "prompt": prompt,
                "type": item.get("label"), "text": item.get("text"), "palette": item.get("palette")})


def _parse_all(obj):
    out, stats = [], {}
    _parse(obj, out, stats)
    return out, stats


def _to_pixels(entries, width, height):
    """(x, y, w, h) in pixels for every entry."""
    px_entries = [e for e in entries if e["kind"] == "px"]
    legacy_normalized = bool(px_entries) and all(max(e["box"]) <= 1.0 for e in px_entries)
    boxes = []
    for e in entries:
        x, y, w, h = e["box"]
        if e["kind"] == "center":
            x, y = x + width // 2, y + height // 2
        elif e["kind"] == "frac" or legacy_normalized:
            x, w, y, h = x * width, w * width, y * height, h * height
        boxes.append((x, y, w, h))
    return boxes


# kept for anything importing the v1/v2 helper
def _flatten_bboxes(obj, out):
    entries, _ = _parse_all(obj)
    out.extend(e["box"] for e in entries)


def _ramp(lo, hi, n, feather, solid_border=True):
    """1-D profile of a box edge pair [lo, hi) after a (2*feather+1)-tap box blur.
    solid_border: edges on the canvas border stay solid instead of fading toward the border."""
    i = torch.arange(n, dtype=torch.float32)
    if hi <= lo:
        return torch.zeros(n, dtype=torch.float32)
    if feather <= 0:
        return ((i >= lo) & (i < hi)).float()
    a = float("-inf") if (solid_border and lo <= 0) else float(lo)
    b = float("inf") if (solid_border and hi >= n) else float(hi - 1)
    covered = torch.minimum(i + feather, torch.full_like(i, b)) - torch.maximum(i - feather, torch.full_like(i, a)) + 1
    return covered.clamp(min=0) / (2 * feather + 1)


def _rasterize(boxes, width, height, feather, feather_canvas_edges=False):
    """boxes are pixel (x, y, w, h). A box blur of a rectangle is the product of two 1-D
    ramps, so feathering costs O(width + height) per box instead of a 2-D convolution."""
    masks = []
    for x, y, w, h in boxes:
        x1 = max(0, min(int(round(x)), width))
        y1 = max(0, min(int(round(y)), height))
        x2 = max(0, min(int(round(x + w)), width))
        y2 = max(0, min(int(round(y + h)), height))
        solid = not feather_canvas_edges
        px = _ramp(x1, x2, width, feather, solid)
        py = _ramp(y1, y2, height, feather, solid)
        masks.append(py[:, None] * px[None, :])
    if not masks:
        masks = [torch.zeros((height, width), dtype=torch.float32)]
    return torch.stack(masks, dim=0)  # (N, H, W)


LATENT_SCALES = ["auto", "8", "16", "32"]


def _latent_scale(latent, mode):
    """Pixels per latent cell. MOSS-Image / Flux 2 latents are 16x, SD/SDXL/Flux 1 are 8x."""
    if mode != "auto":
        return int(mode), f"latent_scale set to {mode}"
    ratio = latent.get("downscale_ratio_spacial")
    if ratio:
        return int(ratio), f"latent reports {ratio}x"
    channels = int(latent["samples"].shape[1])
    if channels == 128:  # Flux 2 / MOSS-Image latent format
        return 16, "128-channel latent (MOSS-Image / Flux 2), assumed 16x"
    return 8, f"{channels}-channel latent, assumed 8x"


def _resolve_size(width, height, latent_scale, image=None, latent=None):
    """Returns (width, height, human-readable source)."""
    if image is not None:
        return int(image.shape[2]), int(image.shape[1]), "size_from_image"
    if latent is not None:
        s = latent["samples"].shape
        scale, why = _latent_scale(latent, latent_scale)
        return int(s[-1]) * scale, int(s[-2]) * scale, f"size_from_latent ({why})"
    return width, height, "width/height widgets"


def _describe(boxes, prompts, width, height, source, notes):
    lines = [f"{len(boxes)} bbox(es) on {width}x{height} canvas  [size from {source}]"]
    for i, (x, y, w, h) in enumerate(boxes):
        line = f"index {i}: x={x:g} y={y:g}  {w:g}x{h:g}"
        if prompts[i]:
            line += f"  \"{prompts[i]}\""
        lines.append(line)
    lines.extend(notes)
    return "\n".join(lines)


def _common_inputs():
    return {
        "width": ("INT", {"default": 1024, "min": 1, "max": 16384, "step": 1,
                          "tooltip": "Canvas width. Ignored when size_from_image or size_from_latent is connected."}),
        "height": ("INT", {"default": 1024, "min": 1, "max": 16384, "step": 1,
                           "tooltip": "Canvas height. Ignored when size_from_image or size_from_latent is connected."}),
        "feather": ("INT", {"default": 0, "min": 0, "max": 1024, "step": 1,
                            "tooltip": "Soften mask edges by this many pixels (a linear ramp of 2x this width, centred on the box edge). Edges on the canvas border stay solid."}),
        "invert": ("BOOLEAN", {"default": False,
                               "tooltip": "On: The masks are inverted (everything except the box / region is white)."}),
        "latent_scale": (LATENT_SCALES, {"default": "auto",
                                         "tooltip": "Pixels per latent cell for size_from_latent. "
                                                    "auto: 16 for MOSS-Image / Flux 2 latents, 8 for SD/SDXL/Flux 1."}),
    }


def _optional_inputs():
    return {
        "size_from_image": ("IMAGE", {"tooltip": "Takes priority over size_from_latent."}),
        "size_from_latent": ("LATENT", {"tooltip": "Take width / height from this latent (its size times latent_scale). "
                                                   "size_from_image comes first."}),
    }


# --------------------------------------------------------------------------- #
# main node
# --------------------------------------------------------------------------- #
class BBoxesToMasks:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "index": ("INT", {"default": 0, "min": 0, "max": 255, "step": 1,
                                  "tooltip": "Which bbox goes to the 'mask' and 'prompt' outputs. "
                                             "After a run, the label shows the valid range; higher values stay selectable "
                                             "for bboxes you add later."}),
                **_common_inputs(),
                "feather_canvas_edges": ("BOOLEAN", {"default": False,
                                         "tooltip": ("Off: Box edges touching the canvas border stay solid.\n"
                                                     "On: They fade toward the border like every other edge.")}),
            },
            "optional": {
                "bboxes": ("*", {"forceInput": True,
                                 "tooltip": "Pixel bboxes, or elements / prompt JSON (those carry the prompts too)."}),
                **_optional_inputs(),
                "elements": ("*", {"forceInput": True,
                                   "tooltip": ("The 'prompt' of MOSS-Image Prompt Builder KJ, 'elements' from Create Bounding Boxes or the "
                                               "Region Genie node, or the 'prompt' of (Deno) Ideogram Director. It supplies the prompt of each "
                                               "box. MOSS layouts are measured from the canvas centre, so width/height must match the builder's. "
                                               "It is enough on its own; the boxes are read from it when 'bboxes' isn't connected.")}),
            },
        }

    RETURN_TYPES = ("MASK", "MASK", "MASK", "INT", "INT", "STRING", "STRING")
    RETURN_NAMES = ("mask", "combined_mask", "mask_batch", "width", "height", "bbox_info", "prompt")
    OUTPUT_TOOLTIPS = (
        "Mask of the bbox chosen by 'index'.",
        "Union of all bboxes in one mask.",
        "One mask per bbox, stacked as a batch (e.g. for Impact Pack 'MASK to SEGS').",
        "Canvas width actually used.",
        "Canvas height actually used.",
        "Text list of every bbox, its index and its prompt.",
        "Prompt (desc) of the bbox chosen by 'index'. Empty when no elements are available.",
    )
    FUNCTION = "run"
    CATEGORY = "Region Genie"

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, **kwargs):
        return True

    def run(self, index, width, height, feather, invert, latent_scale="auto",
            size_from_image=None, size_from_latent=None, bboxes=None, elements=None,
            feather_canvas_edges=False):
        width, height, source = _resolve_size(width, height, latent_scale,
                                              size_from_image, size_from_latent)
        notes = []
        geo, geo_stats = _parse_all(bboxes)
        els, el_stats = _parse_all(elements)
        els = [e for e in els if e["prompt"] is not None]  # elements / MOSS items  # only real elements carry prompts

        if bboxes is None and elements is None:
            notes.append("WARNING: connect 'bboxes' and/or 'elements'")
        if elements is None:
            entries = geo  # prompts come along if 'bboxes' itself held elements
        elif bboxes is None:
            entries = els
        elif len(geo) == len(els):
            # pixel-exact boxes from 'bboxes', prompts from 'elements', paired by position
            entries = [dict(g, prompt=e["prompt"]) for g, e in zip(geo, els)]
        else:
            entries = els
            notes.append(f"NOTE: 'bboxes' has {len(geo)} box(es) but 'elements' has {len(els)}; "
                         "using the boxes stored in 'elements' so prompts stay matched")
        skipped = (el_stats if elements is not None else geo_stats).get("no_bbox", 0)
        if skipped:
            notes.append(f"NOTE: skipped {skipped} element(s) that have no bbox")

        boxes = _to_pixels(entries, width, height)
        prompts = [e["prompt"] or "" for e in entries]
        batch = _rasterize(boxes, width, height, feather, feather_canvas_edges)
        combined = batch.max(dim=0, keepdim=True).values  # (1, H, W)

        if boxes and index >= len(boxes):
            notes.append(f"WARNING: index {index} out of range, using index {len(boxes) - 1}")
        sel = min(index, max(len(boxes) - 1, 0))
        selected = batch[sel:sel + 1]
        prompt = prompts[sel] if prompts else ""

        if invert:
            batch, combined, selected = 1.0 - batch, 1.0 - combined, 1.0 - selected

        info = _describe(boxes, prompts, width, height, source, notes)
        logging.info(f"{LOG} BBoxes to Masks: {info}")
        return {
            "ui": {"bbox_count": [len(boxes)], "bbox_info": [info]},
            "result": (selected, combined, batch, width, height, info, prompt),
        }


# --------------------------------------------------------------------------- #
# Mask Picker
# --------------------------------------------------------------------------- #
def box_blur(masks_np, feather, solid_border=True):
    """(N, H, W) float32 -> same, (2*feather+1)-tap box blur along both axes (separable, O(pixels)).
    solid_border: the image continues past its edges (mask edges on the border stay solid);
    otherwise the outside counts as empty, so edges touching the border fade too."""
    if feather <= 0:
        return masks_np
    k = 2 * feather + 1
    out = masks_np.astype(np.float32)
    for axis in (1, 2):
        pad = [(0, 0)] * 3
        pad[axis] = (feather, feather)
        p = np.pad(out, pad, mode="edge" if solid_border else "constant")
        c = np.cumsum(p, axis=axis, dtype=np.float64)
        zero_shape = list(c.shape); zero_shape[axis] = 1
        c = np.concatenate([np.zeros(zero_shape), c], axis=axis)
        hi = [slice(None)] * 3; lo = [slice(None)] * 3
        hi[axis] = slice(k, None); lo[axis] = slice(None, -k)
        out = ((c[tuple(hi)] - c[tuple(lo)]) / k).astype(np.float32)
    return np.clip(out, 0.0, 1.0)


class MaskPicker:
    @classmethod
    def INPUT_TYPES(cls):
        c = _common_inputs()
        return {
            "required": {
                "masks": ("MASK", {"tooltip": "A batch of masks, e.g. the 'masks' output of the Region Genie node."}),
                "index": ("INT", {"default": 0, "min": 0, "max": 255, "step": 1,
                                  "tooltip": "Which mask goes to the 'mask' and 'prompt' outputs. After a run, the "
                                             "label shows the valid range; higher values stay selectable."}),
                "feather": c["feather"],
                "invert": c["invert"],
                "feather_canvas_edges": ("BOOLEAN", {"default": False,
                                         "tooltip": ("Off: Mask edges touching the image border stay solid.\n"
                                                     "On: They fade toward the border like every other edge.")}),
            },
            "optional": {
                "elements": ("*", {"forceInput": True,
                                   "tooltip": "Prompts for the masks, in the same order: 'elements' of the Region "
                                              "Genie node (or its 'prompt' when that is MOSS or Ideogram JSON), or "
                                              "any layout the BBoxes to Masks node reads."}),
                "size_from_image": ("IMAGE", {"tooltip": "Resize the masks to this image's size."}),
                "size_from_latent": ("LATENT", {"tooltip": "Resize the masks to this latent's image size "
                                                           "(16x for MOSS-Image / Flux 2 latents, 8x for SD/SDXL/Flux 1)."}),
            },
        }

    RETURN_TYPES = ("MASK", "MASK", "MASK", "INT", "INT", "STRING", "STRING")
    RETURN_NAMES = ("mask", "combined_mask", "mask_batch", "width", "height", "mask_info", "prompt")
    OUTPUT_TOOLTIPS = (
        "The mask chosen by 'index'.",
        "Union of all masks in one mask.",
        "All masks (resized / feathered / inverted as set), as a batch.",
        "Mask width.",
        "Mask height.",
        "Text list of every mask with its index, area and prompt.",
        "Prompt of the mask chosen by 'index'. Empty when no elements are connected.",
    )
    FUNCTION = "run"
    CATEGORY = "Region Genie"

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, **kwargs):
        return True

    def run(self, masks, index, feather, invert, feather_canvas_edges=False, elements=None,
            size_from_image=None, size_from_latent=None):
        m = masks
        if m.dim() == 2:
            m = m.unsqueeze(0)
        m = m.float()
        h0, w0 = int(m.shape[-2]), int(m.shape[-1])
        width, height, source = _resolve_size(w0, h0, "auto", size_from_image, size_from_latent)
        notes = []
        if (width, height) != (w0, h0):
            m = torch.nn.functional.interpolate(m.unsqueeze(1), size=(height, width), mode="nearest").squeeze(1)
            notes.append(f"resized from {w0}x{h0} [{source}]")
        arr = m.cpu().numpy()
        n = arr.shape[0]

        prompts = []
        if elements is not None:
            ents, _ = _parse_all(elements)
            prompts = [e["prompt"] or "" for e in ents if e["prompt"] is not None]
            if prompts and len(prompts) != n:
                notes.append(f"NOTE: {n} mask(s) but {len(prompts)} prompt(s); matched by position")

        if index >= n:
            notes.append(f"WARNING: index {index} out of range, using index {n - 1}")
        sel = min(index, n - 1)
        prompt = prompts[sel] if sel < len(prompts) else ""

        lines = [f"{n} mask(s), {width}x{height}" + (f"  ({notes[0]})" if notes and notes[0].startswith("resized") else "")]
        for i in range(n):
            ys, xs = np.nonzero(arr[i] > 0.5)
            if len(xs):
                desc = f"x={int(xs.min())} y={int(ys.min())}  {int(xs.max() - xs.min() + 1)}x{int(ys.max() - ys.min() + 1)}"
            else:
                desc = "empty"
            p = f'  "{prompts[i]}"' if i < len(prompts) and prompts[i] else ""
            lines.append(f"index {i}: {desc}{p}")
        lines += [x for x in notes if not x.startswith("resized")]
        info = "\n".join(lines)

        arr = box_blur(arr, feather, solid_border=not feather_canvas_edges)
        batch = torch.from_numpy(np.ascontiguousarray(arr))
        combined = batch.max(dim=0, keepdim=True).values
        selected = batch[sel:sel + 1]
        if invert:
            batch, combined, selected = 1.0 - batch, 1.0 - combined, 1.0 - selected
        logging.info(f"{LOG} Mask Picker: {info}")
        return {
            "ui": {"bbox_count": [n], "bbox_info": [info]},
            "result": (selected, combined, batch, width, height, info, prompt),
        }
