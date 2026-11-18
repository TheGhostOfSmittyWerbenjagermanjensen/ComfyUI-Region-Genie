# Region Genie: a ComfyUI custom node pack

Regional prompting and regional LoRAs for ComfyUI (MOSS Image first, then Krea 2; also Ideogram 4, Flux.1/2/3, Anima, SDXL / SD1.5). The repository root is the pack folder: it is installed as `ComfyUI/custom_nodes/ComfyUI-Region-Genie`.

Read `docs/HANDOFF.md` before larger changes: it explains the code layout, the data formats, past decisions and what is still untested. `README.md` is the front page and `docs/*.md` (one page per subject) the user-facing manual; keep them current with every user-visible change. `docs/CHANGELOG.md` has the history of every round.

## Layout

- Python nodes and server routes at the top level (`__init__.py` registers them); every `.js` file in `js/` (`WEB_DIRECTORY`).
- `region_genie.py` / `js/region_genie.js` + `js/editor/*.js`: the main node and its canvas editor (the editor is split into parts that share one object, `E`: read the header of `js/editor/parts.js` first). `regional_lora.py`: the regional LoRA engine. `region_select.py`: Select object (SAM 3.1). `llm_enhance.py`: LLM Prompt Enhancer. `wildcards.py`: Impact Pack wildcards. `control.py`: Control (ControlNet / control LoRAs). `save_image.py` / `js/save_image.js`: Save Image (Region Genie). `js/rg_shared.js`: icons, Settings, shared helpers. `locales/<language>/`: translations of node texts and Settings (read `locales/README.md`); `js/rg_i18n.js`: translated dropdown choices.
- `tests/`: see `tests/README.md`. There is no GPU in cloud sessions; tests use stubs, CPU, and a random-weight SAM fixture.

## Working agreements with the owner

- Before a decision that changes the outcome a lot (UI placement, behavior, design), present the options as multiple choice, with mock-ups where it helps, and let the owner choose. Answer their questions before building.
- Must work in ComfyUI's legacy node mode **and** Nodes 2.0, on a 4K high-DPR display.
- Breaking saved workflows is acceptable, but keep them loading where it's cheap: `keepWidgetValuesByName`, add new inputs after existing ones, remap outputs by name, convert old data.
- UI: compact header controls; icons with tooltips over words, except these words the owner kept: "▼ LoRAs", "▼ All", "separation", "until", and every "LoRA"/"＋LoRA" label. Reuse existing icons.
- Tooltips (node inputs / outputs, Settings, every editor control): concise but complete. A tooltip that explains several things (options, states, outputs) puts each on its own line (`name: Description.`). Every sentence starts with a capital letter, also after a ":", unless its first word is a lowercase field / option name (`sidecar .json: The workflow …`). `tests/tooltip_rules.cjs` has the rules; `tests/real_tooltips.cjs [vue]` checks every tooltip.
- The owner often can't test right away: explain behavior changes clearly, and end every task with what was tested and what wasn't (real GPU runs never are).
- After each round, update `docs/HANDOFF.md` (current design, open items), `docs/CHANGELOG.md` (the round: asked, decided, built, tested), the manual (`README.md`, `docs/*.md`) and, for anything a cloud session can't check, `docs/HARDWARE-CHECKLIST.md`. Raise the version in `pyproject.toml` with every user-visible change.
- Before implementing anything (features, fixes, docs), fetch from GitHub and make sure the local copy matches the latest version of the branch the working branch is based on (its base branch: often `main`, but it depends on the situation), plus any newer commits on the working branch itself. If a PR from the working branch has been merged, start the new work from the current base branch.
- When an instruction is unclear or could be read more than one way, ask the owner before acting on it.

## Checks before pushing

GitHub Actions (`.github/workflows/tests.yml`) runs the syntax checks, `tests/run_py.sh` and `tests/run_ui.sh` on every push; the real-ComfyUI tests are manual.

- `node --check --input-type=module < js/<file>.js` for every changed JS file (also in `js/editor/`); `python3 -m py_compile` for Python.
- `tests/run_py.sh`; `tests/run_ui.sh` when the editor changed; `tests/test_select.py` when `region_select.py` changed; `tests/test_control.py` when `control.py` changed; `tests/real_save_image.cjs [vue]` when the save node changed; `tests/real_tooltips.cjs [vue]` when a tooltip changed; `tests/real_settings.cjs` when a Setting changed; `tests/real_llm_settings.cjs [vue]` when the LLM settings (pop-up or Settings rows) changed.
- When a node text (name, input, output, tooltip, dropdown choice) or a Setting changed: `node tests/i18n_extract.cjs` (rewrites the English reference `tests/i18n_en/`), `python3 tests/test_i18n.py --todo` lists exactly the entries whose English is new or changed: translate only those in every `locales/<language>/` (never re-translate or re-review the rest), `python3 tests/test_i18n.py --done`, then `tests/real_i18n.cjs [vue]` (restart ComfyUI first: it reads locale files at start).

## Never commit

API keys, tokens, passwords, personal paths or email addresses, model files (`*.safetensors`), `llm_cache.json`, ComfyUI settings files. Keys a session needs go in the cloud environment's network secrets, never in the repo or in environment variables.
