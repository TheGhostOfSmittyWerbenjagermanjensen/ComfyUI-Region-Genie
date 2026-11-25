"""Generation settings as text, the way A1111 / Forge write them into their images (round 44).

Save Image (Region Genie) writes this text next to ComfyUI's own workflow data, so other interfaces and sites can read
what an image was made with:

    <prompt>
    Negative prompt: <negative prompt>
    Steps: 20, Sampler: Euler a, Schedule type: Karras, CFG scale: 7, Seed: 1, Size: 1024x1024, Model: name, ...

Where the values come from:
  - trace(): the workflow that ran. ComfyUI hands a save node the whole graph in API form ({id: {class_type, inputs}};
    an input is a value or a link [source id, output number]). From the save node's image the code walks back to the
    sampler (KSampler, KSampler (Advanced), SamplerCustom, SamplerCustomAdvanced with their helper nodes; any other
    node that looks like a sampler is read by its input names), on to the model loader and the LoRA loaders, and to
    the prompts. Only values that are written in the graph can be read: a seed that another node computes can't.
  - later passes (round 46): from the first sampler found, _back() walks on to earlier ones; each later pass notes what
    enlarged the picture before it ("ups"), and trace() also notes what enlarged it after the last pass ("post").
    build() sorts them: a detailer (ADetailer's field names), a refiner (it starts part-way through the steps with
    another model: A1111's Refiner fields), the hi-res pass (the first one the picture was enlarged for), and
    anything that enlarged it after that (A1111's Extras fields, "Postprocess upscale by / upscaler").
  - RUNS: what a Region Genie / Regional LoRAs node really used in its last run (the text after wildcards and the LLM,
    the LoRAs it applied). Those nodes call record(); it is kept in memory only, never written anywhere.
  - overrides: values connected to the save node's optional inputs win over everything read.
  - hashes: only from files that already hold one (file_hash()): nothing is ever hashed here.

No ComfyUI import at module level: tests/test_gen_params.py runs it on its own.
"""
import json
import os
import re
import struct

# --------------------------------------------------------------------------- #
# what the pack's own nodes used in their last run (memory only)
# --------------------------------------------------------------------------- #
RUNS = {}


def record(node_id, **what):
    """A Region Genie / Regional LoRAs node tells what it used: prompt, negative, loras [(name, strength)], width, height."""
    if node_id is not None:
        RUNS[str(node_id)] = what


# --------------------------------------------------------------------------- #
# names: ComfyUI -> A1111 / Forge (a name with no counterpart is written as it is)
# --------------------------------------------------------------------------- #
SAMPLERS = {
    "euler": "Euler", "euler_ancestral": "Euler a", "euler_cfg_pp": "Euler CFG++", "euler_ancestral_cfg_pp": "Euler a CFG++",
    "heun": "Heun", "heunpp2": "Heun++ 2", "dpm_2": "DPM2", "dpm_2_ancestral": "DPM2 a", "lms": "LMS",
    "dpm_fast": "DPM fast", "dpm_adaptive": "DPM adaptive",
    "dpmpp_2s_ancestral": "DPM++ 2S a", "dpmpp_sde": "DPM++ SDE", "dpmpp_sde_gpu": "DPM++ SDE",
    "dpmpp_2m": "DPM++ 2M", "dpmpp_2m_sde": "DPM++ 2M SDE", "dpmpp_2m_sde_gpu": "DPM++ 2M SDE",
    "dpmpp_2m_sde_heun": "DPM++ 2M SDE Heun", "dpmpp_2m_sde_heun_gpu": "DPM++ 2M SDE Heun",
    "dpmpp_3m_sde": "DPM++ 3M SDE", "dpmpp_3m_sde_gpu": "DPM++ 3M SDE",
    "ddim": "DDIM", "ddpm": "DDPM", "lcm": "LCM", "uni_pc": "UniPC", "uni_pc_bh2": "UniPC", "ipndm": "IPNDM",
    "ipndm_v": "IPNDM_V", "deis": "DEIS", "res_multistep": "Res Multistep", "restart": "Restart", "plms": "PLMS",
}
SCHEDULERS = {
    "normal": "Normal", "karras": "Karras", "exponential": "Exponential", "sgm_uniform": "SGM Uniform",
    "simple": "Simple", "ddim_uniform": "DDIM", "beta": "Beta", "linear_quadratic": "Linear Quadratic",
    "kl_optimal": "KL Optimal", "align_your_steps": "Align Your Steps", "polyexponential": "Polyexponential",
    "turbo": "Turbo", "gits": "GITS", "laplace": "Laplace",
}
# sampler nodes without a sampler_name input (SamplerCustom's "sampler" input): the node's class says which
SAMPLER_NODES = {
    "SamplerEulerAncestral": "euler_ancestral", "SamplerEulerAncestralCFGPP": "euler_ancestral_cfg_pp",
    "SamplerEulerCFGpp": "euler_cfg_pp", "SamplerLMS": "lms", "SamplerDPMPP_2M_SDE": "dpmpp_2m_sde",
    "SamplerDPMPP_SDE": "dpmpp_sde", "SamplerDPMPP_3M_SDE": "dpmpp_3m_sde", "SamplerDPMPP_2S_Ancestral": "dpmpp_2s_ancestral",
    "SamplerDPMAdaptative": "dpm_adaptive", "SamplerLCMUpscale": "lcm", "SamplerER_SDE": "er_sde", "SamplerSASolver": "sa_solver",
}
SCHEDULER_NODES = {
    "KarrasScheduler": "karras", "ExponentialScheduler": "exponential", "PolyexponentialScheduler": "polyexponential",
    "SDTurboScheduler": "turbo", "AlignYourStepsScheduler": "align_your_steps", "BetaSamplingScheduler": "beta",
    "GITSScheduler": "gits", "LaplaceScheduler": "laplace", "VPScheduler": "vp", "Flux2Scheduler": "simple",
}
LATENT_INPUTS = ("latent_image", "latent", "samples", "latents")
# a sampler that takes a picture instead of a latent (tiled upscalers such as Ultimate SD Upscale, detailers)
IMAGE_INPUTS = ("image", "images", "pixels", "upscaled_image")
# what a walk back along the picture never follows: these inputs bring something else than the picture
NOT_PICTURE = ("model", "positive", "negative", "vae", "clip", "conditioning", "control_net", "controlnet", "upscale_model",
               "sampler", "sigmas", "noise", "guider", "mask", "clip_vision", "style_model")
