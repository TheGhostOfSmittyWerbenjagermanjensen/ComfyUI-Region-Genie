"""Round 9 checks: hidden regions (the region's eye in the list) are left out of every output."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from stubs import check, fails, T  # noqa: E402,F401
import numpy as np  # noqa: E402

from rgpack import region_genie as rg  # noqa: E402

node = rg.RegionGenie()


def run(pd, model="Krea 2", **kw):
    # (round 103: the format comes from the model picked on the node; the old hidden prompt_format value is not read)
    args = dict(width=64, height=64, scene_prompt_positive="", scene_prompt_negative="",
                image_mode=rg.IMAGE_MODES[0], min_region_pixels=64, paint_data=json.dumps({**pd, "modelPick": pd.get("modelPick") or model}))
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

# ---------------------------------------------------------------- wildcards (a stand-in for Impact Pack's module)
import types  # noqa: E402
import zlib  # noqa: E402
from rgpack import wildcards as wc  # noqa: E402

COLORS = ["red", "green", "blue"]
def fake_process(text, seed=None):
    import re
    out = re.sub(r"__color__", lambda m: COLORS[int(seed) % 3], text)
    return re.sub(r"\{([^{}|]*)\|([^{}]*)\}", lambda m: m.group(1 + int(seed) % 2), out)
fake = types.ModuleType("impact.wildcards")
fake.process = fake_process
fake.available_wildcards = {"color": "x.txt", "animals/cat": "y.txt"}
fake.wildcard_dict = {}
fake.wildcard_load = lambda: None
pkg = types.ModuleType("impact")
pkg.wildcards = fake

check("syntax: __name__", wc.has_syntax("a __color__ car"))
check("syntax: {a|b}", wc.has_syntax("a {red|blue} car"))
check("syntax: plain text is not", not wc.has_syntax("a red car"))
check("syntax: a JSON layout is not (Regional LoRAs' prompt from Region Genie)", not wc.has_syntax('{"caption": "a {red|blue} car", "items": []}'))
check("seed: the same for every field by default", wc.field_seed(7, "scene", False) == wc.field_seed(7, "r3", False) == 7)
check("seed per field: derived from the field", wc.field_seed(7, "r3", True) == (7 + zlib.crc32(b"r3")) & wc.SEED_MAX)

sys.modules.pop("impact", None)
sys.modules.pop("impact.wildcards", None)
notes = []
f0 = wc.Filler(1, notes=notes)
check("without Impact Pack: text unchanged, one note", f0("scene", "__color__ sky") == "__color__ sky" and f0("r1", "{a|b}") == "{a|b}" and len(notes) == 1)
check("without Impact Pack: no list", wc.wildcard_names() is None)

sys.modules["impact"] = pkg
sys.modules["impact.wildcards"] = fake
check("list: every wildcard Impact knows (on-demand ones too)", wc.wildcard_names() == ["__animals/cat__", "__color__"])
pd = {"v": 2, "regions": [{"id": 1, "color": "#E6194B", "prompt": "a __color__ car", "type": "object", "text": ""},
                          {"id": 2, "color": "#3CB44B", "prompt": "a plain dog", "type": "text", "text": "{YES|NO}"}],
      "layers": [rect(1, 1, -.25), rect(2, 2, .25)]}
out = run(pd, scene_prompt_positive="a __color__ sky", wildcard_seed=1)
P = R(out, "prompt")
check("run: region prompt filled (seed 1 -> green)", "a green car" in P and "__color__" not in P)
check("run: scene prompt filled with the same seed", "a green sky" in P)
check("run: text to render filled (MOSS JSON carries it)", '"text":"NO"' in R(run(pd, wildcard_seed=1, model="MOSS-Image"), "prompt").replace(" ", ""))
filled = json.loads(out["ui"]["wildcards"][0])
check("run: the UI gets raw and filled text per field", filled.get("r1") == {"raw": "a __color__ car", "filled": "a green car"}
      and set(filled) == {"scene", "r1", "r2.text"})
check("run: the canvas state is not changed", pd["regions"][0]["prompt"] == "a __color__ car")
out2 = run(dict(pd, wcPerField=True), scene_prompt_positive="a __color__ sky", wildcard_seed=1)
f2 = json.loads(out2["ui"]["wildcards"][0])
exp = lambda key: COLORS[((1 + zlib.crc32(key.encode())) & wc.SEED_MAX) % 3]
check("run, seed per field: each field from its own seed", f2["r1"]["filled"] == f"a {exp('r1')} car" and f2["scene"]["filled"] == f"a {exp('scene')} sky")
out3 = run(pd, scene_prompt_positive="no wildcards", wildcard_seed=2)
check("run: seed 2 -> blue", "a blue car" in R(out3, "prompt"))
sys.modules.pop("impact", None)
sys.modules.pop("impact.wildcards", None)

print("\n" + (f"{len(fails)} failed" if fails else "all passed"))
sys.exit(1 if fails else 0)
