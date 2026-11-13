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


def png16_pixels(data, channels, h=H, w=W):
    """Decode 16-bit IDAT rows with filter types 0 (none), 1 (Sub) and 2 (Up)."""
    raw = zlib.decompress(b"".join(d for k, d in png_chunks(data) if k == b"IDAT"))
    row, bpp = 1 + w * channels * 2, channels * 2
    prev = np.zeros(row - 1, np.uint8)
    out = []
    for i in range(h):
        ft, cur = raw[i * row], np.frombuffer(raw[i * row + 1:(i + 1) * row], np.uint8).copy()
        if ft == 1:
            for j in range(bpp, len(cur)):
                cur[j] = (int(cur[j]) + int(cur[j - bpp])) & 255
        elif ft == 2:
            cur = ((cur.astype(np.int32) + prev) & 255).astype(np.uint8)
        else:
            assert ft == 0, ft
        out.append(cur)
        prev = cur
    return np.frombuffer(b"".join(r.tobytes() for r in out), ">u2").reshape(h, w, channels)


def png_filters(data, h, w, channels):
    raw = zlib.decompress(b"".join(d for k, d in png_chunks(data) if k == b"IDAT"))
    row = 1 + w * channels * 2
    return {raw[i * row] for i in range(h)}


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

# ---------------------------------------------------------------- the node
import tempfile  # noqa: E402
from stubs import T  # noqa: E402
OUT = tempfile.mkdtemp(prefix="rg_out_")


def _gsip(prefix, out, w=0, h=0):                     # as core: (folder, base name, counter, subfolder, prefix)
    sub, base = os.path.dirname(os.path.normpath(prefix)), os.path.basename(os.path.normpath(prefix))
    full = os.path.join(out, sub)
    os.makedirs(full, exist_ok=True)
    return full, base, 1, sub, prefix


stubs.fp.get_output_directory = lambda: OUT
stubs.fp.get_save_image_path = _gsip
node = si.SaveImageRG()
IMGS = np.stack([RGB, RGB[::-1].copy(), RGB[:, ::-1].copy()]).view(T)
DEF = dict(filename_prefix="ComfyUI", format="png", png_compression=9, png_bit_depth="8-bit", webp_lossless=False,
           webp_quality=90, jpeg_quality=90, jpeg_extension=".jpg", jpeg_workflow="sidecar .json", avif_quality=80)


def save(images=IMGS, **kw):
    a = dict(DEF)
    a.update(kw)
    return node.run(images, **a)


def files(sub=""):
    return sorted(f for f in os.listdir(os.path.join(OUT, sub)) if os.path.isfile(os.path.join(OUT, sub, f)))


out = save(prompt=PROMPT, extra_pnginfo=EXTRA)
check("one PNG per image", files() == ["ComfyUI_00001.png", "ComfyUI_00002.png", "ComfyUI_00003.png"])
check("ui lists them as output files", [x["filename"] for x in out["ui"]["images"]] == files()
      and all(x["type"] == "output" and x["subfolder"] == "" for x in out["ui"]["images"]))
check("the images pass through", out["result"][0] is IMGS)
check("PNG carries the workflow", json.loads(Image.open(os.path.join(OUT, "ComfyUI_00001.png")).text["workflow"]) == WF)
save(images=IMGS[:1], format="jpeg", jpeg_workflow="none")
check("counter across formats", "ComfyUI_00004.jpg" in files())
open(os.path.join(OUT, "ComfyUI_00010.webp"), "wb").close()
save(images=IMGS[:1], format="png")
check("counter: the highest existing number + 1, any extension", "ComfyUI_00011.png" in files())
o = save(images=IMGS[:1], filename_prefix="portraits/ComfyUI")
check("subfolder prefix", files("portraits") == ["ComfyUI_00001.png"] and o["ui"]["images"][0]["subfolder"] == "portraits")
save(images=IMGS[:2], filename_prefix="b/img_%batch_num%")
check("%batch_num% per image", files("b") == ["img_0_00001.png", "img_1_00002.png"])

