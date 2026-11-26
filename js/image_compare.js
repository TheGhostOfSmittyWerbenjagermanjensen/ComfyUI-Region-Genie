// Image Compare (Region Genie): two or more pictures in one node (round 93; image_compare.py sends them).
//
// What the owner decided on the mock-up:
// - A slider only: while the pointer is on the picture, the picture BEFORE the chosen one is left of the pointer and
//   the chosen one right of it; off the picture, the chosen one shows whole (so flipping with the keys is the
//   "single" view, and no second mode is needed).
// - The keys, while the pointer is over the node: 1-9 on the number row or the numpad choose a picture, the arrow
//   keys the one before / after.
// - The LAST picture (the highest number) is the chosen one to start with: four pictures show "3 | 4", two "1 | 2".
// - Picture 1 has the LAST picture on its left (around the corner); a button on the node turns that off (picture 1
//   then shows alone). With two pictures that means: 2 chosen is "1 | 2", 1 chosen is "2 | 1".
// - The keys: 1-9 are fixed; the two that step (the arrows) are the user's, in the pack's shortcut list under its
//   own section "Image Compare node" (rg_keys.js, ctx "compare"), so they can be the same keys as the editor's.
// - After every run the last picture is the chosen one.
// - Round 95: the keys act while the pointer is anywhere over the node (title and inputs too); the wheel over the
//   node's picture zooms ComfyUI's graph as it does anywhere else (to look closer, zoom the graph); a Large view
//   (a window over ComfyUI, as the Region Genie node has) where the wheel zooms into the pictures, never further out
//   than the picture fitting its frame, and a drag moves them.
// - Number labels on the picture, with a button to hide them.
// - Every image of a batch is a picture of its own, in input order.
// - A picture can be hidden from the comparison (right-click its number): its neighbours are then compared
//   directly, without rewiring. Hidden pictures keep their numbers.
// Inputs: image_1, image_2, …; a free one is kept after the last connected one.
// Saved with the node (properties.rg_compare): which pictures are hidden, the two buttons. The pictures themselves
// are the last run's, like ComfyUI's own preview.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { svgIcon } from "./rg_shared.js";
import { keyIs, keyText, SHORTCUTS_EVENT } from "./rg_keys.js";

const NODE = "Region-Genie_ImageCompare";
const MAX_ZOOM = 32;
const CSS = `
.rg-ic { display:flex; flex-direction:column; gap:4px; width:100%; height:100%; min-height:0; box-sizing:border-box; padding:0 2px 2px;
  font:12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--input-text,#ddd); outline:none; }
.rg-ic-bar { display:flex; align-items:flex-start; gap:6px; flex:0 0 auto; }
.rg-ic-chips { display:flex; flex-wrap:wrap; gap:3px; flex:1 1 auto; min-width:0; }
.rg-ic button { box-sizing:border-box; height:20px; min-width:22px; margin:0; padding:0 4px; border:1px solid var(--border-color,#555); border-radius:4px;
  background:var(--comfy-input-bg,#222); color:inherit; font:inherit; font-variant-numeric:tabular-nums; cursor:pointer; line-height:18px; }
.rg-ic button:hover { border-color:var(--rg-accent,#5b8fd0); }
.rg-ic button.cur { background:var(--rg-accent-fill,#3a6ea5); border-color:var(--rg-accent,#5b8fd0); color:#fff; }
.rg-ic button.prev { border-color:var(--rg-on,#d9a441); color:var(--rg-on,#d9a441); }
.rg-ic button.hid { opacity:.45; text-decoration:line-through; }
.rg-ic-opts { display:flex; align-items:center; gap:3px; flex:0 0 auto; }
.rg-ic-opts button { display:flex; align-items:center; justify-content:center; width:22px; padding:0; }
.rg-ic-opts button svg { width:14px; height:14px; display:block; }
.rg-ic-opts button.on { background:var(--rg-accent-fill,#3a6ea5); border-color:var(--rg-accent,#5b8fd0); color:#fff; }
.rg-ic-opts button.rg-ic-bigbtn:hover { background:var(--rg-accent-fill,#3a6ea5); border-color:var(--rg-accent,#5b8fd0); color:#fff; }
.rg-ic-zoom { min-width:44px; text-align:right; font-variant-numeric:tabular-nums; opacity:.75; }
.rg-ic-view { position:relative; flex:1 1 auto; min-height:60px; border-radius:4px; overflow:hidden; background:#000; cursor:ew-resize; user-select:none; touch-action:none; }
.rg-ic-stage { position:absolute; inset:0; transform-origin:0 0; pointer-events:none; }
.rg-ic-view img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; display:block; pointer-events:none; -webkit-user-drag:none; }
.rg-ic-view.sharp img { image-rendering:pixelated; }
.rg-ic-line { position:absolute; top:0; bottom:0; width:2px; margin-left:-1px; background:#fff; box-shadow:0 0 0 1px rgba(0,0,0,.45); pointer-events:none; }
.rg-ic-tag { position:absolute; top:6px; padding:0 7px; border-radius:4px; background:rgba(0,0,0,.62); color:#fff; font-weight:650; font-size:12px; line-height:18px;
  font-variant-numeric:tabular-nums; pointer-events:none; }
.rg-ic-tag.l { left:6px; } .rg-ic-tag.r { right:6px; }
.rg-ic-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:10px; text-align:center; color:#9aa1ad; cursor:default; }
.rg-ic [hidden] { display:none !important; }
.rg-ic-big { position:fixed; inset:0; z-index:9000; box-sizing:border-box; padding:2vh 2vw; display:flex; background:rgba(0,0,0,.55); }
.rg-ic-big > .rg-ic { padding:8px; gap:6px; border-radius:8px; background:var(--comfy-menu-bg,#2b2b2b); border:1px solid var(--rg-accent,#5b8fd0); box-shadow:0 8px 28px rgba(0,0,0,.55); font-size:13px; }
.rg-ic-big .rg-ic button { height:24px; min-width:26px; line-height:22px; }
.rg-ic-big .rg-ic-opts button { width:26px; }
.rg-ic-big .rg-ic-opts button svg { width:16px; height:16px; }
.rg-ic-big .rg-ic-view.zoomed { cursor:grab; } .rg-ic-big .rg-ic-view.panning { cursor:grabbing; }`;

