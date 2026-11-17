# BBoxes to Masks and Mask Picker

Both pick one region by `index` and output `mask` (that region), `combined_mask` (all of them), `mask_batch`, `width`, `height`, an info list and that region's `prompt`. After a run, the `index` label shows the valid range and the node lists every region.

- **BBoxes to Masks** takes `bboxes` from MOSS-Image Prompt Builder KJ, Create Bounding Boxes, (Deno) Ideogram Director or the Region Genie node, or `elements` JSON (0–1000 grid, y first). The masks are rectangles at `width`×`height` (or the size of `size_from_image` / `size_from_latent`; 16× for MOSS / Flux 2 latents).
- **Mask Picker** takes `masks`, e.g. the exact painted shapes from the Region Genie node. Connect that node's `elements` (or a MOSS JSON `prompt`) to get each mask's prompt too. `size_from_image` / `size_from_latent` resize the masks.
- `feather` softens the edges by that many pixels; edges touching the image border stay solid unless `feather_canvas_edges` is on. `invert` flips all outputs.

[← Back to the README](../README.md)
