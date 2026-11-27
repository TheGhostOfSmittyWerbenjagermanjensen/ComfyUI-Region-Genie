// The editor's elements, the tool buttons (with versions), the tool options strip on the canvas, Arrange, opacity and labels.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { svgIcon, setHTML, getSetting, setSetting, SET } from "../rg_shared.js";
import { openMenu } from "../rg_menu.js";
import { keyed, keyText } from "../rg_keys.js";
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
        b.innerHTML = svgIcon(name); E.keyTitle(b, title);
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
    const LASSO_TIP = () => `Drag freehand, or click points and close the loop (click the first point${keyText("draw.accept") ? `, double-click or ${keyText("draw.accept")}` : " or double-click"}). `;
    // every shape has a command, "tool.<shape>": its default key is written into the tooltip (keyed() puts the
    // user's own there; a key that the user took away is left out of the sentence)
    const SHAPE_KEYS = { rect: "R", roundrect: "Shift+R", ellipse: "O", triangle: "T", pentagon: "N", hexagon: "X", star: "S", heart: "H" };
    const OBJECT_TIP = () => "Select object (Q): SAM 3.1 finds the object you click in the image under the canvas. Click to add "
        + "a point on the object, Ctrl+click a spot the selection covers but shouldn't (a red point takes it out), drag a box around it"
        + [[keyText("draw.back"), "undoes the last point"], [keyText("draw.accept"), "adds the selection to the active region"], [keyText("draw.cancel"), "cancels"]]
            .filter(([k]) => k).map(([k, what], i) => `${i ? ", " : "; "}${k} ${what}`).join("")
        + ". Or type what to find in the field on the canvas. Needs the SAM 3.1 model (Settings > Region Genie > Select object).";
    // entries: [id, icon, title, pick()]; cur(): the id shown
    const GROUPS = {
        shape: { name: "Shape", tools: ["shape"], cur: () => E.shapeKind,
            entries: () => SHAPES.map(([k, label]) => [k, "shape" + k[0].toUpperCase() + k.slice(1),
                `Shape (${label}): Drag a box to draw it; Shift for equal sides, Alt to draw from the centre`
                    + (SHAPE_KEYS[k] ? ` (${SHAPE_KEYS[k]})` : "") + ".",
                () => { E.shapeKind = k; E.setTool("shape"); }, "tool." + k, `(${label})`]) },
        lasso: { name: "Lasso", tools: ["lasso"], cur: () => LASSO_MODES.lasso,
            entries: () => [["plain", "lasso", "Lasso: Straight lines between the points."], ["spline", "lassoSpline", "Lasso (spline): A smooth curve through the points."],
                ["magnetic", "lassoMagnetic", "Lasso (magnetic): The outline follows edges in the image under the canvas."]]
                .map(([m, icon, t]) => [m, icon, `${t} ${LASSO_TIP()}Filled with the active region (L).`, () => { setLassoMode("lasso", m); E.setTool("lasso"); }]) },
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
                ["object", "samSelect", OBJECT_TIP(), () => E.setTool("object")]] },
        erase: { name: "Eraser / Lasso erase", tools: ["erase", "lassoErase"], cur: () => (grpCur.erase === "erase" ? "erase" : "lasso:" + LASSO_MODES.lassoErase),
            entries: () => [
                ["erase", "erase", "Eraser: Erase from the selected layer (E). Shift+click draws a straight line from where the last stroke ended.", () => E.setTool("erase")],
                ...[["plain", "lassoErase", "Lasso erase: Straight lines between the points."], ["spline", "lassoEraseSpline", "Lasso erase (spline): A smooth curve through the points."],
                    ["magnetic", "lassoEraseMagnetic", "Lasso erase (magnetic): The outline follows edges in the image under the canvas."]]
                    .map(([m, icon, t]) => ["lasso:" + m, icon, `${t} ${LASSO_TIP()}Erases from the selected layer (Shift+L).`, () => { setLassoMode("lassoErase", m); E.setTool("lassoErase"); }])] },
    }; E.GROUPS = GROUPS;
    function setLassoMode(key, m) {
        LASSO_MODES[key] = m;
        if (E.clickPoly && E.tool === key) { E.clickPoly.spline = m === "spline"; E.clickPoly.magnetic = m === "magnetic"; }
    }
    const grpBtns = {};
    function groupMenu(key, e) {
        const g = GROUPS[key], cur = g.cur();
        // the pack's own menu: each row has the entry's icon, its key and, when pointed at, its tooltip.
        // A shape's row is its icon and "(Name)"; the other rows keep the tool's name.
        const items = g.entries().map(([id, icon, title, pickIt, cmd, label]) => ({ label: label || title.split(":")[0], icon, tick: id === cur,
            key: cmd ? keyText(cmd) : "", title: keyed(title), fn: pickIt }));
        const at = e.target.closest?.(".rg-grp-dd, .rg-btn")?.getBoundingClientRect();
        openMenu(at ? at.left : e.clientX, at ? at.bottom + 2 : e.clientY, [{ head: g.name }, ...items], { onClose: () => { if (E.wrap.isConnected) focusSink(); } });
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
            b.title = keyed(`${en[2]}\n▾ or right-click: ${g.name === "Shape" ? "Other shapes" : "The other tools and versions"}.`);
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
    findIn.title = "Find all: Type what to select, e.g. 'person' or 'red car, dog' (commas separate things), then press Enter.\n"
        + "Drag a box first: Search only inside it.\n"
        + "Ctrl+click a match: Leave it out / bring it back.\n"
        + "Enter: Add all matches to the active region.\n"
        + "Shift+Enter: With several matches, each becomes its own region, with what it matched as its prompt.";
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
        E.poseStripSync?.();
    }
    lassoRefreshers.add(refreshVariantButtons);
    bar1.append(grpBtns.shape);
    addTool("brush", "Brush: Paint into the selected layer, or a new layer for the active region (B). Shift+click draws a "
        + "straight line from where the last stroke ended.\nSize: The slider on the canvas, [ ], Alt+wheel.");
    bar1.append(grpBtns.lasso, grpBtns.fill, grpBtns.wand, grpBtns.erase);
    refreshVariantButtons();
    addTool("pose", "Pose: Stick figures for pose control (P). Drag a box to draw a figure in the pose picked on the canvas, then drag "
        + "its joints. Drag a bone to move the figure; the handles resize and turn it.\nA Control row set to pose makes the model follow the figures.");
    // Arrange: flip, align to the image, grow / shrink. Round 102: on the selected layer, the active region, picked
    // regions or the whole picture ("Apply to"), with "Together / Each" for more than one region (one block, or each
    // region on its own), and two more flips that mirror across the image's centre lines (selectTools.js does the work)
    const ARRANGE_TIP = "Arrange: Flip, align to the image, or grow and shrink the selected layer, a region, several regions or the whole picture";
    const arrangeBtn = iconBtn("arrange", ARRANGE_TIP, () => toggleArrange()); E.arrangeBtn = arrangeBtn;
    bar1.appendChild(arrangeBtn);
    E.arrangePop = null; let growPx = 8;
    E.arrangeTo = null;                 // "layer" | "region" | "all" | "pick": what the pop-up acts on (kept while the page is open)
    E.arrangePick = new Set();          // the regions picked under "Pick…"
    E.arrangeEach = false;              // more than one region: each on its own (true) or together as one block
    function closeArrange() {
        if (!E.arrangePop) return;
        E.arrangePop.remove(); E.arrangePop = null;
        window.removeEventListener("pointerdown", arrangeOutside, true);
        arrangeBtn.classList.remove("on");
    }
    function arrangeOutside(e) { if (E.arrangePop && !E.arrangePop.contains(e.target) && !arrangeBtn.contains(e.target)) closeArrange(); }
    const arrangeable = () => E.state.regions.filter((r) => !r.fromImage && (E.listedOf(r.id).length || E.posesOf?.(r.id).length));
    // what "Apply to" stands for now: { kind, layer?, ids? } (null: nothing there)
    function arrangeTarget() {
        if (E.arrangeTo === "layer") { const L = E.selLayer(); return L ? { kind: "layer", layer: L } : null; }
        if (E.arrangeTo === "region") return E.curRegion != null && E.regionById(E.curRegion) ? { kind: "regions", ids: [E.curRegion] } : null;
        if (E.arrangeTo === "pick") { const ids = E.state.regions.filter((r) => E.arrangePick.has(r.id)).map((r) => r.id); return ids.length ? { kind: "regions", ids } : null; }
        return { kind: "all" };
    }
    const manyRegions = (t) => !!t && (t.kind === "all" ? arrangeable().length > 1 : t.kind === "regions" && t.ids.length > 1);
    // run a flip or an align on what "Apply to" stands for, with the words for the Undo tooltip
    const SIDES = { l: "to the left edge", ch: "to the horizontal centre", r: "to the right edge", t: "to the top edge", cv: "to the vertical centre", b: "to the bottom edge", c: "to the centre" };
    function arrangeRun(op, arg, about, forced = null) {
        const t = forced || arrangeTarget();
        if (!t) { E.hint(E.arrangeTo === "layer" ? "Select a layer first" : E.arrangeTo === "pick" ? "Pick one or more regions first" : "Make a region the active one first"); return; }
        const each = !forced && manyRegions(t) && E.arrangeEach, groups = E.arrangeGroups(t, each), name = E.arrangeName(t);
        if (!groups.length) { E.hint("Nothing to arrange there yet"); return; }
        const dir = arg === "h" ? "horizontally" : "vertically";
        const done = op === "flip"
            ? E.arrangeFlip(groups, arg, about, about === "image" ? (t.kind === "all" ? `Mirroring the whole picture ${dir}` : `Mirroring ${name} ${dir} across the image`)
                : `Flipping ${name} ${dir}${each ? ", each in its place" : ""}`)
            : E.arrangeAlign(groups, arg, `Aligning ${name}${each ? ", each" : ""} ${SIDES[arg]}`);
        // what lies under the regions comes from outside the node: a mirror moves the regions, not that picture
        if (done && op === "flip" && (E.isEdit?.() || E.backdrop)) E.hint("Mirrored: The regions moved; the image under them is an input of the node and stays as it was");
        if (!done && op === "align") E.hint("Already there");
    }
    // the canvas's right-click menu: "Mirror the whole picture" (left to right)
    E.mirrorWholePicture = () => arrangeRun("flip", "h", "image", { kind: "all" });
    function toggleArrange() {
        if (E.arrangePop) { closeArrange(); return; }
        // what it opens on: the last choice while it still stands for something, else the selected layer, else the
        // active region, else the whole picture
        if (!E.arrangeTo || (E.arrangeTo === "layer" && !E.selLayer()) || (E.arrangeTo === "region" && E.curRegion == null)) E.arrangeTo = E.selLayer() ? "layer" : E.curRegion != null ? "region" : "all";
        if (!E.arrangePick.size && E.curRegion != null) E.arrangePick.add(E.curRegion);
        const pop = E.el("div", "rg-arrange");
        pop.addEventListener("pointerdown", (e) => e.stopPropagation());
        E.arrangePop = pop; arrangeBtn.classList.add("on");
        fillArrange();
        document.body.appendChild(pop);
        const r = arrangeBtn.getBoundingClientRect();
        pop.style.left = `${Math.max(4, Math.min(window.innerWidth - pop.offsetWidth - 4, r.left))}px`;
        pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 4, r.bottom + 4)}px`;
        window.addEventListener("pointerdown", arrangeOutside, true);
    }
    // what the pop-up shows depends on: the selected layer, the active region, the regions (render.js fills it again
    // when this changes while it is open: a key, a click in the list)
    const arrangeSig = () => `${E.selId}|${E.curRegion}|${E.state.regions.map((r) => r.id).join(",")}|${E.state.layers.length}`;
    E.arrangeStale = () => !!E.arrangePop && E.arrangeSig !== arrangeSig();
    E.fillArrange = () => fillArrange();
    // the pop-up's rows, again whenever "Apply to", the picked regions or "Together / Each" change
    function fillArrange() {
        const pop = E.arrangePop;
        if (!pop) return;
        E.arrangeSig = arrangeSig();
        pop.replaceChildren();
        const row = (label, cls = "") => { const r = E.el("div", "rg-arrange-row" + (cls ? " " + cls : "")); if (label != null) { const t = E.el("span", "rg-hint"); t.textContent = label; r.appendChild(t); } pop.appendChild(r); return r; };
        const seg = (choices, cur, onPick) => {
            const box = E.el("span", "rg-arrange-seg");
            for (const [v, text, title, off] of choices) {
                const b = E.el("button", "rg-btn" + (v === cur ? " on" : "")); b.type = "button"; b.textContent = text; b.title = title; b.disabled = !!off;
                b.addEventListener("click", (e) => { e.preventDefault(); onPick(v); });
                box.appendChild(b);
            }
            return box;
        };
        const ri = E.curRegion != null ? E.state.regions.findIndex((r) => r.id === E.curRegion) : -1;
        row("Apply to").append(seg([
            ["layer", "Layer", "Layer: The selected layer only.", !E.selLayer()],
            ["region", ri >= 0 ? `Region ${ri}` : "Region", "Region: The active region (its row is marked in the list), all its layers as one, hidden ones and its pose figures too.", ri < 0],
            ["all", "All", "All: Every region, and what belongs to no region: the whole picture. Its flips mirror across the image's centre lines."],
            ["pick", "Pick…", "Pick: Choose the regions below."],
        ], E.arrangeTo, (v) => { E.arrangeTo = v; fillArrange(); }));
        if (E.arrangeTo === "pick") {
            const chips = row("", "rg-arrange-picks");
            E.state.regions.forEach((r, i) => {
                const b = E.el("button", "rg-btn rg-arrange-chip" + (E.arrangePick.has(r.id) ? " on" : "")); b.type = "button";
                const sw = E.el("i"); sw.style.background = E.colorOf ? E.colorOf(r.id) : r.color; b.append(sw, String(i));
                const empty = r.fromImage || !(E.listedOf(r.id).length || E.posesOf?.(r.id).length);
                b.disabled = empty;
                b.title = empty ? `Region ${i}: Nothing to arrange (no layers${r.fromImage ? "; it is a color of the input image" : ""}).` : `Region ${i}: Click to pick it, or to leave it out.`;
                b.addEventListener("click", (e) => { e.preventDefault(); if (E.arrangePick.has(r.id)) E.arrangePick.delete(r.id); else E.arrangePick.add(r.id); fillArrange(); });
                chips.appendChild(b);
            });
            const link = (text, title, fn) => { const a = E.el("button", "rg-btn rg-arrange-link"); a.type = "button"; a.textContent = text; a.title = title; a.addEventListener("click", (e) => { e.preventDefault(); fn(); fillArrange(); }); return a; };
            chips.append(link("All", "Pick every region", () => { for (const r of arrangeable()) E.arrangePick.add(r.id); }), link("None", "Pick none", () => E.arrangePick.clear()));
        }
        const t = arrangeTarget();
        if (manyRegions(t)) {
            row("Several").append(seg([
                [false, "Together", "Together: The regions move as one block (centre the whole scene, flip it in place)."],
                [true, "Each", "Each: Every region on its own (each centred, each flipped in its own place)."],
            ], E.arrangeEach, (v) => { E.arrangeEach = v; fillArrange(); }));
        }
        const act = (icon, title, fn, off) => {
            const b = iconBtn(icon, title, () => fn()); b.disabled = !!off;
            b.addEventListener("pointerdown", (e) => e.stopPropagation());
            return b;
        };
        const what = !t ? "What Apply to names" : t.kind === "layer" ? "The layer" : t.kind === "all" ? "The whole picture" : t.ids.length > 1 ? "The regions" : "The region";
        const inPlace = t?.kind === "all" && !(manyRegions(t) && E.arrangeEach) ? "across the image's centre line (for All)" : manyRegions(t) && E.arrangeEach ? "each in its own place" : "in place";
        row("Flip").append(
            act("flipH", `Flip horizontally (mirror left-right), ${inPlace}. ${what}.`, () => arrangeRun("flip", "h", t?.kind === "all" && !E.arrangeEach ? "image" : "self")),
            act("flipV", `Flip vertically (upside down), ${inPlace}. ${what}.`, () => arrangeRun("flip", "v", t?.kind === "all" && !E.arrangeEach ? "image" : "self")),
            E.el("span", "rg-sep"),
            act("mirrorImgH", `Mirror horizontally across the image's vertical centre line: What is on the left goes to the right. ${what}.`, () => arrangeRun("flip", "h", "image")),
            act("mirrorImgV", `Mirror vertically across the image's horizontal centre line: What is at the top goes to the bottom. ${what}.`, () => arrangeRun("flip", "v", "image")));
        const by = t?.kind === "layer" ? " (by the layer's own pixels)" : " (by the shown layers' pixels)";
        row("Align").append(
            act("alignL", `Align to the left edge of the image${by}`, () => arrangeRun("align", "l")),
            act("alignCH", "Centre horizontally in the image", () => arrangeRun("align", "ch")),
            act("alignR", "Align to the right edge of the image", () => arrangeRun("align", "r")),
            act("alignT", "Align to the top edge of the image", () => arrangeRun("align", "t")),
            act("alignCV", "Centre vertically in the image", () => arrangeRun("align", "cv")),
            act("alignB", "Align to the bottom edge of the image", () => arrangeRun("align", "b")),
            act("alignCenter", "Centre in the image", () => arrangeRun("align", "c")));
        const layerOnly = E.arrangeTo !== "layer";
        const ONLY = layerOnly ? "\nFor a single layer only: Choose Layer under Apply to." : "";
        const pxIn = E.el("input", "rg-num"); pxIn.type = "number"; pxIn.min = "1"; pxIn.max = "512"; pxIn.step = "1"; pxIn.value = String(growPx); pxIn.disabled = layerOnly;
        pxIn.title = "How many image pixels to grow or shrink by" + ONLY;
        pxIn.addEventListener("keydown", (e) => e.stopPropagation());
        pxIn.addEventListener("change", () => { growPx = Math.max(1, Math.min(512, parseInt(pxIn.value) || 8)); pxIn.value = String(growPx); });
        const GROW_NOTE = "\nA shape with nothing painted on it: Stays that shape; its sides move and its corners stay as they are.\n"
            + "Anything painted (brush, lasso, fill, a selection, a shape painted or erased on): Becomes pixels." + ONLY;
        const grow = (px) => { const L = E.selLayer(); if (!L) { E.hint("Select a layer first"); return; } E.growLayer(L, px); };
        const edge = row("Edge", layerOnly ? "off" : "");
        edge.append(
            act("layerGrow", "Grow the layer by this many pixels on every side." + GROW_NOTE, () => grow(growPx), layerOnly),
            act("layerShrink", "Shrink the layer by this many pixels on every side." + GROW_NOTE, () => grow(-growPx), layerOnly),
            pxIn);
        const hintPx = E.el("span", "rg-hint"); hintPx.textContent = "px"; edge.appendChild(hintPx);
    }

    // snap to grid: magnet (on, highlighted) / slashed magnet (off), like the labels eye
    // Its ▾ (also right-click) opens the grid's menu: snap, the grid shown without snapping, how strong its lines are
    // (round 99: "solid": as dark as the other buttons while off; its icon and its lit state already say on / off)
    const snapBtn = E.el("button", "rg-btn icon grp toggle solid"); snapBtn.type = "button";
    const snapIc = E.el("span", "rg-grp-ic"), snapDd = E.el("span", "rg-grp-dd");
    snapDd.innerHTML = '<svg viewBox="0 0 8 16"><path d="M1.5 6.5L4 9.5l2.5-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    snapDd.title = "The grid's options (also right-click)";
    snapBtn.append(snapIc, snapDd);
    const toggleSnap = () => { E.snap = !E.snap; setSnapIcon(); E.requestDraw(); };
    const toggleGrid = () => { E.showGrid = !E.showGrid; setSnapIcon(); E.requestDraw(); };
    function gridMenu(e) {
        const lines = getSetting(SET.cmGridLines, "normal"), at = snapBtn.getBoundingClientRect();
        const line = (value, label, what) => ({ label, tick: lines === value, title: `Grid lines: ${what}. For every Region Genie node (also in Settings).`,
            fn: async () => { await setSetting(SET.cmGridLines, value); E.requestDraw(); } });
        // round 99: the grid's size lives here (it was a number field next to the button): a field, and common sizes
        const setGrid = (v) => { E.grid = Math.max(2, Math.min(4096, Math.round(v) || 64)); setSnapIcon(); E.requestDraw(); };
        const sizeRow = E.el("label", "rg-gridsize"), sizeIn = E.el("input", "rg-num"), px = E.el("span");
        sizeIn.type = "number"; sizeIn.min = "2"; sizeIn.max = "4096"; sizeIn.step = "1"; sizeIn.value = String(E.grid); px.textContent = "px";
        sizeRow.title = "Grid size in image pixels: Type a size; the grid on the canvas follows as you type. Enter closes the menu.";
        sizeRow.append(sizeIn, px);
        const sizes = E.el("div", "rg-gridsizes");
        const markSizes = () => { for (const b of sizes.children) b.classList.toggle("on", +b.textContent === E.grid); };
        for (const v of [8, 16, 32, 64, 128]) {
            const b = E.el("button", "rg-btn"); b.type = "button"; b.textContent = String(v); b.title = `Grid size ${v} px`;
            b.addEventListener("click", (ev) => { ev.preventDefault(); setGrid(v); menu.close(); });
            sizes.append(b);
        }
        markSizes();
        sizeIn.addEventListener("input", () => { const v = parseInt(sizeIn.value); if (v >= 2) { setGrid(v); markSizes(); } });
        sizeIn.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); menu.close(); } });
        sizeIn.addEventListener("wheel", (ev) => { ev.preventDefault(); ev.stopPropagation(); setGrid(E.grid + (ev.deltaY < 0 ? 1 : -1)); sizeIn.value = String(E.grid); markSizes(); }, { passive: false });
        sizeIn.addEventListener("focus", () => sizeIn.select());
        const menu = openMenu(at.left, at.bottom + 2, [{ head: "Grid size" }, { custom: sizeRow }, { custom: sizes }, null, { head: "Grid" },
            { label: "Snap to grid", key: keyText("view.snap"), checked: !!E.snap, title: keyed("Snap to grid: Points, shapes and moves snap to the grid (G)."), fn: toggleSnap },
            { label: "Show the grid without snapping", key: keyText("view.grid"), checked: !!E.showGrid,
              title: keyed("Show the grid without snapping: The grid's lines are drawn while snap is off too (Shift+G)."), fn: toggleGrid },
            null, { head: "Grid lines" },
            line("faint", "Faint", "Barely visible"), line("normal", "Normal", "Clearly visible"), line("strong", "Strong", "Stand out")],
        { onClose: () => { if (E.wrap.isConnected) focusSink(); } });
    }
    snapBtn.addEventListener("pointerdown", (e) => { if (e.button === 2 || e.target.closest(".rg-grp-dd")) e.stopPropagation(); });
    snapBtn.addEventListener("click", (e) => { e.preventDefault(); if (e.target.closest(".rg-grp-dd")) gridMenu(e); else toggleSnap(); });
    snapBtn.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); gridMenu(e); });
    function setSnapIcon() {
        setHTML(snapIc, svgIcon(E.snap ? "magnet" : "magnetOff"));
        snapBtn.classList.toggle("on", E.snap);
        snapBtn.title = keyed((E.snap ? "Snap to grid: On. Points, shapes and moves snap to the grid; click to turn it off (G).\n"
            : "Snap to grid: Off. Click to snap points, shapes and moves to the grid (G).\n")
            + (E.showGrid && !E.snap ? "The grid is shown without snapping (Shift+G).\n" : "")
            + `Grid size: ${E.grid} px.\n`
            + "▾ or right-click: The grid's size, the grid shown without snapping, and how strong its lines are.");
    }
    setSnapIcon();
    const undoBtn = iconBtn("undo", "Undo (Ctrl+Z)", E.undo); E.undoBtn = undoBtn;
    const redoBtn = iconBtn("redo", "Redo (Ctrl+Shift+Z / Ctrl+Y)", E.redo); E.redoBtn = redoBtn;
    const fitBtn = E.btn("Fit", "Fit the image in view (Home). Wheel zooms, middle-drag or Space+drag pans.", () => { E.userView = false; E.fitView(); E.requestDraw(); });
    const clearBtn = iconBtn("clear", "Clear all: Remove every layer and region (Undo brings them back)", () => {
        if (E.state.layers.length || E.state.regions.length || E.state.poses?.length || E.state.importSig) E.change(() => { E.state.layers = []; E.state.regions = []; delete E.state.poses; delete E.state.importSig; E.selId = null; E.curRegion = null; E.filter = ALL; });
    }, "danger"); E.clearBtn = clearBtn;
    // region opacity (how solid the regions' colors are drawn; one value with an image under them, one without:
    // E.fillNow / E.setFill in core.js): a button in the canvas's top right corner (the strip of footer.js's image
    // mode buttons; canvasUi.js puts it there), and a vertical slider that drops down from it while the pointer is
    // on either, while it is dragged, or after a click on the button until the next click elsewhere
    const opBox = E.el("span", "rg-opac"); E.opacBox = opBox;
    const opBtn = E.el("button", "rg-btn icon"); opBtn.type = "button"; opBtn.innerHTML = svgIcon("opacity");
    const bdBox = E.el("div", "rg-oslider"); E.bdBox = bdBox;
    opBtn.addEventListener("click", (e) => { e.preventDefault(); opBox.classList.toggle("open"); });
    const closeOp = (e) => {
        if (!opBox.isConnected && !E.wrap.isConnected) { document.removeEventListener("pointerdown", closeOp, true); return; }   // the node is gone
        if (opBox.classList.contains("open") && !opBox.contains(e.target)) opBox.classList.remove("open");
    };
    document.addEventListener("pointerdown", closeOp, true);
    bdBox.innerHTML = '<svg viewBox="0 0 26 160" preserveAspectRatio="none"><rect x="11" y="14" width="4" height="132" rx="2" '
        + 'fill="rgba(240,240,240,.45)" stroke="#111" stroke-width="1"/></svg>';
    const bdHandle = E.el("div", "rg-bhandle rg-ohandle");
    bdBox.append(bdHandle);
    opBox.append(opBtn, bdBox);
    const O_TOP = 14 / 160, O_BOT = 146 / 160;
    let shownFill = "";
    function syncOpacity() {
        const f = E.fillNow(), key = `${f}|${E.backdrop ? 1 : 0}`;
        if (key === shownFill) return;
        shownFill = key;
        bdHandle.style.top = `${(O_BOT - f * (O_BOT - O_TOP)) * 100}%`;
        const what = `Region opacity: ${Math.round(f * 100)}%.\n`
            + (E.backdrop ? "How solid the regions' colors are drawn over the image. Below 100% a line along each region's edge stays solid.\n"
                : "How solid the regions' colors are drawn. Below 100% a line along each region's edge stays solid.\n");
        bdBox.title = what + "Drag or wheel: Change it. With an image connected the canvas keeps its own value.";
        opBtn.title = what + "Point here: The slider drops down. A click keeps it open.\nWheel: Change it. With an image connected the canvas keeps its own value.";
    }
    E.syncOpacity = syncOpacity;
    const opacityFromY = (y) => {
        const r = bdBox.getBoundingClientRect(), f = (y - r.top) / Math.max(1, r.height);
        E.setFill((O_BOT - f) / (O_BOT - O_TOP));
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
    opBox.addEventListener("wheel", (e) => {
        e.preventDefault(); e.stopPropagation();
        E.setFill(E.fillNow() + (e.deltaY < 0 ? 0.05 : -0.05));
        syncOpacity(); E.requestDraw();
    }, { passive: false });
    syncOpacity();
    E.node.properties = E.node.properties || {};
    if (E.node.properties.rg_labels === undefined) E.node.properties.rg_labels = true;
    const labBtn = iconBtn("eye", "", () => {
        E.node.properties.rg_labels = E.node.properties.rg_labels === false;
        setLabIcon(); E.requestDraw();
    }, "toggle");
    E.labBtn = labBtn;
    function setLabIcon() {
        const on = E.node.properties.rg_labels !== false;
        setHTML(labBtn, svgIcon(on ? "eye" : "eyeOff"));
        labBtn.classList.toggle("on", on);
        labBtn.title = on ? "Labels on: Each region's number and prompt are shown on the canvas (click to hide)"
            : "Labels off: Click to show each region's number and prompt on the canvas";
    }
    setLabIcon();
    // (round 40: the canvas size was repeated here; the size row at the top of the node shows it, from the same E.dims())
    const barGap = E.el("span", "rg-bargap"); E.barGap = barGap; barGap.style.marginLeft = "auto";
    // Clear all sits at the right end, away from the tools and from Undo / Redo (it looks like a layer's delete button)
    // (round 99: the Large editor's button goes between the gap and Clear all, with a separator: big.js)
    const endSep = sep(); E.barEndSep = endSep;
    bar1.append(sep(), undoBtn, redoBtn, sep(), snapBtn, fitBtn, labBtn, barGap, endSep, clearBtn);
}
