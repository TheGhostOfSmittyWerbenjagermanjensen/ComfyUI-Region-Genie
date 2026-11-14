import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { svgIcon, setHTML, escReverts, popFootText, naturalHeight, nodeOffCanvas, popNavDir, popNavTip, knownLoras, pickLora, contextMenu, appendWord, fillTriggerChips, CHIP_CSS, keepWidgetValuesByName,
         autocompleteOnFocus, autocompleteOpen, autocompleteWidgets, inAutocompleteList, autocompleteToggle,
         getSetting, setSetting, SET, migrateProps, autoApartSettings, editSettings, editLoras, editMaskDefaults, toolDefault,
         onToolDefault, toolNumber, TOOL_NUMBERS, llmCacheSettings, SIZE_ASPECTS, ratioSize, parseSizePresets, formatSizePresets,
         ratioLabel, SIZE_PRESETS_DEFAULT, wildcardSeedControl, pickWildcard, insertAtCursor, hasWildcards, WC_CSS,
         wildcardsInstalled, onWildcardInfo, CONTROL_FILES, controlFiles, OLD_MOSS, MOSS, CONTROL_DOWNLOADS, CONTROL_KIND_HELP, controlFolder,
         controlLabel, knownModels, NO_LORA, controlFolders, modelFilePicker, isFullPath, EDIT_MODELS } from "./rg_shared.js";
import { loadLibrary, library, onLibraryChange, resolveNodeLlm, presetForType, sparkleSvg, openLlmSettings, inLlmSettings,
         closeLlmSettings } from "./rg_llm.js";
import { openColorPicker, inColorPicker } from "./rg_colorpicker.js";

