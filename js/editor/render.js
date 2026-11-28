// Drawing the canvas, hit testing, and the region label map (what the outputs will contain).
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { UNSPEC } from "./shared.js";
import { shapeVerts, bitmapCanvas } from "./geometry.js";
import { hexRgb } from "./colors.js";
import { LABEL_MARKS, accentColor } from "../rg_shared.js";

// The marks before a label's prompt (a person: a character region; a lock: kept as it is in Edit Mode): filled
// shapes in the label's text color, MARK_SIZE px tall at 100 %, MARK_STEP px from one to the next / to the text.
const MARK_SIZE = 11, MARK_STEP = 14;
const markPaths = {};
function drawLabelMark(ctx, name, x, y, size, color) {
    const m = LABEL_MARKS[name];
    if (!m || typeof Path2D === "undefined") return;
    const p = markPaths[name] || (markPaths[name] = { fill: new Path2D(m.fill), stroke: m.stroke ? new Path2D(m.stroke) : null });
    ctx.save();
    ctx.translate(x, y); ctx.scale(size / 16, size / 16);
    ctx.fillStyle = color; ctx.fill(p.fill);
    if (p.stroke) { ctx.strokeStyle = color; ctx.lineWidth = m.width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(p.stroke); }
    ctx.restore();
}

