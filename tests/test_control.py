"""Control (ControlNet / control LoRAs) against real ComfyUI code and torch, on CPU, without model files: a stand-in VAE,
ControlNet and LLLite patch record what ComfyUI's own nodes hand them.

    COMFY_DIR=/path/to/ComfyUI python3 tests/test_control.py
"""
import importlib.util
import os
import sys

COMFY = os.environ.get("COMFY_DIR", "/tmp/comfy_src")
sys.path.insert(0, COMFY)
import comfy.cli_args  # noqa: E402
comfy.cli_args.args.cpu = True
import numpy as np  # noqa: E402
import torch  # noqa: E402

PACK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("rg_control", os.path.join(PACK, "control.py"))
ctl = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(ctl)

fails = []
def check(name, ok):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


class VAE:                                     # 8x down, 3 channels: enough to see what was encoded
    def encode(self, img):
        return torch.nn.functional.avg_pool2d(img[..., :3].movedim(-1, 1), 8)


class FakeCN:                                  # what ControlNetApplyAdvanced does with a ControlNet
    def __init__(self):
        self.hint = None; self.args = None
    def copy(self):
        return self
    def set_cond_hint(self, hint, strength, rng, vae=None, extra_concat=[]):
        self.hint, self.args = hint, (strength, rng)
        return self
    def set_previous_controlnet(self, prev):
        pass


W = H = 64
def cond():
    return [[torch.zeros(1, 4, 8), {}]]
def ce(c):                                     # the conditioning entry that carries the control (the step range splits it)
    return next((t[1] for t in c if "concat_latent_image" in t[1] or "control" in t[1]), {})
def cfg(kind, files=None, **kw):
    return ctl.config({"control": {"on": True, "kind": kind, "files": files or {}, **kw}})
cmap = torch.zeros(1, H, W, 3); cmap[:, :, :32] = torch.tensor([1.0, 0.1, 0.3]); cmap[:, :, 32:] = torch.tensor([0.2, 0.7, 0.3])
photo = torch.zeros(1, H, W, 3); photo[:, 16:48, 16:48] = 1.0                 # a white square: edges for canny
half = np.zeros((H, W), bool); half[:, :32] = True                            # the left half: a region still on for control

# ---------------------------------------------------------------- settings
check("off: no config", ctl.config({"control": {"on": False}}) is None and ctl.config({}) is None)
c = cfg("depth", strength=2.5, start=0.2, end=0.7)
check("config: kind, strength, start, end", c["kind"] == "depth" and c["strength"] == 2.5 and c["start"] == 0.2 and c["end"] == 0.7)
check("config: bad kind -> depth, numbers clamped", cfg("x", strength=99)["kind"] == "depth" and cfg("x", strength=99)["strength"] == 10)
check("LoRA tag: MOSS row used for color / depth with MOSS", ctl.lora_tag_ok({"control": "MOSS Image", "ckind": "moss"}, cfg("color"), "MOSS Image"))
check("LoRA tag: not with another model", not ctl.lora_tag_ok({"control": "MOSS Image", "ckind": "moss"}, cfg("color"), "Flux.1"))
check("LoRA tag: Flux depth LoRA not for canny", not ctl.lora_tag_ok({"control": "Flux.1", "ckind": "depth"}, cfg("canny"), "Flux.1"))
check("LoRA tag: nothing while control is off", not ctl.lora_tag_ok({"control": "MOSS Image", "ckind": "moss"}, None, "MOSS Image"))
regions = [{"id": 1}, {"id": 2, "noControl": True}]
idx = np.zeros((H, W), np.uint8); idx[:, :32] = 1; idx[:, 32:] = 2
check("region mask: everywhere while all regions are on", ctl.region_mask([{"id": 1}, {"id": 2}], {1: 1, 2: 2}, idx) is None)
rm = ctl.region_mask(regions, {1: 1, 2: 2}, idx)
check("region mask: only the regions still on", rm[:, :32].all() and not rm[:, 32:].any())

# ---------------------------------------------------------------- MOSS Image: color / depth control LoRA
notes = []
m, p, n, prev = ctl.apply(cfg("color", {"MOSS": "moss_ctrl.safetensors"}, strength=2, start=0.1, end=0.6), "MOSS Image", "M",
                          cond(), cond(), VAE(), None, None, cmap, None, W, H, notes)
