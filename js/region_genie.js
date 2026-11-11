import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { svgIcon, knownLoras, pickLora, contextMenu, appendWord, fillTriggerChips, CHIP_CSS, keepWidgetValuesByName,
         autocompleteOnFocus, autocompleteOpen, autocompleteWidgets, inAutocompleteList, autocompleteToggle,
         getSetting, setSetting, SET, migrateProps, autoApartSettings, editSettings, editLoras, editMaskDefaults, toolDefault,
         onToolDefault, toolNumber, TOOL_NUMBERS, llmCacheSettings, SIZE_ASPECTS, ratioSize, parseSizePresets, formatSizePresets,
         ratioLabel, SIZE_PRESETS_DEFAULT, wildcardSeedControl, pickWildcard, insertAtCursor, hasWildcards, WC_CSS,
         wildcardsInstalled, onWildcardInfo } from "./rg_shared.js";
import { loadLibrary, library, onLibraryChange, resolveNodeLlm, presetForType, sparkleSvg, openLlmSettings, inLlmSettings,
         closeLlmSettings } from "./rg_llm.js";
import { openColorPicker, inColorPicker } from "./rg_colorpicker.js";

// Layered region editor of the "Region Genie" node (formerly "Color Map to Layout").
// paint_data v2 (JSON, hidden widget):
//   { v: 2, regions: [{id, color, prompt, type: "object"|"character"|"text", text, loras: [{lora, strength, on}],
//                      palette: ["#RRGGBB", ... up to 5], paletteOn, featherLinked, feather, featherEdges}],
//     layers: [ bottom ... top ], sceneLoras: [{lora, strength, on}], loraOpts: {separation, until} }
//   layer: { id, name, region (0 = unspecified), visible, shape: null | "rect" | "ellipse" | "triangle" | "pentagon" |
//            "hexagon" | "star" | "heart" | "polygon", sides, bw, bh, sx, sy, rot, ox, oy, ops: [...] }
//   op: {t: "stroke", e, d, p: [[lx, ly], ...]} | {t: "poly", e, p} | {t: "bitmap", e, w, h, runs, x0, y0, x1, y1}
// Local units ("L"): 1 L = the image's shorter side. A layer's base box is bw x bh L; its ops are in the
// same local units. image_px = C + R(rot) * ((l - (bw/2, bh/2)) * (sx, sy) * short),
// C = (W/2 + ox * short, H/2 + oy * short): the centre is an offset from the image centre in the same units, so
// changing width/height keeps every layer in place relative to the image centre and to each other (they scale
// only with the shorter side). Older data stored the centre as fractions (cx, cy) of W and H; it is converted
// with the size it was made for.
// Python (region_genie.py) renders the same data with hard edges; this preview is for editing.

const NODE_NAMES = ["Region-Genie_Main", "RegionalMaskKit_ColorMap"];      // new ID, old ID (old workflows)
// distinct, saturated region-ID colors (none near black); Python uses the same list
const PALETTE = [
    "#E6194B", "#3CB44B", "#FFE119", "#4363D8", "#F58231", "#911EB4", "#42D4F4", "#F032E6",
    "#BFEF45", "#FABED4", "#469990", "#DCBEFF", "#9A6324", "#FFFAC8", "#800000", "#AAFFC3",
    "#808000", "#FFD8B1", "#000075", "#A9A9A9", "#FFFFFF", "#00FF7F", "#FF4500", "#1E90FF",
];
// Lasso / Lasso erase: plain (straight lines) or spline (a smooth curve). They start as set in Settings > Region
// Genie > Canvas tools; right-click either button to choose, which is kept for the rest of the session (all Region
// Genie nodes on the page) until that setting is changed.
// The same for the other tools with variants (magic wand, fill), and their numbers (wand tolerance, fill gap).
const LASSO_MODES = { lasso: "plain", lassoErase: "plain", wand: "contiguous", fill: "normal" };
const TOOL_NUMS = { wandTol: 32, fillGap: 4 };
let lassoInit = false;
const lassoRefreshers = new Set();               // each node's refreshVariantButtons
function initLassoModes() {
    if (lassoInit) return;
    lassoInit = true;
    for (const k of Object.keys(LASSO_MODES)) LASSO_MODES[k] = toolDefault(k);
    for (const k of Object.keys(TOOL_NUMS)) TOOL_NUMS[k] = toolNumber(k);
}
onToolDefault((tool, v) => {
    if (tool in LASSO_MODES) LASSO_MODES[tool] = v;
    else if (tool in TOOL_NUMS) {
        const [, d, lo, hi] = TOOL_NUMBERS[tool], n = Math.round(Number(v));
        TOOL_NUMS[tool] = Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
    } else return;
    for (const f of lassoRefreshers) f();
});
// magnetic lasso: the strongest edge near a point (image px) in an edge map of the backdrop, or the point itself
function snapToEdge(edges, x, y, radius) {
    if (!edges) return [x, y];
    const { g, w, h, k, max } = edges;
    const cx = Math.round(x * k), cy = Math.round(y * k), R = Math.max(1, Math.round(radius * k));
    let best = -1, bx = cx, by = cy;
    for (let yy = Math.max(0, cy - R); yy <= Math.min(h - 1, cy + R); yy++) {
        for (let xx = Math.max(0, cx - R); xx <= Math.min(w - 1, cx + R); xx++) {
            const d = Math.hypot(xx - cx, yy - cy);
            if (d > R) continue;
            const s = g[yy * w + xx] * (1 - 0.5 * d / R);
            if (s > best) { best = s; bx = xx; by = yy; }
        }
    }
    if (best < max * 0.08) return [x, y];                 // no clear edge nearby: the pointer as it is
    return [(bx + 0.5) / k, (by + 0.5) / k];
}
// a straight segment from a to b (image px), sampled every `step` px and pulled onto edges
function snapSegment(edges, a, b, step, radius) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / Math.max(step, 1e-6)));
    const out = [];
    for (let i = 1; i <= n; i++) out.push(snapToEdge(edges, a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, radius));
    return out;
}
// distance (px, chamfer 1 / 1.414) from every pixel to the nearest pixel where src[i] is set; Float32Array
function distanceMap(src, w, h) {
    const INF = 1e9, D = 1.41421356, d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : INF;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) {
            v = Math.min(v, d[i - w] + 1);
            if (x > 0) v = Math.min(v, d[i - w - 1] + D);
            if (x < w - 1) v = Math.min(v, d[i - w + 1] + D);
        }
        d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        let v = d[i];
        if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < h - 1) {
            v = Math.min(v, d[i + w] + 1);
            if (x < w - 1) v = Math.min(v, d[i + w + 1] + D);
            if (x > 0) v = Math.min(v, d[i + w - 1] + D);
        }
        d[i] = v;
    }
    return d;
}
// a 0/1 mask grown (r > 0) or shrunk (r < 0) by r px
function growMask01(mask, w, h, r) {
    if (!r) return mask;
    const out = new Uint8Array(w * h);
    if (r > 0) {
        const d = distanceMap(mask, w, h);
        for (let i = 0; i < out.length; i++) out[i] = d[i] <= r + 1e-6 ? 1 : 0;
    } else {
        const inv = new Uint8Array(w * h);
        for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
        const d = distanceMap(inv, w, h);
        for (let i = 0; i < out.length; i++) out[i] = mask[i] && d[i] > -r + 1e-6 ? 1 : 0;
    }
    return out;
}

// ---- spline lasso: a closed, smooth curve through the clicked points (or a simplified freehand path) ----
function dedupe(pts, eps) {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p); }
    if (out.length > 1) { const a = out[0], b = out[out.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop(); }
    return out;
}
// Ramer-Douglas-Peucker on a closed path: the few points that keep its shape within eps
function simplifyClosed(pts, eps) {
    if (pts.length < 5) return pts.slice();
    let far = 0, fd = -1;                                     // split at the point farthest from the first
    pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > fd) { fd = d; far = i; } });
    const rdp = (a) => {
        if (a.length < 3) return a;
        const [x0, y0] = a[0], [x1, y1] = a[a.length - 1];
        const L = Math.hypot(x1 - x0, y1 - y0) || 1e-9;
        let idx = 0, dmax = 0;
        for (let i = 1; i < a.length - 1; i++) {
            const d = Math.abs((y1 - y0) * a[i][0] - (x1 - x0) * a[i][1] + x1 * y0 - y1 * x0) / L;
            if (d > dmax) { dmax = d; idx = i; }
        }
        if (dmax <= eps) return [a[0], a[a.length - 1]];
        const l = rdp(a.slice(0, idx + 1)), r = rdp(a.slice(idx));
        return [...l.slice(0, -1), ...r];
    };
    const one = rdp(pts.slice(0, far + 1)), two = rdp([...pts.slice(far), pts[0]]);
    return [...one.slice(0, -1), ...two.slice(0, -1)];
}
// a freehand path without the hand's jitter: resampled evenly, then averaged around each point (closed path)
function smoothClosed(pts, spacing, radius) {
    if (pts.length < 4) return pts.slice();
    const ring = [...pts, pts[0]], even = [ring[0]];
    let carry = 0;
    for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1], [bx, by] = ring[i], L = Math.hypot(bx - ax, by - ay);
        let d = spacing - carry;
        while (d <= L) { even.push([ax + (bx - ax) * d / L, ay + (by - ay) * d / L]); d += spacing; }
        carry = L - (d - spacing);
    }
    const n = even.length, k = Math.max(1, Math.min(Math.floor(n / 6), Math.round(radius / spacing)));
    if (n < 6) return pts.slice();
    const out = [];
    for (let i = 0; i < n; i++) {
        let sx = 0, sy = 0, sw = 0;
        for (let j = -k; j <= k; j++) {
            const w = k + 1 - Math.abs(j), q = even[((i + j) % n + n) % n];
            sx += q[0] * w; sy += q[1] * w; sw += w;
        }
        out.push([sx / sw, sy / sw]);
    }
    return out;
}
// closed centripetal Catmull-Rom spline through pts, sampled about every `step` units
function closedSpline(pts, step) {
    const n = pts.length;
    if (n < 3) return pts.slice();
    const out = [];
    const P = (i) => pts[((i % n) + n) % n];
    for (let i = 0; i < n; i++) {
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        const tj = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
        const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
        const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const k = Math.max(4, Math.min(64, Math.ceil(seg / Math.max(step, 1e-6))));
        for (let j = 0; j < k; j++) {
            const t = t1 + (t2 - t1) * (j / k);
            const lerp = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
            const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
            const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
            out.push(lerp(B1, B2, t1, t2));
        }
    }
    return out;
}

const SHAPES = [["rect", "Rectangle"], ["roundrect", "Rounded rectangle"], ["ellipse", "Ellipse"], ["triangle", "Triangle"],
                ["pentagon", "Pentagon"], ["hexagon", "Hexagon"], ["star", "Star"], ["heart", "Heart"]];
const SHAPE_NAMES = Object.fromEntries([...SHAPES, ["polygon", "Polygon"]]);
const TYPES = ["object", "character", "text"];
const UNSPEC = 0, ALL = "all";
const HISTORY = 100;
const DEFAULT_W = 700;                 // default node width (CSS px)
let layerClip = null;                  // Ctrl+C / Ctrl+X: a copy of a layer, shared by all Region Genie nodes
const DEFAULT_H = 1429;                // default height: square canvas at DEFAULT_W in legacy mode (fine-tuned on creation)
const RASTER_MAX = 2048;          // longest side of fill / merge rasters

const STYLE = `
.rg-wrap { display:flex; flex-direction:column; gap:3px; width:100%; height:100%; min-height:460px; box-sizing:border-box;
  font:12px sans-serif; color:var(--input-text,#ddd); pointer-events:auto; outline:none; }
.rg-bar { display:flex; flex-wrap:wrap; align-items:center; gap:3px; }
.rg-btn, .rg-sel, .rg-num { background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555);
  border-radius:4px; padding:2px 6px; font:inherit; }
.rg-btn { cursor:pointer; white-space:nowrap; }
.rg-btn.on { background:#3a6ea5; border-color:#5b8fd0; color:#fff; }
.rg-btn:disabled { opacity:.4; cursor:default; }
.rg-sel { padding:1px 2px; }
.rg-num { width:40px; padding:1px 3px; }
.rg-cv { flex:1 1 auto; min-height:260px; position:relative; overflow:hidden; border-radius:4px; background:#222; }
.rg-cv canvas { position:absolute; left:0; top:0; width:100%; height:100%; touch-action:none; }
.rg-btn.icon { padding:2px 4px; line-height:0; }
.rg-btn.icon svg { width:16px; height:16px; display:block; }
.rg-btn.mixed { display:inline-flex; align-items:center; gap:2px; }
.rg-btn.mixed svg { width:15px; height:15px; display:block; }
.rg-btn.variants { position:relative; }
.rg-btn.variants::after { content:""; position:absolute; right:1px; bottom:1px; width:0; height:0;
  border-style:solid; border-width:0 0 5px 5px; border-color:transparent transparent currentColor transparent; opacity:.7; }
.rg-btn.toggle:not(.on) { opacity:.55; }
.rg-sep { width:1px; align-self:stretch; background:var(--border-color,#555); margin:2px 3px; }
.rg-foot { display:flex; align-items:center; gap:4px; flex:0 0 auto; }
.rg-settings { display:flex; align-items:center; gap:8px; flex:0 1 auto; min-width:0; flex-wrap:wrap; }
.rg-settings label { display:flex; align-items:center; gap:3px; white-space:nowrap; }
.rg-settings .rg-sel { max-width:96px; }
.rg-settings .rg-num { width:64px; }
.rg-llmset svg { width:14px; height:14px; }
.rg-seg { display:inline-flex; align-items:stretch; }
.rg-arrange { position:fixed; z-index:10000; display:flex; flex-direction:column; gap:4px; padding:6px 8px;
  background:#1a1a1a; color:#eee; border:1px solid #5b8fd0; border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,.65); font:12px sans-serif; }
.rg-arrange-row { display:flex; align-items:center; gap:3px; }
.rg-arrange-row > .rg-hint:first-child { width:34px; }
.rg-arrange .rg-num { width:48px; }
.rg-find { width:150px; min-width:60px; flex:0 1 150px; padding:1px 5px; font:inherit; font-size:12px; color:var(--input-text,#ddd);
  background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#555); border-radius:4px; }
.rg-seg .rg-btn { border-radius:0; margin:0; }
.rg-seg .rg-btn + .rg-btn { border-left-width:0; }
.rg-seg .rg-btn:first-child { border-radius:4px 0 0 4px; }
.rg-seg .rg-btn:last-child { border-radius:0 4px 4px 0; }
.rg-seg .rg-btn:not(.icon) { padding:1px 7px; }
.rg-settings .rg-fmt .rg-sel { max-width:112px; }
.rg-row .rg-btn.mini { padding:0 2px; min-width:18px; line-height:0; }
.rg-row .rg-btn.mini svg { width:14px; height:14px; display:block; }
.rg-feather { display:flex; align-items:center; gap:2px; flex:0 0 auto; }
.rg-feather .rg-num { width:42px; }
.rg-fico, .rg-palico { display:inline-flex; opacity:.75; flex:0 0 auto; }
.rg-fico svg, .rg-palico svg { width:14px; height:14px; display:block; }
.rg-row.pal { margin-left:24px; gap:4px; padding-top:0; padding-bottom:0; min-height:18px; }
.rg-row.pal.off .rg-sw { opacity:.4; }
.rg-row.pal .rg-sw { width:16px; height:16px; }
.rg-paladd { position:relative; width:16px; height:16px; box-sizing:border-box; border:1px dashed #888; border-radius:3px;
  display:inline-flex; align-items:center; justify-content:center; font:600 13px/1 sans-serif; color:#ccc; cursor:pointer; flex:0 0 auto; }
.rg-paladd:hover { border-color:#5b8fd0; color:#fff; }
.rg-paladd { background:transparent; padding:0; }
button.rg-sw.pick { padding:0; cursor:pointer; font:inherit; }
button.rg-sw.pick:hover { outline:1px solid #5b8fd0; }
.rg-row textarea.rg-text { flex:0 1 72px; }
.rg-row textarea.rg-text:focus { flex:1.2 1 140px; }
.rg-pop { position:absolute; z-index:6; box-sizing:border-box; display:flex; flex-direction:column; gap:5px; padding:6px 8px 5px;
  background:#1a1a1a; color:#eee; border:2px solid #5b8fd0; border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,.65);
  overflow-y:auto; scrollbar-width:thin; font:12px sans-serif; }
.rg-pop-head { display:flex; align-items:center; gap:6px; font-weight:600; }
.rg-pop-head .rg-idx { flex:0 0 auto; text-align:left; }
.rg-pop-head .rg-sw { cursor:default; }
.rg-pop-head .rg-x { margin-left:auto; padding:0 5px; line-height:16px; }
.rg-pop-types { display:flex; gap:4px; }
.rg-pop-types .rg-btn { flex:1 1 0; padding:3px 6px; }
.rg-pop-lbl { font-size:11px; opacity:.75; margin:0 0 2px 1px; }
.rg-pop textarea { width:100%; box-sizing:border-box; resize:vertical; background:var(--comfy-input-bg,#222); color:inherit;
  border:1px solid var(--border-color,#555); border-radius:4px; padding:3px 5px; font:inherit; line-height:15px; scrollbar-width:thin; }
.rg-pop textarea:focus { border-color:#5b8fd0; outline:none; }
.rg-pop .rg-row { padding:1px 0; }
.rg-pop .rg-row.lora, .rg-pop .rg-row.pal { margin-left:0; }
.rg-pop .rg-trig { margin-left:30px; }
.rg-pop-dyn { display:flex; flex-direction:column; gap:3px; }
.rg-pop-foot { font-size:10px; opacity:.5; }
.rg-bslider { position:absolute; left:8px; top:50%; transform:translateY(-50%); width:30px; height:190px; opacity:.45;
  transition:opacity .12s; z-index:3; touch-action:none; cursor:ns-resize; }
.rg-bslider:hover, .rg-bslider.drag { opacity:1; }
.rg-bslider svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.rg-bhandle { position:absolute; left:1px; width:28px; height:5px; margin-top:-2.5px; background:#f2f2f2; border:1px solid #111;
  border-radius:2px; box-shadow:0 0 3px rgba(0,0,0,.7); pointer-events:none; }
.rg-btip { position:absolute; left:44px; z-index:4; background:rgba(20,20,20,.95); color:#eee; font:11px sans-serif;
  padding:3px 6px; border-radius:4px; border:1px solid #555; white-space:nowrap; pointer-events:none; display:none; }
.rg-tree { flex:0 0 auto; height:220px; display:flex; flex-direction:column; gap:2px; min-height:0; }
.rg-row.lvl1 { margin-left:24px; }
.rg-row.sub { margin-left:20px; gap:4px; padding-top:0; padding-bottom:0; min-height:18px; font-size:11px; cursor:pointer; opacity:.9; }
.rg-row.sub:hover { background:rgba(255,255,255,.05); }
.rg-subname { user-select:none; }
.rg-subbody .rg-row.lvl1, .rg-subbody .rg-row.lora, .rg-subbody .rg-row.pal { margin-left:38px; }
.rg-subbody .rg-trig { margin-left:60px; }
.rg-row.lora { margin-left:24px; font-size:11px; padding-top:0; padding-bottom:0; }
.rg-row.lora .rg-num { width:calc(3.6ch + 26px); }    /* "0.95" next to the spin arrows, in any font */
.rg-row.region { background:rgba(255,255,255,.035); }
.rg-row.scene .rg-pseudo { font-style:normal; font-weight:600; user-select:none; }
.rg-row.scene { cursor:pointer; }
.rg-row.scene:hover { background:rgba(255,255,255,.06); }
.rg-editmask { display:inline-flex; align-items:center; gap:2px; margin-right:6px; }
.rg-loraopts .rg-editmask .rg-num { width:44px; }
.rg-editmask .rg-num::placeholder { color:inherit; opacity:.45; }
.rg-chev { flex:0 0 14px; text-align:center; cursor:pointer; opacity:.85; user-select:none; font-size:10px; }
.rg-chev.empty { opacity:.25; cursor:default; }
.rg-cnt { flex:0 0 auto; font-size:10px; opacity:.55; min-width:10px; }
.rg-row .rg-btn.ico { padding:0 3px; min-width:20px; text-align:center; line-height:16px; }
.rg-row .rg-btn.txt { padding:0 5px; font-size:11px; }
.rg-pick { flex:1 1 0; width:0; min-width:0; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px;
  padding:0 16px 0 5px; font:inherit; cursor:pointer; position:relative; line-height:16px; }
.rg-pick::after { content:"▾"; position:absolute; right:4px; top:50%; transform:translateY(-50%); opacity:.7; }
.rg-pick.missing { color:#e88; }
.rg-row.lora.edit > .rg-hint { color:#8fb8e8; font-weight:600; }     /* edit LoRA added by Edit Mode */
.rg-trig { display:flex; flex-wrap:wrap; gap:3px; margin:0 0 2px 46px; align-items:center; font-size:10px; }
.rg-loraopts { display:flex; align-items:center; gap:3px; font-weight:normal; margin-left:auto; }
.rg-loraopts .rg-num { width:52px; }
.rg-head { display:flex; align-items:center; gap:3px; flex-wrap:wrap; font-weight:600; }
.rg-head .rg-btn { font-weight:normal; padding:1px 5px; }
.rg-list { flex:1 1 auto; overflow-y:auto; display:flex; flex-direction:column; gap:2px; min-height:0;
  border:1px solid var(--border-color,#444); border-radius:4px; padding:2px; }
.rg-row { display:flex; align-items:center; gap:3px; padding:1px 2px; border-radius:4px; border:1px solid transparent; cursor:default; }
.rg-row.sel { border-color:#5b8fd0; background:rgba(91,143,208,.15); }
.rg-row .rg-btn { padding:0 4px; }
.rg-idx { flex:0 0 18px; text-align:right; font:600 11px monospace; color:#e8e8e8; padding-right:1px; }
.rg-idx.none { color:#666; font-weight:400; }
.rg-sw { width:14px; height:14px; border-radius:3px; border:1px solid #000; flex:0 0 auto; cursor:pointer; }
input.rg-sw[type=color] { padding:0; background:none; -webkit-appearance:none; appearance:none; }
input.rg-sw[type=color]::-webkit-color-swatch-wrapper { padding:0; }
input.rg-sw[type=color]::-webkit-color-swatch { border:none; border-radius:2px; }
input.rg-sw[type=color]::-moz-color-swatch { border:none; border-radius:2px; }
.rg-row textarea.rg-prompt { flex:1 1 auto; min-width:0; background:var(--comfy-input-bg,#222); color:inherit; resize:none;
  border:1px solid var(--border-color,#555); border-radius:3px; padding:1px 4px; font:inherit; height:18px; line-height:15px;
  overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.rg-row textarea.rg-prompt:focus { height:64px; white-space:pre-wrap; overflow-x:hidden; overflow-y:auto; position:relative; z-index:2;
  scrollbar-gutter:stable; scrollbar-width:thin; padding-right:2px; }
.rg-row textarea.rg-prompt:focus::-webkit-scrollbar { width:8px; }
.rg-row textarea.rg-prompt:focus::-webkit-scrollbar-thumb { background:#666; border-radius:4px; }
.rg-row:has(textarea.rg-prompt:focus) { align-items:flex-start; }
.rg-row input[type=text] { flex:1 1 auto; min-width:0; background:var(--comfy-input-bg,#222); color:inherit;
  border:1px solid var(--border-color,#555); border-radius:3px; padding:1px 4px; font:inherit; }
.rg-row .rg-sel { flex:0 0 auto; max-width:78px; }
.rg-eye { width:20px; text-align:center; }
.rg-pseudo { font-style:italic; opacity:.85; flex:1 1 auto; }
.rg-hint { opacity:.65; font-size:11px; }
.rg-row.region.off > :not(.rg-reye):not(.rg-chev) { opacity:.45; }
.rg-size { display:flex; align-items:center; gap:3px; width:100%; height:100%; box-sizing:border-box; overflow:hidden;
  font:12px sans-serif; color:var(--input-text,#ddd); pointer-events:auto; }
.rg-size .rg-btn, .rg-size .rg-sel, .rg-size .rg-num, .rg-presets .rg-btn, .rg-presets .rg-num { background:var(--comfy-input-bg,#222);
  color:inherit; border:1px solid var(--border-color,#555); border-radius:4px; padding:1px 4px; font:inherit; }
.rg-size .rg-btn { cursor:pointer; }
.rg-size .rg-btn.on { background:#3a6ea5; border-color:#5b8fd0; color:#fff; }
.rg-size .rg-btn.icon { padding:2px 4px; line-height:0; }
.rg-size .rg-btn.icon svg { width:16px; height:16px; display:block; }
.rg-size .rg-seg { display:inline-flex; flex:0 0 auto; }
.rg-size .rg-seg .rg-btn { border-radius:0; margin:0; }
.rg-size .rg-seg .rg-btn + .rg-btn { border-left-width:0; }
.rg-size .rg-seg .rg-btn:first-child { border-radius:4px 0 0 4px; }
.rg-size .rg-seg .rg-btn:last-child { border-radius:0 4px 4px 0; }
.rg-size-part { display:inline-flex; align-items:center; gap:3px; min-width:0; flex:0 1 auto; }
.rg-size .rg-sel { min-width:0; max-width:170px; flex:0 1 auto; }
.rg-size .rg-hint { opacity:.65; font-size:11px; }
.rg-size-out { margin-left:auto; padding-left:4px; white-space:nowrap; opacity:.8; font-variant-numeric:tabular-nums; }
.rg-size.ext .rg-size-part, .rg-size.ext .rg-seg { opacity:.45; }
.rg-size.ext .rg-size-out { opacity:1; color:#8fb8e8; }
.rg-size.editsized .rg-size-part > select:first-child { opacity:.45; }
.rg-presets { position:fixed; z-index:10000; display:flex; flex-direction:column; gap:4px; padding:6px 8px; max-height:70vh;
  background:var(--comfy-menu-bg,#2a2a2a); color:var(--input-text,#ddd); border:1px solid var(--border-color,#555); border-radius:6px;
  font:12px sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.5); }
.rg-presets-head { display:flex; align-items:center; justify-content:space-between; gap:8px; font-weight:600; }
.rg-presets-list { display:flex; flex-direction:column; gap:3px; overflow:auto; }
.rg-presets-row { display:flex; align-items:center; gap:3px; }
.rg-presets-name { width:110px; background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555);
  border-radius:4px; padding:1px 4px; font:inherit; }
.rg-presets-foot { display:flex; gap:4px; justify-content:flex-end; }
.rg-presets .rg-btn:disabled { opacity:.4; }
.rg-wc-filled { box-shadow:inset 3px 0 0 -1px #c9a14a; }
.rg-pop-lbl .rg-wc-use { margin-left:6px; padding:0 3px; line-height:0; vertical-align:middle; }
.rg-pop .rg-wc-use svg, .rg-pop .rg-wc-pick svg { width:14px; height:14px; display:block; }
.rg-pop .rg-wc-pick { line-height:0; padding:1px 3px; }
.rg-msg { display:flex; gap:6px; align-items:flex-start; flex:0 0 auto; font-size:12px; padding:4px 6px; margin:2px 0;
  background:#3a2424; border:1px solid #b05656; border-radius:4px; color:#f6dddd; user-select:text; -webkit-user-select:text; cursor:auto; }
.rg-msg-icon { flex:0 0 auto; line-height:20px; }
.rg-msg-text { flex:1 1 auto; min-width:0; line-height:20px; overflow-wrap:anywhere; white-space:pre-wrap; }
.rg-msg-text a { color:#9cc4ff; text-decoration:underline; cursor:pointer; }
.rg-msg .rg-btn { flex:0 0 auto; user-select:none; -webkit-user-select:none; }
.rg-banner { display:flex; flex-wrap:wrap; gap:6px; align-items:center; font-size:12px; padding:4px 6px; margin:2px 0;
  background:#3a3220; border:1px solid #b08d3c; border-radius:4px; color:#f2e3bf; }
`;

function injectStyle() {
    for (const id of ["rg-style", "rg-style-v2", "rg-style-v3", "rg-style-v4", "rg-style-v5", "rg-style-v6", "rg-style-v7", "rg-style-v8"]) document.getElementById(id)?.remove();
    const s = document.createElement("style");
    s.id = "rg-style-v8";
    s.textContent = STYLE + CHIP_CSS + WC_CSS;
    document.head.appendChild(s);
}

function chain(obj, prop, fn) {
    const orig = obj[prop];
    obj[prop] = function () {
        const r = orig?.apply(this, arguments);
        fn.apply(this, arguments);
        return r;
    };
}

function linkOf(graph, id) {
    const links = graph?.links;
    if (!links) return null;
    return typeof links.get === "function" ? links.get(id) : links[id];
}

// Outputs before the 'prompt' output replaced moss_layout_json, ideogram_json and text_prompt: on load, links of a
// saved Region Genie node are moved to the output of the same name (those three to 'prompt').
const OLD_OUTPUT_NAMES = { moss_layout_json: "prompt", ideogram_json: "prompt", text_prompt: "prompt" };
function remapOutputs(node, names, types) {
    const outs = node.outputs;
    if (!Array.isArray(outs) || !Array.isArray(names) || !names.length) return false;
    if (outs.length === names.length && outs.every((o, i) => o?.name === names[i])) return false;
    const graph = node.graph;
    const slots = names.map(() => null), links = names.map(() => []);
    for (const o of outs) {
        const j = names.indexOf(OLD_OUTPUT_NAMES[o?.name] ?? o?.name);
        if (j === -1) {                                     // an output that no longer exists: drop its links
            for (const id of o?.links || []) {
                const l = linkOf(graph, id);
                if (l) { try { graph.removeLink(id); } catch (e) { /* ignore */ } }
            }
            continue;
        }
        if (!slots[j]) slots[j] = o;
        for (const id of o.links || []) { const l = linkOf(graph, id); if (l) { l.origin_slot = j; links[j].push(id); } }
    }
    node.outputs = names.map((n, j) => {
        const o = slots[j] || { name: n, type: types?.[j] ?? "*", links: null };
        o.name = n; o.type = types?.[j] ?? o.type;
        if (o.label && OLD_OUTPUT_NAMES[o.label]) delete o.label;
        if ("localized_name" in o) o.localized_name = n;
        o.links = links[j].length ? links[j] : null;
        return o;
    });
    node.setDirtyCanvas?.(true, true);
    return true;
}

