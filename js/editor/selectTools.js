// Fill, magic wand, Select object (SAM 3.1) and Arrange (flip, align, grow / shrink).
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { api } from "../../../scripts/api.js";
import { getSetting, SET } from "../rg_shared.js";
import { LASSO_MODES, TOOL_NUMS, UNSPEC, RASTER_MAX } from "./shared.js";
import { distanceMap, growMask01, encodeRuns, decodeRuns, bitmapCache } from "./geometry.js";
import { hexRgb } from "./colors.js";

export function* selectTools(E) {
    Object.assign(E, {
        gradFill, fillAt, wandAt, edgeMap, pickPointer, pickSettle, pickFind, pickCancel, pickUndo, pickAccept, drawPick,
        flipLayer, alignLayer, growLayer,
    });
    yield;

    // ---------------- fill / magic wand ----------------
    // the working raster for fill, wand and grow: the image at most RASTER_MAX px on its longer side
    function rasterSize() {
        const [W, H] = E.dims(), r = Math.min(1, RASTER_MAX / Math.max(W, H));
        return { W, H, r, w: Math.max(1, Math.round(W * r)), h: Math.max(1, Math.round(H * r)) };
    }
    // label each raster pixel: 0 = blank (empty or unspecified), k = region k (nearest color, so blended edges join a side)
    function regionLabels(R) {
        const { w, h, r } = R;
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const x = c.getContext("2d", { willReadFrequently: true });
        const t = document.createElement("canvas"); t.width = w; t.height = h;
        const saved = E.view;
        E.view = { z: r, x: 0, y: 0 };
        try { E.renderComposite(x, w, h, t, t.getContext("2d")); } finally { E.view = saved; }
        const d = x.getImageData(0, 0, w, h).data;
        const pal = E.state.regions.map((rg) => hexRgb(E.colorOf(rg.id)));
        const lab = new Int16Array(w * h);
        for (let i = 0; i < w * h; i++) {
            if (d[i * 4 + 3] < 128) { lab[i] = 0; continue; }
            const R0 = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2];
            let best = 0, bd = R0 * R0 + G * G + B * B;               // black = unspecified = blank
            for (let k = 0; k < pal.length; k++) {
                const dr = R0 - pal[k][0], dg = G - pal[k][1], db = B - pal[k][2], dd = dr * dr + dg * dg + db * db;
                if (dd < bd) { bd = dd; best = k + 1; }
            }
            lab[i] = best;
        }
        return lab;
    }
    // 4-connected flood from seed over the pixels where ok(i) is true
    function flood(w, h, seed, ok) {
        const mask = new Uint8Array(w * h), stack = [seed];
        mask[seed] = 1;
        while (stack.length) {
            const p = stack.pop(), px = p % w;
            if (px > 0 && !mask[p - 1] && ok(p - 1)) { mask[p - 1] = 1; stack.push(p - 1); }
            if (px < w - 1 && !mask[p + 1] && ok(p + 1)) { mask[p + 1] = 1; stack.push(p + 1); }
            if (p >= w && !mask[p - w] && ok(p - w)) { mask[p - w] = 1; stack.push(p - w); }
            if (p + w < w * h && !mask[p + w] && ok(p + w)) { mask[p + w] = 1; stack.push(p + w); }
        }
        return mask;
    }
    // a raster mask (rasterSize() grid) into the active region: the selected layer when it is that region's
    // plain paint layer, else a new layer called `name`
    function commitMask(R, mask, name, grow1 = true) {
        const { W, H, w, h } = R, s = Math.min(W, H);
        let m = mask;
        if (grow1) {                         // grow by 1 px so it tucks under anti-aliased edges instead of leaving a seam
            m = mask.slice();
            for (let p = 0; p < mask.length; p++) if (mask[p]) {
                const px = p % w;
                if (px > 0) m[p - 1] = 1; if (px < w - 1) m[p + 1] = 1; if (p >= w) m[p - w] = 1; if (p + w < mask.length) m[p + w] = 1;
            }
        }
        if (!m.some((v) => v)) return false;
        const op = { t: "bitmap", e: false, w, h, runs: encodeRuns(m), x0: 0, y0: 0, x1: W / s, y1: H / s };
        E.change(() => {
            const rid = E.ensureRegion();
            const sel = E.selLayer();
            if (sel && sel.region === rid && sel.visible !== false && E.identityFrame(sel)) sel.ops.push(op);
            else { const L = E.newPaintLayer(rid); L.name = `${name} ${L.id}`; L.ops.push(op); E.addLayer(L); }
        });
        return true;
    }
    // gradient fill (round 26): the area the normal Fill would fill from the drag's start, as a layer of its own
    // whose region fades from the start of the drag to its end
    function gradFill(d) {
        const R = rasterSize(), { W, H, w, h, r } = R, [ix, iy] = d.start, s = Math.min(W, H);
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) { E.hint("Gradient fill starts inside the image"); return; }
        if (Math.hypot(d.cur[0] - ix, d.cur[1] - iy) * E.view.z < 4 * E.dprNow()) {
            E.hint(d.kind === "radial" ? "Gradient fill: drag outward from the point where the region is strongest"
                : "Gradient fill: drag a line from where the region is strongest to where it ends");
            return;
        }
        const lab = regionLabels(R);
        const seed = Math.min(h - 1, Math.floor(iy * r)) * w + Math.min(w - 1, Math.floor(ix * r)), want = lab[seed];
        const mask = flood(w, h, seed, (q) => lab[q] === want), m = mask.slice();
        for (let p = 0; p < mask.length; p++) if (mask[p]) {         // 1 px wider, under anti-aliased edges (as commitMask)
            const px = p % w;
            if (px > 0) m[p - 1] = 1; if (px < w - 1) m[p + 1] = 1; if (p >= w) m[p - w] = 1; if (p + w < mask.length) m[p + w] = 1;
        }
        const op = { t: "bitmap", e: false, w, h, runs: encodeRuns(m), x0: 0, y0: 0, x1: W / s, y1: H / s };
        E.change(() => {
            const rid = E.ensureRegion(), L = E.newPaintLayer(rid);
            L.ops.push(op);
            if (rid !== UNSPEC) { L.name = `Gradient ${L.id}`; L.grad = { k: d.kind, a: [ix / s, iy / s], b: [d.cur[0] / s, d.cur[1] / s] }; }
            E.addLayer(L);
        });
    }
    function fillAt(ix, iy) {
        const R = rasterSize(), { W, H, w, h, r } = R;
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) { E.hint("Fill works inside the image"); return; }
        const lab = regionLabels(R);
        const seed = Math.min(h - 1, Math.floor(iy * r)) * w + Math.min(w - 1, Math.floor(ix * r)), want = lab[seed];
        let mask;
        if (LASSO_MODES.fill === "gaps") {
            // close openings: everything that isn't the clicked area is grown by the gap size, the fill can't pass
            // where that closed up; afterwards the fill is grown back by the same amount (only into the clicked area)
            const g = Math.max(1, TOOL_NUMS.fillGap * r);
            const wall = new Uint8Array(w * h);
            for (let i = 0; i < wall.length; i++) wall[i] = lab[i] !== want ? 1 : 0;
            const dw = distanceMap(wall, w, h);
            if (dw[seed] <= g) {
                mask = flood(w, h, seed, (q) => lab[q] === want);
                E.hint("Clicked inside a narrow gap: filled without closing gaps");
            } else {
                const core = flood(w, h, seed, (q) => dw[q] > g);
                const dc = distanceMap(core, w, h);
                mask = new Uint8Array(w * h);
                for (let i = 0; i < mask.length; i++) mask[i] = lab[i] === want && dc[i] <= g + 1 ? 1 : 0;
            }
        } else {
            mask = flood(w, h, seed, (q) => lab[q] === want);
        }
        commitMask(R, mask, "Fill");
    }
    // the image under the canvas at raster size (cached per image and size); null without one
    let bdPix = null;
    function backdropPixels(R) {
        if (!E.backdrop || !E.backdrop.naturalWidth) return null;
        const key = `${E.backdropKey}|${R.w}x${R.h}`;
        if (bdPix?.key === key) return bdPix.data;
        try {
            const c = document.createElement("canvas"); c.width = R.w; c.height = R.h;
            const x = c.getContext("2d", { willReadFrequently: true });
            x.drawImage(E.backdrop, 0, 0, R.w, R.h);
            bdPix = { key, data: x.getImageData(0, 0, R.w, R.h).data };
            return bdPix.data;
        } catch (e) { return null; }                          // a cross-origin image can't be read
    }
    const NEEDS_IMAGE = "needs an image under the canvas: connect a Load Image node to 'image' (or run once)"; E.NEEDS_IMAGE = NEEDS_IMAGE;
    function wandAt(ix, iy) {
        const R = rasterSize(), { W, H, w, h, r } = R;
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) { E.hint("The magic wand works inside the image"); return; }
        const d = backdropPixels(R);
        if (!d) { E.hint("Magic wand " + NEEDS_IMAGE); return; }
        const seed = Math.min(h - 1, Math.floor(iy * r)) * w + Math.min(w - 1, Math.floor(ix * r));
        const r0 = d[seed * 4], g0 = d[seed * 4 + 1], b0 = d[seed * 4 + 2], tol = TOOL_NUMS.wandTol;
        const ok = (q) => Math.abs(d[q * 4] - r0) <= tol && Math.abs(d[q * 4 + 1] - g0) <= tol && Math.abs(d[q * 4 + 2] - b0) <= tol;
        let mask;
        if (LASSO_MODES.wand === "global") { mask = new Uint8Array(w * h); for (let i = 0; i < mask.length; i++) mask[i] = ok(i) ? 1 : 0; }
        else mask = flood(w, h, seed, ok);
        commitMask(R, mask, "Wand");
    }
    // edge strength of the image under the canvas (Sobel on luminance, at most 1024 px), for the magnetic lasso
    let edgeCache = null;
    function edgeMap() {
        if (!E.backdrop || !E.backdrop.naturalWidth) return null;
        const [W, H] = E.dims(), k = Math.min(1, 1024 / Math.max(W, H));
        const w = Math.max(3, Math.round(W * k)), h = Math.max(3, Math.round(H * k)), key = `${E.backdropKey}|${w}x${h}`;
        if (edgeCache?.key === key) return edgeCache.edges;
        let d;
        try {
            const c = document.createElement("canvas"); c.width = w; c.height = h;
            const x = c.getContext("2d", { willReadFrequently: true });
            x.drawImage(E.backdrop, 0, 0, w, h);
            d = x.getImageData(0, 0, w, h).data;
        } catch (e) { return null; }
        const lum = new Float32Array(w * h);
        for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        const g = new Float32Array(w * h);
        let max = 0;
        for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
            const i = y * w + xx;
            const gx = lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1];
            const gy = lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1];
            const v = Math.hypot(gx, gy);
            g[i] = v; if (v > max) max = v;
        }
        edgeCache = { key, edges: { g, w, h, k, max } };
        return edgeCache.edges;
    }
    const magnetRadius = () => 12 * E.dprNow() / (E.view?.z || 1); E.magnetRadius = magnetRadius;      // how far (image px) a point is pulled to an edge

    // ---------------- Select object (SAM 3.1 on the server) ----------------
    const samKeep = () => getSetting(SET.samKeep, "keep loaded") !== "unload";
    function pickStart() { E.pick = { id: ++E.pickIds, pts: [], box: null, text: "", masks: [], overlay: null, sent: false }; return E.pick; }
    function stickyHint(text) { clearTimeout(E.hintTimer); E.statusLbl.textContent = text || ""; }
    function pickPointer(d) {
        const [W, H] = E.dims();
        if (!E.backdrop || !E.backdropRef) { E.hint("Select object " + NEEDS_IMAGE); return; }
        if (d.moved >= 5 * E.dprNow()) {                         // a box
            const [x0, y0] = d.start, [x1, y1] = d.cur;
            const b = [Math.max(0, Math.min(x0, x1)), Math.max(0, Math.min(y0, y1)), Math.min(W, Math.max(x0, x1)), Math.min(H, Math.max(y0, y1))];
            if (b[2] - b[0] < 2 || b[3] - b[1] < 2) return;
            if (d.shift && !pickNext()) return;
            if (!E.pick || E.pick.text) pickStart();
            E.pick.box = b;
            E.pick.masks = []; E.pick.overlay = null;
            pickRequest();
            return;
        }
        const [ix, iy] = d.start;
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
        if (E.pick?.text && E.pick.masks.length) {                // found objects: Ctrl+click leaves one out / brings it back
            if (!d.ctrl) { E.hint("Ctrl+click a found object to leave it out; Enter adds them, Esc cancels"); return; }
            const R = E.pick.R, px = Math.min(R.w - 1, Math.floor(ix * R.w / W)), py = Math.min(R.h - 1, Math.floor(iy * R.h / H));
            const hit = E.pick.masks.filter((m) => m.mask[py * R.w + px]);
            if (!hit.length) { E.hint("No found object here"); return; }
            const sm = hit.reduce((a, b) => (a.area <= b.area ? a : b));          // the smallest one under the pointer
            sm.off = !sm.off; E.pick.overlay = null;
            pickCountHint();
            return;
        }
        if (d.shift && !pickNext()) return;
        if (!E.pick) pickStart();
        E.pick.pts.push([ix, iy, d.ctrl ? 0 : 1]);
        pickRequest();
    }
    // Shift+click / Shift+drag: add the selection made so far, then start a new one
    function pickNext() {
        if (!E.pick) return true;
        if (E.pickBusy) { E.hint("Still selecting…"); return false; }
        if (E.pick.masks.some((m) => !m.off)) pickAccept(false); else pickCancel();
        return true;
    }
    // leaving the tool (or the image going away): add what is selected instead of throwing it away
    function pickSettle() {
        if (!E.pick) return;
        if (E.pickBusy || E.pickAgain) { E.pick.acceptOnAnswer = true; return; }
        if (E.pick.masks.some((m) => !m.off)) pickAccept(false); else pickCancel();
    }
    function pickFind(text) {
        if (!E.backdrop || !E.backdropRef) { E.hint("Select object " + NEEDS_IMAGE); return; }
        const box = E.pick && !E.pick.text ? E.pick.box : E.pick?.box;
        pickStart(); E.pick.text = text; E.pick.box = box || null;
        pickRequest();
    }
    function pickCountHint() {
        if (!E.pick) return;
        const on = E.pick.masks.filter((m) => !m.off).length;
        const where = "to the active region";
        if (E.pick.text) stickyHint(E.pick.masks.length ? `Found ${E.pick.masks.length}${on < E.pick.masks.length ? `, ${on} kept` : ""}: Enter or ✓ adds `
            + `them ${where}, Shift+Enter one region each, Ctrl+click leaves one out, Esc discards` : `Nothing found for "${E.pick.text}"`);
        else stickyHint(E.pick.masks.length ? `Enter or ✓: add ${where} · click / Ctrl+click: more points · drag: box · `
            + "Shift+click: add this one and start the next · Backspace: undo · Esc: discard" : "Nothing selected there: try another point or a box");
    }
    async function pickRequest() {
        if (!E.pick) return;
        if (E.pickBusy) { E.pickAgain = true; return; }
        const p = E.pick, R = rasterSize(), [W, H] = E.dims();
        const body = {
            image: E.backdropRef, size: [R.w, R.h], model: getSetting(SET.samModel, "sam3.1_multiplex_fp16.safetensors"),
            keep_loaded: samKeep(), threshold: +getSetting(SET.samThreshold, 0.5) || 0.5,
            points: p.text ? [] : p.pts.map(([x, y, l]) => [x / W, y / H, l]),
            box: p.box ? [p.box[0] / W, p.box[1] / H, p.box[2] / W, p.box[3] / H] : null,
            text: p.text || "",
        };
        if (!body.points.length && !body.box && !body.text) { p.masks = []; p.overlay = null; pickCountHint(); E.requestDraw(); return; }
        E.pickBusy = true; p.sent = true;
        let retrying = false;
        stickyHint(E.samUsed ? (p.text ? "Finding…" : "Selecting…") : "Loading SAM 3.1 (the first selection takes a few seconds)…");
        try {
            const r = await api.fetchApi("/region_genie/sam_select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            const j = await r.json().catch(() => ({}));
            if (E.pick !== p) return;
            if (j.code === "busy") {
                stickyHint("Select object waits while a workflow is running…");
                retrying = true;
                setTimeout(() => { if (E.pick === p) pickRequest(); }, 2000);
                return;
            }
            if (!r.ok || j.error) { stickyHint(""); E.showMsg(j.error || `Select object failed (${r.status})`); return; }
            E.hideMsg();
            E.samUsed = true;
            p.R = { w: j.w, h: j.h };
            p.masks = (j.masks || []).map((m) => ({ mask: decodeRuns(m.runs, j.w * j.h), box: m.box, score: m.score, label: m.label || "", area: m.area || 0, off: false }));
            p.overlay = null;
            pickCountHint();
        } catch (e) {
            if (E.pick === p) { stickyHint(""); E.showMsg("Select object: no answer from the server (" + (e?.message || e) + ")"); }
        } finally {
            E.pickBusy = false;
            E.requestDraw();
            if (E.pickAgain) { E.pickAgain = false; pickRequest(); }
            else if (!retrying && E.pick === p && p.acceptOnAnswer) pickSettle();
        }
    }
    function pickRelease() {
        api.fetchApi("/region_genie/sam_release", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keep_loaded: samKeep() }) }).catch(() => {});
    }
    function pickCancel() {
        const sent = E.pick?.sent;
        E.pick = null; E.pickAgain = false;
        stickyHint("");
        if (sent) pickRelease();
        E.requestDraw();
    }
    function pickUndo() {
        if (!E.pick) return;
        if (E.pick.text) { pickCancel(); return; }
        if (E.pick.pts.length) E.pick.pts.pop(); else E.pick.box = null;
        if (!E.pick.pts.length && !E.pick.box) { pickCancel(); return; }
        pickRequest();
    }
    function pickAccept(each) {
        if (!E.pick) return;
        if (E.pickBusy) { E.hint("Still selecting…"); return; }
        const on = E.pick.masks.filter((m) => !m.off);
        if (!on.length) { E.hint("Nothing selected yet"); return; }
        const R = { ...rasterSize(), w: E.pick.R.w, h: E.pick.R.h };
        const sent = E.pick.sent;
        const [W, H] = E.dims(), s = Math.min(W, H);
        const asRegion = (mask, prompt) => {                    // one new region with the mask as its layer
            const rg = E.newRegion();
            rg.prompt = prompt || "";
            const L = E.newPaintLayer(rg.id);
            L.name = `Object ${L.id}`;
            L.ops.push({ t: "bitmap", e: false, w: R.w, h: R.h, runs: encodeRuns(growMask01(mask, R.w, R.h, 1)), x0: 0, y0: 0, x1: W / s, y1: H / s });
            E.addLayer(L);
            return rg;
        };
        const union = () => {
            const u = new Uint8Array(R.w * R.h);
            for (const m of on) for (let i = 0; i < u.length; i++) if (m.mask[i]) u[i] = 1;
            return u;
        };
        if (each && E.pick.text && on.length > 1) {
            E.change(() => { for (const m of on.slice().reverse()) asRegion(m.mask, m.label || E.pick.text); });   // the best match ends up on top
            E.hint(`Added ${on.length} regions`);
        } else {
            if (commitMask(R, union(), "Object")) E.hint(on.length > 1 ? `Added ${on.length} objects` : "Added the object");
        }
        E.pick = null; E.pickAgain = false;
        if (sent) pickRelease();
        if (E.findIn.value) E.findIn.value = "";
        E.requestDraw();
    }
    function drawPick(ix, iy, iw, ih) {
        const dpr = E.dprNow();
        E.ctx.save();
        if (E.pick?.masks.length) {
            if (!E.pick.overlay) {
                const { w, h } = E.pick.R, c = document.createElement("canvas"); c.width = w; c.height = h;
                const x = c.getContext("2d"), img = x.createImageData(w, h), d = img.data;
                const [cr, cg, cb] = hexRgb(E.colorOf(E.curRegion) || "#5b8fd0");
                for (const m of E.pick.masks) {
                    const [r, g, b, a] = m.off ? [128, 128, 128, 70] : [cr, cg, cb, 150];
                    for (let i = 0; i < w * h; i++) if (m.mask[i]) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a; }
                }
                x.putImageData(img, 0, 0);
                E.pick.overlay = c;
            }
            E.ctx.imageSmoothingEnabled = false;
            E.ctx.drawImage(E.pick.overlay, ix, iy, iw, ih);
        }
        E.ctx.setLineDash([5 * dpr, 4 * dpr]); E.ctx.lineWidth = 1.5 * dpr; E.ctx.strokeStyle = "#fff";
        const rect = (b) => { const [a0, b0] = E.toScr(b[0], b[1]), [a1, b1] = E.toScr(b[2], b[3]); E.ctx.strokeRect(a0, b0, a1 - a0, b1 - b0); };
        if (E.drag?.mode === "pickbox" && E.drag.moved >= 5 * dpr) rect([...E.drag.start, ...E.drag.cur]);
        else if (E.pick?.box) rect(E.pick.box);
        E.ctx.setLineDash([]);
        for (const [x, y, l] of E.pick?.pts || []) {
            const [a, b] = E.toScr(x, y);
            E.ctx.beginPath(); E.ctx.arc(a, b, 5 * dpr, 0, Math.PI * 2);
            E.ctx.fillStyle = l ? "#2fbf5b" : "#e0463c"; E.ctx.fill();
            E.ctx.lineWidth = 1.5 * dpr; E.ctx.strokeStyle = "#fff"; E.ctx.stroke();
        }
        E.ctx.restore();
    }

    // ---------------- arrange: flip, align, grow / shrink ----------------
    function mirrorOps(L, axis, c) {                 // mirror the layer's ops in its own frame: x -> c - x (or y)
        const i = axis === "h" ? 0 : 1;
        if (L.grad) for (const q of [L.grad.a, L.grad.b]) q[i] = c - q[i];
        for (const o of L.ops) {
            if (o.t === "bitmap") {
                const { w, h } = o, src = decodeRuns(o.runs, w * h), out = new Uint8Array(w * h);
                for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                    if (src[y * w + x]) out[i === 0 ? y * w + (w - 1 - x) : (h - 1 - y) * w + x] = 1;
                }
                o.runs = encodeRuns(out);
                if (i === 0) [o.x0, o.x1] = [c - o.x1, c - o.x0]; else [o.y0, o.y1] = [c - o.y1, c - o.y0];
                bitmapCache.delete(o);
            } else if (Array.isArray(o.p)) {
                o.p = o.p.map((q) => { const n = q.slice(); n[i] = c - n[i]; return n; });
            }
        }
    }
    function flipLayer(L, axis) {
        E.change(() => {
            E.boxCache.delete(L);
            if (L.shape) {
                // shapes are mirror-symmetric left-right: a flip mirrors the ops; upside down = turned 180° + mirrored
                if (axis === "v") L.rot = ((L.rot + 180 + 180) % 360) - 180;
                mirrorOps(L, "h", L.bw);
            } else {
                const b = E.contentBox(L);
                if (!b) return;
                mirrorOps(L, axis, axis === "h" ? b[0] + b[2] : b[1] + b[3]);
            }
            E.boxCache.delete(L);
        });
    }
    function alignLayer(L, how) {
        const cs = E.boxCornersImg(L);
        if (!cs) return;
        const [W, H] = E.dims(), s = Math.min(W, H);
        const x0 = Math.min(...cs.map((c) => c[0])), x1 = Math.max(...cs.map((c) => c[0]));
        const y0 = Math.min(...cs.map((c) => c[1])), y1 = Math.max(...cs.map((c) => c[1]));
        let dx = 0, dy = 0;
        if (how === "l") dx = -x0; else if (how === "r") dx = W - x1; else if (how === "ch" || how === "c") dx = W / 2 - (x0 + x1) / 2;
        if (how === "t") dy = -y0; else if (how === "b") dy = H - y1; else if (how === "cv" || how === "c") dy = H / 2 - (y0 + y1) / 2;
        if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
        E.change(() => { L.ox += dx / s; L.oy += dy / s; });
    }
    // grow (px > 0) or shrink the layer's pixels; the layer becomes a plain paint layer (pixels) covering the image
    function growLayer(L, px) {
        const R = rasterSize(), { W, H, w, h, r } = R, s = Math.min(W, H);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const x = c.getContext("2d", { willReadFrequently: true });
        const saved = E.view;
        E.view = { z: r, x: 0, y: 0 };
        try { E.drawLayerOn(x, L, null, null, "#ffffff"); } finally { E.view = saved; }
        const d = x.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
        for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
        const out = growMask01(m, w, h, px * r);
        // a gradient stays where it is on the image (the layer's frame becomes the whole image below)
        const grad = L.grad ? { k: L.grad.k, a: E.layerToImg(L, ...L.grad.a).map((v) => v / s), b: E.layerToImg(L, ...L.grad.b).map((v) => v / s) } : null;
        E.change(() => {
            E.boxCache.delete(L);
            if (grad) L.grad = grad;
            Object.assign(L, { shape: null, sides: 5, bw: W / s, bh: H / s, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0,
                ops: out.some((v) => v) ? [{ t: "bitmap", e: false, w, h, runs: encodeRuns(out), x0: 0, y0: 0, x1: W / s, y1: H / s }] : [] });
            delete L.radius;
        });
    }
}
