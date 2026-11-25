"""The A1111-style settings text (gen_params.py, round 44): reading the workflow that ran, the text, the hashes from
metadata files, and the text in the saved files. No ComfyUI needed."""
import io
import json
import os
import struct
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
from stubs import check, fails, T  # noqa: E402,F401
import stubs  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, features  # noqa: E402

from rgpack import gen_params as gp  # noqa: E402
from rgpack import save_image as si  # noqa: E402


def N(cls, **inputs):
    return {"class_type": cls, "inputs": inputs}


# ---------------------------------------------------------------- a plain workflow: loader, LoRA, KSampler, decode, save
PLAIN = {
    "1": N("CheckpointLoaderSimple", ckpt_name="SDXL/juggernaut.safetensors"),
    "2": N("LoraLoader", model=["1", 0], clip=["1", 1], lora_name="style/ink.safetensors", strength_model=0.8, strength_clip=1),
    "3": N("CLIPTextEncode", clip=["2", 1], text="a red fox, in snow"),
    "4": N("CLIPTextEncode", clip=["2", 1], text="blurry"),
    "5": N("EmptyLatentImage", width=1024, height=768, batch_size=1),
    "6": N("KSampler", model=["2", 0], positive=["3", 0], negative=["4", 0], latent_image=["5", 0], seed=123456789012,
           steps=28, cfg=6.5, sampler_name="dpmpp_2m_sde", scheduler="karras", denoise=1.0),
    "7": N("VAEDecode", samples=["6", 0], vae=["1", 2]),
    "9": N("Region-Genie_SaveImage", images=["7", 0]),
}
t = gp.trace(PLAIN, "9")
check("plain workflow: the sampler's own values", len(t["samplers"]) == 1 and t["samplers"][0]["seed"] == 123456789012
      and t["samplers"][0]["steps"] == 28 and t["samplers"][0]["cfg"] == 6.5 and t["samplers"][0]["sampler"] == "dpmpp_2m_sde"
      and t["samplers"][0]["scheduler"] == "karras")
check("the model and the LoRA on the way to it", t["model"] == {"name": "SDXL/juggernaut.safetensors", "folder": "checkpoints"}
      and t["loras"] == [("style/ink.safetensors", 0.8)])
check("the prompts of the two text encoders", t["positive"] == "a red fox, in snow" and t["negative"] == "blurry")
text, missing = gp.build(t, (1024, 768))
want = ("a red fox, in snow <lora:ink:0.8>\nNegative prompt: blurry\n"
        "Steps: 28, Sampler: DPM++ 2M SDE, Schedule type: Karras, CFG scale: 6.5, Seed: 123456789012, Size: 1024x768, "
        "Model: juggernaut, Version: ComfyUI")
check(f"the text, in A1111's layout and names ({text!r})", text == want and missing == [])
check("denoise 1 isn't written; under 1 it is (image to image)", "Denoising" not in text
      and "Denoising strength: 0.6" in gp.build(gp.trace({**PLAIN, "6": N("KSampler", **{**PLAIN["6"]["inputs"], "denoise": 0.6})}, "9"), (1024, 768))[0])

# ---------------------------------------------------------------- values that come from other nodes
PRIM = json.loads(json.dumps(PLAIN))
PRIM["20"] = N("PrimitiveInt", value=777)
PRIM["21"] = N("Seed (rgthree)", seed=4242)
PRIM["22"] = N("SomeMathNode", a=1, b=2)
PRIM["6"]["inputs"].update(steps=["20", 0], seed=["21", 0], cfg=["22", 0])
t2 = gp.trace(PRIM, "9")
check("a value held by a plain value node (a primitive, a seed node) is read; one that a node computes is not",
      t2["samplers"][0]["steps"] == 777 and t2["samplers"][0]["seed"] == 4242 and t2["samplers"][0]["cfg"] is None)
PRIM["6"]["inputs"]["seed"] = ["22", 0]
text2, missing2 = gp.build(gp.trace(PRIM, "9"), (64, 64))
check(f"a seed that can't be read is left out and reported ({missing2})", missing2 == ["seed"] and "Seed:" not in text2 and "Steps: 777" in text2)
text3, missing3 = gp.build(gp.trace(PRIM, "9"), (64, 64), {"seed": 99, "sampler_name": "euler_ancestral", "scheduler": "sgm_uniform",
                                                            "positive": "typed here", "negative": "", "model_name": "other.safetensors", "cfg": 3})
check(f"values connected to the save node win ({text3!r})", missing3 == [] and "Seed: 99" in text3 and "Sampler: Euler a" in text3
      and "Schedule type: SGM Uniform" in text3 and text3.startswith("typed here <lora:ink:0.8>\nNegative prompt: blurry\n")
      and "Model: other" in text3 and "CFG scale: 3," in text3)
check("a name A1111 has no word for is written as ComfyUI has it", "Sampler: my_new_sampler" in gp.build(t, (8, 8), {"sampler_name": "my_new_sampler"})[0])

