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
import contextlib
import logging
import math
import time

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


UP_OVERLAP = 32                   # px that neighbouring pieces of the upscale model's input share


def run_upscale_model(upscale_model, image, piece=512, reduced=False, note=None):
    """`image` (B, H, W, C) through an upscale model, as ComfyUI's Upscale Image (using Model) node does it, but in
    pieces of `piece` px (0: the whole image at once; 512 is that node's own cut, with the same picture) and, with `reduced`, at half precision where the
    model allows it (fp16, or bf16 for models that only take that). When the memory runs out, the pieces are halved.
    `note`: a list that gets what was done, for the console."""
    import comfy.model_management as mm
    patcher = getattr(upscale_model, "patcher", None)
    device = patcher.load_device if patcher is not None else mm.get_torch_device()
    image = image[..., :3]
    scale = max(float(getattr(upscale_model, "scale", 1.0)), 1.0)
    h, w = image.shape[1], image.shape[2]
    most = int(piece) if piece and piece > 0 else max(h, w)
    dtype = None
    if reduced and getattr(device, "type", str(device)) == "cuda":
        dtype = torch.float16 if getattr(upscale_model, "supports_half", False) else \
            torch.bfloat16 if getattr(upscale_model, "supports_bfloat16", False) else None
    in_img = image.movedim(-1, -3).to(device)
    out_dev = mm.intermediate_device()

    def call(a):
        if dtype is None:
            return upscale_model(a.float())
        with torch.autocast(device_type="cuda", dtype=dtype):
            return upscale_model(a.float()).float()

    while True:
        ty, tx = min(h, most), min(w, most)
        need = (ty * tx * 3) * image.element_size() * scale * 384.0 * (0.5 if dtype is not None else 1.0)   # ComfyUI's estimate, per piece
        need += image.nelement() * image.element_size()
        try:
            t0 = time.perf_counter()
            if patcher is not None:
                mm.load_models_gpu([patcher], memory_required=need, force_full_load=True)
            else:
                upscale_model.to(device)
            t1 = time.perf_counter()
            steps = in_img.shape[0] * comfy.utils.get_tiled_scale_steps(w, h, tile_x=tx, tile_y=ty, overlap=UP_OVERLAP)
            out = comfy.utils.tiled_scale(in_img, call, tile_x=tx, tile_y=ty, overlap=UP_OVERLAP, upscale_amount=scale,
                                          pbar=comfy.utils.ProgressBar(steps), output_device=out_dev)
            if getattr(device, "type", "") == "cuda":
                torch.cuda.synchronize()
            t2 = time.perf_counter()
            if dtype is not None and not bool(torch.isfinite(out).all()):
                logging.warning("[Region Genie] Tiled Upscale: the upscale model gave a broken picture at half precision; "
                                "run again at full precision")
                dtype = None
                continue
            break
        except Exception as e:
            raise_non_oom = getattr(mm, "raise_non_oom", None)
            if raise_non_oom is not None:
                raise_non_oom(e)
            elif not isinstance(e, getattr(mm, "OOM_EXCEPTION", ())):
                raise
            most = max(ty, tx) // 2
            if most < 128:
                raise
    if patcher is None:
        upscale_model.to("cpu")
    if note is not None:
        prec = {None: "full precision", torch.float16: "fp16", torch.bfloat16: "bf16"}[dtype]
        note.append(f"upscale model: {steps} piece(s) of up to {tx} x {ty} px, {prec}, {t1 - t0:.1f} s to get it into memory "
                    f"and {t2 - t1:.1f} s to run")
    return out.movedim(-3, -1).clamp(0, 1).to(mm.intermediate_dtype())


