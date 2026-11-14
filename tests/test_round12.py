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
old = json.dumps({"modelPick": "MOSS Image", "autoApart": {"MOSS Image": "off"}, "regions": [{"prompt": "MOSS Image"}],
                  "sceneLoras": [{"lora": "a", "edit": "MOSS Image"}, {"lora": "b", "control": "MOSS Image", "ckind": "moss"}]})
new = json.loads(rg.migrate_names(old))
check("migrate_names: pick, autoApart key and LoRA tags renamed, a prompt left as it is",
      new["modelPick"] == "MOSS-Image" and new["autoApart"] == {"MOSS-Image": "off"} and new["regions"][0]["prompt"] == "MOSS Image"
      and new["sceneLoras"][0]["edit"] == "MOSS-Image" and new["sceneLoras"][1]["control"] == "MOSS-Image")
spaced = json.loads(rg.migrate_names(json.dumps(json.loads(old), indent=1)))
check("migrate_names: also with spaces after ':'", spaced["modelPick"] == "MOSS-Image" and spaced["autoApart"] == {"MOSS-Image": "off"})
check("migrate_names: leaves other data alone", rg.migrate_names('{"v": 2}') == '{"v": 2}' and rg.migrate_names(None) is None)

print("\nall passed" if not fails else f"\n{len(fails)} failed")
sys.exit(1 if fails else 0)
