// The node's widgets, last-run wildcard results, the expand button, and the editor's state variables.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { svgIcon, autocompleteWidgets, getSetting, SET, autoSeparateSettings, editSettings, llmCacheSettings, controlFiles, addExpandButton, textHistory } from "../rg_shared.js";
import { ALL } from "./shared.js";
import { locale } from "../rg_i18n.js";
import { emptyState } from "./state.js";

export function* core(E) {
    Object.assign(E, {
        wcFields, wcMark, addExpandButton,
    });
    yield;

    const node = E.node;
    // the Undo / Redo steps of each text field's own text (textHistory() in rg_shared.js), kept for as long as the
    // node lives and shared by the field on the node and its pop-up editor. Keys: "scene:positive", "r<id>", "r<id>.text"
    // Redraws of the region list that nobody asked for (round 44c). The list is rebuilt from scratch, so a redraw takes
    // the field being typed in with it: a number not yet entered is lost, a prompt loses the cursor. Work that runs by
    // itself (the half-second check, the results of a run, an image that finished loading) goes through E.background();
    // while it runs, renderRegions() waits if a text or number field of the list has the cursor (E.renderPending), and
    // the list is drawn when the cursor leaves that field. Whatever the user does redraws at once, as before.
    E.inBackground = 0; E.renderPending = false;
    E.background = (fn) => { E.inBackground++; try { return fn(); } finally { E.inBackground--; } };
    E.textHist = E.textHist || new Map();
    E.histOf = (key) => { if (!E.textHist.has(key)) E.textHist.set(key, {}); return E.textHist.get(key); };
    const findW = (n) => node.widgets?.find((w) => w.name === n);
    const dataW = findW("paint_data"); E.dataW = dataW;
    const wW = findW("width"), hW = findW("height"), modeW = findW("image_mode"); E.wW = wW; E.hW = hW; E.modeW = modeW;
    const sceneW = findW("scene_prompt_positive"), sceneNegW = findW("scene_prompt_negative"); E.sceneW = sceneW; E.sceneNegW = sceneNegW;
    const sceneBgW = findW("scene_prompt_background"); E.sceneBgW = sceneBgW;
    // some frontend versions leave an optional combo empty on new nodes: fall back to its default
    const impW = findW("import_mode"), fmtW = findW("prompt_format"); E.fmtW = fmtW;
    const editW = findW("mode"), areaW = findW("edit_area"); E.editW = editW; E.areaW = areaW;        // Edit Mode (image-to-image)
    const isEdit = () => editW?.value === "edit"; E.isEdit = isEdit;
    const fixImportMode = () => {
        for (const w of [impW, fmtW, editW, areaW]) {
            const vals = w?.options?.values;
            if (w && Array.isArray(vals) && vals.length && !vals.includes(w.value)) w.value = vals[0];
        }
    }; E.fixImportMode = fixImportMode;
    fixImportMode();
    queueMicrotask(fixImportMode); setTimeout(fixImportMode, 0);
    // paint_data, and the rarely used settings (shown as small controls in the bottom-left corner instead)
    const minW = findW("min_region_pixels"); E.minW = minW;
    for (const w of [dataW, modeW, minW, impW, fmtW, editW, areaW, wW, hW]) {
        if (!w) continue;
        w.hidden = true;
        w.computeSize = () => [0, -4];
        const i = node.inputs?.findIndex((inp) => inp.name === w.name);
        if (i != null && i !== -1) node.removeInput(i);
    }
    // the run-time Settings the Python side needs go into the copy of paint_data sent with the prompt
    // (not into the canvas state, so changing a setting doesn't touch undo or the saved layout)
    if (dataW) {
        dataW.serializeValue = () => {
            const v = dataW.value;
            try {
                const d = JSON.parse(v || "{}");
                if (!d || typeof d !== "object" || Array.isArray(d)) return v;
                d.autoSeparate = autoSeparateSettings();
                const hint = E.downstreamFormat();
                if (hint) d.promptFormatHint = hint;
                const pick = node.properties?.rg_model_pick;
                if (pick) d.modelPick = pick;
                if (node.properties?.rg_moss_layout === false) d.mossLayout = false;
                if (isEdit()) { d.edit = editSettings(); d.editMask = E.editMaskNow(); }
                d.llmCache = llmCacheSettings();
                d.minPixels = E.minPixelsNow();
                d.wcPerField = !!getSetting(SET.wcPerField, false);
                if (Array.isArray(d.controls) && d.controls.length) d.controlFiles = controlFiles();
                d.importMode = E.importModeNow();
                return JSON.stringify(d);
            } catch (e) { return v; }
        };
    }
    // legacy mode shares spare node height between DOM widgets: keep the prompt box ~3 lines
    for (const w of [sceneW, sceneNegW]) if (w?.options) { w.options.getMinHeight = () => 48; w.options.getMaxHeight = () => 72; }
    if (sceneBgW?.options) { sceneBgW.options.getMinHeight = () => 36; sceneBgW.options.getMaxHeight = () => 56; }
    // LoRA Manager's tag autocomplete in both scene prompts (if that pack is installed)
    // the scene prompts: tag autocomplete, and a double-click opens them in the pop-up editor
    // ---- wildcards (Impact Pack): what each field became in the last run (or a preview)
    E.wcFilled = {};                       // field key -> { raw, filled }
    const filledFor = (key, raw) => { const f = E.wcFilled[key]; return f && f.raw === (raw ?? "") && f.filled !== f.raw ? f.filled : null; }; E.filledFor = filledFor;
    const sceneTA = {}; E.sceneTA = sceneTA;                      // positive / negative / background -> their textareas
    const SCENE_KEYS = { positive: "scene", negative: "negative", background: "background" }; E.SCENE_KEYS = SCENE_KEYS;
    function wcFields() {
        const f = { scene: sceneW?.value || "", negative: sceneNegW?.value || "", background: sceneBgW?.value || "" };
        for (const r of E.state.regions) {
            if (r.hidden) continue;
            f["r" + r.id] = r.prompt || "";
            if (r.type === "text" && r.text) f[`r${r.id}.text`] = r.text;
        }
        return f;
    }
    // a field's tooltip / marker: the text the wildcards filled in (when it's for the text in the field now)
    function wcMark(t, key, raw, base) {
        if (!t) return;
        if (base != null) t.dataset.baseTitle = base;
        const f = filledFor(key, raw), b = t.dataset.baseTitle ?? "";
        const title = (b ? b + "\n" : "") + (f != null ? `Wildcards filled in (last run or preview):\n${f}` : "");
        if (t.title !== title) t.title = title;
        t.classList.toggle("rg-wc-filled", f != null);
    }
    const SCENE_FIELDS = { scene_prompt_positive: "positive", scene_prompt_negative: "negative",
                           scene_prompt_background: "background" };
    autocompleteWidgets(node, Object.keys(SCENE_FIELDS), (name, t) => {
        if (!SCENE_FIELDS[name]) return;
        sceneTA[SCENE_FIELDS[name]] = t;
        if (!t.__rgWc) { t.__rgWc = true; t.addEventListener("input", () => E.wcRefresh?.()); }      // a wildcard typed: the seed group shows
        t.classList.add("rg-scene-ta");
        t.dataset.rgField = name;                       // which field this text box is (tests/real_layering.cjs finds it by this)
        // an empty scene prompt says what it is for (English; another language keeps ComfyUI's own placeholder).
        // Legacy nodes show the input's name as the placeholder: it stays in front; Nodes 2.0 has it as a label.
        if (locale() === "en" && !t.dataset.rgPlaceholder) {
            const text = { positive: "the whole picture: setting, style, lighting ...", negative: "what to avoid in the whole picture",
                           background: "behind the regions: ground, floor, sky, room ..." }[SCENE_FIELDS[name]];
            t.placeholder = t.placeholder ? `${name}: ${text}` : text;
            t.dataset.rgPlaceholder = "1";
        }
        addExpandButton(t, "Open in the pop-up editor", () => E.editScene(SCENE_FIELDS[name]));
        t.dataset.baseTitle = t.title;
        t.addEventListener("input", () => wcMark(t, SCENE_KEYS[SCENE_FIELDS[name]], t.value));
        // Undo (round 43): a visit to the box is one step of the editor's Undo; while typing, the Undo keys go back
        // through this box's own text (the same steps as in its pop-up editor)
        E.textSession(t);
        if (!t.__rgHist) {
            const w = () => node.widgets?.find((x) => x.name === name);
            t.__rgHist = textHistory(t, E.histOf("scene:" + SCENE_FIELDS[name]), { apply: (v) => { E.setWidget(w(), v); wcMark(t, SCENE_KEYS[SCENE_FIELDS[name]], v); E.wcRefresh?.(); E.updateLlmButtons?.(); E.editor?.refresh(); } });
        }
    });

    // ---------------- editor state ----------------
    E.execDims = null;
    E.state = emptyState();
    E.undoStack = []; E.redoStack = [];
    E.tool = "select"; E.shapeKind = "rect"; E.sides = 5;
    E.brush = 0.03;                        // diameter, fraction of the shorter side
    E.curRegion = null;                    // region for new shapes / paint (UNSPEC allowed)
    E.filter = ALL;                        // layers panel: ALL or a region id
    E.selId = null;                        // selected layer id
    E.snap = !!getSetting(SET.cmSnap, false);  // Settings > Region Genie
    E.grid = Math.max(2, Math.round(+getSetting(SET.cmGrid, 64)) || 64);   // grid in image px
    E.view = null; E.userView = false;       // view: display px = img px * z + (x, y)
    E.drag = null;                         // active pointer interaction
    // the selected layer's box and handles are hidden after a click anywhere outside the canvas; the layer
    // stays selected (brush, lasso and fill still paint into it) and shows again when it is used
    E.hiddenSel = null;
    E.clickPoly = null;                    // lasso being built point by point
    E.lastStrokeEnd = null;
    E.pick = null;                         // Select object in progress: points, box, text, masks found
    E.pickIds = 0; E.pickBusy = false; E.pickAgain = false; E.samUsed = false;
    E.backdropRef = null;                  // {filename, subfolder, type} of the backdrop image (for the server)                // image px where the last brush / eraser stroke ended (Shift+click lines)
    E.hover = null;                        // display coords of the pointer
    E.spaceDown = false;
    E.backdrop = null; E.backdropKey = ""; E.backdropOpacity = 0.5;
    E.lastDims = [0, 0];
    E.raf = 0;
    E.version = 0;                         // bumped on every saved change (label cache key)
}
