# Regional LoRAs

LoRAs that act only inside a mask, for workflows that build their regions with other nodes. (The Region Genie node
does the same from its own regions: press ＋LoRA on a region there.)

- Connect `model`, `clip` and `masks` (for example from the Region Genie node), and its `prompt` to `positive_prompt`.
- Each row is one LoRA: on / off, `index` (the region's number; -1 for the whole image), the LoRA file, its strength
  and words for that region.
- Use the `model`, `positive` and `negative` outputs for the sampler.
- `region_separation` and `separation_until` keep each LoRA's style inside its region for the first part of
  sampling; `feather` softens the mask edges.
- The defaults for new nodes are in **Settings > Region Genie > Regional LoRAs**.

The full manual: [Regional LoRAs](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/regional-loras.md).
