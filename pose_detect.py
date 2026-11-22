"""Pose from the image (the Pose tool's "From the image"): ComfyUI's own pose detector, SDPose, finds the body joints
of the person in a box drawn on the image under the canvas.

POST /region_genie/pose_detect   {image: {filename, subfolder, type}, box: [x0, y0, x1, y1] as fractions of the image
                                  (or null: the whole image), model: file name (optional)}
                               -> {people: [{pts: [[x, y] * 18] as fractions of the image, scores: [18]}]}

The model is the SDPose checkpoint (it holds the model and its VAE), loaded with ComfyUI's checkpoint loader and run
through ComfyUI's SDPose Keypoint Extractor node, so the result is what that node gives. It is kept loaded for a few
minutes after the last request, then released.
"""
import asyncio
import gc
import logging
import os
import threading
import time

import numpy as np

log = logging.getLogger("RegionGenie")

DEFAULT_MODEL = "sdpose_wholebody_fp16.safetensors"
MODEL_URL = "https://huggingface.co/Comfy-Org/SDPose/resolve/main/checkpoints/sdpose_wholebody_fp16.safetensors"
IDLE_UNLOAD_S = 180
JOINTS = 18

_state = {"name": None, "model": None, "vae": None}
_lock = threading.Lock()
_idle_timer = None


class PoseError(Exception):
    def __init__(self, msg, code="error", status=400):
        super().__init__(msg)
        self.code, self.status = code, status


def _select():
    try:
        from . import region_select as rs
    except ImportError:                           # loaded on its own (tests)
        import region_select as rs
    return rs


def model_names():
    import folder_paths
    try:
        names = folder_paths.get_filename_list("checkpoints")
    except Exception:
        names = []
    return [n for n in names if "sdpose" in os.path.basename(n).lower()]


def resolve_model(name):
    import folder_paths
    try:
        from .model_paths import full_path
    except ImportError:
        from model_paths import full_path
    name = (name or "").strip() or DEFAULT_MODEL
    path = full_path("checkpoints", name)
    if path:
        return name, path
    found = model_names()
    if found:
        pick = sorted(found)[0]
        return pick, folder_paths.get_full_path("checkpoints", pick)
    raise PoseError(f"Pose from the image needs the SDPose model: put {DEFAULT_MODEL} in ComfyUI/models/checkpoints "
                    f"({MODEL_URL}), press R to refresh, then try again", "no_model", 404)


def _load(name, path):
    if _state["model"] is not None and _state["name"] == name:
        return _state["model"], _state["vae"]
    _unload()
    import comfy.sd
    import folder_paths
    t0 = time.time()
    out = comfy.sd.load_checkpoint_guess_config(path, output_vae=True, output_clip=False,
                                                embedding_directory=folder_paths.get_folder_paths("embeddings"))
    model, vae = out[0], out[2]
    inner = getattr(getattr(model, "model", None), "diffusion_model", None)
    if inner is None or not hasattr(inner, "heatmap_head"):
        raise PoseError(f"{name} isn't an SDPose model (get {DEFAULT_MODEL}: {MODEL_URL})", "bad_model")
    if vae is None:
        raise PoseError(f"{name} has no VAE inside; use {DEFAULT_MODEL} ({MODEL_URL})", "bad_model")
    _state.update(name=name, model=model, vae=vae)
    log.info(f"[Region Genie] Pose from the image: loaded {name} ({time.time() - t0:.1f}s)")
    return model, vae


def _unload():
    had = _state["model"] is not None
    _state.update(name=None, model=None, vae=None)
    if had:
        gc.collect()
        try:
            import comfy.model_management as mm
            mm.cleanup_models()
            mm.soft_empty_cache()
        except Exception:
            pass
        log.info("[Region Genie] Pose from the image: model unloaded")


def _schedule_unload():
    global _idle_timer
    if _idle_timer is not None:
        _idle_timer.cancel()

    def fire():
        with _lock:
            _unload()
    _idle_timer = threading.Timer(IDLE_UNLOAD_S, fire)
    _idle_timer.daemon = True
    _idle_timer.start()


def _image(path):
    import torch
    from PIL import Image, ImageOps
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0)[None]


def _extract(model, vae, image, bbox):
    """ComfyUI's SDPose Keypoint Extractor on one image (and one box) -> its OpenPose frames."""
    from comfy_extras.nodes_sdpose import SDPoseKeypointExtractor
    out = SDPoseKeypointExtractor.execute(model, vae, image, 1, bboxes=[[bbox]] if bbox else None)
    return out.result[0] if hasattr(out, "result") else out[0]


