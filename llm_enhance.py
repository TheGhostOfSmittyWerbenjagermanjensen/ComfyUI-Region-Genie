"""LLM Prompt Enhancer for Region Genie.

Region prompts (and scene_prompt_positive) switched on with the sparkles button are rewritten by an LLM
before the layout is built, so the LLM never sees or touches the JSON.

The generation is ComfyUI's own "Generate Text" node (comfy_extras/nodes_textgen.py, TextGenerateV2), called
with the settings of the preset chosen for the region's type. The LLM is the connected clip (MOSS-Image: the
Qwen3.5 9B text encoder already in memory) or a text encoder file loaded like "Load CLIP". LLM-only LoRAs are
applied like "Load LoRA (Text Encoder)" (comfy.sd.load_lora_for_models with model None), to a copy of the
LLM: the clip used for conditioning is not changed.

Results are cached by (message, settings, LLM, seed): a prompt is only rewritten again when it or the settings
change. The cache is kept in memory for the session, and in the workflow (the node sends its saved results to
the server when a workflow is loaded). Keeping it on disk between restarts
(<user dir>/region_genie/llm_cache.json) is off by default: Settings > Region Genie > LLM cache, which also sets
how long entries are kept and how many. Turning disk caching off deletes the file.
"""
import hashlib
import json
import logging
import os
import re
import threading
import time

LOG = "[Region Genie]"
TYPES = ("character", "object", "text", "scene")

REGION_SYSTEM_PROMPT = (
    "You rewrite a short description of one element of a picture into a richer description for an image "
    "generator. Keep every subject, name, attribute, count and quoted text from the input exactly. Add concrete "
    "visual detail that fits (appearance, clothing, materials, colors, pose, expression, lighting), but do not "
    "add new people or objects, and do not describe the rest of the picture. Write one or two sentences. Reply "
    "with the description only: no preface, no quotes, no lists, no markdown.")
SCENE_SYSTEM_PROMPT = (
    "You rewrite a short description of a whole picture into a richer scene description for an image "
    "generator. Keep every subject, name, attribute and quoted text from the input exactly. Add concrete detail "
    "about setting, time of day, lighting, atmosphere, composition and style, without adding new main "
    "subjects. Write two or three sentences. Reply with the description only: no preface, no quotes, no lists, "
    "no markdown.")

DEFAULTS = {
    "llm": "",                 # "" = the connected clip, else a file in models/text_encoders
    "llm_type": "auto",        # CLIPLoader type for a file ("auto" = let ComfyUI detect it)
    "loras": [],               # [{"lora", "strength", "on"}] applied to the LLM only
    "system_prompt": REGION_SYSTEM_PROMPT,
    "max_length": 8192,
    "sampling": False,
    "temperature": 0.7, "top_k": 64, "top_p": 0.95, "min_p": 0.05,
    "repetition_penalty": 1.05, "presence_penalty": 0.0, "seed": 0,
    "thinking": True, "use_default_template": True, "mtp": "auto",
}
# used only while sampling is on (Generate Text hides them when its sampling mode is off)
SAMPLING_KEYS = ("temperature", "top_k", "top_p", "min_p", "repetition_penalty", "presence_penalty", "seed")
MTP_OPTIONS = ("auto", "off", "2", "3", "4", "5", "tree2s1", "tree2s2", "tree3s1", "tree4s1m8")


def _num(v, d, lo, hi, cast=float):
    try:
        v = cast(v)
    except (TypeError, ValueError):
        return d
    if v != v:  # NaN
        return d
    return min(hi, max(lo, v))


