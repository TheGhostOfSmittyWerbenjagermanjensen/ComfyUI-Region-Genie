// Region Genie: helpers shared by the editors (LoRA list and picker, trigger words, icons,
// tag autocomplete from ComfyUI-Lora-Manager). Not an extension by itself.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { openColorPicker } from "./rg_colorpicker.js";
import "./rg_tooltip.js";                 // the pack's own tooltip takes over every title in the pack's elements

// ---------------------------------------------------------------- icons (16x16, stroke = text color)
// The marks on a region's label (round 41): filled shapes, so they read at 11 px on any region color. They replace
// the 👤 / 🔒 emoji, which the system drew in its own colors. 16-unit grid; 'fill' is a filled path, 'stroke' an open
// one of 'width'. The canvas draws them with Path2D (drawLabelMark in js/editor/render.js), the lists as icons
// (markPerson, markLock below).
export const LABEL_MARKS = {
    person: { fill: "M8 1.6a3.1 3.1 0 1 0 0 6.2a3.1 3.1 0 0 0 0-6.2zM2.3 14.7a5.7 5.7 0 0 1 11.4 0z" },
    lock: { fill: "M4.1 7.1h7.8a1.6 1.6 0 0 1 1.6 1.6v4.5a1.6 1.6 0 0 1-1.6 1.6H4.1a1.6 1.6 0 0 1-1.6-1.6V8.7a1.6 1.6 0 0 1 1.6-1.6z",
            stroke: "M5.1 7.3V4.9a2.9 2.9 0 0 1 5.8 0v2.4", width: 1.8 },
};
const markSvg = (m) => `<path d="${m.fill}" fill="currentColor" stroke="none"/>` + (m.stroke ? `<path d="${m.stroke}" stroke-width="${m.width}"/>` : "");
export const ICONS = {
    markPerson: markSvg(LABEL_MARKS.person),
    markLock: markSvg(LABEL_MARKS.lock),
    select: '<path d="M3.5 2l8.5 6-3.6.9 2 3.9-1.6.8-2-3.9L4.2 12.3z" fill="currentColor" stroke="none"/>',
    shape: '<rect x="2" y="2" width="7.5" height="7.5"/><circle cx="11" cy="11" r="3.4"/>',
    brush: '<path d="M14 2L8.3 8.4"/><path d="M8.6 8.1c-1.9-.6-3.7.3-3.9 2.3-.1 1.3-.9 2.1-2.2 2.3 1.6 1.4 5.6 1.2 6.4-1.2.4-1.2.2-2.3-.3-3.4z"/>',
    lasso: '<ellipse cx="8.8" cy="6" rx="5.4" ry="3.6"/><path d="M5.2 8.7c-1.5.8-1.3 2.5.1 2.9 1.3.4 1.7 1.7.8 2.9"/>',
    fill: '<path d="M2.6 7.6L7.4 2.8l5 5-4.8 4.8a1.3 1.3 0 0 1-1.8 0L2.6 9.4a1.3 1.3 0 0 1 0-1.8z"/><path d="M2.8 8h9.4"/><path d="M13.6 10.2c.7 1 1.1 1.7 1.1 2.3a1.1 1.1 0 0 1-2.2 0c0-.6.4-1.3 1.1-2.3z" fill="currentColor"/>',
    erase: '<path d="M6.2 13.5L2.8 10.1a1.3 1.3 0 0 1 0-1.8l5.6-5.6a1.3 1.3 0 0 1 1.8 0l3.4 3.4a1.3 1.3 0 0 1 0 1.8l-5.6 5.6z"/><path d="M5.4 5.6l5 5"/><path d="M6.2 13.5h7.6"/>',
    lassoSpline: '<path d="M2.6 7.6C2.2 4.2 6.4 2.2 10.2 2.6c3.4.4 4.6 3 2.6 4.6-1.8 1.4-5.4 1.8-8.2 1"/><path d="M4.4 8.4c-1.4.9-1 2.4.3 2.8 1.3.4 1.6 1.7.7 2.8"/><rect x="1.3" y="6.3" width="2.6" height="2.6" fill="currentColor" stroke="none"/><rect x="8.9" y="1.3" width="2.6" height="2.6" fill="currentColor" stroke="none"/><rect x="12.4" y="4.9" width="2.6" height="2.6" fill="currentColor" stroke="none"/>',
    lassoEraseSpline: '<ellipse cx="7.6" cy="6.4" rx="5.4" ry="3.7" stroke-dasharray="2.2 1.6"/><rect x="0.9" y="5.1" width="2.6" height="2.6" fill="currentColor" stroke="none"/><rect x="6.3" y="1.4" width="2.6" height="2.6" fill="currentColor" stroke="none"/><rect x="11.7" y="5.1" width="2.6" height="2.6" fill="currentColor" stroke="none"/><path d="M10.6 10.6l3.6 3.6M14.2 10.6l-3.6 3.6"/>',
    lassoErase: '<ellipse cx="7.6" cy="6.4" rx="5.4" ry="3.7" stroke-dasharray="2.2 1.6"/><path d="M10.6 10.6l3.6 3.6M14.2 10.6l-3.6 3.6"/>',
    edges: '<rect x="2.5" y="2.5" width="11" height="11" stroke-dasharray="2 1.6"/><rect x="5.5" y="5.5" width="5" height="5" fill="currentColor" stroke="none" opacity=".55"/>',
    regionAdd: '<rect x="1.5" y="3" width="9" height="9" rx="1.5"/><path d="M13 1.8v4.4M10.8 4h4.4"/>',
    grip: '<g fill="currentColor" stroke="none"><circle cx="5.5" cy="3.5" r="1.2"/><circle cx="10.5" cy="3.5" r="1.2"/><circle cx="5.5" cy="8" r="1.2"/><circle cx="10.5" cy="8" r="1.2"/><circle cx="5.5" cy="12.5" r="1.2"/><circle cx="10.5" cy="12.5" r="1.2"/></g>',
    allApart: '<rect x="1.5" y="1.5" width="5.2" height="5.2" rx="1"/><rect x="9.3" y="1.5" width="5.2" height="5.2" rx="1"/><rect x="1.5" y="9.3" width="5.2" height="5.2" rx="1"/><rect x="9.3" y="9.3" width="5.2" height="5.2" rx="1"/>',
    // the four tiles on a shaded backdrop: kept apart from each other, the background shared
    allApartShared: '<rect x="0.6" y="0.6" width="14.8" height="14.8" rx="2" fill="currentColor" stroke="none" opacity=".32"/><rect x="2.4" y="2.4" width="4.4" height="4.4" rx=".9"/><rect x="9.2" y="2.4" width="4.4" height="4.4" rx=".9"/><rect x="2.4" y="9.2" width="4.4" height="4.4" rx=".9"/><rect x="9.2" y="9.2" width="4.4" height="4.4" rx=".9"/>',
    // image input: traced over (backdrop) / read as the color map
    imgBackdrop: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4"/><path d="M1.8 11l3.6-3.6 3 3 2-2 3.8 3.8"/><circle cx="10.6" cy="5.9" r="1.1"/>',
    imgColorMap: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4"/><path d="M8 2.8v10.4M1.8 8h6.2"/><rect x="2.6" y="3.6" width="4.6" height="3.6" fill="currentColor" stroke="none" opacity=".55"/><rect x="8.8" y="8.8" width="4.6" height="3.6" fill="currentColor" stroke="none" opacity=".55"/>',
    // image size row: aspect ratio + megapixels (Resolution Selector) / presets list / manual width and height
    sizeRatio: '<rect x="1.8" y="3.8" width="12.4" height="8.4" rx="1.2"/><path d="M4.4 9.6l7.2-3.2" stroke-dasharray="1.6 1.3"/>',
    sizeList: '<rect x="1.8" y="2.4" width="12.4" height="11.2" rx="1.2"/><path d="M4.4 5.6h7.2M4.4 8h7.2M4.4 10.4h4.6"/>',
    sizeManual: '<rect x="1.8" y="3.8" width="12.4" height="8.4" rx="1.2"/><path d="M4.4 8h2.6M9 8h2.6M5.3 6.6L4.2 8l1.1 1.4M10.7 6.6L11.8 8l-1.1 1.4"/>',
    // wildcards (Impact Pack): the picker / seed label, seed modes (fixed = lock), use the filled text
    wildcard: '<path d="M5.4 2.6c-1.4 0-2 .7-2 2v1.6c0 .9-.5 1.5-1.4 1.8.9.3 1.4.9 1.4 1.8v1.6c0 1.3.6 2 2 2"/><path d="M10.6 2.6c1.4 0 2 .7 2 2v1.6c0 .9.5 1.5 1.4 1.8-.9.3-1.4.9-1.4 1.8v1.6c0 1.3-.6 2-2 2"/><path d="M8 5.4v5.2M5.8 6.7l4.4 2.6M10.2 6.7L5.8 9.3" stroke-width="1.2"/>',
    plusOne: '<path d="M2.4 8h4.4M4.6 5.8v4.4"/><path d="M9.6 5.2l2-1.6v8.8"/>',
    useFilled: '<path d="M8 1.8v7.6M4.8 6.4L8 9.6l3.2-3.2"/><path d="M2.4 12.8h11.2"/>',
    // Control (ControlNet): contour lines of a depth map
    control: '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.6"/><path d="M1.8 11.2c2.4-2.6 4.6-3.4 6.8-2.4s3.8.6 5.6-1.4"/><path d="M1.8 7.4c2-2 4-2.6 6-1.8s3.6.4 6.4-2" stroke-dasharray="1.6 1.4"/>',
    controlOff: '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.6" stroke-dasharray="2 1.6"/><path d="M1.8 11.2c2.4-2.6 4.6-3.4 6.8-2.4s3.8.6 5.6-1.4" opacity=".5"/><path d="M2.4 13.6L13.6 2.4"/>',
    // the shape tool shows the shape it draws
    shapeRect: '<rect x="2.2" y="3.4" width="11.6" height="9.2" rx=".4"/>',
    shapeRoundrect: '<rect x="2.2" y="3.4" width="11.6" height="9.2" rx="2.8"/>',
    shapeEllipse: '<ellipse cx="8" cy="8" rx="6" ry="4.8"/>',
    shapeTriangle: '<path d="M8 2.4l6 11.2H2z"/>',
    shapePentagon: '<path d="M8 2l6 4.4-2.3 7.2H4.3L2 6.4z"/>',
    shapeHexagon: '<path d="M4.6 2.4h6.8L14.8 8l-3.4 5.6H4.6L1.2 8z"/>',
    shapeStar: '<path d="M8 1.8l1.8 4 4.4.4-3.3 2.9 1 4.3L8 11.1l-3.9 2.3 1-4.3-3.3-2.9 4.4-.4z"/>',
    shapeHeart: '<path d="M8 13.6S2 9.9 2 5.9A3.1 3.1 0 0 1 8 4.6a3.1 3.1 0 0 1 6 1.3c0 4-6 7.7-6 7.7z"/>',
    // image opacity (the slider on the canvas's right edge)
    opacity: '<circle cx="8" cy="8" r="5.8"/><path d="M8 2.2v11.6A5.8 5.8 0 0 0 8 2.2z" fill="currentColor" stroke="none"/>',
    // Select object (SAM): a frame, a figure and a pointer
    samSelect: '<path d="M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M14 11v2a1 1 0 0 1-1 1h-2M5 14H3a1 1 0 0 1-1-1v-2"/><circle cx="6.6" cy="5.8" r="1.6"/><path d="M3.8 11c.3-1.7 1.4-2.8 2.8-2.8"/><path d="M8.8 8.2l4.6 1.8-2 .8-.8 2z" fill="currentColor" stroke-width="1"/>',
    // magic wand (contiguous) and its 'all similar colors' variant
    wand: '<path d="M2.4 13.6l7.4-7.4"/><path d="M9.2 4.6l2.2 2.2"/><path d="M11.8 1.6v2M14.4 4.2h-2M13.6 2.4l-1.2 1.2M9.6 2.4l.9.9M13.6 6.4l-.9-.9"/>',
    wandGlobal: '<path d="M2.4 13.6l7.4-7.4"/><path d="M9.2 4.6l2.2 2.2"/><path d="M11.8 1.6v2M14.4 4.2h-2M13.6 2.4l-1.2 1.2M9.6 2.4l.9.9M13.6 6.4l-.9-.9"/><circle cx="3.2" cy="4" r="1.3" fill="currentColor" stroke="none"/><circle cx="12.6" cy="12.4" r="1.3" fill="currentColor" stroke="none"/>',
    fillLinear: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5.2 2.5v11" stroke-width="2.4"/><path d="M8.4 2.5v11" stroke-width="1.5"/><path d="M11.2 2.5v11" stroke-width=".7"/>',
    fillRadial: '<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="1.9" fill="currentColor"/><circle cx="8" cy="8" r="3.8" stroke-width=".8"/>',
    fillGaps: '<path d="M2.6 7.6L7.4 2.8l5 5-4.8 4.8a1.3 1.3 0 0 1-1.8 0L2.6 9.4a1.3 1.3 0 0 1 0-1.8z"/><path d="M2.8 8h9.4"/><path d="M12.6 10.4v1.4M12.6 13.2v1.4M14.6 12.4h-1.2M11.8 12.4h-1.2" stroke-width="1.2"/>',
    lassoMagnetic: '<ellipse cx="8.8" cy="6" rx="5.4" ry="3.6"/><path d="M5.2 8.7c-1.5.8-1.3 2.5.1 2.9"/><path d="M8.2 10.6h1.8v2.6a1 1 0 0 0 2 0v-2.6h1.8v2.6a2.8 2.8 0 0 1-5.6 0z" stroke-width="1.2"/>',
    lassoEraseMagnetic: '<ellipse cx="7.6" cy="6.4" rx="5.4" ry="3.7" stroke-dasharray="2.2 1.6"/><path d="M1.4 10.6h1.8v2.2a1 1 0 0 0 2 0v-2.2h1.8v2.2a2.8 2.8 0 0 1-5.6 0z" stroke-width="1.2"/><path d="M10.6 10.6l3.6 3.6M14.2 10.6l-3.6 3.6"/>',
    // the selected layer: flip, align, grow / shrink (one button, a small panel)
    arrange: '<rect x="2" y="2" width="5" height="5" rx=".8"/><rect x="9" y="9" width="5" height="5" rx=".8"/><path d="M9.5 3.5h3v3M6.5 12.5h-3v-3"/><path d="M12.5 3.5l-3 3M3.5 12.5l3-3"/>',
    flipH: '<path d="M8 1.6v12.8" stroke-dasharray="1.6 1.4"/><path d="M6 4L2 12h4z"/><path d="M10 4l4 8h-4z" fill="currentColor" stroke="none" opacity=".55"/>',
    flipV: '<path d="M1.6 8h12.8" stroke-dasharray="1.6 1.4"/><path d="M4 6L12 2v4z"/><path d="M4 10l8 4v-4z" fill="currentColor" stroke="none" opacity=".55"/>',
    alignL: '<path d="M2.4 1.8v12.4"/><rect x="4.4" y="3.6" width="8.6" height="3.2" rx=".6"/><rect x="4.4" y="9.2" width="5.4" height="3.2" rx=".6"/>',
    alignCH: '<path d="M8 1.8v12.4"/><rect x="3.4" y="3.6" width="9.2" height="3.2" rx=".6"/><rect x="5" y="9.2" width="6" height="3.2" rx=".6"/>',
    alignR: '<path d="M13.6 1.8v12.4"/><rect x="3" y="3.6" width="8.6" height="3.2" rx=".6"/><rect x="6.2" y="9.2" width="5.4" height="3.2" rx=".6"/>',
    alignT: '<path d="M1.8 2.4h12.4"/><rect x="3.6" y="4.4" width="3.2" height="8.6" rx=".6"/><rect x="9.2" y="4.4" width="3.2" height="5.4" rx=".6"/>',
    alignCV: '<path d="M1.8 8h12.4"/><rect x="3.6" y="3.4" width="3.2" height="9.2" rx=".6"/><rect x="9.2" y="5" width="3.2" height="6" rx=".6"/>',
    alignB: '<path d="M1.8 13.6h12.4"/><rect x="3.6" y="3" width="3.2" height="8.6" rx=".6"/><rect x="9.2" y="6.2" width="3.2" height="5.4" rx=".6"/>',
    alignCenter: '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.2" stroke-dasharray="2 1.6"/><rect x="5.4" y="5.4" width="5.2" height="5.2" rx=".8"/>',
    layerGrow: '<rect x="5.2" y="5.2" width="5.6" height="5.6" rx="1"/><path d="M8 4.2V1.6M8 11.8v2.6M4.2 8H1.6M11.8 8h2.6M6.8 2.8L8 1.6l1.2 1.2M6.8 13.2L8 14.4l1.2-1.2M2.8 6.8L1.6 8l1.2 1.2M13.2 6.8L14.4 8l-1.2 1.2"/>',
    layerShrink: '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.5" stroke-dasharray="2 1.7"/><rect x="6" y="6" width="4" height="4" rx=".8"/><path d="M8 2.6v2.2M8 13.4v-2.2M2.6 8h2.2M13.4 8h-2.2"/>',
    // the edit mask grows (or shrinks) by this many px
    maskGrow: '<rect x="5.2" y="5.2" width="5.6" height="5.6" rx="1" fill="currentColor" stroke="none" opacity=".55"/><rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.5" stroke-dasharray="2 1.7"/><path d="M8 4.6V2.9M8 11.4v1.7M4.6 8H2.9M11.4 8h1.7"/>',
    mossLayout: '<rect x="1.5" y="2" width="13" height="12" rx="1.5"/><rect x="3.5" y="4" width="4.5" height="4" rx=".6"/><rect x="9" y="7.5" width="3.5" height="4.5" rx=".6"/>',
    mossStandard: '<rect x="1.5" y="2" width="13" height="12" rx="1.5"/><path d="M4 5.5h8M4 8h8M4 10.5h5"/>',
};
// General-purpose icons, taken from Lucide 1.76 (https://lucide.dev, ISC license: see THIRD-PARTY-NOTICES.md). They are
// drawn on a 24-unit grid; svgIcon() draws them at the weight of the pack's own 16-unit drawings above. To add one:
// copy the inside of its .svg here, under the name the code uses (the comment keeps Lucide's name).
export const LUCIDE = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',   // undo-2
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',   // redo-2
    clear: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',   // trash-2
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',   // eye
    eyeOff: '<path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/><path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/>',   // eye-closed
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',   // link
    unlink: '<path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" x2="8" y1="2" y2="5"/><line x1="2" x2="5" y1="8" y2="8"/><line x1="16" x2="16" y1="19" y2="22"/><line x1="19" x2="22" y1="16" y2="16"/>',   // unlink
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',   // pencil
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',   // lock
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',   // tag
    tagOff: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/><path d="m2 2 20 20"/>',   // tag + a slash
    magnet: '<path d="m12 15 4 4"/><path d="M2.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.029-6.029a1 1 0 1 1 3 3l-6.029 6.029a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.365-6.367A1 1 0 0 0 8.716 4.282z"/><path d="m5 8 4 4"/>',   // magnet
    magnetOff: '<path d="m12 15 4 4"/><path d="M2.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.029-6.029a1 1 0 1 1 3 3l-6.029 6.029a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.365-6.367A1 1 0 0 0 8.716 4.282z"/><path d="m5 8 4 4"/><path d="m2 2 20 20"/>',   // magnet + a slash
    dice: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M16 8h.01"/><path d="M8 8h.01"/><path d="M8 16h.01"/><path d="M16 16h.01"/><path d="M12 12h.01"/>',   // dice-5
    check: '<path d="M20 6 9 17l-5-5"/>',   // check
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',   // x
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',   // folder
    palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',   // palette
    layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',   // layers
    layerAdd: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 .83.18 2 2 0 0 0 .83-.18l8.58-3.9a1 1 0 0 0 0-1.831z"/><path d="M16 17h6"/><path d="M19 14v6"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 .825.178"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l2.116-.962"/>',   // layers-plus
    expand: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',   // maximize-2
    feather: '<path d="M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z"/><path d="M16 8 2 22"/><path d="M17.488 15H9"/>',   // feather
    swapWH: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',   // arrow-down-up
    up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',   // arrow-up
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',   // arrow-down
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',   // copy
    scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',   // scissors
    mergeDown: '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',   // arrow-down-to-line
    mergeAll: '<g transform="rotate(180 12 12)"><path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/></g>',   // merge, turned upside down
    moveTo: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',   // arrow-left-right
    eraseLayer: '<path d="M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><path d="m12 9 6 6"/><path d="m18 9-6 6"/>',   // delete
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',   // rotate-ccw
    folderUp: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="m9 13 3-3 3 3"/>',   // folder-up
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',   // plus
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',   // triangle-alert
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',   // info
    keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',   // keyboard
    sockets: '<path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z"/><path d="M17 21v-2"/><path d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10"/><path d="M21 21v-2"/><path d="M3 5V3"/><path d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z"/><path d="M7 5V3"/>',   // cable
    fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',   // maximize
};
const SVG_ATTRS = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
export const svgIcon = (name) => (LUCIDE[name]
    ? `<svg viewBox="0 0 24 24" ${SVG_ATTRS} stroke-width="2.25">${LUCIDE[name]}</svg>`
    : `<svg viewBox="0 0 16 16" ${SVG_ATTRS} stroke-width="1.5">${ICONS[name]}</svg>`);
// a button whose whole label is one icon (every editor and pop-up of the pack uses it, so the rule lives here)
if (typeof document !== "undefined" && !document.getElementById("rg-ib-style")) {
    const st = document.createElement("style"); st.id = "rg-ib-style";
    st.textContent = `.rg-ib { display:inline-flex; align-items:center; justify-content:center; }
.rg-ib > svg { width:14px; height:14px; display:block; flex:0 0 auto; pointer-events:none; }
.rg-btn.rg-x { display:inline-flex; align-items:center; }
.rg-x > svg { width:13px; height:13px; display:block; pointer-events:none; }`;
    document.head.appendChild(st);
}
// set an element's content only when it changes: replacing what is under the mouse restarts (and so hides) its tooltip
export const setHTML = (e, html) => { if (e && e.__rgHtml !== html) { e.__rgHtml = html; e.innerHTML = html; } };


