"""Image Compare (Region Genie): shows two or more images in one node, to compare them with a slider or by flipping
between them with the keys (js/image_compare.js draws it).

The node takes any number of image inputs (image_1, image_2, …; the script adds a free one after the last connected
one). Every image of a batch counts as a picture of its own, in input order. The pictures are written to ComfyUI's
temp folder, as its own Preview Image does, and their names are sent to the page under "rg_compare" (not "images":
ComfyUI would then draw its own preview into the node as well).
"""
import logging
import re

LOG = "[Region Genie]"
_NAME = re.compile(r"^image_(\d+)$")
TIP = "An image, or a batch of images: every image of a batch counts as a picture of its own. A free input is added when the last one gets a cable."


class _Images(dict):
    """The optional inputs: image_1 and image_2 are listed; any other image_N is accepted too (the page adds them)."""

    def __contains__(self, key):
        return isinstance(key, str) and bool(_NAME.match(key))

    def __getitem__(self, key):
        if dict.__contains__(self, key):
            return dict.__getitem__(self, key)
        if key in self:
            return ("IMAGE", {"tooltip": TIP})
        raise KeyError(key)

    def get(self, key, default=None):
        return self[key] if key in self else default


def ordered(inputs):
    """[(input number, value)] for the connected image_N inputs, by number."""
    out = []
    for k, v in (inputs or {}).items():
        m = _NAME.match(str(k))
        if m and v is not None:
            out.append((int(m.group(1)), v))
    return sorted(out, key=lambda x: x[0])


class ImageCompareRG:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}, "optional": _Images({"image_1": ("IMAGE", {"tooltip": TIP}), "image_2": ("IMAGE", {"tooltip": TIP})})}

    RETURN_TYPES = ()
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "Region Genie"
    DESCRIPTION = ("Shows two or more images in one node to compare them. Move the pointer across the picture: the "
                   "picture before the chosen one is left of the pointer, the chosen one right of it. The number keys "
                   "and the arrow keys choose the picture while the pointer is over the node.")

    def run(self, **inputs):
        import nodes
        pics = []
        for n, image in ordered(inputs):
            try:
                saved = nodes.PreviewImage().save_images(image, "rg.compare")["ui"]["images"]
            except Exception as e:  # one input that can't be shown doesn't stop the others
                logging.warning(f"{LOG} Image Compare: image_{n} could not be shown: {e}")
                continue
            for i, s in enumerate(saved):
                pics.append({"filename": s.get("filename"), "subfolder": s.get("subfolder", ""), "type": s.get("type", "temp"),
                             "input": n, "index": i})
        return {"ui": {"rg_compare": pics}}
