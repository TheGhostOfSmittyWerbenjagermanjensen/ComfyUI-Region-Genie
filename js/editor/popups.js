// The pop-up editors for prompts, and the editor's keyboard shortcuts.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import {
    svgIcon, popFootText, naturalHeight, popNavDir, popNavTip, appendWord, autocompleteOnFocus, autocompleteOpen, autocompleteToggle, SET,
    pickWildcard, insertAtCursor, wildcardsInstalled, textHistory, historyButtons, closeComfyMenus,
} from "../rg_shared.js";
import { recentSetting, rememberSetting, CLIPBOARD, SHAPES } from "./shared.js";
import { keyIs, keyUpIs } from "../rg_keys.js";

export function* popups(E) {
    Object.assign(E, {
        applyFieldFonts, closeEditor, editPrompt, editScene, markOpenField,
    });
    yield;

    // ---- pop-up editors: on top of the page (dragged anywhere on the screen), one at a time. The size: every node (a
    // hidden Setting); the text size: Settings > Region Genie > Text, per kind of field (A− / A+ don't change the
    // pop-up's size). They stay open until Esc, the close button, another pop-up, or the node leaving the canvas (another
    // workflow tab, a subgraph); a click elsewhere doesn't close them. They always keep their text: Enter is a new line,
    // and a change is taken back with the pop-up's own Undo / Redo (textHistory(): the steps of every field are kept
    // in E.textHist for as long as the node lives). ◀ / ▶ step through every text field of the node.
    const histOf = E.histOf;                       // (core.js: the node's own text boxes use the same steps)
    const POP_W = { scene: 640, region: 560 };
    const POP_MIN_W = { scene: 300, region: 430 };      // (a region's pop-up has five tabs and the layer rows: narrower would cut them)
    const CLOSE_TIP = "Close (Esc).\nThe text stays as it is: Undo takes a change back.";
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
            box.style.width = clampN(Math.round(ed.at.width), POP_MIN_W[kind], Math.max(POP_MIN_W[kind], W - 12)) + "px";
            box.style.height = clampN(Math.round(ed.at.height), 160, Math.max(160, H - 12)) + "px";
            box.classList.add("sized");
            if (!ed.placed) { ed.placed = true; box.style.left = ed.at.left + "px"; box.style.top = ed.at.top + "px"; }
            keepOn(); return;
        }
        const sz = popSizes()[kind] || {};
        const w = clampN(Math.round(sz.w || POP_W[kind]), POP_MIN_W[kind], Math.max(POP_MIN_W[kind], W - 12));
        box.style.width = w + "px";
        box.classList.remove("sized");
        const h = sz.h || naturalHeight(box, [...box.querySelectorAll("textarea")]);
        box.style.height = clampN(Math.round(h), 160, Math.max(160, H - 12)) + "px";
        box.style.maxHeight = "";
        box.classList.add("sized");
        if (ed.placed) { keepOn(); return; }
        ed.placed = true;
        // round 91: the height the pop-up ends up with is worked out before it is placed (a tab that holds more than
        // the saved size made it grow afterwards, and a pop-up that grew past the window's lower edge was pushed up
        // over its own field): so it goes below its field when it fits there, above it otherwise
        popGrow(box);
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
        if (t[0] === "scene") editScene(t[1], at, ed.tabs?.cur); else editPrompt(t[1], null, "prompt", at, ed.tabs?.cur);
    }
    // The tabs of a pop-up (round 87): what a row holds, each on its own tab (Prompt, LoRAs; layers and the rest later).
    // Every pane lies in the same place and the pop-up is as tall as the tallest one, so it keeps its size and its
    // place when the tab is switched. defs: [[id, label, tooltip]]; a single tab shows no tab bar.
    function popTabs(defs, first, onSwitch) {
        const bar = E.el("div", "rg-pop-tabs"), panes = E.el("div", "rg-pop-panes"), pane = {}, btn = {};
        const t = { bar, panes, pane, cur: null,
            show(id) { t.cur = id; for (const [k] of defs) { pane[k].classList.toggle("off", k !== id); btn[k].classList.toggle("on", k === id); } },
            // the number on a tab ("2/3"); lit: amber (something there is switched on)
            count(id, text, lit) { const c = btn[id].__cnt, t = text ? `(${text})` : ""; if (c.textContent !== t) c.textContent = t; c.classList.toggle("lit", !!lit); } };
        for (const [id, label, tip] of defs) {
            const b = E.el("button", "rg-btn"); b.type = "button"; b.title = tip; b.dataset.tab = id;
            const l = E.el("span"); l.textContent = label;
            const c = E.el("em"); b.__cnt = c;
            b.append(l, c);
            b.addEventListener("click", (e) => { e.preventDefault(); if (t.cur !== id) { t.show(id); onSwitch?.(id); } });
            btn[id] = b; bar.appendChild(b);
            pane[id] = E.el("div", "rg-pop-pane"); pane[id].dataset.pane = id; panes.appendChild(pane[id]);
        }
        if (defs.length < 2) bar.style.display = "none";
        t.show(defs.some((d) => d[0] === first) ? first : defs[0][0]);
        return t;
    }
    const TAB_TIPS = { prompt: "The prompt and what goes with it.", loras: "The LoRAs: On / off, the file, the strength, the trigger words. Drag a row by its grip to move it.",
                       layers: "The layers: What is drawn in this region. Drag a row by its grip to move it in front of or behind the others.",
                       palette: "The color palette: Up to 5 colors this region should use.",
                       options: "The rest: Feather, the region's place in the order, merging its layers, hiding and deleting it." };
    // a line of a pop-up's Options tab: what it is, then its controls
    const optLine = (label, ...kids) => {
        const l = E.el("span", "rg-pop-optl"); l.textContent = label;
        const c = E.el("span", "rg-row rg-pop-optc"); c.append(...kids.filter(Boolean));       // (rg-row: the small toggles take their look from it)
        return [l, c];
    };
    const optNote = (text) => { const n = E.el("span", "rg-hint"); n.textContent = text; return n; };
    // Undo / Redo in a pop-up while no text has the cursor (its LoRAs tab): the editor's own, so a LoRA moved, switched
    // or removed there comes back. In a text field the keys stay that field's (its own text steps).
    function popUndoKeys(e) {
        const t = e.target;
        if (t?.tagName === "TEXTAREA" || (t?.tagName === "INPUT" && !["checkbox", "button"].includes(t.type))) return false;
        const undo = keyIs(e, "edit.undo"), redo = keyIs(e, "edit.redo");
        if (!undo && !redo) return false;
        e.preventDefault();
        if (undo) E.undo(); else E.redo();
        return true;
    }
    // never a scroll bar: when what a pop-up holds is taller than the pop-up (a LoRA was added), it grows, up to the window
    // A control of a pop-up that is redrawn by its own click (a switch, a LoRA row) loses the keyboard focus with its
    // old element: the pop-up takes it, so Esc and the Undo keys still reach it. Only when nothing else has the focus.
    function popKeepFocus(box) {
        const a = document.activeElement;
        if (box.isConnected && (!a || a === document.body)) box.focus({ preventScroll: true });
    }
    // (a guideline of the owner's, not a law: no scroll bar where it can be avoided, and never a horizontal one. A
    // pop-up taller than the window scrolls: that is the one case left.)
    function popGrow(box) {
        const over = box.scrollHeight - box.clientHeight, H = window.innerHeight;
        if (over <= 1) return false;
        box.style.height = clampN(box.offsetHeight + over, 160, Math.max(160, H - 12)) + "px";
        return true;
    }
    function popFit(box) {
        const H = window.innerHeight;
        if (popGrow(box) && box.offsetTop + box.offsetHeight > H - 6) box.style.top = Math.max(6, H - 6 - box.offsetHeight) + "px";
    }
    // the LoRAs tab of a pop-up: the rows (or a line that says there are none), and ＋LoRA under them
    // headBox, label: the switch for all of the list's LoRAs (round 90), above the rows while there are any
    function fillLoraTab(headBox, label, rowsBox, addBox, list, rows, tip, onAdd) {
        const sw = E.loraSwitch(list, label);
        headBox.replaceChildren(...(sw ? [sw] : []));
        headBox.style.display = sw ? "" : "none";
        if (E.ownLoras(list).length) rowsBox.replaceChildren(rows());
        else { const h = E.el("span", "rg-hint"); h.textContent = "No LoRAs here yet."; rowsBox.replaceChildren(h); }
        addBox.replaceChildren(E.ico("＋LoRA", tip, onAdd, "txt"));
    }
    // ◀ / ▶, Undo / Redo (the field in use: curHist()), A− / A+ (the field in use: curCat()), dragging by the title bar,
    // the resize grip
    function popFrame(ed, kind, head, curCat, applyFonts, curHist) {
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
        const fm = mkB("A−", "Smaller text in the box you're typing in (Settings > Region Genie > Text). The pop-up keeps its size", () => font(-1), "rg-pop-font");
        const fp = mkB("A+", "Larger text in the box you're typing in (Settings > Region Genie > Text). The pop-up keeps its size", () => font(1), "rg-pop-font");
        const prev = mkB("◀", popNavTip(-1, "scene prompts, then each region's prompt"), () => popStep(-1), "rg-nav prev");
        const next = mkB("▶", popNavTip(1, "scene prompts, then each region's prompt"), () => popStep(1), "rg-nav");
        const x = head.querySelector(".rg-x");
        // Undo / Redo take back what was done last (round 93). Typing was last, and the Prompt tab is shown: the text's
        // own steps (curHist()). Anything else was last (a row moved, a switch, a LoRA, a region moved in the list), or
        // another tab is shown: the editor's Undo, the same as the buttons above the canvas. Before, the buttons only
        // knew the text, so a layer moved on the Layers tab could not be taken back from the pop-up.
        const edHist = { undo: () => { ed.last = "edit"; E.undo(); }, redo: () => { ed.last = "edit"; E.redo(); },
                         canUndo: () => E.undoStack.length > 0 || !!E.textDirty, canRedo: () => E.redoStack.length > 0 };
        const textLast = () => (!ed.tabs || ed.tabs.cur === "prompt") && ed.last !== "edit" && curHist();
        box.addEventListener("input", (e) => { if (e.target?.tagName === "TEXTAREA") { ed.last = "text"; ed.histBtns?.refresh(); } }, true);
        box.addEventListener("click", () => setTimeout(() => ed.histBtns?.refresh(), 0));           // another tab: the buttons may be ready or not
        ed.histBtns = historyButtons(() => (textLast() ? curHist() : edHist), undefined,
            ["Undo: Take back what was done last (Ctrl+Z).\nAfter typing: The text, step by step.\nAfter anything else: That change (a row moved, a switch, a LoRA), as the Undo button above the canvas does.",
             "Redo: Bring back what was taken back (Ctrl+Shift+Z / Ctrl+Y)."]);
        head.insertBefore(fp, x);
        head.insertBefore(fm, fp);
        head.insertBefore(prev, fm); head.insertBefore(next, fm);
        head.insertBefore(ed.histBtns.undo, fm); head.insertBefore(ed.histBtns.redo, fm);
        // the node's tag autocomplete switch (the same one as in the bottom bar: it acts on every field of the node):
        // it goes in the pop-up's bottom row, see popTools()
        ed.acCtl = autocompleteToggle(E.node, E.el, true);
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
                box.style.width = clampN(w0 + dx, POP_MIN_W[kind], Math.max(POP_MIN_W[kind], W - box.offsetLeft - 6)) + "px";
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
    // the tag autocomplete switch and the wildcard list of a pop-up, for the right end of its bottom row (left of the
    // LLM button where there is one)
    const popTools = (ed, wcPick) => {
        wcPick.style.display = wildcardsInstalled() ? "" : "none";
        return [ed.acCtl.el, wcPick];
    };
    const flexGap = () => { const g = E.el("span", "rg-pop-gap"); return g; };
    // text size of the node's own fields (Settings > Region Genie > Text; 0 = as before)
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
    // The text field whose pop-up is open is outlined (round 91): a region's prompt (and its text to render) in the
    // list, a scene prompt's own box on the node, and its box in the large editor. The list's fields are made anew
    // with every redraw, so this is called after each (renderRegions) as well as when a pop-up opens or closes.
    function markOpenField() {
        const ed = E.editor, open = new Set();
        if (ed?.rid != null) for (const t of E.regList.querySelectorAll(`.rg-row.region[data-rid="${ed.rid}"] textarea`)) open.add(t);
        if (ed?.scene) { const t = E.sceneTA[ed.scene]; if (t) open.add(t); const b = E.big?.fields?.find((f) => f.which === ed.scene)?.ta; if (b) open.add(b); }
        for (const t of [...E.regList.querySelectorAll("textarea.rg-pop-open"), ...Object.values(E.sceneTA), ...(E.big?.fields || []).map((f) => f.ta)]) if (t && !open.has(t)) t.classList.remove("rg-pop-open");
        for (const t of open) t.classList.add("rg-pop-open");
    }
    function closeEditor(commit = true) {
        if (!E.editor) return;
        const ed = E.editor;
        if (ed.field) ed.endField(!commit);
        E.editor = null;
        markOpenField();
        ed.pal?.flush?.(); ed.pal?.picker?.close();        // the Palette tab's color picker: its last change is kept
        ed.acCtl?.dispose();
        ed.box.remove();
        E.refreshUI();
        E.focusSink();
    }
    // rect: the label on the canvas it opens from; null = from the region's row in the list. focus: "prompt" | "text"
    // at: { left, top, width, height } to open at (stepping with ◀ / ▶)
    // tab: the tab it opens on ("prompt" | "loras")
    function editPrompt(rid, rect, focus = "prompt", at = null, tab = "prompt") {
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
            if (popUndoKeys(e)) return;
            const dir = popNavDir(e);                 // the previous / next field key (Settings; Page Up / Page Down)
            if (dir && !autocompleteOpen(e.target, e)) { e.preventDefault(); popStep(dir); return; }
            if (e.key === "Escape" && !autocompleteOpen(e.target, e)) { e.preventDefault(); if (!closeComfyMenus()) closeEditor(true); }
        });
        // header: number, color, close
        const head = E.el("div", "rg-pop-head");
        const num = E.el("span", "rg-idx");
        const title = E.el("span"); title.textContent = "Edit region";
        const sw = E.el("span", "rg-sw"); sw.dataset.swatch = String(r.id);
        const x = E.el("button", "rg-btn ico rg-x"); x.innerHTML = svgIcon("close"); x.title = CLOSE_TIP;
        x.addEventListener("click", (e) => { e.preventDefault(); closeEditor(true); });
        let lastTa = null;                         // the field the picker inserts into, and Undo / Redo act on
        const wcPick = E.el("button", "rg-btn ico rg-wc-pick"); wcPick.innerHTML = svgIcon("wildcard");
        wcPick.title = "Insert a wildcard (ComfyUI Impact Pack) at the cursor";
        wcPick.addEventListener("mousedown", (e) => e.preventDefault());            // the text box keeps the cursor
        wcPick.addEventListener("click", (e) => pickWildcard(e, (name) => { const t = lastTa || prompt.ta; insertAtCursor(t, name); t.__rgHist?.sync(); }));
        head.append(title, num, sw, x);
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
                ta.value = f; syncUse(); ta.__rgHist?.sync();
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
                if (E.editor) E.editor.field = { ta, key, orig: r[key] || "" };
            });
            E.textSession(ta);                         // a visit to the box is one step of the editor's Undo
            const store = () => { const rr = E.regionById(rid) || r; rr[key] = ta.value; E.save(); E.requestDraw(); };
            ta.addEventListener("input", store);
            ta.addEventListener("blur", () => { if (E.editor?.field?.ta === ta) E.editor.endField(false); });
            // Undo / Redo of this text (the steps are kept per field: closing the pop-up doesn't lose them)
            ta.__rgHist = textHistory(ta, histOf(`${fkey}`), { apply: () => { store(); syncUse(); }, onChange: () => E.editor?.histBtns?.refresh() });
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
        // round 88: everything that was under the region's row in the list is on a tab here
        const tabs = popTabs([["prompt", "Prompt", TAB_TIPS.prompt], ["loras", "LoRAs", TAB_TIPS.loras], ["layers", "Layers", TAB_TIPS.layers],
                              ["palette", "Palette", TAB_TIPS.palette], ["options", "Options", TAB_TIPS.options]], tab,
                             (id) => { if (id === "prompt") prompt.ta.focus(); else box.focus(); });
        const loraRowsBox = E.el("div", "rg-pop-lorarows"), loraAddBox = E.el("div", "rg-row rg-pop-addl"), loraHeadBox = E.el("div", "rg-pop-lorahead");
        const layerRowsBox = E.el("div", "rg-pop-layers"), layerBar = E.el("div", "rg-row rg-pop-addl");
        const palBox = E.el("div", "rg-pop-pal"), optBox = E.el("div", "rg-pop-opts");
        tabs.pane.prompt.append(types, prompt.wrapF, text.wrapF, dyn);
        tabs.pane.loras.append(loraHeadBox, loraRowsBox, loraAddBox);
        tabs.pane.layers.append(layerRowsBox, layerBar);
        tabs.pane.palette.append(palBox);
        tabs.pane.options.append(optBox);
        box.tabIndex = -1;
        box.append(head, tabs.bar, tabs.panes, foot);
        document.body.appendChild(box);

        const ed = {
            rid, box, field: null, at, target: ["region", rid], tabs, pal: {},
            // finish editing a text field: one undo step (E.endText()), or put the old text back (cancel: the region is gone)
            endField(cancel) {
                const f = ed.field;
                if (!f) return;
                ed.field = null;
                const rr = E.regionById(rid);
                if (!rr) { E.endText(); return; }
                if (cancel) {
                    if ((rr[f.key] || "") !== f.orig) { rr[f.key] = f.orig; f.ta.value = f.orig; E.save(); }
                    E.endText();
                } else {
                    E.endText();
                    if ((rr[f.key] || "") !== f.orig) E.renderRegions();       // the list shows the new text too
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
                box.style.borderColor = E.colorOf(rid) || "var(--rg-accent,#5b8fd0)";
                for (const [t, b] of Object.entries(typeBtns)) b.classList.toggle("on", rr.type === t);
                text.wrapF.style.display = rr.type === "text" ? "" : "none";
                prompt.ta.__rgSyncUse?.(); text.ta.__rgSyncUse?.();
                for (const [f, key] of [[prompt, "prompt"], [text, "text"]]) {
                    if (document.activeElement !== f.ta && f.ta.value !== (rr[key] || "")) f.ta.value = rr[key] || "";
                    f.ta.__rgHist.sync();                    // a change made elsewhere (the LLM, the list) is a step too
                }
                // one row (round 43). Left: the color palette (its on / off button, the colors, +). Right: everything
                // else: kept / changed (Edit Mode), feather, the tag list, the wildcard list, the LLM, ＋LoRA
                // the Prompt tab's bottom row: what belongs to the text (the tag list, the wildcard list, the LLM)
                const ctl = E.el("div", "rg-row pop-ctl");
                ctl.append(flexGap(), ...popTools(ed, wcPick), E.llmButton(rr.id, "pop"));
                dyn.replaceChildren(ctl);
                // the Layers tab: the region's pose figures and layers (the rows the list had), a new layer, merge all
                const lays = E.listedOf(rid), nPose = E.posesOf(rid).length;
                tabs.count("layers", lays.length + nPose ? String(lays.length + nPose) : "", false);
                const act = document.activeElement, keepLid = layerRowsBox.contains(act) && act.tagName === "INPUT" ? act.closest(".rg-row.layer")?.dataset.lid : null;
                if (lays.length + nPose) layerRowsBox.replaceChildren(E.layerRows(rid));
                else layerRowsBox.replaceChildren(optNote("No layers yet: Draw on the canvas with this region selected, or add an empty layer."));
                if (keepLid) layerRowsBox.querySelector(`.rg-row.layer[data-lid="${keepLid}"] input[type=text]`)?.focus();
                const addLay = E.ico("@layerAdd", "Add an empty layer on top of this region's layers; brush, lasso and fill then go into it", () => { E.curRegion = rid; E.addLayerBtn.click(); });
                const mergeAll = E.ico("@mergeAll", "Merge all visible layers of this region into one layer", () => E.mergeRegion(rid));
                mergeAll.disabled = lays.filter((l) => l.visible !== false).length < 2;
                layerBar.replaceChildren(addLay, mergeAll);
                // the Palette tab
                E.paletteTab(palBox, rr, ed.pal);
                const palN = (rr.palette || []).length;
                tabs.count("palette", palN ? String(palN) : "", palN > 0 && !!rr.paletteOn);
                // the Options tab: one line per thing
                const k2 = E.state.regions.indexOf(rr), nReg = E.state.regions.length;
                const swap = (d) => E.change(() => { [E.state.regions[k2 + d], E.state.regions[k2]] = [E.state.regions[k2], E.state.regions[k2 + d]]; E.sortLayersByRegions(); });
                const up = E.ico("@up", "Move up: Earlier in the output order, and its layers in front", () => swap(-1)); up.disabled = k2 <= 0;
                const down = E.ico("@down", "Move down: Later in the output order, and its layers behind", () => swap(1)); down.disabled = k2 >= nReg - 1;
                const eye = E.ico(rr.hidden ? "@eyeOff" : "@eye", rr.hidden ? "Hidden: Not drawn and not output. Click to show it again"
                    : "Show / hide this region: A hidden region is not drawn and is left out of every output", () => E.change(() => { if (rr.hidden) delete rr.hidden; else rr.hidden = true; }));
                const del = E.ico("@close", "Delete region and its layers. Undo brings them back.", () => E.deleteRegion(rr));
                optBox.replaceChildren(
                    ...optLine("Feather", E.featherBox(rr), optNote("px; the chain shares the value with the other regions")),
                    ...(E.isEdit() ? optLine("Edit Mode", E.keepToggle(rr), optNote("whether this region is kept or changed")) : []),
                    ...(E.controls().length ? optLine("Control", E.controlToggle(rr), optNote("whether the Control rows act in this region")) : []),
                    ...optLine("Order", up, down, optNote(`region ${k2 + 1} of ${nReg}; the top one is in front`)),
                    ...optLine("Show", eye, optNote(rr.hidden ? "hidden: not drawn, not output" : "shown")),
                    ...optLine("Delete", del, optNote("the region and its layers")));
                // the LoRAs tab (round 87; they were rows under the prompt)
                const n = E.loraCount(rr.loras);
                tabs.count("loras", n.all ? (n.on === n.all ? String(n.on) : `${n.on}/${n.all}`) : "", n.on > 0);
                fillLoraTab(loraHeadBox, "This region's LoRAs", loraRowsBox, loraAddBox, rr.loras, () => E.regionLoraRows(rr, true),
                    "Apply a LoRA to this region (model output; MOSS-Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5)",
                    (e) => { rr.loras = rr.loras || []; E.addLoraTo(rr.loras, e); });
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
            }); popFit(box); popKeepFocus(box); },
        };
        E.editor = ed;
        markOpenField();
        popFrame(ed, "region", head, () => (lastTa === text.ta ? "text" : "prompt"),
                 () => { applyPopFont(prompt.ta, "prompt"); applyPopFont(text.ta, "text"); }, () => (lastTa || prompt.ta).__rgHist);
        ed.refresh();
        const first = focus === "text" && r.type === "text" ? text : prompt;
        if (tabs.cur !== "prompt") { box.focus(); return; }
        first.ta.focus(); first.ta.setSelectionRange(first.ta.value.length, first.ta.value.length);
    }
    // pop-up editor for scene_prompt_positive / _negative / _background (double-click the text box).
    // Positive: also the LLM Prompt Enhancer and the whole-image LoRAs. Esc or the close button closes it (the text
    // stays), Enter is a new line.
    function editScene(which, at = null, tab = "prompt") {
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
            if (popUndoKeys(e)) return;
            const dir = popNavDir(e);                 // the previous / next field key (Settings; Page Up / Page Down)
            if (dir && !autocompleteOpen(e.target, e)) { e.preventDefault(); popStep(dir); return; }
            if (e.key === "Escape" && !autocompleteOpen(e.target, e)) { e.preventDefault(); if (!closeComfyMenus()) closeEditor(true); }
        });
        const head = E.el("div", "rg-pop-head");
        const title = E.el("span");
        title.textContent = { positive: "Scene prompt (scene_prompt_positive)", negative: "Negative scene prompt (scene_prompt_negative)",
                              background: "Background (scene_prompt_background)" }[which];
        const x = E.el("button", "rg-btn ico rg-x"); x.innerHTML = svgIcon("close"); x.title = CLOSE_TIP;
        x.addEventListener("click", (e) => { e.preventDefault(); closeEditor(true); });
        const wcPickS = E.el("button", "rg-btn ico rg-wc-pick"); wcPickS.innerHTML = svgIcon("wildcard");
        wcPickS.title = "Insert a wildcard (ComfyUI Impact Pack) at the cursor";
        wcPickS.addEventListener("mousedown", (e) => e.preventDefault());           // the text box keeps the cursor
        wcPickS.addEventListener("click", (e) => pickWildcard(e, (name) => { insertAtCursor(ta, name); hist.sync(); }));
        head.append(title, x);
        const wrapF = E.el("div", "rg-pop-field grow");
        const ta = E.el("textarea"); ta.rows = 12; ta.spellcheck = false; ta.value = String(w.value ?? "");
        ta.placeholder = { positive: "the whole picture: setting, style, lighting ...", negative: "what to avoid in the whole picture",
                           background: "behind the regions: ground, floor, sky, room ..." }[which];
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
            E.setWidget(w, f); ta.value = f; syncUseS(); E.wcMarkScene(); hist.sync();
        });
        const store = () => { E.setWidget(w, ta.value); E.sceneTA[which]?.__rgPlaceExpand?.(); if (pos) E.updateLlmButtons(); };
        ta.addEventListener("input", () => syncUseS());
        ta.addEventListener("input", store);
        E.textSession(ta);                             // a visit to the box is one step of the editor's Undo
        // Undo / Redo of this text (the steps are kept per field: closing the pop-up doesn't lose them)
        const hist = textHistory(ta, histOf("scene:" + which), { apply: () => { store(); syncUseS(); E.wcMarkScene?.(); }, onChange: () => E.editor?.histBtns?.refresh() });
        autocompleteOnFocus(ta, E.node);
        wrapF.append(ta);
        const dyn = E.el("div", "rg-pop-dyn");
        const foot = E.el("div", "rg-pop-foot");
        foot.textContent = popFootText();
        const useRow = E.el("div", "rg-pop-lbl"); useRow.append(useS);
        // the scene prompt's pop-up has the whole image's LoRAs on a tab of their own (round 87); the others have one pane
        const tabs = popTabs(pos ? [["prompt", "Prompt", TAB_TIPS.prompt], ["loras", "LoRAs", TAB_TIPS.loras]] : [["prompt", "Prompt", TAB_TIPS.prompt]], tab,
                             (id) => { if (id === "prompt") ta.focus(); else box.focus(); });
        const loraRowsBox = E.el("div", "rg-pop-lorarows"), loraAddBox = E.el("div", "rg-row rg-pop-addl"), loraHeadBox = E.el("div", "rg-pop-lorahead");
        tabs.pane.prompt.append(useRow, wrapF, dyn);
        if (pos) tabs.pane.loras.append(loraHeadBox, loraRowsBox, loraAddBox);
        box.tabIndex = -1;
        box.append(head, tabs.bar, tabs.panes, foot);
        document.body.appendChild(box);
        const ed = {
            scene: which, which, box, field: { cancelable: true }, at, target: ["scene", which], tabs,
            endField() {
                ed.field = null;
                E.endText();
                if (pos) E.updateLlmButtons();
            },
            refresh() {
                if (document.activeElement !== ta && ta.value !== String(w.value ?? "")) ta.value = String(w.value ?? "");
                hist.sync();                                 // a change made elsewhere (the LLM, a LoRA's words) is a step too
                syncUseS();
                box.style.borderColor = "var(--rg-accent,#5b8fd0)";
                const ctl = E.el("div", "rg-row pop-ctl");
                // the bottom row, on the right: the tag list and the wildcard list (then, positive only: the LLM, ＋LoRA)
                if (!pos) {
                    const tools = popTools(ed, wcPickS);
                    ctl.append(flexGap(), ...tools);
                    ctl.style.display = tools.some((t) => t.style.display !== "none") ? "" : "none";
                    dyn.replaceChildren(ctl); ed.place(); return;
                }
                ctl.append(flexGap(), ...popTools(ed, wcPickS), E.llmButton(E.LLM_SCENE, "pop"));
                dyn.replaceChildren(ctl);
                const n = E.loraCount(E.state.sceneLoras);
                tabs.count("loras", n.all ? (n.on === n.all ? String(n.on) : `${n.on}/${n.all}`) : "", n.on > 0);
                fillLoraTab(loraHeadBox, "The whole image's LoRAs", loraRowsBox, loraAddBox, E.state.sceneLoras, () => E.loraRows(E.state.sceneLoras, {
                    pop: true, sceneOnly: true,
                    prompt: () => String(E.sceneW?.value ?? ""),
                    append: (words) => {
                        let v = String(E.sceneW?.value ?? "");
                        for (const wd of words) v = appendWord(v, wd);
                        E.setWidget(E.sceneW, v); ta.value = v; E.renderRegions(); E.editor?.refresh();
                    },
                }), "Add a LoRA for the whole image", (e) => { E.state.sceneLoras = E.state.sceneLoras || []; E.addLoraTo(E.state.sceneLoras, e); });
                ed.place();
            },
            placed: false,
            place() { popLayout(ed, "scene", (wd, h, W, H) => {
                // in the large editor: left of its scene box (the node's own field is behind the window)
                const bf = E.big?.fields?.find((f) => f.which === which)?.ta;
                if (bf?.isConnected && bf.offsetWidth) {
                    const br = bf.getBoundingClientRect();
                    box.style.left = Math.max(6, br.left - wd - 8) + "px";
                    box.style.top = clampN(br.top, 6, Math.max(6, H - h - 6)) + "px";
                    return;
                }
                // below (else above) the scene prompt's own text box; else at the top of the node's canvas
                const t = E.sceneTA[which];
                const r = t?.isConnected && t.offsetParent ? t.getBoundingClientRect() : null;
                if (r && r.width) { placeBy(box, r, wd, h, W, H); return; }
                const cr = E.cv.getBoundingClientRect();
                placeBy(box, { left: cr.left, right: cr.right, top: cr.top - 4, bottom: cr.top - 4 }, wd, h, W, H, true);
            }); popFit(box); popKeepFocus(box); },
        };
        E.editor = ed;
        markOpenField();
        popFrame(ed, "scene", head, () => "scene", () => applyPopFont(ta, "scene"), () => hist);
        ed.refresh();
        if (tabs.cur !== "prompt") { box.focus(); return; }
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
        // every key below is a command of the shortcut table (rg_keys.js): the user can give it another key
        const is = (id) => keyIs(e, id);
        const nudge = ["left", "right", "up", "down"].find((d) => is("nudge." + d));
        if (L && E.hiddenSel === E.selId && (is("edit.delete") || nudge || is("edit.duplicate"))) {
            E.hiddenSel = null; E.requestDraw();
        }
        let handled = true;
        const shape = SHAPES.map((s) => s[0]).find((s) => is("tool." + s));
        // while an outline or a selection is being made, its keys come first
        if (E.pick && is("draw.accept")) E.pickAccept(e.shiftKey);
        else if (E.pick && is("draw.cancel")) E.pickCancel();
        else if (E.pick && is("draw.back")) E.pickUndo();
        else if (E.clickPoly && is("draw.accept")) E.finishClickPoly();
        else if (E.clickPoly && is("draw.cancel")) { E.clickPoly = null; E.requestDraw(); }
        else if (E.clickPoly && is("draw.back")) { E.clickPoly.pts.pop(); if (!E.clickPoly.pts.length) E.clickPoly = null; E.requestDraw(); }
        else if (is("view.pan")) E.spaceDown = true;
        else if (is("edit.undo")) E.undo();
        else if (is("edit.redo")) E.redo();
        else if (is("edit.duplicate") && E.poseKey("duplicate")) { /* the selected pose figure (pose.js) */ }
        else if (is("edit.delete") && E.poseKey("delete")) { /* " */ }
        else if (is("edit.deselect") && E.poseKey("deselect")) { /* " */ }
        else if (is("tool.pose")) E.setTool("pose");
        else if (is("edit.duplicate")) E.duplicate();
        else if (is("edit.copy") && L) E.copyLayer(L, false);
        else if (is("edit.cut") && L) E.copyLayer(L, true);
        else if (is("edit.paste") && CLIPBOARD.layer) E.pasteLayer();
        else if (is("edit.delete")) E.deleteSelected();
        else if (is("edit.deselect")) { if (E.big && !E.selLayer()) E.closeBig(); else E.selectLayer(null); }      // large editor: with nothing selected it closes
        else if (is("tool.select")) E.setTool("select");
        else if (is("tool.brush")) E.setTool("brush");
        else if (is("tool.erase")) E.setTool("erase");
        else if (is("tool.fill")) E.setTool("fill");
        else if (is("tool.wand")) E.setTool("wand");
        else if (is("tool.object")) E.setTool("object");
        else if (is("tool.lassoErase")) E.setTool("lassoErase");
        else if (is("tool.lasso")) E.setTool("lasso");
        else if (shape) { E.shapeKind = shape; E.setTool("shape"); }
        else if (is("view.grid")) { E.showGrid = !E.showGrid; E.setSnapIcon(); E.requestDraw(); }
        else if (is("view.snap")) { E.snap = !E.snap; E.setSnapIcon(); E.requestDraw(); }
        else if (is("view.help")) E.toggleKeys();
        else if (is("view.fit")) { E.userView = false; E.fitView(); E.requestDraw(); }
        else if (is("brush.smaller") || is("brush.larger")) { E.brush = Math.min(0.3, Math.max(0.002, E.brush * (is("brush.larger") ? 1.2 : 1 / 1.2))); E.updateBrushSlider(); E.requestDraw(); }
        else if (L && nudge) {
            const s = E.short(), step = (e.shiftKey ? 10 : 1) * (E.snap ? E.grid : 1);
            E.change(() => {
                if (nudge === "left") L.ox -= step / s; if (nudge === "right") L.ox += step / s;
                if (nudge === "up") L.oy -= step / s; if (nudge === "down") L.oy += step / s;
            });
        } else handled = false;
        if (handled) { e.preventDefault(); e.stopPropagation(); }
    });
    E.wrap.addEventListener("keyup", (e) => { if (keyUpIs(e, "view.pan")) E.spaceDown = false; });
}
