"""Wildcards in the prompt fields, through ComfyUI Impact Pack (its ImpactWildcardProcessor's own code).

Impact Pack puts its 'modules' folder on sys.path when ComfyUI loads it, so `impact.wildcards` is importable then;
without Impact Pack every function here leaves the text as it is.

Same syntax as Impact Pack: __name__ (a line from wildcards/name.txt, or a YAML key), {a|b|c}, {2$$a|b|c}, ...
"""
import json
import logging
import re
import zlib

LOG = "[Region Genie]"
SEED_MAX = 0xFFFFFFFFFFFFFFFF
_SYNTAX = re.compile(r"__[\w.\-+/*\\]+?__|\{[^{}]*\}")


def impact():
    """Impact Pack's wildcards module, or None when Impact Pack isn't installed (or failed to load)."""
    try:
        import impact.wildcards as w          # noqa: PLC0415 (only there when Impact Pack is loaded)
        return w if callable(getattr(w, "process", None)) else None
    except Exception:
        return None


def has_syntax(text):
    """True when the text has wildcard syntax and isn't JSON (a MOSS / Ideogram layout from the Region Genie node
    has braces that Impact's {a|b} syntax would take apart)."""
    if not isinstance(text, str) or not _SYNTAX.search(text):
        return False
    s = text.strip()
    if s[:1] in "{[":
        try:
            json.loads(s)
            return False
        except ValueError:
            pass
    return True


def field_seed(seed, key, per_field):
    """The seed for one field: the node's wildcard seed, or (Settings: a seed per field) one derived from it and the
    field's name, so the same wildcard in two fields can pick different values."""
    seed = int(seed or 0) & SEED_MAX
    if not per_field:
        return seed
    return (seed + zlib.crc32(str(key).encode("utf-8"))) & SEED_MAX


class Filler:
    """Fills the wildcards of several fields with one seed and remembers what each field became (for the UI)."""

    def __init__(self, seed, per_field=False, notes=None):
        self.mod = impact()
        self.seed = seed
        self.per_field = bool(per_field)
        self.notes = notes
        self.filled = {}                      # field key -> {"raw": text, "filled": text} (only fields with wildcards)
        self._warned = False

    def __call__(self, key, text):
        if not has_syntax(text):
            return text
        if self.mod is None:
            if not self._warned and self.notes is not None:
                self.notes.append("NOTE: the prompt has wildcard syntax (__name__ or {a|b}), but ComfyUI Impact Pack "
                                  "isn't installed: the text was used as it is")
            self._warned = True
            return text
        try:
            out = self.mod.process(text, field_seed(self.seed, key, self.per_field))
        except Exception as e:                # a broken wildcard file must not stop the run
            logging.warning(f"{LOG} wildcards in '{key}' could not be filled: {e}")
            return text
        out = out if isinstance(out, str) else text
        self.filled[str(key)] = {"raw": text, "filled": out}
        return out


def wildcard_names(refresh=False):
    """Every wildcard Impact Pack knows (also the ones not loaded yet in its on-demand mode), as '__name__'."""
    w = impact()
    if w is None:
        return None
    try:
        if refresh:
            w.wildcard_load()
        keys = set(getattr(w, "available_wildcards", {}) or {}) | set(getattr(w, "wildcard_dict", {}) or {})
        if not keys:
            keys = {n.strip("_") for n in w.get_wildcard_list()}
    except Exception as e:
        logging.warning(f"{LOG} could not list the wildcards: {e}")
        return []
    return sorted(f"__{k}__" for k in keys)


def _register_routes():
    try:
        from server import PromptServer
        from aiohttp import web
    except Exception:
        return
    if getattr(PromptServer, "instance", None) is None:
        return
    routes = PromptServer.instance.routes

    @routes.get("/region_genie/wildcards")
    async def _list(request):
        names = wildcard_names(refresh=request.rel_url.query.get("refresh") == "1")
        return web.json_response({"installed": names is not None, "names": names or []})

    @routes.post("/region_genie/wildcards/fill")
    async def _fill(request):
        """Preview: fill each field as the next run would (same seed rule), without running."""
        try:
            data = await request.json()
            fields = data.get("fields") or {}
            filler = Filler(data.get("seed", 0), data.get("perField", False))
            if filler.mod is None:
                return web.json_response({"installed": False, "filled": {}})
            for key, text in fields.items():
                filler(key, text)
            return web.json_response({"installed": True, "filled": filler.filled})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=400)


_register_routes()
