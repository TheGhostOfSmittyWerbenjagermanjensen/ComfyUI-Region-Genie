"""Image Compare (Region Genie), the Python side: which inputs it takes, their order, a batch counted per image."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from stubs import check, fails  # noqa: E402
import numpy as np  # noqa: E402

from rgpack import image_compare as ic  # noqa: E402

opt = ic.ImageCompareRG.INPUT_TYPES()["optional"]
check("the node lists image_1 and image_2", list(opt) == ["image_1", "image_2"] and opt["image_1"][0] == "IMAGE")
check("and takes any other image_N the page adds", "image_3" in opt and "image_27" in opt and opt["image_27"][0] == "IMAGE" and opt.get("image_9")[0] == "IMAGE")
check("but nothing else", "mask" not in opt and "image_" not in opt and "image_x" not in opt and opt.get("mask") is None)
got = ic.ordered({"image_10": "j", "image_2": "b", "image_1": "a", "image_3": None, "other": "x"})
check("connected inputs come in the order of their numbers, not of their names; an empty one is left out", got == [(1, "a"), (2, "b"), (10, "j")])

# the run: every image of a batch is a picture of its own, in input order
import types  # noqa: E402


class _Preview:
    n = 0

    def save_images(self, images, prefix):
        out = []
        for _ in range(len(images)):
            _Preview.n += 1
            out.append({"filename": f"{prefix}_{_Preview.n:05d}_.png", "subfolder": "", "type": "temp"})
        return {"ui": {"images": out}}


sys.modules["nodes"] = types.SimpleNamespace(PreviewImage=_Preview)
img = lambda n: np.zeros((n, 8, 8, 3), np.float32)  # noqa: E731
res = ic.ImageCompareRG().run(image_2=img(3), image_1=img(1), image_4=img(2))
pics = res["ui"]["rg_compare"]
check("six pictures from three inputs (1 + 3 + 2), in input order", [(p["input"], p["index"]) for p in pics] == [(1, 0), (2, 0), (2, 1), (2, 2), (4, 0), (4, 1)])
check("each with its file in the temp folder", all(p["filename"].endswith(".png") and p["type"] == "temp" for p in pics) and len({p["filename"] for p in pics}) == 6)
check("ComfyUI's own preview is not asked for (no 'images' in the result)", "images" not in res["ui"])
check("no input connected: nothing to show, no error", ic.ImageCompareRG().run()["ui"]["rg_compare"] == [])

print("\n%d failed" % len(fails) if fails else "\nALL PASS")
sys.exit(1 if fails else 0)
