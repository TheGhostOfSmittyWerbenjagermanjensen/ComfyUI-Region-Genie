"""Model files set in Settings > Region Genie: a name ComfyUI knows (relative to one of its model folders) or a full
path the user browsed to anywhere on the ComfyUI machine (round 18: Stability Matrix and other setups keep models
outside ComfyUI/models).

full_path(folders, name)  the file on disk, or None: a full path as it is, else the first of `folders` that has it.
absolute_names()          while active, ComfyUI's folder_paths.get_full_path(_or_raise) also accept a full path to
                          an existing model file, so core loaders that take a name (LoraLoaderModelOnly,
                          ModelPatchLoader, LoadDA3Model) can load one. Names inside ComfyUI's folders behave as before.
/region_genie/browse      the folder browser behind the Settings 'Browse…' buttons: lists folders and model files.
"""
import contextlib
import logging
import os
import string
import threading

MODEL_EXTS = (".safetensors", ".sft", ".ckpt", ".pt", ".pt2", ".pth", ".bin", ".gguf")
LOG = "[Region Genie]"
_lock = threading.RLock()
_depth = 0
_orig = {}


def is_full_path(name):
    return isinstance(name, str) and bool(name) and os.path.isabs(name)


def split_folder(name):
    """(folder type, name) for a value picked in the Models menu from another folder than the setting's own
    ("controlnet:SDXL/x.safetensors"), else (None, name). A Windows full path ("C:\\...") is never split."""
    if isinstance(name, str) and ":" in name and not is_full_path(name):
        folder, rest = name.split(":", 1)
        if len(folder) > 1 and rest:
            try:
                import folder_paths
                if folder in folder_paths.folder_names_and_paths:
                    return folder, rest
            except Exception:
                pass
    return None, name


def _model_file(path):
    return os.path.isfile(path) and path.lower().endswith(MODEL_EXTS)


def full_path(folders, name):
    """The file for `name`: a full path (when it is an existing model file), else ComfyUI's lookup in `folders` (a
    folder type or a list of them, tried in order). None when not found."""
    if not name:
        return None
    if is_full_path(name):
        return name if _model_file(name) else None
    import folder_paths
    picked, name = split_folder(name)
    for f in ([picked] if picked else [folders] if isinstance(folders, str) else folders):
        try:
            p = folder_paths.get_full_path(f, name)
        except Exception:
            p = None
        if p:
            return p
    return None


def folder_of(folders, name):
    """The first of `folders` that has `name` (a full path: the first folder), or None."""
    if is_full_path(name):
        return ([folders] if isinstance(folders, str) else list(folders))[0] if _model_file(name) else None
    import folder_paths
    picked, name = split_folder(name)
    for f in ([picked] if picked else [folders] if isinstance(folders, str) else folders):
        try:
            if folder_paths.get_full_path(f, name):
                return f
        except Exception:
            pass
    return None


@contextlib.contextmanager
def absolute_names():
    """Let core loaders that take a file name load a full path (see the module docstring). Re-entrant; other names
    (and other threads' calls) get ComfyUI's own answer."""
    global _depth
    import folder_paths
    with _lock:
        if _depth == 0:
            _orig["get"] = folder_paths.get_full_path
            _orig["raise"] = getattr(folder_paths, "get_full_path_or_raise", None)

            def get_full_path(folder_name, filename):
                if is_full_path(filename) and _model_file(filename):
                    return filename
                return _orig["get"](folder_name, filename)

            folder_paths.get_full_path = get_full_path
            if _orig["raise"] is not None:
                def get_full_path_or_raise(folder_name, filename):
                    if is_full_path(filename) and _model_file(filename):
                        return filename
                    return _orig["raise"](folder_name, filename)
                folder_paths.get_full_path_or_raise = get_full_path_or_raise
        _depth += 1
    try:
        yield
    finally:
        with _lock:
            _depth -= 1
            if _depth == 0:
                folder_paths.get_full_path = _orig["get"]
                if _orig["raise"] is not None:
                    folder_paths.get_full_path_or_raise = _orig["raise"]