save(images=IMGS[:1], filename_prefix="j/a", format="jpeg", jpeg_extension=".jpeg", prompt=PROMPT, extra_pnginfo=EXTRA)
check("jpeg extension .jpeg, sidecar by default", files("j") == ["a_00001.jpeg", "a_00001.json"]
      and json.load(open(os.path.join(OUT, "j", "a_00001.json"))) == WF)
check("jpeg sidecar: no workflow in the JPEG", 0x010F not in Image.open(os.path.join(OUT, "j", "a_00001.jpeg")).getexif())
save(images=IMGS[:1], filename_prefix="j/b", format="jpeg", jpeg_workflow="none", prompt=PROMPT, extra_pnginfo=EXTRA)
check("jpeg none: no .json, no EXIF workflow", files("j")[-1] == "b_00001.jpg"
      and 0x010F not in Image.open(os.path.join(OUT, "j", "b_00001.jpg")).getexif())
save(images=IMGS[:1], filename_prefix="j/c", format="jpeg", jpeg_workflow="inside the JPEG (EXIF)", prompt=PROMPT, extra_pnginfo=EXTRA)
check("jpeg EXIF option: the workflow inside, no .json", not os.path.exists(os.path.join(OUT, "j", "c_00001.json"))
      and Image.open(os.path.join(OUT, "j", "c_00001.jpg")).getexif()[0x010F] == "workflow:" + json.dumps(WF))
BIGWF = {"workflow": {"nodes": [{"id": i, "widgets_values": ["x" * 100]} for i in range(1000)]}}
o = save(images=IMGS[:1], filename_prefix="j/d", format="jpeg", jpeg_workflow="inside the JPEG (EXIF)", prompt=PROMPT, extra_pnginfo=BIGWF)
check("jpeg EXIF fallback: too big -> sidecar and a note", os.path.exists(os.path.join(OUT, "j", "d_00001.json"))
      and si.NOTE_EXIF in o["ui"]["rg_saved"][0]["notes"] and 0x010F not in Image.open(os.path.join(OUT, "j", "d_00001.jpg")).getexif())
o = save(images=IMGS[:1], filename_prefix="j/e", format="jpeg")
check("no workflow (API run): no sidecar, no error", files("j")[-1] == "e_00001.jpg" and not os.path.exists(os.path.join(OUT, "j", "e_00001.json")))

masks = np.stack([np.zeros((12, 16), np.float32), np.ones((12, 16), np.float32)]).view(T)
save(filename_prefix="m/a", mask=masks)
ims = [Image.open(os.path.join(OUT, "m", f)) for f in files("m")]
check("mask batch shorter than images: 3 RGBA PNGs, the last mask repeats", len(ims) == 3 and all(i.mode == "RGBA" for i in ims)
      and np.asarray(ims[0])[..., 3].min() == 255 and np.asarray(ims[2])[..., 3].max() == 0)
save(images=IMGS[:1], filename_prefix="m/b", mask=masks, invert_mask=True)
check("invert_mask: mask 1 = opaque", np.asarray(Image.open(os.path.join(OUT, "m", "b_00001.png")))[..., 3].max() == 0)
o = save(images=IMGS[:1], filename_prefix="m/c", format="jpeg", mask=masks)
check("jpeg ignores the mask (note)", Image.open(os.path.join(OUT, "m", "c_00001.jpg")).mode == "RGB"
      and si.NOTE_JPEG_MASK in o["ui"]["rg_saved"][0]["notes"])