// The edge lines of the see-through regions (see edgeLines below), drawn by the graphics card. One WebGL canvas for
// the whole page (browsers allow only a few), made on first use.
// It gets the regions' own shapes, three to a picture (one in red, one in green, one in blue: renderPlanes), front
// region first, and for every pixel and region works out: how much of the region is here (m), how much of it is left
// a line's width around (e, the least of m on up to three rings of twelve points; outside the image there is none),
// and how much the regions in front leave visible. The line is the region's color where m - e is not zero.
// So a region is outlined along its own shape only: where another region lies on top of it there is no line (its
// shape goes on underneath), two regions that only touch both keep theirs, and a line wider than the shape fills it.
// The shapes' smooth rims give smooth lines. run() returns null when WebGL can't be used.
const EDGE_GL = (() => {
    const MAXT = 8;                                  // textures: 3 regions each (EDGE_MAX_REGIONS)
    let cv = null, gl = null, prog = null, texs = [], loc = null, dead = false;
    const VS = "attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
    const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
        #else
        precision mediump float;
        #endif
        varying vec2 uv; uniform sampler2D t0, t1, t2, t3, t4, t5, t6, t7;
        uniform vec2 size; uniform float k; uniform vec4 box; uniform int n; uniform int rings; uniform vec3 col[24];
        vec3 plane(int ti, vec2 q){
            if (ti == 0) return texture2D(t0, q).rgb; if (ti == 1) return texture2D(t1, q).rgb; if (ti == 2) return texture2D(t2, q).rgb;
            if (ti == 3) return texture2D(t3, q).rgb; if (ti == 4) return texture2D(t4, q).rgb; if (ti == 5) return texture2D(t5, q).rgb;
            if (ti == 6) return texture2D(t6, q).rgb; return texture2D(t7, q).rgb; }
        float chan(vec3 v, int c){ return c == 0 ? v.r : (c == 1 ? v.g : v.b); }
        float at(int ti, int c, vec2 px){
            if (px.x < 0.0 || px.y < 0.0 || px.x >= box.z || px.y >= box.w) return 0.0;
            return chan(plane(ti, vec2((px.x + box.x) / size.x, 1.0 - (px.y + box.y) / size.y)), c); }
        void main(){
            vec2 px = vec2(uv.x * size.x, (1.0 - uv.y) * size.y) - box.xy;
            if (px.x < 0.0 || px.y < 0.0 || px.x >= box.z || px.y >= box.w) { gl_FragColor = vec4(0.0); return; }
            float open = 1.0; vec4 acc = vec4(0.0);
            for (int i = 0; i < 24; i++) {
                if (i >= n) break;
                int ti = i / 3; int c = i - ti * 3;
                float m = chan(plane(ti, uv), c);
                if (m * open > 0.004) {
                    float e = m;
                    for (int r = 0; r < 3; r++) {
                        if (r >= rings) break;
                        float rad = k * float(r + 1) / float(rings);
                        for (int a = 0; a < 12; a++) {
                            float ang = float(a) * 0.5235988 + float(r) * 0.2617994;
                            e = min(e, at(ti, c, px + rad * vec2(cos(ang), sin(ang))));
                            if (e < 0.004) break;
                        }
                    }
                    acc += vec4(col[i], 1.0) * (open * (m - e));
                }
                open *= 1.0 - m;
            }
            gl_FragColor = clamp(acc, 0.0, 1.0); }`;
    function init() {
        cv = document.createElement("canvas");
        cv.addEventListener("webglcontextlost", (e) => { e.preventDefault(); gl = null; });     // made again at the next run
        gl = cv.getContext("webgl", { premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
        if (!gl) { dead = true; return; }
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const p = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        texs = [];
        for (let j = 0; j < MAXT; j++) {
            const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + j); gl.bindTexture(gl.TEXTURE_2D, tex);
            for (const [n, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, n, v);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
            gl.uniform1i(gl.getUniformLocation(prog, "t" + j), j);
            texs.push(tex);
        }
        loc = {}; for (const u of ["size", "k", "box", "n", "rings", "col"]) loc[u] = gl.getUniformLocation(prog, u);
    }
    return { run(planes, colors, w, h, k, box) {
        if (dead || !planes.length || planes.length > MAXT) return null;
        try {
            if (!gl || gl.isContextLost()) init();
            if (!gl) return null;
            const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            if (w > max || h > max) return null;
            if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
            gl.viewport(0, 0, w, h);
            planes.forEach((pl, j) => { gl.activeTexture(gl.TEXTURE0 + j); gl.bindTexture(gl.TEXTURE_2D, texs[j]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pl); });
            const col = new Float32Array(72); colors.forEach((c, i) => { col[i * 3] = c[0] / 255; col[i * 3 + 1] = c[1] / 255; col[i * 3 + 2] = c[2] / 255; });
            gl.uniform2f(loc.size, w, h); gl.uniform1f(loc.k, k); gl.uniform4f(loc.box, box[0], box[1], box[2], box[3]);
            gl.uniform1i(loc.n, colors.length); gl.uniform1i(loc.rings, k <= 3 ? 1 : k <= 10 ? 2 : 3); gl.uniform3fv(loc.col, col);
            gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            return cv;
        } catch (e) { console.warn("[Region Genie] edge lines: WebGL failed, using the simple lines", e); dead = true; return null; }
    } };
})();
const EDGE_MAX_REGIONS = 24;                         // the front ones get a line; a canvas with more is very rare

export function* render(E) {
    Object.assign(E, {
        paintLocal, drawLayerOn, renderComposite, requestDraw, handles, hitLayer, hitLayers, insideBox, outputIndexMap, updateRegionIndices,
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
    // The regions' edge lines, drawn solid while their fill is see-through (how: EDGE_GL at the top of this file).
    // renderPlanes draws what EDGE_GL needs: every shown region's own whole shape (all its layers, also the parts
    // other regions cover), the front region first, three regions to a canvas: one adds red, one green, one blue,
    // on black. A layer with erased parts or a fade is drawn by itself first, like in renderComposite.
    const planes = [], regScr = document.createElement("canvas"), layScr = document.createElement("canvas");
    let regCtx = null, layCtx = null;
    const CHANNEL = ["#ff0000", "#00ff00", "#0000ff"];
    function renderPlanes(w, h) {
        const pending = E.drag?.mode === "paint" && !E.drag.target ? E.drag.layer : null;
        let list = E.state.layers;
        if (pending) { list = [...E.state.layers]; list.splice(E.slotFor(pending.region), 0, pending); }
        const order = [];                                            // region ids, front first
        for (let i = list.length - 1; i >= 0; i--) { const L = list[i]; if (E.isShown(L) && E.colorOf(L.region) && !order.includes(L.region)) order.push(L.region); }
        order.length = Math.min(order.length, EDGE_MAX_REGIONS);
        const used = Math.ceil(order.length / 3);
        while (planes.length < used) { const c = document.createElement("canvas"); planes.push({ c, x: c.getContext("2d") }); }
        for (const c of [regScr, layScr]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        regCtx = regCtx || regScr.getContext("2d"); layCtx = layCtx || layScr.getContext("2d");
        for (let j = 0; j < used; j++) {
            const { c, x } = planes[j];
            if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
            x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.fillStyle = "#000"; x.fillRect(0, 0, w, h);
        }
        const extraOf = (L) => (E.drag?.mode === "paint" && (E.drag.target === L || L === pending) ? E.drag.op : null);
        const plain = (L) => !L.ops.length && !extraOf(L) && !L.grad;      // a bare shape: nothing in it changes how the canvas adds things up
        order.forEach((rid, r) => {
            const x = planes[Math.floor(r / 3)].x, color = CHANNEL[r % 3], lays = list.filter((L) => L.region === rid && E.isShown(L));
            x.globalCompositeOperation = "lighter";
            if (lays.every(plain)) { for (const L of lays) drawLayerOn(x, L, null, undefined, color); x.setTransform(1, 0, 0, 1, 0, 0); return; }
            regCtx.setTransform(1, 0, 0, 1, 0, 0); regCtx.globalCompositeOperation = "source-over"; regCtx.clearRect(0, 0, w, h);
            for (const L of lays) {
                const extra = extraOf(L);
                if (!L.ops.some((o) => o.e) && !extra?.e && !L.grad) { drawLayerOn(regCtx, L, extra, undefined, color); regCtx.globalCompositeOperation = "source-over"; continue; }
                layCtx.setTransform(1, 0, 0, 1, 0, 0); layCtx.globalCompositeOperation = "source-over"; layCtx.clearRect(0, 0, w, h);
                drawLayerOn(layCtx, L, extra, undefined, color); fadeLayerOn(layCtx, L);
                regCtx.setTransform(1, 0, 0, 1, 0, 0); regCtx.drawImage(layScr, 0, 0);
            }
            x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(regScr, 0, 0);
        });
        return { canvases: planes.slice(0, used).map((p) => p.c), colors: order.map((rid) => hexRgb(E.colorOf(rid))) };
    }
    // Without WebGL the lines are simpler (simpleLines): found in the finished picture, so stepped, and a region's line
    // also follows the edge of a region lying on top of it.
    const edgeCv = document.createElement("canvas"), edgeCtx = edgeCv.getContext("2d");
    const flatCv = document.createElement("canvas"), flatScr = document.createElement("canvas");
    let flatCtx = null, flatSctx = null;
    function edgeLines(w, h, dpr, box) {             // box: the image's rectangle on the canvas (only that part gets lines)
        const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
        const bw = Math.min(w, Math.ceil(box[0] + box[2])) - x0, bh = Math.min(h, Math.ceil(box[1] + box[3])) - y0;
        const px = E.edgePx();
        if (bw <= 0 || bh <= 0 || px <= 0) return null;
        E.edgeBy = "gl";
        if (!window.__rgNoEdgeGL) {
            const pl = renderPlanes(w, h);
            if (!pl.canvases.length) return null;
            const gl = EDGE_GL.run(pl.canvases, pl.colors, w, h, px * dpr, [box[0], box[1], box[2], box[3]]);
            if (gl) return gl;
        }
        E.edgeBy = "js";
        return simpleLines(w, h, Math.max(1, Math.round(px * dpr)), x0, y0, bw, bh);
    }
    function simpleLines(w, h, k, x0, y0, bw, bh) {
        let flat = E.comp;
        if (E.state.layers.some((L) => L.region === UNSPEC && E.isShown(L)) || (E.drag?.mode === "paint" && E.drag.layer?.region === UNSPEC)) {
            for (const c of [flatCv, flatScr]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
            flatCtx = flatCtx || flatCv.getContext("2d"); flatSctx = flatSctx || flatScr.getContext("2d");
            renderComposite(flatCtx, w, h, flatScr, flatSctx);
            flat = flatCv;
        }
        if (edgeCv.width !== w || edgeCv.height !== h) { edgeCv.width = w; edgeCv.height = h; }
        edgeCtx.clearRect(0, 0, w, h);
        edgeCtx.drawImage(flat, x0, y0, bw, bh, x0, y0, bw, bh);
        const src = edgeCtx.getImageData(x0, y0, bw, bh), s = src.data, s32 = new Uint32Array(s.buffer);
        const out = edgeCtx.createImageData(bw, bh), o32 = new Uint32Array(out.data.buffer);
        const other = (i, j) => {                    // i is drawn (alpha >= 128): is j another color, or empty?
            const a = i * 4, b = j * 4;
            if (s[b + 3] < 128) return true;
            return Math.abs(s[a] - s[b]) + Math.abs(s[a + 1] - s[b + 1]) + Math.abs(s[a + 2] - s[b + 2]) > 36;
        };
        const kw = k * bw;
        for (let y = 0; y < bh; y++) {
            const row = y * bw, up = y >= k, down = y < bh - k;
            for (let x = 0; x < bw; x++) {
                const i = row + x, p = s32[i];
                if ((p >>> 24) < 128) continue;
                if (x < k || x >= bw - k || !up || !down || (s32[i - k] !== p && other(i, i - k)) || (s32[i + k] !== p && other(i, i + k))
                    || (s32[i - kw] !== p && other(i, i - kw)) || (s32[i + kw] !== p && other(i, i + kw))
                    || (s32[i - kw - k] !== p && other(i, i - kw - k)) || (s32[i - kw + k] !== p && other(i, i - kw + k))
                    || (s32[i + kw - k] !== p && other(i, i + kw - k)) || (s32[i + kw + k] !== p && other(i, i + kw + k))) o32[i] = p | 0xff000000;
            }
        }
        edgeCtx.clearRect(0, 0, w, h);
        edgeCtx.putImageData(out, x0, y0);
        return edgeCv;
    }
    let edgeSlow = false, lastEdgeAt = 0, edgeLater = 0, linesKey = "", linesOn = false;
    const linesCv = document.createElement("canvas"), linesCtx = linesCv.getContext("2d");
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
            E.ctx.drawImage(E.backdrop, ix, iy, iw, ih);
        }
        const fill = E.fillNow();
        renderComposite(E.cctx, w, h, E.scratch, E.sctx, undefined, true);
        E.ctx.save();
        E.ctx.beginPath(); E.ctx.rect(ix, iy, iw, ih); E.ctx.clip();
        E.ctx.globalAlpha = fill;
        E.ctx.drawImage(E.comp, 0, 0);
        if (fill < 1) {
            // The lines are kept (linesCv) for as long as nothing they depend on changes: a redraw for another reason
            // (the pointer, a label) reuses them. Where working them out takes long (no graphics card: WebGL done by
            // the processor), they are left out while the canvas changes in quick succession (a drag, a zoom) and
            // drawn once it rests.
            const t0 = performance.now(), px = E.edgePx();
            const key = E.drag || E.clickPoly || E.pick ? "" : `${E.version}|${E.view.z}|${E.view.x}|${E.view.y}|${w}|${h}|${dpr}|${px}|${E.state.layers.length}|${E.state.regions.length}`;
            clearTimeout(edgeLater);
            if (key && key === linesKey) { if (linesOn) { E.ctx.globalAlpha = 1; E.ctx.drawImage(linesCv, 0, 0); } }
            else if (edgeSlow && t0 - lastEdgeAt < 140) { linesKey = ""; edgeLater = setTimeout(() => { lastEdgeAt = 0; requestDraw(); }, 170); }
            else {
                const ed = edgeLines(w, h, dpr, [ix, iy, iw, ih]);
                if (linesCv.width !== w || linesCv.height !== h) { linesCv.width = w; linesCv.height = h; }
                linesCtx.clearRect(0, 0, w, h);
                if (ed) { linesCtx.drawImage(ed, 0, 0); linesCtx.getImageData(0, 0, 1, 1); E.ctx.globalAlpha = 1; E.ctx.drawImage(linesCv, 0, 0); }   // the read makes the time below the real one
                linesKey = key; linesOn = !!ed;
                E.edgeMs = performance.now() - t0;
                edgeSlow = E.edgeMs > 45 ? true : E.edgeMs < 20 ? false : edgeSlow;
                lastEdgeAt = performance.now();          // from the end: a slow one must not look like a pause
            }
        }
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
        if ((E.snap || E.showGrid) && E.grid * E.view.z >= 6) {
            E.ctx.save();
            E.ctx.beginPath(); E.ctx.rect(ix, iy, iw, ih); E.ctx.clip();
            E.ctx.strokeStyle = `rgba(255,255,255,${E.gridAlphaNow()})`; E.ctx.lineWidth = 1;
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
                    E.ctx.fillStyle = i ? "#fff" : accentColor(); E.ctx.fill(); E.ctx.stroke();
                });
            }
            E.ctx.restore();
        }
        if (E.tool !== "pose") drawLabels();              // the figures are edited on top of the regions: no labels in the way
        updateRegionIndices();
        E.drawPoses();
        const L = E.selLayer();
        if (L && E.isShown(L) && E.hiddenSel !== E.selId) {
            const cs = E.boxCornersImg(L);
            if (cs) {
                outline(cs, accentColor(), E.tool !== "select");
                if (E.tool === "select") for (const hd of handles(L)) {
                    E.ctx.fillStyle = hd.kind === "rotate" ? accentColor() : "#fff";
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
        E.undoBtn.disabled = !E.undoStack.length && !E.textDirty; E.redoBtn.disabled = !E.redoStack.length;
        {   // the tooltips say what a click would change (round 100)
            const [u, r] = E.stepWhat();
            const ut = `Undo: ${u || "Nothing to undo"} (Ctrl+Z).`, rt = `Redo: ${r || "Nothing to redo"} (Ctrl+Shift+Z / Ctrl+Y).`;
            if (E.undoBtn.__rgTitle !== ut) E.keyTitle(E.undoBtn, ut);
            if (E.redoBtn.__rgTitle !== rt) E.keyTitle(E.redoBtn, rt);
        }
        E.arrangeBtn.disabled = !E.state.layers.length && !(E.state.poses || []).length;     // (round 102: a region or the whole picture too)
        if (E.arrangeBtn.disabled && E.arrangePop) E.closeArrange();
        else if (E.arrangeStale?.()) E.fillArrange();
        E.clearBtn.disabled = !E.state.layers.length && !E.state.regions.length;
        E.syncOpacity();
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
    function hitLayers(dx, dy, first = false) {          // every shown layer under the point, the top one first
        const out = [];
        for (let i = E.state.layers.length - 1; i >= 0; i--) {
            const L = E.state.layers[i];
            if (!E.isShown(L)) continue;
            E.hctx.setTransform(1, 0, 0, 1, 0, 0);
            E.hctx.clearRect(0, 0, 1, 1);
            drawLayerOn(E.hctx, L, null, [1, 0, 0, 1, -dx, -dy]);
            if (E.hctx.getImageData(0, 0, 1, 1).data[3] > 0) { out.push(L); if (first) break; }
        }
        return out;
    }
    function hitLayer(dx, dy) { return hitLayers(dx, dy, true)[0] || null; }
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
                : `Output index ${v}: Its place in masks, bboxes, elements and the layout JSON in 'prompt'; also the 'index' of Mask Picker / BBoxes to Masks.`;
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
        bx.forEach((b, k) => {
            if (!isFinite(b[0])) return;
            const q = inscribed(lab, w, k + 1, b);
            boxes.push({ k, x0: b[0] / r, y0: b[1] / r, x1: (b[2] + 1) / r, y1: (b[3] + 1) / r,
                         in: { x0: q[0] / r, y0: q[1] / r, x1: q[2] / r, y1: q[3] / r } });
        });
        labelCache = { t: now, key, boxes };
        return boxes;
    }
    // The largest upright rectangle that lies inside one region's visible pixels: [x0, y0, x1, y1] in label map
    // pixels (x1 / y1 exclusive). The region's prompt is written into it, so the text stays inside the region
    // whatever its shape and whatever covers it. (Largest rectangle under a histogram, row by row, inside the
    // region's bounding box b; a rectangle much taller than wide counts less: lines of text need width.)
    function inscribed(lab, w, k1, b) {
        const x0 = b[0], bw = b[2] - b[0] + 1, hgt = new Int32Array(bw + 1), stack = [];
        let best = [x0, b[1], x0 + 1, b[1] + 1], bestScore = 0;
        for (let y = b[1]; y <= b[3]; y++) {
            const row = y * w + x0;
            for (let i = 0; i < bw; i++) hgt[i] = lab[row + i] === k1 ? hgt[i] + 1 : 0;
            stack.length = 0;
            for (let i = 0; i <= bw; i++) {                 // hgt[bw] stays 0 and empties the stack at the row's end
                while (stack.length && hgt[stack[stack.length - 1]] >= hgt[i]) {
                    const hh = hgt[stack.pop()], left = stack.length ? stack[stack.length - 1] + 1 : 0, ww = i - left;
                    const score = ww * hh * Math.min(1, ww / (0.45 * hh));
                    if (score > bestScore) { bestScore = score; best = [x0 + left, y - hh + 1, x0 + i, y + 1]; }
                }
                stack.push(i);
            }
        }
        return best;
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
            if (it.inside) { it.x = it.dx; it.y = it.dy; placed.push(it); continue; }      // written inside its region: stays
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
        // Everything a label is made of is measured in "dpr" here, so one factor sizes it all: the screen's pixel
        // ratio, the text size from Settings (11 px is 1), and the zoom. With the image fitted in view (fitView's
        // zoom) the text has its set size; zoomed in it grows with the image up to the largest size set, zoomed out it
        // stays at its size.
        const [fw, fh] = E.dims(), zFit = Math.min((E.cv.width || 1) / (fw * 1.2), (E.cv.height || 1) / (fh * 1.2));
        const dpr = E.dprNow() * (E.labelPx() / 11) * Math.min(E.labelMaxPx() / E.labelPx(), Math.max(1, E.view.z / zFit));
        const shadowPx = E.labelShadow(), shadowUnits = E.labelShadowStrength() * 2;       // per 50%, the text is drawn once more with its shadow
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
            // marks before the prompt, drawn (not emoji): a lock for a region kept as it is in Edit Mode, a person for
            // a character region. They take room at the start of every line, like the index badge.
            // (round 88: every type has its mark, an object and a text region too)
            const marks = [...(rg.keep && E.isEdit() ? ["lock"] : []), { character: "person", text: "text" }[rg.type] || "object"];
            const mw = marks.length * MARK_STEP * dpr;
            const [cx, cy] = E.toScr((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
            const [rx0, ry0] = E.toScr(b.x0, b.y0), [rx1, ry1] = E.toScr(b.x1, b.y1);
            const num = imap[b.k] == null ? "" : String(imap[b.k]);
            E.ctx.font = `bold ${11 * dpr}px sans-serif`;
            const nw = num ? Math.max(lh + 2 * dpr, E.ctx.measureText(num).width + pad * 2) : 0, gap = num ? 3 * dpr : 0;
            E.ctx.font = `${11 * dpr}px sans-serif`;
            // inside the region (round 35): as much of the prompt as fits the largest rectangle inside the region's
            // visible pixels (the part of it in view), with a margin, centred. A region too small for a line of
            // text gets the compact label instead (index and up to three lines on a dark plate), as before.
            const [qx0, qy0] = E.toScr(b.in.x0, b.in.y0), [qx1, qy1] = E.toScr(b.in.x1, b.in.y1);
            const vx0 = Math.max(qx0, 0), vy0 = Math.max(qy0, 0), vx1 = Math.min(qx1, E.cv.width), vy1 = Math.min(qy1, E.cv.height);
            const iw = vx1 - vx0, ih = vy1 - vy0, mg = Math.max(2 * dpr, Math.min(iw, ih) * E.labelPad());       // (a Setting since round 88; 8% and at least 4 px until then)
            // round 88: the number and the marks go on a line of their own above the text, centred over it, so the
            // text has the region's whole width. Where the region isn't tall enough for that line and a line of text,
            // they stay before the text as they were.
            const headW = nw + (num && mw ? 3 * dpr : 0) + mw, headH = headW ? lh + 2 * dpr : 0;
            const topW = iw - 2 * mg, topLines = Math.floor((ih - 2 * mg - headH) / lh);
            if (headW && topW >= 44 * dpr && topLines >= 1) {
                const lines = wrapText(E.ctx, text, topW, topLines);
                const tw = Math.max(...lines.map((l) => E.ctx.measureText(l).width));
                const w = Math.max(tw, headW), h = headH + lines.length * lh;
                items.push({ k: b.k, rg, lines, num, nw, gap, marks, mw, bw: tw, w, h, dx: vx0 + (iw - w) / 2, dy: vy0 + (ih - h) / 2, rx0, ry0, rx1, ry1, inside: true, top: { headW, headH } });
                continue;
            }
            const availW = iw - 2 * mg - nw - gap - mw, maxLines = Math.floor((ih - 2 * mg) / lh);
            if (availW >= 44 * dpr && maxLines >= 1) {
                const lines = wrapText(E.ctx, text, availW, maxLines);
                const tw = Math.max(...lines.map((l) => E.ctx.measureText(l).width));
                const w = nw + gap + mw + tw, h = lines.length * lh;
                items.push({ k: b.k, rg, lines, num, nw, gap, marks, mw, bw: tw, w, h, dx: vx0 + (iw - w) / 2, dy: vy0 + (ih - h) / 2, rx0, ry0, rx1, ry1, inside: true });
                continue;
            }
            const regionW = (b.x1 - b.x0) * E.view.z;
            const maxW = Math.max(70 * dpr, Math.min(200 * dpr, regionW * 0.9));
            const lines = wrapText(E.ctx, text, Math.max(40 * dpr, maxW - mw), 3);
            const tw = Math.max(...lines.map((l) => E.ctx.measureText(l).width));
            const bw = tw + mw + pad * 2, bh = lines.length * lh + pad * 2 - 2 * dpr;
            const w = nw + gap + bw;
            items.push({ k: b.k, rg, lines, num, nw, gap, marks, mw, bw, w, h: bh, dx: cx - w / 2, dy: cy - bh / 2, rx0, ry0, rx1, ry1 });
        }
        // place from the top of the region list down (not by selection, so labels don't jump when you click)
        const prio = [...items].sort((a, b) => (b.inside ? 1 : 0) - (a.inside ? 1 : 0) || a.k - b.k);
        const [W, H] = E.dims();
        const [ix0, iy0] = E.toScr(0, 0), [ix1, iy1] = E.toScr(W, H);
        placeLabels(prio, { x0: Math.max(0, ix0), y0: Math.max(0, iy0), x1: Math.min(E.cv.width, ix1), y1: Math.min(E.cv.height, iy1) });
        // draw from the bottom of the list up, active region last (on top)
        const order = [...items].sort((a, b) => b.k - a.k);
        const act = order.findIndex((it) => it.rg.id === E.curRegion);
        if (act >= 0) order.push(order.splice(act, 1)[0]);
        E.labelRects = [];
        // A label inside its region is written straight on it, without a box (round 73): white with a dark shadow, or
        // black with a white glow where what is under it is light. What is under it: the region's color at the
        // regions' opacity, on black or on the image (taken as a middle gray: its real colors aren't looked at).
        // A dark plate remains where the text lies on a picture: a control map on the canvas, and a kept region in
        // Edit Mode, which is only an outline over the picture it keeps.
        const plateAll = E.controlShowK >= 0, fillNow = E.fillNow();
        for (const it of order) {
            const { rg, lines, num, nw, gap, bw, h: bh, marks, mw } = it;
            // where the number's badge, the marks and the text go: side by side, or (it.top) the first two centred above the text
            const top = it.top, headX = top ? it.x + (it.w - top.headW) / 2 : it.x;
            const x0 = top ? headX + nw + (num && mw ? 3 * dpr : 0) : it.x + nw + gap, y0 = it.y;
            const shown = E.colorOf(rg.id), [rr, gg, bb] = hexRgb(shown), light = rr * 0.299 + gg * 0.587 + bb * 0.114 > 140;
            const badgeH = it.inside ? lh : bh;
            const plate = plateAll || (!!rg.keep && E.isEdit());
            if (it.inside && plate) {
                E.ctx.globalAlpha = 0.6; E.ctx.fillStyle = "#000";
                E.ctx.fillRect(it.x - pad, y0 - pad, it.w + pad * 2, bh + pad * 2);
                E.ctx.globalAlpha = 1;
            }
            if (num) {                                   // index badge right before the prompt
                E.ctx.globalAlpha = 0.9; E.ctx.fillStyle = shown; E.ctx.fillRect(headX, y0, nw, badgeH);
                E.ctx.globalAlpha = 1; E.ctx.strokeStyle = it.inside && light && !plate ? "#000" : "#fff"; E.ctx.lineWidth = 1.5 * dpr; E.ctx.strokeRect(headX, y0, nw, badgeH);
                E.ctx.fillStyle = light ? "#000" : "#fff";
                E.ctx.font = `bold ${11 * dpr}px sans-serif`; E.ctx.textAlign = "center";
                E.ctx.fillText(num, headX + nw / 2, y0 + (badgeH - 11 * dpr) / 2);
                E.ctx.textAlign = "left"; E.ctx.font = `${11 * dpr}px sans-serif`;
            }
            if (it.inside) {
                // straight on the region's color, in black or white, whichever reads better on it
                E.labelRects.push({ rid: rg.id, x0: it.x - pad, y0: y0 - pad, x1: it.x + it.w + pad, y1: y0 + bh + pad, inside: true, marks, plate });
                const under = (rr * 0.299 + gg * 0.587 + bb * 0.114) * fillNow + (E.backdrop ? 128 * (1 - fillNow) : 0);
                const dark = under > 140 && !plate;
                E.ctx.save();
                E.ctx.shadowBlur = shadowPx * dpr;
                E.ctx.shadowColor = shadowPx > 0 && shadowUnits > 0 ? (dark ? "rgba(255,255,255,.9)" : "rgba(0,0,0,.95)") : "rgba(0,0,0,0)";
                E.ctx.fillStyle = dark ? "#000" : "#fff";
                marks.forEach((m, i) => drawLabelMark(E.ctx, m, x0 + i * MARK_STEP * dpr, y0 + 1 * dpr, MARK_SIZE * dpr, dark ? "#000" : "#fff"));
                E.ctx.fillStyle = dark ? "#000" : "#fff";
                E.ctx.globalAlpha = rg.prompt.trim() ? 1 : 0.6;
                // the text once for each unit of shadow strength (a last one for the rest): shadows add up
                for (let left = shadowPx > 0 ? shadowUnits : 0, first = true; first || left > 0; left -= 1, first = false) {
                    const a = Math.max(0, Math.min(1, left));
                    E.ctx.shadowColor = dark ? `rgba(255,255,255,${0.9 * a})` : `rgba(0,0,0,${0.95 * a})`;
                    if (top && E.labelCentered()) { E.ctx.textAlign = "center"; lines.forEach((l, i) => E.ctx.fillText(l, it.x + it.w / 2, y0 + top.headH + 1 * dpr + i * lh)); E.ctx.textAlign = "left"; }
                    else if (top) lines.forEach((l, i) => E.ctx.fillText(l, it.x + (it.w - it.bw) / 2, y0 + top.headH + 1 * dpr + i * lh));       // left-aligned (a Setting), as a block under the number
                    else lines.forEach((l, i) => E.ctx.fillText(l, x0 + mw, y0 + 1 * dpr + i * lh));
                }
                E.ctx.restore();
                continue;
            }
            E.labelRects.push({ rid: rg.id, x0: it.x, y0, x1: x0 + bw, y1: y0 + bh, marks });
            const isAct = rg.id === E.curRegion;
            E.ctx.globalAlpha = isAct ? 0.8 : 0.6; E.ctx.fillStyle = "#000"; E.ctx.fillRect(x0, y0, bw, bh);
            E.ctx.globalAlpha = 1; E.ctx.strokeStyle = E.colorOf(rg.id); E.ctx.lineWidth = 1.5 * dpr; E.ctx.strokeRect(x0, y0, bw, bh);
            marks.forEach((m, i) => drawLabelMark(E.ctx, m, x0 + pad + i * MARK_STEP * dpr, y0 + pad, MARK_SIZE * dpr, "#fff"));
            E.ctx.fillStyle = rg.prompt.trim() ? "#fff" : "rgba(255,255,255,.6)";
            lines.forEach((l, i) => E.ctx.fillText(l, x0 + pad + mw, y0 + pad + i * lh));
        }
        E.ctx.restore();
    }
}
