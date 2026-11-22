// The node's sockets (round 40): fewer of them by default, and a checklist to choose which show.
// One part of the Region Genie node's editor (see parts.js).
//
// Inputs. A new node shows model, clip, vae, image and size_from. size_from takes an image or a latent (it replaces
// the size_from_image and size_from_latent sockets: their links are moved here on load). width / height and
// import_json and pose_keypoint show when ticked in the sockets list; control_image shows while the node has a Control row.
//
// Outputs. The Python node always returns all 14, in a fixed order. The node here shows the ticked ones only, so the
// output numbers in the workflow (0, 1, 2 … of what is shown) are not the Python node's. mapShownOutputs() puts that
// right when ComfyUI turns the graph into a prompt: the hidden widget outputs_shown carries the names of the shown
// outputs into the prompt, every link from this node gets the real number of its output, and the widget is emptied.
// If that step is ever skipped, the Python node sees outputs_shown still set and stops with a message, so a link can
// never deliver another output's data.
//
// A socket that is connected always stays. Changing the sockets keeps the node's bottom edge where it is: the editor
// keeps its height and the node's top moves (the owner's choice).
import { app } from "../../../scripts/app.js";
import { svgIcon, socksStyle } from "../rg_shared.js";
import { linkOf, remapOutputs } from "./graph.js";

const NODE = "Region-Genie_Main";
const SAMPLER_OUTS = ["model", "positive", "negative", "latent"];       // what a new node shows
const OLD_SIZE = ["size_from_image", "size_from_latent"];
const HIDDEN_BY_DEFAULT = [...OLD_SIZE, "width_in", "height_in", "import_json", "pose_keypoint", "control_image"];

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

let panel = null;                                    // one sockets list at a time, on the whole page

