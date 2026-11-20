"""Save Image (Region Genie): saves images as PNG (compression 0-9, 8 / 16-bit), WebP (lossless or a quality), JPEG
(a quality, .jpg / .jpeg) or AVIF (a quality), with an optional mask for transparency, the workflow stored the way
ComfyUI's own save nodes store it, and the saved file sizes shown on the node.

Design: docs/superpowers/specs/2026-11-13-save-image-design.md."""
import io
import os
import struct
import tempfile
import zlib

import numpy as np
from PIL import Image, features


class ImageTooLarge(ValueError):
    """Wider or taller than the format allows (WebP 16383 px, JPEG 65535 px)."""


def _check_size(rgb, limit, label):
    h, w = np.asarray(rgb).shape[:2]
    if w > limit or h > limit:
        raise ImageTooLarge(f"{label} can't be wider or taller than {limit} px (this image is {w} x {h}): "
                            f"save it as png (or avif) instead")


class ExifTooLong(ValueError):
    """The workflow doesn't fit in a JPEG's EXIF (about 64 KB)."""


class AvifUnavailable(RuntimeError):
    pass


AVIF_MISSING = "AVIF needs Pillow 11.3 or newer (pip install -U pillow), or a ComfyUI with AVIF support"


# --------------------------------------------------------------------------- #
# pixels
# --------------------------------------------------------------------------- #
def _u8(x):
    return np.round(np.clip(np.asarray(x, np.float32), 0, 1) * 255).astype(np.uint8)


def _pil(rgb, alpha):
    """An RGB or RGBA Pillow image from float (H, W, 3) and (H, W) arrays (0-1, clipped)."""
    if alpha is None:
        return Image.fromarray(_u8(rgb), "RGB")
    return Image.fromarray(np.concatenate([_u8(rgb), _u8(alpha)[..., None]], -1), "RGBA")


def mask_alpha(mask, index, h, w, invert):
    """The alpha for image `index` from a ComfyUI MASK ((H, W) or (B, H, W); 1 = transparent, as Load Image's mask),
    resized to h x w; invert: 1 = opaque. None without a mask."""
    if mask is None:
        return None
    m = mask.cpu().numpy() if hasattr(mask, "cpu") else np.asarray(mask)
    m = np.asarray(m, np.float32)
    if m.ndim == 3:
        m = m[min(index, m.shape[0] - 1)]
    if m.shape != (h, w):
        m = np.asarray(Image.fromarray(m, "F").resize((w, h), Image.BILINEAR), np.float32)
    m = np.clip(m, 0, 1)
    return m if invert else 1 - m


# --------------------------------------------------------------------------- #
# encoders
# --------------------------------------------------------------------------- #
def _chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def _png16(rgb, alpha, level, text):
    """16-bit PNG (Pillow can't write 16-bit RGB): filter 0 rows, one zlib stream at `level`."""
    px = np.round(np.clip(np.asarray(rgb, np.float32), 0, 1) * 65535)
    if alpha is not None:
        px = np.concatenate([px, np.round(np.clip(np.asarray(alpha, np.float32), 0, 1) * 65535)[..., None]], -1)
    h, w, c = px.shape
    rows = px.astype(">u2").reshape(h, w * c).view(np.uint8).reshape(h, w * c * 2)
    # each row's filter (PNG: 0 none, 1 Sub, 2 Up), picked by the usual smallest-sum-of-differences rule
    bpp = c * 2
    sub = rows.copy()
    sub[:, bpp:] = rows[:, bpp:] - rows[:, :-bpp]
    up = rows.copy()
    up[1:] = rows[1:] - rows[:-1]
    cand = np.stack([rows, sub, up])                       # uint8 arithmetic wraps mod 256, as PNG wants
    score = np.minimum(cand, 256 - cand.astype(np.int32)).sum(2)
    pick = score.argmin(0)
    filt = cand[pick, np.arange(h)]
    raw = np.concatenate([pick.astype(np.uint8)[:, None], filt], 1).tobytes()
    out = [b"\x89PNG\r\n\x1a\n", _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 16, 6 if c == 4 else 2, 0, 0, 0))]
    from .gen_params import png_text_chunk                 # tEXt, or iTXt for text that isn't Latin-1 (a prompt in Chinese)
    for k, v in (text or {}).items():
        out.append(_chunk(*png_text_chunk(k, v)))
    out += [_chunk(b"IDAT", zlib.compress(raw, level)), _chunk(b"IEND", b"")]
    return b"".join(out)


