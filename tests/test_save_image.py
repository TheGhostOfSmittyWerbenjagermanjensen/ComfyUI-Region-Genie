"""Save Image (Region Genie): encoders, mask alpha, workflow metadata, the node (naming, batches, masks, summary)."""
import io
import json
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from stubs import check, fails  # noqa: E402,F401
import numpy as np  # noqa: E402
from PIL import Image, JpegImagePlugin, features  # noqa: E402

from rgpack import save_image as si  # noqa: E402

H, W = 24, 32
yy, xx = np.mgrid[0:H, 0:W]
RGB = np.stack([xx / (W - 1), yy / (H - 1), (xx + yy) / (W + H - 2)], -1).astype(np.float32)
RGB[4:12, 4:12] = [1, 0, 0]
ALPHA = (xx / (W - 1)).astype(np.float32)
U8 = np.round(RGB * 255).astype(np.uint8)
AVIF = features.check("avif")


def png_chunks(data):
    pos, out = 8, []
    while pos < len(data):
        n, kind = struct.unpack(">I4s", data[pos:pos + 8])
        out.append((kind, data[pos + 8:pos + 8 + n]))
        pos += 12 + n
    return out


def png16_pixels(data, channels):
    raw = zlib.decompress(b"".join(d for k, d in png_chunks(data) if k == b"IDAT"))
    row = 1 + W * channels * 2
    rows = [raw[i * row:(i + 1) * row] for i in range(H)]
    assert all(r[0] == 0 for r in rows)
    return np.frombuffer(b"".join(r[1:] for r in rows), ">u2").reshape(H, W, channels)


# ---------------------------------------------------------------- PNG
sizes = {}
exact = True
for lvl in range(10):
    d = si.encode_png(RGB, None, lvl, 8, None)
    sizes[lvl] = len(d)
    exact &= bool((np.asarray(Image.open(io.BytesIO(d)).convert("RGB")) == U8).all())
check("png 8-bit lossless at every level", exact and sizes[9] <= sizes[0])
d16 = si.encode_png(RGB, None, 6, 16, None)
ihdr = png_chunks(d16)[0][1]
check("png 16-bit: bit depth 16, color type 2, exact samples", ihdr[8] == 16 and ihdr[9] == 2
      and (png16_pixels(d16, 3) == np.round(RGB * 65535)).all())
im = Image.open(io.BytesIO(si.encode_png(RGB, ALPHA, 6, 8, None)))
check("png with alpha (8-bit): RGBA, exact alpha", im.mode == "RGBA"
      and (np.asarray(im)[..., 3] == np.round(ALPHA * 255)).all())
d16a = si.encode_png(RGB, ALPHA, 6, 16, None)
check("png with alpha (16-bit): color type 6, exact alpha", png_chunks(d16a)[0][1][9] == 6
      and (png16_pixels(d16a, 4)[..., 3] == np.round(ALPHA * 65535)).all())
check("png text chunks", Image.open(io.BytesIO(si.encode_png(RGB, None, 6, 8, {"a": "1", "workflow": "{}"}))).text
      == {"a": "1", "workflow": "{}"})
t16 = [d for k, d in png_chunks(si.encode_png(RGB, None, 6, 16, {"workflow": "{}"})) if k == b"tEXt"]
check("png 16-bit text chunks", t16 == [b"workflow\x00{}"])

# ---------------------------------------------------------------- WebP
wl = si.encode_webp(RGB, None, True, 90, None)
check("webp lossless is exact", (np.asarray(Image.open(io.BytesIO(wl)).convert("RGB")) == U8).all())
check("webp quality shrinks", len(si.encode_webp(RGB, None, False, 30, None)) < len(si.encode_webp(RGB, None, False, 95, None)))
check("webp keeps alpha", Image.open(io.BytesIO(si.encode_webp(RGB, ALPHA, True, 90, None))).mode == "RGBA")

# ---------------------------------------------------------------- JPEG
check("jpeg quality shrinks", len(si.encode_jpeg(RGB, 30, None)) < len(si.encode_jpeg(RGB, 95, None)))
s90 = JpegImagePlugin.get_sampling(Image.open(io.BytesIO(si.encode_jpeg(RGB, 90, None))))
s89 = JpegImagePlugin.get_sampling(Image.open(io.BytesIO(si.encode_jpeg(RGB, 89, None))))
check("jpeg 4:4:4 at q>=90, 4:2:0 below", s90 == 0 and s89 == 2)
big = Image.Exif()
big[0x010F] = "workflow:" + "x" * 70000
try:
    si.encode_jpeg(RGB, 90, big.tobytes())
    raised = False
