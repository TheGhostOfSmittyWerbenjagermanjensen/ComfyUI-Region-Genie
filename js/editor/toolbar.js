// The editor's elements, the tool buttons (with versions), the tool options strip on the canvas, Arrange, opacity and labels.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { svgIcon, setHTML, contextMenu } from "../rg_shared.js";
import { LASSO_MODES, TOOL_NUMS, lassoRefreshers, initLassoModes, SHAPES, ALL } from "./shared.js";

export function* toolbar(E) {
    Object.assign(E, {
        iconBtn, refreshVariantButtons, syncPickBtns, syncToolOpts, closeArrange, setSnapIcon,
    });
    yield;

    // ---------------- DOM ----------------
    const wrap = E.el("div", "rg-wrap"); E.wrap = wrap;
    wrap.tabIndex = 0;
    // ComfyUI's undo tracker catches Ctrl+Z / Ctrl+Y on the whole window before the node sees them,
    // unless a text field has focus. Keyboard focus therefore sits in this hidden read-only field
    // while the editor is in use, so editor shortcuts stay in the editor.
    const keySink = E.el("input", "rg-keysink"); E.keySink = keySink;
    keySink.type = "text"; keySink.readOnly = true; keySink.tabIndex = -1;
    keySink.setAttribute("aria-hidden", "true");
    keySink.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0;border:0;padding:0;";
    const isField = (t) => t && (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && t !== keySink && !["range", "checkbox", "button"].includes(t.type))); E.isField = isField;
    const focusSink = () => keySink.focus({ preventScroll: true }); E.focusSink = focusSink;
    wrap.addEventListener("click", (e) => { if (!isField(e.target) && !e.target?.closest?.(".rg-msg")) focusSink(); }, true);
    const bar1 = E.el("div", "rg-bar"); E.bar1 = bar1;
    function iconBtn(name, title, fn, cls = "") {
        const b = E.el("button", "rg-btn icon" + (cls ? " " + cls : ""));
        b.innerHTML = svgIcon(name); b.title = title;
        b.addEventListener("click", (e) => { e.preventDefault(); fn(e); });
        return b;
    }
    const sep = () => E.el("span", "rg-sep");
    const toolBtns = {}; E.toolBtns = toolBtns;
    const addTool = (key, title, icon = key) => {
        const b = iconBtn(icon, title, () => E.setTool(key));
        toolBtns[key] = b; bar1.appendChild(b); return b;
    };
    addTool("select", "Select: Move, resize and rotate layers (V). Shift keeps proportions / snaps angles to 15°; Alt resizes from the centre.");
    // ---- tools with versions: one button each, showing the active version's icon, with ▾ on its right (and
    // right-click) for the list. Shape: the shapes; Lasso / Fill: their versions; Magic wand: the wand's two versions
    // and Select object; Eraser: the eraser and the three lasso erase versions. Keyboard shortcuts pick an entry too.
    const numIn = (min, max, value, title) => {
        const i = E.el("input", "rg-num"); i.type = "number"; i.min = String(min); i.max = String(max); i.step = "1";
        i.value = String(value); i.title = title; i.style.display = "none";
        i.addEventListener("keydown", (e) => e.stopPropagation());
        return i;
    };
    const grpCur = { wand: "wand", erase: "erase" }; E.grpCur = grpCur;          // the tool each mixed group shows (session)
    const LASSO_TIP = "Drag freehand, or click points and close the loop (click the first point, double-click or Enter). ";
    const SHAPE_KEYS = { rect: "R", ellipse: "O", triangle: "T" };
    const OBJECT_TIP = "Select object (Q): SAM 3.1 finds the object you click in the image under the canvas. Click to add "
        + "a point on the object, Ctrl+click a point that isn't part of it, drag a box around it; Backspace undoes the "
        + "last point, Enter adds the selection to the active region, Esc cancels. Or type what to find in the field "
        + "on the canvas. Needs the SAM 3.1 model (Settings > Region Genie > Select object).";
    // entries: [id, icon, title, pick()]; cur(): the id shown
    const GROUPS = {
        shape: { name: "Shape", tools: ["shape"], cur: () => E.shapeKind,
            entries: () => SHAPES.map(([k, label]) => [k, "shape" + k[0].toUpperCase() + k.slice(1),
                `Shape (${label}): Drag a box to draw it; Shift for equal sides, Alt to draw from the centre`
                    + (SHAPE_KEYS[k] ? ` (${SHAPE_KEYS[k]})` : "") + ".",
                () => { E.shapeKind = k; E.setTool("shape"); }]) },
        lasso: { name: "Lasso", tools: ["lasso"], cur: () => LASSO_MODES.lasso,
            entries: () => [["plain", "lasso", "Lasso: Straight lines between the points."], ["spline", "lassoSpline", "Lasso (spline): A smooth curve through the points."],
                ["magnetic", "lassoMagnetic", "Lasso (magnetic): The outline follows edges in the image under the canvas."]]
                .map(([m, icon, t]) => [m, icon, `${t} ${LASSO_TIP}Filled with the active region (L).`, () => { setLassoMode("lasso", m); E.setTool("lasso"); }]) },
        fill: { name: "Fill", tools: ["fill"], cur: () => LASSO_MODES.fill,
            entries: () => [["normal", "fill", "Fill: Fills the clicked area (blank space, or one color) with the active region (F)."],
                ["gaps", "fillGaps", "Fill (closing small gaps): Fills the clicked area, but doesn't leak through small openings (the gap size is the field on the canvas) (F)."],
                ["linear", "fillLinear", "Fill (linear gradient): Drag a line in the area to fill. The active region is at full strength where the line starts and fades to nothing where it ends (F)."],
                ["radial", "fillRadial", "Fill (radial gradient): Drag outward from a point in the area to fill. The active region is at full strength at that point and fades to nothing at the distance you drag (F)."]]
                .map(([m, icon, t]) => [m, icon, t, () => { LASSO_MODES.fill = m; E.setTool("fill"); }]) },
        wand: { name: "Magic wand / Select object", tools: ["wand", "object"], cur: () => (grpCur.wand === "object" ? "object" : LASSO_MODES.wand),
            entries: () => [
                ["contiguous", "wand", "Magic wand: Selects the connected area of similar color around the click, in the image under the canvas; each click adds it to the active region (W).\nTolerance: The field on the canvas.",
                    () => { LASSO_MODES.wand = "contiguous"; E.setTool("wand"); }],
                ["global", "wandGlobal", "Magic wand (all similar colors): Selects every pixel of similar color in the image under the canvas (W).\nTolerance: The field on the canvas.",
                    () => { LASSO_MODES.wand = "global"; E.setTool("wand"); }],
                ["object", "samSelect", OBJECT_TIP, () => E.setTool("object")]] },
        erase: { name: "Eraser / Lasso erase", tools: ["erase", "lassoErase"], cur: () => (grpCur.erase === "erase" ? "erase" : "lasso:" + LASSO_MODES.lassoErase),
            entries: () => [
                ["erase", "erase", "Eraser: Erase from the selected layer (E). Shift+click draws a straight line from where the last stroke ended.", () => E.setTool("erase")],
                ...[["plain", "lassoErase", "Lasso erase: Straight lines between the points."], ["spline", "lassoEraseSpline", "Lasso erase (spline): A smooth curve through the points."],
                    ["magnetic", "lassoEraseMagnetic", "Lasso erase (magnetic): The outline follows edges in the image under the canvas."]]
                    .map(([m, icon, t]) => ["lasso:" + m, icon, `${t} ${LASSO_TIP}Erases from the selected layer (Shift+L).`, () => { setLassoMode("lassoErase", m); E.setTool("lassoErase"); }])] },
    }; E.GROUPS = GROUPS;
    function setLassoMode(key, m) {
        LASSO_MODES[key] = m;
        if (E.clickPoly && E.tool === key) { E.clickPoly.spline = m === "spline"; E.clickPoly.magnetic = m === "magnetic"; }
    }
    const grpBtns = {};
    function groupMenu(key, e) {
        const g = GROUPS[key], cur = g.cur();
        const items = g.entries().map(([id, , title, pickIt]) => ({ content: (id === cur ? "✓ " : "   ") + title.split(":")[0], pickIt }));
        contextMenu(e, items, g.name, (v) => { v?.pickIt?.(); focusSink(); });
    }
    for (const key of Object.keys(GROUPS)) {
        const b = E.el("button", "rg-btn icon grp"); b.type = "button"; b.dataset.group = key;
        const ic = E.el("span", "rg-grp-ic"), dd = E.el("span", "rg-grp-dd");
        dd.innerHTML = '<svg viewBox="0 0 8 16"><path d="M1.5 6.5L4 9.5l2.5-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        dd.title = "Other versions (also right-click)";
        b.append(ic, dd);
        b.addEventListener("pointerdown", (e) => { if (e.button === 2 || e.target.closest(".rg-grp-dd")) e.stopPropagation(); });
        b.addEventListener("click", (e) => {
            e.preventDefault();
            if (e.target.closest(".rg-grp-dd")) { groupMenu(key, e); return; }
            const g = GROUPS[key], cur = g.cur();
            (g.entries().find((x) => x[0] === cur) || g.entries()[0])[3]();
        });
        b.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); groupMenu(key, e); });
        grpBtns[key] = b;
        for (const t of GROUPS[key].tools) toolBtns[t] = b;
    }
    function refreshVariantButtons() {
        for (const [key, b] of Object.entries(grpBtns)) {
            const g = GROUPS[key], cur = g.cur(), en = g.entries().find((x) => x[0] === cur) || g.entries()[0];
            if (b.dataset.cur !== en[0]) { b.querySelector(".rg-grp-ic").innerHTML = svgIcon(en[1]); b.dataset.cur = en[0]; }
            b.title = `${en[2]}\n▾ or right-click: ${g.name === "Shape" ? "Other shapes" : "The other tools and versions"}.`;
        }
        if (document.activeElement !== tolIn) tolIn.value = String(TOOL_NUMS.wandTol);
        if (document.activeElement !== gapIn) gapIn.value = String(TOOL_NUMS.fillGap);
        syncToolOpts();
    }
    // ---- tool options: a strip in the canvas's top-left corner, shown while the active tool has some
    const optStrip = E.el("div", "rg-toolopts"); E.optStrip = optStrip; optStrip.style.display = "none";
    for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "contextmenu"]) optStrip.addEventListener(ev, (e) => e.stopPropagation());
    const optLab = (icon, forEl) => { const l = E.el("span", "rg-optlab"); l.innerHTML = svgIcon(icon); l.title = forEl.title; l.__for = forEl; return l; };
    const sidesIn = numIn(3, 64, E.sides, "Number of star points"); E.sidesIn = sidesIn;
    sidesIn.addEventListener("change", () => {
        E.sides = Math.max(3, Math.min(64, parseInt(sidesIn.value) || 5));
        const L = E.selLayer();
        if (L && L.shape === "star") E.change(() => { L.sides = E.sides; });
    });
    E.cornerPct = 20;                      // rounded rectangle: corner radius, % of the shorter side
    const radiusIn = numIn(0, 50, E.cornerPct, "Corner radius of the rounded rectangle, in % of its shorter side (0-50)"); E.radiusIn = radiusIn;
    radiusIn.addEventListener("change", () => {
        E.cornerPct = Math.max(0, Math.min(50, parseInt(radiusIn.value) || 0));
        radiusIn.value = String(E.cornerPct);
        const L = E.selLayer();
        if (L && L.shape === "roundrect") E.change(() => { L.radius = E.cornerPct; });
    });
    // the shape fields: drawing that shape, or with the selection tool on a layer of that shape
    const syncShapeOpts = () => {
        const L = E.tool === "select" ? E.state.layers.find((l) => l.id === E.selId) || null : null;
        sidesIn.style.display = (E.tool === "shape" && E.shapeKind === "star") || L?.shape === "star" ? "" : "none";
        radiusIn.style.display = (E.tool === "shape" && E.shapeKind === "roundrect") || L?.shape === "roundrect" ? "" : "none";
    };
    initLassoModes();
    // fill, closing small gaps: the gap size (px)
    const gapIn = numIn(1, 64, TOOL_NUMS.fillGap, "Fill, closing small gaps: Openings narrower than about twice this many "
        + "pixels are closed, so the fill doesn't leak through them (default in Settings > Region Genie > Canvas tools)");
    gapIn.addEventListener("change", () => { TOOL_NUMS.fillGap = Math.max(1, Math.min(64, parseInt(gapIn.value) || 4)); gapIn.value = String(TOOL_NUMS.fillGap); });
    const tolIn = numIn(0, 255, TOOL_NUMS.wandTol, "Magic wand tolerance: How different a color may be from the clicked one "
        + "(0-255 per channel) and still be selected (default in Settings > Region Genie > Canvas tools)");
    tolIn.addEventListener("change", () => { TOOL_NUMS.wandTol = Math.max(0, Math.min(255, parseInt(tolIn.value) || 0)); tolIn.value = String(TOOL_NUMS.wandTol); });
    const findIn = E.el("input", "rg-find"); E.findIn = findIn;
    findIn.type = "text"; findIn.placeholder = "find all…"; findIn.style.display = "none";
    findIn.title = "Find all: Type what to select and press Enter, e.g. 'person' or 'red car, dog' (commas separate several "
        + "things). Every match is selected; Ctrl+click one to leave it out (click again to bring it back). Drag a box "
        + "first to search only inside it. Enter adds them all to the active region, Shift+Enter makes each one its "
        + "own region with the text as its prompt.";
    findIn.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); if (findIn.value.trim()) E.pickFind(findIn.value.trim()); else if (E.pick?.masks?.length) E.pickAccept(e.shiftKey); }
        else if (e.key === "Escape") { e.preventDefault(); if (E.pick) E.pickCancel(); focusSink(); }
    });
    // the pending selection: add it (Enter) / discard it (Esc); shown while there is one
    const pickOkBtn = iconBtn("check", "Add the selection to the active region (Enter). Switching to another tool adds it too.", () => { if (E.pick) E.pickAccept(false); focusSink(); });
    const pickNoBtn = iconBtn("close", "Discard the selection (Esc)", () => { if (E.pick) E.pickCancel(); focusSink(); });
    pickOkBtn.style.display = pickNoBtn.style.display = "none";
    const optLabels = [optLab("shapeStar", sidesIn), optLab("shapeRoundrect", radiusIn), optLab("fillGaps", gapIn), optLab("wand", tolIn), optLab("samSelect", findIn)];
    optStrip.append(optLabels[0], sidesIn, optLabels[1], radiusIn, optLabels[2], gapIn, optLabels[3], tolIn, optLabels[4], findIn, pickOkBtn, pickNoBtn);
    // folded to the first option's icon; hover opens it, a click on that icon keeps it open (click again: fold)
    let optPinned = false;
    for (const l of optLabels) {
        l.addEventListener("click", (e) => {
            if (!l.classList.contains("lead")) return;
            e.preventDefault();
            optPinned = !optPinned;
            syncStrip();
            if (optPinned) l.__for.focus?.();
        });
    }
    function syncStrip() {
        let lead = null;
        for (const l of optLabels) {
            const d = l.__for.style.display;
            if (l.style.display !== d) l.style.display = d;
            if (!lead && d !== "none") lead = l;
        }
        for (const l of optLabels) {
            const on = l === lead;
            if (l.classList.contains("lead") !== on) l.classList.toggle("lead", on);
            const tip = on ? `${l.__for.title}\nHover: Show the field.\nClick: ${optPinned ? "Fold it again" : "Keep it open"}.` : l.__for.title;
            if (l.title !== tip) l.title = tip;
        }
        optStrip.classList.toggle("pinned", optPinned);
        optStrip.classList.toggle("busy", pickOkBtn.style.display !== "none");
        const any = [sidesIn, radiusIn, gapIn, tolIn, findIn, pickOkBtn].some((x) => x.style.display !== "none") ? "" : "none";
        if (optStrip.style.display !== any) optStrip.style.display = any;
    }
    function syncPickBtns() {
        const show = E.tool === "object" && !!E.pick ? "" : "none";
        if (pickOkBtn.style.display !== show) { pickOkBtn.style.display = pickNoBtn.style.display = show; syncStrip(); }
        const ok = !!E.pick && !E.pickBusy && E.pick.masks.some((m) => !m.off);
        if (pickOkBtn.disabled === ok) pickOkBtn.disabled = !ok;
    }
    function syncToolOpts() {
        tolIn.style.display = E.tool === "wand" ? "" : "none";
        findIn.style.display = E.tool === "object" ? "" : "none";
        gapIn.style.display = E.tool === "fill" && LASSO_MODES.fill === "gaps" ? "" : "none";
        syncShapeOpts();
        syncStrip();
    }
    lassoRefreshers.add(refreshVariantButtons);
    bar1.append(grpBtns.shape);
    addTool("brush", "Brush: Paint into the selected layer, or a new layer for the active region (B). Shift+click draws a "
        + "straight line from where the last stroke ended.\nSize: The slider on the canvas, [ ], Alt+wheel.");
    bar1.append(grpBtns.lasso, grpBtns.fill, grpBtns.wand, grpBtns.erase);
    refreshVariantButtons();
    // arrange the selected layer: flip, align to the image, grow / shrink
    const arrangeBtn = iconBtn("arrange", "Arrange the selected layer: Flip, align to the image, grow or shrink", () => toggleArrange()); E.arrangeBtn = arrangeBtn;
    bar1.appendChild(arrangeBtn);
    E.arrangePop = null; let growPx = 8;
    function closeArrange() {
        if (!E.arrangePop) return;
        E.arrangePop.remove(); E.arrangePop = null;
        window.removeEventListener("pointerdown", arrangeOutside, true);
        arrangeBtn.classList.remove("on");
    }
    function arrangeOutside(e) { if (E.arrangePop && !E.arrangePop.contains(e.target) && !arrangeBtn.contains(e.target)) closeArrange(); }
    function toggleArrange() {
        if (E.arrangePop) { closeArrange(); return; }
        const pop = E.el("div", "rg-arrange");
        const row = (label) => { const r = E.el("div", "rg-arrange-row"); if (label) { const t = E.el("span", "rg-hint"); t.textContent = label; r.appendChild(t); } pop.appendChild(r); return r; };
        const act = (icon, title, fn) => {
            const b = iconBtn(icon, title, () => { const L = E.selLayer(); if (!L) { E.hint("Select a layer first"); return; } fn(L); });
            b.addEventListener("pointerdown", (e) => e.stopPropagation());
            return b;
        };
        row("Flip").append(
            act("flipH", "Flip horizontally (mirror left-right)", (L) => E.flipLayer(L, "h")),
            act("flipV", "Flip vertically (upside down)", (L) => E.flipLayer(L, "v")));
        row("Align").append(
            act("alignL", "Align to the left edge of the image", (L) => E.alignLayer(L, "l")),
            act("alignCH", "Centre horizontally in the image", (L) => E.alignLayer(L, "ch")),
            act("alignR", "Align to the right edge of the image", (L) => E.alignLayer(L, "r")),
            act("alignT", "Align to the top edge of the image", (L) => E.alignLayer(L, "t")),
            act("alignCV", "Centre vertically in the image", (L) => E.alignLayer(L, "cv")),
            act("alignB", "Align to the bottom edge of the image", (L) => E.alignLayer(L, "b")),
            act("alignCenter", "Centre in the image", (L) => E.alignLayer(L, "c")));
        const pxIn = E.el("input", "rg-num"); pxIn.type = "number"; pxIn.min = "1"; pxIn.max = "512"; pxIn.step = "1"; pxIn.value = String(growPx);
        pxIn.title = "How many image pixels to grow or shrink by";
        pxIn.addEventListener("keydown", (e) => e.stopPropagation());
        pxIn.addEventListener("change", () => { growPx = Math.max(1, Math.min(512, parseInt(pxIn.value) || 8)); pxIn.value = String(growPx); });
        const GROW_NOTE = " The layer becomes pixels (a shape can't be edited as a shape any more). Undoable.";
        row("Edge").append(
            act("layerGrow", "Grow the layer's area by this many pixels on every side." + GROW_NOTE, (L) => E.growLayer(L, growPx)),
            act("layerShrink", "Shrink the layer's area by this many pixels on every side." + GROW_NOTE, (L) => E.growLayer(L, -growPx)),
            pxIn);
        const hintPx = E.el("span", "rg-hint"); hintPx.textContent = "px"; pop.lastChild.appendChild(hintPx);
        document.body.appendChild(pop);
        const r = arrangeBtn.getBoundingClientRect();
        pop.style.left = `${Math.max(4, Math.min(window.innerWidth - pop.offsetWidth - 4, r.left))}px`;
        pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 4, r.bottom + 4)}px`;
        E.arrangePop = pop; arrangeBtn.classList.add("on");
        window.addEventListener("pointerdown", arrangeOutside, true);
    }

    // snap to grid: magnet (on, highlighted) / slashed magnet (off), like the labels eye
    const snapBtn = iconBtn("magnetOff", "", () => { E.snap = !E.snap; setSnapIcon(); E.requestDraw(); }, "toggle");
    function setSnapIcon() {
        setHTML(snapBtn, svgIcon(E.snap ? "magnet" : "magnetOff"));
        snapBtn.classList.toggle("on", E.snap);
        snapBtn.title = E.snap ? "Snap to grid on: Points, shapes and moves snap to the grid (click or G to turn off)"
            : "Snap to grid off: Click (or G) to snap points, shapes and moves to the grid";
    }
    setSnapIcon();
    const gridIn = E.el("input", "rg-num");
    gridIn.type = "number"; gridIn.min = "2"; gridIn.max = "4096"; gridIn.value = String(E.grid);
    gridIn.title = "Grid size in image pixels";
    gridIn.addEventListener("change", () => { E.grid = Math.max(2, parseInt(gridIn.value) || 64); E.requestDraw(); });
    const undoBtn = iconBtn("undo", "Undo (Ctrl+Z)", E.undo); E.undoBtn = undoBtn;
    const redoBtn = iconBtn("redo", "Redo (Ctrl+Shift+Z / Ctrl+Y)", E.redo); E.redoBtn = redoBtn;
    const fitBtn = E.btn("Fit", "Fit the image in view (Home). Wheel zooms, middle-drag or Space+drag pans.", () => { E.userView = false; E.fitView(); E.requestDraw(); });
    const clearBtn = iconBtn("clear", "Clear all: Remove every layer and region (undoable)", () => {
        if (E.state.layers.length || E.state.regions.length || E.state.importSig) E.change(() => { E.state.layers = []; E.state.regions = []; delete E.state.importSig; E.selId = null; E.curRegion = null; E.filter = ALL; });
    }); E.clearBtn = clearBtn;
    // image opacity: a vertical slider over the canvas's right edge while an image is shown under the regions
    const bdBox = E.el("div", "rg-oslider"); E.bdBox = bdBox; bdBox.style.display = "none";
    bdBox.innerHTML = '<svg viewBox="0 0 26 160" preserveAspectRatio="none"><rect x="11" y="14" width="4" height="132" rx="2" '
        + 'fill="rgba(240,240,240,.45)" stroke="#111" stroke-width="1"/></svg>';
    const bdIcon = E.el("span", "rg-oslider-ic"); bdIcon.innerHTML = svgIcon("opacity");
    const bdHandle = E.el("div", "rg-bhandle rg-ohandle");
    bdBox.append(bdIcon, bdHandle);
    const O_TOP = 14 / 160, O_BOT = 146 / 160;
    function syncOpacity() {
        bdHandle.style.top = `${(O_BOT - E.backdropOpacity * (O_BOT - O_TOP)) * 100}%`;
        bdBox.title = `Image opacity: ${Math.round(E.backdropOpacity * 100)}% — how strongly the image on the 'image' input shows `
            + "under the regions (drag, or the mouse wheel)";
    }
    const opacityFromY = (y) => {
        const r = bdBox.getBoundingClientRect(), f = (y - r.top) / Math.max(1, r.height);
        E.backdropOpacity = Math.round(Math.min(1, Math.max(0, (O_BOT - f) / (O_BOT - O_TOP))) * 20) / 20;
        syncOpacity(); E.requestDraw();
    };
    let oDrag = false;
    bdBox.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        oDrag = true; bdBox.classList.add("drag");
        try { bdBox.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        opacityFromY(e.clientY);
    });
    bdBox.addEventListener("pointermove", (e) => { e.stopPropagation(); if (oDrag) opacityFromY(e.clientY); });
    const endODrag = (e) => { if (!oDrag) return; oDrag = false; bdBox.classList.remove("drag"); try { bdBox.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ } };
    bdBox.addEventListener("pointerup", endODrag);
    bdBox.addEventListener("pointercancel", endODrag);
    for (const ev of ["mousedown", "mouseup", "click", "dblclick", "contextmenu"]) bdBox.addEventListener(ev, (e) => e.stopPropagation());
    bdBox.addEventListener("wheel", (e) => {
        e.preventDefault(); e.stopPropagation();
        E.backdropOpacity = Math.round(Math.min(1, Math.max(0, E.backdropOpacity + (e.deltaY < 0 ? 0.05 : -0.05))) * 20) / 20;
        syncOpacity(); E.requestDraw();
    }, { passive: false });
    syncOpacity();
    E.node.properties = E.node.properties || {};
    if (E.node.properties.rg_labels === undefined) E.node.properties.rg_labels = true;
    const labBtn = iconBtn("eye", "", () => {
        E.node.properties.rg_labels = E.node.properties.rg_labels === false;
        setLabIcon(); E.requestDraw();
    }, "toggle");
    function setLabIcon() {
        const on = E.node.properties.rg_labels !== false;
        setHTML(labBtn, svgIcon(on ? "eye" : "eyeOff"));
        labBtn.classList.toggle("on", on);
        labBtn.title = on ? "Labels on: Each region's number and prompt are shown on the canvas (click to hide)"
            : "Labels off: Click to show each region's number and prompt on the canvas";
    }
    setLabIcon();
    const dimsLbl = E.el("span", "rg-hint"); E.dimsLbl = dimsLbl; dimsLbl.style.marginLeft = "auto";
    dimsLbl.title = "The canvas size in pixels (the image size this node makes; set in the size row above)";
    bar1.append(sep(), undoBtn, redoBtn, clearBtn, sep(), snapBtn, gridIn, fitBtn, labBtn, dimsLbl);
}
