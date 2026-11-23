// Region Genie: LLM Prompt Enhancer (front end) of the Region Genie node.
// - the preset library, shared by all workflows: <ComfyUI user data>/region_genie/llm_presets.json
// - the LLM Settings pop-up (what the LLM sees, the preset for each region type, the preset editor)
// - the sparkles button used on the region rows and on the Whole image row
// Not an extension by itself.
import { api } from "../../scripts/api.js";
import { svgIcon, pickLora, getSetting, setSetting, SET, fileField, LLM_ROWS, LLM_FILES } from "./rg_shared.js";

export const LLM_TYPES = ["character", "object", "text", "scene"];
const TYPE_LABEL = { character: "Character", object: "Object", text: "Text", scene: "Scene" };
const LIB_FILE = "region_genie/llm_presets.json";
const REGION_PRESET = "Region (default)", SCENE_PRESET = "Scene (default)";
const MTP = ["auto", "off", "2", "3", "4", "5", "tree2s1", "tree2s2", "tree3s1", "tree4s1m8"];

// the same defaults as llm_enhance.py (the server sends its copy; this one is only a fallback)
let BASE = {
    llm: "", llm_type: "auto", loras: [], system_prompt: "", max_length: 8192, sampling: false,
    temperature: 0.7, top_k: 64, top_p: 0.95, min_p: 0.05, repetition_penalty: 1.05, presence_penalty: 0, seed: 0,
    thinking: true, use_default_template: true, mtp: "auto",
};
// used only while sampling is on (Generate Text hides them when its sampling mode is off)
export const SAMPLING_KEYS = ["temperature", "top_k", "top_p", "min_p", "repetition_penalty", "presence_penalty", "seed"];
let REGION_SYS = "", SCENE_SYS = "";

const num = (v, d, lo, hi, int = false) => {
    let x = Number(v);
    if (!Number.isFinite(x)) return d;
    if (int) x = Math.round(x);
    return Math.min(hi, Math.max(lo, x));
};
export function normSettings(s) {
    s = s && typeof s === "object" ? s : {};
    const d = BASE;
    return {
        llm: String(s.llm || ""),
        llm_type: String(s.llm_type || "auto"),
        loras: (Array.isArray(s.loras) ? s.loras : []).filter((x) => x && x.lora)
            .map((x) => ({ lora: String(x.lora), strength: num(x.strength, 1, -100, 100), on: x.on !== false })),
        system_prompt: typeof s.system_prompt === "string" ? s.system_prompt : d.system_prompt,
        max_length: num(s.max_length, d.max_length, 1, 32768, true),
        sampling: s.sampling === undefined ? d.sampling : !!s.sampling,
        temperature: num(s.temperature, d.temperature, 0.01, 2),
        top_k: num(s.top_k, d.top_k, 0, 1000, true),
        top_p: num(s.top_p, d.top_p, 0, 1),
        min_p: num(s.min_p, d.min_p, 0, 1),
        repetition_penalty: num(s.repetition_penalty, d.repetition_penalty, 0, 5),
        presence_penalty: num(s.presence_penalty, d.presence_penalty, 0, 5),
        seed: num(s.seed, 0, 0, Number.MAX_SAFE_INTEGER, true),
        thinking: s.thinking === undefined ? d.thinking : !!s.thinking,
        use_default_template: s.use_default_template !== false,
        mtp: MTP.includes(String(s.mtp)) ? String(s.mtp) : "auto",
    };
}

// ---------------------------------------------------------------- library
let lib = null, libLoading = null;
const listeners = new Set();
export const onLibraryChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
const notify = () => { for (const f of listeners) { try { f(); } catch (e) { console.warn(e); } } };
export const library = () => lib;
function defaultLibrary() {
    return {
        v: LIB_VERSION,
        presets: {
            [REGION_PRESET]: normSettings({ system_prompt: REGION_SYS }),
            [SCENE_PRESET]: normSettings({ system_prompt: SCENE_SYS }),
        },
        defaults: { character: REGION_PRESET, object: REGION_PRESET, text: REGION_PRESET, scene: SCENE_PRESET },
    };
}
function normLibrary(d) {
    const base = defaultLibrary();
    if (!d || typeof d !== "object" || !d.presets || typeof d.presets !== "object") return base;
    const presets = {};
    for (const [k, v] of Object.entries(d.presets)) if (k) presets[k] = normSettings(v);
    if (!Object.keys(presets).length) return base;
    const first = Object.keys(presets)[0];
    const defaults = {};
    for (const t of LLM_TYPES) {
        const n = d.defaults?.[t];
        defaults[t] = presets[n] ? n : (presets[base.defaults[t]] ? base.defaults[t] : first);
    }
    return { v: LIB_VERSION, presets, defaults, migrated: migrate(d, presets) };
}
// library v1 (first release) -> v2: presets still on the first release's Generate Text defaults get the new ones
const LIB_VERSION = 2;
function migrate(d, presets) {
    if ((Number(d.v) || 1) >= 2) return false;
    for (const p of Object.values(presets)) {
        if ((p.max_length === 256 || p.max_length === 320) && p.sampling === true && p.thinking === false) {
            p.max_length = BASE.max_length; p.sampling = BASE.sampling; p.thinking = BASE.thinking;
        }
    }
    return true;                 // saved once with the new version number
}
export function loadLibrary() {
    if (libLoading) return libLoading;
    libLoading = (async () => {
        try {
            const r = await api.fetchApi("/region_genie/llm_defaults");
            if (r.ok) {
                const d = await r.json();
                if (d?.defaults) BASE = { ...BASE, ...d.defaults };
                REGION_SYS = d?.region_system_prompt || REGION_SYS;
                SCENE_SYS = d?.scene_system_prompt || SCENE_SYS;
            }
        } catch (e) { /* older server: built-in fallback */ }
        let data = null;
        try {
            const r = await api.getUserData(LIB_FILE);
            if (r.status === 200) data = await r.json();
        } catch (e) { data = null; }
        lib = normLibrary(data);
        const migrated = lib.migrated;
        delete lib.migrated;
        if (migrated) await saveLibrary();
        notify();
        return lib;
    })();
    return libLoading;
}
export async function saveLibrary() {
    if (!lib) return;
    try { await api.storeUserData(LIB_FILE, lib, { overwrite: true, stringify: true, throwOnError: true }); }
    catch (e) { console.warn("[Region Genie] could not save the LLM presets:", e); }
    notify();
}