except si.ExifTooLong:
    raised = True
check("jpeg exif too long raises ExifTooLong", raised and issubclass(si.ExifTooLong, ValueError))

# ---------------------------------------------------------------- AVIF
if AVIF:
    a95, a30 = si.encode_avif(RGB, None, 95, None), si.encode_avif(RGB, None, 30, None)
    check("avif round trip, quality shrinks", Image.open(io.BytesIO(a95)).size == (W, H) and len(a30) < len(a95))
else:
    check("avif: this Pillow has no AVIF (skipped)", True)

# ---------------------------------------------------------------- range and masks
odd = RGB.copy()
odd[0, 0] = [1.2, -0.1, 0.5]
px = np.asarray(Image.open(io.BytesIO(si.encode_png(odd, None, 6, 8, None))).convert("RGB"))[0, 0]
check("out-of-range values clip", px[0] == 255 and px[1] == 0)
m2 = (1 - ALPHA)
check("mask_alpha: (H, W) mask, alpha = 1 - mask", np.allclose(si.mask_alpha(m2, 0, H, W, False), ALPHA, atol=1e-6))
check("mask_alpha: inverted, alpha = mask", np.allclose(si.mask_alpha(m2, 0, H, W, True), m2, atol=1e-6))
mb = np.stack([np.zeros((H, W), np.float32), np.ones((H, W), np.float32)])
check("mask_alpha: (B, H, W), index past the batch uses the last mask", float(si.mask_alpha(mb, 3, H, W, False).max()) == 0.0
      and float(si.mask_alpha(mb, 0, H, W, False).min()) == 1.0)
small = np.zeros((12, 16), np.float32)
small[:, 8:] = 1
r = si.mask_alpha(small, 0, H, W, False)
check("mask_alpha: another size is resized to the image", r.shape == (H, W) and r[0, 0] == 1.0 and r[0, -1] == 0.0)
check("mask_alpha: no mask, no alpha", si.mask_alpha(None, 0, H, W, False) is None)

# ---------------------------------------------------------------- workflow metadata (as core writes it)
import stubs  # noqa: E402
PROMPT = {"3": {"class_type": "KSampler", "inputs": {}}}
WF = {"nodes": [{"id": 1, "type": "Region-Genie_SaveImage"}], "links": []}
EXTRA = {"workflow": WF}
txt = si.png_text(PROMPT, EXTRA)
check("png carries prompt and workflow", json.loads(Image.open(io.BytesIO(si.encode_png(RGB, None, 6, 8, txt))).text["workflow"]) == WF
      and json.loads(txt["prompt"]) == PROMPT)
ex = si.comfy_exif(PROMPT, EXTRA)
wex = Image.open(io.BytesIO(si.encode_webp(RGB, None, False, 80, ex))).getexif()
check("webp exif layout as core", wex[0x0110] == "prompt:" + json.dumps(PROMPT) and wex[0x010F] == "workflow:" + json.dumps(WF))
two = Image.Exif()
two.load(si.comfy_exif(PROMPT, {"workflow": WF, "extra": {"a": 1}}))
check("exif: one tag per extra key, counting down from 0x010F", two[0x010E] == 'extra:{"a": 1}')
if AVIF:
    aex = Image.open(io.BytesIO(si.encode_avif(RGB, None, 80, ex))).getexif()
    check("avif exif layout as core", aex[0x0110] == "prompt:" + json.dumps(PROMPT) and aex[0x010F] == "workflow:" + json.dumps(WF))
jex = Image.open(io.BytesIO(si.encode_jpeg(RGB, 90, ex))).getexif()
check("jpeg exif option: same tags", jex[0x010F] == "workflow:" + json.dumps(WF))
check("sidecar json is the workflow", json.loads(si.workflow_json(EXTRA)) == WF)
check("no workflow, no sidecar", si.workflow_json(None) is None and si.workflow_json({}) is None)
check("no prompt and no extra: no metadata", si.png_text(None, None) is None and si.comfy_exif(None, None) is None)
stubs.comfy.cli_args.args.disable_metadata = True
check("disable-metadata: nothing", si.metadata_disabled() and si.png_text(PROMPT, EXTRA) is None
      and si.comfy_exif(PROMPT, EXTRA) is None and si.workflow_json(EXTRA) is None)
stubs.comfy.cli_args.args.disable_metadata = False

if __name__ == "__main__":
    print("\nall passed" if not fails else f"\n{len(fails)} failed")
    sys.exit(1 if fails else 0)
