"""
Trigger words of a LoRA, from the info files that model managers save next to it:
  <name>.cm-info.json   Stability Matrix ("TrainedWords")
  <name>.civitai.info   Civitai Helper ("trainedWords")
  <name>.metadata.json  ComfyUI LoRA Manager ("civitai": {"trainedWords"}, or "trainedWords")
  <name>.json           A1111 / Forge user metadata ("activation text")
and from the file's own safetensors metadata ("modelspec.trigger_phrase").
GET /region_genie/lora_triggers?name=<lora> -> {"words": [...], "word_sources": [...], "sources": [...]}
"""
import json
import logging
import os
import struct

import folder_paths


def _words(v):
    if isinstance(v, str):
        v = [v]
    if not isinstance(v, (list, tuple)):
        return []
    out = []
    for w in v:
        if isinstance(w, str) and w.strip():
            out.append(w.strip())
    return out


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return None


def _safetensors_meta(path):
    try:
        with open(path, "rb") as f:
            n = struct.unpack("<Q", f.read(8))[0]
            if n <= 0 or n > 100_000_000:
                return {}
            head = json.loads(f.read(n).decode("utf-8", "replace"))
        meta = head.get("__metadata__", {})
        return meta if isinstance(meta, dict) else {}
    except Exception:
        return {}


def lora_trigger_words(name):
    try:                                          # a full path set with Settings' Browse… works too
        from .model_paths import full_path
    except ImportError:                           # loaded on its own (tests)
        from model_paths import full_path
    path = full_path("loras", name)
    if not path:
        return [], [], []
    base = os.path.splitext(path)[0]
    words, word_sources, sources = [], [], []

    def add(ws, src):
        new = []
        for w in ws:
            if w.lower() not in {x.lower() for x in words + new}:
                new.append(w)
        if new:
            words.extend(new)
            word_sources.extend([src] * len(new))
            sources.append(src)

    d = _read_json(base + ".cm-info.json")
    if isinstance(d, dict):
        add(_words(d.get("TrainedWords") or d.get("trainedWords")), os.path.basename(base) + ".cm-info.json")
    d = _read_json(base + ".civitai.info")
    if isinstance(d, dict):
        add(_words(d.get("trainedWords")), os.path.basename(base) + ".civitai.info")
    d = _read_json(base + ".metadata.json")
    if isinstance(d, dict):
        civ = d.get("civitai") if isinstance(d.get("civitai"), dict) else {}
        add(_words(civ.get("trainedWords") or d.get("trainedWords")), os.path.basename(base) + ".metadata.json")
    d = _read_json(base + ".json")
    if isinstance(d, dict):
        act = d.get("activation text") or d.get("activation_text")
        if isinstance(act, str):
            add([w for w in (x.strip() for x in act.split(",")) if w], os.path.basename(base) + ".json")
    if path.lower().endswith(".safetensors"):
        tp = _safetensors_meta(path).get("modelspec.trigger_phrase")
        if isinstance(tp, str) and tp.strip():
            add([w for w in (x.strip() for x in tp.split(",")) if w], "the LoRA file's metadata")
    return words, word_sources, sources


def register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return

    @PromptServer.instance.routes.get("/region_genie/lora_triggers")
    async def _lora_triggers(request):
        name = request.rel_url.query.get("name", "")
        try:
            words, word_sources, sources = lora_trigger_words(name)
        except Exception as e:
            logging.warning(f"[Region Genie] trigger words of '{name}': {e}")
            words, word_sources, sources = [], [], []
        return web.json_response({"words": words, "word_sources": word_sources, "sources": sources})


register_routes()
