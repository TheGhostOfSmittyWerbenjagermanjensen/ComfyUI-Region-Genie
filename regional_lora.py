"""
Region Genie: Create Hook LoRA (Quantized)

A drop-in alternative to "Create Hook LoRA" that works on quantized (int8, fp8,
...) diffusion models.

ComfyUI's own Hook LoRA bakes the LoRA into the model weights every time the
sampler switches between hooked and unhooked conditioning. That baking path
doesn't understand quantized layers (errors like
"'Linear' object has no attribute 'weight_scale'").

This node never touches the weights. While the model is evaluating the
conditioning the hook is attached to (ComfyUI evaluates each hook group in its
own model call), it adds each adapter's contribution to the targeted layers'
outputs:

    y = base_layer(x) + strength * h(x)

h(x) comes from ComfyUI's own "bypass" implementations
(comfy/weight_adapter/*.py), so the math matches ComfyUI:
  - LoRA / LoCon (linear and conv layers, incl. Tucker "mid" weights)
  - LoKr  (Kronecker product applied without building the full matrix)
  - LoHa  (builds one layer's full weight change at a time: slower)
  - DoRA on top of any of these (linear layers; one-time setup per layer)
Fused-qkv slices ("offsets") are handled here, since ComfyUI's bypass mode
skips them.
"""

import collections
import copy
import json
import math
import logging
import threading
import uuid

import torch

import comfy.hooks
import comfy.lora
import comfy.lora_convert
import comfy.patcher_extension
import comfy.utils
import folder_paths

try:
    from comfy.weight_adapter.base import WeightAdapterBase
    from comfy.weight_adapter.bypass import get_module_type_info
    _BYPASS_OK = True
except Exception:  # ComfyUI too old for bypass-capable adapters
    WeightAdapterBase = None
    get_module_type_info = None
    _BYPASS_OK = False

LOG = "[Region Genie] Hook LoRA:"
_HOOKED_ATTR = "_rg_runtime_lora_modules"     # module path -> (forward hook handle, module)
_SUPPORTED = ("lora", "loha", "lokr")
_DORA_CHUNK = 512  # identity rows per probe when reading a layer's weights for DoRA

# LoRAs active for the model call currently running on this thread.
_state = threading.local()


def _active():
    """Active LoRAs of the current model call: tuples (lora, strength, region or None)."""
    return getattr(_state, "active", ())


def _grid():
    """Token grid of the current model call: (h, w, (H, W, patch)) - h x w image tokens made from the H x W
    latent in patch x patch pieces (MOSS Image and Ideogram 4: one token per latent pixel)."""
    return getattr(_state, "grid", None)


def _arch():
    return getattr(_state, "arch", None)


# --------------------------------------------------------------------------- #
# models the one-pass engine knows: where the image and text tokens are in the joint sequence
# --------------------------------------------------------------------------- #
QWEN_IM_START, QWEN_USER, QWEN_NEWLINE = 151644, 872, 198


def _krea2_prefix(ids):
    """Tokens the Krea 2 text encoder cuts off the front of the prompt (its system prompt and the user turn's
    opening), as comfy/text_encoders/krea2.py does it."""
    end, seen = -1, 0
    for i, v in enumerate(ids):
        if v == QWEN_IM_START and seen < 2:
            end, seen = i, seen + 1
    if len(ids) > end + 3 and end >= 0 and ids[end + 1] == QWEN_USER and ids[end + 2] == QWEN_NEWLINE:
        end += 3
    return max(0, end)


