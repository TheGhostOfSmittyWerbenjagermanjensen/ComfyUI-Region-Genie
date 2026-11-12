// Region Genie: helpers shared by the editors (LoRA list and picker, trigger words, icons,
// tag autocomplete from ComfyUI-Lora-Manager). Not an extension by itself.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// ---------------------------------------------------------------- icons (16x16, stroke = text color)
export const ICONS = {
    select: '<path d="M3.5 2l8.5 6-3.6.9 2 3.9-1.6.8-2-3.9L4.2 12.3z" fill="currentColor" stroke="none"/>',
    shape: '<rect x="2" y="2" width="7.5" height="7.5"/><circle cx="11" cy="11" r="3.4"/>',
    brush: '<path d="M14 2L8.3 8.4"/><path d="M8.6 8.1c-1.9-.6-3.7.3-3.9 2.3-.1 1.3-.9 2.1-2.2 2.3 1.6 1.4 5.6 1.2 6.4-1.2.4-1.2.2-2.3-.3-3.4z"/>',
    lasso: '<ellipse cx="8.8" cy="6" rx="5.4" ry="3.6"/><path d="M5.2 8.7c-1.5.8-1.3 2.5.1 2.9 1.3.4 1.7 1.7.8 2.9"/>',
    fill: '<path d="M2.6 7.6L7.4 2.8l5 5-4.8 4.8a1.3 1.3 0 0 1-1.8 0L2.6 9.4a1.3 1.3 0 0 1 0-1.8z"/><path d="M2.8 8h9.4"/><path d="M13.6 10.2c.7 1 1.1 1.7 1.1 2.3a1.1 1.1 0 0 1-2.2 0c0-.6.4-1.3 1.1-2.3z" fill="currentColor"/>',
    erase: '<path d="M6.2 13.5L2.8 10.1a1.3 1.3 0 0 1 0-1.8l5.6-5.6a1.3 1.3 0 0 1 1.8 0l3.4 3.4a1.3 1.3 0 0 1 0 1.8l-5.6 5.6z"/><path d="M5.4 5.6l5 5"/><path d="M6.2 13.5h7.6"/>',
    lassoSpline: '<path d="M2.6 7.6C2.2 4.2 6.4 2.2 10.2 2.6c3.4.4 4.6 3 2.6 4.6-1.8 1.4-5.4 1.8-8.2 1"/><path d="M4.4 8.4c-1.4.9-1 2.4.3 2.8 1.3.4 1.6 1.7.7 2.8"/><rect x="1.3" y="6.3" width="2.6" height="2.6" fill="currentColor" stroke="none"/><rect x="8.9" y="1.3" width="2.6" height="2.6" fill="currentColor" stroke="none"/><rect x="12.4" y="4.9" width="2.6" height="2.6" fill="currentColor" stroke="none"/>',
    lassoEraseSpline: '<ellipse cx="7.6" cy="6.4" rx="5.4" ry="3.7" stroke-dasharray="2.2 1.6"/><rect x="0.9" y="5.1" width="2.6" height="2.6" fill="currentColor" stroke="none"/><rect x="6.3" y="1.4" width="2.6" height="2.6" fill="currentColor" stroke="none"/><rect x="11.7" y="5.1" width="2.6" height="2.6" fill="currentColor" stroke="none"/><path d="M10.6 10.6l3.6 3.6M14.2 10.6l-3.6 3.6"/>',
    magnet: '<path d="M3 2.5h3v5.4a2 2 0 0 0 4 0V2.5h3v5.4a5 5 0 0 1-10 0z"/><path d="M3 5h3M10 5h3"/>',
    magnetOff: '<path d="M3 2.5h3v5.4a2 2 0 0 0 4 0V2.5h3v5.4a5 5 0 0 1-10 0z"/><path d="M3 5h3M10 5h3"/><path d="M1.8 14.2L14.2 1.8"/>',
    lassoErase: '<ellipse cx="7.6" cy="6.4" rx="5.4" ry="3.7" stroke-dasharray="2.2 1.6"/><path d="M10.6 10.6l3.6 3.6M14.2 10.6l-3.6 3.6"/>',
    undo: '<path d="M5.6 3.6L2.6 6.6l3 3"/><path d="M2.9 6.6h7.3a3.4 3.4 0 0 1 0 6.8H7.2"/>',
    redo: '<path d="M10.4 3.6l3 3-3 3"/><path d="M13.1 6.6H5.8a3.4 3.4 0 0 0 0 6.8h3"/>',
    clear: '<path d="M2.8 4.4h10.4"/><path d="M6.3 4.4V2.8h3.4v1.6"/><path d="M4.3 4.4l.7 9.2h6l.7-9.2"/><path d="M6.8 6.8v4.6M9.2 6.8v4.6"/>',
    eye: '<path d="M1.4 8S3.8 3.6 8 3.6 14.6 8 14.6 8 12.2 12.4 8 12.4 1.4 8 1.4 8z"/><circle cx="8" cy="8" r="2.1"/>',
    eyeOff: '<path d="M1.4 7.4S3.8 10.8 8 10.8s6.6-3.4 6.6-3.4"/><path d="M3.4 9.6l-1.3 1.7M8 10.8v2.2M12.6 9.6l1.3 1.7"/>',
    link: '<path d="M6.4 9.6l3.2-3.2"/><path d="M7.4 4.6l1.4-1.4a2.6 2.6 0 0 1 3.7 3.7L11.1 8.3"/><path d="M8.6 11.4l-1.4 1.4a2.6 2.6 0 0 1-3.7-3.7l1.4-1.4"/>',
    unlink: '<path d="M7.4 4.6l1.4-1.4a2.6 2.6 0 0 1 3.7 3.7L11.1 8.3"/><path d="M8.6 11.4l-1.4 1.4a2.6 2.6 0 0 1-3.7-3.7l1.4-1.4"/><path d="M5.4 2v1.8M2 5.4h1.8M10.6 14v-1.8M14 10.6h-1.8"/>',
    edges: '<rect x="2.5" y="2.5" width="11" height="11" stroke-dasharray="2 1.6"/><rect x="5.5" y="5.5" width="5" height="5" fill="currentColor" stroke="none" opacity=".55"/>',
    feather: '<path d="M13.6 2.4C9.2 2.6 5 5.8 4.2 10.6L3.6 13"/><path d="M13.6 2.4c.4 4.6-2.6 8.8-7.9 9.6"/><path d="M4.3 10.2l4.6-4.6"/><path d="M6.4 11.6l3.3.1"/><path d="M8.4 5.2l3.4.2"/>',
    regionAdd: '<rect x="1.5" y="3" width="9" height="9" rx="1.5"/><path d="M13 1.8v4.4M10.8 4h4.4"/>',
    layerAdd: '<path d="M6.5 3.5L1.5 6l5 2.5 5-2.5z"/><path d="M1.5 9l5 2.5 5-2.5"/><path d="M13 9.5v4.4M10.8 11.7h4.4"/>',
    layers: '<path d="M8 2.5L2 5.5l6 3 6-3z"/><path d="M2 8.5l6 3 6-3"/><path d="M2 11.2l6 3 6-3"/>',
    allApart: '<rect x="1.5" y="1.5" width="5.2" height="5.2" rx="1"/><rect x="9.3" y="1.5" width="5.2" height="5.2" rx="1"/><rect x="1.5" y="9.3" width="5.2" height="5.2" rx="1"/><rect x="9.3" y="9.3" width="5.2" height="5.2" rx="1"/>',
    // the four tiles on a shaded backdrop: kept apart from each other, the background shared
    allApartShared: '<rect x="0.6" y="0.6" width="14.8" height="14.8" rx="2" fill="currentColor" stroke="none" opacity=".32"/><rect x="2.4" y="2.4" width="4.4" height="4.4" rx=".9"/><rect x="9.2" y="2.4" width="4.4" height="4.4" rx=".9"/><rect x="2.4" y="9.2" width="4.4" height="4.4" rx=".9"/><rect x="9.2" y="9.2" width="4.4" height="4.4" rx=".9"/>',
    // Edit Mode: a region that changes (pencil) / is kept as it is in the source (lock)
    pencil: '<path d="M11.3 2.3l2.4 2.4-8 8-3.1.7.7-3.1z"/><path d="M9.8 3.8l2.4 2.4"/>',
    lock: '<rect x="3.4" y="7.2" width="9.2" height="6.8" rx="1.2"/><path d="M5.4 7.2V5.2a2.6 2.6 0 0 1 5.2 0v2"/>',
    // tag autocomplete on / off (lit / slashed, like the magnet and eye buttons)
    tag: '<path d="M2.4 2.4h5.4l5.9 5.9-5.4 5.4-5.9-5.9z"/><circle cx="5.4" cy="5.4" r="1.1"/>',
    tagOff: '<path d="M2.4 2.4h5.4l5.9 5.9-5.4 5.4-5.9-5.9z"/><circle cx="5.4" cy="5.4" r="1.1"/><path d="M1.6 14.4L14.4 1.6"/>',
    // image input: traced over (backdrop) / read as the color map
    imgBackdrop: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4"/><path d="M1.8 11l3.6-3.6 3 3 2-2 3.8 3.8"/><circle cx="10.6" cy="5.9" r="1.1"/>',
    imgColorMap: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4"/><path d="M8 2.8v10.4M1.8 8h6.2"/><rect x="2.6" y="3.6" width="4.6" height="3.6" fill="currentColor" stroke="none" opacity=".55"/><rect x="8.8" y="8.8" width="4.6" height="3.6" fill="currentColor" stroke="none" opacity=".55"/>',
    // image size row: aspect ratio + megapixels (Resolution Selector) / presets list / manual width and height
    sizeRatio: '<rect x="1.8" y="3.8" width="12.4" height="8.4" rx="1.2"/><path d="M4.4 9.6l7.2-3.2" stroke-dasharray="1.6 1.3"/>',
    sizeList: '<rect x="1.8" y="2.4" width="12.4" height="11.2" rx="1.2"/><path d="M4.4 5.6h7.2M4.4 8h7.2M4.4 10.4h4.6"/>',
    sizeManual: '<rect x="1.8" y="3.8" width="12.4" height="8.4" rx="1.2"/><path d="M4.4 8h2.6M9 8h2.6M5.3 6.6L4.2 8l1.1 1.4M10.7 6.6L11.8 8l-1.1 1.4"/>',
    swapWH: '<path d="M4.6 2.4v10.8M2.6 11.2l2 2 2-2"/><path d="M11.4 13.6V2.8M9.4 4.8l2-2 2 2"/>',
    // wildcards (Impact Pack): the picker / seed label, seed modes (fixed = lock), use the filled text
    wildcard: '<path d="M5.4 2.6c-1.4 0-2 .7-2 2v1.6c0 .9-.5 1.5-1.4 1.8.9.3 1.4.9 1.4 1.8v1.6c0 1.3.6 2 2 2"/><path d="M10.6 2.6c1.4 0 2 .7 2 2v1.6c0 .9.5 1.5 1.4 1.8-.9.3-1.4.9-1.4 1.8v1.6c0 1.3-.6 2-2 2"/><path d="M8 5.4v5.2M5.8 6.7l4.4 2.6M10.2 6.7L5.8 9.3" stroke-width="1.2"/>',
    dice: '<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.2"/><circle cx="5.4" cy="5.4" r="1" fill="currentColor" stroke="none"/><circle cx="10.6" cy="5.4" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="5.4" cy="10.6" r="1" fill="currentColor" stroke="none"/><circle cx="10.6" cy="10.6" r="1" fill="currentColor" stroke="none"/>',
    plusOne: '<path d="M2.4 8h4.4M4.6 5.8v4.4"/><path d="M9.6 5.2l2-1.6v8.8"/>',
    useFilled: '<path d="M8 1.8v7.6M4.8 6.4L8 9.6l3.2-3.2"/><path d="M2.4 12.8h11.2"/>',
    // Control (ControlNet): contour lines of a depth map
    control: '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.6"/><path d="M1.8 11.2c2.4-2.6 4.6-3.4 6.8-2.4s3.8.6 5.6-1.4"/><path d="M1.8 7.4c2-2 4-2.6 6-1.8s3.6.4 6.4-2" stroke-dasharray="1.6 1.4"/>',
    controlOff: '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.6" stroke-dasharray="2 1.6"/><path d="M1.8 11.2c2.4-2.6 4.6-3.4 6.8-2.4s3.8.6 5.6-1.4" opacity=".5"/><path d="M2.4 13.6L13.6 2.4"/>',
    // open a text field in the pop-up editor
    expand: '<path d="M9.4 2.4h4.2v4.2M13.6 2.4L9.2 6.8M6.6 13.6H2.4V9.4M2.4 13.6l4.4-4.4"/>',
    // Select object: add the pending selection / discard it
    check: '<path d="M2.8 8.6l3.4 3.4 7-7.6"/>',
    close: '<path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8"/>',
    // Select object (SAM): a frame, a figure and a pointer
    samSelect: '<path d="M2 5V3a1 1 0 0 1 1-1h2M11 2h2a1 1 0 0 1 1 1v2M14 11v2a1 1 0 0 1-1 1h-2M5 14H3a1 1 0 0 1-1-1v-2"/><circle cx="6.6" cy="5.8" r="1.6"/><path d="M3.8 11c.3-1.7 1.4-2.8 2.8-2.8"/><path d="M8.8 8.2l4.6 1.8-2 .8-.8 2z" fill="currentColor" stroke-width="1"/>',
    // magic wand (contiguous) and its 'all similar colors' variant
    wand: '<path d="M2.4 13.6l7.4-7.4"/><path d="M9.2 4.6l2.2 2.2"/><path d="M11.8 1.6v2M14.4 4.2h-2M13.6 2.4l-1.2 1.2M9.6 2.4l.9.9M13.6 6.4l-.9-.9"/>',
    wandGlobal: '<path d="M2.4 13.6l7.4-7.4"/><path d="M9.2 4.6l2.2 2.2"/><path d="M11.8 1.6v2M14.4 4.2h-2M13.6 2.4l-1.2 1.2M9.6 2.4l.9.9M13.6 6.4l-.9-.9"/><circle cx="3.2" cy="4" r="1.3" fill="currentColor" stroke="none"/><circle cx="12.6" cy="12.4" r="1.3" fill="currentColor" stroke="none"/>',
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
    palette: '<path d="M8 1.8C4.4 1.8 1.8 4.4 1.8 7.7c0 3.4 2.7 6.3 6 6.3 1 0 1.6-.6 1.6-1.4 0-.8-.6-1.1-.6-1.8 0-.8.6-1.4 1.5-1.4h1.6c1.6 0 2.4-1.2 2.4-2.6 0-2.8-2.9-5-6.3-5z"/><circle cx="5" cy="7" r=".9" fill="currentColor"/><circle cx="7.4" cy="4.6" r=".9" fill="currentColor"/><circle cx="10.5" cy="5.1" r=".9" fill="currentColor"/><circle cx="4.9" cy="10.1" r=".9" fill="currentColor"/>',
};
export const svgIcon = (name) =>
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

