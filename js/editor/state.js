// paint_data: the editor's saved state (format, loading, converting older data).
import { OLD_MOSS, MOSS } from "../rg_shared.js";
import { TYPES, UNSPEC } from "./shared.js";
import { normPalette } from "./colors.js";

// Layered region editor of the "Region Genie" node.
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

export const NODE_NAMES = ["Region-Genie_Main"];

// ---- state / migration ----------------------------------------------------
export function emptyState() { return { v: 2, regions: [], layers: [] }; }

function normLoras(a) {
    return (Array.isArray(a) ? a : []).filter((x) => x && typeof x.lora === "string")
        .map((x) => ({ lora: x.lora, strength: Number.isFinite(+x.strength) ? +x.strength : 1, on: x.on !== false,
                       ...(typeof x.edit === "string" && x.edit ? { edit: x.edit === OLD_MOSS ? MOSS : x.edit } : {}),        // edit: added by Edit Mode, for that model
                       // control: added by the Control row, for that model (ckind: moss / depth / canny)
                       ...(typeof x.control === "string" && x.control ? { control: x.control === OLD_MOSS ? MOSS : x.control, ckind: String(x.ckind || "") } : {}) }));
}
export function normLoraOpts(o) {
    o = o && typeof o === "object" ? o : {};
    const clamp = (v, d) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : d);
    // autoOff: 'keep all regions apart' is off for this node, also where a run would turn it on by itself
    return { separation: clamp(o.separation, 0.85), until: clamp(o.until, 0.25), ...(o.allRegions ? { allRegions: true } : {}),
             ...(o.autoOff && !o.allRegions ? { autoOff: true } : {}),
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
export function normEditMask(m) {
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

export function parseState(text, W, H) {
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
        // round 23: the Control rows (before: one 'control' with 'on') and the Edit rows (the Settings one can be removed
        // for this node; ＋Edit adds this node's own)
        ...(normControls(d).length ? { controls: normControls(d) } : {}),
        ...(normControl(d.controlLast) ? { controlLast: normControl(d.controlLast) } : {}),
        ...(d.editOff ? { editOff: true } : {}),
        ...(Array.isArray(d.editLoras) ? { editLoras: d.editLoras.filter((x) => x && typeof x === "object")
            .map((x) => ({ lora: typeof x.lora === "string" ? x.lora : "", strength: Number.isFinite(+x.strength) ? +x.strength : 1, on: x.on !== false })) } : {}),
    };
}
function normControls(d) {
    if (Array.isArray(d.controls)) return d.controls.map(normControl).filter(Boolean);
    const c = normControl(d.control);
    return c && d.control.on ? [c] : [];
}
// the Control row: on / off, what the map is, strength and the part of the steps (fractions 0..1)
const CONTROL_KINDS = ["color", "color+depth", "depth", "canny", "other"];
function normControl(c) {
    if (!c || typeof c !== "object") return null;
    const n = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
    return { kind: CONTROL_KINDS.includes(c.kind) ? c.kind : "depth", strength: n(c.strength, 1, 0, 10),
             start: n(c.start, 0, 0, 1), end: n(c.end, 1, 0, 1) };
}