// values this pack just wrote to Settings, read back before the Settings store has them (it saves asynchronously)
const RG_RECENT = new Map();
const recentSetting = (id, dflt) => (RG_RECENT.has(id) ? RG_RECENT.get(id) : getSetting(id, dflt));
const rememberSetting = (id, v) => { RG_RECENT.set(id, v); setSetting(id, v); setTimeout(() => { if (RG_RECENT.get(id) === v) RG_RECENT.delete(id); }, 3000); };

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
.rg-btn.icon.grp { display:inline-flex; align-items:center; padding:2px 0 2px 4px; }
.rg-btn.icon .rg-grp-ic { line-height:0; }
.rg-btn.icon .rg-grp-dd { line-height:0; margin-left:1px; padding:0 1px; opacity:.6; border-radius:2px; }
.rg-btn.icon .rg-grp-dd:hover { opacity:1; background:rgba(255,255,255,.12); }
.rg-btn.icon .rg-grp-dd svg { width:8px; height:16px; }
.rg-toolopts { position:absolute; left:6px; top:6px; z-index:4; display:flex; align-items:center; gap:3px; padding:3px 4px;
  background:rgba(20,20,20,.85); border:1px solid var(--border-color,#555); border-radius:5px; box-shadow:0 2px 8px rgba(0,0,0,.5); }
.rg-toolopts .rg-optlab { line-height:0; opacity:.75; margin-left:2px; }
.rg-toolopts .rg-optlab svg { width:14px; height:14px; display:block; }
.rg-toolopts .rg-num { width:46px; }
/* folded to its first icon (a rounded square) until hovered, typed in, clicked (pinned) or a selection waits for ✓ / ✕ */
.rg-toolopts:not(:hover):not(:focus-within):not(.pinned):not(.busy) > :not(.lead) { display:none !important; }
.rg-toolopts:not(:hover):not(:focus-within):not(.pinned):not(.busy) { padding:4px; }
.rg-toolopts:not(:hover):not(:focus-within):not(.pinned):not(.busy) .rg-optlab.lead { margin:0; opacity:.9; }
.rg-toolopts .rg-optlab.lead { cursor:pointer; }
.rg-toolopts.pinned .rg-optlab.lead { color:#7fb0ea; opacity:1; }
.rg-btn.variants { position:relative; }
.rg-btn.variants::after { content:""; position:absolute; right:1px; bottom:1px; width:0; height:0;
  border-style:solid; border-width:0 0 5px 5px; border-color:transparent transparent currentColor transparent; opacity:.7; }
.rg-btn.toggle:not(.on) { opacity:.55; }
.rg-sep { width:1px; align-self:stretch; background:var(--border-color,#555); margin:2px 3px; }
.rg-foot { display:flex; align-items:center; gap:4px; flex:0 0 auto; }
/* one row at any width (round 21): the dropdowns narrow (their text cut short) before anything wraps; system fonts
   that run wider (Windows, high DPR) used to push it onto a second row */
.rg-settings { display:flex; align-items:center; gap:8px; flex:0 1 auto; min-width:0; flex-wrap:nowrap; }
.rg-settings > * { flex:0 0 auto; }
.rg-settings label { display:flex; align-items:center; gap:3px; white-space:nowrap; flex:0 1 auto; min-width:0; }
.rg-settings .rg-sel { max-width:96px; min-width:44px; flex:0 1 auto; text-overflow:ellipsis; }
/* the model dropdown and MOSS-Image's layout / standard button: centred on one line (inline, they sat on the text
   baseline, the dropdown about 3 px lower than the button) */
.rg-settings .rg-modelbox { display:inline-flex; align-items:center; gap:4px; flex:0 1 auto; min-width:0; }
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
.rg-row .rg-pwrap.rg-twrap { flex:0 1 72px; }
.rg-row .rg-pwrap.rg-twrap:has(textarea:focus) { flex:1.2 1 140px; }
.rg-pop { position:fixed; z-index:10000; box-sizing:border-box; display:flex; flex-direction:column; gap:5px; padding:6px 8px 5px;
  background:#1a1a1a; color:#eee; border:2px solid #5b8fd0; border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,.65);
  overflow-y:auto; scrollbar-width:thin; font:12px sans-serif; }
.rg-pop-head { display:flex; align-items:center; gap:6px; font-weight:600; cursor:move; user-select:none; touch-action:none; }
.rg-pop-head .rg-btn { cursor:pointer; }
.rg-pop-head .rg-pop-font { padding:0 4px; line-height:16px; font-weight:normal; font-size:11px; }
.rg-pop-head .rg-pop-font ~ .rg-x { margin-left:0; }
.rg-pop.sized .rg-pop-field.grow { flex:1 1 auto; display:flex; flex-direction:column; min-height:60px; }
.rg-pop.sized .rg-pop-field.grow textarea { flex:1 1 auto; min-height:40px; resize:none; }
.rg-pop-grip { position:absolute; right:1px; bottom:1px; width:14px; height:14px; cursor:nwse-resize; touch-action:none; opacity:.7;
  background:linear-gradient(135deg, transparent 52%, #5b8fd0 52% 60%, transparent 60% 70%, #5b8fd0 70% 78%, transparent 78%); }
.rg-pop-grip:hover { opacity:1; }
.rg-pop-head .rg-idx { flex:0 0 auto; text-align:left; }
.rg-pop-head .rg-sw { cursor:default; }
.rg-pop-head .rg-x { margin-left:auto; padding:0 5px; line-height:16px; }
.rg-pop-head .rg-nav { padding:0 4px; line-height:16px; font-weight:normal; font-size:11px; }
/* ◀ ▶ A− A+ … ✕ stay at the right end, whatever the title's length (they don't move while stepping) */
.rg-pop-head .rg-nav.prev { margin-left:auto; }
.rg-pop-types { display:flex; gap:4px; }
.rg-pop-types .rg-btn { flex:1 1 0; padding:3px 6px; }
.rg-pop-lbl { font-size:11px; opacity:.75; margin:0 0 2px 1px; }
.rg-pop textarea { width:100%; box-sizing:border-box; resize:none; background:var(--comfy-input-bg,#222); color:inherit;
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
.rg-oslider { position:absolute; right:8px; top:50%; transform:translateY(-50%); width:26px; height:160px; opacity:.45;
  transition:opacity .12s; z-index:3; touch-action:none; cursor:ns-resize; }
.rg-oslider:hover, .rg-oslider.drag { opacity:1; }
.rg-oslider svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.rg-oslider-ic { position:absolute; left:5px; top:-18px; line-height:0; color:#f2f2f2; filter:drop-shadow(0 0 2px #000); pointer-events:none; }
.rg-oslider-ic svg { position:static; width:16px; height:16px; }
.rg-ohandle { left:0; width:24px; }
.rg-bslider svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.rg-bhandle { position:absolute; left:1px; width:28px; height:5px; margin-top:-2.5px; background:#f2f2f2; border:1px solid #111;
  border-radius:2px; box-shadow:0 0 3px rgba(0,0,0,.7); pointer-events:none; }
.rg-btip { position:absolute; left:44px; z-index:4; background:rgba(20,20,20,.95); color:#eee; font:11px sans-serif;
  padding:3px 6px; border-radius:4px; border:1px solid #555; white-space:nowrap; pointer-events:none; display:none; }
.rg-split { flex:0 0 7px; margin:-2px 0; position:relative; cursor:row-resize; touch-action:none; z-index:1; }
.rg-split::after { content:""; position:absolute; left:42%; right:42%; top:2px; height:3px; border-radius:2px; background:var(--border-color,#555); opacity:.8; }
.rg-split:hover::after, .rg-split.drag::after { background:#5b8fd0; opacity:1; left:30%; right:30%; }
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
.rg-row.scene .rg-pseudo, .rg-row.ctrl .rg-pseudo { font-style:normal; font-weight:600; user-select:none; }
.rg-row.scene, .rg-row.ctrl { cursor:pointer; }
.rg-row.scene:hover, .rg-row.ctrl:hover { background:rgba(255,255,255,.06); }
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
.rg-pwrap { position:relative; display:flex; flex:1 1 auto; min-width:0; }
.rg-pwrap > textarea.rg-prompt { padding-right:18px !important; }
.rg-expand { position:absolute; z-index:3; width:16px; height:16px; padding:0; margin:0; border:0; border-radius:3px; background:transparent;
  color:var(--input-text,#ddd); opacity:.3; cursor:pointer; line-height:0; }
.rg-expand svg { width:12px; height:12px; display:block; margin:2px; }
.rg-expand:hover { opacity:1; background:rgba(91,143,208,.35); }
*:hover > .rg-expand { opacity:.75; }
textarea.rg-scene-ta { padding-right:20px !important; }
.rg-row textarea.rg-prompt { flex:1 1 auto; min-width:0; background:var(--comfy-input-bg,#222); color:inherit; resize:none;
  border:1px solid var(--border-color,#555); border-radius:3px; padding:1px 4px; font-family:inherit; font-size:var(--rg-fs-r,12px);
  line-height:var(--rg-lh-r,15px); height:calc(var(--rg-lh-r,15px) + 3px); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.rg-row textarea.rg-prompt.rg-text { font-size:var(--rg-fs-t,12px); line-height:var(--rg-lh-t,15px); height:calc(var(--rg-lh-t,15px) + 3px); }
.rg-row textarea.rg-prompt.rg-text:focus { height:calc(var(--rg-lh-t,15px) * 4 + 4px); }
.rg-row textarea.rg-prompt:focus { height:calc(var(--rg-lh-r,15px) * 4 + 4px); white-space:pre-wrap; overflow-x:hidden; overflow-y:auto; position:relative; z-index:2;
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
.rg-row.ctrl.off .rg-pseudo { opacity:.6; }
.rg-row.ctrl.edit { cursor:default; }
.rg-row.layer.hole .rg-sw { background:repeating-linear-gradient(135deg, #000 0 3px, #8a8a8a 3px 4px); }
.rg-row.layer .ico.on { color:var(--p-primary-color, #4a9eff); border-color:var(--p-primary-color, #4a9eff); }
.rg-row.ctrl.edit:hover { background:none; }
.rg-row .rg-file { width:auto; min-width:0; max-width:none; flex:1 1 auto; gap:4px; }
.rg-row .rg-file select { padding:1px 4px; border-radius:4px; font-size:11px; }
.rg-row .rg-file button { width:22px; height:20px; border-radius:4px; }
.rg-row .rg-file button svg { width:14px; height:14px; }
.rg-row.ctrl .rg-num { width:44px; }
.rg-row.ctrl .rg-sel { min-width:150px; max-width:190px; }
.rg-settings .rg-sel.rg-model { max-width:150px; }
.rg-settings .rg-sel.rg-model.picked { border-color:#c9a14a; }
.rg-subbody.ctrl .rg-ctrl-help { white-space:normal; line-height:14px; opacity:.8; }
.rg-subbody.ctrl .rg-row.lora { padding-left:30px; }
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
                       ...(typeof x.edit === "string" && x.edit ? { edit: x.edit === OLD_MOSS ? MOSS : x.edit } : {}),        // edit: added by Edit Mode, for that model
                       // control: added by the Control row, for that model (ckind: moss / depth / canny)
                       ...(typeof x.control === "string" && x.control ? { control: x.control === OLD_MOSS ? MOSS : x.control, ckind: String(x.ckind || "") } : {}) }));
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
             ...(r.keep ? { keep: true } : {}),                    // Edit Mode: keep this region as it is in the source
             ...(r.hidden ? { hidden: true } : {}),                // the region's eye: not drawn, not output
             ...(r.llm ? { llm: true } : {}),                      // LLM Prompt Enhancer on for this region
             ...(Number.isFinite(+r.llmSalt) && +r.llmSalt ? { llmSalt: Math.round(+r.llmSalt) } : {}),
             ...(r.noControl ? { noControl: true } : {}) };        // Control: switched off for this region
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
            // a hole (region 0) is listed under the region it was made in (round 20)
            ...((l.region ?? UNSPEC) === UNSPEC && l.owner != null ? { owner: l.owner } : {}),
            shape: l.shape || null, sides: l.sides || 5, bw: +l.bw || 1, bh: +l.bh || 1, sx: +l.sx || 1, sy: +l.sy || 1,
            ...(l.shape === "roundrect" ? { radius: Math.max(0, Math.min(50, Number.isFinite(+l.radius) ? +l.radius : 20)) } : {}),
            rot: +l.rot || 0, ...layerCentre(l, W, H), ops: Array.isArray(l.ops) ? l.ops : [],
        })),
        ...(d.importSig ? { importSig: String(d.importSig) } : {}),
        ...(normLoras(d.sceneLoras).length ? { sceneLoras: normLoras(d.sceneLoras) } : {}),
        ...(d.loraOpts ? { loraOpts: normLoraOpts(d.loraOpts) } : {}),
        ...(+d.feather > 0 ? { feather: Math.round(+d.feather) } : {}),
        ...(normEditMask(d.editMask) ? { editMask: normEditMask(d.editMask) } : {}),
        // LLM Prompt Enhancer: the scene prompt's switch / salt and the node's preset assignments
        ...(d.sceneLlm ? { sceneLlm: true } : {}),
        ...(Number.isFinite(+d.sceneLlmSalt) && +d.sceneLlmSalt ? { sceneLlmSalt: Math.round(+d.sceneLlmSalt) } : {}),
        ...(d.llm && typeof d.llm === "object" ? { llm: d.llm } : {}),
        ...(normControl(d.control) ? { control: normControl(d.control) } : {}),
    };
}
// the Control row: on / off, what the map is, strength and the part of the steps (fractions 0..1)
const CONTROL_KINDS = ["color", "color+depth", "depth", "canny", "other"];
function normControl(c) {
    if (!c || typeof c !== "object") return null;
    const n = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
    return { on: !!c.on, kind: CONTROL_KINDS.includes(c.kind) ? c.kind : "depth", strength: n(c.strength, 1, 0, 10),
             start: n(c.start, 0, 0, 1), end: n(c.end, 1, 0, 1) };
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
                        const pick = node.properties?.rg_model_pick;
                        if (pick) d.modelPick = pick;
                        if (node.properties?.rg_moss_layout === false) d.mossLayout = false;
                        if (isEdit()) { d.edit = editSettings(); d.editMask = editMaskNow(); }
                        d.llmCache = llmCacheSettings();
                        d.minPixels = minPixelsNow();
                        d.wcPerField = !!getSetting(SET.wcPerField, false);
                        if (d.control?.on) d.control = { ...d.control, files: controlFiles() };
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
            // the expand button: opens a text field in its pop-up editor (double-click stays the browser's word selection).
            // It sits in the field's bottom-right corner, left of a scrollbar, inside the field's parent element.
            function addExpandButton(t, title, onOpen) {
                const host = t.parentElement;
                if (!host) return null;
                const old = host.querySelector(":scope > .rg-expand");
                if (old && old.__rgFor === t) return old;
                old?.remove();
                if (getComputedStyle(host).position === "static") host.style.position = "relative";
                const b = document.createElement("button");
                b.type = "button"; b.className = "rg-expand"; b.innerHTML = svgIcon("expand"); b.title = title; b.tabIndex = -1;
                b.__rgFor = t;
                for (const ev of ["pointerdown", "mousedown", "dblclick"]) b.addEventListener(ev, (e) => { e.stopPropagation(); if (ev !== "pointerdown") e.preventDefault(); });
                b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onOpen(); });
                const place = () => {
                    if (!t.isConnected) return;
                    const sb = Math.max(0, t.offsetWidth - t.clientWidth - (t.clientLeft || 0) * 2);   // a scrollbar, if any
                    const right = host.clientWidth - (t.offsetLeft + t.offsetWidth) + (t.clientLeft || 0) + sb + 2;
                    const bottom = host.clientHeight - (t.offsetTop + t.offsetHeight) + (t.clientTop || 0) + 2;
                    b.style.right = Math.round(right) + "px"; b.style.bottom = Math.round(bottom) + "px";
                };
                for (const ev of ["mouseenter", "focus", "input", "blur"]) t.addEventListener(ev, () => requestAnimationFrame(place));
                try { new ResizeObserver(place).observe(t); } catch (e) { /* old browser */ }
                host.addEventListener("mouseenter", place);
                host.appendChild(b);
                place();
                return b;
            }
            const SCENE_FIELDS = { scene_prompt_positive: "positive", scene_prompt_negative: "negative",
                                   scene_prompt_background: "background" };
            autocompleteWidgets(node, Object.keys(SCENE_FIELDS), (name, t) => {
                if (!SCENE_FIELDS[name]) return;
                sceneTA[SCENE_FIELDS[name]] = t;
                t.classList.add("rg-scene-ta");
                addExpandButton(t, "Open in the pop-up editor", () => editScene(SCENE_FIELDS[name]));
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
            addTool("select", "Select: Move, resize and rotate layers (V). Shift keeps proportions / snaps angles to 15°.");
            // ---- tools with versions: one button each, showing the active version's icon, with ▾ on its right (and
            // right-click) for the list. Shape: the shapes; Lasso / Fill: their versions; Magic wand: the wand's two versions
            // and Select object; Eraser: the eraser and the three lasso erase versions. Keyboard shortcuts pick an entry too.
            const numIn = (min, max, value, title) => {
                const i = el("input", "rg-num"); i.type = "number"; i.min = String(min); i.max = String(max); i.step = "1";
                i.value = String(value); i.title = title; i.style.display = "none";
                i.addEventListener("keydown", (e) => e.stopPropagation());
                return i;
            };
            const grpCur = { wand: "wand", erase: "erase" };          // the tool each mixed group shows (session)
            const LASSO_TIP = "Drag freehand, or click points and close the loop (click the first point, double-click or Enter). ";
            const SHAPE_KEYS = { rect: "R", ellipse: "O", triangle: "T" };
            const OBJECT_TIP = "Select object (Q): SAM 3.1 finds the object you click in the image under the canvas. Click to add "
                + "a point on the object, Ctrl+click a point that isn't part of it, drag a box around it; Backspace undoes the "
                + "last point, Enter adds the selection to the active region, Esc cancels. Or type what to find in the field "
                + "on the canvas. Needs the SAM 3.1 model (Settings > Region Genie > Select object).";
            // entries: [id, icon, title, pick()]; cur(): the id shown
            const GROUPS = {
                shape: { name: "Shape", tools: ["shape"], cur: () => shapeKind,
                    entries: () => SHAPES.map(([k, label]) => [k, "shape" + k[0].toUpperCase() + k.slice(1),
                        `Shape (${label}): Drag a box to draw it; Shift for equal sides, Alt to draw from the centre`
                            + (SHAPE_KEYS[k] ? ` (${SHAPE_KEYS[k]})` : "") + ".",
                        () => { shapeKind = k; setTool("shape"); }]) },
                lasso: { name: "Lasso", tools: ["lasso"], cur: () => LASSO_MODES.lasso,
                    entries: () => [["plain", "lasso", "Lasso: Straight lines between the points."], ["spline", "lassoSpline", "Lasso (spline): A smooth curve through the points."],
                        ["magnetic", "lassoMagnetic", "Lasso (magnetic): The outline follows edges in the image under the canvas."]]
                        .map(([m, icon, t]) => [m, icon, `${t} ${LASSO_TIP}Filled with the active region (L).`, () => { setLassoMode("lasso", m); setTool("lasso"); }]) },
                fill: { name: "Fill", tools: ["fill"], cur: () => LASSO_MODES.fill,
                    entries: () => [["normal", "fill", "Fill: Fills the clicked area (blank space, or one color) with the active region (F)."],
                        ["gaps", "fillGaps", "Fill (closing small gaps): Fills the clicked area, but doesn't leak through small openings (the gap size is the field on the canvas) (F)."]]
                        .map(([m, icon, t]) => [m, icon, t, () => { LASSO_MODES.fill = m; setTool("fill"); }]) },
                wand: { name: "Magic wand / Select object", tools: ["wand", "object"], cur: () => (grpCur.wand === "object" ? "object" : LASSO_MODES.wand),
                    entries: () => [
                        ["contiguous", "wand", "Magic wand: Selects the connected area of similar color around the click, in the image under the canvas; each click adds it to the active region (W).\nTolerance: The field on the canvas.",
                            () => { LASSO_MODES.wand = "contiguous"; setTool("wand"); }],
                        ["global", "wandGlobal", "Magic wand (all similar colors): Selects every pixel of similar color in the image under the canvas (W).\nTolerance: The field on the canvas.",
                            () => { LASSO_MODES.wand = "global"; setTool("wand"); }],
                        ["object", "samSelect", OBJECT_TIP, () => setTool("object")]] },
                erase: { name: "Eraser / Lasso erase", tools: ["erase", "lassoErase"], cur: () => (grpCur.erase === "erase" ? "erase" : "lasso:" + LASSO_MODES.lassoErase),
                    entries: () => [
                        ["erase", "erase", "Eraser: Erase from the selected layer (E). Shift+click draws a straight line from where the last stroke ended.", () => setTool("erase")],
                        ...[["plain", "lassoErase", "Lasso erase: Straight lines between the points."], ["spline", "lassoEraseSpline", "Lasso erase (spline): A smooth curve through the points."],
                            ["magnetic", "lassoEraseMagnetic", "Lasso erase (magnetic): The outline follows edges in the image under the canvas."]]
                            .map(([m, icon, t]) => ["lasso:" + m, icon, `${t} ${LASSO_TIP}Erases from the selected layer (Shift+L).`, () => { setLassoMode("lassoErase", m); setTool("lassoErase"); }])] },
            };
            function setLassoMode(key, m) {
                LASSO_MODES[key] = m;
                if (clickPoly && tool === key) { clickPoly.spline = m === "spline"; clickPoly.magnetic = m === "magnetic"; }
            }
            const grpBtns = {};
            function groupMenu(key, e) {
                const g = GROUPS[key], cur = g.cur();
                const items = g.entries().map(([id, , title, pickIt]) => ({ content: (id === cur ? "✓ " : "   ") + title.split(":")[0], pickIt }));
                contextMenu(e, items, g.name, (v) => { v?.pickIt?.(); focusSink(); });
            }
            for (const key of Object.keys(GROUPS)) {
                const b = el("button", "rg-btn icon grp"); b.type = "button"; b.dataset.group = key;
                const ic = el("span", "rg-grp-ic"), dd = el("span", "rg-grp-dd");
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
            const optStrip = el("div", "rg-toolopts"); optStrip.style.display = "none";
            for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "contextmenu"]) optStrip.addEventListener(ev, (e) => e.stopPropagation());
            const optLab = (icon, forEl) => { const l = el("span", "rg-optlab"); l.innerHTML = svgIcon(icon); l.title = forEl.title; l.__for = forEl; return l; };
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
            // the shape fields: drawing that shape, or with the selection tool on a layer of that shape
            const syncShapeOpts = () => {
                const L = tool === "select" ? state.layers.find((l) => l.id === selId) || null : null;
                sidesIn.style.display = (tool === "shape" && shapeKind === "star") || L?.shape === "star" ? "" : "none";
                radiusIn.style.display = (tool === "shape" && shapeKind === "roundrect") || L?.shape === "roundrect" ? "" : "none";
            };
            initLassoModes();
            // fill, closing small gaps: the gap size (px)
            const gapIn = numIn(1, 64, TOOL_NUMS.fillGap, "Fill, closing small gaps: Openings narrower than about twice this many "
                + "pixels are closed, so the fill doesn't leak through them (default in Settings > Region Genie > Canvas tools)");
            gapIn.addEventListener("change", () => { TOOL_NUMS.fillGap = Math.max(1, Math.min(64, parseInt(gapIn.value) || 4)); gapIn.value = String(TOOL_NUMS.fillGap); });
            const tolIn = numIn(0, 255, TOOL_NUMS.wandTol, "Magic wand tolerance: How different a color may be from the clicked one "
                + "(0-255 per channel) and still be selected (default in Settings > Region Genie > Canvas tools)");
            tolIn.addEventListener("change", () => { TOOL_NUMS.wandTol = Math.max(0, Math.min(255, parseInt(tolIn.value) || 0)); tolIn.value = String(TOOL_NUMS.wandTol); });
            const findIn = el("input", "rg-find");
            findIn.type = "text"; findIn.placeholder = "find all…"; findIn.style.display = "none";
            findIn.title = "Find all: Type what to select and press Enter, e.g. 'person' or 'red car, dog' (commas separate several "
                + "things). Every match is selected; Ctrl+click one to leave it out (click again to bring it back). Drag a box "
                + "first to search only inside it. Enter adds them all to the active region, Shift+Enter makes each one its "
                + "own region with the text as its prompt.";
            findIn.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); if (findIn.value.trim()) pickFind(findIn.value.trim()); else if (pick?.masks?.length) pickAccept(e.shiftKey); }
                else if (e.key === "Escape") { e.preventDefault(); if (pick) pickCancel(); focusSink(); }
            });
            // the pending selection: add it (Enter) / discard it (Esc); shown while there is one
            const pickOkBtn = iconBtn("check", "Add the selection to the active region (Enter). Switching to another tool adds it too.", () => { if (pick) pickAccept(false); focusSink(); });
            const pickNoBtn = iconBtn("close", "Discard the selection (Esc)", () => { if (pick) pickCancel(); focusSink(); });
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
                const show = tool === "object" && !!pick ? "" : "none";
                if (pickOkBtn.style.display !== show) { pickOkBtn.style.display = pickNoBtn.style.display = show; syncStrip(); }
                const ok = !!pick && !pickBusy && pick.masks.some((m) => !m.off);
                if (pickOkBtn.disabled === ok) pickOkBtn.disabled = !ok;
            }
            function syncToolOpts() {
                tolIn.style.display = tool === "wand" ? "" : "none";
                findIn.style.display = tool === "object" ? "" : "none";
                gapIn.style.display = tool === "fill" && LASSO_MODES.fill === "gaps" ? "" : "none";
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
            const arrangeBtn = iconBtn("arrange", "Arrange the selected layer: Flip, align to the image, grow or shrink", () => toggleArrange());
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
                setHTML(snapBtn, svgIcon(snap ? "magnet" : "magnetOff"));
                snapBtn.classList.toggle("on", snap);
                snapBtn.title = snap ? "Snap to grid on: Points, shapes and moves snap to the grid (click or G to turn off)"
                    : "Snap to grid off: Click (or G) to snap points, shapes and moves to the grid";
            }
            setSnapIcon();
            const gridIn = el("input", "rg-num");
            gridIn.type = "number"; gridIn.min = "2"; gridIn.max = "4096"; gridIn.value = String(grid);
            gridIn.title = "Grid size in image pixels";
            gridIn.addEventListener("change", () => { grid = Math.max(2, parseInt(gridIn.value) || 64); requestDraw(); });
            const undoBtn = iconBtn("undo", "Undo (Ctrl+Z)", undo);
            const redoBtn = iconBtn("redo", "Redo (Ctrl+Shift+Z / Ctrl+Y)", redo);
            const fitBtn = btn("Fit", "Fit the image in view (Home). Wheel zooms, middle-drag or Space+drag pans.", () => { userView = false; fitView(); requestDraw(); });
            const clearBtn = iconBtn("clear", "Clear all: Remove every layer and region (undoable)", () => {
                if (state.layers.length || state.regions.length || state.importSig) change(() => { state.layers = []; state.regions = []; delete state.importSig; selId = null; curRegion = null; filter = ALL; });
            });
            // image opacity: a vertical slider over the canvas's right edge while an image is shown under the regions
            const bdBox = el("div", "rg-oslider"); bdBox.style.display = "none";
            bdBox.innerHTML = '<svg viewBox="0 0 26 160" preserveAspectRatio="none"><rect x="11" y="14" width="4" height="132" rx="2" '
                + 'fill="rgba(240,240,240,.45)" stroke="#111" stroke-width="1"/></svg>';
            const bdIcon = el("span", "rg-oslider-ic"); bdIcon.innerHTML = svgIcon("opacity");
            const bdHandle = el("div", "rg-bhandle rg-ohandle");
            bdBox.append(bdIcon, bdHandle);
            const O_TOP = 14 / 160, O_BOT = 146 / 160;
            function syncOpacity() {
                bdHandle.style.top = `${(O_BOT - backdropOpacity * (O_BOT - O_TOP)) * 100}%`;
                bdBox.title = `Image opacity: ${Math.round(backdropOpacity * 100)}% — how strongly the image on the 'image' input shows `
                    + "under the regions (drag, or the mouse wheel)";
            }
            const opacityFromY = (y) => {
                const r = bdBox.getBoundingClientRect(), f = (y - r.top) / Math.max(1, r.height);
                backdropOpacity = Math.round(Math.min(1, Math.max(0, (O_BOT - f) / (O_BOT - O_TOP))) * 20) / 20;
                syncOpacity(); requestDraw();
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
                backdropOpacity = Math.round(Math.min(1, Math.max(0, backdropOpacity + (e.deltaY < 0 ? 0.05 : -0.05))) * 20) / 20;
                syncOpacity(); requestDraw();
            }, { passive: false });
            syncOpacity();
            node.properties = node.properties || {};
            if (node.properties.rg_labels === undefined) node.properties.rg_labels = true;
            const labBtn = iconBtn("eye", "", () => {
                node.properties.rg_labels = node.properties.rg_labels === false;
                setLabIcon(); requestDraw();
            }, "toggle");
            function setLabIcon() {
                const on = node.properties.rg_labels !== false;
                setHTML(labBtn, svgIcon(on ? "eye" : "eyeOff"));
                labBtn.classList.toggle("on", on);
                labBtn.title = on ? "Labels on: Each region's number and prompt are shown on the canvas (click to hide)"
                    : "Labels off: Click to show each region's number and prompt on the canvas";
            }
            setLabIcon();
            const dimsLbl = el("span", "rg-hint"); dimsLbl.style.marginLeft = "auto";
            dimsLbl.title = "The canvas size in pixels (the image size this node makes; set in the size row above)";
            bar1.append(sep(), undoBtn, redoBtn, clearBtn, sep(), snapBtn, gridIn, fitBtn, labBtn, dimsLbl);
            // ---- layout files (bottom right of the node)
            const exportBtn = btn("Export", "Save this layout (regions, LoRAs, layers, scene prompt, size) as a .json file. "
                + "Load it again with Import, or through the import_json input.", exportLayout);
            const importBtn = btn("Import", "Load a layout file: One saved with Export, or MOSS-Image layout JSON, "
                + "Ideogram caption JSON / elements, or bboxes (boxes become rectangles). Undoable.", () => fileIn.click());
            const fileIn = el("input"); fileIn.type = "file"; fileIn.accept = ".json,.txt,application/json,text/plain"; fileIn.style.display = "none";
            fileIn.addEventListener("change", async () => {
                const f = fileIn.files?.[0]; fileIn.value = "";
                if (f) { try { await importLayoutText(await f.text(), true); } catch (e) { notify(`Import failed: ${e.message || e}`, true); } }
            });
            // footer (bottom left): mode, edit_area (Edit Mode), model, LLM Settings, tag autocomplete, wildcard seed
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
                ["backdrop (trace over)", svgIcon("imgBackdrop"), "Image as a backdrop: The connected image is shown under the canvas to trace over "
                    + "(image_mode; the default for new nodes is in Settings > Region Genie)."],
                ["use as color map", svgIcon("imgColorMap"), "Image as a color map: The connected image's colors become the regions; painting "
                    + "goes on top.\nThe field next to it sets the min region pixels (image_mode)."],
            ], (v) => { setWidget(modeW, v); syncSettings(); requestDraw(); });
            const minIn = el("input", "rg-num"); minIn.type = "number"; minIn.min = "1"; minIn.max = "1000000"; minIn.step = "1";
            minIn.title = "Min region pixels (color map). A color becomes a region when it has at least this many flat pixels; "
                + "blended edges and specks go to the nearest region. It is one setting for every node "
                + "(Settings > Region Genie > Region Genie node).";
            minIn.addEventListener("keydown", (e) => e.stopPropagation());
            minIn.addEventListener("change", () => {
                const v = Math.max(1, Math.min(1000000, Math.round(+minIn.value || 64)));
                minIn.value = String(v); setSetting(SET.cmMinPixels, v); setWidget(minW, v);
            });
            const imgBox = el("span", "rg-bar"); imgBox.style.display = "none";
            imgBox.append(imgSeg.box, minIn);
            bar1.insertBefore(imgBox, dimsLbl);
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
            const areaCtl = setSel(areaW, "", [["only the regions", "regions only"], ["whole image", "whole image"]],
                "edit_area (Edit Mode): What the sampler may change.\nOnly the regions: The 'latent' output carries a mask of "
                + "all regions, so the rest of the image is kept (like inpainting).\nWhole image: No mask; the regions still "
                + "steer where each prompt goes.");
            // the model dropdown (and MOSS-Image's layout / standard switch) go here; they also set the prompt format
            // (the old 'format' select is gone: the hidden prompt_format widget stays "auto", see migrateFormat)
            const modelBox = el("span", "rg-modelbox");
            let lastFormat = null;                 // the format the last run used (in the model dropdown's tooltip)
            // scene_prompt_background is Ideogram 4's alone (its caption JSON requires one): shown only while the model is
            // Ideogram 4 (picked or found); its text is kept while hidden
            const bgSize = sceneBgW ? Object.getOwnPropertyDescriptor(sceneBgW, "computeSize") : null;
            function syncBackground() {
                if (!sceneBgW) return;
                const show = modelArch() === "Ideogram 4";
                if (sceneBgW.__rgShown === show) return;
                sceneBgW.__rgShown = show;
                sceneBgW.hidden = !show;
                if (show) { if (bgSize) Object.defineProperty(sceneBgW, "computeSize", bgSize); else delete sceneBgW.computeSize; }
                else sceneBgW.computeSize = () => [0, -4];
                const elB = sceneBgW.element || sceneBgW.inputEl;
                if (elB) elB.style.display = show ? "" : "none";
                if (!show && editor?.which === "background") closeEditor(true);
                node.setDirtyCanvas?.(true, true);
            }
            // a workflow saved with the old format select: its choice becomes a model pick (or MOSS's standard mode)
            function migrateFormat() {
                // saved before the model was stored as MOSS-Image (its official name)
                if (node.properties?.rg_model_pick === OLD_MOSS) node.properties.rg_model_pick = MOSS;
                const v = fmtW?.value;
                if (!fmtW || !v || v === "auto") return;
                node.properties = node.properties || {};
                if (!node.properties.rg_model_pick) {
                    if (v === "MOSS JSON") node.properties.rg_model_pick = "MOSS-Image";
                    else if (v === "Ideogram JSON") node.properties.rg_model_pick = "Ideogram 4";
                }
                if (v === "text") node.properties.rg_moss_layout = false;
                fmtW.value = "auto";
            }
            const acCtl = autocompleteToggle(node, el);
            const llmSetBtn = iconBtn("shape", "LLM Prompt Enhancer settings: What the LLM sees, the preset for each prompt type, and the "
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
            settings.append(editSeg.box, areaCtl.lab, modelBox, llmSetBtn, acCtl.el, wcCtl.el);
            const syncSettings = () => {
                migrateFormat(); areaCtl.sync(); acCtl.refresh(); wcCtl.refresh();
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
            // ---- the connected model: picked in the footer, else the last run's (while 'model' still comes from the same
            // loader), else a guess from the graph (the loader's file name / type, or the text encoder loader's type)
            const MODEL_NAMES = ["MOSS-Image", "Krea 2", "Ideogram 4", "Flux.1", "Flux.2", "Flux 3", "Anima", "SDXL", "SD1.5"];
            function archFromText(t) {
                t = String(t || "");
                if (/moss/i.test(t)) return "MOSS-Image";
                if (/krea/i.test(t)) return "Krea 2";
                if (/ideogram/i.test(t)) return "Ideogram 4";
                if (/flux[\s._-]*3(?!\d)/i.test(t)) return "Flux 3";
                if (/flux[\s._-]*2(?!\d)|klein/i.test(t)) return "Flux.2";
                if (/flux|kontext/i.test(t)) return "Flux.1";
                if (/anima/i.test(t)) return "Anima";
                if (/sd[\s._-]*1[\s._-]*5|v1-5|sd15/i.test(t)) return "SD1.5";
                if (/sdxl|sd[\s._-]*xl|illustrious|pony|noob/i.test(t)) return "SDXL";
                return null;
            }
            const loaderFile = (n) => {
                const ws = n?.widgets || [];
                const w = ws.find((x) => typeof x.value === "string" && /\.(safetensors|gguf|ckpt|pt|pth|sft|bin)$/i.test(x.value))
                    || ws.find((x) => /name/i.test(x.name) && typeof x.value === "string");
                return w ? String(w.value) : "";
            };
            // follow 'model' up to its source (through LoRA loaders, model patches, reroutes ...)
            function modelSource() {
                let n = node;
                for (let i = 0; i < 24; i++) {
                    const f = feeder(n, "model");
                    if (!f) return n === node ? null : { n, file: loaderFile(n) };
                    n = f.src;
                    if (!n.inputs?.some((x) => x.name === "model")) return { n, file: loaderFile(n) };
                }
                return null;
            }
            function clipType() {                      // the text encoder loader's 'type' (CLIPLoader, DualCLIPLoader ...)
                let n = node;
                for (let i = 0; i < 24; i++) {
                    const f = feeder(n, "clip");
                    if (!f) return "";
                    n = f.src;
                    const t = n.widgets?.find((w) => w.name === "type");
                    if (t && !n.inputs?.some((x) => x.name === "clip" && x.link != null)) return String(t.value || "");
                }
                return "";
            }
            function guessArch() {
                const src = modelSource();
                const arch = (src && (archFromText(src.file) || archFromText(src.n.comfyClass || src.n.type) || archFromText(src.n.title)))
                    || archFromText(clipType());
                return { arch: arch || null, sig: src ? `${src.n.id}:${src.file}` : "" };
            }
            function modelInfo() {                     // { arch, how: "picked" | "last run" | "guess" | null, guess }
                const pick = node.properties?.rg_model_pick;
                const g = guessArch(), run = node.properties?.rg_model_arch || null, runSig = node.properties?.rg_model_src;
                if (pick && MODEL_NAMES.includes(pick)) return { arch: pick, how: "picked", guess: g.arch };
                if (run && (runSig == null || runSig === g.sig || !g.sig)) return { arch: run, how: "last run", guess: g.arch };
                return { arch: g.arch, how: g.arch ? "guess" : null, guess: g.arch };
            }
            const modelArch = () => modelInfo().arch;
            // the edit LoRAs Edit Mode wants in Whole image: the one for the model, or every one while the model isn't known
            function syncEditLoras() {
                const all = editLoras(), arch = modelArch();
                const want = !isEdit() ? [] : arch ? all.filter(([m]) => m === arch) : all;
                const cur = state.sceneLoras || [];
                const kept = cur.filter((x) => !x.edit || want.some(([m, l]) => x.edit === m && x.lora === l));
                const add = want.filter(([m, l]) => !kept.some((x) => x.edit === m && x.lora === l)).map(([m, lora]) => ({ lora, strength: 1, on: true, edit: m }));
                if (kept.length === cur.length && !add.length) return false;
                state.sceneLoras = [...kept, ...add];
                if (!state.sceneLoras.length) delete state.sceneLoras;
                if (add.length) expanded.add(SCENE);
                return true;
            }
            let syncedArch;
            // the model changed (picked, rewired, or a run said so): the Control and Edit Mode LoRAs follow it (no undo step)
            function onModelChanged(force) {
                const arch = modelArch();
                if (!force && arch === syncedArch) return;
                syncedArch = arch;
                const a = syncControlLoras(), b = syncEditLoras();
                if (a || b) { save(); renderRegions(); }
                syncModelSel();
                if (state.control?.on) checkControlFiles(false);
            }
            // the footer select: auto (with what it found) or a model picked to correct it
            const modelSel = el("select", "rg-sel rg-model");
            modelSel.addEventListener("pointerdown", (e) => e.stopPropagation());
            // MOSS-Image: layout (its layout JSON, with the region boxes) or standard (a plain text prompt)
            const layoutBtn = iconBtn("mossLayout", "", () => {
                node.properties = node.properties || {};
                if (node.properties.rg_moss_layout === false) delete node.properties.rg_moss_layout;
                else node.properties.rg_moss_layout = false;
                app.graph?.change?.();
                syncModelSel();
            }, "rg-layout");
            modelBox.append(modelSel, layoutBtn);         // in the bottom bar, after Edit Mode
            modelSel.addEventListener("change", () => {
                node.properties = node.properties || {};
                if (modelSel.value) node.properties.rg_model_pick = modelSel.value; else delete node.properties.rg_model_pick;
                app.graph?.change?.();
                onModelChanged(true);
            });
            function syncModelSel() {
                const info = modelInfo(), pick = node.properties?.rg_model_pick || "";
                const auto = !pick && info.arch ? `auto · ${info.arch}` : pick && info.guess ? `auto (${info.guess})` : "auto · model?";
                const opts = [["", auto], ...MODEL_NAMES.map((m) => [m, m])];
                const sig = JSON.stringify(opts);
                if (modelSel.dataset.sig !== sig) { modelSel.replaceChildren(...opts.map(([v, t]) => opt(v, t))); modelSel.dataset.sig = sig; }
                if (document.activeElement !== modelSel) modelSel.value = pick;
                modelSel.title = "The model this node works with. It sets the format of the 'prompt' and 'positive' outputs "
                    + "(MOSS-Image: MOSS layout JSON, Ideogram 4: Ideogram caption JSON, the others: Plain text), the LoRAs "
                    + "Control and Edit Mode add to Whole image, and the control files.\n"
                    + (pick ? `Picked: ${pick}. ` : info.how === "last run" ? `Auto: ${info.arch}, from the last run. `
                        : info.how === "guess" ? `Auto: ${info.arch}, guessed from the model loader's file / type (the run checks the model itself). `
                        : "Auto: Not known yet (no run, and nothing to guess from); the run checks the connected model. ")
                    + "Pick a model to correct a wrong guess; 'auto' follows the graph and the runs again."
                    + (lastFormat ? `\nThe last run's prompt format: ${lastFormat}.` : "");
                modelSel.classList.toggle("picked", !!pick);
                // MOSS-Image's layout / standard switch
                layoutBtn.style.display = info.arch === "MOSS-Image" ? "" : "none";
                syncLayoutBtn();
                syncBackground();
            }
            // round 20: the icon shows the mode the run will use: standard by itself while no region is drawn and shown
            // (holes don't count) and in Edit Mode, even when layout is chosen; layout comes back with a region
            let layoutAuto = null;
            function syncLayoutBtn(anyRegion) {
                if (anyRegion === undefined) anyRegion = outputIndexMap().some((v) => v != null);
                const want = node.properties?.rg_moss_layout !== false, edit = isEdit();
                const layout = want && anyRegion && !edit;
                const key = `${want}|${anyRegion}|${edit}`;
                if (key === layoutAuto) return;
                layoutAuto = key;
                setHTML(layoutBtn, svgIcon(layout ? "mossLayout" : "mossStandard"));
                layoutBtn.classList.toggle("on", layout);
                const why = !want ? "" : edit ? "\nStandard by itself: Edit Mode always sends plain text (the edit LoRA takes an instruction)."
                    : !anyRegion ? "\nStandard by itself: No region is drawn and shown. Layout comes back when one is." : "";
                layoutBtn.title = (layout
                    ? "MOSS-Image layout mode: The prompt is MOSS layout JSON, with each region's box. Click for standard mode."
                    : want ? "MOSS-Image standard mode (for now): The prompt is plain text. Click to choose standard mode for good."
                    : "MOSS-Image standard mode: The prompt is plain text (the regions as sentences; masks still steer them). Click for layout mode.")
                    + why;
            }
            // the files the Control row needs for the model and kind, and the ones ComfyUI doesn't have: the message bar
            // shows where to get them (like Select object's missing-model message)
            function neededControlFiles(c, arch) {
                const files = controlFiles(), need = [];
                const mapMade = !isLinked("control_image") && ["depth", "color+depth"].includes(c.kind);
                if (arch === "MOSS-Image") {
                    if (["color", "color+depth", "depth"].includes(c.kind)) need.push("MOSS");
                } else if (arch === "Flux.1") {
                    if (c.kind === "depth") need.push(files.Flux1Depth || !files["Flux1.depth"] ? "Flux1Depth" : "Flux1.depth");
                    else if (c.kind === "canny") need.push(files.Flux1Canny || !files["Flux1.canny"] ? "Flux1Canny" : "Flux1.canny");
                    else if (c.kind === "other") need.push("Flux1.other");
                } else if (arch === "SDXL" || arch === "SD1.5" || arch === "Anima") {
                    const k = { SDXL: "SDXL", "SD1.5": "SD15", Anima: "Anima" }[arch];
                    if (["depth", "canny", "other"].includes(c.kind)) need.push(`${k}.${c.kind}`);
                }
                if (mapMade && need.length) need.push("DA3");
                return need;
            }
            function missingControlFiles(keys) {
                const files = controlFiles(), out = [];
                for (const key of keys) {
                    const folder = controlFolder(key);
                    const list = folder === "loras" ? (knownLoras() || []) : controlFolders(key).flatMap((f) => knownModels(f) || []);
                    if (!files[key]) out.push([key, "unset"]);
                    // a full path (Browse…) is checked by the run, which notes a file it can't find
                    else if (!isFullPath(files[key]) && list.length && !list.includes(files[key])) out.push([key, "missing", files[key]]);
                }
                return out;
            }
            function showControlMissing(items) {
                if (!items.length) return false;
                const lines = items.map(([key, why, name]) => {
                    const d = CONTROL_DOWNLOADS[key], folder = controlFolder(key);
                    const state = why === "missing" ? `'${name}' isn't in ComfyUI/models/${folder} (ComfyUI doesn't see it)` : "no file is set";
                    return `${controlLabel(key)}: ${state}. Download ${d?.file || "one"}${d ? ` (${d.url})` : ""}${d?.note ? ` — ${d.note}` : ""} `
                        + `into ComfyUI/models/${folder}, refresh ComfyUI (R), then pick it in Settings > Region Genie > Control (or keep it `
                        + "anywhere and pick it there with the folder button, Browse…).";
                });
                showMsg(lines.join("\n"));
                return true;
            }
            function checkControlFiles(refreshLists) {
                const c = ctl(), arch = modelArch();
                if (!c.on) return;
                if (refreshLists) for (const f of new Set(CONTROL_FILES.map((x) => x[2]))) if (f !== "loras") knownModels(f, true);
                if (arch && !["MOSS-Image", "Flux.1", "SDXL", "SD1.5", "Anima"].includes(arch)) {
                    showMsg(`Control: ComfyUI has no ControlNet support for ${arch} yet, so this node can't apply control with it. `
                        + "If the model was guessed wrong, pick the right one in the bottom bar.");
                    return;
                }
                if (!showControlMissing(missingControlFiles(neededControlFiles(c, arch)))) hideMsg();
            }
            // ---- Control (ControlNet / control LoRAs): the row under Whole image, the per-region switch, the LoRAs it adds
            const CONTROL = "control";
            const CONTROL_KIND_LABELS = [["color", "color map (MOSS)"], ["color+depth", "color map + depth (MOSS)"], ["depth", "depth"],
                                         ["canny", "canny"], ["other", "your control_image"]];
            const ctl = () => state.control || { on: false, kind: "depth", strength: 1, start: 0, end: 1 };
            let controlMap = null, controlMapKey = "", controlShow = false;          // the map of the last run, shown on the canvas
            // the control LoRAs the current settings want in Whole image: [{lora, control: model, ckind}]
            function wantedControlLoras(c) {
                if (!c.on) return [];
                const files = controlFiles(), arch = modelArch(), out = [];
                const add = (key, model, ckind) => { if (files[key] && (!arch || arch === model)) out.push({ lora: files[key], control: model, ckind }); };
                if (["color", "color+depth", "depth"].includes(c.kind)) add("MOSS", "MOSS-Image", "moss");
                if (c.kind === "depth") add("Flux1Depth", "Flux.1", "depth");
                if (c.kind === "canny") add("Flux1Canny", "Flux.1", "canny");
                return out;
            }
            // keep the Whole image LoRAs in step (inside a change(): one undo step with the switch that caused it)
            function syncControlLoras() {
                const want = wantedControlLoras(ctl()), cur = state.sceneLoras || [];
                const same = (a, b) => a.lora === b.lora && a.control === b.control && a.ckind === b.ckind;
                const kept = cur.filter((x) => !x.control || want.some((w) => same(w, x)));
                const add = want.filter((w) => !kept.some((x) => x.control && same(w, x))).map((w) => ({ ...w, strength: 1, on: true }));
                if (kept.length === cur.length && !add.length) return false;
                state.sceneLoras = [...kept, ...add];
                if (!state.sceneLoras.length) delete state.sceneLoras;
                if (add.length) expanded.add(SCENE);
                return true;
            }
            // Edit Mode's LoRAs never stay in Generate, nor a control LoRA while Control is off: whatever put them there (Ctrl+Z
            // after switching back, an old workflow, a Setting changed meanwhile). Only removes; adding is syncEditLoras' /
            // syncControlLoras' job (on a mode, model or Control change)
            function pruneManagedLoras() {
                const cur = state.sceneLoras || [], ctlOn = !!ctl().on, edit = isEdit();
                const kept = cur.filter((x) => !(x.edit && !edit) && !(x.control && !ctlOn));
                if (kept.length === cur.length) return false;
                if (kept.length) state.sceneLoras = kept; else delete state.sceneLoras;
                return true;
            }
            function setControl(patch) {
                change(() => { state.control = { ...ctl(), ...patch }; syncControlLoras(); });
                if (state.control.on) checkControlFiles(true); else hideMsg();
            }
            // Edit Mode's Edit row (round 18): always there in Edit Mode; the edit LoRA for the node's model, picked here
            // (dropdown or Browse…) or in Settings > Region Genie > Edit Mode (the same setting)
            function editRow() {
                const row = el("div", "rg-row ctrl edit");
                const pad = el("span", "rg-chev"); pad.style.visibility = "hidden"; pad.textContent = "▶";   // lines up with Control
                const lbl = el("span", "rg-pseudo"); lbl.textContent = "Edit";
                lbl.title = "Edit Mode adds the edit LoRA set for the node's model to Whole image (marked 'Edit'), and removes it "
                    + "when the node is switched back to Generate.";
                row.append(pad, lbl);
                const arch = modelArch(), m = EDIT_MODELS.find(([name]) => name === arch);
                const t = el("span", "rg-hint"); t.style.flex = "0 0 auto";
                if (!m) {
                    t.textContent = "The model isn't known yet: Pick it in the bottom bar to choose its edit LoRA here";
                    t.title = "Until the model is known, the edit LoRAs set for every model in Settings > Region Genie > Edit Mode are added.";
                    row.appendChild(t);
                    return row;
                }
                const id = SET.editLora + "." + m[1], cur = getSetting(id, NO_LORA) || NO_LORA;
                t.textContent = cur === NO_LORA ? `No edit LoRA for ${arch}:` : `LoRA for ${arch}:`;
                const picker = modelFilePicker({
                    folders: ["loras"], none: NO_LORA, value: cur,
                    title: `The edit LoRA for ${arch} (the same as Settings > Region Genie > Edit Mode > '${arch}: edit LoRA')`,
                    onPick: async (v) => { await setSetting(id, v); onModelChanged(true); renderRegions(); },
                });
                picker.classList.add("rg-edit-pick");
                row.append(t, picker);
                return row;
            }
            function controlRow() {
                const c = ctl();
                // round 18: the row is there only while control is on (＋Control on Whole image adds it, its ✕ removes it)
                const row = el("div", "rg-row ctrl");
                const lbl = el("span", "rg-pseudo"); lbl.textContent = "Control";
                lbl.title = "Control: The model follows a map (ControlNet / control LoRA for the connected model). The files are set in "
                    + "Settings > Region Genie > Control.";
                row.append(chevron(CONTROL, c.on, "the control files for each model"), lbl);
                if (c.on) {
                    const kind = el("select", "rg-sel");
                    kind.title = (CONTROL_KIND_HELP[c.kind] || "") + "\n\nWhat the model follows: The regions' color map and / or depth (MOSS-Image's "
                        + "control LoRA), depth, canny, or the map on 'control_image'. Depth and canny are made from 'image' when control_image isn't connected.";
                    for (const [v, t] of CONTROL_KIND_LABELS) kind.appendChild(opt(v, t));
                    kind.value = c.kind;
                    kind.addEventListener("change", () => setControl({ kind: kind.value }));
                    const num = (v, title, lo, hi, step, set) => {
                        const i = el("input", "rg-num"); i.type = "number"; i.min = String(lo); i.max = String(hi); i.step = String(step);
                        i.value = String(v); i.title = title;
                        i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") i.blur(); });
                        i.addEventListener("change", () => set(Math.min(hi, Math.max(lo, +i.value || 0))));
                        return i;
                    };
                    const str = num(c.strength, "Strength (1 = as trained)", 0, 10, 0.05, (v) => setControl({ strength: v }));
                    const a = num(Math.round(c.start * 100), "Start, in % of the steps", 0, 100, 1, (v) => setControl({ start: v / 100 }));
                    const b = num(Math.round(c.end * 100), "End, in % of the steps (ending early keeps the layout, then lets the shapes loosen)", 0, 100, 1, (v) => setControl({ end: v / 100 }));
                    const pct = el("span", "rg-hint"); pct.textContent = "%";
                    const dash = el("span", "rg-hint"); dash.textContent = "–";
                    const eye = iconBtn(controlShow ? "eye" : "eyeOff", controlMap ? (controlShow ? "Hide the control map on the canvas" : "Show the control map of the last run on the canvas")
                        : "The control map shows here after a run", () => { controlShow = !controlShow; renderRegions(); requestDraw(); });
                    eye.disabled = !controlMap;
                    eye.addEventListener("pointerdown", (e) => e.stopPropagation());
                    for (const x of [kind, str, a, b]) x.addEventListener("pointerdown", (e) => e.stopPropagation());
                    const gap = el("span"); gap.style.flex = "1 1 auto";
                    const rm = iconBtn("close", "Remove the Control row (control off). Its settings are kept for the next ＋Control.",
                        () => { setControl({ on: false }); expanded.delete(CONTROL); });
                    rm.addEventListener("pointerdown", (e) => e.stopPropagation());
                    row.append(kind, str, a, dash, b, pct, gap, eye, rm);
                }
                row.addEventListener("pointerdown", (e) => {
                    if (e.button !== 0 || e.target.closest?.("button, input, select, textarea") || !c.on) return;
                    e.stopPropagation();
                    if (expanded.has(CONTROL)) expanded.delete(CONTROL); else expanded.add(CONTROL);
                    renderRegions();
                });
                return row;
            }
            // the details: which file each model uses for this kind, and where the map comes from
            function controlDetails() {
                const c = ctl(), files = controlFiles(), box = el("div", "rg-subbody ctrl");
                const line = (text, title) => { const d = el("div", "rg-row lora"); const t = el("span", "rg-hint"); t.textContent = text; if (title) t.title = title; d.appendChild(t); box.appendChild(d); };
                const info = modelInfo(), arch = info.arch;
                const pick = (key) => files[key] || "—";
                const per = c.kind === "color" || c.kind === "color+depth"
                    ? [["MOSS-Image", `LoRA ${pick("MOSS")}`]]
                    : [["MOSS-Image", c.kind === "depth" ? `LoRA ${pick("MOSS")}` : "— (color map / depth only)"],
                       ["Flux.1", (c.kind === "depth" && files.Flux1Depth) ? `LoRA ${files.Flux1Depth}` : (c.kind === "canny" && files.Flux1Canny) ? `LoRA ${files.Flux1Canny}` : `ControlNet ${pick(`Flux1.${c.kind}`)}`],
                       ["SDXL", `ControlNet ${pick(`SDXL.${c.kind}`)}`], ["SD1.5", `ControlNet ${pick(`SD15.${c.kind}`)}`],
                       ["Anima", `LLLite ${pick(`Anima.${c.kind}`)}`]];
                for (const [m, f] of per) line(`${m === arch ? "▸ " : ""}${m}: ${f}`, m === arch ? `The model this node works with (${info.how}; the bottom bar's model select)` : "");
                line("Krea 2, Flux.2, Flux 3, Ideogram 4: no ControlNet in ComfyUI yet");
                const src = c.kind === "color" ? "the regions' colors (the color_map output)"
                    : c.kind === "other" ? "the control_image input"
                    : `control_image if connected, else made from 'image' (${c.kind === "canny" ? "ComfyUI's Canny" : `Depth Anything 3: ${files.DA3 || "set its model in Settings"}`})`
                        + (c.kind === "color+depth" ? "; the color map from the regions" : "");
                line("Map: " + src);
                const off = state.regions.filter((r) => r.noControl).length;
                line(off ? `${off} region(s) switched off: the control acts only inside the regions still on` : "Every region is on (the region rows' control button switches one off)");
                line("Files: Settings > Region Genie > Control (each one's tooltip says where to get it)");
                const help = el("div", "rg-row lora"); const ht = el("span", "rg-hint rg-ctrl-help"); ht.textContent = CONTROL_KIND_HELP[c.kind] || ""; help.appendChild(ht); box.appendChild(help);
                return box;
            }
            function controlToggle(r) {
                const on = !r.noControl;
                const b = el("button", "rg-btn mini" + (on ? " toggle on" : ""));
                setHTML(b, svgIcon(on ? "control" : "controlOff"));
                b.title = on ? "Control acts on this region. Click to leave it out (while any region is left out, the control acts only inside the regions still on)."
                    : "Control leaves this region out. Click to include it again.";
                b.addEventListener("pointerdown", (e) => e.stopPropagation());
                b.addEventListener("click", (e) => { e.preventDefault(); change(() => { if (r.noControl) delete r.noControl; else r.noControl = true; }); });
                return b;
            }
            function keepToggle(r) {
                const b = el("button", "rg-btn mini" + (r.keep ? " toggle on" : ""));
                setHTML(b, svgIcon(r.keep ? "lock" : "pencil"));
                b.title = r.keep
                    ? "Keep (Edit Mode): This region stays as it is in the source image, also with change = whole image, and "
                        + "the edit mask never grows into it. Its prompt is still part of the prompt. Click to let it change."
                    : "Change (Edit Mode): The sampler may change this region. Click to keep it as it is in the source image "
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
            cvBox.append(cv, optStrip, bdBox);            // the tool options (top left) and the image opacity (right edge)
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
                shapeKind = "rect";
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
            sepIn.title = "LoRA region separation: How much attention between the image of different LoRA regions is removed "
                + "(MOSS-Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5; model output). Higher keeps each LoRA's style in its region; 1 = fully separate.";
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
                setHTML(allApartBtn, svgIcon(shared ? "allApartShared" : "allApart"));
                allApartBtn.classList.toggle("on", on);
                allApartBtn.title = (own ? "Keep all regions apart: ON."
                    : autoApart ? "Keep all regions apart: ON automatically in the last run (a model without a layout format, "
                        + "with region prompts; Settings > Region Genie > keep all regions apart automatically sets this for "
                        + "all such models or one model). "
                        + "Clicking switches it on for this node in any case."
                    : "Keep all regions apart: OFF.")
                    + "\nOn: Every region, with or without LoRAs, is kept apart from the others and from the background for "
                    + "the first part of sampling ('until'), at the separation strength set here, and each region's caption "
                    + "speaks only to its own region.\nOff (default): Only regions with LoRAs are kept apart.\n"
                    + "With Krea 2, Flux, Anima or SDXL / SD1.5 (no layout format of their own) this is what places each "
                    + "region's prompt in its region. Needs a MOSS-Image, Krea 2, Ideogram 4, Flux, Anima or SDXL / SD1.5 "
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
                grow: "Edit mask grow (px): The area the sampler may change in Edit Mode grows this far past the regions "
                    + "set to change, so the edit blends into its surroundings; negative shrinks it. Kept regions are never "
                    + "grown into. Separate from each region's own feather (which is for 'masks' and LoRAs).\nEmpty: The "
                    + "Settings default (Settings > Region Genie > Edit Mode), shown greyed.",
                feather: "Edit mask feather (px): Softens the edge of the area the sampler may change in Edit Mode (after "
                    + "growing). Separate from each region's own feather.\nEmpty: The Settings default (Settings > Region "
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

            // the divider between the canvas and the Regions list: dragging moves room between them (the node keeps its
            // size); the list's height is this node's (node.properties.rg_list_h); double-click: the usual 220 px
            const LIST_H = 220, LIST_MIN = 90, CV_MIN = 120;
            const split = el("div", "rg-split");
            split.title = "Drag: More room for the canvas or for the Regions list (this node keeps its size).\nDouble-click: The usual height.";
            const applyListH = () => {
                const h = Math.round(+node.properties?.rg_list_h || LIST_H);
                const want = Math.max(LIST_MIN, h) + "px";
                if (tree.style.height !== want) tree.style.height = want;
            };
            split.addEventListener("pointerdown", (e) => {
                if (e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                const k = wrap.offsetHeight / Math.max(1, wrap.getBoundingClientRect().height);   // screen px -> CSS px (graph zoom)
                const y0 = e.clientY, h0 = tree.offsetHeight, room = h0 + cvBox.offsetHeight - CV_MIN;
                cvBox.style.minHeight = CV_MIN + "px";
                split.setPointerCapture?.(e.pointerId);
                split.classList.add("drag");
                const move = (ev) => {
                    node.properties = node.properties || {};
                    node.properties.rg_list_h = Math.round(Math.max(LIST_MIN, Math.min(room, h0 - (ev.clientY - y0) * k)));
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
                if (node.properties) delete node.properties.rg_list_h;
                cvBox.style.minHeight = "";
                applyListH(); app.graph?.change?.();
            });
            for (const ev of ["mousedown", "click"]) split.addEventListener(ev, (e) => e.stopPropagation());
            if (node.properties?.rg_list_h) cvBox.style.minHeight = CV_MIN + "px";
            applyListH();
            wrap.style.position = "relative";
            wrap.append(keySink, bar1, banner, cvBox, msgBar, split, tree, foot);
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
            ], (v) => {
                const c = sizeCfg();
                // into presets mode: keep the size the other mode made (shown as "not in the list" until a preset is
                // picked), so '＋ Current size' in 'Edit list…' can add it
                if (v === "presets" && c.mode !== "presets") { const [w, h] = sizeOfCfg(c); c.preset = { ...c.preset, w, h, swap: false }; }
                c.mode = v; applySize();
            });
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
            const mpIn = sizeNum(0.1, 16, 0.01, "Megapixels: The target pixel count (1.0 = 1024 x 1024 for square)", "48px");
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
            const PRESET_TIP = "Image size presets (Settings > Region Genie > Image size; 'Edit list…' to change them)";
            preSel.title = PRESET_TIP;
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
                    const extra = preSel.querySelector("option[data-extra]");
                    const listed = [...preSel.options].some((o) => o.value === key && !o.dataset.extra);
                    if (!listed && extra?.value !== key) {         // not in the list (any more): keep it shown
                        const o = opt(key, `${c.preset.w} × ${c.preset.h}  (not in the list)`); o.dataset.extra = "1";
                        extra?.remove();
                        preSel.insertBefore(o, preSel.firstChild);
                    } else if (listed) extra?.remove();
                    preSel.value = key;
                    preSel.title = PRESET_TIP + (listed ? "" : `. ${c.preset.w} x ${c.preset.h} isn't in the list: 'Edit list…' > ＋ Current size adds it`);
                }
                if (idle(wIn)) wIn.value = String(c.manual.w);
                if (idle(hIn)) hIn.value = String(c.manual.h);
                setHTML(linkBtn, svgIcon(c.manual.link ? "link" : "unlink"));
                linkBtn.classList.toggle("on", !!c.manual.link);
                linkBtn.title = c.manual.link ? "Ratio kept: Changing one side changes the other. Click to set them separately"
                    : "Keep the ratio: Changing one side changes the other";
                swapR.classList.toggle("on", !!c.ratio.swap); swapP.classList.toggle("on", !!c.preset.swap);
                if (!sizeReady) { sizeOut.textContent = sizeOfCfg(c).join(" × "); return; }
                // what decides the size in the end (same priority as the Python side)
                const [W, H] = dims();
                const from = isLinked("size_from_image") ? "from size_from_image" : isLinked("size_from_latent") ? "from size_from_latent"
                    : editSized() ? "Edit: The image's shape at this many pixels"
                    : isLinked("width_in") || isLinked("height_in") ? "from the width / height inputs" : "";
                sizeOut.textContent = `${W} × ${H}`;
                sizeOut.title = from ? `Image size ${W} x ${H}, ${from.startsWith("Edit") ? "in Edit Mode: " + from.slice(6) : from}.` : `Image size: ${W} x ${H}.`;
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
                const addCur = btn("＋ Current size", "Add the node's current image size to the list (a size made in aspect ratio or "
                    + "manual mode stays when you switch to presets mode, shown as 'not in the list', so it can be added here)", () => {
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
            // the region a hole is listed under: the one it was made in, else (old workflows, a deleted region) the
            // region of the nearest layer below it, else above it, else the first region
            function holeOwner(L) {
                if (L.owner != null && regionById(L.owner)) return L.owner;
                const i = state.layers.indexOf(L);
                for (const dir of [-1, 1]) {
                    for (let j = i + dir; j >= 0 && j < state.layers.length; j += dir) {
                        const o = state.layers[j];
                        if (o.region !== UNSPEC && regionById(o.region)) return o.region;
                    }
                }
                return state.regions[0]?.id ?? null;
            }
            // ✂: a layer cuts a hole through the layers below it (region 0: no region there), or paints its region again
            function toggleHole(L) {
                if (L.region === UNSPEC) {
                    const rid = holeOwner(L);
                    if (rid == null) { hint("Add a region first"); return; }
                    change(() => { L.region = rid; delete L.owner; sortLayersByRegions(); curRegion = rid; selId = L.id; });
                } else {
                    change(() => { L.owner = L.region; L.region = UNSPEC; selId = L.id; });
                }
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
            function undo() { if (undoStack.length) { redoStack.push(snapshot()); restore(undoStack.pop()); afterRestore(); } }
            function redo() { if (redoStack.length) { undoStack.push(snapshot()); restore(redoStack.pop()); afterRestore(); } }
            // the Generate / Edit switch isn't part of an undo step: an undone list must still fit the mode it's in now
            function afterRestore() { if (pruneManagedLoras()) { save(); renderRegions(); } }
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
                if (L) { curRegion = L.region; openSub(L.region === UNSPEC ? holeOwner(L) : L.region, "layers"); }
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
                    L.region = rid; delete L.owner; curRegion = rid; selId = L.id; openSub(rid, "layers");
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
                if (t === "wand" || t === "object") grpCur.wand = t;
                if (t === "erase" || t === "lassoErase") grpCur.erase = t;
                for (const b of new Set(Object.values(toolBtns))) b.classList.toggle("on", toolBtns[t] === b);
                refreshVariantButtons();                       // the buttons show the tool in use; the strip its options
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
            let holePat = null, holePatDpr = 0;
            function holePattern(c) {                      // the canvas's holes: black with grey stripes
                const d = dprNow();
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
                const pending = drag?.mode === "paint" && !drag.target ? drag.layer : null;
                let list = state.layers;
                if (pending) { list = [...state.layers]; list.splice(slotFor(pending.region), 0, pending); }
                for (const L of list) {
                    if (!isShown(L)) continue;
                    const extra = drag?.mode === "paint" && (drag.target === L || L === pending) ? drag.op : null;
                    const hatch = hatchHoles && L.region === UNSPEC;
                    const needsScratch = L.ops.some((o) => o.e) || extra?.e || hatch;
                    if (!needsScratch) { drawLayerOn(c, L, extra, pre); continue; }
                    sc.setTransform(1, 0, 0, 1, 0, 0);
                    sc.clearRect(0, 0, w, h);
                    drawLayerOn(sc, L, extra, pre);
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
                renderComposite(cctx, w, h, scratch, sctx, undefined, true);
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
                if (controlShow && controlMap && state.control?.on) {         // the control map of the last run
                    ctx.save(); ctx.globalAlpha = 0.65; ctx.drawImage(controlMap, ix, iy, iw, ih); ctx.restore();
                }
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
                syncLayoutBtn(map.some((v) => v != null));
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
                const sel = selLayer(), owner = rid === UNSPEC ? (sel?.region === UNSPEC ? holeOwner(sel) : state.regions[0]?.id) : null;
                return { id, name: rid === UNSPEC ? `Hole ${id}` : `Paint ${id}`, region: rid, ...(owner != null ? { owner } : {}),
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
                    } else if (L) { activateRegion(UNSPEC); hint("A hole (✂ on its layer): Painting now adds holes"); }
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
            // ---- pop-up editors: on top of the page (dragged anywhere on the screen), one at a time. The size: every node (a
            // hidden Setting); the text size: Settings > Region Genie > Text size, per kind of field (A− / A+ don't change the
            // pop-up's size). They stay open until Enter, Esc, ✕, another pop-up, or the node leaving the canvas (another
            // workflow tab, a subgraph); a click elsewhere doesn't close them. ◀ / ▶ step through every text field of the node.
            const POP_W = { scene: 640, region: 560 };
            const FS_POP = { scene: SET.fsPopScene, prompt: SET.fsPopRegion, text: SET.fsPopText };
            const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
            const popSizes = () => { try { const v = JSON.parse(recentSetting(SET.popSizes, "{}") || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } };
            const fsPop = (cat) => clampN(Math.round(+recentSetting(FS_POP[cat], 14)) || 14, 8, 40);
            function applyPopFont(ta, cat) { const f = fsPop(cat); ta.style.fontSize = f + "px"; ta.style.lineHeight = Math.round(f * 1.3) + "px"; }
            // size, then place (screen px): ed.at (stepped here with ◀ / ▶: the same place and size), else the saved size (or the
            // height with 14 px text) and autoPlace(w, h, W, H) next to the field it opens from; kept on the screen
            function popLayout(ed, kind, autoPlace) {
                const box = ed.box, W = window.innerWidth, H = window.innerHeight;
                const keepOn = () => {
                    box.style.left = clampN(parseFloat(box.style.left) || 6, 0, Math.max(0, W - 60)) + "px";
                    box.style.top = clampN(parseFloat(box.style.top) || 6, 0, Math.max(0, H - 40)) + "px";
                };
                if (ed.at) {
                    box.style.width = clampN(Math.round(ed.at.width), 240, Math.max(240, W - 12)) + "px";
                    box.style.height = clampN(Math.round(ed.at.height), 160, Math.max(160, H - 12)) + "px";
                    box.classList.add("sized");
                    if (!ed.placed) { ed.placed = true; box.style.left = ed.at.left + "px"; box.style.top = ed.at.top + "px"; }
                    keepOn(); return;
                }
                const sz = popSizes()[kind] || {};
                const w = clampN(Math.round(sz.w || POP_W[kind]), 240, Math.max(240, W - 12));
                box.style.width = w + "px";
                box.classList.remove("sized");
                const h = sz.h || naturalHeight(box, [...box.querySelectorAll("textarea")]);
                box.style.height = clampN(Math.round(h), 160, Math.max(160, H - 12)) + "px";
                box.style.maxHeight = "";
                box.classList.add("sized");
                if (ed.placed) { keepOn(); return; }
                ed.placed = true;
                autoPlace(w, box.offsetHeight, W, H);
                keepOn();
            }
            // just below the element's screen rect r, else above it, else as low as fits
            const placeBy = (box, r, w, h, W, H, center = false) => {
                const top = r.bottom + 4 + h <= H - 6 ? r.bottom + 4 : (r.top - 4 - h >= 6 ? r.top - 4 - h : Math.max(6, H - 6 - h));
                const left = center ? (r.left + r.right) / 2 - w / 2 : r.left;
                box.style.left = clampN(left, 6, Math.max(6, W - w - 6)) + "px";
                box.style.top = top + "px";
            };
            // every text field of the node, in order: the scene prompts, then each region's prompt (list order)
            const popTargets = () => [["scene", "positive"], ["scene", "negative"], ...(sceneBgW?.__rgShown ? [["scene", "background"]] : []),
                                      ...state.regions.map((r) => ["region", r.id])];
            function popStep(dir) {
                const ed = editor;
                if (!ed) return;
                const list = popTargets(), b = ed.box;
                const at = { left: b.offsetLeft, top: b.offsetTop, width: b.offsetWidth, height: b.offsetHeight };
                let i = list.findIndex((t) => t[0] === ed.target[0] && t[1] === ed.target[1]);
                const t = list[((i < 0 ? 0 : i) + dir + list.length) % list.length];
                if (t[0] === "scene") editScene(t[1], at); else editPrompt(t[1], null, "prompt", at);
            }
            // Esc in a pop-up: close it, putting the text back (or keeping it: Settings > Region Genie > Text size)
            const popEsc = () => closeEditor(!escReverts());
            // ◀ / ▶, A− / A+ (the field in use: curCat()), dragging by the title bar, the resize grip
            function popFrame(ed, kind, head, curCat, applyFonts) {
                const box = ed.box;
                const font = (d) => {
                    const cat = curCat();
                    rememberSetting(FS_POP[cat], clampN(fsPop(cat) + d, 8, 40));
                    applyFonts();
                };
                const mkB = (text, tip, fn, cls) => {
                    const b = el("button", "rg-btn " + cls); b.type = "button"; b.textContent = text; b.title = tip;
                    b.addEventListener("click", (e) => { e.preventDefault(); fn(); });
                    return b;
                };
                const fm = mkB("A−", "Smaller text in the box you're typing in (Settings > Region Genie > Text size). The pop-up keeps its size", () => font(-1), "rg-pop-font");
                const fp = mkB("A+", "Larger text in the box you're typing in (Settings > Region Genie > Text size). The pop-up keeps its size", () => font(1), "rg-pop-font");
                const prev = mkB("◀", popNavTip(-1, "scene prompts, then each region's prompt"), () => popStep(-1), "rg-nav prev");
                const next = mkB("▶", popNavTip(1, "scene prompts, then each region's prompt"), () => popStep(1), "rg-nav");
                const x = head.querySelector(".rg-x");
                head.insertBefore(fp, x?.previousElementSibling?.classList.contains("rg-wc-pick") ? x.previousElementSibling : x);
                head.insertBefore(fm, fp);
                head.insertBefore(prev, fm); head.insertBefore(next, fm);
                head.title = "Drag to move (anywhere on the screen).\nDouble-click: Back next to the field.";
                const drag = (e, onMove, onEnd) => {
                    e.preventDefault(); e.stopPropagation();
                    const t = e.currentTarget, x0 = e.clientX, y0 = e.clientY;
                    t.setPointerCapture?.(e.pointerId);
                    const move = (ev) => onMove(ev.clientX - x0, ev.clientY - y0);
                    const up = () => { t.removeEventListener("pointermove", move); t.removeEventListener("pointerup", up); t.removeEventListener("pointercancel", up); onEnd?.(); };
                    t.addEventListener("pointermove", move); t.addEventListener("pointerup", up); t.addEventListener("pointercancel", up);
                };
                head.addEventListener("pointerdown", (e) => {
                    if (e.button !== 0 || e.target.closest("button, input, select, textarea")) return;
                    const l0 = box.offsetLeft, t0 = box.offsetTop, W = window.innerWidth, H = window.innerHeight;
                    drag(e, (dx, dy) => {
                        box.style.left = clampN(l0 + dx, 0, Math.max(0, W - 60)) + "px";
                        box.style.top = clampN(t0 + dy, 0, Math.max(0, H - 40)) + "px";
                    });
                });
                head.addEventListener("dblclick", (e) => {
                    if (e.target.closest("button, input, select, textarea")) return;
                    ed.at = null; ed.placed = false; ed.place();
                });
                const grip = el("div", "rg-pop-grip");
                grip.title = "Drag to resize (remembered for every Region Genie node).\nDouble-click: Back to the default size.";
                grip.addEventListener("pointerdown", (e) => {
                    if (e.button !== 0) return;
                    const w0 = box.offsetWidth, h0 = box.offsetHeight, W = window.innerWidth, H = window.innerHeight;
                    drag(e, (dx, dy) => {
                        box.style.width = clampN(w0 + dx, 240, Math.max(240, W - box.offsetLeft - 6)) + "px";
                        box.style.height = clampN(h0 + dy, 160, Math.max(160, H - box.offsetTop - 6)) + "px";
                        box.style.maxHeight = ""; box.classList.add("sized");
                    }, () => {
                        const all = popSizes(); all[kind] = { w: Math.round(box.offsetWidth), h: Math.round(box.offsetHeight) };
                        rememberSetting(SET.popSizes, JSON.stringify(all));
                        if (ed.at) ed.at = null;
                    });
                });
                grip.addEventListener("dblclick", (e) => {
                    e.stopPropagation();
                    const all = popSizes(); delete all[kind];
                    rememberSetting(SET.popSizes, JSON.stringify(all));
                    ed.at = null; ed.place();
                });
                box.appendChild(grip);
                applyFonts();
            }
            // text size of the node's own fields (Settings > Region Genie > Text size; 0 = as before)
            function applyFieldFonts() {
                const fs = (id) => clampN(Math.round(+recentSetting(id, 0)) || 0, 0, 40);
                const a = fs(SET.fsNodeScene), b = fs(SET.fsNodeRegion), c = fs(SET.fsNodeText);
                for (const t of Object.values(sceneTA)) {
                    const want = a ? a + "px" : "";
                    if (t.style.fontSize !== want) { t.style.fontSize = want; t.style.lineHeight = a ? Math.round(a * 1.3) + "px" : ""; }
                }
                for (const [n, f] of [["r", b], ["t", c]]) {
                    if (f) { wrap.style.setProperty(`--rg-fs-${n}`, f + "px"); wrap.style.setProperty(`--rg-lh-${n}`, Math.round(f * 1.25) + "px"); }
                    else { wrap.style.removeProperty(`--rg-fs-${n}`); wrap.style.removeProperty(`--rg-lh-${n}`); }
                }
            }
            function closeEditor(commit = true) {
                if (!editor) return;
                const ed = editor;
                if (ed.field) ed.endField(!commit);
                editor = null;
                ed.box.remove();
                refreshUI();
                focusSink();
            }
            // rect: the label on the canvas it opens from; null = from the region's row in the list. focus: "prompt" | "text"
            // at: { left, top, width, height } to open at (stepping with ◀ / ▶)
            function editPrompt(rid, rect, focus = "prompt", at = null) {
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
                    const dir = popNavDir(e);                 // the previous / next field key (Settings; Page Up / Page Down)
                    if (dir && !autocompleteOpen(e.target, e)) { e.preventDefault(); popStep(dir); return; }
                    if (e.key === "Escape" && !autocompleteOpen(e.target, e)) { e.preventDefault(); popEsc(); }
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
                                text: "MOSS 'text' item: The Text below is rendered in the image" }[t];
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
                        use.title = f != null ? `Use the filled text: Replace the wildcards with what they produced (last run or preview):\n${f}` : "";
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
                const prompt = field("Prompt", "prompt", 8, "prompt: what is in this region");
                prompt.wrapF.classList.add("grow");
                autocompleteOnFocus(prompt.ta, node);
                const text = field("Text", "text", 3, "text to render");
                // feather, palette, LoRAs (rebuilt on every change)
                const dyn = el("div", "rg-pop-dyn");
                const foot = el("div", "rg-pop-foot");
                foot.textContent = popFootText();
                box.append(head, types, prompt.wrapF, text.wrapF, dyn, foot);
                document.body.appendChild(box);

                const ed = {
                    rid, box, field: null, at, target: ["region", rid],
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
                        const addL = ico("＋LoRA", "Apply a LoRA to this region (model output; MOSS-Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5)", (e) => { rr.loras = rr.loras || []; addLoraTo(rr.loras, e, () => openSub(rr.id, "loras")); }, "txt");
                        ctl.append(llmButton(rr.id, "pop"), ...(isEdit() ? [keepToggle(rr)] : []), featherBox(rr), paletteToggle(rr), addL);
                        const loras = el("div", "rg-pop-loras");
                        if ((rr.loras || []).length) loras.appendChild(regionLoraRows(rr));
                        dyn.replaceChildren(ctl, paletteRow(rr, true), loras);
                        ed.place();
                    },
                    placed: false,
                    place() { popLayout(ed, "region", (w, h, W, H) => {
                        // from the list: below (else above) the region's row; from the canvas: below (else above) its label
                        const row = !rect && regList.querySelector(`textarea.rg-prompt[data-rid="${rid}"]`)?.closest(".rg-row");
                        if (row && row.offsetParent) { placeBy(box, row.getBoundingClientRect(), w, h, W, H); return; }
                        const cr = cv.getBoundingClientRect(), k = cr.width / Math.max(1, cv.width);   // canvas px -> screen px
                        if (!rect) { placeBy(box, { left: cr.left, right: cr.right, top: cr.top - 4, bottom: cr.top - 4 }, w, h, W, H, true); return; }
                        placeBy(box, { left: cr.left + rect.x0 * k, right: cr.left + rect.x1 * k, top: cr.top + rect.y0 * k - 2,
                                       bottom: cr.top + rect.y1 * k + 2 }, w, h, W, H, true);
                    }); },
                };
                editor = ed;
                popFrame(ed, "region", head, () => (lastTa === text.ta ? "text" : "prompt"),
                         () => { applyPopFont(prompt.ta, "prompt"); applyPopFont(text.ta, "text"); });
                ed.refresh();
                const first = focus === "text" && r.type === "text" ? text : prompt;
                first.ta.focus(); first.ta.setSelectionRange(first.ta.value.length, first.ta.value.length);
            }
            // pop-up editor for scene_prompt_positive / _negative / _background (double-click the text box).
            // Positive: also the LLM Prompt Enhancer and the whole-image LoRAs. Enter or clicking elsewhere closes it,
            // Shift+Enter = new line, Esc closes it and puts the text back as it was.
            function editScene(which, at = null) {
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
                    const dir = popNavDir(e);                 // the previous / next field key (Settings; Page Up / Page Down)
                    if (dir && !autocompleteOpen(e.target, e)) { e.preventDefault(); popStep(dir); return; }
                    if (e.key === "Escape" && !autocompleteOpen(e.target, e)) { e.preventDefault(); popEsc(); }
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
                const wrapF = el("div", "rg-pop-field grow");
                const ta = el("textarea"); ta.rows = 12; ta.spellcheck = false; ta.value = String(w.value ?? "");
                ta.placeholder = { positive: "the whole picture: setting, style, lighting ...", negative: "what to avoid in the whole picture",
                                   background: "behind the regions: ground, floor, sky, room ..." }[which];
                const orig = ta.value;
                const skey = SCENE_KEYS[which];
                const useS = el("button", "rg-btn ico rg-wc-use"); useS.innerHTML = svgIcon("useFilled");
                const syncUseS = () => {
                    const f = filledFor(skey, String(w.value ?? ""));
                    useS.style.display = f != null ? "" : "none";
                    useS.title = f != null ? `Use the filled text: Replace the wildcards with what they produced (last run or preview):\n${f}` : "";
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
                foot.textContent = popFootText();
                const useRow = el("div", "rg-pop-lbl"); useRow.append(useS);
                box.append(head, useRow, wrapF, dyn, foot);
                document.body.appendChild(box);
                const ed = {
                    scene: which, which, box, field: { cancelable: true }, at, target: ["scene", which],
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
                    place() { popLayout(ed, "scene", (wd, h, W, H) => {
                        // below (else above) the scene prompt's own text box; else at the top of the node's canvas
                        const t = sceneTA[which];
                        const r = t?.isConnected && t.offsetParent ? t.getBoundingClientRect() : null;
                        if (r && r.width) { placeBy(box, r, wd, h, W, H); return; }
                        const cr = cv.getBoundingClientRect();
                        placeBy(box, { left: cr.left, right: cr.right, top: cr.top - 4, bottom: cr.top - 4 }, wd, h, W, H, true);
                    }); },
                };
                editor = ed;
                popFrame(ed, "scene", head, () => "scene", () => applyPopFont(ta, "scene"));
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
                // a pop-up editor stays open while the node is used; Esc here (nothing else pending) closes it, keeping the text
                if (editor && k === "escape" && !pick && !clickPoly) { e.preventDefault(); e.stopPropagation(); closeEditor(true); return; }
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
                    shapeKind = { r: "rect", o: "ellipse", t: "triangle" }[k]; setTool("shape");
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
                syncToolOpts();                              // the shape fields follow the selected layer
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
            // the layers listed under a region: its own and its holes (region 0 layers listed there), top first
            const listedOf = (rid) => {
                const out = [];
                for (let i = state.layers.length - 1; i >= 0; i--) {
                    const L = state.layers[i];
                    if (L.region === rid || (L.region === UNSPEC && holeOwner(L) === rid)) out.push(L);
                }
                return out;
            };
            // what an open row / subsection shows; empty subsections are left out
            const subKinds = (r) => [
                ...(listedOf(r.id).length ? ["layers"] : []),
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
                const n = kind === "layers" ? listedOf(r.id).length : kind === "loras" ? (r.loras || []).length : normPalette(r.palette).length;
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
                    const tag = el("span", "rg-hint"); tag.textContent = lo.control ? "Control" : lo.edit ? "Edit" : "LoRA";
                    if (lo.edit) {
                        tag.title = `Edit LoRA for ${lo.edit}, added by Edit Mode: Used only in Edit Mode with a ${lo.edit} model, `
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
                for (const L of listedOf(rid)) {
                    const hole = L.region === UNSPEC;
                    const row = el("div", "rg-row lvl1 layer" + (L.id === selId ? " sel" : "") + (hole ? " hole" : ""));
                    row.dataset.lid = String(L.id);
                    row.addEventListener("pointerdown", (e) => { if (e.target === row || e.target.classList.contains("rg-sw")) selectLayer(L); });
                    const eye = ico(L.visible === false ? "○" : "◉", "Show / hide (hidden layers are not output)", () => change(() => { L.visible = L.visible === false; }));
                    const sw = el("div", "rg-sw"); if (!hole) sw.style.background = colorOf(L.region) || "transparent";
                    sw.title = hole ? "A hole: Select this layer" : "Select this layer";
                    const cut = ico("✂", hole ? "Hole: On. This layer cuts its area out of every layer below it (no region there; black in "
                        + "color_map). Click to paint this region again." : "Hole: Off. Click to make this layer cut a hole through every "
                        + "layer below it (no region there).", () => toggleHole(L));
                    cut.classList.toggle("on", hole);
                    const name = el("input"); name.type = "text"; name.value = L.name; name.title = "Layer name";
                    name.addEventListener("focus", () => { if (selId !== L.id || hiddenSel === L.id) { selId = L.id; hiddenSel = null; curRegion = L.region; markLayerRows(); requestDraw(); } });
                    name.addEventListener("change", () => change(() => { L.name = name.value; }));
                    name.addEventListener("keydown", (e) => e.stopPropagation());
                    const up = ico("▲", L.region === UNSPEC ? "Move up one step in the stack (the hole then cuts through what it moved over)" : "Move up (in front of this region's other layers)", () => moveLayer(L, +1));
                    up.disabled = moveTarget(L, +1) < 0;
                    const dn = ico("▼", L.region === UNSPEC ? "Move down one step in the stack (what it moved under is no longer cut)" : "Move down (behind this region's other layers)", () => moveLayer(L, -1));
                    dn.disabled = moveTarget(L, -1) < 0;
                    const dup = ico("⧉", "Duplicate (Ctrl+D).\nRight-click: Duplicate into another region.", () => duplicate(L));
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
                    const er = ico("⌫", "Erase layer: Remove its shapes and paint, keep the empty layer", () => eraseLayer(L));
                    const del = ico("🗑", "Delete layer (Del)", () => deleteSelected(L));
                    row.append(eye, sw, name, cut, up, dn, dup, md, mv, er, del);
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
                    sw.title = pal.length ? `${colorOf(r.id)}: The region is shown in its first palette color. Click to change it.`
                        : `${r.color}: Click to change the color (display only).`;
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
                fIn.title = linked ? "Feather (px): Softens this region's mask edges in 'masks' and for its LoRAs. "
                    + "\nLinked: The same value for every linked region." : "Feather (px) of this region only (unlinked)";
                fIn.addEventListener("keydown", (e) => e.stopPropagation());
                fIn.addEventListener("change", () => {
                    const v = Math.max(0, Math.min(512, Math.round(+fIn.value || 0)));
                    change(() => { if (r.featherLinked !== false) state.feather = v; else r.feather = v; });
                });
                const fLink = el("button", "rg-btn mini toggle" + (linked ? " on" : ""));
                setHTML(fLink, svgIcon(linked ? "link" : "unlink"));
                fLink.title = linked ? "Linked: Every linked region uses the same feather. Click to give this region its own value."
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
                setHTML(fEdge, svgIcon("edges"));
                fEdge.title = r.featherEdges ? "feather_canvas_edges on: Edges on the image border fade too. Click to keep them solid."
                    : "feather_canvas_edges off: Edges on the image border stay solid. Click to fade them too.";
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
                b.title = r.paletteOn ? `Color palette on (${n} color${n === 1 ? "" : "s"}): Sent with the region in elements, `
                    + "the MOSS and Ideogram JSON prompts; the first color shows the region. Click to turn it off."
                    : "Color palette: Give this region up to 5 colors (MOSS 'palette' / Ideogram 'color_palette'). Click to turn it on.";
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
                tag.title = r.paletteOn ? "Color palette of this region" : "Color palette (off, so not used; turn it on with the palette button)";
                row.appendChild(tag);
                const pal = normPalette(r.palette);
                pal.forEach((c, i) => {
                    const sw = el("button", "rg-sw pal pick"); sw.type = "button"; sw.style.background = c;
                    sw.dataset.pal = `${r.id}:${i}`;
                    sw.title = `${c}: Click to change, right-click to remove` + (i === 0 ? " (the first color shows the region)." : ".");
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
                    else if (failed) tip = `LLM Prompt Enhancer on: The LLM returned nothing last time, so the typed prompt was used; it is tried again on the next run.`;
                    else tip = `LLM Prompt Enhancer on (preset '${preset}'): ${t.what} is rewritten when the workflow runs. Click to turn off.`;
                    // only touch the button when something changed: replacing its contents while the pointer rests
                    // on it (the 0.5 s poll) would cancel the browser's tooltip
                    const sig = [t.on, ready, failed, tip].join("|");
                    if (sig === shown) return;
                    shown = sig;
                    setHTML(b, sparkleSvg(t.on));
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
                // round 18: Control is a row you add (and remove with its ✕), not an always-there switch
                const ctlAdd = ico("＋Control", "Add the Control row: The model follows a color map, depth, canny or your own "
                    + "control_image (ControlNet / control LoRA; the files are set in Settings > Region Genie > Control)",
                    () => { expanded.add(CONTROL); setControl({ on: true }); }, "txt");
                if (state.control?.on) ctlAdd.style.display = "none";
                const nScene = (state.sceneLoras || []).length;
                const sGap = el("span"); sGap.style.flex = "1 1 auto";
                const sOpen = expanded.has(SCENE);
                scene.append(chevron(SCENE, true, `the whole-image LoRAs (${nScene})`), sl, sGap, llmButton(LLM_SCENE), sceneAdd, ctlAdd);
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

                if (isEdit()) regList.appendChild(editRow());
                if (state.control?.on) {
                    regList.appendChild(controlRow());
                    if (expanded.has(CONTROL)) regList.appendChild(controlDetails());
                }

                state.regions.forEach((r, i) => {
                    const lays = listedOf(r.id);
                    const row = el("div", "rg-row region" + (curRegion === r.id ? " sel" : "") + (r.hidden ? " off" : ""));
                    const pick = () => { if (activateRegion(r.id)) { markRegionRows(); requestDraw(); } };
                    row.addEventListener("pointerdown", (e) => { if (e.target === row || e.target.classList.contains("rg-idx") || e.target.classList.contains("rg-cnt")) pick(); });
                    const sw = regionSwatch(r, pick);
                    const ty = el("select", "rg-sel"); ty.title = "MOSS item type";
                    for (const v of TYPES) ty.appendChild(opt(v, v));
                    ty.value = r.type;
                    ty.addEventListener("change", () => change(() => { r.type = ty.value; }));
                    const pr = el("textarea", "rg-prompt"); pr.rows = 1; pr.placeholder = r.fromImage ? "prompt for this image color" : "prompt";
                    const dblTip = (v) => v || "";
                    pr.value = r.prompt; pr.dataset.rid = String(r.id); pr.spellcheck = false;
                    wcMark(pr, "r" + r.id, r.prompt, dblTip(r.prompt));
                    pr.addEventListener("blur", () => { pr.scrollTop = 0; wcMark(pr, "r" + r.id, r.prompt, dblTip(r.prompt)); refreshChips(r.id); });
                    // the expand button: the region's pop-up editor, next to this row
                    const openPop = (field, t) => () => { t.blur(); editPrompt(r.id, null, field); };
                    const prWrap = el("span", "rg-pwrap"); prWrap.appendChild(pr);
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
                    const eye = ico(r.hidden ? "○" : "◉", r.hidden ? "Hidden: Not drawn and not output. Click to show it again (its layers keep their own show / hide)"
                        : "Show / hide this region: A hidden region is not drawn and is left out of every output; its layers keep their own show / hide",
                        () => change(() => { if (r.hidden) delete r.hidden; else r.hidden = true; }));
                    eye.classList.add("rg-reye");
                    row.append(chevron(r.id, kinds.length > 0, "this region's " + (kinds.map((k) => ({ layers: "layers", loras: "LoRAs", palette: "palette" })[k]).join(", ") || "layers")), eye, ix, sw, ty, prWrap);
                    addExpandButton(pr, "Open this region in the pop-up editor", openPop("prompt", pr));
                    if (r.type === "text") {
                        // text to render: grows while edited, like the prompt (Shift+Enter = new line)
                        const tx = el("textarea", "rg-prompt rg-text"); tx.rows = 1; tx.placeholder = "text"; tx.value = r.text;
                        tx.spellcheck = false;
                        wcMark(tx, `r${r.id}.text`, r.text, dblTip(r.text || "Text to render"));
                        tx.addEventListener("focus", () => pick());
                        tx.addEventListener("blur", () => { tx.scrollTop = 0; wcMark(tx, `r${r.id}.text`, r.text, dblTip(r.text || "Text to render")); });

                        tx.addEventListener("input", () => { r.text = tx.value; save(); });
                        tx.addEventListener("keydown", (e) => {
                            e.stopPropagation();
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); tx.blur(); }
                        });
                        const txWrap = el("span", "rg-pwrap rg-twrap"); txWrap.appendChild(tx);
                        row.appendChild(txWrap);
                        addExpandButton(tx, "Open this region in the pop-up editor (its text to render)", openPop("text", tx));
                    }
                    const addL = ico("＋LoRA", "Apply a LoRA to this region (model output; MOSS-Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5)", (e) => { r.loras = r.loras || []; addLoraTo(r.loras, e, () => openSub(r.id, "loras")); }, "txt");
                    const mergeAll = ico("⇊", "Merge all visible layers of this region into one layer", () => mergeRegion(r.id));
                    mergeAll.disabled = lays.filter((l) => l.visible !== false).length < 2;
                    const up = ico("↑", "Move up: Earlier in the output order, and its layers in front", () => change(() => {
                        [state.regions[i - 1], state.regions[i]] = [state.regions[i], state.regions[i - 1]]; sortLayersByRegions(); }));
                    up.disabled = i === 0;
                    const down = ico("↓", "Move down: Later in the output order, and its layers behind", () => change(() => {
                        [state.regions[i + 1], state.regions[i]] = [state.regions[i], state.regions[i + 1]]; sortLayersByRegions(); }));
                    down.disabled = i === state.regions.length - 1;
                    const del = ico("✕", "Delete region and its layers", () => change(() => {
                        state.regions.splice(i, 1);
                        state.layers = state.layers.filter((l) => l.region !== r.id);
                        if (curRegion === r.id) curRegion = state.regions[0]?.id ?? null;
                        if (!selLayer()) selId = null;
                    }));
                    row.append(llmButton(r.id), ...(isEdit() ? [keepToggle(r)] : []), ...(state.control?.on ? [controlToggle(r)] : []), cnt, featherBox(r), paletteToggle(r), addL,
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
                const ids = state.regions.map((r) => r.id);
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
            function onEditModeChanged() {
                hideMsg();
                const arch = modelArch(), all = editLoras();
                const probe = JSON.stringify(state.sceneLoras || []);
                const before = snapshot();
                if (syncEditLoras() && JSON.stringify(state.sceneLoras || []) !== probe) { pushUndo(before); save(); }
                if (isEdit()) {
                    if (!all.length) hint("Edit Mode: no edit LoRA is set in Settings > Region Genie > Edit Mode");
                    else if (arch && !all.some(([m]) => m === arch)) hint(`Edit Mode: no edit LoRA is set for ${arch} in Settings > Region Genie > Edit Mode`);
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
                if (Array.isArray(message?.prompt_format)) { lastFormat = String(message.prompt_format[0] || "") || null; syncModelSel(); }
                if (Array.isArray(message?.model_arch) && message.model_arch[0]) {
                    node.properties = node.properties || {};
                    node.properties.rg_model_arch = String(message.model_arch[0]);
                    node.properties.rg_model_src = guessArch().sig;
                    onModelChanged(true);
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
                let missing = null;
                try { missing = JSON.parse(message?.control_missing?.[0] || "null"); } catch (e) { /* ignore */ }
                if (Array.isArray(missing) && missing.length) showControlMissing(missing);
                const cm = Array.isArray(message?.control_map) ? message.control_map[0] : null;
                if (cm?.filename) {
                    const key = cm.filename + cm.subfolder;
                    if (key !== controlMapKey) {
                        controlMapKey = key;
                        const img = new Image();
                        img.onload = () => { controlMap = img; renderRegions(); requestDraw(); };
                        img.src = api.apiURL(`/view?filename=${encodeURIComponent(cm.filename)}&type=${cm.type}&subfolder=${encodeURIComponent(cm.subfolder || "")}&t=${Date.now()}`);
                    }
                }
                if (state.control?.on && Array.isArray(message?.model_arch) && message.model_arch[0]) {
                    const before = JSON.stringify(state.sceneLoras || []);
                    if (syncControlLoras() && JSON.stringify(state.sceneLoras || []) !== before) { save(); renderRegions(); }
                }
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
                moveSizeLinks(); setTimeout(() => { sizeCfg(); syncSizeRow(true); onDimsChanged(); }, 0); fixImportMode(); migrateFormat(); if (node.properties?.rg_list_h) cvBox.style.minHeight = CV_MIN + "px"; applyListH(); load(); pushLlmCache(); syncLlm(); updateLlmButtons(); });
            for (const w of [wW, hW]) if (w) chain(w, "callback", () => onDimsChanged());
            if (modeW) chain(modeW, "callback", () => requestDraw());

            const ro = new ResizeObserver(() => requestDraw());
            ro.observe(cvBox);
            sizeReady = true; syncSizeRow();
            const poll = setInterval(() => {
                if (editor && nodeOffCanvas(node)) closeEditor(true);     // another workflow tab, a subgraph, removed
                if (!node.graph) return;
                if (pruneManagedLoras()) { save(); renderRegions(); }
                fixImportMode();
                syncSettings();
                applyFieldFonts();
                onModelChanged(false);
                labelSizeInputs();
                onDimsChanged();
                liveBackdrop();
                syncLlm();
                updateLlmButtons();
            }, 500);
            chain(node, "onRemoved", function () {
                clearInterval(poll); closeEditor(true); ro.disconnect(); offLlmLib(); closeLlmSettings(); lassoRefreshers.delete(refreshVariantButtons); closeArrange(); if (pick) pickCancel();
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
            node.__rgSetTool = (t) => setTool(t);
            node.__rgSelectLayer = (id) => selectLayer(state.layers.find((l) => l.id === id) || null);    // tests
            node.__rgToolTips = () => Object.values(GROUPS).flatMap((g) => g.entries().map((e) => e[2]));   // tests: every tool version's tooltip
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