// what the node uses: the preset for each type (its own choice, else the library default) as a full copy, so
// the workflow carries the settings it was made with. Returns the new llm block (or the old one, unchanged).
export function resolveNodeLlm(L) {
    L = L && typeof L === "object" ? L : {};
    const assign = L.assign && typeof L.assign === "object" ? L.assign : {};
    const old = L.cfg && typeof L.cfg === "object" ? L.cfg : {};
    const ctx = L.ctxMode === "prompt" || L.ctxMode === "context" ? L.ctxMode : (getSetting(SET.llmContext, "prompt") === "context" ? "context" : "prompt");
    if (!lib) return { ...L, ctx };
    const cfg = {};
    for (const t of LLM_TYPES) {
        const name = assign[t] || lib.defaults[t];
        let s = lib.presets[name];
        if (!s && old[t]?.preset === name && old[t].s) s = normSettings(old[t].s);       // only in this workflow
        if (!s) { const n = lib.defaults[t]; cfg[t] = { preset: n, s: lib.presets[n] }; continue; }
        cfg[t] = { preset: name, s };
    }
    return { ...L, assign, ctx, cfg };
}
export const presetForType = (L, t) => L?.cfg?.[t]?.preset || L?.assign?.[t] || lib?.defaults?.[t] || "";

// ---------------------------------------------------------------- the sparkles button
export const SPARKLE = '<path d="M7 1.8l1.3 3.4 3.4 1.3-3.4 1.3L7 11.2 5.7 7.8 2.3 6.5l3.4-1.3z"/><path d="M12.4 9.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"/>';
export const sparkleSvg = (on) => `<svg viewBox="0 0 16 16" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">${SPARKLE}</svg>`;

