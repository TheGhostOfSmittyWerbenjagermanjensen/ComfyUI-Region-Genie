# Regional LoRAs

LoRAs that act only inside a mask, for workflows that build their regions with other nodes. (The Region Genie node
does the same from its own regions: press ＋LoRA on a region there.)

- Connect `model`, `clip` and `masks` (for example from the Region Genie node), and its `prompt` to `positive_prompt`.
- Each row is one LoRA: on / off, `index` (the region's number; -1 for the whole image), the LoRA file, its strength
  and words for that region.
- Use the `model`, `positive` and `negative` outputs for the sampler.
- `region_separation` is how strongly the regions are kept from influencing each other, `separation_until` for
  how much of the sampling (0.4 / 0.1: a smooth blend; 0.85-0.99 with 0.1-0.5: strong style separation);
  `feather` softens the mask edges.
- The defaults for new nodes are in **Settings > Region Genie > Regional LoRAs**.

The full manual: [Regional LoRAs](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/regional-loras.md).
