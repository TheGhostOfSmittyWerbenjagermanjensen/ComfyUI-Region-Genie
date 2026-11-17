// Drawing the canvas, hit testing, and the region label map (what the outputs will contain).
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { UNSPEC } from "./shared.js";
import { shapeVerts, bitmapCanvas } from "./geometry.js";
import { hexRgb } from "./colors.js";

export function* render(E) {
    Object.assign(E, {
        paintLocal, drawLayerOn, renderComposite, requestDraw, handles, hitLayer, insideBox, outputIndexMap, updateRegionIndices,
    });
    yield;

    // ---------------- rendering ----------------
    function paintLocal(c, L, ops, color) {
        c.fillStyle = color; c.strokeStyle = color;
        if (L.shape) {
            const v = shapeVerts(L.shape, L.sides, L.bw, L.bh, L.radius);
            c.beginPath();
            v.forEach(([u, w], i) => (i ? c.lineTo(u * L.bw, w * L.bh) : c.moveTo(u * L.bw, w * L.bh)));
            c.closePath(); c.fill();
        }
        for (const o of ops) {
            c.globalCompositeOperation = o.e ? "destination-out" : "source-over";
            if (o.t === "bitmap") {
                c.imageSmoothingEnabled = false;
                c.drawImage(bitmapCanvas(o, color), o.x0, o.y0, o.x1 - o.x0, o.y1 - o.y0);
                continue;
            }
            if (!o.p?.length) continue;
            c.beginPath();
            c.moveTo(o.p[0][0], o.p[0][1]);
            if (o.t === "stroke") {
                if (o.p.length === 1) c.lineTo(o.p[0][0] + 1e-4, o.p[0][1]);
                for (let i = 1; i < o.p.length; i++) c.lineTo(o.p[i][0], o.p[i][1]);
                c.lineWidth = o.d; c.lineCap = "round"; c.lineJoin = "round";
                c.stroke();
            } else if (o.p.length >= 3) {
                for (let i = 1; i < o.p.length; i++) c.lineTo(o.p[i][0], o.p[i][1]);
                c.closePath(); c.fill();
            }
        }
        c.globalCompositeOperation = "source-over";
    }
    function drawLayerOn(c, L, extraOp, pre, colorOverride) {
        const color = colorOverride || E.colorOf(L.region);
        if (!color) return;
        c.save();
        E.layerTransform(c, L, pre);
        paintLocal(c, L, extraOp ? [...L.ops, extraOp] : L.ops, color);
        c.restore();
    }
    // a gradient layer: what was just drawn on c (this layer alone) fades along its gradient
    function fadeLayerOn(c, L, pre) {
        const g = L.grad;
        if (!g || L.region === UNSPEC) return;
        c.save();
        E.layerTransform(c, L, pre);
        const len = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
        const gr = g.k === "radial" ? c.createRadialGradient(g.a[0], g.a[1], 0, g.a[0], g.a[1], len)
            : c.createLinearGradient(g.a[0], g.a[1], g.b[0], g.b[1]);
        gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        c.globalCompositeOperation = "destination-in";
        c.fillStyle = gr;
        c.fillRect(-100, -100, 200, 200);                  // layer units (1 = the image's shorter side)
        c.restore();
    }
    let holePat = null, holePatDpr = 0;
    function holePattern(c) {                      // the canvas's holes: black with grey stripes
        const d = E.dprNow();
        if (!holePat || holePatDpr !== d) {
            const s = Math.max(6, Math.round(8 * d)), t = document.createElement("canvas"); t.width = t.height = s;
            const p = t.getContext("2d");
            p.fillStyle = "#000"; p.fillRect(0, 0, s, s);
            p.lineWidth = 1.5 * d; p.strokeStyle = "rgba(150,150,150,.75)";
            p.beginPath(); for (const o of [-s, 0, s]) { p.moveTo(o, s); p.lineTo(o + s, 0); } p.stroke();
            holePat = c.createPattern(t, "repeat"); holePatDpr = d;
        }
        return holePat;
    }
    function renderComposite(c, w, h, scr, sc, pre, hatchHoles = false) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, w, h);
        const pending = E.drag?.mode === "paint" && !E.drag.target ? E.drag.layer : null;
        let list = E.state.layers;
        if (pending) { list = [...E.state.layers]; list.splice(E.slotFor(pending.region), 0, pending); }
        for (const L of list) {
            if (!E.isShown(L)) continue;
            const extra = E.drag?.mode === "paint" && (E.drag.target === L || L === pending) ? E.drag.op : null;
            const hatch = hatchHoles && L.region === UNSPEC;
            const needsScratch = L.ops.some((o) => o.e) || extra?.e || hatch || !!L.grad;
            if (!needsScratch) { drawLayerOn(c, L, extra, pre); continue; }
            sc.setTransform(1, 0, 0, 1, 0, 0);
            sc.clearRect(0, 0, w, h);
            drawLayerOn(sc, L, extra, pre);
            fadeLayerOn(sc, L, pre);
            if (hatch) {
                sc.setTransform(1, 0, 0, 1, 0, 0);
                sc.globalCompositeOperation = "source-atop"; sc.fillStyle = holePattern(sc); sc.fillRect(0, 0, w, h);
                sc.globalCompositeOperation = "source-over";
            }
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.drawImage(scr, 0, 0);
        }
    }
    function checker(w, h) {
        const s = 10 * E.dprNow();
        E.ctx.fillStyle = "#3a3a3a"; E.ctx.fillRect(0, 0, w, h);
        E.ctx.fillStyle = "#2a2a2a";
        for (let y = 0; y < h; y += s) for (let x = (Math.floor(y / s) % 2) * s; x < w; x += 2 * s) E.ctx.fillRect(x, y, s, s);
    }
    function requestDraw() {
        if (E.raf) return;
        E.raf = requestAnimationFrame(() => { E.raf = 0; draw(); });
    }
    function draw() {
        if (!E.resizeCanvas()) return;
        if (!E.view) E.fitView();
        const w = E.cv.width, h = E.cv.height, [W, H] = E.dims(), dpr = E.dprNow();
        E.ctx.setTransform(1, 0, 0, 1, 0, 0);
        checker(w, h);
        const [ix, iy] = E.toScr(0, 0), iw = W * E.view.z, ih = H * E.view.z;
        E.ctx.fillStyle = "#000"; E.ctx.fillRect(ix, iy, iw, ih);
        if (E.backdrop) {
            E.ctx.globalAlpha = E.backdropOpacity;
            E.ctx.drawImage(E.backdrop, ix, iy, iw, ih);
            E.ctx.globalAlpha = 1;
        }
        renderComposite(E.cctx, w, h, E.scratch, E.sctx, undefined, true);
        E.ctx.save();
        E.ctx.beginPath(); E.ctx.rect(ix, iy, iw, ih); E.ctx.clip();
        E.ctx.globalAlpha = E.backdrop ? Math.max(0.35, 1 - E.backdropOpacity * 0.6) : 1;
        E.ctx.drawImage(E.comp, 0, 0);
        E.ctx.restore();
        E.ctx.save();
        E.ctx.beginPath(); E.ctx.rect(0, 0, w, h); E.ctx.rect(ix, iy, iw, ih); E.ctx.clip("evenodd");
        E.ctx.globalAlpha = 0.35;
        E.ctx.drawImage(E.comp, 0, 0);
        E.ctx.restore();
        const shownMap = E.controlShowK >= 0 ? E.controlMaps[E.controlShowK] : null;
        if (shownMap && E.controls().length) {                        // a Control row's map of the last run
            E.ctx.save(); E.ctx.globalAlpha = 0.65; E.ctx.drawImage(shownMap, ix, iy, iw, ih); E.ctx.restore();
        }
        if (E.isEdit() && E.state.regions.some((r) => r.keep)) {        // Edit Mode: kept regions are hatched
            E.ctx.save();
            E.ctx.beginPath(); E.ctx.rect(ix, iy, iw, ih); E.ctx.clip();
            E.ctx.drawImage(keepHatch(w, h), 0, 0);
            E.ctx.restore();
        }
        if (E.snap && E.grid * E.view.z >= 6) {
            E.ctx.save();
            E.ctx.beginPath(); E.ctx.rect(ix, iy, iw, ih); E.ctx.clip();
            E.ctx.strokeStyle = "rgba(255,255,255,.12)"; E.ctx.lineWidth = 1;
            E.ctx.beginPath();
            for (let gx = 0; gx <= W; gx += E.grid) { const x = Math.round(ix + gx * E.view.z) + 0.5; E.ctx.moveTo(x, iy); E.ctx.lineTo(x, iy + ih); }
            for (let gy = 0; gy <= H; gy += E.grid) { const y = Math.round(iy + gy * E.view.z) + 0.5; E.ctx.moveTo(ix, y); E.ctx.lineTo(ix + iw, y); }
            E.ctx.stroke();
            E.ctx.restore();
        }
        E.ctx.strokeStyle = "rgba(255,255,255,.55)"; E.ctx.lineWidth = 1;
        E.ctx.strokeRect(Math.round(ix) + 0.5, Math.round(iy) + 0.5, Math.round(iw), Math.round(ih));
        if (E.drag?.mode === "shape") {
            const t = E.shapeDragLayer();
            if (t) { E.ctx.save(); E.ctx.globalAlpha = 0.75; drawLayerOn(E.ctx, t); E.ctx.restore(); outline(E.boxCornersImg(t, [0, 0, t.bw, t.bh]), "#fff", true); }
        }
        if (E.drag?.mode === "grad") {                       // gradient fill: the line being dragged (radial: its circle)
            const [ax, ay] = E.toScr(...E.drag.start), [bx, by] = E.toScr(...E.drag.cur), d = E.dprNow();
            E.ctx.save();
            for (const [col, lw] of [["rgba(0,0,0,.7)", 3 * d], ["#fff", 1.25 * d]]) {
                E.ctx.strokeStyle = col; E.ctx.lineWidth = lw;
                E.ctx.beginPath(); E.ctx.moveTo(ax, ay); E.ctx.lineTo(bx, by); E.ctx.stroke();
                if (E.drag.kind === "radial") { E.ctx.beginPath(); E.ctx.arc(ax, ay, Math.hypot(bx - ax, by - ay), 0, Math.PI * 2); E.ctx.stroke(); }
            }
            E.ctx.fillStyle = "#fff"; E.ctx.strokeStyle = "rgba(0,0,0,.7)"; E.ctx.lineWidth = d;
            E.ctx.beginPath(); E.ctx.arc(ax, ay, 3.5 * d, 0, Math.PI * 2); E.ctx.fill(); E.ctx.stroke();
            E.ctx.restore();
        }
        if (E.pick || E.drag?.mode === "pickbox") E.drawPick(ix, iy, iw, ih);
        E.syncPickBtns();
        const poly = E.drag?.mode === "lasso" ? E.drag : E.clickPoly;
        if (poly && poly.pts.length) {
            let pts = E.clickPoly && E.hover ? [...poly.pts, E.toImg(...E.hover)] : poly.pts;
            // spline: preview the closed curve it will make (plain click-lasso: the open path so far)
            const curve = poly.spline && pts.length >= 3;
            if (curve) pts = E.lassoOutline(pts, true, !E.clickPoly);
            E.ctx.save();
            E.ctx.beginPath();
            pts.forEach(([x, y], i) => { const [a, b] = E.toScr(x, y); i ? E.ctx.lineTo(a, b) : E.ctx.moveTo(a, b); });
            if (!E.clickPoly || curve) E.ctx.closePath();
            E.ctx.fillStyle = poly.erase ? "rgba(0,0,0,.45)" : (E.colorOf(poly.region) || "#fff") + "88";
            if (pts.length > 2) E.ctx.fill();
            E.ctx.setLineDash([4 * dpr, 3 * dpr]); E.ctx.lineWidth = 1.5 * dpr; E.ctx.strokeStyle = "#fff"; E.ctx.stroke();
            if (E.clickPoly) {                                   // points, first one bigger (click it to close)
                E.ctx.setLineDash([]);
                poly.pts.forEach(([x, y], i) => {
                    const [a, b] = E.toScr(x, y);
                    E.ctx.beginPath(); E.ctx.arc(a, b, (i ? 3 : 6) * dpr, 0, Math.PI * 2);
                    E.ctx.fillStyle = i ? "#fff" : "#5b8fd0"; E.ctx.fill(); E.ctx.stroke();
                });
            }
            E.ctx.restore();
        }
        drawLabels();
        updateRegionIndices();
        const L = E.selLayer();
        if (L && E.isShown(L) && E.hiddenSel !== E.selId) {
            const cs = E.boxCornersImg(L);
            if (cs) {
                outline(cs, "#5b8fd0", E.tool !== "select");
                if (E.tool === "select") for (const hd of handles(L)) {
                    E.ctx.fillStyle = hd.kind === "rotate" ? "#5b8fd0" : "#fff";
                    E.ctx.strokeStyle = "#1d3d66"; E.ctx.lineWidth = 1.5;
                    E.ctx.beginPath();
                    if (hd.kind === "rotate") E.ctx.arc(hd.x, hd.y, 5 * dpr, 0, Math.PI * 2);
                    else E.ctx.rect(hd.x - 4 * dpr, hd.y - 4 * dpr, 8 * dpr, 8 * dpr);
                    E.ctx.fill(); E.ctx.stroke();
                }
            }
        }
        if (E.hover && (E.tool === "brush" || E.tool === "erase")) {
            const r = Math.max(1, E.brush * E.short() * E.view.z / 2);
            E.ctx.beginPath(); E.ctx.arc(E.hover[0], E.hover[1], r, 0, Math.PI * 2);
            E.ctx.strokeStyle = "rgba(255,255,255,.9)"; E.ctx.lineWidth = 1; E.ctx.stroke();
            E.ctx.setLineDash([3, 3]); E.ctx.strokeStyle = "rgba(0,0,0,.9)"; E.ctx.stroke(); E.ctx.setLineDash([]);
        }
        E.undoBtn.disabled = !E.undoStack.length; E.redoBtn.disabled = !E.redoStack.length;
        E.arrangeBtn.disabled = !E.selLayer();
        if (E.arrangeBtn.disabled && E.arrangePop) E.closeArrange();
        E.clearBtn.disabled = !E.state.layers.length && !E.state.regions.length;
        E.bdBox.style.display = E.backdrop ? "" : "none";
    }
    // the visible pixels of the kept regions (their layers, minus every other layer above them), hatched;
    // cached until the layout or the view changes
    const hatchCv = document.createElement("canvas"), hatchCtx = hatchCv.getContext("2d");
    const hatchTmp = document.createElement("canvas"), hatchTmpCtx = hatchTmp.getContext("2d");
    let hatchKey = "", hatchPat = null, hatchDpr = 0;
    function keepHatch(w, h) {
        const key = `${E.version}|${w}x${h}|${E.view.z}|${E.view.x}|${E.view.y}|${E.dprNow()}`;
        if (key === hatchKey) return hatchCv;
        hatchKey = key;
        for (const c of [hatchCv, hatchTmp]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const keep = new Set(E.state.regions.filter((r) => r.keep).map((r) => r.id));
        const x = hatchCtx;
        x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, w, h);
        for (const L of E.state.layers) {
            if (!E.isShown(L) || (L.region !== UNSPEC && !E.regionById(L.region))) continue;
            hatchTmpCtx.setTransform(1, 0, 0, 1, 0, 0); hatchTmpCtx.clearRect(0, 0, w, h);
            drawLayerOn(hatchTmpCtx, L, null, null, "#fff");      // on its own canvas: its erasers stay inside it
            x.globalCompositeOperation = keep.has(L.region) ? "source-over" : "destination-out";
            x.drawImage(hatchTmp, 0, 0);
        }
        const d = E.dprNow();
        if (!hatchPat || hatchDpr !== d) {                        // diagonal stripes, dark and light
            const s = Math.max(6, Math.round(9 * d)), c = document.createElement("canvas"); c.width = c.height = s;
            const p = c.getContext("2d");
            p.lineCap = "square";
            p.fillStyle = "rgba(0,0,0,.22)"; p.fillRect(0, 0, s, s);
            p.lineWidth = 2 * d; p.strokeStyle = "rgba(0,0,0,.6)";
            p.beginPath(); for (const o of [-s, 0, s]) { p.moveTo(o, s); p.lineTo(o + s, 0); } p.stroke();
            p.lineWidth = 1.2 * d; p.strokeStyle = "rgba(255,255,255,.8)";
            p.beginPath(); for (const o of [-s, 0, s]) { p.moveTo(o + 2 * d, s); p.lineTo(o + s + 2 * d, 0); } p.stroke();
            hatchPat = x.createPattern(c, "repeat"); hatchDpr = d;
        }
        x.globalCompositeOperation = "source-in";
        x.fillStyle = hatchPat; x.fillRect(0, 0, w, h);
        x.globalCompositeOperation = "source-over";
        return hatchCv;
    }
    function outline(cornersImg, color, dashed) {
        if (!cornersImg) return;
        const dpr = E.dprNow();
        E.ctx.save();
        E.ctx.beginPath();
        cornersImg.forEach(([x, y], i) => { const [a, b] = E.toScr(x, y); i ? E.ctx.lineTo(a, b) : E.ctx.moveTo(a, b); });
        E.ctx.closePath();
        if (dashed) E.ctx.setLineDash([4 * dpr, 3 * dpr]);
        E.ctx.lineWidth = 1.5 * dpr; E.ctx.strokeStyle = color; E.ctx.stroke();
        E.ctx.restore();
    }
    function handles(L) {
        const box = E.contentBox(L);
        if (!box) return [];
        const dpr = E.dprNow();
        const [x0, y0, x1, y1] = box, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const out = [];
        for (const [hx, hy] of [[x0, y0], [mx, y0], [x1, y0], [x1, my], [x1, y1], [mx, y1], [x0, y1], [x0, my]]) {
            const [ix, iy] = E.layerToImg(L, hx, hy), [sx, sy] = E.toScr(ix, iy);
            out.push({ kind: "scale", lx: hx, ly: hy, ax: hx === x0 ? x1 : hx === x1 ? x0 : hx, ay: hy === y0 ? y1 : hy === y1 ? y0 : hy,
                       ex: hx !== mx, ey: hy !== my, x: sx, y: sy });
        }
        const [tx, ty] = E.toScr(...E.layerToImg(L, mx, y0)), [cx, cy] = E.toScr(...E.layerToImg(L, mx, my));
        const len = Math.hypot(tx - cx, ty - cy) || 1;
        out.push({ kind: "rotate", x: tx + (tx - cx) / len * 22 * dpr, y: ty + (ty - cy) / len * 22 * dpr });
        return out;
    }

    // ---------------- hit testing ----------------
    function hitLayer(dx, dy) {
        for (let i = E.state.layers.length - 1; i >= 0; i--) {
            const L = E.state.layers[i];
            if (!E.isShown(L)) continue;
            E.hctx.setTransform(1, 0, 0, 1, 0, 0);
            E.hctx.clearRect(0, 0, 1, 1);
            drawLayerOn(E.hctx, L, null, [1, 0, 0, 1, -dx, -dy]);
            if (E.hctx.getImageData(0, 0, 1, 1).data[3] > 0) return L;
        }
        return null;
    }
    function insideBox(L, ix, iy) {
        const box = E.contentBox(L);
        if (!box) return false;
        const [lx, ly] = E.imgToLayer(L, ix, iy), [x0, y0, x1, y1] = box;
        return lx >= x0 && lx <= x1 && ly >= y0 && ly <= y1;
    }
    const snapV = (v) => (E.snap ? Math.round(v / E.grid) * E.grid : v); E.snapV = snapV;

    // ---------------- region label map (what the outputs will contain, at reduced size) -------------
    // 0 = blank (empty or unspecified), k = region index + 1; blended edges go to the nearest color
    // which region each pixel shows (small copy of the image): every layer is drawn on its own, in stack
    // order, and its solid pixels (alpha >= 128) take its region's number (Unspecified layers set 0), as
    // the Python side does. Not read back from colors: where two regions meet, the blended edge pixels
    // could match a third region's color and give it pixels it doesn't have.
    function labelMap(maxSide) {
        const [W, H] = E.dims();
        const r = Math.min(1, maxSide / Math.max(W, H));
        const w = Math.max(1, Math.round(W * r)), h = Math.max(1, Math.round(H * r));
        const t = document.createElement("canvas"); t.width = w; t.height = h;
        const x = t.getContext("2d", { willReadFrequently: true });
        const saved = E.view;
        E.view = { z: r, x: 0, y: 0 };
        const lab = new Int16Array(w * h);
        const kOf = new Map(E.state.regions.map((rg, k) => [rg.id, k + 1]));
        const pending = E.drag?.mode === "paint" && !E.drag.target ? E.drag.layer : null;
        let list = E.state.layers;
        if (pending) { list = [...E.state.layers]; list.splice(E.slotFor(pending.region), 0, pending); }
        try {
            for (const L of list) {
                if (!E.isShown(L)) continue;
                const k = L.region === UNSPEC ? 0 : kOf.get(L.region);
                if (k == null) continue;
                const extra = E.drag?.mode === "paint" && (E.drag.target === L || L === pending) ? E.drag.op : null;
                x.setTransform(1, 0, 0, 1, 0, 0);
                x.clearRect(0, 0, w, h);
                drawLayerOn(x, L, extra, undefined, "#ffffff");
                fadeLayerOn(x, L);                         // a gradient layer counts where it is at least half strength
                const d = x.getImageData(0, 0, w, h).data;
                for (let i = 0, j = 3; i < lab.length; i++, j += 4) if (d[j] >= 128) lab[i] = k;
            }
        } finally {
            E.view = saved;
        }
        return { w, h, r, lab };
    }
    // output index of every region: position among the regions that have visible pixels
    // (Python skips empty regions), or null. Image colors count as present after a run.
    E.detectedSet = new Set();
    function outputIndexMap() {
        const present = new Set(regionLabelBoxes().map((b) => b.k));
        let n = 0;
        return E.state.regions.map((r, k) =>
            !r.hidden && (present.has(k) || r.fromImage || E.detectedSet.has(r.color.toUpperCase())) ? n++ : null);
    }
    E.idxKey = "";
    function updateRegionIndices(map) {
        map = map || outputIndexMap();
        E.syncLayoutBtn(map.some((v) => v != null));
        const key = map.join(",") + "|" + E.state.regions.map((r) => r.id).join(",");
        if (key === E.idxKey && E.regList.querySelector(".rg-idx[data-k]")) return;
        E.idxKey = key;
        for (const sp of E.regList.querySelectorAll(".rg-idx[data-k]")) {
            const v = map[Number(sp.dataset.k)];
            sp.textContent = v == null ? "–" : String(v);
            sp.classList.toggle("none", v == null);
            sp.title = v == null ? (E.state.regions[Number(sp.dataset.k)]?.hidden ? "Hidden, so this region is not in the outputs"
                : "No visible pixels yet, so this region is not in the outputs")
                : `Output index ${v}: masks, bboxes, elements, layouts and Mask Picker / BBoxes to Masks 'index'`;
        }
    }
    let labelCache = { t: 0, key: "", boxes: [] };
    E.labelRects = []; E.labelClick = null;                     // drawn label boxes (canvas pixels), bottom to top
    function regionLabelBoxes() {
        const now = performance.now();
        const key = E.version + "|" + E.dims().join("x");
        const busy = !!E.drag;
        if (labelCache.key === key && !busy) return labelCache.boxes;
        if (busy && now - labelCache.t < 150) return labelCache.boxes;
        const { w, h, r, lab } = labelMap(256);
        const n = E.state.regions.length;
        const bx = Array.from({ length: n }, () => [Infinity, Infinity, -Infinity, -Infinity]);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const k = lab[y * w + x] - 1;
            if (k < 0) continue;
            const b = bx[k];
            if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
        }
        const boxes = [];
        bx.forEach((b, k) => { if (isFinite(b[0])) boxes.push({ k, x0: b[0] / r, y0: b[1] / r, x1: (b[2] + 1) / r, y1: (b[3] + 1) / r }); });
        labelCache = { t: now, key, boxes };
        return boxes;
    }
    function wrapText(c, text, maxW, maxLines) {
        const words = text.split(/\s+/).filter(Boolean), lines = [];
        let cur = "";
        for (const wd of words) {
            const t = cur ? cur + " " + wd : wd;
            if (c.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = wd; }
            if (lines.length === maxLines) break;
        }
        if (lines.length < maxLines && cur) lines.push(cur);
        if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
            let last = lines[maxLines - 1];
            while (last.length > 1 && c.measureText(last + "…").width > maxW) last = last.slice(0, -1);
            lines[maxLines - 1] = last + "…";
        }
        return lines.map((l) => { let t = l; while (t.length > 1 && c.measureText(t).width > maxW) t = t.slice(0, -1); return t === l ? l : t + "…"; });
    }
    // keep labels from overlapping: each sits at the centre of its region's visible pixels unless that spot
    // is taken by a label placed earlier (from the top of the region list down); then it moves
    // to the nearest free spot, preferring spots still over its own region. Recomputed every frame, so
    // labels slide back home as soon as there's room.
    function placeLabels(items, bounds) {
        const m = 3 * E.dprNow(), placed = [];
        const hits = (x, y, it) => placed.find((p) => x < p.x + p.w + m && x + it.w + m > p.x && y < p.y + p.h + m && y + it.h + m > p.y);
        const clamp = (x, y, it) => {
            if (it.w <= bounds.x1 - bounds.x0) x = Math.max(bounds.x0, Math.min(bounds.x1 - it.w, x));
            if (it.h <= bounds.y1 - bounds.y0) y = Math.max(bounds.y0, Math.min(bounds.y1 - it.h, y));
            return [x, y];
        };
        for (const it of items) {
            let [x, y] = clamp(it.dx, it.dy, it);
            if (hits(x, y, it)) {
                // spots touching each placed label, first and second order, plus a coarse ring
                const first = [];
                for (const p of placed) first.push([it.dx, p.y - it.h - m], [it.dx, p.y + p.h + m], [p.x - it.w - m, it.dy], [p.x + p.w + m, it.dy]);
                const cands = [...first];
                for (const [cx, cy] of first) for (const p of placed) cands.push([cx, p.y - it.h - m], [cx, p.y + p.h + m], [p.x - it.w - m, cy], [p.x + p.w + m, cy]);
                for (let r = 1; r <= 6; r++) for (const [ax, ay] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]])
                    cands.push([it.dx + ax * r * (it.w / 2 + m), it.dy + ay * r * (it.h + m)]);
                let best = null;
                for (const c of cands) {
                    const [cx, cy] = clamp(c[0], c[1], it);
                    const ccx = cx + it.w / 2, ccy = cy + it.h / 2;
                    const outside = ccx < it.rx0 || ccx > it.rx1 || ccy < it.ry0 || ccy > it.ry1 ? 1 : 0;
                    const d = (cx - it.dx) ** 2 + (cy - it.dy) ** 2;
                    if (best && (outside > best.o || (outside === best.o && d >= best.d))) continue;
                    if (hits(cx, cy, it)) continue;
                    best = { x: cx, y: cy, o: outside, d };
                }
                if (best) { x = best.x; y = best.y; }
            }
            it.x = x; it.y = y;
            placed.push(it);
        }
    }
    function drawLabels() {
        if (E.node.properties?.rg_labels === false) return;
        const dpr = E.dprNow();
        E.ctx.save();
        E.ctx.font = `${11 * dpr}px sans-serif`;
        E.ctx.textBaseline = "top";
        const imap = outputIndexMap();
        const lh = 13 * dpr, pad = 4 * dpr;
        // measure every label at its preferred spot
        const items = [];
        for (const b of regionLabelBoxes()) {
            const rg = E.state.regions[b.k];
            if (!rg) continue;
            let text = (E.filledFor("r" + rg.id, rg.prompt) ?? rg.prompt).trim() || "(no prompt)";
            if (rg.type === "text" && rg.text) text += `  "${rg.text}"`;
            if (rg.type === "character") text = "👤 " + text;
            if (rg.keep && E.isEdit()) text = "🔒 " + text;            // Edit Mode: kept as it is in the source
            const [cx, cy] = E.toScr((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
            const [rx0, ry0] = E.toScr(b.x0, b.y0), [rx1, ry1] = E.toScr(b.x1, b.y1);
            const regionW = (b.x1 - b.x0) * E.view.z;
            const maxW = Math.max(70 * dpr, Math.min(200 * dpr, regionW * 0.9));
            const lines = wrapText(E.ctx, text, maxW, 3);
            const tw = Math.max(...lines.map((l) => E.ctx.measureText(l).width));
            const bw = tw + pad * 2, bh = lines.length * lh + pad * 2 - 2 * dpr;
            const num = imap[b.k] == null ? "" : String(imap[b.k]);
            E.ctx.font = `bold ${11 * dpr}px sans-serif`;
            const nw = num ? Math.max(lh + 2 * dpr, E.ctx.measureText(num).width + pad * 2) : 0, gap = num ? 2 * dpr : 0;
            E.ctx.font = `${11 * dpr}px sans-serif`;
            const w = nw + gap + bw;
            items.push({ k: b.k, rg, lines, num, nw, gap, bw, w, h: bh, dx: cx - w / 2, dy: cy - bh / 2, rx0, ry0, rx1, ry1 });
        }
        // place from the top of the region list down (not by selection, so labels don't jump when you click)
        const prio = [...items].sort((a, b) => a.k - b.k);
        const [W, H] = E.dims();
        const [ix0, iy0] = E.toScr(0, 0), [ix1, iy1] = E.toScr(W, H);
        placeLabels(prio, { x0: Math.max(0, ix0), y0: Math.max(0, iy0), x1: Math.min(E.cv.width, ix1), y1: Math.min(E.cv.height, iy1) });
        // draw from the bottom of the list up, active region last (on top)
        const order = [...items].sort((a, b) => b.k - a.k);
        const act = order.findIndex((it) => it.rg.id === E.curRegion);
        if (act >= 0) order.push(order.splice(act, 1)[0]);
        E.labelRects = [];
        for (const it of order) {
            const { rg, lines, num, nw, gap, bw, h: bh } = it;
            const x0 = it.x + nw + gap, y0 = it.y;
            if (num) {                                   // index badge right before the prompt box
                const shown = E.colorOf(rg.id), [rr, gg, bb] = hexRgb(shown);
                E.ctx.globalAlpha = 0.9; E.ctx.fillStyle = shown; E.ctx.fillRect(it.x, y0, nw, bh);
                E.ctx.globalAlpha = 1; E.ctx.strokeStyle = "#fff"; E.ctx.lineWidth = 1.5 * dpr; E.ctx.strokeRect(it.x, y0, nw, bh);
                E.ctx.fillStyle = rr * 0.299 + gg * 0.587 + bb * 0.114 > 140 ? "#000" : "#fff";
                E.ctx.font = `bold ${11 * dpr}px sans-serif`; E.ctx.textAlign = "center";
                E.ctx.fillText(num, it.x + nw / 2, y0 + (bh - 11 * dpr) / 2);
                E.ctx.textAlign = "left"; E.ctx.font = `${11 * dpr}px sans-serif`;
            }
            E.labelRects.push({ rid: rg.id, x0: it.x, y0, x1: x0 + bw, y1: y0 + bh });
            const isAct = rg.id === E.curRegion;
            E.ctx.globalAlpha = isAct ? 0.8 : 0.6; E.ctx.fillStyle = "#000"; E.ctx.fillRect(x0, y0, bw, bh);
            E.ctx.globalAlpha = 1; E.ctx.strokeStyle = E.colorOf(rg.id); E.ctx.lineWidth = 1.5 * dpr; E.ctx.strokeRect(x0, y0, bw, bh);
            E.ctx.fillStyle = rg.prompt.trim() ? "#fff" : "rgba(255,255,255,.6)";
            lines.forEach((l, i) => E.ctx.fillText(l, x0 + pad, y0 + pad + i * lh));
        }
        E.ctx.restore();
    }
}
