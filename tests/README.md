# Tests

None of these need a GPU. Screenshots go to `tests/out/` (not committed).

| What | How | Needs |
|---|---|---|
| Python, stubbed (`test_edit_mode.py`, `test_shapes_import.py`, `test_hidden_regions.py`, `test_prompt_format.py`, `test_save_image.py`, `test_model_paths.py`: model files by full path, the folder browser's listing; `test_i18n.py`: every language in `locales/` against the English reference `tests/i18n_en/`) | `bash tests/run_py.sh` | numpy, Pillow, scipy |
| Editor in a stub page (`ui_*.cjs`; `ui_hints_notes.cjs`: the hints on the canvas, the start card, Clear all, the run-notes button, shortcuts over the whole editor; `ui_region_rows.cjs`: the short region row and the options line of an opened region; `ui_labels_colors_drag.cjs`: the prompt inside its region, the region colors and their Setting, drag to reorder; `ui_large_editor.cjs`: the large editor; `ui_review_items.cjs`: the pack's own tooltip, the shortcut list and changing its keys, the canvas's right-click menu, the click areas of small controls, no button labelled with a bare symbol; `ui_popup_text.cjs`: the pop-up editors' text (Enter is a new line, Esc and the close button keep the text, Undo / Redo and their steps, the buttons' order and click areas, no browser tooltip on a pop-up's buttons) and the shortcut list in a low and a narrow window; `ui_load_order.cjs`: the pack starts whichever of its script files is loaded first, i.e. no two files import each other) | `bash tests/run_ui.sh` | Node, `npm i -D playwright`, `npx playwright install chromium` |
| Control against real ComfyUI code (`test_control.py`): MOSS / Flux.1 / ControlNet / Anima paths, maps, region masks | `COMFY_DIR=… python3 tests/test_control.py` | a ComfyUI checkout and torch (no model files) |
| Select object against real ComfyUI code (`test_select.py`) | see below | a ComfyUI checkout, torch, the SAM 3.1 checkpoint (or the random-weight fixture) |
| Smoke test in the real ComfyUI frontend (`real_smoke.cjs [vue]`) | see below | a running ComfyUI with this pack in `custom_nodes` |
| A real run, size row, old workflows, region eye, wildcards (`real_run_wildcards.cjs [vue]`): size row, old workflows, a real run, region eye, wildcards | see below | a running ComfyUI with this pack and ComfyUI Impact Pack; no model files |
| Save Image (Region Genie) in the real ComfyUI (`real_save_image.cjs [vue]`): fields per format, Settings defaults, a run per format, the size readout, `%date%` tokens, the files and the JPEG `.json` loading their workflow back, transparency | `COMFY_DIR=… node tests/real_save_image.cjs [vue]` | a running ComfyUI with this pack; `COMFY_DIR` for its output folder; no model files |
| The LLM presets in Settings and Browse… in the LLM settings (`real_llm_settings.cjs [vue]`) | `COMFY_DIR=… node tests/real_llm_settings.cjs [vue]` | a running ComfyUI with this pack; it resets the preset library and puts the old one back |
| Settings dialog (`real_settings.cjs`): every Region Genie setting shows, also with LoRA / ControlNet names containing `@ { } | % $` or a Windows-style `sub\@author` (a backslash); a 10 000-LoRA library must not slow the tab (under 5 s), the dropdowns fill when pointed at; every model-file setting has Browse… with the switch on, and Browse… to a folder outside ComfyUI saves the full path (it makes and removes `rgtest_outside` next to COMFY_DIR) | `COMFY_DIR=… node tests/real_settings.cjs` | a running ComfyUI with this pack; adds and removes a few empty files in its models folders |
| Translations in the real ComfyUI (`real_i18n.cjs [vue] [language …]`): the English reference is current (`i18n_extract.cjs --check`; without `--check` it rewrites `tests/i18n_en/`), and per language: every text passes ComfyUI's translation engine, titles / names / dropdown choices show translated, values stay English, the Settings dialog shows every translated name | `node tests/real_i18n.cjs [vue]` | a running ComfyUI with this pack, started after the locale files last changed; it switches ComfyUI's language and puts English back |
| **Pop-up lists and pop-ups, for every text field** (`real_layering.cjs [vue]`): in each place a text can be typed (scene prompts and a region's prompt on the node, their pop-up editors, the Regional LoRAs node's two prompts and a row's words with their pop-up editors, the large editor's scene boxes, region prompt and region pop-up) the tag autocomplete list and the wildcard list open, lie inside the window, start under the line being typed and have nothing over them; the pack's own tooltip, shortcut list and canvas menu open on top, on the node and over the large editor (and ComfyUI's node menu stays away); then the tool menu, the LoRA menu, the color picker, a region's pop-up editor and the LLM settings open over the large editor. Since round 42 also: the lists a pop-up editor's buttons open (wildcard, LoRA: ComfyUI's own menu) lie over the pop-up (`menuFrom()`), and with the pointer on any control that has a tooltip the browser has no tooltip of its own to show, neither the control's nor that of a box around it (`nativeTips()`: the node, the pop-up editors of both nodes, the shortcut list, the LLM settings, the large editor; an element outside the pack keeps its tooltip). **Run it whenever a pop-up editor, the large editor, a z-index, a text field, the tooltip, or the autocomplete / wildcard code changes; add a line to it for every new place where text is typed, a `menuFrom()` line for every list a pop-up's button opens, and a `nativeTips()` call for every new pop-up or panel** | `node tests/real_layering.cjs [vue]` | a running ComfyUI with this pack, ComfyUI-Custom-Scripts (autocomplete on, with a word starting "blon"), ComfyUI Impact Pack with the wildcard `rgtest/color`, and a LoRA file; `setup_real_comfy.sh` sets all of it up. Set *pysssss > Image Feed > Location* to hidden, or its panel covers buttons |
| **Sockets** (`real_sockets.cjs [vue]`): a new node's short socket lists, the sockets checklist (tick / untick, connected ones stay), the node resizing at its top, the prompt's output numbers and a run that proves them, `size_from` with an image and a latent, the size row = the canvas size, `control_image` with a Control row, no row wrapping at 700 px in Generate and Edit Mode, the wildcard seed group, save and load, a workflow from before round 40. **Run it whenever sockets, the size inputs, loading / saving of the node or the Python node's inputs / outputs change** | `node tests/real_sockets.cjs [vue]` | a running ComfyUI with this pack, `rg_test.png` in its input folder (`setup_real_comfy.sh` puts it there) |
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

**The help page's picture** (`js/docs/region-genie-parts.png`): `node tests/shot_help.cjs js/docs/region-genie-parts.png` with ComfyUI running (legacy mode, English). Retake it when the node's look changes.

**The README's pictures** (`docs/images/editor.png`, `rows.png`): `node tests/shot_readme.cjs` with ComfyUI running. Retake them when the node's look changes.

## Finding controls: titles and icons

- Tests and the screenshot scripts find most controls by their tooltip: `[title^="Undo"]`. The pack's own tooltip (`js/rg_tooltip.js`) puts the title of the element under the pointer aside (the attribute is left empty) so the browser shows nothing; in a browser driven by a test tool (`navigator.webdriver`) it leaves the title in place, so these selectors always work. `ui_review_items.cjs` and `ui_popup_text.cjs` switch the real behavior on (`window.__rgTakeTitles = true` in an init script) to test it, and `real_layering.cjs` switches it on for its `nativeTips()` checks only.
- The real-ComfyUI suites that write test files into ComfyUI's folders (`real_fields_popups.cjs` and others) need `COMFY_DIR` set to that ComfyUI; without it one check of the Edit row fails ("a pick in the menu sets the Setting …") because the file went elsewhere.
- A button whose label is a drawn icon carries the icon's name: `button[data-ic="close"]`. Don't match on a character (✕ ↑ …): buttons have none.

## Things that look like flaky tests but aren't (or are the machine)

- **A real-ComfyUI suite fails in one node mode and passes in the other, with "all fields show" or "the English reference is out of date":** the pack's scripts did not start in that page load. Check for two files of `js/` importing each other (`bash tests/run_ui.sh` runs `ui_load_order.cjs`, which finds it every time).
- **`real_smoke.cjs` times out waiting for `/region_genie/sam_select` on a ComfyUI that has already run other suites:** restart the test ComfyUI and run it first (cloud sessions have 16 GB and no swap; the server with the SAM fixture loaded takes about 4 GB). On a fresh server the first answer comes in about 25 s.