o = save(images=IMGS[:1], filename_prefix="m/d", format="webp", webp_lossless=True, mask=(1 - ALPHA).view(T))
wa = Image.open(os.path.join(OUT, "m", "d_00001.webp"))
check("webp lossless with a mask: RGBA, exact alpha", wa.mode == "RGBA" and (np.asarray(wa)[..., 3] == np.round(ALPHA * 255)).all())
_chk, _pyav = si.features.check, si._avif_pyav
si.features.check, si._avif_pyav = (lambda name: False), (lambda rgb, a, q, m: b"avif")
o = save(images=IMGS[:1], filename_prefix="m/e", format="avif", mask=masks)
check("AVIF through PyAV with a mask: a note (no transparency there)", si.NOTE_AVIF_ALPHA in o["ui"]["rg_saved"][0]["notes"])
si.features.check, si._avif_pyav = _chk, _pyav

o = save(filename_prefix="s/a", format="webp", webp_quality=90)
sm = o["ui"]["rg_saved"][0]
check("rg_saved summary: label, files, total", sm["label"] == "WebP q90" and [f["name"] for f in sm["files"]] == files("s")
      and sm["total"] == sum(os.path.getsize(os.path.join(OUT, "s", f)) for f in files("s")) and sm["notes"] == [])
labels = [save(images=IMGS[:1], filename_prefix="s/l", **k)["ui"]["rg_saved"][0]["label"] for k in
          [dict(format="png", png_compression=9), dict(format="png", png_compression=4, png_bit_depth="16-bit"),
           dict(format="webp", webp_lossless=True), dict(format="jpeg", jpeg_quality=85), dict(format="avif", avif_quality=80)]]
check("labels: PNG 9 / PNG 4 16-bit / WebP lossless / JPEG q85 / AVIF q80",
      labels == ["PNG 9", "PNG 4 16-bit", "WebP lossless", "JPEG q85", "AVIF q80"])
o = save(images=IMGS[:1], filename_prefix="s/j", format="jpeg", prompt=PROMPT, extra_pnginfo=EXTRA)
check("sidecar counted in the summary", [f["name"] for f in o["ui"]["rg_saved"][0]["files"]] == ["j_00001.jpg", "j_00001.json"])

it = si.SaveImageRG.INPUT_TYPES()
order = ["images", "filename_prefix", "format", "png_compression", "png_bit_depth", "webp_lossless", "webp_quality",
         "jpeg_quality", "jpeg_extension", "jpeg_workflow", "avif_quality"]
