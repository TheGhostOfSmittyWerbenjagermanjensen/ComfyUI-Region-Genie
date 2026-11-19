import { app } from "../../scripts/app.js";
import { getLoras, knownLoras, pickLora, fillTriggerChips, CHIP_CSS, keepWidgetValuesByName, appendWord,
         autocompleteOnFocus, autocompleteOpen, autocompleteWidgets, autocompleteToggle, getSetting, SET,
         wildcardSeedControl, WC_CSS, addExpandButton, openFloatPopup, FPOP_CSS } from "./rg_shared.js";

// Editor of the "Regional LoRAs" node: one row per LoRA (on, mask index, LoRA, strength, words for
// that region's caption with the LoRA's trigger words as chips), stored as JSON in the hidden "loras_data" widget.
// When the masks come from the Region Genie node, each row shows the region its index points to.
const NODE_NAMES = ["Region-Genie_RegionalLoRAs"];
const DATA = "loras_data";

const CSS = `
.rg-rl-wrap { display:flex; flex-direction:column; gap:4px; font:12px sans-serif; color:var(--input-text,#ddd);
  box-sizing:border-box; padding:2px 0; width:100%; }
.rg-rl-head { display:flex; align-items:center; gap:6px; }
.rg-rl-btn { background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px;
  padding:2px 8px; cursor:pointer; font:inherit; white-space:nowrap; }
.rg-rl-btn:hover { filter:brightness(1.25); }
.rg-rl-btn.sm { padding:0 5px; min-width:20px; }
.rg-rl-btn:disabled { opacity:.4; cursor:default; }
.rg-rl-hint { opacity:.6; font-size:11px; }
.rg-rl-row { display:flex; flex-direction:column; gap:3px; padding:4px; border:1px solid var(--border-color,#444); border-radius:5px;
  background:rgba(0,0,0,.15); }
.rg-rl-row.off { opacity:.5; }
.rg-rl-line { display:flex; align-items:center; gap:4px; min-width:0; }
.rg-rl-line > * { flex:0 0 auto; }
.rg-rl-wrap select, .rg-rl-wrap input { background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555);
  border-radius:4px; font:inherit; padding:1px 4px; box-sizing:border-box; }
.rg-rl-idx { width:46px; }
.rg-rl-pick { flex:1 1 0 !important; width:0; min-width:0; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px; padding:1px 18px 1px 6px;
  font:inherit; cursor:pointer; position:relative; }
.rg-rl-pick::after { content:"▾"; position:absolute; right:5px; top:50%; transform:translateY(-50%); opacity:.7; }
.rg-rl-pick.missing { color:#e88; }
.rg-rl-str { width:max(62px, calc(3.6ch + 28px)); }
.rg-rl-sw { width:12px; height:12px; border-radius:2px; border:1px solid #000; flex:0 0 auto; }
.rg-rl-region { flex:1 1 0 !important; width:0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.85; }
.rg-rl-region.bad { color:#e88; opacity:1; }
.rg-rl-line .rg-pwrap { position:relative; display:flex; flex:1 1 0; min-width:0; }
.rg-rl-prompt { flex:1 1 0 !important; width:0; min-width:0; box-sizing:border-box; resize:none; background:var(--comfy-input-bg,#222);
  color:inherit; border:1px solid var(--border-color,#555); border-radius:4px; font-family:inherit; font-size:var(--rg-rl-fs,12px);
  padding:1px 18px 1px 4px; height:calc(var(--rg-rl-lh,16px) + 4px); line-height:var(--rg-rl-lh,16px); overflow:hidden; white-space:nowrap;
  text-overflow:ellipsis; }
.rg-rl-prompt:focus { height:calc(var(--rg-rl-lh,16px) * 4); white-space:pre-wrap; overflow-y:auto; scrollbar-width:thin; outline:none; border-color:#5b8fd0; }
.rg-rl-trig { display:flex; flex-wrap:wrap; gap:3px; align-items:center; font-size:10px; min-height:0; }
.rg-rl-trig:empty { display:none; }
`;

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

