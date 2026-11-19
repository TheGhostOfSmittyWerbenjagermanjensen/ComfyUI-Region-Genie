// The pop-up editors for prompts, and the editor's keyboard shortcuts.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import {
    svgIcon, escReverts, popFootText, naturalHeight, popNavDir, popNavTip, appendWord, autocompleteOnFocus, autocompleteOpen, autocompleteToggle, SET,
    pickWildcard, insertAtCursor, wildcardsInstalled,
} from "../rg_shared.js";
import { recentSetting, rememberSetting, CLIPBOARD } from "./shared.js";

export function* popups(E) {
    Object.assign(E, {
        applyFieldFonts, closeEditor, editPrompt, editScene,
    });
    yield;

    // ---- pop-up editors: on top of the page (dragged anywhere on the screen), one at a time. The size: every node (a
    // hidden Setting); the text size: Settings > Region Genie > Text size, per kind of field (A− / A+ don't change the
    // pop-up's size). They stay open until Enter, Esc, ✕, another pop-up, or the node leaving the canvas (another
    // workflow tab, a subgraph); a click elsewhere doesn't close them. ◀ / ▶ step through every text field of the node.
    const POP_W = { scene: 640, region: 560 };
    const FS_POP = { scene: SET.fsPopScene, prompt: SET.fsPopRegion, text: SET.fsPopText };
    const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const popSizes = () => { try { const v = JSON.parse(recentSetting(SET.popSizes, "{}") || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } };
    const fsPop = (cat) => clampN(Math.round(+recentSetting(FS_POP[cat], 14)) || 14, 8, 40);
    function applyPopFont(ta, cat) { const f = fsPop(cat); ta.style.fontSize = f + "px"; ta.style.lineHeight = Math.round(f * 1.3) + "px"; }
    // size, then place (screen px): ed.at (stepped here with ◀ / ▶: the same place and size), else the saved size (or the
    // height with 14 px text) and autoPlace(w, h, W, H) next to the field it opens from; kept on the screen
    function popLayout(ed, kind, autoPlace) {
        const box = ed.box, W = window.innerWidth, H = window.innerHeight;
        const keepOn = () => {
            box.style.left = clampN(parseFloat(box.style.left) || 6, 0, Math.max(0, W - 60)) + "px";
            box.style.top = clampN(parseFloat(box.style.top) || 6, 0, Math.max(0, H - 40)) + "px";
        };
        if (ed.at) {
            box.style.width = clampN(Math.round(ed.at.width), 240, Math.max(240, W - 12)) + "px";
            box.style.height = clampN(Math.round(ed.at.height), 160, Math.max(160, H - 12)) + "px";
            box.classList.add("sized");
            if (!ed.placed) { ed.placed = true; box.style.left = ed.at.left + "px"; box.style.top = ed.at.top + "px"; }
            keepOn(); return;
        }
        const sz = popSizes()[kind] || {};
        const w = clampN(Math.round(sz.w || POP_W[kind]), 240, Math.max(240, W - 12));
        box.style.width = w + "px";
        box.classList.remove("sized");
        const h = sz.h || naturalHeight(box, [...box.querySelectorAll("textarea")]);
        box.style.height = clampN(Math.round(h), 160, Math.max(160, H - 12)) + "px";
        box.style.maxHeight = "";
        box.classList.add("sized");
        if (ed.placed) { keepOn(); return; }
        ed.placed = true;
        autoPlace(w, box.offsetHeight, W, H);
        keepOn();
    }
    // just below the element's screen rect r, else above it, else as low as fits
    const placeBy = (box, r, w, h, W, H, center = false) => {
        const top = r.bottom + 4 + h <= H - 6 ? r.bottom + 4 : (r.top - 4 - h >= 6 ? r.top - 4 - h : Math.max(6, H - 6 - h));
        const left = center ? (r.left + r.right) / 2 - w / 2 : r.left;
        box.style.left = clampN(left, 6, Math.max(6, W - w - 6)) + "px";
        box.style.top = top + "px";
    };
    // every text field of the node, in order: the scene prompts, then each region's prompt (list order)
    const popTargets = () => [["scene", "positive"], ["scene", "negative"], ...(E.sceneBgW?.__rgShown ? [["scene", "background"]] : []),
                              ...E.state.regions.map((r) => ["region", r.id])];
    function popStep(dir) {
        const ed = E.editor;
        if (!ed) return;
        const list = popTargets(), b = ed.box;
        const at = { left: b.offsetLeft, top: b.offsetTop, width: b.offsetWidth, height: b.offsetHeight };
        let i = list.findIndex((t) => t[0] === ed.target[0] && t[1] === ed.target[1]);
        const t = list[((i < 0 ? 0 : i) + dir + list.length) % list.length];
        if (t[0] === "scene") editScene(t[1], at); else editPrompt(t[1], null, "prompt", at);
    }
    // Esc in a pop-up: close it, putting the text back (or keeping it: Settings > Region Genie > Text size)
    const popEsc = () => closeEditor(!escReverts());
    // ◀ / ▶, A− / A+ (the field in use: curCat()), dragging by the title bar, the resize grip
    function popFrame(ed, kind, head, curCat, applyFonts) {
        const box = ed.box;
        const font = (d) => {
            const cat = curCat();
            rememberSetting(FS_POP[cat], clampN(fsPop(cat) + d, 8, 40));
            applyFonts();
        };
        const mkB = (text, tip, fn, cls) => {
            const b = E.el("button", "rg-btn " + cls); b.type = "button"; b.textContent = text; b.title = tip;
            b.addEventListener("click", (e) => { e.preventDefault(); fn(); });
            return b;
        };
        const fm = mkB("A−", "Smaller text in the box you're typing in (Settings > Region Genie > Text size). The pop-up keeps its size", () => font(-1), "rg-pop-font");
        const fp = mkB("A+", "Larger text in the box you're typing in (Settings > Region Genie > Text size). The pop-up keeps its size", () => font(1), "rg-pop-font");
        const prev = mkB("◀", popNavTip(-1, "scene prompts, then each region's prompt"), () => popStep(-1), "rg-nav prev");
        const next = mkB("▶", popNavTip(1, "scene prompts, then each region's prompt"), () => popStep(1), "rg-nav");
        const x = head.querySelector(".rg-x");
        head.insertBefore(fp, x?.previousElementSibling?.classList.contains("rg-wc-pick") ? x.previousElementSibling : x);
        head.insertBefore(fm, fp);
        head.insertBefore(prev, fm); head.insertBefore(next, fm);
        // the node's tag autocomplete switch (the same one as in the bottom bar: it acts on every field of the node)
        ed.acCtl = autocompleteToggle(E.node, E.el, true);
        head.insertBefore(ed.acCtl.el, fp.nextSibling);
        head.title = "Drag to move (anywhere on the screen).\nDouble-click: Back next to the field.";
        const drag = (e, onMove, onEnd) => {
            e.preventDefault(); e.stopPropagation();
            const t = e.currentTarget, x0 = e.clientX, y0 = e.clientY;
            t.setPointerCapture?.(e.pointerId);
            const move = (ev) => onMove(ev.clientX - x0, ev.clientY - y0);
            const up = () => { t.removeEventListener("pointermove", move); t.removeEventListener("pointerup", up); t.removeEventListener("pointercancel", up); onEnd?.(); };
            t.addEventListener("pointermove", move); t.addEventListener("pointerup", up); t.addEventListener("pointercancel", up);
        };
        head.addEventListener("pointerdown", (e) => {
            if (e.button !== 0 || e.target.closest("button, input, select, textarea")) return;
            const l0 = box.offsetLeft, t0 = box.offsetTop, W = window.innerWidth, H = window.innerHeight;
            drag(e, (dx, dy) => {
                box.style.left = clampN(l0 + dx, 0, Math.max(0, W - 60)) + "px";
                box.style.top = clampN(t0 + dy, 0, Math.max(0, H - 40)) + "px";
            });
        });
        head.addEventListener("dblclick", (e) => {
            if (e.target.closest("button, input, select, textarea")) return;
            ed.at = null; ed.placed = false; ed.place();
        });
        const grip = E.el("div", "rg-pop-grip");
        grip.title = "Drag to resize (remembered for every Region Genie node).\nDouble-click: Back to the default size.";
        grip.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            const w0 = box.offsetWidth, h0 = box.offsetHeight, W = window.innerWidth, H = window.innerHeight;
            drag(e, (dx, dy) => {
                box.style.width = clampN(w0 + dx, 240, Math.max(240, W - box.offsetLeft - 6)) + "px";
                box.style.height = clampN(h0 + dy, 160, Math.max(160, H - box.offsetTop - 6)) + "px";
                box.style.maxHeight = ""; box.classList.add("sized");
            }, () => {
                const all = popSizes(); all[kind] = { w: Math.round(box.offsetWidth), h: Math.round(box.offsetHeight) };
                rememberSetting(SET.popSizes, JSON.stringify(all));
                if (ed.at) ed.at = null;
            });
        });
        grip.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            const all = popSizes(); delete all[kind];
            rememberSetting(SET.popSizes, JSON.stringify(all));
            ed.at = null; ed.place();
        });
        box.appendChild(grip);
        applyFonts();
    }
    // text size of the node's own fields (Settings > Region Genie > Text size; 0 = as before)
    function applyFieldFonts() {
        const fs = (id) => clampN(Math.round(+recentSetting(id, 0)) || 0, 0, 40);
        const a = fs(SET.fsNodeScene), b = fs(SET.fsNodeRegion), c = fs(SET.fsNodeText);
        for (const t of Object.values(E.sceneTA)) {
            const want = a ? a + "px" : "";
            if (t.style.fontSize !== want) { t.style.fontSize = want; t.style.lineHeight = a ? Math.round(a * 1.3) + "px" : ""; }
        }
        for (const [n, f] of [["r", b], ["t", c]]) {
            if (f) { E.wrap.style.setProperty(`--rg-fs-${n}`, f + "px"); E.wrap.style.setProperty(`--rg-lh-${n}`, Math.round(f * 1.25) + "px"); }
            else { E.wrap.style.removeProperty(`--rg-fs-${n}`); E.wrap.style.removeProperty(`--rg-lh-${n}`); }
        }
    }
    function closeEditor(commit = true) {
        if (!E.editor) return;
        const ed = E.editor;
        if (ed.field) ed.endField(!commit);
        E.editor = null;
        ed.acCtl?.dispose();
        ed.box.remove();
        E.refreshUI();
        E.focusSink();
    }
    // rect: the label on the canvas it opens from; null = from the region's row in the list. focus: "prompt" | "text"
    // at: { left, top, width, height } to open at (stepping with ◀ / ▶)
    function editPrompt(rid, rect, focus = "prompt", at = null) {
        closeEditor(true);
        const r = E.regionById(rid);
        if (!r) return;
        if (E.activateRegion(rid)) E.refreshUI();
        const box = E.el("div", "rg-pop");
        const stop = (e) => e.stopPropagation();
        for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu"]) box.addEventListener(ev, stop);
        box.dataset.captureWheel = "true";
        box.addEventListener("keydown", (e) => {
            e.stopPropagation();                           // editor shortcuts (Delete, V, B, ...) stay off
            const dir = popNavDir(e);                 // the previous / next field key (Settings; Page Up / Page Down)
            if (dir && !autocompleteOpen(e.target, e)) { e.preventDefault(); popStep(dir); return; }
            if (e.key === "Escape" && !autocompleteOpen(e.target, e)) { e.preventDefault(); popEsc(); }
        });
        // header: number, color, close
        const head = E.el("div", "rg-pop-head");
        const num = E.el("span", "rg-idx");
        const title = E.el("span"); title.textContent = "Edit region";
        const sw = E.el("span", "rg-sw"); sw.dataset.swatch = String(r.id);
        const x = E.el("button", "rg-btn ico rg-x"); x.innerHTML = svgIcon("close"); x.title = "Close, keeping the edits (Enter).";
        x.addEventListener("click", (e) => { e.preventDefault(); closeEditor(true); });
        let lastTa = null;                         // the field the picker inserts into
        const wcPick = E.el("button", "rg-btn ico rg-wc-pick"); wcPick.innerHTML = svgIcon("wildcard");
        wcPick.title = "Insert a wildcard (ComfyUI Impact Pack) at the cursor";
        wcPick.addEventListener("click", (e) => pickWildcard(e, (name) => insertAtCursor(lastTa || prompt.ta, name)));
        wcPick.style.display = wildcardsInstalled() ? "" : "none";
        head.append(title, num, sw, wcPick, x);
        // type buttons
        const types = E.el("div", "rg-pop-types");
        const typeBtns = {};
        for (const [t, label] of [["object", "Object"], ["character", "Character"], ["text", "Text"]]) {
            const b = E.el("button", "rg-btn"); b.textContent = label;
            b.title = { object: "Object: A thing or area.", character: "Character: A person or character (also listed in character_boxes).",
                        text: "Text: The Text below is rendered in the image." }[t];
            b.addEventListener("click", (e) => { e.preventDefault(); if (r.type !== t) E.change(() => { r.type = t; }); });
            typeBtns[t] = b; types.appendChild(b);
        }
        // text fields
        const field = (label, key, rows, placeholder) => {
            const wrapF = E.el("div", "rg-pop-field");
            const lab = E.el("div", "rg-pop-lbl"); lab.textContent = label;
            const ta = E.el("textarea"); ta.rows = rows; ta.placeholder = placeholder; ta.spellcheck = false; ta.value = r[key] || "";
            const fkey = key === "prompt" ? "r" + r.id : `r${r.id}.text`;
            const use = E.el("button", "rg-btn ico rg-wc-use"); use.innerHTML = svgIcon("useFilled");
            use.addEventListener("click", (e) => {
                e.preventDefault();
                const f = E.filledFor(fkey, r[key] || "");
                if (f == null) return;
                E.change(() => { r[key] = f; });
                ta.value = f; syncUse();
            });
            const syncUse = () => {
                const f = E.filledFor(fkey, r[key] || "");
                use.style.display = f != null ? "" : "none";
                use.title = f != null ? `Use the filled text: Replace the wildcards with what they produced (last run or preview):\n${f}` : "";
            };
            lab.appendChild(use);
            ta.addEventListener("focus", () => { lastTa = ta; });
            ta.addEventListener("input", syncUse);
            ta.__rgSyncUse = syncUse;
            ta.addEventListener("focus", () => {
                if (E.editor?.field && E.editor.field.ta !== ta) E.editor.endField(false);
                if (E.editor) E.editor.field = { ta, key, before: E.snapshot(), orig: r[key] || "" };
            });
            ta.addEventListener("input", () => { r[key] = ta.value; E.save(); E.requestDraw(); });
            ta.addEventListener("blur", () => { if (E.editor?.field?.ta === ta) E.editor.endField(false); });
            ta.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey && !autocompleteOpen(ta, e)) { e.preventDefault(); closeEditor(true); }
            });
            wrapF.append(lab, ta);
            return { wrapF, ta };
        };
        const prompt = field("Prompt", "prompt", 8, "prompt: what is in this region");
        prompt.wrapF.classList.add("grow");
        autocompleteOnFocus(prompt.ta, E.node);
        const text = field("Text", "text", 3, "text to render");
        // feather, palette, LoRAs (rebuilt on every change)
        const dyn = E.el("div", "rg-pop-dyn");
        const foot = E.el("div", "rg-pop-foot");
        foot.textContent = popFootText();
        box.append(head, types, prompt.wrapF, text.wrapF, dyn, foot);
        document.body.appendChild(box);

        const ed = {
            rid, box, field: null, at, target: ["region", rid],
            // finish editing a text field: one undo step, or put the old text back (cancel)
            endField(cancel) {
                const f = ed.field;
                if (!f) return;
                ed.field = null;
                const rr = E.regionById(rid);
                if (!rr) return;
                if (cancel) {
                    if ((rr[f.key] || "") !== f.orig) { rr[f.key] = f.orig; f.ta.value = f.orig; E.save(); }
                } else if ((rr[f.key] || "") !== f.orig) {
                    E.pushUndo(f.before);
                    E.renderRegions();                       // the list shows the new text too
                }
                E.requestDraw();
            },
            refresh() {
                const rr = E.regionById(rid);
                if (!rr) { closeEditor(false); return; }
                const k = E.state.regions.indexOf(rr), idx = E.outputIndexMap()[k];
                num.textContent = idx == null ? "–" : String(idx);
                num.classList.toggle("none", idx == null);
                num.title = idx == null ? "No visible pixels yet" : `Output index ${idx}`;
                sw.style.background = E.colorOf(rid);
                box.style.borderColor = E.colorOf(rid) || "#5b8fd0";
                for (const [t, b] of Object.entries(typeBtns)) b.classList.toggle("on", rr.type === t);
                text.wrapF.style.display = rr.type === "text" ? "" : "none";
                prompt.ta.__rgSyncUse?.(); text.ta.__rgSyncUse?.();
                wcPick.style.display = wildcardsInstalled() ? "" : "none";
                for (const [f, key] of [[prompt, "prompt"], [text, "text"]]) {
                    if (document.activeElement !== f.ta && f.ta.value !== (rr[key] || "")) f.ta.value = rr[key] || "";
                }
                const ctl = E.el("div", "rg-row pop-ctl");
                const addL = E.ico("＋LoRA", "Apply a LoRA to this region (model output; MOSS-Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5)", (e) => { rr.loras = rr.loras || []; E.addLoraTo(rr.loras, e, () => E.openSub(rr.id, "loras")); }, "txt");
                ctl.append(E.llmButton(rr.id, "pop"), ...(E.isEdit() ? [E.keepToggle(rr)] : []), E.featherBox(rr), E.paletteToggle(rr), addL);
                const loras = E.el("div", "rg-pop-loras");
                if ((rr.loras || []).length) loras.appendChild(E.regionLoraRows(rr));
                dyn.replaceChildren(ctl, E.paletteRow(rr, true), loras);
                ed.place();
            },
            placed: false,
            place() { popLayout(ed, "region", (w, h, W, H) => {
                // from the list: below (else above) the region's row; from the canvas: below (else above) its label
                const row = !rect && E.regList.querySelector(`textarea.rg-prompt[data-rid="${rid}"]`)?.closest(".rg-row");
                if (row && row.offsetParent) { placeBy(box, row.getBoundingClientRect(), w, h, W, H); return; }
                const cr = E.cv.getBoundingClientRect(), k = cr.width / Math.max(1, E.cv.width);   // canvas px -> screen px
                if (!rect) { placeBy(box, { left: cr.left, right: cr.right, top: cr.top - 4, bottom: cr.top - 4 }, w, h, W, H, true); return; }
                placeBy(box, { left: cr.left + rect.x0 * k, right: cr.left + rect.x1 * k, top: cr.top + rect.y0 * k - 2,
                               bottom: cr.top + rect.y1 * k + 2 }, w, h, W, H, true);
            }); },
        };
        E.editor = ed;
        popFrame(ed, "region", head, () => (lastTa === text.ta ? "text" : "prompt"),
                 () => { applyPopFont(prompt.ta, "prompt"); applyPopFont(text.ta, "text"); });
        ed.refresh();
        const first = focus === "text" && r.type === "text" ? text : prompt;
        first.ta.focus(); first.ta.setSelectionRange(first.ta.value.length, first.ta.value.length);
    }
    // pop-up editor for scene_prompt_positive / _negative / _background (double-click the text box).
    // Positive: also the LLM Prompt Enhancer and the whole-image LoRAs. Enter or clicking elsewhere closes it,
    // Shift+Enter = new line, Esc closes it and puts the text back as it was.
    function editScene(which, at = null) {
        closeEditor(true);
        const pos = which === "positive";
        const w = { positive: E.sceneW, negative: E.sceneNegW, background: E.sceneBgW }[which];
        if (!w) return;
        const box = E.el("div", "rg-pop scene");
        const stop = (e) => e.stopPropagation();
        for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu"]) box.addEventListener(ev, stop);
        box.dataset.captureWheel = "true";
        box.addEventListener("keydown", (e) => {
            e.stopPropagation();
            const dir = popNavDir(e);                 // the previous / next field key (Settings; Page Up / Page Down)
            if (dir && !autocompleteOpen(e.target, e)) { e.preventDefault(); popStep(dir); return; }
            if (e.key === "Escape" && !autocompleteOpen(e.target, e)) { e.preventDefault(); popEsc(); }
        });
        const head = E.el("div", "rg-pop-head");
        const title = E.el("span");
        title.textContent = { positive: "Scene prompt (scene_prompt_positive)", negative: "Negative scene prompt (scene_prompt_negative)",
                              background: "Background (scene_prompt_background)" }[which];
        const x = E.el("button", "rg-btn ico rg-x"); x.innerHTML = svgIcon("close"); x.title = "Close, keeping the edits (Enter).";
        x.addEventListener("click", (e) => { e.preventDefault(); closeEditor(true); });
        const wcPickS = E.el("button", "rg-btn ico rg-wc-pick"); wcPickS.innerHTML = svgIcon("wildcard");
        wcPickS.title = "Insert a wildcard (ComfyUI Impact Pack) at the cursor";
        wcPickS.addEventListener("click", (e) => pickWildcard(e, (name) => insertAtCursor(ta, name)));
        wcPickS.style.display = wildcardsInstalled() ? "" : "none";
        head.append(title, wcPickS, x);
        const wrapF = E.el("div", "rg-pop-field grow");
        const ta = E.el("textarea"); ta.rows = 12; ta.spellcheck = false; ta.value = String(w.value ?? "");
        ta.placeholder = { positive: "the whole picture: setting, style, lighting ...", negative: "what to avoid in the whole picture",
                           background: "behind the regions: ground, floor, sky, room ..." }[which];
        const orig = ta.value;
        const skey = E.SCENE_KEYS[which];
        const useS = E.el("button", "rg-btn ico rg-wc-use"); useS.innerHTML = svgIcon("useFilled");
        const syncUseS = () => {
            const f = E.filledFor(skey, String(w.value ?? ""));
            useS.style.display = f != null ? "" : "none";
            useS.title = f != null ? `Use the filled text: Replace the wildcards with what they produced (last run or preview):\n${f}` : "";
        };
        useS.addEventListener("click", (e) => {
            e.preventDefault();
            const f = E.filledFor(skey, String(w.value ?? ""));
            if (f == null) return;
            E.setWidget(w, f); ta.value = f; syncUseS(); E.wcMarkScene();
        });
        ta.addEventListener("input", () => syncUseS());
        ta.addEventListener("input", () => { E.setWidget(w, ta.value); if (pos) E.updateLlmButtons(); });
        ta.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey && !autocompleteOpen(ta, e)) { e.preventDefault(); closeEditor(true); }
        });
        autocompleteOnFocus(ta, E.node);
        wrapF.append(ta);
        const dyn = E.el("div", "rg-pop-dyn");
        const foot = E.el("div", "rg-pop-foot");
        foot.textContent = popFootText();
        const useRow = E.el("div", "rg-pop-lbl"); useRow.append(useS);
        box.append(head, useRow, wrapF, dyn, foot);
        document.body.appendChild(box);
        const ed = {
            scene: which, which, box, field: { cancelable: true }, at, target: ["scene", which],
            endField(cancel) {
                ed.field = null;
                if (cancel && String(w.value ?? "") !== orig) { E.setWidget(w, orig); ta.value = orig; }
                if (pos) E.updateLlmButtons();
            },
            refresh() {
                if (document.activeElement !== ta && ta.value !== String(w.value ?? "")) ta.value = String(w.value ?? "");
                syncUseS(); wcPickS.style.display = wildcardsInstalled() ? "" : "none";
                box.style.borderColor = "#5b8fd0";
                if (!pos) { dyn.replaceChildren(); ed.place(); return; }
                const ctl = E.el("div", "rg-row pop-ctl");
                const lbl = E.el("span", "rg-hint"); lbl.textContent = "Whole image";
                lbl.title = "LoRAs here act on the whole picture (and all text), like a normal LoRA";
                const gap = E.el("span"); gap.style.flex = "1 1 auto";
                const addL = E.ico("＋LoRA", "Add a LoRA for the whole image", (e) => {
                    E.state.sceneLoras = E.state.sceneLoras || [];
                    E.addLoraTo(E.state.sceneLoras, e, () => E.expanded.add(E.SCENE));
                }, "txt");
                ctl.append(lbl, gap, E.llmButton(E.LLM_SCENE, "pop"), addL);
                const loras = E.el("div", "rg-pop-loras");
                if ((E.state.sceneLoras || []).length) {
                    loras.appendChild(E.loraRows(E.state.sceneLoras, {
                        prompt: () => String(E.sceneW?.value ?? ""),
                        append: (words) => {
                            let v = String(E.sceneW?.value ?? "");
                            for (const wd of words) v = appendWord(v, wd);
                            E.setWidget(E.sceneW, v); ta.value = v; E.renderRegions();
                        },
                    }));
                }
                dyn.replaceChildren(ctl, loras);
                ed.place();
            },
            placed: false,
            place() { popLayout(ed, "scene", (wd, h, W, H) => {
                // below (else above) the scene prompt's own text box; else at the top of the node's canvas
                const t = E.sceneTA[which];
                const r = t?.isConnected && t.offsetParent ? t.getBoundingClientRect() : null;
                if (r && r.width) { placeBy(box, r, wd, h, W, H); return; }
                const cr = E.cv.getBoundingClientRect();
                placeBy(box, { left: cr.left, right: cr.right, top: cr.top - 4, bottom: cr.top - 4 }, wd, h, W, H, true);
            }); },
        };
        E.editor = ed;
        popFrame(ed, "scene", head, () => "scene", () => applyPopFont(ta, "scene"));
        ed.refresh();
        ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    E.cv.addEventListener("pointerleave", () => { E.hover = null; E.requestDraw(); });
    E.cv.addEventListener("pointerenter", () => E.keepFocus());
    // the toolbar, the list and the bottom bar too: a shortcut pressed while pointing anywhere at the editor is
    // the editor's (R: rectangle), not ComfyUI's (R: refresh). A text field that has the focus keeps it.
    E.wrap.addEventListener("pointerenter", () => E.keepFocus());
    for (const ev of ["mousedown", "mousemove", "mouseup", "pointerdown", "pointermove", "pointerup", "contextmenu", "dblclick"]) {
        E.cvBox.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === "contextmenu") e.preventDefault(); });
    }
    E.cvBox.addEventListener("wheel", (e) => {
        e.preventDefault(); e.stopPropagation();
        const [dx, dy] = E.evDisplay(e);
        if (e.altKey || e.ctrlKey) {                       // Alt+wheel (Ctrl+wheel zooms the graph in Nodes 2.0)
            E.brush = Math.min(0.3, Math.max(0.002, E.brush * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
            E.updateBrushSlider();
        } else {
            const k = Math.pow(1.0015, -e.deltaY);
            const z = Math.min(64, Math.max(0.02, E.view.z * k));
            E.view.x = dx - (dx - E.view.x) * (z / E.view.z);
            E.view.y = dy - (dy - E.view.y) * (z / E.view.z);
            E.view.z = z;
            E.userView = true;
        }
        E.requestDraw();
    }, { passive: false });

    E.wrap.addEventListener("keydown", (e) => {
        if (E.isField(e.target)) return;
        const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
        if (mod && k === "c" && E.msgSelected()) { e.stopPropagation(); return; }     // copy the message text, not a layer
        // a pop-up editor stays open while the node is used; Esc here (nothing else pending) closes it, keeping the text
        if (E.editor && k === "escape" && !E.pick && !E.clickPoly) { e.preventDefault(); e.stopPropagation(); closeEditor(true); return; }
        const L = E.selLayer();
        // keys that act on the selected layer show its box again
        if (L && E.hiddenSel === E.selId && (["delete", "backspace", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k) || (mod && k === "d"))) {
            E.hiddenSel = null; E.requestDraw();
        }
        let handled = true;
        if (E.pick && k === "enter") E.pickAccept(e.shiftKey);
        else if (E.pick && k === "escape") E.pickCancel();
        else if (E.pick && k === "backspace") E.pickUndo();
        else if (E.clickPoly && (k === "enter")) E.finishClickPoly();
        else if (E.clickPoly && k === "escape") { E.clickPoly = null; E.requestDraw(); }
        else if (E.clickPoly && k === "backspace") { E.clickPoly.pts.pop(); if (!E.clickPoly.pts.length) E.clickPoly = null; E.requestDraw(); }
        else if (k === " ") E.spaceDown = true;
        else if (mod && k === "z") (e.shiftKey ? E.redo() : E.undo());
        else if (mod && k === "y") E.redo();
        else if (mod && k === "d") E.duplicate();
        else if (mod && k === "c" && L) E.copyLayer(L, false);
        else if (mod && k === "x" && L) E.copyLayer(L, true);
        else if (mod && k === "v" && CLIPBOARD.layer) E.pasteLayer();
        else if (k === "delete" || k === "backspace") E.deleteSelected();
        else if (k === "escape") { if (E.big && !E.selLayer()) E.closeBig(); else E.selectLayer(null); }      // large editor: Esc with nothing selected closes it
        else if (k === "v") E.setTool("select");
        else if (k === "b") E.setTool("brush");
        else if (k === "e") E.setTool("erase");
        else if (k === "f") E.setTool("fill");
        else if (k === "w") E.setTool("wand");
        else if (k === "q") E.setTool("object");
        else if (k === "l") E.setTool(e.shiftKey ? "lassoErase" : "lasso");
        else if (k === "r" || k === "o" || k === "t") {
            E.shapeKind = { r: "rect", o: "ellipse", t: "triangle" }[k]; E.setTool("shape");
        } else if (k === "g") { E.snap = !E.snap; E.setSnapIcon(); E.requestDraw(); }
        else if (k === "home") { E.userView = false; E.fitView(); E.requestDraw(); }
        else if (k === "[" || k === "]") { E.brush = Math.min(0.3, Math.max(0.002, E.brush * (k === "]" ? 1.2 : 1 / 1.2))); E.updateBrushSlider(); E.requestDraw(); }
        else if (L && k.startsWith("arrow")) {
            const s = E.short(), step = (e.shiftKey ? 10 : 1) * (E.snap ? E.grid : 1);
            E.change(() => {
                if (k === "arrowleft") L.ox -= step / s; if (k === "arrowright") L.ox += step / s;
                if (k === "arrowup") L.oy -= step / s; if (k === "arrowdown") L.oy += step / s;
            });
        } else handled = false;
        if (handled) { e.preventDefault(); e.stopPropagation(); }
    });
    E.wrap.addEventListener("keyup", (e) => { if (e.key === " ") E.spaceDown = false; });
}
