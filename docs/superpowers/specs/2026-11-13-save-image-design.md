# Save Image node with formats and compression: design

Date: 2026-11-13. Status: draft for the owner's approval.

## Intent

The owner wants to **reduce the file size of generated images to save disk space**. ComfyUI has no save node that lets them
set the PNG compression level, and none that saves JPEG or WebP stills with a quality setting. This pack gets a save node
like ComfyUI's **Save Image (Advanced)**, with more formats and compression / quality controls.

Background the owner has seen and agreed with:
- PNG compression (0-9) is lossless: identical pixels, only file size against save time. Level 9 is usually only 5-15%
  smaller than ComfyUI's default (4) and slower to save.
- WebP lossless: identical pixels, usually 25-35% smaller than PNG.
- WebP / JPEG / AVIF with a quality setting: a little invisible-at-a-glance detail lost, often 5-20x smaller.
- ComfyUI reloads a workflow from a dragged-in PNG, WebP or AVIF, not from a JPEG.

## Goals

- One node, **Save Image (Region Genie)**, that saves each image of a batch to ComfyUI's output folder as:
  - **PNG**: compression level 0-9, 8-bit or 16-bit;
  - **WebP**: lossless, or lossy with a quality;
  - **JPEG**: a quality, and the extension **.jpg or .jpeg** (one format, an extension choice);
  - **AVIF**: a quality.
- The workflow stays recoverable wherever the format allows (PNG, WebP, AVIF: inside the file, as ComfyUI's own save
  nodes write it, so dragging the file into ComfyUI loads the workflow).
- JPEG: a choice of what happens to the workflow (owner's decision):
  - **sidecar .json** (default): the workflow in a small `.json` file next to each JPEG, same base name; dragging that
    file into ComfyUI loads the workflow;
  - **none**: no workflow saved;
  - **inside the JPEG (EXIF)**: stored in the JPEG's EXIF, readable by other tools; ComfyUI can't drag-load it today
    (the tooltip says so).
- Behaves like ComfyUI's save nodes otherwise: `filename_prefix` with subfolders and the `%date:…%` /
  `%Node.widget%` tokens, the counter `_00001`, `%batch_num%`, a preview of the saved images on the node, an `images`
  output that passes the images through, and `--disable-metadata` respected (no workflow in any file or sidecar).
- Works in ComfyUI's **legacy node mode and Nodes 2.0**, on a 4K high-DPR display (owner's requirement for every node).

## Non-goals

- EXR, HDR / wide-gamut color spaces, animated WebP / AVIF, video (WEBM etc.): core nodes cover these, and they don't
  save space.
- Transparency (an alpha / mask input). Images are saved as RGB (a 4-channel tensor isn't expected from this pack's
  workflows). Can be added later if asked.
- Resizing, cropping, or any image processing before saving.
- Replacing or patching ComfyUI's own save nodes.

## Anti-goals (would make it a failure even if it works)

- A file that silently loses its workflow when the owner expects it there (PNG / WebP / AVIF must carry it; JPEG must
  say clearly what it does).
- A "lossless" setting that isn't lossless (PNG at any level and WebP lossless must give back the exact pixels).
- Breaking saved workflows when the node is changed later (follow the pack's rules: `keepWidgetValuesByName`, new
  inputs after existing ones).
- A field without a tooltip, or a number field whose value is covered by its arrows (round 12 rules).

## Constraints

- ComfyUI v0.45.2 / frontend 1.58.5 are what the pack is tested against; the node must also load on older ComfyUI
  (classic node style, no dependency on the newer schema API).
- ComfyUI requires Pillow >= 10.1. PNG, WebP and JPEG are in every such Pillow. **AVIF is only in Pillow >= 11.3**;
  ComfyUI also ships PyAV (`av`), which core uses for AVIF.
- Pillow can't write 16-bit RGB PNG; core writes 16-bit PNG through PyAV's PNG encoder.
- The frontend fills in `%date%` / `%Node.widget%` tokens only for a fixed list of core node names; this node isn't on
  it, so the pack's own script must do the same for its `filename_prefix`.
- No GPU in the cloud sessions; tests use stubs, CPU and the real ComfyUI from `tests/setup_real_comfy.sh`.

## Approaches considered

- **A. Classic node (`INPUT_TYPES`) with a small script that hides the fields the chosen format doesn't use.**
  Every setting is an ordinary widget with a tooltip; the script shows only the chosen format's fields. Matches every
  other node in the pack, works in legacy and Nodes 2.0 and on older ComfyUI. **Chosen by the owner.**
- B. ComfyUI's newer node style (a `DynamicCombo` format that reveals its own fields, as in core Save Image
  (Advanced)): no script needed, but needs a recent ComfyUI, no other node of the pack uses it, and saved widget values
  are stored differently (harder to keep old workflows loading).