RG_MAIN, RG_LORAS = "Region-Genie_Main", "Region-Genie_RegionalLoRAs"
MAX_NODES = 600                                    # a walk never looks at more nodes than this


# --------------------------------------------------------------------------- #
# reading the graph
# --------------------------------------------------------------------------- #
def _is_link(v):
    return isinstance(v, (list, tuple)) and len(v) == 2 and isinstance(v[0], (str, int)) and isinstance(v[1], int) \
        and not isinstance(v[1], bool)


def _node(graph, nid):
    n = graph.get(str(nid)) if isinstance(graph, dict) else None
    return n if isinstance(n, dict) and isinstance(n.get("inputs"), dict) else None


def _value(graph, v, depth=0):
    """A value as written in the graph: itself, or what a plain value node (a primitive, a constant, a seed node)
    holds. None when another node computes it."""
    if not _is_link(v):
        return v
    n = _node(graph, v[0])
    if n is None or depth > 6:
        return None
    ins = n["inputs"]
    for k in ("value", "seed", "noise_seed", "int", "float", "number", "text", "string"):
        if k in ins and (len(ins) == 1 or k == "value" or str(n.get("class_type", "")).startswith("Primitive")):
            return _value(graph, ins[k], depth + 1)
    if len(ins) == 1:
        return _value(graph, next(iter(ins.values())), depth + 1)
    return None


def _num(x):
    try:
        if isinstance(x, bool) or x is None:
            return None
        f = float(x)
        return int(f) if f == int(f) and not isinstance(x, float) else f
    except (TypeError, ValueError):
        return None


def _provider(graph, n):
    """Impact Pack's iterative upscale: the node takes the picture, its sampler settings sit on an 'upscaler provider'
    node connected to it. Returns that node, or None."""
    v = n["inputs"].get("upscaler") if graph is not None else None
    pn = _node(graph, v[0]) if _is_link(v) else None
    if pn is not None and "steps" in pn["inputs"] and any(k in pn["inputs"] for k in ("seed", "noise_seed")):
        return pn
    return None


def _is_sampler(n, graph=None):
    ins, ct = n["inputs"], str(n.get("class_type", ""))
    if ct in ("KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced"):
        return True
    if _provider(graph, n) is not None and any(_is_link(ins.get(k)) for k in LATENT_INPUTS + IMAGE_INPUTS):
        return True
    if not (("steps" in ins or "sigmas" in ins) and any(k in ins for k in ("seed", "noise_seed", "noise"))):
        return False
    if any(k in ins for k in LATENT_INPUTS):
        return True
    # fed a picture: it must also take a model (or a guider), or a node that only has steps and a seed would count
    return any(_is_link(ins.get(k)) for k in IMAGE_INPUTS) and any(_is_link(ins.get(k)) for k in ("model", "guider", "positive"))


def _sampler_name(graph, v):
    if not _is_link(v):
        return v if isinstance(v, str) else None
    n = _node(graph, v[0])
    if n is None:
        return None
    name = _value(graph, n["inputs"].get("sampler_name"))
    if isinstance(name, str):
        return name
    ct = str(n.get("class_type", ""))
    if ct in SAMPLER_NODES:
        return SAMPLER_NODES[ct]
    if ct.startswith("Sampler") and len(ct) > 7:
        return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", ct[7:]).lower()
    return None


def _sigmas(graph, v, depth=0):
    """{scheduler, steps, denoise, model} of the node that makes the sigmas (through nodes that only cut them)."""
    out = {}
    n = _node(graph, v[0]) if _is_link(v) else None
    if n is None or depth > 6:
        return out
    ins, ct = n["inputs"], str(n.get("class_type", ""))
    steps = _num(_value(graph, ins.get("steps")))
    if steps is None and _is_link(ins.get("sigmas")):
        return _sigmas(graph, ins["sigmas"], depth + 1)           # SplitSigmas, FlipSigmas ...
    out["steps"] = steps
    sch = _value(graph, ins.get("scheduler"))
    out["scheduler"] = sch if isinstance(sch, str) else SCHEDULER_NODES.get(ct) or (ct[:-9].lower() if ct.endswith("Scheduler") and ct != "BasicScheduler" else None)
    out["denoise"] = _num(_value(graph, ins.get("denoise")))
    if _is_link(ins.get("model")):
        out["model"] = ins["model"]
    return out