# ---------------------------------------------------------------- the custom sampler set (Flux-style)
ADV = {
    "1": N("UNETLoader", unet_name="flux1-dev.safetensors", weight_dtype="default"),
    "2": N("DualCLIPLoader", clip_name1="a", clip_name2="b", type="flux"),
    "3": N("CLIPTextEncode", clip=["2", 0], text="a lighthouse at dusk"),
    "4": N("FluxGuidance", conditioning=["3", 0], guidance=3.5),
    "5": N("BasicGuider", model=["12", 0], conditioning=["4", 0]),
    "6": N("RandomNoise", noise_seed=31337),
    "7": N("KSamplerSelect", sampler_name="euler"),
    "8": N("BasicScheduler", model=["12", 0], scheduler="simple", steps=20, denoise=1.0),
    "9": N("EmptySD3LatentImage", width=1216, height=832, batch_size=1),
    "10": N("SamplerCustomAdvanced", noise=["6", 0], guider=["5", 0], sampler=["7", 0], sigmas=["8", 0], latent_image=["9", 0]),
    "11": N("VAELoader", vae_name="ae.safetensors"),
    "12": N("Power Lora Loader (rgthree)", model=["1", 0], lora_1={"on": True, "lora": "detail.safetensors", "strength": 0.5},
            lora_2={"on": False, "lora": "off.safetensors", "strength": 1}, **{"➕ Add Lora": ""}),
    "13": N("VAEDecode", samples=["10", 0], vae=["11", 0]),
    "14": N("Region-Genie_SaveImage", images=["13", 0]),
}
ta = gp.trace(ADV, "14")
sa = ta["samplers"][0]
check("SamplerCustomAdvanced: seed from the noise node, sampler from its select node, steps / scheduler from the sigmas node",
      sa["seed"] == 31337 and sa["sampler"] == "euler" and sa["steps"] == 20 and sa["scheduler"] == "simple" and sa["cfg"] is None)
check("…the model through a list-of-LoRAs loader (only the LoRAs that are on), the prompt through the guidance node, the VAE",
      ta["model"] == {"name": "flux1-dev.safetensors", "folder": "diffusion_models"} and ta["loras"] == [("detail.safetensors", 0.5)]
      and ta["positive"] == "a lighthouse at dusk" and ta["negative"] is None and ta["vae"] == "ae.safetensors" and ta["guidance"] == 3.5)
texta, missa = gp.build(ta, (1216, 832))
check(f"its text: no cfg, the guidance as Forge writes it, no negative line ({texta!r})", missa == [] and "CFG scale" not in texta
      and "Distilled CFG Scale: 3.5" in texta and "Negative prompt" not in texta and "Sampler: Euler, Schedule type: Simple" in texta
      and "Model: flux1-dev, VAE: ae.safetensors" in texta)
# a sampler made by a node of its own, sigmas cut by another node
ADV2 = json.loads(json.dumps(ADV))
ADV2["7"] = N("SamplerDPMPP_2M_SDE", solver_type="midpoint", eta=1.0, s_noise=1.0, noise_device="gpu")
ADV2["8"] = N("SplitSigmas", sigmas=["80", 0], step=3)
ADV2["80"] = N("KarrasScheduler", steps=12, sigma_max=14.6, sigma_min=0.03, rho=7.0)
s2 = gp.trace(ADV2, "14")["samplers"][0]
check("a sampler node without a name says it by its kind; sigmas are followed back to the node that makes them",
      s2["sampler"] == "dpmpp_2m_sde" and s2["scheduler"] == "karras" and s2["steps"] == 12)

# ---------------------------------------------------------------- two passes: the first, the second as hi-res fix
TWO = json.loads(json.dumps(PLAIN))
TWO["30"] = N("LatentUpscaleBy", samples=["6", 0], upscale_method="bislerp", scale_by=1.5)
TWO["31"] = N("KSampler", model=["2", 0], positive=["3", 0], negative=["4", 0], latent_image=["30", 0], seed=5, steps=12,
              cfg=5.0, sampler_name="euler", scheduler="normal", denoise=0.45)
TWO["7"]["inputs"]["samples"] = ["31", 0]
tt = gp.trace(TWO, "9")
check("two samplers in a row: both found, the first pass first", [s["id"] for s in tt["samplers"]] == ["6", "31"] and tt["base_size"] == (1024, 768))
textt, _ = gp.build(tt, (1536, 1152))
check(f"the text describes the first pass, and the second the way A1111 writes hi-res fix ({textt.splitlines()[-1]!r})",
      "Steps: 28, Sampler: DPM++ 2M SDE" in textt and "Seed: 123456789012" in textt and "Size: 1024x768" in textt
      and "Denoising strength: 0.45, Hires resize: 1536x1152, Hires upscale: 1.5, Hires steps: 12" in textt)

check("…with what enlarged the picture, and the second pass's own sampler, schedule and CFG where they differ",
      "Hires upscaler: Latent (bislerp), Hires sampler: Euler, Hires schedule type: Normal, Hires CFG Scale: 5" in textt)

# a tiled upscale: a node that takes the decoded picture, enlarges it and samples it again in tiles (Ultimate SD Upscale)
USDU = json.loads(json.dumps(PLAIN))
USDU["40"] = N("UpscaleModelLoader", model_name="ESRGAN/4x-UltraSharp.pth")
USDU["41"] = N("UltimateSDUpscale", image=["7", 0], model=["2", 0], positive=["3", 0], negative=["4", 0], vae=["1", 2],
               upscale_model=["40", 0], upscale_by=2.0, seed=77, steps=20, cfg=6.5, sampler_name="dpmpp_2m_sde",
               scheduler="karras", denoise=0.3, mode_type="Linear", tile_width=1024, tile_height=1024)
USDU["9"]["inputs"]["images"] = ["41", 0]
tu = gp.trace(USDU, "9")
textu, missu = gp.build(tu, (2048, 1536))
check(f"a tiled upscaler fed the decoded picture: the first pass is found behind it ({[s['id'] for s in tu['samplers']]})",
      [s["id"] for s in tu["samplers"]] == ["6", "41"] and tu["base_size"] == (1024, 768) and missu == [])
