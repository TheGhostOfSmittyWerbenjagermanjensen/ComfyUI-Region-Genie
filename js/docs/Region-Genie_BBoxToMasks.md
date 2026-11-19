# BBoxes to Masks

Turns layout boxes into rectangular masks and picks one of them.

- Takes `bboxes` from MOSS-Image Prompt Builder KJ, Create Bounding Boxes, (Deno) Ideogram Director or the Region
  Genie node, or `elements` JSON.
- `index` chooses the region. After a run its label shows the valid range, and the node lists every region.
- Outputs: `mask` (that region), `combined_mask` (all regions), `mask_batch`, `width`, `height`, an info list and
  that region's `prompt`.
- The masks are made at `width` × `height`, or at the size of `size_from_image` / `size_from_latent`.
- `feather` softens the edges by that many pixels. Edges on the image border stay solid unless
  `feather_canvas_edges` is on. `invert` flips all outputs.
- For the exact painted shapes of a Region Genie node, use its `masks` output with Mask Picker instead.

The full manual: [BBoxes to Masks and Mask Picker](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/mask-nodes.md).
