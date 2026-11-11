"""Select object (click-to-select) for the Region Genie editor, using ComfyUI's native SAM 3 / SAM 3.1 support.

POST /region_genie/sam_select   points / box / text on the image under the canvas -> mask(s) as runs
POST /region_genie/sam_release  the selection ended (accepted or cancelled): unload the model if Settings say so
GET  /region_genie/sam_models   checkpoints that look like SAM 3 models (for Settings and error messages)

The model is loaded with ComfyUI's own checkpoint loader and moved to the GPU with model_management, so it is one
of ComfyUI's tracked models: when a workflow needs the VRAM, ComfyUI moves it to system RAM like any other idle
model, and the next click brings it back. The expensive part of SAM (the image backbone, "trunk") is computed once
per image and kept on the CPU, so every further click only runs the small prompt / mask decoder.
"""
import asyncio
import gc
import logging
import os
import re
import threading
import time

import numpy as np

log = logging.getLogger("RegionGenie")

DEFAULT_MODEL = "sam3.1_multiplex_fp16.safetensors"
MODEL_URL = "https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors"
SAM_SIZE = 1008                     # SAM 3's input size
MAX_OBJECTS = 64                    # "select all": most objects per phrase
REFINE_MAX = 16                     # "select all": the best this many get SAM's sharper edge pass (each is a full
                                    # image pass); the rest keep the detector's own mask
IDLE_UNLOAD_S = 180                 # unload-after-each-selection: also unload after this long without a request

_lock = threading.Lock()
_state = {"name": None, "model": None, "clip": None}
_trunk = {"key": None, "frame": None, "trunk": None}
_idle_timer = None


class SelectError(Exception):
    def __init__(self, msg, code="error", status=400):
        super().__init__(msg)
        self.code, self.status = code, status


# ---------------------------------------------------------------- helpers (no torch needed)
def encode_runs(mask):
    """Flat 0/1 mask -> run lengths, starting with a run of zeros (the editor's bitmap format)."""
    flat = np.asarray(mask, dtype=np.uint8).ravel()
    if flat.size == 0:
        return []
    change = np.flatnonzero(np.diff(flat)) + 1
    bounds = np.concatenate([[0], change, [flat.size]])
    runs = np.diff(bounds).tolist()
    if flat[0]:
        runs = [0] + runs
    return [int(r) for r in runs]


def select_all_text(text, cap=MAX_OBJECTS):
    """Comma-separated phrases; each gets ':cap' (find every instance) unless it already says ':N'.
    SAM 3's text encoder otherwise returns only the best match per phrase."""
    parts = [p.strip() for p in str(text or "").replace("(", "").replace(")", "").split(",") if p.strip()]
    out = []
    for p in parts:
        out.append(p if re.search(r":\s*[\d.]+\s*$", p) else f"{p}:{cap}")
    return ", ".join(out)


def resolve_image(ref):
    """{filename, subfolder, type} as used by /view -> a path inside ComfyUI's input / output / temp folder."""
    import folder_paths
    if not isinstance(ref, dict) or not ref.get("filename"):
        raise SelectError("Select object needs an image under the canvas: connect a Load Image node to 'image' "
                          "(or run once)", "no_image")
    kind = ref.get("type") or "input"
    if kind not in ("input", "output", "temp"):
        raise SelectError(f"unknown image folder: {kind}", "no_image")
    base = folder_paths.get_directory_by_type(kind)
    if not base:
        raise SelectError(f"no {kind} folder", "no_image")
    base = os.path.abspath(base)
    path = os.path.abspath(os.path.join(base, os.path.normpath(ref.get("subfolder") or ""), ref["filename"]))
    if os.path.commonpath([base, path]) != base:
        raise SelectError("image path outside ComfyUI's folders", "no_image")
    if not os.path.isfile(path):
        raise SelectError(f"image not found: {ref['filename']}", "no_image")
    return path