def upscale_pixels(image, upscale_by, upscale_model, method, multiple, piece=512, reduced=False, note=None, lap=None):
    """The image enlarged `upscale_by` times in pixels: with the upscale model first when there is one, then
    resized to the exact size (a multiple of `multiple` px, so it fits the latent's cells)."""
    b, h, w, _ = image.shape
    tw = max(multiple, int(round(w * upscale_by / multiple)) * multiple)
    th = max(multiple, int(round(h * upscale_by / multiple)) * multiple)
    img = image
    if upscale_model is not None and upscale_by > 1.0:
        img = run_upscale_model(upscale_model, img, piece, reduced, note)
        if lap:
            lap("upscale model")
    if img.shape[1] != th or img.shape[2] != tw:
        img = comfy.utils.common_upscale(img.movedim(-1, 1), tw, th, method, "disabled").movedim(1, -1)
    if lap:
        lap("resize")
    return img.clamp(0, 1)


RESIZE = ["lanczos", "bicubic", "bilinear", "area", "nearest-exact"]
NO_MODEL = "none"
_loaded = {}                      # the upscale model last used: {name: model}, so a run doesn't read the file again


def upscale_model_names():
    try:
        import folder_paths
        return [NO_MODEL] + list(folder_paths.get_filename_list("upscale_models"))
    except Exception:
        return [NO_MODEL]


def load_upscale_model(name):
    """The upscale model of that file name (as the Load Upscale Model node loads it), or None for "none"."""
    if not isinstance(name, str) or not name or name == NO_MODEL:
        return None
    if name not in _loaded:
        from comfy_extras.nodes_upscale_model import UpscaleModelLoader
        fn = getattr(UpscaleModelLoader, "execute", None)
        out = fn(name) if fn is not None else UpscaleModelLoader().load_model(name)
        _loaded.clear()
        _loaded[name] = getattr(out, "result", out)[0]
    return _loaded[name]


COLOR_SIGMA = 8.0                 # px of the original image: colors are matched at this scale and coarser


def match_colors(image, reference, sigma=COLOR_SIGMA):
    """`image` (B, H, W, 3) with the colors and brightness of `reference` (the original picture, any size): the
    coarse part of their difference is added, the fine detail of `image` stays. Worked out at the reference's size
    (the image shrunk to it, the difference blurred with a Gaussian of `sigma` px), then enlarged, so it costs little."""
    if reference is None or image.ndim != 4 or reference.ndim != 4 or reference.shape[0] not in (1, image.shape[0]):
        return image
    img = image[..., :3].movedim(-1, 1).float()
    ref = reference[..., :3].movedim(-1, 1).to(img.device).float()
    rh, rw = ref.shape[-2:]
    if (rh, rw) != tuple(img.shape[-2:]):
        small = torch.nn.functional.interpolate(img, size=(rh, rw), mode="area") if rh <= img.shape[-2] and rw <= img.shape[-1] \
            else torch.nn.functional.interpolate(img, size=(rh, rw), mode="bilinear", align_corners=False)
    else:
        small = img
    diff = ref - small
    r = max(1, int(math.ceil(sigma * 3)))
    r = min(r, rh - 1, rw - 1)
    if r >= 1:
        k = torch.exp(-(torch.arange(-r, r + 1, dtype=torch.float32, device=diff.device) ** 2) / (2 * sigma * sigma))
        k = k / k.sum()
        c = diff.shape[1]
        diff = torch.nn.functional.pad(diff, (r, r, r, r), mode="reflect")
        diff = torch.nn.functional.conv2d(diff, k.view(1, 1, 1, -1).repeat(c, 1, 1, 1), groups=c)
        diff = torch.nn.functional.conv2d(diff, k.view(1, 1, -1, 1).repeat(c, 1, 1, 1), groups=c)
    if tuple(diff.shape[-2:]) != tuple(img.shape[-2:]):
        diff = torch.nn.functional.interpolate(diff, size=img.shape[-2:], mode="bicubic", align_corners=False)
    return (img + diff).clamp(0, 1).movedim(1, -1).to(image.dtype)


def redraw_start(steps, denoise):
    """The step a run of `steps` starts at so that `denoise` of it is redrawn: the last round(steps x denoise)
    steps are run, at least one."""
    steps = max(1, int(steps))
    return max(0, min(steps - 1, steps - int(round(steps * float(denoise)))))


