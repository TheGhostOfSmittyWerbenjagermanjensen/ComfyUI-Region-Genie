// Image size from the graph (linked inputs, Resolution Selector), canvas size and view (zoom, pan, coordinates), layer geometry.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { api } from "../../../scripts/api.js";
import { linkOf } from "./graph.js";

export function* view(E) {
    Object.assign(E, {
        feeder, downstreamFormat, guessInputDims, dims, resizeCanvas, fitView, onDimsChanged, evDisplay, layerToImg, imgToLayer,
        contentBox, boxCornersImg, layerTransform,
    });
    yield;

    // ---------------- dims / view ----------------
    const isLinked = (name) => !!E.node.inputs?.some((i) => i.name === name && i.link != null); E.isLinked = isLinked;
    const srcOf = (name) => {
        const inp = E.node.inputs?.find((i) => i.name === name && i.link != null);
        const link = inp && linkOf(E.node.graph, inp.link);
        return link ? E.node.graph?.getNodeById(link.origin_id) : null;
    };
    const imgSizeCache = new Map();          // Load Image file -> [w, h]
    function loadImageSize(src) {
        const iw = src?.widgets?.find((w) => w.name === "image");
        if (!/LoadImage/.test(src?.type || src?.comfyClass || "") || typeof iw?.value !== "string" || !iw.value) return null;
        const key = iw.value;
        if (imgSizeCache.has(key)) return imgSizeCache.get(key);
        imgSizeCache.set(key, null);
        const v = key.replace(/ \[(input|output|temp)\]$/, ""), cut = v.lastIndexOf("/");
        const img = new Image();
        img.onload = () => { imgSizeCache.set(key, [img.naturalWidth, img.naturalHeight]); onDimsChanged(); };
        img.src = api.apiURL(`/view?filename=${encodeURIComponent(cut >= 0 ? v.slice(cut + 1) : v)}&type=input&subfolder=${encodeURIComponent(cut >= 0 ? v.slice(0, cut) : "")}`);
        return null;
    }
    // the node feeding input `name` of node n, through reroutes
    function feeder(n, name, depth = 0) {
        const inp = n?.inputs?.find((i) => i.name === name && i.link != null) ?? (name == null ? n?.inputs?.find((i) => i.link != null) : null);
        const link = inp && linkOf(n.graph, inp.link);
        const src = link ? n.graph?.getNodeById(link.origin_id) : null;
        if (src && depth < 8 && /reroute/i.test(src.type || "") ) return feeder(src, null, depth + 1);
        return src ? { src, slot: link.origin_slot } : null;
    }
    // value of widget `name` of node n, following a link into it (primitives, reroutes ...) to the widget
    // that feeds it; `test` says which values count
    function widgetValue(n, name, test, depth = 0) {
        if (!n || depth > 8) return null;
        const f = n.inputs?.some((i) => i.name === name && i.link != null) ? feeder(n, name) : null;
        if (f) {
            const outName = f.src.outputs?.[f.slot]?.name;
            let w = f.src.widgets?.find((x) => x.name === outName);
            if (!w) { const ws = (f.src.widgets || []).filter((x) => test(x.value)); if (ws.length === 1) w = ws[0]; }
            return w ? widgetValue(f.src, w.name, test, depth + 1) : null;
        }
        const w = n.widgets?.find((x) => x.name === name);
        return w && test(w.value) ? w.value : null;
    }
    // Python's round(): halves go to the even neighbour (round(2.5) == 2)
    function pyRound(x) {
        const f = Math.floor(x), d = x - f;
        return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
    }
    // the outputs of ComfyUI's Resolution Selector, computed as its Python code does (it has no width/height
    // widgets: they only exist when the workflow runs)
    function resolutionSelectorDims(n, depth) {
        const ar = widgetValue(n, "aspect_ratio", (v) => typeof v === "string", depth + 1);
        const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/.exec(ar || "");
        const mp = numberOf(n, "megapixels", depth + 1);
        const mult = numberOf(n, "multiple", depth + 1) ?? 8;
        if (!m || !mp || !(mult > 0)) return null;
        const wr = parseFloat(m[1]), hr = parseFloat(m[2]);
        const scale = Math.sqrt((mp * 1024 * 1024) / (wr * hr));
        return [pyRound(wr * scale / mult) * mult, pyRound(hr * scale / mult) * mult];
    }
    const isResolutionSelector = (n) => (n?.comfyClass || n?.type) === "ResolutionSelector";
    // value of a number widget `name` of node n, following links into it (primitives, int nodes, reroutes,
    // Resolution Selector)
    function numberOf(n, name, depth = 0) {
        if (!n || depth > 8) return null;
        const f = n.inputs?.some((i) => i.name === name && i.link != null) ? feeder(n, name) : null;
        if (f && isResolutionSelector(f.src)) {
            const d = resolutionSelectorDims(f.src, depth);
            const outName = f.src.outputs?.[f.slot]?.name;
            const i = outName === "height" ? 1 : outName === "width" ? 0 : f.slot;
            return d && (i === 0 || i === 1) && d[i] > 0 ? d[i] : null;
        }
        if (f) {
            const outName = f.src.outputs?.[f.slot]?.name;
            let w = f.src.widgets?.find((x) => x.name === outName);
            if (!w) { const nums = (f.src.widgets || []).filter((x) => typeof x.value === "number"); if (nums.length === 1) w = nums[0]; }
            if (!w) return null;
            return numberOf(f.src, w.name, depth + 1);
        }
        const w = n.widgets?.find((x) => x.name === name);
        return typeof w?.value === "number" && w.value > 0 ? w.value : null;
    }
    // The prompt format the text encoder that 'prompt' goes to takes ("moss" / "ideogram" / "plain"), for
    // format = auto when neither model nor clip is connected: follows the 'prompt' output (through reroutes)
    // to the nodes it feeds; a text encode node is followed up its clip input to the loader.
    function formatOfLoader(n, depth = 0) {
        if (!n || depth > 12) return null;
        const t = String(n.comfyClass || n.type || "");
        if (/ideogram/i.test(t)) return "ideogram";
        if (/moss/i.test(t)) return "moss";
        const typeW = n.widgets?.find((w) => w.name === "type");
        if (/^CLIPLoader/i.test(t) || (typeW && /clip/i.test(t))) {
            const v = String(typeW?.value || "");
            return v === "ideogram4" ? "ideogram" : v === "moss_image" ? "moss" : v ? "plain" : null;
        }
        if (/(Dual|Triple|Quadruple)CLIPLoader/i.test(t)) return "plain";
        const ckpt = n.widgets?.find((w) => /ckpt_name|model_name/.test(w.name))?.value;
        if (/checkpoint/i.test(t) && ckpt) return /moss/i.test(ckpt) ? "moss" : /ideogram/i.test(ckpt) ? "ideogram" : "plain";
        const up = feeder(n, "clip");                  // LoRA loaders, clip set last layer ...: keep going up
        return up ? formatOfLoader(up.src, depth + 1) : null;
    }
    function formatOfTarget(n, depth = 0) {
        if (!n || depth > 8) return null;
        const t = String(n.comfyClass || n.type || "");
        if (/reroute/i.test(t)) {
            for (const o of n.outputs || []) for (const id of o.links || []) {
                const l = linkOf(n.graph, id), f = formatOfTarget(l && n.graph?.getNodeById(l.target_id), depth + 1);
                if (f) return f;
            }
            return null;
        }
        if (/ideogram/i.test(t)) return "ideogram";
        if (/moss/i.test(t)) return "moss";
        const up = feeder(n, "clip");
        return up ? formatOfLoader(up.src) : null;
    }
    function downstreamFormat() {
        try {
            const o = E.node.outputs?.find((x) => x.name === "prompt");
            for (const id of o?.links || []) {
                const l = linkOf(E.node.graph, id), f = formatOfTarget(l && E.node.graph?.getNodeById(l.target_id));
                if (f) return f;
            }
        } catch (e) { /* graph being edited */ }
        return null;
    }
    // size_from_image > size_from_latent > width/height widgets (same priority as the Python side).
    // What the editor can read from the graph is a guess; after a run the node reports the real size,
    // which is used until the guess changes (e.g. a different latent size is set).
    E.execGuess = null;
    // Edit Mode with the image connected (and no size_from_* input): the image's shape at the pixel count of
    // width x height, in steps of 16 (edit_size in region_genie.py)
    // the size input in use (size_from; the two older sockets only until a loaded workflow's links are moved), and
    // whether an image or a latent feeds it
    const sizeFromName = () => ["size_from", "size_from_image", "size_from_latent"].find((n) => isLinked(n)) || null;
    const sizeFromKind = () => {
        const n = sizeFromName();
        if (!n) return null;
        if (n !== "size_from") return n === "size_from_image" ? "image" : "latent";
        const f = feeder(E.node, n);
        return /LATENT/i.test(String(f?.src?.outputs?.[f.slot]?.type || "")) ? "latent" : "image";
    }; E.sizeFromKind = sizeFromKind;
    const editSized = () => E.isEdit() && isLinked("image") && !sizeFromName(); E.editSized = editSized;
    function editDims() {
        const s = loadImageSize(srcOf("image"));
        if (!s) return null;
        const pick = (name, widget) => isLinked(name) ? (numberOf(E.node, name) ?? widget?.value ?? 1024) : (widget?.value ?? 1024);
        const sc = Math.sqrt(+pick("width_in", E.wW) * +pick("height_in", E.hW) / Math.max(1, s[0] * s[1]));
        return [Math.max(16, pyRound(s[0] * sc / 16) * 16), Math.max(16, pyRound(s[1] * sc / 16) * 16)];
    }
    function guessInputDims() {
        const from = sizeFromName(), kind = sizeFromKind();
        if (kind === "image") return loadImageSize(srcOf(from)) || null;
        if (kind === "latent") {
            const f = feeder(E.node, from);
            const w = numberOf(f?.src, "width"), h = numberOf(f?.src, "height");
            return w && h ? [w, h] : null;
        }
        if (editSized()) return editDims();
        return null;
    }
    function inputDims() {
        if (!sizeFromName() && !editSized()) return null;
        const g = guessInputDims();
        if (E.execDims && JSON.stringify(g) === JSON.stringify(E.execGuess)) return E.execDims;
        return g || E.execDims || null;
    }
    function dims() {
        const fromInput = inputDims();
        if (fromInput) return [Math.max(1, Math.round(fromInput[0])), Math.max(1, Math.round(fromInput[1]))];
        const pick = (name, widget, i) => isLinked(name)
            ? (numberOf(E.node, name) ?? E.execDims?.[i] ?? widget?.value ?? 1024) : (widget?.value ?? 1024);
        return [Math.max(1, Math.round(pick("width_in", E.wW, 0))), Math.max(1, Math.round(pick("height_in", E.hW, 1)))];
    }
    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const bw = E.cvBox.clientWidth, bh = E.cvBox.clientHeight;
        if (bw < 2 || bh < 2) return false;                    // not laid out yet
        const w = Math.round(bw * dpr), h = Math.round(bh * dpr);
        if (E.cv.width !== w || E.cv.height !== h) {
            const old = [E.cv.width, E.cv.height];
            for (const c of [E.cv, E.comp, E.scratch]) { c.width = w; c.height = h; }
            if (!E.view || !E.userView) fitView();
            else { E.view.x += (w - old[0]) / 2; E.view.y += (h - old[1]) / 2; }   // keep the view centred
        }
        return true;
    }
    function fitView() {
        const [W, H] = dims();
        const cw = E.cv.width || 1, ch = E.cv.height || 1;
        const z = Math.min(cw / (W * 1.2), ch / (H * 1.2));
        E.view = { z, x: (cw - W * z) / 2, y: (ch - H * z) / 2 };
    }
    function onDimsChanged() {
        const [W, H] = dims();
        if (W !== E.lastDims[0] || H !== E.lastDims[1]) {
            E.lastDims = [W, H];
            if (!E.userView) fitView();
        }
        E.syncSizeRow();
        E.requestDraw();
    }
    const toImg = (sx, sy) => [(sx - E.view.x) / E.view.z, (sy - E.view.y) / E.view.z]; E.toImg = toImg;
    const toScr = (ix, iy) => [ix * E.view.z + E.view.x, iy * E.view.z + E.view.y]; E.toScr = toScr;
    function evDisplay(e) {
        const r = E.cv.getBoundingClientRect();
        return [(e.clientX - r.left) * (E.cv.width / Math.max(1, r.width)), (e.clientY - r.top) * (E.cv.height / Math.max(1, r.height))];
    }
    const dprNow = () => window.devicePixelRatio || 1; E.dprNow = dprNow;

    // ---------------- geometry ----------------
    const short = () => Math.min(...dims()); E.short = short;
    function layerToImg(L, lx, ly) {
        const [W, H] = dims(), s = Math.min(W, H), th = L.rot * Math.PI / 180;
        const dx = (lx - L.bw / 2) * L.sx * s, dy = (ly - L.bh / 2) * L.sy * s;
        return [W / 2 + L.ox * s + Math.cos(th) * dx - Math.sin(th) * dy, H / 2 + L.oy * s + Math.sin(th) * dx + Math.cos(th) * dy];
    }
    function imgToLayer(L, px, py) {
        const [W, H] = dims(), s = Math.min(W, H), th = L.rot * Math.PI / 180;
        const qx = px - (W / 2 + L.ox * s), qy = py - (H / 2 + L.oy * s);
        const dx = Math.cos(th) * qx + Math.sin(th) * qy, dy = -Math.sin(th) * qx + Math.cos(th) * qy;
        return [dx / (L.sx * s) + L.bw / 2, dy / (L.sy * s) + L.bh / 2];
    }
    // geometric extents of everything painted (erasers ignored): an upper bound
    function geomBox(L) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
        if (L.shape) { add(0, 0); add(L.bw, L.bh); }
        for (const o of L.ops) {
            if (o.e) continue;
            if (o.t === "bitmap") { add(o.x0, o.y0); add(o.x1, o.y1); continue; }
            const r = o.t === "stroke" ? (o.d || 0) / 2 : 0;
            for (const [x, y] of o.p) { add(x - r, y - r); add(x + r, y + r); }
        }
        return isFinite(x0) ? [x0, y0, x1, y1] : null;
    }
    // tight box of the visible pixels (erasing shrinks it), in local units; cached per layer content
    const boxCache = new WeakMap(); E.boxCache = boxCache;
    function contentBox(L) {
        const last = L.ops[L.ops.length - 1];
        const sig = `${L.shape}|${L.sides}|${L.radius}|${L.bw}|${L.bh}|${L.region}|${L.ops.length}|${last?.p?.length ?? last?.w ?? 0}`;
        const c0 = boxCache.get(L);
        if (c0 && c0.sig === sig) return c0.box;
        const g = geomBox(L);
        let box = null;
        if (g) {
            const span = Math.max(g[2] - g[0], g[3] - g[1], 1e-6), k = 256 / span;
            const w = Math.max(1, Math.ceil((g[2] - g[0]) * k) + 2), h = Math.max(1, Math.ceil((g[3] - g[1]) * k) + 2);
            const c = document.createElement("canvas"); c.width = w; c.height = h;
            const x = c.getContext("2d", { willReadFrequently: true });
            x.setTransform(k, 0, 0, k, (-g[0]) * k + 1, (-g[1]) * k + 1);
            E.paintLocal(x, L, L.ops, "#fff");
            const d = x.getImageData(0, 0, w, h).data;
            let a = w, b = h, cc = -1, dd = -1;
            for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
                if (d[(yy * w + xx) * 4 + 3] > 0) { if (xx < a) a = xx; if (xx > cc) cc = xx; if (yy < b) b = yy; if (yy > dd) dd = yy; }
            }
            if (cc >= 0) box = [g[0] + (a - 1) / k, g[1] + (b - 1) / k, g[0] + (cc) / k, g[1] + (dd) / k];
        }
        boxCache.set(L, { sig, box });
        return box;
    }
    function boxCornersImg(L, box = contentBox(L)) {
        if (!box) return null;
        const [x0, y0, x1, y1] = box;
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => layerToImg(L, x, y));
    }
    function layerTransform(c, L, pre) {
        const [W, H] = dims(), s = Math.min(W, H);
        c.setTransform(...(pre || [1, 0, 0, 1, 0, 0]));
        c.transform(E.view.z, 0, 0, E.view.z, E.view.x, E.view.y);
        c.translate(W / 2 + L.ox * s, H / 2 + L.oy * s);
        c.rotate(L.rot * Math.PI / 180);
        c.scale(L.sx * s, L.sy * s);
        c.translate(-L.bw / 2, -L.bh / 2);
    }
    const identityFrame = (L) => L.rot === 0 && L.sx === 1 && L.sy === 1 && Math.abs(L.ox) < 1e-9 && Math.abs(L.oy) < 1e-9 && !L.shape &&
        Math.abs(L.bw - dims()[0] / short()) < 1e-9 && Math.abs(L.bh - dims()[1] / short()) < 1e-9; E.identityFrame = identityFrame;
}