def model_names():
    import folder_paths
    try:
        names = folder_paths.get_filename_list("checkpoints")
    except Exception:
        names = []
    return [n for n in names if "sam3" in os.path.basename(n).lower()]


def resolve_model(name):
    import folder_paths
    name = (name or "").strip() or DEFAULT_MODEL
    path = folder_paths.get_full_path("checkpoints", name)
    if path:
        return name, path
    found = model_names()
    if found:                                   # the Setting names a file that isn't there: use the SAM 3 file we have
        pick = sorted(found, key=lambda n: ("sam3.1" not in n.lower(), n))[0]
        return pick, folder_paths.get_full_path("checkpoints", pick)
    raise SelectError(f"Select object needs the SAM 3.1 model: put {DEFAULT_MODEL} in ComfyUI/models/checkpoints "
                      f"({MODEL_URL}), then try again", "no_model", 404)


def queue_busy():
    """True while ComfyUI is running a workflow (the model would compete with it for VRAM)."""
    try:
        from server import PromptServer
        q = PromptServer.instance.prompt_queue
        running, _ = q.get_current_queue_volatile() if hasattr(q, "get_current_queue_volatile") else q.get_current_queue()
        return len(running) > 0
    except Exception:
        return False


# ---------------------------------------------------------------- model
def _load(name, path):
    if _state["model"] is not None and _state["name"] == name:
        return _state["model"], _state["clip"]
    _unload()
    import comfy.sd
    import folder_paths
    t0 = time.time()
    out = comfy.sd.load_checkpoint_guess_config(path, output_vae=False, output_clip=True,
                                                embedding_directory=folder_paths.get_folder_paths("embeddings"))
    model, clip = out[0], out[1]
    inner = getattr(getattr(model, "model", None), "diffusion_model", None)
    if inner is None or not hasattr(inner, "forward_segment"):
        raise SelectError(f"{name} isn't a SAM 3 model (pick the SAM 3.1 checkpoint in Settings > Region Genie > "
                          "Select object)", "bad_model")
    _state.update(name=name, model=model, clip=clip)
    log.info(f"[Region Genie] Select object: loaded {name} ({time.time() - t0:.1f}s)")
    return model, clip


def _unload():
    had = _state["model"] is not None
    _state.update(name=None, model=None, clip=None)
    _trunk.update(key=None, frame=None, trunk=None)
    if had:
        gc.collect()
        try:
            import comfy.model_management as mm
            mm.cleanup_models()
            mm.soft_empty_cache()
        except Exception:
            pass
        log.info("[Region Genie] Select object: model unloaded")


def _schedule_idle_unload(keep_loaded):
    global _idle_timer
    if _idle_timer is not None:
        _idle_timer.cancel()
        _idle_timer = None
    if keep_loaded:
        return

    def fire():
        with _lock:
            _unload()
    _idle_timer = threading.Timer(IDLE_UNLOAD_S, fire)
    _idle_timer.daemon = True
    _idle_timer.start()


class _CachedTrunk:
    """Temporarily stands in for the vision backbone's trunk, returning the trunk output computed earlier."""

    def __init__(self, bb, out):
        self.bb, self.out, self.orig = bb, out, None

    def __enter__(self):
        import torch.nn as nn
        out = self.out

        class _T(nn.Module):
            def forward(self, x):
                return out
        self.orig = self.bb.trunk
        self.bb.trunk = _T()
        return self

    def __exit__(self, *a):
        self.bb.trunk = self.orig
        return False


def _image_frame(path):
    import torch
    from PIL import Image, ImageOps
    import comfy.utils
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")       # as the browser shows it
        arr = np.asarray(im, dtype=np.float32) / 255.0
    img = torch.from_numpy(arr)[None]                          # [1, H, W, 3]
    frame = comfy.utils.common_upscale(img.movedim(-1, 1), SAM_SIZE, SAM_SIZE, "bilinear", crop="disabled")
    return img, frame


