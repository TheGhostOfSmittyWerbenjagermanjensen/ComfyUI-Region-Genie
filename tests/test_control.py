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
sys.path.insert(0, PACK)                      # control.py imports model_paths next to it
_spec = importlib.util.spec_from_file_location("rg_control", os.path.join(PACK, "control.py"))
ctl = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(ctl)

# the files "installed" for these checks (ComfyUI looks them up in its model folders)
import folder_paths  # noqa: E402
INSTALLED = {"moss_ctrl.safetensors", "x", "cn-canny-sdxl.safetensors", "pose.pth", "flux1-depth-dev-lora.safetensors",
             "flux-depth-cn.safetensors", "anima_canny.safetensors"}
folder_paths.get_full_path = lambda folder, name: f"/models/{folder}/{name}" if name in INSTALLED else None

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
    def set_extra_arg(self, k, v=None):
        self.extra = {**getattr(self, "extra", {}), k: v}
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
# round 23: several Control rows ('controls' + 'controlFiles'); an old workflow's single 'control' still reads
cs = ctl.configs({"controls": [{"kind": "depth", "strength": 0.6}, {"kind": "canny"}], "controlFiles": {"SDXL.depth": "d", "SDXL.canny": "c"}})
check("configs: several rows, the files shared", [c["kind"] for c in cs] == ["depth", "canny"] and cs[0]["files"]["SDXL.canny"] == "c" and cs[0]["strength"] == 0.6)
check("configs: an old single control", [c["kind"] for c in ctl.configs({"control": {"on": True, "kind": "color"}})] == ["color"]
      and ctl.configs({"control": {"on": False}}) == [] and ctl.configs({"controls": []}) == [])
check("uses_concat: MOSS rows and a Flux.1 LoRA row share the one extra input; ControlNets don't",
      ctl.uses_concat(cs[0], "MOSS-Image") and not ctl.uses_concat(cs[0], "SDXL")
      and ctl.uses_concat({"kind": "depth", "files": {"Flux1Depth": "l"}}, "Flux.1") and not ctl.uses_concat({"kind": "depth", "files": {}}, "Flux.1"))
row = {"control": "Flux.1", "ckind": "canny", "lora": "x"}
check("lora_row_cfg: a control LoRA belongs to the row of its kind", ctl.lora_row_cfg(row, cs, "Flux.1") is cs[1]
      and ctl.lora_row_cfg(row, cs, "SDXL") is None and ctl.lora_tag_ok(row, cs, "Flux.1"))
c = cfg("depth", strength=2.5, start=0.2, end=0.7)
check("config: kind, strength, start, end", c["kind"] == "depth" and c["strength"] == 2.5 and c["start"] == 0.2 and c["end"] == 0.7)
check("config: bad kind -> depth, numbers clamped", cfg("x", strength=99)["kind"] == "depth" and cfg("x", strength=99)["strength"] == 10)
check("LoRA tag: MOSS row used for color / depth with MOSS", ctl.lora_tag_ok({"control": "MOSS-Image", "ckind": "moss"}, cfg("color"), "MOSS-Image"))
check("LoRA tag: not with another model", not ctl.lora_tag_ok({"control": "MOSS-Image", "ckind": "moss"}, cfg("color"), "Flux.1"))
check("LoRA tag: Flux depth LoRA not for canny", not ctl.lora_tag_ok({"control": "Flux.1", "ckind": "depth"}, cfg("canny"), "Flux.1"))
check("LoRA tag: nothing while control is off", not ctl.lora_tag_ok({"control": "MOSS-Image", "ckind": "moss"}, None, "MOSS-Image"))
regions = [{"id": 1}, {"id": 2, "noControl": True}]
idx = np.zeros((H, W), np.uint8); idx[:, :32] = 1; idx[:, 32:] = 2
check("region mask: everywhere while all regions are on", ctl.region_mask([{"id": 1}, {"id": 2}], {1: 1, 2: 2}, idx) is None)
rm = ctl.region_mask(regions, {1: 1, 2: 2}, idx)
check("region mask: only the regions still on", rm[:, :32].all() and not rm[:, 32:].any())

# ---------------------------------------------------------------- MOSS-Image: color / depth control LoRA
notes = []
m, p, n, prev = ctl.apply(cfg("color", {"MOSS": "moss_ctrl.safetensors"}, strength=2, start=0.1, end=0.6), "MOSS-Image", "M",
                          cond(), cond(), VAE(), None, None, cmap, None, W, H, notes)
