# Region Genie: a ComfyUI custom node pack

Regional prompting and regional LoRAs for ComfyUI (MOSS Image first, then Krea 2; also Ideogram 4, Flux.1/2/3, Anima, SDXL / SD1.5). The repository root is the pack folder: it is installed as `ComfyUI/custom_nodes/ComfyUI-Region-Genie`.

Read `docs/HANDOFF.md` before larger changes: it explains the code layout, the data formats, past decisions and what is still untested. `README.md` is the user-facing manual; keep it current with every user-visible change.

## Layout

- Python nodes and server routes at the top level (`__init__.py` registers them); every `.js` file in `js/` (`WEB_DIRECTORY`).
- `region_genie.py` / `js/region_genie.js`: the main node and its canvas editor. `regional_lora.py`: the regional LoRA engine. `region_select.py`: Select object (SAM 3.1). `llm_enhance.py`: LLM Prompt Enhancer. `js/rg_shared.js`: icons, Settings, shared helpers.
- `tests/`: see `tests/README.md`. There is no GPU in cloud sessions; tests use stubs, CPU, and a random-weight SAM fixture.

## Working agreements with the owner

- Before a decision that changes the outcome a lot (UI placement, behavior, design), present the options as multiple choice, with mock-ups where it helps, and let the owner choose. Answer their questions before building.
- Must work in ComfyUI's legacy node mode **and** Nodes 2.0, on a 4K high-DPR display.
- Breaking saved workflows is acceptable, but keep them loading where it's cheap: `keepWidgetValuesByName`, add new inputs after existing ones, remap outputs by name, convert old data.
- UI: compact header controls; icons with tooltips over words, except these words the owner kept: "▼ LoRAs", "▼ All", "separation", "until", and every "LoRA"/"＋LoRA" label. Reuse existing icons.
- The owner often can't test right away: explain behavior changes clearly, and end every task with what was tested and what wasn't (real GPU runs never are).
- After each round, update `docs/HANDOFF.md` (decisions, open items) and `README.md`.
- Before implementing anything (features, fixes, docs), fetch from GitHub and make sure the local copy matches the latest version of the branch the working branch is based on (its base branch: often `main`, but it depends on the situation), plus any newer commits on the working branch itself. If a PR from the working branch has been merged, start the new work from the current base branch.
- When an instruction is unclear or could be read more than one way, ask the owner before acting on it.

## Checks before pushing

- `node --check --input-type=module < js/<file>.js` for every changed JS file; `python3 -m py_compile` for Python.
- `tests/run_py.sh`; `tests/run_ui.sh` when the editor changed; `tests/test_select.py` when `region_select.py` changed.

## Never commit

API keys, tokens, passwords, personal paths or email addresses, model files (`*.safetensors`), `llm_cache.json`, ComfyUI settings files. Keys a session needs go in the cloud environment's network secrets, never in the repo or in environment variables.
