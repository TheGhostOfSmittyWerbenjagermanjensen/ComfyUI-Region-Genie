"""Tiled diffusion (Mixture of Diffusers) and the one-node tiled upscale.

Mixture of Diffusers (Jiménez, 2023: https://arxiv.org/abs/2302.02412) samples a picture that is larger than the
model handles well, or than the card has memory for: at every step the latent is cut into overlapping tiles, the
model predicts each tile, and the predictions are added up with a Gaussian weight that is highest in a tile's middle
and falls to almost nothing at its edges, so where tiles overlap each pixel listens most to the tile it is deepest in.
Written from the paper; no code is taken from other implementations.

How it is done here:
- `TiledModel` is an APPLY_MODEL wrapper (comfy.patcher_extension; the same hook the regional LoRAs use, and several
  can be stacked). It gets the latent in sigma space with cond and uncond already joined into one batch, and returns
  the denoised latent; denoised = input - sigma * noise is linear per pixel, so blending the denoised tiles is the
  paper's blend of the noise predictions.
- Several tiles go through the model in ONE call (`tile_batch_size`). They are laid out sample by sample
  ([sample 0: tile a, tile b, …, sample 1: tile a, …]), so code that splits the batch into its cond / uncond halves
  (`transformer_options["cond_or_uncond"]`) still finds them.
- Nothing is done about a transformer model's image positions: each tile is sampled as a picture of its own, as
  Forge Neo does. From an upscaled image at a low denoise each tile is held in place by its own content. (Giving every
  tile its place in the whole picture is possible per model family; see docs/HANDOFF.md.)
- What has the picture's shape is cut per tile: the inpaint / control channels (`c_concat`), a `denoise_mask`, and
  ControlNet residuals that are images. Everything else with a batch row is repeated; the rest is passed as it is.

Tile sizes are given in pixels and turned into latent cells with the model's own scale (8 px per cell for most,
16 for the Flux.2 latent); tiles keep even sizes and positions, so a model that patches 2 x 2 cells sees whole patches.
"""
import logging
import math

import torch

import comfy.model_management
import comfy.patcher_extension
import comfy.utils

WRAPPER_KEY = "region_genie_tiled"
TILES_KEY = "rg_tiles"            # in transformer_options while a batch of tiles is in the model (see TiledModel)
GAUSS_VAR = 0.01                 # the paper's variance of the tile weights (on a tile of width 1)


def tile_starts(size, tile, overlap):
    """Where the tiles start along one axis of `size` cells: as few tiles of `tile` cells as cover it with at least
    `overlap` cells shared by neighbours, spread evenly, the last one ending at the edge. Even positions."""
    if tile >= size:
        return [0]
    step = max(1, tile - overlap)
    n = math.ceil((size - overlap) / step)
    if n <= 1:
        return [0]
    last = size - tile
    out = []
    for i in range(n):
        p = int(round(i * last / (n - 1) / 2)) * 2
        out.append(min(max(p, 0), last))
    return sorted(set(out))


def gaussian_weights(h, w, blend=1.0):
    """The tile's weights (h x w, float64): the product of a Gaussian along each axis, centred on the tile.
    `blend` widens (above 1) or narrows (below 1) the Gaussian; 1 is the paper's (a tenth of the tile's length as
    its standard deviation), as the other implementations have it."""
    var = GAUSS_VAR * float(blend) ** 2

    def axis(n):
        x = torch.arange(n, dtype=torch.float64)
        mid = (n - 1) / 2
        return torch.exp(-((x - mid) ** 2) / (n * n) / (2 * var)) / math.sqrt(2 * math.pi * var)
    return torch.outer(axis(h), axis(w))


