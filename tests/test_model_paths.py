"""Round 18: model files anywhere (model_paths.py): full paths, the scoped absolute-name support for core loaders,
the folder browser's listing, and a file inside a model folder saved by its usual name."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
from stubs import check, fails  # noqa: E402,F401

import folder_paths as fp  # noqa: E402  (the stub)
from rgpack import model_paths as mp  # noqa: E402

root = tempfile.mkdtemp(prefix="rg_models_")
loras = os.path.join(root, "models", "loras")
cn = os.path.join(root, "models", "controlnet")
outside = os.path.join(root, "elsewhere", "@author")
for d in (loras, os.path.join(loras, "sub"), cn, outside):
    os.makedirs(d, exist_ok=True)
for f in (os.path.join(loras, "a.safetensors"), os.path.join(loras, "sub", "b.safetensors"), os.path.join(cn, "lllite.safetensors"),
          os.path.join(outside, "edit.safetensors"), os.path.join(outside, "notes.txt"), os.path.join(outside, ".hidden.safetensors")):
    open(f, "wb").write(b"x" * 10)
os.makedirs(os.path.join(outside, "deeper"), exist_ok=True)
FOLDERS = {"loras": [loras], "controlnet": [cn], "model_patches": [os.path.join(root, "models", "model_patches")]}


def get_full_path(kind, name):
    for d in FOLDERS.get(kind, []):
        p = os.path.join(d, os.path.relpath(os.path.join("/", name), "/"))
        if os.path.isfile(p):
            return p
    return None


def get_full_path_or_raise(kind, name):
    p = get_full_path(kind, name)
    if p is None:
        raise FileNotFoundError(name)
    return p


fp.get_full_path = get_full_path
fp.get_full_path_or_raise = get_full_path_or_raise
fp.get_folder_paths = lambda kind: FOLDERS.get(kind, [])

full = os.path.join(outside, "edit.safetensors")
check("full_path: a name in the folder", mp.full_path("loras", "a.safetensors") == os.path.join(loras, "a.safetensors"))
check("full_path: a full path anywhere", mp.full_path("loras", full) == full)
check("full_path: a missing file or a non-model file is None",
      mp.full_path("loras", os.path.join(outside, "nope.safetensors")) is None and mp.full_path("loras", os.path.join(outside, "notes.txt")) is None)
check("full_path: Anima looks in model_patches, then controlnet",
      mp.full_path(("model_patches", "controlnet"), "lllite.safetensors") == os.path.join(cn, "lllite.safetensors"))
check("full_path: empty name", mp.full_path("loras", "") is None)

orig = fp.get_full_path
with mp.absolute_names():
    with mp.absolute_names():                      # re-entrant
        inside = fp.get_full_path_or_raise("loras", full) == full and fp.get_full_path("loras", "a.safetensors") == os.path.join(loras, "a.safetensors")
    still = fp.get_full_path("loras", full) == full
check("absolute_names: core lookups take a full path, names work as before, re-entrant", inside and still)
check("absolute_names: ComfyUI's own functions are back afterwards", fp.get_full_path is orig and fp.get_full_path("loras", full) is None)

b = mp.browse(outside, ["loras"])
check("browse: folders and model files only (no hidden, no .txt)",
      b["dirs"] == ["deeper"] and [f["name"] for f in b["files"]] == ["edit.safetensors"] and not b["error"])
check("browse: a file outside the model folders is saved by its full path", b["files"][0]["rel"] is None and b["files"][0]["path"] == full)
b2 = mp.browse(os.path.join(loras, "sub"), ["loras"])
check("browse: a file inside a model folder is saved by its usual name", b2["files"][0]["rel"] == os.path.join("sub", "b.safetensors"))
check("browse: starts in the setting's model folder; the roots list it", mp.browse("", ["loras"])["path"] == os.path.normpath(loras)
      and any(r["path"] == os.path.normpath(loras) for r in b["roots"]))
check("browse: a missing folder is an error, not an exception", mp.browse(os.path.join(root, "nope"), ["loras"])["error"] != "")
check("browse: the parent of a folder", b["parent"] == os.path.dirname(outside))

print("\nall passed" if not fails else f"\n{len(fails)} failed")
sys.exit(1 if fails else 0)