class ModelArch:
    """Token layout of a model the one-pass engine supports.

    Joint-attention models (MOSS Image, Krea 2, Ideogram 4, Flux, Flux 3) run image and text tokens as one
    sequence; cross-attention models (Anima, SDXL / SD1.5) keep the text apart and the image tokens read it in
    a separate cross-attention step.

    patch:      latent pixels per image token side (image tokens = ceil(H/patch) x ceil(W/patch), row-major)
    order:      joint sequence order: "img_txt" [image, text, references] (MOSS Image), "txt_img" [text, image,
                references] (Krea 2, Ideogram 4, Flux), "img_ref_txt" [image, references, text] (Flux 3)
    prefix:     tokens of the tokenized prompt the text encoder drops from the front (ids -> count)
    skip_lens:  sequence lengths that are not tokens (Krea 2's text fusion attends across its 12 encoder layers)
    token_key:  which tokenizer's tokens line up with the model's text tokens (Flux.1, Anima: T5)
    text_pad:   the model pads its text to at least this many tokens (Anima: 512)
    cross:      text reaches the image through cross-attention (no text queries in the model)
    multires:   image tokens at several resolutions (UNet: latent size / 1, 2, 4, 8)
    text_from:  where the text length comes from: "c_crossattn", or "txt_states" (Flux 3 encodes its text once,
                before sampling)
    family:     the name used for the per-model settings (keep all regions apart automatically)"""

    def __init__(self, name, patch=1, order="img_txt", prefix=None, skip_lens=(), token_key=None, text_pad=0,
                 cross=False, multires=False, text_from="c_crossattn", family=None, layout=False):
        self.name = name
        self.patch = int(patch)
        self.order = order
        self.prefix = prefix
        self.skip_lens = tuple(skip_lens)
        self.token_key = token_key
        self.text_pad = int(text_pad)
        self.cross = bool(cross)
        self.multires = bool(multires)
        self.text_from = text_from
        self.family = family or name
        self.layout = bool(layout)             # has a layout prompt format of its own (MOSS Image, Ideogram 4)

    @property
    def text_first(self):
        return self.order == "txt_img"

    def grid(self, H, W):
        p = self.patch
        return (-(-H // p), -(-W // p), (H, W, p))


ONE_PASS_MODELS = "MOSS Image, Krea 2, Ideogram 4, Flux, Anima or SDXL / SD1.5"
# models without a layout format of their own: their regions are placed by keeping the regions apart in attention
AUTO_APART_FAMILIES = ("Krea 2", "Flux", "Flux 3", "Anima", "SDXL / SD1.5")


def model_arch(model):
    """ModelArch of a MODEL (ModelPatcher), or None when the one-pass engine doesn't know it."""
    dm = getattr(getattr(model, "model", None), "diffusion_model", None)
    if dm is None:
        return None
    cls, mod = type(dm).__name__, type(dm).__module__ or ""
    if cls == "MOSSImage" and hasattr(dm, "video_embedder"):
        return ModelArch("MOSS Image", layout=True)
    if cls == "SingleStreamDiT" and "krea2" in mod:
        return ModelArch("Krea 2", patch=getattr(dm, "patch", 2), order="txt_img", prefix=_krea2_prefix,
                         skip_lens=(int(getattr(dm, "txtlayers", 12)),))
    if cls == "Ideogram4Transformer2DModel":
        # its latent is already in 2x2 patches (128 channels): one token per latent pixel
        return ModelArch("Ideogram 4", order="txt_img", layout=True)
    if cls == "Flux" and mod.startswith("comfy.ldm.flux."):
        # Flux.1 (16-channel latent in 2x2 patches, T5 text) and Flux.2 / Klein (128-channel latent, LLM text)
        p = int(getattr(dm, "patch_size", 2) or 1)
        return ModelArch("Flux.2" if p == 1 else "Flux.1", patch=p, order="txt_img", token_key="t5xxl",
                         family="Flux")
    if cls == "Flux3" and "flux3" in mod:
        return ModelArch("Flux 3", order="img_ref_txt", text_from="txt_states")
    if cls == "Anima" and "anima" in mod:
        ps = getattr(dm, "patch_spatial", 2)
        ps = ps[0] if isinstance(ps, (tuple, list)) else ps
        return ModelArch("Anima", patch=ps, token_key="t5xxl", text_pad=512, cross=True)
    if cls == "UNetModel" and "openaimodel" in mod:
        sdxl = getattr(dm, "adm_in_channels", None) or getattr(dm, "num_classes", None) == "sequential"
        return ModelArch("SDXL" if sdxl else "SD1.5", token_key="l", cross=True, multires=True, family="SDXL / SD1.5")
    return None


class Layout:
    """Where the image and text tokens are in a sequence of L tokens: h x w image tokens (made from the latent as
    src = (H, W, patch)) starting at img0, text_len text tokens starting at txt0 (None: not in it)."""
    __slots__ = ("h", "w", "src", "img0", "txt0")

    def __init__(self, h, w, src, img0, txt0):
        self.h, self.w, self.src, self.img0, self.txt0 = h, w, src, img0, txt0

    @property
    def n(self):
        return self.h * self.w


def _levels(grid, arch):
    """(h, w, src) of every token grid the model uses: one, or the UNet's resolutions (1/1, 1/2, 1/4, 1/8)."""
    h, w, src = grid
    if arch is None or not arch.multires:
        return [(h, w, src)]
    H, W, p = src
    out = []
    for k in range(4):
        f = p * (2 ** k)
        out.append((-(-H // f), -(-W // f), (H, W, f)))
    return out


def _layout(L, grid, text_len, arch):
    """How a sequence of L tokens is laid out (a Layout), or None when it isn't one of the model's sequences."""
    T = text_len or 0
    skip = arch.skip_lens if arch is not None else ()
    if arch is not None and arch.cross:
        if T and L == T:
            return Layout(0, 0, None, None, 0)                       # text tokens (cross-attention keys/values)
        for hh, ww, src in _levels(grid, arch):
            if L == hh * ww:
                return Layout(hh, ww, src, 0, None)
        return None
    h, w, src = grid
    n = h * w
    if L >= n + T and (T or L == n or L > n):
        if T and arch is not None and arch.order == "txt_img":
            return Layout(h, w, src, T, 0)                           # text, image, references
        if T and arch is not None and arch.order == "img_ref_txt":
            return Layout(h, w, src, 0, L - T)                       # image, references, text
        return Layout(h, w, src, 0, n if T else None)                # image, text, references
    if L == n:
        return Layout(h, w, src, 0, None)                            # image only
    if T and L == T and L not in skip:
        return Layout(0, 0, None, None, 0)                           # text only (text embedders / refiners)
    return None


class TokenRegion:
    """A region mask turned into per-token LoRA weights inside the model.

    The one-pass models run image and text tokens as one sequence (see ModelArch: MOSS Image puts the image
    tokens first, Krea 2 and Ideogram 4 the text tokens; reference tokens come last). A regional LoRA's change
    is multiplied by the mask at each image token and switched off for text/reference tokens and in the text-only layers, so the LoRA only acts on its region, within
    one model pass. Overlapping regions get both LoRAs.

    text_spans: token ranges [(start, end)] of this region's caption in the prompt (e.g. a trigger word in the
    region's caption), valid only when the prompt has text_len tokens: there the LoRA acts on the text too."""

    def __init__(self, mask_hw, text_spans=None, text_len=None):
        self.mask = mask_hw.float().cpu()               # (H, W), 0..1
        self.text_spans = list(text_spans or [])
        self.text_len = text_len
        self._cache = {}

    def coverage(self):
        return float(self.mask.mean())

    def grid_mask(self, h, w, src=None):
        """The mask on the h x w token grid (flattened). src = (H, W, patch): tokens are patch x patch pieces of
        an H x W latent; when H or W isn't a multiple of patch the model pads the latent at the bottom/right
        (circular), so the mask is padded the same way before it is pooled."""
        m = self.mask[None, None]
        if src is not None and src[2] > 1 and (h * src[2], w * src[2]) != (src[0], src[1]):
            H, W, p = src
            m = _resize(m, H, W)
            m = torch.nn.functional.pad(m, (0, w * p - W, 0, h * p - H), mode="circular")
            return torch.nn.functional.avg_pool2d(m, p).reshape(-1).clamp(0, 1)
        return _resize(m, h, w).reshape(-1).clamp(0, 1)

    def weights(self, L, grid, device, dtype, text_len=None, arch=None):
        """(1, L, 1) weights for a sequence of L tokens, or None when this LoRA doesn't act on it."""
        spans = self.text_spans if (self.text_spans and text_len is not None and text_len == self.text_len) else ()
        lay = _layout(L, grid, text_len, arch)
        if lay is None or (lay.img0 is None and not spans):
            return None
        key = ("w", L, lay.h, lay.w, lay.src, str(device), dtype, text_len, lay.img0, lay.txt0)
        t = self._cache.get(key)
        if t is None:
            t = torch.zeros(L, dtype=torch.float32)
            if lay.img0 is not None:
                t[lay.img0:lay.img0 + lay.n] = self.grid_mask(lay.h, lay.w, lay.src)
            if lay.txt0 is not None:
                for a, b in spans:
                    a, b = max(0, int(a)), min(int(b), L - lay.txt0)
                    if b > a:
                        t[lay.txt0 + a:lay.txt0 + b] = 1.0
            t = t.to(device=device, dtype=dtype).reshape(1, L, 1)
            self._remember(key, t)
        return t

    def spatial(self, hh, ww, grid, device, dtype, arch=None):
        """(1, 1, hh, ww) weights for a conv layer's output (channels first), or None when (hh, ww) isn't one of
        the model's token grids."""
        for h, w, src in _levels(grid, arch):
            if (h, w) == (hh, ww):
                key = ("s", h, w, src, str(device), dtype)
                t = self._cache.get(key)
                if t is None:
                    t = self.grid_mask(h, w, src).to(device=device, dtype=dtype).reshape(1, 1, h, w)
                    self._remember(key, t)
                return t
        return None

    def _remember(self, key, t):
        if len(self._cache) > 32:
            self._cache.clear()
        self._cache[key] = t


def _resize(m, h, w):
    mode = "area" if m.shape[-2] >= h and m.shape[-1] >= w else "bilinear"
    kw = {} if mode == "area" else {"align_corners": False}
    return torch.nn.functional.interpolate(m, size=(h, w), mode=mode, **kw)


def _log(msg, level=logging.INFO):
    logging.log(level, msg)  # ComfyUI shows INFO and above in its console


# --------------------------------------------------------------------------- #
# one adapter on one layer
# --------------------------------------------------------------------------- #
class _Patch:
    def __init__(self, module_name, module, adapter, offset):
        self.module_name = module_name
        self.adapter = adapter            # CPU original, never mutated
        self.kind = adapter.name
        self.offset = offset              # None or (dim, start, length), linear only
        self.info = get_module_type_info(module)
        self.dora_scale = self._dora_scale(adapter)
        self.broken = False
        self._adapters = {}               # (device, dtype) -> prepared copy
        self._dora = {}                   # device -> dict(axis, s, bias)

    @staticmethod
    def _dora_scale(adapter):
        w = adapter.weights
        idx = {"lora": 4, "loha": 7, "lokr": 8}[adapter.name]
        return w[idx] if len(w) > idx else None

    def prepared(self, device, dtype):
        key = (device, dtype)
        a = self._adapters.get(key)
        if a is None:
            a = copy.copy(self.adapter)
            a.weights = tuple(
                w.to(device=device, dtype=dtype) if isinstance(w, torch.Tensor) else w
                for w in self.adapter.weights
            )
            info = self.info
            a.multiplier = 1.0
            a.is_conv = info["is_conv"]
            a.conv_dim = info["conv_dim"]
            a.kernel_size = info["kernel_size"]
            a.in_channels = info["in_channels"]
            a.out_channels = info["out_channels"]
            a.kw_dict = ({"stride": info["stride"], "padding": info["padding"],
                          "dilation": info["dilation"], "groups": info["groups"]}
                         if info["is_conv"] else {})
            self._adapters[key] = a
        return a

    # ---- slices of fused layers ------------------------------------------- #
    def slice_in(self, x):
        if self.offset is not None and self.offset[0] == 1:
            return x.narrow(-1, self.offset[1], self.offset[2])
        return x

    def slice_out(self, y):
        if self.offset is not None and self.offset[0] == 0:
            return y.narrow(-1, self.offset[1], self.offset[2])
        return y

    def delta(self, x, base_out):
        """Adapter contribution h(x) at strength 1, shaped like this patch's output slice."""
        a = self.prepared(x.device, x.dtype)
        return a.h(self.slice_in(x), base_out)

    # ---- DoRA --------------------------------------------------------------- #
    def prepare_dora(self, module, device, dtype):
        """One-time: read this layer's (dequantized) weights through its own forward and
        compute DoRA's per-channel factors, exactly like comfy's weight_decompose()."""
        if device in self._dora:
            return
        in_full = self.info["in_channels"] or getattr(module, "in_features", None)
        if in_full is None:
            raise ValueError("unknown input size")
        in_lo, in_len = 0, in_full   # DoRA is never used with input slices (skipped at load)

        with torch.no_grad():
            zero = torch.zeros((1, 1, in_full), device=device, dtype=dtype)
            bias_full = module.forward(zero)[0, 0].float()       # bias (or zeros)
            bias = self.slice_out(bias_full)
            out_len = bias.shape[-1]
            ds = self.dora_scale.to(device=device, dtype=torch.float32)
            axis_out = ds.shape[0] == out_len          # same rule as comfy's weight_decompose()

            row_sq = torch.zeros(out_len, device=device, dtype=torch.float32)
            col_norm = torch.zeros(in_len, device=device, dtype=torch.float32)
            a = self.prepared(device, dtype)
            for j0 in range(0, in_len, _DORA_CHUNK):
                n = min(_DORA_CHUNK, in_len - j0)
                eye = torch.zeros((1, n, in_full), device=device, dtype=dtype)
                idx = torch.arange(n, device=device)
                eye[0, idx, in_lo + j0 + idx] = 1
                w_t = self.slice_out(module.forward(eye)[0].float() - bias_full)   # (n, out) = W[:, cols]^T
                if axis_out:
                    row_sq += (w_t * w_t).sum(dim=0)
                else:
                    d_t = a.h(self.slice_in(eye), None)[0].float()                # (n, out) = dW[:, cols]^T
                    col_norm[j0:j0 + n] = (w_t + d_t).norm(dim=1)
            eps = torch.finfo(torch.float32).eps
            if axis_out:
                s = ds.flatten() / (row_sq.sqrt() + eps)          # per output channel
            else:
                s = ds.flatten() / (col_norm + eps)               # per input channel
        self._dora[device] = {"axis_out": axis_out, "s": s, "bias": bias}

    def dora_output(self, module, x, out_slice, strength):
        """New value for this patch's output slice with DoRA applied."""
        d = self._dora[x.device]
        b = d["bias"].to(out_slice.dtype)
        yw = out_slice - b                                            # W x (this slice)
        if d["axis_out"]:
            s = d["s"].to(out_slice.dtype)
            calc = s * (yw + self.delta(x, out_slice).to(out_slice.dtype))
        else:
            c = d["s"].to(x.dtype)
            xc = x * c
            base_c = self.slice_out(module.forward(xc)).to(out_slice.dtype) - b   # W (c*x)
            calc = base_c + self.delta(xc, out_slice).to(out_slice.dtype)
        return out_slice + strength * (calc - yw)


# --------------------------------------------------------------------------- #
# LoRA container
# --------------------------------------------------------------------------- #
class RuntimeLoRA:
    def __init__(self, name):
        self.id = uuid.uuid4().hex[:8]
        self.name = name
        self.modules = {}         # module path (relative to BaseModel) -> [_Patch]
        self.summary = ""
        self.has_dora = False
        self._last_run = None

    def prepare(self, base_model, device):
        if not self.has_dora:
            return
        todo = [(n, p) for n, ps in self.modules.items() for p in ps
                if p.dora_scale is not None and not p.broken and device not in p._dora]
        if not todo:
            return
        dtype = base_model.get_dtype_inference() if hasattr(base_model, "get_dtype_inference") else None
        if dtype not in (torch.float16, torch.bfloat16, torch.float32):
            dtype = torch.bfloat16
        _log(f"{LOG} '{self.name}': one-time DoRA setup for {len(todo)} layer(s)...")
        for name, p in todo:
            try:
                p.prepare_dora(base_model.get_submodule(name), device, dtype)
            except Exception as e:
                p.broken = True
                _log(f"{LOG} '{self.name}': DoRA setup failed on {name}, skipping that layer: {e}",
                     logging.WARNING)


def _expected_linear_shape(adapter):
    """(out, in) of the weight change for linear layers, or None if unknown."""
    w = adapter.weights
    try:
        if adapter.name == "lora":
            if w[3] is not None:          # Tucker mid: conv-style
                return None
            return int(w[0].shape[0]), int(w[1].shape[1])
        if adapter.name == "loha":
            if w[5] is not None:
                return None
            return int(w[0].shape[0]), int(w[1].shape[1])
        if adapter.name == "lokr":
            w1 = w[0] if w[0] is not None else None
            w1_shape = tuple(w1.shape) if w1 is not None else (w[3].shape[0], w[4].shape[1])
            if w[1] is not None:
                if w[1].dim() != 2:
                    return None
                w2_shape = tuple(w[1].shape)
            else:
                if w[7] is not None:
                    return None
                w2_shape = (w[5].shape[0], w[6].shape[1])
            return int(w1_shape[0] * w2_shape[0]), int(w1_shape[1] * w2_shape[1])
    except Exception:
        return None
    return None


def _layer_dims(module, info):
    if info["is_conv"]:
        return info["in_channels"], info["out_channels"]
    in_f = getattr(module, "in_features", None)
    out_f = getattr(module, "out_features", None)
    if in_f is None or out_f is None:
        shape = getattr(getattr(module, "weight", None), "shape", None)
        if shape is not None and len(shape) == 2:
            out_f, in_f = int(shape[0]), int(shape[1])
    return in_f, out_f


def build_runtime_lora(model_patcher, lora_sd, name):
    base_model = model_patcher.model
    key_map = comfy.lora.model_lora_keys_unet(base_model, {})
    lora_sd = comfy.lora_convert.convert_lora(lora_sd)
    patches = comfy.lora.load_lora(lora_sd, key_map, log_missing=False)

    rl = RuntimeLoRA(name)
    skipped, kinds = {}, {}
    loha_elems = 0

    def skip(reason):
        skipped[reason] = skipped.get(reason, 0) + 1

    for k, adapter in patches.items():
        if isinstance(k, str):
            weight_key, offset = k, None
        elif isinstance(k, tuple) and len(k) == 2:
            weight_key, offset = k
        else:
            skip("custom patch function")
            continue
        if not weight_key.endswith(".weight"):
            skip("bias/norm patch")
            continue
        if WeightAdapterBase is None or not isinstance(adapter, WeightAdapterBase):
            skip("full-weight 'diff' patch" if isinstance(adapter, tuple) else "unknown patch")
            continue
        if adapter.name not in _SUPPORTED:
            skip(f"{adapter.name.upper()} (not supported)")
            continue
        if adapter.name == "lora" and len(adapter.weights) > 5 and adapter.weights[5] is not None:
            skip("LoRA with reshape_weight")
            continue

        module_name = weight_key[: -len(".weight")]
        try:
            module = base_model.get_submodule(module_name)
        except AttributeError:
            skip("layer not found in model")
            continue
        info = get_module_type_info(module)
        in_f, out_f = _layer_dims(module, info)
        if in_f is None:
            skip("not a linear/conv layer")
            continue

        if offset is not None:
            if info["is_conv"]:
                skip("sliced conv layer")
                continue
            if not isinstance(offset, (tuple, list)) or len(offset) != 3 or offset[0] not in (0, 1):
                skip("unsupported slice")
                continue
            if offset[0] == 0:
                out_f = offset[2]
            else:
                in_f = offset[2]
            offset = tuple(offset)

        dora = _Patch._dora_scale(adapter) is not None
        if dora and info["is_conv"]:
            skip("DoRA on conv layer")
            continue
        if dora and offset is not None and offset[0] == 1:
            skip("DoRA on input-sliced layer")
            continue

        if not info["is_conv"]:
            shape = _expected_linear_shape(adapter)
            if shape is not None and shape != (out_f, in_f):
                skip("shape mismatch")
                continue

        rl.modules.setdefault(module_name, []).append(_Patch(module_name, module, adapter, offset))
        label = adapter.name.upper() if adapter.name != "lora" else "LoRA"
        label = {"LOHA": "LoHa", "LOKR": "LoKr"}.get(label, label)
        if info["is_conv"]:
            label += " (conv)"
        if dora:
            label += " + DoRA"
            rl.has_dora = True
        kinds[label] = kinds.get(label, 0) + 1
        if adapter.name == "loha":
            loha_elems = max(loha_elems, int(out_f) * int(in_f) * (
                1 if not info["is_conv"] else max(1, int(torch.tensor(info["kernel_size"]).prod()))))

    patched = sum(kinds.values())
    lines = [f"'{name}': {patched} patch(es) on {len(rl.modules)} layer(s)"]
    if kinds:
        lines.append("applied: " + ", ".join(f"{n} {k}" for k, n in sorted(kinds.items())))
    if skipped:
        lines.append("skipped: " + ", ".join(f"{n} {r}" for r, n in sorted(skipped.items())))
    if patched == 0:
        lines.append("WARNING: matched no layers of this model; is it a LoRA for a different model?")
    rl.summary = "\n".join(lines)
    _log(f"{LOG} " + " | ".join(lines))

    if loha_elems:
        mb = loha_elems * 2 / 2 ** 20
        _log(f"{LOG} '{name}' is a LoHa. LoHa can't be applied piece by piece, so each patched layer "
             f"rebuilds its full-size weight change on every step: expect slower sampling (about one "
             f"extra full layer computation per patched layer) and up to ~{mb:.0f} MB of extra "
             f"temporary VRAM for the largest layer.", logging.WARNING)
    if rl.has_dora:
        _log(f"{LOG} '{name}' uses DoRA: one-time setup on first use, then about one extra layer "
             f"computation per DoRA layer for input-channel DoRA.")
    return rl


# --------------------------------------------------------------------------- #
# forward hook + wrapper
# --------------------------------------------------------------------------- #
def _sigma_progress(topts):
    """0 at the first sampling step .. 1 at the last (None if unknown)."""
    try:
        s, ss = topts.get("sigmas"), topts.get("sample_sigmas")
        if s is None or ss is None:
            return None
        s = float(s.flatten()[0])
        ss = ss.flatten().float().cpu()
        return int(torch.argmin((ss - s).abs())) / max(1, len(ss) - 1)
    except Exception:
        return None


class RegionSeparation:
    """Regional attention for the one-pass models: image tokens of different regions see each other less (or not at
    all) in self-attention, so a region's LoRA style can't leak into its neighbours through attention.
    strength 0..1 = how much of the cross-region attention is removed (1 = blocked); `until` = up to which
    fraction of the steps it applies. Text tokens stay shared, so the layout prompt still ties it together.
    share_bg: the background (image tokens outside every region) stays shared: regions are kept apart from each
    other but not from the background, so lighting and setting stay one picture. Captions still reach only their
    own region."""

    def __init__(self, regions, strength, until, share_bg=False):
        self.regions = list(regions)
        self.strength = float(strength)
        self.until = float(until)
        self.share_bg = bool(share_bg)
        self._labels, self._bias = {}, {}

    def bias_value(self):
        return -1.0e4 if self.strength >= 0.9999 else float(math.log(1.0 - self.strength))

    def labels(self, h, w, src=None):
        key = (h, w, src)
        lab = self._labels.get(key)
        if lab is None:
            M = torch.stack([r.grid_mask(h, w, src) for r in self.regions])     # (R, h*w)
            mx, am = M.max(dim=0)
            lab = torch.where(mx >= 0.5, am + 1, torch.zeros_like(am))         # 0 = outside every region
            self._labels[key] = lab
        return lab

    def _text_labels(self, text_len):
        """Per text token: region label (1..R) for the captions of LoRA regions, -1 for shared text."""
        if text_len is None:
            return None
        lab = torch.full((text_len,), -1, dtype=torch.long)
        any_span = False
        for i, r in enumerate(self.regions):
            if r.text_spans and r.text_len == text_len:
                for a, b in r.text_spans:
                    a, b = max(0, int(a)), min(int(b), text_len)
                    if b > a:
                        lab[a:b] = i + 1
                        any_span = True
        return lab if any_span else None

    def has_captions(self):
        return any(r.text_spans for r in self.regions)

    def bias(self, nq, nk, grid, device, dtype, text_len=None, early=True, arch=None):
        """Additive attention bias. Image tokens of different regions are kept apart while `early`; a LoRA
        region's caption tokens are kept apart from the image and captions of the other regions at every step
        (shared text - scene caption, template, captions of regions without LoRAs - stays open to all).
        Cross-attention models: image tokens of a region don't read the other regions' captions."""
        txt = self._text_labels(text_len)
        key = (nq, nk, grid, str(device), dtype, text_len, txt is not None, early, arch.name if arch else None)
        if key in self._bias:
            return self._bias[key]
        pen = None
        if arch is not None and arch.cross:
            lq = _layout(nq, grid, text_len, arch)
            if lq is not None and lq.img0 is not None:
                labq = self.labels(lq.h, lq.w, lq.src)
                if nk == nq:                                              # self-attention between image tokens
                    if early:
                        pen = labq[:, None] != labq[None, :]
                        if self.share_bg:                                 # the background stays shared
                            pen = pen & (labq[:, None] != 0) & (labq[None, :] != 0)
                elif txt is not None and nk == text_len:                  # image reads the text
                    pen = (txt[None, :] >= 0) & (txt[None, :] != labq[:, None])
        else:
            L = max(nq, nk)
            lay = _layout(L, grid, text_len, arch)
            if lay is not None and lay.img0 is not None:                  # joint (or image-only) attention
                lab = torch.full((L,), -1, dtype=torch.long)
                kind = torch.full((L,), 2, dtype=torch.long)              # 0 image, 1 region caption, 2 shared
                lab[lay.img0:lay.img0 + lay.n] = self.labels(lay.h, lay.w, lay.src)
                kind[lay.img0:lay.img0 + lay.n] = 0
                if txt is not None and lay.txt0 is not None and lay.txt0 + text_len <= L:
                    sl = slice(lay.txt0, lay.txt0 + text_len)
                    cap = txt >= 0
                    lab[sl] = torch.where(cap, txt, lab[sl])
                    kind[sl] = torch.where(cap, torch.ones_like(txt), kind[sl])
            elif lay is not None and txt is not None and nq == nk == text_len:   # text-only layers
                lab = txt.clone()
                kind = torch.where(txt >= 0, torch.ones_like(txt), torch.full_like(txt, 2))
            else:
                lab = None
            if lab is not None:
                diff = lab[:, None] != lab[None, :]
                ki, kj = kind[:, None], kind[None, :]
                both_img = (ki == 0) & (kj == 0)
                if self.share_bg:                                         # background image tokens stay shared
                    both_img = both_img & (lab[:, None] != 0) & (lab[None, :] != 0)
                caption = ((ki == 1) & (kj != 2)) | ((kj == 1) & (ki != 2))
                pen = (diff & (caption | (both_img & early)))[:nq, :nk]
        if pen is None or not bool(pen.any()):
            b = None
        else:
            b = torch.where(pen, self.bias_value(), 0.0).float().to(device=device, dtype=dtype)[None, None]
        if len(self._bias) > 16:
            self._bias.clear()
        self._bias[key] = b
        return b

    def override(self, prev, grid, early=True, arch=None):
        def fn(func, *args, **kwargs):
            q, k = args[0], args[1]
            seq = 2 if kwargs.get("skip_reshape") else 1
            nq, nk = q.shape[seq], k.shape[seq]
            m = self.bias(nq, nk, grid, q.device, q.dtype, getattr(_state, "text_len", None), early, arch)
            if m is None:
                return prev(func, *args, **kwargs) if prev is not None else func(*args, **kwargs)
            if len(args) > 4:                         # mask passed by position (Ideogram 4)
                kwargs["mask"] = args[4]
                args = args[:4] + tuple(args[5:])
            ex = kwargs.get("mask")
            if ex is not None:
                while ex.ndim < 4:
                    ex = ex.unsqueeze(0) if ex.ndim < 3 else ex.unsqueeze(1)
                m = m + ex.to(m.dtype)
            kwargs["mask"] = m
            from comfy.ldm.modules.attention import attention_pytorch   # fused kernels may ignore masks
            if prev is not None:
                return prev(attention_pytorch, *args, **kwargs)
            return attention_pytorch(*args, **kwargs)
        return fn


def _count(name):
    c = getattr(_state, "counts", None)
    if c is not None:
        c[name] = c.get(name, 0) + 1


def _make_forward_hook(module_name):
    def hook(module, args, output):
        active = _active()
        if not active or not args or not isinstance(output, torch.Tensor):
            return None
        x = args[0]
        if not isinstance(x, torch.Tensor):
            return None
        out = output
        for lora, strength, region in active:
            tw = None
            if region is not None:                    # regional LoRA: per-token weights, off outside its region
                grid = _grid()
                if grid is None or out.dim() < 3:
                    continue
                if out.dim() == 4 and getattr(module, "kernel_size", None) is not None:     # conv: (B, C, h, w)
                    tw = region.spatial(out.shape[-2], out.shape[-1], grid, out.device, out.dtype, _arch())
                else:                                     # (B, L, C), or (B, T, h, w, C) (Anima): tokens in between
                    L = 1
                    for d_ in out.shape[1:-1]:
                        L *= int(d_)
                    tw = region.weights(L, grid, out.device, out.dtype, getattr(_state, "text_len", None), _arch())
                    if tw is not None and out.dim() > 3:
                        tw = tw.reshape((1,) + tuple(out.shape[1:-1]) + (1,))
                if tw is None:
                    continue
            for p in lora.modules.get(module_name, ()):
                if p.broken:
                    continue
                _count(lora.name)
                try:
                    if p.dora_scale is not None:
                        if x.device not in p._dora:
                            continue  # setup failed or not run on this device
                        new = p.dora_output(module, x, p.slice_out(out), strength).to(out.dtype)
                        if tw is not None:
                            old = p.slice_out(out)
                            new = old + (new - old) * tw
                        if p.offset is not None and p.offset[0] == 0:
                            if out is output:
                                out = out.clone()
                            out[..., p.offset[1]:p.offset[1] + p.offset[2]] = new
                        else:
                            out = new
                    else:
                        d = (p.delta(x, out) * strength).to(out.dtype)
                        if tw is not None:
                            d = d * tw
                        if p.offset is not None and p.offset[0] == 0:
                            if out is output:
                                out = out.clone()
                            out[..., p.offset[1]:p.offset[1] + p.offset[2]] += d
                        else:
                            out = out + d
                except Exception as e:
                    p.broken = True
                    logging.warning(f"{LOG} '{lora.name}': disabled patch on {module_name} after error: {e}")
        return None if out is output else out
    return hook


def _ensure_hooks(base_model, lora):
    hooked = getattr(base_model, _HOOKED_ATTR, None)
    if hooked is None:
        hooked = {}
        setattr(base_model, _HOOKED_ATTR, hooked)
    for module_name in lora.modules:
        if module_name in hooked:
            continue
        try:
            module = base_model.get_submodule(module_name)
        except AttributeError:
            continue
        hooked[module_name] = (module.register_forward_hook(_make_forward_hook(module_name)), module)


def _force_forward(base_model, loras):
    """Fused paths (comfy.ops.linear_input_act, e.g. MOSS Image's ffn_down) skip a layer's forward (and so its
    hook) unless comfy_force_forward is set. Set it on the patched layers for this model call only, so the fast
    path is back as soon as the LoRAs are off. Returns what to undo."""
    hooked = getattr(base_model, _HOOKED_ATTR, None) or {}
    changed = []
    for lora in loras:
        for module_name in lora.modules:
            h = hooked.get(module_name)
            module = h[1] if isinstance(h, tuple) else None
            if module is not None and not getattr(module, "comfy_force_forward", False):
                module.comfy_force_forward = True
                changed.append(module)
    return changed


def _unforce_forward(changed):
    for module in changed:
        module.comfy_force_forward = False


class _ActivateLoRAWrapper:
    """APPLY_MODEL wrapper: switches the LoRA on for exactly one model call."""

    def __init__(self, lora, strength):
        self.lora = lora
        self.strength = strength

    def __call__(self, executor, *args, **kwargs):
        base_model = executor.class_obj
        _ensure_hooks(base_model, self.lora)
        x = args[0] if args else kwargs.get("x")
        if isinstance(x, torch.Tensor):
            self.lora.prepare(base_model, x.device)
        self._announce(args, kwargs)
        prev = _active()
        _state.active = prev + ((self.lora, self.strength, None),)
        forced = _force_forward(base_model, (self.lora,))
        try:
            return executor(*args, **kwargs)
        finally:
            _state.active = prev
            _unforce_forward(forced)

    def _announce(self, args, kwargs):
        """Print one console line per sampling run, even when the node itself is cached."""
        topts = kwargs.get("transformer_options")
        if topts is None and len(args) > 5:
            topts = args[5]
        sigmas = topts.get("sample_sigmas") if isinstance(topts, dict) else None
        run_id = id(sigmas) if sigmas is not None else None
        if run_id is not None and run_id != self.lora._last_run:
            self.lora._last_run = run_id
            first = self.lora.summary.split("\n")[0]
            _log(f"{LOG} active in this run at strength {self.strength:g}: {first}")

    def to(self, *args, **kwargs):  # ComfyUI may try to cast hook options
        return self


class _ActivateRegionalLoRAsWrapper:
    """APPLY_MODEL wrapper: switches several LoRAs on for one model call, each limited to its region's
    image tokens (region None = everywhere)."""

    def __init__(self, entries, label, separation=None, arch=None):
        self.entries = tuple(entries)                    # (lora, strength, TokenRegion or None)
        self.label = label
        self.separation = separation                     # RegionSeparation or None
        self.arch = arch or ModelArch("MOSS Image")
        self._last_run = None

    def __call__(self, executor, *args, **kwargs):
        base_model = executor.class_obj
        x = args[0] if args else kwargs.get("x")
        for lora, _, _ in self.entries:
            _ensure_hooks(base_model, lora)
            if isinstance(x, torch.Tensor):
                lora.prepare(base_model, x.device)
        args, kwargs, topts = list(args), dict(kwargs), None
        if "transformer_options" in kwargs:
            topts = kwargs["transformer_options"]
        elif len(args) > 5:
            topts = args[5]
        first = self._announce(topts)
        grid = self.arch.grid(int(x.shape[-2]), int(x.shape[-1])) if isinstance(x, torch.Tensor) and x.dim() >= 4 else None
        sep_on = False
        if self.separation is not None and grid is not None and isinstance(topts, dict):
            prog = _sigma_progress(topts)
            early = prog is None or prog <= self.separation.until + 1e-6
            if early or self.separation.has_captions():
                t2 = dict(topts)
                t2["optimized_attention_override"] = self.separation.override(topts.get("optimized_attention_override"),
                                                                              grid, early, self.arch)
                if "transformer_options" in kwargs:
                    kwargs["transformer_options"] = t2
                else:
                    args[5] = t2
                sep_on = True
        prev, prev_grid, prev_tl, prev_arch = _active(), _grid(), getattr(_state, "text_len", None), _arch()
        ctx = args[3] if len(args) > 3 else kwargs.get("c_crossattn")
        if self.arch.text_from == "txt_states" or ctx is None:
            ctx = kwargs.get("txt_states", ctx)
        _state.active = prev + self.entries
        _state.grid = grid
        _state.arch = self.arch
        tl = int(ctx.shape[1]) if isinstance(ctx, torch.Tensor) and ctx.dim() >= 2 else None
        ids = kwargs.get("t5xxl_ids")                    # Anima: text not yet through its adapter
        if self.arch.text_pad and isinstance(ids, torch.Tensor):
            tl = max(int(ids.shape[-1]), self.arch.text_pad)
        _state.text_len = tl
        _state_text_len_seen = _state.text_len
        if first:
            _state.counts = {}
        forced = _force_forward(base_model, [lora for lora, _, _ in self.entries])
        try:
            return executor(*args, **kwargs)
        finally:
            _unforce_forward(forced)
            _state.active = prev
            _state.grid = prev_grid
            _state.text_len = prev_tl
            _state.arch = prev_arch
            if first:
                counts, _state.counts = getattr(_state, "counts", None) or {}, None
                parts = []
                for lora, _, region in self.entries:
                    where = "everywhere" if region is None else f"{region.coverage() * 100:.0f}% of the image"
                    if region is not None and region.text_spans:
                        tl = _state_text_len_seen
                        where += (", + its caption tokens" if tl == region.text_len else
                                  ", caption tokens not used: the prompt differs from the one the regions were set up with")
                    parts.append(f"{lora.name}: {counts.get(lora.name, 0)} layer patches ({where})")
                sep = (f"; regions kept apart in attention (strength {self.separation.strength:g})" if sep_on else "")
                _log(f"{LOG} first step check: " + ("; ".join(parts) or "no regional LoRAs") + sep +
                     ("" if all(counts.get(l.name, 0) for l, _, _ in self.entries) else
                      "  <- a LoRA with 0 patches changed nothing (keys didn't match this model?)"))

    def _announce(self, topts):
        sigmas = topts.get("sample_sigmas") if isinstance(topts, dict) else None
        run_id = id(sigmas) if sigmas is not None else None
        if run_id is not None and run_id != self._last_run:
            self._last_run = run_id
            _log(f"{LOG} regional LoRAs active in this run ({self.arch.name}, one pass, masked inside the model): "
                 f"{self.label}")
            return True
        return False

    def to(self, *args, **kwargs):
        return self


PAD_IDS = {0, 11, 49407, 151643}        # T5 / CLIP-G, Mistral, CLIP-L (pads with its end token), Qwen


def _vision_tokens(v):
    """How many text-encoder tokens an image in the prompt becomes (Qwen3.5 / Qwen3-VL: 16 px patches, 2 x 2 merged)."""
    try:
        from comfy.text_encoders.qwen_vl import process_qwen2vl_images
        _, grid = process_qwen2vl_images(v["data"], patch_size=16)
        return max(1, int(grid[0, 1] * grid[0, 2]) // 4)
    except Exception:
        return 1


def _token_ids(clip, text, key=None, **kw):
    t = clip.tokenize(text, **kw) if kw else clip.tokenize(text)
    if isinstance(t, dict):
        t = t[key] if key in t else next(iter(t.values()))
    ids = []
    for batch in t:
        for tok in batch:
            v = tok[0] if isinstance(tok, (tuple, list)) else tok
            if isinstance(v, dict):                       # an image in the prompt: its vision tokens
                ids += [-2] * _vision_tokens(v)
            else:
                ids.append(int(v) if isinstance(v, (int, float)) else -1)
    return ids


def _unpadded(ids):
    """The tokens without the padding some tokenizers add at the end (T5 to 256, Qwen to 512, CLIP to 77)."""
    n = len(ids)
    while n > 1 and ids[n - 1] in PAD_IDS and ids[n - 2] == ids[n - 1]:
        n -= 1
    if n > 1 and ids[n - 1] in PAD_IDS and ids[n - 1] != ids[0]:
        n -= 1
    return ids[:n]


def caption_token_spans(clip, text, char_spans, arch=None, base=0, **kw):
    """Token ranges of character ranges of `text`, as the text encoder will see `text` (template included,
    minus the tokens the model's text encoder cuts off the front, e.g. Krea 2's system prompt).
    Found by tokenizing the text up to each boundary and comparing with the full tokenization (padding at the
    end left out). Returns (spans, total_tokens): total_tokens = how many text tokens the model will see.
    base: the first `base` characters are always in the prompt (a "Picture 1:" image marker); kw go to tokenize
    (images)."""
    key = arch.token_key if arch is not None else None
    raw = _token_ids(clip, text, key, **kw)
    full = _unpadded(raw)
    def common(b):
        n, m = 0, min(len(full), len(b))
        while n < m and full[n] == b[n]:
            n += 1
        return n
    empty = _unpadded(_token_ids(clip, text[:base], key, **kw))
    suffix = len(empty) - common(empty)                  # template tokens after the text
    spans = []
    for a, b in char_spans:
        s0 = common(_unpadded(_token_ids(clip, text[:a], key, **kw)))
        s1 = len(full) - suffix if b >= len(text) else common(_unpadded(_token_ids(clip, text[:b], key, **kw)))
        spans.append((s0, max(s0, s1)))
    drop = arch.prefix(raw) if arch is not None and arch.prefix is not None else 0
    if drop:
        spans = [(max(0, a - drop), max(0, b - drop)) for a, b in spans]
    total = len(raw) - drop
    if arch is not None and arch.text_pad:
        total = max(total, arch.text_pad)
    return spans, total


def regional_lora_model(model, entries, label, separation=None):
    """A clone of `model` whose LoRAs act inside their regions (one pass, see ONE_PASS_MODELS); with no LoRAs, only
    the region separation."""
    if entries and not _BYPASS_OK:
        raise RuntimeError("Regional LoRAs need a newer ComfyUI (comfy.weight_adapter.bypass is missing). "
                           "Please update ComfyUI.")
    m = model.clone()
    wrapper = _ActivateRegionalLoRAsWrapper(entries, label, separation, model_arch(model))
    m.add_wrapper_with_key(comfy.patcher_extension.WrappersMP.APPLY_MODEL, f"region_genie_loras_{id(wrapper)}", wrapper)
    return m


_MERGE_LOADERS = collections.OrderedDict()      # LoRA name -> core LoraLoaderModelOnly (it caches its file)


def merge_loras(model, loras):
    """Whole-image LoRAs merged into the model weights, exactly like a chain of core 'LoraLoaderModelOnly'
    nodes (same code, same file cache): no per-step cost, and the same result as Load LoRA nodes placed
    before this node's model input."""
    import nodes
    for name, strength in loras:
        loader = _MERGE_LOADERS.pop(name, None) or nodes.LoraLoaderModelOnly()
        _MERGE_LOADERS[name] = loader
        while len(_MERGE_LOADERS) > 8:
            _MERGE_LOADERS.popitem(last=False)
        model = loader.load_lora_model_only(model, name, strength)[0]
    return model


def regional_lora_patch(model, clip, text, regions, scene, separation, until, notes, separate_all=False, tok_kw=None,
                        base=0, share_background=False):
    """Regional LoRAs as one model patch (MOSS Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5), shared by the Region Genie and Regional
    LoRAs nodes.

    text:    the prompt the sampler gets (encoded with `clip`), or None
    regions: [(key, mask (H, W) 0..1, (char_start, char_end) of the region's caption in `text` or None,
               [(lora_name, strength), ...])]
    scene:   [(lora_name, strength)] acting everywhere: merged into the weights like Load LoRA (model only)
    Each regional LoRA acts on its region's image tokens and, with clip, on its caption's text tokens; the
    regions are kept apart in attention for the first `until` of the steps (`separation` 0..1), and each LoRA
    region's caption only talks to its own region. separate_all: every region in `regions` is kept apart (and its
    caption talks only to it), with or without LoRAs. share_background: the image outside the kept-apart regions stays
    shared with them (they are only kept apart from each other). Returns (patched model, info lines)."""
    spans_by_key, text_len, lines = {}, None, []
    with_caps = [(k, c) for k, _, c, ls in regions if c is not None and (ls or separate_all)]
    if clip is not None and text and with_caps:
        try:
            tok, text_len = caption_token_spans(clip, text, [c for _, c in with_caps], model_arch(model), base=base,
                                                **(tok_kw or {}))
            spans_by_key = {k: [t] for (k, _), t in zip(with_caps, tok) if t[1] > t[0]}
        except Exception as e:
            notes.append(f"NOTE: could not map captions to tokens ({e}); LoRAs act on the image only")
            spans_by_key, text_len = {}, None

    loaded, entries, label, token_regions = {}, [], [], []
    def runtime(name):
        if name not in loaded:
            loaded[name] = load_runtime_lora(model, name)
        return loaded[name]
    if scene:
        model = merge_loras(model, scene)
        lines.append("  LoRA whole image (merged into the model, like Load LoRA): "
                     + ", ".join(f"{n} @{st:g}" for n, st in scene))
    for key, mask, _, ls in regions:
        if not ls and not separate_all:
            continue
        reg = TokenRegion(mask, spans_by_key.get(key), text_len)
        token_regions.append(reg)
        if not ls:
            continue
        for name, st in ls:
            entries.append((runtime(name), st, reg))
            label.append(f"{name} in region {key}")
        cap = " + caption tokens" if spans_by_key.get(key) else ""
        lines.append(f"  LoRA region {key} ({reg.coverage() * 100:.0f}% of the image{cap}): "
                     + ", ".join(f"{n} @{st:g}" for n, st in ls))
    if not entries and not (separate_all and token_regions):
        return model, lines
    sep = None
    if token_regions and separation > 0 and (until > 0 or spans_by_key):
        sep = RegionSeparation(token_regions, separation, until, share_bg=share_background)
    shared = " (background shared)" if sep is not None and share_background else ""
    if not entries:
        if sep is None:
            lines.insert(0, "all regions apart: on, but separation is 0 (or 'until' is 0 and no captions): nothing to do")
            return model, lines
        lines.insert(0, f"all {len(token_regions)} regions kept apart{shared} {separation:g} for the first {until * 100:.0f}% of the steps"
                     + (" (captions to their own region at every step)" if spans_by_key else "") + "; no regional LoRAs")
        return regional_lora_model(model, [], f"region separation only ({len(token_regions)} regions)", sep), lines
    lines.insert(0, "LoRAs (model output, one pass): " + (("all regions" if separate_all else "regions")
                                                          + f" kept apart{shared} {separation:g} for the first "
                 f"{until * 100:.0f}% of steps" + (("; each region's caption only talks to its own region" if separate_all
                                                    else "; each LoRA region's caption only talks to its own region")
                                                   if spans_by_key else "") if sep else "no region separation"))
    if token_regions and clip is None:
        lines.append("  (connect clip to let regional LoRAs act on their captions / trigger words too)")
    lines += ["  " + rl.summary.splitlines()[0] for rl in loaded.values()]
    return regional_lora_model(model, entries, "; ".join(label), sep), lines


def is_moss_image(model):
    a = model_arch(model)
    return a is not None and a.name == "MOSS Image"


def one_pass_ok(model):
    """True for the models whose LoRAs can be masked inside the model (one pass)."""
    return model_arch(model) is not None


# --------------------------------------------------------------------------- #
# node
# --------------------------------------------------------------------------- #
class CreateHookLoRAQuantized:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "The (quantized) diffusion model the LoRA is for. Only used to "
                                               "match LoRA keys to layers; the model is not modified."}),
                "lora_name": (folder_paths.get_filename_list("loras"), {"tooltip": "The LoRA file (models/loras)."}),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -20.0, "max": 20.0, "step": 0.01,
                                             "tooltip": "LoRA strength on the diffusion model (0 = off). There is no "
                                                        "CLIP strength: the LoRA's text-encoder weights are not used."}),
            },
            "optional": {
                "prev_hooks": ("HOOKS", {"tooltip": "Hooks from another hook node, combined with this one: chain "
                                                    "nodes here to stack several LoRAs on the same conditioning."}),
            },
        }

    RETURN_TYPES = ("HOOKS", "STRING")
    RETURN_NAMES = ("HOOKS", "lora_info")
    OUTPUT_TOOLTIPS = ("This LoRA (plus prev_hooks) as hooks: attach them to a conditioning, e.g. the hooks input of "
                       "'Cond Pair Set Props'. The LoRA is on only while the model computes that conditioning.",
                       "What was applied and skipped, and the LoRA's trigger words (also shown on the node).")
    FUNCTION = "create_hook"
    CATEGORY = "Region Genie"
    DESCRIPTION = ("Like core 'Create Hook LoRA', but the LoRA is applied while the model runs instead of being baked "
                   "into the weights, so it works with int8 / fp8 / quantized models. Supports LoRA, LoCon, LoKr, LoHa "
                   "and DoRA. Model only (no CLIP strength). Attach the HOOKS to a conditioning, e.g. through the hooks "
                   "input of 'Cond Pair Set Props' (with a mask for a regional LoRA): that conditioning then gets its "
                   "own model pass with the LoRA on.")

    def create_hook(self, model, lora_name, strength_model, prev_hooks=None):
        if not _BYPASS_OK:
            raise RuntimeError("Create Hook LoRA (Quantized) needs a newer ComfyUI "
                               "(comfy.weight_adapter.bypass is missing). Please update ComfyUI.")
        hooks = prev_hooks.clone() if prev_hooks is not None else comfy.hooks.HookGroup()
        if strength_model == 0:
            info = f"'{lora_name}': strength 0, not applied"
            return {"ui": {"lora_info": [info]}, "result": (hooks, info)}
        hook, runtime_lora = make_runtime_hook(model, lora_name, strength_model)
        hooks.add(hook)
        info = runtime_lora.summary
        try:
            from .lora_triggers import lora_trigger_words
            words = lora_trigger_words(lora_name)[0]
            if words:
                info += "\ntrigger words: " + ", ".join(words)
        except Exception:
            pass
        return {"ui": {"lora_info": [info]}, "result": (hooks, info)}


