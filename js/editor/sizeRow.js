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
        sizeDefaults, sizeCfg, applySize, setManualSize, syncSizeRow, el, opt, btn,
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
                      h: Math.round(clampNum(getSetting(SET.cmHeight, 1024), 16, 16384, 1024)), link: false, step: Math.round(clampNum(getSetting(SET.cmStep, 64), 1, 4096, 64)) },
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
    const sizeRow = el("div", "rg-size"); E.sizeEl = sizeRow;
    const sizeSeg = E.segmented([
        ["aspect ratio", svgIcon("sizeRatio"), "Aspect ratio: Image size from an aspect ratio and megapixels, like ComfyUI's Resolution Selector"],
        ["presets", svgIcon("sizeList"), "Presets: Image size from the presets list (shared by every Region Genie node; 'Edit list…' at its end)"],
        ["manual", svgIcon("sizeManual"), "Manual: Image size from manually selected width and height values"],
    ], (v) => {
        // each mode keeps its own choice: back in presets mode, the preset picked there last time is the size again
        // (round 51; rounds 12 to 50 carried the other mode's size over, as "not in the list"). The sizes of the
        // other two modes are offered in the presets dropdown instead, as entries that add them to the list
        const c = sizeCfg();
        c.mode = v; applySize();
    });
    const sizeNum = (min, max, step, title, width) => {
        const i = el("input", "rg-num"); i.type = "number"; i.min = String(min); i.max = String(max); i.step = String(step);
        i.title = title; if (width) i.style.width = width;
        i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") i.blur(); });
        // a value changed in the field and not taken over yet (between a click on one of the field's arrows, "input",
        // and its release, "change"): syncSizeRow() must not write the old value back meanwhile. It used to go by
        // the focus alone, and a click on the arrows doesn't put the focus into the field in Firefox on Windows
        // (it does in Chromium, and in Firefox on Linux), so the editor's half-second check could undo a click. If no "change" follows (no focus: no blur
        // either), the value is taken over after a moment
        i.addEventListener("input", () => {
            i.__rgPending = true; clearTimeout(i.__rgPendT);
            i.__rgPendT = setTimeout(() => { if (i.__rgPending && document.activeElement !== i) i.dispatchEvent(new Event("change")); }, 400);
        });
        i.addEventListener("change", () => { i.__rgPending = false; clearTimeout(i.__rgPendT); });
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
    const EDIT_LIST = "__edit__", ADD = "__add__:";
    let presetsText = null;
    // the sizes the other two modes are set to on this node, for the "add to the list" entries: [[w, h, "aspect ratio"], …]
    // (one that is in the list already is left out; the same size in both modes is offered once)
    function otherSizes(list) {
        const c = sizeCfg(), out = [];
        for (const mode of ["aspect ratio", "manual"]) {
            const [w, h] = sizeOfCfg({ ...c, mode });
            if (list.some((p) => p.w === w && p.h === h)) continue;
            const same = out.find((o) => o[0] === w && o[1] === h);
            if (same) same[2] += " and manual"; else out.push([w, h, mode]);
        }
        return out;
    }
    const addPreset = (w, h) => {
        const list = parseSizePresets(getSetting(SET.sizePresets, SIZE_PRESETS_DEFAULT));
        if (!list.some((p) => p.w === w && p.h === h)) { list.push({ w, h, name: "" }); setSetting(SET.sizePresets, formatSizePresets(list)); }
        presetsText = null;
    };
    preSel.addEventListener("change", () => {
        if (preSel.value === EDIT_LIST) { syncSizeRow(true); openPresetEditor(); return; }
        const add = preSel.value.startsWith(ADD);
        const [w, h] = (add ? preSel.value.slice(ADD.length) : preSel.value).split("x").map(Number);
        if (add) addPreset(w, h);                              // into the list (every node's), and picked here
        const c = sizeCfg(); c.preset = { ...c.preset, w, h, ...(add ? { swap: false } : {}) };
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
    // step size (round 53): how far the arrows of width / height go per click. A number field's arrows go to the
    // next value that is its min plus a multiple of its step, so stepFrom() moves min to where the value in the
    // field is such a value: 1000 with step 64 then goes to 1064 and 936, not to 1040 (16 + 16 x 64)
    const stepOf = () => Math.round(clampNum(sizeCfg().manual.step, 1, 4096, 64));
    const stepFrom = (i, lo, step, fallback) => {
        const v = Math.round(clampNum(i.value, lo, +i.max, fallback));
        i.step = String(step); i.min = String(v - Math.floor((v - lo) / step) * step);
    };
    const stepIn = sizeNum(1, 4096, 8, "Step size: How far the arrows of width and height go per click (px). A width or height that is typed in can be any number.", "44px");
    const stepSync = () => {
        const m = sizeCfg().manual, st = stepOf();
        stepFrom(wIn, 16, st, m.w); stepFrom(hIn, 16, st, m.h);
    };
    stepIn.addEventListener("change", () => {
        const c = sizeCfg(); c.manual = { ...c.manual, step: Math.round(clampNum(stepIn.value, 1, 4096, stepOf())) };
        stepIn.value = String(c.manual.step); syncSizeRow();
    });
    for (const i of [wIn, hIn]) i.addEventListener("input", () => stepFrom(i, 16, stepOf(), 1024));
    // the step box's own arrows go to the multiples of 8 (10 → 16 or 8), and no lower than 1 (8 → 1 → 8): counted
    // from 0, with the 0 the arrows would reach turned into 1. A typed step can be any number
    stepIn.min = "0";
    stepIn.addEventListener("input", () => { if (stepIn.value !== "" && +stepIn.value < 1) stepIn.value = "1"; });
    const manBox = el("span", "rg-size-part");
    manBox.append(tiny("W", wIn.title), wIn, swapM, tiny("H", hIn.title), hIn, linkBtn, tiny("±", stepIn.title), stepIn);
    const sizeOut = el("span", "rg-size-out");
    sizeRow.append(sizeSeg.box, ratioBox, preBox, manBox, sizeOut);
    for (const ev of ["pointerdown", "mousedown", "dblclick", "wheel"]) sizeRow.addEventListener(ev, (e) => e.stopPropagation());
    function presetOptions() {
        const list = parseSizePresets(String(getSetting(SET.sizePresets, SIZE_PRESETS_DEFAULT) ?? ""));
        const others = otherSizes(list);
        const text = formatSizePresets(list) + "|" + others.map((o) => o.join("x")).join("|");
        if (text === presetsText) return;
        presetsText = text;
        preSel.replaceChildren();
        for (const p of list) {
            preSel.appendChild(opt(`${p.w}x${p.h}`, `${p.w} × ${p.h}  (${p.name || ratioLabel(p.w, p.h)})`));
        }
        const line = () => { const o = opt("", "──────────"); o.disabled = true; return o; };
        if (others.length) preSel.appendChild(line());
        for (const [w, h, mode] of others) preSel.appendChild(opt(`${ADD}${w}x${h}`, `＋ Add ${w} × ${h}  (the ${mode} size)`));
        preSel.append(line(), opt(EDIT_LIST, "Edit list…"));
    }
    function syncSizeRow(force) {
        const c = sizeCfg();
        sizeSeg.set(c.mode);
        ratioBox.style.display = c.mode === "aspect ratio" ? "" : "none";
        preBox.style.display = c.mode === "presets" ? "" : "none";
        manBox.style.display = c.mode === "manual" ? "" : "none";
        const idle = (i) => force || (document.activeElement !== i && !i.__rgPending);
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
            preSel.title = PRESET_TIP + ".\n＋ Add …: Puts the size the aspect ratio or manual mode is set to into the list, and picks it."
                + (listed ? "" : `\n${c.preset.w} x ${c.preset.h} isn't in the list any more: Pick another, or add it again in 'Edit list…'.`);
        }
        if (idle(wIn)) wIn.value = String(c.manual.w);
        if (idle(hIn)) hIn.value = String(c.manual.h);
        if (idle(stepIn)) stepIn.value = String(stepOf());
        stepSync();
        setHTML(linkBtn, svgIcon(c.manual.link ? "link" : "unlink"));
        linkBtn.classList.toggle("on", !!c.manual.link);
        linkBtn.title = c.manual.link ? "Ratio kept: Changing one side changes the other. Click to set them separately"
            : "Keep the ratio: Changing one side changes the other";
        swapR.classList.toggle("on", !!c.ratio.swap); swapP.classList.toggle("on", !!c.preset.swap);
        if (!E.sizeReady) { sizeOut.textContent = sizeOfCfg(c).join(" × "); return; }
        // what decides the size in the end (same priority as the Python side)
        const [W, H] = E.dims();
        const kind = E.sizeFromKind();
        const from = kind ? `from size_from (${kind === "image" ? "an image" : "a latent"})`
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
        // ---- sorting (round 69): a click on a column's header sorts the whole rows by that column, a second click
        // the other way round, as a file manager does. The order is the list's own (it is what the node's dropdown
        // shows), so sorting saves it. Name: rows without a name show their ratio; those come first, from the
        // tallest picture to the widest (the owner's choice), then the named ones in the order of their text.
        const text = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
        const COLS = [
            ["w", "Width", "Width: Click to sort the list by width; click again for the opposite order.", (a, b) => a.w - b.w || a.h - b.h],
            ["h", "Height", "Height: Click to sort the list by height; click again for the opposite order.", (a, b) => a.h - b.h || a.w - b.w],
            ["name", "Name", "Name: Click to sort the list by name; click again for the opposite order.\nSizes without a name: They show their ratio and come first, from the tallest picture to the widest.",
                (a, b) => (a.name ? 1 : 0) - (b.name ? 1 : 0) || (a.name ? text.compare(a.name, b.name) : a.w / a.h - b.w / b.h || a.w - b.w)],
        ];
        let sorted = null;                                 // { col, dir }: the header that shows an arrow, while the list is in that order
        const inOrder = (cmp, dir) => list.every((p, i) => !i || cmp(list[i - 1], p) * dir <= 0);
        const sortBy = (col) => {
            const cmp = COLS.find((c) => c[0] === col)[3];
            const dir = sorted?.col === col && inOrder(cmp, sorted.dir) ? -sorted.dir : 1;
            list = list.map((p, i) => [p, i]).sort((a, b) => cmp(a[0], b[0]) * dir || a[1] - b[1]).map((x) => x[0]);      // whole rows, ties as they were
            sorted = { col, dir };
            save(); render();
        };
        // the width and height columns are as wide as their longest number, the name column as its longest text
        const fit = () => {
            const len = (f) => Math.max(...list.map(f), 0);
            const wn = Math.max(4, len((p) => String(p.w).length), len((p) => String(p.h).length));
            const nn = Math.min(30, Math.max(12, len((p) => (p.name || ratioLabel(p.w, p.h)).length)));
            body.style.setProperty("--rg-pw", `calc(${wn}ch + 30px)`); body.style.setProperty("--rg-pn", `calc(${nn}ch + 14px)`);
        };
        // ---- dragging a row by its handle: a line shows where it will land
        function startDrag(e, from, grip) {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const grips = [...body.querySelectorAll(".rg-presets-row .rg-grip")], line = el("div", "rg-presets-drop");
            const cells = [...grip.parentElement.children];
            cells.forEach((c) => c.classList.add("dragging"));
            let to = from;
            const at = (y) => { let k = 0; for (const g of grips) { const r = g.getBoundingClientRect(); if (y > r.top + r.height / 2) k++; } return k; };      // 0 … rows: the gap it is over
            const move = (ev) => {
                const k = at(ev.clientY); to = k > from ? k - 1 : k;
                const ref = grips[k]?.parentElement || null;
                if (to === from) line.remove(); else body.insertBefore(line, ref);
            };
            const end = (ev) => {
                window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", end, true); window.removeEventListener("pointercancel", end, true);
                line.remove(); cells.forEach((c) => c.classList.remove("dragging"));
                if (ev.type === "pointerup" && to !== from) { const [p] = list.splice(from, 1); list.splice(to, 0, p); save(); }
                render();
            };
            window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", end, true); window.addEventListener("pointercancel", end, true);
        }
        // the headers: the sorted column shows an arrow for as long as the list is in that order
        const hrow = el("div", "rg-presets-cols");
        const drawHead = () => {
            hrow.replaceChildren(el("span"));
            for (const [col, label, title, cmp] of COLS) {
                const on = sorted?.col === col && inOrder(cmp, sorted.dir);
                const h = el("button", "rg-presets-col" + (on ? " on" : "")); h.type = "button"; h.title = title; h.dataset.col = col;
                const t = el("span"); t.textContent = label; h.append(t);
                if (on) { const a = el("span", "rg-presets-dir"); setHTML(a, svgIcon(sorted.dir > 0 ? "up" : "down")); h.dataset.dir = sorted.dir > 0 ? "up" : "down"; h.append(a); }
                h.addEventListener("click", (e) => { e.preventDefault(); sortBy(col); });
                hrow.append(h);
            }
            hrow.append(el("span"));
        };
        const render = () => {
            body.replaceChildren();
            if (list.length) { body.appendChild(hrow); drawHead(); }
            list.forEach((p, i) => {
                const row = el("div", "rg-presets-row");
                const grip = el("span", "rg-grip"); setHTML(grip, svgIcon("grip")); grip.title = "Drag to move this size up or down in the list.";
                grip.addEventListener("pointerdown", (e) => startDrag(e, i, grip));
                const w = sizeNum(16, 16384, 1, "Width", ""), h = sizeNum(16, 16384, 1, "Height", "");
                w.value = String(p.w); h.value = String(p.h);
                const name = el("input", "rg-presets-name"); name.type = "text"; name.value = p.name; name.placeholder = ratioLabel(p.w, p.h);
                name.title = "Name (optional; shown instead of the ratio)";
                name.addEventListener("keydown", (e) => e.stopPropagation());
                const upd = () => { list[i] = { w: Math.round(clampNum(w.value, 16, 16384, p.w)), h: Math.round(clampNum(h.value, 16, 16384, p.h)), name: name.value.replace(/[;\n]/g, " ").trim() }; save(); name.placeholder = ratioLabel(list[i].w, list[i].h); fit(); drawHead(); };
                for (const x of [w, h, name]) x.addEventListener("change", upd);
                const del = btn("@close", "Remove from the list", () => { list.splice(i, 1); save(); render(); });
                row.append(grip, w, h, name, del);
                body.appendChild(row);
            });
            if (!list.length) { const t = tiny("The list is empty: add a size below.", ""); body.appendChild(t); }
            fit();
            renderAdds();
        };
        const head = el("div", "rg-presets-head");
        const title = el("span"); title.textContent = "Image size presets (every Region Genie node)";
        head.append(title, btn("@close", "Close", () => closePresetEditor()));
        const foot = el("div", "rg-presets-foot");
        // one button per size the other modes (and a preset that left the list) are set to on this node
        const adds = el("span", "rg-presets-adds");
        const renderAdds = () => {
            adds.replaceChildren();
            const c = sizeCfg(), cand = otherSizes(list);
            if (!list.some((p) => p.w === c.preset.w && p.h === c.preset.h) && !cand.some((o) => o[0] === c.preset.w && o[1] === c.preset.h)) cand.push([c.preset.w, c.preset.h, "preset picked on this node"]);
            for (const [w, h, mode] of cand) adds.appendChild(btn(`＋ ${w} × ${h}`, `Add ${w} x ${h} to the list: The ${mode} size`, () => { list.push({ w, h, name: "" }); save(); render(); }));
        };
        const reset = btn("Defaults", "Put the starting list back", () => { list = parseSizePresets(SIZE_PRESETS_DEFAULT); save(); render(); });
        foot.append(adds, reset);
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
        // "@name": a drawn icon (svgIcon) in place of a text label
        if (label[0] === "@") { b.innerHTML = svgIcon(label.slice(1)); b.classList.add("rg-ib"); b.dataset.ic = label.slice(1); } else b.textContent = label;
        E.keyTitle(b, title);
        b.addEventListener("click", (e) => { e.preventDefault(); fn(e); });
        return b;
    }
}