// ---------------------------------------------------------------- saved node properties
// Property keys renamed with Region Genie (workflows saved before still have the old ones). An old key always
// wins over the new one: a node gets its defaults before the workflow's properties are copied in.
const RENAMED_PROPS = { rg_llm: "rmk_llm", rg_autocomplete: "rmk_autocomplete", rg_widget_values: "rmk_widget_values",
                        rg_labels: "cml_labels" };
export function migrateProps(props) {
    if (!props || typeof props !== "object") return props;
    for (const [key, old] of Object.entries(RENAMED_PROPS)) {
        if (!(old in props)) continue;
        props[key] = props[old];
        delete props[old];
    }
    return props;
}

// ---------------------------------------------------------------- widget values
// Widget values are saved by position, and some frontend versions line positions up differently on load
// (they count connection-only inputs), which shifts values into the wrong widgets. Keep a copy by name
// in the node's properties and put each value back where it belongs after loading.
export function keepWidgetValuesByName(node, names) {
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
        if (!vals || typeof vals !== "object") return;
        for (const [n, v] of Object.entries(vals)) {
            const w = node.widgets?.find((w) => w.name === n);
            if (!w || v === undefined || w.value === v) continue;
            const opts = w.options?.values;
            if (Array.isArray(opts) && !opts.includes(v)) continue;
            w.value = v;
        }
        node.setDirtyCanvas?.(true, true);
    };
    const onConfigure = node.onConfigure;
    node.onConfigure = function (info) {
        migrateProps(info?.properties);
        migrateProps(this.properties);
        const r = onConfigure?.apply(this, arguments);
        const vals = info?.properties?.rg_widget_values;
        restore(vals);
        setTimeout(() => restore(vals), 0);
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

// ---------------------------------------------------------------- Control (ControlNet / control LoRAs)
// [Settings key, label, model folder, model (as ui.model_arch says), LoRA tag kind or null]. One file per model and kind;
// the LoRA ones are added to 'Whole image' when control is on.
export const CONTROL_FILES = [
    ["MOSS", "MOSS Image: color / depth control LoRA", "loras", "MOSS Image", "moss"],
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
const WC_MODES = { fixed: ["lock", "fixed: the seed stays as it is"], randomize: ["dice", "randomize: a new random seed after each run"],
                   increment: ["plusOne", "increment: the seed goes up by 1 after each run"] };
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
    const prevBtn = btn("eye", "Preview: fill the wildcards with this seed now (without running); hover a field to see "
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
        const show = wildcardsInstalled() && !!seedW ? "" : "none";
        if (box.style.display !== show) box.style.display = show;
        if (document.activeElement !== inp && seedW) inp.value = String(seedW.value ?? 0);
        const [icon, t] = WC_MODES[mode()];
        if (modeBtn.dataset.mode !== mode()) { modeBtn.innerHTML = svgIcon(icon); modeBtn.dataset.mode = mode(); }
        modeBtn.title = `After each run (when a field has wildcards): ${t}. Click to change.`;
        const u = used();
        lbl.title = inp.title = "Wildcard seed (ComfyUI Impact Pack): fills __name__ and {a|b} in this node's prompt fields"
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
.rg-wc-seed { width:122px !important; }
.rg-wc .rg-btn, .rg-wc .rg-num { background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd); border:1px solid var(--border-color,#555);
  border-radius:4px; font:12px sans-serif; }
.rg-wc .rg-btn { cursor:pointer; padding:2px 4px; line-height:0; }
.rg-wc .rg-btn svg { width:16px; height:16px; display:block; }
.rg-wc .rg-num { padding:1px 3px; }
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
    const v = migrateProps(node?.properties)?.[AC_PROPERTY];
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
function sweepAutocomplete() {
    for (const [el, st] of attached) {
        if (el.isConnected) continue;
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
            if (!st.pys) { st.pys = new engines.pysssss(el); st.pys.dropdown?.classList.add("rg-ac"); }
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
    const st = { node, engine: null, inst: null, pys: null };
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
export function autocompleteToggle(node, mk) {
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
        b.innerHTML = svgIcon(on ? "tag" : "tagOff");
        b.classList.toggle("on", on);
        b.title = title;
        b.setAttribute("aria-pressed", String(on));
    };
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => { e.preventDefault(); setAutocompleteFor(node, !autocompleteEnabledFor(node)); refresh(); });
    loadAutocompleteEngines().then(refresh);
    toggles.add(refresh);
    refresh();
    return { el: b, refresh };
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
    wcPerField: "RegionGenie.Wildcards.PerField",
    control: "RegionGenie.Control",
    // text size per kind of field, in the node and in the pop-up editors (0 in the node = as before)
    fsNodeScene: "RegionGenie.Text.NodeScene", fsNodeRegion: "RegionGenie.Text.NodeRegion", fsNodeText: "RegionGenie.Text.NodeText",
    fsPopScene: "RegionGenie.Text.PopupScene", fsPopRegion: "RegionGenie.Text.PopupRegion", fsPopText: "RegionGenie.Text.PopupText",
    popSizes: "RegionGenie.Popup.Sizes",
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
    cmAllRegions: "RegionGenie.Main.AllRegionsApart",
    cmKrea2Apart: "RegionGenie.Main.Krea2AllRegionsApart",     // before 'keep all regions apart automatically' per model
    cmAutoApart: "RegionGenie.Main.AutoApart",
    cmShareBg: "RegionGenie.Main.ShareBackground",
    toolLasso: "RegionGenie.Tools.Lasso",
    toolLassoErase: "RegionGenie.Tools.LassoErase",
    toolWand: "RegionGenie.Tools.Wand",
    toolWandTolerance: "RegionGenie.Tools.WandTolerance",
    toolFill: "RegionGenie.Tools.Fill",
    toolFillGap: "RegionGenie.Tools.FillGap",
    samModel: "RegionGenie.Select.Model",
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
    hlFeather: "RegionGenie.RegionalLoRAs.Feather",
    hlMasking: "RegionGenie.RegionalLoRAs.LoraMasking",
    hlSeparation: "RegionGenie.RegionalLoRAs.RegionSeparation",
    hlUntil: "RegionGenie.RegionalLoRAs.SeparationUntil",
};
// models without a layout format of their own: [family name used by the Python side, settings ID suffix]
export const AUTO_APART_MODELS = [["Krea 2", "Krea2"], ["Flux", "Flux"], ["Flux 3", "Flux3"], ["Anima", "Anima"], ["SDXL / SD1.5", "SDXL"]];
// the 'keep all regions apart automatically' settings, as sent to Python in paint_data
export function autoApartSettings() {
    const out = { all: getSetting(SET.cmAutoApart, true) !== false };
    for (const [fam, key] of AUTO_APART_MODELS) out[fam] = getSetting(SET.cmAutoApart + "." + key, "default") || "default";
    return out;
}
// Edit Mode: [model name as the Python side reports it (ui.model_arch), settings ID suffix, reads a reference image]
export const EDIT_MODELS = [["MOSS Image", "MOSS", true], ["Krea 2", "Krea2", true], ["Ideogram 4", "Ideogram4", false],
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
                               wand: ["contiguous", "global"], fill: ["normal", "gaps"] };
const TOOL_SETTING = { lasso: SET.toolLasso, lassoErase: SET.toolLassoErase, wand: SET.toolWand, fill: SET.toolFill };
export function toolDefault(tool) {
    const v = getSetting(TOOL_SETTING[tool], TOOL_VARIANTS[tool][0]);
    return TOOL_VARIANTS[tool].includes(v) ? v : TOOL_VARIANTS[tool][0];
}
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
const CAT = (section, key) => ["Region Genie", section, key];
const SETTINGS = [
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
        {
            id: SET.llmCacheDisk, name: "Keep LLM results on disk between ComfyUI restarts", type: "boolean", defaultValue: false,
            tooltip: "Off (default): enhanced prompts are kept in memory for this session, and in each workflow that used "
                + "them (a saved workflow brings its own results back when it is opened), so re-running a workflow never "
                + "needs the LLM again. On: they are also saved to <ComfyUI user dir>/region_genie/llm_cache.json, which "
                + "only helps workflows queued through the API without opening them. Turning this off deletes that file.",
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
            tooltip: "Which lasso the Lasso erase button starts as in every Region Genie node. Right-clicking the button "
                + "still switches it for the rest of the session.",
            category: CAT("Canvas tools", "2 lasso erase"),
            onChange: (v) => toolChanged("lassoErase", v),
        },
        {
            id: SET.toolWand, name: "Magic wand: default", type: "combo", defaultValue: "contiguous",
            options: [{ text: "Connected area of similar color", value: "contiguous" }, { text: "Every similar color in the image", value: "global" }],
            tooltip: "What a click with the magic wand selects in the image: the connected area of similar color around "
                + "the click, or every pixel of similar color. Right-clicking the button still switches it for the session.",
            category: CAT("Canvas tools", "3 wand"),
            onChange: (v) => toolChanged("wand", v),
        },
        {
            id: SET.toolWandTolerance, name: "Magic wand: tolerance", type: "number", defaultValue: 32,
            attrs: { min: 0, max: 255, step: 1 },
            tooltip: "How different a color may be from the clicked one (0-255 per channel) and still be selected. The field "
                + "next to the wand changes it for the session.",
            category: CAT("Canvas tools", "4 wand tolerance"),
            onChange: (v) => toolChanged("wandTol", v),
        },
        {
            id: SET.toolFill, name: "Fill: default", type: "combo", defaultValue: "normal",
            options: [{ text: "Fill", value: "normal" }, { text: "Fill, closing small gaps", value: "gaps" }],
            tooltip: "Closing small gaps: the fill doesn't leak out through openings narrower than about twice the gap size "
                + "(set next to the Fill button). Right-clicking the button still switches it for the session.",
            category: CAT("Canvas tools", "5 fill"),
            onChange: (v) => toolChanged("fill", v),
        },
        {
            id: SET.toolFillGap, name: "Fill: gap size (px)", type: "number", defaultValue: 4,
            attrs: { min: 1, max: 64, step: 1 },
            tooltip: "Fill, closing small gaps: openings narrower than about twice this many pixels are closed.",
            category: CAT("Canvas tools", "6 fill gap"),
            onChange: (v) => toolChanged("fillGap", v),
        },
        {
            id: SET.samModel, name: "Model (in models/checkpoints)", type: "text", defaultValue: "sam3.1_multiplex_fp16.safetensors",
            tooltip: "The SAM 3.1 checkpoint the Select object tool uses (ComfyUI's native SAM 3 support). Download "
                + "sam3.1_multiplex_fp16.safetensors from huggingface.co/Comfy-Org/sam3.1 into ComfyUI/models/checkpoints. "
                + "When this file isn't there, another SAM 3 checkpoint in that folder is used.",
            category: CAT("Select object", "1 model"),
        },
        {
            id: SET.samKeep, name: "After a selection", type: "combo", defaultValue: "keep loaded",
            options: [{ text: "Keep the model loaded (faster next time)", value: "keep loaded" },
                { text: "Unload the model after each selection", value: "unload" }],
            tooltip: "Keep loaded: the model stays in memory for the session (about 1.7 GB). ComfyUI still moves it out of "
                + "VRAM into system RAM when a workflow needs the room, and back on the next click. Unload: the model is "
                + "freed when you accept or cancel a selection (and after 3 idle minutes), so each new selection loads it "
                + "from disk again.",
            category: CAT("Select object", "2 keep"),
        },
        {
            id: SET.samThreshold, name: "Find all: confidence", type: "slider", defaultValue: 0.5,
            attrs: { min: 0.05, max: 0.95, step: 0.05 },
            tooltip: "Find all (typed text): how sure SAM must be that something matches to select it. Lower finds more "
                + "(and more wrong things), higher finds fewer.",
            category: CAT("Select object", "3 threshold"),
        },
        ...[["fsNodeScene", "In the node: scene prompts", "1", 0, "the three scene_prompt boxes (0 = ComfyUI's own size)"],
            ["fsNodeRegion", "In the node: region prompts", "2", 0, "the prompt fields in the region list (0 = the usual 12 px)"],
            ["fsNodeText", "In the node: text to render", "3", 0, "the text-to-render fields in the region list (0 = the usual 12 px)"],
            ["fsPopScene", "Pop-up editor: scene prompts", "4", 14, "the text box of the scene prompts' pop-up editor (A− / A+ in its header change it too)"],
            ["fsPopRegion", "Pop-up editor: region prompts", "5", 14, "the Prompt box of the region pop-up editor (A− / A+ in its header change it too)"],
            ["fsPopText", "Pop-up editor: text to render", "6", 14, "the Text box of the region pop-up editor (A− / A+ in its header, with the Text box in use)"]]
            .map(([k, name, ord, dflt, what]) => ({ id: SET[k], name, type: "number", defaultValue: dflt, attrs: { min: k.startsWith("fsNode") ? 0 : 8, max: 40, step: 1 },
                tooltip: `Text size in px for ${what}. Applies to every Region Genie node.`, category: CAT("Text size", `${ord} ${k}`) })),
        { id: SET.popSizes, name: "Pop-up editor sizes", type: "hidden", defaultValue: "{}" },
        { id: SET.wcPerField, name: "A seed per field", type: "boolean", defaultValue: false,
          tooltip: "Off: every prompt field of a node uses the node's wildcard seed as it is (like Impact Pack nodes sharing "
              + "one seed), so the same wildcard in two fields usually picks the same value. On: each field gets its own seed, "
              + "derived from the wildcard seed and the field, so they pick independently (still the same result for the same seed).",
          category: CAT("Wildcards (Impact Pack)", "1 per field") },
        { id: SET.sizeMode, name: "Image size: mode", type: "combo", defaultValue: "aspect ratio", options: ["aspect ratio", "presets", "manual"],
          tooltip: "How a new node's image size is set: aspect ratio + megapixels (like ComfyUI's Resolution Selector), a size from "
              + "the presets list, or width and height typed in. " + NEW_NODES, category: CAT("Image size", "1 mode") },
        { id: SET.sizeAspect, name: "Aspect ratio", type: "combo", defaultValue: SIZE_ASPECTS[0][0], options: SIZE_ASPECTS.map((a) => a[0]),
          tooltip: NEW_NODES, category: CAT("Image size", "2 aspect") },
        { id: SET.sizeMegapixels, name: "Megapixels", type: "number", defaultValue: 1, attrs: { min: 0.1, max: 16, step: 0.01 },
          tooltip: "Target total megapixels (1.0 MP = 1024 x 1024 for square). " + NEW_NODES, category: CAT("Image size", "3 megapixels") },
        { id: SET.sizeMultiple, name: "Multiple", type: "number", defaultValue: 8, attrs: { min: 8, max: 128, step: 4 },
          tooltip: "Width and height are rounded to a multiple of this. " + NEW_NODES, category: CAT("Image size", "4 multiple") },
        { id: SET.sizePresets, name: "Presets", type: "text", defaultValue: SIZE_PRESETS_DEFAULT,
          tooltip: "The sizes in the presets list of every Region Genie node, separated by ';', each as WIDTHxHEIGHT and an optional "
              + "name (e.g. '1216x832 landscape'). Easier to edit from the node: the last entry of its presets list, 'Edit list…'.",
          category: CAT("Image size", "5 presets") },
        { id: SET.cmWidth, name: "Manual: width", type: "number", defaultValue: 1024, attrs: { min: 16, max: 16384, step: 1 }, tooltip: NEW_NODES, category: CAT("Image size", "6 width") },
        { id: SET.cmHeight, name: "Manual: height", type: "number", defaultValue: 1024, attrs: { min: 16, max: 16384, step: 1 }, tooltip: NEW_NODES, category: CAT("Image size", "7 height") },
        { id: SET.cmImageMode, name: "image_mode", type: "combo", defaultValue: "backdrop (trace over)", options: ["backdrop (trace over)", "use as color map"], tooltip: NEW_NODES, category: CAT("Region Genie node", "03 image") },
        {
            id: SET.cmMinPixels, name: "Color map: min region pixels", type: "number", defaultValue: 64, attrs: { min: 1, max: 1000000, step: 1 },
            tooltip: "With the image used as a color map: a color becomes a region when it has at least this many flat pixels "
                + "(blended edges and specks go to the nearest region). Applies to every Region Genie node at its next run; "
                + "the node's image control shows it too while 'color map' is chosen.",
            category: CAT("Region Genie node", "04 min"),
        },
        {
            id: SET.cmImportMode, name: "import_json when the canvas isn't empty", type: "combo", defaultValue: "ask before replacing",
            options: ["ask before replacing", "always replace"],
            tooltip: "Ask before replacing: the run keeps the canvas and the node asks (Replace canvas / Keep canvas). Always "
                + "replace: the new layout replaces the canvas right away. An empty canvas is always filled. Applies to every "
                + "Region Genie node at its next run.",
            category: CAT("Region Genie node", "05 import"),
        },
        { id: SET.cmFeather, name: "Feather (px, linked regions)", type: "number", defaultValue: 0, attrs: { min: 0, max: 512, step: 1 }, tooltip: NEW_NODES, category: CAT("Region Genie node", "06 feather") },
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
            id: SET.cmAutoApart, name: "Models without a layout format: keep all regions apart automatically", type: "boolean", defaultValue: true,
            tooltip: "Krea 2, Flux, Flux 3, Anima and SDXL / SD1.5 get the regions as plain sentences: the Region Genie node "
                + "places each region by tying its sentence to its region in attention ('keep all regions apart'). On: "
                + "with such a model on 'model', clip connected and at least one region prompt, that switch is on for the "
                + "run even when the node's own switch is off. Off: only the node's switch counts. The settings below "
                + "change it for one model. Applies to every Region Genie node at its next run.",
            category: CAT("Region Genie node", "086 auto apart"),
        },
        ...AUTO_APART_MODELS.map(([fam, key], i) => ({
            id: SET.cmAutoApart + "." + key, name: `${fam}: keep all regions apart automatically`, type: "combo", defaultValue: "default",
            options: [{ text: "As set for all models (above)", value: "default" }, { text: "On", value: "on" }, { text: "Off", value: "off" }],
            tooltip: `For ${fam} models only; 'As set for all models' follows the setting above.`,
            category: CAT("Region Genie node", "087 auto apart " + i),
        })),
        { id: SET.cmSnap, name: "Snap to grid on", type: "boolean", defaultValue: false, tooltip: "When a Region Genie node is added or a workflow is opened.", category: CAT("Region Genie node", "09 snap") },
        { id: SET.cmGrid, name: "Grid size (image px)", type: "number", defaultValue: 64, attrs: { min: 2, max: 4096, step: 1 }, tooltip: "When a Region Genie node is added or a workflow is opened.", category: CAT("Region Genie node", "10 grid") },
        ...CONTROL_FILES.map(([key, name, folder, model, tag], i) => ({
            id: SET.control + "." + key, name, type: "combo", defaultValue: CONTROL_NONE,
            // the file list is read when ComfyUI starts; the set value is always listed
            options: (value) => {
                const list = (folder === "loras" ? knownLoras() : knownModels(folder)) || [];
                const cur = typeof value === "string" && value && value !== CONTROL_NONE && !list.includes(value) ? [value] : [];
                return [CONTROL_NONE, ...cur, ...list];
            },
            tooltip: (tag ? `Turning on a Region Genie node's Control row adds this LoRA to its 'Whole image' LoRAs (marked 'Control') `
                + `when the control uses it, and turning it off removes it again. It is applied only when the model on 'model' is ${model}.`
                : model ? `The Region Genie node's Control row uses this file (models/${folder}) when the model on 'model' is ${model}.`
                : "Makes the depth map from the node's 'image' input when no control_image is connected (models/geometry_estimation; "
                    + "ComfyUI's Depth Anything 3).")
                + " The same for every Region Genie node.",
            category: CAT("Control", String(i).padStart(2, "0") + " " + key),
        })),
        ...EDIT_MODELS.map(([name, key], i) => ({
            id: SET.editLora + "." + key, name: `${name}: edit LoRA`, type: "combo", defaultValue: NO_LORA,
            // the LoRA list is read when ComfyUI starts (and refreshed when a LoRA picker opens); the set value is always listed
            options: (value) => {
                const list = knownLoras() || [];
                const cur = typeof value === "string" && value && value !== NO_LORA && !list.includes(value) ? [value] : [];
                return [NO_LORA, ...cur, ...list];
            },
            tooltip: `Switching a Region Genie node to Edit Mode adds this LoRA to its 'Whole image' LoRAs (marked 'edit '`
                + `LoRA'), and switching back to generate removes it again. It is applied only when the model on 'model' is `
                + `${name}, so one LoRA per model can be set here.`
                + (key === "MOSS" ? " For MOSS Image, e.g. the Moss-Image-Edit LoRA; its file decides the edit layout (see below)." : ""),
            category: CAT("Edit Mode", "1 lora " + String(i).padStart(2, "0")),
        })),
        ...EDIT_MODELS.filter((m) => m[2]).map(([name, key], i) => ({
            id: SET.editRef + "." + key, name: `${name}: send the source image as a reference`, type: "boolean", defaultValue: true,
            tooltip: `In Edit Mode, the source image (on 'image') is also given to ${name} as a reference image `
                + "(reference_latents on positive and negative), as edit models such as "
                + ({ MOSS: "MOSS Image Edit", Krea2: "Krea 2 edit packs", Flux1: "Flux.1 Kontext", Flux2: "Flux.2 / Klein", Flux3: "Flux 3" }[key])
                + " expect. Off: image-to-image from the latent only."
                + (key === "Flux1" ? " Flux.1 dev and Kontext can't be told apart: turn this off for plain Flux.1 dev." : ""),
            category: CAT("Edit Mode", "2 ref " + i),
        })),
        {
            id: SET.editRefSize, name: "Reference image size (long edge, px; 0 = output size)", type: "number", defaultValue: 1024,
            attrs: { min: 0, max: 8192, step: 16 },
            tooltip: "The reference image is scaled down to this long edge before it is encoded (never up). Larger is slower.",
            category: CAT("Edit Mode", "3 ref size"),
        },
        {
            id: SET.editMossFormat, name: "MOSS Image edit layout", type: "combo", defaultValue: "auto",
            options: [{ text: "Auto (from the edit LoRA file)", value: "auto" }, "Moss-Image-Edit", "ai-toolkit", "ai-toolkit (kv_cache off)"],
            tooltip: "How the reference is given to MOSS Image (as in ComfyUI's TextEncodeMOSSImageEdit node). Auto: LoRAs "
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
        { id: SET.hlUntil, name: "separation_until", type: "slider", defaultValue: 0.25, attrs: { min: 0, max: 1, step: 0.05 }, tooltip: NEW_NODES, category: CAT("Regional LoRAs", "4 until") },
];
SETTINGS.forEach((x, i) => { x.sortOrder = 1000 - i; });         // listed in this order (higher sortOrder first)
// The pack was called "Regional Mask Kit" before: on the first start after the rename, copy the values set under
// the old setting IDs to the new ones (only where the new one isn't set yet). To be removed in a later version.
const OLD_PREFIX = "RegionalMaskKit.";
const oldSettingId = (id) => OLD_PREFIX + id.slice("RegionGenie.".length).replace(/^Main\./, "ColorMap.").replace(/^RegionalLoRAs\./, "HookLoRAs.");
async function migrateOldSettings() {
    let stored = null;
    try { stored = await api.getSettings(); } catch (e) { return; }
    if (!stored || typeof stored !== "object") return;
    for (const { id } of SETTINGS) {
        const old = oldSettingId(id);
        if (!(old in stored) || id in stored) continue;
        try {
            if (app.extensionManager?.setting?.set) await app.extensionManager.setting.set(id, stored[old]);
            else await app.ui?.settings?.setSettingValueAsync?.(id, stored[old]);
        } catch (e) { console.warn("[Region Genie] could not copy setting", old, e); }
    }
    // "Krea 2: keep all regions apart automatically" turned off before it became one setting per model
    const krea2 = SET.cmAutoApart + ".Krea2";
    if (stored[SET.cmKrea2Apart] === false && !(krea2 in stored)) {
        try {
            if (app.extensionManager?.setting?.set) await app.extensionManager.setting.set(krea2, "off");
            else await app.ui?.settings?.setSettingValueAsync?.(krea2, "off");
        } catch (e) { console.warn("[Region Genie] could not copy setting", SET.cmKrea2Apart, e); }
    }
}
app.registerExtension({
    name: "RegionGenie.Settings",
    settings: SETTINGS,
    setup() {
        loadAutocompleteEngines(); migrateOldSettings(); getLoras();
        settingsReady = true;
        postLlmCache({});                     // the server learns the LLM cache settings (and deletes the file when off)
    },
});

export const AC_CSS = `
.rg-ac.comfy-autocomplete-dropdown .comfy-autocomplete-item { padding:2px 10px !important; }
.rg-ac.pysssss-autocomplete .pysssss-autocomplete-item { padding:1px 7px; line-height:1.25; }
.rg-ac.pysssss-autocomplete .pysssss-autocomplete-pill { padding-top:0; padding-bottom:0; }
.rg-ac-btn { background:var(--comfy-input-bg,#222); color:var(--input-text,#ddd); border:1px solid var(--border-color,#555);
  border-radius:4px; padding:2px 4px; line-height:0; cursor:pointer; flex:0 0 auto; }
.rg-ac-btn svg { width:16px; height:16px; display:block; }
.rg-ac-btn:not(.on) { opacity:.55; }
.rg-ac-btn.on { background:#3a6ea5; border-color:#5b8fd0; color:#fff; }
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