def load_runtime_lora(model, lora_name):
    lora_path = folder_paths.get_full_path_or_raise("loras", lora_name) \
        if hasattr(folder_paths, "get_full_path_or_raise") else folder_paths.get_full_path("loras", lora_name)
    lora_sd = comfy.utils.load_torch_file(lora_path, safe_load=True)
    runtime_lora = build_runtime_lora(model, lora_sd, lora_name)
    del lora_sd
    return runtime_lora


def make_runtime_hook(model, lora_name, strength, runtime_lora=None):
    """One hook that switches a runtime LoRA on (at `strength`) for the model calls of the conds carrying it."""
    if not _BYPASS_OK:
        raise RuntimeError("Create Hook LoRA (Quantized) needs a newer ComfyUI "
                           "(comfy.weight_adapter.bypass is missing). Please update ComfyUI.")
    if runtime_lora is None:
        runtime_lora = load_runtime_lora(model, lora_name)
    wrapper = _ActivateLoRAWrapper(runtime_lora, strength)
    hook = comfy.hooks.TransformerOptionsHook(
        transformers_dict={
            "wrappers": {
                comfy.patcher_extension.WrappersMP.APPLY_MODEL: {
                    f"runtime_hook_lora_{runtime_lora.id}_{id(wrapper)}": [wrapper],
                }
            }
        },
        hook_scope=comfy.hooks.EnumHookScope.HookedOnly,
    )
    return hook, runtime_lora