def people_of(frames, width, height):
    """The frames' people as [{pts: 18 x [x, y] fractions of the image, scores: [18]}] (body joints only)."""
    frame = frames[0] if isinstance(frames, (list, tuple)) and frames else frames
    out = []
    for person in (frame or {}).get("people") or []:
        kp = person.get("pose_keypoints_2d") or []
        if len(kp) < JOINTS * 3:
            continue
        pts, scores = [], []
        for k in range(JOINTS):
            x, y, sc = float(kp[3 * k]), float(kp[3 * k + 1]), float(kp[3 * k + 2])
            ok = sc > 0 and x >= 0 and y >= 0 and np.isfinite(x) and np.isfinite(y)
            pts.append([x / width, y / height] if ok else [0.0, 0.0])
            scores.append(round(max(0.0, min(1.0, sc)), 3) if ok else 0.0)
        out.append({"pts": pts, "scores": scores})
    return out


class PoseFetch:
    """Internal (not in the node menu): the node the Pose tool's "take the input's figures" button adds to a small
    prompt of its own, after the nodes that make the keypoints. It hands the people in the keypoints back to the
    editor (as the run's UI message), which places them on the canvas. Nothing is saved, nothing goes on."""
    DEV_ONLY = True                    # hidden from the node menu and search (shown only in ComfyUI's dev mode)
    CATEGORY = "Region Genie"
    DESCRIPTION = "Internal: gives pose keypoints back to the Region Genie editor (the Pose tool's import button)."
    OUTPUT_NODE = True
    RETURN_TYPES = ()
    FUNCTION = "run"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"keypoints": ("POSE_KEYPOINT", {"forceInput": True})},
                "optional": {"nonce": ("STRING", {"default": ""})}}       # changes with every click: never answered from the cache

    def run(self, keypoints, nonce=""):
        frame = keypoints[0] if isinstance(keypoints, (list, tuple)) and keypoints else keypoints
        people = []
        if isinstance(frame, dict):
            try:
                cw, ch = float(frame.get("canvas_width") or 1), float(frame.get("canvas_height") or 1)
            except (TypeError, ValueError):
                cw, ch = 1.0, 1.0
            people = people_of([frame], max(cw, 1e-6), max(ch, 1e-6))
        return {"ui": {"pose_people": people}}


def run_detect(body):
    rs = _select()
    try:
        path = rs.resolve_image(body.get("image"))
    except rs.SelectError as e:
        raise PoseError(str(e).replace("Select object", "Pose from the image"), e.code, e.status)
    name, mpath = resolve_model(body.get("model"))
    model, vae = _load(name, mpath)
    image = _image(path)
    h, w = int(image.shape[1]), int(image.shape[2])
    bbox = None
    box = body.get("box")
    if isinstance(box, (list, tuple)) and len(box) == 4:
        x0, y0, x1, y1 = [max(0.0, min(1.0, float(v))) for v in box]
        x0, x1, y0, y1 = min(x0, x1) * w, max(x0, x1) * w, min(y0, y1) * h, max(y0, y1) * h
        if x1 - x0 >= 8 and y1 - y0 >= 8:
            bbox = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
    t0 = time.time()
    frames = _extract(model, vae, image, bbox)
    people = people_of(frames, w, h)
    log.info(f"[Region Genie] Pose from the image: {len(people)} figure(s) ({time.time() - t0:.1f}s)")
    return {"people": people, "model": name}


def handle_detect(body):
    if _select().queue_busy():
        raise PoseError("Pose from the image waits while a workflow is running", "busy", 409)
    with _lock:
        try:
            return run_detect(body)
        finally:
            _schedule_unload()


def register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return
    if getattr(PromptServer, "instance", None) is None:
        return

    @PromptServer.instance.routes.post("/region_genie/pose_detect")
    async def _pose_detect(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "bad request", "code": "error"}, status=400)
        loop = asyncio.get_running_loop()
        try:
            return web.json_response(await loop.run_in_executor(None, handle_detect, body if isinstance(body, dict) else {}))
        except PoseError as e:
            return web.json_response({"error": str(e), "code": e.code, "url": MODEL_URL if e.code in ("no_model", "bad_model") else None}, status=e.status)
        except Exception as e:
            log.exception("[Region Genie] Pose from the image failed")
            return web.json_response({"error": f"Pose from the image failed: {e}", "code": "error"}, status=500)


register_routes()
