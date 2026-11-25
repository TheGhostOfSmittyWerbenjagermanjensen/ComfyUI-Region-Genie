// Tiled Upscale (Region Genie): the settings that are set once (how the image is resized, the tile blend, how the
// upscale model and the VAE are run) are folded away behind a "More settings" line, so the node is shorter (round 84;
// the owner chose this over rows of two settings). The line is the pack's own, so it works with legacy nodes and with
// Nodes 2.0. Folded settings are ComfyUI's own widgets, only hidden; one with a cable connected to it always stays.
import { app } from "../../scripts/app.js";
import { keepWidgetValuesByName, svgIcon } from "./rg_shared.js";

const NODE = "Region-Genie_TiledUpscale";
const MORE = ["resize_method", "tile_blend", "upscale_model_tile_size", "upscale_model_half_precision",
              "vae_encode_tile_size", "vae_decode_tile_size"];
const ALL = ["upscale_by", "upscale_model", "denoise", "seed", "steps", "cfg", "sampler_name", "scheduler", "tile_width",
             "tile_height", "tile_overlap", "tile_batch_size", "color_fix", "preview", ...MORE];
const ROW_H = 20;
const CSS = `
.rg-tu-more { display:flex; align-items:center; gap:6px; height:${ROW_H}px; padding:0 4px; box-sizing:border-box; }
.rg-tu-more button { display:flex; align-items:center; gap:3px; flex:0 0 auto; height:18px; margin:0; padding:0 6px 0 2px;
  border:0; border-radius:9px; background:transparent; color:var(--descrip-text, #999); font:inherit; font-size:12px; cursor:pointer; }
.rg-tu-more button:hover { color:var(--input-text, #ddd); background:var(--comfy-input-bg, #222); }
.rg-tu-more button svg { width:13px; height:13px; }
.rg-tu-more:after { content:""; flex:1 1 auto; height:1px; background:var(--border-color, #4e4e4e); }
.rg-tu-more .rg-tu-changed { color:#d9a441; }`;

app.registerExtension({
    name: "RegionGenie.TiledUpscale",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE) return;
        if (!document.getElementById("rg-tu-css")) {
            const st = document.createElement("style"); st.id = "rg-tu-css"; st.textContent = CSS; document.head.appendChild(st);
        }
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onCreated?.apply(this, arguments);
            const node = this;
            const W = (n) => node.widgets?.find((w) => w.name === n);
            const initial = {};                      // what a new node has: a folded setting that differs is counted on the line
            for (const n of MORE) initial[n] = W(n)?.value;
            const linked = (n) => node.inputs?.some((i) => (i.widget?.name ?? i.name) === n && i.link != null);
            const isOpen = () => !!node.properties?.rg_more;

            const row = document.createElement("div");
            row.className = "rg-tu-more";
            const btn = document.createElement("button");
            btn.type = "button";
            for (const ev of ["pointerdown", "mousedown", "dblclick"]) btn.addEventListener(ev, (e) => e.stopPropagation());
            btn.addEventListener("click", (e) => {
                e.preventDefault(); e.stopPropagation();
                node.properties = node.properties || {};
                node.properties.rg_more = !isOpen();
                sync();
            });
            row.appendChild(btn);
            const rowW = node.addDOMWidget("rg_more", "RgMore", row, {
                serialize: false, hideOnZoom: false, margin: 0, getMinHeight: () => ROW_H, getMaxHeight: () => ROW_H,
            });
            rowW.serialize = false;
            rowW.computeSize = (w) => [w ?? node.size?.[0] ?? 300, ROW_H];
            rowW.computeLayoutSize = undefined;
            {   // the line goes just above the first folded setting
                const at = node.widgets.findIndex((w) => MORE.includes(w.name)), i = node.widgets.indexOf(rowW);
                if (at >= 0 && i > at) { node.widgets.splice(i, 1); node.widgets.splice(at, 0, rowW); }
            }

            const sizeOf = new Map();                // the widgets' own computeSize, put back when shown again
            function label() {
                const open = isOpen();
                const changed = MORE.filter((n) => W(n) && W(n).value !== initial[n]).length;
                const html = svgIcon(open ? "chevronDown" : "chevronRight") + `<span>${open ? "Fewer settings" : "More settings"}</span>`
                    + (!open && changed ? `<span class="rg-tu-changed">${changed} changed</span>` : "");
                if (btn.__html !== html) { btn.__html = html; btn.innerHTML = html; }
                const title = open
                    ? "Folds the settings below away: The ones that are usually set once."
                    : "Shows the settings that are usually set once: How the image is resized, the tile blend, and how the "
                      + "upscale model and the VAE are run."
                      + (changed ? `\n${changed} of them differ from what a new node has.` : "");
                if (btn.title !== title) btn.title = title;
            }
            // loaded: the workflow was just loaded, and the node's saved size already fits its saved state
            let justLoaded = false;                  // set when the node is configured: the next sync, whoever asks, keeps the size
            function sync(loaded) {
                loaded = loaded === true || justLoaded; justLoaded = false;
                const open = isOpen();
                const legacy = !app.extensionManager?.setting?.get?.("Comfy.VueNodes.Enabled");
                const before = legacy ? node.computeSize?.()[1] : 0;
                let changed = false;
                for (const n of MORE) {
                    const w = W(n);
                    if (!w) continue;
                    const show = open || linked(n);
                    if (!w.hidden === show) continue;
                    changed = true;
                    if (!sizeOf.has(w)) sizeOf.set(w, Object.getOwnPropertyDescriptor(w, "computeSize") || null);
                    w.hidden = !show;
                    if (show) { const d = sizeOf.get(w); if (d) Object.defineProperty(w, "computeSize", d); else delete w.computeSize; }
                    else w.computeSize = () => [0, -4];
                }
                label();
                if (!changed) return;
                // legacy: grow or shrink by what the settings add or take, so a node made taller by hand stays taller.
                // Nodes 2.0: the node's size is the least height of its box; down to what the shown settings need
                const after = node.computeSize?.()[1] || 0;
                if (loaded === true) { if (after && node.size[1] < after) node.setSize([node.size[0], after]); }
                else if (legacy && after && before) node.setSize([node.size[0], Math.max(after, node.size[1] + after - before)]);
                else if (!legacy && after && (node.size[1] > after || open)) node.setSize([node.size[0], after]);
                node.setDirtyCanvas?.(true, true);
            }
            node.__rgMoreSync = sync;

            for (const n of MORE) {                  // the "changed" count follows the values
                const w = W(n);
                if (!w) continue;
                const cb = w.callback;
                w.callback = function () { const x = cb?.apply(this, arguments); label(); return x; };
            }
            const onConn = node.onConnectionsChange;
            node.onConnectionsChange = function () { const x = onConn?.apply(this, arguments); setTimeout(() => sync(), 0); return x; };
            keepWidgetValuesByName(node, ALL);
            const onConf = node.onConfigure;
            node.onConfigure = function () { const x = onConf?.apply(this, arguments); justLoaded = true; setTimeout(() => sync(true), 0); return x; };
            sync();
            setTimeout(() => sync(), 0);
            return r;
        };
    },
});