# --------------------------------------------------------------------------- #
# all-in-one: several regional runtime LoRAs, conditioning combined internally
# --------------------------------------------------------------------------- #
GLOBAL_INDEX = -1


def parse_rows(text):
    try:
        d = json.loads(text) if isinstance(text, str) and text.strip() else {}
    except (ValueError, TypeError):
        d = {}
    rows = d.get("rows", []) if isinstance(d, dict) else (d if isinstance(d, list) else [])
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            out.append({"on": bool(r.get("on", True)), "index": int(r.get("index", 0)),
                        "lora": str(r.get("lora") or ""), "strength": float(r.get("strength", 1.0)),
                        "prompt": str(r.get("prompt") or "")})
        except (TypeError, ValueError):
            continue
    return out


MASKING_MODES = ["inside the model (one pass)", "separate passes (classic hooks)"]


def _has_words(text, words):
    """True if `words` appears in `text` as whole words (case-insensitive)."""
    import re
    w = words.strip()
    return bool(w) and re.search(r"(?<!\w)" + re.escape(w) + r"(?!\w)", str(text or ""), re.IGNORECASE) is not None


def _append_words(text, words):
    """text + ", " + words (no doubled commas); comma-separated phrases already in text are not added again."""
    text = str(text or "")
    for phrase in str(words or "").split(","):
        phrase = phrase.strip()
        if not phrase or _has_words(text, phrase):
            continue
        base = text.rstrip().rstrip(",").rstrip()
        text = f"{base}, {phrase}" if base else phrase
    return text