def norm_settings(s):
    """A preset's settings with every field present and in range (as the Generate Text inputs allow)."""
    s = s if isinstance(s, dict) else {}
    d = DEFAULTS
    loras = []
    for x in s.get("loras") or []:
        if isinstance(x, dict) and x.get("lora"):
            loras.append({"lora": str(x["lora"]), "strength": _num(x.get("strength", 1), 1.0, -100.0, 100.0),
                          "on": x.get("on", True) is not False})
    mtp = str(s.get("mtp", d["mtp"]))
    return {
        "llm": str(s.get("llm") or ""),
        "llm_type": str(s.get("llm_type") or "auto"),
        "loras": loras,
        "system_prompt": str(s.get("system_prompt") if s.get("system_prompt") is not None else d["system_prompt"]),
        "max_length": _num(s.get("max_length"), d["max_length"], 1, 32768, int),
        "sampling": bool(s.get("sampling", d["sampling"])),
        "temperature": _num(s.get("temperature"), d["temperature"], 0.01, 2.0),
        "top_k": _num(s.get("top_k"), d["top_k"], 0, 1000, int),
        "top_p": _num(s.get("top_p"), d["top_p"], 0.0, 1.0),
        "min_p": _num(s.get("min_p"), d["min_p"], 0.0, 1.0),
        "repetition_penalty": _num(s.get("repetition_penalty"), d["repetition_penalty"], 0.0, 5.0),
        "presence_penalty": _num(s.get("presence_penalty"), d["presence_penalty"], 0.0, 5.0),
        "seed": _num(s.get("seed"), 0, 0, 0xffffffffffffffff, int),
        "thinking": bool(s.get("thinking", d["thinking"])),
        "use_default_template": s.get("use_default_template", True) is not False,
        "mtp": mtp if mtp in MTP_OPTIONS else "auto",
    }


# --------------------------------------------------------------------------- #
# what the LLM is asked
# --------------------------------------------------------------------------- #
def build_message(kind, prompt, rtype, scene, others, with_context):
    """The user message: the prompt alone, or (context mode) the prompt with the scene and the other regions."""
    prompt = str(prompt or "").strip()
    if not with_context:
        return prompt
    lines = []
    if kind == "scene":
        if others:
            lines.append("For context, the picture contains these elements (do not rewrite them):")
            lines += [f"- {t}: {p}" for t, p in others if p]
            lines.append("")
        lines.append("Scene description to rewrite:")
        lines.append(prompt)
    else:
        ctx = []
        if scene:
            ctx.append(f"Whole scene: {scene}")
        if others:
            ctx.append("Other elements of the picture:")
            ctx += [f"- {t}: {p}" for t, p in others if p]
        if ctx:
            lines.append("For context only (do not rewrite or describe these):")
            lines += ctx
            lines.append("")
        lines.append(f"Element to rewrite ({rtype}):")
        lines.append(prompt)
    return "\n".join(lines)