export const LLM_CSS = `
.rg-llm-btn { flex:0 0 auto; width:18px; height:18px; padding:0 !important; display:inline-flex; align-items:center; justify-content:center;
  position:relative; opacity:.55; }
.rg-llm-btn svg { width:13px; height:13px; }
.rg-llm-btn.on { opacity:1; color:var(--p-primary-color, #4a9eff); border-color:var(--p-primary-color, #4a9eff) !important; }
.rg-llm-btn.ready::after { content:""; position:absolute; right:1px; bottom:1px; width:5px; height:5px; border-radius:50%;
  background:#4caf50; box-shadow:0 0 0 1px var(--comfy-input-bg, #222); }
.rg-llm-btn.failed::after { content:""; position:absolute; right:1px; bottom:1px; width:5px; height:5px; border-radius:50%; background:#e0a030; }
.rg-llm-pop { position:fixed; z-index:100001; width:400px; max-height:82vh; overflow:auto; box-sizing:border-box; padding:8px 10px 10px;
  background:var(--comfy-menu-bg, #2a2a2a); color:var(--fg-color, #ddd); border:1px solid var(--border-color, #555); border-radius:8px;
  box-shadow:0 6px 24px rgba(0,0,0,.45); font:12px sans-serif; }
.rg-llm-pop h4 { margin:10px 0 4px; font-size:12px; font-weight:600; opacity:.85; }
.rg-llm-pop h4:first-of-type { margin-top:2px; }
.rg-llm-pop .row { display:flex; align-items:center; gap:6px; margin:3px 0; }
.rg-llm-pop .row > .lbl { flex:0 0 112px; opacity:.8; }
.rg-llm-pop select, .rg-llm-pop input[type=text], .rg-llm-pop input[type=number], .rg-llm-pop textarea, .rg-llm-pop button {
  background:var(--comfy-input-bg, #222); color:inherit; border:1px solid var(--border-color, #555); border-radius:4px; font:inherit; padding:2px 5px; }
.rg-llm-pop button { cursor:pointer; padding:2px 8px; }
.rg-llm-pop button:disabled { opacity:.45; cursor:default; }
.rg-llm-pop select { min-width:0; }
.rg-llm-pop .grow { flex:1 1 0; min-width:0; }
.rg-llm-pop textarea { width:100%; box-sizing:border-box; resize:vertical; min-height:70px; }
.rg-llm-pop .grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:3px 10px; }
.rg-llm-pop .grid label { display:flex; align-items:center; justify-content:space-between; gap:6px; }
.rg-llm-pop .grid input[type=number] { width:calc(7ch + 26px); }
.rg-llm-pop .pill { font-size:10px; padding:0 5px; border-radius:8px; background:rgba(255,255,255,.12); white-space:nowrap; }
.rg-llm-pop .pill.node { background:rgba(74,158,255,.3); }
.rg-llm-pop .hint { opacity:.6; font-size:11px; }
.rg-llm-pop .head { display:flex; align-items:center; gap:6px; }
.rg-llm-pop .head b { flex:1; font-size:13px; }
.rg-llm-pop .lora { display:flex; align-items:center; gap:4px; margin:2px 0; }
.rg-llm-pop .lora .name { flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; }
.rg-llm-pop .lora input[type=number] { width:calc(3.6ch + 30px); }
body:has(.rg-llm-pop) .litecontextmenu, body:has(.rg-llm-pop) .litegraph.litecontextmenu.dark { z-index:100002 !important; }
.rg-lset { display:flex; gap:6px; align-items:center; width:360px; max-width:100%; font:inherit; }
.rg-lset.col { flex-direction:column; align-items:stretch; }
.rg-lset select, .rg-lset input[type=text], .rg-lset input[type=number], .rg-lset textarea, .rg-lset button {
  font:inherit; color:var(--input-text,#ddd); background:var(--comfy-input-bg,#2a2a2a); border:1px solid var(--border-color,#4a4a4a);
  border-radius:6px; padding:6px 8px; box-sizing:border-box; }
.rg-lset select, .rg-lset input[type=text], .rg-lset textarea { flex:1 1 auto; min-width:0; width:100%; }
.rg-lset input[type=number] { width:140px; margin-left:auto; }
.rg-lset input:disabled, .rg-lset select:disabled { opacity:.45; }
.rg-lset button { cursor:pointer; flex:0 0 auto; }
.rg-lset button:disabled { opacity:.45; cursor:default; }
.rg-lset textarea { resize:vertical; min-height:90px; font-size:12px; }
.rg-lset .rg-lset-check { margin-left:auto; width:18px; height:18px; }
.rg-lset.col > button { align-self:flex-start; }
.rg-lset-lora { display:flex; gap:6px; align-items:center; margin-top:4px; }
.rg-lset-lora .rg-ff { flex:1 1 auto; width:auto; min-width:0; }
/* never wider than the row's column (a long file name used to push the field past the window's edge): the file
   field and a LoRA row shrink, and the name inside is cut with "…" */
.rg-lset, .rg-lset > *, .rg-lset-loras, .rg-lset-lora { min-width:0; max-width:100%; box-sizing:border-box; }
.rg-lset > .rg-ff { flex:1 1 auto; width:auto; }
.rg-lset .rg-ff-name { flex:1 1 0; min-width:0; padding-right:22px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }      /* (.rg-lset button: flex 0 0 auto, as wide as its text) */
.rg-lset-loras { width:100%; }
.rg-llm-pop .lora .rg-ff, .rg-llm-pop .row > .rg-ff { width:auto; min-width:0; gap:3px; flex:1 1 0; }
.rg-llm-pop .rg-ff-name { padding:2px 20px 2px 5px; border-radius:4px; }
.rg-llm-pop .rg-ff-browse { width:24px; height:22px; border-radius:4px; }
.rg-llm-pop .rg-ff-browse svg { width:14px; height:14px; }
.rg-llm-pop .sep { border-top:1px solid var(--border-color, #555); margin:8px 0 2px; opacity:.6; }
`;
(function injectCss() {
    if (document.getElementById("rg-llm-style")) return;
    const st = document.createElement("style"); st.id = "rg-llm-style"; st.textContent = LLM_CSS;
    document.head.appendChild(st);
})();

// ---------------------------------------------------------------- shared by the pop-up and Settings
const CLIP_LABEL = "The connected clip (MOSS-Image: Qwen3.5 9B; Krea 2 / Ideogram 4: Qwen3-VL)";
const LLM_TIP = "The connected clip is used as it is (no extra memory). A file from ComfyUI's text_encoders folders (or anywhere "
    + "with 'Browse… for model files' on in Settings > Region Genie) is loaded once and kept while in use.\n"
    + "Click to choose it in ComfyUI's menu.";
// an LLM LoRA's file: ComfyUI's menu of models/loras (Browse… beside it with the Settings switch on)
function loraPicker(value, onPick) {
    const p = fileField({ roots: ["loras"], none: "", noneLabel: false, emptyLabel: "(choose a LoRA)", value, onPick, title: "An LLM LoRA" });
    p.classList.add("name");
    return p;
}
const llmField = (value, onPick) => fileField({ roots: ["text_encoders"], none: "", noneLabel: CLIP_LABEL, value, onPick, title: "The LLM" });

