"""Round 5 checks: edit mask (grow / feather / keep), shared-background separation, LLM cache settings,
RegionGenie.run in Edit Mode, Regional LoRAs input order."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from stubs import check, fails, USER_DIR, T  # noqa: E402
import numpy as np  # noqa: E402

from rgpack import region_genie as rg  # noqa: E402
from rgpack import regional_lora as hl  # noqa: E402
from rgpack import llm_enhance as le  # noqa: E402

# ---------------------------------------------------------------- grow_mask / edit_mask
H = W = 64
sq = np.zeros((H, W), bool); sq[20:30, 20:30] = True
g = rg.grow_mask(sq, 3)
check("grow 3: round growth (corner not reached)", g[17, 25] and not g[16, 25] and not g[17, 17])
check("grow 3: diagonal within radius", g[18, 18])            # dist sqrt(8) < 3
s = rg.grow_mask(sq, -2)
check("shrink 2", s[22:28, 22:28].all() and not s[21, 25] and s.sum() == 36)
check("grow 0 is the same mask", rg.grow_mask(sq, 0) is sq)
full = np.ones((H, W), bool)
check("shrink of a full mask keeps it", rg.grow_mask(full, -3).all())
edge = np.zeros((H, W), bool); edge[:, :10] = True
check("shrink keeps the image border inside", rg.grow_mask(edge, -2)[:, 0].all() and not rg.grow_mask(edge, -2)[:, 8].any())

keep = np.zeros((H, W), bool); keep[:, 32:] = True               # right half kept
chg = np.zeros((H, W), bool); chg[10:20, 24:32] = True          # touches the kept half
m = rg.edit_mask(chg, keep, False, grow=6, feather=0)
check("regions only: grows past the change region", m[25, 26] == 1 and m[10, 20] == 1)
check("regions only: never grows into kept pixels", m[:, 32:].max() == 0)
m = rg.edit_mask(chg, keep, False, grow=6, feather=4)
check("feather: kept pixels stay exactly 0", m[:, 32:].max() == 0)
check("feather: soft edge toward the kept half lies outside it", 0 < m[15, 31] < 1 and m[15, 32] == 0 and m[15, 22] == 1)
check("feather: soft outer edge", 0 < m[15, 18] < 1 or 0 < m[15, 17] < 1)
check("feather values in 0..1", m.min() >= 0 and m.max() <= 1)
m = rg.edit_mask(chg, keep, True, grow=0, feather=0)
check("whole image: everything but the kept half", m[:, :32].min() == 1 and m[:, 32:].max() == 0)
m = rg.edit_mask(chg, keep, True, grow=-3, feather=0)
check("whole image, grow -3: margin around the kept half", m[:, 29:32].max() == 0 and m[:, 28].min() == 1)
check("whole image without kept regions: no mask", rg.edit_mask(chg, np.zeros_like(keep), True, 8, 16) is None)
check("regions only, nothing to change: all zero", rg.edit_mask(np.zeros_like(chg), keep, False, 8, 16).max() == 0)

# fallback without scipy: square growth
import builtins  # noqa: E402
real_import = builtins.__import__
def no_scipy(name, *a, **k):
    if name.startswith("scipy"):
        raise ImportError("no scipy")
    return real_import(name, *a, **k)
builtins.__import__ = no_scipy
try:
    gs = rg.grow_mask(sq, 3)
    ss = rg.grow_mask(sq, -2)
finally:
    builtins.__import__ = real_import
check("no scipy: square grow", gs[17, 17] and not gs[16, 25] and gs.sum() == 16 * 16)
check("no scipy: shrink", ss.sum() == 36)

# ---------------------------------------------------------------- shared background (RegionSeparation.bias)
class FakeRegion:
    def __init__(self, cells, n=4, spans=(), text_len=None):
        m = np.zeros(n, np.float32); m[list(cells)] = 1
        self.m, self.text_spans, self.text_len = m.view(T), list(spans), text_len
    def grid_mask(self, h, w, src=None):
        return self.m

moss = hl.ModelArch("MOSS-Image")
grid = (2, 2, (2, 2, 1))                        # 4 image tokens: 0 = region A, 1 = region B, 2 and 3 = background
A, B = FakeRegion([0]), FakeRegion([1])
def pen(sep, nq, nk, tl=None, arch=moss, early=True):
    b = sep.bias(nq, nk, grid, "cpu", np.float32, tl, early, arch)
    return np.zeros((nq, nk), bool) if b is None else (np.asarray(b)[0, 0] < -1e-6)
p0 = pen(hl.RegionSeparation([A, B], 0.9, 0.3), 4, 4)
p1 = pen(hl.RegionSeparation([A, B], 0.9, 0.3, share_bg=True), 4, 4)
check("apart: region vs region blocked", p0[0, 1] and p1[0, 1] and p1[1, 0])
check("apart: region vs background blocked when not shared", p0[0, 2] and p0[2, 1])
check("shared: region vs background open", not p1[0, 2] and not p1[2, 1] and not p1[3, 0])
check("background vs background open in both", not p0[2, 3] and not p1[2, 3])
# captions: text after the image (MOSS: image, text); A's caption is text token 0 (sequence index 4)
Ac, Bc = FakeRegion([0], spans=[(0, 1)], text_len=2), FakeRegion([1], spans=[(1, 2)], text_len=2)
p1 = pen(hl.RegionSeparation([Ac, Bc], 0.9, 0.3, share_bg=True), 6, 6, tl=2)
check("shared: a caption still doesn't reach the background", p1[4, 2] and p1[2, 4])
check("shared: a caption reaches its own region", not p1[4, 0] and not p1[0, 4])
check("shared: a caption doesn't reach the other region", p1[4, 1] and p1[5, 0])
p_late = pen(hl.RegionSeparation([Ac, Bc], 0.9, 0.3, share_bg=True), 6, 6, tl=2, early=False)
check("shared, after 'until': image open, captions still apart", not p_late[0, 1] and p_late[4, 1])
# cross-attention (SDXL / SD1.5 style): self-attention between image tokens
sd = hl.ModelArch("SD1.5", cross=True, multires=True, family="SDXL / SD1.5")
gsd = sd.grid(2, 2)
def pen_sd(sep):
    b = sep.bias(4, 4, gsd, "cpu", np.float32, None, True, sd)
    return np.zeros((4, 4), bool) if b is None else (np.asarray(b)[0, 0] < -1e-6)
q0, q1 = pen_sd(hl.RegionSeparation([A, B], 0.9, 0.3)), pen_sd(hl.RegionSeparation([A, B], 0.9, 0.3, share_bg=True))
check("cross-attn: region vs background blocked / shared", q0[0, 2] and not q1[0, 2] and q1[0, 1])

# ---------------------------------------------------------------- LLM cache settings
cache_file = os.path.join(USER_DIR, "region_genie", "llm_cache.json")
os.makedirs(os.path.dirname(cache_file), exist_ok=True)
with open(cache_file, "w") as f:
    json.dump({"k0": {"text": "old"}}, f)
cfg = le.configure({"disk": False})
check("disk off (default): the cache file is deleted", not os.path.exists(cache_file))
check("defaults: 30 days, 500 entries", cfg == {"disk": False, "days": 30, "max": 500})
le.cache_put({"a": {"text": "A"}})
check("disk off: nothing written", not os.path.exists(cache_file) and le.cache_get("a")["text"] == "A")
le.configure({"disk": True, "days": 30, "max": 500})
le.cache_put({"b": {"text": "B"}})
check("disk on: written", os.path.exists(cache_file) and "b" in json.load(open(cache_file)))
check("entries have a date", "t" in json.load(open(cache_file))["b"])
with le._cache_lock:
    le._cache["a"]["t"] = time.time() - 40 * 86400              # 40 days old
le.configure({"disk": True, "days": 30, "max": 500})
check("older than the day limit: dropped", le.cache_get("a") is None and le.cache_get("b") is not None)
le.configure({"disk": True, "days": 0, "max": 10})
le.cache_put({f"n{i}": {"text": str(i)} for i in range(15)})
check("entry limit: oldest dropped first", len(le._cache) == 10 and le.cache_get("n14") and le.cache_get("b") is None)
le.configure({"disk": False, "days": 30, "max": 500})
check("turning disk off deletes the file, memory stays", not os.path.exists(cache_file) and le.cache_get("n14") is not None)
check("bad values clamp", le.norm_cache_cfg({"disk": "yes", "days": -5, "max": 3}) == {"disk": False, "days": 0, "max": 10})
# no browser yet: read ComfyUI's saved settings
os.makedirs(os.path.join(USER_DIR, "default"), exist_ok=True)
with open(os.path.join(USER_DIR, "default", "comfy.settings.json"), "w") as f:
    json.dump({"RegionGenie.LLM.CacheOnDisk": True, "RegionGenie.LLM.CacheDays": 7}, f)
le._cfg_known, le._cache_loaded, le._cfg = False, False, {"disk": False, "days": 30, "max": 500}
le.cache_get("zzz")
check("API run before any browser: settings file read", le._cfg == {"disk": True, "days": 7, "max": 500})

# ---------------------------------------------------------------- RegionGenie.run in Edit Mode (64 x 64)
class FakeVAE:
    latent_channels = 4
    def encode(self, img):
        return np.zeros((1, 4, int(img.shape[1]) // 8, int(img.shape[2]) // 8), np.float32).view(T)
def rect(lid, rid, bw, bh, ox, oy):
    return {"id": lid, "name": f"r{lid}", "region": rid, "visible": True, "shape": "rect", "sides": 5,
            "bw": bw, "bh": bh, "sx": 1, "sy": 1, "rot": 0, "ox": ox, "oy": oy, "ops": []}
def paint(keep1=True, edit_mask=None, share=False):
    d = {"v": 2,
         "regions": [{"id": 1, "color": "#E6194B", "prompt": "old barn", "type": "object", **({"keep": True} if keep1 else {})},
                     {"id": 2, "color": "#3CB44B", "prompt": "red car", "type": "object"}],
         "layers": [rect(1, 1, 0.5, 1.0, -0.25, 0.0), rect(2, 2, 0.5, 0.5, 0.25, -0.25)]}
    if edit_mask is not None:
        d["editMask"] = edit_mask
    if share:
        d["loraOpts"] = {"separation": 0.85, "until": 0.25, "allRegions": True, "shareBg": True}
    return json.dumps(d)
img = np.full((1, 64, 64, 3), 0.5, np.float32).view(T)
node = rg.RegionGenie()
def run(**kw):
    args = dict(width=64, height=64, scene_prompt_positive="make it night", scene_prompt_negative="",
                image_mode=rg.IMAGE_MODES[0], min_region_pixels=64, image=img, vae=FakeVAE(), mode="edit")
    args.update(kw)
    return node.run(**args)
out = run(paint_data=paint(edit_mask={"grow": 4, "feather": 0}), edit_area="only the regions")
lat, info = out["result"][3], out["result"][10]
nm = np.asarray(lat.get("noise_mask"))[0, 0] if "noise_mask" in lat else None
check("run: latent has a noise mask", nm is not None and nm.shape == (64, 64))
check("run: kept region (left half) never changes", nm[:, :32].max() == 0)
check("run: change region (top right) grown by 4 px", nm[10, 40] == 1 and nm[34, 40] == 1 and nm[37, 40] == 0)
check("run: region_info names change / keep", "change: 1" in info and "keep: 0" in info and "grow 4 px" in info)
out = run(paint_data=paint(edit_mask={"grow": 4, "feather": 0}), edit_area="whole image")
nm = np.asarray(out["result"][3]["noise_mask"])[0, 0]
kept_px = rg.render_layers(np.zeros((64, 64), np.uint8), json.loads(paint())["layers"], {1: 1, 2: 2}) == 1
check("run, whole image: all but the kept region", nm[kept_px].max() == 0 and nm[~kept_px].min() == 1)
out = run(paint_data=paint(keep1=False), edit_area="whole image")
check("run, whole image, nothing kept: no mask", "noise_mask" not in out["result"][3])
out = run(paint_data=paint(), edit_area="only the regions")                  # no editMask sent: defaults 8 / 16
check("run: defaults grow 8 / feather 16", "grow 8 px, feather 16 px" in out["result"][10])
nm = np.asarray(out["result"][3]["noise_mask"])[0, 0]
check("run, defaults: kept half still exactly 0", nm[:, :32].max() == 0)
out = run(paint_data=paint(), mode="generate")
check("run, generate: no noise mask", "noise_mask" not in out["result"][3])
out = run(paint_data=json.dumps({"v": 2, "regions": [{"id": 1, "color": "#E6194B", "prompt": "x", "keep": True}],
                                  "layers": [rect(1, 1, 0.5, 0.5, 0, 0)]}), edit_area="only the regions")
check("run: every region kept -> note", "every region is set to keep" in out["result"][10])
check("layout export / import keeps editMask", rg.layout_from_json(json.dumps(
    {"regions": [], "layers": [], "editMask": {"grow": 3}}), 64, 64)[0].get("editMask") == {"grow": 3})

# ---------------------------------------------------------------- Regional LoRAs: the new input comes last
req = list(hl.RegionalLoRAs.INPUT_TYPES()["required"])
check("Regional LoRAs: share_background is the last input", req[-1] == "share_background" and req[-2] == "separate_all_regions")

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