class TileGrid:
    """The tiles of one latent size, their weights and what the weights add up to at every cell."""

    def __init__(self, h, w, tile_h, tile_w, overlap, device, blend=1.0):
        self.h, self.w = h, w
        even = lambda v: max(2, int(v) // 2 * 2)                       # noqa: E731
        self.th, self.tw = min(even(tile_h), h), min(even(tile_w), w)
        ov_y, ov_x = min(int(overlap), self.th - 2), min(int(overlap), self.tw - 2)
        self.boxes = [(y, x) for y in tile_starts(h, self.th, max(0, ov_y)) for x in tile_starts(w, self.tw, max(0, ov_x))]
        # every tile's share of each of its cells: its weight over the sum of all tiles' weights there. Worked out
        # in float64 (a narrow Gaussian's edge is far below what float32 holds), kept as float32
        weight = gaussian_weights(self.th, self.tw, blend)
        total = torch.zeros((h, w), dtype=torch.float64)
        for y, x in self.boxes:
            total[y:y + self.th, x:x + self.tw] += weight
        self.total = total
        self.share = [(weight / total[y:y + self.th, x:x + self.tw]).to(device=device, dtype=torch.float32) for y, x in self.boxes]

    def cut(self, t, y, x, scale_y=1.0, scale_x=1.0):
        """The tile's part of a tensor whose last two sizes are the latent's (or the latent's times a scale)."""
        if scale_y == 1.0 and scale_x == 1.0:
            return t[..., y:y + self.th, x:x + self.tw]
        y0, x0 = int(round(y * scale_y)), int(round(x * scale_x))
        return t[..., y0:y0 + max(1, int(round(self.th * scale_y))), x0:x0 + max(1, int(round(self.tw * scale_x)))]


def _is_image_of(t, h, w):
    return torch.is_tensor(t) and t.ndim >= 3 and tuple(t.shape[-2:]) == (h, w)


class TiledModel:
    """The APPLY_MODEL wrapper: `tile` and `overlap` in latent cells are worked out per call from pixels."""

    def __init__(self, tile_w, tile_h, overlap, batch, px_per_cell, blend=1.0):
        self.tile_w, self.tile_h, self.overlap = int(tile_w), int(tile_h), int(overlap)
        self.batch = max(1, int(batch))
        self.px = max(1, int(px_per_cell))
        self.blend = min(4.0, max(0.25, float(blend)))
        self.grids = {}
        self.warned = set()
        self.calls = 0                                  # model calls made (tests, and the node's note)
        self.last_tiles = 0

    def grid(self, h, w, device):
        key = (h, w, str(device))
        g = self.grids.get(key)
        if g is None:
            g = TileGrid(h, w, max(2, round(self.tile_h / self.px)), max(2, round(self.tile_w / self.px)),
                         max(0, round(self.overlap / self.px)), device, self.blend)
            self.grids = {key: g}                        # one size at a time is all a run needs
        return g

    def _warn(self, what):
        if what not in self.warned:
            self.warned.add(what)
            logging.warning(f"[Region Genie] Tiled diffusion: {what}")

    # -- what goes to the model with a batch of tiles -----------------------------------------------------------
    def _per_tile(self, v, g, tiles, rows):
        """A cond for `tiles` (a list of (y, x)), sample by sample. `rows`: the batch size of the latent."""
        n = len(tiles)
        if torch.is_tensor(v):
            if _is_image_of(v, g.h, g.w) and v.shape[0] in (1, rows):
                if v.shape[0] == 1 and rows > 1:
                    v = v.expand(rows, *v.shape[1:])
                return torch.stack([g.cut(v, y, x) for y, x in tiles], dim=1).flatten(0, 1)
            if v.ndim >= 1 and v.shape[0] == rows and rows >= 1:
                return v.repeat_interleave(n, dim=0)
            return v
        if isinstance(v, (list, tuple)):
            out = [self._per_tile(e, g, tiles, rows) for e in v]
            return type(v)(out) if isinstance(v, tuple) else out
        return v

    def _control(self, control, g, tiles, rows):
        """ControlNet residuals worked out on the whole latent, cut to the tiles: those that are images whose size
        is the latent's divided by a whole number (a UNet's). None when a residual can't be cut."""
        if control is None:
            return None
        out = {}
        for key, group in control.items():
            cut = []
            for r in group:
                if r is None:
                    cut.append(None)
                    continue
                if not (torch.is_tensor(r) and r.ndim == 4 and r.shape[0] in (1, rows)):
                    return False
                sy, sx = r.shape[-2] / g.h, r.shape[-1] / g.w
                if sy <= 0 or sx <= 0 or abs(g.th * sy - round(g.th * sy)) > 1e-6 or abs(g.tw * sx - round(g.tw * sx)) > 1e-6:
                    return False
                if r.shape[0] == 1 and rows > 1:
                    r = r.expand(rows, *r.shape[1:])
                cut.append(torch.stack([g.cut(r, y, x, sy, sx) for y, x in tiles], dim=1).flatten(0, 1))
            out[key] = cut
        return out

    def __call__(self, executor, x, t, c_concat=None, c_crossattn=None, control=None, transformer_options={}, **kwargs):
        if not torch.is_tensor(x) or x.ndim not in (4, 5) or "latent_shapes" in kwargs:
            self._warn("this model's latent isn't one picture (packed latents): sampled without tiles")
            return executor(x, t, c_concat, c_crossattn, control, transformer_options, **kwargs)
        h, w = x.shape[-2], x.shape[-1]
        g = self.grid(h, w, x.device)
        self.last_tiles = len(g.boxes)
        if len(g.boxes) <= 1:
            self.calls += 1
            return executor(x, t, c_concat, c_crossattn, control, transformer_options, **kwargs)
        rows = x.shape[0]
        out = None
        per_call = math.ceil(len(g.boxes) / math.ceil(len(g.boxes) / self.batch))     # even batches
        for i in range(0, len(g.boxes), per_call):
            comfy.model_management.throw_exception_if_processing_interrupted()
            tiles = g.boxes[i:i + per_call]
            n = len(tiles)
            xt = torch.stack([g.cut(x, y, x0) for y, x0 in tiles], dim=1).flatten(0, 1)
            tt = t.repeat_interleave(n, dim=0) if torch.is_tensor(t) and t.ndim >= 1 and t.shape[0] == rows else t
            ct = self._control(control, g, tiles, rows)
            if ct is False:
                self._warn("this ControlNet's output can't be cut into tiles: it is left out while tiling")
                ct = None
            kw = {k: self._per_tile(v, g, tiles, rows) for k, v in kwargs.items()}
            # for code inside the model call that works by place in the picture (the regional LoRAs' wrapper):
            # which part of the whole latent each row of this batch is (rows: sample 0's tiles, then sample 1's …)
            to = dict(transformer_options) if isinstance(transformer_options, dict) else {}
            to[TILES_KEY] = {"canvas": (h, w), "boxes": [(y, x0, g.th, g.tw) for y, x0 in tiles], "rows": rows}
            res = executor(xt, tt, self._per_tile(c_concat, g, tiles, rows), self._per_tile(c_crossattn, g, tiles, rows),
                           ct, to, **kw)
            self.calls += 1
            if out is None:
                out = torch.zeros((rows, *res.shape[1:-2], h, w), device=res.device, dtype=res.dtype)
            res = res.unflatten(0, (rows, n))
            for j, (y, x0) in enumerate(tiles):
                out[..., y:y + g.th, x0:x0 + g.tw] += res[:, j] * g.share[i + j].to(device=res.device, dtype=res.dtype)
        return out


def px_per_cell(model):
    """How many pixels one latent cell stands for with this model (8, or 16 for the Flux.2 latent …)."""
    try:
        r = model.get_model_object("latent_format").spacial_downscale_ratio
        return int(r) if isinstance(r, (int, float)) and r >= 1 else 8
    except Exception:
        return 8


def tiled_model(model, tile_width, tile_height, tile_overlap, tile_batch_size, tile_blend=1.0):
    """A clone of `model` that samples in tiles (Mixture of Diffusers)."""
    m = model.clone()
    wrapper = TiledModel(tile_width, tile_height, tile_overlap, tile_batch_size, px_per_cell(model), tile_blend)
    kind = comfy.patcher_extension.WrappersMP.APPLY_MODEL
    m.remove_wrappers_with_key(kind, WRAPPER_KEY)
    m.add_wrapper_with_key(kind, WRAPPER_KEY, wrapper)
    # The tiling goes around every other wrapper of the model call (ComfyUI runs them in the order of their keys,
    # the first outermost): what works by place in the picture, as the regional LoRAs do, must be given the tiles
    # and told which they are, not the whole latent
    mine = m.wrappers[kind].pop(WRAPPER_KEY)
    m.wrappers[kind] = {WRAPPER_KEY: mine, **m.wrappers[kind]}
    return m, wrapper


_TILE = {
    "tile_width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 16, "tooltip": (
        "The width of one tile in pixels. Use a size the model draws well at (about what it was trained on). "
        "Smaller tiles need less memory and take more model calls.")}),
    "tile_height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 16, "tooltip": (
        "The height of one tile in pixels.")}),
    "tile_overlap": ("INT", {"default": 128, "min": 0, "max": 4096, "step": 16, "tooltip": (
        "How many pixels neighbouring tiles share at least. More overlap hides seams better and takes more tiles; "
        "an eighth to a quarter of the tile is usual.")}),
    "tile_batch_size": ("INT", {"default": 2, "min": 1, "max": 64, "step": 1, "tooltip": (
        "How many tiles go through the model in one call. More is faster while they fit in memory; 1 needs the "
        "least memory.")}),
    "tile_blend": ("FLOAT", {"default": 1.0, "min": 0.25, "max": 4.0, "step": 0.05, "tooltip": (
        "How widely a tile's say spreads from its middle where tiles overlap.\n"
        "1: As Mixture of Diffusers defines it (the usual).\n"
        "Higher: The tiles are mixed over a wider band, towards a plain average; softer, and it can smear detail.\n"
        "Lower: Each pixel follows the tile it is deepest in more strictly; crisper, and a seam can show sooner.")}),
}


