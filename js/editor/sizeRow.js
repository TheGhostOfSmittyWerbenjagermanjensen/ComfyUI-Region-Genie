// The image size row at the top of the node (aspect ratio / presets / manual).
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import {
    svgIcon, setHTML, keepWidgetValuesByName, getSetting, setSetting, SET, SIZE_ASPECTS, ratioSize, parseSizePresets,
    formatSizePresets, ratioLabel, SIZE_PRESETS_DEFAULT,
} from "../rg_shared.js";
import { linkOf } from "./graph.js";
import { inputLabel } from "../rg_i18n.js";

export function* sizeRow(E) {
    Object.assign(E, {
        sizeDefaults, sizeCfg, applySize, setManualSize, syncSizeRow, moveSizeLinks, el, opt, btn,
    });
    yield;

    // ---------------- image size row (top of the node, where the width / height widgets were) ----------------
    // node.properties.rg_size keeps the row's settings (each mode its own); the hidden width / height widgets
    // hold the result, so the Python side, saved workflows and API prompts keep using width / height.
    const SIZE_MODES = ["aspect ratio", "presets", "manual"];
    const clampNum = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
    function sizeDefaults() {
        const mode = getSetting(SET.sizeMode, "aspect ratio"), asp = getSetting(SET.sizeAspect, SIZE_ASPECTS[0][0]);
        const first = parseSizePresets(getSetting(SET.sizePresets, SIZE_PRESETS_DEFAULT))[0] || { w: 1024, h: 1024 };
        return {
            mode: SIZE_MODES.includes(mode) ? mode : "aspect ratio",
            ratio: { aspect: SIZE_ASPECTS.some((a) => a[0] === asp) ? asp : SIZE_ASPECTS[0][0], swap: false,
                     mp: clampNum(getSetting(SET.sizeMegapixels, 1), 0.1, 16, 1), multiple: clampNum(getSetting(SET.sizeMultiple, 8), 8, 128, 8) },
            preset: { w: first.w, h: first.h, swap: false },
            manual: { w: Math.round(clampNum(getSetting(SET.cmWidth, 1024), 16, 16384, 1024)),
                      h: Math.round(clampNum(getSetting(SET.cmHeight, 1024), 16, 16384, 1024)), link: false },
        };
    }
    function sizeCfg() {
        E.node.properties = E.node.properties || {};
        let c = E.node.properties.rg_size;
        if (!c || typeof c !== "object") {           // a node saved before the size row: manual, with its size
            c = { ...sizeDefaults(), mode: "manual" };
            c.manual = { w: Math.round(clampNum(E.wW?.value, 16, 16384, 1024)), h: Math.round(clampNum(E.hW?.value, 16, 16384, 1024)), link: false };
            E.node.properties.rg_size = c;
        }
        const d = sizeDefaults();
        for (const k of ["ratio", "preset", "manual"]) c[k] = { ...d[k], ...(c[k] && typeof c[k] === "object" ? c[k] : {}) };
        if (!SIZE_MODES.includes(c.mode)) c.mode = "manual";
        return c;
    }
    function sizeOfCfg(c) {
        if (c.mode === "aspect ratio") {
            const a = SIZE_ASPECTS.find((x) => x[0] === c.ratio.aspect) || SIZE_ASPECTS[0];
            const [w, h] = ratioSize(a[1], a[2], clampNum(c.ratio.mp, 0.1, 16, 1), clampNum(c.ratio.multiple, 8, 128, 8));
            return c.ratio.swap ? [h, w] : [w, h];
        }
        if (c.mode === "presets") return c.preset.swap ? [c.preset.h, c.preset.w] : [c.preset.w, c.preset.h];
        return [c.manual.w, c.manual.h];
    }
    function applySize() {
        const [w, h] = sizeOfCfg(sizeCfg());
        E.setWidget(E.wW, w); E.setWidget(E.hW, h);
        syncSizeRow();
        if (E.sizeReady) E.onDimsChanged();
        E.node.setDirtyCanvas?.(true, true);
    }
    // a size set from elsewhere (an imported layout): typed in, so the row shows it
    function setManualSize(w, h) {
        const c = sizeCfg();
        if (JSON.stringify(sizeOfCfg(c)) === JSON.stringify([w, h])) return;
        c.mode = "manual"; c.manual = { ...c.manual, w, h };
        applySize();
    }
    E.sizeReady = false;                     // the editor below is set up (onDimsChanged can run)
    const sizeRow = el("div", "rg-size");
    const sizeSeg = E.segmented([
        ["aspect ratio", svgIcon("sizeRatio"), "Image size from an aspect ratio and megapixels, like ComfyUI's Resolution Selector"],
        ["presets", svgIcon("sizeList"), "Image size from the presets list (shared by every Region Genie node; 'Edit list…' at its end)"],
        ["manual", svgIcon("sizeManual"), "Image size: width and height typed in"],
    ], (v) => {
        const c = sizeCfg();
        // into presets mode: keep the size the other mode made (shown as "not in the list" until a preset is
        // picked), so '＋ Current size' in 'Edit list…' can add it
        if (v === "presets" && c.mode !== "presets") { const [w, h] = sizeOfCfg(c); c.preset = { ...c.preset, w, h, swap: false }; }
        c.mode = v; applySize();
    });
    const sizeNum = (min, max, step, title, width) => {
        const i = el("input", "rg-num"); i.type = "number"; i.min = String(min); i.max = String(max); i.step = String(step);
        i.title = title; if (width) i.style.width = width;
        i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") i.blur(); });
        return i;
    };
    const tiny = (text, title) => { const t = el("span", "rg-hint"); t.textContent = text; t.title = title; return t; };
    // aspect ratio
    const aspSel = el("select", "rg-sel");
    aspSel.title = "Aspect ratio (as in ComfyUI's Resolution Selector)";
    for (const [name] of SIZE_ASPECTS) aspSel.appendChild(opt(name, name));
    aspSel.addEventListener("change", () => { sizeCfg().ratio.aspect = aspSel.value; applySize(); });
    const mpIn = sizeNum(0.1, 16, 0.01, "Megapixels: The target pixel count (1.0 = 1024 x 1024 for square)", "48px");
    mpIn.addEventListener("change", () => { const c = sizeCfg(); c.ratio.mp = Math.round(clampNum(mpIn.value, 0.1, 16, 1) * 100) / 100; applySize(); });
    const multIn = sizeNum(8, 128, 4, "Multiple: width and height are rounded to a multiple of this", "38px");
    multIn.addEventListener("change", () => { const c = sizeCfg(); c.ratio.multiple = Math.round(clampNum(multIn.value, 8, 128, 8)); applySize(); });
    const ratioBox = el("span", "rg-size-part");
    const swapBtn = (mode) => E.iconBtn("swapWH", "Swap width and height (portrait / landscape)", () => {
        const c = sizeCfg();
        if (mode === "manual") c.manual = { ...c.manual, w: c.manual.h, h: c.manual.w }; else c[mode].swap = !c[mode].swap;
        applySize();
    });
    const swapR = swapBtn("ratio"), swapP = swapBtn("preset"), swapM = swapBtn("manual");
    ratioBox.append(aspSel, swapR, tiny("MP", mpIn.title), mpIn, tiny("×", multIn.title), multIn);
    // presets
    const preSel = el("select", "rg-sel rg-size-pre");
    const PRESET_TIP = "Image size presets (Settings > Region Genie > Image size; 'Edit list…' to change them)";
    preSel.title = PRESET_TIP;
    const EDIT_LIST = "__edit__";
    let presetsText = null;
    preSel.addEventListener("change", () => {
        if (preSel.value === EDIT_LIST) { syncSizeRow(true); openPresetEditor(); return; }
        const [w, h] = preSel.value.split("x").map(Number);
        const c = sizeCfg(); c.preset = { ...c.preset, w, h };
        applySize();
    });
    const preBox = el("span", "rg-size-part");
    preBox.append(preSel, swapP);
    // manual
    const wIn = sizeNum(16, 16384, 1, "Width (px)", "54px"), hIn = sizeNum(16, 16384, 1, "Height (px)", "54px");
    const linkBtn = E.iconBtn("unlink", "", () => { const c = sizeCfg(); c.manual.link = !c.manual.link; syncSizeRow(); });
    const manualSet = (which) => {
        const c = sizeCfg(), m = c.manual, v = Math.round(clampNum((which === "w" ? wIn : hIn).value, 16, 16384, m[which]));
        if (m.link && m.w > 0 && m.h > 0) {           // keep the ratio: the other side follows
            if (which === "w") c.manual = { ...m, w: v, h: Math.round(clampNum(v * m.h / m.w, 16, 16384, m.h)) };
            else c.manual = { ...m, h: v, w: Math.round(clampNum(v * m.w / m.h, 16, 16384, m.w)) };
        } else c.manual = { ...m, [which]: v };
        applySize();
    };
    wIn.addEventListener("change", () => manualSet("w"));
    hIn.addEventListener("change", () => manualSet("h"));
    const manBox = el("span", "rg-size-part");
    manBox.append(tiny("W", wIn.title), wIn, swapM, tiny("H", hIn.title), hIn, linkBtn);
    const sizeOut = el("span", "rg-size-out");
    sizeRow.append(sizeSeg.box, ratioBox, preBox, manBox, sizeOut);
    for (const ev of ["pointerdown", "mousedown", "dblclick", "wheel"]) sizeRow.addEventListener(ev, (e) => e.stopPropagation());
    function presetOptions() {
        const text = String(getSetting(SET.sizePresets, SIZE_PRESETS_DEFAULT) ?? "");
        if (text === presetsText) return;
        presetsText = text;
        preSel.replaceChildren();
        for (const p of parseSizePresets(text)) {
            preSel.appendChild(opt(`${p.w}x${p.h}`, `${p.w} × ${p.h}  (${p.name || ratioLabel(p.w, p.h)})`));
        }
        const sep = opt("", "──────────"); sep.disabled = true;
        preSel.append(sep, opt(EDIT_LIST, "Edit list…"));
    }
    function syncSizeRow(force) {
        const c = sizeCfg();
        sizeSeg.set(c.mode);
        ratioBox.style.display = c.mode === "aspect ratio" ? "" : "none";
        preBox.style.display = c.mode === "presets" ? "" : "none";
        manBox.style.display = c.mode === "manual" ? "" : "none";
        const idle = (i) => force || document.activeElement !== i;
        if (idle(aspSel)) aspSel.value = c.ratio.aspect;
        if (idle(mpIn)) mpIn.value = String(c.ratio.mp);
        if (idle(multIn)) multIn.value = String(c.ratio.multiple);
        presetOptions();
        const key = `${c.preset.w}x${c.preset.h}`;
        if (idle(preSel)) {
            const extra = preSel.querySelector("option[data-extra]");
            const listed = [...preSel.options].some((o) => o.value === key && !o.dataset.extra);
            if (!listed && extra?.value !== key) {         // not in the list (any more): keep it shown
                const o = opt(key, `${c.preset.w} × ${c.preset.h}  (not in the list)`); o.dataset.extra = "1";
                extra?.remove();
                preSel.insertBefore(o, preSel.firstChild);
            } else if (listed) extra?.remove();
            preSel.value = key;
            preSel.title = PRESET_TIP + (listed ? "" : `. ${c.preset.w} x ${c.preset.h} isn't in the list: 'Edit list…' > ＋ Current size adds it`);
        }
        if (idle(wIn)) wIn.value = String(c.manual.w);
        if (idle(hIn)) hIn.value = String(c.manual.h);
        setHTML(linkBtn, svgIcon(c.manual.link ? "link" : "unlink"));
        linkBtn.classList.toggle("on", !!c.manual.link);
        linkBtn.title = c.manual.link ? "Ratio kept: Changing one side changes the other. Click to set them separately"
            : "Keep the ratio: Changing one side changes the other";
        swapR.classList.toggle("on", !!c.ratio.swap); swapP.classList.toggle("on", !!c.preset.swap);
        if (!E.sizeReady) { sizeOut.textContent = sizeOfCfg(c).join(" × "); return; }
        // what decides the size in the end (same priority as the Python side)
        const [W, H] = E.dims();
        const from = E.isLinked("size_from_image") ? "from size_from_image" : E.isLinked("size_from_latent") ? "from size_from_latent"
            : E.editSized() ? "Edit: The image's shape at this many pixels"
            : E.isLinked("width_in") || E.isLinked("height_in") ? "from the width / height inputs" : "";
        sizeOut.textContent = `${W} × ${H}`;
        sizeOut.title = from ? `Image size ${W} x ${H}, ${from.startsWith("Edit") ? "in Edit Mode: " + from.slice(6) : from}.` : `Image size: ${W} x ${H}.`;
        sizeRow.classList.toggle("ext", /^from/.test(from));
        sizeRow.classList.toggle("editsized", from.startsWith("Edit"));
    }
    // the presets list editor (a small pop-up; the list is a Setting shared by every node)
    let presetPop = null;
    function closePresetEditor() {
        if (!presetPop) return;
        presetPop.remove(); presetPop = null;
        window.removeEventListener("pointerdown", presetOutside, true);
    }
    function presetOutside(e) { if (presetPop && !presetPop.contains(e.target)) closePresetEditor(); }
    function openPresetEditor() {
        closePresetEditor();
        const pop = el("div", "rg-presets");
        presetPop = pop;
        let list = parseSizePresets(getSetting(SET.sizePresets, SIZE_PRESETS_DEFAULT));
        const save = () => { setSetting(SET.sizePresets, formatSizePresets(list)); presetsText = null; syncSizeRow(true); };
        const body = el("div", "rg-presets-list");
        const render = () => {
            body.replaceChildren();
            list.forEach((p, i) => {
                const row = el("div", "rg-presets-row");
                const w = sizeNum(16, 16384, 1, "Width", "54px"), h = sizeNum(16, 16384, 1, "Height", "54px");
                w.value = String(p.w); h.value = String(p.h);
                const name = el("input", "rg-presets-name"); name.type = "text"; name.value = p.name; name.placeholder = ratioLabel(p.w, p.h);
                name.title = "Name (optional; shown instead of the ratio)";
                name.addEventListener("keydown", (e) => e.stopPropagation());
                const upd = () => { list[i] = { w: Math.round(clampNum(w.value, 16, 16384, p.w)), h: Math.round(clampNum(h.value, 16, 16384, p.h)), name: name.value.replace(/[;\n]/g, " ").trim() }; save(); };
                for (const x of [w, h, name]) x.addEventListener("change", upd);
                const up = btn("↑", "Move up", () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; save(); render(); } });
                up.disabled = i === 0;
                const dn = btn("↓", "Move down", () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; save(); render(); } });
                dn.disabled = i === list.length - 1;
                const del = btn("✕", "Remove from the list", () => { list.splice(i, 1); save(); render(); });
                row.append(w, tiny("×", ""), h, name, up, dn, del);
                body.appendChild(row);
            });
            if (!list.length) { const t = tiny("The list is empty: add the current size below.", ""); body.appendChild(t); }
        };
        const head = el("div", "rg-presets-head");
        const title = el("span"); title.textContent = "Image size presets (every Region Genie node)";
        head.append(title, btn("✕", "Close", () => closePresetEditor()));
        const foot = el("div", "rg-presets-foot");
        const addCur = btn("＋ Current size", "Add the node's current image size to the list (a size made in aspect ratio or "
            + "manual mode stays when you switch to presets mode, shown as 'not in the list', so it can be added here)", () => {
            const [cw, ch] = sizeOfCfg(sizeCfg());
            if (!list.some((p) => p.w === cw && p.h === ch)) { list.push({ w: cw, h: ch, name: "" }); save(); render(); }
        });
        const reset = btn("Defaults", "Put the starting list back", () => { list = parseSizePresets(SIZE_PRESETS_DEFAULT); save(); render(); });
        foot.append(addCur, reset);
        pop.append(head, body, foot);
        for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "keydown"]) pop.addEventListener(ev, (e) => e.stopPropagation());
        render();
        document.body.appendChild(pop);
        const r = preSel.getBoundingClientRect();
        const pw = pop.offsetWidth, ph = pop.offsetHeight;
        pop.style.left = Math.max(6, Math.min(window.innerWidth - pw - 6, r.left)) + "px";
        pop.style.top = (r.bottom + 4 + ph <= window.innerHeight - 6 ? r.bottom + 4 : Math.max(6, r.top - 4 - ph)) + "px";
        setTimeout(() => window.addEventListener("pointerdown", presetOutside, true), 0);
    }
    const sizeW = E.node.addDOMWidget("rg_size", "RgSize", sizeRow, {
        // legacy mode takes 'margin' off each side of a DOM widget (10 px by default): a 24 px row
        serialize: false, hideOnZoom: false, margin: 3, getMinHeight: () => 30, getMaxHeight: () => 30,
    });
    sizeW.serialize = false;
    // a fixed-height row: legacy mode sizes a widget with computeSize first (26 + 4 px, minus the margins = 24 px);
    // Nodes 2.0 stretches every widget that has computeLayoutSize, so this one hides it (min-content row there)
    sizeW.computeSize = (w) => [w ?? E.node.size?.[0] ?? 700, 26];
    sizeW.computeLayoutSize = undefined;
    {                                              // at the top, where width / height were
        const ws = E.node.widgets || [], iS = ws.indexOf(sizeW);
        if (iS > -1) { ws.splice(iS, 1); const iW = ws.indexOf(E.wW); ws.splice(iW > -1 ? iW : 0, 0, sizeW); }
    }
    // the optional width / height sockets (internal names width_in / height_in) show as "width" / "height"
    const labelSizeInputs = () => {
        for (const inp of E.node.inputs || []) {
            // in ComfyUI's language: the translated name of the width / height input
            const want = inp.name === "width_in" ? inputLabel("Region-Genie_Main", "width") : inp.name === "height_in" ? inputLabel("Region-Genie_Main", "height") : null;
            if (want && inp.label !== want) inp.label = want;
        }
    }; E.labelSizeInputs = labelSizeInputs;
    labelSizeInputs();
    // workflows from before the size row: links into the old width / height sockets move to the new ones
    function moveSizeLinks() {
        for (const [from, to] of [["width", "width_in"], ["height", "height_in"]]) {
            const i = (E.node.inputs || []).findIndex((x) => x.name === from);
            if (i < 0) continue;
            const id = E.node.inputs[i].link, j = E.node.inputs.findIndex((x) => x.name === to);
            if (id != null && j >= 0 && E.node.inputs[j].link == null) {
                const l = linkOf(E.node.graph, id);
                if (l) { l.target_slot = j; E.node.inputs[j].link = id; E.node.inputs[i].link = null; }
            }
            E.node.removeInput((E.node.inputs || []).findIndex((x) => x.name === from));
        }
        labelSizeInputs();
    }
    keepWidgetValuesByName(E.node, ["wildcard_seed", "width", "height", "scene_prompt_positive", "scene_prompt_negative", "scene_prompt_background", "image_mode",
                                  "min_region_pixels", "import_mode", "prompt_format", "mode", "edit_area"]);
    // ComfyUI's right-side properties panel renders the selected node's widgets and writes its own
    // panel width into widget.width, which the classic canvas then uses for the node (the "squished"
    // editor; rgthree's widgets get hit the same way). Keep this node's widgets at the node width.
    const pinWidth = (w) => {
        if (!w || w.__rgPinned) return;
        try {
            Object.defineProperty(w, "width", { configurable: true, enumerable: false, get: () => undefined, set: () => {} });
            w.__rgPinned = true;
        } catch (e) { /* non-configurable: leave it */ }
    };
    for (const w of E.node.widgets || []) pinWidth(w);
    void E.domW;

    function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
    function opt(v, label) { const o = document.createElement("option"); o.value = String(v); o.textContent = label; return o; }
    function btn(label, title, fn) {
        const b = el("button", "rg-btn");
        b.textContent = label; b.title = title;
        b.addEventListener("click", (e) => { e.preventDefault(); fn(e); });
        return b;
    }
}