d = ce(p)
lat = d.get("concat_latent_image")
check("MOSS color: [color | depth] latents as concat_latent_image", lat is not None and tuple(lat.shape) == (1, 6, 8, 8))
check("MOSS color: color latent x strength, depth zeros", torch.allclose(lat[:, :3], 2 * VAE().encode(cmap)) and lat[:, 3:].abs().sum() == 0)
check("MOSS color: start / end on the conditioning", abs(d.get("start_percent", -1) - 0.1) < 2e-5 and abs(d.get("end_percent", -1) - 0.6) < 2e-5)
check("MOSS color: negative too, the color map as preview", "concat_latent_image" in ce(n) and prev is not None)
notes = []
_, p, _, _ = ctl.apply(cfg("color", {"MOSS": "x"}), "MOSS-Image", "M", cond(), cond(), VAE(), None, None, cmap, half, W, H, notes)
lat = ce(p)["concat_latent_image"]
check("MOSS per region: zero latent (no control) outside the regions still on", lat[..., 4:].abs().sum() == 0 and lat[..., :4].abs().sum() > 0)
dmap = torch.full((1, H, W, 3), 0.5)
_, p, _, prev = ctl.apply(cfg("color+depth", {"MOSS": "x"}), "MOSS-Image", "M", cond(), cond(), VAE(), None, dmap, cmap, None, W, H, [])
lat = ce(p)["concat_latent_image"]
check("MOSS color + depth: depth from control_image in the second half", torch.allclose(lat[:, 3:], VAE().encode(dmap)) and lat[:, :3].abs().sum() > 0)
notes = []
ctl.apply(cfg("canny", {"MOSS": "x"}), "MOSS-Image", "M", cond(), cond(), VAE(), photo, None, cmap, None, W, H, notes)
check("MOSS canny: not supported, noted", any("not canny" in x or "canny" in x for x in notes))
notes = []
ctl.apply(cfg("color"), "MOSS-Image", "M", cond(), cond(), None, None, None, cmap, None, W, H, notes)
check("MOSS without vae: noted, not used", any("needs 'vae'" in x for x in notes))
notes = []
ctl.apply(cfg("color"), "MOSS-Image", "M", cond(), cond(), VAE(), None, None, cmap, None, W, H, notes)
check("MOSS without the LoRA in Settings: noted", any("no MOSS-Image color / depth control LoRA is set" in x for x in notes))

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
LOAD_PATCH = ctl._load_patch
ctl._load_patch = lambda name: "PATCH:" + name
notes = []
m, p, _, _ = ctl.apply(cfg("canny", {"Anima.canny": "anima_canny.safetensors"}, strength=0.6), "Anima", "M", cond(), cond(), None, photo, None, cmap, half, W, H, notes)
check("Anima: LLLite patch on the model, with the strength", m == "PATCHED" and seen["patch"] == "PATCH:anima_canny.safetensors" and seen["s"] == 0.6)
check("Anima: the region mask goes to the patch", seen["mask"] is not None and float(seen["mask"][0, 0, 0]) == 1 and float(seen["mask"][0, 0, 40]) == 0)
# round 18: an LLLite patch kept in models/controlnet (where the owner keeps them), and one anywhere (a full path)
import tempfile  # noqa: E402
_base = folder_paths.get_full_path
folder_paths.get_full_path = lambda folder, name: (f"/models/controlnet/{name}" if folder == "controlnet" and name == "anima_in_cn.safetensors"
                                                   else None if name == "anima_in_cn.safetensors" else _base(folder, name))
notes = []
ctl.apply(cfg("canny", {"Anima.canny": "anima_in_cn.safetensors"}), "Anima", "M", cond(), cond(), None, photo, None, cmap, half, W, H, notes)
check("Anima: a patch in models/controlnet is found and used", seen["patch"] == "PATCH:anima_in_cn.safetensors" and not any("isn't found" in x for x in notes))
tmp = tempfile.mkdtemp(prefix="rg_anima_"); full = os.path.join(tmp, "@author", "lllite.safetensors")
os.makedirs(os.path.dirname(full)); open(full, "wb").write(b"x")
from comfy_extras.nodes_model_patch import ModelPatchLoader  # noqa: E402
_mpl = ModelPatchLoader.load_model_patch
ModelPatchLoader.load_model_patch = lambda self, name: (folder_paths.get_full_path_or_raise("model_patches", name),)   # the loader's first step
check("Anima: a full path loads through ComfyUI's patch loader (by its full path)", LOAD_PATCH(full) == full)
ModelPatchLoader.load_model_patch = _mpl
folder_paths.get_full_path = _base

