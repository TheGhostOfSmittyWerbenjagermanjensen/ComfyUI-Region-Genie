"""ControlNet for the Region Genie node: one control (color map / depth / canny / your own image) applied with what
ComfyUI itself supports for the connected model.

    MOSS Image   color / depth control LoRA (in 'Whole image'): the maps, VAE-encoded, as concat_latent_image
                 (what ComfyUI's 'MOSS-Image Color/Depth Control' node does); the color map is the node's own.
    Flux.1       the depth / canny dev LoRAs (in 'Whole image'): the map as concat_latent_image (like
                 InstructPixToPixConditioning); otherwise a ControlNet file (XLabs, InstantX, Union, Mistoline ...).
    SDXL, SD1.5  a ControlNet file (also Control-LoRA / T2I adapter files ComfyUI's loader reads).
    Anima        an LLLite control patch (models/model_patches), on the model.
    others       not supported by ComfyUI yet: a note.

The map comes from the 'control_image' input when it is connected, else it is made from 'image': canny with ComfyUI's
Canny, depth with ComfyUI's Depth Anything 3 (its model set in Settings). With some regions switched off for control,
the control acts only inside the regions still on.
"""
import hashlib
import logging

import numpy as np
import torch

LOG = "[Region Genie]"
KINDS = ("color", "color+depth", "depth", "canny", "other")
KIND_LABEL = {"color": "color map", "color+depth": "color map + depth", "depth": "depth", "canny": "canny", "other": "your control_image"}
CN_KEY = {"Flux.1": "Flux1", "SDXL": "SDXL", "SD1.5": "SD15"}          # ControlNet files in Settings
SUPPORTED = ("MOSS Image", "Flux.1", "SDXL", "SD1.5", "Anima")
_cache = {}                                                           # loaded control files and the last depth map


def config(pdata):
    """The node's control settings from paint_data, or None when control is off."""
    c = pdata.get("control") if isinstance(pdata, dict) else None
    if not isinstance(c, dict) or not c.get("on"):
        return None
    kind = c.get("kind") if c.get("kind") in KINDS else "depth"

    def num(k, d, lo, hi):
        try:
            return max(lo, min(hi, float(c.get(k, d))))
        except (TypeError, ValueError):
            return d
    files = c.get("files") if isinstance(c.get("files"), dict) else {}
    return {"kind": kind, "strength": num("strength", 1.0, 0.0, 10.0), "start": num("start", 0.0, 0.0, 1.0),
            "end": num("end", 1.0, 0.0, 1.0), "files": {str(k): str(v) for k, v in files.items() if isinstance(v, str) and v}}


def lora_tag_ok(row, cfg, arch_name):
    """A 'Whole image' LoRA row added for control (row['control'] = model, row['ckind'] = 'moss' / 'depth' / 'canny'):
    used only while control is on, for that model, with a kind that uses it."""
    if cfg is None or arch_name is None or row.get("control") != arch_name:
        return False
    ck = row.get("ckind")
    if ck == "moss":
        return cfg["kind"] in ("color", "color+depth", "depth")
    return ck == cfg["kind"]


def _fit(img, width, height):
    """(B, H, W, C) image at width x height, 3 channels, float 0..1 (centre-cropped to the shape, like ComfyUI)."""
    import comfy.utils
    img = img[..., :3].float()
    if img.shape[1] != height or img.shape[2] != width:
        img = comfy.utils.common_upscale(img.movedim(-1, 1), width, height, "bilinear", "center").movedim(1, -1)
    return img.clamp(0, 1)


def _canny(img):
    from comfy_extras.nodes_canny import Canny
    return Canny.execute(img, 0.4, 0.8).result[0].float().cpu()


def _key(img, name):
    a = img[:1, ::8, ::8, :3].float().cpu().numpy()
    return (name, tuple(img.shape), hashlib.sha1(np.ascontiguousarray(a).tobytes()).hexdigest())


def _depth(img, model_name, notes, missing=None):
    """A depth map (near = white) with ComfyUI's Depth Anything 3, or None (with a note)."""
    if not _have("DA3", model_name, missing):
        notes.append("NOTE: control: no depth map: connect 'control_image', or set the Depth Anything 3 model in Settings > "
                      "Region Genie > Control to make one from 'image'" if not model_name else
                      f"NOTE: control: the Depth Anything 3 model '{model_name}' isn't in ComfyUI/models/geometry_estimation; "
                      "control not used")
        return None
    key = _key(img, model_name)
    if _cache.get("depth_key") == key:
        return _cache["depth"]
    try:
        from comfy_extras.nodes_depth_anything_3 import LoadDA3Model, DA3Inference, DA3Render
        if _cache.get("da3_name") != model_name:
            _cache["da3"] = LoadDA3Model.execute(model_name, "default").result[0]
            _cache["da3_name"] = model_name
        geo = DA3Inference._execute_mono(_cache["da3"], img, 504, "upper_bound_resize").result[0]
        out = DA3Render._depth_to_image(geo["depth"], geo.get("sky"), "v2_style").float().cpu()
    except Exception as e:
        notes.append(f"NOTE: control: Depth Anything 3 could not make the depth map ({e}); control not used")
        return None
    _cache["depth_key"], _cache["depth"] = key, out
    return out


