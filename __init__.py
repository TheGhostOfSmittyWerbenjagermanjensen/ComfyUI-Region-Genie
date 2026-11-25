"""
Region Genie
  Region Genie                    layered region painter -> color map, masks, layouts, regional LoRAs
  Mask Picker                     mask batch -> one mask + its prompt
  BBoxes to Masks                 bbox layouts -> masks + per-box prompts
  Regional LoRAs                  several regional LoRAs + their conditioning in one node
  Create Hook LoRA (Quantized)    hook LoRA that works on int8/fp8 models
  Tiled Upscale / Tiled Diffusion upscaling in blended tiles (Mixture of Diffusers)
"""
from .bbox_masks import BBoxesToMasks, MaskPicker
from .region_genie import RegionGenie
from .regional_lora import CreateHookLoRAQuantized, RegionalLoRAs
from .save_image import SaveImageRG
from .tiled_diffusion import TiledDiffusionRG, TiledUpscaleRG
from . import lora_triggers  # noqa: F401  (registers the trigger-word route)
from . import llm_enhance  # noqa: F401  (LLM Prompt Enhancer routes)
from . import region_select  # noqa: F401  (Select object: SAM 3.1 routes)
from . import pose_detect  # noqa: F401  (the Pose tool's "From the image": the SDPose route)
from . import wildcards  # noqa: F401  (wildcards through Impact Pack: list / preview routes)
from . import model_paths  # noqa: F401  (model files anywhere: the Settings folder browser route)

WEB_DIRECTORY = "./js"

ICON = " ✨"

# Node IDs: their lengths set the order in node search for "Region Genie" (ComfyUI ranks equal matches by the
# shorter name): Region Genie (17), Mask Picker (23), BBoxes to Masks (24), Regional LoRAs (26),
# Create Hook LoRA (27); Save Image (22) comes second.
NODES = [
    ("Region-Genie_Main", RegionGenie, "Region Genie"),
    ("Region-Genie_MaskPicker", MaskPicker, "Mask Picker"),
    ("Region-Genie_BBoxToMasks", BBoxesToMasks, "BBoxes to Masks"),
    ("Region-Genie_RegionalLoRAs", RegionalLoRAs, "Regional LoRAs"),
    ("Region-Genie_CreateHookLoRA", CreateHookLoRAQuantized, "Create Hook LoRA (Quantized)"),
    ("Region-Genie_SaveImage", SaveImageRG, "Save Image (Region Genie)"),
    ("Region-Genie_TiledUpscale", TiledUpscaleRG, "Tiled Upscale (Region Genie)"),
    ("Region-Genie_TiledDiffusion", TiledDiffusionRG, "Tiled Diffusion (Region Genie)"),
]


# extra words node search matches (every node: the pack and what it is for)
_COMMON = ["Region Genie", "RegionGenie", "Region-Genie", "Region_Genie", "genie", "regional", "region", "regions",
           "mask", "masks", "MOSS", "MOSS-Image", "MOSS Image", "MOSSImage", "Ideogram", "Ideogram 4", "Krea",
           "Krea 2", "Krea2", "layout", "map", "canvas",
           "bbox", "bounding box", "regional prompt", "regional lora", "area"]
_ALIASES = {
    RegionGenie: ["color map", "colour map", "region painter", "paint regions",
                  "draw regions", "segmentation map", "layout editor", "layout prompt", "MOSS layout",
                  "Ideogram layout", "elements", "regional LoRA", "region editor", "mask editor", "mask painter",
                  "color palette", "brush", "shapes", "LLM", "prompt enhancer", "SAM", "SAM 3", "SAM3",
                  "segment anything", "select object", "magic wand"],
    MaskPicker: ["pick mask", "select mask", "mask from batch", "mask index", "mask selector", "region prompt"],
    BBoxesToMasks: ["bbox to mask", "bboxes", "boxes to masks", "bounding boxes to masks", "box mask",
                    "elements to masks", "region masks"],
    RegionalLoRAs: ["regional LoRAs", "LoRA", "LoRAs", "multi LoRA", "LoRA mask", "masked LoRA",
                    "hook LoRA", "hook LoRAs", "runtime LoRA", "quantized LoRA",
                    "int8", "fp8", "trigger words"],
    SaveImageRG: ["save", "save image", "export image", "output image", "png", "jpeg", "jpg", "webp", "avif", "exr", "hdr",
                  "compression", "compress", "quality", "file size", "transparency", "alpha"],
    TiledUpscaleRG: ["upscale", "upscaler", "tiled upscale", "tiled diffusion", "mixture of diffusers", "multidiffusion",
                     "hires fix", "high resolution", "tile", "tiles", "ultimate upscale", "detail"],
    TiledDiffusionRG: ["tiled diffusion", "mixture of diffusers", "multidiffusion", "tile", "tiles", "tiled sampling",
                       "upscale", "high resolution"],
    CreateHookLoRAQuantized: ["hook LoRA", "LoRA", "regional LoRA", "LoRA mask", "masked LoRA", "runtime LoRA",
                              "quantized LoRA", "int8", "fp8", "LoRA hook", "Create Hook LoRA"],
}
for _cls, _extra in _ALIASES.items():
    _seen, _out = set(), []
    for _a in _extra + _COMMON:
        if _a.lower() not in _seen:
            _seen.add(_a.lower())
            _out.append(_a)
    _cls.SEARCH_ALIASES = _out

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
for _id, _cls, _name in NODES:
    NODE_CLASS_MAPPINGS[_id] = _cls
    NODE_DISPLAY_NAME_MAPPINGS[_id] = _name + ICON