# ---------------------------------------------------------------- files that aren't set or that ComfyUI doesn't find
missing = []
ctl.apply(cfg("canny"), "SDXL", "M", cond(), cond(), None, photo, None, cmap, None, W, H, [], missing)
check("missing: an unset ControlNet is reported by its Settings key", missing == [["SDXL.canny", "unset"]])
missing, notes = [], []
ctl.apply(cfg("canny", {"SDXL.canny": "gone.safetensors"}), "SDXL", "M", cond(), cond(), None, photo, None, cmap, None, W, H, notes, missing)
check("missing: a set file ComfyUI doesn't find is reported, control not used", missing == [["SDXL.canny", "missing", "gone.safetensors"]]
      and any("isn't found (in ComfyUI's controlnet folders" in x for x in notes))
missing = []
ctl.apply(cfg("depth", {"MOSS": "nope.safetensors"}), "MOSS-Image", "M", cond(), cond(), VAE(), photo, None, cmap, None, W, H, [], missing)
check("missing: MOSS LoRA not found and no Depth Anything 3 set", ["MOSS", "missing", "nope.safetensors"] in missing and ["DA3", "unset"] in missing)
missing = []
ctl.apply(cfg("depth", {"Anima.depth": "x"}), "Anima", "M", cond(), cond(), None, None, dmap, cmap, None, W, H, [], missing)
check("missing: nothing when every file is there", missing == [])

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

# ---------------------------------------------------------------- pose (round 61): the canvas's figures as the map
import pose_map as pm  # noqa: E402
STAND = [[0, -.40], [0, -.30], [-.11, -.29], [-.14, -.13], [-.15, .02], [.11, -.29], [.14, -.13], [.15, .02], [-.07, .02], [-.075, .24],
         [-.08, .46], [.07, .02], [.075, .24], [.08, .46], [-.025, -.42], [.025, -.42], [-.055, -.405], [.055, -.405]]
pd = {"poses": [{"id": 1, "region": 1, "pts": STAND}, {"id": 2, "region": 2, "pts": STAND, "visible": False},
                {"id": 3, "region": 9, "pts": STAND}, {"id": 4, "region": 1, "pts": STAND, "off": [0, 14, 15]}]}
figs = pm.figures(pd, {1, 2})
check("pose: hidden figures and figures of regions that aren't output are left out", len(figs) == 2)
check("pose: hidden joints are None", figs[1][0] is None and figs[1][14] is None and figs[1][16] is not None and figs[0][0] is not None)
pmap = pm.render(figs[:1], 256, 256)
neck, nose = pmap[int(128 - .30 * 256), 128], pmap[int(128 - .40 * 256), 128]
check("pose map: black background, the joints in OpenPose's colors (neck orange-red, nose red)",
      pmap.shape == (256, 256, 3) and pmap[5, 5].max() == 0 and neck[0] > .9 and .2 < neck[1] < .5 and neck[2] < .1 and nose[0] > .9 and nose[1] < .1)
bone = pmap[int(128 + .13 * 256), int(128 - .0725 * 256)]                     # the middle of the right thigh: its color at 60 %
check("pose map: bones at 60 % brightness", 0.05 < bone.max() <= 0.61)
nohead = pm.render(figs[1:], 256, 256)
check("pose map: a hidden nose takes its bones along", nohead[int(128 - .35 * 256), 128].max() == 0 and pmap[int(128 - .35 * 256), 128].max() > 0)
wide = pm.render(figs[:1], 512, 256)
check("pose map: on a wide image the figure keeps its shape (units of the shorter side, from the centre)",
      wide.shape == (256, 512, 3) and wide[int(128 - .30 * 256), 256][0] > .9)
fake = FakeCN(); ctl._load_controlnet = lambda name: fake
notes = []
pt = torch.from_numpy(pm.render(figs, W, H))[None]
_, p, _, prev = ctl.apply(cfg("pose", {"SDXL.other": "pose.pth"}), "SDXL", "M", cond(), cond(), None, None, None, cmap, None, W, H, notes, pose_map=pt)
check("pose: the figures' map goes to the ControlNet set for 'your control_image', as the openpose type of a union one",
      fake.hint is not None and prev is not None and torch.equal(prev, pt) and getattr(fake, "extra", {}).get("control_type") == [0]
      and any("pose.pth" in x for x in notes))
notes = []
_, _, _, prev = ctl.apply(cfg("pose", {"SDXL.other": "pose.pth"}), "SDXL", "M", cond(), cond(), None, None, None, cmap, None, W, H, notes)
check("pose without a figure or a control_image: noted, not used", prev is None and any("no pose figure" in x for x in notes))
_, _, _, prev = ctl.apply(cfg("pose", {"SDXL.other": "pose.pth"}), "SDXL", "M", cond(), cond(), None, None, ci, cmap, None, W, H, [])
check("pose without a figure but with a control_image: that image is the map", prev is not None and float(prev.mean()) > 0.8)
notes = []
ctl.apply(cfg("pose", {"MOSS": "x"}), "MOSS-Image", "M", cond(), cond(), VAE(), None, None, cmap, None, W, H, notes, pose_map=pt)
check("pose with MOSS-Image: noted as not read", any("not pose" in x for x in notes))

