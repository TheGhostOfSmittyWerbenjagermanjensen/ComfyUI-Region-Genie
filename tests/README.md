# Tests

None of these need a GPU. Screenshots go to `tests/out/` (not committed).

| What | How | Needs |
|---|---|---|
| Python, stubbed (`test_edit_mode.py`, `test_shapes_import.py`, `test_hidden_regions.py`, `test_prompt_format.py`, `test_save_image.py`, `test_model_paths.py`: model files by full path, the folder browser's listing; `test_i18n.py`: every language in `locales/` against the English reference `tests/i18n_en/`) | `bash tests/run_py.sh` | numpy, Pillow, scipy |
| Editor in a stub page (`ui_*.cjs`) | `bash tests/run_ui.sh` | Node, `npm i -D playwright`, `npx playwright install chromium` |
| Control against real ComfyUI code (`test_control.py`): MOSS / Flux.1 / ControlNet / Anima paths, maps, region masks | `COMFY_DIR=… python3 tests/test_control.py` | a ComfyUI checkout and torch (no model files) |
| Select object against real ComfyUI code (`test_select.py`) | see below | a ComfyUI checkout, torch, the SAM 3.1 checkpoint (or the random-weight fixture) |
| Smoke test in the real ComfyUI frontend (`real_smoke.cjs [vue]`) | see below | a running ComfyUI with this pack in `custom_nodes` |
| A real run, size row, old workflows, region eye, wildcards (`real_run_wildcards.cjs [vue]`): size row, old workflows, a real run, region eye, wildcards | see below | a running ComfyUI with this pack and ComfyUI Impact Pack; no model files |
| Save Image (Region Genie) in the real ComfyUI (`real_save_image.cjs [vue]`): fields per format, Settings defaults, a run per format, the size readout, `%date%` tokens, the files and the JPEG `.json` loading their workflow back, transparency | `COMFY_DIR=… node tests/real_save_image.cjs [vue]` | a running ComfyUI with this pack; `COMFY_DIR` for its output folder; no model files |
| The LLM presets in Settings and Browse… in the LLM settings (`real_llm_settings.cjs [vue]`) | `COMFY_DIR=… node tests/real_llm_settings.cjs [vue]` | a running ComfyUI with this pack; it resets the preset library and puts the old one back |
| Settings dialog (`real_settings.cjs`): every Region Genie setting shows, also with LoRA / ControlNet names containing `@ { } | % $` or a Windows-style `sub\@author` (a backslash); a 10 000-LoRA library must not slow the tab (under 5 s), the dropdowns fill when pointed at; every model-file setting has Browse… with the switch on, and Browse… to a folder outside ComfyUI saves the full path (it makes and removes `rgtest_outside` next to COMFY_DIR) | `COMFY_DIR=… node tests/real_settings.cjs` | a running ComfyUI with this pack; adds and removes a few empty files in its models folders |
| Translations in the real ComfyUI (`real_i18n.cjs [vue] [language …]`): the English reference is current (`i18n_extract.cjs --check`; without `--check` it rewrites `tests/i18n_en/`), and per language: every text passes ComfyUI's translation engine, titles / names / dropdown choices show translated, values stay English, the Settings dialog shows every translated name | `node tests/real_i18n.cjs [vue]` | a running ComfyUI with this pack, started after the locale files last changed; it switches ComfyUI's language and puts English back |
| Tooltip rules (`real_tooltips.cjs [vue]`, rules in `tooltip_rules.cjs`): every node / Settings / editor tooltip has one item per line and capitalized sentences | `node tests/real_tooltips.cjs [vue]` | a running ComfyUI with this pack; no model files |
| Fields, pop-ups, footer, Edit rows (`real_fields_popups.cjs [vue]`): number field widths, tooltip audit, presets, model dropdown / format / background, pop-ups, divider, tool strip | see below | a running ComfyUI with this pack; no model files |

## Real ComfyUI (CPU)

**One command** (ComfyUI v0.45.2, torch from PyPI, ComfyUI Impact Pack, this pack linked into `custom_nodes`, the test wildcard; about 5 GB, a few minutes; safe to run again):

```bash
bash tests/setup_real_comfy.sh --start
```

Then `node tests/real_run_wildcards.cjs`, `node tests/real_run_wildcards.cjs vue`, `node tests/real_fields_popups.cjs`, `node tests/real_fields_popups.cjs vue` and `COMFY_DIR=/tmp/comfy_src python3 tests/test_control.py`. Options: a folder as the first argument (default `/tmp/comfy_src`), `COMFY_TAG` for another ComfyUI release, `COMFY_PORT`. The manual steps it does:


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

Smoke test: start ComfyUI with `--cpu --listen 127.0.0.1 --port 8188` and an `extra_model_paths.yaml` pointing at `/tmp/comfy_models`, copy a test image to `input/rg_test.png`, then `node tests/real_smoke.cjs` (legacy) and `node tests/real_smoke.cjs vue` (Nodes 2.0).

Round 9 (`real_run_wildcards.cjs`): clone ComfyUI-Impact-Pack into `custom_nodes` too (`pip install` its requirements without the two SAM lines, plus `segment-anything`), add a wildcard file `custom_nodes/ComfyUI-Impact-Pack/wildcards/rgtest/color.txt` (a few colors, one per line), start ComfyUI with `--cpu`, then `node tests/real_run_wildcards.cjs` and `node tests/real_run_wildcards.cjs vue`. No model files are needed (the run only produces the color map). Without Impact Pack the wildcard checks are skipped.