// ---------------------------------------------------------------- LLM Settings pop-up
let openPop = null;
export const inLlmSettings = (t) => !!t?.closest?.(".rg-llm-pop");
export function closeLlmSettings() { openPop?.close(); }

let typeList = null;
async function llmTypes() {
    if (typeList) return typeList;
    try {
        const r = await api.fetchApi("/object_info/CLIPLoader");
        const d = r.ok ? await r.json() : null;
        typeList = d?.CLIPLoader?.input?.required?.type?.[0] || [];
    } catch (e) { typeList = []; }
    return typeList;
}

// host: { getLlm(): llm block of the node, setLlm(fn(L)), regionTypesInUse(): Set }
export async function openLlmSettings(anchor, host) {
    closeLlmSettings();
    await loadLibrary();
    const types = await llmTypes();
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const opt = (v, t) => { const o = mk("option"); o.value = v; o.textContent = t; return o; };
    const pop = mk("div", "rg-llm-pop");
    for (const ev of ["keydown", "keyup", "keypress", "wheel", "pointerdown", "mousedown", "dblclick", "contextmenu"]) pop.addEventListener(ev, (e) => e.stopPropagation());

    let editName = null, draft = null, dirty = false;
    const workflowOnly = () => {             // presets this node carries that this library doesn't have
        const L = host.getLlm(); const out = {};
        for (const t of LLM_TYPES) { const c = L?.cfg?.[t]; if (c?.preset && !lib.presets[c.preset]) out[c.preset] = normSettings(c.s); }
        return out;
    };
    const allNames = () => [...Object.keys(lib.presets), ...Object.keys(workflowOnly()).filter((n) => !lib.presets[n])];
    const settingsOf = (n) => lib.presets[n] || workflowOnly()[n] || null;

    function render() {
        const L = host.getLlm() || {};
        pop.textContent = "";
        const head = mk("div", "head"); const title = mk("b", null, "LLM Prompt Enhancer");
        const x = mk("button", "rg-ib"); x.innerHTML = svgIcon("close"); x.title = "Close (Esc)"; x.addEventListener("click", close);
        head.append(title, x); pop.append(head);

        // what the LLM sees
        pop.append(mk("h4", null, "What the LLM sees"));
        const ctxRow = mk("div", "row");
        const ctxSel = mk("select", "grow");
        const gdef = getSetting(SET.llmContext, "prompt") === "context" ? "prompt + context" : "only the prompt";
        ctxSel.append(opt("", `Settings default (${gdef})`), opt("prompt", "Only the prompt"), opt("context", "The prompt + the scene and the other regions"));
        ctxSel.value = L.ctxMode === "prompt" || L.ctxMode === "context" ? L.ctxMode : "";
        ctxSel.title = "With context, the LLM also gets scene_prompt_positive and the other regions' prompts (to keep them "
            + "consistent), but rewrites only the one prompt. The default is in Settings > Region Genie > LLM Prompt Enhancer.";
        ctxSel.addEventListener("change", () => host.setLlm((l) => { if (ctxSel.value) l.ctxMode = ctxSel.value; else delete l.ctxMode; }));
        ctxRow.append(ctxSel); pop.append(ctxRow);

        // preset for each type
        pop.append(mk("h4", null, "Preset for each prompt type"));
        const used = host.regionTypesInUse();
        for (const t of LLM_TYPES) {
            const row = mk("div", "row");
            const lbl = mk("span", "lbl", TYPE_LABEL[t]);
            if (used.has(t)) lbl.style.fontWeight = "600";
            const sel = mk("select", "grow");
            const wf = workflowOnly();
            for (const n of allNames()) sel.append(opt(n, wf[n] && !lib.presets[n] ? `${n} (from this workflow)` : n));
            const current = presetForType(L, t);
            sel.value = current;
            sel.title = `Preset used for ${TYPE_LABEL[t].toLowerCase()} prompts in this node`;
            sel.addEventListener("change", () => {
                host.setLlm((l) => { l.assign = { ...(l.assign || {}) }; if (sel.value === lib.defaults[t]) delete l.assign[t]; else l.assign[t] = sel.value; });
                edit(sel.value);
            });
            const own = !!L.assign?.[t] && L.assign[t] !== lib.defaults[t];
            const pill = mk("span", "pill" + (own ? " node" : ""), own ? "this node" : "default");
            pill.title = own ? `Only this node uses '${current}' for ${t} prompts; the default is '${lib.defaults[t]}'.`
                : "The default for all Region Genie nodes (that haven't chosen their own)";
            row.append(lbl, sel, pill);
            if (own) {
                const mkDef = mk("button", null, "Make default");
                mkDef.title = `Use '${current}' for ${t} prompts in all nodes that haven't chosen their own preset (saved in your user data)`;
                mkDef.addEventListener("click", async () => {
                    lib.defaults[t] = current;
                    host.setLlm((l) => { l.assign = { ...(l.assign || {}) }; delete l.assign[t]; });
                    await saveLibrary(); render();
                });
                const reset = mk("button", "rg-ib"); reset.innerHTML = svgIcon("reset");
                reset.title = `Back to the default ('${lib.defaults[t]}')`;
                reset.addEventListener("click", () => { host.setLlm((l) => { l.assign = { ...(l.assign || {}) }; delete l.assign[t]; }); render(); });
                row.append(mkDef, reset);
            }
            pop.append(row);
        }
        pop.append(mk("div", "hint", "Choosing a preset here changes this node only. 'Make default' applies it to every node that hasn't chosen its own."));

        // preset editor
        pop.append(mk("div", "sep"));
        pop.append(mk("h4", null, "Edit preset (shared by all your workflows)"));
        if (!editName || !settingsOf(editName)) edit(presetForType(L, [...used][0] || "object"), true);
        const pickRow = mk("div", "row");
        const pickSel = mk("select", "grow");
        for (const n of allNames()) pickSel.append(opt(n, n));
        pickSel.value = editName;
        pickSel.addEventListener("change", () => { edit(pickSel.value); });
        const newB = mk("button", null, "New");
        newB.title = "A new preset, starting from the one shown";
        newB.addEventListener("click", () => {
            let i = 2, n = `${editName} ${i}`;
            while (settingsOf(n)) n = `${editName} ${++i}`;
            lib.presets[n] = normSettings(draft); editName = n; dirty = false;
            saveLibrary(); render();
        });
        const delB = mk("button", null, "Delete");
        const inUseBy = LLM_TYPES.filter((t) => lib.defaults[t] === editName);
        delB.disabled = !lib.presets[editName] || Object.keys(lib.presets).length < 2 || inUseBy.length > 0;
        delB.title = inUseBy.length ? `The default for ${inUseBy.join(", ")}. Choose another default first.`
            : !lib.presets[editName] ? "Only in this workflow: Nothing to delete in your library."
            : Object.keys(lib.presets).length < 2 ? "The only preset: It can't be deleted."
            : "Delete this preset from your library (click twice).";
        delB.addEventListener("click", () => {
            if (delB.dataset.armed !== "1") { delB.dataset.armed = "1"; delB.textContent = "Delete?"; return; }
            delete lib.presets[editName];
            editName = null; saveLibrary(); render();
        });
        pickRow.append(pickSel, newB, delB); pop.append(pickRow);

        const nameRow = mk("div", "row");
        const nameIn = mk("input", "grow"); nameIn.type = "text"; nameIn.value = editName;
        nameIn.title = "Preset name: Change it and Save to rename";
        nameRow.append(mk("span", "lbl", "Name"), nameIn); pop.append(nameRow);

        const field = (label, input, title) => {
            const r = mk("div", "row"); const l = mk("span", "lbl", label); if (title) { l.title = title; input.title = title; }
            r.append(l, input); pop.append(r); return r;
        };
        const touch = () => { dirty = true; saveBtn.textContent = "Save*"; saveBtn.disabled = false; };

        // round 23: ComfyUI's menu of models/text_encoders (Browse… beside it with the Settings switch on)
        const llmPick = llmField(draft.llm, (v) => { draft.llm = v; typeRow.style.display = draft.llm ? "" : "none"; touch(); });
        llmPick.classList.add("grow");
        field("LLM", llmPick, LLM_TIP);
        const typeSel = mk("select", "grow");
        typeSel.append(opt("auto", "auto (detect)"));
        for (const t of types) if (t !== "stable_diffusion") typeSel.append(opt(t, t));
        typeSel.value = draft.llm_type || "auto";
        const typeRow = field("LLM type", typeSel, "As the 'type' of Load CLIP. auto works for plain Qwen3 / Qwen3.5 / Gemma files.");
        typeRow.style.display = draft.llm ? "" : "none";
        typeSel.addEventListener("change", () => { draft.llm_type = typeSel.value; touch(); });

        // LLM-only LoRAs
        const lh = mk("div", "row"); lh.append(mk("span", "lbl", "LLM LoRAs"));
        const addL = mk("button", null, "＋LoRA"); addL.title = "A LoRA applied to the LLM only (like Load LoRA (Text Encoder)); the image model and the clip used for conditioning are not changed";
        addL.addEventListener("click", (e) => pickLora(e, (name) => { draft.loras.push({ lora: name, strength: 1, on: true }); touch(); renderLoras(); }));
        lh.append(addL); pop.append(lh);
        const lbox = mk("div"); pop.append(lbox);
        function renderLoras() {
            lbox.textContent = "";
            draft.loras.forEach((x, i) => {
                const r = mk("div", "lora");
                const on = mk("input"); on.type = "checkbox"; on.checked = x.on !== false; on.title = "On / off";
                on.addEventListener("change", () => { x.on = on.checked; touch(); });
                const nm = loraPicker(x.lora, (name) => { x.lora = name; touch(); });
                const st = mk("input"); st.type = "number"; st.step = "0.05"; st.min = "-100"; st.max = "100"; st.value = String(x.strength); st.title = "Strength";
                st.addEventListener("change", () => { const v = +st.value; if (Number.isFinite(v)) { x.strength = v; touch(); } });
                const del = mk("button", "rg-ib"); del.innerHTML = svgIcon("close"); del.title = "Remove";
                del.addEventListener("click", () => { draft.loras.splice(i, 1); touch(); renderLoras(); });
                r.append(on, nm, st, del); lbox.append(r);
            });
        }
        renderLoras();

        pop.append(mk("h4", null, "System prompt"));
        const sys = mk("textarea"); sys.rows = 5; sys.value = draft.system_prompt; sys.spellcheck = false;
        sys.title = "Sent as the system prompt (Generate Text's system_prompt). Ignored when 'default template' is off.";
        sys.addEventListener("input", () => { draft.system_prompt = sys.value; touch(); });
        pop.append(sys);

        pop.append(mk("h4", null, "Generate Text settings"));
        const grid = mk("div", "grid");
        const numIn = (key, label, step, min, max, title) => {
            const l = mk("label"); l.title = title || "";
            const i = mk("input"); i.type = "number"; i.step = String(step); i.min = String(min); i.max = String(max); i.value = String(draft[key]);
            i.addEventListener("change", () => { const v = Number(i.value); if (Number.isFinite(v)) { draft[key] = v; touch(); } });
            l.append(mk("span", null, label), i); grid.append(l); i.__label = l; return i;
        };
        const chk = (key, label, title) => {
            const l = mk("label"); l.title = title || "";
            const i = mk("input"); i.type = "checkbox"; i.checked = !!draft[key];
            i.addEventListener("change", () => { draft[key] = i.checked; touch(); syncSampling(); });
            l.append(mk("span", null, label), i); grid.append(l); return i;
        };
        numIn("max_length", "max_length", 1, 1, 32768, "Most tokens the LLM writes");
        chk("sampling", "sampling", "On: Sampling with the settings below.\nOff (default): Greedy decoding, always the same text for the same input; temperature, top_k, top_p, min_p, the penalties and the seed are not used (hidden, as in Generate Text).");
        const sampled = [
            numIn("temperature", "temperature", 0.05, 0.01, 2),
            numIn("top_k", "top_k", 1, 0, 1000),
            numIn("top_p", "top_p", 0.01, 0, 1),
            numIn("min_p", "min_p", 0.01, 0, 1),
            numIn("repetition_penalty", "repetition_penalty", 0.01, 0, 5),
            numIn("presence_penalty", "presence_penalty", 0.01, 0, 5),
            numIn("seed", "seed", 1, 0, Number.MAX_SAFE_INTEGER, "Seed (a region's right-click 'Run again with a new seed' adds to it for that region)"),
        ];
        // as Generate Text: with sampling off these are hidden and not used (greedy decoding, no seed)
        function syncSampling() { for (const i of sampled) i.__label.style.display = draft.sampling ? "" : "none"; }
        syncSampling();
        chk("thinking", "thinking", "Thinking mode, if the model supports it (the reasoning is shown in the tooltip of the LLM button, the one with the sparkles icon; it is not used)");
        chk("use_default_template", "default template", "Use the model's built-in chat template (needed for the system prompt)");
        const mtpL = mk("label"); mtpL.title = "Speculative decoding with the model's multi-token-prediction head (no effect without MTP weights)";
        const mtpSel = mk("select"); for (const m of MTP) mtpSel.append(opt(m, m)); mtpSel.value = draft.mtp;
        mtpSel.addEventListener("change", () => { draft.mtp = mtpSel.value; touch(); });
        mtpL.append(mk("span", null, "mtp"), mtpSel); grid.append(mtpL);
        pop.append(grid);

        const foot = mk("div", "row"); foot.style.marginTop = "8px";
        const saveBtn = mk("button", null, dirty ? "Save*" : "Save");
        saveBtn.disabled = !dirty && !!lib.presets[editName];
        saveBtn.title = "Save this preset to your library (all workflows and nodes using it get the new settings)";
        saveBtn.addEventListener("click", async () => {
            const newName = nameIn.value.trim() || editName;
            const renamed = newName !== editName && lib.presets[editName];
            lib.presets[newName] = normSettings(draft);
            if (renamed) {
                delete lib.presets[editName];
                for (const t of LLM_TYPES) if (lib.defaults[t] === editName) lib.defaults[t] = newName;
                host.renamePreset?.(editName, newName);
            }
            editName = newName; dirty = false;
            await saveLibrary(); render();
        });
        const revert = mk("button", null, "Revert"); revert.disabled = !dirty;
        revert.addEventListener("click", () => { dirty = false; edit(editName, true); render(); });
        const note = mk("span", "hint grow", lib.presets[editName] ? "" : "Only in this workflow: Save adds it to your library.");
        foot.append(note, revert, saveBtn); pop.append(foot);
        place();
    }
    function edit(name, quiet) {
        editName = name;
        draft = normSettings(settingsOf(name) || {});
        dirty = false;
        if (!quiet) render();
    }
    function place() {
        const r = anchor.getBoundingClientRect();
        const w = pop.offsetWidth || 400, h = pop.offsetHeight || 500;
        let left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left));
        let top = r.top - h - 6;
        if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 6);
        pop.style.left = `${left}px`; pop.style.top = `${Math.max(8, top)}px`;
    }
    // (the folder browser opened from here, Browse…, is not "outside")
    const inBrowser = (e) => !!e.target?.closest?.(".rg-fb-back") || !!document.querySelector(".rg-fb-back[open]");
    const outside = (e) => {
        if (pop.contains(e.target) || e.target.closest?.(".litecontextmenu") || anchor.contains(e.target) || inBrowser(e)) return;
        close();
    };
    const esc = (e) => { if (e.key === "Escape" && !inBrowser(e)) { e.preventDefault(); e.stopPropagation(); close(); } };
    const offLib = onLibraryChange(() => { if (!dirty) render(); });
    function close() {
        window.removeEventListener("pointerdown", outside, true);
        window.removeEventListener("keydown", esc, true);
        offLib(); pop.remove();
        if (openPop?.pop === pop) openPop = null;
    }
    document.body.append(pop);
    render();
    setTimeout(() => window.addEventListener("pointerdown", outside, true), 0);
    window.addEventListener("keydown", esc, true);
    openPop = { pop, close, rerender: () => { if (!dirty) render(); } };
    return openPop;
}
export const rerenderLlmSettings = () => openPop?.rerender();

