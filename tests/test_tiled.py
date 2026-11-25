"""Tiled diffusion (tiled_diffusion.py) against real ComfyUI code on the CPU, with stand-in models: the tile grid, the
weights, tiles batched into one model call in the order ComfyUI's cond / uncond split expects, what is cut per tile,
and a real sampling run through ComfyUI's sampler with a tiny random UNet.
  COMFY_DIR=<a ComfyUI checkout> python3 tests/test_tiled.py
"""
import os
import sys

COMFY = os.environ.get("COMFY_DIR") or "/tmp/comfy_src"
sys.path.insert(0, COMFY)
import comfy.cli_args  # noqa: E402
comfy.cli_args.args.cpu = True
import torch  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.dirname(HERE)
sys.path.insert(0, os.path.dirname(PACK))
import importlib.util  # noqa: E402
spec = importlib.util.spec_from_file_location("rg_tiled", os.path.join(PACK, "tiled_diffusion.py"))
td = importlib.util.module_from_spec(spec)
spec.loader.exec_module(td)

fails = []


def check(name, ok):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        fails.append(name)


# ---- the grid
check("one tile when the tile covers the axis", td.tile_starts(64, 64, 16) == [0] and td.tile_starts(40, 64, 16) == [0])
s = td.tile_starts(160, 64, 16)
check(f"tiles cover the axis, start at 0, end at the edge, even positions ({s})", s[0] == 0 and s[-1] == 160 - 64 and all(p % 2 == 0 for p in s)
      and all(b - a <= 64 - 16 for a, b in zip(s, s[1:])))
check("no overlap asked: tiles side by side", td.tile_starts(128, 64, 0) == [0, 64])
g = td.TileGrid(48, 80, 32, 32, 8, "cpu")
check(f"grid: {len(g.boxes)} tiles of {g.th} x {g.tw}, every cell covered", g.total.min().item() > 0 and len(g.boxes) == len(td.tile_starts(48, 32, 8)) * len(td.tile_starts(80, 32, 8)))
wt = td.gaussian_weights(32, 32)
check("weights: highest in the middle, almost nothing at the edge, the same in both directions", wt[15, 15] > 100 * wt[0, 15]
      and torch.allclose(wt, wt.T) and torch.allclose(wt, wt.flip(0)) and torch.allclose(wt, wt.flip(1)))
tall = td.gaussian_weights(64, 32)
check("weights of a tile that isn't square follow each side's own length (a quarter in from the edge: the same share on both)", abs((tall[16, 16] / tall[32, 16]) / (tall[32, 8] / tall[32, 16]) - 1) < 0.25)

# tile_blend: 1 is the paper's Gaussian (variance 0.01 on a tile of length 1, as the other implementations have it)
import math  # noqa: E402
xs = torch.arange(32, dtype=torch.float64)
ref = torch.exp(-((xs - 15.5) ** 2) / (32 * 32) / (2 * 0.01)) / math.sqrt(2 * math.pi * 0.01)
check("blend 1: exactly the paper's weights", torch.allclose(wt, torch.outer(ref, ref)))
wide, narrow = td.gaussian_weights(32, 32, 2.0), td.gaussian_weights(32, 32, 0.5)
edge = lambda m_: (m_[15, 0] / m_[15, 15]).item()          # noqa: E731
check(f"a higher blend gives the tile's edge more say, a lower one less ({edge(narrow):.1e} < {edge(wt):.1e} < {edge(wide):.1e})", edge(narrow) < edge(wt) < edge(wide))
for bl in (0.25, 4.0):
    gg = td.TileGrid(48, 80, 32, 32, 8, "cpu", bl)
    tot = torch.zeros(48, 80)
    for (yy, xx), sh in zip(gg.boxes, gg.share):
        tot[yy:yy + 32, xx:xx + 32] += sh
    check(f"blend {bl}: the tiles' shares are finite and add up to 1 at every cell", bool(torch.isfinite(tot).all()) and torch.allclose(tot, torch.ones_like(tot), atol=1e-4))

