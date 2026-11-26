# Regional LoRAs

LoRAs that act only inside a mask, for workflows that build their regions with other nodes. (The Region Genie node
does the same from its own regions: press the LoRAs button on a region's row there.)

- Connect `model`, `clip` and `masks` (for example from the Region Genie node), and its `prompt` to `positive_prompt`.
- Each row is one LoRA: on / off, `index` (the region's number; -1 for the whole image), the LoRA file, its strength
  and words for that region.
- Use the `model`, `positive` and `negative` outputs for the sampler.
- `region_separation` is how strongly the regions are kept from influencing each other, `separation_until` for
  how much of the sampling (0.85 / 0.1, the defaults: regions placed reliably; 0.4 / 0.1: a smoother blend; 0.85-0.99 with 0.1-0.5: strongest style separation);
  `feather` softens the mask edges.
- In any text box, **Ctrl+Up / Ctrl+Down** raise or lower the weight of the word or tag at the cursor: `(tag:1.05)`.
- The wildcard seed shows at the top right while a field has a wildcard (ComfyUI Impact Pack).
- Click a number field (index, strength), then turn the mouse wheel over the node to change it.
- The defaults for new nodes are in **Settings > Region Genie > Regional LoRAs**.

The full manual: [Regional LoRAs](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/regional-loras.md).
