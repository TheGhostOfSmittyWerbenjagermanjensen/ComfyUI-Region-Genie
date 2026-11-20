// The brush size slider on the canvas, the list header's options (keep apart, edit mask), sub-sections and the list height.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { app } from "../../../scripts/app.js";
import { svgIcon, setHTML, contextMenu, editMaskDefaults, getSetting, SET, hintsListeners } from "../rg_shared.js";
import { UNSPEC, LASSO_MODES } from "./shared.js";
import { keyed, keyText } from "../rg_keys.js";
import { normLoraOpts, normEditMask } from "./state.js";

export function* canvasUi(E) {
    Object.assign(E, {
        updateBrushSlider, setAllApartBtn, syncEditMaskBox, syncTips,
    });
    yield;

    // ---- hints on the canvas (Settings > Region Genie > Canvas tools > Hints on the canvas): the active tool's
    // gestures along the bottom edge, and the first steps while the canvas is empty. Neither takes clicks; the
    // gestures fade while a button is held on the canvas, so they never cover what is being drawn.
    const tips = E.el("div", "rg-tips"), startCard = E.el("div", "rg-start");
    const setStartCard = () => { startCard.innerHTML = "<b>Start here</b>"
        + keyed("<span><i>1</i>Pick a shape (R) and drag a box on the canvas: that is your first region.</span>")
        + "<span><i>2</i>Type what belongs there in the region's prompt, in the list under the canvas.</span>"
        + "<span><i>3</i>Connect model and clip, send positive, negative and latent to the sampler, and run.</span>"
        + "<span class=\"more\">More regions: The ▢＋ button under the canvas. Every button explains itself when you point at it.</span>"; };
    setStartCard(); E.setStartCard = setStartCard;
    E.cvBox.append(tips, startCard);
    // The keys come from the shortcut table (rg_keys.js), so the hints show the user's own; an entry whose key was
    // taken away is left out ([null, …]).
    const K = keyText, first = (id) => keyText(id).split(" / ")[0];
    const join = (...ids) => { const ks = ids.map(first); return ks.every(Boolean) ? ks.join(" / ") : null; };
    const arrows = () => (["left", "up", "right", "down"].map((d) => first("nudge." + d)).join("") === "←↑→↓" ? "Arrows" : join("nudge.left", "nudge.up", "nudge.right", "nudge.down"));
    const ccp = () => (join("edit.copy", "edit.cut", "edit.paste") === "Ctrl+C / Ctrl+X / Ctrl+V" ? "Ctrl+C / X / V" : join("edit.copy", "edit.cut", "edit.paste"));
    const size = () => { const a = first("brush.smaller"), b = first("brush.larger"); return a && b ? `${a} ${b} or Alt+wheel` : "Alt+wheel"; };
    const VIEW_TIPS = () => [["Wheel", "Zoom"], [first("view.pan") && `${first("view.pan")}+drag`, "Pan"]];
    const PICK_TIP = ["Alt+click", "Make the region under the pointer the active one"];
    const LASSO_TIPS = () => [["Drag", "Freehand"], ["Click", "Add a point"], [K("draw.accept") ? `${first("draw.accept")} / double-click` : "Double-click", "Close the outline"],
        [first("draw.back"), "Remove the last point"], [first("draw.cancel"), "Cancel"]];
    const TIPS = {
        select: () => (E.selLayer()
            ? [["Drag", "Move"], ["Square handles", "Resize (Shift: Keep proportions, Alt: From the centre)"], ["Round handle", "Rotate (Shift: 15° steps)"],
               [arrows(), "Nudge (Shift: ×10)"], [first("edit.duplicate"), "Duplicate"], [ccp(), "Copy, cut, paste"]]
            : [["Click", "Select a layer"], ["Double-click a label", "Edit that region"], ...VIEW_TIPS(), [first("view.fit"), "Fit"]]),
        shape: () => [["Drag", "Draw the shape"], ["Shift", "Equal sides"], ["Alt", "From the centre"], ["▾ on the button", "Other shapes"]],
        brush: () => [["Drag", "Paint"], ["Shift+click", "A straight line from the last stroke"], [size(), "Brush size"], PICK_TIP],
        lasso: () => [...LASSO_TIPS(), PICK_TIP],
        lassoErase: () => LASSO_TIPS(),
        fill: () => (["linear", "radial"].includes(LASSO_MODES.fill)
            ? [["Drag", LASSO_MODES.fill === "linear" ? "From full strength to nothing, along the line" : "Outward from full strength to nothing"], PICK_TIP]
            : [["Click", "Fill that area with the active region"], PICK_TIP]),
        wand: () => [["Click", "Add the area of similar color to the active region"], PICK_TIP],
        object: () => [["Click", "The object"], ["Ctrl+click", "Take that spot out of the selection"], ["Drag", "A box around it"], [first("draw.accept"), "Add the selection"],
                       ["Shift+click", "Add it and start the next"], [first("draw.back"), "Remove the last point"], [first("draw.cancel"), "Discard"]],
        erase: () => [["Drag", "Erase from the selected layer"], ["Shift+click", "A straight line from the last stroke"], [size(), "Eraser size"]],
    };
    let tipsShown = null;
    function syncTips() {
        const on = getSetting(SET.toolHints, true) !== false;
        const empty = on && !E.state.layers.length && !E.state.regions.length && E.modeW?.value !== "use as color map";
        const list = on ? (TIPS[E.tool]?.() || []).filter((t) => t[0]) : [];
        const key = `${empty}|${list.map((t) => t.join(":")).join("|")}`;
        if (key === tipsShown) return;
        tipsShown = key;
        startCard.style.display = empty ? "" : "none";
        tips.style.display = list.length ? "" : "none";
        tips.replaceChildren(...list.map(([k, text]) => {
            const s = E.el("span"), b = E.el("b"); b.textContent = k; s.append(b, " " + text); return s;
        }));
    }
    hintsListeners.add(syncTips);
    E.cv.addEventListener("pointerdown", () => E.cvBox.classList.add("held"));
    E.tipsRelease = () => E.cvBox.classList.remove("held");
    for (const ev of ["pointerup", "pointercancel"]) window.addEventListener(ev, E.tipsRelease, true);      // capture: the canvas keeps its own events from bubbling

    // ---- brush size: vertical slider over the left edge of the canvas (brush and eraser tools)
    const BMIN = 0.002, BMAX = 0.3;
    const bSlider = E.el("div", "rg-bslider"); E.bSlider = bSlider; bSlider.style.display = "none";
    bSlider.innerHTML = '<svg viewBox="0 0 30 190" preserveAspectRatio="none">'
        + '<circle cx="15" cy="9" r="7.5" fill="rgba(240,240,240,.85)" stroke="#111" stroke-width="1"/>'
        + '<polygon points="7,22 23,22 17,168 13,168" fill="rgba(240,240,240,.55)" stroke="#111" stroke-width="1"/>'
        + '<circle cx="15" cy="180" r="2.6" fill="rgba(240,240,240,.85)" stroke="#111" stroke-width="1"/></svg>';
    const bHandle = E.el("div", "rg-bhandle");
    bSlider.appendChild(bHandle);
    const bTip = E.el("div", "rg-btip");
    E.cvBox.append(bSlider, bTip);
    const TRACK_TOP = 22 / 190, TRACK_BOT = 168 / 190;          // fractions of the slider height
    const brushToT = (b) => Math.log(b / BMIN) / Math.log(BMAX / BMIN);          // 0 small .. 1 large
    function updateBrushSlider() {
        const t = Math.min(1, Math.max(0, brushToT(E.brush)));
        bHandle.style.top = `${(TRACK_BOT - t * (TRACK_BOT - TRACK_TOP)) * 100}%`;
        bTip.textContent = `Brush size: ${Math.max(1, Math.round(E.brush * Math.min(...E.dims())))} px  (drag, [ ] or Alt+wheel)`;
    }
    function brushFromY(clientY) {
        const r = bSlider.getBoundingClientRect();
        const f = (clientY - r.top) / Math.max(1, r.height);
        const t = Math.min(1, Math.max(0, (TRACK_BOT - f) / (TRACK_BOT - TRACK_TOP)));
        E.brush = BMIN * Math.pow(BMAX / BMIN, t);
        updateBrushSlider(); E.requestDraw();
    }
    let bTipTimer = 0, bDrag = false;
    const hideBTip = () => { clearTimeout(bTipTimer); bTip.style.display = "none"; }; E.hideBTip = hideBTip;
    bSlider.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        bDrag = true; bSlider.classList.add("drag"); hideBTip();
        try { bSlider.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        brushFromY(e.clientY);
    });
    bSlider.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        if (bDrag) { brushFromY(e.clientY); return; }
        hideBTip();                                       // tooltip only after the pointer rests
        bTipTimer = setTimeout(() => {
            if (bDrag) return;
            const r = bSlider.getBoundingClientRect(), br = E.cvBox.getBoundingClientRect();
            bTip.style.top = `${e.clientY - br.top - 10}px`;
            bTip.style.left = `${r.right - br.left + 6}px`;
            bTip.style.display = "block";
        }, 650);
    });
    const endBDrag = (e) => {
        if (!bDrag) return;
        bDrag = false; bSlider.classList.remove("drag");
        try { bSlider.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    };
    bSlider.addEventListener("pointerup", endBDrag);
    bSlider.addEventListener("pointercancel", endBDrag);
    bSlider.addEventListener("pointerleave", hideBTip);
    for (const ev of ["mousedown", "mouseup", "click", "dblclick", "contextmenu"]) bSlider.addEventListener(ev, (e) => e.stopPropagation());
    bSlider.addEventListener("wheel", (e) => {
        e.preventDefault(); e.stopPropagation(); hideBTip();
        E.brush = Math.min(BMAX, Math.max(BMIN, E.brush * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        updateBrushSlider(); E.requestDraw();
    }, { passive: false });
    const comp = document.createElement("canvas"), cctx = comp.getContext("2d"); E.comp = comp; E.cctx = cctx;
    const scratch = document.createElement("canvas"), sctx = scratch.getContext("2d"); E.scratch = scratch; E.sctx = sctx;
    const hit = document.createElement("canvas"); hit.width = hit.height = 1;
    const hctx = hit.getContext("2d", { willReadFrequently: true }); E.hctx = hctx;

    // bottom: one tree: regions, each with its LoRAs and (expandable) layers
    const tree = E.el("div", "rg-tree"); E.tree = tree;
    const treeHead = E.el("div", "rg-head");
    const treeTitle = E.el("span"); treeTitle.textContent = "Regions";
    const addRegionBtn = E.btn("", "Add a region with a new color (it goes on top)", () => {
        E.change(() => { const r = E.newRegion(); E.selId = null; E.activateRegion(r.id); });
        E.shapeKind = "rect";
        E.setTool("shape");                          // the next thing to do is usually drawing its box
        setTimeout(() => regList.querySelector(`textarea[data-rid="${E.curRegion}"]`)?.focus(), 0);
    });
    E.addRegionBtn = addRegionBtn;
    // show / hide one kind of subsection (layers, LoRAs, palettes) in every region at once, or everything
    // + Layer: an empty layer on top of the active region's layers (then paint, lasso or fill into it)
    const addLayerBtn = E.btn("", "Add an empty layer on top of the active region's layers; brush, lasso and fill then go into it", () => {
        const rid = E.curRegion;
        if (rid == null || (rid !== UNSPEC && !E.regionById(rid))) { E.hint("Select a region first"); return; }
        E.change(() => { const L = E.newPaintLayer(rid); L.name = `${rid === UNSPEC ? "Hole" : "Layer"} ${L.id}`; E.addLayer(L); });
        openSub(rid, "layers");
        E.refreshUI();
    });
    for (const [b, ic] of [[addRegionBtn, "regionAdd"], [addLayerBtn, "layerAdd"]]) { b.innerHTML = svgIcon(ic); b.classList.add("icon"); }
    const expandBtns = {
        layers: E.btn("▼ Layers", "Show or hide the layers of every region", () => E.toggleKind("layers")),
        loras: E.btn("▼ LoRAs", "Show or hide the LoRAs of every region (and of the whole image)", () => E.toggleKind("loras")),
        palette: E.btn("▼ Color Palettes", "Show or hide the color palettes of every region", () => E.toggleKind("palette")),
        all: E.btn("▼ All", "Show or hide everything in the list", () => E.toggleKind("all")),
    }; E.expandBtns = expandBtns;
    const statusLbl = E.el("span", "rg-hint"); E.statusLbl = statusLbl;
    const loraOptsBox = E.el("span", "rg-loraopts");
    const sepIn = E.el("input", "rg-num"); E.sepIn = sepIn; sepIn.type = "number"; sepIn.min = "0"; sepIn.max = "1"; sepIn.step = "0.05";
    sepIn.title = "LoRA region separation: How much attention between the image of different LoRA regions is removed "
        + "(MOSS-Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5; model output). Higher keeps each LoRA's style in its region; 1 = fully separate.";
    const untilIn = E.el("input", "rg-num"); E.untilIn = untilIn; untilIn.type = "number"; untilIn.min = "0"; untilIn.max = "1"; untilIn.step = "0.05";
    untilIn.title = "Apply the separation for this fraction of the steps; the rest blends the seams. "
        + "0.1-0.5 with separation 0.85-0.99 works well.";
    const optChange = () => E.change(() => {
        E.state.loraOpts = normLoraOpts({ ...normLoraOpts(E.state.loraOpts), separation: sepIn.value, until: untilIn.value });
    });
    // keep all regions apart (not only those with LoRAs)
    const allApartBtn = E.btn("", "", () => {
        // a real switch of what the button shows: on (set here, or by itself in the last run) -> off for this node,
        // also where a run would turn it on by itself; off -> on
        E.change(() => {
            const o = normLoraOpts(E.state.loraOpts), shown = !!o.allRegions || (E.autoApart && !o.autoOff);
            E.state.loraOpts = normLoraOpts({ ...o, allRegions: !shown, autoOff: shown });
        });
        E.refreshUI();
    });
    allApartBtn.classList.add("mixed", "toggle", "variants", "rg-apart");
    // right-click: the two choices as check items (keep all regions apart / share the background)
    allApartBtn.addEventListener("pointerdown", (e) => { if (e.button === 2) e.stopPropagation(); });
    allApartBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault(); e.stopPropagation();
        const o = normLoraOpts(E.state.loraOpts);
        const mark = (on) => (on ? "✓ " : " ");
        const items = [
            { content: mark(o.allRegions) + "Keep all regions apart", v: "all" },
            { content: mark(!o.allRegions && !o.autoOff) + "Automatic (as set in Settings)", v: "auto" },
            { content: mark(o.autoOff) + "Off for this node", v: "off" },
            { content: mark(o.shareBg) + "Share the background", v: "bg" },
        ];
        contextMenu(e, items, "Keep regions apart", (v) => {
            const set = { all: (c) => ({ allRegions: !c.allRegions, autoOff: false }), auto: () => ({ allRegions: false, autoOff: false }),
                          off: () => ({ allRegions: false, autoOff: true }), bg: (c) => ({ shareBg: !c.shareBg }) }[v?.v];
            if (set) {
                E.change(() => { const c = normLoraOpts(E.state.loraOpts); E.state.loraOpts = normLoraOpts({ ...c, ...set(c) }); });
                E.refreshUI();
            }
            E.focusSink();
        });
    });
    let allApartShown = null;
    E.autoApart = false;          // the last run turned it on by itself (a model without a layout format, region prompts)
    function setAllApartBtn() {
        const opts = normLoraOpts(E.state.loraOpts);
        const own = !!opts.allRegions, auto = E.autoApart && !opts.autoOff, on = own || auto, shared = !!opts.shareBg;
        const key = `${own}|${auto}|${!!opts.autoOff}|${shared}`;
        if (allApartShown === key) return;
        allApartShown = key;
        setHTML(allApartBtn, svgIcon(shared ? "allApartShared" : "allApart") + "<span>apart</span>");
        allApartBtn.classList.toggle("on", on);
        allApartBtn.title = (own ? "Keep all regions apart: ON."
            : auto ? "Keep all regions apart: ON automatically in the last run."
            : opts.autoOff ? "Keep all regions apart: OFF for this node."
            : "Keep all regions apart: OFF.")
            + "\nOn: Every region, with or without LoRAs, is kept apart from the others and from the background for "
            + "the first part of sampling ('until', at 'separation'), and each region's prompt reaches only its region. "
            + "This is what places region prompts with Krea 2, Flux, Anima and SDXL / SD1.5. Needs the model on 'model'; "
            + "sampling is a little slower and uses more VRAM.\n"
            + "Off: Only regions with LoRAs are kept apart.\n"
            + "Automatic (default): A run turns it on for a model without a layout format when a region has a prompt "
            + "(Settings > Region Genie > Region Genie node > '… keep all regions apart automatically').\n"
            + (shared ? "Share the background: ON. The regions are kept apart from each other only, so lighting, "
                + "perspective and setting stay one picture.\n"
                : "Share the background: OFF. The regions are kept apart from the background too.\n")
            + "Click: Switch what the button shows, for this node.\n"
            + "Right-click: Keep all regions apart, Automatic, Off for this node, Share the background.";
    }
    sepIn.addEventListener("change", optChange); untilIn.addEventListener("change", optChange);
    for (const i of [sepIn, untilIn]) i.addEventListener("keydown", (e) => e.stopPropagation());
    const sepLbl = E.el("span", "rg-hint"); E.sepLbl = sepLbl; sepLbl.textContent = "separation"; sepLbl.title = sepIn.title;
    const untilLbl = E.el("span", "rg-hint"); E.untilLbl = untilLbl; untilLbl.textContent = "until"; untilLbl.title = untilIn.title;
    loraOptsBox.append(sepLbl, sepIn, untilLbl, untilIn);
    // Edit Mode: the edit mask's own grow / feather (px), shown at the start of this group in Edit Mode only.
    // An empty field follows Settings > Region Genie > Edit Mode (its value shows greyed in the field).
    const editMaskBox = E.el("span", "rg-editmask");
    const MASK_TIPS = {
        grow: "Edit mask grow (px): The area the sampler may change in Edit Mode grows this far past the regions "
            + "set to change, so the edit blends into its surroundings; negative shrinks it. Kept regions are never "
            + "grown into. Separate from each region's own feather (which is for 'masks' and LoRAs).\nEmpty: The "
            + "Settings default (Settings > Region Genie > Edit Mode), shown greyed.",
        feather: "Edit mask feather (px): Softens the edge of the area the sampler may change in Edit Mode (after "
            + "growing). Separate from each region's own feather.\nEmpty: The Settings default (Settings > Region "
            + "Genie > Edit Mode), shown greyed.",
    };
    const maskIn = (key, icon, min, max) => {
        const ic = E.el("span", "rg-fico"); ic.innerHTML = svgIcon(icon); ic.title = MASK_TIPS[key];
        const inp = E.el("input", "rg-num"); inp.type = "number"; inp.min = String(min); inp.max = String(max); inp.step = "1";
        inp.title = MASK_TIPS[key];
        inp.addEventListener("keydown", (e) => e.stopPropagation());
        inp.addEventListener("change", () => {
            const raw = inp.value.trim();
            E.change(() => {
                const m = { ...(E.state.editMask || {}) };
                if (raw === "" || !Number.isFinite(+raw)) delete m[key]; else m[key] = +raw;
                const n = normEditMask(m);
                if (n && Object.keys(n).length) E.state.editMask = n; else delete E.state.editMask;
            });
        });
        editMaskBox.append(ic, inp);
        return inp;
    };
    const growIn = maskIn("grow", "maskGrow", -256, 256), maskFeatherIn = maskIn("feather", "feather", 0, 256);
    function syncEditMaskBox() {
        const d = editMaskDefaults(), m = E.state.editMask || {};
        for (const [inp, key] of [[growIn, "grow"], [maskFeatherIn, "feather"]]) {
            if (inp.placeholder !== String(d[key])) inp.placeholder = String(d[key]);
            const v = m[key] != null ? String(m[key]) : "";
            if (document.activeElement !== inp && inp.value !== v) inp.value = v;
        }
        const show = E.isEdit() ? "" : "none";
        if (editMaskBox.style.display !== show) editMaskBox.style.display = show;
    }
    loraOptsBox.prepend(editMaskBox);
    treeHead.append(treeTitle, addRegionBtn, addLayerBtn, expandBtns.layers, expandBtns.loras, expandBtns.palette, expandBtns.all,
                    statusLbl, loraOptsBox);
    loraOptsBox.append(allApartBtn);           // always at the right end; the number fields come and go
    const regList = E.el("div", "rg-list"); E.regList = regList;
    tree.append(treeHead, regList);
    // the list's open / closed parts (UI only): a region (or the whole-image row, or Unspecified) is open,
    // and inside an open region each subsection (layers, LoRAs, palette) is open on its own
    const SCENE = "scene"; E.SCENE = SCENE;
    const expanded = new Set(); E.expanded = expanded;                  // open rows: region ids, UNSPEC, SCENE
    const subOpen = new Set(); E.subOpen = subOpen;                   // `${rid}:layers` | `${rid}:loras` | `${rid}:palette`
    const openSub = (rid, kind) => { expanded.add(rid); subOpen.add(`${rid}:${kind}`); }; E.openSub = openSub;

    // the divider between the canvas and the Regions list: dragging moves room between them (the node keeps its
    // size); the list's height is this node's (node.properties.rg_list_h); double-click: the usual 220 px
    const LIST_H = 220, LIST_MIN = 90, CV_MIN = 120; E.CV_MIN = CV_MIN;
    const split = E.el("div", "rg-split"); E.split = split;
    split.title = "Drag: More room for the canvas or for the Regions list (this node keeps its size).\nDouble-click: The usual height.";
    const applyListH = () => {
        const h = Math.round(+E.node.properties?.rg_list_h || LIST_H);
        const want = Math.max(LIST_MIN, h) + "px";
        if (tree.style.height !== want) tree.style.height = want;
    }; E.applyListH = applyListH;
    split.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const k = E.wrap.offsetHeight / Math.max(1, E.wrap.getBoundingClientRect().height);   // screen px -> CSS px (graph zoom)
        const y0 = e.clientY, h0 = tree.offsetHeight, room = h0 + E.cvBox.offsetHeight - CV_MIN;
        E.cvBox.style.minHeight = CV_MIN + "px";
        split.setPointerCapture?.(e.pointerId);
        split.classList.add("drag");
        const move = (ev) => {
            E.node.properties = E.node.properties || {};
            E.node.properties.rg_list_h = Math.round(Math.max(LIST_MIN, Math.min(room, h0 - (ev.clientY - y0) * k)));
            applyListH();
        };
        const up = () => {
            split.classList.remove("drag");
            split.removeEventListener("pointermove", move); split.removeEventListener("pointerup", up); split.removeEventListener("pointercancel", up);
            app.graph?.change?.();
        };
        split.addEventListener("pointermove", move); split.addEventListener("pointerup", up); split.addEventListener("pointercancel", up);
    });
    split.addEventListener("dblclick", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (E.node.properties) delete E.node.properties.rg_list_h;
        E.cvBox.style.minHeight = "";
        applyListH(); app.graph?.change?.();
    });
    for (const ev of ["mousedown", "click"]) split.addEventListener(ev, (e) => e.stopPropagation());
    if (E.node.properties?.rg_list_h) E.cvBox.style.minHeight = CV_MIN + "px";
    applyListH();
    E.wrap.style.position = "relative";
    E.wrap.append(E.keySink, E.bar1, E.banner, E.cvBox, E.msgBar, split, tree, E.foot);
    const domW = E.node.addDOMWidget("color_map_canvas", "ColorMapCanvas", E.wrap, {
        serialize: false, hideOnZoom: false, getMinHeight: () => 620,
    }); E.domW = domW;
    domW.serialize = false;
}