// ---------------------------------------------------------------- the presets in ComfyUI's Settings (round 19)
// Settings > Region Genie > LLM Prompt Enhancer: one row per field (rg_shared.js LLM_FIELDS), each our own element.
// They read and write the same library as the pop-up and save at once; the rows follow each other (and the pop-up)
// through onLibraryChange and the 'Preset to edit' choice.
const rowRefreshers = new Set();
// all: Another preset is being edited now (the 'Preset to edit' choice, New, Delete, a new name), so every row shows
// that one, also the row the keyboard focus is in. Without it a row being typed in is left alone: the same preset,
// only saved or changed elsewhere. (Round 71: with the focus still in the system prompt box, as after a click on
// the dropdown in Firefox on Windows, that box kept the previous preset's text. What was typed is in the library
// already: each field writes at every keystroke.)
function refreshRows(except, all = false) {
    for (const f of [...rowRefreshers]) {
        if (!f.box.isConnected) { rowRefreshers.delete(f); continue; }
        const ae = document.activeElement;
        if (f.box === except || (!all && f.box.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.type !== "checkbox")) continue;
        f();
    }
}
onLibraryChange(() => refreshRows());
const editTarget = () => {
    const n = getSetting(SET.llmEdit, "");
    return lib && lib.presets[n] ? n : lib ? (lib.defaults.object || Object.keys(lib.presets)[0]) : "";
};
let saveTimer = 0;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveLibrary(), 500); };
const RS = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ROPT = (v, t) => { const o = RS("option"); o.value = v; o.textContent = t; return o; };