// ---------------------------------------------------------------- widget values
// Widget values are saved by position, and some frontend versions line positions up differently on load
// (they count connection-only inputs), which shifts values into the wrong widgets. Keep a copy by name
// in the node's properties and put each value back where it belongs after loading.
export function keepWidgetValuesByName(node, names) {
    // the values a new node starts with: a loaded value that can't be right for its widget (a choice not in its
    // list, or another type, e.g. a workflow saved before a widget was added shifts its neighbour's value into it)
    // goes back to this
    const initial = {};
    for (const n of names) { const w = node.widgets?.find((x) => x.name === n); if (w) initial[n] = w.value; }
    const fixInvalid = () => {
        for (const n of names) {
            const w = node.widgets?.find((x) => x.name === n);
            if (!w || !(n in initial)) continue;
            const opts = w.options?.values, d = initial[n];
            const bad = Array.isArray(opts) ? !opts.includes(w.value) : (d !== undefined && d !== null && typeof w.value !== typeof d);
            if (bad) w.value = d;
        }
    };
    const onSerialize = node.onSerialize;
    node.onSerialize = function (o) {
        const r = onSerialize?.apply(this, arguments);
        const vals = {};
        for (const n of names) { const w = this.widgets?.find((w) => w.name === n); if (w) vals[n] = w.value; }
        o.properties = o.properties || {};
        o.properties.rg_widget_values = vals;
        return r;
    };
    const restore = (vals) => {
        if (!vals || typeof vals !== "object") vals = {};
        for (const [n, v] of Object.entries(vals)) {
            const w = node.widgets?.find((w) => w.name === n);
            if (!w || v === undefined || w.value === v) continue;
            const opts = w.options?.values;
            if (Array.isArray(opts) && !opts.includes(v)) continue;
            w.value = v;
        }
        fixInvalid();
        node.setDirtyCanvas?.(true, true);
    };
    const onConfigure = node.onConfigure;
    node.onConfigure = function (info) {
        const r = onConfigure?.apply(this, arguments);
        const vals = info?.properties?.rg_widget_values;
        restore(vals || {});
        setTimeout(() => restore(vals || {}), 0);
        return r;
    };
}

// ---------------------------------------------------------------- LoRA files
let loraList = null, loraTime = 0, loraPromise = null;
export const knownLoras = () => loraList;
// other model folders' file lists (ControlNet, model patches, Depth Anything 3), read once and on request
const modelLists = {};
export function knownModels(folder, refresh = false) {
    if (!modelLists[folder] || refresh) {
        modelLists[folder] = modelLists[folder] || { list: [] };
        api.fetchApi(`/models/${folder}`).then((r) => (r.ok ? r.json() : [])).then((l) => { if (Array.isArray(l)) modelLists[folder].list = l; }).catch(() => {});
    }
    return modelLists[folder].list;
}

// ---------------------------------------------------------------- model files anywhere (round 18)
// A model-file setting holds a name ComfyUI knows (relative to one of its folders for that type) or a full path the
// user browsed to (Stability Matrix and other setups keep models outside ComfyUI/models). Python: model_paths.py.
export const isFullPath = (v) => typeof v === "string" && (/^[a-zA-Z]:[\\/]/.test(v) || /^[\\/]/.test(v));
export const fileBase = (v) => String(v || "").split(/[\\/]/).pop();
// every file ComfyUI lists for these folder types: [{ name, folder }]
const fileListCache = new Map();          // folders -> { t, p }: the lists are fetched at most every 5 s
export function listModelFiles(folders, force = false) {
    const k = folders.join(","), c = fileListCache.get(k);
    if (c && !force && performance.now() - c.t < 5000) return c.p;
    const p = fetchModelFiles(folders);
    fileListCache.set(k, { t: performance.now(), p });
    return p;
}
async function fetchModelFiles(folders) {
    const out = [], seen = new Set();
    for (const f of folders) {
        let l = [];
        try { const r = await api.fetchApi(`/models/${f}`); l = r.ok ? await r.json() : []; } catch (e) { l = []; }
        for (const x of Array.isArray(l) ? l : []) {
            const n = typeof x === "string" ? x : x?.name;
            const key = f + "\n" + n;         // per folder: the same name can be in two model folders
            if (n && !seen.has(key)) { seen.add(key); out.push({ name: n, folder: f }); }
        }
        if (modelLists[f]) modelLists[f].list = (Array.isArray(l) ? l : []).map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean);
    }
    if (folders.includes("loras")) { loraList = out.filter((x) => x.folder === "loras").map((x) => x.name); loraTime = performance.now(); }
    return out;
}
// whether the server finds a set file (a name in one of the folders, or a full path)
export async function modelFileFound(folders, name) {
    try {
        const r = await api.fetchApi(`/region_genie/model_exists?folders=${encodeURIComponent(folders.join(","))}&name=${encodeURIComponent(name)}`);
        return r.ok ? !!(await r.json()).found : true;
    } catch (e) { return true; }
}
const FB_CSS = `
.rg-fb-back { border:none; padding:0; background:transparent; overflow:visible; max-width:none; max-height:none; }
.rg-fb-back::backdrop { background:rgba(0,0,0,.45); }
.rg-fb { width:min(720px, 94vw); height:min(560px, 86vh); display:flex; flex-direction:column; gap:8px; padding:12px; box-sizing:border-box;
  background:var(--comfy-menu-bg,#202020); color:var(--fg-color,#ddd); border:1px solid var(--border-color,#4a4a4a); border-radius:8px;
  font:13px sans-serif; box-shadow:0 8px 32px rgba(0,0,0,.5); }
.rg-fb-head { display:flex; flex-direction:column; gap:6px; align-items:stretch; }
.rg-fb-head b { font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rg-fb-head select { width:100%; min-width:0; }
.rg-fb-path { display:flex; gap:6px; }
.rg-fb-path input { flex:1 1 auto; min-width:0; }
.rg-fb input, .rg-fb select, .rg-fb button { font:13px sans-serif; color:var(--input-text,#ddd); background:var(--comfy-input-bg,#2a2a2a);
  border:1px solid var(--border-color,#4a4a4a); border-radius:5px; padding:4px 8px; }
.rg-fb button { cursor:pointer; }
.rg-fb button:disabled { opacity:.45; cursor:default; }
.rg-fb button.primary { background:#2563c7; border-color:#2563c7; color:#fff; }
.rg-fb-list { flex:1 1 auto; overflow:auto; border:1px solid var(--border-color,#4a4a4a); border-radius:5px; }
.rg-fb-item { display:flex; gap:8px; align-items:center; padding:4px 8px; cursor:pointer; white-space:nowrap; }
.rg-fb-item:hover { background:rgba(255,255,255,.07); }
.rg-fb-item.sel { background:rgba(37,99,199,.45); }
.rg-fb-item svg { width:16px; height:16px; flex:0 0 16px; opacity:.85; }
.rg-fb-item .sz { margin-left:auto; opacity:.6; font-size:12px; }
.rg-fb-msg { color:#d9a441; min-height:16px; }
.rg-fb-foot { display:flex; gap:6px; justify-content:flex-end; align-items:center; }
.rg-fb-foot span { flex:1 1 auto; opacity:.75; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
`;
function fbCss() {
    if (document.getElementById("rg-fb-css")) return;
    const st = document.createElement("style"); st.id = "rg-fb-css"; st.textContent = FB_CSS; document.head.appendChild(st);
}
const fmtMB = (n) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB` : `${Math.max(0.01, n / 1024 / 1024).toFixed(1)} MB`);
// The folder browser: the ComfyUI machine's folders and model files. Resolves to the setting's value (the name
// ComfyUI knows the file by when it is inside one of `folders`, else its full path), or null when cancelled.
export function openFileBrowser({ folders = ["loras"], home, title = "Choose a model file", current = "" } = {}) {
    fbCss();
    return new Promise((resolve) => {
        // a modal <dialog>: it goes on the browser's top layer, above ComfyUI's Settings dialog (also there), and takes
        // the keyboard while open
        const back = document.createElement("dialog"); back.className = "rg-fb-back";
        const box = document.createElement("div"); box.className = "rg-fb"; back.appendChild(box);
        const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
        const head = mk("div", "rg-fb-head"); head.appendChild(mk("b", "", title));
        const roots = mk("select"); roots.title = "Go to: One of ComfyUI's model folders, a drive or the home folder";
        head.appendChild(roots);
        const pathRow = mk("div", "rg-fb-path");
        const up = mk("button", "rg-ib"); up.innerHTML = svgIcon("folderUp"); up.title = "Up one folder";
        const pathIn = mk("input"); pathIn.title = "The folder shown. Type or paste a folder (or a file's full path) and press Enter";
        pathRow.append(up, pathIn);
        const list = mk("div", "rg-fb-list");
        const msg = mk("div", "rg-fb-msg");
        const foot = mk("div", "rg-fb-foot");
        const chosen = mk("span", "", "");
        const cancel = mk("button", "", "Cancel"), ok = mk("button", "primary", "Select");
        ok.disabled = true;
        foot.append(chosen, cancel, ok);
        box.append(head, pathRow, list, msg, foot);
        let pick = null, here = "";
        const done = (v) => { if (back.open) back.close(); back.remove(); resolve(v); };
        const choose = (f, row) => {
            pick = f; ok.disabled = !f;
            for (const r of list.querySelectorAll(".sel")) r.classList.remove("sel");
            row?.classList.add("sel");
            chosen.textContent = f ? (f.rel ? `${f.rel}  (in ComfyUI's ${f.folder || folders[0]} folders)` : f.path) : "";
            chosen.title = chosen.textContent;
        };
        async function go(path) {
            msg.textContent = "Loading…";
            let d;
            try {
                const r = await api.fetchApi(`/region_genie/browse?folders=${encodeURIComponent(folders.join(","))}&path=${encodeURIComponent(path || "")}`);
                d = await r.json();
            } catch (e) { msg.textContent = "The folder list couldn't be loaded (is ComfyUI running?)."; return; }
            here = d.path || path || ""; pathIn.value = here; up.disabled = !d.parent;
            up.onclick = () => d.parent && go(d.parent);
            if (!roots.options.length) {
                for (const r of d.roots || []) { const o = mk("option", "", r.label); o.value = r.path; roots.appendChild(o); }
            }
            roots.value = [...roots.options].some((o) => o.value === here) ? here : "";
            list.replaceChildren(); choose(null);
            msg.textContent = d.error || (!d.dirs.length && !d.files.length ? "No folders or model files here." : "");
            for (const n of d.dirs || []) {
                const row = mk("div", "rg-fb-item"); row.innerHTML = svgIcon("folder"); row.appendChild(mk("span", "", n));
                row.title = "Open this folder";
                row.addEventListener("click", () => go(here.replace(/[\\/]+$/, "") + (d.sep || "/") + n));
                list.appendChild(row);
            }
            for (const f of d.files || []) {
                const row = mk("div", "rg-fb-item"); row.appendChild(mk("span", "", f.name)); row.appendChild(mk("span", "sz", fmtMB(f.size || 0)));
                row.title = f.path;
                row.addEventListener("click", () => choose(f, row));
                row.addEventListener("dblclick", () => { choose(f, row); ok.click(); });
                if (current && (current === f.rel || current === f.path)) choose(f, row);
                list.appendChild(row);
            }
        }
        roots.addEventListener("change", () => roots.value && go(roots.value));
        pathIn.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key !== "Enter") return;
            const v = pathIn.value.trim();
            if (/\.(safetensors|sft|ckpt|pt2?|pth|bin|gguf)$/i.test(v)) go(v.replace(/[\\/][^\\/]*$/, "")); else go(v);
        });
        cancel.addEventListener("click", () => done(null));
        ok.addEventListener("click", () => pick && done(pick.rel ? encodeValue(pick.folder, pick.rel, home || folders[0]) : pick.path));
        back.addEventListener("pointerdown", (e) => { if (e.target === back) done(null); });   // the backdrop
        back.addEventListener("cancel", (e) => { e.preventDefault(); done(null); });            // Esc
        // nothing inside reaches the page: a click here must not count as a click outside ComfyUI's Settings dialog
        // (which closes it), and keys must not reach the canvas
        for (const ev of ["keydown", "keyup", "keypress", "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"])
            back.addEventListener(ev, (e) => e.stopPropagation());
        document.body.appendChild(back);
        back.showModal();
        const start = isFullPath(current) ? current.replace(/[\\/][^\\/]*$/, "") : "";
        go(start);
    });
}
// ---------------------------------------------------------------- model-file fields (round 23)
// Every model file (Settings, the Edit row, the LLM settings) is a field showing the file's name; a click opens
// ComfyUI's classic menu (LiteGraph.ContextMenu: its 'Filter list' box, rgthree-comfy's 'Auto Nest Subdirectories in
// Menus' folders), with a search through every level added. The control and edit files open on ComfyUI's model folders
// (📁 controlnet, 📁 loras, 📁 model_patches, 📁 geometry_estimation). 'Browse… for model files' adds a folder button.
// A file from another folder than the setting's own is saved as "folder:name" (Python: model_paths.split_folder).
export const MODEL_ROOTS = ["controlnet", "loras", "model_patches", "geometry_estimation"];
export const filePickersOn = () => getSetting(SET.filePickers, false) === true;
export function splitValue(v) {
    if (typeof v === "string" && !isFullPath(v)) {
        const m = /^([A-Za-z0-9_]{2,}):(.+)$/.exec(v);
        if (m) return { folder: m[1], name: m[2] };
    }
    return { folder: null, name: v };
}
export const encodeValue = (folder, name, home) => (folder && folder !== home ? `${folder}:${name}` : name);
// is a set value among the files ComfyUI lists (full paths: asked of the server)
async function fileKnown(v, roots, home) {
    if (isFullPath(v)) return modelFileFound(roots, v);
    const { folder, name } = splitValue(v);
    const files = await listModelFiles(roots);
    return files.some((f) => f.name === name && (folder ? f.folder === folder : (f.folder === home || roots.length === 1)));
}
const FF_CSS = `
.rg-ff { display:flex; gap:6px; align-items:center; width:360px; max-width:100%; min-width:0; }
.rg-ff-name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; cursor:pointer;
  font:inherit; color:var(--input-text,#ddd); background:var(--comfy-input-bg,#2a2a2a); border:1px solid var(--border-color,#4a4a4a);
  border-radius:6px; padding:6px 24px 6px 8px; position:relative; }
.rg-ff-name::after { content:"▾"; position:absolute; right:8px; top:50%; transform:translateY(-50%); opacity:.7; }
.rg-ff-name.missing { color:#e88; }
.rg-ff-browse { flex:0 0 auto; display:flex; align-items:center; justify-content:center; width:34px; height:32px; padding:0; cursor:pointer;
  color:var(--input-text,#ddd); background:var(--comfy-input-bg,#2a2a2a); border:1px solid var(--border-color,#4a4a4a); border-radius:6px; }
.rg-ff-browse svg { width:18px; height:18px; }
.litecontextmenu .rg-ff-hit { white-space:nowrap; }
.litecontextmenu .rg-ff-more { opacity:.6; font-style:italic; pointer-events:none; }
`;
function ffCss() {
    fbCss();
    if (document.getElementById("rg-ff-css")) return;
    const st = document.createElement("style"); st.id = "rg-ff-css"; st.textContent = FF_CSS; document.head.appendChild(st);
}
// ComfyUI's Settings dialog lets nothing outside it take clicks or focus: a menu opened from it lives inside it
// (submenus too, while one is open)
function keepMenusIn(dlg) {
    const move = (m) => {
        if (!(m instanceof HTMLElement) || !m.classList.contains("litecontextmenu") || dlg.contains(m)) return;
        const r0 = m.getBoundingClientRect();
        dlg.appendChild(m);
        m.style.pointerEvents = "auto";
        const r1 = m.getBoundingClientRect();
        if (Math.abs(r1.left - r0.left) > 1 || Math.abs(r1.top - r0.top) > 1) {
            m.style.left = `${parseFloat(m.style.left || 0) - (r1.left - r0.left)}px`;
            m.style.top = `${parseFloat(m.style.top || 0) - (r1.top - r0.top)}px`;
        }
    };
    document.querySelectorAll("body > .litecontextmenu").forEach(move);
    const obs = new MutationObserver((list) => { for (const x of list) x.addedNodes.forEach(move); });
    obs.observe(document.body, { childList: true });
    const t = setInterval(() => { if (!document.querySelector(".litecontextmenu")) { obs.disconnect(); clearInterval(t); } }, 400);
}
// the search through every level: while the filter has text, the menu lists the matching files of all folders
function deepSearch(root, entries, pick) {
    const nested = [...root.querySelectorAll(".litemenu-entry")].some((e) => e.textContent.trim().startsWith("📁"));
    let input = root.querySelector(".comfy-context-menu-filter");
    if (!nested && input) return;                          // a flat list: ComfyUI's own filter already searches all of it
    if (!input) {                                          // ComfyUI adds its box only to menus of more than 4 entries
        input = document.createElement("input"); input.className = "comfy-context-menu-filter"; input.placeholder = "Filter list";
        const title = root.querySelector(".litemenu-title");
        if (title) title.after(input); else root.prepend(input);
        requestAnimationFrame(() => input.focus());
        input.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); e.stopPropagation(); });
    }
    let hits = [], sel = 0;
    const box = document.createElement("div");
    const originals = () => [...root.querySelectorAll(".litemenu-entry")].filter((e) => !box.contains(e));
    const render = () => {
        const q = input.value.trim().toLowerCase();
        box.replaceChildren();
        if (!q) { box.remove(); return; }
        for (const e of originals()) e.style.display = "none";
        const words = q.split(/\s+/);
        hits = entries.filter((t) => { const l = t.toLowerCase(); return words.every((w) => l.includes(w)); });
        sel = 0;
        hits.slice(0, 60).forEach((t, k) => {
            const e = document.createElement("div"); e.className = "litemenu-entry submenu rg-ff-hit" + (k === sel ? " selected" : "");
            e.textContent = t;
            e.addEventListener("click", (ev) => { ev.stopPropagation(); pick(t); });
            box.appendChild(e);
        });
        const more = document.createElement("div"); more.className = "litemenu-entry rg-ff-more";
        more.textContent = hits.length > 60 ? `${hits.length - 60} more: type more to narrow it down` : hits.length ? "" : "No match";
        if (more.textContent) box.appendChild(more);
        if (!box.isConnected) input.after(box);
    };
    input.addEventListener("input", render);
    root.addEventListener("keydown", (e) => {
        if (!input.value.trim() || !hits.length) return;
        const items = [...box.querySelectorAll(".rg-ff-hit")];
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items.forEach((x, k) => x.classList.toggle("selected", k === sel));
            items[sel]?.scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter") pick(hits[sel]);
        else return;
        e.preventDefault(); e.stopImmediatePropagation();
    }, true);
}
const closeMenus = () => {
    try { LiteGraph.closeAllContextMenus?.(window); } catch (e) { /* older litegraph */ }
    document.querySelectorAll(".litecontextmenu").forEach((m) => m.remove());
};
// ComfyUI's classic menu of the files in `roots` (several: each under its folder name). onPick(value).
export async function openModelMenu(ev, { roots, home, none, noneLabel, title, onPick }) {
    ev?.preventDefault?.(); ev?.stopPropagation?.();
    const anchor = ev?.currentTarget || ev?.target;
    const dlg = anchor?.closest?.('[role="dialog"]');
    const files = await listModelFiles(roots, true);
    const multi = roots.length > 1, map = new Map(), items = [];
    if (noneLabel !== false && none !== undefined) {
        const t = noneLabel ? `None (${noneLabel})` : "None";       // first in rgthree's nested menus too ("None …")
        items.push(t); map.set(t, none);
    }
    for (const f of files) {
        if (f.name === none) continue;
        const t = multi ? `${f.folder}/${f.name}` : f.name;
        if (!map.has(t)) { items.push(t); map.set(t, encodeValue(f.folder, f.name, home)); }
    }
    if (!items.length) { items.push("(no files in ComfyUI's folders)"); }
    const pick = (t) => { const v = map.get(t); closeMenus(); if (v !== undefined) onPick(v); };
    if (dlg) keepMenusIn(dlg);
    ensureActiveCanvas();
    const before = new Set(document.querySelectorAll(".litecontextmenu"));
    // below the field, like a dropdown (also when opened from the keyboard, which gives no pointer position)
    const ar = anchor?.getBoundingClientRect?.();
    const at = ar ? new MouseEvent("click", { clientX: ar.left, clientY: ar.bottom + 2 }) : ev;
    new LiteGraph.ContextMenu(items, {
        event: at, className: "dark", title, scale: Math.max(1, dlg ? 1 : (app.canvas?.ds?.scale || 1)),
        callback: (v) => {
            const t = typeof v === "string" ? v : (v?.rgthree_originalValue ?? v?.content);
            const s2 = typeof t === "string" ? t : t?.content;
            if (map.has(s2)) onPick(map.get(s2));
        },
    });
    const root = [...document.querySelectorAll(".litecontextmenu")].find((m) => !before.has(m));
    if (root) {
        if (dlg) keepMenusIn(dlg);
        deepSearch(root, items.filter((t) => map.has(t)), pick);
    }
}
// the field: the file's name (red when ComfyUI doesn't list it), a click opens the menu; Browse… beside it with the
// Settings switch on. Returns the element; .set(v) changes what it shows.
export function fileField({ roots, home, none, noneLabel, emptyLabel, value, onPick, title, menuTitle, browse, cls }) {
    ffCss();
    home = home || roots[0];
    const box = document.createElement("div"); box.className = "rg-ff" + (cls ? " " + cls : "");
    const name = document.createElement("button"); name.type = "button"; name.className = "rg-ff-name";
    let cur = value ?? none;
    const show = () => {
        const empty = cur === undefined || cur === null || cur === "" || cur === none;
        let text;
        if (empty) text = emptyLabel || (noneLabel ? noneLabel : (none || ""));
        else if (isFullPath(cur)) text = fileBase(cur);
        else { const { folder, name: n } = splitValue(cur); text = folder ? `${n}  (${folder})` : n; }
        name.textContent = text;
        const where = empty ? "" : isFullPath(cur) ? cur : (() => { const { folder, name: n } = splitValue(cur); return `${folder || home}/${n}`; })();
        const t1 = title ? title.split("\n")[0] : "";
        name.title = (t1 ? (/[.!?)]$/.test(t1) ? t1 : t1 + ".") + "\n" : "") + (where ? where + "\n" : "") + "Click to choose it in ComfyUI's menu (typing there searches every folder).";
        name.classList.remove("missing");
        if (!empty) fileKnown(cur, roots, home).then((ok) => {
            if (cur !== undefined && !ok) {
                name.classList.add("missing");
                name.title += "\nIn red: ComfyUI doesn't find it in its model folders (moved, renamed or deleted).";
            }
        }).catch(() => {});
    };
    show();
    const set = (v) => { cur = v; show(); onPick(v); };
    name.addEventListener("click", (e) => openModelMenu(e, { roots, home, none, noneLabel, title: menuTitle || (title ? title.split("\n")[0] : "Model file"), onPick: set }));
    box.appendChild(name);
    if (browse ?? filePickersOn()) {
        const btn = document.createElement("button"); btn.type = "button"; btn.className = "rg-ff-browse"; btn.innerHTML = svgIcon("folder");
        btn.title = "Browse…: Pick the file anywhere on the ComfyUI machine (a full path is saved when it isn't in ComfyUI's model folders)";
        btn.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation();
            // it starts in the setting's own folder
            const v = await openFileBrowser({ folders: [home, ...roots.filter((r) => r !== home)], home, current: cur && cur !== none ? cur : "",
                                             title: title ? `Choose: ${title.split("\n")[0]}` : undefined });
            if (v == null) return;
            fileListCache.clear();
            set(v);
        });
        box.appendChild(btn);
    }
    for (const ev of ["pointerdown", "mousedown", "keydown", "dblclick"]) box.addEventListener(ev, (e) => e.stopPropagation());
    box.set = (v) => { cur = v; show(); };
    return box;
}
// a Settings type: the setting's own row control (ComfyUI calls it with the setting's name, a setter and the value);
// saved by its id too, so a pick lands even if the dialog re-rendered meanwhile
const fileSettingType = (roots, none, id, home, noneLabel) => (name, setter, value) =>
    fileField({ roots, home, none, noneLabel, value: typeof value === "string" && value ? value : none, title: name,
                onPick: (v) => { try { setter(v); } catch (e) { /* the dialog is gone */ } if (id) setSetting(id, v); } });

