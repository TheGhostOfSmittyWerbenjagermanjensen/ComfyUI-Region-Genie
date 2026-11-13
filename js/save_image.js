// Save Image (Region Genie): shows only the chosen format's fields, fills in filename_prefix's %date% / %Node.widget%
// tokens (ComfyUI does that only for its own save nodes), starts new nodes with the Settings defaults, and shows the
// saved files and their sizes after a run. Design: docs/superpowers/specs/2026-11-13-save-image-design.md
import { app } from "../../scripts/app.js";
import { getSetting, SET, keepWidgetValuesByName } from "./rg_shared.js";

const NODE = "Region-Genie_SaveImage";
const FIELDS = {
    png: ["png_compression", "png_bit_depth"],
    webp: ["webp_lossless", "webp_quality"],
    jpeg: ["jpeg_quality", "jpeg_extension", "jpeg_workflow"],
    avif: ["avif_quality"],
};
const ALL = ["filename_prefix", "format", ...Object.values(FIELDS).flat(), "invert_mask"];
const CSS = `
.rg-save-out { display:flex; align-items:center; gap:6px; height:20px; padding:0 4px; box-sizing:border-box; overflow:hidden;
  white-space:nowrap; text-overflow:ellipsis; font:12px sans-serif; color:var(--input-text,#ddd); opacity:.85; }
.rg-save-out .rg-save-note { color:#d9a441; overflow:hidden; text-overflow:ellipsis; }
.rg-save-out.stale { opacity:.45; }
`;

// 1024-based sizes: B, KB, MB (2 decimals from 1 MB)
export function fmtSize(n) {
    if (!Number.isFinite(n)) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) { const k = n / 1024; return `${k < 100 ? k.toFixed(1) : Math.round(k)} KB`; }
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// %date:yyyy-MM-dd hh:mm:ss% and %Node title.widget% (or the node's "Node name for S&R"), as ComfyUI's own save nodes
function replaceTokens(text) {
    const fn = window.comfyAPI?.utils?.applyTextReplacements;
    if (typeof fn === "function") {
        for (const arg of [app.graph, app]) {
            try { const r = fn(arg, text); if (typeof r === "string") return r; } catch (e) { /* try the other signature */ }
        }
    }
    return String(text).replace(/%([^%]+)%/g, (m, t) => {
        const d = t.match(/^date:(.*)$/);
        if (d) {
            const now = new Date(), p = (v, n = 2) => String(v).padStart(n, "0");
            const parts = { yyyy: now.getFullYear(), yy: p(now.getFullYear() % 100), MM: p(now.getMonth() + 1), M: now.getMonth() + 1,
                            dd: p(now.getDate()), d: now.getDate(), hh: p(now.getHours()), h: now.getHours(),
                            mm: p(now.getMinutes()), m: now.getMinutes(), ss: p(now.getSeconds()), s: now.getSeconds() };
            return d[1].replace(/yyyy|yy|MM|M|dd|d|hh|h|mm|m|ss|s/g, (k) => String(parts[k]));
        }
        const i = t.lastIndexOf(".");
        if (i < 0) return m;
        const name = t.slice(0, i), wname = t.slice(i + 1);
        const n = (app.graph?.nodes || []).find((x) => x.title === name || x.properties?.["Node name for S&R"] === name);
        const w = n?.widgets?.find((x) => x.name === wname);
        return w ? String(w.value).replaceAll("/", "_").replaceAll("\\", "_") : m;
    });
}

