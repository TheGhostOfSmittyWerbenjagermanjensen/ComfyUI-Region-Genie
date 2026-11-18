// Mouse, pen and keyboard on the canvas.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { LASSO_MODES, SHAPE_NAMES, UNSPEC } from "./shared.js";
import { snapToEdge, snapSegment, dedupe, simplifyClosed, smoothClosed, closedSpline } from "./geometry.js";

export function* pointer(E) {
    Object.assign(E, {
        shapeDragLayer, newPaintLayer, lassoOutline, finishClickPoly,
    });
    yield;

    // ---------------- interactions ----------------
    function shapeDragLayer() {
        if (!E.drag || E.drag.mode !== "shape") return null;
        let [ax, ay] = E.drag.start, [bx, by] = E.drag.cur;
        if (E.drag.square) {
            const m = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
            bx = ax + Math.sign(bx - ax || 1) * m; by = ay + Math.sign(by - ay || 1) * m;
        }
        if (E.drag.centre) { const dx = bx - ax, dy = by - ay; [ax, ay, bx, by] = [ax - dx, ay - dy, ax + dx, ay + dy]; }
        const [W, H] = E.dims(), s = Math.min(W, H);
        const w = Math.abs(bx - ax), h = Math.abs(by - ay);
        if (w < 1 || h < 1) return null;
        return { id: -1, name: "", region: E.drag.region, visible: true, shape: E.shapeKind, sides: E.sides,
                 ...(E.shapeKind === "roundrect" ? { radius: E.cornerPct } : {}),
                 bw: w / s, bh: h / s, sx: 1, sy: 1, rot: 0, ox: ((ax + bx) / 2 - W / 2) / s, oy: ((ay + by) / 2 - H / 2) / s, ops: [] };
    }
    function paintTarget(erasing) {
        const L = E.selLayer();
        if (erasing) return L && L.visible !== false ? L : null;
        const rid = E.ensureRegion();
        return L && L.visible !== false && L.region === rid ? L : null;
    }
    function newPaintLayer(rid) {
        const [W, H] = E.dims(), s = Math.min(W, H), id = E.nextLayerId();
        const sel = E.selLayer(), owner = rid === UNSPEC ? (sel?.region === UNSPEC ? E.holeOwner(sel) : E.state.regions[0]?.id) : null;
        return { id, name: rid === UNSPEC ? `Hole ${id}` : `Paint ${id}`, region: rid, ...(owner != null ? { owner } : {}),
                 visible: true, shape: null, sides: 5, bw: W / s, bh: H / s, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, ops: [] };
    }
    const localBrush = (L) => E.brush / Math.sqrt(L.sx * L.sy);
    // the outline a lasso makes (image px). Spline: clicked points are kept; a freehand path is first
    // reduced to the points that carry its shape (so hand jitter is smoothed out), then a smooth closed
    // curve goes through them.
    function lassoOutline(pts, spline, freehand) {
        if (!spline) return pts;
        const z = E.view?.z || 1, px = E.dprNow() / z;           // one screen pixel in image px
        let p = dedupe(pts, 0.5 * px);
        if (freehand && p.length >= 4) {
            let per = 0;
            p.forEach((q, i) => { const r = p[(i + 1) % p.length]; per += Math.hypot(r[0] - q[0], r[1] - q[1]); });
            const radius = Math.max(6 * px, Math.min(32 * px, per * 0.02));
            p = simplifyClosed(smoothClosed(p, 2 * px, radius), 2.5 * px);
        }
        if (p.length < 3) return pts;
        return closedSpline(p, 3 * E.dprNow() / z);
    }
    function finishClickPoly() {
        const cp = E.clickPoly;
        E.clickPoly = null;
        if (!cp || cp.pts.length < 3) { E.requestDraw(); return; }
        const before = E.snapshot();
        const layer = cp.target || newPaintLayer(cp.region);
        layer.ops.push({ t: "poly", e: cp.erase, p: lassoOutline(cp.pts, cp.spline, false).map(([x, y]) => E.imgToLayer(layer, x, y)) });
        if (!cp.target) E.addLayer(layer);
        E.pushUndo(before); E.save(); E.refreshUI();
    }

    function onPointerDown(e) {
        e.preventDefault(); e.stopPropagation();
        E.focusSink();
        if (e.button === 0 && E.tool !== "select" && E.hiddenSel != null) { E.hiddenSel = null; E.requestDraw(); }
        const [dx, dy] = E.evDisplay(e), [ix, iy] = E.toImg(dx, dy);
        E.cv.setPointerCapture?.(e.pointerId);
        if (e.button === 1 || (e.button === 0 && E.spaceDown)) { E.drag = { mode: "pan", sx: dx, sy: dy, vx: E.view.x, vy: E.view.y }; E.userView = true; return; }
        if (e.button !== 0) return;
        const onLabel = !E.clickPoly && labelAt(dx, dy);
        if (onLabel && e.detail >= 2) return;              // 2nd click of a double-click on a label: edit, don't draw
        E.labelClick = onLabel ? { t: performance.now(), n: E.undoStack.length } : null;
        const before = E.snapshot();
        if (E.clickPoly) {                                   // building a lasso point by point
            const [fx, fy] = E.toScr(...E.clickPoly.pts[0]);
            if (E.clickPoly.pts.length >= 3 && Math.hypot(fx - dx, fy - dy) <= 8 * E.dprNow()) finishClickPoly();
            else if (E.clickPoly.magnetic && E.edgeMap()) {    // magnetic: the segment follows edges to the snapped click
                const ed = E.edgeMap(), rad = E.magnetRadius();
                const b = snapToEdge(ed, ix, iy, rad), a = E.clickPoly.pts[E.clickPoly.pts.length - 1];
                E.clickPoly.pts.push(...snapSegment(ed, a, b, Math.max(2, 4 * E.dprNow() / E.view.z), rad / 2).slice(0, -1), b);
                E.requestDraw();
            } else { E.clickPoly.pts.push([E.snapV(ix), E.snapV(iy)]); E.requestDraw(); }
            return;
        }
        // Alt+click with a painting tool: eyedropper, the region under the pointer becomes the active one
        if (e.altKey && E.tool !== "select" && E.tool !== "shape") {
            const L = E.hitLayer(dx, dy);
            if (L && L.region !== UNSPEC && E.regionById(L.region)) {
                E.activateRegion(L.region); E.openSub?.(L.region, "layers");
                const rg = E.regionById(L.region);
                E.hint(`Active region: ${rg.prompt.trim().slice(0, 40) || "(no prompt)"}`);
            } else if (L) { E.activateRegion(UNSPEC); E.hint("A hole (✂ on its layer): Painting now adds holes"); }
            else E.hint("No region here");
            E.labelClick = null;
            E.refreshUI();
            return;
        }
        if (E.tool === "select") {
            const L = E.selLayer();
            const shown = E.hiddenSel !== E.selId;
            E.hiddenSel = null;
            if (L && E.isShown(L) && shown) {
                const hd = E.handles(L).find((h) => Math.hypot(h.x - dx, h.y - dy) <= 9 * E.dprNow());
                if (hd) {
                    const L0 = { ...L };
                    if (hd.kind === "rotate") {
                        const [x0, y0, x1, y1] = E.contentBox(L), kc = [(x0 + x1) / 2, (y0 + y1) / 2];
                        const K = E.layerToImg(L, ...kc);
                        E.drag = { mode: "rotate", L, L0, kc, K, a0: Math.atan2(iy - K[1], ix - K[0]), before };
                    } else {
                        E.drag = { mode: "scale", L, L0, hd, A: E.layerToImg(L, hd.ax, hd.ay), before };
                    }
                    return;
                }
                if (E.insideBox(L, ix, iy) && !e.altKey) { E.drag = { mode: "move", L, c0: [L.ox, L.oy], start: [ix, iy], before }; return; }
            }
            const H2 = E.hitLayer(dx, dy);
            E.selectLayer(H2);
            if (H2) E.drag = { mode: "move", L: H2, c0: [H2.ox, H2.oy], start: [ix, iy], before };
            return;
        }
        if (E.tool === "shape") {
            E.drag = { mode: "shape", start: [E.snapV(ix), E.snapV(iy)], cur: [E.snapV(ix), E.snapV(iy)], region: E.ensureRegion(), square: e.shiftKey, centre: e.altKey, before };
            E.refreshUI();
            return;
        }
        if (E.tool === "object") {
            E.drag = { mode: "pickbox", start: [ix, iy], cur: [ix, iy], sd: [dx, dy], moved: 0, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
            E.labelClick = null;
            return;
        }
        if (E.tool === "fill") {
            if (LASSO_MODES.fill === "linear" || LASSO_MODES.fill === "radial") E.drag = { mode: "grad", kind: LASSO_MODES.fill, start: [ix, iy], cur: [ix, iy] };
            else E.fillAt(ix, iy);
            return;
        }
        if (E.tool === "wand") { E.wandAt(ix, iy); return; }
        const erasing = E.tool === "erase" || E.tool === "lassoErase";
        const target = paintTarget(erasing);
        if (erasing && !target) { E.hint("Select a layer to erase from"); return; }
        if (E.tool === "brush" || E.tool === "erase") {
            const layer = target || newPaintLayer(E.ensureRegion());
            const p = E.imgToLayer(layer, ix, iy);
            // Shift+click: a straight line from where the last stroke ended
            const from = e.shiftKey && E.lastStrokeEnd ? E.imgToLayer(layer, ...E.lastStrokeEnd) : null;
            E.drag = { mode: "paint", target, layer, op: { t: "stroke", e: erasing, d: localBrush(layer), p: from ? [from, p] : [p] }, before };
        } else {
            let magnetic = LASSO_MODES[E.tool] === "magnetic", p0 = [ix, iy];
            if (magnetic && !E.edgeMap()) { magnetic = false; E.hint("Magnetic lasso " + E.NEEDS_IMAGE + "; drawing a plain lasso"); }
            if (magnetic) p0 = snapToEdge(E.edgeMap(), ix, iy, E.magnetRadius());
            E.drag = { mode: "lasso", erase: erasing, spline: LASSO_MODES[E.tool] === "spline", magnetic, target, region: erasing ? null : E.ensureRegion(), pts: [p0], start: [dx, dy], moved: 0, before };
        }
        E.refreshUI();
    }
    E.cv.addEventListener("pointerdown", onPointerDown);
    const keepFocus = () => {                        // Nodes 2.0 may move focus to the node element after a click
        const a = document.activeElement;
        if (a !== E.keySink && (!a || a === document.body || !E.isField(a) || E.wrap.contains(a)) && !(E.wrap.contains(a) && E.isField(a))) E.focusSink();
    }; E.keepFocus = keepFocus;
    function onPointerMove(e) {
        const [dx, dy] = E.evDisplay(e), [ix, iy] = E.toImg(dx, dy);
        E.hover = [dx, dy];
        keepFocus();
        if (!E.drag) { E.requestDraw(); return; }
        e.preventDefault(); e.stopPropagation();
        const [W, H] = E.dims(), s = Math.min(W, H);
        if (E.drag.mode === "pan") { E.view.x = E.drag.vx + dx - E.drag.sx; E.view.y = E.drag.vy + dy - E.drag.sy; }
        else if (E.drag.mode === "move") {
            const L = E.drag.L;
            L.ox = E.drag.c0[0] + (ix - E.drag.start[0]) / s;
            L.oy = E.drag.c0[1] + (iy - E.drag.start[1]) / s;
            if (E.snap) {
                const cs = E.boxCornersImg(L);
                if (cs) {
                    const mx = Math.min(...cs.map((c) => c[0])), my = Math.min(...cs.map((c) => c[1]));
                    L.ox += (E.snapV(mx) - mx) / s; L.oy += (E.snapV(my) - my) / s;
                }
            }
        } else if (E.drag.mode === "scale") {
            const { L, L0, hd, A } = E.drag, th = L0.rot * Math.PI / 180;
            const mx = E.snapV(ix), my = E.snapV(iy);
            const qx = mx - A[0], qy = my - A[1];
            const rx = Math.cos(th) * qx + Math.sin(th) * qy, ry = -Math.sin(th) * qx + Math.cos(th) * qy;
            let nsx = L0.sx, nsy = L0.sy;
            const spanX = hd.lx - hd.ax, spanY = hd.ly - hd.ay;
            if (hd.ex && spanX) nsx = Math.max(1e-3, rx / (spanX * s));
            if (hd.ey && spanY) nsy = Math.max(1e-3, ry / (spanY * s));
            if (e.shiftKey && hd.ex && hd.ey) { const k = Math.max(nsx / L0.sx, nsy / L0.sy); nsx = L0.sx * k; nsy = L0.sy * k; }
            L.sx = nsx; L.sy = nsy;
            const ox = (hd.ax - L.bw / 2) * L.sx * s, oy = (hd.ay - L.bh / 2) * L.sy * s;
            L.ox = (A[0] - (Math.cos(th) * ox - Math.sin(th) * oy) - W / 2) / s;
            L.oy = (A[1] - (Math.sin(th) * ox + Math.cos(th) * oy) - H / 2) / s;
        } else if (E.drag.mode === "rotate") {
            const { L, L0, kc, K } = E.drag;
            let rot = L0.rot + (Math.atan2(iy - K[1], ix - K[0]) - E.drag.a0) * 180 / Math.PI;
            if (e.shiftKey) rot = Math.round(rot / 15) * 15;
            rot = ((rot % 360) + 540) % 360 - 180;
            L.rot = rot;
            const th = rot * Math.PI / 180;
            const ox = (kc[0] - L.bw / 2) * L.sx * s, oy = (kc[1] - L.bh / 2) * L.sy * s;
            L.ox = (K[0] - (Math.cos(th) * ox - Math.sin(th) * oy) - W / 2) / s;
            L.oy = (K[1] - (Math.sin(th) * ox + Math.cos(th) * oy) - H / 2) / s;
        } else if (E.drag.mode === "pickbox") {
            E.drag.cur = [ix, iy]; E.drag.moved = Math.max(E.drag.moved, Math.hypot(dx - E.drag.sd[0], dy - E.drag.sd[1]));
        } else if (E.drag.mode === "grad") {
            E.drag.cur = [ix, iy];
        } else if (E.drag.mode === "shape") {
            E.drag.cur = [E.snapV(ix), E.snapV(iy)]; E.drag.square = e.shiftKey; E.drag.centre = e.altKey;
        } else if (E.drag.mode === "paint") {
            const p = E.imgToLayer(E.drag.layer, ix, iy), last = E.drag.op.p[E.drag.op.p.length - 1];
            if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= Math.max(E.drag.op.d * 0.15, 0.5 / s)) E.drag.op.p.push(p);
        } else if (E.drag.mode === "lasso") {
            E.drag.moved = Math.max(E.drag.moved, Math.hypot(dx - E.drag.start[0], dy - E.drag.start[1]));
            const last = E.drag.pts[E.drag.pts.length - 1];
            if (Math.hypot(ix - last[0], iy - last[1]) * E.view.z >= 3) {
                E.drag.pts.push(E.drag.magnetic ? snapToEdge(E.edgeMap(), ix, iy, E.magnetRadius()) : [ix, iy]);
            }
        }
        E.requestDraw();
    }
    E.cv.addEventListener("pointermove", onPointerMove);
    const finish = (e) => {
        if (!E.drag) return;
        e?.preventDefault?.(); e?.stopPropagation?.();
        const d = E.drag;
        const t = d.mode === "shape" ? shapeDragLayer() : null;
        E.drag = null;
        if (d.mode === "pan") { E.requestDraw(); return; }
        if (d.mode === "pickbox") { E.pickPointer(d); E.requestDraw(); return; }
        if (d.mode === "grad") { E.gradFill(d); E.requestDraw(); return; }
        if (d.mode === "lasso" && d.moved < 5 * E.dprNow()) {     // a click: start a point-by-point lasso
            E.clickPoly = { erase: d.erase, spline: d.spline, magnetic: d.magnetic, target: d.target, region: d.region,
                          pts: [d.magnetic ? d.pts[0] : [E.snapV(d.pts[0][0]), E.snapV(d.pts[0][1])]] };
            E.requestDraw();
            return;
        }
        if (d.mode === "shape") {
            if (t) {
                t.id = E.nextLayerId();
                t.name = `${SHAPE_NAMES[t.shape] || "Shape"} ${t.id}`;
                E.addLayer(t);
                E.setTool("select");
            }
        } else if (d.mode === "paint") {
            E.lastStrokeEnd = E.layerToImg(d.layer, ...d.op.p[d.op.p.length - 1]);
            if (d.target) d.target.ops.push(d.op);
            else { d.layer.ops.push(d.op); E.addLayer(d.layer); }
        } else if (d.mode === "lasso" && d.pts.length >= 3) {
            const layer = d.target || newPaintLayer(d.region);
            layer.ops.push({ t: "poly", e: d.erase, p: lassoOutline(d.pts, d.spline, true).map(([x, y]) => E.imgToLayer(layer, x, y)) });
            if (!d.target) E.addLayer(layer);
        }
        E.pushUndo(d.before);
        E.save(); E.refreshUI();
    };
    E.cv.addEventListener("pointerup", finish);
    // Nodes 2.0 forwards middle-button drags over nodes to the graph in a capture handler above the nodes.
    // A window capture listener runs before it, so middle-drags that start on this canvas pan the canvas.
    const midPan = (e) => {
        const panning = E.drag?.mode === "pan" && E.drag.middle;
        if (e.type === "pointerdown") {
            if (!(e.target === E.cv && e.button === 1)) return;
            e.stopPropagation(); e.preventDefault();
            onPointerDown(e);
            if (E.drag?.mode === "pan") E.drag.middle = true;
        } else if (panning) {
            e.stopPropagation(); e.preventDefault();
            if (e.type === "pointermove") onPointerMove(e); else finish(e);
        }
    }; E.midPan = midPan;
    const PAN_EVENTS = ["pointerdown", "pointermove", "pointerup", "pointercancel"]; E.PAN_EVENTS = PAN_EVENTS;
    for (const t of PAN_EVENTS) window.addEventListener(t, midPan, true);
    // a click anywhere but the canvas hides the selected layer's box and handles
    const hideSelOutside = (e) => {
        if (E.selId == null || E.hiddenSel === E.selId || E.drag || e.target === E.cv) return;
        E.hiddenSel = E.selId; E.requestDraw();
    }; E.hideSelOutside = hideSelOutside;
    window.addEventListener("pointerdown", hideSelOutside, true);
    const noAutoScroll = (e) => { if (e.button === 1 && e.target === E.cv) e.preventDefault(); }; E.noAutoScroll = noAutoScroll;
    window.addEventListener("mousedown", noAutoScroll, true);
    E.cv.addEventListener("pointercancel", finish);
    E.cv.addEventListener("dblclick", (e) => {
        if (E.clickPoly) { e.preventDefault(); e.stopPropagation(); E.clickPoly.pts.pop(); finishClickPoly(); return; }
        if (E.node.properties?.rg_labels === false) return;
        const r = labelAt(...E.evDisplay(e));
        if (!r) return;
        e.preventDefault(); e.stopPropagation();
        // the first click already drew with a paint/shape/fill tool: take that back
        if (E.tool !== "select" && E.labelClick && performance.now() - E.labelClick.t < 800 && E.undoStack.length === E.labelClick.n + 1) {
            E.undo(); E.redoStack.pop();
        }
        E.labelClick = null;
        E.editPrompt(r.rid, r);
    });
    function labelAt(px, py) {
        if (E.node.properties?.rg_labels === false) return null;
        for (let i = E.labelRects.length - 1; i >= 0; i--) {
            const r = E.labelRects[i];
            if (px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1) return r;
        }
        return null;
    }
    // pop-up region editor (double-click a label): type, prompt, text, feather, palette and LoRAs.
    // Text edits show live; each edited field is one undo step. Enter or clicking elsewhere closes it,
    // Shift+Enter = new line, Esc closes it and undoes the text edit in progress.
    E.editor = null;
}