# ---- the wrapper with a stand-in model
calls = []


def fake(x, t, c_concat, c_crossattn, control, transformer_options, **kw):
    calls.append(dict(x=x, t=t, c_concat=c_concat, c_crossattn=c_crossattn, control=control, kw=kw))
    return x * 2.0


W = td.TiledModel(32 * 8, 32 * 8, 8 * 8, 3, 8)
x = torch.randn(2, 4, 48, 80)
t = torch.tensor([0.5, 0.7])
ctx = torch.randn(2, 7, 16)
concat = torch.randn(2, 5, 48, 80)
y = torch.randn(2, 12)
guid = torch.tensor([3.5])
mask = torch.rand(1, 1, 48, 80)
out = W(fake, x, t, concat, ctx, None, {"cond_or_uncond": [0, 1]}, y=y, guidance=guid, denoise_mask=mask, refs=[torch.randn(2, 4, 10, 10)])
n = len(W.grid(48, 80, "cpu").boxes)
check(f"a model that doubles its input: the blended result is the doubled picture ({n} tiles)", torch.allclose(out, x * 2, atol=1e-4))
check(f"tiles are batched: {len(calls)} model calls for {n} tiles at 3 per call, in even batches", len(calls) == -(-n // 3) and W.calls == len(calls)
      and max(c["x"].shape[0] for c in calls) - min(c["x"].shape[0] for c in calls) <= 2)
c0 = calls[0]
k = c0["x"].shape[0] // 2
gr = W.grid(48, 80, "cpu")
(y0, x0), (y1, x1) = gr.boxes[0], gr.boxes[1]
check("batch order: sample by sample (sample 0's tiles, then sample 1's), so the cond / uncond halves stay halves",
      torch.equal(c0["x"][0], x[0, :, y0:y0 + 32, x0:x0 + 32]) and torch.equal(c0["x"][1], x[0, :, y1:y1 + 32, x1:x1 + 32])
      and torch.equal(c0["x"][k], x[1, :, y0:y0 + 32, x0:x0 + 32]))
check("the timestep and the prompt are repeated per tile, in that order", torch.equal(c0["t"], t.repeat_interleave(k)) and torch.equal(c0["c_crossattn"][k], ctx[1])
      and torch.equal(c0["c_crossattn"][0], ctx[0]) and c0["c_crossattn"].shape[0] == 2 * k)
check("what has the picture's shape is cut per tile (c_concat, denoise_mask)", torch.equal(c0["c_concat"][1], concat[0, :, y1:y1 + 32, x1:x1 + 32])
      and c0["kw"]["denoise_mask"].shape == (2 * k, 1, 32, 32) and torch.equal(c0["kw"]["denoise_mask"][k + 1], mask[0, :, y1:y1 + 32, x1:x1 + 32]))
check("other conds: repeated when they have a row per sample, passed as they are otherwise, lists element by element",
      c0["kw"]["y"].shape == (2 * k, 12) and torch.equal(c0["kw"]["y"][k], y[1]) and c0["kw"]["guidance"] is guid and c0["kw"]["refs"][0].shape[0] == 2 * k)

# a model whose answer depends on the tile: the blend follows the weights
calls.clear()
W1 = td.TiledModel(32 * 8, 32 * 8, 16 * 8, 8, 8)
ids = []


def marks(x, t, c_concat, c_crossattn, control, transformer_options, **kw):
    r = torch.zeros_like(x)
    for i in range(x.shape[0]):
        r[i] = float(len(ids)); ids.append(1)
    return r


o = W1(marks, torch.zeros(1, 4, 32, 48), torch.tensor([1.0]), None, None, None, {})
check("two tiles that disagree: each side keeps its tile's answer, the overlap goes smoothly from one to the other",
      abs(o[0, 0, 16, 0].item() - 0) < 1e-3 and abs(o[0, 0, 16, 47].item() - 1) < 1e-3 and 0.4 < o[0, 0, 16, 23:25].mean().item() < 0.6
      and bool((o[0, 0, 16, 1:] - o[0, 0, 16, :-1] >= -1e-6).all()))

# ControlNet residuals worked out on the whole latent are cut to the tiles
calls.clear()
ctrl = {"input": [torch.randn(2, 8, 48, 80), torch.randn(2, 8, 24, 40), None], "middle": [torch.randn(2, 8, 6, 10)], "output": []}
W2 = td.TiledModel(32 * 8, 32 * 8, 8 * 8, 2, 8)
W2(fake, x, t, None, ctx, ctrl, {})
cc = calls[0]["control"]
check("ControlNet residuals that are pictures are cut per tile at their own scale", cc["input"][0].shape[-2:] == (32, 32) and cc["input"][1].shape[-2:] == (16, 16)
      and cc["input"][2] is None and cc["middle"][0].shape[-2:] == (4, 4) and torch.equal(cc["input"][1][1], ctrl["input"][1][0, :, y1 // 2:y1 // 2 + 16, x1 // 2:x1 // 2 + 16]))
calls.clear()
W2(fake, x, t, None, ctx, {"input": [torch.randn(2, 100, 64)]}, {})
check("a ControlNet whose output can't be cut is left out (with a warning), nothing crashes", calls[0]["control"] is None and len(W2.warned) == 1)
calls.clear()
W(fake, torch.randn(1, 4, 16, 16), torch.tensor([1.0]), None, None, None, {})
check("a latent no larger than one tile: one plain model call", len(calls) == 1 and calls[0]["x"].shape == (1, 4, 16, 16))
calls.clear()
o5 = W(fake, torch.randn(1, 16, 1, 48, 80), torch.tensor([1.0]), None, None, None, {})
check("a latent with a frame axis (Wan-type image models) is tiled the same way", o5.shape == (1, 16, 1, 48, 80) and calls[0]["x"].shape[-3:] == (1, 32, 32))

# ---- through ComfyUI's own sampler, with a tiny random UNet
import comfy.supported_models  # noqa: E402
import comfy.model_patcher  # noqa: E402
import nodes  # noqa: E402

cfg = dict(image_size=32, in_channels=4, out_channels=4, model_channels=32, num_res_blocks=[1, 1], channel_mult=[1, 2],
           transformer_depth=[1, 1], transformer_depth_middle=1, transformer_depth_output=[1, 1, 1, 1], context_dim=24, num_heads=2,
           use_spatial_transformer=True, use_linear_in_transformer=False, adm_in_channels=None, use_temporal_attention=False,
           num_head_channels=-1, dtype=torch.float32)
mc = comfy.supported_models.SD15(cfg)
base = mc.get_model({}, device="cpu")
torch.manual_seed(1)
for p_ in base.parameters():
    torch.nn.init.normal_(p_, std=0.02)
patcher = comfy.model_patcher.ModelPatcher(base, load_device=torch.device("cpu"), offload_device=torch.device("cpu"))
pos = [[torch.randn(1, 5, 24), {}]]
neg = [[torch.randn(1, 5, 24), {}]]
lat = {"samples": torch.randn(1, 4, 24, 40) * 0.1}
check("px per latent cell read from the model (8 for SD1.5)", td.px_per_cell(patcher) == 8)
m, wr = td.tiled_model(patcher, 128, 128, 32, 4)
res = nodes.common_ksampler(m, 3, 3, 4.0, "euler", "simple", pos, neg, lat, denoise=0.5)[0]["samples"]
tiles = wr.last_tiles
check(f"a real sampling run in tiles finishes: {tiles} tiles, {wr.calls} model calls for 3 steps at cfg 4 (cond + uncond in one batch)",
      res.shape == (1, 4, 24, 40) and bool(torch.isfinite(res).all()) and tiles == 6 and wr.calls == 3 * -(-tiles // 4))
m1, w1 = td.tiled_model(patcher, 1024, 1024, 32, 4)
a = nodes.common_ksampler(m1, 3, 3, 4.0, "euler", "simple", pos, neg, lat, denoise=0.5)[0]["samples"]
b = nodes.common_ksampler(patcher, 3, 3, 4.0, "euler", "simple", pos, neg, lat, denoise=0.5)[0]["samples"]
check("with one tile the result is the untiled one", torch.allclose(a, b, atol=1e-5))
check("the tiled result differs from the untiled one, a little (the same picture, tile by tile)", not torch.allclose(res, b, atol=1e-5) and (res - b).abs().mean().item() < (b.abs().mean().item() + 1e-6) * 2)
m2, _ = td.tiled_model(m, 128, 128, 32, 1)
import comfy.patcher_extension  # noqa: E402
check("applying it twice replaces the first (one wrapper on the model)", len(m2.wrappers[comfy.patcher_extension.WrappersMP.APPLY_MODEL][td.WRAPPER_KEY]) == 1)

# ---- with the regional LoRAs' wrapper (regional_lora.py) on the same model
sys.path.insert(0, PACK)
spec2 = importlib.util.spec_from_file_location("rg_regional", os.path.join(PACK, "regional_lora.py"))
rl = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(rl)
KIND = comfy.patcher_extension.WrappersMP.APPLY_MODEL
seen = []


def spy(x, t, c_concat, c_crossattn, control, transformer_options, **kw):
    seen.append(transformer_options.get(td.TILES_KEY))
    return x


W3 = td.TiledModel(32 * 8, 32 * 8, 8 * 8, 3, 8)
W3(spy, torch.zeros(2, 4, 48, 80), torch.tensor([1.0, 1.0]), None, None, None, {"sample_sigmas": torch.ones(3)})
g3 = W3.grid(48, 80, "cpu")
check(f"transformer_options['{td.TILES_KEY}'] per call: canvas, rows and the boxes of that call ({seen[0]})", seen[0]["canvas"] == (48, 80) and seen[0]["rows"] == 2
      and seen[0]["boxes"] == [(y_, x_, 32, 32) for y_, x_ in g3.boxes[:3]] and seen[1]["boxes"] == [(y_, x_, 32, 32) for y_, x_ in g3.boxes[3:]])
seen.clear()
W3(spy, torch.zeros(1, 4, 16, 16), torch.tensor([1.0]), None, None, None, {})
check("a call that isn't tiled announces nothing", seen == [None])
reg = rl.regional_lora_model(patcher, (), "test regions")
both = td.tiled_model(reg, 128, 128, 32, 4)[0]
check("Region Genie's model -> tiled: the tiling is the outermost wrapper", list(both.wrappers[KIND])[0] == td.WRAPPER_KEY and len(both.wrappers[KIND]) == 2)
other = rl.regional_lora_model(td.tiled_model(patcher, 128, 128, 32, 4)[0], (), "test regions")
check("tiled -> Region Genie's model: the tiling is the outermost wrapper too", list(other.wrappers[KIND])[0] == td.WRAPPER_KEY and len(other.wrappers[KIND]) == 2)


class Exec:                                   # what ComfyUI hands a wrapper: the rest of the call, and the model
    class_obj = base

    def __init__(self):
        self.got = None

    def __call__(self, *a, **k):
        self.got = (a, k)
        return "out"


wrap = rl._ActivateRegionalLoRAsWrapper((), "test regions", None, rl.model_arch(patcher))
ex = Exec()
topt = {td.TILES_KEY: {"canvas": (48, 80), "boxes": [(0, 0, 32, 32)], "rows": 1}, "sample_sigmas": torch.ones(3)}
r = wrap(ex, torch.zeros(1, 4, 32, 32), torch.tensor([1.0]), None, torch.zeros(1, 5, 24), None, topt)
check("the regional wrapper steps aside for a batch of tiles: the call goes on unchanged, nothing regional is switched on",
      r == "out" and ex.got[0][5] is topt and "optimized_attention_override" not in topt and not rl._active())
res2 = nodes.common_ksampler(both, 3, 3, 4.0, "euler", "simple", pos, neg, lat, denoise=0.5)[0]["samples"]
check("a sampling run with both on the model finishes and gives the tiled result", torch.allclose(res2, res, atol=1e-5))

# ---- the nodes
it = td.TiledUpscaleRG.INPUT_TYPES()
check("tile_overlap and tile_blend are inputs of both nodes; blend 1 at first", all("tile_overlap" in n_.INPUT_TYPES()["required"] and n_.INPUT_TYPES()["required"]["tile_blend"][1]["default"] == 1.0 for n_ in (td.TiledUpscaleRG, td.TiledDiffusionRG)))
tips = [k_ for grp in ("required", "optional") for k_, v in it[grp].items() if not (len(v) > 1 and v[1].get("tooltip"))]
check("Tiled Upscale: every input has a tooltip" + (": missing " + ", ".join(tips) if tips else ""), not tips and "upscale_model" in it["optional"])
img = torch.rand(1, 50, 70, 3)
up = td.upscale_pixels(img, 2.0, None, "lanczos", 16)
check(f"without an upscale model the image is resized to a size that fits the latent ({up.shape[2]} x {up.shape[1]})", up.shape == (1, 96, 144, 3))


class FakeVAE:
    def encode(self, px):
        return torch.nn.functional.avg_pool2d(px.movedim(-1, 1), 8).repeat(1, 2, 1, 1)[:, :4]

    def decode(self, z):
        return torch.nn.functional.interpolate(z[:, :3], scale_factor=8).movedim(1, -1)


node = td.TiledUpscaleRG()
im, la = node.run(torch.rand(1, 96, 160, 3), patcher, pos, neg, FakeVAE(), 2.0, "lanczos", 5, 4, 4.0, "euler", "simple", 0.5, 128, 128, 32, 4, 1.0)
check(f"Tiled Upscale end to end: image {tuple(im.shape)} and latent {tuple(la['samples'].shape)}", im.shape == (1, 192, 320, 3) and la["samples"].shape == (1, 4, 24, 40))
check("the steps that are run: steps x denoise, the last ones (20 at 0.2: from step 16; at least one; all of them at 1)",
      [td.redraw_start(20, 0.2), td.redraw_start(20, 1.0), td.redraw_start(20, 0.01), td.redraw_start(30, 0.5), td.redraw_start(1, 0.2)] == [16, 0, 19, 15, 0])
seen_steps = []
orig_ks = nodes.common_ksampler


def spy_ks(model, seed, steps, cfg, sampler_name, scheduler, positive, negative, latent, **kw):
    seen_steps.append((steps, kw.get("denoise"), kw.get("start_step"), kw.get("last_step"), kw.get("force_full_denoise")))
    return orig_ks(model, seed, steps, cfg, sampler_name, scheduler, positive, negative, latent, **kw)


nodes.common_ksampler = spy_ks
m_calls = {"n": 0}
cnt_model = patcher.clone()
cnt_model.add_wrapper_with_key(KIND, "count", lambda ex, *a, **k: (m_calls.__setitem__("n", m_calls["n"] + 1), ex(*a, **k))[1])
node.run(torch.rand(1, 64, 64, 3), cnt_model, pos, neg, FakeVAE(), 1.0, "lanczos", 5, 20, 1.0, "euler", "simple", 0.2, 1024, 1024, 32, 4, 1.0)
nodes.common_ksampler = orig_ks
check(f"Tiled Upscale at 20 steps and denoise 0.2 runs the last 4 steps only ({seen_steps[-1]}; {m_calls['n']} model calls)",
      seen_steps[-1] == (20, 1.0, 16, 20, True) and m_calls["n"] == 4)
im0, _ = node.run(torch.rand(1, 96, 160, 3), patcher, pos, neg, FakeVAE(), 2.0, "lanczos", 5, 4, 4.0, "euler", "simple", 0.0, 128, 128, 32, 4)
check("denoise 0: only the enlarged image", im0.shape == (1, 192, 320, 3))

if __name__ == "__main__":
    print("\nall passed" if not fails else f"\n{len(fails)} failed")
    sys.exit(1 if fails else 0)