export function* sockets(E) {
    Object.assign(E, { applySockets, syncSockets, toggleSockets, closeSockets, keepBottom, socketState, renumberLinks });
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
    // While a node is being loaded, its sockets are taken out of the lists directly: the graph's links are already
    // there with the numbers they were saved with, and removeInput / removeOutput would shift or drop them by number.
    // renumberLinks() gives every link its socket's number once the lists are final.
    let loading = false;
    function removeIn(name) { const i = findIn(name); if (i < 0 || N.inputs[i].link != null) return; if (loading) N.inputs.splice(i, 1); else N.removeInput(i); }
    function renumberLinks() {
        (N.inputs || []).forEach((inp, i) => { const l = inp.link != null ? linkOf(N.graph, inp.link) : null; if (l) l.target_slot = i; });
        (N.outputs || []).forEach((o, i) => { for (const id of o.links || []) { const l = linkOf(N.graph, id); if (l) l.origin_slot = i; } });
    }
    function addOut(name) {
        if (findOut(name) >= 0 || !OUT.includes(name)) return;
        N.addOutput(name, OUT_T[OUT.indexOf(name)] ?? "*");
        dress(N.outputs[N.outputs.length - 1], proto.out[name]);
    }
    function removeOut(name) { const i = findOut(name); if (i < 0 || N.outputs[i].links?.length) return; if (loading) N.outputs.splice(i, 1); else N.removeOutput(i); }

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
        syncShown();
    }
    // The saved node says that its sockets are the chosen ones (a workflow from before round 40 doesn't). The mark is
    // written when the node is saved, not kept on the live node: loading merges the saved properties into the new
    // node's, so a mark made at creation would also be there for an old workflow.
    const onSer = N.onSerialize;
    N.onSerialize = function (o) { const r = onSer?.apply(this, arguments); if (real && o) { o.properties = o.properties || {}; o.properties.rg_sockets = 1; } return r; };
    if (N.properties) delete N.properties.rg_sockets;
    // ---- a node about to be given its saved state (loading, pasting): ComfyUI lays the saved outputs over the node's
    // by number and keeps the node's names, and keeps a saved input only when the node has one of that name. So the
    // node first takes the shape it was saved in: the saved outputs in their order, no optional input that wasn't saved.
    function shapeLikeSaved(saved) {
        const names = (saved.outputs || []).map((o) => o?.name).filter((n) => typeof n === "string");
        loading = true;
        try {
            if (names.join() !== (N.outputs || []).map((o) => o.name).join()) {
                N.outputs.splice(0);
                for (const n of names) { if (OUT.includes(n)) addOut(n); else N.addOutput(n, "*"); }     // (an unknown one keeps its place; applySockets drops it)
            }
            const kept = new Set((saved.inputs || []).map((i) => i?.name));
            for (const name of HIDDEN_BY_DEFAULT) if (!kept.has(name)) removeIn(name);
        } finally { loading = false; }
    }
    const configure0 = N.configure;
    if (real && typeof configure0 === "function") {
        N.configure = function (saved) {
            try { if (saved?.properties?.rg_sockets) shapeLikeSaved(saved); } catch (e) { console.error("[Region Genie] sockets", e); }
            return configure0.apply(this, arguments);
        };
    }
    // ---- a loaded (or pasted) node: its saved sockets, put right
    function applySockets(saved) {
        if (!real) { remapOutputs(N, OUT, OUT_T); return; }
        quiet = true; setTimeout(() => { quiet = false; }, 0);
        const old = !saved?.properties?.rg_sockets;        // saved before round 40: every socket was there
        if (N.properties) delete N.properties.rg_sockets;
        loading = true;
        try { settle(old); } finally { loading = false; }
        renumberLinks();
        E.labelSizeInputs?.();
        syncShown();
    }
    function settle(old) {
        if (old) remapOutputs(N, OUT, OUT_T);              // all outputs, by name (added or reordered since it was saved)
        else {
            for (let i = (N.outputs || []).length - 1; i >= 0; i--) {         // an output that no longer exists; a doubled one
                const o = N.outputs[i];
                if (!OUT.includes(o.name) || findOut(o.name) !== i) { for (const id of [...(o.links || [])]) { try { N.graph?.removeLink(id); } catch (e) { /* gone */ } } o.links = null; N.outputs.splice(i, 1); continue; }
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
            if (N.inputs[i].link != null) { try { N.graph?.removeLink(N.inputs[i].link); } catch (e) { /* gone */ } N.inputs[i].link = null; }      // both were connected: the image's link won
            removeIn(name);
        }
        if (old) {                                          // everything that isn't connected goes, like on a new node
            for (const name of ["import_json", "pose_keypoint", "control_image"]) removeIn(name);
            if (!linkedIn("width_in") && !linkedIn("height_in")) { removeIn("width_in"); removeIn("height_in"); }
            for (const name of OUT.slice().reverse()) if (!SAMPLER_OUTS.includes(name)) removeOut(name);
        }
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
                { key: "pose", label: lab(proto.in.pose_keypoint, "pose_keypoint"), on: findIn("pose_keypoint") >= 0, linked: linkedIn("pose_keypoint"),
                  tip: "The pose_keypoint input: Pose keypoints from another node. Their figures are added to the ones drawn on the canvas." },
                { key: "control", label: lab(proto.in.control_image, "control_image"), on: findIn("control_image") >= 0, linked: linkedIn("control_image"), auto: true,
                  tip: "The control_image input: It shows while the node has a Control row (＋Control on Whole image)." },
            ],
            outputs: OUT.map((name, i) => ({ key: name, label: lab(proto.out[name], name), on: findOut(name) >= 0, linked: linkedOut(name), tip: def.output_tooltips?.[i] || "" })),
        };
    }
    function setInput(key, on) {
        const names = key === "size" ? ["width_in", "height_in"] : key === "import" ? ["import_json"] : key === "pose" ? ["pose_keypoint"] : [];
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
        socksStyle();
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

    // A new node gets its short lists a moment after it is made, not at once: a node that is being loaded (or pasted) is
    // made first and given its saved sockets right after, and ComfyUI only keeps a saved input (and its link) when
    // the new node still has that input. By the time this runs, a loaded node has been through applySockets().
    queueMicrotask(() => { if (!E.configured) newNodeSockets(); });
    setTimeout(() => { quiet = false; }, 0);
    // tests: every socket at once (the outputs then come in another order than the Python node's)
    N.__rgShowAll = () => { const q = quiet; quiet = true; try { keepBottom(() => { for (const n of ["width_in", "height_in", "import_json", "pose_keypoint"]) addIn(n); for (const n of OUT) addOut(n); }); } finally { quiet = q; } };      // (the node stays where it is)
    N.__rgSetOutputs = (names, on) => setOutputs(names, on);
    N.__rgSetInput = (key, on) => setInput(key, on);
    N.__rgSockets = () => ({ inputs: (N.inputs || []).filter((i) => !i.widget).map((i) => i.name), outputs: (N.outputs || []).map((o) => o.name), shown: shownText() });
}
