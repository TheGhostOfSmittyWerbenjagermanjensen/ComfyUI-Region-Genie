import { app } from "../../scripts/app.js";
import { getLoras, knownLoras, pickLora, fillTriggerChips, CHIP_CSS, keepWidgetValuesByName, appendWord,
         autocompleteOnFocus, autocompleteOpen, autocompleteWidgets, autocompleteToggle, getSetting, SET } from "./rg_shared.js";

// Editor of the "Regional LoRAs" node: one row per LoRA (on, mask index, LoRA, strength, words for
// that region's caption with the LoRA's trigger words as chips), stored as JSON in the hidden "loras_data" widget.
// When the masks come from the Region Genie node, each row shows the region its index points to.
const NODE_NAMES = ["Region-Genie_RegionalLoRAs", "RegionalMaskKit_CreateHookLoRAs"];   // new ID, old ID
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
.rg-rl-prompt { flex:1 1 0 !important; width:0; min-width:0; box-sizing:border-box; resize:none; background:var(--comfy-input-bg,#222);
  color:inherit; border:1px solid var(--border-color,#555); border-radius:4px; font:inherit; padding:1px 4px; height:20px;
  line-height:16px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.rg-rl-prompt:focus { height:64px; white-space:pre-wrap; overflow-y:auto; scrollbar-width:thin; outline:none; border-color:#5b8fd0; }
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
            const s = document.createElement("style"); s.id = "rg-rl-style"; s.textContent = CSS + CHIP_CSS; document.head.appendChild(s);
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
        };
    },
});

function setup(node) {
    keepWidgetValuesByName(node, ["prompt", "negative_prompt", "feather", "lora_masking", "region_separation", "separation_until",
                                  "separate_all_regions", "share_background"]);
    autocompleteWidgets(node, ["prompt", "negative_prompt"]);
    for (const n of ["prompt", "negative_prompt"]) {
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
    const save = () => {
        if (dataW) dataW.value = JSON.stringify({ v: 2, rows });
        node.setDirtyCanvas?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
    };

    const wrap = el("div", "rg-rl-wrap");
    const head = el("div", "rg-rl-head");
    const addBtn = el("button", "rg-rl-btn", "+ Add LoRA");
    addBtn.title = "Add a row: one LoRA applied inside one mask (index), or everywhere (index -1).";
    const hint = el("span", "rg-rl-hint");
    const acCtl = autocompleteToggle(node, el);
    acCtl.el.style.marginLeft = "auto";
    head.append(addBtn, hint, acCtl.el);
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
            if (document.activeElement !== h.pr) h.pr.title = r.prompt ? `${r.prompt}\n(${ph})` : ph;
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
        rowEls.length = 0;
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
            l3.append(pr);
            const chips = el("div", "rg-rl-trig");
            row.append(l1, l2, l3, chips);
            list.append(row);
            rowEls[i] = { sw, text: regText, pr };
            fillChips(chips, r);
        });
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

    let configured = false;
    const onConfigure = node.onConfigure;
    node.onConfigure = function () {
        configured = true;
        const r = onConfigure?.apply(this, arguments);
        fixMode(); load(); render(); acCtl.refresh();
        return r;
    };
    load(); render();
    getLoras();
    // Settings > Region Genie: defaults for a node that was just added (not loaded or pasted)
    setTimeout(() => {
        if (configured) return;
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
    }, 0);
    const poll = setInterval(() => { if (!node.graph) return; fixMode(); updateHints(); }, 1000);
    const onRemoved = node.onRemoved;
    node.onRemoved = function () { clearInterval(poll); return onRemoved?.apply(this, arguments); };
}