def clean_output(text):
    """One line of plain text: no code fences, markdown emphasis, surrounding quotes or 'Output:' labels."""
    t = str(text or "").strip()
    t = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", t).strip()
    t = re.sub(r"^(?:output|description|rewritten(?: description)?|enhanced prompt|prompt)\s*:\s*", "", t, flags=re.I)
    t = t.replace("**", "").replace("__", "")
    t = re.sub(r"\s*\n+\s*", " ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    while len(t) >= 2 and t[0] == t[-1] and t[0] in "\"'`":
        t = t[1:-1].strip()
    if len(t) >= 2 and t[0] in "“‘" and t[-1] in "”’":
        t = t[1:-1].strip()
    return t


def readd_triggers(original, enhanced, trigger_words):
    """Trigger words that were in the typed prompt but that the LLM dropped are appended again."""
    from .regional_lora import _has_words, _append_words
    missing = [w for w in trigger_words if w and _has_words(original, w) and not _has_words(enhanced, w)]
    return (_append_words(enhanced, ", ".join(missing)) if missing else enhanced), missing


# --------------------------------------------------------------------------- #
# cache: in memory for the session; on disk between restarts only when Settings say so
# --------------------------------------------------------------------------- #
_cache = {}                     # key -> {"text", "thinking", "t": time stored}
_cache_lock = threading.Lock()
_cache_loaded = False
# Settings > Region Genie > LLM cache (sent by the front end at start-up, when changed, and with every run)
_cfg = {"disk": False, "days": 30, "max": 500}
_cfg_known = False              # True once the front end has said what the settings are


def norm_cache_cfg(c):
    c = c if isinstance(c, dict) else {}
    return {"disk": c.get("disk") is True,
            "days": _num(c.get("days"), 30, 0, 36500, int),          # 0 = no age limit
            "max": _num(c.get("max"), 500, 10, 100000, int)}


def _cache_path(folder="region_genie"):
    try:
        import folder_paths
        d = os.path.join(folder_paths.get_user_directory(), folder)
    except Exception:
        return None
    return os.path.join(d, "llm_cache.json")


OLD_CACHE_FOLDER = "regional_mask_kit"          # the pack's old name: read once if the new cache doesn't exist yet


def _prune():
    """Drop entries older than the day limit, then the oldest beyond the entry limit (call with the lock held)."""
    if _cfg["days"] > 0:
        cutoff = time.time() - _cfg["days"] * 86400
        for k in [k for k, v in _cache.items() if float(v.get("t") or 0) < cutoff]:
            _cache.pop(k, None)
    while len(_cache) > _cfg["max"]:
        _cache.pop(next(iter(_cache)))


def _delete_files():
    """Disk caching is off: remove the cache file (and the one kept under the pack's old name)."""
    for folder in ("region_genie", OLD_CACHE_FOLDER):
        p = _cache_path(folder)
        if p and os.path.isfile(p):
            try:
                os.remove(p)
                logging.info(f"{LOG} removed {p}: keeping LLM results on disk is off "
                             "(Settings > Region Genie > LLM cache)")
            except OSError as e:
                logging.warning(f"{LOG} could not remove {p}: {e}")


def configure(c):
    """Apply the LLM cache settings. Returns the settings in use."""
    global _cfg, _cfg_known, _cache_loaded
    new = norm_cache_cfg(c)
    with _cache_lock:
        turned_on = new["disk"] and not _cfg["disk"]
        _cfg, _cfg_known = new, True
        if not new["disk"]:
            _delete_files()
        elif turned_on:
            _cache_loaded = False                 # read what is on disk (if anything) next time
        _prune()
        if new["disk"] and _cache_loaded:
            _save_cache()
    return dict(_cfg)


def _cfg_from_settings_file():
    """No browser has told the server the settings yet (e.g. a workflow queued through the API right after start-up):
    read them from ComfyUI's saved settings of the default user, if there are any."""
    global _cfg
    try:
        import folder_paths
        p = os.path.join(folder_paths.get_user_directory(), "default", "comfy.settings.json")
        with open(p, "r", encoding="utf-8") as f:
            s = json.load(f)
        if isinstance(s, dict):
            _cfg = norm_cache_cfg({"disk": s.get("RegionGenie.LLM.CacheOnDisk", False),
                                   "days": s.get("RegionGenie.LLM.CacheDays", 30),
                                   "max": s.get("RegionGenie.LLM.CacheMaxEntries", 500)})
    except Exception:
        pass


def _load_cache():
    global _cache_loaded
    if _cache_loaded:
        return
    _cache_loaded = True
    if not _cfg_known:
        _cfg_from_settings_file()
    if not _cfg["disk"]:
        return
    p = _cache_path()
    if p and not os.path.isfile(p):
        p = _cache_path(OLD_CACHE_FOLDER)             # first run after the rename: start from the old cache
    if p and os.path.isfile(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict):
                now = time.time()
                for k, v in d.items():
                    if isinstance(v, dict) and isinstance(v.get("text"), str):
                        v = dict(v)
                        v.setdefault("t", now)            # entries saved before they had a date: from now on
                        _cache.setdefault(k, v)
            _prune()
        except Exception as e:
            logging.warning(f"{LOG} could not read the LLM cache: {e}")


def _save_cache():
    if not _cfg["disk"]:
        return
    p = _cache_path()
    if not p:
        return
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(dict(_cache), f, ensure_ascii=False)
        os.replace(tmp, p)
    except Exception as e:
        logging.warning(f"{LOG} could not save the LLM cache: {e}")


def cache_get(key):
    with _cache_lock:
        _load_cache()
        return _cache.get(key)


def cache_put(entries, save=True):
    with _cache_lock:
        _load_cache()
        changed = False
        now = time.time()
        for k, v in entries.items():
            if isinstance(k, str) and isinstance(v, dict) and isinstance(v.get("text"), str):
                old = _cache.get(k)
                if old is None or old.get("text") != v["text"] or old.get("thinking", "") != str(v.get("thinking") or ""):
                    _cache.pop(k, None)
                    _cache[k] = {"text": v["text"], "thinking": str(v.get("thinking") or ""), "t": now}
                    changed = True
        _prune()
        if changed and save:
            _save_cache()


def make_key(message, settings, llm_id, seed):
    """Sampling off: the sampling values (and the seed) are not used, so they don't change the key either."""
    used = {k: v for k, v in settings.items() if k != "seed" and (settings.get("sampling") or k not in SAMPLING_KEYS)}
    blob = json.dumps({"m": message, "s": used, "llm": llm_id,
                       "seed": seed if settings.get("sampling") else None}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# the LLM
# --------------------------------------------------------------------------- #
_llm_files = {}          # (path, type) -> CLIP
_lora_files = {}         # path -> (sd, metadata), last few
_patched = {}            # (id(base), loras) -> CLIP


def _clip_identity(clip):
    """Something stable that changes when a different text encoder (or upstream LoRA) is connected."""
    try:
        m = clip.cond_stage_model
        n = sum(int(p.numel()) for p in m.parameters())
        patches = len(clip.patcher.patches) if hasattr(clip.patcher, "patches") else 0
        return f"{type(m).__name__}:{n}:{patches}:{type(clip.tokenizer).__name__}"
    except Exception:
        return type(clip).__name__


def load_llm(settings, connected_clip):
    """(CLIP to generate with, identity string)."""
    import folder_paths
    if settings["llm"]:
        import comfy.sd
        path = folder_paths.get_full_path_or_raise("text_encoders", settings["llm"])
        t = settings["llm_type"]
        key = (path, t)
        base = _llm_files.get(key)
        if base is None:
            clip_type = comfy.sd.CLIPType.STABLE_DIFFUSION if t in ("", "auto") else \
                getattr(comfy.sd.CLIPType, t.upper(), comfy.sd.CLIPType.STABLE_DIFFUSION)
            logging.info(f"{LOG} loading LLM {settings['llm']} ({t})")
            base = comfy.sd.load_clip(ckpt_paths=[path], embedding_directory=folder_paths.get_folder_paths("embeddings"),
                                      clip_type=clip_type)
            _llm_files.clear()                       # keep one extra LLM loaded at a time
            _patched.clear()
            _llm_files[key] = base
        ident = f"file:{settings['llm']}:{t}"
    else:
        if connected_clip is None:
            raise ValueError("Region Genie: the LLM Prompt Enhancer uses the connected clip, but no clip is "
                             "connected. Connect the text encoder to 'clip', or choose an LLM file in LLM Settings.")
        base = connected_clip
        ident = "clip:" + _clip_identity(connected_clip)
    loras = tuple((x["lora"], round(x["strength"], 6)) for x in settings["loras"] if x["on"] and x["strength"] != 0)
    if not loras:
        return base, ident
    pkey = (id(base), loras)
    clip = _patched.get(pkey)
    if clip is None:
        import comfy.sd
        import comfy.utils
        clip = base
        for name, strength in loras:
            path = folder_paths.get_full_path_or_raise("loras", name)
            if path not in _lora_files:
                if len(_lora_files) >= 4:
                    _lora_files.pop(next(iter(_lora_files)))
                _lora_files[path] = comfy.utils.load_torch_file(path, safe_load=True, return_metadata=True)
            sd, meta = _lora_files[path]
            # as "Load LoRA (Text Encoder)": text encoder only, on a copy
            _, clip = comfy.sd.load_lora_for_models(None, clip, sd, 0, strength, lora_metadata=meta)
        if len(_patched) > 8:
            _patched.clear()
        _patched[pkey] = clip
    return clip, ident + "|" + "|".join(f"{n}@{s}" for n, s in loras)


def generate(clip, message, s, seed):
    """ComfyUI's Generate Text with these settings: (text, thinking). With sampling off only the sampling mode is
    passed, as Generate Text does (its sampling inputs are hidden then): greedy decoding, no seed."""
    sm = {"sampling_mode": "on" if s["sampling"] else "off"}
    if s["sampling"]:
        sm.update(temperature=s["temperature"], top_k=s["top_k"], top_p=s["top_p"], min_p=s["min_p"],
                  repetition_penalty=s["repetition_penalty"], presence_penalty=s["presence_penalty"], seed=seed)
    try:
        from comfy_extras.nodes_textgen import TextGenerateV2
    except Exception:
        TextGenerateV2 = None
    if TextGenerateV2 is not None:
        try:
            out = TextGenerateV2.execute(clip=clip, prompt=message, max_length=s["max_length"], sampling_mode=sm,
                                         thinking=s["thinking"], use_default_template=s["use_default_template"],
                                         mtp=s["mtp"], system_prompt=s["system_prompt"])
            return str(out[0] or ""), str(out[1] or "")
        except TypeError as e:                      # another ComfyUI version: same steps below
            logging.info(f"{LOG} Generate Text call differs in this ComfyUI ({e}); using the built-in steps")
    return _generate_steps(clip, message, s, sm)


def _generate_steps(clip, message, s, sm):
    """The steps of Generate Text (ComfyUI 0.44), for versions where its node can't be called directly."""
    mtp = {"off": False, "auto": True}.get(s["mtp"], s["mtp"])
    kw = dict(skip_template=not s["use_default_template"], min_length=1, thinking=s["thinking"],
              system_prompt=s["system_prompt"] if s["use_default_template"] else "")
    try:
        tokens = clip.tokenize(message, **kw)
    except TypeError:
        kw.pop("system_prompt", None)
        tokens = clip.tokenize(message, **kw)
    gen = dict(do_sample=sm["sampling_mode"] == "on", max_length=s["max_length"], temperature=sm.get("temperature", 1.0),
               top_k=sm.get("top_k", 50), top_p=sm.get("top_p", 1.0), min_p=sm.get("min_p", 0.0),
               repetition_penalty=sm.get("repetition_penalty", 1.0), presence_penalty=sm.get("presence_penalty", 0.0),
               seed=sm.get("seed"), mtp=mtp)
    try:
        ids = clip.generate(tokens, **gen)
    except TypeError:
        gen.pop("mtp", None)
        gen.pop("presence_penalty", None)
        ids = clip.generate(tokens, **gen)
    text = clip.decode(ids)
    reasoning, sep, rest = text.partition("</think>")
    if not sep:
        return text.strip(), ""
    return rest.strip(), reasoning.replace("<think>", "", 1).strip()


# --------------------------------------------------------------------------- #
# the node's part
# --------------------------------------------------------------------------- #
def _region_triggers(loras):
    from .lora_triggers import lora_trigger_words
    words = []
    for x in loras if isinstance(loras, list) else []:
        if isinstance(x, dict) and x.get("on", True) and x.get("lora"):
            try:
                words += lora_trigger_words(str(x["lora"]))[0]
            except Exception:
                pass
    return words


def apply(data, regions, table, scene, clip, notes):
    """Rewrite the switched-on prompts in table (in place) and the scene prompt.

    data: paint_data dict; regions: its region dicts; table: the node's region rows (with "rid").
    Returns (scene, ui dict or None)."""
    if isinstance(data.get("llmCache"), dict):
        configure(data["llmCache"])              # the LLM cache settings, as the front end sent them
    by_id = {r.get("id"): r for r in regions}
    jobs = []        # (kind, ref, prompt, rtype, loras, salt)
    for row in table:
        r = by_id.get(row.get("rid"))
        if r is not None and r.get("llm") and row.get("prompt"):
            jobs.append(("region", row, row["prompt"], row["type"], row.get("loras"), int(r.get("llmSalt") or 0)))
    if data.get("sceneLlm") and str(scene or "").strip():
        jobs.append(("scene", None, str(scene).strip(), "scene", data.get("sceneLoras"), int(data.get("sceneLlmSalt") or 0)))
    if not jobs:
        return scene, None

    llm = data.get("llm") if isinstance(data.get("llm"), dict) else {}
    cfg = llm.get("cfg") if isinstance(llm.get("cfg"), dict) else {}
    with_context = llm.get("ctx") == "context"
    others_all = [(id(row), row["type"], row["prompt"]) for row in table if row.get("prompt")]
    import comfy.model_management as mm
    try:
        import comfy.utils
        pbar = comfy.utils.ProgressBar(len(jobs))
    except Exception:
        pbar = None

    results = {"regions": {}, "scene": None}
    new_entries = {}
    for kind, row, prompt, rtype, loras, salt in jobs:
        entry = cfg.get(rtype) if isinstance(cfg.get(rtype), dict) else {}
        s = norm_settings(entry.get("s") if "s" in entry else {"system_prompt": SCENE_SYSTEM_PROMPT} if rtype == "scene" else {})
        others = [(t, p) for i, t, p in others_all if i != id(row)]
        message = build_message(kind, prompt, rtype, str(scene or "").strip(), others, with_context)
        seed = (s["seed"] + salt) % 0x10000000000000000
        mm.throw_exception_if_processing_interrupted()
        clip_llm, ident = load_llm(s, clip)
        key = make_key(message, s, ident, seed)
        hit = cache_get(key)
        cached = hit is not None
        if hit is None:
            text, thinking = generate(clip_llm, message, s, seed)
            hit = {"text": clean_output(text), "thinking": thinking}
            if hit["text"]:
                new_entries[key] = hit
        text = hit["text"]
        label = f"region '{prompt[:30]}'" if kind == "region" else "scene_prompt_positive"
        if not text:
            notes.append(f"NOTE: the LLM returned nothing for {label}; the typed prompt was used")
            if kind == "region":
                results["regions"][str(row["rid"])] = {"key": key, "failed": True, "prompt": prompt}
            else:
                results["scene"] = {"key": key, "failed": True, "prompt": prompt}
            if pbar is not None:
                pbar.update(1)
            continue
        text, missing = readd_triggers(prompt, text, _region_triggers(loras))
        if missing:
            notes.append(f"LLM: added back trigger word(s) {', '.join(missing)} to {label}")
        res = {"key": key, "text": text, "thinking": hit.get("thinking", ""), "prompt": prompt,
               "preset": entry.get("preset", ""), "cached": cached}
        if kind == "region":
            row["prompt_typed"] = prompt
            row["prompt"] = text
            results["regions"][str(row["rid"])] = res
        else:
            scene = text
            results["scene"] = res
        notes.append(f"LLM ({'cached' if cached else 'new'}, preset '{entry.get('preset', 'default')}'): {label}"
                     f" -> \"{text[:80]}{'...' if len(text) > 80 else ''}\"")
        if pbar is not None:
            pbar.update(1)
    if new_entries:
        cache_put(new_entries)
    return scene, results


def register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return

    @PromptServer.instance.routes.post("/region_genie/llm_cache")
    async def _llm_cache(request):
        """Results saved in a workflow, sent by the node when it is loaded (kept in memory for the session)."""
        try:
            body = await request.json()
            entries = body.get("entries") if isinstance(body, dict) else None
            if isinstance(entries, dict):
                cache_put({k: v for k, v in list(entries.items())[:500]}, save=False)
            return web.json_response({"ok": True})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=400)

    @PromptServer.instance.routes.post("/region_genie/llm_cache_config")
    async def _llm_cache_config(request):
        """Settings > Region Genie > LLM cache: {disk, days, max} (sent at start-up and when changed)."""
        try:
            body = await request.json()
            return web.json_response({"ok": True, "config": configure(body)})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=400)

    @PromptServer.instance.routes.get("/region_genie/llm_defaults")
    async def _llm_defaults(request):
        return web.json_response({"defaults": DEFAULTS, "region_system_prompt": REGION_SYSTEM_PROMPT,
                                  "scene_system_prompt": SCENE_SYSTEM_PROMPT, "mtp": list(MTP_OPTIONS)})


register_routes()
