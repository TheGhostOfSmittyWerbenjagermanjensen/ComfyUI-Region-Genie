"""Round 9 checks: hidden regions (the region's eye in the list) are left out of every output."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from stubs import check, fails, T  # noqa: E402,F401
import numpy as np  # noqa: E402

from rgpack import region_genie as rg  # noqa: E402

node = rg.RegionGenie()


def run(pd, **kw):
    args = dict(width=64, height=64, scene_prompt_positive="", scene_prompt_negative="",
                image_mode=rg.IMAGE_MODES[0], min_region_pixels=64, paint_data=json.dumps(pd), prompt_format="text")
    args.update(kw)
    return node.run(**args)


def rect(lid, rid, ox, visible=True):
    return {"id": lid, "region": rid, "visible": visible, "shape": "rect", "bw": .5, "bh": 1, "sx": 1, "sy": 1, "rot": 0,
            "ox": ox, "oy": 0, "ops": []}


R = lambda out, name: out["result"][rg.RegionGenie.RETURN_NAMES.index(name)]
regions = [{"id": 1, "color": "#E6194B", "prompt": "a red cat"}, {"id": 2, "color": "#3CB44B", "prompt": "a green dog"}]
pd = {"v": 2, "regions": regions, "layers": [rect(1, 1, -.25), rect(2, 2, .25)]}

out = run(pd)
check("both shown: two masks", R(out, "masks").shape[0] == 2 and "green dog" in R(out, "prompt"))
hid = json.loads(json.dumps(pd))
hid["regions"][1]["hidden"] = True
out = run(hid)
m = R(out, "masks")
check("hidden region: one mask", m.shape[0] == 1)
check("hidden region: not in the prompt", "green dog" not in R(out, "prompt") and "red cat" in R(out, "prompt"))
cm = np.asarray(R(out, "color_map"))[0]
check("hidden region: its area is unspecified (black) in the color map", float(cm[32, 48].sum()) == 0 and float(cm[32, 16].sum()) > 0)
check("hidden region: its layer keeps its own visible flag", hid["layers"][1]["visible"] is True)
hid["regions"][0]["hidden"] = True
out = run(hid)
check("all hidden: no masks", R(out, "masks").shape[0] == 0 or float(np.asarray(R(out, "masks")).sum()) == 0)

# color map mode: an image color that belongs to a hidden region stays unspecified
arr = np.zeros((1, 64, 64, 3), np.float32)
arr[0, :, :32] = [230 / 255, 25 / 255, 75 / 255]              # #E6194B (region 1)
arr[0, :, 32:] = [60 / 255, 180 / 255, 75 / 255]              # #3CB44B (region 2)
img = arr.view(T)
cmap = {"v": 2, "regions": [dict(regions[0], fromImage=True), dict(regions[1], fromImage=True, hidden=True)], "layers": []}
out = run(cmap, image=img, image_mode=rg.IMAGE_MODES[1])
det = json.loads(out["ui"]["detected"][0])
check("color map: hidden region's color is not a region", len(det) == 1 and det[0].upper() == "#E6194B")
check("color map: one mask", R(out, "masks").shape[0] == 1)

print("\n" + (f"{len(fails)} failed" if fails else "all passed"))
sys.exit(1 if fails else 0)