check(f"…the first pass's settings, the upscale as hi-res fix with its upscale model ({textu.splitlines()[-1]!r})",
      "Steps: 28, Sampler: DPM++ 2M SDE, Schedule type: Karras, CFG scale: 6.5, Seed: 123456789012, Size: 1024x768" in textu
      and "Denoising strength: 0.3, Hires resize: 2048x1536, Hires upscale: 2, Hires steps: 20, Hires upscaler: 4x-UltraSharp" in textu
      and "Hires sampler" not in textu and "Hires CFG" not in textu)
check("…the prompt and the model are the first pass's", textu.startswith("a red fox, in snow") and "Model: juggernaut" in textu)

# tiled sampling with a plain sampler: decode, upscale with a model, encode in tiles, sample; the picture passes through
# a switch of another pack, whose inputs have names of their own
TIL = json.loads(json.dumps(PLAIN))
TIL["40"] = N("UpscaleModelLoader", model_name="4x_foolhardy_Remacri.safetensors")
TIL["41"] = N("ImageUpscaleWithModel", upscale_model=["40", 0], image=["7", 0])
TIL["42"] = N("Any Switch (rgthree)", any_01=["41", 0], any_02=["3", 0])
TIL["43"] = N("VAEEncodeTiled", pixels=["42", 0], vae=["1", 2], tile_size=512)
TIL["44"] = N("TiledDiffusion", model=["2", 0], method="MultiDiffusion", tile_width=1024, tile_height=1024)
TIL["45"] = N("KSampler", model=["44", 0], positive=["3", 0], negative=["4", 0], latent_image=["43", 0], seed=9, steps=16,
              cfg=6.5, sampler_name="dpmpp_2m_sde", scheduler="karras", denoise=0.35)
TIL["46"] = N("VAEDecodeTiled", samples=["45", 0], vae=["1", 2], tile_size=512)
TIL["9"]["inputs"]["images"] = ["46", 0]
tl = gp.trace(TIL, "9")
textl, _ = gp.build(tl, (4096, 3072))
check(f"a second sampler reached through a switch with its own input names: both passes ({[s['id'] for s in tl['samplers']]})",
      [s["id"] for s in tl["samplers"]] == ["6", "45"])
check(f"…written as hi-res fix ({textl.splitlines()[-1]!r})", "Steps: 28" in textl and "Seed: 123456789012" in textl and "Size: 1024x768" in textl
      and "Denoising strength: 0.35, Hires resize: 4096x3072, Hires upscale: 4, Hires steps: 16, Hires upscaler: 4x_foolhardy_Remacri" in textl)
# the walk prefers the picture's own inputs: a sampler that only made a ControlNet's hint picture is no earlier pass
SIDE = json.loads(json.dumps(PLAIN))
SIDE["50"] = N("KSampler", model=["2", 0], positive=["3", 0], negative=["4", 0], latent_image=["5", 0], seed=1, steps=3, cfg=1.0,
               sampler_name="euler", scheduler="simple", denoise=1.0)
SIDE["51"] = N("VAEDecode", samples=["50", 0], vae=["1", 2])
SIDE["52"] = N("ControlNetApplyAdvanced", positive=["3", 0], negative=["4", 0], control_net=["53", 0], image=["51", 0], strength=1.0)
SIDE["53"] = N("ControlNetLoader", control_net_name="cn.safetensors")
SIDE["6"]["inputs"]["positive"] = ["52", 0]
check("a sampler that only feeds the prompt side (a ControlNet's picture) isn't taken for an earlier pass",
      [s["id"] for s in gp.trace(SIDE, "9")["samplers"]] == ["6"])
# three passes: the one that enlarged the picture is the hi-res pass
THREE = json.loads(json.dumps(USDU))
THREE["60"] = N("FaceDetailer", image=["41", 0], model=["2", 0], positive=["3", 0], negative=["4", 0], vae=["1", 2], seed=3, steps=8,
                cfg=4.0, sampler_name="euler", scheduler="normal", denoise=0.5)
THREE["9"]["inputs"]["images"] = ["60", 0]
t3 = gp.trace(THREE, "9")
text3p, _ = gp.build(t3, (2048, 1536))
check(f"three passes (sampler, tiled upscale, a detailer): all found; hi-res fix is the pass that enlarged ({[s['id'] for s in t3['samplers']]})",
      [s["id"] for s in t3["samplers"]] == ["6", "41", "60"] and "Hires steps: 20, Hires upscaler: 4x-UltraSharp" in text3p and "Denoising strength: 0.3" in text3p)
check("a node with steps and a seed but no model (a noise picture) is no sampler",
      gp.trace({"1": N("NoiseImage", image=["2", 0], steps=4, seed=1), "2": N("LoadImage", image="x.png"), "9": N("Region-Genie_SaveImage", images=["1", 0])}, "9")["samplers"] == [])

# ---------------------------------------------------------------- other ways of upscaling, refiners, detailers (round 46)
K2 = dict(model=["2", 0], positive=["3", 0], negative=["4", 0], seed=222, steps=12, cfg=6.5, sampler_name="dpmpp_2m_sde", scheduler="karras", denoise=0.4)


def last_line(extra, save_from, size, change=None):
    g = json.loads(json.dumps(PLAIN))
    g.update(extra)
    g["9"]["inputs"]["images"] = save_from
    if change:
        change(g)
    tr = gp.trace(g, "9")
    return gp.build(tr, size)[0].splitlines()[-1], tr


