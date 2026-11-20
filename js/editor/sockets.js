// The node's sockets (round 40): fewer of them by default, and a checklist to choose which show.
// One part of the Region Genie node's editor (see parts.js).
//
// Inputs. A new node shows model, clip, vae, image and size_from. size_from takes an image or a latent (it replaces
// the size_from_image and size_from_latent sockets: their links are moved here on load). width / height and
// import_json show when ticked in the sockets list; control_image shows while the node has a Control row.
//
// Outputs. The Python node always returns all 13, in a fixed order. The node here shows the ticked ones only, so the
// output numbers in the workflow (0, 1, 2 … of what is shown) are not the Python node's. mapShownOutputs() puts that
// right when ComfyUI turns the graph into a prompt: the hidden widget outputs_shown carries the names of the shown
// outputs into the prompt, every link from this node gets the real number of its output, and the widget is emptied.
// If that step is ever skipped, the Python node sees outputs_shown still set and stops with a message, so a link can
// never deliver another output's data.
//
// A socket that is connected always stays. Changing the sockets keeps the node's bottom edge where it is: the editor
// keeps its height and the node's top moves (the owner's choice).
import { app } from "../../../scripts/app.js";
import { svgIcon } from "../rg_shared.js";
import { linkOf, remapOutputs } from "./graph.js";

const NODE = "Region-Genie_Main";
const SAMPLER_OUTS = ["model", "positive", "negative", "latent"];       // what a new node shows
const OLD_SIZE = ["size_from_image", "size_from_latent"];
const HIDDEN_BY_DEFAULT = [...OLD_SIZE, "width_in", "height_in", "import_json", "control_image"];

// ---------------------------------------------------------------- the prompt: shown outputs -> real output numbers
let outNames = null;
export function mapShownOutputs(output, names = outNames) {
    if (!output || !names?.length) return 0;
    const shown = {};
    for (const [id, n] of Object.entries(output)) {
        if (n?.class_type !== NODE || !n.inputs) continue;
        const v = String(n.inputs.outputs_shown ?? "").trim();
        if (!v) continue;
        shown[id] = v.split(",").map((name) => names.indexOf(name.trim()));
        n.inputs.outputs_shown = "";
    }
    let moved = 0;
    if (!Object.keys(shown).length) return moved;
    for (const n of Object.values(output)) {
        for (const [k, val] of Object.entries(n?.inputs || {})) {
            if (!Array.isArray(val) || val.length !== 2 || !Number.isInteger(val[1])) continue;
            const real = shown[String(val[0])]?.[val[1]];
            if (real != null && real >= 0 && real !== val[1]) { n.inputs[k] = [val[0], real]; moved++; }
        }
    }
    return moved;
}
export function installOutputMapping(names) {
    if (Array.isArray(names) && names.length) outNames = names.slice();
    if (app.__rgOutputMapping || typeof app.graphToPrompt !== "function") return;
    app.__rgOutputMapping = true;
    const orig = app.graphToPrompt;
    app.graphToPrompt = async function (...args) {
        const r = await orig.apply(this, args);
        try { mapShownOutputs(r?.output); } catch (e) { console.error("[Region Genie] output mapping failed", e); }
        return r;
    };
}

const CSS = `.rg-socks { position:fixed; z-index:10000; box-sizing:border-box; min-width:230px; max-width:min(320px, calc(100vw - 12px)); max-height:calc(100vh - 12px);
  overflow:auto; padding:6px 8px 8px; border-radius:7px; outline:none; pointer-events:auto; user-select:none;
  font:12.5px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--input-text,#ddd);
  background:var(--comfy-menu-bg,#2b2b2b); border:1px solid var(--border-color,#555); box-shadow:0 6px 22px rgba(0,0,0,.5); }
.rg-socks h4 { margin:6px 0 3px; font-size:11px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; opacity:.7; }
.rg-socks h4:first-child { margin-top:0; }
.rg-socks label { display:flex; align-items:center; gap:7px; padding:2.5px 4px; border-radius:4px; cursor:pointer; white-space:nowrap; }
.rg-socks label:hover { background:color-mix(in srgb, currentColor 10%, transparent); }
.rg-socks label.off { opacity:.55; cursor:default; }
.rg-socks label.off:hover { background:none; }
.rg-socks input { margin:0; flex:0 0 auto; }
.rg-socks .rg-socks-why { margin-left:auto; padding-left:10px; font-size:11px; opacity:.65; }
.rg-socks-acts { display:flex; gap:6px; margin-top:7px; }
.rg-socks-acts button { flex:1 1 0; background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px;
  cursor:pointer; font:inherit; font-size:12px; padding:2px 6px; }`;