d = ce(p)
lat = d.get("concat_latent_image")
check("MOSS color: [color | depth] latents as concat_latent_image", lat is not None and tuple(lat.shape) == (1, 6, 8, 8))
check("MOSS color: color latent x strength, depth zeros", torch.allclose(lat[:, :3], 2 * VAE().encode(cmap)) and lat[:, 3:].abs().sum() == 0)
check("MOSS color: start / end on the conditioning", abs(d.get("start_percent", -1) - 0.1) < 2e-5 and abs(d.get("end_percent", -1) - 0.6) < 2e-5)
check("MOSS color: negative too, the color map as preview", "concat_latent_image" in ce(n) and prev is not None)
notes = []
_, p, _, _ = ctl.apply(cfg("color", {"MOSS": "x"}), "MOSS Image", "M", cond(), cond(), VAE(), None, None, cmap, half, W, H, notes)
lat = ce(p)["concat_latent_image"]
check("MOSS per region: zero latent (no control) outside the regions still on", lat[..., 4:].abs().sum() == 0 and lat[..., :4].abs().sum() > 0)
dmap = torch.full((1, H, W, 3), 0.5)
_, p, _, prev = ctl.apply(cfg("color+depth", {"MOSS": "x"}), "MOSS Image", "M", cond(), cond(), VAE(), None, dmap, cmap, None, W, H, [])
lat = ce(p)["concat_latent_image"]
check("MOSS color + depth: depth from control_image in the second half", torch.allclose(lat[:, 3:], VAE().encode(dmap)) and lat[:, :3].abs().sum() > 0)
notes = []
ctl.apply(cfg("canny", {"MOSS": "x"}), "MOSS Image", "M", cond(), cond(), VAE(), photo, None, cmap, None, W, H, notes)
check("MOSS canny: not supported, noted", any("not canny" in x or "canny" in x for x in notes))
notes = []
ctl.apply(cfg("color"), "MOSS Image", "M", cond(), cond(), None, None, None, cmap, None, W, H, notes)
check("MOSS without vae: noted, not used", any("needs 'vae'" in x for x in notes))
notes = []
ctl.apply(cfg("color"), "MOSS Image", "M", cond(), cond(), VAE(), None, None, cmap, None, W, H, notes)
check("MOSS without the LoRA in Settings: noted", any("no MOSS Image color / depth LoRA" in x for x in notes))

# ---------------------------------------------------------------- ControlNet files (SDXL / SD1.5 / Flux.1)
fake = FakeCN()
ctl._load_controlnet = lambda name: fake
notes = []
_, p, n, prev = ctl.apply(cfg("canny", {"SDXL.canny": "cn-canny-sdxl.safetensors"}, strength=0.8, start=0, end=0.5), "SDXL", "M",
                          cond(), cond(), None, photo, None, cmap, None, W, H, notes)
check("SDXL canny: ComfyUI's Canny made the map from 'image'", prev is not None and prev.shape == (1, H, W, 3) and prev.max() > 0.5 and prev[0, 32, 32].max() == 0)
check("SDXL canny: ControlNetApplyAdvanced set the hint, strength and steps", fake.hint is not None and fake.args == (0.8, (0.0, 0.5))
      and ce(p).get("control") is fake and ce(n).get("control") is fake)
