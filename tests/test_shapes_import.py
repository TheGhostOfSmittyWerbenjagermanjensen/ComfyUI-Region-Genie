"""Round 6 checks: rounded rectangle (shape_verts / layer_mask), min region pixels and import mode from paint_data."""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from stubs import check, fails, T  # noqa: E402
import numpy as np  # noqa: E402

from rgpack import region_genie as rg  # noqa: E402

# ---------------------------------------------------------------- rounded rectangle
v = rg.shape_verts("roundrect", 5, 1, 1, 0)
check("roundrect radius 0 = rect", v == rg.shape_verts("rect"))
v = rg.shape_verts("roundrect", 5, 1, 1, 50)
check("roundrect 50% on a square = circle", all(abs(math.hypot(x - .5, y - .5) - .5) < 1e-9 for x, y in v))
v = rg.shape_verts("roundrect", 5, 2, 1, 50)                 # corner radius 0.5 L: rx = 0.25, ry = 0.5 (unit box)
xs = sorted(set(round(x, 6) for x, y in v))
check("roundrect 2x1: corners round in L units", min(xs) == 0 and max(xs) == 1 and any(abs(x - .25) < 1e-6 for x, _ in v))
check("roundrect bad radius -> default 20%", rg.shape_verts("roundrect", 5, 1, 1, "x") == rg.shape_verts("roundrect", 5, 1, 1, 20))
check("roundrect radius clamped to 50", rg.shape_verts("roundrect", 5, 1, 1, 90) == rg.shape_verts("roundrect", 5, 1, 1, 50))
L = {"id": 1, "region": 1, "shape": "roundrect", "radius": 40, "bw": 1, "bh": 1, "sx": 1, "sy": 1, "rot": 0, "ox": 0, "oy": 0, "ops": []}
m = rg.layer_mask(L, 100, 100)
check("roundrect mask: corner empty, centre and edge middles filled", not m[1, 1] and m[50, 50] and m[50, 1] and m[1, 50])
check("roundrect mask: area between rect and circle", math.pi * 50 ** 2 < m.sum() < 100 * 100)
L2 = dict(L, ops=[{"t": "stroke", "e": False, "d": 0.02, "p": [[0.5, 0.5], [0.6, 0.5]]}])
m2 = rg.layer_mask(L2, 100, 100)
check("roundrect + strokes: same corners", not m2[1, 1] and m2[50, 1])
L3 = dict(L, shape="rect")
check("rect ignores radius", rg.layer_mask(L3, 100, 100)[0, 0])

# ---------------------------------------------------------------- gradient fill: a layer whose strength fades
full = {"t": "bitmap", "e": False, "w": 4, "h": 4, "runs": [0, 16], "x0": 0, "y0": 0, "x1": 1, "y1": 1}
G = {"id": 5, "region": 2, "shape": None, "bw": 1, "bh": 1, "sx": 1, "sy": 1, "rot": 0, "ox": 0, "oy": 0, "ops": [full],
     "grad": {"k": "linear", "a": [0, 0.5], "b": [1, 0.5]}}
fd = rg.layer_fade(G, 64, 64)
check("linear gradient: full at the start of the line, nothing at its end, even in between",
      fd[32, 0] > 0.98 and fd[32, 63] < 0.02 and abs(fd[32, 31] - 0.5078) < 0.01 and abs(fd[0, 16] - fd[63, 16]) < 1e-6)
check("an ordinary layer has no fade", rg.layer_fade(dict(G, grad=None), 64, 64) is None and rg.layer_fade({**G, "grad": {"k": "linear", "a": [0, 0], "b": [0, 0]}}, 64, 64) is None)
rad = rg.layer_fade({**G, "grad": {"k": "radial", "a": [0.5, 0.5], "b": [0.5, 1.0]}}, 64, 64)
check("radial gradient: full at the centre, nothing from the dragged distance on", rad[32, 32] > 0.97 and rad[32, 63] < 0.03 and rad[0, 0] == 0 and abs(rad[32, 48] - rad[48, 32]) < 1e-6)
base = {"id": 4, "region": 1, "shape": "rect", "bw": 1, "bh": 1, "sx": 1, "sy": 1, "rot": 0, "ox": 0, "oy": 0, "ops": []}
soft = {}
ix = rg.render_layers(np.zeros((64, 64), np.uint8), [base, G], {1: 1, 2: 2}, soft)
check("the gradient region owns the pixels where it is at least half strength; the rest stays with the region below",
      (ix[:, :31] == 2).all() and (ix[:, 33:] == 1).all())
