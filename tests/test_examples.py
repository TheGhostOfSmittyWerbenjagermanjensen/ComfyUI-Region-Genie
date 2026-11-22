"""The example workflows (example_workflows/, built by tests/make_examples.cjs): each file is a sound workflow with
the Region Genie node wired to a sampler, and the README and the manual list every file, MOSS-Image first.
No ComfyUI needed. `node tests/make_examples.cjs check` loads them in a real ComfyUI page."""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "example_workflows")
fails = 0


def check(name, ok):
    global fails
    print(("PASS " if ok else "FAIL ") + name)
    fails += 0 if ok else 1


files = sorted(f for f in os.listdir(DIR) if f.endswith(".json"))
check(f"{len(files)} workflows, MOSS-Image layout first, then MOSS-Image text-to-image",
      len(files) == 11 and files[0] == "01-moss-image-layout.json" and files[1] == "02-moss-image-text-to-image.json")
ARCH = {"moss": "moss", "krea": "krea", "ideogram": "ideogram", "flux-1": "flux1", "flux-2": "flux", "flux-3": "flux3", "anima": "anima", "sdxl": "xl", "sd-1-5": "v1-5"}
for f in files:
    d = json.load(open(os.path.join(DIR, f), encoding="utf-8"))
    nodes = {n["id"]: n for n in d["nodes"]}
    types = [n["type"] for n in d["nodes"]]
    ok = True
    for l in d["links"]:                                   # [id, from node, from slot, to node, to slot, type]
        _, a, sa, b, sb, _t = l[:6]
        ok = ok and a in nodes and b in nodes and sa < len(nodes[a].get("outputs", [])) and sb < len(nodes[b].get("inputs", []))
        ok = ok and nodes[b]["inputs"][sb].get("link") == l[0] and l[0] in (nodes[a]["outputs"][sa].get("links") or [])
    check(f"{f}: every link joins two sockets that exist", ok and len(d["links"]) >= 9)
    # saved as ComfyUI's Save writes it: a widget has a socket entry only when something is connected to it
    check(f"{f}: no unused widget sockets in the file", not any(i.get("widget") and i.get("link") is None for n in d["nodes"] for i in n.get("inputs", [])))
    if "moss" in f:
        check(f"{f}: skip-layer guidance between the loader and the node", "SkipLayerGuidanceDiTSimple" in types)
    rg = [n for n in d["nodes"] if n["type"] == "Region-Genie_Main"]
    check(f"{f}: one Region Genie node, a sampler, VAE Decode, Save Image (Region Genie), a note",
          len(rg) == 1 and ("KSampler" in types or "SamplerCustomAdvanced" in types) and "VAEDecode" in types and "Region-Genie_SaveImage" in types and "MarkdownNote" in types)
    rg = rg[0]
    ins = {i["name"]: i.get("link") for i in rg["inputs"]}
    outs = {o["name"]: o.get("links") for o in rg["outputs"]}
    check(f"{f}: model, clip and vae go in; model, positive and latent go out",
          all(ins.get(k) is not None for k in ("model", "clip", "vae")) and all(outs.get(k) for k in ("model", "positive", "latent")))
    data = next((json.loads(v) for v in rg["widgets_values"] if isinstance(v, str) and v.startswith('{"v":')), None)
    want = 0 if "text-to-image" in f else 3
    check(f"{f}: {want} regions, each with a prompt and a layer",
          data is not None and len(data["regions"]) == want and all(r.get("prompt") for r in data["regions"])
          and {L["region"] for L in data["layers"]} == {r["id"] for r in data["regions"]})
    check(f"{f}: separation 0.85 and until 0.1, the defaults", data is not None and data.get("loraOpts", {}).get("separation") == 0.85 and data.get("loraOpts", {}).get("until") == 0.1)
    check(f"{f}: a positive scene prompt; saved by the current node (rg_sockets)", any(isinstance(v, str) and "harbor" in v for v in rg["widgets_values"]) and rg.get("properties", {}).get("rg_sockets") == 1)
    loaders = [n for n in d["nodes"] if "Loader" in n["type"]]
    names = " ".join(str(v) for n in loaders for v in n.get("widgets_values", [])).lower()
    key = next(k for k in ARCH if k in f)
    check(f"{f}: the loaders name that model's files, each with its download", ARCH[key].replace("flux1", "flux1-").replace("flux3", "flux3-") in names
          and all(m["url"].startswith("https://huggingface.co/") for n in loaders for m in n.get("properties", {}).get("models", []))
          and all(n.get("properties", {}).get("models") for n in loaders if "rdbt" not in str(n["widgets_values"])))
    note = next(n for n in d["nodes"] if n["type"] == "MarkdownNote")["widgets_values"][0]
    check(f"{f}: the note lists every file of the loaders", all(v in note for n in loaders for v in n["widgets_values"] if str(v).endswith(".safetensors")))
    samplers = [n for n in d["nodes"] if n["type"] in ("KSampler", "RandomNoise")]
    check(f"{f}: the seed is 1 and fixed", len(samplers) == 1 and samplers[0]["widgets_values"][:2] == [1, "fixed"])
    if "anima" in f:
        check(f"{f}: RDBT in the loader, Anima Base and RDBT in the note, the background shared, the style and quality tags",
              "rdbt_v3.0_sma_anima_b1_ckpt.safetensors" in names and "anima-base-v1.0.safetensors" in note and "https://civitai.com/models/2356447/rdbt-or-anima" in note
              and note.index("anima-base-v1.0") < note.index("rdbt_v3.0") and data["loraOpts"].get("shareBg") is True
              and any(isinstance(v, str) and v.endswith("watercolor \\(medium\\), oil painting \\(medium\\), traditional media, impressionism") for v in rg["widgets_values"])
              and any(isinstance(v, str) and v.endswith("artist name, watermark, signature") for v in rg["widgets_values"]))
    blob = json.dumps(d)
    check(f"{f}: no personal path, no key", not re.search(r"/home/|/Users/|[A-Z]:\\\\|api[_-]?key|token", blob, re.I))

for page, prefix in (("README.md", ""), (os.path.join("docs", "region-genie.md"), "../")):
    text = open(os.path.join(ROOT, page), encoding="utf-8").read()
    listed = re.findall(r"\]\(" + re.escape(prefix) + r"example_workflows/([^)]+\.json)\)", text)
    check(f"{page}: its table links every workflow, in order", listed == files)
check("the old examples folder is gone", not os.path.exists(os.path.join(ROOT, "examples")))
print("\nALL PASS" if not fails else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
