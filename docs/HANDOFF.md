# Region Genie (ComfyUI node pack): handoff summary

**Latest version:** `ComfyUI-Region-Genie.zip`, delivered Nov 11, 2026, after rounds 5, 6 and 7 (round 7 = Select object with SAM 3.1). It is 201,205 bytes and its SHA-256 starts `8b16ddd1583265734a6c5c274c51a36b7a04a949d146fd7a80fcdde2d2b13f45`. The project's Context files match it.

**Planned move:** the user asked for instructions to move this project to a GitHub repo and Claude Code on the web (Nov 11). If a repo exists when you read this, the repo is the source of truth, not the Context files. Check with the user.

**Where the files are.** The Context holds the files flat:
- Files that kept their old name are at the top level: `__init__.py`, `bbox_masks.py`, `llm_enhance.py`, `lora_triggers.py`, `README.md`, `bbox_masks.js`, `hook_lora.js`.
- Renamed or new files were added with a leading slash: `/region_genie.py`, `/regional_lora.py`, `/region_select.py` (new in round 7), `/region_genie.js`, `/regional_loras.js`, `/rg_shared.js`, `/rg_llm.js`, `/rg_colorpicker.js`.
- In the pack itself, every `.js` file goes in `js/` and every `.py` file at the top.
- **Changed in rounds 5-7 (uploaded Nov 11):** `__init__.py`, `llm_enhance.py`, `README.md`, `/region_genie.py`, `/regional_lora.py`, `/region_select.py`, `/region_genie.js`, `/regional_loras.js`, `/rg_shared.js`. Unchanged since round 4: `bbox_masks.py`, `lora_triggers.py`, `bbox_masks.js`, `hook_lora.js`, `/rg_llm.js`, `/rg_colorpicker.js`.
- The `README.md` inside the zip is the user-facing reference and is up to date.

The pack used to be called **Regional Mask Kit** (folder `ComfyUI-RegionalMaskKit`, main node "Color Map to Layout"). It was renamed on Nov 10, 2026. Section 7 lists the compatibility code that still mentions the old names.

## 1. Goals and working agreements

- **Purpose.** A ComfyUI node pack for regional prompting and regional LoRAs.
  - Built mainly for **MOSS-Image** (text encoder Qwen3.5 9B loaded as CLIP; MOSS layout JSON).
  - Also **Ideogram 4** (Qwen3-VL 8B; caption JSON).
  - With plain text: **Krea 2**, **Flux.1**, **Flux.2 / Klein**, **Flux 3**, **Anima**, **SDXL / SD1.5**.
  - After MOSS, Krea 2 matters most to the user.
  - All of these also work image-to-image (Edit Mode, round 4).
- **Must work in both** legacy node mode and **Nodes 2.0**, on a **4K, high-DPR display**.
- **Breaking workflows is acceptable**, but keep saved workflows loading where it's cheap: `keepWidgetValuesByName`; new inputs added *after* existing ones; `remapOutputs`; legacy-data conversions.
- **Delivery each round:** rebuild the zip, send it, and say what was and wasn't tested.
- **Context files / handoff:** after a round the user reviews first; when asked, upload the changed files and update this handoff. They have asked every round.
- **Process preferences:**
  - Before decisions that change the outcome a lot (UI placement, behavior, design), present options as multiple choice with mock-ups and let the user choose.
  - Answer the user's questions before building.
  - "Look into whether X could be added": build it unless it's an extreme rewrite.
  - The user often can't test right away, so explain behavior clearly.
- **UI preferences:**
  - Keep header controls compact.
  - Icons with tooltips over words, except the words the user kept: "▼ LoRAs", "▼ All", "separation", "until", and every "LoRA"/"＋LoRA" label.
  - Reuse existing icons where possible.
- **Sensitive data:** treat the user's email as private.

## 2. Nodes

| ID | Display name | Python class | Role |
|---|---|---|---|
| `Region-Genie_Main` | Region Genie ✨ | `RegionGenie` | Canvas editor; layouts, conditioning, latent, regional LoRAs, LLM Prompt Enhancer, Edit Mode, Select object |
| `Region-Genie_MaskPicker` | Mask Picker ✨ | `MaskPicker` | Picks masks from a batch |
| `Region-Genie_BBoxToMasks` | BBoxes to Masks ✨ | `BBoxesToMasks` | Bounding boxes → masks |
| `Region-Genie_RegionalLoRAs` | Regional LoRAs ✨ | `RegionalLoRAs` | Regional LoRAs from a masks batch, rows editor |
| `Region-Genie_CreateHookLoRA` | Create Hook LoRA (Quantized) ✨ | `CreateHookLoRAQuantized` | Single hook LoRA for int8/fp8 models |