UPM = {"19": N("UpscaleModelLoader", model_name="ESRGAN/4x-UltraSharp.pth"), "20": N("ImageUpscaleWithModel", upscale_model=["19", 0], image=["7", 0])}
ln, _ = last_line({"20": N("ImageScaleBy", image=["7", 0], upscale_method="lanczos", scale_by=2.0), "21": N("VAEEncode", pixels=["20", 0], vae=["1", 2]),
                   "22": N("KSampler", latent_image=["21", 0], **K2), "23": N("VAEDecode", samples=["22", 0], vae=["1", 2])}, ["23", 0], (2048, 1536))
check(f"the picture resized, encoded and sampled again: hi-res fix with the resize method ({ln!r})",
      "Size: 1024x768" in ln and "Denoising strength: 0.4, Hires resize: 2048x1536, Hires upscale: 2, Hires steps: 12, Hires upscaler: Lanczos" in ln)
ln, _ = last_line({**UPM, "20b": N("ImageScale", image=["20", 0], upscale_method="bicubic", width=2048, height=1536, crop="disabled"),
                   "21": N("VAEEncode", pixels=["20b", 0], vae=["1", 2]), "22": N("KSampler", latent_image=["21", 0], **K2),
                   "23": N("VAEDecode", samples=["22", 0], vae=["1", 2])}, ["23", 0], (2048, 1536))
check(f"an upscale model, then a resize to the wanted size: the upscaler is the model, not the resize ({ln!r})",
      "Hires resize: 2048x1536, Hires upscale: 2, Hires steps: 12, Hires upscaler: 4x-UltraSharp" in ln)
ln, tr = last_line(UPM, ["20", 0], (4096, 3072))
check(f"enlarged by an upscale model alone, nothing sampled again: the size it was made at, and the upscale as hi-res fix ({ln!r})",
      len(tr["samplers"]) == 1 and "Seed: 123456789012, Size: 1024x768" in ln and "Hires resize: 4096x3072, Hires upscale: 4, Hires upscaler: 4x-UltraSharp" in ln
      and "Denoising" not in ln and "Hires steps" not in ln)
ln, _ = last_line({"20": N("SeedVR2VideoUpscaler", images=["7", 0], seed=5, resolution=2160, dit=["21", 0]), "21": N("SeedVR2LoadDiTModel", model="seedvr2.safetensors")},
                  ["20", 0], (2880, 2160))
check(f"an upscaler of another pack that says neither model nor method: named by its node ({ln!r})",
      "Size: 1024x768" in ln and "Hires resize: 2880x2160, Hires upscale: 2.81, Hires upscaler: SeedVR2VideoUpscaler" in ln)
ln, tr = last_line({"20": N("PixelKSampleUpscalerProvider", scale_method="lanczos", model=["2", 0], vae=["1", 2], seed=222, steps=12, cfg=6.5, sampler_name="euler",
                            scheduler="normal", positive=["3", 0], negative=["4", 0], denoise=0.4, upscale_model_opt=["19", 0]),
                    "19": N("UpscaleModelLoader", model_name="4x_NMKD-Siax_200k.pth"),
                    "22": N("IterativeLatentUpscale", samples=["6", 0], upscale_factor=2.0, steps=3, upscaler=["20", 0]),
                    "23": N("VAEDecode", samples=["22", 0], vae=["1", 2])}, ["23", 0], (2048, 1536))
check(f"Impact Pack's iterative upscale: the sampler settings are read from its provider node ({ln!r})",
      [s["class"] for s in tr["samplers"]] == ["KSampler", "IterativeLatentUpscale"] and "Steps: 28" in ln
      and "Denoising strength: 0.4, Hires resize: 2048x1536, Hires upscale: 2, Hires steps: 12, Hires upscaler: 4x_NMKD-Siax_200k, Hires sampler: Euler, Hires schedule type: Normal" in ln)
ln, tr = last_line({"20": N("LatentUpscaleBy", samples=["6", 0], upscale_method="bislerp", scale_by=1.5), "22": N("KSampler", latent_image=["20", 0], **K2),
                    "23": N("VAEDecode", samples=["22", 0], vae=["1", 2]), "19": N("UpscaleModelLoader", model_name="4x-UltraSharp.pth"),
                    "24": N("UltimateSDUpscale", image=["23", 0], vae=["1", 2], upscale_model=["19", 0], upscale_by=2.0, **{**K2, "steps": 20, "denoise": 0.25})},
                   ["24", 0], (3072, 2304))
check(f"hi-res fix, then a tiled upscale: the hi-res size is the hi-res pass's own, the later upscale as A1111's Extras writes one ({ln!r})",
      len(tr["samplers"]) == 3 and "Size: 1024x768" in ln and "Denoising strength: 0.4, Hires resize: 1536x1152, Hires upscale: 1.5, Hires steps: 12, Hires upscaler: Latent (bislerp)" in ln
      and "Postprocess upscale by: 2, Postprocess upscaler: 4x-UltraSharp" in ln)
ln, _ = last_line({"20": N("LatentUpscaleBy", samples=["6", 0], upscale_method="nearest-exact", scale_by=1.5), "22": N("KSampler", latent_image=["20", 0], **K2),
                   "23": N("VAEDecode", samples=["22", 0], vae=["1", 2]), "19": N("UpscaleModelLoader", model_name="4x-UltraSharp.pth"),
                   "24": N("ImageUpscaleWithModel", upscale_model=["19", 0], image=["23", 0])}, ["24", 0], (6144, 4608))
check(f"hi-res fix, then an upscale model with nothing sampled: the same two groups ({ln!r})",
      "Hires resize: 1536x1152, Hires upscale: 1.5, Hires steps: 12, Hires upscaler: Latent, Postprocess upscale by: 4, Postprocess upscaler: 4x-UltraSharp" in ln)
