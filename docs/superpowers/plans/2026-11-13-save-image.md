# Save Image (Region Genie) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A save node that writes PNG (compression 0-9, 8/16-bit), WebP (lossless or quality), JPEG (quality, .jpg/.jpeg, workflow as sidecar / none / EXIF) and AVIF (quality), with optional transparency from a mask and the saved file sizes shown on the node.

**Architecture:** A classic ComfyUI node (`INPUT_TYPES`) in a new `save_image.py`: pure encode / metadata / naming helpers plus the node class, registered in `__init__.py`. A new `js/save_image.js` shows only the chosen format's fields, fills in `filename_prefix` tokens, applies new-node defaults from Settings, and draws the size readout. Settings live in `js/rg_shared.js` with the pack's others.

**Tech Stack:** Python 3, numpy, Pillow (>= 10.1; AVIF needs >= 11.3), zlib, optional PyAV + core `comfy_extras.nodes_images.inject_avif_metadata`; JavaScript ES modules (ComfyUI frontend 1.58.5, legacy and Nodes 2.0); Playwright for tests.

**Spec:** `docs/superpowers/specs/2026-11-13-save-image-design.md` (approved). Read it first; this plan only adds the decisions it leaves open.

## Global Constraints

- Node id `Region-Genie_SaveImage`, display name `Save Image (Region Genie)` (+ the pack's `ICON` suffix via `NODES`), `CATEGORY = "Region Genie"`, `OUTPUT_NODE = True`, `RETURN_TYPES = ("IMAGE",)`, `RETURN_NAMES = ("images",)`.
- Inputs in this order: `images`, `filename_prefix` (default `ComfyUI`), `format` (`png`/`webp`/`jpeg`/`avif`), `png_compression` (0-9, default 9), `png_bit_depth` (`8-bit`/`16-bit`, default `8-bit`), `webp_lossless` (default False), `webp_quality` (1-100, default 90), `jpeg_quality` (1-100, default 90), `jpeg_extension` (`.jpg`/`.jpeg`, default `.jpg`), `jpeg_workflow` (`sidecar .json`/`none`/`inside the JPEG (EXIF)`, default `sidecar .json`), `avif_quality` (1-100, default 80); optional `mask` (MASK), `invert_mask` (BOOLEAN, default False); hidden `prompt` = `PROMPT`, `extra_pnginfo` = `EXTRA_PNGINFO`.
- Mask convention: alpha = 1 - mask; `invert_mask` on: alpha = mask. JPEG ignores the mask (note).
- Workflow layout as core: PNG `tEXt` `prompt` + one chunk per `extra_pnginfo` key; WebP / AVIF / JPEG-EXIF: EXIF `0x0110` = `prompt:<json>`, then `0x010F`, `0x010E`, … = `<key>:<json>`.
- JPEG EXIF too big (Pillow "EXIF data is too long", ~64 KB): sidecar instead + note.
- `--disable-metadata` (`comfy.cli_args.args.disable_metadata`): no workflow anywhere, no sidecar.
- File names `<prefix>_<counter:05>.<ext>`; the counter is the node's own (highest existing `<prefix>_NNNNN.*` + 1).
- Every field has a tooltip; number fields fit their value (the pack's `autoNumber` does this for `rg-` elements; ComfyUI's own widgets need no change). Legacy mode and Nodes 2.0. No API keys, personal paths or emails in commits.
- Before pushing: `node --check --input-type=module < js/<file>.js` for each changed JS file, `python3 -m py_compile` for Python, `bash tests/run_py.sh`.

## Review Focus

1. **A batch of mixed mask sizes or a mask batch shorter than the image batch** — expect resize to the image and the last mask repeating, never a crash (Task 3 test `mask batch shorter than images`).
2. **`filename_prefix` with a subfolder (`portraits/ComfyUI`) or a token (`%date:yyyy-MM-dd%`)** — expect the file in the subfolder and the token filled in on the frontend; never a literal `%date…%` file name (Task 3 subfolder test; Task 5 real-frontend token check).
3. **Saving twice with the same prefix but different formats** (PNG then JPEG) — expect `_00001.png` then `_00002.jpg`, never an overwrite or a shared number (Task 3 test `counter across formats`).
4. **An API run (no `extra_pnginfo`)** with JPEG sidecar — expect no empty `.json` written and no error (Task 2 test `no workflow, no sidecar`).
5. **Images not in 0-1** (slightly over 1 or negative after some nodes) — expect clipping, not wrapped colors (Task 1 test `out-of-range values clip`).

---

### Task 1: Encoders and alpha (`save_image.py`)

**Files:**
- Create: `save_image.py`
- Create: `tests/test_save_image.py`
- Modify: `tests/stubs.py` (add `comfy.cli_args` with `args = types.SimpleNamespace(disable_metadata=False)`), `tests/run_py.sh` (add `test_save_image.py`)

**Interfaces:**
- Produces (all in `save_image.py`; arrays are numpy, images float32 `(H, W, 3)` 0-1, alpha float32 `(H, W)` 0-1 or None):
  - `encode_png(rgb, alpha, level: int, bits: int, text: dict[str, str] | None) -> bytes` (bits 8 or 16)
  - `encode_webp(rgb, alpha, lossless: bool, quality: int, exif: bytes | None) -> bytes`
  - `encode_jpeg(rgb, quality: int, exif: bytes | None) -> bytes` — raises `ExifTooLong` (a `ValueError` subclass defined here) when Pillow refuses the EXIF
  - `encode_avif(rgb, alpha, quality: int, exif: bytes | None) -> bytes` — raises `AvifUnavailable(RuntimeError)` with the message `"AVIF needs Pillow 11.3 or newer (pip install -U pillow), or a ComfyUI with AVIF support"` when neither route works
  - `mask_alpha(mask, index: int, h: int, w: int, invert: bool) -> np.ndarray | None`

- [ ] **Step 1: Write the failing tests** in `tests/test_save_image.py` (style of `test_round12.py`: `from stubs import check, fails`, `from rgpack import save_image as si`), with a 32×24 test image (a gradient plus a red square) and a 16-bit-precise gradient:
  - `png 8-bit lossless at every level`: for `level in 0..9`, decode with Pillow → equals `round(rgb*255)`; size at 9 <= size at 0.
  - `png 16-bit`: IHDR bit depth byte == 16 and color type 2; IDAT (zlib) decoded with numpy (filter type 0 rows) equals `round(rgb*65535)`.
  - `png with alpha`: 8-bit → Pillow mode `RGBA`, alpha == `round(alpha*255)`; 16-bit → color type 6.
  - `png text chunks`: `Image.open(...).text == text`.
  - `webp lossless is exact` (Pillow decode == uint8 input) and `webp quality shrinks` (q=30 smaller than q=95); `webp keeps alpha` (mode RGBA).
  - `jpeg quality shrinks` (q=30 < q=95); `jpeg 4:4:4 at q>=90, 4:2:0 below` (`JpegImagePlugin.get_sampling(im)` == 0 at 90, == 2 at 89).
  - `jpeg exif too long raises ExifTooLong` (an `Exif` with a 70 000-char value).
  - `avif round trip` (skip with a PASS-and-note when `PIL.features.check("avif")` is False): decodes, size shrinks from q=95 to q=30.
  - `out-of-range values clip`: rgb with 1.2 and -0.1 → 255 and 0.
  - `mask_alpha`: `(H,W)` and `(B,H,W)` inputs; `alpha = 1 - mask`, inverted `alpha = mask`; a 16×12 mask resized to 32×24 (bilinear); index 3 with a batch of 2 uses mask 1; `None` mask → `None`.

- [ ] **Step 2: Run them to see them fail**
  Run: `python3 tests/test_save_image.py`  Expected: ImportError / FAIL (no `save_image` module).

- [ ] **Step 3: Implement the encoders in `save_image.py`**
  - 8-bit PNG / WebP / JPEG / AVIF through Pillow from `np.clip(x, 0, 1)` → `round(*255)` uint8; RGBA when alpha is given (JPEG never).
  - PNG: `compress_level=level`, `pnginfo` from `text`. 16-bit: a small writer (signature, IHDR with bit depth 16, color type 2 or 6, one `IDAT` = `zlib.compress(rows with filter byte 0, level)`, `IEND`, big-endian `>u2` samples), `tEXt` chunks for `text`.
  - WebP: lossless → `lossless=True, quality=100, method=6`; else `quality=quality, method=6`; `exif=` when given.
  - JPEG: `quality=quality, optimize=True, subsampling=0 if quality >= 90 else 2`; map Pillow's `ValueError("EXIF data is too long")` to `ExifTooLong`.
  - AVIF: Pillow (`quality=quality, speed=6, exif=`) when `PIL.features.check("avif")`; else PyAV `libaom-av1`/`libsvtav1` as core's `_save_avif` does, with `crf = round(63 - (quality - 1) * 62 / 99)`, writing to a temp file then `comfy_extras.nodes_images.inject_avif_metadata(path, metadata)` for the workflow — only when that import works; otherwise `AvifUnavailable`.
  - `mask_alpha`: accept 2-D or 3-D (numpy or torch-like with `.cpu().numpy()`), pick `min(index, B-1)`, resize with Pillow `Image.resize((w, h), BILINEAR)` on float32 mode `F`, clip 0-1, invert as specified.

- [ ] **Step 4: Run the tests to see them pass**
  Run: `python3 tests/test_save_image.py`  Expected: every line PASS, `all passed`.

- [ ] **Step 5: Commit**
  `git add save_image.py tests/test_save_image.py tests/stubs.py tests/run_py.sh && git commit -m "Save Image: encoders (PNG 8/16, WebP, JPEG, AVIF) and mask alpha"`

### Task 2: Workflow metadata, sidecar and the EXIF fallback

**Files:**
- Modify: `save_image.py`, `tests/test_save_image.py`

**Interfaces:**
- Consumes: Task 1 encoders, `ExifTooLong`.
- Produces:
  - `png_text(prompt: dict | None, extra: dict | None) -> dict[str, str] | None` — `{"prompt": json, <key>: json, …}`; `None` when metadata is disabled or both are empty
  - `comfy_exif(prompt, extra) -> bytes | None` — `PIL.Image.Exif` with the tags of Global Constraints, `.tobytes()`
  - `workflow_json(extra) -> str | None` — `json.dumps(extra["workflow"])` or None
  - `metadata_disabled() -> bool` — `comfy.cli_args.args.disable_metadata`, False when the import fails

- [ ] **Step 1: Write the failing tests**
  - `png carries prompt and workflow`: `Image.open(png).text["workflow"]` parses to the given workflow.
  - `webp exif layout as core`: `Image.open(webp).getexif()[0x0110] == "prompt:" + json.dumps(prompt)` and `[0x010F] == "workflow:" + json.dumps(wf)`.
  - `avif exif layout as core` (skip when no AVIF): same tags.
  - `jpeg exif option`: same tags in the JPEG.
  - `no workflow, no sidecar`: `workflow_json(None) is None`, `workflow_json({})` is None.
  - `disable-metadata`: with `stubs` `args.disable_metadata = True`, `png_text` / `comfy_exif` / `workflow_json` all None (reset afterwards).

- [ ] **Step 2: Run them to see them fail**
  Run: `python3 tests/test_save_image.py`  Expected: FAIL on the new checks (functions missing).

- [ ] **Step 3: Implement the four helpers** as specified; `extra_pnginfo` key order kept (tags count down from `0x010F` in that order).

- [ ] **Step 4: Run the tests to see them pass**
  Run: `python3 tests/test_save_image.py`  Expected: `all passed`.

- [ ] **Step 5: Commit**
  `git add save_image.py tests/test_save_image.py && git commit -m "Save Image: workflow metadata as core writes it, sidecar JSON"`

### Task 3: The node (`SaveImageRG`), naming, batches, the run's ui data, registration

**Files:**
- Modify: `save_image.py`, `__init__.py` (import; `NODES` entry `("Region-Genie_SaveImage", SaveImageRG, "Save Image (Region Genie)")`; `_ALIASES[SaveImageRG] = ["save", "save image", "png", "jpeg", "jpg", "webp", "avif", "compression", "quality", "transparency", "alpha"]`), `tests/test_save_image.py`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces:
  - `next_counter(folder: str, prefix: str) -> int`
  - `class SaveImageRG` with `INPUT_TYPES` per Global Constraints (each with a `tooltip`), `FUNCTION = "run"`, and
    `run(self, images, filename_prefix, format, png_compression, png_bit_depth, webp_lossless, webp_quality, jpeg_quality, jpeg_extension, jpeg_workflow, avif_quality, mask=None, invert_mask=False, prompt=None, extra_pnginfo=None) -> dict`
    returning `{"ui": {"images": [{"filename", "subfolder", "type": "output"}, …], "rg_saved": [summary]}, "result": (images,)}` where
    `summary = {"label": str, "files": [{"name": str, "bytes": int}], "total": int, "notes": [str]}` and `label` is `"PNG 9"`, `"PNG 9 16-bit"`, `"WebP lossless"`, `"WebP q90"`, `"JPEG q90"`, `"AVIF q80"`. Sidecar files are listed in `files` too (counted in `total`).
  - Note strings (exact): `"JPEG has no transparency: the mask was ignored"`, `"The workflow was too big for the JPEG's EXIF (about 64 KB): saved as a .json next to it"`.

- [ ] **Step 1: Write the failing tests** (a stub `folder_paths.get_output_directory` → a temp dir and `get_save_image_path(prefix, out, w, h)` returning `(os.path.join(out, subdir), base, 1, subdir, prefix)` as core does, set in the test file):
  - `one PNG per image` (batch of 3 → `ComfyUI_00001.png` … `_00003.png`), `ui.images` lists them with `type == "output"`, the result is the input `images`.
  - `counter across formats`: PNG run then JPEG run with the same prefix → `_00004.jpg` after three PNGs; an existing `ComfyUI_00010.webp` makes the next `_00011`.
  - `subfolder prefix`: `portraits/ComfyUI` → file in `<out>/portraits`, `ui` subfolder `portraits`.
  - `jpeg extension .jpeg`, `jpeg sidecar default` (`ComfyUI_00001.json` next to `ComfyUI_00001.jpg`, equal to the workflow), `jpeg none` (no `.json`, no EXIF), `jpeg EXIF fallback` (a 100 KB workflow with `inside the JPEG (EXIF)` → sidecar written, the note in `notes`, no EXIF in the JPEG).
  - `mask batch shorter than images` (3 images, 2 masks of another size) → 3 RGBA PNGs, the third's alpha from mask 2; `jpeg ignores the mask` → RGB JPEG and the note.
  - `rg_saved summary`: label `"WebP q90"`, `total == sum(file sizes on disk)`.
  - `INPUT_TYPES order and tooltips`: required keys in the Global Constraints order; every input (required and optional) has a non-empty `tooltip`.

- [ ] **Step 2: Run them to see them fail**
  Run: `python3 tests/test_save_image.py`  Expected: FAIL (no `SaveImageRG`).

- [ ] **Step 3: Implement `next_counter` and `SaveImageRG`**; images arrive as a torch tensor `(B, H, W, C)` (use `.cpu().numpy()`; the stub tensor is a numpy view); take the first 3 channels. One file per image, counter + i; `%batch_num%` in the prefix replaced per image as core does. `AvifUnavailable` propagates (the run stops with its message).

- [ ] **Step 4: Run all Python tests**
  Run: `bash tests/run_py.sh`  Expected: every file `all passed`.

- [ ] **Step 5: Commit**
  `git add save_image.py __init__.py tests/test_save_image.py && git commit -m "Save Image: the node, naming, batches, masks, size summary; registered"`

### Task 4: The script (`js/save_image.js`) and Settings

**Files:**
- Create: `js/save_image.js`
- Modify: `js/rg_shared.js` (SET ids and Settings entries, category `CAT("Save Image", …)`), `tests/real_comfy_save.cjs` (created in Task 5; this task is checked by it)

**Interfaces:**
- Consumes: `getSetting`, `SET`, `keepWidgetValuesByName`, `NEW_NODES` text pattern from `rg_shared.js`; the run's `ui.rg_saved` from Task 3 (`node.onExecuted(message)` gets `message.rg_saved[0]`).
- Produces: `SET.saveFormat`, `SET.savePngLevel`, `SET.saveWebpLossless`, `SET.saveWebpQuality`, `SET.saveJpegQuality`, `SET.saveJpegExt`, `SET.saveJpegWorkflow`, `SET.saveAvifQuality` (ids `RegionGenie.Save.<Name>`), defaults as Global Constraints.

- [ ] **Step 1: Implement `js/save_image.js`** (`app.registerExtension({ name: "RegionGenie.SaveImage", beforeRegisterNodeDef })` for `Region-Genie_SaveImage`):
  - Field visibility: `FIELDS = { png: ["png_compression", "png_bit_depth"], webp: ["webp_lossless", "webp_quality"], jpeg: ["jpeg_quality", "jpeg_extension", "jpeg_workflow"], avif: ["avif_quality"] }`; `webp_quality` also hidden while `webp_lossless`; `invert_mask` shown only while `mask` has a link and format isn't `jpeg`. Hide as `region_genie.js` does (`w.hidden = true; w.computeSize = () => [0, -4]`, restore the original descriptor), then `node.setSize([node.size[0], node.computeSize()[1]])` in legacy mode only. Re-run on the `format` / `webp_lossless` callbacks, `onConnectionsChange`, `onConfigure`.
  - `filename_prefix.serializeValue = () => (window.comfyAPI?.utils?.applyTextReplacements ?? fallback)(app.graph, value)`; if the helper throws with `app.graph`, call it with `app`; `fallback` handles `%date:yyyy-MM-dd hh:mm:ss%` (y M d h m s tokens) and `%Title.widget%` (node title or `Node name for S&R` property).
  - New-node defaults: the `configured` / `setTimeout` pattern of `regional_loras.js` (only for nodes just added).
  - `keepWidgetValuesByName(node, [every widget name])`.
  - Size readout: a small DOM widget (`addDOMWidget("rg_saved", …, { serialize: false })`, class `rg-save-out`, ~18 px, `computeLayoutSize = undefined` as the size row) showing `label · size` (`1 file`: `PNG 9 · 1.42 MB`; more: `4 × WebP q90 · 1.9 MB total`), notes after it in `#d9a441`; its `title` lists every file `name — size` and the notes. Sizes: B / KB / MB with 2 decimals over 1 MB, 1024-based. Empty before the first run.
- [ ] **Step 2: Add the Settings entries** in `rg_shared.js` (each with a tooltip ending in `NEW_NODES`).
- [ ] **Step 3: Check**
  Run: `node --check --input-type=module < js/save_image.js && node --check --input-type=module < js/rg_shared.js`  Expected: no output.
- [ ] **Step 4: Commit**
  `git add js/save_image.js js/rg_shared.js && git commit -m "Save Image: format fields, filename tokens, new-node defaults, size readout"`

### Task 5: Real-frontend test (both modes), docs, all checks

**Files:**
- Create: `tests/real_comfy_save.cjs`
- Modify: `README.md` (a *Save Image (Region Genie)* section: formats, the size comparison from the spec, workflow per format, JPEG choices and the EXIF fallback, transparency and `invert_mask`, the readout, Settings), `docs/HANDOFF.md` (round 13 entry: decisions from the spec's "Calls I made" and the builder check; open items: 4K check, AVIF on older Pillow untested), `tests/README.md` (the new files), `CLAUDE.md` layout line (`save_image.py` / `js/save_image.js`)

**Interfaces:**
- Consumes: everything above; ComfyUI from `bash tests/setup_real_comfy.sh --start` (output folder `$COMFY_DIR/output`).

- [ ] **Step 1: Write `tests/real_comfy_save.cjs [vue]`** (pattern of `real_comfy12.cjs`; `COMFY_DIR` env for the output folder). Graph: `EmptyImage` (64×48, batch 2, a color) → `Region-Genie_SaveImage`; `SolidMask` (0.25, 64×48) → `mask`. Checks, each run in legacy and Nodes 2.0:
  - only the chosen format's fields show for each of the 4 formats; `webp_quality` hides with lossless; `invert_mask` shows only with `mask` linked and not for jpeg;
  - every visible widget has a tooltip (`widget.tooltip` or the input's `tooltip`); no page errors;
  - a new node takes Settings defaults (set `RegionGenie.Save.PngLevel` to 3 first → the new node's `png_compression` is 3);
  - a queued run per format (`app.queuePrompt(0)`, wait for `executed`): the files exist in `output/` with the expected names; the readout shows the label and a size; `filename_prefix` `rgtest/%date:yyyy%` lands in `output/rgtest/` with the year in the name;
  - drag-load: fetch the PNG, WebP and AVIF (`/view?filename=…&type=output&subfolder=…`) and the JPEG's sidecar `.json`, pass each as a `File` to `app.handleFile` → the graph again has a `Region-Genie_SaveImage` node; the PNG has alpha 191 (= round(0.75*255)) at a pixel (decode in the page with a canvas).
- [ ] **Step 2: Run it in both modes**
  Run: `node tests/real_comfy_save.cjs && node tests/real_comfy_save.cjs vue`  Expected: `all passed` twice.
- [ ] **Step 3: Write the docs** listed above.
- [ ] **Step 4: Run every check**
  Run: `for f in js/*.js; do node --check --input-type=module < $f; done; python3 -m py_compile save_image.py __init__.py; bash tests/run_py.sh; bash tests/run_ui.sh; node tests/real_comfy9.cjs; node tests/real_comfy9.cjs vue; node tests/real_comfy12.cjs; node tests/real_comfy12.cjs vue`  Expected: no errors, every suite `all passed`.
- [ ] **Step 5: Commit and push**
  `git add -A && git commit -m "Save Image: real-frontend test, README, HANDOFF" && git push -u origin claude/sharp-tesla-1gt9qf`