def encode_png(rgb, alpha, level, bits, text):
    level = int(max(0, min(9, level)))
    if int(bits) == 16:
        return _png16(rgb, alpha, level, text)
    from PIL.PngImagePlugin import PngInfo
    info = None
    if text:
        info = PngInfo()
        for k, v in text.items():
            info.add_text(k, v)
    buf = io.BytesIO()
    _pil(rgb, alpha).save(buf, "PNG", compress_level=level, pnginfo=info)
    return buf.getvalue()


def encode_webp(rgb, alpha, lossless, quality, exif):
    _check_size(rgb, 16383, "WebP")
    buf = io.BytesIO()
    kw = {"lossless": True, "quality": 100, "method": 6} if lossless else {"quality": int(quality), "method": 6}
    if lossless and alpha is not None:
        kw["exact"] = True                         # keep the colors under fully transparent pixels too
    if exif:
        kw["exif"] = exif
    _pil(rgb, alpha).save(buf, "WEBP", **kw)
    return buf.getvalue()


def encode_jpeg(rgb, quality, exif):
    _check_size(rgb, 65535, "JPEG")
    buf = io.BytesIO()
    kw = {"quality": int(quality), "optimize": True, "subsampling": 0 if int(quality) >= 90 else 2}
    if exif:
        kw["exif"] = exif
    img = _pil(rgb, None)
    try:
        img.save(buf, "JPEG", **kw)
    except ValueError as e:
        if "too long" in str(e).lower():
            raise ExifTooLong(str(e)) from e
        raise
    except OSError:
        # optimize=True needs the whole file in one buffer (Pillow: width x height bytes, x2 from q95); a detailed
        # image at high quality can be bigger: once more with a buffer large enough for any JPEG of this size
        from PIL import ImageFile
        keep = ImageFile.MAXBLOCK
        try:
            ImageFile.MAXBLOCK = max(keep, img.size[0] * img.size[1] * 4 + len(exif or b"") + 65536)
            buf = io.BytesIO()
            img.save(buf, "JPEG", **kw)
        finally:
            ImageFile.MAXBLOCK = keep
    return buf.getvalue()


def _avif_pyav(rgb, alpha, quality, metadata):
    """AVIF through PyAV and core's own metadata helper (a ComfyUI with AVIF support, Pillow without it)."""
    try:
        from comfy_extras.nodes_images import _save_avif, inject_avif_metadata  # noqa: F401
        import torch
    except Exception as e:
        raise AvifUnavailable(AVIF_MISSING) from e
    crf = int(round(63 - (int(quality) - 1) * 62 / 99))
    img = torch.from_numpy(np.clip(np.asarray(rgb, np.float32), 0, 1))[None]
    fd, path = tempfile.mkstemp(suffix=".avif")
    os.close(fd)
    try:
        _save_avif(img, path, "auto", "sRGB", crf, fps=1.0, loop_count=None, metadata=metadata or None)
        with open(path, "rb") as f:
            return f.read()
    finally:
        os.remove(path)


def encode_avif(rgb, alpha, quality, exif, metadata=None):
    """Pillow when it has AVIF; else PyAV as core does (metadata: the dict core's helper takes)."""
    if features.check("avif"):
        buf = io.BytesIO()
        kw = {"quality": int(quality), "speed": 6}
        if exif:
            kw["exif"] = exif
        _pil(rgb, alpha).save(buf, "AVIF", **kw)
        return buf.getvalue()
    return _avif_pyav(rgb, alpha, quality, metadata)


# --------------------------------------------------------------------------- #
# the workflow in the files, as ComfyUI's own save nodes write it (so dragging a file in loads it)
# --------------------------------------------------------------------------- #
def metadata_disabled():
    """ComfyUI started with --disable-metadata: no workflow in any file or sidecar."""
    try:
        from comfy.cli_args import args
        return bool(getattr(args, "disable_metadata", False))
    except Exception:
        return False