- C. A compact custom DOM panel (like Region Genie's size row): most compact, much more code for a handful of settings.

## The node as decided

- Node id `Region-Genie_SaveImage`, display name **Save Image (Region Genie)** (plus the pack's icon suffix), category
  `Region Genie`, output node, search aliases for "save", "save image", "png", "jpeg", "jpg", "webp", "avif",
  "compression", "quality" plus the pack's common ones.
- Inputs, in this order (new inputs only ever go at the end later):
  1. `images` (IMAGE)
  2. `filename_prefix` (STRING, default `ComfyUI`, as core)
  3. `format`: `png` / `webp` / `jpeg` / `avif`
  4. `png_compression` (INT 0-9) — png only
  5. `png_bit_depth` (`8-bit` / `16-bit`) — png only
  6. `webp_lossless` (BOOLEAN) — webp only
  7. `webp_quality` (INT 1-100) — webp only, hidden while lossless is on
  8. `jpeg_quality` (INT 1-100) — jpeg only
  9. `jpeg_extension` (`.jpg` / `.jpeg`) — jpeg only
  10. `jpeg_workflow` (`sidecar .json` / `none` / `inside the JPEG (EXIF)`) — jpeg only
  11. `avif_quality` (INT 1-100) — avif only
  - Hidden: `prompt`, `extra_pnginfo` (as core).
- Output: `images` (IMAGE, passed through).
- Preview on the node: the saved files (`ui.images` with `type: "output"`), like core.

## Calls I made (the owner can change any of them)

- **Defaults:** format `png`, `png_compression` **9** (the owner's goal is space; core's 4 stays one click away),
  `png_bit_depth` 8-bit, `webp_lossless` off, `webp_quality` 90, `jpeg_quality` 90, `jpeg_extension` `.jpg`,
  `jpeg_workflow` sidecar .json, `avif_quality` 80.
- **New-node defaults in Settings > Region Genie > Save Image**, like the pack's other nodes: format, PNG compression,
  WebP lossless / quality, JPEG quality / extension / workflow, AVIF quality. Nodes in saved workflows keep their own
  values.
- **Encoders:**
  - PNG 8-bit: Pillow, `compress_level` = the field (0-9).
  - PNG 16-bit: PyAV's PNG encoder (as core) with the compression level passed through, else a small pure-numpy +
    zlib PNG writer with the same level (both lossless).
  - WebP: Pillow; `lossless=True` with the best compression effort (`quality=100, method=6`) when lossless; else
    `quality` = the field, `method=6` (smallest files; the extra save time is small for single images).
  - JPEG: Pillow, `quality` = the field, `optimize=True`; chroma subsampling 4:4:4 at quality >= 90, else 4:2:0
    (sharper colors at high quality, smaller files below).
  - AVIF: Pillow when it has AVIF (`quality` = the field, speed 6), else PyAV as core does. If neither can encode AVIF,
    the run stops with a clear message saying what to update; the format list stays the same so workflows don't change.
- **Workflow inside the files**, the same layout ComfyUI's own nodes write and the frontend reads:
  - PNG: `tEXt` chunks `prompt` and each `extra_pnginfo` key (e.g. `workflow`).
  - WebP and AVIF: EXIF `0x0110` = `prompt:<json>`, then `0x010F`, `0x010E`, … = `<key>:<json>` per `extra_pnginfo`
    key.
  - JPEG "inside" option: the same EXIF tags.
  - JPEG sidecar: `<same base name>.json` holding the workflow JSON (`extra_pnginfo["workflow"]`) exactly as a saved
    workflow file, so ComfyUI loads it when dragged in. Nothing is written when there is no workflow (API runs).
  - `--disable-metadata`: none of the above (no sidecar either).
- **File names:** `<prefix>_<counter:05>.<ext>`, the counter from `folder_paths.get_save_image_path` as core (it
  counts existing files with the prefix whatever their extension, so a PNG and a JPEG never share a number).
- **The script (`js/save_image.js`):** shows only the fields of the chosen format (and hides `webp_quality` while
  lossless is on), in legacy and Nodes 2.0; fills in the `filename_prefix` tokens when the prompt is queued (using the
  frontend's own text-replacement helper when it is exported, else the same rules re-implemented); keeps widget values
  by name (`keepWidgetValuesByName`).
- **Tooltips** on every field, short and complete, e.g. PNG compression: "0-9. Lossless: every level gives the same
  pixels; higher = smaller file, slower save. 9 = smallest." JPEG workflow: explains each choice and that ComfyUI can't
  load a workflow from a JPEG itself.
- **README:** a section for the node, with the size comparison above.

## Left to the builder

- Code layout (a new `save_image.py` registered in `__init__.py`'s `NODES`, the script in `js/`), helper names.
- How the field hiding is done (widget `hidden` + `computeSize` as in `region_genie.js`, re-checked in Nodes 2.0).
- Exact tooltip wording, search aliases.
- Tests: Python with stubs (each format and setting written and read back: exact pixels for PNG / WebP lossless,
  sizes shrink with compression / quality, 16-bit PNG, metadata present / absent, sidecar, `--disable-metadata`), and
  a real-frontend test in both modes (field visibility per format, tooltips, number fields, a real CPU run with no
  model files, the saved PNG / WebP / AVIF files and the JPEG sidecar loading their workflow back when dropped on the
  page).
- `docs/HANDOFF.md` and `tests/README.md` updates.

## Ideas not in scope (offered, not requested)

- Showing each saved file's size on the node after a run (helps compare settings).
- An optional mask input for transparency.