def _backbone(sam, bb, path, name, device, dtype):
    """The image's trunk output (cached on the CPU per image and model) and the 1008 px frame on the device."""
    st = os.stat(path)
    key = (name, path, st.st_mtime_ns, st.st_size)
    if _trunk["key"] != key:
        img, frame = _image_frame(path)
        import torch
        with torch.inference_mode():
            out = bb.trunk(frame.to(device=device, dtype=dtype))
        _trunk.update(key=key, img=img, frame=frame, trunk=out.detach().to("cpu"))
        cached = False
    else:
        cached = True
    return (_trunk["img"], _trunk["frame"].to(device=device, dtype=dtype),
            _trunk["trunk"].to(device=device, dtype=dtype), cached)


def _to_out(mask_hw, w, h):
    """Mask logits / probabilities [H, W] (any size) -> 0/1 numpy at w x h."""
    import torch.nn.functional as F
    m = F.interpolate(mask_hw[None, None].float(), size=(h, w), mode="bilinear", align_corners=False)[0, 0]
    return (m > 0).cpu().numpy().astype(np.uint8)


def run_select(body):
    """The selection itself (runs in a worker thread, one at a time)."""
    import torch
    import torch.nn.functional as F
    import comfy.model_management as mm

    path = resolve_image(body.get("image"))
    name, mpath = resolve_model(body.get("model"))
    w, h = (int(v) for v in (body.get("size") or [512, 512])[:2])
    w, h = max(1, min(4096, w)), max(1, min(4096, h))
    text = str(body.get("text") or "").strip()
    pts = [p for p in (body.get("points") or []) if isinstance(p, (list, tuple)) and len(p) >= 3][:64]
    box = body.get("box")
    threshold = float(body.get("threshold", 0.5))
    if not text and not pts and not box:
        raise SelectError("nothing to select: click the object, drag a box, or type what to find")

    t0 = time.time()
    model, clip = _load(name, mpath)
    mm.load_model_gpu(model)
    device = mm.get_torch_device()
    dtype = model.model.get_dtype()
    sam = model.model.diffusion_model
    bb = sam.detector.backbone["vision_backbone"]
    with torch.inference_mode():
        img, frame, trunk, cached = _backbone(sam, bb, path, name, device, dtype)
        H, W = img.shape[1], img.shape[2]
        masks = []
        if text:
            phrase = select_all_text(text)
            cond = clip.encode_from_tokens_scheduled(clip.tokenize(phrase))
            mm.load_model_gpu(model)                       # the text encoder may have pushed it out
            try:
                from comfy_extras.nodes_sam3 import _extract_text_prompts, _refine_mask
            except Exception:
                _extract_text_prompts = _refine_mask = None
            prompts = _extract_text_prompts(cond, device, dtype) if _extract_text_prompts else \
                [(cond[0][0].to(device=device, dtype=dtype), None, MAX_OBJECTS)]
            boxes = None
            if box:
                x0, y0, x1, y1 = (float(v) for v in box)
                boxes = torch.tensor([[[(x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0), abs(y1 - y0)]]], device=device, dtype=dtype)
            labels = [re.sub(r"\s*:\s*[\d.]+\s*$", "", p).strip() for p in phrase.split(",")]
            if len(labels) != len(prompts):
                labels = [text] * len(prompts)
            found = []
            for (emb, tmask, max_det), label in zip(prompts, labels):
                if tmask is None:
                    tmask = torch.ones(emb.shape[0], emb.shape[1], dtype=torch.int64, device=device)
                with _CachedTrunk(bb, trunk):
                    res = sam(frame, text_embeddings=emb, text_mask=tmask, boxes=boxes, threshold=threshold, orig_size=(H, W))
                probs = res["scores"][0].sigmoid()
                keep = probs > threshold
                kb, ks, km = res["boxes"][0][keep], probs[keep], res["masks"][0][keep]
                order = ks.argsort(descending=True)[:max_det]
                for i in order.tolist():
                    found.append((float(ks[i]), kb[i], km[i], label))
            found.sort(key=lambda t: -t[0])
            for n, (score, b, m, label) in enumerate(found[:MAX_OBJECTS]):
                if _refine_mask is not None and n < REFINE_MAX:
                    full = _refine_mask(sam, img[0].to(device), m, b.float().cpu(), H, W, device, dtype, 2)[0]
                else:
                    full = m
                bx = b.float().cpu().tolist()
                masks.append({"mask": _to_out(full, w, h), "score": round(score, 4), "label": label,
                              "box": [bx[0] / W, bx[1] / H, bx[2] / W, bx[3] / H]})
        else:
            point_inputs = box_inputs = None
            if pts:
                point_inputs = {
                    "point_coords": torch.tensor([[[float(p[0]) * SAM_SIZE, float(p[1]) * SAM_SIZE] for p in pts]], dtype=dtype, device=device),
                    "point_labels": torch.tensor([[1 if p[2] else 0 for p in pts]], dtype=torch.int32, device=device),
                }
            if box:
                x0, y0, x1, y1 = (float(v) for v in box)
                box_inputs = torch.tensor([[[min(x0, x1) * SAM_SIZE, min(y0, y1) * SAM_SIZE],
                                            [max(x0, x1) * SAM_SIZE, max(y0, y1) * SAM_SIZE]]], device=device, dtype=dtype)
            with _CachedTrunk(bb, trunk):
                logit = sam.forward_segment(frame, point_inputs=point_inputs, box_inputs=box_inputs)
                logit = sam.forward_segment(frame, mask_inputs=logit)      # one refinement pass, as SAM3 Detect does
            m = _to_out(logit[0, 0], w, h)
            ys, xs = np.nonzero(m)
            bx = [float(xs.min()) / w, float(ys.min()) / h, float(xs.max() + 1) / w, float(ys.max() + 1) / h] if len(xs) else None
            masks.append({"mask": m, "score": None, "box": bx, "label": ""})
    out = [{"runs": encode_runs(x["mask"]), "score": x["score"], "box": x["box"], "label": x["label"], "area": int(x["mask"].sum())}
           for x in masks if x["mask"].any()]
    return {"ok": True, "w": w, "h": h, "masks": out, "model": name, "cached": cached,
            "ms": int((time.time() - t0) * 1000)}


