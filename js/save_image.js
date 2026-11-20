// Save Image (Region Genie): shows only the chosen format's fields, fills in filename_prefix's %date% / %Node.widget%
// tokens (ComfyUI does that only for its own save nodes), starts new nodes with the Settings defaults, and shows the
// saved files and their sizes after a run. Design: docs/superpowers/specs/2026-11-13-save-image-design.md
// Round 44: the node also writes what the image was made with as text for other interfaces (a1111_metadata; the
// Python side reads it from the workflow that ran). Values the workflow doesn't show can be connected: those optional
// inputs are hidden until they are ticked in the node's inputs list (the cable button at the end of its status line).
import { app } from "../../scripts/app.js";
import { getSetting, SET, keepWidgetValuesByName, svgIcon, socksStyle } from "./rg_shared.js";

const NODE = "Region-Genie_SaveImage";
const FIELDS = {
    png: ["png_compression", "png_bit_depth"],
    webp: ["webp_lossless", "webp_quality"],
    jpeg: ["jpeg_quality", "jpeg_extension", "jpeg_workflow"],
    avif: ["avif_quality"],
    exr: ["exr_bit_depth", "exr_color_space"],
};
const ALL = ["filename_prefix", "format", ...Object.values(FIELDS).flat(), "invert_mask", "a1111_metadata"];
// the optional inputs for the settings text: [name, type, what the list says about it]
const META = [
    ["positive", "STRING", "The prompt, in place of the one read from the workflow."],
    ["negative", "STRING", "The negative prompt, in place of the one read from the workflow."],
    ["seed", "INT", "The seed. Connect it when the sampler gets its seed from another node."],
    ["steps", "INT", "The number of steps."],
    ["cfg", "FLOAT", "The cfg."],
    ["sampler_name", "*", "The sampler's name, as ComfyUI names it (euler_ancestral)."],
    ["scheduler", "*", "The scheduler's name, as ComfyUI names it (karras)."],
    ["denoise", "FLOAT", "The denoise."],
    ["model_name", "*", "The model's name."],
];
const META_TYPE = Object.fromEntries(META.map(([n, t]) => [n, t]));
let panel = null;                                    // one inputs list at a time, on the whole page
const CSS = `
.rg-save-out { display:flex; align-items:center; gap:6px; height:20px; padding:0 4px; box-sizing:border-box; overflow:hidden;
  white-space:nowrap; text-overflow:ellipsis; font:12px sans-serif; color:var(--input-text,#ddd); opacity:.85; }
.rg-save-out .rg-save-note { color:#d9a441; overflow:hidden; text-overflow:ellipsis; }
.rg-save-out.stale { opacity:.45; }
.rg-save-text { display:flex; align-items:center; gap:6px; flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.rg-save-out.stale .rg-save-socks { opacity:1; }
.rg-save-socks { flex:0 0 auto; margin-left:auto; width:20px; height:18px; padding:0; display:inline-flex; align-items:center; justify-content:center;
  background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px; cursor:pointer; }
.rg-save-socks svg { width:13px; height:13px; display:block; pointer-events:none; }
.rg-save-socks.on { background:#3a6ea5; border-color:#5b8fd0; color:#fff; }
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
    // the same rules as ComfyUI's own (scripts/utils applyTextReplacements, formatDate), for a frontend without it
    const nodes = app.graph?.nodes || [];
    return String(text).replace(/%([^%]+)%/g, (m, t) => {
        const split = t.split(".");
        if (split.length !== 2) {
            if (!split[0].startsWith("date:")) return m;
            const now = new Date();
            const get = { d: () => now.getDate(), M: () => now.getMonth() + 1, h: () => now.getHours(), m: () => now.getMinutes(), s: () => now.getSeconds() };
            return split[0].slice(5).replace(/(d+|M+|y+|h+|m+|s+)/g, (k) => {
                if (k === "yy") return String(now.getFullYear()).slice(2);
                if (k === "yyyy") return String(now.getFullYear());
                return k[0] in get ? String(get[k[0]]()).padStart(k.length, "0") : k;
            });
        }
        // the node by its "Node name for S&R", else by its title
        const n = nodes.find((x) => x.properties?.["Node name for S&R"] === split[0]) || nodes.find((x) => x.title === split[0]);
        const w = n?.widgets?.find((x) => x.name === split[1]);
        return w ? String(w.value ?? "").replaceAll(/[/?<>\\:*|"\x00-\x1F\x7F]/g, "_") : m;
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
                if (fmt !== "exr") want.add("a1111_metadata");       // (EXR has no place for the settings text)
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
            const outText = document.createElement("span"); outText.className = "rg-save-text"; out.appendChild(outText);

            // ---- the optional inputs for the settings text (round 44). A node shows those listed in its property
            // rg_meta_inputs, and any that is connected. The Python node declares all of them, so a new node has them
            // all for a moment: they are taken off right after it is made, or right after it was loaded.
            const shown = () => META.map(([n]) => n).filter((n) => node.inputs?.some((i) => i.name === n));
            const linked = (n) => node.inputs?.some((i) => i.name === n && i.link != null);
            function setMeta(names, quiet = false) {
                const want = new Set(names.filter((n) => META_TYPE[n]));
                const legacy = !app.extensionManager?.setting?.get?.("Comfy.VueNodes.Enabled");
                const before = legacy ? node.computeSize?.()[1] : 0;
                let changed = false;
                for (const [n, type] of META) {
                    const at = node.inputs?.findIndex((i) => i.name === n) ?? -1;
                    if (want.has(n) && at < 0) { node.addInput(n, type); changed = true; }
                    else if (!want.has(n) && at >= 0 && node.inputs[at].link == null) { node.removeInput(at); changed = true; }
                }
                node.properties = node.properties || {};
                const list = shown();
                if (list.length) node.properties.rg_meta_inputs = list; else delete node.properties.rg_meta_inputs;
                if (!changed) return;
                const after = legacy ? node.computeSize?.()[1] : 0;
                if (legacy && after && before) node.setSize([node.size[0], Math.max(after, node.size[1] + after - before)]);
                node.setDirtyCanvas?.(true, true);
                if (!quiet) node.graph?.change?.();
            }
            const wanted = () => [...new Set([...(Array.isArray(node.properties?.rg_meta_inputs) ? node.properties.rg_meta_inputs : []),
                                             ...META.map(([n]) => n).filter(linked)])];
            let configured = false;
            // a saved node: ComfyUI keeps a saved input (and its link) only if the node has that input when it is loaded
            const conf = node.configure;
            node.configure = function (info) {
                configured = true;
                for (const i of info?.inputs || []) if (META_TYPE[i.name] && !this.inputs?.some((x) => x.name === i.name)) this.addInput(i.name, META_TYPE[i.name]);
                return conf.apply(this, arguments);
            };
            queueMicrotask(() => { if (!configured) setMeta([], true); });
            node.__rgMetaInputs = shown;
            node.__rgSetMetaInput = (n, on) => setMeta(on ? [...shown(), n] : shown().filter((x) => x !== n));

            const sockBtn = document.createElement("button");
            sockBtn.type = "button"; sockBtn.className = "rg-save-socks"; sockBtn.innerHTML = svgIcon("sockets");
            sockBtn.title = "Inputs: Choose which optional inputs this node shows for the settings text it writes for other "
                + "interfaces (a1111_metadata).\nTick one when the workflow doesn't show that value because another node sets "
                + "it, then connect it.\nA connected one always stays.";
            for (const ev of ["pointerdown", "mousedown", "dblclick"]) sockBtn.addEventListener(ev, (e) => e.stopPropagation());
            sockBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleList(); });
            out.appendChild(sockBtn);
            function toggleList() {
                if (panel) { const mine = panel.node === node; panel.close(); if (mine) return; }
                socksStyle();
                const box = document.createElement("div"); box.className = "rg-socks rg-save-list"; box.tabIndex = -1;
                function render() {
                    const h = document.createElement("h4"); h.textContent = "Inputs for the settings text";
                    box.replaceChildren(h, ...META.map(([n, , tip]) => {
                        const l = document.createElement("label"), c = document.createElement("input"), t = document.createElement("span");
                        c.type = "checkbox"; c.checked = shown().includes(n); t.textContent = n;
                        const fixed = linked(n);
                        c.disabled = fixed; if (fixed) l.classList.add("off");
                        l.title = `${n}: ${tip}` + (fixed ? "\nConnected: Disconnect it to hide it." : "");
                        l.dataset.sock = n; l.append(c, t);
                        if (fixed) { const w = document.createElement("span"); w.className = "rg-socks-why"; w.textContent = "connected"; l.append(w); }
                        c.addEventListener("change", () => { node.__rgSetMetaInput(n, c.checked); last = sig(); render(); place(); });
                        return l;
                    }));
                }
                function place() {
                    const r = sockBtn.getBoundingClientRect(), w = box.offsetWidth, hh = box.offsetHeight;
                    box.style.left = Math.round(Math.max(6, Math.min(r.right - w, window.innerWidth - w - 6))) + "px";
                    box.style.top = Math.round(r.bottom + 6 + hh <= window.innerHeight - 6 ? r.bottom + 6 : Math.max(6, r.top - 6 - hh)) + "px";
                }
                document.body.appendChild(box);
                const stop = (e) => e.stopPropagation();
                for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu", "keydown"]) box.addEventListener(ev, stop);
                box.dataset.captureWheel = "true";
                const outside = (e) => { if (!box.contains(e.target) && !sockBtn.contains(e.target)) close(); };
                const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
                // the node can change under the open list (an input connected, the node moved)
                const sig = () => META.map(([n]) => (shown().includes(n) ? "1" : "0") + (linked(n) ? "L" : "")).join();
                let last = sig();
                const timer = setInterval(() => {
                    if (!out.isConnected || !node.graph) { close(); return; }
                    if (sig() !== last) { last = sig(); render(); }
                    place();
                }, 300);
                render(); place();
                function close() {
                    if (panel?.box !== box) return;
                    panel = null; clearInterval(timer);
                    document.removeEventListener("pointerdown", outside, true);
                    document.removeEventListener("keydown", key, true);
                    box.remove(); sockBtn.classList.remove("on");
                }
                document.addEventListener("pointerdown", outside, true);
                document.addEventListener("keydown", key, true);
                panel = { box, node, close };
                sockBtn.classList.add("on");
                box.focus({ preventScroll: true });
            }
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
                    outText.textContent = "";
                    out.classList.remove("stale");
                    const t = document.createElement("span"); t.textContent = main; outText.appendChild(t);
                    if (s.notes?.length) { const n = document.createElement("span"); n.className = "rg-save-note"; n.textContent = "⚠ " + s.notes.join(" · "); outText.appendChild(n); }
                    lastTip = [...(s.files || []).map((f) => `${f.name} — ${fmtSize(f.bytes)}`), ...(s.notes || []).map((n) => "⚠ " + n)].join("\n")
                        + (s.settings ? "\nSettings text written for other interfaces (a1111_metadata):\n" + s.settings : "");
                    out.title = lastTip;
                    out.dataset.settings = s.settings ? "1" : "";
                }
                return x;
            };

            keepWidgetValuesByName(node, ALL);
            const onConf = node.onConfigure;
            node.onConfigure = function () {
                const x = onConf?.apply(this, arguments);
                setTimeout(sync, 0);
                setTimeout(() => setMeta(wanted(), true), 0);         // the graph's links are all there by then
                return x;
            };
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
            set("exr_bit_depth", getSetting(SET.saveExrDepth, "16-bit float"));
            set("exr_color_space", getSetting(SET.saveExrSpace, "sRGB"));
            setTimeout(sync, 0);
            return r;
        };
    },
});
