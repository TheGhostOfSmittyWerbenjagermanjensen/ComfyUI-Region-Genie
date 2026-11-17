# Real-hardware checklist

Cloud sessions have no GPU, no real model files, no Windows and no 4K display, so the items below have only been checked with stand-ins. Tick an item when it works on a real machine; report anything that doesn't. Once an item is confirmed it can be deleted from this file.

Do sections 1 and 2 first: they cover the most with the fewest runs.

## 1. One run per model you use

For each model: connect `model`, `clip` and `vae`, draw two regions with prompts, run, and check that each region shows its own prompt.

- [ ] MOSS-Image, layout mode (regions placed by the layout prompt)
- [ ] MOSS-Image, standard mode (the layout / standard switch off, and with no regions drawn)
- [ ] Krea 2 (regions kept apart automatically)
- [ ] Ideogram 4
- [ ] Flux.1
- [ ] Flux.2 / Klein
- [ ] Flux 3
- [ ] Anima
- [ ] SDXL
- [ ] SD1.5
- [ ] The model in the bottom bar is guessed correctly before the first run (GGUF files, merges, renamed files, custom loader nodes)

## 2. Display: 4K, both node modes

Check once in legacy mode and once in Nodes 2.0.

- [ ] The footer and the toolbar each stay on one row at the default node width
- [ ] Number fields show every digit (the arrows don't cover any)
- [ ] Pop-up editors: drag, resize, ◀ / ▶, A− / A+, Page Up / Page Down
- [ ] Multi-line tooltips show their line breaks (node inputs, Settings, editor buttons)
- [ ] The divider between canvas and region list, the folded tool strip, the brush-size slider on the canvas edge
- [ ] The size row: presets pop-up, the chain button, the seed control
- [ ] The message bar under the canvas: selecting text, right-click, Copy link

## 3. Model files (Settings, Edit rows, LLM)

- [ ] A model-file field opens ComfyUI's menu on the right folders; with rgthree-comfy's Auto Nest on, subfolders show as folders
- [ ] Typing in the menu finds a file in any subfolder
- [ ] The Region Genie tab in Settings opens quickly with your full library
- [ ] Browse… (with its switch on) picks a file outside ComfyUI's model folders, and a run loads it (Windows / Stability Matrix paths)

## 4. Control

- [ ] A ControlNet row (SDXL / SD1.5 / Flux.1): the result follows the control map
- [ ] Two ControlNet rows together
- [ ] Anima: one LLLite row, then two
- [ ] MOSS-Image color map + depth control LoRA, including a region with its control switch off
- [ ] Flux.1 depth / canny LoRA, and that its row's strength changes the effect
- [ ] Depth Anything 3 making the depth map (no `control_image` connected)
- [ ] Control together with LoRAs per region; memory use is acceptable

## 5. Edit Mode

- [ ] Each model you edit with: the Edit row shows the Settings edit LoRA and the run changes only the chosen regions
- [ ] ＋Edit rows of the node's own are applied
- [ ] MOSS-Image with a LoRA trained with ai-toolkit
- [ ] The edit mask's grow / feather, keep / change per region

## 6. LoRAs per region

- [ ] MOSS-Image, Krea 2, Flux, Anima, SDXL: a LoRA on one region acts only there
- [ ] On an int8 / fp8 (quantized) model
- [ ] The Regional LoRAs node and Create Hook LoRA (Quantized)

## 7. Select object, lasso, wand

- [ ] Select object with the real SAM 3.1 file: mask quality, speed, find-all by text
- [ ] ComfyUI unloads and reloads SAM without trouble when memory is needed
- [ ] Magnetic lasso and magic wand on real photos

## 8. LLM Prompt Enhancer and wildcards

- [ ] A real LLM run for a region prompt and for the scene prompt
- [ ] An LLM file picked with Browse…, and an LLM LoRA
- [ ] Wildcards preview and run; the `__` list next to a tag autocomplete pack (LoRA Manager / pysssss)

## 9. Save Image (Region Genie)

- [ ] File sizes on real generations for PNG, WebP, JPEG, AVIF and EXR
- [ ] AVIF on an install where Pillow has no AVIF support
- [ ] A saved file dragged back onto ComfyUI loads its workflow

[← Back to the README](../README.md)
