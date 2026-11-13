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
    for k, v in (text or {}).items():
        out.append(_chunk(b"tEXt", k.encode("latin-1", "replace") + b"\x00" + v.encode("latin-1", "replace")))
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
    buf = io.BytesIO()
    kw = {"lossless": True, "quality": 100, "method": 6} if lossless else {"quality": int(quality), "method": 6}
    if lossless and alpha is not None:
        kw["exact"] = True                         # keep the colors under fully transparent pixels too
    if exif:
        kw["exif"] = exif
    _pil(rgb, alpha).save(buf, "WEBP", **kw)
    return buf.getvalue()


def encode_jpeg(rgb, quality, exif):
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


def png_text(prompt, extra):
    """PNG tEXt chunks: 'prompt' and one per extra_pnginfo key (e.g. 'workflow'); None when there is nothing."""
    if metadata_disabled() or (prompt is None and not extra):
        return None
    import json
    out = {}
    if prompt is not None:
        out["prompt"] = json.dumps(prompt)
    for k, v in (extra or {}).items():
        out[k] = json.dumps(v)
    return out


def comfy_exif(prompt, extra):
    """EXIF for WebP / AVIF / JPEG: 0x0110 = 'prompt:<json>', then 0x010F, 0x010E, ... = '<key>:<json>' per
    extra_pnginfo key (ComfyUI's layout). None when there is nothing."""
    if metadata_disabled() or (prompt is None and not extra):
        return None
    import json
    ex = Image.Exif()
    if prompt is not None:
        ex[0x0110] = "prompt:" + json.dumps(prompt)
    tag = 0x010F
    for k, v in (extra or {}).items():
        ex[tag] = f"{k}:{json.dumps(v)}"
        tag -= 1
    return ex.tobytes()


def workflow_json(extra):
    """The workflow as a saved workflow file (the JPEG sidecar), or None."""
    if metadata_disabled() or not extra or extra.get("workflow") is None:
        return None
    import json
    return json.dumps(extra["workflow"])


def avif_metadata(prompt, extra):
    """The dict core's AVIF helper takes (the PyAV route), or None."""
    if metadata_disabled() or (prompt is None and not extra):
        return None
    out = {} if prompt is None else {"prompt": prompt}
    out.update(extra or {})
    return out


# --------------------------------------------------------------------------- #
# the node
# --------------------------------------------------------------------------- #
FORMATS = ("png", "webp", "jpeg", "avif")
JPEG_WORKFLOW = ("sidecar .json", "none", "inside the JPEG (EXIF)")
NOTE_JPEG_MASK = "JPEG has no transparency: the mask was ignored"
NOTE_EXIF = "The workflow was too big for the JPEG's EXIF (about 64 KB): saved as a .json next to it"
NOTE_AVIF_ALPHA = "This AVIF encoder has no transparency (update Pillow to 11.3+): saved without the mask"


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