def _read_sampler(graph, nid):
    """What one sampler node says: seed, steps, cfg, sampler, scheduler, denoise, and the links to follow."""
    n = _node(graph, nid)
    ins, ct = n["inputs"], str(n.get("class_type", ""))
    s = {"id": str(nid), "class": ct}
    pn = _provider(graph, n)
    if pn is not None:                                         # the settings from the provider node, the picture from this one
        ins = {**pn["inputs"], **{k: v for k, v in ins.items() if k in LATENT_INPUTS + IMAGE_INPUTS}}
    s["seed"] = _num(_value(graph, ins.get("seed", ins.get("noise_seed"))))
    s["steps"] = _num(_value(graph, ins.get("steps")))
    s["cfg"] = _num(_value(graph, ins.get("cfg")))
    s["sampler"] = _sampler_name(graph, ins.get("sampler_name", ins.get("sampler")))
    sch = _value(graph, ins.get("scheduler"))
    s["scheduler"] = sch if isinstance(sch, str) else None
    s["denoise"] = _num(_value(graph, ins.get("denoise")))
    for k in ("model", "positive", "negative"):
        if _is_link(ins.get(k)):
            s[k] = ins[k]
    start, end = _num(_value(graph, ins.get("start_at_step"))), _num(_value(graph, ins.get("end_at_step")))
    s["latent"] = next((ins[k] for k in LATENT_INPUTS + IMAGE_INPUTS if _is_link(ins.get(k))), None)
    s["ups"] = [u for u in (_upscaler(graph, n), _upscaler(graph, pn) if pn is not None else None) if u]   # upscales and samples in one
    if pn is not None and s["ups"]:
        f = _num(_value(graph, n["inputs"].get("upscale_factor")))
        s["ups"] = [{**s["ups"][-1], "factor": f, "target": None}]   # the provider says what with, the node how far
    s["start_at_step"] = start
    if re.search(r"detailer", ct, re.I):
        s["detailer"] = _detailer(graph, n)
    # KSampler (Advanced): a pass that starts part-way has no denoise value; the steps say it
    if s["denoise"] is None and s["steps"] and start:
        s["denoise"] = round(max(0.0, 1 - start / s["steps"]), 2)
    if end is not None and s["steps"] and end < s["steps"]:
        s["end_at_step"] = end
    # SamplerCustom / SamplerCustomAdvanced: the values sit on the helper nodes
    if _is_link(ins.get("sigmas")):
        g = _sigmas(graph, ins["sigmas"])
        for k in ("steps", "scheduler", "denoise"):
            if s.get(k) is None and g.get(k) is not None:
                s[k] = g[k]
        s.setdefault("model", g.get("model"))
    if _is_link(ins.get("noise")):
        nn = _node(graph, ins["noise"][0])
        if nn is not None and s["seed"] is None:
            s["seed"] = _num(_value(graph, nn["inputs"].get("noise_seed", nn["inputs"].get("seed"))))
    if _is_link(ins.get("guider")):
        gn = _node(graph, ins["guider"][0])
        if gn is not None:
            gi = gn["inputs"]
            if s["cfg"] is None:
                s["cfg"] = _num(_value(graph, gi.get("cfg", gi.get("cfg_conds"))))
            for k, src in (("model", "model"), ("positive", "positive"), ("positive", "conditioning"), ("negative", "negative")):
                if s.get(k) is None and _is_link(gi.get(src)):
                    s[k] = gi[src]
    if s.get("model") is None:
        s.pop("model", None)
    return s


def _upscaler(graph, n):
    """What a node enlarges the picture with, or None when it doesn't:
    {name: an upscale model's name, 'Latent' (+ the method) or the method; model: True for an upscale model;
     factor: how many times larger (None when the node doesn't say); target: (width, height) it resizes to, or None}."""
    ins, ct = n["inputs"], str(n.get("class_type", ""))
    factor = next((f for f in (_num(_value(graph, ins.get(k))) for k in ("upscale_by", "scale_by", "upscale_factor", "scale_factor", "scale"))
                   if f is not None and f > 0), None)
    link = next((ins[k] for k in ("upscale_model", "upscale_model_opt") if _is_link(ins.get(k))), None)
    own = ins.get("upscale_model")                              # a file name on the node itself (Tiled Upscale (Region Genie))
    own = own if isinstance(own, str) and own and own.lower() != "none" else None
    if link is not None or own is not None:
        ln = _node(graph, link[0]) if link is not None else None
        name = own if link is None else (_value(graph, ln["inputs"].get("model_name")) if ln is not None else None)
        name = _stem(name) if isinstance(name, str) and name else "Upscale model"
        if factor is None:                                     # the model's own factor is in its name: 4x-UltraSharp, RealESRGAN_x2
            m = re.search(r"(?<![0-9a-z])([2-8])x|x([2-8])(?![0-9a-z])", name, re.I)
            factor = int(m.group(1) or m.group(2)) if m else None
        return {"name": name, "model": True, "factor": factor, "target": None}
    if re.search(r"upscale|scale|resize", ct, re.I) and not re.search(r"model|loader|cfg|schedul|provider", ct, re.I) \
            and any(_is_link(ins.get(k)) for k in LATENT_INPUTS + IMAGE_INPUTS):
        m = _value(graph, ins.get("upscale_method", ins.get("scale_method", ins.get("method", ins.get("interpolation")))))
        m = m.capitalize() if isinstance(m, str) and m else ""
        if "latent" in ct.lower():
            m = ("Latent (%s)" % m.lower()) if m and m.lower() != "nearest-exact" else "Latent"
        w, h = _num(_value(graph, ins.get("width"))), _num(_value(graph, ins.get("height")))
        target = (int(w), int(h)) if w and h and w > 0 and h > 0 else None
        return {"name": m or ct, "model": False, "factor": None if target else factor, "target": target}
    if ct.endswith("UpscalerProvider"):                        # Impact Pack's provider without an upscale model
        m = _value(graph, ins.get("scale_method"))
        return {"name": m.capitalize() if isinstance(m, str) and m else "Resize", "model": False, "factor": None, "target": None}
    return None


