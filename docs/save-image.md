# Save Image (Region Genie)

Saves images to ComfyUI's output folder like ComfyUI's Save Image (Advanced), with more formats and compression / quality settings, to keep generated images smaller on disk. Only the settings of the chosen format show on the node.

| format | settings | pixels | size (rough, varies by image) | workflow inside (drag the file into ComfyUI to load it) |
|---|---|---|---|---|
| **png** | `png_compression` 0-9, `png_bit_depth` 8-bit / 16-bit | exact at every level | level 9 is usually only 5-15% smaller than level 4 (ComfyUI's default), and slower | yes |
| **webp** | `webp_lossless`, or `webp_quality` 1-100 | lossless: exact; quality: a little detail lost | lossless: usually 25-35% smaller than PNG; quality: often 5-20x smaller | yes |
| **jpeg** | `jpeg_quality` 1-100, `jpeg_extension` .jpg / .jpeg, `jpeg_workflow` | a little detail lost | often 5-20x smaller than PNG | see below |
| **avif** | `avif_quality` 1-100 | a little detail lost | usually the smallest | yes |
| **exr** | `exr_bit_depth` 16 / 32-bit float, `exr_color_space` sRGB / HDR / linear / linear ACEScg | float, scene-linear (for compositing and HDR) | larger than PNG | in its header (ComfyUI can't load it from there yet) |

- **PNG compression** never changes the picture: 0 = no compression (big, fast), 9 = smallest (slowest; the default here). **16-bit** keeps finer gradients for editing later, at about twice the size.
- **JPEG and the workflow:** ComfyUI can't load a workflow from a JPEG, so `jpeg_workflow` decides: **sidecar .json** (default) writes the workflow to a small `.json` file next to each JPEG, with the same name; drag that file into ComfyUI to load it. **none**: no workflow. **inside the JPEG (EXIF)**: readable by other tools, not by ComfyUI; a JPEG's EXIF holds about 64 KB, so a bigger workflow goes into the `.json` instead (the node says so; in an API run there is no workflow, only the prompt, and a prompt that doesn't fit isn't saved, which the node also says). From quality 90 up, JPEG keeps the full color detail; below 90 it stores colors at half resolution (smaller files).
- **AVIF** needs Pillow 11.3 or newer (`pip install -U pillow`), or a ComfyUI recent enough to save AVIF itself (then without transparency); otherwise the run stops and says so.
- **EXR** works as in ComfyUI's Save Image (Advanced), with its own code: the images are converted from `exr_color_space` to scene-linear light (sRGB: the inverse sRGB curve; HDR: the inverse HLG curve; the linear ones unchanged) and written as 16 or 32-bit float, with the color space and the workflow in the header. It needs ComfyUI v0.45 or newer.
- **Transparency:** connect a `mask` (PNG, WebP, AVIF and EXR get an alpha channel; JPEG has none and ignores it, with a note). As ComfyUI's Load Image mask, **1 = transparent**, so a Load Image's image and mask save back as they were. **invert_mask** (shown while a mask is connected): 1 = opaque, e.g. a region mask from the Region Genie node or Mask Picker to keep the region and clear the rest. A mask of another size is resized; one mask applies to every image of a batch. An image that already has transparency (4 channels, e.g. from Join Image with Alpha or a background remover) keeps it when no mask is connected; a connected mask takes its place. WebP lossless also keeps the colors under fully transparent pixels.
- **filename_prefix** works as in ComfyUI's save nodes: a subfolder (`portraits/ComfyUI`), `%date:yyyy-MM-dd%`, `%Node title.widget%`. Files are numbered `ComfyUI_00001.png`, `ComfyUI_00002.jpg` … (one count for all formats, upper / lower case ignored, and an existing file is never overwritten); `%batch_num%` is the image's place in the batch.
- **After a run** the node shows what it saved and how big it is, e.g. `PNG 9 · 1.42 MB` or `4 × WebP q90 · 1.9 MB total`; JPEG's `.json` files show apart (`2 × JPEG q90 · 1.1 MB total + 2 .json · 8.2 KB`), and notes in yellow. Hover it for each file and its size. When you change a setting afterwards, it dims until the next run (it shows the last run's files, not what the new setting would give).
- **Size limits:** WebP images can be at most 16383 px wide or tall and JPEG 65535 px; a bigger image stops the run with a message saying so (PNG and AVIF have no such limit here).
- The `images` output passes the images through. `--disable-metadata` saves no workflow anywhere (no `.json` either).
- **Settings > Region Genie > Save Image:** how new nodes start (format, PNG compression, EXR bit depth / color space, WebP lossless / quality, JPEG quality / extension / workflow, AVIF quality). Nodes already in a workflow keep their own values.

[← Back to the README](../README.md)
