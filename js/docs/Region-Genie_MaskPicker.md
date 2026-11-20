# Mask Picker

Picks one region's mask out of `masks`, for example the exact painted shapes from the Region Genie node.

- `index` chooses the region. After a run its label shows the valid range, and the node lists every region.
- Outputs: `mask` (that region), `combined_mask` (all regions), `mask_batch`, `width`, `height`, an info list, and
  that region's `prompt` when `elements` (or a MOSS JSON `prompt`) is connected.
- `feather` softens the edges by that many pixels. Edges on the image border stay solid unless
  `feather_canvas_edges` is on. `invert` flips all outputs.
- `size_from_image` / `size_from_latent` resize the masks.

The full manual: [BBoxes to Masks and Mask Picker](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/mask-nodes.md).
