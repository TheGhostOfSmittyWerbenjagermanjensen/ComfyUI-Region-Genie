# Tests

None of these need a GPU. Screenshots go to `tests/out/` (not committed).

| What | How | Needs |
|---|---|---|
| Python, stubbed (`test_round5.py`, `test_round6.py`, `test_round9.py`) | `bash tests/run_py.sh` | numpy, Pillow, scipy |
| Editor in a stub page (`ui_test*.cjs`) | `bash tests/run_ui.sh` | Node, `npm i -D playwright`, `npx playwright install chromium` |
| Control against real ComfyUI code (`test_control.py`): MOSS / Flux.1 / ControlNet / Anima paths, maps, region masks | `COMFY_DIR=… python3 tests/test_control.py` | a ComfyUI checkout and torch (no model files) |
| Select object against real ComfyUI code (`test_select.py`) | see below | a ComfyUI checkout, torch, the SAM 3.1 checkpoint (or the random-weight fixture) |
| Smoke test in the real ComfyUI frontend (`real_comfy.cjs [vue]`) | see below | a running ComfyUI with this pack in `custom_nodes` |
| Round 9 in the real ComfyUI (`real_comfy9.cjs [vue]`): size row, old workflows, a real run, region eye, wildcards | see below | a running ComfyUI with this pack and ComfyUI Impact Pack; no model files |

## Real ComfyUI (CPU)

**One command** (ComfyUI v0.45.2, torch from PyPI, ComfyUI Impact Pack, this pack linked into `custom_nodes`, the test wildcard; about 5 GB, a few minutes; safe to run again):

```bash
bash tests/setup_real_comfy.sh --start
```

Then `node tests/real_comfy9.cjs`, `node tests/real_comfy9.cjs vue` and `COMFY_DIR=/tmp/comfy_src python3 tests/test_control.py`. Options: a folder as the first argument (default `/tmp/comfy_src`), `COMFY_TAG` for another ComfyUI release, `COMFY_PORT`. The manual steps it does:


```bash
git clone --depth 1 https://github.com/Comfy-Org/ComfyUI.git /tmp/comfy_src
pip install torch torchvision                       # from PyPI; runs on CPU
pip install -r /tmp/comfy_src/requirements.txt
ln -s "$PWD/.." /tmp/comfy_src/custom_nodes/ComfyUI-Region-Genie
```

SAM 3.1 model: the real file is `sam3.1_multiplex_fp16.safetensors` from huggingface.co/Comfy-Org/sam3.1. When huggingface.co can't be reached, `make_fake_sam.py` writes a checkpoint with the real architecture and key layout but random weights (masks are meaningless; it tests the plumbing):

```bash
mkdir -p /tmp/comfy_models/checkpoints
COMFY_DIR=/tmp/comfy_src python3 tests/make_fake_sam.py /tmp/comfy_models/checkpoints/sam3.1_multiplex_fp16.safetensors
COMFY_DIR=/tmp/comfy_src RG_MODELS=/tmp/comfy_models python3 tests/test_select.py      # ~2 min on CPU
```

Smoke test: start ComfyUI with `--cpu --listen 127.0.0.1 --port 8188` and an `extra_model_paths.yaml` pointing at `/tmp/comfy_models`, copy a test image to `input/rg_test.png`, then `node tests/real_comfy.cjs` (legacy) and `node tests/real_comfy.cjs vue` (Nodes 2.0).

Round 9 (`real_comfy9.cjs`): clone ComfyUI-Impact-Pack into `custom_nodes` too (`pip install` its requirements without the two SAM lines, plus `segment-anything`), add a wildcard file `custom_nodes/ComfyUI-Impact-Pack/wildcards/rgtest/color.txt` (a few colors, one per line), start ComfyUI with `--cpu`, then `node tests/real_comfy9.cjs` and `node tests/real_comfy9.cjs vue`. No model files are needed (the run only produces the color map). Without Impact Pack the wildcard checks are skipped.
