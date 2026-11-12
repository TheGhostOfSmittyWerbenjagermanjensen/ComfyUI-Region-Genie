# Region Genie (ComfyUI node pack): handoff summary

**Latest version:** `ComfyUI-Region-Genie.zip`, delivered Nov 11, 2026, after rounds 5, 6 and 7 (round 7 = Select object with SAM 3.1). It is 201,205 bytes and its SHA-256 starts `8b16ddd1583265734a6c5c274c51a36b7a04a949d146fd7a80fcdde2d2b13f45`. The project's Context files match it.

**Moved to GitHub (Nov 11):** the project now lives in a GitHub repo and is worked on in Claude Code on the web. **The repo is the source of truth**; the Context files and the zip described above are the state before round 8. Rounds from 8 on are commits on the repo.

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

## 4. Feature state and decisions (most recent first)

### Round 12 (Nov 12): the user's test list (fields, pop-ups, model / format, list height, tool strip)
- Asked for (from the user's own testing): number fields too narrow (MP, Multiple, W / H: the arrows covered digits) and, in general, fields that fit their value (wider as typed, 2 digits at least); the size row's chain button had no tooltip, and every control should have a concise tooltip; '＋ Current size' couldn't work (presets mode jumped to the first preset); Region Genie's pop-ups movable anywhere on screen like Regional LoRAs'; no pop-up closes on a click elsewhere, only Enter / Esc / ✕ / a graph tab switch / a refresh; A− / A+ mustn't change the box size; `scene_prompt_background` only for Ideogram 4; the 'json format' select is redundant: the model dropdown sets the format; the Regions list's height adjustable; the canvas tool options folded to an icon until hovered or clicked.
- User's choices (multiple choice): presets mode keeps the current size ('not in the list' entry) so ＋ Current size adds it; a divider between canvas and list (the node keeps its size; per node, double-click resets); background only for Ideogram 4 (other models stop using it, text kept while hidden; hidden while the model isn't known); Esc puts the text back by default, with a Setting to keep the edits; tool strip: hover opens, click pins, the icon is the active option's; MOSS Image keeps its Edit Mode exception (plain instruction); one pop-up at a time, plus ◀ / ▶ in the header stepping through all the node's text fields (wrapping, same place and size); self-sizing for every number field in the pack.
- User's additions while answering: a MOSS Image **layout / standard** switch in Generate mode (an icon next to the model dropdown; standard = plain text), and **standard automatically when no region is drawn or shown**.
- Found while testing: the chain button's tooltip never appeared because the size row redraws every 500 ms and replaced the button's icon each time (a replaced element under the mouse restarts the tooltip). Fixed with `setHTML` (rg_shared.js: sets content only when it changes), applied to every icon that is set during a sync (snap, labels, Control, keep, all-apart, link, feather link / edges, LLM sparkles, the tag button). The real-frontend audit now checks that controls aren't redrawn.
- Decided while building: number fields fit via a page-wide MutationObserver in rg_shared.js (`autoNumber`: every `input[type=number]` inside an `rg-…` element; width = value's characters in `ch` + 22 px for the arrows, re-fit on input / change / a value set by code through an instance `value` property); the format is sent as `modelPick` / `mossLayout` in the run copy of paint_data (Python `prompt_family(..., pick, layout, regions)`); the hidden `prompt_format` widget stays (API prompts; a pick wins) and old workflows convert in `migrateFormat` (MOSS JSON → pick MOSS Image, Ideogram JSON → Ideogram 4, text → `rg_moss_layout: false`); the text format no longer includes the background sentence; Region Genie pop-ups are `position:fixed` in `document.body` (no saved per-node place any more: `rg_pop` is ignored; they open next to the field, the size is still remembered); a pop-up's unsized height is the height it would have with 14 px text, so A− / A+ never resize it; Esc on the canvas (nothing pending) also closes an open pop-up; pop-ups close when `app.canvas.graph` isn't the node's graph (tab switch, subgraph) or the node is removed; two new icons `mossLayout` / `mossStandard` (no existing icon fit: boxes in a frame / lines in a frame); the list split is `node.properties.rg_list_h` (canvas min 120 px while split; 220 px default).

### Round 11 (Nov 12): one-row toolbar, smaller nodes brought up to date
- Asked for: check the smaller nodes against the main node's recent updates (tooltips, pop-up editor …); make the row of tools above the canvas fit in one row whatever the tool (the shape dropdown and Select object's find field were the main causes), with a shape button whose icon shows the active shape.
- Measured first: at the default 700 px node width the row needed 703 px with no tool options, 754 with the wand, 868 with Select object, 898 with an image connected. Now 549 px (603 with an image), one row for every tool, in the stub page and the real frontend (both modes).
- User's choices: ▾ on every tool with versions (Shape, Lasso, Fill, Magic wand, Eraser), plus two merges: the eraser and the three lasso erase versions in one button (eraser first), the magic wand's two versions and Select object in one button (wand first); tool options in a strip in the canvas's top-left corner; the image opacity as a vertical slider on the canvas's right edge (like the brush slider), with a tooltip; Regional LoRAs gets the pop-up editor, floating over the page at the field (it may extend past the small node), and its `prompt` input is renamed `positive_prompt`. The '256 x 256' size label stays (explained to the user; they can ask to drop it).
- Decided while building: the merged buttons show the last tool used from them (so Q, then clicking the button, is Select object again); the shape fields (star points, corner radius) show while drawing that shape or with the select tool on such a layer; the floating pop-up remembers its size (`popSizes.float`) but opens at the field each time; the old `prompt` value and link of Regional LoRAs move to `positive_prompt` on load (`migratePrompt`); API prompts must use the new name.
- Smaller nodes audit: Mask Picker / BBoxes to Masks were up to date except two tooltips (`invert`, `size_from_latent`, added). Create Hook LoRA is up to date. Regional LoRAs lacked the pop-up editor and the text sizes (added).