// ---- Settings > Region Genie > Model files > Check model files (round 24): every model file set in these Settings
// (Control, edit LoRAs, Select object) and in the LLM presets is looked up now; the ones not found are listed.
export const LLM_FILES = { list: null };          // rg_llm.js fills it in: () => [{ what, value, roots, home }]
function configuredModelFiles() {
    const out = [], set = (v, none) => typeof v === "string" && v && v !== none;
    for (const [key, name, folder] of CONTROL_FILES) {
        const v = getSetting(SET.control + "." + key, CONTROL_NONE);
        if (set(v, CONTROL_NONE)) out.push({ what: "Control > " + name, value: v, roots: MODEL_ROOTS, home: folder });
    }
    for (const [name, key] of EDIT_MODELS) {
        const v = getSetting(SET.editLora + "." + key, NO_LORA);
        if (set(v, NO_LORA)) out.push({ what: `Edit Mode > ${name}: edit LoRA`, value: v, roots: MODEL_ROOTS, home: "loras" });
    }
    const sam = getSetting(SET.samModel, SAM_DEFAULT);
    if (set(sam)) out.push({ what: "Select object > Model", value: sam, roots: ["checkpoints"], home: "checkpoints" });
    try { out.push(...(LLM_FILES.list?.() || [])); } catch (e) { /* the LLM presets aren't loaded */ }
    return out;
}
export async function checkModelFiles() {
    fileListCache.clear();
    const all = configuredModelFiles(), missing = [];
    for (const f of all) {
        let ok = false;
        try { ok = await fileKnown(f.value, f.roots, f.home); } catch (e) { ok = false; }
        if (!ok) missing.push(f);
    }
    return { count: all.length, missing };
}
const CHECK_CSS = `
.rg-chk { display:flex; flex-direction:column; align-items:flex-end; gap:6px; width:360px; max-width:100%; }
.rg-chk button { cursor:pointer; font:inherit; color:var(--input-text,#ddd); background:var(--comfy-input-bg,#2a2a2a); border:1px solid var(--border-color,#4a4a4a); border-radius:6px; padding:6px 14px; }
.rg-chk button:disabled { opacity:.5; cursor:default; }
.rg-chk-out { align-self:stretch; font-size:12px; line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
.rg-chk-out.ok { color:#8c8; }
.rg-chk-out.bad b { color:#e88; font-weight:600; }`;
// ---- Settings > Region Genie > Region Genie node > Region colors (round 35): the colors new regions get, in
// this order. Calm, clearly different tones by default (purple first, then golden yellow: the owner's choice);
// a user who tells other colors apart better sets their own here. Stored as one text: "#RRGGBB, #RRGGBB, …".
export const REGION_COLORS_DEFAULT = "#8F73D1, #E3B341, #3FA9A0, #DE7359, #5C9DDB, #7DB45C, #E08DB4, #4A58A6, #9BDDC0, #A27A52, #A8509C, #8496A6";
const REGION_COLORS_MAX = 24;
export function parseColorList(v) {
    const out = [];
    for (const m of String(v ?? "").toUpperCase().matchAll(/#?([0-9A-F]{6})\b/g)) {
        const c = "#" + m[1];
        const dark = Math.max(parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)) < 32;
        if (!dark && !out.includes(c)) out.push(c);             // black means "no region" in the color map
        if (out.length >= REGION_COLORS_MAX) break;
    }
    return out;
}
export function regionColors() {
    const list = parseColorList(getSetting(SET.regionColors, REGION_COLORS_DEFAULT));
    return list.length ? list : parseColorList(REGION_COLORS_DEFAULT);
}
const COLORS_CSS = `
.rg-colors { display:flex; flex-wrap:wrap; align-items:center; gap:5px; max-width:420px; justify-content:flex-end; }
.rg-colors .sw { width:22px; height:22px; padding:0; border-radius:4px; border:1px solid rgba(128,128,128,.7); cursor:pointer; }
.rg-colors .sw:hover, .rg-colors .sw:focus-visible { outline:2px solid var(--p-primary-color, #5b8fd0); outline-offset:1px; }
.rg-colors .act { height:24px; padding:0 8px; border-radius:4px; border:1px solid var(--border-color, #555); background:var(--comfy-input-bg, #222);
  color:inherit; font:inherit; cursor:pointer; }
.rg-colors .act:disabled { opacity:.4; cursor:default; }`;
const regionColorsType = () => (name, setter, value) => {
    if (!document.getElementById("rg-colors-style")) { const s = document.createElement("style"); s.id = "rg-colors-style"; s.textContent = COLORS_CSS; document.head.appendChild(s); }
    const box = document.createElement("div"); box.className = "rg-colors";
    const defaults = parseColorList(REGION_COLORS_DEFAULT);
    let list = parseColorList(value); if (!list.length) list = [...defaults];
    const save = () => { const v = list.join(", "); try { setter(v); } catch (e) { /* the dialog is gone */ } setSetting(SET.regionColors, v); };
    const render = () => {
        box.replaceChildren();
        list.forEach((c, i) => {
            const b = document.createElement("button"); b.type = "button"; b.className = "sw"; b.style.background = c; b.dataset.color = c;
            b.title = `${c}: Color ${i + 1} for new regions.\nClick: Change it.\nRight-click: Remove it.`;
            b.addEventListener("click", (e) => {
                e.preventDefault();
                openColorPicker(b, list[i], {
                    onInput: (hex) => { b.style.background = hex; },
                    onClose: (hex, changed) => {
                        const h = parseColorList(hex)[0];
                        if (changed && h && !list.includes(h)) { list[i] = h; save(); }
                        render();
                    },
                });
            });
            b.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); if (list.length > 1) { list.splice(i, 1); save(); render(); } });
            box.appendChild(b);
        });
        const add = document.createElement("button"); add.type = "button"; add.className = "act rg-ib"; add.innerHTML = svgIcon("plus");
        add.title = "Add a color at the end: The next of the built-in colors that isn't in the list (else white); click it to change it.";
        add.disabled = list.length >= REGION_COLORS_MAX;
        add.addEventListener("click", () => { list.push(defaults.find((c) => !list.includes(c)) || ["#FFFFFF", "#DDDDDD", "#BBBBBB", "#999999"].find((c) => !list.includes(c)) || "#777777"); save(); render(); });
        const reset = document.createElement("button"); reset.type = "button"; reset.className = "act"; reset.textContent = "Defaults";
        reset.title = "Put the built-in colors back.";
        reset.disabled = list.join() === defaults.join();
        reset.addEventListener("click", () => { list = [...defaults]; save(); render(); });
        box.append(add, reset);
    };
    render();
    return box;
};
const checkFilesType = () => () => {
    if (!document.getElementById("rg-chk-style")) { const s = document.createElement("style"); s.id = "rg-chk-style"; s.textContent = CHECK_CSS; document.head.appendChild(s); }
    const box = document.createElement("div"); box.className = "rg-chk";
    const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "Check";
    btn.title = "Look up every model file set in Settings > Region Genie and in the LLM presets now.";
    const out = document.createElement("div"); out.className = "rg-chk-out";
    btn.addEventListener("click", async () => {
        btn.disabled = true; out.className = "rg-chk-out"; out.textContent = "Checking…";
        let r = null;
        try { r = await checkModelFiles(); } catch (e) { r = null; }
        btn.disabled = false;
        if (!r) { out.textContent = "The check couldn't run (is ComfyUI still running?)."; return; }
        if (!r.count) { out.textContent = "No model files are set."; return; }
        if (!r.missing.length) { out.className = "rg-chk-out ok"; out.textContent = r.count === 1 ? "The 1 file that is set was found." : `All ${r.count} files that are set were found.`; return; }
        out.className = "rg-chk-out bad"; out.textContent = "";
        const head = document.createElement("div"); head.textContent = `${r.missing.length} of ${r.count} not found:`; out.appendChild(head);
        for (const f of r.missing) {
            const line = document.createElement("div"), b = document.createElement("b");
            b.textContent = f.what + ": "; line.append(b, isFullPath(f.value) ? f.value : splitValue(f.value).name); line.title = f.value; out.appendChild(line);
        }
    });
    for (const ev of ["pointerdown", "mousedown", "keydown", "dblclick"]) box.addEventListener(ev, (e) => e.stopPropagation());
    box.append(btn, out);
    return box;
};

// ---------------------------------------------------------------- the LLM presets in Settings (round 19)
// One Settings row per field of the LLM Prompt Enhancer's presets (the pop-up's library, in user data, not in
// ComfyUI's settings): rg_llm.js fills in LLM_ROWS.render(key) when it loads.
export const LLM_ROWS = { render: null };
const llmRowType = (key) => () => {
    if (LLM_ROWS.render) return LLM_ROWS.render(key);
    const e = document.createElement("span"); e.textContent = "…"; return e;
};
const SAMPLED = "\nUsed only while the preset's sampling is on (greyed otherwise).";
// [key, name, tooltip]; each row edits the preset chosen in 'Preset to edit' and saves at once
export const LLM_FIELDS = [
    ["name", "Preset: name", "The preset's name. Press Enter (or leave the field) to rename it; the defaults above follow."],
    ["llm", "Preset: LLM", "The LLM that rewrites the prompts.\nThe connected clip: Used as it is (no extra memory).\n"
        + "A file: From ComfyUI's text_encoders folders (or anywhere with 'Browse… for model files' on, Model files); loaded once and kept while in use."],
    ["llm_type", "Preset: LLM type", "As the 'type' of Load CLIP, for an LLM file. 'auto (detect)' works for plain Qwen3 / Qwen3.5 / Gemma files."],
    ["loras", "Preset: LLM LoRAs", "LoRAs applied to the LLM only (like Load LoRA (Text Encoder)); the image model and the clip "
        + "used for conditioning are not changed.\nEach row: On / off, the file (a click opens ComfyUI's menu; a folder button with 'Browse… for model files' on), strength, ✕ removes it."],
    ["system_prompt", "Preset: system prompt", "Sent as the system prompt (Generate Text's system_prompt). Ignored when the preset's default template is off."],
    ["max_length", "Preset: max_length", "Most tokens the LLM writes."],
    ["sampling", "Preset: sampling", "On: Sampling with the settings below.\nOff (default): Greedy decoding, always the same text for "
        + "the same input; temperature, top_k, top_p, min_p, the penalties and the seed are not used."],
    ["temperature", "Preset: temperature", "Sampling temperature." + SAMPLED],
    ["top_k", "Preset: top_k", "Sample from the k most likely tokens (0 = all)." + SAMPLED],
    ["top_p", "Preset: top_p", "Sample from the most likely tokens up to this total probability." + SAMPLED],
    ["min_p", "Preset: min_p", "Leave out tokens less likely than this share of the most likely one." + SAMPLED],
    ["repetition_penalty", "Preset: repetition_penalty", "Penalty for repeating tokens (1 = none)." + SAMPLED],
    ["presence_penalty", "Preset: presence_penalty", "Penalty for tokens already used (0 = none)." + SAMPLED],
    ["seed", "Preset: seed", "The seed (a region's right-click 'Run again with a new seed' adds to it for that region)." + SAMPLED],
    ["thinking", "Preset: thinking", "Thinking mode, if the model supports it (the reasoning is shown in the tooltip of the LLM button, the one with the sparkles icon; it is not used)."],
    ["use_default_template", "Preset: default template", "Use the model's built-in chat template (needed for the system prompt)."],
    ["mtp", "Preset: mtp", "Speculative decoding with the model's multi-token-prediction head (no effect without MTP weights)."],
];

// ---------------------------------------------------------------- Control (ControlNet / control LoRAs)
// [Settings key, label, model folder, model (as ui.model_arch says), LoRA tag kind or null]. One file per model and kind;
// the LoRA ones are added to 'Whole image' when control is on.
// the model's official name (also as stored and as the run reports it); workflows saved before used OLD_MOSS
export const MOSS = "MOSS-Image", OLD_MOSS = "MOSS Image";
export const CONTROL_FILES = [
    ["MOSS", "MOSS-Image: color / depth control LoRA", "loras", "MOSS-Image", "moss"],
    ["Flux1Depth", "Flux.1: depth LoRA (e.g. flux1-depth-dev-lora)", "loras", "Flux.1", "depth"],
    ["Flux1Canny", "Flux.1: canny LoRA (e.g. flux1-canny-dev-lora)", "loras", "Flux.1", "canny"],
    ...[["Flux1", "Flux.1"], ["SDXL", "SDXL"], ["SD15", "SD1.5"]].flatMap(([k, name]) => [
        [`${k}.depth`, `${name}: depth ControlNet`, "controlnet", name, null],
        [`${k}.canny`, `${name}: canny ControlNet`, "controlnet", name, null],
        [`${k}.other`, `${name}: ControlNet for your control_image (pose, lineart, union …)`, "controlnet", name, null]]),
    ["Anima.depth", "Anima: depth LLLite patch", "model_patches", "Anima", null],
    ["Anima.canny", "Anima: canny LLLite patch", "model_patches", "Anima", null],
    ["Anima.other", "Anima: LLLite patch for your control_image", "model_patches", "Anima", null],
    ["DA3", "Depth Anything 3 model (makes depth maps from 'image')", "geometry_estimation", null, null],
];
export const CONTROL_NONE = "(none)";
const SAM_DEFAULT = "sam3.1_multiplex_fp16.safetensors";
// where to get each file (official / original uploads; checked Nov 2026) and the folder it goes in
const HF = "https://huggingface.co/";
export const CONTROL_DOWNLOADS = {
    MOSS: { file: "moss_image_color_depth_control.safetensors", url: HF + "Comfy-Org/MOSS-Image/resolve/main/loras/moss_image_color_depth_control.safetensors" },
    Flux1Depth: { file: "flux1-depth-dev-lora.safetensors", url: HF + "Comfy-Org/flux1-dev/resolve/main/split_files/loras/flux1-depth-dev-lora.safetensors" },
    Flux1Canny: { file: "flux1-canny-dev-lora.safetensors", url: HF + "black-forest-labs/FLUX.1-Canny-dev-lora/resolve/main/flux1-canny-dev-lora.safetensors",
                  note: "Black Forest Labs' page asks you to accept the FLUX.1 [dev] license first" },
    "Flux1.depth": { file: "flux-depth-controlnet-v3.safetensors", url: HF + "XLabs-AI/flux-controlnet-collections/resolve/main/flux-depth-controlnet-v3.safetensors" },
    "Flux1.canny": { file: "flux-canny-controlnet-v3.safetensors", url: HF + "XLabs-AI/flux-controlnet-collections/resolve/main/flux-canny-controlnet-v3.safetensors" },
    "Flux1.other": { file: "diffusion_pytorch_model.safetensors", url: HF + "InstantX/FLUX.1-dev-Controlnet-Union/resolve/main/diffusion_pytorch_model.safetensors",
                     note: "InstantX's union ControlNet (pose, depth, canny, tile …); rename it, e.g. instantx-flux-union.safetensors" },
    "SDXL.depth": { file: "control-lora-depth-rank128.safetensors", url: HF + "stabilityai/control-lora/resolve/main/control-LoRAs-rank128/control-lora-depth-rank128.safetensors" },
    "SDXL.canny": { file: "control-lora-canny-rank128.safetensors", url: HF + "stabilityai/control-lora/resolve/main/control-LoRAs-rank128/control-lora-canny-rank128.safetensors" },
    "SDXL.other": { file: "diffusion_pytorch_model_promax.safetensors", url: HF + "xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors",
                    note: "xinsir's union ControlNet (pose, depth, canny, lineart …); rename it, e.g. controlnet-union-sdxl-promax.safetensors" },
    "SD15.depth": { file: "control_v11f1p_sd15_depth_fp16.safetensors", url: HF + "comfyanonymous/ControlNet-v1-1_fp16_safetensors/resolve/main/control_v11f1p_sd15_depth_fp16.safetensors" },
    "SD15.canny": { file: "control_v11p_sd15_canny_fp16.safetensors", url: HF + "comfyanonymous/ControlNet-v1-1_fp16_safetensors/resolve/main/control_v11p_sd15_canny_fp16.safetensors" },
    "SD15.other": { file: "control_v11p_sd15_openpose_fp16.safetensors", url: HF + "comfyanonymous/ControlNet-v1-1_fp16_safetensors/resolve/main/control_v11p_sd15_openpose_fp16.safetensors",
                    note: "the pose one; lineart, scribble, softedge … are in the same repository" },
    "Anima.depth": { file: "anima-lllite-depth-1.safetensors", url: HF + "Comfy-Org/Anima-LLLite/resolve/main/model_patches/anima-lllite-depth-1.safetensors" },
    "Anima.canny": { file: "anima-lllite-lineart-1.safetensors", url: HF + "Comfy-Org/Anima-LLLite/resolve/main/model_patches/anima-lllite-lineart-1.safetensors",
                     note: "there is no canny LLLite; the lineart one reads edge lines like canny's (untested with canny maps)" },
    "Anima.other": { file: "anima-lllite-pose-1.safetensors", url: HF + "Comfy-Org/Anima-LLLite/resolve/main/model_patches/anima-lllite-pose-1.safetensors",
                     note: "the pose one; lineart, scribble and a general 'any-test-like' patch are in the same repository" },
    DA3: { file: "depth_anything_3_mono_large.safetensors", url: HF + "Comfy-Org/Depth-Anything-3/resolve/main/geometry_estimation/depth_anything_3_mono_large.safetensors" },
};
// a Setting's tooltip: what this kind of file does, how it is used, and where to get it
export function controlFileHelp(key, folder, model, tag) {
    // three lines: what it is, how the Control row uses it, where to get it
    const what = key === "MOSS" ? "MOSS-Image's color / depth control adapter (a LoRA). It reads the regions' color map and / or a depth map, "
            + "VAE-encoded next to the image (needs 'vae')."
        : tag ? "Black Forest Labs' structural LoRA for Flux.1 [dev]. The map is VAE-encoded next to the image (needs 'vae')."
        : folder === "controlnet" ? "A ControlNet, a separate network that reads the map and steers the model at each step, with the Control "
            + "row's strength and start / end (also Control-LoRA and union files)."
        : folder === "model_patches" ? "An Anima LLLite patch, a small control network on the model, with the Control row's strength and start / end."
        : "ComfyUI's Depth Anything 3. It makes the depth map (near = white) from 'image' when no control_image is connected.";
    const use = tag ? `\nA node's Control row uses it (as a LoRA on the model) for ${model} models${tag !== "moss" ? ", at the row's strength" : ""}.`
        : /^Flux1\.(depth|canny)$/.test(key) ? `\nUsed by the Control row when the model is Flux.1 and no Flux.1 ${key.slice(6)} LoRA is set (the LoRA comes first).`
        : model ? `\nUsed by the Control row when the model is ${model}.` : "";
    const d = CONTROL_DOWNLOADS[key];
    const where = folder === "model_patches" ? "ComfyUI/models/model_patches (or models/controlnet)" : `ComfyUI/models/${folder}`;
    const get = d ? `\nGet ${d.file} into ${where}${d.note ? ` (${d.note[0].toUpperCase() + d.note.slice(1)})` : ""}: ${d.url}`
        : `\nFiles go in ${where}.`;
    return what + use + get + "\nOr keep the file anywhere: With 'Browse… for model files' on (Model files), a folder button picks it where it is.";
}
// the folder types a Control setting's file is listed from and looked up in (Anima's LLLite patches: ComfyUI's own
// loader reads model_patches, but they are often kept with the ControlNets)
export const controlFolders = (key) => (/^Anima\./.test(key) ? ["model_patches", "controlnet"] : [controlFolder(key)]);
export const controlFolder = (key) => (CONTROL_FILES.find((x) => x[0] === key) || [])[2] || "";
export const controlLabel = (key) => (CONTROL_FILES.find((x) => x[0] === key) || [])[1] || key;
// what each kind does (tooltips and the Control details)
export const CONTROL_KIND_HELP = {
    color: "Color map (MOSS-Image): A shape map. Each flat color marks one region; the colors are only IDs, not the colors to paint "
        + "(the region's prompt says what it is and what color). The model follows the painted outlines, also rough ones: a "
        + "rectangle drawn for a person pushes towards a person filling that rectangle. End % below 100 (e.g. 30–50) keeps the "
        + "layout and lets the shapes loosen at the end; strength below 1 pulls less.",
    "color+depth": "Color map + depth (MOSS-Image): The regions' outlines (see color map) and how far away things are (near = white).",
    depth: "Depth: A grey map of distances (near = white). The model keeps the 3D layout (what is in front, the shape of the room or "
        + "the land) but is free with textures, colors and details.",
    canny: "Canny: The edge lines of a picture. The model keeps the outlines and composition closely, so it's good for redrawing a "
        + "picture in another style; it follows the lines more strictly than depth.",
    other: "Your control_image: Any map made with other nodes (pose skeletons, lineart, scribble, segmentation …). The file set for "
        + "your control_image (Settings > Region Genie > Control) must read that kind of map (a union ControlNet reads several).",
};
setTimeout(() => { for (const f of new Set(CONTROL_FILES.map((x) => x[2]))) if (f !== "loras") knownModels(f); }, 0);
// the files set in Settings: { key: file } (unset ones left out)
export function controlFiles() {
    const out = {};
    for (const [key] of CONTROL_FILES) {
        const v = getSetting(SET.control + "." + key, CONTROL_NONE);
        if (typeof v === "string" && v && v !== CONTROL_NONE) out[key] = v;
    }
    return out;
}
export async function getLoras(force) {
    if (loraList && !force && performance.now() - loraTime < 5000) return loraList;
    if (!loraPromise) {
        loraPromise = (async () => {
            try {
                const r = await api.fetchApi("/models/loras");
                const d = await r.json();
                if (Array.isArray(d)) { loraList = d.map((x) => (typeof x === "string" ? x : x?.name)).filter(Boolean); loraTime = performance.now(); }
            } catch (e) { console.warn("[Region Genie] could not list LoRAs:", e); }
            loraPromise = null;
            return loraList || [];
        })();
    }
    return loraPromise;
}