def handle_select(body):
    if queue_busy():
        raise SelectError("Select object waits while a workflow is running", "busy", 409)
    with _lock:
        try:
            return run_select(body)
        finally:
            _schedule_idle_unload(bool(body.get("keep_loaded", True)))


def handle_release(body):
    keep = bool((body or {}).get("keep_loaded", True))
    with _lock:
        if not keep:
            _unload()
        _schedule_idle_unload(True)
    return {"ok": True, "loaded": _state["model"] is not None}


# ---------------------------------------------------------------- routes
def register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return
    if getattr(PromptServer, "instance", None) is None:      # imported outside a running ComfyUI (tests, scripts)
        return

    async def _run(fn, body):
        loop = asyncio.get_running_loop()
        try:
            return web.json_response(await loop.run_in_executor(None, fn, body))
        except SelectError as e:
            return web.json_response({"error": str(e), "code": e.code}, status=e.status)
        except Exception as e:
            log.exception("[Region Genie] Select object failed")
            return web.json_response({"error": f"Select object failed: {e}", "code": "error"}, status=500)

    @PromptServer.instance.routes.post("/region_genie/sam_select")
    async def _sam_select(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "bad request", "code": "error"}, status=400)
        return await _run(handle_select, body if isinstance(body, dict) else {})

    @PromptServer.instance.routes.post("/region_genie/sam_release")
    async def _sam_release(request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        return await _run(handle_release, body if isinstance(body, dict) else {})

    @PromptServer.instance.routes.get("/region_genie/sam_models")
    async def _sam_models(request):
        return web.json_response({"models": model_names(), "default": DEFAULT_MODEL, "url": MODEL_URL})


register_routes()