class TiledDiffusionRG:
    """MODEL -> MODEL: sampling with this model works in tiles."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model": ("MODEL", {"tooltip": "The model to sample with in tiles."}), **_TILE}}

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    OUTPUT_TOOLTIPS = ("The model, sampling in tiles. Connect it to a sampler.",)
    FUNCTION = "run"
    CATEGORY = "Region Genie"
    DESCRIPTION = ("Makes a model sample in overlapping tiles that are blended at every step (Mixture of Diffusers), "
                   "for pictures larger than the model or the memory allows at once. For your own sampler; Tiled "
                   "Upscale (Region Genie) does the whole upscale in one node.")

    def run(self, model, tile_width, tile_height, tile_overlap, tile_batch_size, tile_blend=1.0):
        return (tiled_model(model, tile_width, tile_height, tile_overlap, tile_batch_size, tile_blend)[0],)


def upscale_pixels(image, upscale_by, upscale_model, method, multiple):
    """The image enlarged `upscale_by` times in pixels: with the upscale model first when there is one, then
    resized to the exact size (a multiple of `multiple` px, so it fits the latent's cells)."""
    b, h, w, _ = image.shape
    tw = max(multiple, int(round(w * upscale_by / multiple)) * multiple)
    th = max(multiple, int(round(h * upscale_by / multiple)) * multiple)
    img = image
    if upscale_model is not None and upscale_by > 1.0:
        from comfy_extras.nodes_upscale_model import ImageUpscaleWithModel
        fn = getattr(ImageUpscaleWithModel, "execute", None)
        out = fn(upscale_model, img) if fn is not None else ImageUpscaleWithModel().upscale(upscale_model, img)
        img = getattr(out, "result", out)[0]
    if img.shape[1] != th or img.shape[2] != tw:
        img = comfy.utils.common_upscale(img.movedim(-1, 1), tw, th, method, "disabled").movedim(1, -1)
    return img.clamp(0, 1)


RESIZE = ["lanczos", "bicubic", "bilinear", "area", "nearest-exact"]


def redraw_start(steps, denoise):
    """The step a run of `steps` starts at so that `denoise` of it is redrawn: the last round(steps x denoise)
    steps are run, at least one."""
    steps = max(1, int(steps))
    return max(0, min(steps - 1, steps - int(round(steps * float(denoise)))))


class TiledUpscaleRG:
    """IMAGE -> IMAGE: enlarge, then redraw in tiles at a low denoise."""

    @classmethod
    def INPUT_TYPES(cls):
        import comfy.samplers
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The image to upscale."}),
                "model": ("MODEL", {"tooltip": "The model that redraws the enlarged image (with its LoRAs applied)."}),
                "positive": ("CONDITIONING", {"tooltip": "The prompt: What the image shows. Every tile gets it."}),
                "negative": ("CONDITIONING", {"tooltip": "The negative prompt."}),
                "vae": ("VAE", {"tooltip": "The model's VAE."}),
                "upscale_by": ("FLOAT", {"default": 2.0, "min": 1.0, "max": 8.0, "step": 0.05, "tooltip": (
                    "How many times larger the result is, per side. 1: Only redraws the image at its size.")}),
                "resize_method": (RESIZE, {"default": "lanczos", "tooltip": (
                    "How the image is resized to its new size. Used by itself without an upscale model, or after the "
                    "upscale model when its factor is another one.")}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True,
                                 "tooltip": "The seed of the noise that is added before redrawing."}),
                "steps": ("INT", {"default": 20, "min": 1, "max": 10000, "tooltip": (
                    "The steps of a full run. Only the last part of them is run, steps x denoise. That is 4 of 20 at a "
                    "denoise of 0.2, as KSampler (Advanced) does when it starts at a later step.")}),
                "cfg": ("FLOAT", {"default": 4.0, "min": 0.0, "max": 100.0, "step": 0.1, "round": 0.01,
                                  "tooltip": "The cfg, as on a sampler. 1 for distilled models."}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS, {"tooltip": "The sampler."}),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS, {"tooltip": "The scheduler."}),
                "denoise": ("FLOAT", {"default": 0.2, "min": 0.0, "max": 1.0, "step": 0.01, "tooltip": (
                    "How much of the enlarged image is redrawn. About 0.05: Only polish. About 0.2: Fine detail. "
                    "0.3-0.4: More invention. Higher: The tiles start to forget the picture.")}),
                **_TILE,
            },
            "optional": {
                "upscale_model": ("UPSCALE_MODEL", {"tooltip": (
                    "Optional. An upscale model (ESRGAN and the like) for the enlarging; sharper than a plain "
                    "resize. Without it the image is resized with resize_method.")}),
            },
        }

    RETURN_TYPES = ("IMAGE", "LATENT")
    RETURN_NAMES = ("image", "latent")
    OUTPUT_TOOLTIPS = ("The upscaled image.", "The same as a latent, before decoding.")
    FUNCTION = "run"
    CATEGORY = "Region Genie"
    DESCRIPTION = ("Upscales an image in one node. It enlarges the image (with an upscale model when one is connected), "
                   "then redraws it with your model in overlapping tiles blended at every step (Mixture of Diffusers), "
                   "several tiles per model call.")

    def run(self, image, model, positive, negative, vae, upscale_by, resize_method, seed, steps, cfg, sampler_name,
            scheduler, denoise, tile_width, tile_height, tile_overlap, tile_batch_size, tile_blend=1.0, upscale_model=None):
        import nodes
        px = px_per_cell(model)
        pixels = upscale_pixels(image, float(upscale_by), upscale_model, resize_method if resize_method in RESIZE else "lanczos", px * 2)
        latent = {"samples": vae.encode(pixels[:, :, :, :3])}
        if denoise <= 0:
            return (pixels, latent)
        m, _ = tiled_model(model, tile_width, tile_height, tile_overlap, tile_batch_size, tile_blend)
        # Only the last part of the steps is run, as KSampler (Advanced) does with start_at_step: at denoise 0.2 and 20
        # steps, the last 4. (A sampler's own `denoise` runs all 20 steps on the last fifth of a 100-step schedule:
        # five times the model calls for the same amount of redrawing.)
        start = redraw_start(steps, denoise)
        out = nodes.common_ksampler(m, seed, steps, cfg, sampler_name, scheduler, positive, negative, latent, denoise=1.0,
                                    start_step=start, last_step=steps, force_full_denoise=True)[0]
        images = vae.decode(out["samples"])
        if images.ndim == 5:                              # a video VAE's frames: the pictures one after another
            images = images.reshape(-1, images.shape[-3], images.shape[-2], images.shape[-1])
        return (images, out)
