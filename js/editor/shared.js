// Constants and values shared by every Region Genie node on the page (tool versions, the layer clipboard, sizes).
import { getSetting, setSetting, toolDefault, onToolDefault, toolNumber, TOOL_NUMBERS } from "../rg_shared.js";

// values this pack just wrote to Settings, read back before the Settings store has them (it saves asynchronously)
const RG_RECENT = new Map();
export const recentSetting = (id, dflt) => (RG_RECENT.has(id) ? RG_RECENT.get(id) : getSetting(id, dflt));
export const rememberSetting = (id, v) => { RG_RECENT.set(id, v); setSetting(id, v); setTimeout(() => { if (RG_RECENT.get(id) === v) RG_RECENT.delete(id); }, 3000); };
// distinct, saturated region-ID colors (none near black); Python uses the same list
export const PALETTE = [
    "#E6194B", "#3CB44B", "#FFE119", "#4363D8", "#F58231", "#911EB4", "#42D4F4", "#F032E6",
    "#BFEF45", "#FABED4", "#469990", "#DCBEFF", "#9A6324", "#FFFAC8", "#800000", "#AAFFC3",
    "#808000", "#FFD8B1", "#000075", "#A9A9A9", "#FFFFFF", "#00FF7F", "#FF4500", "#1E90FF",
];
// Lasso / Lasso erase: plain (straight lines) or spline (a smooth curve). They start as set in Settings > Region
// Genie > Canvas tools; right-click either button to choose, which is kept for the rest of the session (all Region
// Genie nodes on the page) until that setting is changed.
// The same for the other tools with variants (magic wand, fill), and their numbers (wand tolerance, fill gap).
export const LASSO_MODES = { lasso: "plain", lassoErase: "plain", wand: "contiguous", fill: "normal" };
export const TOOL_NUMS = { wandTol: 32, fillGap: 4 };
let lassoInit = false;
export const lassoRefreshers = new Set();               // each node's refreshVariantButtons
export function initLassoModes() {
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

export const SHAPES = [["rect", "Rectangle"], ["roundrect", "Rounded rectangle"], ["ellipse", "Ellipse"], ["triangle", "Triangle"],
                ["pentagon", "Pentagon"], ["hexagon", "Hexagon"], ["star", "Star"], ["heart", "Heart"]];
export const SHAPE_NAMES = Object.fromEntries([...SHAPES, ["polygon", "Polygon"]]);
export const TYPES = ["object", "character", "text"];
export const UNSPEC = 0, ALL = "all";
export const HISTORY = 100;
export const DEFAULT_W = 700;                 // default node width (CSS px)
export const CLIPBOARD = { layer: null };  // Ctrl+C / Ctrl+X: a copy of a layer, shared by all Region Genie nodes
export const DEFAULT_H = 1429;                // default height: square canvas at DEFAULT_W in legacy mode (fine-tuned on creation)
export const RASTER_MAX = 2048;          // longest side of fill / merge rasters

export const LAYOUT_FORMAT = "region_genie_layout";