def parse_moss_layout(text):
    """The prompt as a MOSS-Image layout dict (summary + items), or None for a plain prompt."""
    if not isinstance(text, str) or not text.strip().startswith("{"):
        return None
    try:
        d = json.loads(text)
    except (ValueError, TypeError):
        return None
    if isinstance(d, dict) and isinstance(d.get("items"), list) and ("summary" in d or "bbox_coord_space" in d):
        return d
    return None


def parse_ideogram_layout(text):
    """The prompt as Ideogram caption JSON (compositional_deconstruction.elements), or None."""
    if not isinstance(text, str) or not text.strip().startswith("{"):
        return None
    try:
        d = json.loads(text)
    except (ValueError, TypeError):
        return None
    cd = d.get("compositional_deconstruction") if isinstance(d, dict) else None
    if isinstance(cd, dict) and isinstance(cd.get("elements"), list):
        return d
    return None


def build_region_prompt(text, extras, global_extra):
    """The prompt with words added to region captions.

    MOSS layout JSON: extras[i] goes into item i's caption, global_extra into the summary caption.
    Ideogram caption JSON: extras[i] goes into element i's desc, global_extra into high_level_description.
    Plain prompt: global_extra is appended; each region's words are appended as their own sentence.
    Returns (text, {index: (char_start, char_end) of the region's caption or words}, n_items or None)."""
    layout = parse_moss_layout(text)
    if layout is not None:
        d = copy.deepcopy(layout)
        items = d["items"]
        if global_extra:
            summ = d.get("summary") if isinstance(d.get("summary"), dict) else {}
            summ["caption"] = _append_words(summ.get("caption", ""), global_extra)
            d["summary"] = summ
        for i, words in extras.items():
            if 0 <= i < len(items) and isinstance(items[i], dict):
                items[i]["caption"] = _append_words(items[i].get("caption", ""), words)
        out = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
        from .region_genie import caption_char_spans
        spans = caption_char_spans(out, [it if isinstance(it, dict) else {} for it in items])
        return out, {i: c for i, c in enumerate(spans) if c is not None}, len(items)
    layout = parse_ideogram_layout(text)
    if layout is not None:
        d = copy.deepcopy(layout)
        els = d["compositional_deconstruction"]["elements"]
        if global_extra:
            hl = _append_words(d.get("high_level_description", ""), global_extra)
            d = {"high_level_description": hl, **{k: v for k, v in d.items() if k != "high_level_description"}}
        for i, words in extras.items():
            if 0 <= i < len(els) and isinstance(els[i], dict):
                els[i]["desc"] = _append_words(els[i].get("desc", ""), words)
        out = json.dumps(d, ensure_ascii=False)
        from .region_genie import ideogram_desc_spans
        spans = ideogram_desc_spans(out, [e if isinstance(e, dict) else {} for e in els])
        return out, {i: c for i, c in enumerate(spans) if c is not None}, len(els)
    out = _append_words(text or "", global_extra) if global_extra else str(text or "")
    spans = {}
    for i in sorted(extras):
        words = str(extras[i] or "").strip().strip(",").strip()
        if not words:
            continue
        base = out.rstrip()
        sep = ". " if base and not base.endswith((".", "!", "?")) else (" " if base else "")
        start = len(base) + len(sep)
        out = base + sep + words
        spans[i] = (start, len(out))
    return out, spans, None