function hsvHex(h, s, v) {
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return "#" + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16) || 0);
// sRGB -> CIELAB (D65), for "how different do two colors look"
function rgbLab([r, g, b]) {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const rgbHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("").toUpperCase();

// ---- color palettes (MOSS "palette" / Ideogram "color_palette"); same rules as region_genie.py ----
const PAL_MAX = 5, PAL_MIN_D2 = 40 * 40;
function normPalette(p) {
    const out = [];
    for (const c of Array.isArray(p) ? p : []) {
        if (typeof c !== "string") continue;
        let h = c.trim().toUpperCase();
        if (!h.startsWith("#")) h = "#" + h;
        if (/^#[0-9A-F]{6}$/.test(h)) out.push(h);
        if (out.length >= PAL_MAX) break;
    }
    return out;
}
const activePalette = (r) => (r?.paletteOn ? normPalette(r.palette) : []);
function distinctColor(c, taken) {
    const far = (q) => taken.every((t) => (q[0] - t[0]) ** 2 + (q[1] - t[1]) ** 2 + (q[2] - t[2]) ** 2 >= PAL_MIN_D2);
    if (far(c)) return c;
    for (let k = 1; k < 22; k++) {                       // lighter / darker versions of the same color first
        for (const sign of [1, -1]) {
            const d = 12 * k * sign;
            const q = c.map((v) => Math.min(255, Math.max(0, v + d)));
            if (Math.max(...q) >= 32 && far(q)) return q;
        }
    }
    const tk = new Set(taken.map((t) => t.join(",")));
    const q = [...c];
    let n = 0;
    while (tk.has(q.join(",")) && n < 512) {               // crowded: at least keep it unique
        n += 1;
        q[2] = q[2] < 255 ? q[2] + 1 : q[2] - 1;
        if (n % 2) q[1] = q[1] < 255 ? q[1] + 1 : q[1] - 1;
    }
    return q;
}
// region id -> shown color for regions with a palette (its first color, moved a little when it would look like
// black or another region's color); regions without one keep their own colors, which are reserved first
function effectiveColors(regions) {
    const taken = [[0, 0, 0]];
    for (const r of regions) if (!activePalette(r).length) taken.push(hexRgb(r.color));
    const out = new Map();
    for (const r of regions) {
        const pal = activePalette(r);
        if (!pal.length) continue;
        let c = hexRgb(pal[0]);
        const m = Math.max(...c);
        if (m < 32) c = c.map((v) => v + 32 - m);
        c = distinctColor(c, taken);
        taken.push(c);
        out.set(r.id, rgbHex(c));
    }
    return out;
}

// unit-box outline of a base shape (same as shape_verts() in Python). Rounded rectangle: bw x bh is the box (L units)
// and radius the corner radius in % of its shorter side, so corners stay round whatever the box's proportions
function shapeVerts(kind, sides, bw = 1, bh = 1, radius = 20) {
    if (kind === "rect") return [[0, 0], [1, 0], [1, 1], [0, 1]];
    if (kind === "roundrect") {
        const r = Math.max(0, Math.min(50, Number.isFinite(+radius) ? +radius : 20)) / 100 * Math.min(bw, bh);
        if (r <= 0) return [[0, 0], [1, 0], [1, 1], [0, 1]];
        const rx = r / bw, ry = r / bh, n = 8, out = [];
        for (const [cx, cy, a0] of [[1 - rx, ry, -90], [1 - rx, 1 - ry, 0], [rx, 1 - ry, 90], [rx, ry, 180]]) {
            for (let i = 0; i <= n; i++) {
                const a = (a0 + 90 * i / n) * Math.PI / 180;
                out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
            }
        }
        return out;
    }
    if (kind === "ellipse") {
        const n = 128, out = [];
        for (let i = 0; i < n; i++) out.push([0.5 + 0.5 * Math.cos(2 * Math.PI * i / n), 0.5 + 0.5 * Math.sin(2 * Math.PI * i / n)]);
        return out;
    }
    if (kind === "triangle") return [[0.5, 0], [1, 1], [0, 1]];
    if (kind === "heart") {
        const n = 128, pts = [];
        for (let i = 0; i < n; i++) {
            const t = 2 * Math.PI * i / n;
            pts.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
        }
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        return pts.map(([x, y]) => [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)]);
    }
    if (kind === "pentagon" || kind === "hexagon") { sides = kind === "pentagon" ? 5 : 6; kind = "polygon"; }
    const n = Math.max(3, Math.min(64, Math.round(sides || 5)));
    const out = [];
    if (kind === "polygon") {
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + 2 * Math.PI * i / n;
            out.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
        }
    } else if (kind === "star") {
        for (let i = 0; i < 2 * n; i++) {
            const r = i % 2 === 0 ? 0.5 : 0.2, a = -Math.PI / 2 + Math.PI * i / n;
            out.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
        }
    }
    return out;
}

// ---- run-length masks (alternating 0/1 runs, starting with 0; same as decode_runs() in Python)
function encodeRuns(mask) {
    const runs = [];
    let val = 0, n = 0;
    for (let i = 0; i < mask.length; i++) {
        const v = mask[i] ? 1 : 0;
        if (v === val) n++;
        else { runs.push(n); val = v; n = 1; }
    }
    runs.push(n);
    return runs;
}
function decodeRuns(runs, n) {
    const mask = new Uint8Array(n);
    let pos = 0, val = 0;
    for (const run of runs || []) { if (val) mask.fill(1, pos, Math.min(n, pos + run)); pos += run; val ^= 1; }
    return mask;
}
const bitmapCache = new WeakMap();     // op -> {color, canvas}
function bitmapCanvas(op, color) {
    const c0 = bitmapCache.get(op);
    if (c0 && c0.color === color) return c0.canvas;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, op.w); cv.height = Math.max(1, op.h);
    const x = cv.getContext("2d"), img = x.createImageData(cv.width, cv.height);
    const [r, g, b] = hexRgb(color);
    let pos = 0, val = 0;
    for (const run of op.runs || []) {
        if (val) for (let i = pos; i < pos + run; i++) { const k = i * 4; img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255; }
        pos += run; val ^= 1;
    }
    x.putImageData(img, 0, 0);
    bitmapCache.set(op, { color, canvas: cv });
    return cv;
}

// ---- state / migration ----------------------------------------------------
function emptyState() { return { v: 2, regions: [], layers: [] }; }

function normLoras(a) {
    return (Array.isArray(a) ? a : []).filter((x) => x && typeof x.lora === "string")
        .map((x) => ({ lora: x.lora, strength: Number.isFinite(+x.strength) ? +x.strength : 1, on: x.on !== false,
                       ...(typeof x.edit === "string" && x.edit ? { edit: x.edit } : {}) }));      // edit: added by Edit Mode, for that model
}
function normLoraOpts(o) {
    o = o && typeof o === "object" ? o : {};
    const clamp = (v, d) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : d);
    return { separation: clamp(o.separation, 0.85), until: clamp(o.until, 0.25), ...(o.allRegions ? { allRegions: true } : {}),
             ...(o.shareBg ? { shareBg: true } : {}) };            // shareBg: kept-apart regions still share the background
}
function normRegion(r) {
    return { id: r.id, color: String(r.color || "#FFFFFF").toUpperCase(), prompt: r.prompt || "",
             type: TYPES.includes(r.type) ? r.type : "object", text: r.text || "",
             ...(r.fromImage ? { fromImage: true } : {}),
             ...(normLoras(r.loras).length ? { loras: normLoras(r.loras) } : {}),
             ...(r.featherLinked === false ? { featherLinked: false, feather: Math.max(0, Math.round(+r.feather || 0)) } : {}),
             ...(r.featherEdges ? { featherEdges: true } : {}),
             ...(normPalette(r.palette).length ? { palette: normPalette(r.palette) } : {}),
             ...(r.paletteOn ? { paletteOn: true } : {}),
             ...(r.keep ? { keep: true } : {}) };                  // Edit Mode: keep this region as it is in the source
}
// Edit Mode: the edit mask's own grow / feather (px); null = follow Settings > Region Genie > Edit Mode
function normEditMask(m) {
    if (!m || typeof m !== "object") return null;
    const g = Math.round(+m.grow), f = Math.round(+m.feather);
    if (!Number.isFinite(g) && !Number.isFinite(f)) return null;
    return { ...(Number.isFinite(g) ? { grow: Math.max(-256, Math.min(256, g)) } : {}),
             ...(Number.isFinite(f) ? { feather: Math.max(0, Math.min(256, f)) } : {}) };
}

// v1 (global ops in normalized image coords) -> v2: consecutive ops of one region become one layer
function migrateV1(d, W, H) {
    const short = Math.min(W, H);
    let ops = Array.isArray(d.ops) ? d.ops.filter((o) => o && Array.isArray(o.p)) : [];
    const k = ops.map((o) => o.t).lastIndexOf("clear");
    if (k >= 0) ops = ops.slice(k + 1);
    const layers = [];
    let id = 1;
    for (const o of ops) {
        if (o.t !== "stroke" && o.t !== "poly") continue;
        const r = o.r === 0 ? UNSPEC : o.r;
        let L = layers[layers.length - 1];
        if (!L || L.region !== r) {
            L = { id: id++, name: r === UNSPEC ? `Erase ${id - 1}` : `Paint ${id - 1}`, region: r, visible: true, shape: null,
                  sides: 5, bw: W / short, bh: H / short, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, ops: [] };
            layers.push(L);
        }
        L.ops.push({ t: o.t, e: false, d: o.s ?? 0.02, p: o.p.map(([x, y]) => [x * W / short, y * H / short]) });
    }
    return { v: 2, regions: (d.regions || []).filter((r) => r && r.id != null).map(normRegion), layers };
}

// a layer's centre as an offset from the image centre (short-side units); older data: fractions of W and H
function layerCentre(l, W, H) {
    const short = Math.max(1, Math.min(W, H));
    const num = (v, d) => (v !== null && v !== "" && Number.isFinite(+v) ? +v : d);
    if (l.ox != null || l.oy != null) return { ox: num(l.ox, 0), oy: num(l.oy, 0) };
    return { ox: (num(l.cx, 0.5) - 0.5) * W / short, oy: (num(l.cy, 0.5) - 0.5) * H / short };
}

function parseState(text, W, H) {
    let d = null;
    try { d = JSON.parse(text || ""); } catch (e) { /* empty */ }
    if (!d || typeof d !== "object") return emptyState();
    if (!Array.isArray(d.layers)) return migrateV1(d, W, H);
    return {
        v: 2,
        regions: (d.regions || []).filter((r) => r && r.id != null).map(normRegion),
        layers: d.layers.filter((l) => l && typeof l === "object").map((l) => ({
            id: l.id, name: l.name || "Layer", region: l.region ?? UNSPEC, visible: l.visible !== false,
            shape: l.shape || null, sides: l.sides || 5, bw: +l.bw || 1, bh: +l.bh || 1, sx: +l.sx || 1, sy: +l.sy || 1,
            ...(l.shape === "roundrect" ? { radius: Math.max(0, Math.min(50, Number.isFinite(+l.radius) ? +l.radius : 20)) } : {}),
            rot: +l.rot || 0, ...layerCentre(l, W, H), ops: Array.isArray(l.ops) ? l.ops : [],
        })),
        ...(d.importSig ? { importSig: String(d.importSig) } : {}),
        ...(normLoras(d.sceneLoras).length ? { sceneLoras: normLoras(d.sceneLoras) } : {}),
        ...(d.loraOpts ? { loraOpts: normLoraOpts(d.loraOpts) } : {}),
        ...(+d.feather > 0 ? { feather: Math.round(+d.feather) } : {}),
        ...(normEditMask(d.editMask) ? { editMask: normEditMask(d.editMask) } : {}),
    };
}

const LAYOUT_FORMAT = "region_genie_layout";

