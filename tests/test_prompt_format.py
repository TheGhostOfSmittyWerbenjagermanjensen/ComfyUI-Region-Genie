"""Round 12 checks: the model dropdown sets the prompt format, MOSS-Image's layout / standard switch (and standard
mode when no region is shown), scene_prompt_background only for Ideogram 4."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from stubs import check, fails  # noqa: E402,F401

from rgpack import region_genie as rg  # noqa: E402

node = rg.RegionGenie()


def rect(lid, rid, ox):
    return {"id": lid, "region": rid, "visible": True, "shape": "rect", "bw": .5, "bh": 1, "sx": 1, "sy": 1, "rot": 0,
            "ox": ox, "oy": 0, "ops": []}


regions = [{"id": 1, "color": "#E6194B", "prompt": "a red cat"}, {"id": 2, "color": "#3CB44B", "prompt": "a green dog"}]
BASE = {"v": 2, "regions": regions, "layers": [rect(1, 1, -.25), rect(2, 2, .25)]}


def run(extra=None, pd=None, **kw):
    d = json.loads(json.dumps(pd or BASE))
    d.update(extra or {})
    args = dict(width=64, height=64, scene_prompt_positive="a sunny park", scene_prompt_negative="",
                scene_prompt_background="green grass", image_mode=rg.IMAGE_MODES[0], min_region_pixels=64,
                paint_data=json.dumps(d), prompt_format="auto")
    args.update(kw)
    out = node.run(**args)
    return out["result"][rg.RegionGenie.RETURN_NAMES.index("prompt")], out["ui"]["prompt_format"][0]


p, f = run({"modelPick": "MOSS-Image"})
check("picked MOSS-Image: MOSS layout JSON", f == "MOSS JSON" and json.loads(p)["items"][0]["caption"] == "a red cat")
check("MOSS JSON has no background", "green grass" not in p)
p, f = run({"modelPick": "MOSS-Image", "mossLayout": False})
check("MOSS-Image standard mode: plain text", f == "text" and "a red cat" in p and not p.lstrip().startswith("{"))
p, f = run({"modelPick": "MOSS-Image"}, pd={"v": 2, "regions": [], "layers": []})
check("MOSS-Image, no regions: plain text by itself", f == "text" and p.strip() == "a sunny park")
hid = json.loads(json.dumps(BASE))
for r in hid["regions"]:
    r["hidden"] = True
p, f = run({"modelPick": "MOSS-Image"}, pd=hid)
check("MOSS-Image, every region hidden: plain text by itself", f == "text" and "a red cat" not in p)
# round 20: hole layers (region 0, listed under a region with 'owner') don't count as regions either
holes = {"v": 2, "regions": regions, "layers": [dict(rect(1, 0, -.25), owner=1), dict(rect(2, 0, .25), owner=2)]}
p, f = run({"modelPick": "MOSS-Image"}, pd=holes)
check("MOSS-Image, only hole layers: plain text by itself", f == "text" and "a red cat" not in p)
hole_over = {"v": 2, "regions": regions, "layers": [rect(1, 1, -.25), rect(2, 2, .25), dict(rect(3, 0, .25), owner=2)]}
p, f = run({"modelPick": "MOSS-Image"}, pd=hole_over)
check("a hole over a region's only layer removes that region; the other stays (layout JSON)",
      f == "MOSS JSON" and [x["caption"] for x in json.loads(p)["items"]] == ["a red cat"])
p, f = run({"modelPick": "Ideogram 4"})
j = json.loads(p)
check("picked Ideogram 4: caption JSON with the background", f == "Ideogram JSON"
      and j["compositional_deconstruction"]["background"] == "green grass")
for m in ("Krea 2", "Flux.1", "Flux.2", "Flux 3", "Anima", "SDXL", "SD1.5"):
    p, f = run({"modelPick": m})
    check(f"picked {m}: plain text, no background", f == "text" and "a red cat" in p and "green grass" not in p)
p, f = run({"modelPick": "Krea 2"}, prompt_format="MOSS JSON")
check("a model picked on the node wins over the old hidden format value", f == "text")
p, f = run({}, prompt_format="Ideogram JSON")
check("old hidden format value still works without a pick (API prompts)", f == "Ideogram JSON")
p, f = run({"modelPick": "nonsense"}, prompt_format="text")
check("an unknown pick is ignored", f == "text")
fam, why = rg.prompt_family(None, None, "auto", None, edit=True, pick="MOSS-Image")
check("MOSS-Image in Edit Mode: plain instruction (also when picked)", fam == "plain" and "edit" in why)
fam, why = rg.prompt_family(None, None, "MOSS JSON", None, edit=True)
check("MOSS JSON set on the node, Edit Mode: plain instruction", fam == "plain")
fam, why = rg.prompt_family(None, None, "auto", None)
check("nothing known: MOSS JSON (default)", fam == "moss" and why == "default")
fam, why = rg.prompt_family(None, None, "auto", "plain")
check("the downstream text encoder hint still applies", fam == "plain")

# round 17: paint data saved (or API prompts made) when the model was stored as 'MOSS Image'
p, f = run({"modelPick": "MOSS Image"})
check("old pick 'MOSS Image': still MOSS layout JSON", f == "MOSS JSON" and json.loads(p)["items"][0]["caption"] == "a red cat")
old = json.dumps({"modelPick": "MOSS Image", "autoSeparate": {"MOSS Image": "off"}, "regions": [{"prompt": "MOSS Image"}],
                  "sceneLoras": [{"lora": "a", "edit": "MOSS Image"}, {"lora": "b", "control": "MOSS Image", "ckind": "moss"}]})
new = json.loads(rg.migrate_names(old))
check("migrate_names: pick, autoSeparate key and LoRA tags renamed, a prompt left as it is",
      new["modelPick"] == "MOSS-Image" and new["autoSeparate"] == {"MOSS-Image": "off"} and new["regions"][0]["prompt"] == "MOSS Image"
      and new["sceneLoras"][0]["edit"] == "MOSS-Image" and new["sceneLoras"][1]["control"] == "MOSS-Image")
spaced = json.loads(rg.migrate_names(json.dumps(json.loads(old), indent=1)))
check("migrate_names: also with spaces after ':'", spaced["modelPick"] == "MOSS-Image" and spaced["autoSeparate"] == {"MOSS-Image": "off"})
check("migrate_names: leaves other data alone", rg.migrate_names('{"v": 2}') == '{"v": 2}' and rg.migrate_names(None) is None)

# ---------------------------------------------------------------- keep all regions separate by itself, and switched off on the node
import types  # noqa: E402
from rgpack import regional_lora as hl  # noqa: E402
_arch, _ok = hl.model_arch, hl.one_pass_ok
hl.model_arch = lambda m: types.SimpleNamespace(name="Krea 2", family="Krea 2")
hl.one_pass_ok = lambda m: False                       # stop right after the decision (no sampling code in this test)
def auto_separate(opts):
    st, notes = {}, []
    pd = json.dumps({"loraOpts": opts, "autoSeparate": {"all": True}})
    rg.RegionGenie._regional_loras(object(), object(), pd, [{"out_index": 0, "prompt": "a cat", "loras": []}], None, "", None, notes, status=st, family="plain")
    return bool(st.get("auto_separate"))
check("a model without a layout format: keep all regions separate turns on by itself", auto_separate({}) is True)
check("switched off on the node (autoOff): it stays off", auto_separate({"autoOff": True}) is False)
hl.model_arch, hl.one_pass_ok = _arch, _ok

# ---- round 40: one size_from input (an image or a latent); the guard for a node that shows only some outputs
import torch  # noqa: E402  (the stub)


def size_of(**kw):
    args = dict(width=64, height=64, scene_prompt_positive="", scene_prompt_negative="", image_mode=rg.IMAGE_MODES[0],
                min_region_pixels=64, paint_data=json.dumps(BASE), prompt_format="auto")
    args.update(kw)
    r = node.run(**args)["result"]
    return r[rg.RegionGenie.RETURN_NAMES.index("width")], r[rg.RegionGenie.RETURN_NAMES.index("height")]


img = torch.zeros((1, 48, 80, 3))                       # an image batch: height 48, width 80
lat = {"samples": torch.zeros((1, 4, 16, 24))}          # an SD-style latent: 8x -> 192 x 128
check("size_from with an image: its size", size_of(size_from=img) == (80, 48))
check("size_from with a latent: its size times the latent scale", size_of(size_from=lat) == (192, 128))
check("size_from comes before the older size_from_latent socket", size_of(size_from=img, size_from_latent=lat) == (80, 48))
check("a latent on size_from comes before an image on the older size_from_image socket", size_of(size_from=lat, size_from_image=img) == (192, 128))
check("the older sockets still work (API prompts, old workflows)", size_of(size_from_image=img) == (80, 48) and size_of(size_from_latent=lat) == (192, 128))
check("nothing connected: the size row's width and height", size_of() == (64, 64))
try:
    size_of(outputs_shown="model,positive,masks")
    check("outputs_shown still set when the node runs: it stops with a clear message", False)
except ValueError as e:
    check("outputs_shown still set when the node runs: it stops with a clear message", "output numbers" in str(e))
check("outputs_shown empty: runs as always", size_of(outputs_shown="") == (64, 64))
check("the outputs are in the order the editor's script maps names to",
      rg.RegionGenie.RETURN_NAMES == ("model", "positive", "negative", "latent", "prompt", "color_map", "masks", "bboxes",
                                      "elements", "character_boxes", "region_info", "width", "height"))

# round 44: the node notes what a run used, for Save Image's settings text (in memory, by the node's id)
from rgpack import gen_params  # noqa: E402
gen_params.RUNS.clear()
p, _ = run({"modelPick": "MOSS-Image", "sceneLoras": [{"lora": "whole.safetensors", "strength": 0.7}]},
           scene_prompt_negative="blurry", unique_id="77")
note = gen_params.RUNS.get("77") or {}
check("a run notes its 'prompt' output's exact text, its negative prompt and its size under the node's id",
      note.get("prompt") == p and note.get("negative") == "blurry" and note.get("width") == 64 and note.get("height") == 64)
check("…and no LoRA when no model is connected (none was applied)", note.get("loras") == [])
run(scene_prompt_negative="x")
check("a run without an id (an API call that doesn't give one) notes nothing", list(gen_params.RUNS) == ["77"])

print("\nall passed" if not fails else f"\n{len(fails)} failed")
sys.exit(1 if fails else 0)