### Round 10 (Nov 12): expand button, pop-up editor, text sizes, Control (ControlNet)
- Asked for: a small expand button instead of double-click to open the pop-up editors (so double-click selects words); bigger pop-ups with font size per kind of field, resize and move; ControlNet for every model with native support, the control LoRAs set in Settings and added to Whole image when it's turned on.
- User's choices (multiple choice): the button in the field's bottom-right corner; the pop-up stays inside the node (bigger, resizable, movable); font sizes per kind of field set separately for the pop-ups and the node's own fields (asked again because the request could be read two ways); ControlNet for all models with native support; the Control settings as a row under Whole image; the map from a new `control_image` input, else made from `image` (Canny / Depth Anything 3); ControlNet files per model: depth, canny, other; per-region control and a map preview on the canvas.
- Decided while building (tell the user if asked):
  - Expand button: on the scene prompts (ComfyUI's textareas: the button goes in their parent element, left of a scrollbar) and the region list's prompt / text fields (wrapped in `.rg-pwrap`). Canvas labels keep their double-click (not text fields). Regional LoRAs' fields have no pop-up, so no button.
  - Pop-up: size remembered for every node (hidden Setting `RegionGenie.Popup.Sizes`, per kind: scene / region), place per node (`node.properties.rg_pop`); double-click the title / grip resets. A− / A+ change the field in use (region pop-up: Prompt or Text). Defaults: region 560 px wide with 8 prompt lines, scene 640 px with 12 lines, text 14 px; node fields 0 = unchanged.
  - Control: one control per node (one kind at a time). Per region: with any region switched off, the control acts only inside the regions still on (background free); all on = whole image. MOSS masks at the latent (zeros = no control, as ComfyUI's comment says); ControlNets get a black-outside map; Anima's LLLite takes the mask natively. The Flux.1 depth / canny LoRAs ignore the strength field (their LoRA strength in Whole image is the strength). `control_image` was put before the width / height inputs so those stay last (as asked in round 9); saved workflows keep their own input order.
  - Follow-up (same day, before the PR): the user asked how a color-map control works. Answer given: the map is a shape map (colors are region IDs, ComfyUI's own description); flat maps are what it expects; it follows rough outlines too, so it stays off by default (my earlier "on by default" idea was withdrawn); end 30–50 % or a lower strength loosens it. Then, on request: short explanations per kind and model in the README, the kind select's tooltip, the Control details and every Control Setting's tooltip; a missing-file message (like Select object's) with the official download link and folder when a needed file isn't set or ComfyUI doesn't find it (on turning control on, changing the kind or model, and after a run via `ui.control_missing`).
  - Model before the first run: the user asked why every control LoRA was added before a run, and chose a guess from the graph plus a manual correction, with Edit Mode's LoRAs handled the same way; the correction is a footer select (their choice). `modelInfo()`: the footer pick, else the last run's model while `model` still comes from the same loader (`rg_model_src` = loader id + file, saved at each run), else `guessArch()` (follow `model` through LoRA loaders / patches / reroutes to the source node; its file name, type or title; else the CLIP loader's `type`), else unknown (then every configured LoRA, as before). `onModelChanged()` (poll, footer, runs) re-syncs the control and edit LoRAs without an undo step.
  - Download links (checked against Hugging Face file listings, Nov 12 2026): MOSS, Flux.1 depth LoRA, Depth Anything 3 and Anima LLLite from ComfyUI's own templates (Comfy-Org repos); Flux.1 canny LoRA from Black Forest Labs (gated: accept the license); SD1.5 from comfyanonymous' fp16 ControlNet repo; SDXL Stability Control-LoRAs and xinsir's union; Flux.1 XLabs ControlNets and InstantX union. There is no canny LLLite for Anima: the lineart one is suggested (untested with canny maps). Union files are named `diffusion_pytorch_model…`, so the message says to rename them.
  - Found and fixed while testing: the workflow loader (`parseState` / `normRegion` / `normLoras`) dropped keys it didn't know, so a reload lost the region eye (`hidden`, round 9), the per-region and scene LLM switches and salts, the node's LLM preset assignments (`state.llm`), and would have lost the control settings and LoRA tags. They're kept now.

### Round 9 (Nov 11): image size row, wildcards, region eye
- Asked for: Resolution Selector-style sizing on the node (3 modes in one row) plus width / height inputs; Impact Pack wildcards with a seed and an "add wildcard" feature, in Region Genie and Regional LoRAs; a show / hide button per region.
- User's choices (multiple choice, with mock-ups): the size row at the top of the node; one shared presets list in Settings (starting with the 9 SDXL / Flux sizes) edited from "Edit list…"; a compact footer seed control (fixed / randomize / increment); the same seed in every field by default with a Setting for one seed per field; after-run + on-demand preview plus "use the filled text" (in the pop-up editors and on the seed's right-click menu); adding wildcards by a picker in the pop-up editors and `__` autocomplete (no footer picker); wildcards before the LLM; the region eye hides the region (layers keep their own eye).
- Decided while building (tell the user if asked):
  - Size: new nodes start in aspect-ratio mode from Settings (Image size: mode, aspect, megapixels, multiple; the old Width / Height Settings are now "Manual: width / height"). The sockets are named `width_in` / `height_in` (labelled "width" / "height"), because the hidden widgets keep the names width / height for old workflows and the API. Preset labels show the simplest ratio within 3 % (1216x832 = 3:2). Swap in ratio mode turns 21:9 into 9:21.
  - Wildcards: the seed is sent as 0 while no field has wildcard syntax, and it only changes after a run when a field has some, so the node stays cached and the sampler doesn't rerun for nothing. Text that parses as JSON is never processed (Regional LoRAs' prompt from Region Genie). Randomize is the default mode (as ComfyUI's seeds). Our own route `/region_genie/wildcards` lists every wildcard (Impact's own list route leaves out the not-yet-loaded ones in its on-demand mode).
  - Region eye: drawing / adding a selection into a hidden region shows it again (with a note).
- Real ComfyUI notes (frontend 1.58.5): legacy mode subtracts a DOM widget's `margin` (10 px by default) from each side, and Nodes 2.0 stretches every widget that has `computeLayoutSize`. The size row passes `margin: 3`, a fixed `computeSize` (legacy uses it first) and `computeLayoutSize = undefined` (Nodes 2.0: a min-content row). The frontend calls `beforeQueued` / `afterQueued` on every widget of the queued nodes; the hidden `wildcard_seed` widget uses them (honouring `Comfy.WidgetControlMode`). Node ids in links can be strings.

### Round 8 (Nov 11): bug fixes from the user's first real runs
- Reported: blank Select object button; the missing-model message vanished after 3.5 s and couldn't be copied (it was a `hint()` in the list header; Ctrl+C was the layer-copy shortcut); selections didn't show in the region list (they were only previews until Enter, and switching tools discarded them silently); the user asked for double-click on list prompts to open the pop-up editor (it never existed; only the focus-expand did).
- User's choices (multiple choice): message bar under the canvas with Copy link and ✕; Enter or a ✓ button, switching tools adds instead of discarding, only Esc discards; Edit Mode made a new region per selection (then reverted at the user's request: selections go into the active region in both modes, so regions can be built from several layers); the list pop-up opens by the row.
- Decided without asking (told to the user): ✓ / ✕ are icons with tooltips (the mock-up said "✓ Add"; the owner's rule prefers icons); Shift+click starts the next object; the message bar also closes when a later selection succeeds; `tests/run_ui.sh` now starts the server with `--directory` (it used to leak the server, so a second run could exit 1).
- Confirmed by the user: Enter works in real ComfyUI (they hadn't pressed it).
- Offered, not decided: in both modes a selection merges into the active region's selected layer (the layer just added stays selected, so repeated selections pile into one layer); "always a new layer" would be a small change.

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
- Round 12 at 4K on the user's machine: the self-sizing number fields (font metrics differ by OS; the arrows' width is assumed 22 px with room), the floating pop-ups with ◀ / ▶, the divider, the folded tool strip. MOSS Image standard mode and the no-region standard fallback with a real MOSS model (the text it gets is checked; image quality isn't). Nodes 2.0 shares a node's spare height between the scene prompt boxes and the editor, so dragging the divider there also moves a little height between them.
- Round 10 Control with real models: no ControlNet, control LoRA, LLLite or Depth Anything 3 files were available, so `tests/test_control.py` checks what ComfyUI's own code receives (real torch and ComfyUI functions, stand-in VAE / ControlNet / patch) and the real-frontend test checks the run without a model. Real image quality, the MOSS color/depth LoRA's response to the mask, ControlNet + regional LoRAs together, and VRAM are untested.
- Round 11 at 4K on the user's machine: the ▾ buttons, the canvas strip, the opacity slider, the floating pop-up.
- Round 10 model guess on real workflows: file-name patterns (GGUF names, merges, renamed files), custom loader nodes and subgraphs; the footer pick is the way out when it's wrong.
- Round 10 pop-up drag / resize and the expand button at 4K on the user's machine (tested at DPR 2 in both modes).
- Round 9 on the user's machine at 4K (the size row, the presets pop-up, the seed control, the `__` list next to a tag autocomplete pack, the gold edge on filled fields). Tested in the real frontend 1.58.5 at DPR 2 in both modes, but not with LoRA Manager / pysssss installed together with the `__` list.
- Round 8 in the real ComfyUI frontend (legacy and Nodes 2.0, 4K): the message bar's text selection, right-click menu and Copy link (clipboard API needs https or localhost; otherwise the `execCommand` fallback), the list double-click, and Select object in Edit Mode.
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
- **Real ComfyUI in a new session (round 11+):** `bash tests/setup_real_comfy.sh --start` installs and starts it (see `tests/README.md`); a new cloud session's machine starts without it. The user chose a script in the repo over a cloud-environment setup script, so sessions only pay the ~5 GB download when they need real-frontend tests.
- **Round 9 setup (no model files):** ComfyUI v0.45.2 (latest release) checked out from GitHub, torch from PyPI (CPU), ComfyUI-Impact-Pack from GitHub (its requirements without the SAM lines, plus `segment-anything`), a test wildcard `wildcards/rgtest/color.txt`. `tests/real_comfy9.cjs [vue]`: 22 checks each (size row, old-workflow conversion, a real run with a Resolution Selector and a hidden region checked in the output image, wildcards preview / run / randomize / use-filled / `__` list / picker, Regional LoRAs). huggingface.co answered this session, but the user asked not to download big checkpoints.
- **Round 10:** `tests/test_control.py` (37 checks, needs `COMFY_DIR`), `ui_test9.cjs` grew to the pop-up / text size / Control row / reload checks, `real_comfy9.cjs` to 33 checks per mode (with the model guess and the missing-file message); round 11: 41 per mode (one-row toolbar, Regional LoRAs rename / old workflow / floating pop-up), and `ui_test9.cjs` the toolbar checks (expand buttons, pop-up drag / resize / A+, Control row and a run with control on, the map overlay).
- **Round 12:** `test_round12.py` (20: format from the model pick, layout switch, no-region fallback, background only in Ideogram JSON, old hidden format), `real_comfy12.cjs [vue]` (35 per mode: number fields fit 1-5 digits / decimals / minus, a tooltip on every shown control that isn't redrawn — default state, a pop-up open, Regional LoRAs —, presets keep the size, model dropdown / layout switch / background, old-workflow conversion, pop-ups (outside clicks, drag outside the node, A+, ◀ / ▶ order and geometry, Esc both ways, tab switch), divider, folded strip, Regional LoRAs ◀ / ▶). Older tests updated for the folded strip, the model dropdown and the pop-up placement.
- **Test files (rebuild as needed; they don't carry over):**
  - `test_round5.py` (49), `test_round6.py` (16), `test_round9.py` (round 9: hidden regions and wildcards with a stand-in Impact module): Python with a numpy-backed torch stub and comfy / folder_paths stubs.
  - `test_select.py` (31): region_select against real ComfyUI code: path safety, busy, loading, ComfyUI tracking the model, cached == uncached (points+box and text), output masks, unload and idle timer.
  - Browser tests in a stub harness (`/tmp/harness`, stub `app.js` / `api.js` with `window.__apiHandlers`), Playwright Chromium at `/opt/pw-browsers`: `ui_test.cjs` (29, round 5), `ui_test6.cjs` (46, round 6), `ui_test9.cjs` (round 9: region eye, size row), `ui_test_select.cjs` (45 since round 8: Select object with a stubbed server, icons not blank, ✓ / tool-switch / Shift+click, Edit Mode adds to the active region, list double-click pop-up, the message bar). The harness is in the repo now (`tests/harness`), run with `tests/run_ui.sh`; Playwright is preinstalled in cloud sessions, scipy may need `pip install scipy`. The run scripts aren't executable in git: run them with `bash`.
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