app.registerExtension({
    name: "RegionGenie.RegionalLoRAs",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!NODE_NAMES.includes(nodeData.name)) return;
        if (!document.getElementById("rg-rl-style")) {
            const s = document.createElement("style"); s.id = "rg-rl-style"; s.textContent = CSS + CHIP_CSS + WC_CSS + FPOP_CSS; document.head.appendChild(s);
        }
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onCreated?.apply(this, arguments);
            setup(this);
            return r;
        };
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            if (typeof message?.mask_count?.[0] === "number") { this.__rgrlMaskCount = message.mask_count[0]; this.__rgrlRefresh?.(); }
            if (Array.isArray(message?.wildcards)) {
                let f = {};
                try { f = JSON.parse(message.wildcards[0] || "{}") || {}; } catch (e) { /* ignore */ }
                this.__rgrlFilled?.(f);
            }
        };
    },
});

function setup(node) {
    keepWidgetValuesByName(node, ["positive_prompt", "negative_prompt", "feather", "lora_masking", "region_separation", "separation_until",
                                  "separate_all_regions", "share_background", "wildcard_seed"]);
    // wildcards (Impact Pack): what each field became in the last run (or a preview)
    let wcFilled = {};
    const filledFor = (key, raw) => { const f = wcFilled[key]; return f && f.raw === (raw ?? "") && f.filled !== f.raw ? f.filled : null; };
    const widgetTA = {};                                      // positive_prompt / negative_prompt -> textarea
    const WKEY = { positive_prompt: "prompt", negative_prompt: "negative" };   // -> the wildcard field keys of the run
    const wcMark = (t, key, raw) => {
        if (!t) return;
        if (t.dataset.baseTitle == null) t.dataset.baseTitle = t.title || "";
        const f = filledFor(key, raw), b = t.dataset.baseTitle;
        const title = (b ? b + "\n" : "") + (f != null ? `Wildcards filled in (last run or preview):\n${f}` : "");
        if (t.title !== title) t.title = title;
        t.style.boxShadow = f != null ? "inset 3px 0 0 -1px #c9a14a" : "";
    };
    // the text fields' expand button: the floating pop-up editor (bigger, A− / A+, drag, resize, wildcards)
    const setW = (name, v) => {
        const w = node.widgets?.find((x) => x.name === name);
        if (!w) return;
        w.value = v;
        try { w.callback?.(v); } catch (e) { /* ignore */ }
        if (widgetTA[name] && widgetTA[name].value !== v) widgetTA[name].value = v;
        wcMark(widgetTA[name], WKEY[name], v);
        node.setDirtyCanvas?.(true, true);
    };
    autocompleteWidgets(node, ["positive_prompt", "negative_prompt"], (name, t) => {
        t.dataset.rgField = name;                       // which field this text box is (tests/real_layering.cjs finds it by this)
        if (!WKEY[name]) return;
        widgetTA[name] = t;
        t.addEventListener("input", () => wcMark(t, WKEY[name], t.value));
        addExpandButton(t, "Open in the pop-up editor", () => openField("w:" + name));
    });
    // the pop-up editor for a text field ("w:<widget name>" or "row:<i>"); ◀ / ▶ step through all of them in order
    // (positive_prompt, negative_prompt, then each row's words), keeping the pop-up's place and size
    const NAV_WHAT = "positive_prompt, negative_prompt, then each row's words";
    const rowOpen = [];                      // row i -> (at) => opens its pop-up (made by render)
    const popKeys = () => ["w:positive_prompt", "w:negative_prompt", ...rows.map((_, i) => "row:" + i)];
    function openField(key, at) {
        const nav = (dir, geom) => {
            const keys = popKeys(), i = keys.indexOf(key);
            openField(keys[((i < 0 ? 0 : i) + dir + keys.length) % keys.length], geom);
        };
        if (key.startsWith("row:")) { rowOpen[+key.slice(4)]?.(at, nav); return; }
        const name = key.slice(2);
        openFloatPopup({
            anchor: widgetTA[name] || wrap, title: name, value: node.widgets?.find((x) => x.name === name)?.value ?? "", node, at, nav, navWhat: NAV_WHAT,
            fontKey: SET.fsPopScene, onInput: (v) => setW(name, v), filled: (raw) => filledFor(WKEY[name], raw) });
    }
    for (const n of ["positive_prompt", "negative_prompt"]) {
        const w = node.widgets?.find((x) => x.name === n);
        if (w?.options) { w.options.getMinHeight = () => 48; w.options.getMaxHeight = () => 96; }
    }
    const dataW = node.widgets?.find((w) => w.name === DATA);
    // some frontend versions leave a combo empty on new nodes: fall back to its default
    const modeW = node.widgets?.find((w) => w.name === "lora_masking");
    const fixMode = () => {
        const vals = modeW?.options?.values;
        if (modeW && Array.isArray(vals) && vals.length && !vals.includes(modeW.value)) modeW.value = vals[0];
    };
    fixMode(); setTimeout(fixMode, 0);
    if (dataW) { dataW.hidden = true; dataW.computeSize = () => [0, -4]; }
    let rows = [];
    const load = () => {
        try { const d = JSON.parse(dataW?.value || "{}"); rows = Array.isArray(d.rows) ? d.rows : []; } catch (e) { rows = []; }
        rows = rows.map((r) => ({ on: r.on !== false, index: Number.isFinite(+r.index) ? Math.trunc(+r.index) : 0,
                                  lora: String(r.lora || ""), strength: Number.isFinite(+r.strength) ? +r.strength : 1, prompt: String(r.prompt || "") }));
    };
    // the per-field wildcard Setting goes to the run with the rows
    if (dataW) {
        dataW.serializeValue = () => {
            try { return JSON.stringify({ ...JSON.parse(dataW.value || "{}"), wcPerField: !!getSetting(SET.wcPerField, false) }); }
            catch (e) { return dataW.value; }
        };
    }
    const save = () => {
        if (dataW) dataW.value = JSON.stringify({ v: 2, rows });
        node.setDirtyCanvas?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
    };

    const wrap = el("div", "rg-rl-wrap");
    const head = el("div", "rg-rl-head");
    const addBtn = el("button", "rg-rl-btn", "+ Add LoRA");
    addBtn.title = "Add a row: One LoRA applied inside one mask (index), or everywhere (index -1).";
    const hint = el("span", "rg-rl-hint");
    const acCtl = autocompleteToggle(node, el);
    acCtl.el.style.marginLeft = "auto";
    const linked = (n) => !!node.inputs?.some((i) => i.name === n && i.link != null);
    const wval = (n) => (linked(n) ? "" : String(node.widgets?.find((x) => x.name === n)?.value ?? ""));
    const wcFields = () => {
        const f = { prompt: wval("positive_prompt"), negative: wval("negative_prompt") };
        rows.forEach((r, k) => { if (r.prompt) f["row" + k] = r.prompt; });
        return f;
    };
    function markAll() {
        for (const [n, key] of Object.entries(WKEY)) wcMark(widgetTA[n], key, wval(n));
        rowEls.forEach((e, k) => wcMark(e?.pr, "row" + k, rows[k]?.prompt || ""));
    }
    node.__rgrlFilled = (f) => { wcFilled = { ...(f || {}) }; markAll(); };
    const wcCtl = wildcardSeedControl(node, el, {
        fields: wcFields,
        onFilled: (f, preview, msg) => { wcFilled = { ...(f || {}) }; markAll(); hint.textContent = msg || (Object.keys(f || {}).length ? "Preview: hover a field to see what it becomes" : ""); },
        useAll: () => {
            for (const [n, key] of Object.entries(WKEY)) {
                const f = filledFor(key, wval(n)), w = node.widgets?.find((x) => x.name === n);
                if (f != null && w) { w.value = f; try { w.callback?.(f); } catch (e) { /* ignore */ } }
            }
            rows.forEach((r, k) => { const f = filledFor("row" + k, r.prompt); if (f != null) r.prompt = f; });
            save(); render(); markAll();
        },
    });
    head.append(addBtn, hint, acCtl.el, wcCtl.el);
    const list = el("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:4px;";
    wrap.append(head, list);
    for (const ev of ["keydown", "keyup", "keypress"]) wrap.addEventListener(ev, (e) => e.stopPropagation());

    addBtn.addEventListener("click", async () => {
        const loras = await getLoras();
        const last = rows[rows.length - 1];
        rows.push({ on: true, index: last ? Math.max(0, last.index) + 1 : 0, lora: last?.lora || loras[0] || "", strength: 1, prompt: "" });
        save(); render(); fit(true);
    });

    // regions behind the masks input (when it comes from the Region Genie node)
    function upstreamRegions() {
        const inp = node.inputs?.find((i) => i.name === "masks");
        const link = inp?.link != null ? node.graph?.links?.[inp.link] ?? node.graph?.links?.get?.(inp.link) : null;
        const src = link ? node.graph.getNodeById(link.origin_id) : null;
        if (src?.__rgOutputRegions && src.outputs?.[link.origin_slot]?.name === "masks") {
            try { return src.__rgOutputRegions(); } catch (e) { return null; }
        }
        return null;
    }
    function regionHint(idx, regs) {
        if (idx === -1) return { text: "everywhere (whole image)", color: null, bad: false };
        const count = regs ? regs.length : node.__rgrlMaskCount;
        if (regs && regs[idx]) {
            const r = regs[idx];
            const p = (r.prompt || "").trim() || "(no prompt)";
            return { text: (r.type === "character" ? "👤 " : "") + p + (r.type === "text" && r.text ? `  "${r.text}"` : ""), color: r.color, bad: false };
        }
        if (typeof count === "number") {
            if (idx < 0 || idx >= count) return { text: count ? `no mask ${idx} (masks: 0-${count - 1})` : "no masks", color: null, bad: true };
            return { text: `mask ${idx} of 0-${count - 1}`, color: null, bad: false };
        }
        return { text: idx < -1 ? "invalid index" : "", color: null, bad: idx < -1 };
    }
    const regionCaption = (idx, regs) => (idx >= 0 && regs?.[idx]?.prompt) || "";
    function promptHint(r, regs) {
        if (r.index === -1) return "words for the scene caption (e.g. trigger words of this LoRA)";
        const cap = regionCaption(r.index, regs).trim();
        return cap ? `words added to region ${r.index}'s caption "${cap}"` : `words added to region ${r.index}'s caption (e.g. trigger words)`;
    }

    const rowEls = [];
    function updateHints() {
        const regs = upstreamRegions();
        rows.forEach((r, i) => {
            const h = rowEls[i]; if (!h) return;
            const v = regionHint(r.index, regs);
            h.text.textContent = v.text; h.text.title = v.text;
            h.text.classList.toggle("bad", v.bad);
            h.sw.style.display = v.color ? "" : "none";
            if (v.color) h.sw.style.background = v.color;
            const ph = promptHint(r, regs);
            h.pr.placeholder = ph;
            if (document.activeElement !== h.pr) h.pr.title = r.prompt ? `${r.prompt}\n(${ph})` : ph[0].toUpperCase() + ph.slice(1) + ".";
        });
        const groups = new Set(rows.filter((r) => r.on && r.lora && r.index >= 0).map((r) => r.index));
        hint.textContent = rows.length ? `${rows.filter((r) => r.on).length} on, ${groups.size} region(s)` : "no LoRAs yet";
    }
    node.__rgrlRefresh = updateHints;

    function setPickLabel(b, value) {
        b.textContent = value || "(choose a LoRA)";
        b.title = value || "Choose a LoRA";
        const known = knownLoras();
        b.classList.toggle("missing", !!value && !!known && !known.includes(value));
    }
    // trigger-word chips of a row's LoRA: "used" when already in the row's words or in the region's caption
    function fillChips(box, r) {
        box.replaceChildren();
        if (!r.lora) return;
        fillTriggerChips(box, r.lora, () => `${r.prompt}\n${regionCaption(r.index, upstreamRegions())}`, (w) => {
            r.prompt = appendWord(r.prompt, w); save(); render();
        }, el);
    }

    function render() {
        list.replaceChildren();
        rowEls.length = 0; rowOpen.length = 0;
        rows.forEach((r, i) => {
            const row = el("div", "rg-rl-row" + (r.on ? "" : " off"));
            const l1 = el("div", "rg-rl-line");
            const on = el("input"); on.type = "checkbox"; on.checked = r.on; on.title = "On / off";
            on.addEventListener("change", () => { r.on = on.checked; row.classList.toggle("off", !r.on); save(); updateHints(); });
            const idxLbl = el("span", null, "index");
            const idx = el("input", "rg-rl-idx"); idx.type = "number"; idx.min = "-1"; idx.step = "1"; idx.value = String(r.index);
            idx.title = "Mask index (the number left of the region in the Region Genie node). -1 = everywhere. Rows with the same index stack on that region.";
            idx.addEventListener("input", () => {
                const v = Math.trunc(+idx.value);
                if (Number.isFinite(v)) { r.index = Math.max(-1, v); save(); updateHints(); fillChips(chips, r); }
            });
            const sw = el("span", "rg-rl-sw");
            const regText = el("span", "rg-rl-region");
            const up = el("button", "rg-rl-btn sm", "↑"); up.title = "Move up"; up.disabled = i === 0;
            const dn = el("button", "rg-rl-btn sm", "↓"); dn.title = "Move down"; dn.disabled = i === rows.length - 1;
            const del = el("button", "rg-rl-btn sm", "×"); del.title = "Remove this LoRA";
            up.addEventListener("click", () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; save(); render(); });
            dn.addEventListener("click", () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; save(); render(); });
            del.addEventListener("click", () => { rows.splice(i, 1); save(); render(); fit(false); });
            l1.append(on, idxLbl, idx, sw, regText, up, dn, del);

            const l2 = el("div", "rg-rl-line");
            const sel = el("button", "rg-rl-pick");
            setPickLabel(sel, r.lora);
            sel.addEventListener("pointerdown", (e) => e.stopPropagation());
            sel.addEventListener("click", async (e) => {
                const ok = await pickLora(e, (name) => { r.lora = name; save(); render(); });
                if (!ok) sel.title = "No LoRAs found in models/loras";
            });
            const strL = el("span", null, "strength");
            const str = el("input", "rg-rl-str"); str.type = "number"; str.step = "0.05"; str.min = "-20"; str.max = "20"; str.value = String(r.strength);
            str.title = "LoRA strength for this row (1 = full; negative values push away from the LoRA)";
            strL.title = str.title;
            str.addEventListener("input", () => { const v = +str.value; if (Number.isFinite(v)) { r.strength = v; save(); } });
            l2.append(sel, strL, str);

            // words for this region's caption (trigger words etc.); grows while edited
            const l3 = el("div", "rg-rl-line");
            const pr = el("textarea", "rg-rl-prompt"); pr.rows = 1; pr.value = r.prompt; pr.spellcheck = false;
            pr.dataset.k = String(i);
            pr.addEventListener("input", () => { r.prompt = pr.value; save(); });
            pr.addEventListener("focus", () => fit(true));
            pr.addEventListener("blur", () => { pr.scrollTop = 0; fillChips(chips, r); updateHints(); });
            pr.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey && !autocompleteOpen(pr, e)) { e.preventDefault(); pr.blur(); }
            });
            autocompleteOnFocus(pr, node);
            const prWrap = el("span", "rg-pwrap"); prWrap.appendChild(pr);
            l3.append(prWrap);
            const chips = el("div", "rg-rl-trig");
            row.append(l1, l2, l3, chips);
            list.append(row);
            rowEls[i] = { sw, text: regText, pr };
            fillChips(chips, r);
            rowOpen[i] = (at, nav) => openFloatPopup({
                anchor: pr, title: `Row ${i + 1}: words for ${r.index === -1 ? "the whole image" : "region " + r.index}`, value: r.prompt, node, at, nav, navWhat: NAV_WHAT,
                fontKey: SET.fsPopRegion, onInput: (v) => { r.prompt = v; pr.value = v; save(); wcMark(pr, "row" + i, v); },
                filled: (raw) => filledFor("row" + i, raw), onClose: () => { fillChips(chips, r); updateHints(); } });
            addExpandButton(pr, "Open this row's words in the pop-up editor", () => openField("row:" + i));
            pr.addEventListener("input", () => wcMark(pr, "row" + i, r.prompt));
        });
        markAll();
        updateHints();
        fit(true);
    }

    const domW = node.addDOMWidget("loras_editor", "RegionalLoRAsEditor", wrap, {
        serialize: false, hideOnZoom: false,
        getMinHeight: () => Math.max(40, head.offsetHeight + list.scrollHeight + 12),
    });
    domW.serialize = false;
    // keep the classic canvas from using a width the properties panel wrote into the widget
    try { Object.defineProperty(domW, "width", { configurable: true, get: () => undefined, set: () => {} }); } catch (e) { /* ignore */ }

    let fitRaf = 0;
    function fit(grow) {
        cancelAnimationFrame(fitRaf);
        fitRaf = requestAnimationFrame(() => {
            const h = node.computeSize?.()[1];
            if (!h) return;
            if (grow ? h > node.size[1] : true) node.setSize([node.size[0], h]);
            node.setDirtyCanvas?.(true, true);
        });
    }

    const onConfigure = node.onConfigure;
    node.onConfigure = function (info) {
        const r = onConfigure?.apply(this, arguments);
        fixMode(); load(); render(); acCtl.refresh();
        migratePrompt(info);
        return r;
    };
    // 'prompt' was renamed 'positive_prompt' (round 11): a workflow saved before keeps its text and its link
    function migratePrompt(info) {
        const old = info?.properties?.rg_widget_values?.prompt;
        const put = () => { const w = node.widgets?.find((x) => x.name === "positive_prompt"); if (w && typeof old === "string" && !w.value) setW("positive_prompt", old); };
        if (typeof old === "string" && info.properties.rg_widget_values.positive_prompt == null) { put(); setTimeout(put, 0); }
        const i = (node.inputs || []).findIndex((x) => x.name === "prompt");
        if (i < 0) return;
        const id = node.inputs[i].link;
        let j = node.inputs.findIndex((x) => x.name === "positive_prompt");
        if (id != null && j < 0) { node.addInput("positive_prompt", "STRING", { widget: { name: "positive_prompt" } }); j = node.inputs.length - 1; }
        if (id != null && node.inputs[j].link == null) {
            const l = node.graph?.links?.get?.(id) ?? node.graph?.links?.[id];
            if (l) { l.target_slot = j; node.inputs[j].link = id; node.inputs[i].link = null; }
        }
        node.removeInput(node.inputs.findIndex((x) => x.name === "prompt"));
    }
    load(); render();
    getLoras();
    // Settings > Region Genie: how a new node starts. Set right away, while the node is being made: a saved, pasted or
    // API-format workflow (loadApiJson doesn't call configure) sets its own values afterwards and so keeps them
    {
        const set = (name, v) => {
            const w = node.widgets?.find((x) => x.name === name);
            if (!w || v === undefined || v === null || w.value === v) return;
            if (Array.isArray(w.options?.values) && !w.options.values.includes(v)) return;
            w.value = v;
            try { w.callback?.(v); } catch (e) { /* ignore */ }
        };
        set("feather", Math.max(0, Math.round(+getSetting(SET.hlFeather, 0)) || 0));
        set("lora_masking", getSetting(SET.hlMasking, "inside the model (one pass)"));
        set("region_separation", +getSetting(SET.hlSeparation, 0.85));
        set("separation_until", +getSetting(SET.hlUntil, 0.25));
        set("separate_all_regions", !!getSetting(SET.hlAllRegions, false));
        set("share_background", !!getSetting(SET.hlShareBg, false));
        node.setDirtyCanvas?.(true, true);
    }
    // Settings > Region Genie > Text size: positive / negative as 'scene prompts', the rows' words as 'region prompts'
    function applyFonts() {
        const fs = (id) => Math.max(0, Math.min(40, Math.round(+getSetting(id, 0)) || 0));
        const a = fs(SET.fsNodeScene), b = fs(SET.fsNodeRegion);
        for (const t of Object.values(widgetTA)) {
            const want = a ? a + "px" : "";
            if (t.style.fontSize !== want) { t.style.fontSize = want; t.style.lineHeight = a ? Math.round(a * 1.3) + "px" : ""; }
        }
        if (b) { wrap.style.setProperty("--rg-rl-fs", b + "px"); wrap.style.setProperty("--rg-rl-lh", Math.round(b * 1.3) + "px"); }
        else { wrap.style.removeProperty("--rg-rl-fs"); wrap.style.removeProperty("--rg-rl-lh"); }
    }
    applyFonts();
    const poll = setInterval(() => { if (!node.graph) return; fixMode(); updateHints(); wcCtl.refresh(); applyFonts(); }, 1000);
    const onRemoved = node.onRemoved;
    node.onRemoved = function () { clearInterval(poll); return onRemoved?.apply(this, arguments); };
}