def png_text(prompt, extra, params=None):
    """PNG text chunks: 'prompt' and one per extra_pnginfo key (e.g. 'workflow'), and 'parameters' (the settings as
    text, where A1111 / Forge keep them: gen_params.py); None when there is nothing."""
    if metadata_disabled() or (prompt is None and not extra and not params):
        return None
    import json
    out = {}
    if params:
        out["parameters"] = params
    if prompt is not None:
        out["prompt"] = json.dumps(prompt)
    for k, v in (extra or {}).items():
        if k != "parameters" or not params:
            out[k] = json.dumps(v)
    return out


def comfy_exif(prompt, extra, params=None):
    """EXIF for WebP / AVIF / JPEG: 0x0110 = 'prompt:<json>', then 0x010F, 0x010E, ... = '<key>:<json>' per
    extra_pnginfo key (ComfyUI's layout); and the settings as text in UserComment, where A1111 / Forge keep them for
    these formats (gen_params.py). None when there is nothing."""
    if metadata_disabled() or (prompt is None and not extra and not params):
        return None
    import json
    ex = Image.Exif()
    if prompt is not None:
        ex[0x0110] = "prompt:" + json.dumps(prompt)
    tag = 0x010F
    for k, v in (extra or {}).items():
        ex[tag] = f"{k}:{json.dumps(v)}"
        tag -= 1
    if params:
        from .gen_params import user_comment
        ex.get_ifd(0x8769)[0x9286] = user_comment(params)
    return ex.tobytes()


def workflow_json(extra):
    """The workflow as a saved workflow file (the JPEG sidecar), or None."""
    if metadata_disabled() or not extra or extra.get("workflow") is None:
        return None
    import json
    return json.dumps(extra["workflow"])


def avif_metadata(prompt, extra, params=None):
    """The dict core's AVIF helper takes (the PyAV route), or None."""
    if metadata_disabled() or (prompt is None and not extra and not params):
        return None
    out = {} if prompt is None else {"prompt": prompt}
    out.update(extra or {})
    if params:
        out["parameters"] = params
    return out


# --------------------------------------------------------------------------- #
# the node
# --------------------------------------------------------------------------- #
FORMATS = ("png", "webp", "jpeg", "avif", "exr")
EXR_DEPTHS = ("16-bit float", "32-bit float")              # as core Save Image (Advanced)
EXR_SPACES = ("sRGB", "HDR", "linear", "linear ACEScg")
EXR_MISSING = "EXR needs the EXR support of ComfyUI's own Save Image (Advanced) (ComfyUI v0.45 or newer): update ComfyUI"


class ExrUnavailable(RuntimeError):
    pass


class _Any(str):
    """An input type every output may be connected to (a sampler's or scheduler's name comes as a list of choices)."""
    def __ne__(self, other):
        return False


ANY = _Any("*")
NOTE_SETTINGS = ("Settings text: {} not found in the workflow (another node sets {}); connect it at this node's inputs "
                 "(the cable button)")


def _plain(v):
    """A connected value as text or a number; anything else (an object some node hands over) counts as not connected."""
    if isinstance(v, (list, tuple)) and len(v) == 1:
        v = v[0]
    return v if isinstance(v, (str, int, float)) and not isinstance(v, bool) else None


def _model_path(folder, name):
    """A model file's full path (for its metadata file), or None."""
    try:
        import folder_paths
    except Exception:
        return None
    for f in dict.fromkeys((folder, "checkpoints", "diffusion_models", "unet", "loras", "vae")):
        try:
            p = folder_paths.get_full_path(f, name)
        except Exception:
            p = None
        if p:
            return p
    return name if os.path.isabs(str(name)) and os.path.isfile(str(name)) else None


def settings_text(prompt, unique_id, size, overrides):
    """(the A1111-style settings text or None, the settings that couldn't be read) for the image this node saves."""
    from . import gen_params
    traced = gen_params.trace(prompt if isinstance(prompt, dict) else {}, unique_id)
    return gen_params.build(traced, size, overrides, _model_path)


def _core_exr():
    """ComfyUI's own EXR helpers (comfy_extras/nodes_images.py), so the files match Save Image (Advanced)'s."""
    try:
        from comfy_extras.nodes_images import _to_scene_linear, _encode_image, inject_exr_metadata
        return _to_scene_linear, _encode_image, inject_exr_metadata
    except Exception as e:
        raise ExrUnavailable(EXR_MISSING) from e