def _roots(folders):
    """Where the browser can start: the folders ComfyUI uses for these model types, then the drives (Windows) or /."""
    import folder_paths
    out, seen = [], set()
    for f in folders:
        try:
            paths = folder_paths.get_folder_paths(f)
        except Exception:
            paths = []
        for p in paths:
            p = os.path.normpath(p)
            if p not in seen and os.path.isdir(p):
                seen.add(p)
                out.append({"label": f"{f}: {p}", "path": p})
    if os.name == "nt":
        for d in string.ascii_uppercase:
            p = f"{d}:\\"
            if os.path.isdir(p):
                out.append({"label": p, "path": p})
    else:
        out.append({"label": "/", "path": "/"})
        home = os.path.expanduser("~")
        if os.path.isdir(home):
            out.append({"label": home, "path": home})
    return out


def relative_name(folders, path, with_folder=False):
    """The name ComfyUI knows `path` by in one of `folders` (so a file inside a model folder is saved as its usual
    name and stays portable), else None. with_folder: (folder type, name)."""
    import folder_paths
    path = os.path.normcase(os.path.normpath(path))
    for f in folders:
        try:
            roots = folder_paths.get_folder_paths(f)
        except Exception:
            roots = []
        for r in roots:
            r = os.path.normcase(os.path.normpath(r))
            if path.startswith(r + os.sep):
                rel = os.path.relpath(path, r)
                try:
                    if os.path.normcase(os.path.normpath(folder_paths.get_full_path(f, rel) or "")) == path:
                        return (f, rel) if with_folder else rel
                except Exception:
                    pass
    return (None, None) if with_folder else None


def browse(path, folders):
    """One folder's sub-folders and model files (hidden ones left out), or an error. `folders`: the model folder
    types of the setting (where it starts, and how a file in them is named)."""
    roots = _roots(folders)
    if not path:
        path = roots[0]["path"] if roots else (os.path.expanduser("~"))
    path = os.path.normpath(os.path.expanduser(path))
    out = {"path": path, "parent": None, "dirs": [], "files": [], "roots": roots, "sep": os.sep, "error": ""}
    if not os.path.isdir(path):
        out["error"] = "This folder doesn't exist (or can't be reached)."
        return out
    parent = os.path.dirname(path.rstrip("\\/")) if path.rstrip("\\/") else None
    out["parent"] = parent if parent and parent != path else None
    try:
        with os.scandir(path) as it:
            entries = list(it)
    except Exception as e:
        out["error"] = f"This folder can't be read ({e.__class__.__name__})."
        return out
    for e in entries:
        if e.name.startswith("."):
            continue
        try:
            if e.is_dir():
                out["dirs"].append(e.name)
            elif e.is_file() and e.name.lower().endswith(MODEL_EXTS):
                full = os.path.join(path, e.name)
                folder, rel = relative_name(folders, full, with_folder=True)
                out["files"].append({"name": e.name, "path": full, "rel": rel, "folder": folder, "size": e.stat().st_size})
        except OSError:
            pass
    out["dirs"].sort(key=str.lower)
    out["files"].sort(key=lambda x: x["name"].lower())
    return out


def _register_routes():
    try:
        from server import PromptServer
        from aiohttp import web
    except Exception:
        return
    if getattr(PromptServer, "instance", None) is None:
        return
    routes = PromptServer.instance.routes

    @routes.get("/region_genie/browse")
    async def _browse(request):
        q = request.rel_url.query
        folders = [f for f in (q.get("folders") or "loras").split(",") if f][:4]
        try:
            return web.json_response(browse(q.get("path", ""), folders))
        except Exception as e:
            logging.exception(f"{LOG} browse failed")
            return web.json_response({"error": str(e), "path": q.get("path", ""), "dirs": [], "files": [], "roots": []})

    @routes.get("/region_genie/model_exists")
    async def _exists(request):
        q = request.rel_url.query
        folders = [f for f in (q.get("folders") or "loras").split(",") if f][:4]
        return web.json_response({"found": full_path(folders, q.get("name", "")) is not None})


_register_routes()