def _vae_tile(size):
    size = int(size or 0)
    return 0 if size <= 0 else max(64, size)


def vae_encode(vae, pixels, tile=0):
    """The latent of `pixels`; in tiles of `tile` px when it isn't 0 (as the VAE Encode (Tiled) node does)."""
    tile = _vae_tile(tile)
    if not tile:
        return vae.encode(pixels)
    return vae.encode_tiled(pixels, tile_x=tile, tile_y=tile, overlap=min(64, tile // 4))


def vae_decode(vae, samples, tile=0):
    """The picture of a latent; in tiles of `tile` px when it isn't 0 (as the VAE Decode (Tiled) node does)."""
    tile = _vae_tile(tile)
    if not tile:
        return vae.decode(samples)
    try:
        comp = max(1, int(vae.spacial_compression_decode()))
    except Exception:
        comp = 8
    return vae.decode_tiled(samples, tile_x=max(1, tile // comp), tile_y=max(1, tile // comp), overlap=max(1, min(64, tile // 4) // comp))


@contextlib.contextmanager
def _no_preview(off):
    """While inside (and `off`): samplers make no preview picture. ComfyUI reads the preview method when a sampler
    sets up its callback; it is put back afterwards. The progress bar still moves."""
    if not off:
        yield
        return
    try:
        from comfy.cli_args import args, LatentPreviewMethod
        before, args.preview_method = args.preview_method, LatentPreviewMethod.NoPreviews
    except Exception:
        yield
        return
    try:
        yield
    finally:
        args.preview_method = before


class TiledUpscaleRG:
    """IMAGE -> IMAGE: enlarge, then redraw in tiles at a low denoise."""

    @classmethod
    def INPUT_TYPES(cls):
        import comfy.samplers
        req = {
            "image": ("IMAGE", {"tooltip": "The image to upscale."}),
            "model": ("MODEL", {"tooltip": "The model that redraws the enlarged image (with its LoRAs applied)."}),
            "positive": ("CONDITIONING", {"tooltip": "The prompt: What the image shows. Every tile gets it."}),
            "negative": ("CONDITIONING", {"tooltip": "The negative prompt."}),
            "vae": ("VAE", {"tooltip": "The model's VAE."}),
            "upscale_model": (upscale_model_names(), {"default": NO_MODEL, "tooltip": (
                "An upscale model (ESRGAN and the like) for the enlarging; sharper than a plain resize.\n"
                "none: The image is resized with resize_method only.")}),
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
            "color_fix": ("BOOLEAN", {"default": True, "tooltip": (
                "Keeps the colors and the brightness of the original image, which an upscale model or the redrawing "
                "can shift. Only the coarse colors are matched; the new fine detail stays.")}),
            "vae_encode_tile_size": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 64, "tooltip": (
                "The VAE encodes the enlarged image in tiles of this size in pixels, which needs less memory for a "
                "large image.\n0: In one piece. ComfyUI still switches to tiles by itself when the memory runs out.")}),
            "vae_decode_tile_size": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 64, "tooltip": (
                "The VAE decodes the result in tiles of this size in pixels, which needs less memory for a large "
                "image.\n0: In one piece. ComfyUI still switches to tiles by itself when the memory runs out.")}),
            "preview": ("BOOLEAN", {"default": True, "tooltip": (
                "Shows the picture on the node while it is redrawn, as a sampler does. Off: No preview picture.")}),
            "upscale_model_tile_size": ("INT", {"default": 512, "min": 0, "max": 8192, "step": 64, "tooltip": (
                "The upscale model works on pieces of the image of this size in pixels. Larger pieces are faster "
                "and need more memory; when it runs out, they are halved. 512 is what ComfyUI's own node uses.\n"
                "0: The whole image at once.")}),
            "upscale_model_half_precision": ("BOOLEAN", {"default": False, "tooltip": (
                "Runs the upscale model at half precision where it allows it, which is faster and needs less "
                "memory. A few models give a slightly different picture with it. The console says what was used.")}),
        }
        # everyday settings first, then the ones that are set once (the order of the widgets on the node)
        order = ["image", "model", "positive", "negative", "vae",
                 "upscale_by", "upscale_model", "denoise", "seed", "steps", "cfg", "sampler_name", "scheduler",
                 "tile_width", "tile_height", "tile_overlap", "tile_batch_size", "color_fix", "preview",
                 "resize_method", "tile_blend", "upscale_model_tile_size", "upscale_model_half_precision",
                 "vae_encode_tile_size", "vae_decode_tile_size"]
        assert set(order) == set(req), "Tiled Upscale: the order list and the inputs differ"
        return {"required": {k: req[k] for k in order}}

    RETURN_TYPES = ("IMAGE", "LATENT")
    RETURN_NAMES = ("image", "latent")
    OUTPUT_TOOLTIPS = ("The upscaled image.", "The same as a latent, before decoding and before the last color fix.")
    FUNCTION = "run"
    CATEGORY = "Region Genie"
    DESCRIPTION = ("Upscales an image in one node. It enlarges the image (with an upscale model when one is chosen), "
                   "then redraws it with your model in overlapping tiles blended at every step (Mixture of Diffusers), "
                   "several tiles per model call.")

    def run(self, image, model, positive, negative, vae, upscale_model, upscale_by, resize_method, seed, steps, cfg,
            sampler_name, scheduler, denoise, tile_width, tile_height, tile_overlap, tile_batch_size, tile_blend=1.0,
            color_fix=True, vae_encode_tile_size=0, vae_decode_tile_size=0, preview=True, upscale_model_tile_size=512,
            upscale_model_half_precision=False):
        import nodes
        times, t0 = [], time.perf_counter()

        def lap(name):
            nonlocal t0
            now = time.perf_counter()
            if now - t0 >= 0.05:
                times.append(f"{name} {now - t0:.1f} s")
            t0 = now

        def fixed(img):
            return match_colors(img, image) if color_fix else img

        px = px_per_cell(model)
        up = upscale_model if not isinstance(upscale_model, str) else load_upscale_model(upscale_model)   # a name, or a loaded model
        lap("load upscale model")
        notes = []
        pixels = upscale_pixels(image, float(upscale_by), up, resize_method if resize_method in RESIZE else "lanczos", px * 2,
                                upscale_model_tile_size, upscale_model_half_precision, notes, lap)
        pixels = fixed(pixels[:, :, :, :3])                # before redrawing too: the model then starts from the right colors
        lap("color fix")
        latent = {"samples": vae_encode(vae, pixels, vae_encode_tile_size)}
        lap("encode")
        if denoise <= 0:
            return (pixels, latent)
        m, tiler = tiled_model(model, tile_width, tile_height, tile_overlap, tile_batch_size, tile_blend)
        # Only the last part of the steps is run, as KSampler (Advanced) does with start_at_step: at denoise 0.2 and 20
        # steps, the last 4. (A sampler's own `denoise` runs all 20 steps on the last fifth of a 100-step schedule:
        # five times the model calls for the same amount of redrawing.)
        start = redraw_start(steps, denoise)
        with _no_preview(not preview):
            out = nodes.common_ksampler(m, seed, steps, cfg, sampler_name, scheduler, positive, negative, latent, denoise=1.0,
                                        start_step=start, last_step=steps, force_full_denoise=True)[0]
        lap("sample")
        images = vae_decode(vae, out["samples"], vae_decode_tile_size)
        if images.ndim == 5:                              # a video VAE's frames: the pictures one after another
            images = images.reshape(-1, images.shape[-3], images.shape[-2], images.shape[-1])
        lap("decode")
        images = fixed(images)
        lap("color fix")
        logging.info(f"[Region Genie] Tiled Upscale: {pixels.shape[2]} x {pixels.shape[1]} px, {tiler.last_tiles} tile(s), "
                     f"{steps - start} of {steps} steps, {tiler.calls} model calls"
                     + "".join("; " + n for n in notes) + ". " + ", ".join(times)
                     + " (sample and the VAE steps include loading their models)")
        return (images, out)
