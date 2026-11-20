// The node's widgets, last-run wildcard results, the expand button, and the editor's state variables.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { svgIcon, autocompleteWidgets, getSetting, SET, autoApartSettings, editSettings, llmCacheSettings, controlFiles } from "../rg_shared.js";
import { ALL } from "./shared.js";
import { locale } from "../rg_i18n.js";
import { emptyState } from "./state.js";

export function* core(E) {
    Object.assign(E, {
        wcFields, wcMark, addExpandButton,
    });
    yield;

    const node = E.node;
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
                d.autoApart = autoApartSettings();
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
    // the expand button: opens a text field in its pop-up editor (double-click stays the browser's word selection).
    // It sits in the field's bottom-right corner, left of a scrollbar, inside the field's parent element.
    function addExpandButton(t, title, onOpen) {
        const host = t.parentElement;
        if (!host) return null;
        const old = host.querySelector(":scope > .rg-expand");
        if (old && old.__rgFor === t) return old;
        old?.remove();
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        const b = document.createElement("button");
        b.type = "button"; b.className = "rg-expand"; b.innerHTML = svgIcon("expand"); b.title = title; b.tabIndex = -1;
        b.__rgFor = t;
        for (const ev of ["pointerdown", "mousedown", "dblclick"]) b.addEventListener(ev, (e) => { e.stopPropagation(); if (ev !== "pointerdown") e.preventDefault(); });
        b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onOpen(); });
        const place = () => {
            if (!t.isConnected) return;
            const sb = Math.max(0, t.offsetWidth - t.clientWidth - (t.clientLeft || 0) * 2);   // a scrollbar, if any
            const right = host.clientWidth - (t.offsetLeft + t.offsetWidth) + (t.clientLeft || 0) + sb + 2;
            const bottom = host.clientHeight - (t.offsetTop + t.offsetHeight) + (t.clientTop || 0) + 2;
            b.style.right = Math.round(right) + "px"; b.style.bottom = Math.round(bottom) + "px";
        };
        for (const ev of ["mouseenter", "focus", "input", "blur"]) t.addEventListener(ev, () => requestAnimationFrame(place));
        try { new ResizeObserver(place).observe(t); } catch (e) { /* old browser */ }
        host.addEventListener("mouseenter", place);
        host.appendChild(b);
        place();
        return b;
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