m1, m2 = rg.soft_mask(ix, 1, soft), rg.soft_mask(ix, 2, soft)
check("its mask fades across the whole area (also where the region below shows)", m2[32, 0] > 0.98 and 0.2 < m2[32, 48] < 0.3 and m2[32, 63] < 0.02)
check("the region below: full where it shows, nothing under the strong half", m1[32, 48] == 1 and m1[32, 10] == 0)
soft2 = {}
ix2 = rg.render_layers(np.zeros((64, 64), np.uint8), [base, G, dict(base, id=6, region=1)], {1: 1, 2: 2}, soft2)
check("a layer on top hides the gradient completely", (ix2 == 1).all() and rg.soft_mask(ix2, 2, soft2).max() == 0 and rg.soft_mask(ix2, 1, soft2).min() == 1)
soft3 = {}
rg.render_layers(np.zeros((64, 64), np.uint8), [base], {1: 1}, soft3)
check("no gradient layer: nothing extra is kept", soft3 == {})
hole = rg.render_layers(np.zeros((64, 64), np.uint8), [base, dict(G, region=0)], {1: 1}, {})
check("a hole is always hard, also with a gradient on it", (hole == 0).all())
turned = rg.layer_fade(dict(G, rot=90), 64, 64)
check("the gradient turns with its layer", turned[0, 32] > 0.98 and turned[63, 32] < 0.02)

# ---------------------------------------------------------------- min region pixels from paint_data
node = rg.RegionGenie()
arr = np.zeros((1, 64, 64, 3), np.float32)
arr[0, :, :32] = [1, 0, 0]
arr[0, :, 32:] = [0, 1, 0]
arr[0, 10:20, 40:50] = [0, 0, 1]                              # 100 blue px
img = arr.view(T)
def run(pd, **kw):
    args = dict(width=64, height=64, scene_prompt_positive="", scene_prompt_negative="",
                image_mode=rg.IMAGE_MODES[1], min_region_pixels=64, paint_data=pd, image=img)
    args.update(kw)
    return node.run(**args)
det = lambda out: json.loads(out["ui"]["detected"][0])
base = {"v": 2, "regions": [], "layers": []}
d1 = det(run(json.dumps(base)))
check("color map, widget 64: blue patch is a region", len(d1) == 3)
d2 = det(run(json.dumps(dict(base, minPixels=500))))
check("color map, paint_data minPixels 500 wins: blue patch is not", len(d2) == 2)
d3 = det(run(json.dumps(dict(base, minPixels="junk"))))
check("bad minPixels falls back to the widget", len(d3) == 3)

# ---------------------------------------------------------------- import mode from paint_data
layout = json.dumps({"regions": [{"id": 1, "color": "#E6194B", "prompt": "cat"}],
                     "layers": [{"id": 1, "region": 1, "shape": "rect", "bw": .5, "bh": .5, "sx": 1, "sy": 1, "rot": 0, "ox": 0, "oy": 0, "ops": []}]})
full = {"v": 2, "regions": [{"id": 1, "color": "#3CB44B", "prompt": "dog"}],
        "layers": [{"id": 1, "region": 1, "shape": "rect", "bw": 1, "bh": 1, "sx": 1, "sy": 1, "rot": 0, "ox": 0, "oy": 0, "ops": []}]}
def imp(pd, **kw):
    out = run(json.dumps(pd), image=None, image_mode=rg.IMAGE_MODES[0], import_json=layout, **kw)
    return json.loads(out["ui"]["layout_import"][0])["action"]
check("import: widget 'ask' -> pending", imp(full) == "pending")
check("import: paint_data importMode 'always replace' wins", imp(dict(full, importMode="always replace")) == "applied")
check("import: paint_data 'ask' wins over widget 'always'", imp(dict(full, importMode="ask before replacing"), import_mode="always replace") == "pending")
check("import: unknown importMode -> widget", imp(dict(full, importMode="nope"), import_mode="always replace") == "applied")

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
