"""
Region Genie
  Region Genie                    layered region painter -> color map, masks, layouts, regional LoRAs
  Mask Picker                     mask batch -> one mask + its prompt
  BBoxes to Masks                 bbox layouts -> masks + per-box prompts
  Regional LoRAs                  several regional LoRAs + their conditioning in one node
  Create Hook LoRA (Quantized)    hook LoRA that works on int8/fp8 models
"""
import logging as _logging
import os as _os

# Files that were renamed in this version. Unzipping the new version over an old copy leaves them behind, and
# ComfyUI loads every .js file in the js folder, so the old copies would register a second, outdated editor.
# Remove them before the frontend asks for the extension list (only these exact files in this pack's folder).
_OBSOLETE = ["js/color_map_layout.js", "js/hook_loras.js", "js/rmk_shared.js", "js/rmk_llm.js",
             "js/rmk_colorpicker.js", "color_map_layout.py", "hook_lora.py"]
_here = _os.path.dirname(_os.path.abspath(__file__))
for _rel in _OBSOLETE:
    _p = _os.path.join(_here, *_rel.split("/"))
    if _os.path.isfile(_p):
        try:
            _os.remove(_p)
            _logging.info(f"[Region Genie] removed {_rel}: an old copy of a file that was renamed in this version")
        except OSError as _e:
            _logging.warning(f"[Region Genie] please delete {_p} (an old copy of a renamed file): {_e}")

from .bbox_masks import BBoxesToMasks, MaskPicker
from .region_genie import RegionGenie
from .regional_lora import CreateHookLoRAQuantized, RegionalLoRAs
from .save_image import SaveImageRG
from . import lora_triggers  # noqa: F401  (registers the trigger-word route)
from . import llm_enhance  # noqa: F401  (LLM Prompt Enhancer routes)
from . import region_select  # noqa: F401  (Select object: SAM 3.1 routes)
from . import wildcards  # noqa: F401  (wildcards through Impact Pack: list / preview routes)

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
]

# IDs used before the pack was renamed: still registered so saved workflows load, but marked deprecated, so
# node search doesn't list them. To be removed in a later version.
LEGACY_IDS = {
    "RegionalMaskKit_ColorMap": RegionGenie,
    "RegionalMaskKit_MaskPicker": MaskPicker,
    "RegionalMaskKit_BBoxesToMasks": BBoxesToMasks,
    "RegionalMaskKit_CreateHookLoRAs": RegionalLoRAs,
    "RegionalMaskKit_CreateHookLoRASingle": CreateHookLoRAQuantized,
}

# extra words node search matches (every node: the pack and what it is for)
_COMMON = ["Region Genie", "RegionGenie", "Region-Genie", "Region_Genie", "genie", "regional", "region", "regions",
           "mask", "masks", "MOSS", "MOSS-Image", "MOSS Image", "MOSSImage", "Ideogram", "Ideogram 4", "Krea",
           "Krea 2", "Krea2", "layout", "map", "canvas",
           "bbox", "bounding box", "regional prompt", "regional lora", "area",
           "Regional Mask Kit", "RegionalMaskKit"]                  # the pack's old name (remove later)
_ALIASES = {
    RegionGenie: ["color map", "colour map", "Color Map to Layout", "region painter", "paint regions",
                  "draw regions", "segmentation map", "layout editor", "layout prompt", "MOSS layout",
                  "Ideogram layout", "elements", "regional LoRA", "region editor", "mask editor", "mask painter",
                  "color palette", "brush", "shapes", "LLM", "prompt enhancer", "SAM", "SAM 3", "SAM3",
                  "segment anything", "select object", "magic wand"],
    MaskPicker: ["pick mask", "select mask", "mask from batch", "mask index", "mask selector", "region prompt"],
    BBoxesToMasks: ["bbox to mask", "bboxes", "boxes to masks", "bounding boxes to masks", "box mask",
                    "elements to masks", "region masks"],
    RegionalLoRAs: ["regional LoRAs", "LoRA", "LoRAs", "multi LoRA", "LoRA mask", "masked LoRA",
                    "hook LoRA", "hook LoRAs", "Create Hook LoRAs", "runtime LoRA", "quantized LoRA",
                    "int8", "fp8", "trigger words"],
    SaveImageRG: ["save", "save image", "export image", "output image", "png", "jpeg", "jpg", "webp", "avif",
                  "compression", "compress", "quality", "file size", "transparency", "alpha"],
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
_names = {cls: name for _, cls, name in NODES}
for _id, _cls in LEGACY_IDS.items():
    NODE_CLASS_MAPPINGS[_id] = type(_cls.__name__ + "Legacy", (_cls,), {"DEPRECATED": True, "SEARCH_ALIASES": []})
    NODE_DISPLAY_NAME_MAPPINGS[_id] = _names[_cls] + ICON