// ---- which Image Compare node gets the keys: the one whose Large view is open, else the one the pointer is over,
// anywhere on it (its title and inputs too)
let bigNode = null, px = -1, py = -1;
const isCompare = (n) => (n && n.__rgCompare && n.graph ? n : null);
function nodeUnderPointer() {
    if (bigNode) return isCompare(bigNode);
    const at = document.elementFromPoint(px, py);
    if (!at) return null;
    const own = at.closest?.(".rg-ic");
    if (own?.__rgNode) return isCompare(own.__rgNode);
    const graph = app.canvas?.graph || app.graph;
    const vue = at.closest?.("[data-node-id]");                       // Nodes 2.0: the node is an element
    if (vue) return isCompare(graph?.getNodeById?.(+vue.dataset.nodeId) || graph?.getNodeById?.(vue.dataset.nodeId));
    const cv = app.canvas?.canvas;
    if (cv && at === cv) {                                            // legacy: the node is drawn on the graph's canvas
        const r = cv.getBoundingClientRect(), ds = app.canvas.ds;
        return isCompare(graph?.getNodeOnPos?.((px - r.left) / ds.scale - ds.offset[0], (py - r.top) / ds.scale - ds.offset[1]));
    }
    return null;
}
function onKey(e) {
    const node = nodeUnderPointer(), c = node?.__rgCompare;
    if (!c) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    let used = false;
    if (keyIs(e, "compare.big")) { c.toggleBig(); used = true; }
    else if (bigNode && e.key === "Escape") { c.closeBig(); used = true; }
    else if (e.ctrlKey || e.altKey || e.metaKey) return;
    // the stepping keys are the user's (the shortcut list, section "Image Compare node"); a key given to them comes
    // before the numbers. The numbers: the number row and the numpad, by the key's place (so with Num Lock off too)
    else if (keyIs(e, "compare.prev")) used = c.step(-1);
    else if (keyIs(e, "compare.next")) used = c.step(1);
    else { const d = +(/^(?:Digit|Numpad)([1-9])$/.exec(e.code || "")?.[1] || (/^[1-9]$/.test(e.key) ? e.key : 0)); if (d && !e.shiftKey) used = c.choose(d); }
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
}
// the wheel over the node's picture zooms ComfyUI's graph, as it does over any other part of a node. Where ComfyUI
// already does that by itself (the event reaches its own handler) nothing is added: only when the view did not change
function wheelToGraph(e) {
    const c = app.canvas, cv = c?.canvas, ds = c?.ds;
    if (!cv || !ds) return;
    const before = `${ds.scale}|${ds.offset[0]}|${ds.offset[1]}`;
    const copy = { deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
                   ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true };
    setTimeout(() => { if (`${ds.scale}|${ds.offset[0]}|${ds.offset[1]}` === before) cv.dispatchEvent(new WheelEvent("wheel", copy)); }, 0);
}