ln, _ = last_line({"22": N("KSampler", latent_image=["6", 0], **K2), "23": N("VAEDecode", samples=["22", 0], vae=["1", 2])}, ["23", 0], (1024, 768))
check(f"a second pass at the same size: its strength and steps, no resize ({ln!r})", "Denoising strength: 0.4, Hires steps: 12" in ln and "Hires resize" not in ln and "Hires upscaler" not in ln)

# a base model and a refiner sharing the steps (two advanced samplers): A1111's Refiner fields, not hi-res fix
ADV = dict(positive=["3", 0], negative=["4", 0], noise_seed=111, steps=30, cfg=6.5, sampler_name="euler", scheduler="normal")


def refiner(g, same=False):
    g["6"] = N("KSamplerAdvanced", model=["2", 0], latent_image=["5", 0], add_noise="enable", start_at_step=0, end_at_step=24, return_with_leftover_noise="enable", **ADV)


REF = {"30": N("CheckpointLoaderSimple", ckpt_name="SDXL/sd_xl_refiner_1.0.safetensors"),
       "22": N("KSamplerAdvanced", model=["30", 0], latent_image=["6", 0], add_noise="disable", start_at_step=24, end_at_step=10000, return_with_leftover_noise="disable", **ADV),
       "23": N("VAEDecode", samples=["22", 0], vae=["1", 2])}
ln, tr = last_line(REF, ["23", 0], (1024, 768), refiner)
check(f"a refiner: its model and where it took over, the steps of the whole run, nothing written as hi-res fix ({ln!r})",
      "Steps: 30," in ln and "Seed: 111" in ln and "Model: juggernaut, Refiner: sd_xl_refiner_1.0, Refiner switch at: 0.8" in ln and "Hires" not in ln and "Denoising" not in ln)
same = json.loads(json.dumps(REF))
same["22"]["inputs"]["model"] = ["2", 0]
ln, _ = last_line(same, ["23", 0], (1024, 768), refiner)
check(f"one run split over two samplers with the same model: one pass, no refiner ({ln!r})", "Steps: 30," in ln and "Refiner" not in ln and "Hires" not in ln and "Denoising" not in ln)
ln, _ = last_line({**REF, "40": N("LatentUpscaleBy", samples=["22", 0], upscale_method="bislerp", scale_by=2.0), "41": N("KSampler", latent_image=["40", 0], **K2),
                   "23": N("VAEDecode", samples=["41", 0], vae=["1", 2])}, ["23", 0], (2048, 1536), refiner)
check(f"a refiner and hi-res fix after it: both ({ln!r})", "Refiner: sd_xl_refiner_1.0, Refiner switch at: 0.8, Denoising strength: 0.4, Hires resize: 2048x1536, Hires upscale: 2, Hires steps: 12" in ln)
with tempfile.TemporaryDirectory() as RD:
    rp = os.path.join(RD, "sd_xl_refiner_1.0.safetensors")
    open(rp, "wb").write(b"\0" * 16)
    json.dump({"sha256": "7440042BBD" + "0" * 54}, open(os.path.join(RD, "sd_xl_refiner_1.0.metadata.json"), "w"))
    g = json.loads(json.dumps(PLAIN))
    g.update(REF)
    refiner(g)
    g["9"]["inputs"]["images"] = ["23", 0]
    txt = gp.build(gp.trace(g, "9"), (1024, 768), path_of=lambda folder, name: rp if "refiner" in name else None)[0]
    check("the refiner's hash, where a metadata file has one, in A1111's brackets", "Refiner: sd_xl_refiner_1.0 [7440042bbd], Refiner switch at: 0.8" in txt)

# detailers: in the names of A1111's ADetailer extension
DET = {"50": N("UltralyticsDetectorProvider", model_name="bbox/face_yolov8m.pt"),
       "22": N("FaceDetailer", image=["7", 0], vae=["1", 2], bbox_detector=["50", 0], bbox_threshold=0.5, bbox_dilation=10, feather=5, **{**K2, "denoise": 0.5})}
ln, tr = last_line(DET, ["22", 0], (1024, 768))
check(f"a face detailer after one pass: ADetailer's fields, not hi-res fix ({ln!r})",
      "Hires" not in ln and "Denoising strength: 0.5" not in ln.replace("ADetailer denoising strength", "")
      and "ADetailer model: face_yolov8m.pt, ADetailer confidence: 0.5, ADetailer dilate erode: 10, ADetailer mask blur: 5, ADetailer denoising strength: 0.5, ADetailer use separate steps: True, ADetailer steps: 12" in ln)
ln, _ = last_line({**DET, "51": N("UltralyticsDetectorProvider", model_name="bbox/hand_yolov8s.pt"), "52": N("BboxDetectorSEGS", bbox_detector=["51", 0], image=["22", 0], threshold=0.4, dilation=4),
                   "53": N("DetailerForEach", image=["22", 0], segs=["52", 0], vae=["1", 2], feather=5, **{**K2, "steps": 28, "denoise": 0.35, "cfg": 4.0})}, ["53", 0], (1024, 768))
check(f"two detailers (the second given its areas by a detector node): the second with '2nd' after each name ({ln!r})",
      "ADetailer model: face_yolov8m.pt" in ln and "ADetailer model 2nd: hand_yolov8s.pt, ADetailer confidence 2nd: 0.4, ADetailer dilate erode 2nd: 4, ADetailer mask blur 2nd: 5, ADetailer denoising strength 2nd: 0.35, ADetailer use separate CFG scale 2nd: True, ADetailer CFG scale 2nd: 4" in ln
      and "ADetailer steps 2nd" not in ln)