def _detailer(graph, n):
    """A detailer node's own settings, in the terms of A1111's ADetailer extension."""
    ins = n["inputs"]
    dn = None
    for k, v in ins.items():                                   # the detector: on the node, or behind the areas it is given
        if dn is None and _is_link(v) and ("detector" in k.lower() or "segs" in k.lower()):
            _, dn = _find_upstream(graph, v, lambda m: isinstance(m["inputs"].get("model_name"), str)
                                   and "etect" in str(m.get("class_type", "")))
    # the detector's threshold and dilation: on the detailer itself (FaceDetailer), or on the node that found the
    # areas for it (Detailer (SEGS) after BBOX Detector (SEGS))
    src = ins
    if "bbox_threshold" not in ins and "threshold" not in ins and _is_link(ins.get("segs")):
        _, sn = _find_upstream(graph, ins["segs"], lambda m: "threshold" in m["inputs"] or "bbox_threshold" in m["inputs"])
        src = sn["inputs"] if sn is not None else ins
    return {"model": os.path.basename(str(dn["inputs"]["model_name"]).replace("\\", "/")) if dn is not None else None,
            "confidence": _num(_value(graph, src.get("bbox_threshold", src.get("threshold")))),
            "dilate": _num(_value(graph, src.get("bbox_dilation", src.get("dilation")))),
            "blur": _num(_value(graph, ins.get("feather")))}


def _back(graph, link, known=()):
    """Back along the picture (latent or image) from `link`, through nodes that only change it (an upscale, a decode +
    encode), to the sampler it came from. The inputs that usually carry the picture first; then, only when those end,
    any other input that isn't known to carry something else (a switch or a node of another pack names its inputs
    its own way). Returns (the sampler's id or None, what enlarged the picture on the way, nearest first)."""
    seen, q, rest, ups = set(), [link], [], []
    first = ("samples", "latent", "latent_image", "latents", "image", "images", "pixels", "upscaled_image")
    while (q or rest) and len(seen) < MAX_NODES:
        v = q.pop(0) if q else rest.pop(0)
        if not _is_link(v) or str(v[0]) in seen:
            continue
        seen.add(str(v[0]))
        n = _node(graph, v[0])
        if n is None:
            continue
        if _is_sampler(n, graph):
            return (str(v[0]) if str(v[0]) not in known else None), ups
        up = _upscaler(graph, n)
        if up:
            ups.append(up)
        ins = n["inputs"]
        q += [ins[k] for k in first if _is_link(ins.get(k))]
        rest += [x for k, x in ins.items() if _is_link(x) and k not in first and k.lower() not in NOT_PICTURE]
    return None, ups


def find_samplers(graph, start):
    """(the samplers the image came from, first pass first; what enlarged the picture after the last of them).
    `start`: the link the save node's image comes in by. Each later pass has "ups": what enlarged the picture between
    the pass before it and its own sampling."""
    last, post = _back(graph, start)
    if last is None:
        # not along the picture's usual inputs: any sampler behind the save node
        seen, queue, post = set(), [start], []
        while queue and len(seen) < MAX_NODES and last is None:
            v = queue.pop(0)
            if not _is_link(v) or str(v[0]) in seen:
                continue
            seen.add(str(v[0]))
            n = _node(graph, v[0])
            if n is None:
                continue
            if _is_sampler(n, graph):
                last = str(v[0])
                break
            queue += [x for x in n["inputs"].values() if _is_link(x)]
    chain = []
    while last is not None and len(chain) < 8:
        s = _read_sampler(graph, last)
        chain.append(s)
        last, ups = _back(graph, s["latent"], {c["id"] for c in chain})
        s["ups"] = s["ups"] + ups
    chain.reverse()
    if chain:
        chain[0]["ups"] = []                                   # before the first pass there is nothing to enlarge
    return chain, post


def _lora_rows(n):
    """The LoRAs a loader node applies: [(name, strength)]."""
    ins, out = n["inputs"], []
    name = ins.get("lora_name")
    if isinstance(name, str) and name and name.lower() != "none":
        st = _num(ins.get("strength_model", ins.get("strength", 1)))
        if st is None or st != 0:
            out.append((name, 1.0 if st is None else float(st)))
    for v in ins.values():                                     # a list of LoRAs on one node (rgthree's Power Lora Loader)
        if isinstance(v, dict) and isinstance(v.get("lora"), str) and v.get("on", True) and v["lora"].lower() != "none":
            st = _num(v.get("strength", 1))
            if st is None or st != 0:
                out.append((v["lora"], 1.0 if st is None else float(st)))
    return out


