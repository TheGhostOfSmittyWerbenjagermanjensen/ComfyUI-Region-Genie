# Real-hardware checklist

Cloud sessions have no GPU, no real model files, no Windows and no 4K display, so the items below have only been checked with stand-ins. Tick an item when it works on a real machine; report anything that doesn't. Once an item is confirmed it can be deleted from this file.

Do sections 1 and 2 first: they cover the most with the fewest runs.

## 1. One run per model you use

For each model: connect `model`, `clip` and `vae`, draw two regions with prompts, run, and check that each region shows its own prompt.

- [ ] MOSS-Image, layout mode (regions placed by the layout prompt)
- [ ] MOSS-Image, standard mode (the layout / standard switch off, and with no regions drawn)
- [ ] MOSS-Image: with an empty canvas the switch shows standard; drawing the first region brings layout back, and the run's `prompt` is layout JSON
- [ ] Krea 2 (or MOSS-Image in standard mode): after a run the keep-all-regions-apart button is lit; one click turns it off, and the next run leaves it off
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
- [ ] Check model files (Settings > Region Genie > Model files) reports nothing missing when everything is in place, and names a file after you move it away
- [ ] Browse… (with its switch on) picks a file outside ComfyUI's model folders, and a run loads it (Windows / Stability Matrix paths)

## 4. Control

- [ ] A ControlNet row (SDXL / SD1.5 / Flux.1): the result follows the control map
- [ ] Two ControlNet rows together
- [ ] Anima: one LLLite row, then two
- [ ] MOSS-Image color map + depth control LoRA, including a region with its control switch off
- [ ] Flux.1 depth / canny LoRA, and that its row's strength changes the effect
- [ ] A second MOSS-Image or Flux.1 LoRA control row shows ⚠, and the run really ignores it
- [ ] Depth Anything 3 making the depth map (no `control_image` connected)
- [ ] Control together with LoRAs per region; memory use is acceptable

## 5. Edit Mode

- [ ] Each model you edit with: the Edit row shows the Settings edit LoRA and the run changes only the chosen regions
- [ ] ＋Edit rows of the node's own are applied
- [ ] MOSS-Image with a LoRA trained with ai-toolkit
- [ ] MOSS-Image editing with the manual's settings (CFG 5 for Moss-Image-Edit, 3 for Edit-HQ; reference size 0 / 512), with *regions only* and with *whole image*; with and without a Skip Layer Guidance node (layer 22) on `model`
- [ ] The edit mask's grow / feather, keep / change per region

## 6. LoRAs per region

- [ ] MOSS-Image, Krea 2, Flux, Anima, SDXL: a LoRA on one region acts only there
- [ ] On an int8 / fp8 (quantized) model
- [ ] The Regional LoRAs node and Create Hook LoRA (Quantized)

## 7. Select object, lasso, wand

- [ ] Select object with the real SAM 3.1 file: mask quality, speed, find-all by text
- [ ] ComfyUI unloads and reloads SAM without trouble when memory is needed
- [ ] Magnetic lasso and magic wand on real photos
- [ ] Gradient fill (Fill button's list): a region with a LoRA or a distinct prompt fades across the filled area in the generated image

## 8. LLM Prompt Enhancer and wildcards

- [ ] A real LLM run for a region prompt and for the scene prompt
- [ ] An LLM file picked with Browse…, and an LLM LoRA
- [ ] Wildcards preview and run; the `__` list next to a tag autocomplete pack (LoRA Manager / pysssss)

## 9. Save Image (Region Genie)

- [ ] File sizes on real generations for PNG, WebP, JPEG, AVIF and EXR
- [ ] AVIF on an install where Pillow has no AVIF support
- [ ] A saved file dragged back onto ComfyUI loads its workflow

[← Back to the README](../README.md)

## 10. Languages (Chinese, Japanese, Korean, Spanish)

- Settings > Language set to one of the four, page reloaded: node names in the node menu and on the nodes, input / output names, tooltips and the dropdown choices show in that language; Settings > Region Genie shows translated sections, names, tooltips and options. Checked here only in a headless browser at normal scale, not on the 4K display.
- Longer names (Spanish, Japanese) on the nodes: nothing cut off or overlapping at the default node width, in both node modes.
- A workflow saved in one language opens and runs unchanged in English, and the other way round.
- The wording itself: every translation is machine-drafted. A native speaker should read at least the node names, the input names and the dropdown choices (`glossary.json` in each language folder lists them).

## 11. First-use help (round 33)

- On the 4K display, both node modes: the three first steps on an empty canvas and the hint line along the canvas's bottom edge are readable at the zoom you normally work at, and the hint line fades while you draw.
- After a real run: the button left of Export shows ⚠ with the number of notes (try a run without `clip`), and a click lists them under the canvas.
- Node Info on a selected Region Genie node shows the guide and its picture.
- R, V, B pressed while pointing at the toolbar or the region list pick the tool (and no longer trigger ComfyUI's own shortcuts).