let panel = null;                                    // one sockets list at a time, on the whole page

export function* sockets(E) {
    Object.assign(E, { applySockets, syncSockets, toggleSockets, closeSockets, keepBottom, socketState });
    yield;

    const N = E.node, def = E.nodeData || {};
    const OUT = def.output_name || [], OUT_T = def.output || [];
    installOutputMapping(OUT);
    const real = typeof N.addInput === "function" && typeof N.addOutput === "function" && OUT.length > 0;      // (not the tests' stub node)
    const findIn = (name) => (N.inputs || []).findIndex((i) => i.name === name);
    const findOut = (name) => (N.outputs || []).findIndex((o) => o.name === name);
    const linkedIn = (name) => { const i = findIn(name); return i >= 0 && N.inputs[i].link != null; };
    const linkedOut = (name) => { const i = findOut(name); return i >= 0 && !!N.outputs[i].links?.length; };
    // what ComfyUI made of each socket from the node's definition (type, translated name, shape): put back when a
    // socket is shown again
    const proto = { in: {}, out: {} };
    for (const i of N.inputs || []) proto.in[i.name] = { ...i, link: null };
    for (const o of N.outputs || []) proto.out[o.name] = { ...o, links: null };
    const inType = (name) => { const t = (def.input?.optional?.[name] || def.input?.required?.[name])?.[0]; return proto.in[name]?.type ?? (typeof t === "string" ? t : "*"); };
    const dress = (slot, p) => { for (const k of ["localized_name", "label", "shape", "color_on", "color_off", "tooltip"]) if (p?.[k] != null && slot[k] == null) slot[k] = p[k]; };
    function addIn(name) {
        if (findIn(name) >= 0) return;
        N.addInput(name, inType(name));
        dress(N.inputs[N.inputs.length - 1], proto.in[name]);
        E.labelSizeInputs?.();
    }
    function removeIn(name) { const i = findIn(name); if (i >= 0 && N.inputs[i].link == null) N.removeInput(i); }
    function addOut(name) {
        if (findOut(name) >= 0 || !OUT.includes(name)) return;
        N.addOutput(name, OUT_T[OUT.indexOf(name)] ?? "*");
        dress(N.outputs[N.outputs.length - 1], proto.out[name]);
    }
    function removeOut(name) { const i = findOut(name); if (i >= 0 && !N.outputs[i].links?.length) N.removeOutput(i); }

    // ---- the hidden widget that carries the shown outputs into the prompt (read when the prompt is made)
    const shownW = N.widgets?.find((w) => w.name === "outputs_shown");
    const shownText = () => {
        const names = (N.outputs || []).map((o) => o.name);
        return names.length === OUT.length && names.every((n, i) => n === OUT[i]) ? "" : names.join(",");
    };
    if (shownW) {
        shownW.hidden = true; shownW.computeSize = () => [0, -4];
        const el = shownW.element || shownW.inputEl; if (el) el.style.display = "none";
        const i = findIn("outputs_shown"); if (i >= 0) N.removeInput(i);
        shownW.serializeValue = () => (real ? shownText() : "");
    }
    const syncShown = () => { if (shownW && real) shownW.value = shownText(); };

    // ---- the node keeps its bottom edge: the editor keeps its height, the node's top moves
    let quiet = true;                                  // while the node is being made or loaded: sockets change, the node's box doesn't
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    let chainP = Promise.resolve();
    function keepBottom(change) {
        if (quiet || E.big || !N.graph || !E.wrap?.isConnected) { change(); syncShown(); N.setDirtyCanvas?.(true, true); return Promise.resolve(); }
        chainP = chainP.then(async () => {
            const want = E.wrap.offsetHeight, h0 = N.size[1];
            change(); syncShown();
            N.setDirtyCanvas?.(true, true);
            for (let i = 0; i < 10; i++) {
                await frame(); await frame();
                if (!E.wrap.isConnected || E.big) break;
                const d = want - E.wrap.offsetHeight;
                if (Math.abs(d) <= 1) break;
                N.setSize([N.size[0], Math.max(60, Math.round(N.size[1] + d))]); N.setDirtyCanvas?.(true, true);
            }
            const dh = N.size[1] - h0;
            if (dh) { N.pos = [N.pos[0], N.pos[1] - dh]; N.setDirtyCanvas?.(true, true); }
            app.graph?.change?.();
        }).catch((e) => console.error("[Region Genie] sockets", e));
        return chainP;
    }

    // ---- control_image: with a Control row (or while it is connected)
    function syncSockets() {
        if (!real) return;
        const want = (E.controls?.().length || 0) > 0 || linkedIn("control_image");
        const has = findIn("control_image") >= 0;
        if (want && !has) keepBottom(() => addIn("control_image"));
        else if (!want && has) keepBottom(() => removeIn("control_image"));
    }

    // ---- a new node: the short lists
    function newNodeSockets() {
        if (!real) return;
        for (const name of HIDDEN_BY_DEFAULT) removeIn(name);
        for (const name of OUT.slice().reverse()) if (!SAMPLER_OUTS.includes(name)) removeOut(name);
        N.properties = N.properties || {}; N.properties.rg_sockets = 1;
        syncShown();
    }
    // ---- a loaded (or pasted) node: its saved sockets, put right
    function applySockets() {
        if (!real) { remapOutputs(N, OUT, OUT_T); return; }
        quiet = true; setTimeout(() => { quiet = false; }, 0);
        N.properties = N.properties || {};
        const old = !N.properties.rg_sockets;              // saved before round 40: every socket was there
        if (old) remapOutputs(N, OUT, OUT_T);              // all outputs, by name (added or reordered since it was saved)
        else {
            for (let i = (N.outputs || []).length - 1; i >= 0; i--) {         // an output that no longer exists; a doubled one
                const o = N.outputs[i];
                if (!OUT.includes(o.name) || findOut(o.name) !== i) { for (const id of [...(o.links || [])]) { try { N.graph?.removeLink(id); } catch (e) { /* gone */ } } o.links = null; N.removeOutput(i); continue; }
                o.type = OUT_T[OUT.indexOf(o.name)] ?? o.type; dress(o, proto.out[o.name]);
            }
        }
        // size_from_image / size_from_latent -> size_from (an image comes first, as it did)
        if (findIn("size_from") < 0) addIn("size_from");
        for (const name of OLD_SIZE) {
            const i = findIn(name); if (i < 0) continue;
            const id = N.inputs[i].link, j = findIn("size_from");
            if (id != null && j >= 0 && N.inputs[j].link == null) {
                const l = linkOf(N.graph, id);
                if (l) { l.target_slot = j; N.inputs[j].link = id; N.inputs[i].link = null; }
            }
            if (N.inputs[i].link != null) { try { N.disconnectInput(i); } catch (e) { N.inputs[i].link = null; } }      // both were connected: the image's link won
            removeIn(name);
        }
        if (old) {                                          // everything that isn't connected goes, like on a new node
            for (const name of ["import_json", "control_image"]) removeIn(name);
            if (!linkedIn("width_in") && !linkedIn("height_in")) { removeIn("width_in"); removeIn("height_in"); }
            for (const name of OUT.slice().reverse()) if (!SAMPLER_OUTS.includes(name)) removeOut(name);
            N.properties.rg_sockets = 1;
        }
        E.labelSizeInputs?.();
        syncShown();
    }
    // what the sockets list shows: [{ name, label, on, linked, why }]
    function socketState() {
        const lab = (p, name) => p?.label || p?.localized_name || name;
        const size = findIn("width_in") >= 0 || findIn("height_in") >= 0;
        return {
            inputs: [
                { key: "size", label: `${lab(proto.in.width_in, "width")}, ${lab(proto.in.height_in, "height")}`, on: size, linked: linkedIn("width_in") || linkedIn("height_in"),
                  tip: "The width and height inputs: The image size from other nodes, in place of the size row." },
                { key: "import", label: lab(proto.in.import_json, "import_json"), on: findIn("import_json") >= 0, linked: linkedIn("import_json"),
                  tip: "The import_json input: A layout from another node, loaded into the editor when the workflow runs." },
                { key: "control", label: lab(proto.in.control_image, "control_image"), on: findIn("control_image") >= 0, linked: linkedIn("control_image"), auto: true,
                  tip: "The control_image input: It shows while the node has a Control row (＋Control on Whole image)." },
            ],
            outputs: OUT.map((name, i) => ({ key: name, label: lab(proto.out[name], name), on: findOut(name) >= 0, linked: linkedOut(name), tip: def.output_tooltips?.[i] || "" })),
        };
    }
    function setInput(key, on) {
        const names = key === "size" ? ["width_in", "height_in"] : key === "import" ? ["import_json"] : [];
        return keepBottom(() => { for (const n of names) (on ? addIn : removeIn)(n); });
    }
    const setOutputs = (names, on) => keepBottom(() => { for (const n of names) (on ? addOut : removeOut)(n); });

    // ---- the sockets list
    const sockBtn = E.iconBtn("sockets", "Sockets: Choose which inputs and outputs this node shows.\nA connected one always stays.\n"
        + "Changing them moves the node's top; the editor keeps its size and place.", () => toggleSockets(), "toggle");
    sockBtn.classList.add("rg-socks-btn");
    sockBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    E.sizeEl?.append(sockBtn);
    E.sockBtn = sockBtn;
    function closeSockets() { if (panel?.E === E) panel.close(); }
    function toggleSockets() {
        if (panel) { const mine = panel.E === E; panel.close(); if (mine) return; }
        if (!document.getElementById("rg-socks-style")) { const st = document.createElement("style"); st.id = "rg-socks-style"; st.textContent = CSS; document.head.appendChild(st); }
        const box = E.el("div", "rg-socks"); box.tabIndex = -1;
        const row = (it, apply) => {
            const l = E.el("label"), c = E.el("input"), t = E.el("span"); c.type = "checkbox"; c.checked = it.on; t.textContent = it.label;
            const fixed = it.linked || it.auto;
            c.disabled = fixed; if (fixed) l.classList.add("off");
            l.title = it.tip + (it.linked ? "\nConnected: Disconnect it to hide it." : "");
            l.dataset.sock = it.key; l.append(c, t);
            if (it.linked || it.auto) { const w = E.el("span", "rg-socks-why"); w.textContent = it.linked ? "connected" : "with a Control row"; l.append(w); }
            c.addEventListener("change", async () => { await apply(c.checked); render(); place(); });
            return l;
        };
        const head = (text) => { const h = document.createElement("h4"); h.textContent = text; return h; };
        function render() {
            const s = socketState();
            box.replaceChildren(head("Inputs"), ...s.inputs.map((it) => row(it, (on) => setInput(it.key, on))),
                head("Outputs"), ...s.outputs.map((it) => row(it, (on) => setOutputs([it.key], on))));
            const acts = E.el("div", "rg-socks-acts");
            const b = (text, tip, fn) => { const x = document.createElement("button"); x.type = "button"; x.textContent = text; x.title = tip; x.addEventListener("click", async (e) => { e.preventDefault(); await fn(); render(); place(); }); return x; };
            acts.append(b("All outputs", "Show every output.", () => setOutputs(OUT, true)),
                b("Sampler only", "Show model, positive, negative and latent, and whatever else is connected.", () => setOutputs(OUT.filter((n) => !SAMPLER_OUTS.includes(n)), false).then(() => setOutputs(SAMPLER_OUTS, true))));
            box.append(acts);
        }
        // under the button, inside the page (the button moves when the node's top does)
        function place() {
            const r = sockBtn.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
            box.style.left = Math.round(Math.max(6, Math.min(r.right - w, window.innerWidth - w - 6))) + "px";
            box.style.top = Math.round(Math.max(6, Math.min(r.bottom + 6, window.innerHeight - h - 6))) + "px";
        }
        render();
        document.body.appendChild(box); place();
        const stop = (e) => e.stopPropagation();
        for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu", "keydown"]) box.addEventListener(ev, stop);
        box.dataset.captureWheel = "true";
        const outside = (e) => { if (!box.contains(e.target) && !sockBtn.contains(e.target)) close(); };
        const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
        const timer = setInterval(() => { if (!E.wrap.isConnected || !N.graph) close(); }, 300);
        function close() {
            if (panel?.box !== box) return;
            panel = null; clearInterval(timer);
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", key, true);
            box.remove(); sockBtn.classList.remove("on");
            if (E.wrap.isConnected) E.focusSink();
        }
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", key, true);
        panel = { box, E, close };
        sockBtn.classList.add("on");
        box.focus({ preventScroll: true });
    }

    newNodeSockets();
    setTimeout(() => { quiet = false; }, 0);
    // tests: every socket at once (the outputs then come in another order than the Python node's)
    N.__rgShowAll = () => keepBottom(() => { for (const n of ["width_in", "height_in", "import_json", "control_image"]) addIn(n); for (const n of OUT) addOut(n); });
    N.__rgSetOutputs = (names, on) => setOutputs(names, on);
    N.__rgSetInput = (key, on) => setInput(key, on);
    N.__rgSockets = () => ({ inputs: (N.inputs || []).filter((i) => !i.widget).map((i) => i.name), outputs: (N.outputs || []).map((o) => o.name), shown: shownText() });
}
