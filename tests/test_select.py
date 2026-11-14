"""Select object route, run against ComfyUI 0.45's real SAM 3.1 code (CPU; random-weight fixture checkpoint)."""
import json
import os
import sys
import time

COMFY = os.environ.get("COMFY_DIR", "/tmp/comfy_src")          # a ComfyUI checkout (see tests/README.md)
MODELS = os.environ.get("RG_MODELS", "/tmp/comfy_models")
sys.path.insert(0, COMFY)
import comfy.cli_args
comfy.cli_args.args.cpu = True
import folder_paths
folder_paths.add_model_folder_path("checkpoints", os.path.join(MODELS, "checkpoints"))
import numpy as np
import torch
import comfy.model_management as mm

import importlib.util
sys.path.insert(1, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # region_select imports model_paths next to it
_spec = importlib.util.spec_from_file_location("region_select", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "region_select.py"))
rs = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(rs)    # no server here: routes are skipped

fails = []
def check(name, ok):
    print(("PASS " if ok else "FAIL ") + name, flush=True)
    if not ok:
        fails.append(name)

# ---- helpers without the model
m = np.zeros((3, 4), np.uint8); m[1, 1:3] = 1; m[2, 3] = 1
r = rs.encode_runs(m)
check("encode_runs: zeros first", r == [5, 2, 4, 1] and sum(r) == 12)
check("encode_runs: starts with ones", rs.encode_runs(np.ones(3, np.uint8)) == [0, 3])
check("select_all_text adds :64, keeps :N", rs.select_all_text("person, red car:3, (dog)") == "person:64, red car:3, dog:64")
img = {"filename": "rg_test.png", "subfolder": "", "type": "input"}
folder_paths.set_input_directory(os.path.join(COMFY, "input"))
check("image path resolves", rs.resolve_image(img).endswith("input/rg_test.png"))
for bad in ({"filename": "../../etc/passwd", "type": "input"}, {"filename": "rg_test.png", "subfolder": "../..", "type": "input"},
            {"filename": "x.png", "type": "models"}, {}):
    try:
        rs.resolve_image(bad); check(f"rejects {bad}", False)
    except rs.SelectError as e:
        check(f"rejects {bad}: {e.code}", e.code == "no_image")
check("model: named file", rs.resolve_model("")[0] == rs.DEFAULT_MODEL)
check("model: missing name falls back to the SAM 3 file there", rs.resolve_model("nope.safetensors")[0] == rs.DEFAULT_MODEL)
_full = os.path.join(MODELS, "checkpoints", rs.DEFAULT_MODEL)          # round 18: a full path (Settings' Browse…)
check("model: a full path anywhere is used as it is", rs.resolve_model(_full)[1] == _full)

# ---- busy: refuses while a workflow runs
orig_busy = rs.queue_busy
rs.queue_busy = lambda: True
try:
    rs.handle_select({"image": img, "points": [[.2, .2, 1]]}); check("busy refused", False)
except rs.SelectError as e:
    check("busy -> 409 'busy'", e.code == "busy" and e.status == 409)
rs.queue_busy = orig_busy

