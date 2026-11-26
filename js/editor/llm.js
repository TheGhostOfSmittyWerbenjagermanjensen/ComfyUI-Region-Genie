// LLM Prompt Enhancer: the sparkle buttons, requests and results.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { api } from "../../../scripts/api.js";
import { setHTML, svgIcon, contextMenu, appendWord, autocompleteOnFocus, autocompleteOpen, textHistory } from "../rg_shared.js";
import { loadLibrary, library, onLibraryChange, resolveNodeLlm, presetForType, sparkleSvg, openLlmSettings } from "../rg_llm.js";
import { TYPES } from "./shared.js";
import { openMenu } from "../rg_menu.js";
import { normPalette } from "./colors.js";
import { normLoraOpts } from "./state.js";

export function* llm(E) {
    Object.assign(E, {
        syncLlm, llmButton, updateLlmButtons, storeLlmResults, pushLlmCache, regionLoraRows, renderRegions, markLayerRows, markRegionRows,
    });
    yield;

    // ---------------- LLM Prompt Enhancer ----------------
    // r.llm / state.sceneLlm: on; r.llmSalt / state.sceneLlmSalt: added to the seed ("run again");
    // state.llm: { ctxMode, assign: {type: preset}, ctx, cfg: {type: {preset, s}} } (cfg = full copies, so the
    // workflow carries the settings). Results of the last run: node.properties.rg_llm (not in paint_data, so
    // storing them doesn't make the next run start over).
    const LLM_SCENE = "llm:scene"; E.LLM_SCENE = LLM_SCENE;
    const llmBtns = new Map();
    const llmResults = () => {
        E.node.properties = E.node.properties || {};
        let p = E.node.properties.rg_llm;
        if (!p || typeof p !== "object") p = E.node.properties.rg_llm = { regions: {}, scene: null };
        if (!p.regions || typeof p.regions !== "object") p.regions = {};
        return p;
    };
    const llmUsed = () => !!E.state.sceneLlm || E.state.regions.some((r) => r.llm);
    function syncLlm() {
        if (!llmUsed() && !E.state.llm) return;
        if (!library()) { loadLibrary(); return; }           // its change listener calls back
        const next = resolveNodeLlm(E.state.llm);
        if (JSON.stringify(next) !== JSON.stringify(E.state.llm)) { E.state.llm = next; E.save(); }
    }
    const llmHost = {
        getLlm: () => E.state.llm || {},
        setLlm: (fn) => {
            const L = JSON.parse(JSON.stringify(E.state.llm || {}));
            fn(L);
            E.change(() => { E.state.llm = resolveNodeLlm(L); });
        },
        regionTypesInUse: () => new Set([...E.state.regions.filter((r) => r.llm).map((r) => r.type || "object"),
            ...(E.state.sceneLlm ? ["scene"] : [])]),
        renamePreset: (a, b) => {
            const as = E.state.llm?.assign;
            if (as) for (const t of Object.keys(as)) if (as[t] === a) as[t] = b;
            syncLlm(); E.save();
        },
    }; E.llmHost = llmHost;
    const offLlmLib = onLibraryChange(() => { syncLlm(); updateLlmButtons(); }); E.offLlmLib = offLlmLib;
    function llmTarget(key) {
        if (key === LLM_SCENE) return { on: !!E.state.sceneLlm, prompt: E.sceneW?.value || "", type: "scene", res: llmResults().scene, what: "scene_prompt_positive" };
        const r = E.regionById(key);
        return r ? { on: !!r.llm, prompt: r.prompt || "", type: r.type || "object", res: llmResults().regions[r.id], r, what: "this region's prompt" } : null;
    }
    const llmReady = (t) => !!(t?.res && !t.res.failed && t.res.text && String(t.res.prompt || "").trim() === String(t.prompt || "").trim());
    function setLlmOn(key, on) {
        E.change(() => { if (key === LLM_SCENE) E.state.sceneLlm = on; else { const r = E.regionById(key); if (r) r.llm = on; } });
        syncLlm(); updateLlmButtons();
    }
    function keepEnhanced(key) {
        const t = llmTarget(key);
        if (!llmReady(t)) return;
        if (key === LLM_SCENE) {
            E.change(() => { E.setWidget(E.sceneW, t.res.text); E.state.sceneLlm = false; });      // one step of Undo: the text and the switch
            E.hint("The enhanced text is now in scene_prompt_positive");
        } else E.change(() => { t.r.prompt = t.res.text; t.r.llm = false; });
        updateLlmButtons();
    }
    function llmButton(key, slot = "") {
        const b = E.el("button", "rg-btn rg-llm-btn");
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        let shown = "";
        const refresh = () => {
            const t = llmTarget(key);
            if (!t) return;
            const ready = llmReady(t);
            const failed = !!(t.res?.failed && String(t.res.prompt || "").trim() === t.prompt.trim());
            const preset = presetForType(E.state.llm, t.type) || "default";
            let tip;
            if (!t.on) tip = `LLM Prompt Enhancer off. Click to have the LLM rewrite ${t.what} when the workflow runs (preset '${preset}').`;
            else if (ready) tip = `LLM Prompt Enhancer on (preset '${t.res.preset || preset}'). Text used in the last run:\n\n${t.res.text}`
                + (t.res.thinking ? `\n\nThinking:\n${t.res.thinking.slice(0, 1200)}${t.res.thinking.length > 1200 ? "..." : ""}` : "")
                + "\n\nClick to turn off (restore your prompt or keep this text). Right-click for more.";
            else if (failed) tip = `LLM Prompt Enhancer on: The LLM returned nothing last time, so the typed prompt was used; it is tried again on the next run.`;
            else tip = `LLM Prompt Enhancer on (preset '${preset}'): ${t.what} is rewritten when the workflow runs. Click to turn off.`;
            // only touch the button when something changed: replacing its contents while the pointer rests
            // on it (the 0.5 s poll) would cancel the browser's tooltip
            const sig = [t.on, ready, failed, tip].join("|");
            if (sig === shown) return;
            shown = sig;
            setHTML(b, sparkleSvg(t.on));
            b.classList.toggle("on", t.on);
            b.classList.toggle("ready", t.on && ready);
            b.classList.toggle("failed", t.on && failed);
            b.title = tip;
        };
        b.addEventListener("click", (e) => {
            e.preventDefault();
            const t = llmTarget(key);
            if (!t) return;
            if (!t.on) { setLlmOn(key, true); return; }
            if (!llmReady(t)) { setLlmOn(key, false); return; }
            contextMenu(e, [{ content: "Turn off – restore my original prompt", v: "restore" },
                            { content: "Turn off – keep the enhanced text to edit", v: "keep" }], "LLM Prompt Enhancer", (v) => {
                if (v?.v === "restore") setLlmOn(key, false);
                else if (v?.v === "keep") keepEnhanced(key);
            });
        });
        b.addEventListener("contextmenu", (e) => {
            e.preventDefault(); e.stopPropagation();
            const t = llmTarget(key);
            if (!t) return;
            const items = [];
            const sampling = !!E.state.llm?.cfg?.[t.type]?.s?.sampling;       // greedy: a seed changes nothing
            if (!t.on) items.push({ content: "Turn on", v: "on" });
            else if (sampling) items.push({ content: "Run again with a new seed", v: "again" });
            if (t.res?.text) items.push({ content: "Copy the enhanced text", v: "copy" });
            if (t.res?.thinking) items.push({ content: "Copy the thinking", v: "think" });
            if (llmReady(t)) items.push({ content: "Keep the enhanced text to edit (turns off)", v: "keep" });
            if (items.length) items.push(null);
            items.push({ content: "LLM Settings...", v: "settings" });
            contextMenu(e, items, "LLM Prompt Enhancer", (v) => {
                if (v?.v === "on") setLlmOn(key, true);
                else if (v?.v === "again") {
                    E.change(() => { if (key === LLM_SCENE) E.state.sceneLlmSalt = (E.state.sceneLlmSalt || 0) + 1; else t.r.llmSalt = (t.r.llmSalt || 0) + 1; });
                    E.hint("A new seed: The prompt is rewritten on the next run");
                } else if (v?.v === "copy") navigator.clipboard?.writeText(t.res.text).catch(() => {});
                else if (v?.v === "think") navigator.clipboard?.writeText(t.res.thinking).catch(() => {});
                else if (v?.v === "keep") keepEnhanced(key);
                else if (v?.v === "settings") openLlmSettings(E.llmSetBtn, llmHost);
            });
        });
        llmBtns.set(slot ? `${key}|${slot}` : key, refresh);
        refresh();
        return b;
    }
    // scene_prompt_positive shows its enhancer on the text box itself (round 43; the owner chose button and outline):
    // the same button in the box's corner, left of the pop-up button, and an outline around the box while it is on.
    // Called with every button refresh, so a text box that ComfyUI made anew (Nodes 2.0) gets its button again.
    function sceneLlmMark() {
        const on = !!E.state.sceneLlm;
        const t = E.sceneTA?.positive;
        if (t?.isConnected) {
            const exp = t.parentElement?.querySelector(":scope > .rg-expand");
            if (exp?.__rgAddExtra && !exp.__rgLlm?.isConnected) {
                const b = llmButton(LLM_SCENE, "corner");
                b.classList.add("rg-llm-corner");
                b.addEventListener("mousedown", (e) => { e.stopPropagation(); e.preventDefault(); });      // not a click into the text
                b.__rgRefresh = llmBtns.get(`${LLM_SCENE}|corner`);       // (the list of buttons is emptied whenever the region list is rebuilt)
                exp.__rgLlm = b; exp.__rgAddExtra(b);
            }
            exp?.__rgLlm?.__rgRefresh?.();
            if (t.classList.contains("rg-llm-on") !== on) t.classList.toggle("rg-llm-on", on);
        }
        const big = E.big?.fields?.find((f) => f.which === "positive")?.ta;
        if (big && big.classList.contains("rg-llm-on") !== on) big.classList.toggle("rg-llm-on", on);
    }
    function updateLlmButtons() {
        sceneLlmMark();
        for (const f of llmBtns.values()) f();
    }
    function storeLlmResults(msg) {
        const store = llmResults();
        for (const [rid, res] of Object.entries(msg?.regions || {})) store.regions[rid] = res;
        if (msg?.scene) store.scene = msg.scene;
        const ids = new Set(E.state.regions.map((r) => String(r.id)));
        for (const rid of Object.keys(store.regions)) if (!ids.has(rid)) delete store.regions[rid];
        E.node.setDirtyCanvas?.(true, true);
        updateLlmButtons();
    }
    function pushLlmCache() {                       // results saved in the workflow -> server cache
        const st = E.node.properties?.rg_llm;
        const entries = {};
        for (const res of [...Object.values(st?.regions || {}), st?.scene]) {
            if (res?.key && res.text && !res.failed) entries[res.key] = { text: res.text, thinking: res.thinking || "" };
        }
        if (Object.keys(entries).length) {
            api.fetchApi("/region_genie/llm_cache", { method: "POST", body: JSON.stringify({ entries }) }).catch(() => {});
        }
    }

    // a region's LoRAs; trigger-word chips add to its prompt
    function regionLoraRows(r, pop = false) {
        return E.loraRows(r.loras || [], {
            pop,
            prompt: () => r.prompt,
            append: (words) => E.change(() => { for (const w of words) r.prompt = appendWord(r.prompt, w); }),
        });
    }
    // a text or number field of the list has the cursor (not a checkbox, a dropdown or a button: those hold no typing)
    const listFieldBusy = () => {
        const a = document.activeElement;
        return !!a && E.regList.contains(a) && (a.tagName === "TEXTAREA"
            || (a.tagName === "INPUT" && !["checkbox", "radio", "button", "range", "color", "file"].includes(a.type)));
    };
    // the redraw that was held back (see E.background in core.js), once the cursor has left the field
    function flushRegions() { if (E.renderPending && !listFieldBusy() && E.wrap.isConnected) renderRegions(); }
    E.flushRegions = flushRegions;
    E.regList.addEventListener("focusout", () => setTimeout(flushRegions, 0));      // after the field's own change was handled
    E.redraws = { done: 0, held: 0 };                  // for tests
    function renderRegions() {
        if (E.inBackground && listFieldBusy()) { E.renderPending = true; E.redraws.held++; return; }
        E.renderPending = false; E.redraws.done++;
        const scroll = E.regList.scrollTop;
        E.regList.textContent = "";
        llmBtns.clear();
        E.sepIn.value = String(normLoraOpts(E.state.loraOpts).separation);
        E.untilIn.value = String(normLoraOpts(E.state.loraOpts).until);
        const anyLora = (E.state.sceneLoras || []).length || E.state.regions.some((r) => (r.loras || []).length);
        const showSep = anyLora || normLoraOpts(E.state.loraOpts).allRegions || (E.autoSeparate && !normLoraOpts(E.state.loraOpts).autoOff);
        for (const e of [E.sepLbl, E.sepIn, E.untilLbl, E.untilIn]) e.style.display = showSep ? "" : "none";
        E.setAllSeparateBtn();
        E.syncEditMaskBox();
        E.updateExpandButtons();

        // whole image: LoRAs for everything (trigger words go to scene_prompt_positive)
        const scene = E.el("div", "rg-row scene");
        const sl = E.el("span", "rg-pseudo"); sl.textContent = "Whole image";
        sl.title = "LoRAs here act on the whole picture (and all text), like a normal LoRA";
        // round 87: the row shows its LoRAs that are on as chips, and one LoRAs button; both open the scene prompt's
        // pop-up on its LoRAs tab (the LoRA rows were a part of the list that opened under this row)
        const openSceneLoras = () => E.editScene("positive", null, "loras");
        const sceneAdd = E.loraButton(E.state.sceneLoras, "the whole image", openSceneLoras);
        const sceneChips = E.loraChips(E.state.sceneLoras, openSceneLoras);
        // round 18: Control is a row you add (and remove with its ✕), not an always-there switch
        const ctlAdd = E.ico("＋Control", "Add a Control row: The model follows a color map, depth, canny or your own control_image "
            + "(ControlNet / control LoRA; the files are set in Settings > Region Genie > Control). Several rows combine where the "
            + "model allows it (ControlNets, Anima LLLite).", () => E.addControl(), "txt");
        const editAdd = E.ico("＋Edit", E.state.editOff ? "Add the Edit row back: The edit LoRA set in Settings for the node's model"
            : "Add an Edit row: A LoRA of this node's own, used only in Edit Mode (any model)", () => E.addEditRow(), "txt");
        if (!E.isEdit()) editAdd.style.display = "none";
        // the Edit and Control LoRAs are set on their own rows, not listed here (round 23)
        const nScene = E.loraCount(E.state.sceneLoras).on;
        const sGap = E.el("span"); sGap.style.flex = "1 1 auto";
        scene.append(E.el("span", "rg-grip pad"), sl, nScene ? sceneChips : sGap, llmButton(LLM_SCENE), sceneAdd, ctlAdd, editAdd);
        scene.classList.toggle("has-lora", nScene > 0);
        scene.classList.toggle("has-chips", nScene > 0);
        E.regList.appendChild(scene);
        sceneChips.__rgFit?.();

        if (E.isEdit()) E.regList.appendChild(E.editRows());
        E.controls().forEach((c, k) => E.regList.appendChild(E.controlRow(c, k)));
        E.regList.appendChild(E.poseRows(null, E.ico));           // the pose figures of no region (pose.js)

        E.state.regions.forEach((r, i) => {
            const lays = E.listedOf(r.id);
            const row = E.el("div", "rg-row region" + (E.curRegion === r.id ? " sel" : "") + (r.hidden ? " off" : ""));
            const pick = () => { if (E.activateRegion(r.id)) { markRegionRows(); E.requestDraw(); } };
            row.addEventListener("pointerdown", (e) => { if (e.target === row || e.target.classList.contains("rg-idx") || e.target.classList.contains("rg-cnt")) pick(); });
            const sw = E.regionSwatch(r, pick);
            // round 88: the type is an icon; a click lists the three to choose from (it was a dropdown with the words)
            const TYPE_ICON = { object: "typeObject", character: "typeCharacter", text: "typeText" };
            const ty = E.ico("@" + (TYPE_ICON[r.type] || "typeObject"), `Region type: ${r.type}. Click to change it.\nobject: A thing or area.\ncharacter: A person or character (also listed in character_boxes).\ntext: Text rendered in the image.`, () => {
                const b = ty.getBoundingClientRect();
                pick();
                openMenu(b.left, b.bottom + 2, TYPES.map((v) => ({ label: v, icon: TYPE_ICON[v], checked: r.type === v, fn: () => { if (r.type !== v) E.change(() => { r.type = v; }); } })),
                         { onClose: () => { if (E.wrap.isConnected) E.focusSink(); } });
            });
            ty.classList.add("rg-tybtn"); ty.dataset.type = r.type;
            const pr = E.el("textarea", "rg-prompt"); pr.rows = 1; pr.placeholder = r.fromImage ? "prompt for this image color" : "prompt";
            const dblTip = (v) => v || "";
            pr.value = r.prompt; pr.dataset.rid = String(r.id); pr.spellcheck = false;
            E.wcMark(pr, "r" + r.id, r.prompt, dblTip(r.prompt));
            pr.addEventListener("blur", () => { pr.scrollTop = 0; E.wcMark(pr, "r" + r.id, r.prompt, dblTip(r.prompt)); refreshChips(r.id); });
            // the expand button: the region's pop-up editor, next to this row
            const openPop = (field, t) => () => { t.blur(); E.editPrompt(r.id, null, field); };
            const prWrap = E.el("span", "rg-pwrap"); prWrap.appendChild(pr);
            pr.addEventListener("focus", () => pick());
            const prStore = () => { r.prompt = pr.value; E.save(); llmBtns.get(r.id)?.(); };
            pr.addEventListener("input", prStore);
            // Undo (round 43): a visit to the box is one step of the editor's Undo; while typing, the Undo keys go back
            // through this box's own text (the same steps as in the region's pop-up editor)
            E.textSession(pr);
            textHistory(pr, E.histOf("r" + r.id), { apply: () => { prStore(); E.requestDraw(); } });
            pr.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey && !autocompleteOpen(pr, e)) { e.preventDefault(); pr.blur(); }
            });
            autocompleteOnFocus(pr, E.node);
            const ix = E.el("span", "rg-idx"); ix.dataset.k = String(i);
            // round 88: what the region holds, as small buttons that open its pop-up on that tab
            const openTab = (tab) => () => E.editPrompt(r.id, null, "prompt", null, tab);
            const cnt = E.el("button", "rg-cnt"); cnt.type = "button";
            cnt.title = `${lays.length} layer${lays.length === 1 ? "" : "s"} in this region. Click to show and change them.`;
            cnt.innerHTML = svgIcon("layers"); cnt.append(String(lays.length));
            const pal = E.el("button", "rg-paldots"); pal.type = "button";
            const palCols = r.paletteOn ? normPalette(r.palette) : [];
            pal.title = `Color palette on (${palCols.length} color${palCols.length === 1 ? "" : "s"}). Click to show and change it.`;
            for (const c of palCols) { const d = E.el("i"); d.style.background = c; pal.appendChild(d); }
            if (!palCols.length) pal.style.display = "none";
            for (const b of [cnt, pal]) b.addEventListener("pointerdown", (e) => e.stopPropagation());
            cnt.addEventListener("click", (e) => { e.preventDefault(); openTab("layers")(); });
            pal.addEventListener("click", (e) => { e.preventDefault(); openTab("palette")(); });
            const eye = E.ico(r.hidden ? "@eyeOff" : "@eye", r.hidden ? "Hidden: Not drawn and not output. Click to show it again (its layers keep their own show / hide)"
                : "Show / hide this region: A hidden region is not drawn and is left out of every output; its layers keep their own show / hide",
                () => E.change(() => { if (r.hidden) delete r.hidden; else r.hidden = true; }));
            eye.classList.add("rg-reye");
            // (until round 88 a ▶ here opened the region's options line, layers and palette under its row)
            row.dataset.rid = String(r.id);
            row.append(E.grip("region", r.id, pick), eye, ix, sw, ty, prWrap);
            E.addExpandButton(pr, "Open this region in the pop-up editor", openPop("prompt", pr));
            if (r.type === "text") {
                // text to render: grows while edited, like the prompt (Shift+Enter = new line)
                const tx = E.el("textarea", "rg-prompt rg-text"); tx.rows = 1; tx.placeholder = "text"; tx.value = r.text;
                tx.spellcheck = false;
                E.wcMark(tx, `r${r.id}.text`, r.text, dblTip(r.text || "Text to render"));
                tx.addEventListener("focus", () => pick());
                tx.addEventListener("blur", () => { tx.scrollTop = 0; E.wcMark(tx, `r${r.id}.text`, r.text, dblTip(r.text || "Text to render")); });

                const txStore = () => { r.text = tx.value; E.save(); };
                tx.addEventListener("input", txStore);
                E.textSession(tx);
                textHistory(tx, E.histOf(`r${r.id}.text`), { apply: () => { txStore(); E.requestDraw(); } });
                tx.addEventListener("keydown", (e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); tx.blur(); }
                });
                const txWrap = E.el("span", "rg-pwrap rg-twrap"); txWrap.appendChild(tx);
                // round 88: a handle between the two fields sets how wide the text to render is (this region's, kept
                // with the node in properties.rg_text_w; not a part of Undo, like the list's height)
                const TW_MIN = 40, tsplit = E.el("span", "rg-tsplit");
                tsplit.title = "Drag: More room for the prompt or for the text to render.\nDouble-click: The usual width.";
                const setTw = (w) => { txWrap.style.flex = w ? `0 0 ${w}px` : ""; };
                setTw(+E.node.properties?.rg_text_w?.[r.id] || 0);
                tsplit.addEventListener("pointerdown", (e) => {
                    if (e.button !== 0) return;
                    e.preventDefault(); e.stopPropagation();
                    const k = E.wrap.offsetWidth / Math.max(1, E.wrap.getBoundingClientRect().width);     // screen px -> CSS px (graph zoom)
                    const x0 = e.clientX, w0 = txWrap.offsetWidth, most = Math.max(TW_MIN, w0 + prWrap.offsetWidth - 60);
                    let w = w0;
                    tsplit.setPointerCapture?.(e.pointerId); tsplit.classList.add("drag");
                    const move = (ev) => { w = Math.round(Math.max(TW_MIN, Math.min(most, w0 - (ev.clientX - x0) * k))); setTw(w); pr.__rgPlaceExpand?.(); tx.__rgPlaceExpand?.(); };
                    const up = () => {
                        tsplit.classList.remove("drag");
                        tsplit.removeEventListener("pointermove", move); tsplit.removeEventListener("pointerup", up); tsplit.removeEventListener("pointercancel", up);
                        if (w === w0) return;
                        E.node.properties = E.node.properties || {};
                        E.node.properties.rg_text_w = { ...(E.node.properties.rg_text_w || {}), [r.id]: w };
                        E.node.graph?.change?.();
                    };
                    tsplit.addEventListener("pointermove", move); tsplit.addEventListener("pointerup", up); tsplit.addEventListener("pointercancel", up);
                });
                tsplit.addEventListener("dblclick", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (E.node.properties?.rg_text_w) { delete E.node.properties.rg_text_w[r.id]; E.node.graph?.change?.(); }
                    setTw(0);
                });
                for (const ev of ["mousedown", "click"]) tsplit.addEventListener(ev, (e) => e.stopPropagation());
                row.append(tsplit, txWrap);
                E.addExpandButton(tx, "Open this region in the pop-up editor (its text to render)", openPop("text", tx));
            }
            // round 87: one LoRAs button; it opens the region's pop-up on its LoRAs tab
            const addL = E.loraButton(r.loras, "this region", () => E.editPrompt(r.id, null, "prompt", null, "loras"));
            row.classList.toggle("has-lora", E.loraCount(r.loras).on > 0);
            // on the row itself (round 73; on the opened region's options line until then), and in the row's right-click menu
            const del = E.ico("@close", "Delete region and its layers. Undo brings them back.\nRight-click the row: More for this region.", () => E.deleteRegion(r));
            del.classList.add("rg-rdel");
            row.addEventListener("contextmenu", (e) => {
                if (e.target.closest?.("textarea, input, select, .rg-llm-btn")) return;      // a field keeps the browser's menu, the LLM button its own
                e.preventDefault(); e.stopPropagation(); E.rowMenu(r, e);
            });
            // the row itself keeps what is used all the time, so the prompt gets the room (round 34); the rest is on
            // the options line of the opened region
            row.append(llmButton(r.id), ...(E.isEdit() ? [E.keepToggle(r)] : []), ...(E.controls().length ? [E.controlToggle(r)] : []), cnt, pal, addL, del);
            E.regList.appendChild(row);
        });
        E.regList.scrollTop = scroll;
        E.syncLoraAll();
        E.idxKey = "";
        E.updateRegionIndices();
    }
    function refreshChips(rid) {                   // trigger chips follow prompt edits
        const r = E.regionById(rid);
        const box = E.editor?.rid === rid ? E.editor.box.querySelector(".rg-pop-lorarows") : null;      // (the pop-up's LoRAs tab)
        if (!r || !box || !(r.loras || []).length) return;
        box.replaceChildren(regionLoraRows(r, true));
    }
    function markRegionRows() {
        const rows = [...E.regList.querySelectorAll(".rg-row.region")];
        const ids = E.state.regions.map((r) => r.id);
        rows.forEach((row, k) => row.classList.toggle("sel", ids[k] === E.curRegion));
    }
    function markLayerRows() {
        for (const row of (E.editor?.box.querySelectorAll(".rg-row.layer") || [])) row.classList.toggle("sel", Number(row.dataset.lid) === E.selId);
    }
}
