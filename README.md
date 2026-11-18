# Region Genie ✨

Regional prompting and regional LoRAs for ComfyUI, built around bbox layout models such as MOSS-Image and Ideogram 4, and for Krea 2, Flux (Flux.1, Flux.2 / Klein, Flux 3), Anima and SDXL / SD1.5. All nodes are in the **Region Genie** category, and their names end in ✨.

| Node | What it does |
|---|---|
| **Region Genie** | Paint regions on a layered canvas; outputs a color map, exact masks, bboxes, layout JSON, and the model and conditioning with regional LoRAs |
| **Mask Picker** | A batch of masks (e.g. the Region Genie node's `masks`) → one mask, all masks and its prompt |
| **BBoxes to Masks** | Bboxes from any layout node → one mask, all masks and the box's prompt |
| **Regional LoRAs** | Any number of regional LoRAs from a batch of masks: model, positive and negative ready for the sampler |
| **Create Hook LoRA (Quantized)** | Drop-in replacement for core "Create Hook LoRA" that works on int8 / fp8 models |
| **Save Image (Region Genie)** | Saves images as PNG with the compression you pick, WebP, JPEG or AVIF with a quality, to save disk space; optional transparency from a mask; shows the saved file sizes |

<img src="docs/images/editor.png" alt="The Region Genie node: regions painted on the canvas, with their prompts in the list below" width="520">

## Install

- **ComfyUI Manager:** *Install via Git URL* with this repository's address, then restart ComfyUI.
- **By hand:** clone or unzip into `ComfyUI/custom_nodes/` (it makes the folder `ComfyUI-Region-Genie`) and restart.

The pack needs nothing beyond what ComfyUI installs itself. Optional extras: [ComfyUI Impact Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack) for wildcards, [rgthree-comfy](https://github.com/rgthree/rgthree-comfy) for folders in the model-file menus, and a tag autocomplete pack (see [Setup notes](docs/setup-notes.md)).

## Quick start

1. Add the **Region Genie** node (search for "genie") and connect your loader's `model`, `clip` and `vae` to it.
2. Pick your model in the node's bottom bar if the node hasn't guessed it, and set the image size in the row at the top.
3. Draw a region on the canvas (the Rectangle tool is ready after you press the add-region button), then type its prompt in the list under the canvas. Repeat for each region.
4. Write the overall scene in `scene_prompt_positive`.
5. Connect the node's `model`, `positive`, `negative` and `latent` outputs to your sampler, and run.

A starter workflow is in [`examples/`](examples/): drag `region-genie-starter-sdxl.json` onto ComfyUI and pick your own SDXL checkpoint. For another model, replace the loader and pick the model in the node's bottom bar.

## Manual

| Page | What it covers |
|---|---|
| [Region Genie (the node)](docs/region-genie.md) | Image size, canvas, layers, tools, the region list, inputs and outputs, prompt formats, keeping regions apart, Settings |
| [Control (ControlNet)](docs/control.md) | Control rows, control maps, the files each model uses, choosing model files |
| [Edit Mode](docs/edit-mode.md) | Image-to-image with regions, Edit rows and edit LoRAs |
| [Regional LoRAs](docs/regional-loras.md) | LoRAs per region in the Region Genie node, the Regional LoRAs node, Create Hook LoRA (Quantized) |
| [LLM Prompt Enhancer](docs/llm-prompt-enhancer.md) | Writing and improving prompts with a local LLM |
| [Wildcards](docs/wildcards.md) | Impact Pack wildcards in every prompt field |
| [BBoxes to Masks and Mask Picker](docs/mask-nodes.md) | The two small mask nodes |
| [Save Image (Region Genie)](docs/save-image.md) | Formats, quality, transparency, file sizes |
| [Languages](docs/languages.md) | Which languages there are, what is translated, correcting a translation |
| [Setup notes](docs/setup-notes.md) | Finding the nodes, tag autocomplete, coming from Regional Mask Kit |

![A Control row and an Edit row under Whole image](docs/images/rows.png)

![Choosing a model file: ComfyUI's menu with folders and a search across all of them](docs/images/model-menu.png)

## For developers

`docs/HANDOFF.md` describes the code layout and design decisions, `docs/CHANGELOG.md` the history, `tests/README.md` the tests, and `docs/HARDWARE-CHECKLIST.md` what still needs checking on a real GPU.

## License

[GPL-3.0](LICENSE), the same license as ComfyUI.
