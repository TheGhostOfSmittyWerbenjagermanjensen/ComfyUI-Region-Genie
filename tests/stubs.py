"""Stand-ins for torch / comfy / folder_paths, enough for Region Genie's Python logic (no GPU, no torch here)."""
import os
import sys
import tempfile
import types

import numpy as np


class T(np.ndarray):
    """numpy array with the few torch tensor methods the code under test calls."""
    def float(self): return self.astype(np.float32).view(T)
    def long(self): return self.astype(np.int64).view(T)
    def to(self, *a, **k):
        dt = k.get("dtype", a[0] if a and isinstance(a[0], type) else None)
        return self.astype(dt).view(T) if isinstance(dt, type) else self
    def clone(self): return self.copy().view(T)
    def cpu(self): return self
    def numpy(self): return np.asarray(self)
    def dim(self): return self.ndim
    def clamp(self, lo=None, hi=None, min=None, max=None):
        lo = lo if lo is not None else min
        hi = hi if hi is not None else max
        return np.clip(self, lo, hi).view(T)
    def max(self, dim=None, keepdim=False, **kw):
        if dim is None:
            return np.ndarray.max(self)
        v = np.ndarray.max(self, axis=dim, keepdims=keepdim).view(T)
        i = np.argmax(np.asarray(self), axis=dim).view(T)
        r = types.SimpleNamespace(values=v, indices=i)
        r.__iter__ = None
        return _Pair(v, i)
    def amax(self, dim=None): return np.ndarray.max(self, axis=dim).view(T)
    def movedim(self, a, b): return np.moveaxis(self, a, b).view(T)


class _Pair(tuple):
    def __new__(cls, v, i):
        o = super().__new__(cls, (v, i)); o.values, o.indices = v, i; return o


def _t(x): return np.asarray(x).view(T)


torch = types.ModuleType("torch")
torch.Tensor = np.ndarray
torch.float32, torch.float16, torch.bfloat16, torch.long, torch.uint8 = np.float32, np.float16, np.float32, np.int64, np.uint8
torch.full = lambda shape, v, dtype=None, **k: _t(np.full(shape, v, dtype=dtype))
torch.zeros = lambda shape, dtype=None, **k: _t(np.zeros(shape, dtype=dtype or np.float32))
torch.ones_like = lambda a, **k: _t(np.ones_like(a))
torch.zeros_like = lambda a, **k: _t(np.zeros_like(a))
torch.full_like = lambda a, v, **k: _t(np.full_like(a, v))
torch.where = lambda c, a, b: _t(np.where(c, a, b))
torch.stack = lambda xs, dim=0: _t(np.stack([np.asarray(x) for x in xs], axis=dim))
torch.from_numpy = lambda a: _t(a)
torch.arange = lambda n, dtype=None, **k: _t(np.arange(n, dtype=dtype))
torch.minimum = lambda a, b: _t(np.minimum(a, b))
torch.maximum = lambda a, b: _t(np.maximum(a, b))
nn = types.ModuleType("torch.nn"); F = types.ModuleType("torch.nn.functional")
nn.functional = F; torch.nn = nn
sys.modules["torch"], sys.modules["torch.nn"], sys.modules["torch.nn.functional"] = torch, nn, F

USER_DIR = tempfile.mkdtemp(prefix="rg_user_")
fp = types.ModuleType("folder_paths")
fp.get_user_directory = lambda: USER_DIR
fp.get_full_path = lambda kind, name: None
fp.get_filename_list = lambda kind: []
sys.modules["folder_paths"] = fp

comfy = types.ModuleType("comfy")
for sub in ("hooks", "lora", "lora_convert", "patcher_extension", "utils", "model_management"):
    m = types.ModuleType("comfy." + sub)
    setattr(comfy, sub, m)
    sys.modules["comfy." + sub] = m
comfy.cli_args = types.ModuleType("comfy.cli_args")
comfy.cli_args.args = types.SimpleNamespace(disable_metadata=False)
sys.modules["comfy.cli_args"] = comfy.cli_args
comfy.utils.common_upscale = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no upscale in tests"))
comfy.model_management.throw_exception_if_processing_interrupted = lambda: None
sys.modules["comfy"] = comfy

# the pack as a package, without its __init__ (that registers routes and needs the server)
PACK = os.environ.get("RG_PACK", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
pkg_dir = tempfile.mkdtemp(prefix="rgpkg_")
os.makedirs(os.path.join(pkg_dir, "rgpack"))
for f in os.listdir(PACK):
    if f.endswith(".py") and f != "__init__.py":
        os.symlink(os.path.join(PACK, f), os.path.join(pkg_dir, "rgpack", f))
open(os.path.join(pkg_dir, "rgpack", "__init__.py"), "w").close()
sys.path.insert(0, pkg_dir)

fails = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fails.append(name)