- Category "Region Genie"; display names end in " ✨". ID lengths (17, 23, 24, 26, 27) set the search order. `SEARCH_ALIASES` now also include SAM, SAM 3, segment anything, select object, magic wand.
- **Comfy Registry (not published):** the `pyproject.toml` `name` is permanent and lowercase.

### Region Genie node

**Inputs** (widget order matters for old workflows):
- Required: `width`, `height`, `scene_prompt_positive`, `scene_prompt_negative`, `image_mode`, `min_region_pixels`, `paint_data` (hidden JSON state).
- Optional, in order: `model`, `clip`, `vae`, `image`, `size_from_image`, `size_from_latent`, `import_mode`, `scene_prompt_background`, `prompt_format`, `mode`, `edit_area`, `import_json`.
- Hidden combos with editor controls: `image_mode`, `prompt_format`, `mode`, `edit_area`.
- **Round 6:** `min_region_pixels` and `import_mode` are now **Settings only** (`RegionGenie.Main.MinRegionPixels`, `RegionGenie.Main.ImportMode`). The editor sends them in `paint_data` (`minPixels`, `importMode`) at each run, and `run()` prefers those over the hidden widgets, which are only a fallback (API use, old frontends).

**Outputs (13):** model, positive, negative, latent, prompt, color_map, masks, bboxes, elements, character_boxes, region_info, width, height.

**`prompt` format.** `prompt_family(model, clip, choice, hint, edit=False)`: the format control, else the model, else the clip's text-encoder class, else the front end's `promptFormatHint` (follows the `prompt` output to the text encoder and its loader; checkpoint file-name guess kept on purpose), else MOSS JSON. MOSS in Edit Mode → plain text.

**`paint_data` keys added at run time by `serializeValue`** (not stored in the canvas state): `autoApart`, `promptFormatHint`, `edit` (edit mode), `editMask` (edit mode), `llmCache`, `minPixels`, `importMode`.

## 3. Code layout

### Python

- **`__init__.py`:** mappings, legacy IDs, `SEARCH_ALIASES`, `_OBSOLETE` cleanup; imports `lora_triggers`, `llm_enhance` and **`region_select`** (they register routes).
- **`region_genie.py`:** the `RegionGenie` node.
  - Parsing, label map, palettes, `layer_centre`, the MOSS / Ideogram / text builders, `prompt_family`, `auto_apart_on`, `layout_from_json` + `POST /region_genie/convert_layout`, the LLM hook.
  - `shape_verts(kind, sides, bw, bh, radius)`: **round 6** adds `roundrect` (8 arc points per corner; radius = % of the shorter side, clamped 0-50, default 20; corners stay round because bw/bh are used). `layer_mask` passes the layer's `bw`, `bh`, `radius`.
  - Edit Mode helpers (round 4): `edit_size`, `fit_image`, `limit_image`, `empty_latent`, `lora_edit_format`, `REF_MODELS`, `MOSS_EDIT_FORMATS`, `VISION_PREFIX`.
  - **Round 5 edit mask:** `EDIT_MASK_DEFAULTS = {grow 8, feather 16}`; `grow_mask(m, px)` (scipy EDT, box-blur fallback); `edit_mask(change, keep, whole, grow, feather)`: kept regions are excluded, and the soft edge toward a kept region falls outside it. The latent's `noise_mask` uses it; `pdata["editMask"]` (grow -256..256, feather 0..256) overrides the defaults.
  - Table rows carry `keep`; `_regional_loras` passes `share_background`.
- **`regional_lora.py`:** the regional LoRA engine and the two LoRA nodes.
  - Forward hooks, `ModelArch` / `model_arch`, `Layout`, `TokenRegion`, token helpers, `regional_lora_patch`.
  - **Round 5:** `RegionSeparation(regions, strength, until, share_bg=False)`: with `share_bg`, pairs that involve background (label 0) image tokens aren't penalized, in both the joint and cross-attention paths; captions stay restricted. `RegionalLoRAs` has a new last required input `share_background` (BOOLEAN, default False).