// a middle-button drag over the node moves ComfyUI's graph, as it does over any other part of a node. As with the
// wheel: where ComfyUI already does it by itself nothing is added. When the first movement did not move the graph,
// the press is handed to the graph's canvas (at the place it happened), and the canvas follows the pointer from there
function middleToGraph(e) {
    if (e.button !== 1) return;
    const c = app.canvas, cv = c?.canvas, ds = c?.ds;
    if (!cv || !ds) return;
    e.preventDefault();                                              // no autoscroll of the browser
    const before = `${ds.offset[0]}|${ds.offset[1]}`, at = { x: e.clientX, y: e.clientY };
    const init = { clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, button: 1, buttons: 4, pointerId: e.pointerId, pointerType: e.pointerType || "mouse",
                   isPrimary: true, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true };
    const onMove = (m) => {
        if (Math.hypot(m.clientX - at.x, m.clientY - at.y) < 3) return;
        stop();
        if (`${ds.offset[0]}|${ds.offset[1]}` !== before) return;    // ComfyUI is already moving the graph
        cv.dispatchEvent(new PointerEvent("pointerdown", init));
        cv.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: m.clientX, clientY: m.clientY, button: -1 }));
    };
    const stop = () => { window.removeEventListener("pointermove", onMove, true); window.removeEventListener("pointerup", stop, true); };
    window.addEventListener("pointermove", onMove, true); window.addEventListener("pointerup", stop, true);
}