// trigger words saved next to a LoRA (see lora_triggers.py)
const triggerCache = new Map();
export function getTriggers(name) {
    const empty = { words: [], wordSources: [], sources: [] };
    if (!name) return Promise.resolve(empty);
    if (!triggerCache.has(name)) {
        triggerCache.set(name, (async () => {
            try {
                const r = await api.fetchApi(`/region_genie/lora_triggers?name=${encodeURIComponent(name)}`);
                if (!r.ok) return empty;
                const d = await r.json();
                const words = Array.isArray(d.words) ? d.words.map(String) : [];
                const ws = Array.isArray(d.word_sources) ? d.word_sources : [];
                const keep = words.map((w, i) => [w, ws[i] || (d.sources || [])[0] || ""]).filter(([w]) => w.trim());
                return { words: keep.map((x) => x[0]), wordSources: keep.map((x) => x[1]), sources: d.sources || [] };
            } catch (e) { return empty; }
        })());
    }
    return triggerCache.get(name);
}

// ComfyUI's list menu, so Easy-Use / rgthree folder nesting and the list filter apply
function ensureActiveCanvas() {
    const LGC = window.LGraphCanvas;
    if (LGC && !LGC.active_canvas && app.canvas) LGC.active_canvas = app.canvas;
}
// Esc in a pop-up editor closes what is on top first: a menu of ComfyUI that one of its buttons opened (a short menu
// takes no keys itself, so the key arrives in the pop-up). Returns true when there was one.
export function closeComfyMenus() {
    const open = [...document.querySelectorAll(".litecontextmenu")];
    try { globalThis.LiteGraph?.closeAllContextMenus?.(); } catch (e) { /* older */ }
    open.forEach((m) => m.remove());
    return open.length > 0;
}
export function contextMenu(ev, items, title, onPick) {
    ensureActiveCanvas();
    new LiteGraph.ContextMenu(items, {
        event: ev, scale: Math.max(1, app.canvas?.ds?.scale || 1), className: "dark", title,
        callback: (v) => onPick(v),
    });
}
export async function pickLora(ev, onPick) {
    ev.preventDefault(); ev.stopPropagation();
    const loras = await getLoras(true);
    if (!loras.length) return false;
    contextMenu(ev, [...loras], "LoRA", (v) => {
        const name = typeof v === "string" ? v : (v?.content ?? v?.value);
        if (typeof name === "string" && name) onPick(name);
    });
    return true;
}

// true if the word / phrase is in the prompt as whole words (case-insensitive)
export const promptHas = (prompt, word) => {
    const w = String(word || "").trim();
    if (!w) return false;
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try { return new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, "iu").test(String(prompt || "")); }
    catch (e) { return String(prompt || "").toLowerCase().includes(w.toLowerCase()); }
};
export const appendWord = (prompt, word) => {
    const p = String(prompt || "").replace(/[\s,]+$/, "");
    return p ? `${p}, ${word.trim()}` : word.trim();
};

// trigger-word chips of one LoRA: el.replaceChildren(...); onAdd(word) adds a word to the prompt
export function fillTriggerChips(box, loraName, getPrompt, onAdd, mk) {
    getTriggers(loraName).then(({ words, wordSources }) => {
        box.textContent = "";
        if (!words.length) {
            const lbl = mk("span", "rg-chip-hint");
            lbl.textContent = "no trigger words found";
            lbl.title = "Looked for .cm-info.json, .civitai.info, .metadata.json and .json next to the LoRA, "
                + "and in the LoRA file's own metadata";
            box.appendChild(lbl);
            return;
        }
        const lbl = mk("span", "rg-chip-hint"); lbl.textContent = "triggers:";
        box.appendChild(lbl);
        words.forEach((w, i) => {
            const used = promptHas(getPrompt(), w);
            const from = wordSources[i] ? ` (from ${wordSources[i]})` : "";
            const c = mk("span", "rg-chip" + (used ? " used" : ""));
            c.textContent = (used ? "✓ " : "+ ") + w;
            c.title = (used ? "Already in the prompt" : "Click to add to the prompt") + from;
            c.addEventListener("pointerdown", (e) => e.stopPropagation());
            if (!used) c.addEventListener("click", () => onAdd(w));
            box.appendChild(c);
        });
    });
}
export const CHIP_CSS = `
.rg-chip-hint { opacity:.65; font-size:10px; }
.rg-chip { font-size:10px; line-height:14px; padding:0 6px; border-radius:8px; border:1px solid #666; cursor:pointer;
  background:#2a2a2a; color:#ddd; white-space:nowrap; max-width:220px; overflow:hidden; text-overflow:ellipsis; }
.rg-chip:hover { border-color:#5b8fd0; }
.rg-chip.used { border-color:#4a8a5a; color:#9fd8a8; cursor:default; }
`;

