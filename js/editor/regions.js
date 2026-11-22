// Regions, undo / redo, what can be done to a layer (add, duplicate, copy / paste, merge, delete …), tool switching and hints.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { getSetting, SET, regionColors } from "../rg_shared.js";
import { UNSPEC, ALL, HISTORY, CLIPBOARD, RASTER_MAX } from "./shared.js";
import { encodeRuns } from "./geometry.js";
import { hsvHex, hexRgb, rgbLab, effectiveColors } from "./colors.js";

export function* regions(E) {
    Object.assign(E, {
        uniqueColor, sortLayersByRegions, newRegion, ensureRegion, holeOwner, toggleHole, snapshot, pushUndo, change, undo, redo,
        beginText, endText, textSession,
        save, slotFor, addLayer, selectLayer, regionTargets, duplicateTo, duplicate, copyLayer, pasteLayer, deleteSelected,
        eraseLayer, moveTarget, moveLayer, moveLayerToRegion, mergeDown, mergeRegion, setTool, hint,
    });
    yield;

    // ---------------- regions ----------------
    const regionById = (id) => E.state.regions.find((r) => r.id === id); E.regionById = regionById;
    // shown colors: a region with a palette is drawn in its first palette color (kept distinct)
    let effCache = { v: -1, map: new Map() };
    const effMap = () => {
        if (effCache.v !== E.version) effCache = { v: E.version, map: effectiveColors(E.state.regions) };
        return effCache.map;
    };
    const colorOf = (rid) => rid === UNSPEC ? "#000000" : (effMap().get(rid) || regionById(rid)?.color); E.colorOf = colorOf;
    const regionLabel = (rid) => rid === UNSPEC ? "Hole" : (regionById(rid)?.prompt || `region ${E.state.regions.findIndex((r) => r.id === rid)}`);
    // a new region's color: the first of the user's colors (Settings > Region Genie > Region Genie node > Region
    // colors) that isn't on the canvas yet, nor looks like one that is; when all are in use, the one that looks
    // most different from the colors on the canvas (perceptual distance, CIELAB), from that list and a set of calm hues
    function nextColor() {
        const list = regionColors();
        const shown = E.state.regions.map((r) => colorOf(r.id) || r.color);
        const used = new Set([...E.state.regions.map((r) => r.color.toUpperCase()), ...shown.map((c) => c.toUpperCase())]);
        if (!shown.length) return list[0];
        // black is in the set too: it is "unspecified" in the color map
        const labs = [...shown, "#000000"].map((c) => rgbLab(hexRgb(c)));
        const dist = (c) => { const lab = rgbLab(hexRgb(c)); let d = Infinity; for (const q of labs) d = Math.min(d, Math.hypot(lab[0] - q[0], lab[1] - q[1], lab[2] - q[2])); return d; };
        for (const c of list) if (!used.has(c) && dist(c) >= 16) return c;
        const cands = [...list];
        for (let h = 0; h < 36; h++) for (const [sat, val] of [[0.5, 0.85], [0.65, 0.7], [0.35, 0.95], [0.75, 0.9]]) cands.push(hsvHex(h / 36, sat, val));
        let best = null, bestScore = -Infinity;
        for (const c of cands) {
            if (used.has(c)) continue;
            const d = dist(c);
            if (d > bestScore) { bestScore = d; best = c; }
        }
        return best || uniqueColor(list[E.state.regions.length % list.length], null);
    }
    // keep region colors unique and clearly not black (black = unspecified in the color map)
    function uniqueColor(hex, selfId) {
        let [r, g, b] = hexRgb(hex);
        if (Math.max(r, g, b) < 32) { const k = 32 / Math.max(1, r, g, b); r = Math.max(32, Math.round(r * k)); g = Math.round(g * k); b = Math.round(b * k); }
        const taken = new Set(E.state.regions.filter((x) => x.id !== selfId).map((x) => x.color.toUpperCase()));
        const toHex = () => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("").toUpperCase();
        let c = toHex(), n = 0;
        while (taken.has(c) && n++ < 512) { b = b < 255 ? b + 1 : b - 1; if (n % 2) g = g < 255 ? g + 1 : g - 1; c = toHex(); }
        return c;
    }
    // layer stack follows the region list: the top region is in front. Unspecified (hole) layers keep their slots.
    function sortLayersByRegions() {
        const rank = new Map(E.state.regions.map((r, i) => [r.id, E.state.regions.length - 1 - i]));
        const slots = [], items = [];
        E.state.layers.forEach((L, i) => { if (L.region !== UNSPEC && rank.has(L.region)) { slots.push(i); items.push([rank.get(L.region), i, L]); } });
        items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        slots.forEach((slot, k) => { E.state.layers[slot] = items[k][2]; });
    }
    function newRegion() {
        const id = E.state.regions.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
        const r = { id, color: nextColor(), prompt: "", type: "object", text: "" };
        if (getSetting(SET.llmNewRegions, false)) r.llm = true;
        E.state.regions.unshift(r);                // top of the list: its new layers go on top of the stack too
        return r;
    }
    function ensureRegion() {
        if (E.curRegion === UNSPEC) return UNSPEC;
        if (E.curRegion == null || !regionById(E.curRegion)) {
            E.curRegion = E.state.regions[0]?.id ?? newRegion().id;
        }
        revealRegion(E.curRegion);
        return E.curRegion;
    }
    // the region a hole is listed under: the one it was made in, else (old workflows, a deleted region) the
    // region of the nearest layer below it, else above it, else the first region
    function holeOwner(L) {
        if (L.owner != null && regionById(L.owner)) return L.owner;
        const i = E.state.layers.indexOf(L);
        for (const dir of [-1, 1]) {
            for (let j = i + dir; j >= 0 && j < E.state.layers.length; j += dir) {
                const o = E.state.layers[j];
                if (o.region !== UNSPEC && regionById(o.region)) return o.region;
            }
        }
        return E.state.regions[0]?.id ?? null;
    }
    // ✂: a layer cuts a hole through the layers below it (region 0: no region there), or paints its region again
    function toggleHole(L) {
        if (L.region === UNSPEC) {
            const rid = holeOwner(L);
            if (rid == null) { hint("Add a region first"); return; }
            change(() => { L.region = rid; delete L.owner; sortLayersByRegions(); E.curRegion = rid; E.selId = L.id; });
        } else {
            change(() => { L.owner = L.region; L.region = UNSPEC; E.selId = L.id; });
        }
    }
    // a layer is drawn and output when its own eye and its region's eye are both on
    const isShown = (L) => L.visible !== false && !(L.region !== UNSPEC && regionById(L.region)?.hidden); E.isShown = isShown;
    function revealRegion(rid) {                   // drawing into a hidden region shows it again
        const r = regionById(rid);
        if (!r?.hidden) return;
        delete r.hidden;
        keepHintUntil = performance.now() + 3000;
        hint(`'${String(regionLabel(rid)).slice(0, 40)}' was hidden: Shown again so you can see what you add`);
        E.refreshUI();
    }
    const selLayer = () => E.state.layers.find((l) => l.id === E.selId) || null; E.selLayer = selLayer;
    const nextLayerId = () => E.state.layers.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1; E.nextLayerId = nextLayerId;

    // ---------------- history ----------------
    // A step of Undo holds the editor's state and the texts of the scene prompts (round 43: those live in the node's own
    // widgets, not in the state, and were not part of Undo). Everything is kept in memory only, for as long as the node
    // is on the page: nothing of it is saved with the workflow or written to a file.
    const sceneWidgets = () => [E.sceneW, E.sceneNegW, E.sceneBgW];
    const sceneNow = () => sceneWidgets().map((w) => (w ? String(w.value ?? "") : null));
    function snapshot() { return JSON.stringify({ ...E.state, __scene: sceneNow() }); }
    function pushUndo(before) {
        const now = snapshot();
        E.sceneKnown = JSON.stringify(sceneNow());
        if (before === now) return;
        E.undoStack.push(before);
        if (E.undoStack.length > HISTORY) E.undoStack.shift();
        E.redoStack = [];
    }
    // A scene prompt can be changed by something that isn't a step: trigger words added from a LoRA, "use the filled
    // text", ComfyUI's own parameters panel, another extension. E.sceneKnown is the scene text as of the last step;
    // when the text is found different before the next step is made, that change becomes a step of its own first
    // (otherwise an Undo of an older step would silently take it away, or it couldn't be undone at all).
    function absorbScene() {
        const now = JSON.stringify(sceneNow());
        if (E.sceneKnown != null && E.sceneKnown !== now) {
            E.undoStack.push(JSON.stringify({ ...E.state, __scene: JSON.parse(E.sceneKnown) }));
            if (E.undoStack.length > HISTORY) E.undoStack.shift();
            E.redoStack = [];
        }
        E.sceneKnown = now;
    }
    function change(fn) {
        endText();                                  // text typed before this change is a step of its own, before it
        absorbScene();
        const before = snapshot();
        fn();
        pushUndo(before);
        resumeText();
        save(); E.refreshUI();
    }
    function restore(text) {
        const st = JSON.parse(text), scene = st.__scene;
        delete st.__scene;
        E.state = st;
        let sceneSet = false;
        if (Array.isArray(scene)) sceneWidgets().forEach((w, i) => { if (w && scene[i] != null && String(w.value ?? "") !== scene[i]) { E.setWidget(w, scene[i]); sceneSet = true; } });
        if (E.selId != null && !selLayer()) E.selId = null;
        if (E.filter !== ALL && E.filter !== UNSPEC && !regionById(E.filter)) E.filter = ALL;
        save(); E.refreshUI();
        if (sceneSet) { E.wcMarkScene?.(); for (const t of Object.values(E.sceneTA || {})) t?.__rgPlaceExpand?.(); }
        E.sceneKnown = JSON.stringify(sceneNow());
    }
    function undo() { endText(); absorbScene(); if (E.undoStack.length) { E.redoStack.push(snapshot()); restore(E.undoStack.pop()); afterRestore(); } resumeText(); }
    function redo() { endText(); absorbScene(); if (E.redoStack.length) { E.undoStack.push(snapshot()); restore(E.redoStack.pop()); afterRestore(); } resumeText(); }
    // ---- text boxes and Undo (round 43). A visit to a text box (click in, type, click out) is ONE step: it starts
    // when the box gets the cursor and is closed when the box is left, and before any other change or an Undo / Redo,
    // so the steps stay in the order things were done. While the cursor is in a box, the Undo keys act on that box's
    // own text, step by step (textHistory() in rg_shared.js), not on the editor.
    // E.textBefore: the snapshot from when the box was entered; E.textDirty: something was typed since (the Undo button
    // is then ready, without a snapshot being made on every draw).
    function beginText() { if (E.textBefore == null) { absorbScene(); E.textBefore = snapshot(); E.textDirty = false; } }
    function endText() {
        if (E.textBefore == null) return;
        const before = E.textBefore;
        E.textBefore = null; E.textDirty = false;
        pushUndo(before);
        E.requestDraw?.();                           // the Undo button's state
    }
    // a change was made, or a step taken back, while a text box still has the cursor: what is typed next is a new step
    function resumeText() { if (document.activeElement?.__rgSess) beginText(); }
    function textSession(ta) {
        if (!ta || ta.__rgSess) return;
        ta.__rgSess = true;
        ta.addEventListener("focus", beginText);
        ta.addEventListener("blur", endText);
        ta.addEventListener("input", () => { if (E.textBefore == null) beginText(); if (!E.textDirty) { E.textDirty = true; E.requestDraw?.(); } });
    }
    // the Generate / Edit switch isn't part of an undo step: an undone list must still fit the mode it's in now
    function afterRestore() { if (E.pruneManagedLoras()) { save(); E.renderRegions(); } }
    function save() {
        E.poseAssoc?.();                                  // each pose figure's region: the one under its middle (pose.js)
        E.version++;
        if (E.dataW) E.dataW.value = JSON.stringify(E.state);
        E.wcRefresh?.();
        E.node.graph?.setDirtyCanvas?.(true, true);
    }

    // ---------------- layer actions ----------------
    // stack slot for a new layer of region rid: on top of its own region's layers and of the regions listed
    // below it, under the layers of the regions listed above it (unspecified layers keep their slots)
    function slotFor(rid) {
        if (rid === UNSPEC || !regionById(rid)) return E.state.layers.length;
        const pos = new Map(E.state.regions.map((r, i) => [r.id, i]));
        const p = pos.get(rid);
        let top = -1;
        E.state.layers.forEach((l, i) => { if (pos.has(l.region) && pos.get(l.region) >= p) top = i; });
        return top + 1;
    }
    function addLayer(L, index) {
        E.state.layers.splice(index ?? slotFor(L.region), 0, L);
        E.selId = L.id;
        E.curRegion = L.region;
    }
    function selectLayer(L) {
        E.selId = L ? L.id : null;
        E.hiddenSel = null;
        if (L) { E.curRegion = L.region; E.openSub(L.region === UNSPEC ? holeOwner(L) : L.region, "layers"); }
        E.refreshUI();
    }
    // "Ellipse 1 copy", then "Ellipse 1 copy (2)", "(3)", ... like pasting a file twice in a folder
    // (a copy of a copy counts on from the same name: "Ellipse 1 copy" -> "Ellipse 1 copy (2)")
    function copyName(name) {
        const taken = new Set(E.state.layers.map((l) => l.name));
        const root = String(name).replace(/ copy(?: \(\d+\))?$/, "");
        const base = `${root} copy`;
        if (!taken.has(base)) return base;
        for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
    }
    // the other regions a layer can go to, named by their index (as in the list) and prompt
    function regionTargets(exceptRid) {
        const imap = E.outputIndexMap(), out = [];
        E.state.regions.forEach((rg, k) => {
            if (rg.id === exceptRid) return;
            const p = (rg.prompt || "").trim().replace(/\s+/g, " ");
            const short = p ? (p.length > 40 ? p.slice(0, 39) + "…" : p) : "(no prompt)";
            out.push({ rid: rg.id, label: imap[k] == null ? `Region – (no pixels yet): ${short}` : `Region ${imap[k]}: ${short}` });
        });
        return out;
    }
    // a copy in the same place, in this region (right above the original) or on top of another region's
    // layers (it takes that region's color)
    function duplicateTo(L, rid) {
        if (!L || (rid !== UNSPEC && !regionById(rid))) return;
        if (rid === L.region) { duplicate(L); return; }
        if (rid === UNSPEC) E.expanded.add(UNSPEC); else E.openSub(rid, "layers");
        change(() => {
            const c = JSON.parse(JSON.stringify(L));
            c.id = nextLayerId(); c.name = copyName(L.name); c.region = rid;
            E.state.layers.splice(slotFor(rid), 0, c);
            E.selId = c.id; E.curRegion = rid;
        });
    }
    function duplicate(L = selLayer()) {
        if (!L) return;
        change(() => {
            const c = JSON.parse(JSON.stringify(L));
            c.id = nextLayerId(); c.name = copyName(L.name);   // same place as the original
            E.state.layers.splice(E.state.layers.indexOf(L) + 1, 0, c);
            E.selId = c.id;
        });
    }
    // Ctrl+C / Ctrl+X / Ctrl+V: layers, also between Region Genie nodes (a copy of the layer is kept
    // for the session). A pasted layer lands on top of the active region's layers, in the same place.
    function copyLayer(L, cut) {
        CLIPBOARD.layer = JSON.parse(JSON.stringify(L));
        if (cut) { deleteSelected(L); hint(`Cut '${L.name}': Ctrl+V pastes it into the active region`); }
        else hint(`Copied '${L.name}': Ctrl+V pastes it into the active region`);
    }
    function pasteLayer() {
        if (!CLIPBOARD.layer) return;
        let rid = E.curRegion;
        if (rid == null || (rid !== UNSPEC && !regionById(rid))) {
            rid = CLIPBOARD.layer.region === UNSPEC || regionById(CLIPBOARD.layer.region) ? CLIPBOARD.layer.region : null;
        }
        if (rid == null) { hint("Select a region first: the layer is pasted into the active region"); return; }
        if (rid === UNSPEC) E.expanded.add(UNSPEC); else E.openSub(rid, "layers");
        change(() => {
            const c = JSON.parse(JSON.stringify(CLIPBOARD.layer));
            c.id = nextLayerId(); c.region = rid;
            if (E.state.layers.some((l) => l.name === c.name)) c.name = copyName(c.name);
            E.state.layers.splice(slotFor(rid), 0, c);
            E.selId = c.id; E.curRegion = rid; E.hiddenSel = null;
        });
    }
    function deleteSelected(L = selLayer()) {
        if (!L) return;
        change(() => { E.state.layers.splice(E.state.layers.indexOf(L), 1); if (E.selId === L.id) E.selId = null; });
    }
    function eraseLayer(L = selLayer()) {
        if (!L) return;
        change(() => { L.ops = []; L.shape = null; });
    }
    // next layer up (+1) / down (-1) that this layer can swap with: the same region's layers
    // (unspecified layers move one step through the whole stack, to cut holes above or below other regions)
    function moveTarget(L, dir) {
        const i = E.state.layers.indexOf(L);
        if (i < 0) return -1;
        for (let j = i + dir; j >= 0 && j < E.state.layers.length; j += dir) {
            if (L.region === UNSPEC || E.state.layers[j].region === L.region) return j;
        }
        return -1;
    }
    function moveLayer(L, dir) {          // dir +1 = up (in front)
        const i = E.state.layers.indexOf(L), j = moveTarget(L, dir);
        if (i < 0 || j < 0) return;
        change(() => { [E.state.layers[i], E.state.layers[j]] = [E.state.layers[j], E.state.layers[i]]; });
    }
    function moveLayerToRegion(L, rid) {
        if (L.region === rid) return;
        change(() => {
            L.region = rid; delete L.owner; E.curRegion = rid; E.selId = L.id; E.openSub(rid, "layers");
            E.state.layers.splice(E.state.layers.indexOf(L), 1);
            E.state.layers.splice(slotFor(rid), 0, L);
        });
    }
    // rasterize a group of layers (same region) into one pixel-mask paint layer
    function rasterizeLayers(group) {
        const [W, H] = E.dims(), s = Math.min(W, H);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const L of group) {
            const cs = E.boxCornersImg(L); if (!cs) continue;
            for (const [x, y] of cs) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        }
        if (!isFinite(x0)) return null;
        x0 = Math.floor(Math.max(x0, -W)); y0 = Math.floor(Math.max(y0, -H)); x1 = Math.ceil(Math.min(x1, 2 * W)); y1 = Math.ceil(Math.min(y1, 2 * H));
        const r = Math.min(1, RASTER_MAX / Math.max(x1 - x0, y1 - y0, 1));
        const w = Math.max(1, Math.round((x1 - x0) * r)), h = Math.max(1, Math.round((y1 - y0) * r));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const x = c.getContext("2d", { willReadFrequently: true });
        const saved = E.view;
        E.view = { z: r, x: -x0 * r, y: -y0 * r };
        for (const L of group) {
            const t = document.createElement("canvas"); t.width = w; t.height = h;
            E.drawLayerOn(t.getContext("2d"), L, null, null, "#fff");
            x.drawImage(t, 0, 0);
        }
        E.view = saved;
        const d = x.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
        for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
        return { t: "bitmap", e: false, w, h, runs: encodeRuns(mask), x0: x0 / s, y0: y0 / s, x1: x1 / s, y1: y1 / s };
    }
    function mergeInto(group, name) {
        const op = rasterizeLayers(group);
        if (!op) return;
        const top = Math.max(...group.map((L) => E.state.layers.indexOf(L)));
        const L = E.newPaintLayer(group[0].region);
        L.name = name;
        L.ops.push(op);
        const keep = E.state.layers.filter((l) => !group.includes(l));
        const before = E.state.layers.slice(0, top + 1).filter((l) => !group.includes(l)).length;
        E.state.layers = keep;
        addLayer(L, before);
    }
    function mergeDown(L = selLayer()) {
        if (!L) return;
        const i = E.state.layers.indexOf(L);
        const lower = [...E.state.layers.slice(0, i)].reverse().find((l) => l.region === L.region && l.visible !== false);
        if (!lower) { hint("No lower visible layer in this region to merge into"); return; }
        change(() => mergeInto([lower, L], lower.name));
    }
    function mergeRegion(rid = E.curRegion) {
        if (rid == null) { hint("Pick a region first"); return; }
        const group = E.state.layers.filter((l) => l.region === rid && l.visible !== false);
        if (group.length < 2) { hint("Nothing to merge: this region has fewer than two visible layers"); return; }
        change(() => mergeInto(group, `${regionLabel(rid)} (merged)`.slice(0, 40)));
    }
    function setTool(t) {
        if (E.clickPoly && t !== E.tool) E.clickPoly = null;
        if (E.pick && t !== "object") E.pickSettle();
        else if (E.pick && t === "object") E.pick.acceptOnAnswer = false;
        if (t !== "object") E.hideMsg();
        E.tool = t;
        E.markPoseRows?.();
        if (t === "wand" || t === "object") E.grpCur.wand = t;
        if (t === "erase" || t === "lassoErase") E.grpCur.erase = t;
        for (const b of new Set(Object.values(E.toolBtns))) b.classList.toggle("on", E.toolBtns[t] === b);
        E.refreshVariantButtons();                       // the buttons show the tool in use; the strip its options
        E.bSlider.style.display = t === "brush" || t === "erase" ? "" : "none";
        E.hideBTip(); E.updateBrushSlider(); E.syncTips();
        if (performance.now() > keepHintUntil) hint("");       // a note just shown (e.g. region shown again) stays
        E.requestDraw();
    }
    E.hintTimer = 0; let keepHintUntil = 0;
    // a short message in the list header, for 3.5 s: on the header's one line when it fits there. Select object's
    // standing instructions (stickyHint in selectTools.js) are long and stay as long as the tool waits: they always
    // get a line of their own.
    function hint(text) {
        E.statusLbl.textContent = text || ""; E.statusLbl.title = text || ""; E.statusLbl.classList.remove("wide");
        // no room for all of it on the header's line (the fields of 'Separate' take it): a line of its own under the
        // header for as long as it shows (the owner's choice in round 48; until then it was cut with "…")
        if (text && E.statusLbl.scrollWidth > E.statusLbl.clientWidth + 1) E.statusLbl.classList.add("wide");
        clearTimeout(E.hintTimer);
        if (text) E.hintTimer = setTimeout(() => { E.statusLbl.textContent = ""; E.statusLbl.title = ""; E.statusLbl.classList.remove("wide"); }, 3500);
    }
}