app.registerExtension({
    name: "RegionGenie.SaveImage",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE) return;
        if (!document.getElementById("rg-save-css")) {
            const st = document.createElement("style"); st.id = "rg-save-css"; st.textContent = CSS; document.head.appendChild(st);
        }
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onCreated?.apply(this, arguments);
            const node = this;
            const W = (n) => node.widgets?.find((w) => w.name === n);
            const sizeOf = new Map();                // the widgets' own computeSize, put back when shown again

            // only the chosen format's fields (webp_quality not while lossless; invert_mask only with a mask linked)
            function sync() {
                const fmt = FIELDS[W("format")?.value] ? W("format").value : "png";
                const masked = node.inputs?.some((i) => i.name === "mask" && i.link != null);
                const want = new Set(["filename_prefix", "format", ...FIELDS[fmt]]);
                if (fmt === "webp" && W("webp_lossless")?.value) want.delete("webp_quality");
                if (masked && fmt !== "jpeg") want.add("invert_mask");
                let changed = false;
                const legacy = !app.extensionManager?.setting?.get?.("Comfy.VueNodes.Enabled");
                const before = legacy ? node.computeSize?.()[1] : 0;
                for (const n of ALL) {
                    const w = W(n);
                    if (!w) continue;
                    const show = want.has(n);
                    if (!w.hidden === show) continue;
                    changed = true;
                    if (!sizeOf.has(w)) sizeOf.set(w, Object.getOwnPropertyDescriptor(w, "computeSize") || null);
                    w.hidden = !show;
                    if (show) { const d = sizeOf.get(w); if (d) Object.defineProperty(w, "computeSize", d); else delete w.computeSize; }
                    else w.computeSize = () => [0, -4];
                }
                if (changed) {
                    // legacy: grow or shrink by what the fields add or take, so a node made taller by hand stays taller
                    const after = legacy ? node.computeSize?.()[1] : 0;
                    if (legacy && after && before) node.setSize([node.size[0], Math.max(after, node.size[1] + after - before)]);
                    node.setDirtyCanvas?.(true, true);
                }
            }
            // a setting changed after a run: the readout is from the last run (dimmed) until the next one
            let lastTip = "";
            const markStale = () => {
                if (!lastTip || out.classList.contains("stale")) return;
                out.classList.add("stale");
                out.title = "From the last run, before the settings changed:\n" + lastTip;
            };
            for (const n of ALL) {
                const w = W(n);
                if (!w) continue;
                const cb = w.callback;
                w.callback = function () { const x = cb?.apply(this, arguments); markStale(); if (n === "format" || n === "webp_lossless") sync(); return x; };
            }
            const onConn = node.onConnectionsChange;
            node.onConnectionsChange = function () { const x = onConn?.apply(this, arguments); setTimeout(sync, 0); return x; };

            // filename tokens, filled in when the prompt is queued
            const pre = W("filename_prefix");
            if (pre) pre.serializeValue = () => (typeof pre.value === "string" ? replaceTokens(pre.value) : pre.value);

            // the saved files and their sizes (after a run; not saved with the workflow)
            const out = document.createElement("div");
            out.className = "rg-save-out";
            out.title = "The saved files and their sizes show here after a run";
            const outW = node.addDOMWidget("rg_saved", "RgSaved", out, {
                serialize: false, hideOnZoom: false, margin: 3, getMinHeight: () => 22, getMaxHeight: () => 22,
            });
            outW.serialize = false;
            outW.computeSize = (w) => [w ?? node.size?.[0] ?? 300, 24];
            outW.computeLayoutSize = undefined;
            const onExec = node.onExecuted;
            node.onExecuted = function (message) {
                const x = onExec?.apply(this, arguments);
                const s = message?.rg_saved?.[0];
                if (s) {
                    // the images' total; the JPEG .json files (the workflow) apart
                    const isJson = (f) => /\.json$/i.test(f.name), sum = (a) => a.reduce((t, f) => t + (f.bytes || 0), 0);
                    const imgs = (s.files || []).filter((f) => !isJson(f)), jsons = (s.files || []).filter(isJson);
                    let main = imgs.length > 1 ? `${imgs.length} × ${s.label} · ${fmtSize(sum(imgs))} total` : `${s.label} · ${fmtSize(sum(imgs))}`;
                    if (jsons.length) main += ` + ${jsons.length} .json · ${fmtSize(sum(jsons))}`;
                    out.textContent = "";
                    out.classList.remove("stale");
                    const t = document.createElement("span"); t.textContent = main; out.appendChild(t);
                    if (s.notes?.length) { const n = document.createElement("span"); n.className = "rg-save-note"; n.textContent = "⚠ " + s.notes.join(" · "); out.appendChild(n); }
                    lastTip = [...(s.files || []).map((f) => `${f.name} — ${fmtSize(f.bytes)}`), ...(s.notes || []).map((n) => "⚠ " + n)].join("\n");
                    out.title = lastTip;
                }
                return x;
            };

            keepWidgetValuesByName(node, ALL);
            const onConf = node.onConfigure;
            node.onConfigure = function () { const x = onConf?.apply(this, arguments); setTimeout(sync, 0); return x; };
            // Settings > Region Genie > Save Image: how a new node starts. Set right away, while the node is being made:
            // a saved, pasted or API-format workflow sets its own values afterwards and so keeps them
            const set = (n, v) => {
                const w = W(n);
                if (!w || v === undefined || v === null) return;
                if (Array.isArray(w.options?.values) && !w.options.values.includes(v)) return;
                w.value = v;
            };
            set("format", getSetting(SET.saveFormat, "png"));
            set("png_compression", Math.max(0, Math.min(9, Math.round(+getSetting(SET.savePngLevel, 9)))));
            set("webp_lossless", !!getSetting(SET.saveWebpLossless, false));
            set("webp_quality", Math.max(1, Math.min(100, Math.round(+getSetting(SET.saveWebpQuality, 90)))));
            set("jpeg_quality", Math.max(1, Math.min(100, Math.round(+getSetting(SET.saveJpegQuality, 90)))));
            set("jpeg_extension", getSetting(SET.saveJpegExt, ".jpg"));
            set("jpeg_workflow", getSetting(SET.saveJpegWorkflow, "sidecar .json"));
            set("avif_quality", Math.max(1, Math.min(100, Math.round(+getSetting(SET.saveAvifQuality, 80)))));
            setTimeout(sync, 0);
            return r;
        };
    },
});