function renderRow(key) {
    const box = RS("div", "rg-lset");
    for (const ev of ["keydown", "keyup", "keypress", "pointerdown", "mousedown"]) box.addEventListener(ev, (e) => e.stopPropagation());
    const draw = () => {
        box.replaceChildren();
        if (!lib) { box.append(RS("span", "hint", "Loading…")); loadLibrary().then(draw); return; }
        build(key, box);
    };
    draw.box = box;
    rowRefreshers.add(draw);
    draw();
    return box;
}
function build(key, box) {
    const names = Object.keys(lib.presets);
    if (key.startsWith("default.")) {
        const t = key.slice(8), sel = RS("select");
        for (const n of names) sel.append(ROPT(n, n));
        sel.value = lib.defaults[t];
        sel.addEventListener("change", async () => { lib.defaults[t] = sel.value; await saveLibrary(); refreshRows(box); });
        box.append(sel);
        return;
    }
    const name = editTarget();
    if (key === "edit") {
        const sel = RS("select");
        for (const n of names) sel.append(ROPT(n, n));
        sel.value = name;
        sel.addEventListener("change", async () => { await setSetting(SET.llmEdit, sel.value); refreshRows(box, true); });
        const newB = RS("button", "", "New"); newB.title = "A copy of this preset under a new name";
        newB.addEventListener("click", async () => {
            let i = 2, n = `${name} ${i}`;
            while (lib.presets[n]) n = `${name} ${++i}`;
            lib.presets[n] = normSettings(lib.presets[name]);
            await setSetting(SET.llmEdit, n); await saveLibrary(); refreshRows(null, true);
        });
        const inUse = LLM_TYPES.filter((t) => lib.defaults[t] === name);
        const del = RS("button", "", "Delete");
        del.disabled = names.length < 2 || inUse.length > 0;
        del.title = inUse.length ? `The default for ${inUse.join(", ")}: Choose another default first.` : "Delete this preset (click twice)";
        del.addEventListener("click", async () => {
            if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Delete?"; return; }
            delete lib.presets[name];
            await setSetting(SET.llmEdit, ""); await saveLibrary(); refreshRows(null, true);
        });
        box.append(sel, newB, del);
        return;
    }
    const f = key.slice(6), p = lib.presets[name];
    if (!p) return;
    const set = (v, now) => { p[f] = v; if (now) saveLibrary(); else saveSoon(); };
    if (f === "name") {
        const i = RS("input"); i.type = "text"; i.value = name;
        const commit = async () => {
            const n = i.value.trim();
            if (!n || n === name || lib.presets[n]) { i.value = name; return; }
            lib.presets[n] = p; delete lib.presets[name];
            for (const t of LLM_TYPES) if (lib.defaults[t] === name) lib.defaults[t] = n;
            await setSetting(SET.llmEdit, n); await saveLibrary(); refreshRows();
        };
        i.addEventListener("keydown", (e) => { if (e.key === "Enter") i.blur(); });
        i.addEventListener("change", commit);
        box.append(i);
    } else if (f === "llm") {
        box.append(llmField(p.llm, (v) => { p.llm = v; saveLibrary(); refreshRows(box); }));
    } else if (f === "llm_type") {
        const sel = RS("select"); sel.append(ROPT("auto", "auto (detect)"));
        sel.disabled = !p.llm; sel.title = p.llm ? "" : "Only for an LLM file (set in the row above)";
        llmTypes().then((types) => {
            for (const t of types) if (t !== "stable_diffusion") sel.append(ROPT(t, t));
            sel.value = p.llm_type || "auto";
        });
        sel.addEventListener("change", () => set(sel.value, true));
        box.append(sel);
    } else if (f === "loras") {
        const list = RS("div", "rg-lset-loras");
        const add = RS("button", "", "＋LoRA"); add.title = "Add an LLM LoRA (choose its file in the new row)";
        add.addEventListener("click", () => { p.loras.push({ lora: "", strength: 1, on: true }); drawLoras(); });
        function drawLoras() {
            list.replaceChildren();
            p.loras.forEach((x, i) => {
                const r = RS("div", "rg-lset-lora");
                const on = RS("input"); on.type = "checkbox"; on.checked = x.on !== false; on.title = "On / off";
                on.addEventListener("change", () => { x.on = on.checked; saveLibrary(); });
                const pick = loraPicker(x.lora, (v) => { x.lora = v; saveLibrary(); });
                const st = RS("input"); st.type = "number"; st.step = "0.05"; st.min = "-100"; st.max = "100"; st.value = String(x.strength); st.title = "Strength";
                st.addEventListener("change", () => { const v = +st.value; if (Number.isFinite(v)) { x.strength = v; saveLibrary(); } });
                const rm = RS("button", "rg-ib"); rm.innerHTML = svgIcon("close"); rm.title = "Remove";
                rm.addEventListener("click", () => { p.loras.splice(i, 1); saveLibrary(); drawLoras(); });
                r.append(on, pick, st, rm); list.append(r);
            });
        }
        drawLoras();
        box.classList.add("col");
        box.append(add, list);
    } else if (f === "system_prompt") {
        const ta = RS("textarea"); ta.rows = 6; ta.spellcheck = false; ta.value = p.system_prompt;
        ta.addEventListener("input", () => set(ta.value));
        box.append(ta);
    } else if (f === "mtp") {
        const sel = RS("select"); for (const m of MTP) sel.append(ROPT(m, m)); sel.value = p.mtp;
        sel.addEventListener("change", () => set(sel.value, true));
        box.append(sel);
    } else if (["sampling", "thinking", "use_default_template"].includes(f)) {
        const c = RS("input"); c.type = "checkbox"; c.className = "rg-lset-check"; c.checked = !!p[f];
        c.addEventListener("change", async () => { p[f] = c.checked; await saveLibrary(); if (f === "sampling") refreshRows(box); });
        box.append(c);
    } else {
        const lim = { max_length: [1, 1, 32768], temperature: [0.05, 0.01, 2], top_k: [1, 0, 1000], top_p: [0.01, 0, 1], min_p: [0.01, 0, 1],
                      repetition_penalty: [0.01, 0, 5], presence_penalty: [0.01, 0, 5], seed: [1, 0, Number.MAX_SAFE_INTEGER] }[f];
        if (!lim) return;
        const i = RS("input"); i.type = "number"; i.step = String(lim[0]); i.min = String(lim[1]); i.max = String(lim[2]); i.value = String(p[f]);
        const sampled = SAMPLING_KEYS.includes(f);
        i.disabled = sampled && !p.sampling;
        if (i.disabled) i.title = "Used only while the preset's sampling is on";
        i.addEventListener("change", () => {
            let v = Number(i.value);
            if (!Number.isFinite(v)) { i.value = String(p[f]); return; }
            v = Math.min(lim[2], Math.max(lim[1], v)); if (lim[0] >= 1) v = Math.round(v);
            i.value = String(v); set(v, true);
        });
        box.append(i);
    }
}
LLM_ROWS.render = renderRow;
// for Settings > Region Genie > Check model files: the files the LLM presets use
LLM_FILES.list = () => {
    const out = [];
    for (const [name, s] of Object.entries(lib?.presets || {})) {
        if (s.llm) out.push({ what: `LLM preset '${name}' > LLM`, value: s.llm, roots: ["text_encoders"], home: "text_encoders" });
        for (const l of s.loras || []) if (l.lora) out.push({ what: `LLM preset '${name}' > LoRA`, value: l.lora, roots: ["loras"], home: "loras" });
    }
    return out;
};