function setup(node) {
    const P = () => { node.properties = node.properties || {}; const p = (node.properties.rg_compare = node.properties.rg_compare || {});
        if (!Array.isArray(p.hidden)) p.hidden = []; if (p.wrap === undefined) p.wrap = true; if (p.labels === undefined) p.labels = true; return p; };
    const st = { pics: [], cur: 0 };
    const uis = [];                                // the node's own bar and picture, and the Large view's while it is open
    let big = null;                                // { ov, ui }
    const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    const shown = () => st.pics.map((_, i) => i + 1).filter((n) => !P().hidden.includes(n));
    // the picture left of the pointer: the shown one before the chosen one; before the first: the last (unless that is off)
    const prevOf = (n) => { const v = shown(), k = v.indexOf(n); return k > 0 ? v[k - 1] : k === 0 && P().wrap && v.length > 1 ? v[v.length - 1] : 0; };
    function settle() {                            // the chosen picture is always a shown one
        const v = shown();
        if (!v.includes(st.cur)) st.cur = v.find((n) => n > st.cur) || v[v.length - 1] || 0;
    }
    const draw = () => { for (const u of uis) u.draw(); };
    const build = () => { settle(); for (const u of uis) u.build(); draw(); };
    function toggleHidden(n) {
        const h = P().hidden, k = h.indexOf(n);
        if (k >= 0) h.splice(k, 1);
        else if (shown().length > 1) h.push(n);    // the last shown picture stays
        settle(); draw();
    }
    const pick = (n) => { const h = P().hidden, k = h.indexOf(n); if (k >= 0) h.splice(k, 1); st.cur = n; draw(); };
    function setPics(list) {
        st.pics = list;
        P().hidden = P().hidden.filter((n) => n <= list.length);
        // after every run: the last picture (the highest number that is shown), so the newest result shows and the one
        // before it is on its left (the owner's choice, round 94: also when a run brings as many pictures as the last)
        { const v = shown(); st.cur = v[v.length - 1] || 0; }
        for (const u of uis) u.reset();
        build();
    }
    const choose = (n) => { if (n > st.pics.length || P().hidden.includes(n)) return false; st.cur = n; draw(); return true; };
    const step = (d) => { const v = shown(); if (v.length < 2) return false; const k = v.indexOf(st.cur); st.cur = v[(k + d + v.length) % v.length]; draw(); return true; };

    // one bar and one picture. isBig: the Large view's (the wheel zooms the pictures, a drag moves them)
    function makeUI(isBig) {
        const wrap = el("div", "rg-ic"), bar = el("div", "rg-ic-bar"), chips = el("div", "rg-ic-chips"), opts = el("div", "rg-ic-opts"), view = el("div", "rg-ic-view");
        const stage = el("div", "rg-ic-stage"), imgR = el("img"), imgL = el("img"), line = el("div", "rg-ic-line"), tagL = el("span", "rg-ic-tag l"), tagR = el("span", "rg-ic-tag r"), empty = el("div", "rg-ic-empty");
        imgR.alt = ""; imgL.alt = ""; imgR.draggable = false; imgL.draggable = false;
        const wrapBtn = el("button"), tagBtn = el("button"), bigBtn = el("button", "rg-ic-bigbtn"), zoomLbl = el("span", "rg-ic-zoom");
        for (const [b, ic] of [[wrapBtn, "repeat"], [tagBtn, "hash"], [bigBtn, "expand"]]) { b.type = "button"; b.innerHTML = svgIcon(ic); }
        opts.append(...(isBig ? [zoomLbl] : []), wrapBtn, tagBtn, bigBtn); bar.append(chips, opts); stage.append(imgR, imgL); view.append(stage, line, tagL, tagR, empty); wrap.append(bar, view);
        wrap.__rgNode = node;
        const u = { wrap, view, isBig, x: 0.5, over: false, z: 1, tx: 0, ty: 0 };
        // the pictures never leave the frame: at z = 1 they fit it; further in, they can be moved until an edge meets the frame's
        const clampPan = () => { const W = view.clientWidth, H = view.clientHeight; u.tx = Math.min(0, Math.max(W - W * u.z, u.tx)); u.ty = Math.min(0, Math.max(H - H * u.z, u.ty)); };
        u.reset = () => { imgR.dataset.n = ""; imgL.dataset.n = ""; };
        u.draw = () => {
            const p = P(), n = st.pics.length, prev = prevOf(st.cur), split = u.over && prev > 0, W = view.clientWidth || 1;
            empty.hidden = n > 0;
            empty.textContent = n ? "" : "Connect two or more images and run the workflow: the pictures show here.";
            imgR.hidden = !st.cur; imgL.hidden = !split; line.hidden = !split;
            if (st.cur && imgR.dataset.n !== String(st.cur)) { imgR.src = st.pics[st.cur - 1].url; imgR.dataset.n = String(st.cur); }
            if (prev && imgL.dataset.n !== String(prev)) { imgL.src = st.pics[prev - 1].url; imgL.dataset.n = String(prev); }
            clampPan();
            stage.style.transform = u.z === 1 ? "" : `translate(${u.tx.toFixed(2)}px, ${u.ty.toFixed(2)}px) scale(${u.z.toFixed(4)})`;
            // the pointer's place in the frame, as a share of the (zoomed, moved) picture area
            const f = Math.min(1, Math.max(0, (u.x * W - u.tx) / u.z / W));
            imgL.style.clipPath = `inset(0 ${(100 - f * 100).toFixed(3)}% 0 0)`;
            line.style.left = `${(u.x * 100).toFixed(3)}%`;
            tagL.hidden = !(split && p.labels); tagR.hidden = !(st.cur && p.labels);
            tagL.textContent = String(prev || ""); tagR.textContent = String(st.cur || "");
            view.classList.toggle("zoomed", u.z > 1);
            // far in, the picture's own pixels show as they are (no smoothing): that is what is being compared
            const fit = imgR.naturalWidth ? Math.min(W / imgR.naturalWidth, (view.clientHeight || 1) / imgR.naturalHeight) : 1;
            view.classList.toggle("sharp", fit * u.z >= 3);
            if (!isBig) view.style.cursor = prev ? "ew-resize" : "default";
            zoomLbl.textContent = `${Math.round(fit * u.z * 100)}%`;
            zoomLbl.title = "The picture's size on the screen: 100% is one picture pixel per screen pixel.\nWheel: Zoom in and out (out as far as the whole picture fits). Drag: Move the picture.";
            [...chips.children].forEach((b, i) => { b.classList.toggle("cur", i + 1 === st.cur); b.classList.toggle("prev", i + 1 === prev); b.classList.toggle("hid", p.hidden.includes(i + 1)); });
            wrapBtn.classList.toggle("on", !!p.wrap); tagBtn.classList.toggle("on", !!p.labels); bigBtn.classList.toggle("on", isBig);
            wrapBtn.title = p.wrap ? "Around the corner: ON. The first picture has the last one on its left. Click to show the first picture alone."
                : "Around the corner: OFF. The first picture shows alone. Click to put the last picture on its left.";
            tagBtn.title = p.labels ? "Number labels on the picture: ON. Click to hide them." : "Number labels on the picture: OFF. Click to show them.";
            // the key in use for it (not keyed(): the editor's Large editor has the same default key)
            const k = keyText("compare.big"), kb = k ? ` (${k})` : "";
            bigBtn.title = isBig ? `Large view: ON. Click to close it${kb}.\nAlso: Esc, or a click beside the window.`
                : `Large view: Open the comparison in a large window over ComfyUI${kb}.\nThere the wheel zooms into the pictures, out as far as the whole picture fits, and a drag moves them.`;
        };
        u.build = () => {
            const many = st.pics.some((q) => q.index > 0);
            chips.replaceChildren(...st.pics.map((q, i) => {
                const b = el("button"); b.type = "button"; b.textContent = String(i + 1);
                b.title = `Picture ${i + 1}: From image_${q.input}` + (many ? `, number ${q.index + 1} of its batch` : "") + ".\nClick: Choose it (a hidden one is shown again).\n"
                    + "Right-click: Hide it from the comparison, or show it again. The pictures next to a hidden one are compared with each other.";
                b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); pick(i + 1); });
                b.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); toggleHidden(i + 1); });
                return b;
            }));
        };
        let drag = null;                           // the Large view, zoomed in: a drag moves the pictures
        const move = (e) => {
            const r = view.getBoundingClientRect(); if (!r.width) return;
            if (drag) {
                if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) { drag.on = true; view.classList.add("panning"); }
                if (drag.on) { u.tx = drag.tx + e.clientX - drag.x; u.ty = drag.ty + e.clientY - drag.y; u.draw(); return; }
            }
            u.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); u.over = true; u.draw();
        };
        view.addEventListener("pointermove", move);
        view.addEventListener("pointerenter", move);
        view.addEventListener("pointerleave", () => { if (drag?.on) return; u.over = false; u.draw(); });
        if (isBig) {
            view.addEventListener("pointerdown", (e) => { if (e.button !== 0 || u.z <= 1) return; drag = { x: e.clientX, y: e.clientY, tx: u.tx, ty: u.ty, on: false }; try { view.setPointerCapture(e.pointerId); } catch (err) { /* gone */ } });
            const end = (e) => { if (!drag) return; drag = null; view.classList.remove("panning"); try { view.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ } move(e); };
            view.addEventListener("pointerup", end); view.addEventListener("pointercancel", end);
            view.addEventListener("wheel", (e) => {
                e.preventDefault(); e.stopPropagation();
                const r = view.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
                const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
                const z = Math.min(MAX_ZOOM, Math.max(1, u.z * Math.pow(1.0015, -dy)));
                // the place under the pointer stays under the pointer
                u.tx = mx - (mx - u.tx) * z / u.z; u.ty = my - (my - u.ty) * z / u.z; u.z = z;
                if (u.z <= 1.0005) { u.z = 1; u.tx = 0; u.ty = 0; }
                u.x = Math.min(1, Math.max(0, mx / r.width)); u.over = true;
                u.draw();
            }, { passive: false });
        } else {
            view.addEventListener("wheel", wheelToGraph, { passive: true });
            bar.addEventListener("wheel", wheelToGraph, { passive: true });
            wrap.addEventListener("pointerdown", middleToGraph);
            wrap.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
            wrap.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
        }
        for (const b of [wrapBtn, tagBtn, bigBtn]) for (const ev of ["pointerdown", "mousedown", "dblclick"]) b.addEventListener(ev, (e) => e.stopPropagation());
        chips.addEventListener("pointerdown", (e) => e.stopPropagation());
        wrapBtn.addEventListener("click", (e) => { e.preventDefault(); P().wrap = !P().wrap; draw(); });
        tagBtn.addEventListener("click", (e) => { e.preventDefault(); P().labels = !P().labels; draw(); });
        bigBtn.addEventListener("click", (e) => { e.preventDefault(); toggleBig(); });
        u.state = () => ({ over: u.over, x: u.x, zoom: u.z, tx: u.tx, ty: u.ty });
        uis.push(u);
        return u;
    }

    // ---- the Large view: a window over ComfyUI with the same comparison, larger; the node keeps its own
    function openBig() {
        if (big) return;
        if (bigNode && bigNode !== node) bigNode.__rgCompare?.closeBig();
        const ov = el("div", "rg-ic-big"), ui = makeUI(true);
        ov.appendChild(ui.wrap);
        ov.addEventListener("pointerdown", (e) => { if (e.target === ov) closeBig(); });
        for (const ev of ["wheel", "contextmenu"]) ov.addEventListener(ev, (e) => { if (e.target === ov) e.preventDefault(); }, { passive: false });
        document.body.appendChild(ov);
        big = { ov, ui }; bigNode = node;
        ui.build(); draw();
        big.onResize = () => draw();
        window.addEventListener("resize", big.onResize);
    }
    function closeBig() {
        if (!big) return;
        window.removeEventListener("resize", big.onResize);
        big.ov.remove(); uis.splice(uis.indexOf(big.ui), 1);
        big = null; if (bigNode === node) bigNode = null;
        draw();
    }
    const toggleBig = () => { if (big) closeBig(); else openBig(); };

    const own = makeUI(false);
    const w = node.addDOMWidget("rg_compare", "RgCompare", own.wrap, { serialize: false, hideOnZoom: false, getMinHeight: () => 150 });
    w.serialize = false;

    // inputs: image_1 and image_2 at least, and one free input after the last connected one
    function fixInputs() {
        const ins = () => (node.inputs || []).map((inp, i) => ({ inp, i, n: +(/^image_(\d+)$/.exec(inp.name || "")?.[1] || 0) })).filter((q) => q.n);
        let list = ins();
        while (list.length > 2 && list[list.length - 1].inp.link == null && list[list.length - 2].inp.link == null) { node.removeInput(list[list.length - 1].i); list = ins(); }
        const last = list[list.length - 1];
        if (!last || last.inp.link != null) node.addInput(`image_${(last?.n || 0) + 1}`, "IMAGE");
        if (ins().length < 2) node.addInput("image_2", "IMAGE");
        node.setDirtyCanvas?.(true, true);
    }
    const onConn = node.onConnectionsChange;
    node.onConnectionsChange = function () { const r = onConn?.apply(this, arguments); setTimeout(fixInputs, 0); return r; };
    const onConf = node.onConfigure;
    node.onConfigure = function () { const r = onConf?.apply(this, arguments); setTimeout(() => { fixInputs(); settle(); draw(); }, 0); return r; };
    const onExec = node.onExecuted;
    node.onExecuted = function (out) {
        const r = onExec?.apply(this, arguments);
        this.imgs = null;                          // never ComfyUI's own preview under the node's (a leftover of another node with this id)
        const list = (out?.rg_compare || []).filter((q) => q && q.filename).map((q) => ({ input: +q.input || 0, index: +q.index || 0,
            url: api.apiURL(`/view?filename=${encodeURIComponent(q.filename)}&subfolder=${encodeURIComponent(q.subfolder || "")}&type=${encodeURIComponent(q.type || "temp")}&rand=${Math.random()}`) }));
        setPics(list);
        return r;
    };
    const onRemoved = node.onRemoved;
    node.onRemoved = function () { closeBig(); return onRemoved?.apply(this, arguments); };

    // tests, and anything else that wants to drive the node
    node.__rgCompare = { choose, step, toggleHidden, setPics, fixInputs, openBig, closeBig, toggleBig, redraw: draw,
        state: () => ({ n: st.pics.length, cur: st.cur, prev: prevOf(st.cur), shown: shown(), hidden: [...P().hidden], wrap: !!P().wrap, labels: !!P().labels,
                        ...own.state(), big: big ? big.ui.state() : null }) };
    draw();
    setTimeout(fixInputs, 0);
}

app.registerExtension({
    name: "RegionGenie.ImageCompare",
    setup() {
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("pointermove", (e) => { px = e.clientX; py = e.clientY; }, true);
        window.addEventListener(SHORTCUTS_EVENT, () => { for (const n of app.graph?._nodes || []) if (n.__rgCompare) n.__rgCompare.redraw?.(); });
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE) return;
        if (!document.getElementById("rg-ic-css")) { const s = document.createElement("style"); s.id = "rg-ic-css"; s.textContent = CSS; document.head.appendChild(s); }
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onCreated?.apply(this, arguments);
            setup(this);
            if (this.size) this.setSize([Math.max(this.size[0], 380), Math.max(this.size[1], 360)]);
            return r;
        };
    },
});