def encode_exr(rgb, alpha, depth, space, prompt, extra):
    """Scene-linear EXR (16 / 32-bit float) as core writes it: the input converted from `space` to linear light (not
    clipped: HDR values above 1 stay), the alpha as it is, the workflow and color space in the header."""
    to_linear, encode, inject = _core_exr()
    import torch
    t = to_linear(torch.from_numpy(np.ascontiguousarray(rgb, dtype=np.float32)), space if space in EXR_SPACES else "sRGB")
    if alpha is not None:
        t = torch.cat([t, torch.from_numpy(np.ascontiguousarray(alpha, dtype=np.float32))[..., None]], -1)
    data = encode(t, "exr", depth if depth in EXR_DEPTHS else EXR_DEPTHS[0], "linear")
    if not metadata_disabled() and (prompt is not None or extra):
        data = inject(data, prompt, extra, space)
    return data
JPEG_WORKFLOW = ("sidecar .json", "none", "inside the JPEG (EXIF)")
NOTE_JPEG_MASK = "JPEG has no transparency: the mask was ignored"
NOTE_EXIF = "The workflow was too big for the JPEG's EXIF (about 64 KB): saved as a .json next to it"
NOTE_EXIF_NOT_SAVED = "The prompt was too big for the JPEG's EXIF (about 64 KB) and there is no workflow for a .json: not saved"
NOTE_AVIF_ALPHA = "This AVIF encoder has no transparency (update Pillow to 11.3+): saved without it"


def next_counter(folder, prefix):
    """The node's own file number: the highest existing '<prefix>_NNNNN.<any ext>' + 1 (%batch_num% matches any
    number). Older ComfyUI versions only count core's '<prefix>_NNNNN_.png' names."""
    import re
    # case ignored: on Windows / macOS 'ComfyUI_00001.png' and 'comfyui_00001.png' are the same file
    pat = re.compile("^" + re.escape(prefix).replace(re.escape("%batch_num%"), r"\d+") + r"_(\d{5,})\.[^.]+$", re.IGNORECASE)
    best = 0
    try:
        for f in os.listdir(folder):
            m = pat.match(f)
            if m:
                best = max(best, int(m.group(1)))
    except FileNotFoundError:
        pass
    return best + 1


def _exr_preview(rgb, space):
    """A small preview of an EXR for ComfyUI's asset list, as core writes it (only while ComfyUI's asset manager is on;
    else None, as core)."""
    try:
        from server import PromptServer
        if not getattr(getattr(PromptServer.instance, "asset_manager", None), "enabled", False):
            return None
        from comfy_extras.nodes_images import _write_asset_preview, _to_scene_linear
        import torch
        return _write_asset_preview(_to_scene_linear(torch.from_numpy(np.ascontiguousarray(rgb, dtype=np.float32)), space))
    except Exception:
        return None


def _label(fmt, a):
    if fmt == "png":
        return f"PNG {a['png_compression']}" + (" 16-bit" if a["png_bit_depth"] == "16-bit" else "")
    if fmt == "webp":
        return "WebP lossless" if a["webp_lossless"] else f"WebP q{a['webp_quality']}"
    if fmt == "jpeg":
        return f"JPEG q{a['jpeg_quality']}"
    if fmt == "exr":
        return f"EXR {a['exr_bit_depth']}"
    return f"AVIF q{a['avif_quality']}"