ln, _ = last_line({"19": N("UpscaleModelLoader", model_name="4x-UltraSharp.pth"),
                   "41": N("UltimateSDUpscale", image=["7", 0], vae=["1", 2], upscale_model=["19", 0], upscale_by=2.0, **{**K2, "steps": 20, "denoise": 0.3}),
                   "22": {**DET["22"], "inputs": {**DET["22"]["inputs"], "image": ["41", 0]}}, "50": DET["50"]}, ["22", 0], (2048, 1536))
check(f"tiled upscale, then a detailer: hi-res fix for the upscale and ADetailer's fields for the detailer ({ln!r})",
      "Denoising strength: 0.3, Hires resize: 2048x1536, Hires upscale: 2, Hires steps: 20, Hires upscaler: 4x-UltraSharp" in ln and "ADetailer model: face_yolov8m.pt" in ln and "Postprocess" not in ln)


# ---------------------------------------------------------------- the pack's own nodes say what a run really used
RG = {
    "1": N("UNETLoader", unet_name="moss.safetensors"),
    "2": N("Region-Genie_Main", model=["1", 0], clip=["8", 0], width=512, height=512, scene_prompt_positive="typed __wild__",
           scene_prompt_negative="typed negative", paint_data="{}"),
    "3": N("KSampler", model=["2", 0], positive=["2", 1], negative=["2", 2], latent_image=["2", 3], seed=7, steps=9, cfg=1.0,
           sampler_name="euler", scheduler="simple", denoise=1.0),
    "4": N("VAEDecode", samples=["3", 0], vae=["9", 0]),
    "5": N("Region-Genie_SaveImage", images=["4", 0]),
}
MOSS = '{"scene": "a harbour", "elements": [{"caption": "a boat", "bbox": [0, 0, 10, 10]}]}'
gp.RUNS.clear()
t0 = gp.trace(RG, "5")
check("Region Genie in the workflow, nothing noted for the run yet: its typed fields", t0["positive"] == "typed __wild__" and t0["negative"] == "typed negative")
gp.record("2", prompt=MOSS, negative="filled negative", loras=[("whole/film.safetensors", 0.7), ("regions/boat.safetensors", 1.0),
                                                              ("regions/boat.safetensors", 0.4)], width=1280, height=720)
tr = gp.trace(RG, "5")
check("after a run: the 'prompt' output's exact text, the negative after wildcards, the LoRAs it applied (regional ones too)",
      tr["positive"] == MOSS and tr["negative"] == "filled negative" and [l[0] for l in tr["loras"]] == ["whole/film.safetensors", "regions/boat.safetensors", "regions/boat.safetensors"]
      and tr["model"]["name"] == "moss.safetensors")
textr, _ = gp.build(tr, (1280, 720))
check(f"a JSON prompt is written as it is, the LoRA tags on a line of their own, each LoRA once ({textr.splitlines()[:2]!r})",
      textr.startswith(MOSS + "\n<lora:film:0.7> <lora:boat:1>\nNegative prompt: filled negative\nSteps: 9,"))
# the 'prompt' output wired into a text encoder; a LoRA tag already in the prompt isn't added twice
RG2 = json.loads(json.dumps(RG))
RG2["6"] = N("CLIPTextEncode", clip=["8", 0], text=["2", 4])
RG2["3"]["inputs"]["positive"] = ["6", 0]
gp.record("2", prompt="a boat <lora:film:0.7>", negative="", loras=[("film.safetensors", 0.7)])
check("Region Genie's prompt text through a text encoder is found too; a tag that is in the prompt isn't added again",
      gp.build(gp.trace(RG2, "5"), (8, 8))[0].splitlines()[0] == "a boat <lora:film:0.7>")
# no sampler at all (a drawn or loaded image): nothing, unless the pack's node says a prompt
check("no sampler and no prompt: no text", gp.build(gp.trace({"1": N("LoadImage", image="x.png"), "2": N("Region-Genie_SaveImage", images=["1", 0])}, "2"), (8, 8)) == (None, []))
check("a workflow that isn't one: no text, no error", gp.build(gp.trace({}, "2"), (8, 8)) == (None, []) and gp.trace(None, None)["samplers"] == [])
# a ControlNet between the encoders and the sampler: each side keeps its own prompt; an emptied negative is empty
CN = json.loads(json.dumps(PLAIN))
CN["40"] = N("ControlNetApplyAdvanced", positive=["3", 0], negative=["4", 0], control_net=["41", 0], image=["42", 0], strength=1)
CN["6"]["inputs"].update(positive=["40", 0], negative=["40", 1])
tc = gp.trace(CN, "9")
check("through a node that passes both prompts on: each side its own", tc["positive"] == "a red fox, in snow" and tc["negative"] == "blurry")
CN["43"] = N("ConditioningZeroOut", conditioning=["3", 0])
CN["6"]["inputs"]["negative"] = ["43", 0]
check("a negative made by emptying the positive is no negative prompt", gp.trace(CN, "9")["negative"] == "")
check("a value with a comma is quoted, as A1111 does", 'Model: "a, b"' in gp.build(t, (8, 8), {"model_name": "a, b.safetensors"})[0])

# ---------------------------------------------------------------- hashes: only from files that already hold one
D = tempfile.mkdtemp(prefix="rg_hash_")
SHA = "ab12cd34ef" + "0" * 54


def model(name, body=b"\x00" * 64):
    p = os.path.join(D, name)
    with open(p, "wb") as f:
        f.write(body)
    return p


def sidecar(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f)