# ---- the real model: cached trunk gives the same answer as ComfyUI's own uncached path
t0 = time.time()
model, clip = rs._load(*rs.resolve_model(""))
check("loaded through ComfyUI's checkpoint loader", model is not None and clip is not None and hasattr(model.model.diffusion_model, "forward_segment"))
mm.load_model_gpu(model)
dev, dt = mm.get_torch_device(), model.model.get_dtype()
sam = model.model.diffusion_model
bb = sam.detector.backbone["vision_backbone"]
check("ComfyUI tracks it as a loaded model", any(lm.model is model for lm in mm.current_loaded_models))
path = rs.resolve_image(img)
with torch.inference_mode():
    im, frame, trunk, cached = rs._backbone(sam, bb, path, "x", dev, dt)
    check("first call computes the trunk", cached is False and trunk.device.type == "cpu" or dev.type == "cpu")
    check("trunk cache kept on the CPU", rs._trunk["trunk"].device.type == "cpu")
    pi = {"point_coords": torch.tensor([[[252.0, 504.0]]], dtype=dt), "point_labels": torch.tensor([[1]], dtype=torch.int32)}
    bx = torch.tensor([[[600.0, 200.0], [900.0, 700.0]]], dtype=dt)
    ref = sam.forward_segment(frame, point_inputs=pi, box_inputs=bx)                 # ComfyUI, no cache
    with rs._CachedTrunk(bb, trunk):
        got = sam.forward_segment(frame, point_inputs=pi, box_inputs=bx)
    check("points+box: cached trunk == uncached (max diff %.2e)" % (got - ref).abs().max().item(), torch.equal(got, ref))
    check("trunk restored after the swap", type(bb.trunk).__name__ == "ViTDet")
    _, _, _, cached2 = rs._backbone(sam, bb, path, "x", dev, dt)
    check("second call uses the cache", cached2 is True)
    cond = clip.encode_from_tokens_scheduled(clip.tokenize(rs.select_all_text("yellow circle, red area")))
    from comfy_extras.nodes_sam3 import _extract_text_prompts
    prompts = _extract_text_prompts(cond, dev, dt)
    check("two phrases -> two text prompts, 64 each", len(prompts) == 2 and all(p[2] == 64 for p in prompts))
    emb, tm, _ = prompts[0]
    ref = sam(frame, text_embeddings=emb, text_mask=tm, threshold=0.5, orig_size=(480, 640))
    with rs._CachedTrunk(bb, trunk):
        got = sam(frame, text_embeddings=emb, text_mask=tm, threshold=0.5, orig_size=(480, 640))
    check("text: cached trunk == uncached", all(torch.equal(got[k], ref[k]) for k in ("boxes", "scores", "masks")))
    # the output mask path with a known mask
    lg = torch.full((1008, 1008), -5.0); lg[200:600, 100:400] = 5
    o = rs._to_out(lg, 160, 120)
    check("logits -> 0/1 mask at the requested size", o.shape == (120, 160) and o[50, 40] == 1 and o[5, 5] == 0)
print(f"model part: {time.time() - t0:.0f}s", flush=True)

# ---- the whole route function (random weights: masks may be empty, the structure is what's checked)
rs.REFINE_MAX = 1
res = rs.handle_select({"image": img, "size": [160, 120], "points": [[.25, .5, 1], [.7, .4, 0]], "keep_loaded": True})
check("route: points answer", res["ok"] and res["w"] == 160 and isinstance(res["masks"], list))
res = rs.handle_select({"image": img, "size": [160, 120], "box": [.6, .2, .9, .7], "keep_loaded": True})
check("route: next click reuses the image (cached)", res["ok"] and res["cached"] is True)
res = rs.handle_select({"image": img, "size": [160, 120], "text": "yellow circle", "threshold": 0.9, "keep_loaded": True})
check("route: text answer", res["ok"] and isinstance(res["masks"], list))
try:
    rs.handle_select({"image": img, "size": [160, 120]}); check("empty request refused", False)
except rs.SelectError:
    check("empty request refused", True)
check("idle timer off while kept loaded", rs._idle_timer is None)
rs.handle_select({"image": img, "size": [160, 120], "points": [[.5, .5, 1]], "keep_loaded": False})
check("unload setting: idle timer armed", rs._idle_timer is not None and rs._idle_timer.is_alive())
del model, clip, sam, bb, trunk, frame, im, ref, got, cond, prompts, emb, tm
rs.handle_release({"keep_loaded": False})
import gc; gc.collect(); mm.cleanup_models()
check("release (unload): model freed", rs._state["model"] is None and rs._trunk["trunk"] is None)
check("release: ComfyUI no longer lists it", not any(type(getattr(lm, "real_model", lambda: None)() or object()).__name__ == "SAM3" and lm.model is not None for lm in mm.current_loaded_models))
check("release: idle timer off", rs._idle_timer is None)

print(f"\n{len(fails)} failed" if fails else "\nall passed")
os._exit(1 if fails else 0)