class SaveImageRG:
    """Save Image (Region Genie)."""

    @classmethod
    def INPUT_TYPES(cls):
        q = lambda d, tip: ("INT", {"default": d, "min": 1, "max": 100, "step": 1, "tooltip": tip})  # noqa: E731
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "The images to save (one file per image)."}),
                "filename_prefix": ("STRING", {"default": "ComfyUI", "tooltip": (
                    "The file name before the number, e.g. ComfyUI → ComfyUI_00001.png. Can include a subfolder "
                    "(portraits/ComfyUI) and tokens such as %date:yyyy-MM-dd% or %Empty Latent Image.width%.")}),
                "format": (list(FORMATS), {"default": "png", "tooltip": (
                    "png: Lossless, keeps the workflow.\n"
                    "webp: Lossless or a quality, much smaller, keeps the workflow.\n"
                    "jpeg: A quality, small. The workflow goes in a .json next to it (see jpeg_workflow).\n"
                    "avif: A quality, smallest, keeps the workflow.\n"
                    "exr: 16 / 32-bit float, scene-linear (for compositing and HDR; not smaller). The workflow is in "
                    "its header, which ComfyUI can't load from yet.")}),
                "png_compression": ("INT", {"default": 9, "min": 0, "max": 9, "step": 1, "tooltip": (
                    "0-9, lossless at every level (always the same pixels). Higher = smaller file, slower save; 9 = "
                    "smallest (ComfyUI's own Save Image uses 4).")}),
                "png_bit_depth": (["8-bit", "16-bit"], {"default": "8-bit", "tooltip": (
                    "8-bit: The usual.\n"
                    "16-bit: Finer gradients for editing later, about twice the size.")}),
                "webp_lossless": ("BOOLEAN", {"default": False, "tooltip": (
                    "On: The exact pixels, usually 25-35% smaller than PNG.\n"
                    "Off: webp_quality decides (much smaller files, a little detail lost).")}),
                "webp_quality": q(90, "1-100. Lower = smaller file, more detail lost. 80-90 looks the same as the "
                                      "original for most images."),
                "jpeg_quality": q(90, "1-100. Lower = smaller file, more detail lost. 90 and up keeps the full color "
                                      "detail; below 90 colors are stored at half resolution (smaller)."),
                "jpeg_extension": ([".jpg", ".jpeg"], {"default": ".jpg", "tooltip": "The file extension; the same format either way."}),
                "jpeg_workflow": (list(JPEG_WORKFLOW), {"default": "sidecar .json", "tooltip": (
                    "ComfyUI can't load a workflow from a JPEG.\n"
                    "sidecar .json: The workflow in a small .json file next to each JPEG (drag that file into ComfyUI "
                    "to load it).\n"
                    "none: No workflow.\n"
                    "inside the JPEG (EXIF): Readable by other tools, not by ComfyUI; a workflow too big for it "
                    "(about 64 KB) goes into the .json instead.")}),
                "avif_quality": q(80, "1-100. Lower = smaller file, more detail lost. AVIF needs Pillow 11.3+ or a "
                                      "ComfyUI with AVIF support."),
                "exr_bit_depth": (list(EXR_DEPTHS), {"default": EXR_DEPTHS[0], "tooltip": (
                    "16-bit float: Half precision, about half the size; plenty for most edits.\n"
                    "32-bit float: Full precision.")}),
                "exr_color_space": (list(EXR_SPACES), {"default": "sRGB", "tooltip": (
                    "The color space of the images coming in. The EXR is always written as scene-linear light in the "
                    "matching gamut, as ComfyUI's Save Image (Advanced) does.\n"
                    "sRGB: sRGB-encoded Rec.709 (the usual); the inverse sRGB curve is applied.\n"
                    "HDR: HLG-encoded Rec.2020 (BT.2100); the inverse HLG curve is applied.\n"
                    "linear: Already scene-linear (Rec.709 primaries), written unchanged; for renderer / compositor output.\n"
                    "linear ACEScg: Already scene-linear ACEScg (AP1 / D60), written unchanged with ACEScg chromaticities.")}),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": (
                    "Transparency (PNG, WebP, AVIF, EXR; JPEG has none). As ComfyUI's Load Image mask: 1 = transparent. "
                    "A mask of another size is resized. One mask applies to every image; a batch goes image by image. "
                    "Without a mask, an RGBA image keeps its own alpha.")}),
                "invert_mask": ("BOOLEAN", {"default": False, "tooltip": (
                    "On: Mask 1 = opaque instead. Use it for a region mask from Region Genie or Mask Picker, to keep "
                    "the region and clear the rest.")}),
                # round 44: what the image was made with, as text for other interfaces
                "a1111_metadata": ("BOOLEAN", {"default": True, "tooltip": (
                    "On: Also writes what the image was made with (prompt, seed, steps, sampler, cfg, model, LoRAs) into "
                    "the file as text, the way A1111 and Forge do, so other interfaces and sites can read it. The values "
                    "are read from the workflow that ran; ComfyUI's own workflow data stays in the file as before. Not "
                    "for EXR.\n"
                    "Off: Only ComfyUI's own workflow data.")}),
                # round 44: values for that text when the workflow doesn't say them (another node computes them). The
                # node hides these inputs until they are ticked in its inputs list (js/save_image.js)
                "positive": ("STRING", {"forceInput": True, "tooltip": (
                    "Optional. The prompt to write into the settings text, in place of the one read from the workflow.")}),
                "negative": ("STRING", {"forceInput": True, "tooltip": (
                    "Optional. The negative prompt to write into the settings text, in place of the one read from the "
                    "workflow.")}),
                "seed": ("INT", {"forceInput": True, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "tooltip": (
                    "Optional. The seed to write into the settings text. Connect it when the sampler gets its seed from "
                    "another node, which the workflow doesn't show.")}),
                "steps": ("INT", {"forceInput": True, "min": 0, "max": 100000, "tooltip": (
                    "Optional. The number of steps to write into the settings text, in place of the one read from the "
                    "workflow.")}),
                "cfg": ("FLOAT", {"forceInput": True, "min": -1000.0, "max": 1000.0, "tooltip": (
                    "Optional. The cfg to write into the settings text, in place of the one read from the workflow.")}),
                "sampler_name": (ANY, {"forceInput": True, "tooltip": (
                    "Optional. The sampler's name to write into the settings text (as ComfyUI names it, e.g. "
                    "euler_ancestral), in place of the one read from the workflow.")}),
                "scheduler": (ANY, {"forceInput": True, "tooltip": (
                    "Optional. The scheduler's name to write into the settings text (as ComfyUI names it, e.g. karras), "
                    "in place of the one read from the workflow.")}),
                "denoise": ("FLOAT", {"forceInput": True, "min": 0.0, "max": 1.0, "tooltip": (
                    "Optional. The denoise to write into the settings text, in place of the one read from the workflow.")}),
                "model_name": (ANY, {"forceInput": True, "tooltip": (
                    "Optional. The model's name to write into the settings text, in place of the one read from the "
                    "workflow.")}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO", "unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    OUTPUT_TOOLTIPS = ("The same images, passed through.",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "Region Genie"
    DESCRIPTION = ("Saves images as PNG (compression 0-9, 8 / 16-bit), WebP (lossless or a quality), JPEG (a quality), "
                   "AVIF (a quality) or EXR (16 / 32-bit float), with optional transparency from a mask, and shows the "
                   "saved file sizes.")

    def run(self, images, filename_prefix, format, png_compression, png_bit_depth, webp_lossless, webp_quality,
            jpeg_quality, jpeg_extension, jpeg_workflow, avif_quality, exr_bit_depth="16-bit float",
            exr_color_space="sRGB", mask=None, invert_mask=False, prompt=None, extra_pnginfo=None,
            a1111_metadata=True, positive=None, negative=None, seed=None, steps=None, cfg=None, sampler_name=None,
            scheduler=None, denoise=None, model_name=None, unique_id=None):
        import folder_paths
        fmt = format if format in FORMATS else "png"
        if fmt == "exr":
            _core_exr()                            # stops with a clear message before anything is written
        arr = images.cpu().numpy() if hasattr(images, "cpu") else np.asarray(images)
        arr = np.asarray(arr, np.float32)
        b, h, w = arr.shape[0], arr.shape[1], arr.shape[2]
        out_dir = folder_paths.get_output_directory()
        folder, base, _, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, out_dir, w, h)
        os.makedirs(folder, exist_ok=True)
        counter = next_counter(folder, base)
        ext = {"png": ".png", "webp": ".webp", "avif": ".avif", "exr": ".exr"}.get(fmt, jpeg_extension if jpeg_extension in (".jpg", ".jpeg") else ".jpg")
        a = dict(png_compression=png_compression, png_bit_depth=png_bit_depth, webp_lossless=webp_lossless,
                 webp_quality=webp_quality, jpeg_quality=jpeg_quality, avif_quality=avif_quality,
                 exr_bit_depth=exr_bit_depth)
        notes, results, saved = [], [], []

        def note(n):
            if n not in notes:
                notes.append(n)

        def write(name, data, exclusive=False):
            with open(os.path.join(folder, name), "xb" if exclusive else "wb") as f:
                f.write(data)
            saved.append({"name": name, "bytes": len(data)})

        # round 44: the settings as text for other interfaces (gen_params.py); the same for every image of the batch
        params = None
        if a1111_metadata and fmt != "exr" and not metadata_disabled():
            try:
                params, missing = settings_text(prompt, unique_id, (w, h), dict(
                    positive=_plain(positive), negative=_plain(negative), seed=_plain(seed), steps=_plain(steps),
                    cfg=_plain(cfg), sampler_name=_plain(sampler_name), scheduler=_plain(scheduler),
                    denoise=_plain(denoise), model_name=_plain(model_name)))
                if params and missing:
                    note(NOTE_SETTINGS.format(", ".join(missing), "it" if len(missing) == 1 else "them"))
            except Exception as e:                  # never lose an image over its settings text
                import logging
                logging.warning(f"[Region Genie] Save Image: the settings text could not be made ({e})")
                params = None

        bump = 0                                   # names found taken while saving (never overwrite a file)

        for i in range(b):
            rgb = arr[i, :, :, :3]
            if rgb.shape[-1] < 3:
                rgb = np.repeat(rgb[..., :1], 3, -1)
            alpha = mask_alpha(mask, i, h, w, bool(invert_mask))
            if alpha is None and arr.shape[-1] == 4:   # an RGBA image (Join Image with Alpha ...): its own alpha
                alpha = np.clip(arr[i, :, :, 3], 0, 1)
            sidecar = None
            if fmt == "png":
                data = encode_png(rgb, alpha, int(png_compression), 16 if png_bit_depth == "16-bit" else 8,
                                  png_text(prompt, extra_pnginfo, params))
            elif fmt == "webp":
                data = encode_webp(rgb, alpha, bool(webp_lossless), int(webp_quality), comfy_exif(prompt, extra_pnginfo, params))
            elif fmt == "exr":
                data = encode_exr(rgb, alpha, exr_bit_depth, exr_color_space, prompt, extra_pnginfo)
            elif fmt == "avif":
                if alpha is not None and not features.check("avif"):
                    note(NOTE_AVIF_ALPHA)
                data = encode_avif(rgb, alpha, int(avif_quality), comfy_exif(prompt, extra_pnginfo, params),
                                   avif_metadata(prompt, extra_pnginfo, params))
            else:
                if alpha is not None:
                    note(NOTE_JPEG_MASK)
                # the settings text is small and always goes into the JPEG; the workflow only when asked for
                exif = comfy_exif(prompt, extra_pnginfo, params) if jpeg_workflow == JPEG_WORKFLOW[2] else comfy_exif(None, None, params)
                if jpeg_workflow == JPEG_WORKFLOW[0]:
                    sidecar = workflow_json(extra_pnginfo)
                try:
                    data = encode_jpeg(rgb, int(jpeg_quality), exif)
                except ExifTooLong:
                    try:
                        data = encode_jpeg(rgb, int(jpeg_quality), comfy_exif(None, None, params))
                    except ExifTooLong:
                        data = encode_jpeg(rgb, int(jpeg_quality), None)
                    sidecar = workflow_json(extra_pnginfo)
                    note(NOTE_EXIF if sidecar is not None else NOTE_EXIF_NOT_SAVED)
            while True:
                stem = f"{base.replace('%batch_num%', str(i))}_{counter + i + bump:05}"
                name = stem + ext
                if sidecar is not None and os.path.exists(os.path.join(folder, stem + ".json")):
                    bump += 1
                    continue
                try:
                    write(name, data, exclusive=True)
                    break
                except FileExistsError:
                    bump += 1
            if sidecar is not None:
                write(stem + ".json", sidecar.encode("utf-8"))
            entry = {"filename": name, "subfolder": subfolder, "type": "output"}
            if fmt == "exr":
                preview = _exr_preview(rgb, exr_color_space)
                if preview is not None:
                    entry["asset_preview"] = preview
            results.append(entry)
        summary = {"label": _label(fmt, a), "files": saved, "total": sum(f["bytes"] for f in saved), "notes": notes,
                   "settings": (params or "")[:6000]}       # the node shows it in its status line's tooltip
        return {"ui": {"images": results, "rg_saved": [summary]}, "result": (images,)}