# keypoints in and out (the pose_keypoint input / output)
kp = pm.to_keypoints(figs, 256, 512)
check("to_keypoints: one OpenPose frame, a person per figure, pixels; a hidden joint has score 0",
      len(kp) == 1 and kp[0]["canvas_width"] == 256 and kp[0]["canvas_height"] == 512 and len(kp[0]["people"]) == 2
      and len(kp[0]["people"][0]["pose_keypoints_2d"]) == 54 and kp[0]["people"][1]["pose_keypoints_2d"][:3] == [0.0, 0.0, 0.0]
      and abs(kp[0]["people"][0]["pose_keypoints_2d"][3] - 128) < 1e-3 and abs(kp[0]["people"][0]["pose_keypoints_2d"][4] - (256 - .30 * 256)) < 1e-3)
back = pm.from_keypoints(kp, 256, 512)
check("from_keypoints reads them back to the same figures", len(back) == 2 and back[1][0] is None
      and all(abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6 for a, b in zip(back[0], figs[0])))
half_size = pm.from_keypoints(kp, 128, 256)
check("keypoints made for another canvas size are scaled to this one", abs(half_size[0][1][0] - figs[0][1][0]) < 1e-6 and abs(half_size[0][1][1] - figs[0][1][1]) < 1e-6)
check("from_keypoints: nothing usable gives no figure", pm.from_keypoints([{"people": [{"pose_keypoints_2d": [0] * 54}]}], 64, 64) == [] and pm.from_keypoints(None, 64, 64) == [])

# pose from the image (pose_detect.py): the box in pixels for ComfyUI's SDPose node, its answer as fractions
import tempfile  # noqa: E402
from PIL import Image  # noqa: E402
import pose_detect as pdet  # noqa: E402
tmp = tempfile.mkdtemp(); Image.new("RGB", (200, 100), (40, 60, 80)).save(os.path.join(tmp, "photo.png"))
folder_paths.get_directory_by_type = lambda kind: tmp
seen = {}
pdet._load = lambda name, path: ("MODEL", "VAE")
def fake_extract(model, vae, image, bbox):
    seen.update(shape=tuple(image.shape), bbox=bbox)
    flat = []
    for k in range(18):
        flat += [bbox["x"] + bbox["width"] / 2, bbox["y"] + k * bbox["height"] / 17, 0.9 if k != 4 else 0.0]
    return [{"canvas_width": 200, "canvas_height": 100, "people": [{"pose_keypoints_2d": flat}]}]
pdet._extract = fake_extract
INSTALLED.add("sdpose_wholebody_fp16.safetensors")
r = pdet.run_detect({"image": {"filename": "photo.png", "type": "input"}, "box": [0.25, 0.1, 0.75, 0.9]})
check("pose_detect: the image is read, the box goes to the detector in pixels",
      seen["shape"] == (1, 100, 200, 3) and seen["bbox"] == {"x": 50.0, "y": 10.0, "width": 100.0, "height": 80.0})
pp = r["people"][0]
check("pose_detect: the joints come back as fractions of the image, with their scores",
      len(r["people"]) == 1 and len(pp["pts"]) == 18 and abs(pp["pts"][0][0] - 0.5) < 1e-6 and abs(pp["pts"][0][1] - 0.1) < 1e-6
      and abs(pp["pts"][17][1] - 0.9) < 1e-6 and pp["scores"][4] == 0.0 and pp["scores"][0] == 0.9)
INSTALLED.discard("sdpose_wholebody_fp16.safetensors"); folder_paths.get_filename_list = lambda folder: []
try:
    pdet.resolve_model(""); check("pose_detect: no model file: said so", False)
except pdet.PoseError as e:
    check("pose_detect: no model file: the message names the file and where it goes", e.code == "no_model" and "sdpose_wholebody_fp16.safetensors" in str(e) and "models/checkpoints" in str(e))
try:
    pdet.run_detect({"image": None}); check("pose_detect: no image: said so", False)
except pdet.PoseError as e:
    check("pose_detect: no image under the canvas: said so", e.code == "no_image" and "Pose from the image" in str(e))

print("\n" + (f"{len(fails)} failed" if fails else "all passed"))
sys.exit(1 if fails else 0)