def _label(fmt, a):
    if fmt == "png":
        return f"PNG {a['png_compression']}" + (" 16-bit" if a["png_bit_depth"] == "16-bit" else "")
    if fmt == "webp":
        return "WebP lossless" if a["webp_lossless"] else f"WebP q{a['webp_quality']}"
    if fmt == "jpeg":
        return f"JPEG q{a['jpeg_quality']}"
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
                    "png: lossless, keeps the workflow. webp: lossless or a quality, much smaller, keeps the workflow. "
                    "jpeg: a quality, small; the workflow goes in a .json next to it (see jpeg_workflow). "
                    "avif: a quality, smallest, keeps the workflow.")}),
                "png_compression": ("INT", {"default": 9, "min": 0, "max": 9, "step": 1, "tooltip": (
                    "0-9. Lossless: every level gives the same pixels; higher = smaller file, slower save. "
                    "9 = smallest (ComfyUI's own Save Image uses 4).")}),
                "png_bit_depth": (["8-bit", "16-bit"], {"default": "8-bit", "tooltip": (
                    "8-bit: the usual. 16-bit: finer gradients for editing later, about twice the size.")}),
                "webp_lossless": ("BOOLEAN", {"default": False, "tooltip": (
                    "On: the exact pixels, usually 25-35% smaller than PNG. Off: webp_quality decides "
                    "(much smaller files, a little detail lost).")}),
                "webp_quality": q(90, "1-100. Lower = smaller file, more detail lost. 80-90 looks the same as the "
                                      "original for most images."),
                "jpeg_quality": q(90, "1-100. Lower = smaller file, more detail lost. 90 and up keeps the full color "
                                      "detail; below 90 colors are stored at half resolution (smaller)."),
                "jpeg_extension": ([".jpg", ".jpeg"], {"default": ".jpg", "tooltip": "The file extension; the same format either way."}),
                "jpeg_workflow": (list(JPEG_WORKFLOW), {"default": "sidecar .json", "tooltip": (
                    "ComfyUI can't load a workflow from a JPEG. sidecar .json: the workflow in a small .json file "
                    "next to each JPEG (drag that file into ComfyUI to load it). none: no workflow. inside the JPEG "
                    "(EXIF): readable by other tools, not by ComfyUI; a workflow too big for it (about 64 KB) goes "
                    "into the .json instead.")}),
                "avif_quality": q(80, "1-100. Lower = smaller file, more detail lost. AVIF needs Pillow 11.3+ or a "
                                      "ComfyUI with AVIF support."),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": (
                    "Transparency (PNG, WebP, AVIF; JPEG has none). As ComfyUI's Load Image mask: 1 = transparent. "
                    "A mask of another size is resized; one mask applies to every image.")}),
                "invert_mask": ("BOOLEAN", {"default": False, "tooltip": (
                    "On: mask 1 = opaque instead (e.g. a region mask from Region Genie or Mask Picker: keep the "
                    "region, clear the rest).")}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    OUTPUT_TOOLTIPS = ("The same images, passed through.",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "Region Genie"
    DESCRIPTION = ("Saves images as PNG (compression 0-9, 8 / 16-bit), WebP (lossless or a quality), JPEG (a quality) "
                   "or AVIF (a quality), with optional transparency from a mask, and shows the saved file sizes.")

    def run(self, images, filename_prefix, format, png_compression, png_bit_depth, webp_lossless, webp_quality,
            jpeg_quality, jpeg_extension, jpeg_workflow, avif_quality, mask=None, invert_mask=False, prompt=None,
            extra_pnginfo=None):
        import folder_paths
        fmt = format if format in FORMATS else "png"
        arr = images.cpu().numpy() if hasattr(images, "cpu") else np.asarray(images)
        arr = np.asarray(arr, np.float32)
        b, h, w = arr.shape[0], arr.shape[1], arr.shape[2]
        out_dir = folder_paths.get_output_directory()
        folder, base, _, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, out_dir, w, h)
        os.makedirs(folder, exist_ok=True)
        counter = next_counter(folder, base)
        ext = {"png": ".png", "webp": ".webp", "avif": ".avif"}.get(fmt, jpeg_extension if jpeg_extension in (".jpg", ".jpeg") else ".jpg")
        a = dict(png_compression=png_compression, png_bit_depth=png_bit_depth, webp_lossless=webp_lossless,
                 webp_quality=webp_quality, jpeg_quality=jpeg_quality, avif_quality=avif_quality)
        notes, results, saved = [], [], []

        def note(n):
            if n not in notes:
                notes.append(n)

        def write(name, data, exclusive=False):
            with open(os.path.join(folder, name), "xb" if exclusive else "wb") as f:
                f.write(data)
            saved.append({"name": name, "bytes": len(data)})

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
                                  png_text(prompt, extra_pnginfo))
            elif fmt == "webp":
                data = encode_webp(rgb, alpha, bool(webp_lossless), int(webp_quality), comfy_exif(prompt, extra_pnginfo))
            elif fmt == "avif":
                if alpha is not None and not features.check("avif"):
                    note(NOTE_AVIF_ALPHA)
                data = encode_avif(rgb, alpha, int(avif_quality), comfy_exif(prompt, extra_pnginfo),
                                   avif_metadata(prompt, extra_pnginfo))
            else:
                if alpha is not None:
                    note(NOTE_JPEG_MASK)
                exif = comfy_exif(prompt, extra_pnginfo) if jpeg_workflow == JPEG_WORKFLOW[2] else None
                if jpeg_workflow == JPEG_WORKFLOW[0]:
                    sidecar = workflow_json(extra_pnginfo)
                try:
                    data = encode_jpeg(rgb, int(jpeg_quality), exif)
                except ExifTooLong:
                    note(NOTE_EXIF)
                    data = encode_jpeg(rgb, int(jpeg_quality), None)
                    sidecar = workflow_json(extra_pnginfo)
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
            results.append({"filename": name, "subfolder": subfolder, "type": "output"})
        summary = {"label": _label(fmt, a), "files": saved, "total": sum(f["bytes"] for f in saved), "notes": notes}
        return {"ui": {"images": results, "rg_saved": [summary]}, "result": (images,)}