app.registerExtension({
    name: "RegionGenie.Main",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!NODE_NAMES.includes(nodeData.name)) return;
        injectStyle();

        chain(nodeType.prototype, "onNodeCreated", function () {
            const node = this;
            const findW = (n) => node.widgets?.find((w) => w.name === n);
            const dataW = findW("paint_data");
            const wW = findW("width"), hW = findW("height"), modeW = findW("image_mode");
            const sceneW = findW("scene_prompt_positive"), sceneNegW = findW("scene_prompt_negative");
            const sceneBgW = findW("scene_prompt_background");
            // some frontend versions leave an optional combo empty on new nodes: fall back to its default
            const impW = findW("import_mode"), fmtW = findW("prompt_format");
            const editW = findW("mode"), areaW = findW("edit_area");        // Edit Mode (image-to-image)
            const isEdit = () => editW?.value === "edit";
            const fixImportMode = () => {
                for (const w of [impW, fmtW, editW, areaW]) {
                    const vals = w?.options?.values;
                    if (w && Array.isArray(vals) && vals.length && !vals.includes(w.value)) w.value = vals[0];
                }
            };
            fixImportMode();
            queueMicrotask(fixImportMode); setTimeout(fixImportMode, 0);
            // paint_data, and the rarely used settings (shown as small controls in the bottom-left corner instead)
            const minW = findW("min_region_pixels");
            for (const w of [dataW, modeW, minW, impW, fmtW, editW, areaW, wW, hW]) {
                if (!w) continue;
                w.hidden = true;
                w.computeSize = () => [0, -4];
                const i = node.inputs?.findIndex((inp) => inp.name === w.name);
                if (i != null && i !== -1) node.removeInput(i);
            }
            // the run-time Settings the Python side needs go into the copy of paint_data sent with the prompt
            // (not into the canvas state, so changing a setting doesn't touch undo or the saved layout)
            if (dataW) {
                dataW.serializeValue = () => {
                    const v = dataW.value;
                    try {
                        const d = JSON.parse(v || "{}");
                        if (!d || typeof d !== "object" || Array.isArray(d)) return v;
                        d.autoApart = autoApartSettings();
                        const hint = downstreamFormat();
                        if (hint) d.promptFormatHint = hint;
                        if (isEdit()) { d.edit = editSettings(); d.editMask = editMaskNow(); }
                        d.llmCache = llmCacheSettings();
                        d.minPixels = minPixelsNow();
                        d.wcPerField = !!getSetting(SET.wcPerField, false);
                        d.importMode = importModeNow();
                        return JSON.stringify(d);
                    } catch (e) { return v; }
                };
            }
            // legacy mode shares spare node height between DOM widgets: keep the prompt box ~3 lines
            for (const w of [sceneW, sceneNegW]) if (w?.options) { w.options.getMinHeight = () => 48; w.options.getMaxHeight = () => 72; }
            if (sceneBgW?.options) { sceneBgW.options.getMinHeight = () => 36; sceneBgW.options.getMaxHeight = () => 56; }
            // LoRA Manager's tag autocomplete in both scene prompts (if that pack is installed)
            // the scene prompts: tag autocomplete, and a double-click opens them in the pop-up editor
            // ---- wildcards (Impact Pack): what each field became in the last run (or a preview)
            let wcFilled = {};                       // field key -> { raw, filled }
            const filledFor = (key, raw) => { const f = wcFilled[key]; return f && f.raw === (raw ?? "") && f.filled !== f.raw ? f.filled : null; };
            const sceneTA = {};                      // positive / negative / background -> their textareas
            const SCENE_KEYS = { positive: "scene", negative: "negative", background: "background" };
            function wcFields() {
                const f = { scene: sceneW?.value || "", negative: sceneNegW?.value || "", background: sceneBgW?.value || "" };
                for (const r of state.regions) {
                    if (r.hidden) continue;
                    f["r" + r.id] = r.prompt || "";
                    if (r.type === "text" && r.text) f[`r${r.id}.text`] = r.text;
                }
                return f;
            }
            // a field's tooltip / marker: the text the wildcards filled in (when it's for the text in the field now)
            function wcMark(t, key, raw, base) {
                if (!t) return;
                if (base != null) t.dataset.baseTitle = base;
                const f = filledFor(key, raw), b = t.dataset.baseTitle ?? "";
                const title = (b ? b + "\n" : "") + (f != null ? `Wildcards filled in (last run or preview):\n${f}` : "");
                if (t.title !== title) t.title = title;
                t.classList.toggle("rg-wc-filled", f != null);
            }
            const SCENE_FIELDS = { scene_prompt_positive: "positive", scene_prompt_negative: "negative",
                                   scene_prompt_background: "background" };
            autocompleteWidgets(node, Object.keys(SCENE_FIELDS), (name, t) => {
                if (!SCENE_FIELDS[name]) return;
                sceneTA[SCENE_FIELDS[name]] = t;
                t.addEventListener("dblclick", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    editScene(SCENE_FIELDS[name]);
                });
                if (!/double-click/i.test(t.title || "")) t.title = (t.title ? t.title + "\n" : "") + "Double-click: open in the pop-up editor";
                t.dataset.baseTitle = t.title;
                t.addEventListener("input", () => wcMark(t, SCENE_KEYS[SCENE_FIELDS[name]], t.value));
            });

            // ---------------- editor state ----------------
            let execDims = null;
            let state = emptyState();
            let undoStack = [], redoStack = [];
            let tool = "select", shapeKind = "rect", sides = 5;
            let brush = 0.03;                        // diameter, fraction of the shorter side
            let curRegion = null;                    // region for new shapes / paint (UNSPEC allowed)
            let filter = ALL;                        // layers panel: ALL or a region id
            let selId = null;                        // selected layer id
            let snap = !!getSetting(SET.cmSnap, false);  // Settings > Region Genie
            let grid = Math.max(2, Math.round(+getSetting(SET.cmGrid, 64)) || 64);   // grid in image px
            let view = null, userView = false;       // view: display px = img px * z + (x, y)
            let drag = null;                         // active pointer interaction
            // the selected layer's box and handles are hidden after a click anywhere outside the canvas; the layer
            // stays selected (brush, lasso and fill still paint into it) and shows again when it is used
            let hiddenSel = null;
            let clickPoly = null;                    // lasso being built point by point
            let lastStrokeEnd = null;
            let pick = null;                         // Select object in progress: points, box, text, masks found
            let pickIds = 0, pickBusy = false, pickAgain = false, samUsed = false;
            let backdropRef = null;                  // {filename, subfolder, type} of the backdrop image (for the server)                // image px where the last brush / eraser stroke ended (Shift+click lines)
            let hover = null;                        // display coords of the pointer
            let spaceDown = false;
            let backdrop = null, backdropKey = "", backdropOpacity = 0.5;
            let lastDims = [0, 0];
            let raf = 0;
            let version = 0;                         // bumped on every saved change (label cache key)

            // ---------------- DOM ----------------
            const wrap = el("div", "rg-wrap");
            wrap.tabIndex = 0;
            // ComfyUI's undo tracker catches Ctrl+Z / Ctrl+Y on the whole window before the node sees them,
            // unless a text field has focus. Keyboard focus therefore sits in this hidden read-only field
            // while the editor is in use, so editor shortcuts stay in the editor.
            const keySink = el("input", "rg-keysink");
            keySink.type = "text"; keySink.readOnly = true; keySink.tabIndex = -1;
            keySink.setAttribute("aria-hidden", "true");
            keySink.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0;border:0;padding:0;";
            const isField = (t) => t && (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && t !== keySink && !["range", "checkbox", "button"].includes(t.type)));
            const focusSink = () => keySink.focus({ preventScroll: true });
            wrap.addEventListener("click", (e) => { if (!isField(e.target) && !e.target?.closest?.(".rg-msg")) focusSink(); }, true);
            const bar1 = el("div", "rg-bar");
            function iconBtn(name, title, fn, cls = "") {
                const b = el("button", "rg-btn icon" + (cls ? " " + cls : ""));
                b.innerHTML = svgIcon(name); b.title = title;
                b.addEventListener("click", (e) => { e.preventDefault(); fn(e); });
                return b;
            }
            const sep = () => el("span", "rg-sep");
            const toolBtns = {};
            const addTool = (key, title, icon = key) => {
                const b = iconBtn(icon, title, () => setTool(key));
                toolBtns[key] = b; bar1.appendChild(b); return b;
            };
            addTool("select", "Select: move, resize and rotate layers (V). Shift keeps proportions / snaps angles to 15°.");
            const shapeBtn = iconBtn("shape", "Shape: draw the shape chosen on the right; drag a box, Shift for equal sides, "
                + "Alt to draw from the centre (R, O, T)", () => setTool("shape"));
            toolBtns.shape = shapeBtn;
            const shapeSel = el("select", "rg-sel");
            shapeSel.title = "Shape to draw";
            for (const [k, label] of SHAPES) shapeSel.appendChild(opt(k, label));
            const numIn = (min, max, value, title) => {
                const i = el("input", "rg-num"); i.type = "number"; i.min = String(min); i.max = String(max); i.step = "1";
                i.value = String(value); i.title = title; i.style.display = "none";
                i.addEventListener("keydown", (e) => e.stopPropagation());
                return i;
            };
            const syncShapeOpts = () => {
                sidesIn.style.display = shapeKind === "star" ? "" : "none";
                radiusIn.style.display = shapeKind === "roundrect" ? "" : "none";
            };
            shapeSel.addEventListener("change", () => { shapeKind = shapeSel.value; syncShapeOpts(); setTool("shape"); });
            const sidesIn = numIn(3, 64, sides, "Number of star points");
            sidesIn.addEventListener("change", () => {
                sides = Math.max(3, Math.min(64, parseInt(sidesIn.value) || 5));
                const L = selLayer();
                if (L && L.shape === "star") change(() => { L.sides = sides; });
            });
            let cornerPct = 20;                      // rounded rectangle: corner radius, % of the shorter side
            const radiusIn = numIn(0, 50, cornerPct, "Corner radius of the rounded rectangle, in % of its shorter side (0-50)");
            radiusIn.addEventListener("change", () => {
                cornerPct = Math.max(0, Math.min(50, parseInt(radiusIn.value) || 0));
                radiusIn.value = String(cornerPct);
                const L = selLayer();
                if (L && L.shape === "roundrect") change(() => { L.radius = cornerPct; });
            });
            bar1.append(shapeBtn, shapeSel, sidesIn, radiusIn);
            addTool("brush", "Brush: paint into the selected layer, or a new layer for the active region (B). Shift+click draws a "
                + "straight line from where the last stroke ended. Size: slider on the canvas, [ ], Alt+wheel");
            addTool("lasso", "");
            addTool("fill", "");
            initLassoModes();
            // fill, closing small gaps: the gap size (px)
            const gapIn = numIn(1, 64, TOOL_NUMS.fillGap, "Fill, closing small gaps: openings narrower than about twice this many "
                + "pixels are closed, so the fill doesn't leak through them (default in Settings > Region Genie > Canvas tools)");
            gapIn.addEventListener("change", () => { TOOL_NUMS.fillGap = Math.max(1, Math.min(64, parseInt(gapIn.value) || 4)); gapIn.value = String(TOOL_NUMS.fillGap); });
            bar1.appendChild(gapIn);
            addTool("wand", "");
            const tolIn = numIn(0, 255, TOOL_NUMS.wandTol, "Magic wand tolerance: how different a color may be from the clicked one "
                + "(0-255 per channel) and still be selected (default in Settings > Region Genie > Canvas tools)");
            tolIn.addEventListener("change", () => { TOOL_NUMS.wandTol = Math.max(0, Math.min(255, parseInt(tolIn.value) || 0)); tolIn.value = String(TOOL_NUMS.wandTol); });
            bar1.appendChild(tolIn);
            addTool("object", "Select object (Q): SAM 3.1 finds the object you click in the image under the canvas. Click to add "
                + "a point on the object, Ctrl+click a point that isn't part of it, drag a box around it; Backspace undoes the "
                + "last point, Enter adds the selection to the active region, Esc cancels. Or type what to find in the field "
                + "next to it. Needs the SAM 3.1 model (Settings > Region Genie > Select object).", "samSelect");
            const findIn = el("input", "rg-find");
            findIn.type = "text"; findIn.placeholder = "find all…"; findIn.style.display = "none";
            findIn.title = "Find all: type what to select and press Enter, e.g. 'person' or 'red car, dog' (commas: several "
                + "things). Every match is selected; Ctrl+click one to leave it out (click again to bring it back). Drag a box "
                + "first to search only inside it. Enter adds them all to the active region, Shift+Enter makes each one its "
                + "own region with the text as its prompt.";
            findIn.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); if (findIn.value.trim()) pickFind(findIn.value.trim()); else if (pick?.masks?.length) pickAccept(e.shiftKey); }
                else if (e.key === "Escape") { e.preventDefault(); if (pick) pickCancel(); focusSink(); }
            });
            findIn.addEventListener("pointerdown", (e) => e.stopPropagation());
            bar1.appendChild(findIn);
            // the pending selection: add it (Enter) / discard it (Esc); shown while there is one
            const pickOkBtn = iconBtn("check", "Add the selection to the active region (Enter). Switching to another tool adds it too.", () => { if (pick) pickAccept(false); focusSink(); });
            const pickNoBtn = iconBtn("close", "Discard the selection (Esc)", () => { if (pick) pickCancel(); focusSink(); });
            pickOkBtn.style.display = pickNoBtn.style.display = "none";
            bar1.append(pickOkBtn, pickNoBtn);
            function syncPickBtns() {
                const show = tool === "object" && !!pick ? "" : "none";
                if (pickOkBtn.style.display !== show) pickOkBtn.style.display = pickNoBtn.style.display = show;
                const ok = !!pick && !pickBusy && pick.masks.some((m) => !m.off);
                if (pickOkBtn.disabled === ok) pickOkBtn.disabled = !ok;
            }
            addTool("erase", "Eraser: erase from the selected layer (E). Shift+click draws a straight line from where the last stroke ended.");
            addTool("lassoErase", "");
            // tools with variants: right-click chooses (small triangle in the corner); Settings > Canvas tools sets the start
            const LASSO_TIP = "Drag freehand, or click points and close the loop (click the first point, double-click or Enter). ";
            const VARIANTS = {
                lasso: { name: "Lasso", key: "L", modes: {
                    plain: ["lasso", "Lasso", "straight lines between the points"],
                    spline: ["lassoSpline", "Lasso (spline)", "a smooth curve through the points"],
                    magnetic: ["lassoMagnetic", "Lasso (magnetic)", "the outline follows edges in the image under the canvas"] },
                    tip: () => LASSO_TIP + "Filled with the active region (L)." },
                lassoErase: { name: "Lasso erase", key: "Shift+L", modes: {
                    plain: ["lassoErase", "Lasso erase", "straight lines between the points"],
                    spline: ["lassoEraseSpline", "Lasso erase (spline)", "a smooth curve through the points"],
                    magnetic: ["lassoEraseMagnetic", "Lasso erase (magnetic)", "the outline follows edges in the image under the canvas"] },
                    tip: () => LASSO_TIP + "Erases from the selected layer (Shift+L)." },
                wand: { name: "Magic wand", modes: {
                    contiguous: ["wand", "Magic wand", "selects the connected area of similar color around the click"],
                    global: ["wandGlobal", "Magic wand (all similar colors)", "selects every pixel of similar color"] },
                    tip: () => "Works on the image under the canvas (the 'image' input): each click adds what it selects to the "
                        + "active region (W). Tolerance: the field next to it." },
                fill: { name: "Fill", modes: {
                    normal: ["fill", "Fill", "fills the clicked area (blank space, or one color)"],
                    gaps: ["fillGaps", "Fill (closing small gaps)", "fills the clicked area, but doesn't leak through small openings (gap size: the field next to it)"] },
                    tip: () => "With the active region (F)." },
            };
            function refreshVariantButtons() {
                for (const [key, info] of Object.entries(VARIANTS)) {
                    const b = toolBtns[key], m = LASSO_MODES[key], [icon, label, what] = info.modes[m];
                    b.innerHTML = svgIcon(icon);
                    b.classList.add("variants");
                    b.title = `${label}: ${what}. ${info.tip()} Right-click: other versions.`;
                }
                if (document.activeElement !== tolIn) tolIn.value = String(TOOL_NUMS.wandTol);
                if (document.activeElement !== gapIn) gapIn.value = String(TOOL_NUMS.fillGap);
                syncToolOpts();
            }
            function syncToolOpts() {
                tolIn.style.display = tool === "wand" ? "" : "none";
                findIn.style.display = tool === "object" ? "" : "none";
                gapIn.style.display = tool === "fill" && LASSO_MODES.fill === "gaps" ? "" : "none";
            }
            lassoRefreshers.add(refreshVariantButtons);
            for (const [key, info] of Object.entries(VARIANTS)) {
                toolBtns[key].addEventListener("contextmenu", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    const items = Object.entries(info.modes).map(([mode, [, label]]) =>
                        ({ content: (LASSO_MODES[key] === mode ? "✓ " : " ") + label, mode }));
                    contextMenu(e, items, info.name, (v) => {
                        if (v?.mode) {
                            LASSO_MODES[key] = v.mode;
                            if (clickPoly && (key === "lasso" || key === "lassoErase")) { clickPoly.spline = v.mode === "spline"; clickPoly.magnetic = v.mode === "magnetic"; }
                            refreshVariantButtons(); setTool(key);
                        }
                        focusSink();
                    });
                });
                toolBtns[key].addEventListener("pointerdown", (e) => { if (e.button === 2) e.stopPropagation(); });
            }
            refreshVariantButtons();
            // arrange the selected layer: flip, align to the image, grow / shrink
            const arrangeBtn = iconBtn("arrange", "Arrange the selected layer: flip, align to the image, grow or shrink", () => toggleArrange());
            bar1.appendChild(arrangeBtn);
            let arrangePop = null, growPx = 8;
            function closeArrange() {
                if (!arrangePop) return;
                arrangePop.remove(); arrangePop = null;
                window.removeEventListener("pointerdown", arrangeOutside, true);
                arrangeBtn.classList.remove("on");
            }
            function arrangeOutside(e) { if (arrangePop && !arrangePop.contains(e.target) && !arrangeBtn.contains(e.target)) closeArrange(); }
            function toggleArrange() {
                if (arrangePop) { closeArrange(); return; }
                const pop = el("div", "rg-arrange");
                const row = (label) => { const r = el("div", "rg-arrange-row"); if (label) { const t = el("span", "rg-hint"); t.textContent = label; r.appendChild(t); } pop.appendChild(r); return r; };
                const act = (icon, title, fn) => {
                    const b = iconBtn(icon, title, () => { const L = selLayer(); if (!L) { hint("Select a layer first"); return; } fn(L); });
                    b.addEventListener("pointerdown", (e) => e.stopPropagation());
                    return b;
                };
                row("Flip").append(
                    act("flipH", "Flip horizontally (mirror left-right)", (L) => flipLayer(L, "h")),
                    act("flipV", "Flip vertically (upside down)", (L) => flipLayer(L, "v")));
                row("Align").append(
                    act("alignL", "Align to the left edge of the image", (L) => alignLayer(L, "l")),
                    act("alignCH", "Centre horizontally in the image", (L) => alignLayer(L, "ch")),
                    act("alignR", "Align to the right edge of the image", (L) => alignLayer(L, "r")),
                    act("alignT", "Align to the top edge of the image", (L) => alignLayer(L, "t")),
                    act("alignCV", "Centre vertically in the image", (L) => alignLayer(L, "cv")),
                    act("alignB", "Align to the bottom edge of the image", (L) => alignLayer(L, "b")),
                    act("alignCenter", "Centre in the image", (L) => alignLayer(L, "c")));
                const pxIn = el("input", "rg-num"); pxIn.type = "number"; pxIn.min = "1"; pxIn.max = "512"; pxIn.step = "1"; pxIn.value = String(growPx);
                pxIn.title = "How many image pixels to grow or shrink by";
                pxIn.addEventListener("keydown", (e) => e.stopPropagation());
                pxIn.addEventListener("change", () => { growPx = Math.max(1, Math.min(512, parseInt(pxIn.value) || 8)); pxIn.value = String(growPx); });
                const GROW_NOTE = " The layer becomes pixels (a shape can't be edited as a shape any more). Undoable.";
                row("Edge").append(
                    act("layerGrow", "Grow the layer's area by this many pixels on every side." + GROW_NOTE, (L) => growLayer(L, growPx)),
                    act("layerShrink", "Shrink the layer's area by this many pixels on every side." + GROW_NOTE, (L) => growLayer(L, -growPx)),
                    pxIn);
                const hintPx = el("span", "rg-hint"); hintPx.textContent = "px"; pop.lastChild.appendChild(hintPx);
                document.body.appendChild(pop);
                const r = arrangeBtn.getBoundingClientRect();
                pop.style.left = `${Math.max(4, Math.min(window.innerWidth - pop.offsetWidth - 4, r.left))}px`;
                pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 4, r.bottom + 4)}px`;
                arrangePop = pop; arrangeBtn.classList.add("on");
                window.addEventListener("pointerdown", arrangeOutside, true);
            }

            // snap to grid: magnet (on, highlighted) / slashed magnet (off), like the labels eye
            const snapBtn = iconBtn("magnetOff", "", () => { snap = !snap; setSnapIcon(); requestDraw(); }, "toggle");
            function setSnapIcon() {
                snapBtn.innerHTML = svgIcon(snap ? "magnet" : "magnetOff");
                snapBtn.classList.toggle("on", snap);
                snapBtn.title = snap ? "Snap to grid on: points, shapes and moves snap to the grid (click or G to turn off)"
                    : "Snap to grid off: click (or G) to snap points, shapes and moves to the grid";
            }
            setSnapIcon();
            const gridIn = el("input", "rg-num");
            gridIn.type = "number"; gridIn.min = "2"; gridIn.max = "4096"; gridIn.value = String(grid);
            gridIn.title = "Grid size in image pixels";
            gridIn.addEventListener("change", () => { grid = Math.max(2, parseInt(gridIn.value) || 64); requestDraw(); });
            const undoBtn = iconBtn("undo", "Undo (Ctrl+Z)", undo);
            const redoBtn = iconBtn("redo", "Redo (Ctrl+Shift+Z / Ctrl+Y)", redo);
            const fitBtn = btn("Fit", "Fit the image in view (Home). Wheel zooms, middle-drag or Space+drag pans.", () => { userView = false; fitView(); requestDraw(); });
            const clearBtn = iconBtn("clear", "Clear all: remove every layer and region (undoable)", () => {
                if (state.layers.length || state.regions.length || state.importSig) change(() => { state.layers = []; state.regions = []; delete state.importSig; selId = null; curRegion = null; filter = ALL; });
            });
            const bdBox = el("span", "rg-bar"); bdBox.style.display = "none";
            const bdLbl = el("span"); bdLbl.textContent = "Image opacity";
            bdLbl.title = "Opacity of the image connected to the 'image' input, shown under the regions";
            const bdIn = el("input");
            bdIn.type = "range"; bdIn.min = "0"; bdIn.max = "1"; bdIn.step = "0.05"; bdIn.value = String(backdropOpacity);
            bdIn.style.width = "56px"; bdIn.title = bdLbl.title;
            bdIn.addEventListener("input", () => { backdropOpacity = parseFloat(bdIn.value); requestDraw(); });
            bdBox.append(bdLbl, bdIn);
            node.properties = node.properties || {};
            if (node.properties.rg_labels === undefined) node.properties.rg_labels = true;
            const labBtn = iconBtn("eye", "", () => {
                node.properties.rg_labels = node.properties.rg_labels === false;
                setLabIcon(); requestDraw();
            }, "toggle");
            function setLabIcon() {
                const on = node.properties.rg_labels !== false;
                labBtn.innerHTML = svgIcon(on ? "eye" : "eyeOff");
                labBtn.classList.toggle("on", on);
                labBtn.title = on ? "Labels on: each region's number and prompt are shown on the canvas (click to hide)"
                    : "Labels off: click to show each region's number and prompt on the canvas";
            }
            setLabIcon();
            const dimsLbl = el("span", "rg-hint"); dimsLbl.style.marginLeft = "auto";
            bar1.append(sep(), undoBtn, redoBtn, clearBtn, sep(), snapBtn, gridIn, fitBtn, labBtn, bdBox, dimsLbl);
            // ---- layout files (bottom right of the node)
            const exportBtn = btn("Export", "Save this layout (regions, LoRAs, layers, scene prompt, size) as a .json file. "
                + "Load it again with Import, or through the import_json input.", exportLayout);
            const importBtn = btn("Import", "Load a layout file: one saved with Export, or MOSS-Image layout JSON, "
                + "Ideogram caption JSON / elements, or bboxes (boxes become rectangles). Undoable.", () => fileIn.click());
            const fileIn = el("input"); fileIn.type = "file"; fileIn.accept = ".json,.txt,application/json,text/plain"; fileIn.style.display = "none";
            fileIn.addEventListener("change", async () => {
                const f = fileIn.files?.[0]; fileIn.value = "";
                if (f) { try { await importLayoutText(await f.text(), true); } catch (e) { notify(`Import failed: ${e.message || e}`, true); } }
            });
            // footer (bottom left): mode, change (Edit Mode), format, LLM Settings, tag autocomplete
            const settings = el("div", "rg-settings");
            const setSel = (w, label, opts, title) => {
                const lab = el("label"); lab.title = title;
                if (label) { const t = el("span", "rg-hint"); t.textContent = label; lab.appendChild(t); }
                const sel = el("select", "rg-sel");
                for (const [v, txt] of opts) sel.appendChild(opt(v, txt));
                sel.title = title;
                sel.addEventListener("change", () => { setWidget(w, sel.value); requestDraw(); });
                lab.appendChild(sel);
                return { lab, sel, sync: () => { if (w && document.activeElement !== sel && sel.value !== w.value) sel.value = w.value; } };
            };
            // a row of buttons that act as one choice (segmented control)
            const segmented = (items, onPick) => {
                const box = el("span", "rg-seg"), btns = {};
                for (const [v, html, title] of items) {
                    const b = el("button", "rg-btn" + (html.startsWith("<svg") ? " icon" : ""));
                    b.type = "button"; b.innerHTML = html; b.title = title;
                    b.addEventListener("pointerdown", (e) => e.stopPropagation());
                    b.addEventListener("click", (e) => { e.preventDefault(); onPick(v); focusSink(); });
                    btns[v] = b; box.appendChild(b);
                }
                return { box, set: (v) => { for (const [k, b] of Object.entries(btns)) { b.classList.toggle("on", k === v); b.setAttribute("aria-pressed", String(k === v)); } } };
            };
            // ---- image_mode (top bar, only while an image is connected and not in Edit Mode)
            const imgLinked = () => (node.inputs || []).some((i) => i.name === "image" && i.link != null);
            const imgSeg = segmented([
                ["backdrop (trace over)", svgIcon("imgBackdrop"), "Image: backdrop. The connected image is shown under the canvas to trace over "
                    + "(image_mode; the default for new nodes is in Settings > Region Genie)."],
                ["use as color map", svgIcon("imgColorMap"), "Image: color map. The connected image's colors become the regions; painting "
                    + "goes on top. The field next to it: min region pixels (image_mode)."],
            ], (v) => { setWidget(modeW, v); syncSettings(); requestDraw(); });
            const minIn = el("input", "rg-num"); minIn.type = "number"; minIn.min = "1"; minIn.max = "1000000"; minIn.step = "1";
            minIn.title = "Color map: min region pixels. A color becomes a region when it has at least this many flat pixels; "
                + "blended edges and specks go to the nearest region. This is a setting for every node "
                + "(Settings > Region Genie > Color map: min region pixels).";
            minIn.addEventListener("keydown", (e) => e.stopPropagation());
            minIn.addEventListener("change", () => {
                const v = Math.max(1, Math.min(1000000, Math.round(+minIn.value || 64)));
                minIn.value = String(v); setSetting(SET.cmMinPixels, v); setWidget(minW, v);
            });
            const imgBox = el("span", "rg-bar"); imgBox.style.display = "none";
            imgBox.append(imgSeg.box, minIn);
            bar1.insertBefore(imgBox, bdBox);
            const minPixelsNow = () => Math.max(1, Math.round(+getSetting(SET.cmMinPixels, 64)) || 64);
            const importModeNow = () => getSetting(SET.cmImportMode, "ask before replacing") === "always replace" ? "always replace" : "ask before replacing";
            // ---- mode: generate / edit
            const editSeg = segmented([
                ["generate", "Generate", "Generate a new image (mode)."],
                ["edit", "Edit", "Edit the image on 'image' (image-to-image). Connect 'vae' too, and use the 'latent' output (sampler "
                    + "denoise below 1 for models without a reference image). The canvas takes the image's shape at width x height "
                    + "pixels, the image is the backdrop, the model gets it as a reference image where it reads one (Settings > "
                    + "Region Genie > Edit Mode), and the edit LoRA set there for the model is added to the 'Whole image' LoRAs "
                    + "(and removed again when you switch back)."],
            ], (v) => { if (editW?.value === v) return; setWidget(editW, v); onEditModeChanged(); syncSettings(); });
            const areaCtl = setSel(areaW, "change", [["only the regions", "regions only"], ["whole image", "whole image"]],
                "edit_area (Edit Mode): what the sampler may change. Only the regions: the 'latent' output carries a mask of "
                + "all regions, so the rest of the image is kept (like inpainting). Whole image: no mask; the regions still "
                + "steer where each prompt goes.");
            const FMT_TIP = "Format of the 'prompt' output (and 'positive'). auto: from the model on 'model', else the clip, "
                + "else the text encoder 'prompt' is connected to; MOSS JSON when none of them says. MOSS JSON: MOSS Image. "
                + "Ideogram JSON: Ideogram 4. text: Krea 2, Flux, Anima, SDXL / SD1.5 and other models.";
            const fmtCtl = setSel(fmtW, "", [["auto", "auto"], ["MOSS JSON", "MOSS JSON"], ["Ideogram JSON", "Ideogram JSON"],
                ["text", "text"]], FMT_TIP);
            fmtCtl.lab.classList.add("rg-fmt");
            let lastFormat = null;                 // the format the last run used (shown next to 'auto')
            const fmtSel = fmtCtl.sel;
            const FMT_SHORT = { "MOSS JSON": "MOSS", "Ideogram JSON": "Ideogram", "text": "text" };
            const showLastFormat = () => {
                const o = fmtSel?.querySelector('option[value="auto"]');
                if (o) o.textContent = lastFormat ? `auto · ${FMT_SHORT[lastFormat] || lastFormat}` : "auto";
                fmtCtl.lab.title = fmtSel.title = FMT_TIP + (lastFormat ? ` The last run used: ${lastFormat}.` : "");
            };
            const acCtl = autocompleteToggle(node, el);
            const llmSetBtn = iconBtn("shape", "LLM Prompt Enhancer settings: what the LLM sees, the preset for each prompt type, and the "
                + "presets themselves (LLM, LLM-only LoRAs, system prompt, Generate Text settings)", () => {
                if (document.querySelector(".rg-llm-pop")) { closeLlmSettings(); return; }
                openLlmSettings(llmSetBtn, llmHost);
            });
            llmSetBtn.innerHTML = sparkleSvg(false);
            llmSetBtn.classList.add("rg-llmset");
            // ---- wildcards (Impact Pack): what each field became in the last run (or a preview), and the seed control
            function wcMarkScene() {
                for (const [which, w] of [["positive", sceneW], ["negative", sceneNegW], ["background", sceneBgW]]) {
                    wcMark(sceneTA[which], SCENE_KEYS[which], String(w?.value ?? ""));
                }
            }
            function wcSetFilled(filled, preview, msg) {
                wcFilled = { ...(preview ? {} : wcFilled), ...(filled || {}) };
                if (!preview) wcFilled = { ...(filled || {}) };
                wcMarkScene(); renderRegions(); editor?.refresh(); requestDraw();
                const n = Object.keys(filled || {}).length;
                if (msg) hint(msg);
                else if (preview) hint(n ? `Preview: wildcards filled in ${n} field${n > 1 ? "s" : ""} (hover a field, or see the labels). Right-click the seed: use the filled text` : "Nothing to fill");
            }
            function wcUseAll() {
                let n = 0;
                for (const [which, w] of [["positive", sceneW], ["negative", sceneNegW], ["background", sceneBgW]]) {
                    const f = filledFor(SCENE_KEYS[which], String(w?.value ?? ""));
                    if (f != null) { setWidget(w, f); n++; }
                }
                const regs = state.regions.filter((r) => filledFor("r" + r.id, r.prompt || "") != null || filledFor(`r${r.id}.text`, r.text || "") != null);
                if (regs.length) change(() => {
                    for (const r of regs) {
                        const p = filledFor("r" + r.id, r.prompt || ""), t = filledFor(`r${r.id}.text`, r.text || "");
                        if (p != null) { r.prompt = p; n++; }
                        if (t != null) { r.text = t; n++; }
                    }
                });
                wcMarkScene(); editor?.refresh();
                hint(n ? `The filled text is now in ${n} field${n > 1 ? "s" : ""} (Ctrl+Z undoes the regions)` : "No filled text yet: run the workflow or preview first");
            }
            const wcCtl = wildcardSeedControl(node, el, { fields: wcFields, onFilled: wcSetFilled, useAll: wcUseAll });
            settings.append(editSeg.box, areaCtl.lab, fmtCtl.lab, llmSetBtn, acCtl.el, wcCtl.el);
            const syncSettings = () => {
                fmtCtl.sync(); areaCtl.sync(); acCtl.refresh(); wcCtl.refresh();
                editSeg.set(isEdit() ? "edit" : "generate");
                imgSeg.set(modeW?.value === "use as color map" ? "use as color map" : "backdrop (trace over)");
                const ed = isEdit();
                const show = (n, on) => { const d = on ? "" : "none"; if (n.style.display !== d) n.style.display = d; };
                show(areaCtl.lab, ed);
                show(imgBox, !ed && imgLinked());
                show(minIn, modeW?.value === "use as color map");
                if (document.activeElement !== minIn && +minIn.value !== minPixelsNow()) minIn.value = String(minPixelsNow());
                syncEditMaskBox();
            };
            // the edit mask's grow / feather this run uses: the node's own values, else the Settings defaults
            function editMaskNow() {
                const d = editMaskDefaults(), m = state.editMask || {};
                return { grow: m.grow ?? d.grow, feather: m.feather ?? d.feather };
            }
            // Edit Mode: keep this region as it is in the source (lock) or let it change (pencil)
            function keepToggle(r) {
                const b = el("button", "rg-btn mini" + (r.keep ? " toggle on" : ""));
                b.innerHTML = svgIcon(r.keep ? "lock" : "pencil");
                b.title = r.keep
                    ? "Keep (Edit Mode): this region stays as it is in the source image, also with change = whole image, and "
                        + "the edit mask never grows into it. Its prompt is still part of the prompt. Click to let it change."
                    : "Change (Edit Mode): the sampler may change this region. Click to keep it as it is in the source image "
                        + "(it is hatched on the canvas then).";
                b.addEventListener("pointerdown", (e) => e.stopPropagation());
                b.addEventListener("click", (e) => { e.preventDefault(); change(() => { if (r.keep) delete r.keep; else r.keep = true; }); });
                return b;
            }
            const foot = el("div", "rg-foot");
            const footGap = el("span"); footGap.style.flex = "1 1 auto";
            foot.append(settings, footGap, exportBtn, importBtn, fileIn);

            // banner shown when import_json brings a new layout while the canvas has content ("ask before replacing")
            const banner = el("div", "rg-banner"); banner.style.display = "none";
            let pendingImport = null;
            const bannerText = el("span");
            const replaceBtn = btn("Replace canvas", "Load the layout from import_json (undoable). Run again to use it.", () => {
                const p = pendingImport; hideBanner(); if (p) applyLayout(p.state, p.scene_prompt, p.sig, null, p.scene_prompt_negative, null, p.scene_prompt_background);
            });
            const keepBtn = btn("Keep canvas", "Ignore this import_json; it won't ask again until import_json changes.", () => {
                const p = pendingImport; hideBanner(); if (p) { state.importSig = p.sig; save(); }
            });
            banner.append(bannerText, replaceBtn, keepBtn);
            function hideBanner() { pendingImport = null; banner.style.display = "none"; }
            // message bar under the canvas (Select object errors): stays until closed, another tool is picked or the mode
            // changes. Its text can be selected and copied, links open in a new tab, "Copy link" copies the first link.
            const msgBar = el("div", "rg-msg"); msgBar.style.display = "none";
            const msgIcon = el("span", "rg-msg-icon"); msgIcon.textContent = "⚠";
            const msgText = el("div", "rg-msg-text");
            let msgUrl = "";
            const msgCopy = btn("Copy link", "Copy the link to the clipboard", async () => {
                hint(await copyText(msgUrl) ? "Link copied" : "Couldn't copy: select the link and press Ctrl+C");
            });
            const msgClose = btn("✕", "Close this message", () => { hideMsg(); focusSink(); });
            msgBar.append(msgIcon, msgText, msgCopy, msgClose);
            // keep LiteGraph / Nodes 2.0 from treating a text selection as a node drag; the browser's own menu on right-click
            for (const ev of ["pointerdown", "mousedown", "dblclick", "contextmenu", "wheel"]) msgBar.addEventListener(ev, (e) => e.stopPropagation());
            function showMsg(text) {
                msgText.replaceChildren();
                msgUrl = "";
                const re = /https?:\/\/[^\s()<>"']+/g;
                let last = 0, m;
                while ((m = re.exec(text))) {
                    const url = m[0].replace(/[.,;:]+$/, "");
                    msgText.append(text.slice(last, m.index));
                    const a = el("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = url;
                    msgText.append(a);
                    last = m.index + url.length;
                    if (!msgUrl) msgUrl = url;
                }
                msgText.append(text.slice(last));
                msgCopy.style.display = msgUrl ? "" : "none";
                msgBar.style.display = "";
            }
            function hideMsg() { if (msgBar.style.display !== "none") msgBar.style.display = "none"; }
            const msgSelected = () => {
                const sel = window.getSelection?.();
                return !!(sel && !sel.isCollapsed && msgBar.style.display !== "none" && msgBar.contains(sel.anchorNode));
            };
            async function copyText(t) {
                try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* not a secure page: fall back */ }
                const ta = document.createElement("textarea");
                ta.value = t; ta.style.cssText = "position:fixed;left:-9999px;top:0;";
                document.body.appendChild(ta); ta.select();
                let ok = false;
                try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
                ta.remove(); focusSink();
                return ok;
            }
            function notify(msg, isError) {
                try { app.extensionManager?.toast?.add({ severity: isError ? "error" : "info", summary: "Region Genie", detail: msg, life: 5000 }); }
                catch (e) { console[isError ? "error" : "log"]("[Region Genie]", msg); }
            }

            let configured = false;              // loaded from a workflow: keep its size
            const cvBox = el("div", "rg-cv");
            // Nodes 2.0 sends wheel events over nodes to the graph unless the element is marked like this
            // and contains the focused element (the hidden keyboard field, focused on hover below).
            wrap.dataset.captureWheel = "true";        // only here: the nearest marked ancestor must contain the focus
            const cv = el("canvas");
            cvBox.appendChild(cv);
            const ctx = cv.getContext("2d");

            // ---- brush size: vertical slider over the left edge of the canvas (brush and eraser tools)
            const BMIN = 0.002, BMAX = 0.3;
            const bSlider = el("div", "rg-bslider"); bSlider.style.display = "none";
            bSlider.innerHTML = '<svg viewBox="0 0 30 190" preserveAspectRatio="none">'
                + '<circle cx="15" cy="9" r="7.5" fill="rgba(240,240,240,.85)" stroke="#111" stroke-width="1"/>'
                + '<polygon points="7,22 23,22 17,168 13,168" fill="rgba(240,240,240,.55)" stroke="#111" stroke-width="1"/>'
                + '<circle cx="15" cy="180" r="2.6" fill="rgba(240,240,240,.85)" stroke="#111" stroke-width="1"/></svg>';
            const bHandle = el("div", "rg-bhandle");
            bSlider.appendChild(bHandle);
            const bTip = el("div", "rg-btip");
            cvBox.append(bSlider, bTip);
            const TRACK_TOP = 22 / 190, TRACK_BOT = 168 / 190;          // fractions of the slider height
            const brushToT = (b) => Math.log(b / BMIN) / Math.log(BMAX / BMIN);          // 0 small .. 1 large
            function updateBrushSlider() {
                const t = Math.min(1, Math.max(0, brushToT(brush)));
                bHandle.style.top = `${(TRACK_BOT - t * (TRACK_BOT - TRACK_TOP)) * 100}%`;
                bTip.textContent = `Brush size: ${Math.max(1, Math.round(brush * Math.min(...dims())))} px  (drag, [ ] or Alt+wheel)`;
            }
            function brushFromY(clientY) {
                const r = bSlider.getBoundingClientRect();
                const f = (clientY - r.top) / Math.max(1, r.height);
                const t = Math.min(1, Math.max(0, (TRACK_BOT - f) / (TRACK_BOT - TRACK_TOP)));
                brush = BMIN * Math.pow(BMAX / BMIN, t);
                updateBrushSlider(); requestDraw();
            }
            let bTipTimer = 0, bDrag = false;
            const hideBTip = () => { clearTimeout(bTipTimer); bTip.style.display = "none"; };
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
                    const r = bSlider.getBoundingClientRect(), br = cvBox.getBoundingClientRect();
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
                brush = Math.min(BMAX, Math.max(BMIN, brush * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
                updateBrushSlider(); requestDraw();
            }, { passive: false });
            const comp = document.createElement("canvas"), cctx = comp.getContext("2d");
            const scratch = document.createElement("canvas"), sctx = scratch.getContext("2d");
            const hit = document.createElement("canvas"); hit.width = hit.height = 1;
            const hctx = hit.getContext("2d", { willReadFrequently: true });

            // bottom: one tree: regions, each with its LoRAs and (expandable) layers
            const tree = el("div", "rg-tree");
            const treeHead = el("div", "rg-head");
            const treeTitle = el("span"); treeTitle.textContent = "Regions";
            const addRegionBtn = btn("", "Add a region with a new color (it goes on top)", () => {
                change(() => { const r = newRegion(); selId = null; activateRegion(r.id); });
                shapeKind = "rect"; shapeSel.value = "rect"; syncShapeOpts();
                setTool("shape");                          // the next thing to do is usually drawing its box
                setTimeout(() => regList.querySelector(`textarea[data-rid="${curRegion}"]`)?.focus(), 0);
            });
            // show / hide one kind of subsection (layers, LoRAs, palettes) in every region at once, or everything
            // + Layer: an empty layer on top of the active region's layers (then paint, lasso or fill into it)
            const addLayerBtn = btn("", "Add an empty layer on top of the active region's layers; brush, lasso and fill then go into it", () => {
                const rid = curRegion;
                if (rid == null || (rid !== UNSPEC && !regionById(rid))) { hint("Select a region first"); return; }
                change(() => { const L = newPaintLayer(rid); L.name = `${rid === UNSPEC ? "Unspecified" : "Layer"} ${L.id}`; addLayer(L); });
                openSub(rid, "layers");
                refreshUI();
            });
            for (const [b, ic] of [[addRegionBtn, "regionAdd"], [addLayerBtn, "layerAdd"]]) { b.innerHTML = svgIcon(ic); b.classList.add("icon"); }
            const expandBtns = {
                layers: btn("▼ Layers", "Show or hide the layers of every region", () => toggleKind("layers")),
                loras: btn("▼ LoRAs", "Show or hide the LoRAs of every region (and of the whole image)", () => toggleKind("loras")),
                palette: btn("▼ Color Palettes", "Show or hide the color palettes of every region", () => toggleKind("palette")),
                all: btn("▼ All", "Show or hide everything in the list", () => toggleKind("all")),
            };
            const statusLbl = el("span", "rg-hint");
            const loraOptsBox = el("span", "rg-loraopts");
            const sepIn = el("input", "rg-num"); sepIn.type = "number"; sepIn.min = "0"; sepIn.max = "1"; sepIn.step = "0.05";
            sepIn.title = "LoRA region separation: how much attention between the image of different LoRA regions is removed "
                + "(MOSS Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5; model output). Higher keeps each LoRA's style in its region; 1 = fully separate.";
            const untilIn = el("input", "rg-num"); untilIn.type = "number"; untilIn.min = "0"; untilIn.max = "1"; untilIn.step = "0.05";
            untilIn.title = "Apply the separation for this fraction of the steps; the rest blends the seams. "
                + "0.1-0.5 with separation 0.85-0.99 works well.";
            const optChange = () => change(() => {
                state.loraOpts = normLoraOpts({ ...normLoraOpts(state.loraOpts), separation: sepIn.value, until: untilIn.value });
            });
            // keep all regions apart (not only those with LoRAs)
            const allApartBtn = btn("", "", () => {
                change(() => { const o = normLoraOpts(state.loraOpts); state.loraOpts = normLoraOpts({ ...o, allRegions: !o.allRegions }); });
                refreshUI();
            });
            allApartBtn.classList.add("icon", "toggle", "variants");
            // right-click: the two choices as check items (keep all regions apart / share the background)
            allApartBtn.addEventListener("pointerdown", (e) => { if (e.button === 2) e.stopPropagation(); });
            allApartBtn.addEventListener("contextmenu", (e) => {
                e.preventDefault(); e.stopPropagation();
                const o = normLoraOpts(state.loraOpts);
                const mark = (on) => (on ? "✓ " : " ");
                const items = [
                    { content: mark(o.allRegions) + "Keep all regions apart", v: "all" },
                    { content: mark(o.shareBg) + "Share the background", v: "bg" },
                ];
                contextMenu(e, items, "Keep regions apart", (v) => {
                    if (v?.v === "all" || v?.v === "bg") {
                        const key = v.v === "all" ? "allRegions" : "shareBg";
                        change(() => { const c = normLoraOpts(state.loraOpts); state.loraOpts = normLoraOpts({ ...c, [key]: !c[key] }); });
                    }
                    focusSink();
                });
            });
            let allApartShown = null;
            let autoApart = false;          // the last run turned it on by itself (a model without a layout format, region prompts)
            function setAllApartBtn() {
                const opts = normLoraOpts(state.loraOpts);
                const own = !!opts.allRegions, on = own || autoApart, shared = !!opts.shareBg;
                const key = `${own}|${autoApart}|${shared}`;
                if (allApartShown === key) return;
                allApartShown = key;
                allApartBtn.innerHTML = svgIcon(shared ? "allApartShared" : "allApart");
                allApartBtn.classList.toggle("on", on);
                allApartBtn.title = (own ? "Keep all regions apart: ON. "
                    : autoApart ? "Keep all regions apart: ON automatically in the last run (a model without a layout format, "
                        + "with region prompts; Settings > Region Genie > keep all regions apart automatically sets this for "
                        + "all such models or one model). "
                        + "Clicking switches it on for this node in any case. "
                    : "Keep all regions apart: OFF. ")
                    + "On: every region, with or without LoRAs, is kept apart from the others and from the background for "
                    + "the first part of sampling ('until'), at the separation strength set here, and each region's caption "
                    + "speaks only to its own region. Off (default): only regions with LoRAs are kept apart. "
                    + "With Krea 2, Flux, Anima or SDXL / SD1.5 (no layout format of their own) this is what places each "
                    + "region's prompt in its region. Needs a MOSS Image, Krea 2, Ideogram 4, Flux, Anima or SDXL / SD1.5 "
                    + "model on the model input; while active, sampling is a "
                    + "little slower and uses more VRAM.\n\n"
                    + (shared ? "Share the background: ON. The regions are kept apart from each other only; the image around "
                        + "them stays shared, so lighting, perspective and setting stay one picture (captions still reach only "
                        + "their own region). "
                        : "Share the background: OFF (the regions are kept apart from the background too). ")
                    + "Right-click for both choices.";
            }
            sepIn.addEventListener("change", optChange); untilIn.addEventListener("change", optChange);
            for (const i of [sepIn, untilIn]) i.addEventListener("keydown", (e) => e.stopPropagation());
            const sepLbl = el("span", "rg-hint"); sepLbl.textContent = "separation"; sepLbl.title = sepIn.title;
            const untilLbl = el("span", "rg-hint"); untilLbl.textContent = "until"; untilLbl.title = untilIn.title;
            loraOptsBox.append(sepLbl, sepIn, untilLbl, untilIn);
            // Edit Mode: the edit mask's own grow / feather (px), shown at the start of this group in Edit Mode only.
            // An empty field follows Settings > Region Genie > Edit Mode (its value shows greyed in the field).
            const editMaskBox = el("span", "rg-editmask");
            const MASK_TIPS = {
                grow: "Edit mask grow (px): the area the sampler may change in Edit Mode grows this far past the regions "
                    + "set to change, so the edit blends into its surroundings; negative shrinks it. Kept regions are never "
                    + "grown into. Separate from each region's own feather (which is for 'masks' and LoRAs). Empty: the "
                    + "Settings default (Settings > Region Genie > Edit Mode), shown greyed.",
                feather: "Edit mask feather (px): softens the edge of the area the sampler may change in Edit Mode (after "
                    + "growing). Separate from each region's own feather. Empty: the Settings default (Settings > Region "
                    + "Genie > Edit Mode), shown greyed.",
            };
            const maskIn = (key, icon, min, max) => {
                const ic = el("span", "rg-fico"); ic.innerHTML = svgIcon(icon); ic.title = MASK_TIPS[key];
                const inp = el("input", "rg-num"); inp.type = "number"; inp.min = String(min); inp.max = String(max); inp.step = "1";
                inp.title = MASK_TIPS[key];
                inp.addEventListener("keydown", (e) => e.stopPropagation());
                inp.addEventListener("change", () => {
                    const raw = inp.value.trim();
                    change(() => {
                        const m = { ...(state.editMask || {}) };
                        if (raw === "" || !Number.isFinite(+raw)) delete m[key]; else m[key] = +raw;
                        const n = normEditMask(m);
                        if (n && Object.keys(n).length) state.editMask = n; else delete state.editMask;
                    });
                });
                editMaskBox.append(ic, inp);
                return inp;
            };
            const growIn = maskIn("grow", "maskGrow", -256, 256), maskFeatherIn = maskIn("feather", "feather", 0, 256);
            function syncEditMaskBox() {
                const d = editMaskDefaults(), m = state.editMask || {};
                for (const [inp, key] of [[growIn, "grow"], [maskFeatherIn, "feather"]]) {
                    if (inp.placeholder !== String(d[key])) inp.placeholder = String(d[key]);
                    const v = m[key] != null ? String(m[key]) : "";
                    if (document.activeElement !== inp && inp.value !== v) inp.value = v;
                }
                const show = isEdit() ? "" : "none";
                if (editMaskBox.style.display !== show) editMaskBox.style.display = show;
            }
            loraOptsBox.prepend(editMaskBox);
            treeHead.append(treeTitle, addRegionBtn, addLayerBtn, expandBtns.layers, expandBtns.loras, expandBtns.palette, expandBtns.all,
                            statusLbl, loraOptsBox);
            loraOptsBox.append(allApartBtn);           // always at the right end; the number fields come and go
            const regList = el("div", "rg-list");
            tree.append(treeHead, regList);
            // the list's open / closed parts (UI only): a region (or the whole-image row, or Unspecified) is open,
            // and inside an open region each subsection (layers, LoRAs, palette) is open on its own
            const SCENE = "scene";
            const expanded = new Set();                  // open rows: region ids, UNSPEC, SCENE
            const subOpen = new Set();                   // `${rid}:layers` | `${rid}:loras` | `${rid}:palette`
            const openSub = (rid, kind) => { expanded.add(rid); subOpen.add(`${rid}:${kind}`); };

            wrap.style.position = "relative";
            wrap.append(keySink, bar1, banner, cvBox, msgBar, tree, foot);
            const domW = node.addDOMWidget("color_map_canvas", "ColorMapCanvas", wrap, {
                serialize: false, hideOnZoom: false, getMinHeight: () => 620,
            });
            domW.serialize = false;
            // ---------------- image size row (top of the node, where the width / height widgets were) ----------------
            // node.properties.rg_size keeps the row's settings (each mode its own); the hidden width / height widgets
            // hold the result, so the Python side, saved workflows and API prompts keep using width / height.
            const SIZE_MODES = ["aspect ratio", "presets", "manual"];
            const clampNum = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
            function sizeDefaults() {
                const mode = getSetting(SET.sizeMode, "aspect ratio"), asp = getSetting(SET.sizeAspect, SIZE_ASPECTS[0][0]);
                const first = parseSizePresets(getSetting(SET.sizePresets, SIZE_PRESETS_DEFAULT))[0] || { w: 1024, h: 1024 };
                return {
                    mode: SIZE_MODES.includes(mode) ? mode : "aspect ratio",
                    ratio: { aspect: SIZE_ASPECTS.some((a) => a[0] === asp) ? asp : SIZE_ASPECTS[0][0], swap: false,
                             mp: clampNum(getSetting(SET.sizeMegapixels, 1), 0.1, 16, 1), multiple: clampNum(getSetting(SET.sizeMultiple, 8), 8, 128, 8) },
                    preset: { w: first.w, h: first.h, swap: false },
                    manual: { w: Math.round(clampNum(getSetting(SET.cmWidth, 1024), 16, 16384, 1024)),
                              h: Math.round(clampNum(getSetting(SET.cmHeight, 1024), 16, 16384, 1024)), link: false },
                };
            }
            function sizeCfg() {
                node.properties = node.properties || {};
                let c = node.properties.rg_size;
                if (!c || typeof c !== "object") {           // a node saved before the size row: manual, with its size
                    c = { ...sizeDefaults(), mode: "manual" };
                    c.manual = { w: Math.round(clampNum(wW?.value, 16, 16384, 1024)), h: Math.round(clampNum(hW?.value, 16, 16384, 1024)), link: false };
                    node.properties.rg_size = c;
                }
                const d = sizeDefaults();
                for (const k of ["ratio", "preset", "manual"]) c[k] = { ...d[k], ...(c[k] && typeof c[k] === "object" ? c[k] : {}) };
                if (!SIZE_MODES.includes(c.mode)) c.mode = "manual";
                return c;
            }
            function sizeOfCfg(c) {
                if (c.mode === "aspect ratio") {
                    const a = SIZE_ASPECTS.find((x) => x[0] === c.ratio.aspect) || SIZE_ASPECTS[0];
                    const [w, h] = ratioSize(a[1], a[2], clampNum(c.ratio.mp, 0.1, 16, 1), clampNum(c.ratio.multiple, 8, 128, 8));
                    return c.ratio.swap ? [h, w] : [w, h];
                }
                if (c.mode === "presets") return c.preset.swap ? [c.preset.h, c.preset.w] : [c.preset.w, c.preset.h];
                return [c.manual.w, c.manual.h];
            }
            function applySize() {
                const [w, h] = sizeOfCfg(sizeCfg());
                setWidget(wW, w); setWidget(hW, h);
                syncSizeRow();
                if (sizeReady) onDimsChanged();
                node.setDirtyCanvas?.(true, true);
            }
            // a size set from elsewhere (an imported layout): typed in, so the row shows it
            function setManualSize(w, h) {
                const c = sizeCfg();
                if (JSON.stringify(sizeOfCfg(c)) === JSON.stringify([w, h])) return;
                c.mode = "manual"; c.manual = { ...c.manual, w, h };
                applySize();
            }
            let sizeReady = false;                     // the editor below is set up (onDimsChanged can run)
            const sizeRow = el("div", "rg-size");
            const sizeSeg = segmented([
                ["aspect ratio", svgIcon("sizeRatio"), "Image size from an aspect ratio and megapixels, like ComfyUI's Resolution Selector"],
                ["presets", svgIcon("sizeList"), "Image size from the presets list (shared by every Region Genie node; 'Edit list…' at its end)"],
                ["manual", svgIcon("sizeManual"), "Image size: width and height typed in"],
            ], (v) => { sizeCfg().mode = v; applySize(); });
            const sizeNum = (min, max, step, title, width) => {
                const i = el("input", "rg-num"); i.type = "number"; i.min = String(min); i.max = String(max); i.step = String(step);
                i.title = title; if (width) i.style.width = width;
                i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") i.blur(); });
                return i;
            };
            const tiny = (text, title) => { const t = el("span", "rg-hint"); t.textContent = text; t.title = title; return t; };
            // aspect ratio
            const aspSel = el("select", "rg-sel");
            aspSel.title = "Aspect ratio (as in ComfyUI's Resolution Selector)";
            for (const [name] of SIZE_ASPECTS) aspSel.appendChild(opt(name, name));
            aspSel.addEventListener("change", () => { sizeCfg().ratio.aspect = aspSel.value; applySize(); });
            const mpIn = sizeNum(0.1, 16, 0.01, "Megapixels: the target pixel count (1.0 = 1024 x 1024 for square)", "48px");
            mpIn.addEventListener("change", () => { const c = sizeCfg(); c.ratio.mp = Math.round(clampNum(mpIn.value, 0.1, 16, 1) * 100) / 100; applySize(); });
            const multIn = sizeNum(8, 128, 4, "Multiple: width and height are rounded to a multiple of this", "38px");
            multIn.addEventListener("change", () => { const c = sizeCfg(); c.ratio.multiple = Math.round(clampNum(multIn.value, 8, 128, 8)); applySize(); });
            const ratioBox = el("span", "rg-size-part");
            const swapBtn = (mode) => iconBtn("swapWH", "Swap width and height (portrait / landscape)", () => {
                const c = sizeCfg();
                if (mode === "manual") c.manual = { ...c.manual, w: c.manual.h, h: c.manual.w }; else c[mode].swap = !c[mode].swap;
                applySize();
            });
            const swapR = swapBtn("ratio"), swapP = swapBtn("preset"), swapM = swapBtn("manual");
            ratioBox.append(aspSel, swapR, tiny("MP", mpIn.title), mpIn, tiny("×", multIn.title), multIn);
            // presets
            const preSel = el("select", "rg-sel rg-size-pre");
            preSel.title = "Image size presets (Settings > Region Genie > Image size; 'Edit list…' to change them)";
            const EDIT_LIST = "__edit__";
            let presetsText = null;
            preSel.addEventListener("change", () => {
                if (preSel.value === EDIT_LIST) { syncSizeRow(true); openPresetEditor(); return; }
                const [w, h] = preSel.value.split("x").map(Number);
                const c = sizeCfg(); c.preset = { ...c.preset, w, h };
                applySize();
            });
            const preBox = el("span", "rg-size-part");
            preBox.append(preSel, swapP);
            // manual
            const wIn = sizeNum(16, 16384, 1, "Width (px)", "54px"), hIn = sizeNum(16, 16384, 1, "Height (px)", "54px");
            const linkBtn = iconBtn("unlink", "", () => { const c = sizeCfg(); c.manual.link = !c.manual.link; syncSizeRow(); });
            const manualSet = (which) => {
                const c = sizeCfg(), m = c.manual, v = Math.round(clampNum((which === "w" ? wIn : hIn).value, 16, 16384, m[which]));
                if (m.link && m.w > 0 && m.h > 0) {           // keep the ratio: the other side follows
                    if (which === "w") c.manual = { ...m, w: v, h: Math.round(clampNum(v * m.h / m.w, 16, 16384, m.h)) };
                    else c.manual = { ...m, h: v, w: Math.round(clampNum(v * m.w / m.h, 16, 16384, m.w)) };
                } else c.manual = { ...m, [which]: v };
                applySize();
            };
            wIn.addEventListener("change", () => manualSet("w"));
            hIn.addEventListener("change", () => manualSet("h"));
            const manBox = el("span", "rg-size-part");
            manBox.append(tiny("W", wIn.title), wIn, swapM, tiny("H", hIn.title), hIn, linkBtn);
            const sizeOut = el("span", "rg-size-out");
            sizeRow.append(sizeSeg.box, ratioBox, preBox, manBox, sizeOut);
            for (const ev of ["pointerdown", "mousedown", "dblclick", "wheel"]) sizeRow.addEventListener(ev, (e) => e.stopPropagation());
            function presetOptions() {
                const text = String(getSetting(SET.sizePresets, SIZE_PRESETS_DEFAULT) ?? "");
                if (text === presetsText) return;
                presetsText = text;
                preSel.replaceChildren();
                for (const p of parseSizePresets(text)) {
                    preSel.appendChild(opt(`${p.w}x${p.h}`, `${p.w} × ${p.h}  (${p.name || ratioLabel(p.w, p.h)})`));
                }
                const sep = opt("", "──────────"); sep.disabled = true;
                preSel.append(sep, opt(EDIT_LIST, "Edit list…"));
            }
            function syncSizeRow(force) {
                const c = sizeCfg();
                sizeSeg.set(c.mode);
                ratioBox.style.display = c.mode === "aspect ratio" ? "" : "none";
                preBox.style.display = c.mode === "presets" ? "" : "none";
                manBox.style.display = c.mode === "manual" ? "" : "none";
                const idle = (i) => force || document.activeElement !== i;
                if (idle(aspSel)) aspSel.value = c.ratio.aspect;
                if (idle(mpIn)) mpIn.value = String(c.ratio.mp);
                if (idle(multIn)) multIn.value = String(c.ratio.multiple);
                presetOptions();
                const key = `${c.preset.w}x${c.preset.h}`;
                if (idle(preSel)) {
                    if (![...preSel.options].some((o) => o.value === key)) {          // not in the list (any more): keep it shown
                        const o = opt(key, `${c.preset.w} × ${c.preset.h}  (not in the list)`); o.dataset.extra = "1";
                        preSel.querySelector("option[data-extra]")?.remove();
                        preSel.insertBefore(o, preSel.firstChild);
                    }
                    preSel.value = key;
                }
                if (idle(wIn)) wIn.value = String(c.manual.w);
                if (idle(hIn)) hIn.value = String(c.manual.h);
                linkBtn.innerHTML = svgIcon(c.manual.link ? "link" : "unlink");
                linkBtn.classList.toggle("on", !!c.manual.link);
                linkBtn.title = c.manual.link ? "Ratio kept: changing one side changes the other. Click to set them separately"
                    : "Keep the ratio: changing one side changes the other";
                swapR.classList.toggle("on", !!c.ratio.swap); swapP.classList.toggle("on", !!c.preset.swap);
                if (!sizeReady) { sizeOut.textContent = sizeOfCfg(c).join(" × "); return; }
                // what decides the size in the end (same priority as the Python side)
                const [W, H] = dims();
                const from = isLinked("size_from_image") ? "from size_from_image" : isLinked("size_from_latent") ? "from size_from_latent"
                    : editSized() ? "Edit: the image's shape at this many pixels"
                    : isLinked("width_in") || isLinked("height_in") ? "from the width / height inputs" : "";
                sizeOut.textContent = `${W} × ${H}`;
                sizeOut.title = from ? `Image size ${W} x ${H}: ${from}` : `Image size: ${W} x ${H}`;
                sizeRow.classList.toggle("ext", /^from/.test(from));
                sizeRow.classList.toggle("editsized", from.startsWith("Edit"));
            }
            // the presets list editor (a small pop-up; the list is a Setting shared by every node)
            let presetPop = null;
            function closePresetEditor() {
                if (!presetPop) return;
                presetPop.remove(); presetPop = null;
                window.removeEventListener("pointerdown", presetOutside, true);
            }
            function presetOutside(e) { if (presetPop && !presetPop.contains(e.target)) closePresetEditor(); }
            function openPresetEditor() {
                closePresetEditor();
                const pop = el("div", "rg-presets");
                presetPop = pop;
                let list = parseSizePresets(getSetting(SET.sizePresets, SIZE_PRESETS_DEFAULT));
                const save = () => { setSetting(SET.sizePresets, formatSizePresets(list)); presetsText = null; syncSizeRow(true); };
                const body = el("div", "rg-presets-list");
                const render = () => {
                    body.replaceChildren();
                    list.forEach((p, i) => {
                        const row = el("div", "rg-presets-row");
                        const w = sizeNum(16, 16384, 1, "Width", "54px"), h = sizeNum(16, 16384, 1, "Height", "54px");
                        w.value = String(p.w); h.value = String(p.h);
                        const name = el("input", "rg-presets-name"); name.type = "text"; name.value = p.name; name.placeholder = ratioLabel(p.w, p.h);
                        name.title = "Name (optional; shown instead of the ratio)";
                        name.addEventListener("keydown", (e) => e.stopPropagation());
                        const upd = () => { list[i] = { w: Math.round(clampNum(w.value, 16, 16384, p.w)), h: Math.round(clampNum(h.value, 16, 16384, p.h)), name: name.value.replace(/[;\n]/g, " ").trim() }; save(); };
                        for (const x of [w, h, name]) x.addEventListener("change", upd);
                        const up = btn("↑", "Move up", () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; save(); render(); } });
                        up.disabled = i === 0;
                        const dn = btn("↓", "Move down", () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; save(); render(); } });
                        dn.disabled = i === list.length - 1;
                        const del = btn("✕", "Remove from the list", () => { list.splice(i, 1); save(); render(); });
                        row.append(w, tiny("×", ""), h, name, up, dn, del);
                        body.appendChild(row);
                    });
                    if (!list.length) { const t = tiny("The list is empty: add the current size below.", ""); body.appendChild(t); }
                };
                const head = el("div", "rg-presets-head");
                const title = el("span"); title.textContent = "Image size presets (every Region Genie node)";
                head.append(title, btn("✕", "Close", () => closePresetEditor()));
                const foot = el("div", "rg-presets-foot");
                const addCur = btn("＋ Current size", "Add the node's current image size to the list", () => {
                    const [cw, ch] = sizeOfCfg(sizeCfg());
                    if (!list.some((p) => p.w === cw && p.h === ch)) { list.push({ w: cw, h: ch, name: "" }); save(); render(); }
                });
                const reset = btn("Defaults", "Put the starting list back", () => { list = parseSizePresets(SIZE_PRESETS_DEFAULT); save(); render(); });
                foot.append(addCur, reset);
                pop.append(head, body, foot);
                for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "keydown"]) pop.addEventListener(ev, (e) => e.stopPropagation());
                render();
                document.body.appendChild(pop);
                const r = preSel.getBoundingClientRect();
                const pw = pop.offsetWidth, ph = pop.offsetHeight;
                pop.style.left = Math.max(6, Math.min(window.innerWidth - pw - 6, r.left)) + "px";
                pop.style.top = (r.bottom + 4 + ph <= window.innerHeight - 6 ? r.bottom + 4 : Math.max(6, r.top - 4 - ph)) + "px";
                setTimeout(() => window.addEventListener("pointerdown", presetOutside, true), 0);
            }
            const sizeW = node.addDOMWidget("rg_size", "RgSize", sizeRow, {
                // legacy mode takes 'margin' off each side of a DOM widget (10 px by default): a 24 px row
                serialize: false, hideOnZoom: false, margin: 3, getMinHeight: () => 30, getMaxHeight: () => 30,
            });
            sizeW.serialize = false;
            // a fixed-height row: legacy mode sizes a widget with computeSize first (26 + 4 px, minus the margins = 24 px);
            // Nodes 2.0 stretches every widget that has computeLayoutSize, so this one hides it (min-content row there)
            sizeW.computeSize = (w) => [w ?? node.size?.[0] ?? 700, 26];
            sizeW.computeLayoutSize = undefined;
            {                                              // at the top, where width / height were
                const ws = node.widgets || [], iS = ws.indexOf(sizeW);
                if (iS > -1) { ws.splice(iS, 1); const iW = ws.indexOf(wW); ws.splice(iW > -1 ? iW : 0, 0, sizeW); }
            }
            // the optional width / height sockets (internal names width_in / height_in) show as "width" / "height"
            const labelSizeInputs = () => {
                for (const inp of node.inputs || []) {
                    if (inp.name === "width_in" && inp.label !== "width") inp.label = "width";
                    if (inp.name === "height_in" && inp.label !== "height") inp.label = "height";
                }
            };
            labelSizeInputs();
            // workflows from before the size row: links into the old width / height sockets move to the new ones
            function moveSizeLinks() {
                for (const [from, to] of [["width", "width_in"], ["height", "height_in"]]) {
                    const i = (node.inputs || []).findIndex((x) => x.name === from);
                    if (i < 0) continue;
                    const id = node.inputs[i].link, j = node.inputs.findIndex((x) => x.name === to);
                    if (id != null && j >= 0 && node.inputs[j].link == null) {
                        const l = linkOf(node.graph, id);
                        if (l) { l.target_slot = j; node.inputs[j].link = id; node.inputs[i].link = null; }
                    }
                    node.removeInput((node.inputs || []).findIndex((x) => x.name === from));
                }
                labelSizeInputs();
            }
            keepWidgetValuesByName(node, ["wildcard_seed", "width", "height", "scene_prompt_positive", "scene_prompt_negative", "scene_prompt_background", "image_mode",
                                          "min_region_pixels", "import_mode", "prompt_format", "mode", "edit_area"]);
            // ComfyUI's right-side properties panel renders the selected node's widgets and writes its own
            // panel width into widget.width, which the classic canvas then uses for the node (the "squished"
            // editor; rgthree's widgets get hit the same way). Keep this node's widgets at the node width.
            const pinWidth = (w) => {
                if (!w || w.__rgPinned) return;
                try {
                    Object.defineProperty(w, "width", { configurable: true, enumerable: false, get: () => undefined, set: () => {} });
                    w.__rgPinned = true;
                } catch (e) { /* non-configurable: leave it */ }
            };
            for (const w of node.widgets || []) pinWidth(w);
            void domW;

            function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
            function opt(v, label) { const o = document.createElement("option"); o.value = String(v); o.textContent = label; return o; }
            function btn(label, title, fn) {
                const b = el("button", "rg-btn");
                b.textContent = label; b.title = title;
                b.addEventListener("click", (e) => { e.preventDefault(); fn(e); });
                return b;
            }

            // ---------------- dims / view ----------------
            const isLinked = (name) => !!node.inputs?.some((i) => i.name === name && i.link != null);
            const srcOf = (name) => {
                const inp = node.inputs?.find((i) => i.name === name && i.link != null);
                const link = inp && linkOf(node.graph, inp.link);
                return link ? node.graph?.getNodeById(link.origin_id) : null;
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
                    const o = node.outputs?.find((x) => x.name === "prompt");
                    for (const id of o?.links || []) {
                        const l = linkOf(node.graph, id), f = formatOfTarget(l && node.graph?.getNodeById(l.target_id));
                        if (f) return f;
                    }
                } catch (e) { /* graph being edited */ }
                return null;
            }
            // size_from_image > size_from_latent > width/height widgets (same priority as the Python side).
            // What the editor can read from the graph is a guess; after a run the node reports the real size,
            // which is used until the guess changes (e.g. a different latent size is set).
            let execGuess = null;
            // Edit Mode with the image connected (and no size_from_* input): the image's shape at the pixel count of
            // width x height, in steps of 16 (edit_size in region_genie.py)
            const editSized = () => isEdit() && isLinked("image") && !isLinked("size_from_image") && !isLinked("size_from_latent");
            function editDims() {
                const s = loadImageSize(srcOf("image"));
                if (!s) return null;
                const pick = (name, widget) => isLinked(name) ? (numberOf(node, name) ?? widget?.value ?? 1024) : (widget?.value ?? 1024);
                const sc = Math.sqrt(+pick("width_in", wW) * +pick("height_in", hW) / Math.max(1, s[0] * s[1]));
                return [Math.max(16, pyRound(s[0] * sc / 16) * 16), Math.max(16, pyRound(s[1] * sc / 16) * 16)];
            }
            function guessInputDims() {
                if (isLinked("size_from_image")) return loadImageSize(srcOf("size_from_image")) || null;
                if (isLinked("size_from_latent")) {
                    const f = feeder(node, "size_from_latent");
                    const w = numberOf(f?.src, "width"), h = numberOf(f?.src, "height");
                    return w && h ? [w, h] : null;
                }
                if (editSized()) return editDims();
                return null;
            }
            function inputDims() {
                if (!isLinked("size_from_image") && !isLinked("size_from_latent") && !editSized()) return null;
                const g = guessInputDims();
                if (execDims && JSON.stringify(g) === JSON.stringify(execGuess)) return execDims;
                return g || execDims || null;
            }
            function dims() {
                const fromInput = inputDims();
                if (fromInput) return [Math.max(1, Math.round(fromInput[0])), Math.max(1, Math.round(fromInput[1]))];
                const pick = (name, widget, i) => isLinked(name)
                    ? (numberOf(node, name) ?? execDims?.[i] ?? widget?.value ?? 1024) : (widget?.value ?? 1024);
                return [Math.max(1, Math.round(pick("width_in", wW, 0))), Math.max(1, Math.round(pick("height_in", hW, 1)))];
            }
            function resizeCanvas() {
                const dpr = window.devicePixelRatio || 1;
                const bw = cvBox.clientWidth, bh = cvBox.clientHeight;
                if (bw < 2 || bh < 2) return false;                    // not laid out yet
                const w = Math.round(bw * dpr), h = Math.round(bh * dpr);
                if (cv.width !== w || cv.height !== h) {
                    const old = [cv.width, cv.height];
                    for (const c of [cv, comp, scratch]) { c.width = w; c.height = h; }
                    if (!view || !userView) fitView();
                    else { view.x += (w - old[0]) / 2; view.y += (h - old[1]) / 2; }   // keep the view centred
                }
                return true;
            }
            function fitView() {
                const [W, H] = dims();
                const cw = cv.width || 1, ch = cv.height || 1;
                const z = Math.min(cw / (W * 1.2), ch / (H * 1.2));
                view = { z, x: (cw - W * z) / 2, y: (ch - H * z) / 2 };
            }
            function onDimsChanged() {
                const [W, H] = dims();
                if (W !== lastDims[0] || H !== lastDims[1]) {
                    lastDims = [W, H];
                    if (!userView) fitView();
                }
                {
                    dimsLbl.textContent = `${W} x ${H}` + (isLinked("size_from_image") ? " (from image)" : isLinked("size_from_latent") ? " (from latent)"
                        : isLinked("width_in") || isLinked("height_in") ? " (from input)" : "");
                }
                syncSizeRow();
                requestDraw();
            }
            const toImg = (sx, sy) => [(sx - view.x) / view.z, (sy - view.y) / view.z];
            const toScr = (ix, iy) => [ix * view.z + view.x, iy * view.z + view.y];
            function evDisplay(e) {
                const r = cv.getBoundingClientRect();
                return [(e.clientX - r.left) * (cv.width / Math.max(1, r.width)), (e.clientY - r.top) * (cv.height / Math.max(1, r.height))];
            }
            const dprNow = () => window.devicePixelRatio || 1;

            // ---------------- geometry ----------------
            const short = () => Math.min(...dims());
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
            const boxCache = new WeakMap();
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
                    paintLocal(x, L, L.ops, "#fff");
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
                c.transform(view.z, 0, 0, view.z, view.x, view.y);
                c.translate(W / 2 + L.ox * s, H / 2 + L.oy * s);
                c.rotate(L.rot * Math.PI / 180);
                c.scale(L.sx * s, L.sy * s);
                c.translate(-L.bw / 2, -L.bh / 2);
            }
            const identityFrame = (L) => L.rot === 0 && L.sx === 1 && L.sy === 1 && Math.abs(L.ox) < 1e-9 && Math.abs(L.oy) < 1e-9 && !L.shape &&
                Math.abs(L.bw - dims()[0] / short()) < 1e-9 && Math.abs(L.bh - dims()[1] / short()) < 1e-9;

            // ---------------- regions ----------------
            const regionById = (id) => state.regions.find((r) => r.id === id);
            // shown colors: a region with a palette is drawn in its first palette color (kept distinct)
            let effCache = { v: -1, map: new Map() };
            const effMap = () => {
                if (effCache.v !== version) effCache = { v: version, map: effectiveColors(state.regions) };
                return effCache.map;
            };
            const colorOf = (rid) => rid === UNSPEC ? "#000000" : (effMap().get(rid) || regionById(rid)?.color);
            const regionLabel = (rid) => rid === UNSPEC ? "Unspecified" : (regionById(rid)?.prompt || `region ${state.regions.findIndex((r) => r.id === rid)}`);
            // a new region's color: the one that looks most different from the colors already on the canvas
            // (perceptual distance, CIELAB), from the built-in list first, then from a wider set of hues
            function nextColor() {
                const shown = state.regions.map((r) => colorOf(r.id) || r.color);
                const used = new Set([...state.regions.map((r) => r.color.toUpperCase()), ...shown.map((c) => c.toUpperCase())]);
                if (!shown.length) return PALETTE[0];
                // black is in the set too: it is "unspecified" in the color map
                const labs = [...shown, "#000000"].map((c) => rgbLab(hexRgb(c)));
                const vivid = (c) => { const [r, g, b] = hexRgb(c), mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx >= 150 && (mx - mn) / mx >= 0.35; };
                const cands = [...PALETTE.filter(vivid).map((c) => [c, 3])];       // small preference for the list
                for (let h = 0; h < 36; h++) for (const [sat, val] of [[1, 1], [0.8, 0.9], [0.55, 1], [1, 0.7]]) cands.push([hsvHex(h / 36, sat, val), 0]);
                let best = null, bestScore = -Infinity;
                for (const [c, bonus] of cands) {
                    if (used.has(c)) continue;
                    const lab = rgbLab(hexRgb(c));
                    let dmin = Infinity;
                    for (const q of labs) dmin = Math.min(dmin, Math.hypot(lab[0] - q[0], lab[1] - q[1], lab[2] - q[2]));
                    if (dmin + bonus > bestScore) { bestScore = dmin + bonus; best = c; }
                }
                return best || uniqueColor(PALETTE[state.regions.length % PALETTE.length], null);
            }
            // keep region colors unique and clearly not black (black = unspecified in the color map)
            function uniqueColor(hex, selfId) {
                let [r, g, b] = hexRgb(hex);
                if (Math.max(r, g, b) < 32) { const k = 32 / Math.max(1, r, g, b); r = Math.max(32, Math.round(r * k)); g = Math.round(g * k); b = Math.round(b * k); }
                const taken = new Set(state.regions.filter((x) => x.id !== selfId).map((x) => x.color.toUpperCase()));
                const toHex = () => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("").toUpperCase();
                let c = toHex(), n = 0;
                while (taken.has(c) && n++ < 512) { b = b < 255 ? b + 1 : b - 1; if (n % 2) g = g < 255 ? g + 1 : g - 1; c = toHex(); }
                return c;
            }
            // layer stack follows the region list: the top region is in front. Unspecified (hole) layers keep their slots.
            function sortLayersByRegions() {
                const rank = new Map(state.regions.map((r, i) => [r.id, state.regions.length - 1 - i]));
                const slots = [], items = [];
                state.layers.forEach((L, i) => { if (L.region !== UNSPEC && rank.has(L.region)) { slots.push(i); items.push([rank.get(L.region), i, L]); } });
                items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
                slots.forEach((slot, k) => { state.layers[slot] = items[k][2]; });
            }
            function newRegion() {
                const id = state.regions.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
                const r = { id, color: nextColor(), prompt: "", type: "object", text: "" };
                if (getSetting(SET.llmNewRegions, false)) r.llm = true;
                state.regions.unshift(r);                // top of the list: its new layers go on top of the stack too
                return r;
            }
            function ensureRegion() {
                if (curRegion === UNSPEC) return UNSPEC;
                if (curRegion == null || !regionById(curRegion)) {
                    curRegion = state.regions[0]?.id ?? newRegion().id;
                }
                revealRegion(curRegion);
                return curRegion;
            }
            // a layer is drawn and output when its own eye and its region's eye are both on
            const isShown = (L) => L.visible !== false && !(L.region !== UNSPEC && regionById(L.region)?.hidden);
            function revealRegion(rid) {                   // drawing into a hidden region shows it again
                const r = regionById(rid);
                if (!r?.hidden) return;
                delete r.hidden;
                keepHintUntil = performance.now() + 3000;
                hint(`'${String(regionLabel(rid)).slice(0, 40)}' was hidden: shown again so you can see what you add`);
                refreshUI();
            }
            const selLayer = () => state.layers.find((l) => l.id === selId) || null;
            const nextLayerId = () => state.layers.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;

            // ---------------- history ----------------
            function snapshot() { return JSON.stringify(state); }
            function pushUndo(before) {
                if (before === snapshot()) return;
                undoStack.push(before);
                if (undoStack.length > HISTORY) undoStack.shift();
                redoStack = [];
            }
            function change(fn) {
                const before = snapshot();
                fn();
                pushUndo(before);
                save(); refreshUI();
            }
            function restore(text) {
                state = JSON.parse(text);
                if (selId != null && !selLayer()) selId = null;
                if (filter !== ALL && filter !== UNSPEC && !regionById(filter)) filter = ALL;
                save(); refreshUI();
            }
            function undo() { if (undoStack.length) { redoStack.push(snapshot()); restore(undoStack.pop()); } }
            function redo() { if (redoStack.length) { undoStack.push(snapshot()); restore(redoStack.pop()); } }
            function save() {
                version++;
                if (dataW) dataW.value = JSON.stringify(state);
                node.graph?.setDirtyCanvas?.(true, true);
            }

            // ---------------- layer actions ----------------
            // stack slot for a new layer of region rid: on top of its own region's layers and of the regions listed
            // below it, under the layers of the regions listed above it (unspecified layers keep their slots)
            function slotFor(rid) {
                if (rid === UNSPEC || !regionById(rid)) return state.layers.length;
                const pos = new Map(state.regions.map((r, i) => [r.id, i]));
                const p = pos.get(rid);
                let top = -1;
                state.layers.forEach((l, i) => { if (pos.has(l.region) && pos.get(l.region) >= p) top = i; });
                return top + 1;
            }
            function addLayer(L, index) {
                state.layers.splice(index ?? slotFor(L.region), 0, L);
                selId = L.id;
                curRegion = L.region;
            }
            function selectLayer(L) {
                selId = L ? L.id : null;
                hiddenSel = null;
                if (L) { curRegion = L.region; openSub(L.region, "layers"); }
                refreshUI();
            }
            // "Ellipse 1 copy", then "Ellipse 1 copy (2)", "(3)", ... like pasting a file twice in a folder
            // (a copy of a copy counts on from the same name: "Ellipse 1 copy" -> "Ellipse 1 copy (2)")
            function copyName(name) {
                const taken = new Set(state.layers.map((l) => l.name));
                const root = String(name).replace(/ copy(?: \(\d+\))?$/, "");
                const base = `${root} copy`;
                if (!taken.has(base)) return base;
                for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
            }
            // the other regions a layer can go to, named by their index (as in the list) and prompt
            function regionTargets(exceptRid) {
                const imap = outputIndexMap(), out = [];
                state.regions.forEach((rg, k) => {
                    if (rg.id === exceptRid) return;
                    const p = (rg.prompt || "").trim().replace(/\s+/g, " ");
                    const short = p ? (p.length > 40 ? p.slice(0, 39) + "…" : p) : "(no prompt)";
                    out.push({ rid: rg.id, label: imap[k] == null ? `Region – (no pixels yet): ${short}` : `Region ${imap[k]}: ${short}` });
                });
                if (exceptRid !== UNSPEC) out.push({ rid: UNSPEC, label: "Unspecified (cuts holes)" });
                return out;
            }
            // a copy in the same place, in this region (right above the original) or on top of another region's
            // layers (it takes that region's color)
            function duplicateTo(L, rid) {
                if (!L || (rid !== UNSPEC && !regionById(rid))) return;
                if (rid === L.region) { duplicate(L); return; }
                if (rid === UNSPEC) expanded.add(UNSPEC); else openSub(rid, "layers");
                change(() => {
                    const c = JSON.parse(JSON.stringify(L));
                    c.id = nextLayerId(); c.name = copyName(L.name); c.region = rid;
                    state.layers.splice(slotFor(rid), 0, c);
                    selId = c.id; curRegion = rid;
                });
            }
            function duplicate(L = selLayer()) {
                if (!L) return;
                change(() => {
                    const c = JSON.parse(JSON.stringify(L));
                    c.id = nextLayerId(); c.name = copyName(L.name);   // same place as the original
                    state.layers.splice(state.layers.indexOf(L) + 1, 0, c);
                    selId = c.id;
                });
            }
            // Ctrl+C / Ctrl+X / Ctrl+V: layers, also between Region Genie nodes (a copy of the layer is kept
            // for the session). A pasted layer lands on top of the active region's layers, in the same place.
            function copyLayer(L, cut) {
                layerClip = JSON.parse(JSON.stringify(L));
                if (cut) { deleteSelected(L); hint(`Cut '${L.name}': Ctrl+V pastes it into the active region`); }
                else hint(`Copied '${L.name}': Ctrl+V pastes it into the active region`);
            }
            function pasteLayer() {
                if (!layerClip) return;
                let rid = curRegion;
                if (rid == null || (rid !== UNSPEC && !regionById(rid))) {
                    rid = layerClip.region === UNSPEC || regionById(layerClip.region) ? layerClip.region : null;
                }
                if (rid == null) { hint("Select a region first: the layer is pasted into the active region"); return; }
                if (rid === UNSPEC) expanded.add(UNSPEC); else openSub(rid, "layers");
                change(() => {
                    const c = JSON.parse(JSON.stringify(layerClip));
                    c.id = nextLayerId(); c.region = rid;
                    if (state.layers.some((l) => l.name === c.name)) c.name = copyName(c.name);
                    state.layers.splice(slotFor(rid), 0, c);
                    selId = c.id; curRegion = rid; hiddenSel = null;
                });
            }
            function deleteSelected(L = selLayer()) {
                if (!L) return;
                change(() => { state.layers.splice(state.layers.indexOf(L), 1); if (selId === L.id) selId = null; });
            }
            function eraseLayer(L = selLayer()) {
                if (!L) return;
                change(() => { L.ops = []; L.shape = null; });
            }
            // next layer up (+1) / down (-1) that this layer can swap with: the same region's layers
            // (unspecified layers move one step through the whole stack, to cut holes above or below other regions)
            function moveTarget(L, dir) {
                const i = state.layers.indexOf(L);
                if (i < 0) return -1;
                for (let j = i + dir; j >= 0 && j < state.layers.length; j += dir) {
                    if (L.region === UNSPEC || state.layers[j].region === L.region) return j;
                }
                return -1;
            }
            function moveLayer(L, dir) {          // dir +1 = up (in front)
                const i = state.layers.indexOf(L), j = moveTarget(L, dir);
                if (i < 0 || j < 0) return;
                change(() => { [state.layers[i], state.layers[j]] = [state.layers[j], state.layers[i]]; });
            }
            function moveLayerToRegion(L, rid) {
                if (L.region === rid) return;
                change(() => {
                    L.region = rid; curRegion = rid; selId = L.id; openSub(rid, "layers");
                    state.layers.splice(state.layers.indexOf(L), 1);
                    state.layers.splice(slotFor(rid), 0, L);
                });
            }
            // rasterize a group of layers (same region) into one pixel-mask paint layer
            function rasterizeLayers(group) {
                const [W, H] = dims(), s = Math.min(W, H);
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                for (const L of group) {
                    const cs = boxCornersImg(L); if (!cs) continue;
                    for (const [x, y] of cs) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
                }
                if (!isFinite(x0)) return null;
                x0 = Math.floor(Math.max(x0, -W)); y0 = Math.floor(Math.max(y0, -H)); x1 = Math.ceil(Math.min(x1, 2 * W)); y1 = Math.ceil(Math.min(y1, 2 * H));
                const r = Math.min(1, RASTER_MAX / Math.max(x1 - x0, y1 - y0, 1));
                const w = Math.max(1, Math.round((x1 - x0) * r)), h = Math.max(1, Math.round((y1 - y0) * r));
                const c = document.createElement("canvas"); c.width = w; c.height = h;
                const x = c.getContext("2d", { willReadFrequently: true });
                const saved = view;
                view = { z: r, x: -x0 * r, y: -y0 * r };
                for (const L of group) {
                    const t = document.createElement("canvas"); t.width = w; t.height = h;
                    drawLayerOn(t.getContext("2d"), L, null, null, "#fff");
                    x.drawImage(t, 0, 0);
                }
                view = saved;
                const d = x.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
                for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
                return { t: "bitmap", e: false, w, h, runs: encodeRuns(mask), x0: x0 / s, y0: y0 / s, x1: x1 / s, y1: y1 / s };
            }
            function mergeInto(group, name) {
                const op = rasterizeLayers(group);
                if (!op) return;
                const top = Math.max(...group.map((L) => state.layers.indexOf(L)));
                const L = newPaintLayer(group[0].region);
                L.name = name;
                L.ops.push(op);
                const keep = state.layers.filter((l) => !group.includes(l));
                const before = state.layers.slice(0, top + 1).filter((l) => !group.includes(l)).length;
                state.layers = keep;
                addLayer(L, before);
            }
            function mergeDown(L = selLayer()) {
                if (!L) return;
                const i = state.layers.indexOf(L);
                const lower = [...state.layers.slice(0, i)].reverse().find((l) => l.region === L.region && l.visible !== false);
                if (!lower) { hint("No lower visible layer in this region to merge into"); return; }
                change(() => mergeInto([lower, L], lower.name));
            }
            function mergeRegion(rid = curRegion) {
                if (rid == null) { hint("Pick a region first"); return; }
                const group = state.layers.filter((l) => l.region === rid && l.visible !== false);
                if (group.length < 2) { hint("Nothing to merge: this region has fewer than two visible layers"); return; }
                change(() => mergeInto(group, `${regionLabel(rid)} (merged)`.slice(0, 40)));
            }
            function setTool(t) {
                if (clickPoly && t !== tool) clickPoly = null;
                if (pick && t !== "object") pickSettle();
                else if (pick && t === "object") pick.acceptOnAnswer = false;
                if (t !== "object") hideMsg();
                tool = t;
                for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle("on", k === t);
                syncToolOpts();
                bSlider.style.display = t === "brush" || t === "erase" ? "" : "none";
                hideBTip(); updateBrushSlider();
                if (performance.now() > keepHintUntil) hint("");       // a note just shown (e.g. region shown again) stays
                requestDraw();
            }
            let hintTimer = 0, keepHintUntil = 0;
            function hint(text) {
                statusLbl.textContent = text || "";
                clearTimeout(hintTimer);
                if (text) hintTimer = setTimeout(() => { statusLbl.textContent = ""; }, 3500);
            }

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
                const color = colorOverride || colorOf(L.region);
                if (!color) return;
                c.save();
                layerTransform(c, L, pre);
                paintLocal(c, L, extraOp ? [...L.ops, extraOp] : L.ops, color);
                c.restore();
            }
            function renderComposite(c, w, h, scr, sc, pre) {
                c.setTransform(1, 0, 0, 1, 0, 0);
                c.clearRect(0, 0, w, h);
                const pending = drag?.mode === "paint" && !drag.target ? drag.layer : null;
                let list = state.layers;
                if (pending) { list = [...state.layers]; list.splice(slotFor(pending.region), 0, pending); }
                for (const L of list) {
                    if (!isShown(L)) continue;
                    const extra = drag?.mode === "paint" && (drag.target === L || L === pending) ? drag.op : null;
                    const needsScratch = L.ops.some((o) => o.e) || extra?.e;
                    if (!needsScratch) { drawLayerOn(c, L, extra, pre); continue; }
                    sc.setTransform(1, 0, 0, 1, 0, 0);
                    sc.clearRect(0, 0, w, h);
                    drawLayerOn(sc, L, extra, pre);
                    c.setTransform(1, 0, 0, 1, 0, 0);
                    c.drawImage(scr, 0, 0);
                }
            }
            function checker(w, h) {
                const s = 10 * dprNow();
                ctx.fillStyle = "#3a3a3a"; ctx.fillRect(0, 0, w, h);
                ctx.fillStyle = "#2a2a2a";
                for (let y = 0; y < h; y += s) for (let x = (Math.floor(y / s) % 2) * s; x < w; x += 2 * s) ctx.fillRect(x, y, s, s);
            }
            function requestDraw() {
                if (raf) return;
                raf = requestAnimationFrame(() => { raf = 0; draw(); });
            }
            function draw() {
                if (!resizeCanvas()) return;
                if (!view) fitView();
                const w = cv.width, h = cv.height, [W, H] = dims(), dpr = dprNow();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                checker(w, h);
                const [ix, iy] = toScr(0, 0), iw = W * view.z, ih = H * view.z;
                ctx.fillStyle = "#000"; ctx.fillRect(ix, iy, iw, ih);
                if (backdrop) {
                    ctx.globalAlpha = backdropOpacity;
                    ctx.drawImage(backdrop, ix, iy, iw, ih);
                    ctx.globalAlpha = 1;
                }
                renderComposite(cctx, w, h, scratch, sctx);
                ctx.save();
                ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
                ctx.globalAlpha = backdrop ? Math.max(0.35, 1 - backdropOpacity * 0.6) : 1;
                ctx.drawImage(comp, 0, 0);
                ctx.restore();
                ctx.save();
                ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(ix, iy, iw, ih); ctx.clip("evenodd");
                ctx.globalAlpha = 0.35;
                ctx.drawImage(comp, 0, 0);
                ctx.restore();
                if (isEdit() && state.regions.some((r) => r.keep)) {        // Edit Mode: kept regions are hatched
                    ctx.save();
                    ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
                    ctx.drawImage(keepHatch(w, h), 0, 0);
                    ctx.restore();
                }
                if (snap && grid * view.z >= 6) {
                    ctx.save();
                    ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
                    ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 1;
                    ctx.beginPath();
                    for (let gx = 0; gx <= W; gx += grid) { const x = Math.round(ix + gx * view.z) + 0.5; ctx.moveTo(x, iy); ctx.lineTo(x, iy + ih); }
                    for (let gy = 0; gy <= H; gy += grid) { const y = Math.round(iy + gy * view.z) + 0.5; ctx.moveTo(ix, y); ctx.lineTo(ix + iw, y); }
                    ctx.stroke();
                    ctx.restore();
                }
                ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1;
                ctx.strokeRect(Math.round(ix) + 0.5, Math.round(iy) + 0.5, Math.round(iw), Math.round(ih));
                if (drag?.mode === "shape") {
                    const t = shapeDragLayer();
                    if (t) { ctx.save(); ctx.globalAlpha = 0.75; drawLayerOn(ctx, t); ctx.restore(); outline(boxCornersImg(t, [0, 0, t.bw, t.bh]), "#fff", true); }
                }
                if (pick || drag?.mode === "pickbox") drawPick(ix, iy, iw, ih);
                syncPickBtns();
                const poly = drag?.mode === "lasso" ? drag : clickPoly;
                if (poly && poly.pts.length) {
                    let pts = clickPoly && hover ? [...poly.pts, toImg(...hover)] : poly.pts;
                    // spline: preview the closed curve it will make (plain click-lasso: the open path so far)
                    const curve = poly.spline && pts.length >= 3;
                    if (curve) pts = lassoOutline(pts, true, !clickPoly);
                    ctx.save();
                    ctx.beginPath();
                    pts.forEach(([x, y], i) => { const [a, b] = toScr(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
                    if (!clickPoly || curve) ctx.closePath();
                    ctx.fillStyle = poly.erase ? "rgba(0,0,0,.45)" : (colorOf(poly.region) || "#fff") + "88";
                    if (pts.length > 2) ctx.fill();
                    ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = "#fff"; ctx.stroke();
                    if (clickPoly) {                                   // points, first one bigger (click it to close)
                        ctx.setLineDash([]);
                        poly.pts.forEach(([x, y], i) => {
                            const [a, b] = toScr(x, y);
                            ctx.beginPath(); ctx.arc(a, b, (i ? 3 : 6) * dpr, 0, Math.PI * 2);
                            ctx.fillStyle = i ? "#fff" : "#5b8fd0"; ctx.fill(); ctx.stroke();
                        });
                    }
                    ctx.restore();
                }
                drawLabels();
                updateRegionIndices();
                const L = selLayer();
                if (L && isShown(L) && hiddenSel !== selId) {
                    const cs = boxCornersImg(L);
                    if (cs) {
                        outline(cs, "#5b8fd0", tool !== "select");
                        if (tool === "select") for (const hd of handles(L)) {
                            ctx.fillStyle = hd.kind === "rotate" ? "#5b8fd0" : "#fff";
                            ctx.strokeStyle = "#1d3d66"; ctx.lineWidth = 1.5;
                            ctx.beginPath();
                            if (hd.kind === "rotate") ctx.arc(hd.x, hd.y, 5 * dpr, 0, Math.PI * 2);
                            else ctx.rect(hd.x - 4 * dpr, hd.y - 4 * dpr, 8 * dpr, 8 * dpr);
                            ctx.fill(); ctx.stroke();
                        }
                    }
                }
                if (hover && (tool === "brush" || tool === "erase")) {
                    const r = Math.max(1, brush * short() * view.z / 2);
                    ctx.beginPath(); ctx.arc(hover[0], hover[1], r, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1; ctx.stroke();
                    ctx.setLineDash([3, 3]); ctx.strokeStyle = "rgba(0,0,0,.9)"; ctx.stroke(); ctx.setLineDash([]);
                }
                undoBtn.disabled = !undoStack.length; redoBtn.disabled = !redoStack.length;
                arrangeBtn.disabled = !selLayer();
                if (arrangeBtn.disabled && arrangePop) closeArrange();
                clearBtn.disabled = !state.layers.length && !state.regions.length;
                bdBox.style.display = backdrop ? "" : "none";
            }
            // the visible pixels of the kept regions (their layers, minus every other layer above them), hatched;
            // cached until the layout or the view changes
            const hatchCv = document.createElement("canvas"), hatchCtx = hatchCv.getContext("2d");
            const hatchTmp = document.createElement("canvas"), hatchTmpCtx = hatchTmp.getContext("2d");
            let hatchKey = "", hatchPat = null, hatchDpr = 0;
            function keepHatch(w, h) {
                const key = `${version}|${w}x${h}|${view.z}|${view.x}|${view.y}|${dprNow()}`;
                if (key === hatchKey) return hatchCv;
                hatchKey = key;
                for (const c of [hatchCv, hatchTmp]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
                const keep = new Set(state.regions.filter((r) => r.keep).map((r) => r.id));
                const x = hatchCtx;
                x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, w, h);
                for (const L of state.layers) {
                    if (!isShown(L) || (L.region !== UNSPEC && !regionById(L.region))) continue;
                    hatchTmpCtx.setTransform(1, 0, 0, 1, 0, 0); hatchTmpCtx.clearRect(0, 0, w, h);
                    drawLayerOn(hatchTmpCtx, L, null, null, "#fff");      // on its own canvas: its erasers stay inside it
                    x.globalCompositeOperation = keep.has(L.region) ? "source-over" : "destination-out";
                    x.drawImage(hatchTmp, 0, 0);
                }
                const d = dprNow();
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
                const dpr = dprNow();
                ctx.save();
                ctx.beginPath();
                cornersImg.forEach(([x, y], i) => { const [a, b] = toScr(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
                ctx.closePath();
                if (dashed) ctx.setLineDash([4 * dpr, 3 * dpr]);
                ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = color; ctx.stroke();
                ctx.restore();
            }
            function handles(L) {
                const box = contentBox(L);
                if (!box) return [];
                const dpr = dprNow();
                const [x0, y0, x1, y1] = box, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
                const out = [];
                for (const [hx, hy] of [[x0, y0], [mx, y0], [x1, y0], [x1, my], [x1, y1], [mx, y1], [x0, y1], [x0, my]]) {
                    const [ix, iy] = layerToImg(L, hx, hy), [sx, sy] = toScr(ix, iy);
                    out.push({ kind: "scale", lx: hx, ly: hy, ax: hx === x0 ? x1 : hx === x1 ? x0 : hx, ay: hy === y0 ? y1 : hy === y1 ? y0 : hy,
                               ex: hx !== mx, ey: hy !== my, x: sx, y: sy });
                }
                const [tx, ty] = toScr(...layerToImg(L, mx, y0)), [cx, cy] = toScr(...layerToImg(L, mx, my));
                const len = Math.hypot(tx - cx, ty - cy) || 1;
                out.push({ kind: "rotate", x: tx + (tx - cx) / len * 22 * dpr, y: ty + (ty - cy) / len * 22 * dpr });
                return out;
            }

            // ---------------- hit testing ----------------
            function hitLayer(dx, dy) {
                for (let i = state.layers.length - 1; i >= 0; i--) {
                    const L = state.layers[i];
                    if (!isShown(L)) continue;
                    hctx.setTransform(1, 0, 0, 1, 0, 0);
                    hctx.clearRect(0, 0, 1, 1);
                    drawLayerOn(hctx, L, null, [1, 0, 0, 1, -dx, -dy]);
                    if (hctx.getImageData(0, 0, 1, 1).data[3] > 0) return L;
                }
                return null;
            }
            function insideBox(L, ix, iy) {
                const box = contentBox(L);
                if (!box) return false;
                const [lx, ly] = imgToLayer(L, ix, iy), [x0, y0, x1, y1] = box;
                return lx >= x0 && lx <= x1 && ly >= y0 && ly <= y1;
            }
            const snapV = (v) => (snap ? Math.round(v / grid) * grid : v);

            // ---------------- region label map (what the outputs will contain, at reduced size) -------------
            // 0 = blank (empty or unspecified), k = region index + 1; blended edges go to the nearest color
            // which region each pixel shows (small copy of the image): every layer is drawn on its own, in stack
            // order, and its solid pixels (alpha >= 128) take its region's number (Unspecified layers set 0), as
            // the Python side does. Not read back from colors: where two regions meet, the blended edge pixels
            // could match a third region's color and give it pixels it doesn't have.
            function labelMap(maxSide) {
                const [W, H] = dims();
                const r = Math.min(1, maxSide / Math.max(W, H));
                const w = Math.max(1, Math.round(W * r)), h = Math.max(1, Math.round(H * r));
                const t = document.createElement("canvas"); t.width = w; t.height = h;
                const x = t.getContext("2d", { willReadFrequently: true });
                const saved = view;
                view = { z: r, x: 0, y: 0 };
                const lab = new Int16Array(w * h);
                const kOf = new Map(state.regions.map((rg, k) => [rg.id, k + 1]));
                const pending = drag?.mode === "paint" && !drag.target ? drag.layer : null;
                let list = state.layers;
                if (pending) { list = [...state.layers]; list.splice(slotFor(pending.region), 0, pending); }
                try {
                    for (const L of list) {
                        if (!isShown(L)) continue;
                        const k = L.region === UNSPEC ? 0 : kOf.get(L.region);
                        if (k == null) continue;
                        const extra = drag?.mode === "paint" && (drag.target === L || L === pending) ? drag.op : null;
                        x.setTransform(1, 0, 0, 1, 0, 0);
                        x.clearRect(0, 0, w, h);
                        drawLayerOn(x, L, extra, undefined, "#ffffff");
                        const d = x.getImageData(0, 0, w, h).data;
                        for (let i = 0, j = 3; i < lab.length; i++, j += 4) if (d[j] >= 128) lab[i] = k;
                    }
                } finally {
                    view = saved;
                }
                return { w, h, r, lab };
            }
            // output index of every region: position among the regions that have visible pixels
            // (Python skips empty regions), or null. Image colors count as present after a run.
            let detectedSet = new Set();
            function outputIndexMap() {
                const present = new Set(regionLabelBoxes().map((b) => b.k));
                let n = 0;
                return state.regions.map((r, k) =>
                    !r.hidden && (present.has(k) || r.fromImage || detectedSet.has(r.color.toUpperCase())) ? n++ : null);
            }
            let idxKey = "";
            function updateRegionIndices(map) {
                map = map || outputIndexMap();
                const key = map.join(",") + "|" + state.regions.map((r) => r.id).join(",");
                if (key === idxKey && regList.querySelector(".rg-idx[data-k]")) return;
                idxKey = key;
                for (const sp of regList.querySelectorAll(".rg-idx[data-k]")) {
                    const v = map[Number(sp.dataset.k)];
                    sp.textContent = v == null ? "–" : String(v);
                    sp.classList.toggle("none", v == null);
                    sp.title = v == null ? (state.regions[Number(sp.dataset.k)]?.hidden ? "Hidden, so this region is not in the outputs"
                        : "No visible pixels yet, so this region is not in the outputs")
                        : `Output index ${v}: masks, bboxes, elements, layouts and Mask Picker / BBoxes to Masks 'index'`;
                }
            }
            let labelCache = { t: 0, key: "", boxes: [] };
            let labelRects = [], labelClick = null;                     // drawn label boxes (canvas pixels), bottom to top
            function regionLabelBoxes() {
                const now = performance.now();
                const key = version + "|" + dims().join("x");
                const busy = !!drag;
                if (labelCache.key === key && !busy) return labelCache.boxes;
                if (busy && now - labelCache.t < 150) return labelCache.boxes;
                const { w, h, r, lab } = labelMap(256);
                const n = state.regions.length;
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
                const m = 3 * dprNow(), placed = [];
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
                if (node.properties?.rg_labels === false) return;
                const dpr = dprNow();
                ctx.save();
                ctx.font = `${11 * dpr}px sans-serif`;
                ctx.textBaseline = "top";
                const imap = outputIndexMap();
                const lh = 13 * dpr, pad = 4 * dpr;
                // measure every label at its preferred spot
                const items = [];
                for (const b of regionLabelBoxes()) {
                    const rg = state.regions[b.k];
                    if (!rg) continue;
                    let text = (filledFor("r" + rg.id, rg.prompt) ?? rg.prompt).trim() || "(no prompt)";
                    if (rg.type === "text" && rg.text) text += `  "${rg.text}"`;
                    if (rg.type === "character") text = "👤 " + text;
                    if (rg.keep && isEdit()) text = "🔒 " + text;            // Edit Mode: kept as it is in the source
                    const [cx, cy] = toScr((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
                    const [rx0, ry0] = toScr(b.x0, b.y0), [rx1, ry1] = toScr(b.x1, b.y1);
                    const regionW = (b.x1 - b.x0) * view.z;
                    const maxW = Math.max(70 * dpr, Math.min(200 * dpr, regionW * 0.9));
                    const lines = wrapText(ctx, text, maxW, 3);
                    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
                    const bw = tw + pad * 2, bh = lines.length * lh + pad * 2 - 2 * dpr;
                    const num = imap[b.k] == null ? "" : String(imap[b.k]);
                    ctx.font = `bold ${11 * dpr}px sans-serif`;
                    const nw = num ? Math.max(lh + 2 * dpr, ctx.measureText(num).width + pad * 2) : 0, gap = num ? 2 * dpr : 0;
                    ctx.font = `${11 * dpr}px sans-serif`;
                    const w = nw + gap + bw;
                    items.push({ k: b.k, rg, lines, num, nw, gap, bw, w, h: bh, dx: cx - w / 2, dy: cy - bh / 2, rx0, ry0, rx1, ry1 });
                }
                // place from the top of the region list down (not by selection, so labels don't jump when you click)
                const prio = [...items].sort((a, b) => a.k - b.k);
                const [W, H] = dims();
                const [ix0, iy0] = toScr(0, 0), [ix1, iy1] = toScr(W, H);
                placeLabels(prio, { x0: Math.max(0, ix0), y0: Math.max(0, iy0), x1: Math.min(cv.width, ix1), y1: Math.min(cv.height, iy1) });
                // draw from the bottom of the list up, active region last (on top)
                const order = [...items].sort((a, b) => b.k - a.k);
                const act = order.findIndex((it) => it.rg.id === curRegion);
                if (act >= 0) order.push(order.splice(act, 1)[0]);
                labelRects = [];
                for (const it of order) {
                    const { rg, lines, num, nw, gap, bw, h: bh } = it;
                    const x0 = it.x + nw + gap, y0 = it.y;
                    if (num) {                                   // index badge right before the prompt box
                        const shown = colorOf(rg.id), [rr, gg, bb] = hexRgb(shown);
                        ctx.globalAlpha = 0.9; ctx.fillStyle = shown; ctx.fillRect(it.x, y0, nw, bh);
                        ctx.globalAlpha = 1; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(it.x, y0, nw, bh);
                        ctx.fillStyle = rr * 0.299 + gg * 0.587 + bb * 0.114 > 140 ? "#000" : "#fff";
                        ctx.font = `bold ${11 * dpr}px sans-serif`; ctx.textAlign = "center";
                        ctx.fillText(num, it.x + nw / 2, y0 + (bh - 11 * dpr) / 2);
                        ctx.textAlign = "left"; ctx.font = `${11 * dpr}px sans-serif`;
                    }
                    labelRects.push({ rid: rg.id, x0: it.x, y0, x1: x0 + bw, y1: y0 + bh });
                    const isAct = rg.id === curRegion;
                    ctx.globalAlpha = isAct ? 0.8 : 0.6; ctx.fillStyle = "#000"; ctx.fillRect(x0, y0, bw, bh);
                    ctx.globalAlpha = 1; ctx.strokeStyle = colorOf(rg.id); ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(x0, y0, bw, bh);
                    ctx.fillStyle = rg.prompt.trim() ? "#fff" : "rgba(255,255,255,.6)";
                    lines.forEach((l, i) => ctx.fillText(l, x0 + pad, y0 + pad + i * lh));
                }
                ctx.restore();
            }

            // ---------------- fill / magic wand ----------------
            // the working raster for fill, wand and grow: the image at most RASTER_MAX px on its longer side
            function rasterSize() {
                const [W, H] = dims(), r = Math.min(1, RASTER_MAX / Math.max(W, H));
                return { W, H, r, w: Math.max(1, Math.round(W * r)), h: Math.max(1, Math.round(H * r)) };
            }
            // label each raster pixel: 0 = blank (empty or unspecified), k = region k (nearest color, so blended edges join a side)
            function regionLabels(R) {
                const { w, h, r } = R;
                const c = document.createElement("canvas"); c.width = w; c.height = h;
                const x = c.getContext("2d", { willReadFrequently: true });
                const t = document.createElement("canvas"); t.width = w; t.height = h;
                const saved = view;
                view = { z: r, x: 0, y: 0 };
                try { renderComposite(x, w, h, t, t.getContext("2d")); } finally { view = saved; }
                const d = x.getImageData(0, 0, w, h).data;
                const pal = state.regions.map((rg) => hexRgb(colorOf(rg.id)));
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
                change(() => {
                    const rid = ensureRegion();
                    const sel = selLayer();
                    if (sel && sel.region === rid && sel.visible !== false && identityFrame(sel)) sel.ops.push(op);
                    else { const L = newPaintLayer(rid); L.name = `${name} ${L.id}`; L.ops.push(op); addLayer(L); }
                });
                return true;
            }
            function fillAt(ix, iy) {
                const R = rasterSize(), { W, H, w, h, r } = R;
                if (ix < 0 || iy < 0 || ix >= W || iy >= H) { hint("Fill works inside the image"); return; }
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
                        hint("Clicked inside a narrow gap: filled without closing gaps");
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
                if (!backdrop || !backdrop.naturalWidth) return null;
                const key = `${backdropKey}|${R.w}x${R.h}`;
                if (bdPix?.key === key) return bdPix.data;
                try {
                    const c = document.createElement("canvas"); c.width = R.w; c.height = R.h;
                    const x = c.getContext("2d", { willReadFrequently: true });
                    x.drawImage(backdrop, 0, 0, R.w, R.h);
                    bdPix = { key, data: x.getImageData(0, 0, R.w, R.h).data };
                    return bdPix.data;
                } catch (e) { return null; }                          // a cross-origin image can't be read
            }
            const NEEDS_IMAGE = "needs an image under the canvas: connect a Load Image node to 'image' (or run once)";
            function wandAt(ix, iy) {
                const R = rasterSize(), { W, H, w, h, r } = R;
                if (ix < 0 || iy < 0 || ix >= W || iy >= H) { hint("The magic wand works inside the image"); return; }
                const d = backdropPixels(R);
                if (!d) { hint("Magic wand " + NEEDS_IMAGE); return; }
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
                if (!backdrop || !backdrop.naturalWidth) return null;
                const [W, H] = dims(), k = Math.min(1, 1024 / Math.max(W, H));
                const w = Math.max(3, Math.round(W * k)), h = Math.max(3, Math.round(H * k)), key = `${backdropKey}|${w}x${h}`;
                if (edgeCache?.key === key) return edgeCache.edges;
                let d;
                try {
                    const c = document.createElement("canvas"); c.width = w; c.height = h;
                    const x = c.getContext("2d", { willReadFrequently: true });
                    x.drawImage(backdrop, 0, 0, w, h);
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
            const magnetRadius = () => 12 * dprNow() / (view?.z || 1);      // how far (image px) a point is pulled to an edge

            // ---------------- Select object (SAM 3.1 on the server) ----------------
            const samKeep = () => getSetting(SET.samKeep, "keep loaded") !== "unload";
            function pickStart() { pick = { id: ++pickIds, pts: [], box: null, text: "", masks: [], overlay: null, sent: false }; return pick; }
            function stickyHint(text) { clearTimeout(hintTimer); statusLbl.textContent = text || ""; }
            function pickPointer(d) {
                const [W, H] = dims();
                if (!backdrop || !backdropRef) { hint("Select object " + NEEDS_IMAGE); return; }
                if (d.moved >= 5 * dprNow()) {                         // a box
                    const [x0, y0] = d.start, [x1, y1] = d.cur;
                    const b = [Math.max(0, Math.min(x0, x1)), Math.max(0, Math.min(y0, y1)), Math.min(W, Math.max(x0, x1)), Math.min(H, Math.max(y0, y1))];
                    if (b[2] - b[0] < 2 || b[3] - b[1] < 2) return;
                    if (d.shift && !pickNext()) return;
                    if (!pick || pick.text) pickStart();
                    pick.box = b;
                    pick.masks = []; pick.overlay = null;
                    pickRequest();
                    return;
                }
                const [ix, iy] = d.start;
                if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
                if (pick?.text && pick.masks.length) {                // found objects: Ctrl+click leaves one out / brings it back
                    if (!d.ctrl) { hint("Ctrl+click a found object to leave it out; Enter adds them, Esc cancels"); return; }
                    const R = pick.R, px = Math.min(R.w - 1, Math.floor(ix * R.w / W)), py = Math.min(R.h - 1, Math.floor(iy * R.h / H));
                    const hit = pick.masks.filter((m) => m.mask[py * R.w + px]);
                    if (!hit.length) { hint("No found object here"); return; }
                    const sm = hit.reduce((a, b) => (a.area <= b.area ? a : b));          // the smallest one under the pointer
                    sm.off = !sm.off; pick.overlay = null;
                    pickCountHint();
                    return;
                }
                if (d.shift && !pickNext()) return;
                if (!pick) pickStart();
                pick.pts.push([ix, iy, d.ctrl ? 0 : 1]);
                pickRequest();
            }
            // Shift+click / Shift+drag: add the selection made so far, then start a new one
            function pickNext() {
                if (!pick) return true;
                if (pickBusy) { hint("Still selecting…"); return false; }
                if (pick.masks.some((m) => !m.off)) pickAccept(false); else pickCancel();
                return true;
            }
            // leaving the tool (or the image going away): add what is selected instead of throwing it away
            function pickSettle() {
                if (!pick) return;
                if (pickBusy || pickAgain) { pick.acceptOnAnswer = true; return; }
                if (pick.masks.some((m) => !m.off)) pickAccept(false); else pickCancel();
            }
            function pickFind(text) {
                if (!backdrop || !backdropRef) { hint("Select object " + NEEDS_IMAGE); return; }
                const box = pick && !pick.text ? pick.box : pick?.box;
                pickStart(); pick.text = text; pick.box = box || null;
                pickRequest();
            }
            function pickCountHint() {
                if (!pick) return;
                const on = pick.masks.filter((m) => !m.off).length;
                const where = "to the active region";
                if (pick.text) stickyHint(pick.masks.length ? `Found ${pick.masks.length}${on < pick.masks.length ? `, ${on} kept` : ""}: Enter or ✓ adds `
                    + `them ${where}, Shift+Enter one region each, Ctrl+click leaves one out, Esc discards` : `Nothing found for "${pick.text}"`);
                else stickyHint(pick.masks.length ? `Enter or ✓: add ${where} · click / Ctrl+click: more points · drag: box · `
                    + "Shift+click: add this one and start the next · Backspace: undo · Esc: discard" : "Nothing selected there: try another point or a box");
            }
            async function pickRequest() {
                if (!pick) return;
                if (pickBusy) { pickAgain = true; return; }
                const p = pick, R = rasterSize(), [W, H] = dims();
                const body = {
                    image: backdropRef, size: [R.w, R.h], model: getSetting(SET.samModel, "sam3.1_multiplex_fp16.safetensors"),
                    keep_loaded: samKeep(), threshold: +getSetting(SET.samThreshold, 0.5) || 0.5,
                    points: p.text ? [] : p.pts.map(([x, y, l]) => [x / W, y / H, l]),
                    box: p.box ? [p.box[0] / W, p.box[1] / H, p.box[2] / W, p.box[3] / H] : null,
                    text: p.text || "",
                };
                if (!body.points.length && !body.box && !body.text) { p.masks = []; p.overlay = null; pickCountHint(); requestDraw(); return; }
                pickBusy = true; p.sent = true;
                let retrying = false;
                stickyHint(samUsed ? (p.text ? "Finding…" : "Selecting…") : "Loading SAM 3.1 (the first selection takes a few seconds)…");
                try {
                    const r = await api.fetchApi("/region_genie/sam_select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
                    const j = await r.json().catch(() => ({}));
                    if (pick !== p) return;
                    if (j.code === "busy") {
                        stickyHint("Select object waits while a workflow is running…");
                        retrying = true;
                        setTimeout(() => { if (pick === p) pickRequest(); }, 2000);
                        return;
                    }
                    if (!r.ok || j.error) { stickyHint(""); showMsg(j.error || `Select object failed (${r.status})`); return; }
                    hideMsg();
                    samUsed = true;
                    p.R = { w: j.w, h: j.h };
                    p.masks = (j.masks || []).map((m) => ({ mask: decodeRuns(m.runs, j.w * j.h), box: m.box, score: m.score, label: m.label || "", area: m.area || 0, off: false }));
                    p.overlay = null;
                    pickCountHint();
                } catch (e) {
                    if (pick === p) { stickyHint(""); showMsg("Select object: no answer from the server (" + (e?.message || e) + ")"); }
                } finally {
                    pickBusy = false;
                    requestDraw();
                    if (pickAgain) { pickAgain = false; pickRequest(); }
                    else if (!retrying && pick === p && p.acceptOnAnswer) pickSettle();
                }
            }
            function pickRelease() {
                api.fetchApi("/region_genie/sam_release", { method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ keep_loaded: samKeep() }) }).catch(() => {});
            }
            function pickCancel() {
                const sent = pick?.sent;
                pick = null; pickAgain = false;
                stickyHint("");
                if (sent) pickRelease();
                requestDraw();
            }
            function pickUndo() {
                if (!pick) return;
                if (pick.text) { pickCancel(); return; }
                if (pick.pts.length) pick.pts.pop(); else pick.box = null;
                if (!pick.pts.length && !pick.box) { pickCancel(); return; }
                pickRequest();
            }
            function pickAccept(each) {
                if (!pick) return;
                if (pickBusy) { hint("Still selecting…"); return; }
                const on = pick.masks.filter((m) => !m.off);
                if (!on.length) { hint("Nothing selected yet"); return; }
                const R = { ...rasterSize(), w: pick.R.w, h: pick.R.h };
                const sent = pick.sent;
                const [W, H] = dims(), s = Math.min(W, H);
                const asRegion = (mask, prompt) => {                    // one new region with the mask as its layer
                    const rg = newRegion();
                    rg.prompt = prompt || "";
                    const L = newPaintLayer(rg.id);
                    L.name = `Object ${L.id}`;
                    L.ops.push({ t: "bitmap", e: false, w: R.w, h: R.h, runs: encodeRuns(growMask01(mask, R.w, R.h, 1)), x0: 0, y0: 0, x1: W / s, y1: H / s });
                    addLayer(L);
                    return rg;
                };
                const union = () => {
                    const u = new Uint8Array(R.w * R.h);
                    for (const m of on) for (let i = 0; i < u.length; i++) if (m.mask[i]) u[i] = 1;
                    return u;
                };
                if (each && pick.text && on.length > 1) {
                    change(() => { for (const m of on.slice().reverse()) asRegion(m.mask, m.label || pick.text); });   // the best match ends up on top
                    hint(`Added ${on.length} regions`);
                } else {
                    if (commitMask(R, union(), "Object")) hint(on.length > 1 ? `Added ${on.length} objects` : "Added the object");
                }
                pick = null; pickAgain = false;
                if (sent) pickRelease();
                if (findIn.value) findIn.value = "";
                requestDraw();
            }
            function drawPick(ix, iy, iw, ih) {
                const dpr = dprNow();
                ctx.save();
                if (pick?.masks.length) {
                    if (!pick.overlay) {
                        const { w, h } = pick.R, c = document.createElement("canvas"); c.width = w; c.height = h;
                        const x = c.getContext("2d"), img = x.createImageData(w, h), d = img.data;
                        const [cr, cg, cb] = hexRgb(colorOf(curRegion) || "#5b8fd0");
                        for (const m of pick.masks) {
                            const [r, g, b, a] = m.off ? [128, 128, 128, 70] : [cr, cg, cb, 150];
                            for (let i = 0; i < w * h; i++) if (m.mask[i]) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a; }
                        }
                        x.putImageData(img, 0, 0);
                        pick.overlay = c;
                    }
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(pick.overlay, ix, iy, iw, ih);
                }
                ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = "#fff";
                const rect = (b) => { const [a0, b0] = toScr(b[0], b[1]), [a1, b1] = toScr(b[2], b[3]); ctx.strokeRect(a0, b0, a1 - a0, b1 - b0); };
                if (drag?.mode === "pickbox" && drag.moved >= 5 * dpr) rect([...drag.start, ...drag.cur]);
                else if (pick?.box) rect(pick.box);
                ctx.setLineDash([]);
                for (const [x, y, l] of pick?.pts || []) {
                    const [a, b] = toScr(x, y);
                    ctx.beginPath(); ctx.arc(a, b, 5 * dpr, 0, Math.PI * 2);
                    ctx.fillStyle = l ? "#2fbf5b" : "#e0463c"; ctx.fill();
                    ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = "#fff"; ctx.stroke();
                }
                ctx.restore();
            }

            // ---------------- arrange: flip, align, grow / shrink ----------------
            function mirrorOps(L, axis, c) {                 // mirror the layer's ops in its own frame: x -> c - x (or y)
                const i = axis === "h" ? 0 : 1;
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
                change(() => {
                    boxCache.delete(L);
                    if (L.shape) {
                        // shapes are mirror-symmetric left-right: a flip mirrors the ops; upside down = turned 180° + mirrored
                        if (axis === "v") L.rot = ((L.rot + 180 + 180) % 360) - 180;
                        mirrorOps(L, "h", L.bw);
                    } else {
                        const b = contentBox(L);
                        if (!b) return;
                        mirrorOps(L, axis, axis === "h" ? b[0] + b[2] : b[1] + b[3]);
                    }
                    boxCache.delete(L);
                });
            }
            function alignLayer(L, how) {
                const cs = boxCornersImg(L);
                if (!cs) return;
                const [W, H] = dims(), s = Math.min(W, H);
                const x0 = Math.min(...cs.map((c) => c[0])), x1 = Math.max(...cs.map((c) => c[0]));
                const y0 = Math.min(...cs.map((c) => c[1])), y1 = Math.max(...cs.map((c) => c[1]));
                let dx = 0, dy = 0;
                if (how === "l") dx = -x0; else if (how === "r") dx = W - x1; else if (how === "ch" || how === "c") dx = W / 2 - (x0 + x1) / 2;
                if (how === "t") dy = -y0; else if (how === "b") dy = H - y1; else if (how === "cv" || how === "c") dy = H / 2 - (y0 + y1) / 2;
                if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
                change(() => { L.ox += dx / s; L.oy += dy / s; });
            }
            // grow (px > 0) or shrink the layer's pixels; the layer becomes a plain paint layer (pixels) covering the image
            function growLayer(L, px) {
                const R = rasterSize(), { W, H, w, h, r } = R, s = Math.min(W, H);
                const c = document.createElement("canvas"); c.width = w; c.height = h;
                const x = c.getContext("2d", { willReadFrequently: true });
                const saved = view;
                view = { z: r, x: 0, y: 0 };
                try { drawLayerOn(x, L, null, null, "#ffffff"); } finally { view = saved; }
                const d = x.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
                for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
                const out = growMask01(m, w, h, px * r);
                change(() => {
                    boxCache.delete(L);
                    Object.assign(L, { shape: null, sides: 5, bw: W / s, bh: H / s, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0,
                        ops: out.some((v) => v) ? [{ t: "bitmap", e: false, w, h, runs: encodeRuns(out), x0: 0, y0: 0, x1: W / s, y1: H / s }] : [] });
                    delete L.radius;
                });
            }

            // ---------------- interactions ----------------
            function shapeDragLayer() {
                if (!drag || drag.mode !== "shape") return null;
                let [ax, ay] = drag.start, [bx, by] = drag.cur;
                if (drag.square) {
                    const m = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
                    bx = ax + Math.sign(bx - ax || 1) * m; by = ay + Math.sign(by - ay || 1) * m;
                }
                if (drag.centre) { const dx = bx - ax, dy = by - ay; [ax, ay, bx, by] = [ax - dx, ay - dy, ax + dx, ay + dy]; }
                const [W, H] = dims(), s = Math.min(W, H);
                const w = Math.abs(bx - ax), h = Math.abs(by - ay);
                if (w < 1 || h < 1) return null;
                return { id: -1, name: "", region: drag.region, visible: true, shape: shapeKind, sides,
                         ...(shapeKind === "roundrect" ? { radius: cornerPct } : {}),
                         bw: w / s, bh: h / s, sx: 1, sy: 1, rot: 0, ox: ((ax + bx) / 2 - W / 2) / s, oy: ((ay + by) / 2 - H / 2) / s, ops: [] };
            }
            function paintTarget(erasing) {
                const L = selLayer();
                if (erasing) return L && L.visible !== false ? L : null;
                const rid = ensureRegion();
                return L && L.visible !== false && L.region === rid ? L : null;
            }
            function newPaintLayer(rid) {
                const [W, H] = dims(), s = Math.min(W, H), id = nextLayerId();
                return { id, name: rid === UNSPEC ? `Unspecified ${id}` : `Paint ${id}`, region: rid,
                         visible: true, shape: null, sides: 5, bw: W / s, bh: H / s, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, ops: [] };
            }
            const localBrush = (L) => brush / Math.sqrt(L.sx * L.sy);
            // the outline a lasso makes (image px). Spline: clicked points are kept; a freehand path is first
            // reduced to the points that carry its shape (so hand jitter is smoothed out), then a smooth closed
            // curve goes through them.
            function lassoOutline(pts, spline, freehand) {
                if (!spline) return pts;
                const z = view?.z || 1, px = dprNow() / z;           // one screen pixel in image px
                let p = dedupe(pts, 0.5 * px);
                if (freehand && p.length >= 4) {
                    let per = 0;
                    p.forEach((q, i) => { const r = p[(i + 1) % p.length]; per += Math.hypot(r[0] - q[0], r[1] - q[1]); });
                    const radius = Math.max(6 * px, Math.min(32 * px, per * 0.02));
                    p = simplifyClosed(smoothClosed(p, 2 * px, radius), 2.5 * px);
                }
                if (p.length < 3) return pts;
                return closedSpline(p, 3 * dprNow() / z);
            }
            function finishClickPoly() {
                const cp = clickPoly;
                clickPoly = null;
                if (!cp || cp.pts.length < 3) { requestDraw(); return; }
                const before = snapshot();
                const layer = cp.target || newPaintLayer(cp.region);
                layer.ops.push({ t: "poly", e: cp.erase, p: lassoOutline(cp.pts, cp.spline, false).map(([x, y]) => imgToLayer(layer, x, y)) });
                if (!cp.target) addLayer(layer);
                pushUndo(before); save(); refreshUI();
            }

            function onPointerDown(e) {
                e.preventDefault(); e.stopPropagation();
                focusSink();
                if (e.button === 0 && tool !== "select" && hiddenSel != null) { hiddenSel = null; requestDraw(); }
                const [dx, dy] = evDisplay(e), [ix, iy] = toImg(dx, dy);
                cv.setPointerCapture?.(e.pointerId);
                if (e.button === 1 || (e.button === 0 && spaceDown)) { drag = { mode: "pan", sx: dx, sy: dy, vx: view.x, vy: view.y }; userView = true; return; }
                if (e.button !== 0) return;
                const onLabel = !clickPoly && labelAt(dx, dy);
                if (onLabel && e.detail >= 2) return;              // 2nd click of a double-click on a label: edit, don't draw
                labelClick = onLabel ? { t: performance.now(), n: undoStack.length } : null;
                const before = snapshot();
                if (clickPoly) {                                   // building a lasso point by point
                    const [fx, fy] = toScr(...clickPoly.pts[0]);
                    if (clickPoly.pts.length >= 3 && Math.hypot(fx - dx, fy - dy) <= 8 * dprNow()) finishClickPoly();
                    else if (clickPoly.magnetic && edgeMap()) {    // magnetic: the segment follows edges to the snapped click
                        const ed = edgeMap(), rad = magnetRadius();
                        const b = snapToEdge(ed, ix, iy, rad), a = clickPoly.pts[clickPoly.pts.length - 1];
                        clickPoly.pts.push(...snapSegment(ed, a, b, Math.max(2, 4 * dprNow() / view.z), rad / 2).slice(0, -1), b);
                        requestDraw();
                    } else { clickPoly.pts.push([snapV(ix), snapV(iy)]); requestDraw(); }
                    return;
                }
                // Alt+click with a painting tool: eyedropper, the region under the pointer becomes the active one
                if (e.altKey && tool !== "select" && tool !== "shape") {
                    const L = hitLayer(dx, dy);
                    if (L && L.region !== UNSPEC && regionById(L.region)) {
                        activateRegion(L.region); openSub?.(L.region, "layers");
                        const rg = regionById(L.region);
                        hint(`Active region: ${rg.prompt.trim().slice(0, 40) || "(no prompt)"}`);
                    } else if (L) { activateRegion(UNSPEC); hint("Active region: unspecified"); }
                    else hint("No region here");
                    labelClick = null;
                    refreshUI();
                    return;
                }
                if (tool === "select") {
                    const L = selLayer();
                    const shown = hiddenSel !== selId;
                    hiddenSel = null;
                    if (L && isShown(L) && shown) {
                        const hd = handles(L).find((h) => Math.hypot(h.x - dx, h.y - dy) <= 9 * dprNow());
                        if (hd) {
                            const L0 = { ...L };
                            if (hd.kind === "rotate") {
                                const [x0, y0, x1, y1] = contentBox(L), kc = [(x0 + x1) / 2, (y0 + y1) / 2];
                                const K = layerToImg(L, ...kc);
                                drag = { mode: "rotate", L, L0, kc, K, a0: Math.atan2(iy - K[1], ix - K[0]), before };
                            } else {
                                drag = { mode: "scale", L, L0, hd, A: layerToImg(L, hd.ax, hd.ay), before };
                            }
                            return;
                        }
                        if (insideBox(L, ix, iy) && !e.altKey) { drag = { mode: "move", L, c0: [L.ox, L.oy], start: [ix, iy], before }; return; }
                    }
                    const H2 = hitLayer(dx, dy);
                    selectLayer(H2);
                    if (H2) drag = { mode: "move", L: H2, c0: [H2.ox, H2.oy], start: [ix, iy], before };
                    return;
                }
                if (tool === "shape") {
                    drag = { mode: "shape", start: [snapV(ix), snapV(iy)], cur: [snapV(ix), snapV(iy)], region: ensureRegion(), square: e.shiftKey, centre: e.altKey, before };
                    refreshUI();
                    return;
                }
                if (tool === "object") {
                    drag = { mode: "pickbox", start: [ix, iy], cur: [ix, iy], sd: [dx, dy], moved: 0, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
                    labelClick = null;
                    return;
                }
                if (tool === "fill") { fillAt(ix, iy); return; }
                if (tool === "wand") { wandAt(ix, iy); return; }
                const erasing = tool === "erase" || tool === "lassoErase";
                const target = paintTarget(erasing);
                if (erasing && !target) { hint("Select a layer to erase from"); return; }
                if (tool === "brush" || tool === "erase") {
                    const layer = target || newPaintLayer(ensureRegion());
                    const p = imgToLayer(layer, ix, iy);
                    // Shift+click: a straight line from where the last stroke ended
                    const from = e.shiftKey && lastStrokeEnd ? imgToLayer(layer, ...lastStrokeEnd) : null;
                    drag = { mode: "paint", target, layer, op: { t: "stroke", e: erasing, d: localBrush(layer), p: from ? [from, p] : [p] }, before };
                } else {
                    let magnetic = LASSO_MODES[tool] === "magnetic", p0 = [ix, iy];
                    if (magnetic && !edgeMap()) { magnetic = false; hint("Magnetic lasso " + NEEDS_IMAGE + "; drawing a plain lasso"); }
                    if (magnetic) p0 = snapToEdge(edgeMap(), ix, iy, magnetRadius());
                    drag = { mode: "lasso", erase: erasing, spline: LASSO_MODES[tool] === "spline", magnetic, target, region: erasing ? null : ensureRegion(), pts: [p0], start: [dx, dy], moved: 0, before };
                }
                refreshUI();
            }
            cv.addEventListener("pointerdown", onPointerDown);
            const keepFocus = () => {                        // Nodes 2.0 may move focus to the node element after a click
                const a = document.activeElement;
                if (a !== keySink && (!a || a === document.body || !isField(a) || wrap.contains(a)) && !(wrap.contains(a) && isField(a))) focusSink();
            };
            function onPointerMove(e) {
                const [dx, dy] = evDisplay(e), [ix, iy] = toImg(dx, dy);
                hover = [dx, dy];
                keepFocus();
                if (!drag) { requestDraw(); return; }
                e.preventDefault(); e.stopPropagation();
                const [W, H] = dims(), s = Math.min(W, H);
                if (drag.mode === "pan") { view.x = drag.vx + dx - drag.sx; view.y = drag.vy + dy - drag.sy; }
                else if (drag.mode === "move") {
                    const L = drag.L;
                    L.ox = drag.c0[0] + (ix - drag.start[0]) / s;
                    L.oy = drag.c0[1] + (iy - drag.start[1]) / s;
                    if (snap) {
                        const cs = boxCornersImg(L);
                        if (cs) {
                            const mx = Math.min(...cs.map((c) => c[0])), my = Math.min(...cs.map((c) => c[1]));
                            L.ox += (snapV(mx) - mx) / s; L.oy += (snapV(my) - my) / s;
                        }
                    }
                } else if (drag.mode === "scale") {
                    const { L, L0, hd, A } = drag, th = L0.rot * Math.PI / 180;
                    const mx = snapV(ix), my = snapV(iy);
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
                } else if (drag.mode === "rotate") {
                    const { L, L0, kc, K } = drag;
                    let rot = L0.rot + (Math.atan2(iy - K[1], ix - K[0]) - drag.a0) * 180 / Math.PI;
                    if (e.shiftKey) rot = Math.round(rot / 15) * 15;
                    rot = ((rot % 360) + 540) % 360 - 180;
                    L.rot = rot;
                    const th = rot * Math.PI / 180;
                    const ox = (kc[0] - L.bw / 2) * L.sx * s, oy = (kc[1] - L.bh / 2) * L.sy * s;
                    L.ox = (K[0] - (Math.cos(th) * ox - Math.sin(th) * oy) - W / 2) / s;
                    L.oy = (K[1] - (Math.sin(th) * ox + Math.cos(th) * oy) - H / 2) / s;
                } else if (drag.mode === "pickbox") {
                    drag.cur = [ix, iy]; drag.moved = Math.max(drag.moved, Math.hypot(dx - drag.sd[0], dy - drag.sd[1]));
                } else if (drag.mode === "shape") {
                    drag.cur = [snapV(ix), snapV(iy)]; drag.square = e.shiftKey; drag.centre = e.altKey;
                } else if (drag.mode === "paint") {
                    const p = imgToLayer(drag.layer, ix, iy), last = drag.op.p[drag.op.p.length - 1];
                    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= Math.max(drag.op.d * 0.15, 0.5 / s)) drag.op.p.push(p);
                } else if (drag.mode === "lasso") {
                    drag.moved = Math.max(drag.moved, Math.hypot(dx - drag.start[0], dy - drag.start[1]));
                    const last = drag.pts[drag.pts.length - 1];
                    if (Math.hypot(ix - last[0], iy - last[1]) * view.z >= 3) {
                        drag.pts.push(drag.magnetic ? snapToEdge(edgeMap(), ix, iy, magnetRadius()) : [ix, iy]);
                    }
                }
                requestDraw();
            }
            cv.addEventListener("pointermove", onPointerMove);
            const finish = (e) => {
                if (!drag) return;
                e?.preventDefault?.(); e?.stopPropagation?.();
                const d = drag;
                const t = d.mode === "shape" ? shapeDragLayer() : null;
                drag = null;
                if (d.mode === "pan") { requestDraw(); return; }
                if (d.mode === "pickbox") { pickPointer(d); requestDraw(); return; }
                if (d.mode === "lasso" && d.moved < 5 * dprNow()) {     // a click: start a point-by-point lasso
                    clickPoly = { erase: d.erase, spline: d.spline, magnetic: d.magnetic, target: d.target, region: d.region,
                                  pts: [d.magnetic ? d.pts[0] : [snapV(d.pts[0][0]), snapV(d.pts[0][1])]] };
                    requestDraw();
                    return;
                }
                if (d.mode === "shape") {
                    if (t) {
                        t.id = nextLayerId();
                        t.name = `${SHAPE_NAMES[t.shape] || "Shape"} ${t.id}`;
                        addLayer(t);
                        setTool("select");
                    }
                } else if (d.mode === "paint") {
                    lastStrokeEnd = layerToImg(d.layer, ...d.op.p[d.op.p.length - 1]);
                    if (d.target) d.target.ops.push(d.op);
                    else { d.layer.ops.push(d.op); addLayer(d.layer); }
                } else if (d.mode === "lasso" && d.pts.length >= 3) {
                    const layer = d.target || newPaintLayer(d.region);
                    layer.ops.push({ t: "poly", e: d.erase, p: lassoOutline(d.pts, d.spline, true).map(([x, y]) => imgToLayer(layer, x, y)) });
                    if (!d.target) addLayer(layer);
                }
                pushUndo(d.before);
                save(); refreshUI();
            };
            cv.addEventListener("pointerup", finish);
            // Nodes 2.0 forwards middle-button drags over nodes to the graph in a capture handler above the nodes.
            // A window capture listener runs before it, so middle-drags that start on this canvas pan the canvas.
            const midPan = (e) => {
                const panning = drag?.mode === "pan" && drag.middle;
                if (e.type === "pointerdown") {
                    if (!(e.target === cv && e.button === 1)) return;
                    e.stopPropagation(); e.preventDefault();
                    onPointerDown(e);
                    if (drag?.mode === "pan") drag.middle = true;
                } else if (panning) {
                    e.stopPropagation(); e.preventDefault();
                    if (e.type === "pointermove") onPointerMove(e); else finish(e);
                }
            };
            const PAN_EVENTS = ["pointerdown", "pointermove", "pointerup", "pointercancel"];
            for (const t of PAN_EVENTS) window.addEventListener(t, midPan, true);
            // a click anywhere but the canvas hides the selected layer's box and handles
            const hideSelOutside = (e) => {
                if (selId == null || hiddenSel === selId || drag || e.target === cv) return;
                hiddenSel = selId; requestDraw();
            };
            window.addEventListener("pointerdown", hideSelOutside, true);
            const noAutoScroll = (e) => { if (e.button === 1 && e.target === cv) e.preventDefault(); };
            window.addEventListener("mousedown", noAutoScroll, true);
            cv.addEventListener("pointercancel", finish);
            cv.addEventListener("dblclick", (e) => {
                if (clickPoly) { e.preventDefault(); e.stopPropagation(); clickPoly.pts.pop(); finishClickPoly(); return; }
                if (node.properties?.rg_labels === false) return;
                const r = labelAt(...evDisplay(e));
                if (!r) return;
                e.preventDefault(); e.stopPropagation();
                // the first click already drew with a paint/shape/fill tool: take that back
                if (tool !== "select" && labelClick && performance.now() - labelClick.t < 800 && undoStack.length === labelClick.n + 1) {
                    undo(); redoStack.pop();
                }
                labelClick = null;
                editPrompt(r.rid, r);
            });
            function labelAt(px, py) {
                if (node.properties?.rg_labels === false) return null;
                for (let i = labelRects.length - 1; i >= 0; i--) {
                    const r = labelRects[i];
                    if (px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1) return r;
                }
                return null;
            }
            // pop-up region editor (double-click a label): type, prompt, text, feather, palette and LoRAs.
            // Text edits show live; each edited field is one undo step. Enter or clicking elsewhere closes it,
            // Shift+Enter = new line, Esc closes it and undoes the text edit in progress.
            let editor = null;
            function closeEditor(commit = true) {
                if (!editor) return;
                const ed = editor;
                if (ed.field) ed.endField(!commit);
                editor = null;
                window.removeEventListener("pointerdown", ed.outside, true);
                ed.box.remove();
                refreshUI();
                focusSink();
            }
            // rect: the label on the canvas it opens from; null = from the region's row in the list. focus: "prompt" | "text"
            function editPrompt(rid, rect, focus = "prompt") {
                closeEditor(true);
                const r = regionById(rid);
                if (!r) return;
                if (activateRegion(rid)) refreshUI();
                const box = el("div", "rg-pop");
                const stop = (e) => e.stopPropagation();
                for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu"]) box.addEventListener(ev, stop);
                box.dataset.captureWheel = "true";
                box.addEventListener("keydown", (e) => {
                    e.stopPropagation();                           // editor shortcuts (Delete, V, B, ...) stay off
                    if (e.key === "Escape" && !autocompleteOpen(e.target, e)) { e.preventDefault(); closeEditor(false); }
                });
                // header: number, color, close
                const head = el("div", "rg-pop-head");
                const num = el("span", "rg-idx");
                const title = el("span"); title.textContent = "Edit region";
                const sw = el("span", "rg-sw"); sw.dataset.swatch = String(r.id);
                const x = el("button", "rg-btn ico rg-x"); x.textContent = "✕"; x.title = "Close (Enter / Esc)";
                x.addEventListener("click", (e) => { e.preventDefault(); closeEditor(true); });
                let lastTa = null;                         // the field the picker inserts into
                const wcPick = el("button", "rg-btn ico rg-wc-pick"); wcPick.innerHTML = svgIcon("wildcard");
                wcPick.title = "Insert a wildcard (ComfyUI Impact Pack) at the cursor";
                wcPick.addEventListener("click", (e) => pickWildcard(e, (name) => insertAtCursor(lastTa || prompt.ta, name)));
                wcPick.style.display = wildcardsInstalled() ? "" : "none";
                head.append(title, num, sw, wcPick, x);
                // type buttons
                const types = el("div", "rg-pop-types");
                const typeBtns = {};
                for (const [t, label] of [["object", "Object"], ["character", "Character"], ["text", "Text"]]) {
                    const b = el("button", "rg-btn"); b.textContent = label;
                    b.title = { object: "MOSS 'object' item", character: "MOSS 'character' item (a person / character)",
                                text: "MOSS 'text' item: the Text below is rendered in the image" }[t];
                    b.addEventListener("click", (e) => { e.preventDefault(); if (r.type !== t) change(() => { r.type = t; }); });
                    typeBtns[t] = b; types.appendChild(b);
                }
                // text fields
                const field = (label, key, rows, placeholder) => {
                    const wrapF = el("div", "rg-pop-field");
                    const lab = el("div", "rg-pop-lbl"); lab.textContent = label;
                    const ta = el("textarea"); ta.rows = rows; ta.placeholder = placeholder; ta.spellcheck = false; ta.value = r[key] || "";
                    const fkey = key === "prompt" ? "r" + r.id : `r${r.id}.text`;
                    const use = el("button", "rg-btn ico rg-wc-use"); use.innerHTML = svgIcon("useFilled");
                    use.addEventListener("click", (e) => {
                        e.preventDefault();
                        const f = filledFor(fkey, r[key] || "");
                        if (f == null) return;
                        change(() => { r[key] = f; });
                        ta.value = f; syncUse();
                    });
                    const syncUse = () => {
                        const f = filledFor(fkey, r[key] || "");
                        use.style.display = f != null ? "" : "none";
                        use.title = f != null ? `Use the filled text: replace the wildcards with what they produced (last run or preview):\n${f}` : "";
                    };
                    lab.appendChild(use);
                    ta.addEventListener("focus", () => { lastTa = ta; });
                    ta.addEventListener("input", syncUse);
                    ta.__rgSyncUse = syncUse;
                    ta.addEventListener("focus", () => {
                        if (editor?.field && editor.field.ta !== ta) editor.endField(false);
                        if (editor) editor.field = { ta, key, before: snapshot(), orig: r[key] || "" };
                    });
                    ta.addEventListener("input", () => { r[key] = ta.value; save(); requestDraw(); });
                    ta.addEventListener("blur", () => { if (editor?.field?.ta === ta) editor.endField(false); });
                    ta.addEventListener("keydown", (e) => {
                        if (e.key === "Enter" && !e.shiftKey && !autocompleteOpen(ta, e)) { e.preventDefault(); closeEditor(true); }
                    });
                    wrapF.append(lab, ta);
                    return { wrapF, ta };
                };
                const prompt = field("Prompt", "prompt", 4, "prompt: what is in this region");
                autocompleteOnFocus(prompt.ta, node);
                const text = field("Text", "text", 2, "text to render");
                // feather, palette, LoRAs (rebuilt on every change)
                const dyn = el("div", "rg-pop-dyn");
                const foot = el("div", "rg-pop-foot");
                foot.textContent = "Enter: done · Shift+Enter: new line · Esc: close, undoing the text being edited";
                box.append(head, types, prompt.wrapF, text.wrapF, dyn, foot);
                wrap.appendChild(box);

                const ed = {
                    rid, box, field: null,
                    // finish editing a text field: one undo step, or put the old text back (cancel)
                    endField(cancel) {
                        const f = ed.field;
                        if (!f) return;
                        ed.field = null;
                        const rr = regionById(rid);
                        if (!rr) return;
                        if (cancel) {
                            if ((rr[f.key] || "") !== f.orig) { rr[f.key] = f.orig; f.ta.value = f.orig; save(); }
                        } else if ((rr[f.key] || "") !== f.orig) {
                            pushUndo(f.before);
                            renderRegions();                       // the list shows the new text too
                        }
                        requestDraw();
                    },
                    refresh() {
                        const rr = regionById(rid);
                        if (!rr) { closeEditor(false); return; }
                        const k = state.regions.indexOf(rr), idx = outputIndexMap()[k];
                        num.textContent = idx == null ? "–" : String(idx);
                        num.classList.toggle("none", idx == null);
                        num.title = idx == null ? "No visible pixels yet" : `Output index ${idx}`;
                        sw.style.background = colorOf(rid);
                        box.style.borderColor = colorOf(rid) || "#5b8fd0";
                        for (const [t, b] of Object.entries(typeBtns)) b.classList.toggle("on", rr.type === t);
                        text.wrapF.style.display = rr.type === "text" ? "" : "none";
                        prompt.ta.__rgSyncUse?.(); text.ta.__rgSyncUse?.();
                        wcPick.style.display = wildcardsInstalled() ? "" : "none";
                        for (const [f, key] of [[prompt, "prompt"], [text, "text"]]) {
                            if (document.activeElement !== f.ta && f.ta.value !== (rr[key] || "")) f.ta.value = rr[key] || "";
                        }
                        const ctl = el("div", "rg-row pop-ctl");
                        const addL = ico("＋LoRA", "Apply a LoRA to this region (model output; MOSS Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5)", (e) => { rr.loras = rr.loras || []; addLoraTo(rr.loras, e, () => openSub(rr.id, "loras")); }, "txt");
                        ctl.append(llmButton(rr.id, "pop"), ...(isEdit() ? [keepToggle(rr)] : []), featherBox(rr), paletteToggle(rr), addL);
                        const loras = el("div", "rg-pop-loras");
                        if ((rr.loras || []).length) loras.appendChild(regionLoraRows(rr));
                        dyn.replaceChildren(ctl, paletteRow(rr, true), loras);
                        ed.place();
                    },
                    placed: false,
                    place() {
                        // near the label, inside the node; scrolls when the node is short
                        const k = cvBox.clientWidth / Math.max(1, cv.width);           // canvas px -> CSS px
                        const W = wrap.clientWidth, H = wrap.clientHeight;
                        const w = Math.min(W - 12, 440);
                        box.style.width = w + "px";
                        box.style.maxHeight = Math.max(120, H - 12) + "px";
                        const h = box.offsetHeight;
                        if (ed.placed) {                           // later changes: stay put, only keep it inside
                            const t = parseFloat(box.style.top) || 6;
                            if (t + h > H - 6) box.style.top = Math.max(6, H - 6 - h) + "px";
                            return;
                        }
                        ed.placed = true;
                        const row = !rect && regList.querySelector(`textarea.rg-prompt[data-rid="${rid}"]`)?.closest(".rg-row");
                        if (row) {                                 // from the list: just below the row, else just above it
                            const wr = wrap.getBoundingClientRect(), rr = row.getBoundingClientRect();
                            const sc = wrap.offsetWidth / Math.max(1, wr.width);        // the graph's zoom: screen px -> CSS px
                            const y0 = (rr.top - wr.top) * sc + wrap.scrollTop, y1 = (rr.bottom - wr.top) * sc + wrap.scrollTop;
                            const top = y1 + 4 + h <= H - 6 ? y1 + 4 : (y0 - 4 - h >= 6 ? y0 - 4 - h : Math.max(6, H - 6 - h));
                            box.style.left = Math.max(6, (W - w) / 2) + "px";
                            box.style.top = top + "px";
                            return;
                        }
                        if (!rect) { box.style.left = Math.max(6, (W - w) / 2) + "px"; box.style.top = "6px"; return; }
                        const cx = cvBox.offsetLeft + (rect.x0 + rect.x1) / 2 * k;
                        const below = cvBox.offsetTop + rect.y1 * k + 6, above = cvBox.offsetTop + rect.y0 * k - 6 - h;
                        const top = below + h <= H - 6 ? below : (above >= 6 ? above : Math.max(6, H - 6 - h));
                        box.style.left = Math.max(6, Math.min(W - w - 6, cx - w / 2)) + "px";
                        box.style.top = Math.max(6, top) + "px";
                    },
                    // a click outside closes it (not the LoRA list, the autocomplete list or a color picker)
                    outside(e) {
                        const t = e.target;
                        if (box.contains(t) || inAutocompleteList(t) || inColorPicker(t) || inLlmSettings(t) || t?.closest?.(".litecontextmenu, .litemenu-entry, .comfy-context-menu, .p-contextmenu")) return;
                        closeEditor(true);
                    },
                };
                editor = ed;
                window.addEventListener("pointerdown", ed.outside, true);
                ed.refresh();
                const first = focus === "text" && r.type === "text" ? text : prompt;
                first.ta.focus(); first.ta.setSelectionRange(first.ta.value.length, first.ta.value.length);
            }
            // pop-up editor for scene_prompt_positive / _negative / _background (double-click the text box).
            // Positive: also the LLM Prompt Enhancer and the whole-image LoRAs. Enter or clicking elsewhere closes it,
            // Shift+Enter = new line, Esc closes it and puts the text back as it was.
            function editScene(which) {
                closeEditor(true);
                const pos = which === "positive";
                const w = { positive: sceneW, negative: sceneNegW, background: sceneBgW }[which];
                if (!w) return;
                const box = el("div", "rg-pop scene");
                const stop = (e) => e.stopPropagation();
                for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu"]) box.addEventListener(ev, stop);
                box.dataset.captureWheel = "true";
                box.addEventListener("keydown", (e) => {
                    e.stopPropagation();
                    if (e.key === "Escape" && !autocompleteOpen(e.target, e)) { e.preventDefault(); closeEditor(false); }
                });
                const head = el("div", "rg-pop-head");
                const title = el("span");
                title.textContent = { positive: "Scene prompt (scene_prompt_positive)", negative: "Negative scene prompt (scene_prompt_negative)",
                                      background: "Background (scene_prompt_background)" }[which];
                const x = el("button", "rg-btn ico rg-x"); x.textContent = "✕"; x.title = "Close (Enter / Esc)";
                x.addEventListener("click", (e) => { e.preventDefault(); closeEditor(true); });
                const wcPickS = el("button", "rg-btn ico rg-wc-pick"); wcPickS.innerHTML = svgIcon("wildcard");
                wcPickS.title = "Insert a wildcard (ComfyUI Impact Pack) at the cursor";
                wcPickS.addEventListener("click", (e) => pickWildcard(e, (name) => insertAtCursor(ta, name)));
                wcPickS.style.display = wildcardsInstalled() ? "" : "none";
                head.append(title, wcPickS, x);
                const wrapF = el("div", "rg-pop-field");
                const ta = el("textarea"); ta.rows = 6; ta.spellcheck = false; ta.value = String(w.value ?? "");
                ta.placeholder = { positive: "the whole picture: setting, style, lighting ...", negative: "what to avoid in the whole picture",
                                   background: "behind the regions: ground, floor, sky, room ..." }[which];
                const orig = ta.value;
                const skey = SCENE_KEYS[which];
                const useS = el("button", "rg-btn ico rg-wc-use"); useS.innerHTML = svgIcon("useFilled");
                const syncUseS = () => {
                    const f = filledFor(skey, String(w.value ?? ""));
                    useS.style.display = f != null ? "" : "none";
                    useS.title = f != null ? `Use the filled text: replace the wildcards with what they produced (last run or preview):\n${f}` : "";
                };
                useS.addEventListener("click", (e) => {
                    e.preventDefault();
                    const f = filledFor(skey, String(w.value ?? ""));
                    if (f == null) return;
                    setWidget(w, f); ta.value = f; syncUseS(); wcMarkScene();
                });
                ta.addEventListener("input", () => syncUseS());
                ta.addEventListener("input", () => { setWidget(w, ta.value); if (pos) updateLlmButtons(); });
                ta.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" && !e.shiftKey && !autocompleteOpen(ta, e)) { e.preventDefault(); closeEditor(true); }
                });
                autocompleteOnFocus(ta, node);
                wrapF.append(ta);
                const dyn = el("div", "rg-pop-dyn");
                const foot = el("div", "rg-pop-foot");
                foot.textContent = "Enter: done · Shift+Enter: new line · Esc: close, putting the text back";
                const useRow = el("div", "rg-pop-lbl"); useRow.append(useS);
                box.append(head, useRow, wrapF, dyn, foot);
                wrap.appendChild(box);
                const ed = {
                    scene: which, box, field: { cancelable: true },
                    endField(cancel) {
                        ed.field = null;
                        if (cancel && String(w.value ?? "") !== orig) { setWidget(w, orig); ta.value = orig; }
                        if (pos) updateLlmButtons();
                    },
                    refresh() {
                        if (document.activeElement !== ta && ta.value !== String(w.value ?? "")) ta.value = String(w.value ?? "");
                        syncUseS(); wcPickS.style.display = wildcardsInstalled() ? "" : "none";
                        box.style.borderColor = "#5b8fd0";
                        if (!pos) { dyn.replaceChildren(); ed.place(); return; }
                        const ctl = el("div", "rg-row pop-ctl");
                        const lbl = el("span", "rg-hint"); lbl.textContent = "Whole image";
                        lbl.title = "LoRAs here act on the whole picture (and all text), like a normal LoRA";
                        const gap = el("span"); gap.style.flex = "1 1 auto";
                        const addL = ico("＋LoRA", "Add a LoRA for the whole image", (e) => {
                            state.sceneLoras = state.sceneLoras || [];
                            addLoraTo(state.sceneLoras, e, () => expanded.add(SCENE));
                        }, "txt");
                        ctl.append(lbl, gap, llmButton(LLM_SCENE, "pop"), addL);
                        const loras = el("div", "rg-pop-loras");
                        if ((state.sceneLoras || []).length) {
                            loras.appendChild(loraRows(state.sceneLoras, {
                                prompt: () => String(sceneW?.value ?? ""),
                                append: (words) => {
                                    let v = String(sceneW?.value ?? "");
                                    for (const wd of words) v = appendWord(v, wd);
                                    setWidget(sceneW, v); ta.value = v; renderRegions();
                                },
                            }));
                        }
                        dyn.replaceChildren(ctl, loras);
                        ed.place();
                    },
                    placed: false,
                    place() {
                        // at the top of the canvas area (right under the scene prompts), inside the node
                        const W = wrap.clientWidth, H = wrap.clientHeight;
                        const wd = Math.min(W - 12, 520);
                        box.style.width = wd + "px";
                        box.style.maxHeight = Math.max(120, H - 12) + "px";
                        if (ed.placed) {
                            const t = parseFloat(box.style.top) || 6, h = box.offsetHeight;
                            if (t + h > H - 6) box.style.top = Math.max(6, H - 6 - h) + "px";
                            return;
                        }
                        ed.placed = true;
                        box.style.left = Math.max(6, (W - wd) / 2) + "px";
                        box.style.top = "6px";
                    },
                    outside(e) {
                        const t = e.target;
                        if (box.contains(t) || inAutocompleteList(t) || inColorPicker(t) || inLlmSettings(t) || t?.closest?.(".litecontextmenu, .litemenu-entry, .comfy-context-menu, .p-contextmenu")) return;
                        closeEditor(true);
                    },
                };
                editor = ed;
                window.addEventListener("pointerdown", ed.outside, true);
                ed.refresh();
                ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
            }
            cv.addEventListener("pointerleave", () => { hover = null; requestDraw(); });
            cv.addEventListener("pointerenter", () => keepFocus());
            for (const ev of ["mousedown", "mousemove", "mouseup", "pointerdown", "pointermove", "pointerup", "contextmenu", "dblclick"]) {
                cvBox.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "contextmenu") e.preventDefault(); });
            }
            cvBox.addEventListener("wheel", (e) => {
                e.preventDefault(); e.stopPropagation();
                const [dx, dy] = evDisplay(e);
                if (e.altKey || e.ctrlKey) {                       // Alt+wheel (Ctrl+wheel zooms the graph in Nodes 2.0)
                    brush = Math.min(0.3, Math.max(0.002, brush * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
                    updateBrushSlider();
                } else {
                    const k = Math.pow(1.0015, -e.deltaY);
                    const z = Math.min(64, Math.max(0.02, view.z * k));
                    view.x = dx - (dx - view.x) * (z / view.z);
                    view.y = dy - (dy - view.y) * (z / view.z);
                    view.z = z;
                    userView = true;
                }
                requestDraw();
            }, { passive: false });

            wrap.addEventListener("keydown", (e) => {
                if (isField(e.target)) return;
                const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
                if (mod && k === "c" && msgSelected()) { e.stopPropagation(); return; }     // copy the message text, not a layer
                if (editor && !(mod && (k === "z" || k === "y"))) {          // pop-up editor open: only close / undo
                    if (k === "escape" || k === "enter") { e.preventDefault(); e.stopPropagation(); closeEditor(true); }
                    return;
                }
                const L = selLayer();
                // keys that act on the selected layer show its box again
                if (L && hiddenSel === selId && (["delete", "backspace", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k) || (mod && k === "d"))) {
                    hiddenSel = null; requestDraw();
                }
                let handled = true;
                if (pick && k === "enter") pickAccept(e.shiftKey);
                else if (pick && k === "escape") pickCancel();
                else if (pick && k === "backspace") pickUndo();
                else if (clickPoly && (k === "enter")) finishClickPoly();
                else if (clickPoly && k === "escape") { clickPoly = null; requestDraw(); }
                else if (clickPoly && k === "backspace") { clickPoly.pts.pop(); if (!clickPoly.pts.length) clickPoly = null; requestDraw(); }
                else if (k === " ") spaceDown = true;
                else if (mod && k === "z") (e.shiftKey ? redo() : undo());
                else if (mod && k === "y") redo();
                else if (mod && k === "d") duplicate();
                else if (mod && k === "c" && L) copyLayer(L, false);
                else if (mod && k === "x" && L) copyLayer(L, true);
                else if (mod && k === "v" && layerClip) pasteLayer();
                else if (k === "delete" || k === "backspace") deleteSelected();
                else if (k === "escape") selectLayer(null);
                else if (k === "v") setTool("select");
                else if (k === "b") setTool("brush");
                else if (k === "e") setTool("erase");
                else if (k === "f") setTool("fill");
                else if (k === "w") setTool("wand");
                else if (k === "q") setTool("object");
                else if (k === "l") setTool(e.shiftKey ? "lassoErase" : "lasso");
                else if (k === "r" || k === "o" || k === "t") {
                    shapeKind = { r: "rect", o: "ellipse", t: "triangle" }[k]; shapeSel.value = shapeKind; syncShapeOpts(); setTool("shape");
                } else if (k === "g") { snap = !snap; setSnapIcon(); requestDraw(); }
                else if (k === "home") { userView = false; fitView(); requestDraw(); }
                else if (k === "[" || k === "]") { brush = Math.min(0.3, Math.max(0.002, brush * (k === "]" ? 1.2 : 1 / 1.2))); updateBrushSlider(); requestDraw(); }
                else if (L && k.startsWith("arrow")) {
                    const s = short(), step = (e.shiftKey ? 10 : 1) * (snap ? grid : 1);
                    change(() => {
                        if (k === "arrowleft") L.ox -= step / s; if (k === "arrowright") L.ox += step / s;
                        if (k === "arrowup") L.oy -= step / s; if (k === "arrowdown") L.oy += step / s;
                    });
                } else handled = false;
                if (handled) { e.preventDefault(); e.stopPropagation(); }
            });
            wrap.addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; });

            // ---------------- panel: one tree of regions -> LoRAs + layers ----------------
            function activateRegion(rid) {                // returns true if anything changed
                if (curRegion === rid) return false;
                curRegion = rid;
                return true;
            }
            function refreshUI() {
                if (curRegion != null && curRegion !== UNSPEC && !regionById(curRegion)) curRegion = state.regions[0]?.id ?? null;
                const L = selLayer();
                if (L && L.shape === "star") sidesIn.value = String(L.sides);
                if (L && L.shape === "roundrect" && document.activeElement !== radiusIn) radiusIn.value = String(L.radius ?? 20);
                renderRegions();
                editor?.refresh();
                requestDraw();
            }
            function ico(symbol, title, fn, cls = "ico") {
                const b = btn(symbol, title, fn);
                b.classList.add(cls);
                b.addEventListener("pointerdown", (e) => e.stopPropagation());
                return b;
            }
            const layersOf = (rid) => {                    // top first
                const out = [];
                for (let i = state.layers.length - 1; i >= 0; i--) if (state.layers[i].region === rid) out.push(state.layers[i]);
                return out;
            };
            // what an open row / subsection shows; empty subsections are left out
            const subKinds = (r) => [
                ...(layersOf(r.id).length ? ["layers"] : []),
                ...((r.loras || []).length ? ["loras"] : []),
                ...(r.paletteOn ? ["palette"] : []),
            ];
            function chevron(key, has, what) {
                const c = el("span", "rg-chev" + (has ? "" : " empty"));
                const open = has && expanded.has(key);
                c.textContent = has ? (open ? "▼" : "▶") : "•";
                c.title = has ? `${open ? "Hide" : "Show"} ${what}` : `No ${what} yet`;
                c.addEventListener("pointerdown", (e) => {
                    e.stopPropagation();
                    if (!has) return;
                    if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
                    renderRegions();
                });
                return c;
            }
            // a subsection header inside an open region: ▶ Layers (3)
            function subHeader(r, kind) {
                const key = `${r.id}:${kind}`, open = subOpen.has(key);
                const n = kind === "layers" ? layersOf(r.id).length : kind === "loras" ? (r.loras || []).length : normPalette(r.palette).length;
                const label = { layers: "Layers", loras: "LoRAs", palette: "Color palette" }[kind];
                const row = el("div", "rg-row sub");
                const ch = el("span", "rg-chev"); ch.textContent = open ? "▼" : "▶";
                const t = el("span", "rg-subname"); t.textContent = `${label} (${n})`;
                row.title = `${open ? "Hide" : "Show"} this region's ${label.toLowerCase()}`;
                row.append(ch, t);
                row.addEventListener("pointerdown", (e) => {
                    e.stopPropagation();
                    if (subOpen.has(key)) subOpen.delete(key); else subOpen.add(key);
                    renderRegions();
                });
                return row;
            }
            // header buttons: kind = "layers" | "loras" | "palette" | "all"
            function kindTargets(kind) {
                const out = [];                                // [rowKey, subKey or null]
                for (const r of state.regions) {
                    for (const k of subKinds(r)) if (kind === "all" || kind === k) out.push([r.id, `${r.id}:${k}`]);
                }
                if ((kind === "layers" || kind === "all") && layersOf(UNSPEC).length) out.push([UNSPEC, null]);
                if ((kind === "loras" || kind === "all") && (state.sceneLoras || []).length) out.push([SCENE, null]);
                return out;
            }
            const kindOpen = (kind) => {
                const t = kindTargets(kind);
                return t.length > 0 && t.every(([rk, sk]) => expanded.has(rk) && (sk == null || subOpen.has(sk)));
            };
            function toggleKind(kind) {
                const t = kindTargets(kind);
                if (kind === "all") {
                    if (kindOpen("all")) { expanded.clear(); subOpen.clear(); }
                    else for (const [rk, sk] of t) { expanded.add(rk); if (sk) subOpen.add(sk); }
                } else if (kindOpen(kind)) {
                    for (const [rk, sk] of t) {
                        if (!sk) { expanded.delete(rk); continue; }
                        subOpen.delete(sk);
                        // nothing else open in that region: close the region too
                        const r = regionById(rk);
                        if (r && !subKinds(r).some((k) => subOpen.has(`${rk}:${k}`))) expanded.delete(rk);
                    }
                } else {
                    for (const [rk, sk] of t) { expanded.add(rk); if (sk) subOpen.add(sk); }
                }
                renderRegions();
            }
            function updateExpandButtons() {
                const names = { loras: "LoRAs", all: "All" };              // layers and palettes: icons
                for (const [k, b] of Object.entries(expandBtns)) {
                    const any = kindTargets(k).length > 0;
                    const arrow = any && kindOpen(k) ? "▲" : "▼";
                    const html = names[k] ? `${arrow} ${names[k]}` : `<span>${arrow}</span>${svgIcon(k)}`;
                    if (b.__html !== html) { b.__html = html; b.innerHTML = html; b.classList.toggle("mixed", !names[k]); }
                    b.disabled = !any;
                }
            }
            // one LoRA of a region (or of the whole image), with its trigger words as chips
            function loraRows(list, owner) {
                // owner: { prompt(): string, append(word) } (region prompt, or scene_prompt_positive for whole-image LoRAs)
                const frag = document.createDocumentFragment();
                list.forEach((lo, i) => {
                    const row = el("div", "rg-row lora");
                    const tag = el("span", "rg-hint"); tag.textContent = lo.edit ? "Edit" : "LoRA";
                    if (lo.edit) {
                        tag.title = `Edit LoRA for ${lo.edit}, added by Edit Mode: used only in Edit Mode with a ${lo.edit} model, `
                            + "and removed when the node is switched back to generate (Settings > Region Genie > Edit Mode).";
                        row.classList.add("edit");
                    }
                    const on = el("input"); on.type = "checkbox"; on.checked = lo.on !== false; on.title = "On / off";
                    on.addEventListener("change", () => change(() => { lo.on = on.checked; }));
                    const pick = el("button", "rg-pick");
                    const setLabel = () => {
                        pick.textContent = lo.lora || "(choose a LoRA)";
                        pick.title = lo.lora || "Choose a LoRA";
                        pick.classList.toggle("missing", !!lo.lora && !!knownLoras() && !knownLoras().includes(lo.lora));
                    };
                    setLabel();
                    pick.addEventListener("pointerdown", (e) => e.stopPropagation());
                    pick.addEventListener("click", async (e) => {
                        const ok = await pickLora(e, (name) => { change(() => { lo.lora = name; }); focusSink(); });
                        if (!ok) hint("No LoRAs found in models/loras");
                    });
                    const str = el("input", "rg-num"); str.type = "number"; str.step = "0.05"; str.min = "-10"; str.max = "10";
                    str.value = String(lo.strength); str.title = "LoRA strength";
                    str.addEventListener("change", () => { const v = +str.value; if (Number.isFinite(v)) change(() => { lo.strength = v; }); });
                    str.addEventListener("keydown", (e) => e.stopPropagation());
                    const del = ico("✕", "Remove this LoRA", () => change(() => { list.splice(i, 1); }));
                    row.append(tag, on, pick, str, del);
                    frag.appendChild(row);
                    const chips = el("div", "rg-trig");
                    frag.appendChild(chips);
                    if (!lo.lora) return;
                    fillTriggerChips(chips, lo.lora, owner.prompt, (w) => owner.append([w]), el);
                });
                return frag;
            }
            function addLoraTo(list, ev, onAdded) {
                pickLora(ev, (name) => { onAdded?.(); change(() => { list.push({ lora: name, strength: 1, on: true }); }); focusSink(); })
                    .then((ok) => { if (!ok) hint("No LoRAs found in models/loras"); });
            }
            function layerRows(rid) {
                const frag = document.createDocumentFragment();
                for (const L of layersOf(rid)) {
                    const row = el("div", "rg-row lvl1 layer" + (L.id === selId ? " sel" : ""));
                    row.dataset.lid = String(L.id);
                    row.addEventListener("pointerdown", (e) => { if (e.target === row || e.target.classList.contains("rg-sw")) selectLayer(L); });
                    const eye = ico(L.visible === false ? "○" : "◉", "Show / hide (hidden layers are not output)", () => change(() => { L.visible = L.visible === false; }));
                    const sw = el("div", "rg-sw"); sw.style.background = colorOf(L.region) || "transparent"; sw.title = "Select this layer";
                    const name = el("input"); name.type = "text"; name.value = L.name; name.title = "Layer name";
                    name.addEventListener("focus", () => { if (selId !== L.id || hiddenSel === L.id) { selId = L.id; hiddenSel = null; curRegion = L.region; markLayerRows(); requestDraw(); } });
                    name.addEventListener("change", () => change(() => { L.name = name.value; }));
                    name.addEventListener("keydown", (e) => e.stopPropagation());
                    const up = ico("▲", L.region === UNSPEC ? "Move up one step in the stack" : "Move up (in front of this region's other layers)", () => moveLayer(L, +1));
                    up.disabled = moveTarget(L, +1) < 0;
                    const dn = ico("▼", L.region === UNSPEC ? "Move down one step in the stack" : "Move down (behind this region's other layers)", () => moveLayer(L, -1));
                    dn.disabled = moveTarget(L, -1) < 0;
                    const dup = ico("⧉", "Duplicate (Ctrl+D). Right-click: duplicate into another region", () => duplicate(L));
                    dup.classList.add("variants");
                    dup.addEventListener("pointerdown", (e) => { if (e.button === 2) e.stopPropagation(); });
                    dup.addEventListener("contextmenu", (e) => {
                        e.preventDefault(); e.stopPropagation();
                        const items = [{ content: "Duplicate to this Region", rid: L.region }];
                        for (const it of regionTargets(L.region)) items.push({ content: `Duplicate to ${it.label}`, rid: it.rid });
                        contextMenu(e, items, "Duplicate layer", (v) => { if (v && v.rid != null) duplicateTo(L, v.rid); focusSink(); });
                    });
                    const lower = (() => { const i = state.layers.indexOf(L); return state.layers.slice(0, i).reverse().find((l) => l.region === L.region && l.visible !== false); })();
                    const md = ico("⤓", "Merge down into the next lower layer of this region", () => mergeDown(L));
                    md.disabled = !lower;
                    const mv = ico("⇄", "Move this layer to another region", (e) => {
                        const items = regionTargets(L.region).map((it) => ({ content: `Move to ${it.label}`, rid: it.rid }));
                        contextMenu(e, items, "Move to region", (v) => { if (v && v.rid != null) moveLayerToRegion(L, v.rid); focusSink(); });
                    });
                    const er = ico("⌫", "Erase layer: remove its shapes and paint, keep the empty layer", () => eraseLayer(L));
                    const del = ico("🗑", "Delete layer (Del)", () => deleteSelected(L));
                    row.append(eye, sw, name, up, dn, dup, md, mv, er, del);
                    frag.appendChild(row);
                }
                return frag;
            }
            // ---- pieces of a region's row, shared by the list and the pop-up editor ----
            // the region's color: its own color, or the first palette color when it has a palette
            function regionSwatch(r, pick) {
                const pal = activePalette(r);
                let sw;
                if (r.fromImage && !pal.length) {
                    sw = el("div", "rg-sw"); sw.style.background = r.color;
                    sw.title = `${r.color} (found in the image, so its color can't change)`;
                } else {
                    sw = el("button", "rg-sw pick"); sw.type = "button"; sw.style.background = colorOf(r.id);
                    sw.title = pal.length ? `${colorOf(r.id)}: the region is shown in its first palette color; click to change it`
                        : `${r.color}: click to change the color (display only)`;
                    const apply = (v) => {
                        if (activePalette(r).length) { r.palette = normPalette(r.palette); r.palette[0] = v.toUpperCase(); }
                        else r.color = uniqueColor(v, r.id);
                    };
                    sw.addEventListener("pointerdown", (e) => e.stopPropagation());
                    sw.addEventListener("click", (e) => {
                        e.preventDefault();
                        pick?.();
                        pickColor(sw, colorOf(r.id), apply);
                    });
                }
                sw.dataset.swatch = String(r.id);
                return sw;
            }
            // the color picker on a swatch: changes show live, the whole pick is one undo step
            // before: a snapshot taken before an edit that already happened (a new palette color): then closing
            // the picker keeps that edit even when the color wasn't changed
            function pickColor(anchor, start, apply, before = null) {
                const added = before != null;
                openColorPicker(anchor, start, {
                    onInput: (hex) => {
                        if (before == null) before = snapshot();
                        apply(hex); version++; liveColors();
                        if (anchor.isConnected) anchor.style.background = hex;
                    },
                    onClose: (hex, changed) => {
                        if ((!changed && !added) || before == null) return;
                        pushUndo(before);
                        save(); refreshUI(); focusSink();          // Ctrl+Z goes to the editor next
                    },
                });
            }
            // colors changed while a color picker is open: update the canvas and the swatches, keep the picker
            function liveColors() {
                for (const s of wrap.querySelectorAll("[data-swatch]")) {
                    const c = colorOf(Number(s.dataset.swatch) || s.dataset.swatch);
                    if (!c) continue;
                    if (s.tagName === "INPUT") { if (document.activeElement !== s) s.value = c.toLowerCase(); }
                    else s.style.background = c;
                }
                if (editor) editor.box.style.borderColor = colorOf(editor.rid) || "#5b8fd0";
                requestDraw();
            }
            // mask feather: shared by all linked regions, or this region's own value when unlinked
            function featherBox(r) {
                const fBox = el("span", "rg-feather");
                const linked = r.featherLinked !== false;
                const fIn = el("input", "rg-num"); fIn.type = "number"; fIn.min = "0"; fIn.max = "512"; fIn.step = "1";
                fIn.value = String(linked ? (state.feather || 0) : (r.feather || 0));
                fIn.title = linked ? "Feather (px): softens this region's mask edges in 'masks' and for its LoRAs. "
                    + "Linked: the same value for every linked region." : "Feather (px) of this region only (unlinked)";
                fIn.addEventListener("keydown", (e) => e.stopPropagation());
                fIn.addEventListener("change", () => {
                    const v = Math.max(0, Math.min(512, Math.round(+fIn.value || 0)));
                    change(() => { if (r.featherLinked !== false) state.feather = v; else r.feather = v; });
                });
                const fLink = el("button", "rg-btn mini toggle" + (linked ? " on" : ""));
                fLink.innerHTML = svgIcon(linked ? "link" : "unlink");
                fLink.title = linked ? "Linked: every linked region uses the same feather. Click to give this region its own value."
                    : "Own feather value. Click to link it to the shared value again.";
                fLink.addEventListener("pointerdown", (e) => e.stopPropagation());
                fLink.addEventListener("click", (e) => {
                    e.preventDefault();
                    change(() => {
                        if (r.featherLinked !== false) { r.featherLinked = false; r.feather = state.feather || 0; }
                        else { r.featherLinked = true; delete r.feather; }
                    });
                });
                const fEdge = el("button", "rg-btn mini toggle" + (r.featherEdges ? " on" : ""));
                fEdge.innerHTML = svgIcon("edges");
                fEdge.title = r.featherEdges ? "feather_canvas_edges on: edges on the image border fade too. Click to keep them solid."
                    : "feather_canvas_edges off: edges on the image border stay solid. Click to fade them too.";
                fEdge.addEventListener("pointerdown", (e) => e.stopPropagation());
                fEdge.addEventListener("click", (e) => { e.preventDefault(); change(() => { if (r.featherEdges) delete r.featherEdges; else r.featherEdges = true; }); });
                const fIco = el("span", "rg-fico"); fIco.innerHTML = svgIcon("feather"); fIco.title = fIn.title;
                fBox.append(fIco, fIn, fLink, fEdge);
                return fBox;
            }
            // color palette on/off (a row of up to 5 colors under the region)
            function paletteToggle(r) {
                const b = el("button", "rg-btn mini toggle" + (r.paletteOn ? " on" : ""));
                b.innerHTML = svgIcon("palette");
                const n = normPalette(r.palette).length;
                b.title = r.paletteOn ? `Color palette on (${n} color${n === 1 ? "" : "s"}): sent with the region in elements, `
                    + "the MOSS and Ideogram JSON prompts; the first color shows the region. Click to turn it off."
                    : "Color palette: give this region up to 5 colors (MOSS 'palette' / Ideogram 'color_palette'). Click to turn it on.";
                b.addEventListener("pointerdown", (e) => e.stopPropagation());
                b.addEventListener("click", (e) => {
                    e.preventDefault();
                    if (!r.paletteOn) openSub(r.id, "palette");    // show the new palette row right away
                    change(() => { if (r.paletteOn) delete r.paletteOn; else r.paletteOn = true; });
                });
                return b;
            }
            // the palette row: swatches (click = change, right-click = remove) and + (add, up to 5)
            function paletteRow(r, inPopup) {
                const row = el("div", "rg-row pal" + (r.paletteOn ? "" : " off"));
                const tag = el("span", "rg-palico"); tag.innerHTML = svgIcon("palette");
                tag.title = r.paletteOn ? "Color palette of this region" : "Color palette (off: not used; turn it on with the palette button)";
                row.appendChild(tag);
                const pal = normPalette(r.palette);
                pal.forEach((c, i) => {
                    const sw = el("button", "rg-sw pal pick"); sw.type = "button"; sw.style.background = c;
                    sw.dataset.pal = `${r.id}:${i}`;
                    sw.title = `${c}: click to change, right-click to remove` + (i === 0 ? " (the first color shows the region)" : "");
                    sw.addEventListener("pointerdown", (e) => e.stopPropagation());
                    sw.addEventListener("click", (e) => {
                        e.preventDefault();
                        pickColor(sw, normPalette(r.palette)[i] || c, (v) => { r.palette = normPalette(r.palette); r.palette[i] = v.toUpperCase(); });
                    });
                    sw.addEventListener("contextmenu", (e) => {
                        e.preventDefault(); e.stopPropagation();
                        change(() => { r.palette = normPalette(r.palette); r.palette.splice(i, 1); if (!r.palette.length) delete r.palette; });
                        focusSink();
                    });
                    row.appendChild(sw);
                });
                if (pal.length < PAL_MAX) {
                    // "+" adds a white swatch in its place ("+" moves right, or hides at 5 colors), then opens the
                    // color picker on that new swatch
                    const add = el("button", "rg-paladd"); add.type = "button"; add.textContent = "+";
                    add.title = `Add a color (${pal.length}/${PAL_MAX})`;
                    add.addEventListener("pointerdown", (e) => e.stopPropagation());
                    add.addEventListener("click", (e) => {
                        e.preventDefault();
                        const before = snapshot();
                        const cur = normPalette(r.palette);
                        if (cur.length >= PAL_MAX) return;
                        cur.push("#FFFFFF");
                        r.palette = cur; r.paletteOn = true;
                        const i = cur.length - 1;
                        save(); refreshUI();                         // the list and the pop-up show the new swatch
                        const scope = inPopup ? editor?.box : regList;
                        const sw = scope?.querySelector(`[data-pal="${r.id}:${i}"]`);
                        if (!sw) { pushUndo(before); return; }
                        pickColor(sw, "#FFFFFF", (v) => { r.palette = normPalette(r.palette); r.palette[i] = v.toUpperCase(); }, before);
                    });
                    row.appendChild(add);
                }
                if (!inPopup && !pal.length) {
                    const h = el("span", "rg-hint"); h.textContent = "add up to 5 colors";
                    row.appendChild(h);
                }
                return row;
            }
            // ---------------- LLM Prompt Enhancer ----------------
            // r.llm / state.sceneLlm: on; r.llmSalt / state.sceneLlmSalt: added to the seed ("run again");
            // state.llm: { ctxMode, assign: {type: preset}, ctx, cfg: {type: {preset, s}} } (cfg = full copies, so the
            // workflow carries the settings). Results of the last run: node.properties.rg_llm (not in paint_data, so
            // storing them doesn't make the next run start over).
            const LLM_SCENE = "llm:scene";
            const llmBtns = new Map();
            const llmResults = () => {
                node.properties = migrateProps(node.properties || {});
                let p = node.properties.rg_llm;
                if (!p || typeof p !== "object") p = node.properties.rg_llm = { regions: {}, scene: null };
                if (!p.regions || typeof p.regions !== "object") p.regions = {};
                return p;
            };
            const llmUsed = () => !!state.sceneLlm || state.regions.some((r) => r.llm);
            function syncLlm() {
                if (!llmUsed() && !state.llm) return;
                if (!library()) { loadLibrary(); return; }           // its change listener calls back
                const next = resolveNodeLlm(state.llm);
                if (JSON.stringify(next) !== JSON.stringify(state.llm)) { state.llm = next; save(); }
            }
            const llmHost = {
                getLlm: () => state.llm || {},
                setLlm: (fn) => {
                    const L = JSON.parse(JSON.stringify(state.llm || {}));
                    fn(L);
                    change(() => { state.llm = resolveNodeLlm(L); });
                },
                regionTypesInUse: () => new Set([...state.regions.filter((r) => r.llm).map((r) => r.type || "object"),
                    ...(state.sceneLlm ? ["scene"] : [])]),
                renamePreset: (a, b) => {
                    const as = state.llm?.assign;
                    if (as) for (const t of Object.keys(as)) if (as[t] === a) as[t] = b;
                    syncLlm(); save();
                },
            };
            const offLlmLib = onLibraryChange(() => { syncLlm(); updateLlmButtons(); });
            function llmTarget(key) {
                if (key === LLM_SCENE) return { on: !!state.sceneLlm, prompt: sceneW?.value || "", type: "scene", res: llmResults().scene, what: "scene_prompt_positive" };
                const r = regionById(key);
                return r ? { on: !!r.llm, prompt: r.prompt || "", type: r.type || "object", res: llmResults().regions[r.id], r, what: "this region's prompt" } : null;
            }
            const llmReady = (t) => !!(t?.res && !t.res.failed && t.res.text && String(t.res.prompt || "").trim() === String(t.prompt || "").trim());
            function setLlmOn(key, on) {
                change(() => { if (key === LLM_SCENE) state.sceneLlm = on; else { const r = regionById(key); if (r) r.llm = on; } });
                syncLlm(); updateLlmButtons();
            }
            function keepEnhanced(key) {
                const t = llmTarget(key);
                if (!llmReady(t)) return;
                if (key === LLM_SCENE) {
                    setWidget(sceneW, t.res.text);
                    change(() => { state.sceneLlm = false; });
                    hint("The enhanced text is now in scene_prompt_positive");
                } else change(() => { t.r.prompt = t.res.text; t.r.llm = false; });
                updateLlmButtons();
            }
            function llmButton(key, slot = "") {
                const b = el("button", "rg-btn rg-llm-btn");
                b.addEventListener("pointerdown", (e) => e.stopPropagation());
                let shown = "";
                const refresh = () => {
                    const t = llmTarget(key);
                    if (!t) return;
                    const ready = llmReady(t);
                    const failed = !!(t.res?.failed && String(t.res.prompt || "").trim() === t.prompt.trim());
                    const preset = presetForType(state.llm, t.type) || "default";
                    let tip;
                    if (!t.on) tip = `LLM Prompt Enhancer off. Click to have the LLM rewrite ${t.what} when the workflow runs (preset '${preset}').`;
                    else if (ready) tip = `LLM Prompt Enhancer on (preset '${t.res.preset || preset}'). Text used in the last run:\n\n${t.res.text}`
                        + (t.res.thinking ? `\n\nThinking:\n${t.res.thinking.slice(0, 1200)}${t.res.thinking.length > 1200 ? "..." : ""}` : "")
                        + "\n\nClick to turn off (restore your prompt or keep this text). Right-click for more.";
                    else if (failed) tip = `LLM Prompt Enhancer on: the LLM returned nothing last time, so the typed prompt was used; it is tried again on the next run.`;
                    else tip = `LLM Prompt Enhancer on (preset '${preset}'): ${t.what} is rewritten when the workflow runs. Click to turn off.`;
                    // only touch the button when something changed: replacing its contents while the pointer rests
                    // on it (the 0.5 s poll) would cancel the browser's tooltip
                    const sig = [t.on, ready, failed, tip].join("|");
                    if (sig === shown) return;
                    shown = sig;
                    b.innerHTML = sparkleSvg(t.on);
                    b.classList.toggle("on", t.on);
                    b.classList.toggle("ready", t.on && ready);
                    b.classList.toggle("failed", t.on && failed);
                    b.title = tip;
                };
                b.addEventListener("click", (e) => {
                    e.preventDefault();
                    const t = llmTarget(key);
                    if (!t) return;
                    if (!t.on) { setLlmOn(key, true); return; }
                    if (!llmReady(t)) { setLlmOn(key, false); return; }
                    contextMenu(e, [{ content: "Turn off – restore my original prompt", v: "restore" },
                                    { content: "Turn off – keep the enhanced text to edit", v: "keep" }], "LLM Prompt Enhancer", (v) => {
                        if (v?.v === "restore") setLlmOn(key, false);
                        else if (v?.v === "keep") keepEnhanced(key);
                    });
                });
                b.addEventListener("contextmenu", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    const t = llmTarget(key);
                    if (!t) return;
                    const items = [];
                    const sampling = !!state.llm?.cfg?.[t.type]?.s?.sampling;       // greedy: a seed changes nothing
                    if (!t.on) items.push({ content: "Turn on", v: "on" });
                    else if (sampling) items.push({ content: "Run again with a new seed", v: "again" });
                    if (t.res?.text) items.push({ content: "Copy the enhanced text", v: "copy" });
                    if (t.res?.thinking) items.push({ content: "Copy the thinking", v: "think" });
                    if (llmReady(t)) items.push({ content: "Keep the enhanced text to edit (turns off)", v: "keep" });
                    if (items.length) items.push(null);
                    items.push({ content: "LLM Settings...", v: "settings" });
                    contextMenu(e, items, "LLM Prompt Enhancer", (v) => {
                        if (v?.v === "on") setLlmOn(key, true);
                        else if (v?.v === "again") {
                            change(() => { if (key === LLM_SCENE) state.sceneLlmSalt = (state.sceneLlmSalt || 0) + 1; else t.r.llmSalt = (t.r.llmSalt || 0) + 1; });
                            hint("A new seed: the prompt is rewritten on the next run");
                        } else if (v?.v === "copy") navigator.clipboard?.writeText(t.res.text).catch(() => {});
                        else if (v?.v === "think") navigator.clipboard?.writeText(t.res.thinking).catch(() => {});
                        else if (v?.v === "keep") keepEnhanced(key);
                        else if (v?.v === "settings") openLlmSettings(llmSetBtn, llmHost);
                    });
                });
                llmBtns.set(slot ? `${key}|${slot}` : key, refresh);
                refresh();
                return b;
            }
            function updateLlmButtons() {
                for (const f of llmBtns.values()) f();
            }
            function storeLlmResults(msg) {
                const store = llmResults();
                for (const [rid, res] of Object.entries(msg?.regions || {})) store.regions[rid] = res;
                if (msg?.scene) store.scene = msg.scene;
                const ids = new Set(state.regions.map((r) => String(r.id)));
                for (const rid of Object.keys(store.regions)) if (!ids.has(rid)) delete store.regions[rid];
                node.setDirtyCanvas?.(true, true);
                updateLlmButtons();
            }
            function pushLlmCache() {                       // results saved in the workflow -> server cache
                const st = migrateProps(node.properties)?.rg_llm;
                const entries = {};
                for (const res of [...Object.values(st?.regions || {}), st?.scene]) {
                    if (res?.key && res.text && !res.failed) entries[res.key] = { text: res.text, thinking: res.thinking || "" };
                }
                if (Object.keys(entries).length) {
                    api.fetchApi("/region_genie/llm_cache", { method: "POST", body: JSON.stringify({ entries }) }).catch(() => {});
                }
            }

            // a region's LoRAs; trigger-word chips add to its prompt
            function regionLoraRows(r) {
                return loraRows(r.loras || [], {
                    prompt: () => r.prompt,
                    append: (words) => change(() => { for (const w of words) r.prompt = appendWord(r.prompt, w); }),
                });
            }
            function renderRegions() {
                const scroll = regList.scrollTop;
                regList.textContent = "";
                llmBtns.clear();
                sepIn.value = String(normLoraOpts(state.loraOpts).separation);
                untilIn.value = String(normLoraOpts(state.loraOpts).until);
                const anyLora = (state.sceneLoras || []).length || state.regions.some((r) => (r.loras || []).length);
                const showSep = anyLora || normLoraOpts(state.loraOpts).allRegions || autoApart;
                for (const e of [sepLbl, sepIn, untilLbl, untilIn]) e.style.display = showSep ? "" : "none";
                setAllApartBtn();
                syncEditMaskBox();
                updateExpandButtons();

                // whole image: LoRAs for everything (trigger words go to scene_prompt_positive)
                const scene = el("div", "rg-row scene");
                const sl = el("span", "rg-pseudo"); sl.textContent = "Whole image";
                sl.title = "LoRAs here act on the whole picture (and all text), like a normal LoRA";
                const sceneAdd = ico("＋LoRA", "Add a LoRA for the whole image", (e) => { state.sceneLoras = state.sceneLoras || []; addLoraTo(state.sceneLoras, e, () => expanded.add(SCENE)); }, "txt");
                const nScene = (state.sceneLoras || []).length;
                const sGap = el("span"); sGap.style.flex = "1 1 auto";
                const sOpen = expanded.has(SCENE);
                scene.append(chevron(SCENE, true, `the whole-image LoRAs (${nScene})`), sl, sGap, llmButton(LLM_SCENE), sceneAdd);
                // a click anywhere on the row (but its buttons) opens or closes it, like the chevron
                scene.title = `${sOpen ? "Hide" : "Show"} the LoRAs that act on the whole image (${nScene})`;
                scene.addEventListener("pointerdown", (e) => {
                    if (e.button !== 0 || e.target.closest?.("button, input, select, textarea")) return;
                    e.stopPropagation();
                    if (expanded.has(SCENE)) expanded.delete(SCENE); else expanded.add(SCENE);
                    renderRegions();
                });
                regList.appendChild(scene);
                if (sOpen && nScene) {
                    regList.appendChild(loraRows(state.sceneLoras, {
                        prompt: () => sceneW?.value || "",
                        append: (words) => { let v = sceneW?.value || ""; for (const w of words) v = appendWord(v, w); setWidget(sceneW, v); hint("Added to scene_prompt_positive"); renderRegions(); },
                    }));
                } else if (sOpen) {
                    const empty = el("div", "rg-row lora");
                    const t = el("span", "rg-hint");
                    t.textContent = "No whole-image LoRAs yet: ＋LoRA adds one that acts on the whole picture, like Load LoRA"
                        + (isEdit() ? " (Edit Mode adds the edit LoRA set in Settings > Region Genie > Edit Mode)" : "");
                    empty.appendChild(t);
                    regList.appendChild(empty);
                }

                state.regions.forEach((r, i) => {
                    const lays = layersOf(r.id);
                    const row = el("div", "rg-row region" + (curRegion === r.id ? " sel" : "") + (r.hidden ? " off" : ""));
                    const pick = () => { if (activateRegion(r.id)) { markRegionRows(); requestDraw(); } };
                    row.addEventListener("pointerdown", (e) => { if (e.target === row || e.target.classList.contains("rg-idx") || e.target.classList.contains("rg-cnt")) pick(); });
                    const sw = regionSwatch(r, pick);
                    const ty = el("select", "rg-sel"); ty.title = "MOSS item type";
                    for (const v of TYPES) ty.appendChild(opt(v, v));
                    ty.value = r.type;
                    ty.addEventListener("change", () => change(() => { r.type = ty.value; }));
                    const pr = el("textarea", "rg-prompt"); pr.rows = 1; pr.placeholder = r.fromImage ? "prompt for this image color" : "prompt";
                    const dblTip = (v) => (v ? v + "\n" : "") + "Double-click: open in the pop-up editor";
                    pr.value = r.prompt; pr.dataset.rid = String(r.id); pr.spellcheck = false;
                    wcMark(pr, "r" + r.id, r.prompt, dblTip(r.prompt));
                    pr.addEventListener("blur", () => { pr.scrollTop = 0; wcMark(pr, "r" + r.id, r.prompt, dblTip(r.prompt)); refreshChips(r.id); });
                    // double-click: the region's pop-up editor, next to this row
                    const openPop = (field) => (e) => { e.preventDefault(); e.stopPropagation(); e.target.blur(); editPrompt(r.id, null, field); };
                    pr.addEventListener("dblclick", openPop("prompt"));
                    pr.addEventListener("focus", () => pick());
                    pr.addEventListener("input", () => { r.prompt = pr.value; save(); llmBtns.get(r.id)?.(); });
                    pr.addEventListener("keydown", (e) => {
                        e.stopPropagation();
                        if (e.key === "Enter" && !e.shiftKey && !autocompleteOpen(pr, e)) { e.preventDefault(); pr.blur(); }
                    });
                    autocompleteOnFocus(pr, node);
                    const ix = el("span", "rg-idx"); ix.dataset.k = String(i);
                    const cnt = el("span", "rg-cnt"); cnt.textContent = lays.length ? String(lays.length) : ""; cnt.title = `${lays.length} layer(s)`;
                    const kinds = subKinds(r);
                    const eye = ico(r.hidden ? "○" : "◉", r.hidden ? "Hidden: not drawn and not output. Click to show it again (its layers keep their own show / hide)"
                        : "Show / hide this region: a hidden region is not drawn and is left out of every output; its layers keep their own show / hide",
                        () => change(() => { if (r.hidden) delete r.hidden; else r.hidden = true; }));
                    eye.classList.add("rg-reye");
                    row.append(chevron(r.id, kinds.length > 0, "this region's " + (kinds.map((k) => ({ layers: "layers", loras: "LoRAs", palette: "palette" })[k]).join(", ") || "layers")), eye, ix, sw, ty, pr);
                    if (r.type === "text") {
                        // text to render: grows while edited, like the prompt (Shift+Enter = new line)
                        const tx = el("textarea", "rg-prompt rg-text"); tx.rows = 1; tx.placeholder = "text"; tx.value = r.text;
                        tx.spellcheck = false;
                        wcMark(tx, `r${r.id}.text`, r.text, dblTip(r.text || "Text to render"));
                        tx.addEventListener("focus", () => pick());
                        tx.addEventListener("blur", () => { tx.scrollTop = 0; wcMark(tx, `r${r.id}.text`, r.text, dblTip(r.text || "Text to render")); });
                        tx.addEventListener("dblclick", openPop("text"));
                        tx.addEventListener("input", () => { r.text = tx.value; save(); });
                        tx.addEventListener("keydown", (e) => {
                            e.stopPropagation();
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); tx.blur(); }
                        });
                        row.appendChild(tx);
                    }
                    const addL = ico("＋LoRA", "Apply a LoRA to this region (model output; MOSS Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5)", (e) => { r.loras = r.loras || []; addLoraTo(r.loras, e, () => openSub(r.id, "loras")); }, "txt");
                    const mergeAll = ico("⇊", "Merge all visible layers of this region into one layer", () => mergeRegion(r.id));
                    mergeAll.disabled = lays.filter((l) => l.visible !== false).length < 2;
                    const up = ico("↑", "Move up: earlier in the output order, and its layers in front", () => change(() => {
                        [state.regions[i - 1], state.regions[i]] = [state.regions[i], state.regions[i - 1]]; sortLayersByRegions(); }));
                    up.disabled = i === 0;
                    const down = ico("↓", "Move down: later in the output order, and its layers behind", () => change(() => {
                        [state.regions[i + 1], state.regions[i]] = [state.regions[i], state.regions[i + 1]]; sortLayersByRegions(); }));
                    down.disabled = i === state.regions.length - 1;
                    const del = ico("✕", "Delete region and its layers", () => change(() => {
                        state.regions.splice(i, 1);
                        state.layers = state.layers.filter((l) => l.region !== r.id);
                        if (curRegion === r.id) curRegion = state.regions[0]?.id ?? null;
                        if (!selLayer()) selId = null;
                    }));
                    row.append(llmButton(r.id), ...(isEdit() ? [keepToggle(r)] : []), cnt, featherBox(r), paletteToggle(r), addL,
                               mergeAll, up, down, del);
                    regList.appendChild(row);
                    if (kinds.length && expanded.has(r.id)) {
                        for (const k of kinds) {
                            regList.appendChild(subHeader(r, k));
                            if (!subOpen.has(`${r.id}:${k}`)) continue;
                            const body = el("div", "rg-subbody");
                            if (k === "layers") body.appendChild(layerRows(r.id));
                            else if (k === "loras") { body.dataset.loras = String(r.id); body.appendChild(regionLoraRows(r)); }
                            else body.appendChild(paletteRow(r, false));
                            regList.appendChild(body);
                        }
                    }
                });
                const ul = layersOf(UNSPEC);
                const un = el("div", "rg-row region" + (curRegion === UNSPEC ? " sel" : ""));
                un.title = "Layers here make black, unspecified areas through the layers below";
                un.addEventListener("pointerdown", (e) => { if (e.target === un || e.target.classList.contains("rg-pseudo") || e.target.classList.contains("rg-sw")) { if (activateRegion(UNSPEC)) { markRegionRows(); requestDraw(); } } });
                const usw = el("div", "rg-sw"); usw.style.background = "#000000";
                const ut = el("span", "rg-pseudo"); ut.textContent = "Unspecified (cuts holes)";
                const ucnt = el("span", "rg-cnt"); ucnt.textContent = ul.length ? String(ul.length) : "";
                un.append(chevron(UNSPEC, ul.length > 0, `the unspecified layers (${ul.length})`), el("span", "rg-idx"), usw, ut, ucnt);
                regList.appendChild(un);
                if (ul.length && expanded.has(UNSPEC)) regList.appendChild(layerRows(UNSPEC));
                regList.scrollTop = scroll;
                idxKey = "";
                updateRegionIndices();
            }
            function refreshChips(rid) {                   // trigger chips follow prompt edits
                const r = regionById(rid);
                const box = regList.querySelector(`[data-loras="${rid}"]`);
                if (!r || !box || !(r.loras || []).length) return;
                box.replaceChildren(regionLoraRows(r));
            }
            function markRegionRows() {
                const rows = [...regList.querySelectorAll(".rg-row.region")];
                const ids = [...state.regions.map((r) => r.id), UNSPEC];
                rows.forEach((row, k) => row.classList.toggle("sel", ids[k] === curRegion));
            }
            function markLayerRows() {
                for (const row of regList.querySelectorAll(".rg-row.layer")) row.classList.toggle("sel", Number(row.dataset.lid) === selId);
            }

            // ---------------- backdrop ----------------
            function loadBackdrop(url, key, ref) {
                if (key === backdropKey) return;
                backdropKey = key;
                const img = new Image();
                img.onload = () => { if (backdropKey === key) { backdrop = img; backdropRef = ref || null; requestDraw(); } };
                img.onerror = () => { if (backdropKey === key) { backdrop = null; requestDraw(); } };
                img.src = url;
            }
            function liveBackdrop() {
                const inp = node.inputs?.find((i) => i.name === "image");
                if (!inp || inp.link == null) {
                    if (backdrop || backdropKey) { backdrop = null; backdropKey = ""; backdropRef = null; if (pick) pickSettle(); requestDraw(); }
                    return;
                }
                const link = linkOf(node.graph, inp.link);
                const src = link && node.graph?.getNodeById(link.origin_id);
                const iw = src?.widgets?.find((w) => w.name === "image");
                if (src && /LoadImage/.test(src.type || src.comfyClass || "") && typeof iw?.value === "string" && iw.value) {
                    const v = iw.value.replace(/ \[(input|output|temp)\]$/, "");
                    const cut = v.lastIndexOf("/");
                    const sub = cut >= 0 ? v.slice(0, cut) : "", fn = cut >= 0 ? v.slice(cut + 1) : v;
                    loadBackdrop(api.apiURL(`/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=${encodeURIComponent(sub)}`), "input:" + iw.value,
                        { filename: fn, subfolder: sub, type: "input" });
                }
            }

            // ---------------- layout import / export ----------------
            const sizeLinked = () => (node.inputs || []).some((i) =>
                ["width_in", "height_in", "size_from_image", "size_from_latent"].includes(i.name) && i.link != null);
            // Edit Mode on: add the edit LoRA set in Settings for the model of the last run (for every model with one
            // when no run has said which), to the 'Whole image' LoRAs; off: remove the rows it added
            const lastArchOf = () => node.properties?.rg_model_arch || null;   // the model of the last run (kept in the workflow)
            function onEditModeChanged() {
                hideMsg();
                const lastArch = lastArchOf();
                const cur = state.sceneLoras || [];
                if (isEdit()) {
                    const all = editLoras();
                    const want = lastArch && all.some(([m]) => m === lastArch) ? all.filter(([m]) => m === lastArch) : lastArch ? [] : all;
                    const add = want.filter(([m, lora]) => !cur.some((x) => x.edit === m && x.lora === lora));
                    if (add.length) {
                        change(() => {
                            state.sceneLoras = [...(state.sceneLoras || []), ...add.map(([m, lora]) => ({ lora, strength: 1, on: true, edit: m }))];
                            expanded.add(SCENE);
                        });
                    }
                    if (!all.length) hint("Edit Mode: no edit LoRA is set in Settings > Region Genie > Edit Mode");
                    else if (!want.length) hint(`Edit Mode: no edit LoRA is set for ${lastArch} in Settings > Region Genie > Edit Mode`);
                } else if (cur.some((x) => x.edit)) {
                    change(() => {
                        state.sceneLoras = cur.filter((x) => !x.edit);
                        if (!state.sceneLoras.length) delete state.sceneLoras;
                    });
                }
                syncSettings(); onDimsChanged(); refreshUI();
            }
            function setWidget(w, v) {
                if (!w || w.value === v) return;
                w.value = v;
                try { w.callback?.(v); } catch (e) { /* ignore */ }
            }
            function applyLayout(st, scene, sig, size, sceneNeg, madeFor, sceneBg) {
                hideBanner();
                change(() => {
                    state = parseState(JSON.stringify(st), ...(madeFor || dims()));     // madeFor: size of an older file
                    if (sig) state.importSig = sig; else delete state.importSig;
                    selId = null; filter = ALL; clickPoly = null;
                    curRegion = state.regions[0]?.id ?? null;
                });
                if (scene != null) setWidget(sceneW, String(scene));
                if (sceneNeg != null) setWidget(sceneNegW, String(sceneNeg));
                if (sceneBg != null) setWidget(sceneBgW, String(sceneBg));
                if (size && !sizeLinked()) setManualSize(Math.round(size[0]), Math.round(size[1]));
                userView = false; onDimsChanged(); fitView(); requestDraw();
            }
            function exportLayout() {
                const [W, H] = dims();
                const out = { format: LAYOUT_FORMAT, version: 2, width: W, height: H,
                              scene_prompt_positive: sceneW?.value ?? "", scene_prompt_negative: sceneNegW?.value ?? "",
                              scene_prompt_background: sceneBgW?.value ?? "",
                              regions: state.regions, layers: state.layers,
                              ...(state.sceneLoras?.length ? { sceneLoras: state.sceneLoras } : {}),
                              ...(state.loraOpts ? { loraOpts: state.loraOpts } : {}),
                              ...(state.editMask ? { editMask: state.editMask } : {}) };
                const blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                const base = String(node.title || "layout").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "layout";
                a.download = `${base}.json`;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            }
            async function importLayoutText(text, fromFile) {
                let d = null;
                try { d = JSON.parse(text); if (typeof d === "string") d = JSON.parse(d); } catch (e) { throw new Error("not valid JSON"); }
                if (d && Array.isArray(d.layers) && Array.isArray(d.regions)) {
                    const size = Number(d.width) > 0 && Number(d.height) > 0 ? [Math.round(d.width), Math.round(d.height)] : null;
                    applyLayout(d, d.scene_prompt_positive ?? d.scene_prompt ?? null, null, fromFile ? size : null,
                                d.scene_prompt_negative ?? null, size, d.scene_prompt_background ?? null);
                    return;
                }
                const [W, H] = dims();          // other formats: converted by the Python side (same code as import_json)
                const r = await api.fetchApi("/region_genie/convert_layout", {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ json: text, width: W, height: H }),
                });
                let res = null; try { res = await r.json(); } catch (e) { /* ignore */ }
                if (!r.ok || !res?.state) throw new Error(res?.error || `server returned ${r.status} (restart ComfyUI after updating the pack)`);
                applyLayout(res.state, res.scene_prompt, null, null, res.scene_prompt_negative, null, res.scene_prompt_background);
            }

            // ---------------- lifecycle ----------------
            function load() {
                const [W, H] = dims();
                const wasV1 = (() => { try { const d = JSON.parse(dataW?.value || ""); return d && !Array.isArray(d.layers) && Array.isArray(d.ops); } catch (e) { return false; } })();
                state = parseState(dataW?.value, W, H);
                version++;                                       // new state: drop cached label boxes / indices
                if (wasV1) save();
                undoStack = []; redoStack = [];
                selId = null; filter = ALL; clickPoly = null;
                curRegion = state.regions[0]?.id ?? null;
                lastDims = [0, 0]; userView = false;
                syncSettings();
                onDimsChanged(); refreshUI();
            }
            chain(node, "onExecuted", function (message) {
                if (message?.dims) { execDims = message.dims; execGuess = guessInputDims(); onDimsChanged(); }
                if (Array.isArray(message?.prompt_format)) { lastFormat = String(message.prompt_format[0] || "") || null; showLastFormat(); }
                if (Array.isArray(message?.model_arch) && message.model_arch[0]) {
                    node.properties = node.properties || {};
                    node.properties.rg_model_arch = String(message.model_arch[0]);
                }
                if (Array.isArray(message?.auto_apart) && !!message.auto_apart[0] !== autoApart) {
                    autoApart = !!message.auto_apart[0];
                    renderRegions();
                }
                let imp = null;
                try { imp = JSON.parse(message?.layout_import?.[0] || "null"); } catch (e) { /* ignore */ }
                if (imp?.action === "applied") applyLayout(imp.state, imp.scene_prompt, imp.sig, null, imp.scene_prompt_negative, null, imp.scene_prompt_background);
                let llmMsg = null;
                try { llmMsg = JSON.parse(message?.llm?.[0] || "null"); } catch (e) { /* ignore */ }
                if (llmMsg) storeLlmResults(llmMsg);
                if (Array.isArray(message?.wildcards)) {
                    let f = {};
                    try { f = JSON.parse(message.wildcards[0] || "{}") || {}; } catch (e) { /* ignore */ }
                    wcSetFilled(f, false);
                }
                else if (imp?.action === "pending") {
                    pendingImport = imp;
                    bannerText.textContent = `import_json has a new layout (${imp.state?.regions?.length ?? 0} regions). This run used the canvas.`;
                    banner.style.display = "";
                }
                const imgs = message?.backdrop;
                if (Array.isArray(imgs) && imgs[0]?.filename) {
                    const b = imgs[0], t = Date.now();
                    loadBackdrop(api.apiURL(`/view?filename=${encodeURIComponent(b.filename)}&type=${b.type}&subfolder=${encodeURIComponent(b.subfolder || "")}&t=${t}`), "run:" + b.filename + t,
                    { filename: b.filename, subfolder: b.subfolder || "", type: b.type || "temp" });
                }
                let detected = [];
                try { detected = JSON.parse(message?.detected?.[0] || "[]"); } catch (e) { /* ignore */ }
                detectedSet = new Set(detected.map((c) => String(c).toUpperCase()));
                const known = new Set(state.regions.map((r) => r.color.toUpperCase()));
                const fresh = detected.map((c) => String(c).toUpperCase()).filter((c) => !known.has(c));
                if (fresh.length) {
                    change(() => {
                        for (const c of fresh) {
                            const id = state.regions.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
                            state.regions.push({ id, color: c, prompt: "", type: "object", text: "", fromImage: true });
                        }
                    });
                }
                onDimsChanged();
            });
            chain(node, "onConfigure", function () { remapOutputs(node, nodeData.output_name, nodeData.output); configured = true;
                moveSizeLinks(); setTimeout(() => { sizeCfg(); syncSizeRow(true); onDimsChanged(); }, 0); fixImportMode(); load(); pushLlmCache(); syncLlm(); updateLlmButtons(); });
            for (const w of [wW, hW]) if (w) chain(w, "callback", () => onDimsChanged());
            if (modeW) chain(modeW, "callback", () => requestDraw());

            const ro = new ResizeObserver(() => requestDraw());
            ro.observe(cvBox);
            sizeReady = true; syncSizeRow();
            const poll = setInterval(() => {
                if (!node.graph) return;
                fixImportMode();
                syncSettings();
                labelSizeInputs();
                onDimsChanged();
                liveBackdrop();
                syncLlm();
                updateLlmButtons();
            }, 500);
            chain(node, "onRemoved", function () {
                clearInterval(poll); ro.disconnect(); offLlmLib(); closeLlmSettings(); lassoRefreshers.delete(refreshVariantButtons); closeArrange(); if (pick) pickCancel();
                for (const t of PAN_EVENTS) window.removeEventListener(t, midPan, true);
                window.removeEventListener("pointerdown", hideSelOutside, true);
                window.removeEventListener("mousedown", noAutoScroll, true);
            });

            // test hooks
            node.__rgRender = (w, h) => {
                const c = document.createElement("canvas"); c.width = w; c.height = h;
                const x = c.getContext("2d"), s2 = document.createElement("canvas"); s2.width = w; s2.height = h;
                const saved = view; const [W] = dims();
                view = { z: w / W, x: 0, y: 0 };
                x.fillStyle = "#000"; x.fillRect(0, 0, w, h);
                const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h;
                renderComposite(tmp.getContext("2d"), w, h, s2, s2.getContext("2d"));
                x.drawImage(tmp, 0, 0);
                view = saved;
                return c.toDataURL();
            };
            node.__rgState = () => state;
            node.__rgRefresh = () => { version++; save(); refreshUI(); };
            node.__rgActive = () => curRegion;
            node.__rgSetBackdrop = (img, ref) => { backdrop = img; backdropKey = "test:" + Math.random(); backdropRef = ref || null; requestDraw(); };
            // regions in output order (what Mask Picker / Regional LoRAs index into)
            node.__rgOutputRegions = () => {
                const map = outputIndexMap(), out = [];
                state.regions.forEach((r, k) => { if (map[k] != null) out[map[k]] = { color: colorOf(r.id), prompt: r.prompt, type: r.type, text: r.text, palette: activePalette(r) }; });
                return out;
            };
            node.__rgLabels = () => labelRects.map((r) => ({ ...r, active: r.rid === curRegion }));
            node.__rgRegionToClient = (px, py) => { const b = cv.getBoundingClientRect(); return [b.left + px * b.width / cv.width, b.top + py * b.height / cv.height]; };
            const toClient = (sx, sy) => { const r = cv.getBoundingClientRect(); return [r.left + sx * r.width / cv.width, r.top + sy * r.height / cv.height]; };
            node.__rgToClient = (ix, iy) => toClient(...toScr(ix, iy));
            node.__rgHandles = () => { const L = selLayer(); return L ? handles(L).map((h) => ({ kind: h.kind, at: toClient(h.x, h.y) })) : []; };
            node.__rgBox = () => { const L = selLayer(); return L ? boxCornersImg(L) : null; };
            node.__rgView = () => ({ ...view, cw: cv.width, ch: cv.height });

            setTool("select");
            load();
            // wide enough for the whole toolbar in one row (Select ... labels eye) and a usable region list;
            // a new node gets a square canvas (legacy mode: measured once laid out, since fonts differ per system)
            if (!node.size || node.size[0] < DEFAULT_W) {
                node.setSize?.([DEFAULT_W, Math.max(node.size?.[1] || 0, DEFAULT_H)]);
                let tries = 0;
                const square = () => {
                    if (configured || !node.graph && tries > 2) return;
                    const b = cvBox.getBoundingClientRect();
                    if (cvBox.closest("[data-node-id]")) return;                       // Nodes 2.0 lays out by itself
                    if (!b.width || !b.height) { if (++tries < 30) requestAnimationFrame(square); return; }
                    const k = app.canvas?.ds?.scale || 1;
                    const d = (b.width - b.height) / k;
                    if (Math.abs(d) > 1 && tries < 30) {
                        node.setSize([node.size[0], Math.round(node.size[1] + d)]); node.setDirtyCanvas?.(true, true);
                        tries++; requestAnimationFrame(() => requestAnimationFrame(square));
                    }
                };
                setTimeout(square, 0);
                // Settings > Region Genie: defaults for a node that was just added (not loaded or pasted)
                setTimeout(() => {
                    if (configured) return;
                    node.properties = node.properties || {};
                    node.properties.rg_size = sizeDefaults();
                    applySize();
                    setWidget(modeW, getSetting(SET.cmImageMode, "backdrop (trace over)"));
                    const f = Math.max(0, Math.round(+getSetting(SET.cmFeather, 0)) || 0);
                    const sp = +getSetting(SET.cmSeparation, 0.85), un = +getSetting(SET.cmUntil, 0.25);
                    if (f) state.feather = f;
                    const allApart = !!getSetting(SET.cmAllRegions, false), shareBg = !!getSetting(SET.cmShareBg, false);
                    if (sp !== 0.85 || un !== 0.25 || allApart || shareBg) {
                        state.loraOpts = normLoraOpts({ separation: sp, until: un, allRegions: allApart, shareBg });
                    }
                    save(); syncSettings(); onDimsChanged(); refreshUI();
                }, 0);
            }
        });
    },
});