check("SDXL canny: noted with the file", any("cn-canny-sdxl" in x for x in notes))
fake.hint = None
ci = torch.full((1, 32, 32, 3), 0.9)                                  # a control_image at another size
_, p, _, prev = ctl.apply(cfg("other", {"SD15.other": "pose.pth"}), "SD1.5", "M", cond(), cond(), None, photo, ci, cmap, half, W, H, [])
check("SD1.5 your control_image: used as it is, at the output size", prev.shape == (1, H, W, 3) and abs(float(prev[0, 10, 10, 0]) - 0.9) < 1e-5)
check("per region: the map is black outside the regions still on", float(prev[0, 10, 40].max()) == 0 and fake.hint is not None)
notes = []
ctl.apply(cfg("depth"), "SDXL", "M", cond(), cond(), None, photo, None, cmap, None, W, H, notes)
check("depth without control_image or Depth Anything 3: noted", any("Depth Anything 3" in x for x in notes))
notes = []
ctl.apply(cfg("canny"), "SDXL", "M", cond(), cond(), None, photo, None, cmap, None, W, H, notes)
check("no ControlNet set for the model and kind: noted", any("no SDXL ControlNet for canny" in x for x in notes))
notes = []
ctl.apply(cfg("other", {"SDXL.other": "x"}), "SDXL", "M", cond(), cond(), None, photo, None, cmap, None, W, H, notes)
check("'your control_image' without the input: noted", any("needs the 'control_image' input" in x for x in notes))

# ---------------------------------------------------------------- Flux.1: depth / canny LoRA, else a ControlNet
notes = []
_, p, _, _ = ctl.apply(cfg("depth", {"Flux1Depth": "flux1-depth-dev-lora.safetensors"}, start=0, end=0.9), "Flux.1", "M",
                       cond(), cond(), VAE(), None, dmap, cmap, None, W, H, notes)
check("Flux.1 depth LoRA: the map's latent as concat_latent_image", torch.allclose(ce(p).get("concat_latent_image"), VAE().encode(dmap))
      and abs(ce(p).get("end_percent", 0) - 0.9) < 2e-5)
fake.hint = None
_, p, _, _ = ctl.apply(cfg("depth", {"Flux1.depth": "flux-depth-cn.safetensors"}), "Flux.1", "M", cond(), cond(), VAE(), None, dmap, cmap, None, W, H, [])
check("Flux.1 depth without the LoRA: the ControlNet file", ce(p).get("control") is fake and fake.hint is not None)

# ---------------------------------------------------------------- Anima: LLLite patch with the region mask
seen = {}
from comfy_extras.nodes_model_patch import AnimaLLLiteApply  # noqa: E402
AnimaLLLiteApply.apply_patch = lambda self, model, patch, image, s, a, b, mask=None: (seen.update(model=model, patch=patch, image=image, s=s, a=a, b=b, mask=mask) or ("PATCHED",))
ctl._load_patch = lambda name: "PATCH:" + name
notes = []
m, p, _, _ = ctl.apply(cfg("canny", {"Anima.canny": "anima_canny.safetensors"}, strength=0.6), "Anima", "M", cond(), cond(), None, photo, None, cmap, half, W, H, notes)
check("Anima: LLLite patch on the model, with the strength", m == "PATCHED" and seen["patch"] == "PATCH:anima_canny.safetensors" and seen["s"] == 0.6)
check("Anima: the region mask goes to the patch", seen["mask"] is not None and float(seen["mask"][0, 0, 0]) == 1 and float(seen["mask"][0, 0, 40]) == 0)

# ---------------------------------------------------------------- models without ControlNet in ComfyUI, missing inputs
for arch in ("Krea 2", "Flux.2", "Flux 3", "Ideogram 4"):
    notes = []
    m, p, n, prev = ctl.apply(cfg("depth"), arch, "M", cond(), cond(), VAE(), photo, dmap, cmap, None, W, H, notes)
    check(f"{arch}: not supported yet, noted, nothing changed", m == "M" and not ce(p) and prev is None
          and any("no ControlNet support for " + arch in x for x in notes))
notes = []
ctl.apply(cfg("depth"), None, None, cond(), cond(), None, photo, dmap, cmap, None, W, H, notes)
check("no model connected: noted", any("no model is connected" in x for x in notes))
notes = []
ctl.apply(cfg("depth"), "SDXL", "M", None, None, None, photo, dmap, cmap, None, W, H, notes)
check("no clip (no conditioning): noted", any("needs 'clip'" in x for x in notes))
notes = []
ctl.apply(cfg("color"), "SDXL", "M", cond(), cond(), None, photo, dmap, cmap, None, W, H, notes)
check("color map with another model: noted", any("color map is for MOSS" in x for x in notes))

print("\n" + (f"{len(fails)} failed" if fails else "all passed"))
sys.exit(1 if fails else 0)