m1 = model("lm.safetensors")
sidecar(os.path.join(D, "lm.metadata.json"), {"file_name": "lm", "sha256": SHA, "civitai": {"files": [{"hashes": {"SHA256": "f" * 64}}]}})
check("LoRA Manager's <name>.metadata.json", gp.file_hash(m1) == "ab12cd34ef")
m2 = model("rg.safetensors")
sidecar(m2 + ".rgthree-info.json", {"file": "rg.safetensors", "sha256": SHA.upper()})
check("rgthree's <file>.rgthree-info.json", gp.file_hash(m2) == "ab12cd34ef")
m3 = model("sm.safetensors")
sidecar(os.path.join(D, "sm.cm-info.json"), {"ModelId": 5, "ModelName": "x", "Hashes": {"SHA256": "1234567890" + "a" * 54, "BLAKE3": "zz"}})
check("Stability Matrix's <name>.cm-info.json", gp.file_hash(m3) == "1234567890")
m4 = model("ch.safetensors")
sidecar(os.path.join(D, "ch.civitai.info"), {"files": [{"name": "other.safetensors", "hashes": {"SHA256": "e" * 64}},
                                                       {"name": "ch.safetensors", "hashes": {"SHA256": "9876543210" + "b" * 54}}]})
check("Civitai Helper's <name>.civitai.info: this file's own entry", gp.file_hash(m4) == "9876543210")
hdr = json.dumps({"__metadata__": {"sshs_model_hash": "0123456789abcdef" + "c" * 48}}).encode()
m5 = model("kohya.safetensors", struct.pack("<Q", len(hdr)) + hdr + b"\x00" * 32)
check("a hash in the file's own header (kohya trainers): 12 characters, as A1111 writes a LoRA's", gp.file_hash(m5) == "0123456789ab")
m6 = model("plain.safetensors", struct.pack("<Q", 2) + b"{}" + b"\x00" * 32)
check("no metadata file and no hash in the header: no hash (the file is never hashed)", gp.file_hash(m6) == "" and gp.file_hash(os.path.join(D, "nope")) == "" and gp.file_hash("") == "")
sidecar(os.path.join(D, "plain.metadata.json"), {"sha256": SHA})
check("a metadata file that appears later is found", gp.file_hash(m6) == "ab12cd34ef")
sidecar(os.path.join(D, "broken.metadata.json"), {"sha256": "not a hash"})
with open(os.path.join(D, "bad.metadata.json"), "w") as f:
    f.write("{ not json")
check("a broken metadata file is no error", gp.file_hash(model("broken.safetensors")) == "" and gp.file_hash(model("bad.safetensors")) == "")
paths = {("checkpoints", "SDXL/juggernaut.safetensors"): m1, ("loras", "style/ink.safetensors"): m5}
texth, _ = gp.build(t, (1024, 768), path_of=lambda folder, name: paths.get((folder, name)))
check(f"hashes in the text where a file gave one ({texth.splitlines()[-1]!r})", "Model hash: ab12cd34ef, Model: juggernaut" in texth
      and 'Lora hashes: "ink: 0123456789ab"' in texth)

# ---------------------------------------------------------------- the text in the saved files
RGB = np.zeros((16, 20, 3), np.float32)
RGB[..., 0] = 0.5
TXT = "a fox, 雪の中 <lora:ink:0.8>\nNegative prompt: blurry\nSteps: 20, Sampler: Euler a, Seed: 1, Size: 20x16, Version: ComfyUI"
WF = {"nodes": [], "links": []}


def user_comment(img):
    uc = img.getexif().get_ifd(0x8769).get(0x9286)
    return uc[8:].decode("utf-16-be") if isinstance(uc, bytes) and uc[:8] == b"UNICODE\x00" else None


for bits in (8, 16):
    png = Image.open(io.BytesIO(si.encode_png(RGB, None, 6, bits, si.png_text(PLAIN, {"workflow": WF}, TXT))))
    check(f"png {bits}-bit: 'parameters' holds the text (also text that isn't Latin-1), next to ComfyUI's prompt and workflow",
          png.info.get("parameters") == TXT and json.loads(png.info["workflow"]) == WF and json.loads(png.info["prompt"]) == PLAIN)
check("png: the settings text alone (no workflow data) is written too", si.png_text(None, None, TXT) == {"parameters": TXT})
ex = si.comfy_exif(PLAIN, {"workflow": WF}, TXT)
w = Image.open(io.BytesIO(si.encode_webp(RGB, None, False, 80, ex)))
check("webp: the text in EXIF UserComment, ComfyUI's tags as before", user_comment(w) == TXT and w.getexif()[0x010F] == "workflow:" + json.dumps(WF))
j = Image.open(io.BytesIO(si.encode_jpeg(RGB, 90, si.comfy_exif(None, None, TXT))))
check("jpeg: the text in EXIF UserComment, with no workflow in the file", user_comment(j) == TXT and 0x0110 not in j.getexif())
if features.check("avif"):
    a = Image.open(io.BytesIO(si.encode_avif(RGB, None, 80, ex)))
    check("avif: the text in EXIF UserComment", user_comment(a) == TXT)
check("no text: the files are as before", si.png_text(PLAIN, {"workflow": WF}) == si.png_text(PLAIN, {"workflow": WF}, None)
      and "parameters" not in si.png_text(PLAIN, {"workflow": WF}) and si.comfy_exif(None, None, None) is None)
stubs.comfy.cli_args.args.disable_metadata = True
check("ComfyUI started with --disable-metadata: no settings text either", si.png_text(PLAIN, None, TXT) is None and si.comfy_exif(None, None, TXT) is None)
stubs.comfy.cli_args.args.disable_metadata = False

# ---------------------------------------------------------------- the node
OUT = tempfile.mkdtemp(prefix="rg_out_")