MODEL_KEYS = (("ckpt_name", "checkpoints"), ("unet_name", "diffusion_models"), ("model_name", "diffusion_models"),
              ("gguf_name", "diffusion_models"))


def find_model(graph, link):
    """Back along the model: {name, folder} of the loader, and the LoRAs met on the way [(name, strength)]."""
    model, loras, seen = None, [], set()
    while _is_link(link) and str(link[0]) not in seen and len(seen) < MAX_NODES:
        seen.add(str(link[0]))
        n = _node(graph, link[0])
        if n is None:
            break
        ins, ct = n["inputs"], str(n.get("class_type", ""))
        if ct in (RG_MAIN, RG_LORAS):
            loras = [tuple(x) for x in (RUNS.get(str(link[0])) or {}).get("loras") or []] + loras
        else:
            loras = _lora_rows(n) + loras                      # nearer the loader = applied first
        for key, folder in MODEL_KEYS:
            if isinstance(ins.get(key), str) and ins[key]:
                model = {"name": ins[key], "folder": folder}
                break
        if model is not None:
            break
        link = next((ins[k] for k in ("model", "unet", "base_model", "model1") if _is_link(ins.get(k))), None)
    return model, loras


TEXT_KEYS = ("text", "prompt", "text_g", "t5xxl", "clip_l", "string", "positive_prompt")


def find_text(graph, link, which):
    """The prompt a conditioning was made from. which: "positive" | "negative". Returns the text, or None."""
    seen, queue = set(), [link]
    while queue and len(seen) < MAX_NODES:
        v = queue.pop(0)
        if not _is_link(v) or str(v[0]) in seen:
            continue
        seen.add(str(v[0]))
        n = _node(graph, v[0])
        if n is None:
            continue
        ins, ct = n["inputs"], str(n.get("class_type", ""))
        if ct in (RG_MAIN, RG_LORAS):
            run = RUNS.get(str(v[0])) or {}
            if which == "negative":
                t = run.get("negative", ins.get("scene_prompt_negative", ins.get("negative_prompt")))
            else:
                t = run.get("prompt", ins.get("scene_prompt_positive", ins.get("positive_prompt")))
            return t if isinstance(t, str) else None
        if ct == "ConditioningZeroOut":
            return ""
        texts = []
        for k in TEXT_KEYS:
            if k == "positive_prompt" and which == "negative":
                k = "negative_prompt"
            t = _value(graph, ins.get(k)) if k in ins else None
            if isinstance(t, str) and t.strip() and t not in texts:
                texts.append(t)
        if texts:
            return "\n".join(texts)
        # a node that passes both prompts on (a ControlNet): stay on this one's side
        if _is_link(ins.get(which)):
            queue.append(ins[which])
            continue
        queue += [ins[k] for k in ins if _is_link(ins[k]) and ("cond" in k or k in ("positive", "negative", "text", "prompt"))]
    return None


def _find_upstream(graph, link, test, keys=None):
    """The first node back from `link` (breadth first) for which test(node) is true, or None."""
    seen, queue = set(), [link]
    while queue and len(seen) < MAX_NODES:
        v = queue.pop(0)
        if not _is_link(v) or str(v[0]) in seen:
            continue
        seen.add(str(v[0]))
        n = _node(graph, v[0])
        if n is None:
            continue
        if test(n):
            return str(v[0]), n
        queue += [x for k, x in n["inputs"].items() if _is_link(x) and (keys is None or k in keys)]
    return None, None


def trace(graph, save_id, image_input="images"):
    """Everything that can be read from the workflow that ran. Returns a dict; values that couldn't be read are None."""
    out = {"samplers": [], "model": None, "loras": [], "positive": None, "negative": None, "vae": None,
           "clip_skip": None, "guidance": None, "base_size": None, "post": []}
    me = _node(graph, save_id)
    if me is None or not _is_link(me["inputs"].get(image_input)):
        return out
    start = me["inputs"][image_input]
    chain, out["post"] = find_samplers(graph, start)
    out["samplers"] = chain
    for later in chain[1:]:                                    # a refiner's model
        if later.get("model"):
            later["model_info"] = find_model(graph, later["model"])[0]
    if chain:
        first = chain[0]
        if first.get("model"):
            out["model"], out["loras"] = find_model(graph, first["model"])
        if first.get("positive"):
            out["positive"] = find_text(graph, first["positive"], "positive")
            _, g = _find_upstream(graph, first["positive"], lambda n: n.get("class_type") == "FluxGuidance")
            if g is not None:
                out["guidance"] = _num(_value(graph, g["inputs"].get("guidance")))
            _, cs = _find_upstream(graph, first["positive"], lambda n: n.get("class_type") == "CLIPSetLastLayer")
            if cs is not None:
                v = _num(_value(graph, cs["inputs"].get("stop_at_clip_layer")))
                out["clip_skip"] = abs(int(v)) if v is not None else None
        if first.get("negative"):
            out["negative"] = find_text(graph, first["negative"], "negative")
        # the size the first pass was made at: the node its latent comes from says it
        if first.get("latent"):
            nid, ln = _find_upstream(graph, first["latent"], lambda n: n.get("class_type") == RG_MAIN or (
                _num(n["inputs"].get("width")) is not None and _num(n["inputs"].get("height")) is not None), keys=LATENT_INPUTS)
            if ln is not None:
                run = RUNS.get(nid) or {} if ln.get("class_type") == RG_MAIN else {}
                w = _num(run.get("width", ln["inputs"].get("width")))
                h = _num(run.get("height", ln["inputs"].get("height")))
                if w and h:
                    out["base_size"] = (int(w), int(h))
    else:
        # no sampler (an image that was only loaded or drawn): the pack's own node may still say the prompt
        nid, rg = _find_upstream(graph, start, lambda n: n.get("class_type") == RG_MAIN)
        if rg is not None:
            run = RUNS.get(nid) or {}
            out["positive"], out["negative"] = run.get("prompt"), run.get("negative")
            out["loras"] = [tuple(x) for x in run.get("loras") or []]
    # the VAE: a loader on the way back from the picture
    _, vn = _find_upstream(graph, start, lambda n: isinstance(n["inputs"].get("vae_name"), str))
    if vn is not None:
        out["vae"] = vn["inputs"]["vae_name"]
    return out