// ---------------------------------------------------------------- wildcards (ComfyUI Impact Pack)
// The run fills them with Impact Pack's own code (wildcards.py); here: the list for the picker and the __ autocomplete,
// the syntax check, and the seed control. Nothing shows while Impact Pack isn't installed.
let wcInfo = null, wcLoading = null;
const wcListeners = new Set();
export function wildcardInfo(refresh = false) {
    if (wcLoading && !refresh) return wcLoading;
    wcLoading = api.fetchApi(`/region_genie/wildcards${refresh ? "?refresh=1" : ""}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (wcInfo = { installed: !!j?.installed, names: Array.isArray(j?.names) ? j.names : [] }))
        .catch(() => (wcInfo = { installed: false, names: [] }))
        .then((info) => { for (const f of wcListeners) { try { f(info); } catch (e) { /* ignore */ } } return info; });
    return wcLoading;
}
export const wildcardsInstalled = () => !!wcInfo?.installed;
export const onWildcardInfo = (f) => { wcListeners.add(f); if (wcInfo) f(wcInfo); else wildcardInfo(); return () => wcListeners.delete(f); };
const WC_SYNTAX = /__[\w.\-+/*\\]+?__|\{[^{}]*\}/;
// same rule as wildcards.has_syntax: wildcard syntax, and not a JSON layout
export function hasWildcards(text) {
    if (typeof text !== "string" || !WC_SYNTAX.test(text)) return false;
    const t = text.trim();
    if (t[0] === "{" || t[0] === "[") { try { JSON.parse(t); return false; } catch (e) { /* not JSON */ } }
    return true;
}
export function insertAtCursor(ta, text) {
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
    ta.focus();
    ta.setRangeText(text, a, b, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
}
// the picker (pop-up editors): every wildcard Impact Pack knows, and reloading the files
export async function pickWildcard(ev, onPick) {
    ev.preventDefault(); ev.stopPropagation();
    const info = await wildcardInfo();
    if (!info.installed) return false;
    const RELOAD = "↻ Reload the wildcard files";
    const items = info.names.length ? [...info.names, null, RELOAD] : ["(no wildcards: put .txt files in Impact Pack's wildcards folder)", null, RELOAD];
    contextMenu(ev, items, "Wildcard", async (v) => {
        const name = typeof v === "string" ? v : (v?.content ?? v?.value);
        if (name === RELOAD) { await wildcardInfo(true); return; }
        if (typeof name === "string" && /^__.+__$/.test(name)) onPick(name);
    });
    return true;
}
// __ autocomplete (our own small list; works with or without a tag autocomplete pack)
const wcAc = { el: null, box: null, items: [], sel: 0, start: 0 };
function wcToken(el) {
    const p = el.selectionStart;
    if (p == null || p !== el.selectionEnd) return null;
    const m = /(?<![\w])__([\w.\-+/*\\]*)$/.exec(el.value.slice(0, p));
    if (!m || /__$/.test(m[1]) && m[1].length > 2) return null;          // a closed __name__ before the cursor
    return { start: p - m[0].length, text: m[1].toLowerCase() };
}
function wcHide() { if (wcAc.box) wcAc.box.style.display = "none"; wcAc.el = null; wcAc.items = []; }
const wcVisible = (el) => !!wcAc.el && wcAc.el === el && wcAc.box?.style.display !== "none" && wcAc.items.length > 0;
function wcAccept(i) {
    const el = wcAc.el, name = wcAc.items[i];
    if (!el || !name) return;
    const p = el.selectionStart;
    el.setRangeText(name, wcAc.start, p, "end");
    wcHide();
    el.dispatchEvent(new Event("input", { bubbles: true }));
}
function wcRender() {
    const box = wcAc.box;
    box.replaceChildren();
    wcAc.items.forEach((n, i) => {
        const d = document.createElement("div");
        d.className = "rg-wc-item" + (i === wcAc.sel ? " sel" : "");
        d.textContent = n;
        d.addEventListener("mousedown", (e) => { e.preventDefault(); wcAccept(i); });
        box.appendChild(d);
    });
}
function wcUpdate(el) {
    const tok = wildcardsInstalled() ? wcToken(el) : null;
    if (!tok) { if (wcAc.el === el) wcHide(); return; }
    const names = wcInfo.names, q = tok.text;
    const items = names.filter((n) => n.toLowerCase().slice(2).startsWith(q))
        .concat(names.filter((n) => !n.toLowerCase().slice(2).startsWith(q) && n.toLowerCase().includes(q))).slice(0, 12);
    if (!items.length) { wcHide(); return; }
    if (!wcAc.box) {
        wcAc.box = document.createElement("div");
        wcAc.box.className = "rg-wc-ac";
        wcAc.box.style.cssText = "position:fixed;z-index:10001;min-width:160px;max-width:360px;max-height:260px;overflow:auto;"
            + "background:var(--comfy-menu-bg,#2a2a2a);color:var(--input-text,#ddd);border:1px solid var(--border-color,#555);"
            + "border-radius:4px;font:12px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.5);";
        const st = document.createElement("style");
        st.textContent = ".rg-wc-item{padding:2px 8px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
            + ".rg-wc-item.sel,.rg-wc-item:hover{background:#3a6ea5;color:#fff}";
        document.head.appendChild(st);
        document.body.appendChild(wcAc.box);
    }
    hideList(attached.get(el));                    // the tag list makes way
    wcAc.el = el; wcAc.items = items; wcAc.start = tok.start;
    wcAc.sel = Math.min(wcAc.sel, items.length - 1);
    wcRender();
    const r = el.getBoundingClientRect();
    wcAc.box.style.display = "";
    const h = wcAc.box.offsetHeight;
    wcAc.box.style.left = Math.max(4, Math.min(window.innerWidth - wcAc.box.offsetWidth - 4, r.left)) + "px";
    wcAc.box.style.top = (r.bottom + 2 + h <= window.innerHeight ? r.bottom + 2 : Math.max(4, r.top - 2 - h)) + "px";
}
function attachWildcardComplete(el) {
    el.addEventListener("input", () => { wcAc.sel = 0; wcUpdate(el); });
    el.addEventListener("keydown", (e) => {
        if (!wcVisible(el)) return;
        const k = e.key;
        if (k === "ArrowDown" || k === "ArrowUp") wcAc.sel = (wcAc.sel + (k === "ArrowDown" ? 1 : wcAc.items.length - 1)) % wcAc.items.length, wcRender();
        else if (k === "Enter" || k === "Tab") wcAccept(wcAc.sel);
        else if (k === "Escape") wcHide();
        else return;
        e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    el.addEventListener("blur", () => setTimeout(() => { if (wcAc.el === el && document.activeElement !== el) wcHide(); }, 120));
    el.addEventListener("mousedown", () => { if (wcAc.el === el) wcHide(); });
}

// The wildcard seed control: a seed field, what happens to it after each run (fixed / randomize / increment, like
// ComfyUI's 'control after generate'), and a preview. It drives the node's hidden 'wildcard_seed' widget.
// host: { fields(): {key: text}, onFilled(filled, preview), useAll(), extraMenu?: [[label, fn]] }
const WC_MODES = { fixed: ["lock", "fixed: The seed stays as it is."], randomize: ["dice", "randomize: A new random seed after each run."],
                   increment: ["plusOne", "increment: The seed goes up by 1 after each run."] };
export function wildcardSeedControl(node, mk, host) {
    const box = mk("span", "rg-wc");
    box.style.display = "none";
    const seedW = node.widgets?.find((w) => w.name === "wildcard_seed");
    const btn = (name, title, fn) => {
        const b = mk("button", "rg-btn icon"); b.type = "button"; b.innerHTML = svgIcon(name); b.title = title;
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        b.addEventListener("click", (e) => { e.preventDefault(); fn(e); });
        return b;
    };
    const lbl = mk("span", "rg-wc-lbl"); lbl.innerHTML = svgIcon("wildcard");
    const inp = mk("input", "rg-num rg-wc-seed"); inp.type = "number"; inp.min = "0"; inp.step = "1";
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") inp.blur(); });
    inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    inp.addEventListener("change", () => { setSeed(Math.max(0, Math.floor(+inp.value || 0))); });
    const mode = () => (WC_MODES[node.properties?.rg_wc_mode] ? node.properties.rg_wc_mode : "randomize");
    const modeBtn = btn("dice", "", () => {
        const order = Object.keys(WC_MODES), next = order[(order.indexOf(mode()) + 1) % order.length];
        node.properties = node.properties || {}; node.properties.rg_wc_mode = next;
        refresh(); app.graph?.change?.();
    });
    const prevBtn = btn("eye", "Preview: Fill the wildcards with this seed now (without running); hover a field to see "
        + "what it becomes. Right-click for more.", () => preview());
    box.append(lbl, inp, modeBtn, prevBtn);
    const used = () => Object.values(host.fields() || {}).some((t) => hasWildcards(t));
    function setSeed(v) {
        if (!seedW) return;
        seedW.value = v;
        try { seedW.callback?.(v); } catch (e) { /* ignore */ }
        refresh(); app.graph?.change?.();
    }
    async function preview() {
        const fields = {};
        for (const [k, t] of Object.entries(host.fields() || {})) if (hasWildcards(t)) fields[k] = t;
        if (!Object.keys(fields).length) { host.onFilled({}, true, "No wildcards in this node's prompt fields"); return; }
        try {
            const r = await api.fetchApi("/region_genie/wildcards/fill", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields, seed: seedW?.value ?? 0, perField: !!getSetting(SET.wcPerField, false) }) });
            const j = await r.json();
            host.onFilled(j.filled || {}, true);
        } catch (e) { host.onFilled({}, true, "Preview failed: " + (e?.message || e)); }
    }
    box.addEventListener("contextmenu", (e) => {
        e.preventDefault(); e.stopPropagation();
        const items = [{ content: "Preview with this seed", fn: preview }, { content: "Use the filled text in all fields", fn: () => host.useAll() },
            { content: "New random seed", fn: () => setSeed(randomSeed()) }, null,
            ...Object.entries(WC_MODES).map(([k, [, t]]) => ({ content: (mode() === k ? "✓ " : "   ") + "After each run: " + t, fn: () => {
                node.properties = node.properties || {}; node.properties.rg_wc_mode = k; refresh(); } })),
            null, { content: "Insert a wildcard… (in a pop-up editor)", disabled: true },
            { content: "↻ Reload the wildcard files", fn: () => wildcardInfo(true) }, ...(host.extraMenu || [])];
        contextMenu(e, items, "Wildcards", (v) => v?.fn?.());
    });
    const randomSeed = () => Math.floor(Math.random() * 2 ** 50);
    // the hidden widget: 0 is sent while no field has wildcards (so the node stays cached), and after each run the
    // seed changes as the mode says (ComfyUI's 'Widget control mode' before / after is followed)
    if (seedW) {
        seedW.hidden = true;
        seedW.computeSize = () => [0, -4];
        const i = node.inputs?.findIndex((x) => x.name === "wildcard_seed");
        if (i != null && i !== -1) node.removeInput(i);
        seedW.serializeValue = () => (used() ? seedW.value : 0);
        const step = () => {
            if (!used()) return;
            const m = mode();
            if (m === "randomize") setSeed(randomSeed());
            else if (m === "increment") setSeed((Number(seedW.value) || 0) + 1);
        };
        const before = () => getSetting("Comfy.WidgetControlMode", "after") === "before";
        let queuedOnce = false;
        seedW.beforeQueued = () => { if (before() && queuedOnce) step(); queuedOnce = true; };
        seedW.afterQueued = () => { if (!before()) step(); };
    }
    function refresh() {
        // host.hideIdle: only while a prompt field has a wildcard (the Region Genie node's bottom bar)
        const show = wildcardsInstalled() && !!seedW && (!host.hideIdle || used()) ? "" : "none";
        if (box.style.display !== show) box.style.display = show;
        if (document.activeElement !== inp && seedW) inp.value = String(seedW.value ?? 0);
        const [icon, t] = WC_MODES[mode()];
        if (modeBtn.dataset.mode !== mode()) { modeBtn.innerHTML = svgIcon(icon); modeBtn.dataset.mode = mode(); }
        modeBtn.title = `After each run (when a field has wildcards):\n${t}\nClick to change.`;
        const u = used();
        lbl.title = inp.title = "Wildcard seed (ComfyUI Impact Pack): Fills __name__ and {a|b} in this node's prompt fields"
            + (u ? "." : ". No field has wildcards right now, so it isn't used.") + " Right-click for more.";
        box.classList.toggle("idle", !u);
    }
    onWildcardInfo(() => refresh());
    return { el: box, refresh, preview };
}
export const WC_CSS = `
.rg-wc { display:inline-flex; align-items:center; gap:2px; }
.rg-wc.idle .rg-wc-lbl, .rg-wc.idle .rg-wc-seed { opacity:.5; }
.rg-wc-lbl { line-height:0; opacity:.85; }
.rg-wc-lbl svg { width:15px; height:15px; display:block; }
.rg-wc-seed { max-width:none; }
.rg-wc .rg-btn, .rg-wc .rg-num { background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd); border:1px solid var(--border-color,#555);
  border-radius:4px; font:12px sans-serif; }
.rg-wc .rg-btn { cursor:pointer; padding:2px 4px; line-height:0; }
.rg-wc .rg-btn svg { width:16px; height:16px; display:block; }
.rg-wc .rg-num { padding:1px 3px; }
`;

// ---------------------------------------------------------------- expand button + floating pop-up editor
// (the Region Genie node keeps its own pop-ups inside the node; nodes with little room, like Regional LoRAs, use this one,
// which floats over the page at the field and may extend past the node)
const RECENT = new Map();               // values just written to Settings (the store saves asynchronously)
const recentGet = (id, d) => (RECENT.has(id) ? RECENT.get(id) : getSetting(id, d));
const recentSet = (id, v) => { RECENT.set(id, v); setSetting(id, v); setTimeout(() => { if (RECENT.get(id) === v) RECENT.delete(id); }, 3000); };
// a small ⤢ in the field's bottom-right corner (inside the field's parent element, left of a scrollbar)
// The expand button: opens a text field in its pop-up editor (double-click stays the browser's word selection).
// It sits inside the field's parent element, in the field's bottom-right corner, or centred on the right when the
// field is one line tall (a region's prompt in the list while it isn't being edited).
// It never lies on the scroll bar: a classic scroll bar takes its own room and the button goes left of it; an overlay
// scroll bar (Windows 11, macOS: drawn over the text, see overlayScrollbars()) is given OSB_W px while the field
// scrolls. And the text never runs under the button or the scroll bar: the field's right padding is set to the room
// they take (inline, so it wins over every style sheet).
// extras: more small controls for the same corner, placed left of the button in the order given (the LLM button of
// scene_prompt_positive; button.__rgAddExtra(el) adds one later). Returns the button; button.__rgPlace(), also
// field.__rgPlaceExpand(), puts everything in place again (call it when the field's text was set by code: no event
// tells).
const OSB_W = 14, EXP_W = 16, EXP_GAP = 2;
export function addExpandButton(t, title, onOpen, extras = []) {
    const host = t?.parentElement;
    if (!host) return null;
    const old = host.querySelector(":scope > .rg-expand");
    if (old && old.__rgFor === t) return old;
    old?.remove();
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const b = document.createElement("button");
    b.type = "button"; b.className = "rg-expand"; b.innerHTML = svgIcon("expand"); b.title = title; b.tabIndex = -1; b.__rgFor = t;
    for (const ev of ["pointerdown", "mousedown", "dblclick"]) b.addEventListener(ev, (e) => { e.stopPropagation(); if (ev !== "pointerdown") e.preventDefault(); });
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onOpen(); });
    let last = "";
    const place = () => {
        if (!t.isConnected || !t.offsetWidth) return;
        const classic = Math.max(0, t.offsetWidth - t.clientWidth - (t.clientLeft || 0) * 2);       // a scroll bar that takes room
        const scrolls = t.scrollHeight > t.clientHeight + 1;
        const bar = classic || (scrolls && overlayScrollbars() ? OSB_W : 0);
        const oneLine = t.clientHeight < EXP_W + 10;
        const right0 = host.clientWidth - (t.offsetLeft + t.offsetWidth) + (t.clientLeft || 0);     // the field's inner right edge
        const bottom0 = host.clientHeight - (t.offsetTop + t.offsetHeight) + (t.clientTop || 0);
        const items = [b, ...extras.filter((x) => x.isConnected && x.style.display !== "none")];
        let x = bar + EXP_GAP;
        for (const el of items) {
            const w = el === b ? EXP_W : el.offsetWidth || EXP_W, h = el === b ? EXP_W : el.offsetHeight || EXP_W;
            el.style.right = Math.round(right0 + x) + "px";
            el.style.bottom = Math.round((bottom0 + (oneLine ? Math.max(0, (t.clientHeight - h) / 2) : EXP_GAP + (EXP_W - h) / 2)) * 2) / 2 + "px";
            x += w + EXP_GAP;
        }
        // the text stops before them (a classic scroll bar is outside the padding already)
        const pad = x - classic;
        const sig = pad + "";
        if (sig !== last) { last = sig; t.style.setProperty("padding-right", pad + "px", "important"); }
    };
    b.__rgPlace = place; t.__rgPlaceExpand = place;
    b.__rgAddExtra = (el) => { if (!extras.includes(el)) extras.push(el); el.classList.add("rg-corner"); host.appendChild(el); last = ""; place(); };
    for (const ev of ["mouseenter", "focus", "input", "blur", "scroll"]) t.addEventListener(ev, () => requestAnimationFrame(place));
    try { new ResizeObserver(place).observe(t); } catch (e) { /* old browser */ }
    host.addEventListener("mouseenter", place);
    host.appendChild(b);
    for (const el of extras) { el.classList.add("rg-corner"); host.appendChild(el); }
    place();
    requestAnimationFrame(place);
    return b;
}
// The line at the bottom of a pop-up editor. A pop-up always keeps its text: Esc and the close button only close it
// (taking a change back is what its Undo / Redo buttons are for), and Enter starts a new line.
export const popFootText = (nav = true) => {
    const keys = [keyLabel(popKeyText(-1)), keyLabel(popKeyText(1))];
    return "Esc: close (the text stays)"
        + (nav && (keys[0] || keys[1]) ? ` · ${keys.filter(Boolean).join(" / ")}: ${keys[0] && keys[1] ? "previous / next" : keys[0] ? "previous" : "next"} field` : "");
};
// rg_keys.js puts its functions here when it loads (this file can't import it: it imports this one). Until then: the
// default keys.
export const KEYS = {
    is: (e, id) => (id === "edit.undo" ? keyHit(e, "Ctrl+Z") : id === "edit.redo" ? keyHit(e, "Ctrl+Shift+Z") || keyHit(e, "Ctrl+Y") : false),
    keyed: (text) => text,
};
// ---- a pop-up editor's own Undo / Redo for its text box (the buttons, and the keys of "Undo" / "Redo").
// The browser's own undo is lost whenever code sets the text (a wildcard, the tag list, the LLM, "use the filled
// text"), and it can't tell a button whether there is anything to take back.
// store: an object the caller keeps for as long as the steps should live ({} to start with): closing the pop-up and
// opening it again, or stepping to another field and back, keeps them. o.apply(text): the text box was set to a step
// (store it where the text lives). o.onChange(): there may be a step more or less now (the buttons).
const HIST_MAX = 200, HIST_RUN_MS = 800;
export function textHistory(ta, store, o = {}) {
    const state = () => ({ v: ta.value, a: ta.selectionStart ?? ta.value.length, b: ta.selectionEnd ?? ta.value.length });
    if (!Array.isArray(store.steps) || !store.steps.length) { store.steps = [state()]; store.at = 0; }
    let run = "", runT = 0;                         // typing in one go is one step: the kind of input, when it last came
    const top = () => store.steps[store.at];
    const push = () => {
        store.steps.length = store.at + 1; store.steps.push(state());
        if (store.steps.length > HIST_MAX) store.steps.shift();
        store.at = store.steps.length - 1;
    };
    // the text is not what the last step says: code changed it, or it changed while the pop-up was closed. A step of its own
    const sync = () => { if (top().v !== ta.value) { push(); run = ""; } o.onChange?.(); };
    const onInput = (e) => {
        if (top().v === ta.value) return;
        const kind = e?.inputType || "", t = performance.now();
        const typing = kind === "insertText" || kind === "deleteContentBackward" || kind === "deleteContentForward" || kind === "insertCompositionText";
        // a new word starts a new step too, so Undo doesn't take a whole paragraph typed without a pause
        const newWord = kind === "insertText" && /\s/.test(e.data || "") === false && /\s$/.test(top().v.slice(0, top().a));
        if (typing && kind === run && t - runT < HIST_RUN_MS && store.at > 0 && !newWord) store.steps[store.at] = state();
        else push();
        run = typing ? kind : ""; runT = t;
        o.onChange?.();
    };
    const go = (d) => {
        if (top().v !== ta.value) push();            // a change by code since the last step: don't lose it
        const at = store.at + d;
        if (at < 0 || at >= store.steps.length) return false;
        store.at = at; run = "";
        const st = top();
        ta.value = st.v;
        try { ta.setSelectionRange(Math.min(st.a, st.v.length), Math.min(st.b, st.v.length)); } catch (e) { /* not focusable right now */ }
        o.apply?.(st.v);
        o.onChange?.();
        return true;
    };
    const api_ = { sync, undo: () => go(-1), redo: () => go(1), canUndo: () => store.at > 0 || top().v !== ta.value, canRedo: () => store.at < store.steps.length - 1 && top().v === ta.value };
    ta.addEventListener("input", onInput);
    // the cursor's place belongs to the step (so Redo puts it back where the typing ended)
    ta.addEventListener("blur", () => { run = ""; });
    ta.addEventListener("keydown", (e) => {
        const d = KEYS.is(e, "edit.undo") ? -1 : KEYS.is(e, "edit.redo") ? 1 : 0;
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        go(d);
    });
    // the browser's own undo (its menu, a system gesture) goes the same way
    ta.addEventListener("beforeinput", (e) => {
        if (e.inputType !== "historyUndo" && e.inputType !== "historyRedo") return;
        e.preventDefault(); go(e.inputType === "historyUndo" ? -1 : 1);
    });
    sync();
    return api_;
}
// The Undo / Redo buttons of a pop-up editor. current(): the textHistory() of the text box in use (or null).
// Returns { undo, redo (the buttons), refresh() }.
export function historyButtons(current, cls = "rg-btn ico") {
    const mk = (icon, tip, fn) => {
        const b = document.createElement("button"); b.type = "button"; b.className = cls + " rg-hist"; b.dataset.ic = icon;
        b.innerHTML = svgIcon(icon); b.__rgTitle = tip; b.title = KEYS.keyed(tip);
        b.addEventListener("mousedown", (e) => e.preventDefault());              // the text box keeps the cursor
        b.addEventListener("click", (e) => { e.preventDefault(); if (!b.disabled) fn(); });
        return b;
    };
    const undo = mk("undo", "Undo: Take back the last change to this text (Ctrl+Z).\nThe steps stay when the pop-up is closed and opened again.", () => current()?.undo());
    const redo = mk("redo", "Redo: Bring back the change that was taken back (Ctrl+Shift+Z / Ctrl+Y).", () => current()?.redo());
    const refresh = () => { const h = current(); undo.disabled = !h?.canUndo(); redo.disabled = !h?.canRedo(); };
    refresh();
    return { undo, redo, refresh };
}
// ---- the keys that step to the previous / next text field in a pop-up editor (Settings > Region Genie > Text size):
// a key name as the browser gives it, with modifiers, e.g. "PageUp", "Alt+ArrowLeft", "Ctrl+PageDown", "F2"; empty = off
const KEY_ALIASES = { pgup: "pageup", "page up": "pageup", pgdn: "pagedown", pgdown: "pagedown", "page down": "pagedown",
    left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown", "←": "arrowleft", "→": "arrowright", "↑": "arrowup",
    "↓": "arrowdown", esc: "escape", del: "delete", ins: "insert", space: " ", spacebar: " ", plus: "+" };
const MOD = { ctrl: "ctrl", control: "ctrl", alt: "alt", option: "alt", opt: "alt", shift: "shift", meta: "meta", cmd: "meta", command: "meta", win: "meta" };
export function parseKey(text) {
    // "Alt + Arrow Left" → { alt, key: "arrowleft" }: the last part is the key, the parts before it modifiers
    const parts = String(text || "").split("+").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return null;
    const mods = { ctrl: false, alt: false, shift: false, meta: false };
    for (const p of parts.slice(0, -1)) { if (!MOD[p]) return null; mods[MOD[p]] = true; }
    const last = parts[parts.length - 1].replace(/\s+/g, " ");
    const key = KEY_ALIASES[last] || KEY_ALIASES[last.replace(/ /g, "")] || last.replace(/ /g, "");
    return { ...mods, key };
}
const keyMatches = (e, k) => !!k && (e.key || "").toLowerCase() === k.key && e.ctrlKey === k.ctrl && e.altKey === k.alt && e.metaKey === k.meta
    && (e.shiftKey === k.shift || (k.key.length === 1 && !k.shift && /[^a-z0-9]/.test(k.key)));
export const keyHit = (e, text) => keyMatches(e, parseKey(text));        // a key event is the key written as "Alt+Enter"
export const popKeyText = (dir) => String(getSetting(dir < 0 ? SET.popPrevKey : SET.popNextKey, dir < 0 ? "PageUp" : "PageDown") ?? "");
// -1 / 1 when the key event is the 'previous' / 'next' field key, else 0
export function popNavDir(e) {
    if (keyMatches(e, parseKey(popKeyText(-1)))) return -1;
    if (keyMatches(e, parseKey(popKeyText(1)))) return 1;
    return 0;
}
// a key as people write it: "Page Up", "Alt+←"
export function keyLabel(text) {
    const k = parseKey(text);
    if (!k) return "";
    const names = { pageup: "Page Up", pagedown: "Page Down", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓", " ": "Space", escape: "Esc" };
    const key = names[k.key] || (k.key.length === 1 ? k.key.toUpperCase() : k.key[0].toUpperCase() + k.key.slice(1));
    return [k.ctrl && "Ctrl", k.alt && "Alt", k.shift && "Shift", k.meta && "Meta", key].filter(Boolean).join("+");
}
// the tooltip of a pop-up's ◀ / ▶: what it does, and its key
export function popNavTip(dir, what) {
    const k = keyLabel(popKeyText(dir));
    return (dir < 0 ? `The previous text field of this node (${what}), opened in this place and size; from the first it goes to the last.`
                    : `The next text field of this node (${what}), opened in this place and size; from the last it goes to the first.`)
        + (k ? `\nShortcut: Change it in the shortcut list (${k}).` : "");
}
// the owner node is gone, or not on the canvas any more (another workflow tab, or into / out of a subgraph)
export const nodeOffCanvas = (node) => !node?.graph || (app.canvas?.graph != null && app.canvas.graph !== node.graph);
// the natural height of a pop-up laid out with 14 px text, so its text size (A− / A+) doesn't change its size
export function naturalHeight(box, tas) {
    const keep = tas.map((t) => [t.style.fontSize, t.style.lineHeight]);
    for (const t of tas) { t.style.fontSize = "14px"; t.style.lineHeight = "18px"; }
    box.style.height = "";
    const h = box.offsetHeight;
    tas.forEach((t, i) => { t.style.fontSize = keep[i][0]; t.style.lineHeight = keep[i][1]; });
    return h;
}
let fpop = null;
export const floatPopupOpen = () => !!fpop;
export function closeFloatPopup() { fpop?.close(); }
// o: { anchor, title, value, onInput(v), fontKey (a SET text-size id), node (autocomplete; the pop-up closes when the
//      node leaves the canvas), filled?() -> text | null, hint?, onClose?, nav?(dir, geom) (◀ / ▶: open the previous / next
//      field there), at? { left, top, width, height } (a place and size to open at: stepping with ◀ / ▶),
//      history? (an object kept by the caller: this field's Undo / Redo steps, see textHistory()) }
// It stays open until Esc, the close button, another pop-up, or the node leaving the canvas (a click elsewhere doesn't
// close it), and always keeps its text; Enter is a new line.
export function openFloatPopup(o) {
    closeFloatPopup();
    const box = document.createElement("div"); box.className = "rg-fpop";
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const head = mk("div", "rg-fpop-head"), title = mk("span", "rg-fpop-title", o.title);
    const btn = (cls, html, tip, fn) => { const b = mk("button", "rg-btn " + cls); b.type = "button"; b.innerHTML = html; b.title = tip;
        b.addEventListener("click", (e) => { e.preventDefault(); fn(e); }); return b; };
    const ta = mk("textarea"); ta.rows = 10; ta.spellcheck = false; ta.value = String(o.value ?? "");
    const fs = () => Math.max(8, Math.min(40, Math.round(+recentGet(o.fontKey, 14)) || 14));
    const applyFont = () => { const f = fs(); ta.style.fontSize = f + "px"; ta.style.lineHeight = Math.round(f * 1.3) + "px"; };
    const font = (d) => { recentSet(o.fontKey, Math.max(8, Math.min(40, fs() + d))); applyFont(); };
    const fm = btn("rg-fpop-font", "A−", "Smaller text (Settings > Region Genie > Text size)", () => font(-1));
    const fp = btn("rg-fpop-font", "A+", "Larger text (Settings > Region Genie > Text size)", () => font(1));
    const wc = btn("icon", svgIcon("wildcard"), "Insert a wildcard (ComfyUI Impact Pack) at the cursor", (e) => pickWildcard(e, (n) => insertAtCursor(ta, n)));
    wc.style.display = wildcardsInstalled() ? "" : "none";
    const use = btn("icon", svgIcon("useFilled"), "", () => { const f = o.filled?.(ta.value); if (f != null) { ta.value = f; o.onInput(f); syncUse(); hist.sync(); } });
    const syncUse = () => { const f = o.filled?.(ta.value); use.style.display = f != null ? "" : "none";
        use.title = f != null ? `Use the filled text: Replace the wildcards with what they produced (last run or preview):\n${f}` : ""; };
    const x = btn("rg-x", svgIcon("close"), "Close (Esc).\nThe text stays as it is: Undo takes a change back.", () => close());
    let hb = null;                             // (textHistory() reports once before the buttons exist)
    const hist = textHistory(ta, o.history || {}, { apply: (v) => { o.onInput(v); syncUse(); }, onChange: () => hb?.refresh() });
    hb = historyButtons(() => hist, "rg-btn icon");
    const geom = () => ({ left: box.offsetLeft, top: box.offsetTop, width: box.offsetWidth, height: box.offsetHeight });
    const prev = btn("rg-nav", "◀", popNavTip(-1, o.navWhat || "in order"), () => o.nav(-1, geom()));
    const next = btn("rg-nav", "▶", popNavTip(1, o.navWhat || "in order"), () => o.nav(1, geom()));
    if (!o.nav) prev.style.display = next.style.display = "none";
    // the node's tag autocomplete switch (the same one as in the node's bottom bar: it acts on every field of the node)
    const ac = o.node ? autocompleteToggle(o.node, (tag, cls) => mk(tag, cls), true) : null;
    head.append(title, prev, next, hb.undo, hb.redo, fm, fp, use, x);
    head.title = "Drag to move (anywhere on the screen).\nDouble-click: Back next to the field.";
    // below the text, on the right: the tag autocomplete switch and the wildcard list (the row goes when neither shows)
    const ctl = mk("div", "rg-fpop-ctl");
    ctl.append(...(ac ? [ac.el] : []), wc);
    const syncCtl = () => { const any = [...ctl.children].some((c) => c.style.display !== "none"); if ((ctl.style.display !== "none") !== any) ctl.style.display = any ? "" : "none"; };
    const foot = mk("div", "rg-fpop-foot", o.hint || popFootText(!!o.nav));
    const grip = mk("div", "rg-fpop-grip"); grip.title = "Drag to resize (remembered).\nDouble-click: Back to the default size.";
    box.append(head, ta, ctl, foot, grip);
    syncCtl();
    for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "contextmenu", "keyup", "keypress"]) box.addEventListener(ev, (e) => e.stopPropagation());
    box.dataset.captureWheel = "true";
    ta.addEventListener("input", () => { o.onInput(ta.value); syncUse(); });
    box.addEventListener("keydown", (e) => {
        e.stopPropagation();
        const dir = o.nav ? popNavDir(e) : 0;
        if (dir && !autocompleteOpen(e.target, e)) { e.preventDefault(); o.nav(dir, geom()); return; }
        if (e.key === "Escape" && !autocompleteOpen(e.target, e)) { e.preventDefault(); if (!closeComfyMenus()) close(); }
    });
    if (o.node) attachAutocomplete(ta, o.node);
    document.body.appendChild(box);
    // size (remembered for every node), then the place: just below the field, else above it, kept on screen
    const sizes = () => { try { return JSON.parse(recentGet(SET.popSizes, "{}") || "{}") || {}; } catch (e) { return {}; } };
    const W = () => window.innerWidth, H = () => window.innerHeight;
    function layout(atField) {
        if (o.at && atField) {                     // stepped here with ◀ / ▶: the same place and size
            box.style.width = Math.max(260, Math.min(W() - 12, o.at.width)) + "px";
            box.style.height = Math.max(160, Math.min(H() - 12, o.at.height)) + "px";
            box.classList.add("sized");
            box.style.left = Math.max(0, Math.min(W() - 40, o.at.left)) + "px";
            box.style.top = Math.max(0, Math.min(H() - 30, o.at.top)) + "px";
            return;
        }
        const sz = sizes().float || {};
        box.style.width = Math.max(260, Math.min(W() - 12, sz.w || 560)) + "px";
        // not resized by hand: the height it has with 14 px text (so A− / A+ don't change it)
        box.style.height = Math.max(160, Math.min(H() - 12, sz.h || naturalHeight(box, [ta]))) + "px";
        box.classList.add("sized");
        if (!atField) return;
        const r = o.anchor?.getBoundingClientRect?.() || { left: 40, top: 40, bottom: 60 }, w = box.offsetWidth, h = box.offsetHeight;
        box.style.left = Math.max(6, Math.min(W() - w - 6, r.left)) + "px";
        box.style.top = (r.bottom + 4 + h <= H() - 6 ? r.bottom + 4 : r.top - 4 - h >= 6 ? r.top - 4 - h : Math.max(6, H() - 6 - h)) + "px";
    }
    applyFont(); syncUse(); layout(true);
    const drag = (e, onMove, onEnd) => {
        e.preventDefault(); e.stopPropagation();
        const t = e.currentTarget, x0 = e.clientX, y0 = e.clientY;
        t.setPointerCapture?.(e.pointerId);
        const move = (ev) => onMove(ev.clientX - x0, ev.clientY - y0);
        const up = () => { t.removeEventListener("pointermove", move); t.removeEventListener("pointerup", up); t.removeEventListener("pointercancel", up); onEnd?.(); };
        t.addEventListener("pointermove", move); t.addEventListener("pointerup", up); t.addEventListener("pointercancel", up);
    };
    head.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest("button")) return;
        const l0 = box.offsetLeft, t0 = box.offsetTop;
        drag(e, (dx, dy) => { box.style.left = Math.max(0, Math.min(W() - 40, l0 + dx)) + "px"; box.style.top = Math.max(0, Math.min(H() - 30, t0 + dy)) + "px"; });
    });
    head.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) layout(true); });
    grip.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const w0 = box.offsetWidth, h0 = box.offsetHeight;
        drag(e, (dx, dy) => { box.style.width = Math.max(260, w0 + dx) + "px"; box.style.height = Math.max(160, h0 + dy) + "px"; box.classList.add("sized"); },
             () => { const all = sizes(); all.float = { w: box.offsetWidth, h: box.offsetHeight }; recentSet(SET.popSizes, JSON.stringify(all)); });
    });
    grip.addEventListener("dblclick", () => { const all = sizes(); delete all.float; recentSet(SET.popSizes, JSON.stringify(all)); layout(false); });
    // closes when its node leaves the canvas (another workflow tab, a subgraph, the node removed)
    const watch = setInterval(() => { if (o.node && nodeOffCanvas(o.node)) close(); else if (!box.isConnected) close(); else syncCtl(); }, 300);
    function close() {
        ac?.dispose();
        if (fpop !== api_) return;
        fpop = null;
        clearInterval(watch);
        box.remove();
        o.onClose?.();
    }
    const api_ = { close, box, ta, history: hist };
    fpop = api_;
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    return api_;
}
export const FPOP_CSS = `
.rg-fpop { position:fixed; z-index:10000; box-sizing:border-box; display:flex; flex-direction:column; gap:5px; padding:6px 8px 5px;
  background:#1a1a1a; color:#eee; border:2px solid #5b8fd0; border-radius:6px; box-shadow:0 6px 22px rgba(0,0,0,.65); font:12px sans-serif; }
.rg-fpop-head { display:flex; align-items:center; gap:6px; font-weight:600; cursor:move; user-select:none; touch-action:none; }
.rg-fpop-title { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rg-fpop .rg-btn { background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px;
  padding:0 5px; font:11px sans-serif; line-height:16px; cursor:pointer; }
.rg-fpop .rg-btn.icon { line-height:0; padding:1px 3px; }
.rg-fpop .rg-btn.icon svg { width:14px; height:14px; display:block; }
.rg-fpop textarea { width:100%; box-sizing:border-box; resize:none; background:var(--comfy-input-bg,#222); color:inherit;
  border:1px solid var(--border-color,#555); border-radius:4px; padding:3px 5px; font-family:inherit; scrollbar-width:thin; }
.rg-fpop textarea:focus { border-color:#5b8fd0; outline:none; }
.rg-fpop.sized textarea { flex:1 1 auto; min-height:40px; }
.rg-fpop-foot { font-size:10px; opacity:.5; }
.rg-fpop-ctl { display:flex; align-items:center; justify-content:flex-end; gap:6px; }
.rg-fpop-head .rg-nav { padding:0 4px; }
.rg-fpop .rg-btn:disabled { opacity:.35; cursor:default; }
/* click areas as in the node (editor/style.js, round 39): at least 24 px tall, out to the middle of the gap */
.rg-fpop-head .rg-btn, .rg-fpop-ctl .rg-btn, .rg-fpop-ctl .rg-ac-btn { position:relative; isolation:isolate; }
.rg-fpop-head .rg-btn::before, .rg-fpop-ctl .rg-btn::before, .rg-fpop-ctl .rg-ac-btn::before {
  content:""; position:absolute; z-index:-1; left:-4px; right:-4px; top:50%; height:max(100%, 24px); transform:translateY(-50%); }   /* 1 px border + half the gap */
.rg-fpop-grip { position:absolute; right:1px; bottom:1px; width:14px; height:14px; cursor:nwse-resize; touch-action:none; opacity:.7;
  background:linear-gradient(135deg, transparent 52%, #5b8fd0 52% 60%, transparent 60% 70%, #5b8fd0 70% 78%, transparent 78%); }
.rg-expand { position:absolute; z-index:3; width:16px; height:16px; padding:0; margin:0; border:0; border-radius:3px; background:transparent;
  color:var(--input-text,#ddd); opacity:.3; cursor:pointer; line-height:0; }
.rg-expand svg { width:12px; height:12px; display:block; margin:2px; }
.rg-expand:hover { opacity:1; background:rgba(91,143,208,.35); }
*:hover > .rg-expand { opacity:.75; }
`;

// ---------------------------------------------------------------- tag autocomplete
// Two engines are supported, both loaded from their own packs and following their own settings:
//  - the AutoCompleter of ComfyUI-Custom-Scripts (pysssss), preferred while it is installed and enabled
//    (Settings > pysssss > Text Autocomplete: separator, underscores, Tab/Enter, suggestion count ...)
//  - the Tag Autocomplete of ComfyUI-Lora-Manager (Settings > LoRA Manager > Autocomplete)
// Every Region Genie node has its own on/off switch; new nodes start with the global default
// (Settings > Region Genie > Tag autocomplete). Without either pack nothing happens.
export const AC_DEFAULT_SETTING = "RegionGenie.Autocomplete.DefaultOn";
export const AC_PROPERTY = "rg_autocomplete";
const engines = { pysssss: undefined, lm: undefined };       // undefined = not looked for yet, null = not installed
let enginesLoading = null;
async function importExt(match, rel) {
    const exts = await api.getExtensions();
    const url = (exts || []).find(match);
    if (!url) return null;
    const full = new URL(rel, new URL(api.fileURL ? api.fileURL(url) : url, location.href)).href;
    return await import(full);
}
export function loadAutocompleteEngines() {
    if (enginesLoading) return enginesLoading;
    enginesLoading = (async () => {
        try {
            const mod = await importExt((u) => /custom[-_ ]?scripts/i.test(u) && /\/autocompleter\.js$/i.test(u), "./common/autocomplete.js");
            engines.pysssss = typeof mod?.TextAreaAutoComplete === "function" ? mod.TextAreaAutoComplete : null;
        } catch (e) { engines.pysssss = null; console.warn("[Region Genie] Custom-Scripts autocomplete not available:", e); }
        try {
            const mod = await importExt((u) => /lora[-_ ]?manager/i.test(u) && /\/autocomplete\.js$/i.test(u), "./autocomplete.js");
            if (typeof mod?.AutoComplete === "function") {
                let settings = null;
                try { settings = await importExt((u) => /lora[-_ ]?manager/i.test(u) && /\/autocomplete\.js$/i.test(u), "./settings.js"); } catch (e) { settings = null; }
                engines.lm = { AutoComplete: mod.AutoComplete, settings };
            } else engines.lm = null;
        } catch (e) { engines.lm = null; console.warn("[Region Genie] LoRA Manager autocomplete not available:", e); }
        resyncAll();
        return engines;
    })();
    return enginesLoading;
}
const pysssssOn = () => !!engines.pysssss && engines.pysssss.enabled !== false;
// the engine in use right now: Custom-Scripts when installed and enabled, else LoRA Manager, else none
export function activeEngine() {
    if (pysssssOn()) return "pysssss";
    if (engines.lm) return "lm";
    return null;
}
export const engineName = (e = activeEngine()) => ({ pysssss: "ComfyUI-Custom-Scripts AutoCompleter", lm: "LoRA Manager Tag Autocomplete" })[e] || "";
export function autocompleteDefault() { return getSetting(AC_DEFAULT_SETTING, true) !== false; }
export function autocompleteEnabledFor(node) {
    const v = node?.properties?.[AC_PROPERTY];
    return typeof v === "boolean" ? v : autocompleteDefault();
}
export function setAutocompleteFor(node, on) {
    node.properties = node.properties || {};
    node.properties[AC_PROPERTY] = !!on;
    node.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
    resyncAll();
}

// element -> { node, engine, inst, pys }
const attached = new Map();
// Forget fields that left the page. A field registered before it is put on the page is kept (round 37: the large
// editor's first two scene boxes lost their registration to the third one's sweep, so they never got a list);
// it is dropped only once it has been on the page, or after a minute without ever getting there.
function sweepAutocomplete() {
    const now = performance.now();
    for (const [el, st] of attached) {
        if (el.isConnected) { st.seen = true; continue; }
        if (!st.seen && now - st.t0 < 60000) continue;
        if (st.engine === "lm" && st.inst) { try { st.inst.destroy(); } catch (e) { /* ignore */ } }
        if (st.pys) { try { st.pys.dropdown?.remove(); } catch (e) { /* ignore */ } }
        attached.delete(el);
    }
}
function lmAcceptsKey(key) {
    let mode = "both";
    try { mode = engines.lm?.settings?.getAutocompleteAcceptKeyPreference?.() || "both"; } catch (e) { mode = "both"; }
    if (/tab/i.test(mode) && !/enter|both/i.test(mode)) return key === "Tab";
    if (/enter/i.test(mode) && !/tab|both/i.test(mode)) return key === "Enter";
    return key === "Tab" || key === "Enter";
}
function listVisible(st) {
    if (!st) return false;
    if (st.engine === "lm") return !!st.inst?.isVisible;
    if (st.engine === "pysssss") return !!st.pys?.dropdown?.parentElement;
    return false;
}
function hideList(st) {
    if (st?.engine === "lm") { try { st.inst?.hide?.(); } catch (e) { /* ignore */ } }
    if (st?.pys) { try { st.pys.dropdown?.remove(); st.pys.selected = null; } catch (e) { /* ignore */ } }
}
// true while the list is open and this key belongs to it (Enter/Tab accept, arrows move, Esc closes).
// Pass the key event: when the engine's own handler ran first it has already used the key (defaultPrevented).
export function autocompleteOpen(el, ev) {
    if (ev?.defaultPrevented) return true;
    if (wcVisible(el)) return true;
    const st = attached.get(el);
    if (!listVisible(st)) return false;
    if (!ev) return true;
    if (st.engine === "lm" && (ev.key === "Enter" || ev.key === "Tab")) return lmAcceptsKey(ev.key);
    if (st.engine === "pysssss" && ev.key === "Enter") return engines.pysssss?.insertOnEnter !== false && !ev.ctrlKey;
    if (st.engine === "pysssss" && ev.key === "Tab") return engines.pysssss?.insertOnTab !== false;
    return true;
}
// clicks in an autocomplete list are not "outside" an editor
export const inAutocompleteList = (target) => !!target?.closest?.(".comfy-autocomplete-dropdown, .lm-popover, .pysssss-autocomplete, .rg-wc-ac");

// make the element use the engine it should right now (on focus, and when a switch or setting changes)
function syncElement(el) {
    const st = attached.get(el);
    if (!st || !el.isConnected) return;
    const want = autocompleteEnabledFor(st.node) ? activeEngine() : null;
    if (st.engine === want && (want !== "pysssss" || st.pys?.overrideWords !== RG_NO_WORDS)) return;
    // leave the current engine
    if (st.engine === "lm" && st.inst) { try { st.inst.destroy(); } catch (e) { /* ignore */ } st.inst = null; }
    if (st.pys) { hideList({ pys: st.pys }); st.pys.overrideWords = RG_NO_WORDS; }    // can't be removed: no words = silent
    st.engine = want;
    try {
        if (want === "lm") {
            st.inst = new engines.lm.AutoComplete(el, "prompt", { maxItems: 20, minChars: 1, debounceDelay: 200, itemHeight: 24 });
            st.inst.dropdown?.classList.add("rg-ac");
        } else if (want === "pysssss") {
            if (!st.pys) {
                st.pys = new engines.pysssss(el); st.pys.dropdown?.classList.add("rg-ac");
                // Custom-Scripts places its list by the graph's zoom, which is right for a field on a node but not
                // for one in a pop-up editor or the large editor (not zoomed): use the field's real scale
                if (st.pys.helper) st.pys.helper.getScale = () => (el.offsetHeight ? el.getBoundingClientRect().height / el.offsetHeight : 1);
            }
            st.pys.overrideWords = undefined;                // its global word list again
        }
    } catch (e) { console.warn("[Region Genie] autocomplete:", e); st.engine = null; }
}
const RG_NO_WORDS = Object.freeze({});
export function resyncAll() { for (const el of [...attached.keys()]) syncElement(el); }
export function attachAutocomplete(el, node) {
    if (!el) return;
    if (attached.has(el)) { attached.get(el).node = node || attached.get(el).node; return; }
    sweepAutocomplete();
    const st = { node, engine: null, inst: null, pys: null, seen: el.isConnected, t0: performance.now() };
    attached.set(el, st);
    attachWildcardComplete(el);
    // our listeners come first, so moving the cursor or clicking in the text closes the list before the
    // engine would update it (typing opens it again)
    el.addEventListener("mousedown", () => { if (listVisible(st)) hideList(st); });
    const NAV = new Set(["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
    el.addEventListener("keydown", (e) => { if (NAV.has(e.key) && listVisible(st)) { hideList(st); st.navHidden = true; } });
    el.addEventListener("keyup", (e) => { if (NAV.has(e.key) && st.navHidden) { st.navHidden = false; if (st.engine === "pysssss") e.preventDefault(); } });
    el.addEventListener("focus", () => syncElement(el));
    if (engines.pysssss === undefined || engines.lm === undefined) loadAutocompleteEngines().then(() => syncElement(el));
    else syncElement(el);
}
export function detachAutocomplete(el) {
    const st = attached.get(el);
    if (st?.engine === "lm" && st.inst) { try { st.inst.destroy(); } catch (e) { /* ignore */ } }
    if (st?.pys) { hideList(st); st.pys.overrideWords = RG_NO_WORDS; }
    attached.delete(el);
}
// our own prompt fields
export function autocompleteOnFocus(el, node) { attachAutocomplete(el, node); }

// the switch shown on the nodes: a tag icon, lit when on and slashed when off (hidden while neither pack is installed)
// keepFocus: in a pop-up editor, a click on it leaves the text box focused (typing goes on)
export function autocompleteToggle(node, mk, keepFocus = false) {
    const b = mk("button", "rg-ac-btn");
    b.type = "button";
    b.style.display = "none";
    let shown = "";
    const refresh = () => {
        const eng = activeEngine(), on = autocompleteEnabledFor(node);
        const disp = eng ? "" : "none";
        if (b.style.display !== disp) b.style.display = disp;
        const title = (on ? "Tag autocomplete on" : "Tag autocomplete off") + ` in this node's prompt fields (${engineName(eng)}; `
            + "its own settings apply). Click to switch it for this node; new nodes start with the default from "
            + "Settings > Region Genie.";
        const sig = `${on}|${title}`;
        if (sig === shown) return;                     // don't touch it while a tooltip may be showing
        shown = sig;
        setHTML(b, svgIcon(on ? "tag" : "tagOff"));
        b.classList.toggle("on", on);
        b.title = title;
        b.setAttribute("aria-pressed", String(on));
    };
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    if (keepFocus) b.addEventListener("mousedown", (e) => e.preventDefault());
    // the switch is the node's: every button of it (the footer's, a pop-up's) follows at once
    b.addEventListener("click", (e) => { e.preventDefault(); setAutocompleteFor(node, !autocompleteEnabledFor(node)); for (const f of toggles) f(); });
    loadAutocompleteEngines().then(refresh);
    toggles.add(refresh);
    refresh();
    return { el: b, refresh, dispose: () => toggles.delete(refresh) };
}
const toggles = new Set();
setInterval(() => { for (const f of toggles) f(); }, 2000);      // engines can be switched on/off in their settings

// ---------------------------------------------------------------- Settings > Region Genie
// Defaults for the nodes of this pack. Most apply when a node is added (nodes in saved workflows keep their values).
export function getSetting(id, dflt) {
    try {
        const v = app.extensionManager?.setting?.get?.(id) ?? app.ui?.settings?.getSettingValue?.(id);
        return v === undefined || v === null ? dflt : v;
    } catch (e) { return dflt; }
}
// change a setting from a node's own control (the same value as in the Settings dialog)
export async function setSetting(id, v) {
    try {
        if (app.extensionManager?.setting?.set) await app.extensionManager.setting.set(id, v);
        else await app.ui?.settings?.setSettingValueAsync?.(id, v);
    } catch (e) { console.warn("[Region Genie] could not save setting", id, e); }
}
// ---------------------------------------------------------------- image size (shared by the size row and Settings)
// ComfyUI's Resolution Selector (comfy_extras/nodes_resolution.py): its aspect ratios and its formula
export const SIZE_ASPECTS = [["1:1 (Square)", 1, 1], ["2:3 (Portrait Photo)", 2, 3], ["3:2 (Photo)", 3, 2],
    ["3:4 (Portrait Standard)", 3, 4], ["4:3 (Standard)", 4, 3], ["9:16 (Portrait Widescreen)", 9, 16],
    ["16:9 (Widescreen)", 16, 9], ["21:9 (Ultrawide)", 21, 9]];
export const pyRound = (x) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
export function ratioSize(wr, hr, mp, multiple) {
    const scale = Math.sqrt((mp * 1024 * 1024) / (wr * hr));
    return [pyRound(wr * scale / multiple) * multiple, pyRound(hr * scale / multiple) * multiple];
}
// presets: "1024x1024; 1216x832 landscape; ..." (a name after the size is optional)
export const SIZE_PRESETS_DEFAULT = "1024x1024; 1152x896; 896x1152; 1216x832; 832x1216; 1344x768; 768x1344; 1536x640; 640x1536";
export function parseSizePresets(text) {
    const out = [];
    for (const part of String(text ?? "").split(/[;\n]/)) {
        const m = /^\s*(\d+)\s*[x×*]\s*(\d+)\s*(.*?)\s*$/i.exec(part);
        if (!m) continue;
        const w = Math.max(16, Math.min(16384, +m[1])), h = Math.max(16, Math.min(16384, +m[2]));
        out.push({ w, h, name: m[3].replace(/[;\n]/g, " ").trim() });
    }
    return out;
}
export const formatSizePresets = (list) => list.map((p) => `${p.w}x${p.h}${p.name ? " " + p.name : ""}`).join("; ");
// "3:2" for 1216 x 832: the simplest ratio within 3 % (else the closest one), for the presets list
export function ratioLabel(w, h) {
    let best = null;
    for (let b = 1; b <= 16; b++) {
        const a = Math.round(w / h * b);
        if (a < 1) continue;
        const err = Math.abs(a / b - w / h) / (w / h);
        if (err <= 0.03) return `${a}:${b}`;
        if (!best || err < best.err - 1e-9) best = { a, b, err };
    }
    return best ? `${best.a}:${best.b}` : "";
}

export const SET = {
    acDefault: AC_DEFAULT_SETTING,
    llmContext: "RegionGenie.LLM.Context",
    llmNewRegions: "RegionGenie.LLM.NewRegionsOn",
    llmEdit: "RegionGenie.LLM.EditPreset",
    wcPerField: "RegionGenie.Wildcards.PerField",
    control: "RegionGenie.Control",
    // text size per kind of field, in the node and in the pop-up editors (0 in the node = as before)
    fsNodeScene: "RegionGenie.Text.NodeScene", fsNodeRegion: "RegionGenie.Text.NodeRegion", fsNodeText: "RegionGenie.Text.NodeText",
    fsPopScene: "RegionGenie.Text.PopupScene", fsPopRegion: "RegionGenie.Text.PopupRegion", fsPopText: "RegionGenie.Text.PopupText",
    popSizes: "RegionGenie.Popup.Sizes",
    popPrevKey: "RegionGenie.Popup.PrevKey", popNextKey: "RegionGenie.Popup.NextKey",
    sizeMode: "RegionGenie.Size.Mode",
    sizeAspect: "RegionGenie.Size.Aspect",
    sizeMegapixels: "RegionGenie.Size.Megapixels",
    sizeMultiple: "RegionGenie.Size.Multiple",
    sizePresets: "RegionGenie.Size.Presets",
    cmWidth: "RegionGenie.Main.Width",
    cmHeight: "RegionGenie.Main.Height",
    cmImageMode: "RegionGenie.Main.ImageMode",
    cmMinPixels: "RegionGenie.Main.MinRegionPixels",
    cmImportMode: "RegionGenie.Main.ImportMode",
    cmFeather: "RegionGenie.Main.Feather",
    cmSeparation: "RegionGenie.Main.RegionSeparation",
    cmUntil: "RegionGenie.Main.SeparationUntil",
    cmSnap: "RegionGenie.Main.Snap",
    cmGrid: "RegionGenie.Main.Grid",
    regionColors: "RegionGenie.Main.RegionColors",
    bigKey: "RegionGenie.Main.LargeEditorKey",
    shortcuts: "RegionGenie.Shortcuts",              // the user's keys for the editor's commands (rg_keys.js), a JSON text
    cmAllRegions: "RegionGenie.Main.AllRegionsApart",
    cmAutoApart: "RegionGenie.Main.AutoApart",
    cmShareBg: "RegionGenie.Main.ShareBackground",
    toolLasso: "RegionGenie.Tools.Lasso",
    toolLassoErase: "RegionGenie.Tools.LassoErase",
    toolWand: "RegionGenie.Tools.Wand",
    toolWandTolerance: "RegionGenie.Tools.WandTolerance",
    toolFill: "RegionGenie.Tools.Fill",
    toolFillGap: "RegionGenie.Tools.FillGap",
    toolHints: "RegionGenie.Tools.Hints",
    samModel: "RegionGenie.Select.Model",
    filePickers: "RegionGenie.ModelFiles.Browse",
    checkFiles: "RegionGenie.ModelFiles.Check",
    samKeep: "RegionGenie.Select.KeepLoaded",
    samThreshold: "RegionGenie.Select.Threshold",
    llmCacheDisk: "RegionGenie.LLM.CacheOnDisk",
    llmCacheDays: "RegionGenie.LLM.CacheDays",
    llmCacheMax: "RegionGenie.LLM.CacheMaxEntries",
    editMaskGrow: "RegionGenie.Edit.MaskGrow",
    editMaskFeather: "RegionGenie.Edit.MaskFeather",
    editLora: "RegionGenie.Edit.LoRA",              // + "." + model key
    editRef: "RegionGenie.Edit.Reference",          // + "." + model key
    editRefSize: "RegionGenie.Edit.ReferenceSize",
    editMossFormat: "RegionGenie.Edit.MossFormat",
    hlAllRegions: "RegionGenie.RegionalLoRAs.SeparateAllRegions",
    hlShareBg: "RegionGenie.RegionalLoRAs.ShareBackground",
    saveFormat: "RegionGenie.Save.Format", savePngLevel: "RegionGenie.Save.PngLevel", saveWebpLossless: "RegionGenie.Save.WebpLossless",
    saveWebpQuality: "RegionGenie.Save.WebpQuality", saveJpegQuality: "RegionGenie.Save.JpegQuality", saveJpegExt: "RegionGenie.Save.JpegExtension",
    saveJpegWorkflow: "RegionGenie.Save.JpegWorkflow", saveAvifQuality: "RegionGenie.Save.AvifQuality",
    saveExrDepth: "RegionGenie.Save.ExrBitDepth", saveExrSpace: "RegionGenie.Save.ExrColorSpace",
    hlFeather: "RegionGenie.RegionalLoRAs.Feather",
    hlMasking: "RegionGenie.RegionalLoRAs.LoraMasking",
    hlSeparation: "RegionGenie.RegionalLoRAs.RegionSeparation",
    hlUntil: "RegionGenie.RegionalLoRAs.SeparationUntil",
};
// models without a layout format of their own: [family name used by the Python side, settings ID suffix]
// [the model family the run reports, Settings key, label]. MOSS-Image gets plain text in its standard mode and in Edit Mode
export const AUTO_APART_MODELS = [["MOSS-Image", "MOSS", "MOSS-Image (standard mode, Edit Mode)"], ["Krea 2", "Krea2"], ["Flux", "Flux"],
    ["Flux 3", "Flux3"], ["Anima", "Anima"], ["SDXL / SD1.5", "SDXL"]];
// the 'keep all regions apart automatically' settings, as sent to Python in paint_data
export function autoApartSettings() {
    const out = { all: getSetting(SET.cmAutoApart, true) !== false };
    for (const [fam, key] of AUTO_APART_MODELS) out[fam] = getSetting(SET.cmAutoApart + "." + key, "default") || "default";
    return out;
}
// Edit Mode: [model name as the Python side reports it (ui.model_arch), settings ID suffix, reads a reference image]
export const EDIT_MODELS = [["MOSS-Image", "MOSS", true], ["Krea 2", "Krea2", true], ["Ideogram 4", "Ideogram4", false],
    ["Flux.1", "Flux1", true], ["Flux.2", "Flux2", true], ["Flux 3", "Flux3", true], ["Anima", "Anima", false],
    ["SDXL", "SDXL", false], ["SD1.5", "SD15", false]];
export const NO_LORA = "(none)";
// the edit LoRA set for each model: [[model name, LoRA file], ...] (models without one left out)
export function editLoras() {
    const out = [];
    for (const [name, key] of EDIT_MODELS) {
        const v = getSetting(SET.editLora + "." + key, NO_LORA);
        if (typeof v === "string" && v && v !== NO_LORA) out.push([name, v]);
    }
    return out;
}
// the Edit Mode settings, as sent to Python in paint_data.edit
export function editSettings() {
    const refs = {};
    for (const [name, key, ref] of EDIT_MODELS) if (ref) refs[name] = getSetting(SET.editRef + "." + key, true) !== false;
    const size = Number(getSetting(SET.editRefSize, 1024));
    return { refs, refSize: Number.isFinite(size) && size >= 0 ? Math.round(size) : 1024, mossFormat: getSetting(SET.editMossFormat, "auto") || "auto" };
}
// Edit Mode: the edit mask's grow / feather (px) for nodes that haven't set their own (list header in Edit Mode)
export function editMaskDefaults() {
    const g = Math.round(Number(getSetting(SET.editMaskGrow, 8))), f = Math.round(Number(getSetting(SET.editMaskFeather, 16)));
    return { grow: Number.isFinite(g) ? Math.max(-256, Math.min(256, g)) : 8, feather: Number.isFinite(f) ? Math.max(0, Math.min(256, f)) : 16 };
}

// Canvas tools: which variant each tool with variants starts in (Settings > Region Genie > Canvas tools). The
// right-click choice on a tool button still switches it for the rest of the session.
export const TOOL_VARIANTS = { lasso: ["plain", "spline", "magnetic"], lassoErase: ["plain", "spline", "magnetic"],
                               wand: ["contiguous", "global"], fill: ["normal", "gaps", "linear", "radial"] };
const TOOL_SETTING = { lasso: SET.toolLasso, lassoErase: SET.toolLassoErase, wand: SET.toolWand, fill: SET.toolFill };
export function toolDefault(tool) {
    const v = getSetting(TOOL_SETTING[tool], TOOL_VARIANTS[tool][0]);
    return TOOL_VARIANTS[tool].includes(v) ? v : TOOL_VARIANTS[tool][0];
}
export const hintsListeners = new Set();        // each node's syncTips: 'Hints on the canvas' was switched in Settings
const toolListeners = new Set();
// fn(tool, variant): a tool's default variant was changed in Settings
export const onToolDefault = (fn) => { toolListeners.add(fn); return () => toolListeners.delete(fn); };
let settingsReady = false;                 // after setup(): settings are loaded, onChange means the user changed one
// numbers that go with a tool (magic wand tolerance, fill gap size), from Settings
export const TOOL_NUMBERS = { wandTol: [SET.toolWandTolerance, 32, 0, 255], fillGap: [SET.toolFillGap, 4, 1, 64] };
export function toolNumber(key) {
    const [id, d, lo, hi] = TOOL_NUMBERS[key];
    const v = Math.round(Number(getSetting(id, d)));
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
}
// tool: a key of TOOL_VARIANTS (v: its new default variant) or of TOOL_NUMBERS (v: the new number)
const toolChanged = (tool, v) => {
    if (!settingsReady || (TOOL_VARIANTS[tool] && !TOOL_VARIANTS[tool].includes(v))) return;
    for (const f of toolListeners) { try { f(tool, v); } catch (e) { console.warn(e); } }
};

// LLM cache (Settings > Region Genie > LLM cache): told to the server at start-up and whenever one changes; also
// sent with every run in paint_data
export function llmCacheSettings(over = {}) {
    const num = (id, d) => { const v = Number(over[id] ?? getSetting(id, d)); return Number.isFinite(v) ? Math.round(v) : d; };
    return { disk: (over[SET.llmCacheDisk] ?? getSetting(SET.llmCacheDisk, false)) === true,
             days: Math.max(0, num(SET.llmCacheDays, 30)), max: Math.max(10, num(SET.llmCacheMax, 500)) };
}
function postLlmCache(over) {
    if (!settingsReady) return;
    api.fetchApi("/region_genie/llm_cache_config", { method: "POST", headers: { "Content-Type": "application/json" },
                                                     body: JSON.stringify(llmCacheSettings(over)) }).catch(() => {});
}

const NEW_NODES = "Applies to nodes added from now on; nodes already in a workflow keep their own value.";
// Settings > Region Genie > Shortcuts: one row with a button, in place of a row per key. The shortcuts and their sheet
// are rg_keys.js, which imports this file: so it is loaded here only when the row is shown (never 'import' it at the top).
const SHORTCUTS_ROW_CSS = `.rg-keys-set { display:flex; align-items:center; gap:8px; }
.rg-keys-set button { background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px; cursor:pointer;
  font:inherit; padding:3px 10px; }
.rg-keys-set span { opacity:.7; font-size:12px; }`;
const shortcutsSettingType = () => () => {
    if (!document.getElementById("rg-keys-set-style")) { const st = document.createElement("style"); st.id = "rg-keys-set-style"; st.textContent = SHORTCUTS_ROW_CSS; document.head.appendChild(st); }
    const keys = () => import("./rg_keys.js");
    const box = document.createElement("div"); box.className = "rg-keys-set";
    const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "Edit…";
    btn.title = "Open the list of shortcuts: Click a key in it, then press the new one.";
    const info = document.createElement("span");
    let shown = false;                               // the row leaves the page with the Settings dialog: stop listening then
    const sync = async () => {
        if (box.isConnected) shown = true; else if (shown) { window.removeEventListener("rg-shortcuts", sync); return; }
        try { const n = (await keys()).changedCount(); info.textContent = n ? `${n} changed` : "All default"; } catch (e) { info.textContent = ""; }
    };
    btn.addEventListener("click", async (e) => { e.preventDefault(); (await keys()).openShortcuts({ keep: (t) => btn.contains(t) }); });
    window.addEventListener("rg-shortcuts", sync);
    box.append(btn, info); sync();
    return box;
};
const CAT = (section, key) => ["Region Genie", section, key];
const SETTINGS = [
        // first: the model-file settings below take their form from it when they are registered
        {
            id: SET.filePickers, name: "Browse… for model files", type: "boolean", defaultValue: false,
            tooltip: "Off (default): A model-file field opens ComfyUI's menu of the files in ComfyUI's model folders.\nOn: Each "
                + "field also gets a folder button (Browse…) that picks a file anywhere on the ComfyUI machine (saved by its full "
                + "path), in these Settings (once the dialog is opened again), on the node's Edit rows and in the LLM Settings pop-up. "
                + "Files picked with it keep working when it is off.",
            category: CAT("Model files", "1 browse"),
        },
        {
            id: SET.checkFiles, name: "Check model files", type: checkFilesType(), defaultValue: "",
            tooltip: "Looks up every model file set in these Settings (Control, Edit Mode, Select object) and in the LLM presets, "
                + "and lists the ones ComfyUI can't find (moved, renamed or deleted).",
            category: CAT("Model files", "2 check"),
        },
        {
            id: AC_DEFAULT_SETTING, name: "Tag autocomplete on in new Region Genie nodes", type: "boolean", defaultValue: true,
            tooltip: "Default for the 'autocomplete' switch on the Region Genie and Regional LoRAs nodes (nodes where you set "
                + "the switch yourself keep their own choice). The autocomplete itself comes from ComfyUI-Custom-Scripts "
                + "(preferred when enabled) or ComfyUI-Lora-Manager and follows that pack's settings.",
            category: CAT("Tag autocomplete", "1 default"),
            onChange: () => { resyncAll(); for (const f of toggles) f(); },
        },
        {
            id: SET.llmContext, name: "What the LLM Prompt Enhancer sees", type: "combo", defaultValue: "prompt",
            options: [{ text: "Only the prompt", value: "prompt" }, { text: "The prompt + the scene and the other regions", value: "context" }],
            tooltip: "Default for Region Genie nodes whose LLM Settings say 'Settings default'. With context, the LLM "
                + "also gets scene_prompt_positive and the other regions' prompts (to keep them consistent) but only "
                + "rewrites the one prompt.",
            category: CAT("LLM Prompt Enhancer", "1 context"),
        },
        {
            id: SET.llmNewRegions, name: "New regions start with the LLM Prompt Enhancer on", type: "boolean", defaultValue: false,
            category: CAT("LLM Prompt Enhancer", "2 new regions"),
        },
        // round 19: the presets (as in the node's LLM settings pop-up), one row per field
        ...[["character", "Character"], ["object", "Object"], ["text", "Text"], ["scene", "Scene"]].map(([t, label], i) => ({
            id: `RegionGenie.LLM.Default.${t}`, name: `Default preset: ${label}`, type: llmRowType("default." + t), defaultValue: "",
            tooltip: `The preset for ${label.toLowerCase()} prompts in every Region Genie node whose LLM Settings don't choose another.`,
            category: CAT("LLM Prompt Enhancer", "2a default " + i),
        })),
        {
            id: SET.llmEdit, name: "Preset to edit", type: llmRowType("edit"), defaultValue: "",
            tooltip: "The preset the rows below show and change (saved at once, for all your workflows).\n"
                + "New: A copy of this preset under a new name.\nDelete: Removes it (not while it is a default above; click twice).",
            category: CAT("LLM Prompt Enhancer", "2b edit"),
        },
        ...LLM_FIELDS.map(([key, name, tooltip], i) => ({
            id: `RegionGenie.LLM.Preset.${key}`, name, type: llmRowType("field." + key), defaultValue: "", tooltip,
            category: CAT("LLM Prompt Enhancer", "2c field " + String(i).padStart(2, "0")),
        })),
        {
            id: SET.llmCacheDisk, name: "Keep LLM results on disk between ComfyUI restarts", type: "boolean", defaultValue: false,
            tooltip: "Off (default): Enhanced prompts are kept in memory for this session, and in each workflow that used "
                + "them (a saved workflow brings its own results back when it is opened), so re-running a workflow never "
                + "needs the LLM again.\n"
                + "On: They are also saved to <ComfyUI user dir>/region_genie/llm_cache.json, which only helps workflows "
                + "queued through the API without opening them. Turning this off deletes that file.",
            category: CAT("LLM cache", "1 disk"),
            onChange: (v) => postLlmCache({ [SET.llmCacheDisk]: v }),
        },
        {
            id: SET.llmCacheDays, name: "Forget LLM results after (days; 0 = never)", type: "number", defaultValue: 30,
            attrs: { min: 0, max: 3650, step: 1 },
            tooltip: "Results older than this are dropped from the cache (memory and disk).",
            category: CAT("LLM cache", "2 days"),
            onChange: (v) => postLlmCache({ [SET.llmCacheDays]: v }),
        },
        {
            id: SET.llmCacheMax, name: "Most LLM results to keep", type: "number", defaultValue: 500,
            attrs: { min: 10, max: 100000, step: 10 },
            tooltip: "Beyond this, the oldest results are dropped first (memory and disk).",
            category: CAT("LLM cache", "3 max"),
            onChange: (v) => postLlmCache({ [SET.llmCacheMax]: v }),
        },
        {
            id: SET.toolLasso, name: "Lasso: default", type: "combo", defaultValue: "plain",
            options: [{ text: "Lasso (straight lines)", value: "plain" }, { text: "Spline lasso (smooth curve)", value: "spline" },
                      { text: "Magnetic lasso (follows edges in the image)", value: "magnetic" }],
            tooltip: "Which lasso the Lasso button starts as in every Region Genie node. Right-clicking the button still "
                + "switches it for the rest of the session.",
            category: CAT("Canvas tools", "1 lasso"),
            onChange: (v) => toolChanged("lasso", v),
        },
        {
            id: SET.toolLassoErase, name: "Lasso erase: default", type: "combo", defaultValue: "plain",
            options: [{ text: "Lasso erase (straight lines)", value: "plain" }, { text: "Spline lasso erase (smooth curve)", value: "spline" },
                      { text: "Magnetic lasso erase (follows edges in the image)", value: "magnetic" }],
            tooltip: "Which lasso erase the Eraser button's list starts with in every Region Genie node. Right-clicking the button "
                + "still switches it for the rest of the session.",
            category: CAT("Canvas tools", "2 lasso erase"),
            onChange: (v) => toolChanged("lassoErase", v),
        },
        {
            id: SET.toolWand, name: "Magic wand: default", type: "combo", defaultValue: "contiguous",
            options: [{ text: "Connected area of similar color", value: "contiguous" }, { text: "Every similar color in the image", value: "global" }],
            tooltip: "What a click with the magic wand selects in the image.\n"
                + "Connected area of similar color: Only the area around the click.\n"
                + "Every similar color in the image: All pixels of that color, connected or not.\n"
                + "Right-clicking the button still switches it for the session.",
            category: CAT("Canvas tools", "3 wand"),
            onChange: (v) => toolChanged("wand", v),
        },
        {
            id: SET.toolWandTolerance, name: "Magic wand: tolerance", type: "number", defaultValue: 32,
            attrs: { min: 0, max: 255, step: 1 },
            tooltip: "How different a color may be from the clicked one (0-255 per channel) and still be selected. The field "
                + "on the canvas (top left, while the wand is active) changes it for the session.",
            category: CAT("Canvas tools", "4 wand tolerance"),
            onChange: (v) => toolChanged("wandTol", v),
        },
        {
            id: SET.toolFill, name: "Fill: default", type: "combo", defaultValue: "normal",
            options: [{ text: "Fill", value: "normal" }, { text: "Fill, closing small gaps", value: "gaps" },
                      { text: "Gradient fill, linear", value: "linear" }, { text: "Gradient fill, radial", value: "radial" }],
            tooltip: "Fill, closing small gaps: The fill doesn't leak out through openings narrower than about twice the gap size "
                + "(the field on the canvas while Fill is active).\nRight-clicking the button still switches it for the session.",
            category: CAT("Canvas tools", "5 fill"),
            onChange: (v) => toolChanged("fill", v),
        },
        {
            id: SET.toolFillGap, name: "Fill: gap size (px)", type: "number", defaultValue: 4,
            attrs: { min: 1, max: 64, step: 1 },
            tooltip: "Fill, closing small gaps: Openings narrower than about twice this many pixels are closed.",
            category: CAT("Canvas tools", "6 fill gap"),
            onChange: (v) => toolChanged("fillGap", v),
        },
        {
            id: SET.toolHints, name: "Hints on the canvas", type: "boolean", defaultValue: true,
            tooltip: "On: The canvas shows the active tool's keys and gestures along its bottom edge, and the first steps while it is empty.\n"
                + "Off: No hints on the canvas.\nApplies to every Region Genie node right away.",
            category: CAT("Canvas tools", "7 hints"),
            onChange: () => { for (const f of hintsListeners) f(); },
        },
        {
            id: SET.samModel, name: "Model", type: fileSettingType(["checkpoints"], SAM_DEFAULT, SET.samModel, "checkpoints", false), defaultValue: SAM_DEFAULT,
            tooltip: "The SAM 3.1 checkpoint the Select object tool uses (ComfyUI's native SAM 3 support). Download "
                + "sam3.1_multiplex_fp16.safetensors from huggingface.co/Comfy-Org/sam3.1 into ComfyUI/models/checkpoints. "
                + "When this file isn't there, another SAM 3 checkpoint in that folder is used. With 'Browse… for model files' "
                + "on (Model files), a folder button picks a checkpoint anywhere on the ComfyUI machine.",
            category: CAT("Select object", "1 model"),
        },
        {
            id: SET.samKeep, name: "After a selection", type: "combo", defaultValue: "keep loaded",
            options: [{ text: "Keep the model loaded (faster next time)", value: "keep loaded" },
                { text: "Unload the model after each selection", value: "unload" }],
            tooltip: "Keep the model loaded: The model stays in memory for the session (about 1.7 GB). ComfyUI still moves it out of "
                + "VRAM into system RAM when a workflow needs the room, and back on the next click.\n"
                + "Unload the model: The model is freed when you accept or cancel a selection (and after 3 idle minutes), so each new "
                + "selection loads it from disk again.",
            category: CAT("Select object", "2 keep"),
        },
        {
            id: SET.samThreshold, name: "Find all: confidence", type: "slider", defaultValue: 0.5,
            attrs: { min: 0.05, max: 0.95, step: 0.05 },
            tooltip: "Find all (typed text): How sure SAM must be that something matches to select it. Lower finds more "
                + "(and more wrong things), higher finds fewer.",
            category: CAT("Select object", "3 threshold"),
        },
        ...[["fsNodeScene", "In the node: scene prompts", "1", 0, "the three scene_prompt boxes (0 = ComfyUI's own size); also the Regional LoRAs node's positive / negative boxes"],
            ["fsNodeRegion", "In the node: region prompts", "2", 0, "the prompt fields in the region list (0 = the usual 12 px); also the Regional LoRAs node's row prompts"],
            ["fsNodeText", "In the node: text to render", "3", 0, "the text-to-render fields in the region list (0 = the usual 12 px)"],
            ["fsPopScene", "Pop-up editor: scene prompts", "4", 14, "the text box of the scene prompts' pop-up editor (A− / A+ in its header change it too); also the Regional LoRAs node's pop-up for its positive / negative boxes"],
            ["fsPopRegion", "Pop-up editor: region prompts", "5", 14, "the Prompt box of the region pop-up editor (A− / A+ in its header change it too); also the Regional LoRAs node's pop-up for its row prompts"],
            ["fsPopText", "Pop-up editor: text to render", "6", 14, "the Text box of the region pop-up editor (A− / A+ in its header, with the Text box in use)"]]
            .map(([k, name, ord, dflt, what]) => ({ id: SET[k], name, type: "number", defaultValue: dflt, attrs: { min: k.startsWith("fsNode") ? 0 : 8, max: 40, step: 1 },
                tooltip: `Text size in px for ${what}. Applies to every node.`, category: CAT("Text size", `${ord} ${k}`) })),
        { id: SET.popSizes, name: "Pop-up editor sizes", type: "hidden", defaultValue: "{}" },
        // the keys that step to the previous / next text field in a pop-up editor: changed in the shortcut list (round 39;
        // they were two rows here), still saved under their own ids
        { id: SET.popPrevKey, name: "Pop-up editor: key for the previous text field", type: "hidden", defaultValue: "PageUp" },
        { id: SET.popNextKey, name: "Pop-up editor: key for the next text field", type: "hidden", defaultValue: "PageDown" },
        { id: SET.wcPerField, name: "A seed per field", type: "boolean", defaultValue: false,
          tooltip: "Off: Every prompt field of a node uses the node's wildcard seed as it is (like Impact Pack nodes sharing "
              + "one seed), so the same wildcard in two fields usually picks the same value.\n"
              + "On: Each field gets its own seed, derived from the wildcard seed and the field, so they pick independently "
              + "(still the same result for the same seed).",
          category: CAT("Wildcards (Impact Pack)", "1 per field") },
        { id: SET.sizeMode, name: "Image size: mode", type: "combo", defaultValue: "aspect ratio", options: ["aspect ratio", "presets", "manual"],
          tooltip: "How a new node's image size is set.\n"
              + "aspect ratio: An aspect ratio and megapixels (like ComfyUI's Resolution Selector).\n"
              + "presets: A size from the presets list.\n"
              + "manual: Width and height typed in.\n" + NEW_NODES, category: CAT("Image size", "1 mode") },
        { id: SET.sizeAspect, name: "Aspect ratio", type: "combo", defaultValue: SIZE_ASPECTS[0][0], options: SIZE_ASPECTS.map((a) => a[0]),
          tooltip: NEW_NODES, category: CAT("Image size", "2 aspect") },
        { id: SET.sizeMegapixels, name: "Megapixels", type: "number", defaultValue: 1, attrs: { min: 0.1, max: 16, step: 0.01 },
          tooltip: "Target total megapixels (1.0 MP = 1024 x 1024 for square). " + NEW_NODES, category: CAT("Image size", "3 megapixels") },
        { id: SET.sizeMultiple, name: "Multiple", type: "number", defaultValue: 8, attrs: { min: 8, max: 128, step: 4 },
          tooltip: "Width and height are rounded to a multiple of this. " + NEW_NODES, category: CAT("Image size", "4 multiple") },
        { id: SET.sizePresets, name: "Presets", type: "text", defaultValue: SIZE_PRESETS_DEFAULT,
          tooltip: "The sizes in the presets list of every Region Genie node, separated by ';', each as WIDTHxHEIGHT and an optional "
              + "name (e.g. '1216x832 landscape'). It's easier to edit from the node, with the last entry of its presets list, 'Edit list…'.",
          category: CAT("Image size", "5 presets") },
        { id: SET.cmWidth, name: "Manual: width", type: "number", defaultValue: 1024, attrs: { min: 16, max: 16384, step: 1 }, tooltip: NEW_NODES, category: CAT("Image size", "6 width") },
        { id: SET.cmHeight, name: "Manual: height", type: "number", defaultValue: 1024, attrs: { min: 16, max: 16384, step: 1 }, tooltip: NEW_NODES, category: CAT("Image size", "7 height") },
        { id: SET.cmImageMode, name: "image_mode", type: "combo", defaultValue: "backdrop (trace over)", options: ["backdrop (trace over)", "use as color map"], tooltip: NEW_NODES, category: CAT("Region Genie node", "03 image") },
        {
            id: SET.cmMinPixels, name: "Color map: min region pixels", type: "number", defaultValue: 64, attrs: { min: 1, max: 1000000, step: 1 },
            tooltip: "With the image used as a color map, a color becomes a region when it has at least this many flat pixels "
                + "(blended edges go to the nearest region, specks of other colors become unspecified). Applies to every Region Genie node at its next run; "
                + "the node's image control shows it too while the image is used as a color map.",
            category: CAT("Region Genie node", "04 min"),
        },
        {
            id: SET.cmImportMode, name: "import_json when the canvas isn't empty", type: "combo", defaultValue: "ask before replacing",
            options: ["ask before replacing", "always replace"],
            tooltip: "ask before replacing: The run keeps the canvas and the node asks (Replace canvas / Keep canvas).\n"
                + "always replace: The new layout replaces the canvas right away.\n"
                + "An empty canvas is always filled. Applies to every Region Genie node at its next run.",
            category: CAT("Region Genie node", "05 import"),
        },
        // the large editor's key: changed in the shortcut list (round 39; it was a row here), still saved under its own id
        { id: SET.bigKey, name: "Large editor: key", type: "hidden", defaultValue: "Alt+Enter" },
        { id: SET.shortcuts, name: "Shortcuts", type: shortcutsSettingType(), defaultValue: "{}",
          tooltip: "The keys of the Region Genie editor (the tools, undo, copy and paste, the view, the large editor) and the keys that step "
              + "between text fields in a pop-up editor.\nEdit…: Opens the list. Click a key in it, then press the new key or combination; "
              + "each shortcut can be put back to its default.\nThe same list opens when you press the question mark key while the pointer "
              + "is over a Region Genie node, or with the keyboard button in its bottom bar. Applies to every node.",
          category: CAT("Region Genie node", "11 shortcuts") },
        {
            id: SET.regionColors, name: "Region colors", type: regionColorsType(), defaultValue: REGION_COLORS_DEFAULT,
            tooltip: "The colors new regions get, in this order (a color already on the canvas is skipped; when all are in use, the node picks one that looks different from them).\n"
                + "Click a color: Change it.\nRight-click a color: Remove it.\n＋: Add one.\nDefaults: The built-in colors.\n"
                + "Regions already drawn keep their colors. Black can't be used: It means 'no region' in color_map.",
            category: CAT("Region Genie node", "055 colors"),
        },
        { id: SET.cmFeather, name: "Feather (px, linked regions)", type: "number", defaultValue: 0, attrs: { min: 0, max: 512, step: 1 }, tooltip: "The mask feather that linked regions share (regions start linked). " + NEW_NODES, category: CAT("Region Genie node", "06 feather") },
        { id: SET.cmSeparation, name: "LoRA region separation", type: "slider", defaultValue: 0.85, attrs: { min: 0, max: 1, step: 0.05 }, tooltip: NEW_NODES, category: CAT("Region Genie node", "07 separation") },
        { id: SET.cmUntil, name: "LoRA separation until", type: "slider", defaultValue: 0.25, attrs: { min: 0, max: 1, step: 0.05 }, tooltip: NEW_NODES, category: CAT("Region Genie node", "08 until") },
        { id: SET.cmAllRegions, name: "Keep all regions apart (not only those with LoRAs)", type: "boolean", defaultValue: false, tooltip: NEW_NODES, category: CAT("Region Genie node", "085 all regions") },
        {
            id: SET.cmShareBg, name: "Keep regions apart: share the background", type: "boolean", defaultValue: false,
            tooltip: "Regions that are kept apart stay apart from each other, but not from the image around them, so "
                + "lighting and setting stay one picture. " + NEW_NODES,
            category: CAT("Region Genie node", "0855 share background"),
        },
        {
            id: SET.cmAutoApart, name: "Plain-text prompts: keep all regions apart automatically", type: "boolean", defaultValue: true,
            tooltip: "Krea 2, Flux, Flux 3, Anima and SDXL / SD1.5 (and MOSS-Image in its standard mode and in Edit Mode) get "
                + "the regions as plain sentences. The Region Genie node places each region by tying its sentence to its "
                + "region in attention (keeping all regions apart).\n"
                + "On: With such a model on 'model', clip connected and at least one region prompt, a run keeps all regions apart, "
                + "unless the node's button is set to 'Off for this node'.\n"
                + "Off: Only a node whose button is on keeps them apart.\n"
                + "The settings below change it for one model. Applies to every Region Genie node at its next run.",
            category: CAT("Region Genie node", "086 auto apart"),
        },
        ...AUTO_APART_MODELS.map(([fam, key, label], i) => ({
            id: SET.cmAutoApart + "." + key, name: `${label || fam}: keep all regions apart automatically`, type: "combo", defaultValue: "default",
            options: [{ text: "As set for all models (above)", value: "default" }, { text: "On", value: "on" }, { text: "Off", value: "off" }],
            tooltip: `For ${fam} models only. 'As set for all models' follows the setting above.`,
            category: CAT("Region Genie node", "087 auto apart " + i),
        })),
        { id: SET.cmSnap, name: "Snap to grid on", type: "boolean", defaultValue: false, tooltip: "Whether snap to grid is on when a Region Genie node is added or a workflow is opened.", category: CAT("Region Genie node", "09 snap") },
        { id: SET.cmGrid, name: "Grid size (image px)", type: "number", defaultValue: 64, attrs: { min: 2, max: 4096, step: 1 }, tooltip: "The grid size when a Region Genie node is added or a workflow is opened.", category: CAT("Region Genie node", "10 grid") },
        ...CONTROL_FILES.map(([key, name, folder, model, tag], i) => ({
            // the file field: ComfyUI's menu on the model folders (round 23), Browse… with SET.filePickers
            id: SET.control + "." + key, name, type: fileSettingType(MODEL_ROOTS, CONTROL_NONE, SET.control + "." + key, folder), defaultValue: CONTROL_NONE,
            tooltip: controlFileHelp(key, folder, model, tag) + " The same for every Region Genie node.",
            category: CAT("Control", String(i).padStart(2, "0") + " " + key),
        })),
        ...EDIT_MODELS.map(([name, key], i) => ({
            id: SET.editLora + "." + key, name: `${name}: edit LoRA`, type: fileSettingType(MODEL_ROOTS, NO_LORA, SET.editLora + "." + key, "loras"), defaultValue: NO_LORA,
            tooltip: `The edit LoRA a Region Genie node uses in Edit Mode when its model is ${name}.\n`
                + "Edit row (on the node, under Whole image): Shows and sets this same file; its ✕ leaves it out for that node."
                + (key === "MOSS" ? "\nMOSS-Image: The Moss-Image-Edit LoRA, for example; its file decides the edit layout (see below)." : "")
                + "\nBrowse…: With 'Browse… for model files' on (Model files), a folder button picks a LoRA anywhere on the ComfyUI machine.",
            category: CAT("Edit Mode", "1 lora " + String(i).padStart(2, "0")),
        })),
        ...EDIT_MODELS.filter((m) => m[2]).map(([name, key], i) => ({
            id: SET.editRef + "." + key, name: `${name}: send the source image as a reference`, type: "boolean", defaultValue: true,
            tooltip: `On: In Edit Mode, the source image (on 'image') is also given to ${name} as a reference image `
                + "(reference_latents on positive and negative), as "
                + ({ MOSS: "edit models such as MOSS-Image Edit expect", Krea2: "the edit packs for Krea 2 expect", Flux1: "edit models such as Flux.1 Kontext expect",
                     Flux2: "edit models such as Flux.2 / Klein expect", Flux3: "edit models such as Flux 3 expect" }[key])
                + ".\nOff: Image-to-image from the latent only."
                + (key === "Flux1" ? "\nFlux.1 dev and Kontext can't be told apart; turn this off for plain Flux.1 dev." : ""),
            category: CAT("Edit Mode", "2 ref " + i),
        })),
        {
            id: SET.editRefSize, name: "Reference image size (long edge, px; 0 = output size)", type: "number", defaultValue: 1024,
            attrs: { min: 0, max: 8192, step: 16 },
            tooltip: "The reference image is scaled down to this long edge before it is encoded (never up). Larger is slower.",
            category: CAT("Edit Mode", "3 ref size"),
        },
        {
            id: SET.editMossFormat, name: "MOSS-Image edit layout", type: "combo", defaultValue: "auto",
            options: [{ text: "Auto (from the edit LoRA file)", value: "auto" }, "Moss-Image-Edit", "ai-toolkit", "ai-toolkit (kv_cache off)"],
            tooltip: "How the reference is given to MOSS-Image (as in ComfyUI's TextEncodeMOSSImageEdit node). Auto: LoRAs "
                + "trained with ai-toolkit (fused qkv weights) get 'ai-toolkit', others (e.g. the Moss-Image-Edit LoRA) get "
                + "'Moss-Image-Edit'.",
            category: CAT("Edit Mode", "4 moss format"),
        },
        {
            id: SET.editMaskGrow, name: "Edit mask: grow (px; negative shrinks)", type: "number", defaultValue: 8,
            attrs: { min: -256, max: 256, step: 1 },
            tooltip: "The edit mask (what the sampler may change in Edit Mode) grows by this many pixels past the regions, "
                + "so edits blend into their surroundings; negative values shrink it. Kept regions are never grown into. "
                + "For nodes whose list header doesn't set their own value.",
            category: CAT("Edit Mode", "5 mask grow"),
        },
        {
            id: SET.editMaskFeather, name: "Edit mask: feather (px)", type: "number", defaultValue: 16,
            attrs: { min: 0, max: 256, step: 1 },
            tooltip: "Softens the edit mask's edge by this many pixels (after growing), independent of the regions' own "
                + "feather. For nodes whose list header doesn't set their own value.",
            category: CAT("Edit Mode", "6 mask feather"),
        },
        { id: SET.hlFeather, name: "feather", type: "number", defaultValue: 0, attrs: { min: 0, max: 512, step: 1 }, tooltip: NEW_NODES, category: CAT("Regional LoRAs", "1 feather") },
        { id: SET.hlMasking, name: "lora_masking", type: "combo", defaultValue: "inside the model (one pass)", options: ["inside the model (one pass)", "separate passes (classic hooks)"], tooltip: NEW_NODES, category: CAT("Regional LoRAs", "2 masking") },
        { id: SET.hlSeparation, name: "region_separation", type: "slider", defaultValue: 0.85, attrs: { min: 0, max: 1, step: 0.05 }, tooltip: NEW_NODES, category: CAT("Regional LoRAs", "3 separation") },
        { id: SET.hlAllRegions, name: "separate_all_regions", type: "boolean", defaultValue: false, tooltip: NEW_NODES, category: CAT("Regional LoRAs", "5 all regions") },
        { id: SET.hlShareBg, name: "share_background", type: "boolean", defaultValue: false, tooltip: NEW_NODES, category: CAT("Regional LoRAs", "6 share background") },
        // Save Image (Region Genie): how a new node starts
        { id: SET.saveFormat, name: "format", type: "combo", defaultValue: "png", options: ["png", "webp", "jpeg", "avif", "exr"],
          tooltip: "png: Lossless.\nwebp: Lossless or a quality, much smaller.\njpeg: A quality, small.\navif: A quality, smallest.\n"
              + "exr: 16 / 32-bit float, scene-linear (for compositing and HDR; not smaller).\n" + NEW_NODES,
          category: CAT("Save Image", "1 format") },
        { id: SET.savePngLevel, name: "PNG compression", type: "slider", defaultValue: 9, attrs: { min: 0, max: 9, step: 1 },
          tooltip: "0-9, lossless at every level. Higher = smaller file, slower save. " + NEW_NODES, category: CAT("Save Image", "2 png") },
        { id: SET.saveWebpLossless, name: "WebP lossless", type: "boolean", defaultValue: false,
          tooltip: "The exact pixels, usually 25-35% smaller than PNG; off: WebP quality decides. " + NEW_NODES, category: CAT("Save Image", "3 webp lossless") },
        { id: SET.saveWebpQuality, name: "WebP quality", type: "slider", defaultValue: 90, attrs: { min: 1, max: 100, step: 1 },
          tooltip: "1-100. Lower = smaller file, more detail lost. " + NEW_NODES, category: CAT("Save Image", "4 webp quality") },
        { id: SET.saveJpegQuality, name: "JPEG quality", type: "slider", defaultValue: 90, attrs: { min: 1, max: 100, step: 1 },
          tooltip: "1-100. Lower = smaller file, more detail lost. " + NEW_NODES, category: CAT("Save Image", "5 jpeg quality") },
        { id: SET.saveJpegExt, name: "JPEG extension", type: "combo", defaultValue: ".jpg", options: [".jpg", ".jpeg"],
          tooltip: NEW_NODES, category: CAT("Save Image", "6 jpeg extension") },
        { id: SET.saveJpegWorkflow, name: "JPEG workflow", type: "combo", defaultValue: "sidecar .json",
          options: ["sidecar .json", "none", "inside the JPEG (EXIF)"],
          tooltip: "ComfyUI can't load a workflow from a JPEG.\nsidecar .json: The workflow in a small .json file next to each JPEG (drag that file into ComfyUI to load it).\n"
              + "none: No workflow.\ninside the JPEG (EXIF): Readable by other tools, not by ComfyUI.\n" + NEW_NODES,
          category: CAT("Save Image", "7 jpeg workflow") },
        { id: SET.saveAvifQuality, name: "AVIF quality", type: "slider", defaultValue: 80, attrs: { min: 1, max: 100, step: 1 },
          tooltip: "1-100. Lower = smaller file, more detail lost. " + NEW_NODES, category: CAT("Save Image", "8 avif quality") },
        { id: SET.saveExrDepth, name: "EXR bit depth", type: "combo", defaultValue: "16-bit float", options: ["16-bit float", "32-bit float"],
          tooltip: "16-bit float: Half precision, about half the size.\n32-bit float: Full precision.\n" + NEW_NODES, category: CAT("Save Image", "9 exr depth") },
        { id: SET.saveExrSpace, name: "EXR color space", type: "combo", defaultValue: "sRGB", options: ["sRGB", "HDR", "linear", "linear ACEScg"],
          tooltip: "The color space of the images coming in (the EXR is always scene-linear).\n"
              + "sRGB: sRGB-encoded Rec.709, the usual.\nHDR: HLG-encoded Rec.2020.\nlinear: Already scene-linear Rec.709.\n"
              + "linear ACEScg: Already scene-linear ACEScg.\n" + NEW_NODES, category: CAT("Save Image", "91 exr space") },
        { id: SET.hlUntil, name: "separation_until", type: "slider", defaultValue: 0.25, attrs: { min: 0, max: 1, step: 0.05 }, tooltip: NEW_NODES, category: CAT("Regional LoRAs", "4 until") },
];
SETTINGS.forEach((x, i) => { x.sortOrder = 1000 - i; });         // listed in this order (higher sortOrder first)
app.registerExtension({
    name: "RegionGenie.Settings",
    settings: SETTINGS,
    setup() {
        loadAutocompleteEngines(); getLoras();
        settingsReady = true;
        postLlmCache({});                     // the server learns the LLM cache settings (and deletes the file when off)
    },
});

export const AC_CSS = `
/* ComfyUI's own menus (LoRA and wildcard lists, model files, tool versions: z-index 1700) open above the pack's pop-up
   editors and the large editor, whenever one of those is up (the LLM settings pop-up has its own, higher, rule) */
body:has(.rg-pop, .rg-fpop, .rg-big):not(:has(.rg-llm-pop)) .litecontextmenu,
body:has(.rg-pop, .rg-fpop, .rg-big):not(:has(.rg-llm-pop)) .litegraph.litecontextmenu.dark { z-index:10500 !important; }
/* above the pop-up editors (.rg-pop / .rg-fpop, z-index 10000): the packs' own lists sit at or below that */
.rg-ac.comfy-autocomplete-dropdown, .rg-ac.pysssss-autocomplete { z-index:10002 !important; }
.rg-ac.comfy-autocomplete-dropdown .comfy-autocomplete-item { padding:2px 10px !important; }
.rg-ac.pysssss-autocomplete .pysssss-autocomplete-item { padding:1px 7px; line-height:1.25; }
.rg-ac.pysssss-autocomplete .pysssss-autocomplete-pill { padding-top:0; padding-bottom:0; }
.rg-ac-btn { background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd); border:1px solid var(--border-color,#555);
  border-radius:4px; padding:2px 4px; line-height:0; cursor:pointer; flex:0 0 auto; }
.rg-ac-btn svg { width:16px; height:16px; display:block; }
.rg-ac-btn:not(.on) { opacity:.55; }
.rg-ac-btn.on { background:#3a6ea5; border-color:#5b8fd0; color:#fff; }
.rg-pop .rg-ac-btn, .rg-fpop .rg-ac-btn { padding:1px 3px; }
.rg-pop .rg-ac-btn svg, .rg-fpop .rg-ac-btn svg { width:14px; height:14px; }
`;
(function injectAcCss() {
    if (document.getElementById("rg-ac-style")) return;
    const st = document.createElement("style"); st.id = "rg-ac-style"; st.textContent = AC_CSS;
    document.head.appendChild(st);
})();
// ComfyUI's own multiline widgets of a node (legacy: widget.inputEl; Nodes 2.0: the textarea whose
// <label for> names the widget, inside the node's [data-node-id] box). Widgets are rebuilt on mode or
// tab switches, so the check also runs whenever a textarea gets focus.
const widgetWatch = new Set();       // {node, names}
function widgetTextareaName(entry, t) {
    const { node, names } = entry;
    for (const n of names) if (node.widgets?.find((x) => x.name === n)?.inputEl === t) return n;
    if (!t.closest(`[data-node-id="${node.id}"]`)) return null;
    const lab = t.id ? t.closest(`[data-node-id="${node.id}"]`).querySelector(`label[for="${CSS.escape(t.id)}"]`) : null;
    const text = (lab?.textContent || t.placeholder || t.getAttribute("aria-label") || "").trim();
    for (const n of names) {
        const w = node.widgets?.find((x) => x.name === n);
        if (text && (text === n || text === w?.label)) return n;
    }
    return null;
}
// overlay scrollbars (Windows 11 / Firefox style: drawn over the content and wider on hover) would cover the
// right edge of lists and text: pad those edges then. Classic scrollbars take their own space and need nothing.
let overlaySB = null;
export function overlayScrollbars() {
    if (overlaySB != null) return overlaySB;
    const d = document.createElement("div");
    d.style.cssText = "position:absolute;left:-9999px;top:0;width:100px;height:60px;overflow:scroll;visibility:hidden;";
    d.appendChild(document.createElement("div")).style.cssText = "width:200px;height:200px;";
    document.body.appendChild(d);
    overlaySB = d.offsetWidth - d.clientWidth === 0;
    d.remove();
    document.documentElement.classList.toggle("rg-osb", overlaySB);
    if (!document.getElementById("rg-osb-style")) {
        const st = document.createElement("style"); st.id = "rg-osb-style";
        st.textContent = `
html.rg-osb .rg-list { padding-right:14px; }
html.rg-osb .rg-pop { padding-right:18px; }
html.rg-osb .rg-row textarea.rg-prompt:focus, html.rg-osb .rg-pop textarea, html.rg-osb .rg-rl-prompt:focus,
html.rg-osb textarea.rg-sbpad { padding-right:14px !important; }`;
        document.head.appendChild(st);
    }
    return overlaySB;
}

function hookTextarea(entry, t, name) {
    t.classList.add("rg-sbpad");                    // room for an overlay scrollbar (see overlayScrollbars)
    if (entry.ac) attachAutocomplete(t, entry.node);
    if (entry.onTextarea) {
        entry.seen = entry.seen || new WeakSet();
        if (!entry.seen.has(t)) { entry.seen.add(t); entry.onTextarea(name || widgetTextareaName(entry, t), t); }
    }
}
function scanWidgets(entry) {
    const { node, names } = entry;
    for (const n of names) {
        const el = node.widgets?.find((x) => x.name === n)?.inputEl;
        if (el && el.isConnected) hookTextarea(entry, el, n);
    }
    const box = document.querySelector(`[data-node-id="${node.id}"]`);
    for (const t of box?.querySelectorAll("textarea") || []) if (widgetTextareaName(entry, t)) hookTextarea(entry, t);
}
let widgetListener = false;
function watchWidgets(node, names, ac, onTextarea) {
    overlayScrollbars();
    const entry = { node, names, ac, onTextarea };
    widgetWatch.add(entry);
    scanWidgets(entry);
    setTimeout(() => scanWidgets(entry), 500);
    if (widgetListener) return;
    widgetListener = true;
    document.addEventListener("focusin", (e) => {
        const t = e.target;
        if (t?.tagName !== "TEXTAREA") return;
        for (const en of [...widgetWatch]) {
            if (!en.node.graph) { widgetWatch.delete(en); continue; }
            if (widgetTextareaName(en, t)) { hookTextarea(en, t); break; }
        }
    }, true);
    // Nodes 2.0 rebuilds widget textareas (mode switch, collapse, subgraphs): look again now and then
    setInterval(() => {
        for (const en of [...widgetWatch]) {
            if (!en.node.graph) { widgetWatch.delete(en); continue; }
            scanWidgets(en);
        }
    }, 1500);
}
// LoRA Manager's tag autocomplete (and overlay-scrollbar room) for some of a node's ComfyUI text widgets
// onTextarea(name, textarea): called once for each textarea found (also the ones Nodes 2.0 makes again)
export const autocompleteWidgets = (node, names, onTextarea) => watchWidgets(node, names, true, onTextarea);
// only the overlay-scrollbar room (read-only info boxes)
export const padWidgets = (node, names) => watchWidgets(node, names, false);

// ---------------------------------------------------------------- number fields that fit their value
// Every number field of this pack (inside an element with an "rg-" class) is as wide as its value plus the spin
// arrows: 2 digits at least, wider as more are typed, so the arrows never cover a digit. Applied to fields as they
// are added to the page (a MutationObserver), and again whenever the value changes (typed, spun or set by code).
const NUM_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
const NUM_SPIN_PX = 22;                         // the spin arrows (about 15 px in Chrome, 16 in Firefox) and a little room
const numChars = (s) => {
    let n = 0;
    for (const c of String(s)) n += c === "." || c === "," ? 0.45 : c === "-" ? 0.7 : 1;
    return n;
};
export function fitNumber(inp, minChars = 2) {
    if (!inp || inp.type !== "number") return inp;
    const text = NUM_VALUE.get.call(inp) || inp.placeholder || "";
    const ch = Math.ceil(Math.max(minChars, numChars(text)) * 10) / 10;
    const w = `calc(${ch}ch + ${NUM_SPIN_PX}px)`;
    if (inp.style.width !== w) inp.style.width = w;
    return inp;
}
export function autoNumber(inp) {
    if (!inp || inp.__rgFit || inp.tagName !== "INPUT" || inp.type !== "number") return inp;
    inp.__rgFit = true;
    inp.style.flexShrink = "0"; inp.style.minWidth = "0"; inp.style.maxWidth = "none"; inp.style.boxSizing = "content-box";
    Object.defineProperty(inp, "value", {
        configurable: true,
        get() { return NUM_VALUE.get.call(this); },
        set(v) { NUM_VALUE.set.call(this, v); fitNumber(this); },
    });
    for (const ev of ["input", "change", "blur"]) inp.addEventListener(ev, () => fitNumber(inp));
    new MutationObserver(() => fitNumber(inp)).observe(inp, { attributes: true, attributeFilter: ["placeholder", "type"] });
    fitNumber(inp);
    return inp;
}
const ownNumber = (n) => n.type === "number" && !!n.closest?.('[class^="rg-"], [class*=" rg-"]');
function scanNumbers(root) {
    if (root.nodeType !== 1) return;
    if (root.tagName === "INPUT") { if (ownNumber(root)) autoNumber(root); return; }
    const list = root.getElementsByTagName?.("input");
    if (list?.length) for (const i of [...list]) if (!i.__rgFit && ownNumber(i)) autoNumber(i);
}
function watchNumbers() {
    if (!document.body) { document.addEventListener("DOMContentLoaded", watchNumbers, { once: true }); return; }
    scanNumbers(document.body);
    new MutationObserver((recs) => { for (const r of recs) for (const n of r.addedNodes) scanNumbers(n); })
        .observe(document.body, { childList: true, subtree: true });
}
if (typeof document !== "undefined" && !window.__rgNumbers) { window.__rgNumbers = true; watchNumbers(); }
