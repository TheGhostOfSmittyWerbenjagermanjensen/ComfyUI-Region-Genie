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
    raw = np.concatenate([np.zeros((h, 1), np.uint8), rows], 1).tobytes()
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
    if exif:
        kw["exif"] = exif
    _pil(rgb, alpha).save(buf, "WEBP", **kw)
    return buf.getvalue()


def encode_jpeg(rgb, quality, exif):
    buf = io.BytesIO()
    kw = {"quality": int(quality), "optimize": True, "subsampling": 0 if int(quality) >= 90 else 2}
    if exif:
        kw["exif"] = exif
    try:
        _pil(rgb, None).save(buf, "JPEG", **kw)
    except ValueError as e:
        if "too long" in str(e).lower():
            raise ExifTooLong(str(e)) from e
        raise
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
