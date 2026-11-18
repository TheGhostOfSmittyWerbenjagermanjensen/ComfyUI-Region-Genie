# Setup notes

**Coming from Regional Mask Kit:** the pack's old name. Since version 0.24.0 the old node IDs, settings and file names are no longer read: a workflow saved with *Regional Mask Kit* shows its nodes as missing (add the Region Genie nodes in their place), and settings or LLM presets saved under the old name aren't copied any more. Delete an old `ComfyUI-RegionalMaskKit` folder if you still have one.

**Finding the nodes:** search for "Region Genie" (also "RegionGenie", "Region-Genie" or just "genie") to list all five, in this order: Region Genie, Mask Picker, BBoxes to Masks, Regional LoRAs, Create Hook LoRA (Quantized). They also come up for MOSS, MOSS-Image, Ideogram, Krea, region, regional, mask, bbox, map, layout, canvas, LoRA and similar words.

**Tag autocomplete:** works in every prompt field of this pack (the region prompts, the pop-up editors, `scene_prompt_positive` / `scene_prompt_negative` / `scene_prompt_background`, and the `prompt`, `negative_prompt` and row fields of Regional LoRAs; the "text to render" fields have none), using whichever of these is installed:
- the **AutoCompleter of [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts)** (preferred while its "Text Autocomplete" setting is on), or
- the **tag autocomplete of [ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager)**.

Each follows its own pack's settings (word lists, separator, underscores, Tab / Enter to accept, suggestion count ...). The list uses compact rows, and closes when you click in the text or move the cursor with ←/→, Home/End or PgUp/PgDn (typing opens it again). The Region Genie node (bottom left) and Regional LoRAs (bottom right) have a **tag button** that switches it for that node only: a lit tag when on, a dimmed, slashed tag when off. The choice is saved with the workflow. Nodes you haven't switched follow **Settings > Region Genie > Tag autocomplete on in new Region Genie nodes**. The button is hidden when neither pack is installed.

[← Back to the README](../README.md)