- **`region_select.py` (round 7, new):** Select object, using ComfyUI's native SAM 3 / SAM 3.1 support.
  - Routes: `POST /region_genie/sam_select`, `POST /region_genie/sam_release`, `GET /region_genie/sam_models`. Route registration is skipped when `PromptServer.instance` doesn't exist (tests, scripts).
  - The model is loaded with `comfy.sd.load_checkpoint_guess_config` from `models/checkpoints` (default `sam3.1_multiplex_fp16.safetensors`; another file with "sam3" in its name is used when the Setting's file isn't there). `mm.load_model_gpu(model)` runs before each request, so ComfyUI manages VRAM: idle → moved to system RAM when a workflow needs room.
  - **Trunk cache:** the ViT trunk output is computed once per image (key: model, path, mtime, size) and kept on the CPU. Each click swaps `vision_backbone.trunk` for a tiny module returning the cached output (`_CachedTrunk`, under a lock), then calls ComfyUI's own `forward_segment` / detector forward. Tested to be bit-identical to the uncached path.
  - Points + box: one `forward_segment(point_inputs, box_inputs)` plus one mask-refine pass (as SAM3 Detect does). Text ("find all"): the clip encodes each comma-separated phrase with `:64` appended unless it already has `:N` (SAM 3's text encoder returns only 1 match per phrase otherwise); detections over the threshold are sorted by score; the best 16 (`REFINE_MAX`) get `_refine_mask` from `comfy_extras.nodes_sam3`, the rest keep the detector mask. Each mask carries its phrase as `label`.
  - Returns masks as run-length runs (zeros first, the editor's bitmap format) at the size the editor asks for (its raster grid).
  - `queue_busy()` → 409 `busy` while a workflow runs (the editor retries every 2 s). `keep_loaded` false: unload on release, and after 180 idle seconds (`threading.Timer`). Unload = drop references, `gc.collect()`, `cleanup_models()`, `soft_empty_cache()`.
  - `resolve_image` only accepts `input` / `output` / `temp` paths inside those folders (path traversal refused).
- **`llm_enhance.py`:** LLM Prompt Enhancer back end.
  - **Round 5 cache:** session-only by default (`_cfg = {disk: False, days: 30, max: 500}`); `configure()` from Settings (route `POST /region_genie/llm_cache_config`, plus a fallback read of `user/default/comfy.settings.json`); disk files (new and old cache folders) are deleted when disk caching is off; entries are stamped with a time and pruned by age and count.
- **`lora_triggers.py`, `bbox_masks.py`:** unchanged.

### JavaScript (`js/`)

- **`region_genie.js`** (about 4,270 lines): the whole Region Genie UI.
  - **Round 5:** shared-background right-click menu on the four-tiles button (`loraOpts.shareBg`, icon `allApartShared`); per-region keep/change in edit mode (`r.keep`, pencil/lock toggle, hatched overlay, 🔒 label prefix); edit-mask grow/feather fields in the list header (`state.editMask`, empty = follow Settings); the Whole image row toggles on a click anywhere except its buttons.
  - **Round 6 footer ("Footer B"):** a `Generate | Edit` segmented control, `change` select (edit only), format select ("auto · MOSS" after a run), LLM Settings sparkle icon, tag autocomplete icon; Export / Import on the right. Image mode is a segmented icon pair (backdrop / color map) in the top bar, shown only with an image connected and not in edit mode; with color map a min px field writes the Setting.
  - **Round 6 tools:**
    - variant tools with right-click menus and a corner triangle: lasso / lasso erase (plain, spline, magnetic), magic wand (connected, all similar colors), fill (normal, closing small gaps). `LASSO_MODES`, `TOOL_NUMS` (wandTol, fillGap), `refreshVariantButtons()`, `syncToolOpts()` (tolerance / gap fields).
    - magic wand (W): uses the backdrop pixels (`backdropPixels`), flood or global match, per-channel tolerance.
    - magnetic lasso: Sobel edge map of the backdrop (`edgeMap`, ≤1024 px), `snapToEdge` / `snapSegment`, radius `magnetRadius()`.
    - fill closing gaps: chamfer `distanceMap`, flood the area that stays open after growing the walls by the gap, then grow back.
    - rounded rectangle (`radius` field, layer key `radius`), Alt+drag draws a shape from its centre, Shift+click straight lines for brush/eraser (`lastStrokeEnd`), Alt+click eyedropper for painting tools.
    - Arrange pop-over (`.rg-arrange`, fixed in `document.body`): flip H/V (shapes: H = mirror ops; V = rot+180 + mirror), align ×6 + centre, grow/shrink N px (`growLayer` turns the layer into one bitmap op).
    - shared helpers `rasterSize`, `regionLabels`, `flood`, `commitMask` (into the selected plain layer of the active region, else a new layer).
  - **Round 7 Select object (Q):** `pick` state `{pts [[x,y,label]], box, text, masks, R, sent}`; `pickRequest` (one request at a time, re-sends the latest state; busy → retry), `pickPointer`, `pickFind`, `pickAccept(each)` (Shift+Enter = one new region per found object, prompt = its phrase), `pickCancel`/`pickRelease`, `drawPick` overlay. `backdropRef` = `{filename, subfolder, type}` of the backdrop (Load Image input, or the run preview), sent to the server. The find field `.rg-find` shows with the tool.
  - Test hooks: `__rgState`, `__rgActive`, `__rgSetBackdrop(img, ref)`, `__rgToClient`, `__rgOutputRegions`, `__rgLabels`, `__rgHandles`, `__rgBox`, `__rgView`, `__rgRender`. Style element id `rg-style-v8`.
- **`rg_shared.js`:** icons (round 6/7 added tag/tagOff, imgBackdrop/imgColorMap, wand/wandGlobal, fillGaps, lassoMagnetic/lassoEraseMagnetic, arrange, flipH/V, align*, layerGrow/Shrink, samSelect), LoRA list, trigger chips, autocomplete layer (`autocompleteToggle` is now an icon button `.rg-ac-btn`), `keepWidgetValuesByName`, `migrateProps`, Settings (`SETTINGS`, `SET`, `getSetting`, `setSetting`, `TOOL_VARIANTS`, `TOOL_NUMBERS`, `toolDefault`, `toolNumber`, `onToolDefault`, `llmCacheSettings`, `postLlmCache`, `editMaskDefaults`).
- **`regional_loras.js`:** rows editor; keeps `share_background`; autocomplete icon.
- **`rg_llm.js`, `rg_colorpicker.js`, `hook_lora.js`, `bbox_masks.js`:** unchanged since round 4.
- **Saved `node.properties` keys:** `rg_llm`, `rg_autocomplete`, `rg_widget_values`, `rg_labels`, `rg_model_arch`.

### Settings added in rounds 5-7 (Settings > Region Genie)

- Region Genie node / Regional LoRAs: share the background (new nodes).
- Edit Mode: edit mask grow (default 8) and feather (16).
- Canvas tools: lasso and lasso erase default (plain / spline / magnetic), magic wand default and tolerance (32), fill default and gap size (4).
- LLM cache: keep on disk (off), days (30), max entries (500).
- Region Genie node: color map min region pixels, import_json when the canvas isn't empty (both now apply to every node at its next run).
- Select object: model file (`RegionGenie.Select.Model`), after a selection keep loaded / unload (`RegionGenie.Select.KeepLoaded`, default keep), find-all confidence (`RegionGenie.Select.Threshold`, 0.5).

## 4. Feature state and decisions (most recent first)

### Round 7 (Nov 11): Select object (SAM 3.1)
- User's choices: keep the model loaded after first use (Settings option to unload after each selection); include text "find all".
- The user asked whether ComfyUI frees VRAM for a kept-loaded SAM model: yes, because it is loaded through ComfyUI's model management; answered with sources.
- Decisions made without asking (told to the user): find-all appends `:64` per phrase; only the best 16 matches get the sharper edge pass.

### Round 6 (Nov 11)
- Footer B, autocomplete icon 1 (tag, lit / slashed), min px and import Settings-only with min px also next to the image-mode buttons, and every suggested canvas tool except click-to-select (which became round 7).

### Round 5 (Nov 10-11)
- Shared-background keep-apart (right-click menu), per-region keep / change in Edit Mode (row icon + hatching), separate edit-mask grow / feather (list header), Settings for tool defaults, LLM cache session-only by default with Settings, and the Whole image row click target.
- Behavior note given to the user: the edit mask now uses its own grow 8 / feather 16 instead of the region feathers, so edit results shift a little; set 0 / 0 for the old behavior.

### Round 4 and earlier (Nov 10)
- **Round 4 Edit Mode:** mode / change controls, `latent` output, `vae` input, reference images for MOSS (edit layout from the LoRA's keys), Krea 2, Flux.1/2/3; edit LoRAs per model in Settings, added to Whole image (tag `edit`) and removed when leaving edit.
- **Round 3:** one `prompt` output with a format control; Flux / Flux 3 / Anima / SDXL / SD1.5 in the one-pass engine; keep-apart automatic for models without a layout format.
- **Earlier:** Krea 2 auto-apart, Ideogram JSON per Ideogram's guide, `scene_prompt_background`, file renames, Resolution Selector sizing, Krea 2 and Ideogram 4 one-pass, rename to Region Genie.
- **Standing features:** keep all regions apart, layer clipboard and pop-ups, LLM Prompt Enhancer, tag autocomplete, Settings defaults, UI decisions (node width 700, square canvas, collapsible list, CIELAB region colors, color picker, snap magnet, overlay-scrollbar padding).

## 5. Open items and offered ideas

**Not verified on real hardware (no GPU in the sandbox):**
- Select object mask quality: the real SAM 3.1 weights couldn't be downloaded (huggingface.co blocked); all checks used a random-weight model with the real architecture. Real speed on GPU, and how the ComfyUI offload/reload feels.
- Magnetic lasso and magic wand on real photos.
- Everything from rounds 3-6 on the user's machine at 4K (footer B, Arrange pop-over, tool rows, edit mask, shared background in real sampling).
- Earlier items: Edit Mode per model, MOSS ai-toolkit path, Flux / Anima / SDXL regional LoRAs, real LLM generation, pysssss AutoCompleter.

**Ideas offered, not requested:** an "OpenAI-compatible server" LLM option; Ideogram `style_description`.

**Things to keep in mind:**
- In generate mode the backdrop image is stretched to the canvas size (pre-existing behavior; masks map back by normalized coordinates).
- Keep-apart uses the non-fused attention path (slower, more VRAM). Caption spans only apply when the text length matches. Flux 3's text layers are out of the LoRAs' reach. Rare length clash (Flux.1 with 256 T5 tokens at 256×256 px).
- Edit Mode: before the first run all configured edit LoRAs are added; Flux.1 dev vs Kontext can't be told apart; Krea 2 editing needs a third-party edit pack.
- Grow/shrink and flips change layer data; grow/shrink turns shapes into pixels.

## 6. How it was tested (for the next session)

**Network (Nov 11):** the user enabled network egress. GitHub, PyPI and npm work; **huggingface.co and download.pytorch.org are blocked by policy** (don't look for mirrors or workarounds: that was refused as a policy bypass).

- **Real ComfyUI in the sandbox (round 7):**
  - `git clone --depth 1 https://github.com/Comfy-Org/ComfyUI.git /tmp/comfy_src` (was ComfyUI 0.45.0, frontend 1.58.5).
  - `pip install --break-system-packages torch torchvision` from PyPI (CUDA wheels, run on CPU), then ComfyUI's `requirements.txt` incl. `comfyui-frontend-package`.
  - Symlink the pack into `custom_nodes`, `extra_model_paths.yaml` pointing at `/tmp/comfy_models`, start with `python3 main.py --cpu --listen 127.0.0.1 --port 8188`.
  - SAM 3.1 fixture: `make_fake_sam.py` builds ComfyUI's SAM3Model (image_model SAM31) and SAM3 CLIP with random weights and saves them in the real checkpoint key layout (1.75 GB, detected by ComfyUI's own loader). Masks are meaningless; it tests the plumbing.
  - On 2 CPUs: first click ~38 s (trunk), later clicks ~4 s.
- **Test files (rebuild as needed; they don't carry over):**
  - `test_round5.py` (49), `test_round6.py` (18): Python with a numpy-backed torch stub and comfy / folder_paths stubs.
  - `test_select.py` (31): region_select against real ComfyUI code: path safety, busy, loading, ComfyUI tracking the model, cached == uncached (points+box and text), output masks, unload and idle timer.
  - Browser tests in a stub harness (`/tmp/harness`, stub `app.js` / `api.js` with `window.__apiHandlers`), Playwright Chromium at `/opt/pw-browsers`: `ui_test.cjs` (30, round 5), `ui_test6.cjs` (46, round 6), `ui_test_select.cjs` (26, Select object with a stubbed server).
  - `real_comfy.cjs`: smoke test in the real frontend, legacy and Nodes 2.0 (`Comfy.VueNodes.Enabled`); dismiss the template dialog with Escape first.
- **Lint:** no ESLint installed this time; `node --check` on every JS file.

## 7. Compatibility code that still uses the old names (to remove later)

- Old node IDs `RegionalMaskKit_*` (`LEGACY_IDS`, each JS file's `NODE_NAMES`); search aliases for old names.
- `rg_shared.js`: `migrateOldSettings` / `OLD_PREFIX`, `RENAMED_PROPS` / `migrateProps`.
- `auto_apart_on`: the `krea2AutoApart` fallback.
- `region_genie.js`: `OLD_OUTPUT_NAMES` / `remapOutputs`.
- `rg_llm.js`: `OLD_LIB_FILE`; `llm_enhance.py`: `OLD_CACHE_FOLDER` (its files are deleted when disk caching is off).
- `__init__.py`: `_OBSOLETE` cleanup; README "Renamed from Regional Mask Kit".
- Left as they are: DOM widget name `color_map_canvas` / type `ColorMapCanvas`, the `color_map` output.