FOLDER = {"MOSS": "loras", "Flux1Depth": "loras", "Flux1Canny": "loras", "DA3": "geometry_estimation"}


def _have(key, name, missing):
    """True when the file is set and ComfyUI finds it; else notes it in missing ([key, 'unset'] / [key, 'missing', name])."""
    folder = FOLDER.get(key) or ("model_patches" if key.startswith("Anima.") else "controlnet")
    if not name:
        if missing is not None:
            missing.append([key, "unset"])
        return False
    try:
        import folder_paths
        found = folder_paths.get_full_path(folder, name) is not None
    except Exception:
        found = True                                  # can't tell: let the loader say
    if not found and missing is not None:
        missing.append([key, "missing", name])
    return found


def _load_controlnet(name):
    import comfy.controlnet
    import folder_paths
    if _cache.get(("cn", name)) is None:
        _cache[("cn", name)] = comfy.controlnet.load_controlnet(folder_paths.get_full_path_or_raise("controlnet", name))
    return _cache[("cn", name)]


def _load_patch(name):
    if _cache.get(("mp", name)) is None:
        from comfy_extras.nodes_model_patch import ModelPatchLoader
        _cache[("mp", name)] = ModelPatchLoader().load_model_patch(name)[0]
    return _cache[("mp", name)]


