# Languages

[Back to the front page](../README.md)

Region Genie follows ComfyUI's own language: **Settings > Language** (no separate setting). Reload the page after
changing it.

| Language | State |
|---|---|
| English | The original |
| Chinese (simplified), Japanese, Korean, Spanish | Machine-drafted, not yet reviewed by a native speaker |

Any other language ComfyUI offers shows Region Genie in English.

## What is translated so far

- Node names in the node menu and on the node, and their descriptions.
- Input and output names, and their tooltips.
- Dropdown choices on the nodes (Regional LoRAs, Save Image (Region Genie), BBoxes to Masks).
- Everything under Settings > Region Genie: section names, setting names, tooltips and options.

## What is still English

- The Region Genie editor: toolbar, region list, rows, pop-ups, menus, hints and their tooltips. The same for the
  LoRA rows of the Regional LoRAs node and the LLM settings pop-up.
- Buttons the pack draws inside Settings (Check, New, Delete, the model-file fields and their menus).
- Texts made during a run: `region_info`, `lora_info`, `mask_info`, notes and error messages.

Tooltips name the editor's buttons in English for that reason: it is what you see on screen.

## Good to know

- Only what is shown changes. A workflow saves the same values in every language, so workflows can be shared
  between users of different languages, and API prompts use the English names and values.
- The manual and the run-time notes use the English input names (`edit_area`, `image_mode`, …). Hover an input to see
  its tooltip; the node search also finds nodes by their English name.
- A wrong or awkward translation? The texts are plain files in the pack's `locales/` folder; `locales/README.md`
  explains how to correct one or add a language.
