# Region Genie (ComfyUI node pack): handoff summary

**State (Nov 17, 2026):** version 0.23.0 (`pyproject.toml`), GPL-3.0. The GitHub repository is the source of truth; work happens on branches and reaches `main` through pull requests the owner merges. The history of every development round is in `docs/CHANGELOG.md`; this file describes the pack as it is now.

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
- **Delivery each round:** commits on a working branch, a pull request when the owner asks, and a report of what was and wasn't tested. Update this handoff, `docs/CHANGELOG.md` and the manual (`README.md`, `docs/*.md`) every round.
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
| `Region-Genie_SaveImage` | Save Image (Region Genie) ✨ | `SaveImageRG` (`save_image.py`, `js/save_image.js`) | PNG 0-9 / 8-16-bit, WebP, JPEG, AVIF; mask transparency; size readout |

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
- **`model_paths.py` (round 18, new):** model files anywhere. `full_path(folders, name)` (a full path to an existing model file as it is, else ComfyUI's lookup in each folder type in turn), `absolute_names()` (a re-entrant context manager that, while active, lets `folder_paths.get_full_path(_or_raise)` return a full path, so core loaders that take a name, `LoraLoaderModelOnly`, `ModelPatchLoader`, `LoadDA3Model`, can load one; restored afterwards), `browse(path, folders)` + `GET /region_genie/browse` (sub-folders and model files of one folder, hidden ones skipped; `rel` = the name ComfyUI knows a file by when it is inside one of the folders), `GET /region_genie/model_exists`. Used by control.py (Anima: `ANIMA_FOLDERS = model_patches, controlnet`), `regional_lora.load_runtime_lora` / `merge_loras`, `region_genie.lora_edit_format`, `lora_triggers`, `region_select.resolve_model`.
- **`lora_triggers.py`, `bbox_masks.py`:** unchanged (lora_triggers: full paths, round 18).

### JavaScript (`js/`)

- **`region_genie.js`**: registers the extension and calls `buildEditor(node)`. The editor itself is in **`js/editor/`** (split in round 24; no behavior change):
  - `parts.js`: the list of parts, in the order they run, and `buildEditor`. **Read its header first.** All parts of one node share one object, `E`. A function or value only its own part uses is a local; one another part uses is published on `E` (`Object.assign(E, …)` at the top of the part for functions, `E.name = name` after a value's declaration) and read as `E.name` elsewhere; a variable that changes and is used by several parts lives on `E` only (`E.state`, `E.tool`, `E.view` …). Each part is a generator with one `yield`: first every part runs up to its yield (publishing its functions, so the order of the files doesn't matter for calls), then the bodies run in order.
  - Without a node (plain modules): `shared.js` (constants and values shared by every Region Genie node on the page (tool versions, the layer clipboard, sizes)); `state.js` (paint_data: the editor's saved state (format, loading, converting older data)); `geometry.js` (geometry without a node: edge snapping, masks, outlines, shapes, bitmap layers); `style.js` (the editor's CSS); `graph.js` (graph helpers: chaining node callbacks, links, moving links of old workflows to renamed outputs); `colors.js` (region colors and palettes).
  - Parts, in order: `core.js` (the node's widgets, last-run wildcard results, the expand button, and the editor's state variables); `toolbar.js` (the editor's elements, the tool buttons (with versions), the tool options strip on the canvas, Arrange, opacity and labels); `footer.js` (the footer: Export / Import, image mode, Generate / Edit, wildcards and the seed control; keeping the footer in step with the settings); `model.js` (the connected model: the footer pick, the guess from the graph, layout / standard, what the settings row shows); `rows.js` (the Control and Edit rows under Whole image, the per-region control / keep switches, and the message bar); `canvasUi.js` (the brush size slider on the canvas, the list header's options (keep apart, edit mask), sub-sections and the list height); `sizeRow.js` (the image size row at the top of the node (aspect ratio / presets / manual)); `view.js` (image size from the graph (linked inputs, Resolution Selector), canvas size and view (zoom, pan, coordinates), layer geometry); `regions.js` (regions, undo / redo, what can be done to a layer (add, duplicate, copy / paste, merge, delete …), tool switching and hints); `render.js` (drawing the canvas, hit testing, and the region label map (what the outputs will contain)); `selectTools.js` (fill, magic wand, Select object (SAM 3.1) and Arrange (flip, align, grow / shrink)); `pointer.js` (mouse, pen and keyboard on the canvas); `popups.js` (the pop-up editors for prompts, and the editor's keyboard shortcuts); `list.js` (the region list: one tree of regions with their LoRAs, layers and palettes); `llm.js` (lLM Prompt Enhancer: the sparkle buttons, requests and results); `lifecycle.js` (the backdrop image, layout import / export, and the node's lifecycle (load, save, resize, run results)).
  - When adding code: put it in the part it belongs to; if another part needs it, publish it on `E` the same way. A new part goes in `PARTS` in `parts.js` at the place its body must run. ComfyUI loads every `.js` under `js/`, also in subfolders, so nothing else needs registering.
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
  - **Round 8 Select object fixes:** the tool button uses icon `samSelect` (`addTool(key, title, icon)`; it used to look up `ICONS.object`, which doesn't exist, so the button was blank). ✓ / ✕ buttons after the find field (`pickOkBtn` / `pickNoBtn`, icons `check` / `close`, kept in step by `syncPickBtns()` on every draw). `pickSettle()`: leaving the tool (or the image going away) adds a finished selection, or waits for the answer in flight (`pick.acceptOnAnswer`), instead of discarding it. `pickNext()`: Shift+click / Shift+drag adds the selection so far and starts a new one. `pickAccept` adds to the active region in both modes (`commitMask`: into its selected plain layer, else a new layer); `asRegion` is only used by Shift+Enter (find all, one region each). (A first version made a new region per selection in Edit Mode; the user reverted that the same day, to build regions from layers.) Errors go to the message bar (`msgBar`, `.rg-msg`, between the canvas and the list: `showMsg` linkifies URLs, Copy link via `copyText` with an `execCommand` fallback for non-secure pages, `hideMsg` on ✕ / another tool / mode change / a successful answer). Ctrl+C with text selected in the bar is left to the browser (`msgSelected()`), and the click-capture that focuses the key sink skips the bar.
  - **Round 11 toolbar:** `GROUPS` (shape / lasso / fill / wand / erase: `cur()`, `entries()` = [id, icon, title, pick]), one `.rg-btn.grp` per group with `.rg-grp-ic` and the ▾ `.rg-grp-dd` (click: the list; right-click too), `data-group` for tests, `toolBtns` maps every tool to its group's button (`setTool` highlights by button), `grpCur` (wand / erase: the tool shown), `refreshVariantButtons()` (icon + title from the current entry). Tool options in `optStrip` (`.rg-toolopts`, in `cvBox`) with small icon labels, `syncStrip()`. Image opacity: `bdBox` is now `.rg-oslider` on the canvas's right edge (`syncOpacity`, drag / wheel). New icons shapeRect … shapeHeart, opacity.
  - **Round 10 expand / pop-up / text size:** `addExpandButton(t, title, onOpen)` (button `.rg-expand` in the field's parent, placed from offsets, so it works in legacy and Nodes 2.0); `popLayout(ed, kind, autoPlace)` (saved size, else POP_W; saved place, else the editor's own placement) and `popFrame(ed, kind, head, curCat, applyFonts)` (A− / A+, title-bar drag and `.rg-pop-grip` resize, converting screen px with `wrap.offsetWidth / rect.width`); `applyFieldFonts()` (poll: scene textareas' style, CSS variables `--rg-fs-r/t`, `--rg-lh-r/t` for the list). `RG_RECENT` / `recentSetting` / `rememberSetting` (module level): values just written to Settings, read back before the Settings store has them.
  - **Round 10 Control:** `state.control = {on, kind, strength, start, end}` (`normControl`), `r.noControl`; `controlRow()` / `controlDetails()` / `controlToggle(r)`; `syncControlLoras()` keeps the control LoRAs in Whole image (`{lora, control: model, ckind: moss | depth | canny}`, only the last run's model once known); `paint_data.control.files` = `controlFiles()` (Settings) at serialize time; `onExecuted` loads `message.control_map` (`controlMap`, drawn at 0.65 alpha when the eye is on).
  - **Round 9 size row:** `rg_size` DOM widget (`sizeRow`), moved to the top of `node.widgets`; settings in `node.properties.rg_size` = `{mode: "aspect ratio" | "presets" | "manual", ratio: {aspect, mp, multiple, swap}, preset: {w, h, swap}, manual: {w, h, link}}` (`sizeCfg()` makes one from width / height for old workflows); `applySize()` writes the hidden width / height widgets; `setManualSize` for imported layouts; `syncSizeRow()` (called from `onDimsChanged`) shows the final size and why; `openPresetEditor()` (`.rg-presets`, fixed in `document.body`). `moveSizeLinks()` on configure moves links from the old width / height sockets to `width_in` / `height_in`. `dims()`/`editDims()` read `width_in` / `height_in`.
  - **Round 9 region eye:** `r.hidden`; `isShown(L)` (own eye and region eye) is used for drawing, hatching, hit testing, the region raster and the selection box; `outputIndexMap` skips hidden regions; `revealRegion()` in `ensureRegion()` (painting shows the region again; `keepHintUntil` keeps its note through the tool switch after a shape).
  - **Round 9 wildcards:** `wcFilled` (field key → `{raw, filled}`; keys `scene`, `negative`, `background`, `r<id>`, `r<id>.text`), `filledFor(key, raw)` (only while the field still holds that raw text), `wcFields()`, `wcMark()` (tooltip + `.rg-wc-filled` gold edge), `wcSetFilled()` (from `onExecuted` `message.wildcards`, or a preview), `wcUseAll()`; canvas labels use the filled text. Region pop-up: `.rg-wc-pick` in the header (inserts into the last focused field), `.rg-wc-use` by each field label; scene pop-up the same. `paint_data` carries `wcPerField`.
  - **Round 8 list pop-up:** double-clicking a region's prompt (or text) field in the list opens `editPrompt(rid, null, field)`; with no label rect, `place()` anchors the pop-up just below the row (else just above), converting screen px to CSS px with `wrap.offsetWidth / rect.width` for the graph zoom.
  - **Round 7 Select object (Q):** `pick` state `{pts [[x,y,label]], box, text, masks, R, sent}`; `pickRequest` (one request at a time, re-sends the latest state; busy → retry), `pickPointer`, `pickFind`, `pickAccept(each)` (Shift+Enter = one new region per found object, prompt = its phrase), `pickCancel`/`pickRelease`, `drawPick` overlay. `backdropRef` = `{filename, subfolder, type}` of the backdrop (Load Image input, or the run preview), sent to the server. The find field `.rg-find` shows with the tool.
  - Test hooks: `__rgState`, `__rgActive`, `__rgSetBackdrop(img, ref)`, `__rgToClient`, `__rgOutputRegions`, `__rgLabels`, `__rgHandles`, `__rgBox`, `__rgView`, `__rgRender`. `__rgRefresh` (round 9: save + re-render after a test edits the state). Style element id `rg-style-v8`.
- **`rg_shared.js`:** icons (round 6/7 added tag/tagOff, imgBackdrop/imgColorMap, wand/wandGlobal, fillGaps, lassoMagnetic/lassoEraseMagnetic, arrange, flipH/V, align*, layerGrow/Shrink, samSelect), LoRA list, trigger chips, autocomplete layer (`autocompleteToggle` is now an icon button `.rg-ac-btn`), `keepWidgetValuesByName`, `migrateProps`, Settings (`SETTINGS`, `SET`, `getSetting`, `setSetting`, `TOOL_VARIANTS`, `TOOL_NUMBERS`, `toolDefault`, `toolNumber`, `onToolDefault`, `llmCacheSettings`, `postLlmCache`, `editMaskDefaults`). **Round 9:** `SIZE_ASPECTS`, `ratioSize`, `pyRound`, `parseSizePresets` / `formatSizePresets` / `SIZE_PRESETS_DEFAULT`, `ratioLabel`; wildcards: `wildcardInfo` (route `/region_genie/wildcards`), `hasWildcards` (same rule as Python), `pickWildcard`, `insertAtCursor`, the `__` autocomplete (`attachWildcardComplete`, hooked into `attachAutocomplete`, so every autocomplete field gets it; `autocompleteOpen` counts it), `wildcardSeedControl(node, mk, host)` (hides `wildcard_seed`, `serializeValue` → 0 without syntax, `beforeQueued` / `afterQueued`, mode in `node.properties.rg_wc_mode`), `WC_CSS`; icons sizeRatio / sizeList / sizeManual / swapWH / wildcard / dice / plusOne / useFilled / check / close. Settings: `RegionGenie.Size.*`, `RegionGenie.Wildcards.PerField`.
- **`regional_loras.js`:** rows editor; keeps `share_background`; autocomplete icon.
- **`rg_llm.js`, `rg_colorpicker.js`, `hook_lora.js`, `bbox_masks.js`:** unchanged since round 4.
- **Saved `node.properties` keys:** `rg_llm`, `rg_autocomplete`, `rg_widget_values`, `rg_labels`, `rg_model_arch`, `rg_size` (round 9), `rg_wc_mode` (round 9, both nodes).
- **Round 10 model / downloads (JS):** `MODEL_NAMES`, `archFromText`, `modelSource`, `clipType`, `guessArch`, `modelInfo` / `modelArch`, `syncEditLoras`, `onModelChanged`, the footer `modelSel` (`node.properties.rg_model_pick`), `neededControlFiles` / `missingControlFiles` / `showControlMissing` / `checkControlFiles` (message bar). `rg_shared.js`: `CONTROL_DOWNLOADS` (file, url, note per Settings key), `controlFileHelp` (Settings tooltips), `CONTROL_KIND_HELP`, `controlFolder`, `controlLabel`.
- **`rg_shared.js` (round 11):** `addExpandButton` (the same as the main node's), `openFloatPopup(o)` / `closeFloatPopup` / `FPOP_CSS`: the floating pop-up editor (fixed in `document.body`, at the field; A− / A+, drag, grip, wildcard picker, use-filled, Enter / Esc), used by Regional LoRAs (`positive_prompt`, `negative_prompt` with the scene-prompt text size, the rows' words with the region-prompt one). Regional LoRAs' node fields follow Settings > Text size (CSS variables `--rg-rl-fs` / `--rg-rl-lh`).
- **`control.py` (round 10):** `config(pdata)` (None = off), `lora_tag_ok(row, cfg, arch)` (used in `_regional_loras` for Whole image rows with a `control` tag), `region_mask(regions, id_to_index, idx)`, `apply(cfg, arch, model, positive, negative, vae, image, control_image, color_map, region_mask, W, H, notes)` → (model, positive, negative, map). MOSS: the same maths as ComfyUI's `MOSSImageControl` (VAE latents [color | depth] × strength, `concat_latent_image` with `conditioning_set_values_with_timestep_range`), plus the region mask on the latent. Flux.1 LoRA: like `InstructPixToPixConditioning`. ControlNet files: `comfy.controlnet.load_controlnet` + `nodes.ControlNetApplyAdvanced`. Anima: `ModelPatchLoader` + `AnimaLLLiteApply` (mask). Maps: `control_image`, else ComfyUI's `Canny` (0.4 / 0.8) or Depth Anything 3 (`LoadDA3Model`, `DA3Inference._execute_mono`, `DA3Render._depth_to_image(..., "v2_style")`, near = white; the last depth map is cached by image hash). Loaded files are cached in `_cache`. `region_genie.run` calls it after the latent and returns `ui.control_map` (`_save_preview(..., "regiongenie.control")`).
- **`wildcards.py` (round 9):** `impact()` imports `impact.wildcards` (Impact Pack puts its modules folder on `sys.path`); `has_syntax`; `field_seed` (per field = seed + crc32(key)); `Filler(seed, per_field, notes)` fills a field and records `{raw, filled}`; routes `GET /region_genie/wildcards[?refresh=1]` and `POST /region_genie/wildcards/fill` (preview). `region_genie.run` fills the scene prompts and every region's prompt / text right after the hidden regions are dropped (before the table, so the LLM sees filled text; LLM results get the raw text back as `prompt` so the editor's match works), and returns `ui.wildcards`. `RegionalLoRAs.run` fills prompt (not JSON), negative_prompt and the rows' words (`row<k>`, k = position in the full row list); `loras_data` carries `wcPerField`. New hidden inputs: `wildcard_seed` (last optional input of both nodes), `width_in` / `height_in` (Region Genie, before it).
- **Region eye (Python):** `run()` drops hidden regions before the table; their layers are skipped like a deleted region's, and in color-map mode an image color that matches a hidden region (and no visible one) stays unspecified.

### Settings added in rounds 5-7 (Settings > Region Genie)

- Region Genie node / Regional LoRAs: share the background (new nodes).
- Edit Mode: edit mask grow (default 8) and feather (16).
- Canvas tools: lasso and lasso erase default (plain / spline / magnetic), magic wand default and tolerance (32), fill default and gap size (4).
- LLM cache: keep on disk (off), days (30), max entries (500).
- Region Genie node: color map min region pixels, import_json when the canvas isn't empty (both now apply to every node at its next run).
- Select object: model file (`RegionGenie.Select.Model`), after a selection keep loaded / unload (`RegionGenie.Select.KeepLoaded`, default keep), find-all confidence (`RegionGenie.Select.Threshold`, 0.5).

## 4. Current design and why

The reasons behind the parts a new session is most likely to trip over. Each ends with the round(s) in `docs/CHANGELOG.md` that have the details.

**Model files (Settings, Edit rows, LLM)**
- Every model-file field is a button showing the file's name; a click opens ComfyUI's classic menu (`LiteGraph.ContextMenu`) through `fileField()` / `openModelMenu()` in `rg_shared.js`, in legacy mode and Nodes 2.0 alike. Reasons: rgthree's Auto Nest only wraps that menu, and the Nodes 2.0 dropdown isn't open to extensions. Region Genie adds a search across the whole tree, and its own filter box when ComfyUI leaves it out. (Round 23)
- **Do not use ComfyUI's native Settings combo for file lists.** It builds a component per option and froze the tab with a large LoRA library (1000 files × 25 settings). `tests/real_settings.cjs` guards this with 10 000 LoRAs. (Rounds 21, 22)
- **Do not pass file names through vue-i18n.** A backslash or `@` in a name is message syntax there and made settings disappear on Windows. (Rounds 15, 18)
- Values: a plain name in the setting's home folder, `folder:name` from another model folder, or a full path from Browse… (`model_paths.py`: `split_folder`, `full_path`, `absolute_names()` so core loaders accept a full path). Browse… is behind the 'Browse… for model files' switch. Inside the Settings dialog a menu must live in the dialog element (`keepMenusIn`). (Rounds 18, 19, 23)

**Control and Edit rows (under Whole image)**
- `state.controls` is a list of rows (kind, strength, start, end); ＋Control is always there. ControlNets chain and LLLite patches stack; MOSS-Image's control LoRA and Flux.1's depth / canny LoRAs share one model input, so Python uses only the first such row and says so in `region_info`. A region's control switch applies to every row. (Rounds 10, 18, 23)
- Edit rows show only in Edit Mode: the Settings edit LoRA for the model (its ✕ sets `editOff` for this node), plus the node's own `editLoras` from ＋Edit. Edit / control LoRAs are tagged entries in `sceneLoras`, managed by `syncEditLoras` / `syncControlLoras` / `pruneManagedLoras`, and not listed under Whole image. (Rounds 15, 18, 23)
- The model is the last run's, else a guess from the graph, else the footer pick (`rg_model_pick`); it decides the prompt format and which files the rows use. The stored name is "MOSS-Image" (older "MOSS Image" converts on load). (Rounds 10, 12, 17)

**Editor**
- One-row toolbar with ▾ version buttons and a tool-options strip on the canvas; the footer is one row (`flex-wrap` off) because wider system fonts wrapped it. (Rounds 11, 21)
- Pop-up editors open from the expand button (double-click selects words), can leave the node, and close only by ✕ / Esc. (Rounds 10, 12)
- MOSS-Image's layout / standard switch: layout unless standard was chosen while there are regions (`rg_moss_layout === false`); standard by itself with no shown region or in Edit Mode, where a click does nothing; the first region on an empty canvas clears a standard choice (`layoutHad` in `syncLayoutBtn`, reset in `load()`). (Rounds 12, 20, 25)
- 'Keep all regions apart' has three states in `loraOpts`: `allRegions` (on for this node), neither (automatic: a run turns it on for a model without a layout format, and reports `auto_apart`), `autoOff` (off for this node, also where it would turn on). The button shows on for the first, and for the second after such a run; a click always changes what it shows. (Rounds 3, 25)
- Holes are a ✂ switch per layer: `region: 0` plus `owner` for the region it is listed under. Layout mode shows as off when no region is visible. (Round 20)
- Number fields size themselves through a page-wide observer in `rg_shared.js` (`autoNumber`). Rows that redraw on a timer must not replace an element under the mouse, or its tooltip never appears (`setHTML`). (Round 12)
- The workflow loader keeps unknown keys (it once dropped new ones on reload). New node inputs go **after** existing ones: values are stored by position, and an input added in the middle shifted them (`keepWidgetValuesByName` now also resets invalid values). (Rounds 10, 20)

**Other nodes**
- Save Image (Region Genie): design in `docs/superpowers/specs/2026-11-13-save-image-design.md`; every node keeps the ✨ title icon (a custom icon was tried and rejected). (Round 13)
- Select object keeps SAM 3.1 loaded through ComfyUI's model management, so ComfyUI frees it when it needs the memory. (Rounds 7, 8)
- Wildcards send seed 0 while no field has wildcard syntax, so the node stays cached. (Round 9)
- LLM Prompt Enhancer: presets live in `user/default/region_genie/llm_presets.json`; every pop-up field is also a Settings row (`LLM_FIELDS`, `LLM_ROWS`). (Round 19)

**Tooltips:** one item per line, capitalized sentences; `tests/tooltip_rules.cjs` and `tests/real_tooltips.cjs [vue]` enforce it. (Round 14)

## 5. Open items and offered ideas

**Not verified on real hardware:** see `docs/HARDWARE-CHECKLIST.md` (no GPU in cloud sessions). Remove an item there when the owner reports it working.

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
- **Real ComfyUI in a new session (round 11+):** `bash tests/setup_real_comfy.sh --start` installs and starts it (see `tests/README.md`); a new cloud session's machine starts without it. The user chose a script in the repo over a cloud-environment setup script, so sessions only pay the ~5 GB download when they need real-frontend tests.
- **Round 9 setup (no model files):** ComfyUI v0.45.2 (latest release) checked out from GitHub, torch from PyPI (CPU), ComfyUI-Impact-Pack from GitHub (its requirements without the SAM lines, plus `segment-anything`), a test wildcard `wildcards/rgtest/color.txt`. `tests/real_run_wildcards.cjs [vue]`: 22 checks each (size row, old-workflow conversion, a real run with a Resolution Selector and a hidden region checked in the output image, wildcards preview / run / randomize / use-filled / `__` list / picker, Regional LoRAs). huggingface.co answered this session, but the user asked not to download big checkpoints.
- **Round 10:** `tests/test_control.py` (37 checks, needs `COMFY_DIR`), `ui_rows_popups.cjs` grew to the pop-up / text size / Control row / reload checks, `real_run_wildcards.cjs` to 33 checks per mode (with the model guess and the missing-file message); round 11: 41 per mode (one-row toolbar, Regional LoRAs rename / old workflow / floating pop-up), and `ui_rows_popups.cjs` the toolbar checks (expand buttons, pop-up drag / resize / A+, Control row and a run with control on, the map overlay).
- **Round 13:** `test_save_image.py` (encoders, metadata, the node: naming, batches, masks, summary, tooltips) and `real_save_image.cjs [vue]` (24 checks in legacy, 23 in Nodes 2.0; needs `COMFY_DIR` for the output folder); `real_fields_popups.cjs` 37 per mode since the Regional LoRAs API-workflow checks.
- **Round 12:** `test_prompt_format.py` (20: format from the model pick, layout switch, no-region fallback, background only in Ideogram JSON, old hidden format), `real_fields_popups.cjs [vue]` (35 per mode: number fields fit 1-5 digits / decimals / minus, a tooltip on every shown control that isn't redrawn — default state, a pop-up open, Regional LoRAs —, presets keep the size, model dropdown / layout switch / background, old-workflow conversion, pop-ups (outside clicks, drag outside the node, A+, ◀ / ▶ order and geometry, Esc both ways, tab switch), divider, folded strip, Regional LoRAs ◀ / ▶). Older tests updated for the folded strip, the model dropdown and the pop-up placement.
- **Test files (rebuild as needed; they don't carry over):**
  - `test_edit_mode.py` (49), `test_shapes_import.py` (16), `test_hidden_regions.py` (round 9: hidden regions and wildcards with a stand-in Impact module): Python with a numpy-backed torch stub and comfy / folder_paths stubs.
  - `test_select.py` (31): region_select against real ComfyUI code: path safety, busy, loading, ComfyUI tracking the model, cached == uncached (points+box and text), output masks, unload and idle timer.
  - Browser tests in a stub harness (`/tmp/harness`, stub `app.js` / `api.js` with `window.__apiHandlers`), Playwright Chromium at `/opt/pw-browsers`: `ui_editor.cjs` (29, round 5), `ui_footer_tools.cjs` (46, round 6), `ui_rows_popups.cjs` (round 9: region eye, size row), `ui_select_object.cjs` (45 since round 8: Select object with a stubbed server, icons not blank, ✓ / tool-switch / Shift+click, Edit Mode adds to the active region, list double-click pop-up, the message bar). The harness is in the repo now (`tests/harness`), run with `tests/run_ui.sh`; Playwright is preinstalled in cloud sessions, scipy may need `pip install scipy`. The run scripts aren't executable in git: run them with `bash`.
  - `real_smoke.cjs`: smoke test in the real frontend, legacy and Nodes 2.0 (`Comfy.VueNodes.Enabled`); dismiss the template dialog with Escape first.
- **Lint:** no ESLint installed this time; `node --check` on every JS file.

## 7. Compatibility code that still uses the old names (to remove later)

- Old node IDs `RegionalMaskKit_*` (`LEGACY_IDS`, each JS file's `NODE_NAMES`); search aliases for old names.
- `rg_shared.js`: `migrateOldSettings` / `OLD_PREFIX`, `RENAMED_PROPS` / `migrateProps`.
- `auto_apart_on`: the `krea2AutoApart` fallback.
- `region_genie.js`: `OLD_OUTPUT_NAMES` / `remapOutputs`.
- `rg_llm.js`: `OLD_LIB_FILE`; `llm_enhance.py`: `OLD_CACHE_FOLDER` (its files are deleted when disk caching is off).
- `__init__.py`: `_OBSOLETE` cleanup; README "Renamed from Regional Mask Kit".
- Left as they are: DOM widget name `color_map_canvas` / type `ColorMapCanvas`, the `color_map` output.