# --------------------------------------------------------------------------- #
# hashes: only ones that are already written down somewhere
# --------------------------------------------------------------------------- #
_HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")
_HASHES = {}                                        # (path, mtime, size) -> result, for as long as ComfyUI runs


def _sha256_in(obj, depth=0):
    """A 'sha256' entry in a metadata file: at the top first, then in the dicts inside it (not in lists: those are
    other files of the same model)."""
    if not isinstance(obj, dict) or depth > 3:
        return None
    for k, v in obj.items():
        if isinstance(k, str) and k.lower() == "sha256" and isinstance(v, str) and _HEX64.match(v.strip()):
            return v.strip().lower()
    for v in obj.values():
        h = _sha256_in(v, depth + 1)
        if h:
            return h
    return None


def _json(path):
    try:
        if os.path.isfile(path) and os.path.getsize(path) < 64 * 1024 * 1024:
            with open(path, "r", encoding="utf-8-sig") as f:
                return json.load(f)
    except (OSError, ValueError, UnicodeDecodeError):
        pass
    return None


def _header_hash(path):
    """The hash kohya-based trainers write into a .safetensors file's own header (what A1111 uses for a LoRA)."""
    try:
        if not path.lower().endswith(".safetensors"):
            return None
        with open(path, "rb") as f:
            n = struct.unpack("<Q", f.read(8))[0]
            if not 2 <= n <= 100 * 1024 * 1024:
                return None
            meta = json.loads(f.read(n).decode("utf-8")).get("__metadata__") or {}
        h = meta.get("sshs_model_hash")
        return h.strip().lower() if isinstance(h, str) and _HEX64.match(h.strip()) else None
    except (OSError, ValueError, struct.error, UnicodeDecodeError, AttributeError):
        return None


def file_hash(path):
    """The short hash other tools know a model file by, read from a file that already holds one; "" when none does.
    Looked for, in this order:
      <name>.metadata.json         ComfyUI LoRA Manager          "sha256"
      <file>.rgthree-info.json     rgthree-comfy                 "sha256"
      <name>.cm-info.json          Stability Matrix              "Hashes": {"SHA256"}
      <name>.civitai.info          Civitai Helper (A1111)        "files": [{"name", "hashes": {"SHA256"}}], this file's entry
      the file's own header        kohya-based trainers          "sshs_model_hash"
    A full-file SHA256 is cut to 10 characters (Civitai's "AutoV2", A1111's model hash); a header hash to 12 (A1111's
    LoRA hash). The model file itself is never read through."""
    if not path or not os.path.isfile(path):
        return ""
    try:
        st = os.stat(path)
        key = (path, st.st_mtime, st.st_size)
    except OSError:
        return ""
    stem = os.path.splitext(path)[0]
    side = [stem + ".metadata.json", path + ".rgthree-info.json", stem + ".cm-info.json", stem + ".civitai.info"]
    try:
        key += tuple(os.path.getmtime(p) if os.path.isfile(p) else 0 for p in side)
    except OSError:
        pass
    if key in _HASHES:
        return _HASHES[key]
    found = ""
    for p in side[:3]:
        h = _sha256_in(_json(p))
        if h:
            found = h[:10]
            break
    if not found:
        info = _json(side[3])
        base = os.path.basename(path).lower()
        for f in (info.get("files") if isinstance(info, dict) and isinstance(info.get("files"), list) else []):
            if isinstance(f, dict) and str(f.get("name", "")).lower() == base:
                h = _sha256_in({"hashes": f.get("hashes")})
                if h:
                    found = h[:10]
                    break
    if not found:
        h = _header_hash(path)
        if h:
            found = h[:12]
    if len(_HASHES) > 4000:
        _HASHES.clear()
    _HASHES[key] = found
    return found


# --------------------------------------------------------------------------- #
# the text
# --------------------------------------------------------------------------- #
def _stem(name):
    return os.path.splitext(os.path.basename(str(name).replace("\\", "/")))[0]


def _quote(v):
    """A1111's rule: a value with a comma or a colon in it is written as a JSON string."""
    s = str(v)
    return json.dumps(s, ensure_ascii=False) if ("," in s or ":" in s or "\n" in s) else s


def _fmt(x):
    if isinstance(x, float):
        return ("%.4f" % x).rstrip("0").rstrip(".") if x != int(x) else str(int(x))
    return str(x)


def lora_tags(loras):
    """<lora:name:strength> for each LoRA, a name once (the first strength met)."""
    out, seen = [], set()
    for name, strength in loras or []:
        s = _stem(name)
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(f"<lora:{s}:{_fmt(float(strength))}>")
    return out


