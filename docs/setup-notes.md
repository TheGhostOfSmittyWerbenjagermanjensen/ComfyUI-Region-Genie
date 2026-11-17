# Setup notes

**Renamed from Regional Mask Kit:** this pack was called *Regional Mask Kit*, and its main node *Color Map to Layout*. If you have the old `ComfyUI-RegionalMaskKit` folder, delete it before starting ComfyUI (both folders together would clash). Then:
- **Workflows saved with the old version still load and run.** Their nodes use the old IDs, which still work but are marked deprecated, so node search lists only the new nodes. To bring a workflow up to date, add the new node in place of the old one.
- **Settings** (Settings > Region Genie) and your **LLM presets** are copied from the old version the first time ComfyUI starts with this one. LLM results are kept in memory and in workflows by default; a results file left under the old name is deleted unless *Keep LLM results on disk* is on (see [LLM Prompt Enhancer](llm-prompt-enhancer.md)).
- Node renames: *Color Map to Layout* → **Region Genie**, *Create Hook LoRAs (Runtime / Quantized)* → **Regional LoRAs**, *Create Hook LoRA (Runtime / Quantized)* → **Create Hook LoRA (Quantized)**. Mask Picker and BBoxes to Masks keep their names. Searching for the old names still finds them.
- Files renamed inside the pack: `color_map_layout.py/.js` → `region_genie.py/.js`, `hook_lora.py` → `regional_lora.py`, `js/hook_loras.js` → `js/regional_loras.js`, `js/rmk_*.js` → `js/rg_*.js`. If you unzip this version over an older copy of this folder, the pack removes the old copies of those files when ComfyUI starts (the console says so); reload the browser tab once after that. Options saved inside workflows (labels on/off, autocomplete on/off, LLM results) are read from their old names.

**Finding the nodes:** search for "Region Genie" (also "RegionGenie", "Region-Genie" or just "genie") to list all five, in this order: Region Genie, Mask Picker, BBoxes to Masks, Regional LoRAs, Create Hook LoRA (Quantized). They also come up for MOSS, MOSS-Image, Ideogram, Krea, region, regional, mask, bbox, map, layout, canvas, LoRA and similar words.

**Tag autocomplete:** works in every prompt field of this pack (the region prompts, the pop-up editors, `scene_prompt_positive` / `scene_prompt_negative` / `scene_prompt_background`, and the `prompt`, `negative_prompt` and row fields of Regional LoRAs; the "text to render" fields have none), using whichever of these is installed:
- the **AutoCompleter of [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts)** (preferred while its "Text Autocomplete" setting is on), or
- the **tag autocomplete of [ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager)**.

Each follows its own pack's settings (word lists, separator, underscores, Tab / Enter to accept, suggestion count ...). The list uses compact rows, and closes when you click in the text or move the cursor with ←/→, Home/End or PgUp/PgDn (typing opens it again). The Region Genie node (bottom left) and Regional LoRAs (bottom right) have a **tag button** that switches it for that node only: a lit tag when on, a dimmed, slashed tag when off. The choice is saved with the workflow. Nodes you haven't switched follow **Settings > Region Genie > Tag autocomplete on in new Region Genie nodes**. The button is hidden when neither pack is installed.

[← Back to the README](../README.md)