def _gsip(prefix, out, w=0, h=0):
    full = os.path.join(out, os.path.dirname(os.path.normpath(prefix)))
    os.makedirs(full, exist_ok=True)
    return full, os.path.basename(os.path.normpath(prefix)), 1, os.path.dirname(os.path.normpath(prefix)), prefix


stubs.fp.get_output_directory = lambda: OUT
stubs.fp.get_save_image_path = _gsip
stubs.fp.get_full_path = lambda folder, name: paths.get((folder, name))
node = si.SaveImageRG()
IMGS = np.stack([RGB]).view(T)
DEF = dict(filename_prefix="p/a", format="png", png_compression=6, png_bit_depth="8-bit", webp_lossless=False,
           webp_quality=90, jpeg_quality=90, jpeg_extension=".jpg", jpeg_workflow="sidecar .json", avif_quality=80)


def saved(res):
    f = res["ui"]["images"][0]
    return Image.open(os.path.join(OUT, f["subfolder"], f["filename"]))


res = node.run(images=IMGS, **DEF, prompt=PLAIN, extra_pnginfo={"workflow": WF}, unique_id="9")
img = saved(res)
check(f"the node, switch left on: the saved PNG has the settings text ({img.info.get('parameters', '')[:40]!r} …)",
      img.info.get("parameters", "").startswith("a red fox, in snow <lora:ink:0.8>\nNegative prompt: blurry\nSteps: 28, Sampler: DPM++ 2M SDE")
      and "Size: 20x16" in img.info["parameters"] and "Model hash: ab12cd34ef" in img.info["parameters"] and json.loads(img.info["workflow"]) == WF)
check("…and tells the node what it wrote, with no note", res["ui"]["rg_saved"][0]["settings"] == img.info["parameters"] and res["ui"]["rg_saved"][0]["notes"] == [])
off = saved(node.run(images=IMGS, **DEF, prompt=PLAIN, extra_pnginfo={"workflow": WF}, unique_id="9", a1111_metadata=False))
check("switch off: only ComfyUI's own data", "parameters" not in off.info and "workflow" in off.info)
PRIM["6"]["inputs"]["seed"] = ["22", 0]
res2 = node.run(images=IMGS, **DEF, prompt=PRIM, extra_pnginfo=None, unique_id="9")
check(f"a seed the workflow doesn't show: a note on the node ({res2['ui']['rg_saved'][0]['notes']})",
      len(res2["ui"]["rg_saved"][0]["notes"]) == 1 and "seed" in res2["ui"]["rg_saved"][0]["notes"][0] and "Seed:" not in saved(res2).info["parameters"])
res3 = node.run(images=IMGS, **DEF, prompt=PRIM, extra_pnginfo=None, unique_id="9", seed=31, sampler_name=["heun"], model_name=object())
check("…connected to the node's seed input: written, no note; a connected value that is no text or number is ignored",
      "Seed: 31" in saved(res3).info["parameters"] and "Sampler: Heun" in saved(res3).info["parameters"] and res3["ui"]["rg_saved"][0]["notes"] == []
      and "Model: juggernaut" in saved(res3).info["parameters"])
jp = node.run(images=IMGS, **{**DEF, "format": "jpeg"}, prompt=PLAIN, extra_pnginfo={"workflow": WF}, unique_id="9")
jimg = saved(jp)
check("jpeg with the workflow in a .json next to it: the settings text is in the JPEG itself", user_comment(jimg).startswith("a red fox")
      and 0x010F not in jimg.getexif() and any(f["name"].endswith(".json") for f in jp["ui"]["rg_saved"][0]["files"]))
nothing = node.run(images=IMGS, **DEF, prompt={"1": N("LoadImage", image="x.png"), "9": N("Region-Genie_SaveImage", images=["1", 0])},
                   extra_pnginfo=None, unique_id="9")
check("an image no sampler made: no settings text, no note", "parameters" not in saved(nothing).info and nothing["ui"]["rg_saved"][0]["notes"] == []
      and nothing["ui"]["rg_saved"][0]["settings"] == "")
check("the optional inputs are declared, and an 'any' input takes every kind of output",
      all(k in si.SaveImageRG.INPUT_TYPES()["optional"] for k in ("a1111_metadata", "positive_prompt", "negative_prompt", "seed", "steps", "cfg", "sampler_name", "scheduler", "denoise", "model_name"))
      and not (si.ANY != "COMBO") and not (si.ANY != "STRING"))

# Tiled Upscale (Region Genie): the upscale model is a file name on the node itself
OWN = json.loads(json.dumps(PLAIN))
OWN["41"] = N("Region-Genie_TiledUpscale", image=["7", 0], model=["2", 0], positive=["3", 0], negative=["4", 0], vae=["1", 2],
              upscale_model="ESRGAN/4x-UltraSharp.pth", upscale_by=2.0, seed=77, steps=20, cfg=6.5, sampler_name="euler",
              scheduler="normal", denoise=0.2, tile_width=1024, tile_height=1024)
OWN["9"]["inputs"]["images"] = ["41", 0]
texto, _ = gp.build(gp.trace(OWN, "9"), (2048, 1536))
check(f"an upscale model named on the upscaling node itself is the hi-res upscaler ({texto.splitlines()[-1][-150:]!r})", "Hires upscaler: 4x-UltraSharp" in texto)
OWN["41"]["inputs"]["upscale_model"] = "none"
texto, _ = gp.build(gp.trace(OWN, "9"), (2048, 1536))
check("…and 'none' is no upscale model", "4x-UltraSharp" not in texto)

if __name__ == "__main__":
    print("\nall passed" if not fails else f"\n{len(fails)} failed")
    sys.exit(1 if fails else 0)