def build(traced, size=None, overrides=None, path_of=None):
    """The 'parameters' text and what couldn't be read.
    traced: trace()'s result. size: (width, height) of the image being saved. overrides: values from the save node's
    optional inputs (positive, negative, seed, steps, cfg, sampler_name, scheduler, denoise, model_name); they win.
    path_of(folder, name) -> the file's full path or None (for the hashes).
    Returns (text or None, [names of settings a sampler was found for but that couldn't be read])."""
    o = {k: v for k, v in (overrides or {}).items() if v is not None and v != ""}
    chain = traced.get("samplers") or []
    first = chain[0] if chain else {}
    later = chain[1:]
    base = traced.get("base_size")
    final = tuple(int(x) for x in size) if size else None

    def seg(ups):
        """What a stretch of the workflow did to the size: (name, factor or None, target size or None)."""
        if not ups:
            return None
        name = next((u["name"] for u in ups if u.get("model")), ups[0]["name"])     # an upscale model before a plain resize
        target = next((u["target"] for u in ups if u.get("target")), None)
        factor = None
        if target is None and all(u.get("factor") for u in ups):
            factor = 1.0
            for u in ups:
                factor *= u["factor"]
        return name, factor, target

    # what each later pass is: a detailer; a refiner (it carries on part-way through the steps, with another model);
    # the hi-res pass (the first one the picture was enlarged for; else a plain second pass at the same size)
    detailers = [c for c in later if c.get("detailer") is not None]
    rest = [c for c in later if c.get("detailer") is None]
    refiner = None
    for c in list(rest):
        if c.get("start_at_step") and not c.get("ups"):
            rest.remove(c)                                      # one sampling split over two nodes: no pass of its own
            mi = c.get("model_info") or {}
            if refiner is None and mi.get("name") and mi.get("name") != (traced.get("model") or {}).get("name"):
                refiner = c
    for c in rest:                                              # a resize to the size it already had enlarges nothing
        sg = seg(c.get("ups"))
        if sg and base and sg[2] == tuple(base) and c is rest[0]:
            c["ups"] = []
    second = next((c for c in rest if c.get("ups")), rest[0] if rest else None)
    # what enlarged the picture after the hi-res pass: later sampled passes and plain upscalers
    after = [u for c in rest[rest.index(second) + 1:] for u in c.get("ups") or []] if second is not None else []
    after = list(traced.get("post") or []) + after              # nearest the saved picture first
    hires_seg = seg(second.get("ups")) if second is not None else None
    if hires_seg is None and after:                             # enlarged without sampling again: written as hi-res fix too
        hires_seg, after = seg(after), []
    if hires_seg is None and second is not None and base and final and tuple(final) != tuple(base):
        hires_seg = (None, None, None)                          # a second pass at another size: enlarged, by something unnamed
    enlarged = hires_seg is not None

    def pick(key, okey=None):
        return o[okey or key] if (okey or key) in o else first.get(key)

    positive = o.get("positive", traced.get("positive"))
    negative = o.get("negative", traced.get("negative"))
    seed, steps, cfg = pick("seed"), pick("steps"), pick("cfg")
    sampler, scheduler = pick("sampler", "sampler_name"), pick("scheduler")
    denoise = pick("denoise")
    model = traced.get("model") or {}
    model_name = o.get("model_name") or model.get("name")
    loras = traced.get("loras") or []

    missing = []
    if chain or o:
        for label, v in (("seed", seed), ("steps", steps), ("sampler", sampler)):
            if v is None:
                missing.append(label)
    have_prompt = isinstance(positive, str) and positive.strip()
    if not chain and not o and not have_prompt:
        return None, missing

    lines = []
    prompt = positive.strip() if have_prompt else ""
    tags = [t for t in lora_tags(loras) if t.lower() not in prompt.lower()]
    if tags:
        # after a prompt that is one line of text: on the same line; after JSON or several lines: on a line of their own
        sep = "\n" if ("\n" in prompt or prompt[:1] in "{[") else " "
        prompt = (prompt + sep if prompt else "") + " ".join(tags)
    lines.append(prompt)
    if isinstance(negative, str) and negative.strip():
        lines.append("Negative prompt: " + negative.strip())

    f = []

    def add(name, v):
        if v is not None and v != "":
            f.append(f"{name}: {_quote(v)}")

    add("Steps", _fmt(steps) if steps is not None else None)
    if isinstance(sampler, str) and sampler:
        add("Sampler", SAMPLERS.get(sampler.lower(), sampler))
    if isinstance(scheduler, str) and scheduler:
        add("Schedule type", SCHEDULERS.get(scheduler.lower(), scheduler))
    add("CFG scale", _fmt(cfg) if cfg is not None else None)
    if traced.get("guidance") is not None:
        add("Distilled CFG Scale", _fmt(traced["guidance"]))
    add("Seed", _fmt(seed) if seed is not None else None)
    show = (base if enlarged else None) or final
    if show:
        add("Size", f"{show[0]}x{show[1]}")
    if model_name:
        mpath = path_of(model.get("folder") or "checkpoints", model_name) if path_of and model.get("name") == model_name else None
        add("Model hash", file_hash(mpath) if mpath else "")
        add("Model", _stem(model_name))
    if traced.get("vae"):
        add("VAE", os.path.basename(str(traced["vae"]).replace("\\", "/")))
    if refiner is not None:
        # the way A1111 writes its refiner: the model, and how far through the steps it took over
        rm = refiner.get("model_info") or {}
        rpath = path_of(rm.get("folder") or "checkpoints", rm["name"]) if path_of else None
        rh = file_hash(rpath) if rpath else ""
        add("Refiner", _stem(rm["name"]) + (f" [{rh}]" if rh else ""))
        if refiner.get("steps"):
            add("Refiner switch at", _fmt(round(refiner["start_at_step"] / refiner["steps"], 2)))
    hsize = None
    if second is not None or enlarged:
        # a second pass (or an upscale), written the way A1111 writes hi-res fix
        if second is not None and second.get("denoise") is not None:
            add("Denoising strength", _fmt(second["denoise"]))
        if enlarged and base:
            name, factor, target = hires_seg
            if not after:
                hsize = final                                   # the only thing that enlarged it: the saved size says how far
            elif target:
                hsize = target
            elif factor:
                hsize = (int(round(base[0] * factor)), int(round(base[1] * factor)))
            if hsize and tuple(hsize) != tuple(base):
                add("Hires resize", f"{hsize[0]}x{hsize[1]}")
                add("Hires upscale", _fmt(round(hsize[0] / base[0], 2)))
        if second is not None and second.get("steps") is not None:
            add("Hires steps", _fmt(second["steps"]))
        if enlarged:
            add("Hires upscaler", hires_seg[0])
        if second is not None:
            # the second pass's own sampler, schedule and CFG, where they differ from the first pass's (as Forge writes them)
            s2 = second.get("sampler")
            if isinstance(s2, str) and s2 and s2 != first.get("sampler"):
                add("Hires sampler", SAMPLERS.get(s2.lower(), s2))
            c2 = second.get("scheduler")
            if isinstance(c2, str) and c2 and c2 != first.get("scheduler"):
                add("Hires schedule type", SCHEDULERS.get(c2.lower(), c2))
            if second.get("cfg") is not None and second.get("cfg") != first.get("cfg"):
                add("Hires CFG Scale", _fmt(second["cfg"]))
    elif denoise is not None and float(denoise) < 1:
        add("Denoising strength", _fmt(denoise))
    if after:
        # enlarged again afterwards: the way A1111's Extras tab writes an upscale
        _, factor, _ = seg(after)
        by = round(final[0] / hsize[0], 2) if final and hsize and hsize[0] else factor
        if by:
            add("Postprocess upscale by", _fmt(by if isinstance(by, float) else float(by)))
        add("Postprocess upscaler", seg(after)[0])
    for i, c in enumerate(detailers):
        # detailers, in the names of A1111's ADetailer extension (the 2nd, 3rd ... one with that word after each name)
        nth = "" if i == 0 else " " + ("2nd", "3rd")[i - 1] if i < 3 else f" {i + 1}th"
        dt = c["detailer"]
        add("ADetailer model" + nth, dt.get("model") or c.get("class"))
        for label, v in (("confidence", dt.get("confidence")), ("dilate erode", dt.get("dilate")), ("mask blur", dt.get("blur")),
                         ("denoising strength", c.get("denoise"))):
            if v is not None:
                add(f"ADetailer {label}" + nth, _fmt(v))
        if c.get("steps") is not None and c.get("steps") != first.get("steps"):
            add("ADetailer use separate steps" + nth, "True")
            add("ADetailer steps" + nth, _fmt(c["steps"]))
        if c.get("cfg") is not None and c.get("cfg") != first.get("cfg"):
            add("ADetailer use separate CFG scale" + nth, "True")
            add("ADetailer CFG scale" + nth, _fmt(c["cfg"]))
        ds = c.get("sampler")
        if isinstance(ds, str) and ds and ds != first.get("sampler"):
            add("ADetailer use separate sampler" + nth, "True")
            add("ADetailer sampler" + nth, SAMPLERS.get(ds.lower(), ds))
    if traced.get("clip_skip") and traced["clip_skip"] > 1:
        add("Clip skip", traced["clip_skip"])
    if path_of and loras:
        hs, seen = [], set()
        for name, _ in loras:
            s = _stem(name)
            if s.lower() in seen:
                continue
            seen.add(s.lower())
            h = file_hash(path_of("loras", name) or "")
            if h:
                hs.append(f"{s}: {h}")
        if hs:
            f.append('Lora hashes: "' + ", ".join(hs) + '"')
    add("Version", "ComfyUI")
    lines.append(", ".join(f))
    return "\n".join(lines), missing


# --------------------------------------------------------------------------- #
# into the files
# --------------------------------------------------------------------------- #
def user_comment(text):
    """EXIF UserComment as A1111 writes it for JPEG / WebP: 'UNICODE' + UTF-16 (big endian)."""
    return b"UNICODE\x00" + str(text).encode("utf-16-be", "surrogatepass")


def png_text_chunk(key, value):
    """One PNG text chunk as (kind, data): tEXt when the text is Latin-1, else iTXt (UTF-8), as Pillow does."""
    try:
        return b"tEXt", key.encode("latin-1") + b"\x00" + value.encode("latin-1")
    except UnicodeEncodeError:
        return b"iTXt", key.encode("latin-1", "replace") + b"\x00\x00\x00\x00\x00" + value.encode("utf-8")