class RegionalLoRAs:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "The diffusion model (quantized models work). With lora_masking 'inside "
                                               "the model' and a MOSS Image, Krea 2, Ideogram 4, Flux, Anima or SDXL / SD1.5 model, the LoRAs go "
                                               "into the 'model' output, each acting only inside its mask. Otherwise "
                                               "they ride on 'positive' / 'negative' (one model pass per region)."}),
                "clip": ("CLIP", {"tooltip": "Text encoder: encodes 'positive' and 'negative'. Inside the model, it also "
                                             "finds each region's caption in the prompt, so a LoRA acts on its own "
                                             "region's caption (and trigger words) too."}),
                "masks": ("MASK", {"tooltip": "Region masks, e.g. the 'masks' output of the Region Genie node. Each row "
                                              "picks one by index (the region numbers shown in the Region Genie node)."}),
                "prompt": ("STRING", {"default": "", "multiline": True, "pysssss.autocomplete": False,
                                      "tooltip": "The positive prompt: connect 'prompt' of the Region Genie node "
                                                 "(MOSS JSON, Ideogram JSON or text, in the model's format), or type a "
                                                 "prompt. Each row's words are added to "
                                                 "the caption of its region (index -1: to the scene caption); with a "
                                                 "plain-text prompt they are added as their own sentence."}),
                "negative_prompt": ("STRING", {"default": "", "multiline": True, "pysssss.autocomplete": False,
                                               "tooltip": "Negative prompt, encoded as 'negative' (like CLIP Text "
                                                          "Encode)."}),
                "feather": ("INT", {"default": 0, "min": 0, "max": 512, "step": 1,
                                    "tooltip": "Soften the mask edges by this many pixels, so each LoRA fades into its "
                                               "surroundings."}),
                "lora_masking": (MASKING_MODES, {"default": MASKING_MODES[0],
                                 "tooltip": "inside the model (one pass): each LoRA acts only on its mask's part of the "
                                            "image and on its region's caption, all in one model pass, like the LoRAs "
                                            "of the Region Genie node; index -1 LoRAs are merged into the model like "
                                            "Load LoRA. Needs MOSS Image, Krea 2, Ideogram 4, Flux, Anima or SDXL / SD1.5 (other models fall back "
                                            "to separate passes). separate passes (classic hooks): ComfyUI's hook method, one model pass per "
                                            "region with its LoRAs, blended by the masks; works with any model, but "
                                            "strong styles can bleed across regions."}),
                "region_separation": ("FLOAT", {"default": 0.85, "min": 0.0, "max": 1.0, "step": 0.05,
                                      "tooltip": "inside the model only: how strongly regions are kept apart in "
                                                 "attention. The image of different LoRA regions (every mask with "
                                                 "separate_all_regions) for the first separation_until of the steps, "
                                                 "and each LoRA region's caption from the other regions at every step. "
                                                 "Higher keeps each LoRA's style in its region; 1 = fully separate (may "
                                                 "look like a collage at the seams); 0 = off."}),
                "separation_until": ("FLOAT", {"default": 0.25, "min": 0.0, "max": 1.0, "step": 0.05,
                                     "tooltip": "inside the model only: keep the image of the regions apart for this "
                                                "fraction of the steps (1 = all steps). Early steps set the layout and "
                                                "style of each region; letting the later steps see across regions "
                                                "blends the seams (0.1-0.5 works well with region_separation "
                                                "0.85-0.99)."}),
                "loras_data": ("STRING", {"default": '{"v":2,"rows":[]}', "multiline": False}),
                # after loras_data, so workflows saved before it existed keep their widget values
                "separate_all_regions": ("BOOLEAN", {"default": False,
                                         "tooltip": "On: every mask is kept apart from the others (and from the "
                                                    "background) for the first separation_until of the steps, at "
                                                    "region_separation, with or without LoRAs, and each region's "
                                                    "caption speaks only to its own region. Off: only masks with "
                                                    "LoRAs are kept apart. MOSS Image, Krea 2, Ideogram 4, Flux, Anima or SDXL / SD1.5 with "
                                                    "lora_masking 'inside the model' only; a little slower and more "
                                                    "VRAM while active."}),
                # added last, so saved workflows keep their widget values
                "share_background": ("BOOLEAN", {"default": False,
                                     "tooltip": "inside the model only: the regions that are kept apart (masks with LoRAs, "
                                                "or every mask with separate_all_regions) stay apart from each other, but "
                                                "not from the rest of the image, so lighting, perspective and setting stay "
                                                "one picture. Each region's caption still speaks only to its own region. "
                                                "Off: they are kept apart from the rest of the image too."}),
            },
        }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "CONDITIONING", "STRING")
    RETURN_NAMES = ("model", "positive", "negative", "lora_info")
    OUTPUT_TOOLTIPS = ("The model for the sampler. Inside the model (MOSS Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5): carries the "
                       "LoRAs, each acting only inside its mask (index -1 LoRAs merged in everywhere). Separate passes: the model unchanged "
                       "(the LoRAs ride on 'positive' / 'negative').",
                       "The prompt with the rows' words added, encoded with clip (separate passes: with each region's "
                       "LoRA hooks and mask). Connect it to the sampler.",
                       "negative_prompt encoded with clip (separate passes: with the same hooks). Connect it to the "
                       "sampler.",
                       "What was set up for each region (also printed in the console).")
    FUNCTION = "run"
    CATEGORY = "Region Genie"
    DESCRIPTION = ("Regional LoRAs from a batch of masks (int8 / fp8 / quantized models work). Each row applies a LoRA "
                   "inside one mask (index -1: the whole image) and can add words, e.g. trigger words, to that "
                   "region's caption; rows with the same index stack on that region. MOSS Image, Krea 2, Ideogram 4, "
                   "Flux, Anima and SDXL / SD1.5: "
                   "all LoRAs act in one model pass, each limited to its mask and its caption, like the LoRAs of the "
                   "Region Genie node. "
                   "Other models: one model pass per region with ComfyUI's hooks.")

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, lora_masking=None):
        return True

    def run(self, model, clip, masks, prompt, negative_prompt, feather, loras_data, lora_masking=MASKING_MODES[0],
            region_separation=0.85, separation_until=0.25, separate_all_regions=False, share_background=False):
        from .bbox_masks import box_blur
        rows = [r for r in parse_rows(loras_data) if r["on"] and r["lora"] and r["strength"] != 0]
        m = masks if masks.dim() == 3 else masks.unsqueeze(0)
        n = int(m.shape[0])
        lines, warn = [], []
        prompt = str(prompt or "")

        token_mode = lora_masking != MASKING_MODES[1]
        if token_mode and rows and not one_pass_ok(model):
            token_mode = False
            warn.append(f"NOTE: masking inside the model needs {ONE_PASS_MODELS}; used separate passes instead")

        global_rows = [r for r in rows if r["index"] == GLOBAL_INDEX]
        groups = {}                                            # mask index -> rows
        for r in rows:
            if r["index"] == GLOBAL_INDEX:
                continue
            if not 0 <= r["index"] < n:
                warn.append(f"WARNING: '{r['lora']}' skipped: index {r['index']} but masks has 0-{n - 1}")
                continue
            groups.setdefault(r["index"], []).append(r)

        def joined(rs):
            words = ""
            for r in rs:
                words = _append_words(words, r["prompt"])
            return words
        extras = {i: joined(g) for i, g in groups.items() if joined(g)}
        global_extra = joined(global_rows)

        arr = m.float().cpu().numpy()
        if feather > 0 and groups:
            arr = box_blur(arr, int(feather), solid_border=True)

        enc_cache = {}
        def encode(text):
            if text not in enc_cache:
                enc_cache[text] = clip.encode_from_tokens_scheduled(clip.tokenize(text))
            return enc_cache[text]
        negative = encode(str(negative_prompt or ""))
        desc = lambda rs: " + ".join(f"{r['lora']} @{r['strength']:g}" for r in rs)
        words_note = lambda i: f'  + "{extras[i]}"' if i in extras else ""

        full_text, spans, n_items = build_region_prompt(prompt, extras, global_extra)
        if n_items is not None and n_items != n:
            warn.append(f"NOTE: the layout has {n_items} item(s) but masks has {n}: row indexes follow the masks")
        if extras and n_items is None and not prompt.strip():
            warn.append("NOTE: no prompt: the positive prompt is just the rows' region words")

        sep_all = bool(separate_all_regions)
        if sep_all and lora_masking == MASKING_MODES[1]:
            warn.append("NOTE: separate_all_regions works with lora_masking 'inside the model' only; it was not used")
            sep_all = False
        elif sep_all and not one_pass_ok(model):
            warn.append(f"NOTE: separate_all_regions needs a {ONE_PASS_MODELS} model; it was not used")
            sep_all = False

        model_out = model
        if not rows and not sep_all:
            positive = encode(full_text)
            lines.append("no active LoRA rows: model unchanged, prompt encoded as is")
        elif token_mode or (sep_all and not rows):
            if rows and not _BYPASS_OK:
                raise RuntimeError("The Regional LoRAs node needs a newer ComfyUI "
                                   "(comfy.weight_adapter.bypass is missing). Please update ComfyUI.")
            keys = range(n) if sep_all else sorted(groups)
            regions = [(i, torch.from_numpy(arr[i].copy()), spans.get(i),
                        [(r["lora"], r["strength"]) for r in groups.get(i, [])]) for i in keys]
            scene = [(r["lora"], r["strength"]) for r in global_rows]
            notes = []
            model_out, lines = regional_lora_patch(model, clip, full_text, regions, scene,
                                                   float(region_separation), float(separation_until), notes,
                                                   separate_all=sep_all, share_background=bool(share_background))
            warn += notes
            positive = encode(full_text)
            if global_extra:
                lines.append(f'  scene caption + "{global_extra}"')
            for i in sorted(extras):
                lines.append(f'  region {i} caption + "{extras[i]}"')
        else:
            loaded = {}
            def runtime(name):
                if name not in loaded:
                    loaded[name] = load_runtime_lora(model, name)
                return loaded[name]
            global_hooks = comfy.hooks.HookGroup()
            for r in global_rows:
                global_hooks.add(make_runtime_hook(model, r["lora"], r["strength"], runtime(r["lora"]))[0])
            base_text = build_region_prompt(prompt, {}, global_extra)[0]
            final_pos, final_neg = [], []
            for idx in sorted(groups):
                hooks = global_hooks.clone()
                for r in groups[idx]:
                    hooks.add(make_runtime_hook(model, r["lora"], r["strength"], runtime(r["lora"]))[0])
                region_text = build_region_prompt(prompt, {idx: extras[idx]}, global_extra)[0] if idx in extras \
                    else base_text
                p_, n_ = comfy.hooks.set_conds_props(conds=[encode(region_text), negative], strength=1.0,
                                                     set_cond_area="default",
                                                     mask=torch.from_numpy(arr[idx:idx + 1].copy()), hooks=hooks)
                final_pos += p_; final_neg += n_
                lines.append(f"index {idx}: {desc(groups[idx])}{words_note(idx)}")
            if groups:
                # the plain prompt fills whatever the region masks leave uncovered (1 - their sum), every step
                positive, negative = comfy.hooks.set_default_conds_and_combine(
                    conds=[final_pos, final_neg], new_conds=[encode(base_text), negative],
                    hooks=global_hooks if len(global_hooks) else None)
                lines.insert(0, "separate passes (one per region), LoRAs on the conditioning; model unchanged")
                lines.append("rest of the image: the prompt" + (f" + {desc(global_rows)}" if global_rows else ""))
            else:
                positive, negative = comfy.hooks.set_conds_props(conds=[encode(base_text), negative], strength=1.0,
                                                                 set_cond_area="default", hooks=global_hooks)
                lines.append(f"everywhere: {desc(global_rows)}")
            if global_extra:
                lines.append(f'scene caption + "{global_extra}"')
            lines += [rl.summary.splitlines()[0] for rl in loaded.values()]

        info = "\n".join(lines + warn)
        _log(f"{LOG} Regional LoRAs:\n{info}")
        return {"ui": {"lora_info": [info], "mask_count": [n]}, "result": (model_out, positive, negative, info)}