def apply(cfg, arch_name, model, positive, negative, vae, image, control_image, color_map, region_mask, width, height, notes,
          missing=None):
    """Apply the control. region_mask: (H, W) bool where the control acts, or None for everywhere.
    Returns (model, positive, negative, the map used for the preview or None)."""
    import node_helpers
    kind = cfg["kind"]
    label = KIND_LABEL[kind]
    if arch_name is None:
        notes.append("NOTE: control is on, but no model is connected to 'model' (it decides which control to use)")
        return model, positive, negative, None
    if arch_name not in SUPPORTED:
        notes.append(f"NOTE: control: ComfyUI has no ControlNet support for {arch_name} yet; control not used")
        return model, positive, negative, None
    if positive is None:
        notes.append("NOTE: control needs 'clip' connected (it works on positive / negative)")
        return model, positive, negative, None
    files = cfg["files"]
    mask = None
    if region_mask is not None:
        mask = torch.from_numpy(region_mask.astype(np.float32))[None]           # (1, H, W)

    def blank(img):                                                           # outside the regions: black
        return img if mask is None else img * mask[..., None]

    def made(k):
        if control_image is not None:
            return _fit(control_image, width, height)
        if image is None:
            notes.append(f"NOTE: control ({label}) needs 'control_image', or an 'image' to make the map from; control not used")
            return None
        src = _fit(image, width, height)
        if k == "canny":
            return _canny(src)
        if k == "depth":
            return _depth(src, files.get("DA3"), notes, missing)
        notes.append("NOTE: control 'your control_image' needs the 'control_image' input; control not used")
        return None

    s, a, b = cfg["strength"], cfg["start"], cfg["end"]
    if arch_name == "MOSS Image":
        if kind not in ("color", "color+depth", "depth"):
            notes.append(f"NOTE: control: MOSS Image's control LoRA reads a color map and / or a depth map, not {label}; "
                         "control not used")
            return model, positive, negative, None
        if vae is None:
            notes.append("NOTE: control: MOSS Image needs 'vae' connected to encode the maps; control not used")
            return model, positive, negative, None
        if not _have("MOSS", files.get("MOSS"), missing):
            notes.append("NOTE: control: no MOSS Image color / depth LoRA is set in Settings > Region Genie > Control (or ComfyUI "
                         "doesn't find it in models/loras), so the maps have nothing to read them")
        cm = _fit(color_map, width, height) if kind in ("color", "color+depth") else None
        dm = made("depth") if kind in ("color+depth", "depth") else None
        if cm is None and dm is None:
            return model, positive, negative, None
        # as ComfyUI's MOSS-Image Color/Depth Control: [color | depth] latents, a missing map is a zero latent, scaled by
        # the strength (zeros are no control, so the region mask can switch it off per latent pixel)
        lat = [vae.encode(m) if m is not None else None for m in (cm, dm)]
        ref = next(x for x in lat if x is not None)
        lat = [torch.zeros_like(ref) if x is None else x for x in lat]
        control = torch.cat(lat, dim=1) * s
        if mask is not None:
            import comfy.utils
            m = comfy.utils.common_upscale(mask[:, None], control.shape[-1], control.shape[-2], "bilinear", "disabled")
            control = control * m.to(control.dtype)
        vals = {"concat_latent_image": control}
        positive = node_helpers.conditioning_set_values_with_timestep_range(positive, vals, a, b)
        negative = node_helpers.conditioning_set_values_with_timestep_range(negative, vals, a, b)
        notes.append(f"control: MOSS Image {label}, strength {s:g}, {a:.0%}-{b:.0%}"
                     + (" (inside the regions switched on for control)" if mask is not None else ""))
        return model, positive, negative, (dm if dm is not None else cm)

    if kind in ("color", "color+depth"):
        notes.append(f"NOTE: control: the color map is for MOSS Image's control LoRA; with {arch_name} use depth, canny or "
                     "your own control_image; control not used")
        return model, positive, negative, None
    img = made(kind)
    if img is None:
        return model, positive, negative, None
    img = blank(img)

    if arch_name == "Flux.1" and kind in ("depth", "canny") and files.get(f"Flux1{kind.capitalize()}"):
        _have(f"Flux1{kind.capitalize()}", files.get(f"Flux1{kind.capitalize()}"), missing)
        if vae is None:
            notes.append(f"NOTE: control: the Flux.1 {kind} LoRA needs 'vae' connected; control not used")
            return model, positive, negative, img
        # as InstructPixToPixConditioning: the map's latent next to the image's (the LoRA reads it)
        h8, w8 = img.shape[1] // 8 * 8, img.shape[2] // 8 * 8
        vals = {"concat_latent_image": vae.encode(img[:, :h8, :w8, :3])}
        positive = node_helpers.conditioning_set_values_with_timestep_range(positive, vals, a, b)
        negative = node_helpers.conditioning_set_values_with_timestep_range(negative, vals, a, b)
        notes.append(f"control: Flux.1 {kind} LoRA, {a:.0%}-{b:.0%} (strength: the LoRA's strength in Whole image)")
        return model, positive, negative, img

    if arch_name in CN_KEY:
        name = files.get(f"{CN_KEY[arch_name]}.{kind}")
        if not _have(f"{CN_KEY[arch_name]}.{kind}", name, missing):
            if name:
                notes.append(f"NOTE: control: the {arch_name} ControlNet '{name}' isn't in ComfyUI/models/controlnet; control not used")
                return model, positive, negative, img
            notes.append(f"NOTE: control: no {arch_name} ControlNet for {label} is set in Settings > Region Genie > Control; "
                         "control not used")
            return model, positive, negative, img
        try:
            import nodes
            cn = _load_controlnet(name)
            positive, negative = nodes.ControlNetApplyAdvanced().apply_controlnet(positive, negative, cn, img, s, a, b, vae=vae)
        except Exception as e:
            notes.append(f"NOTE: control: the ControlNet '{name}' could not be used ({e})")
            return model, positive, negative, img
        notes.append(f"control: {arch_name} ControlNet '{name}' ({label}), strength {s:g}, {a:.0%}-{b:.0%}")
        return model, positive, negative, img

    # Anima: an LLLite patch on the model (it takes the region mask itself)
    name = files.get(f"Anima.{kind}")
    if not _have(f"Anima.{kind}", name, missing):
        if name:
            notes.append(f"NOTE: control: the Anima LLLite patch '{name}' isn't in ComfyUI/models/model_patches; control not used")
            return model, positive, negative, img
        notes.append(f"NOTE: control: no Anima LLLite patch for {label} is set in Settings > Region Genie > Control; control not used")
        return model, positive, negative, img
    try:
        from comfy_extras.nodes_model_patch import AnimaLLLiteApply
        model = AnimaLLLiteApply().apply_patch(model, _load_patch(name), img, s, a, b, mask=mask)[0]
    except Exception as e:
        notes.append(f"NOTE: control: the Anima LLLite patch '{name}' could not be used ({e})")
        return model, positive, negative, img
    notes.append(f"control: Anima LLLite '{name}' ({label}), strength {s:g}, {a:.0%}-{b:.0%}")
    return model, positive, negative, img


def region_mask(regions_all, id_to_index, idx):
    """Where the control acts: None (everywhere) while every region is on for control, else the pixels of the regions
    still on (bool H x W)."""
    off = {r.get("id") for r in regions_all if isinstance(r, dict) and r.get("noControl")}
    if not off:
        return None
    on = [id_to_index[r["id"]] for r in regions_all if isinstance(r, dict) and r.get("id") in id_to_index and r.get("id") not in off]
    return np.isin(np.asarray(idx), on) if on else np.zeros(np.asarray(idx).shape, bool)