check("INPUT_TYPES order", list(it["required"]) == order and list(it["optional"]) == ["mask", "invert_mask"]
      and it["hidden"] == {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"})
tips = [k for g in ("required", "optional") for k, v in it[g].items() if not (len(v) > 1 and v[1].get("tooltip"))]
check("every input has a tooltip" + (": missing " + ", ".join(tips) if tips else ""), not tips)
dflt = {k: it["required"][k][1].get("default") for k in order[1:]}
check("defaults as the design", dflt == {"filename_prefix": "ComfyUI", "format": "png", "png_compression": 9, "png_bit_depth": "8-bit",
      "webp_lossless": False, "webp_quality": 90, "jpeg_quality": 90, "jpeg_extension": ".jpg",
      "jpeg_workflow": "sidecar .json", "avif_quality": 80})
check("node: output node, IMAGE passthrough, Region Genie category", si.SaveImageRG.OUTPUT_NODE is True
      and si.SaveImageRG.RETURN_TYPES == ("IMAGE",) and si.SaveImageRG.CATEGORY == "Region Genie")

# ---------------------------------------------------------------- final review fixes
rng = np.random.default_rng(1)
gy, gx = np.mgrid[0:768, 0:768]
NOISY = np.clip(np.stack([gx / 767, gy / 767, (gx + gy) / 1534], -1) + rng.normal(0, 0.1, (768, 768, 3)), 0, 1).astype(np.float32)
ok = True
for q in (90, 94, 100):
    try:
        ok &= Image.open(io.BytesIO(si.encode_jpeg(NOISY, q, None))).size == (768, 768)
    except Exception as e:
        ok = False
        print("   ", q, type(e).__name__, e)
check("jpeg: a detailed, grainy 768x768 image saves at q90, q94 and q100", ok)
ex60 = Image.Exif()
ex60[0x010F] = "workflow:" + "x" * 60000
try:
    small_ok = len(si.encode_jpeg(RGB, 95, ex60.tobytes())) > 60000
except si.ExifTooLong:
    small_ok = True                                    # too long is fine (the node falls back to the sidecar)
except Exception as e:
    small_ok = False
    print("   ", type(e).__name__, e)
check("jpeg: a small image with a 60 KB EXIF saves (or reports too long), never another error", small_ok)
SM = np.clip(np.stack([gx[:256, :256] / 255, gy[:256, :256] / 255, (gx[:256, :256] * gy[:256, :256]) / 65025], -1)
             + rng.normal(0, 0.004, (256, 256, 3)), 0, 1).astype(np.float32)
p16 = si.encode_png(SM, None, 9, 16, None)
plain = len(zlib.compress(np.concatenate([np.zeros((256, 1), np.uint8), np.round(SM * 65535).astype(">u2").reshape(256, -1).view(np.uint8)], 1).tobytes(), 9))
check("png 16-bit: row filters make a smooth image smaller than no filtering", len(p16) < plain * 0.95 and png_filters(p16, 256, 256, 3) - {0})
check("png 16-bit with filters is still exact", (png16_pixels(p16, 3, 256, 256) == np.round(SM * 65535)).all())
check("png 16-bit with alpha and filters is exact", (png16_pixels(si.encode_png(SM, SM[..., 0], 9, 16, None), 4, 256, 256)[..., 3]
      == np.round(SM[..., 0] * 65535)).all())
hid = ALPHA.copy()
hid[:, :8] = 0
wex = np.asarray(Image.open(io.BytesIO(si.encode_webp(RGB, hid, True, 90, None))))
check("webp lossless keeps the colors under fully transparent pixels", (wex[..., :3] == U8).all())
open(os.path.join(OUT, "ComfyUI_00030.png"), "wb").close()
check("counter ignores case (Windows / macOS treat ComfyUI and comfyui as one name)", si.next_counter(OUT, "comfyui") == 31)
keep = os.path.join(OUT, "r", "x_00001.png")
os.makedirs(os.path.dirname(keep), exist_ok=True)
open(keep, "wb").write(b"original")
_nc = si.next_counter
si.next_counter = lambda f, p: 1                      # as if another save took the number meanwhile
o = save(images=IMGS[:2], filename_prefix="r/x")
si.next_counter = _nc
check("never overwrites: a taken name moves to the next number", open(keep, "rb").read() == b"original"
      and files("r") == ["x_00001.png", "x_00002.png", "x_00003.png"] and [x["filename"] for x in o["ui"]["images"]] == ["x_00002.png", "x_00003.png"])
RGBA4 = np.concatenate([np.stack([RGB, RGB]), np.stack([ALPHA, ALPHA])[..., None]], -1).astype(np.float32).view(T)
save(images=RGBA4, filename_prefix="a/p")
ap = Image.open(os.path.join(OUT, "a", "p_00001.png"))
check("an RGBA image (4 channels) keeps its transparency", ap.mode == "RGBA" and (np.asarray(ap)[..., 3] == np.round(ALPHA * 255)).all())
save(images=RGBA4[:1], filename_prefix="a/m", mask=np.ones((H, W), np.float32).view(T), invert_mask=True)
check("a connected mask wins over the image's own alpha", np.asarray(Image.open(os.path.join(OUT, "a", "m_00001.png")))[..., 3].min() == 255)
o = save(images=RGBA4[:1], filename_prefix="a/j", format="jpeg")
check("an RGBA image saved as JPEG: the transparency note", si.NOTE_JPEG_MASK in o["ui"]["rg_saved"][0]["notes"])

if __name__ == "__main__":
    print("\nall passed" if not fails else f"\n{len(fails)} failed")
    sys.exit(1 if fails else 0)
