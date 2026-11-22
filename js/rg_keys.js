// Region Genie: the editor's shortcuts as a table of commands, the keys the user gave them, and the sheet that lists
// and changes them ("?" over a node, the keyboard button in a node's bottom bar, Settings > Region Genie > Shortcuts).
//
// - COMMANDS is the one list. The editor's key handler asks keyIs(event, "edit.undo"), tooltips and hints ask
//   keyText("edit.undo") / keyTip("edit.undo"), the sheet shows and edits it: a shortcut is never written twice.
// - The user's keys are saved in one hidden Setting (SET.shortcuts, a JSON text: { "<command id>": ["Ctrl+Z", …] });
//   only commands that differ from the default are in it. Three commands are older Settings of their own (the large
//   editor's key, previous / next text field): those Settings stay their storage ('setting' below).
// - A change sends the window event "rg-shortcuts", so open editors rewrite their tooltips and hints.
// - Mouse gestures and held modifiers (Shift for equal sides, the wheel …) are listed too, but can't be changed.
//
// This file imports rg_shared.js, so rg_shared.js must never import this one at load: ComfyUI loads the pack's files in
// any order, and with the two importing each other the pack failed to start whenever this file came first (round 39;
// tests/ui_load_order.cjs loads every file first once). rg_shared.js's Settings row loads this file when it is used.
import { getSetting, setSetting, SET, parseKey, keyLabel, svgIcon, KEYS } from "./rg_shared.js";

export const SHORTCUTS_EVENT = "rg-shortcuts";
const MAX_KEYS = 2;                                  // keys per command

// ctx: where the key acts. "main": the editor (default). "draw": only while an outline or a selection is being made
// (it wins over "main" then, so Enter / Backspace / Esc can mean two things). "text": a pop-up editor's text box.
// shiftFree: Shift with it is a variation of the same command, not another key. hold: acts while held down.
export const COMMANDS = [
    { id: "tool.select", group: "Tools", what: "Select: Move, resize and rotate layers", keys: ["V"] },
    { id: "tool.rect", group: "Tools", what: "Shape: Rectangle", keys: ["R"] },
    { id: "tool.roundrect", group: "Tools", what: "Shape: Rounded rectangle", keys: ["Shift+R"] },
    { id: "tool.ellipse", group: "Tools", what: "Shape: Ellipse", keys: ["O"] },
    { id: "tool.triangle", group: "Tools", what: "Shape: Triangle", keys: ["T"] },
    { id: "tool.pentagon", group: "Tools", what: "Shape: Pentagon", keys: ["N"] },
    { id: "tool.hexagon", group: "Tools", what: "Shape: Hexagon", keys: ["X"] },
    { id: "tool.star", group: "Tools", what: "Shape: Star", keys: ["S"] },
    { id: "tool.heart", group: "Tools", what: "Shape: Heart", keys: ["H"] },
    { id: "tool.brush", group: "Tools", what: "Brush", keys: ["B"] },
    { id: "tool.erase", group: "Tools", what: "Eraser", keys: ["E"] },
    { id: "tool.lasso", group: "Tools", what: "Lasso", keys: ["L"] },
    { id: "tool.lassoErase", group: "Tools", what: "Lasso erase", keys: ["Shift+L"] },
    { id: "tool.fill", group: "Tools", what: "Fill", keys: ["F"] },
    { id: "tool.wand", group: "Tools", what: "Magic wand", keys: ["W"] },
    { id: "tool.object", group: "Tools", what: "Select object", keys: ["Q"] },
    { id: "tool.pose", group: "Tools", what: "Pose: Stick figures for pose control", keys: ["P"] },
    { id: "brush.smaller", group: "Tools", what: "Brush size: Smaller", keys: ["["] },
    { id: "brush.larger", group: "Tools", what: "Brush size: Larger", keys: ["]"] },
    { id: "draw.accept", group: "While drawing", ctx: "draw", shiftFree: true, keys: ["Enter"],
      what: "Close the lasso outline. Select object: Add the selection (with Shift: one region for each object found)" },
    { id: "draw.back", group: "While drawing", ctx: "draw", what: "Take back the last point", keys: ["Backspace"] },
    { id: "draw.cancel", group: "While drawing", ctx: "draw", what: "Cancel the outline or the selection", keys: ["Escape"] },
    { id: "edit.undo", group: "Layers and regions", what: "Undo (in a pop-up editor: Its text)", keys: ["Ctrl+Z"] },
    { id: "edit.redo", group: "Layers and regions", what: "Redo (in a pop-up editor: Its text)", keys: ["Ctrl+Shift+Z", "Ctrl+Y"] },
    { id: "edit.duplicate", group: "Layers and regions", what: "Duplicate the selected layer", keys: ["Ctrl+D"] },
    { id: "edit.copy", group: "Layers and regions", what: "Copy the selected layer", keys: ["Ctrl+C"] },
    { id: "edit.cut", group: "Layers and regions", what: "Cut the selected layer", keys: ["Ctrl+X"] },
    { id: "edit.paste", group: "Layers and regions", what: "Paste the layer (also into another Region Genie node)", keys: ["Ctrl+V"] },
    { id: "edit.delete", group: "Layers and regions", what: "Delete the selected layer", keys: ["Delete", "Backspace"] },
    { id: "nudge.left", group: "Layers and regions", shiftFree: true, what: "Move the selected layer left (with Shift: ×10)", keys: ["ArrowLeft"] },
    { id: "nudge.right", group: "Layers and regions", shiftFree: true, what: "Move the selected layer right (with Shift: ×10)", keys: ["ArrowRight"] },
    { id: "nudge.up", group: "Layers and regions", shiftFree: true, what: "Move the selected layer up (with Shift: ×10)", keys: ["ArrowUp"] },
    { id: "nudge.down", group: "Layers and regions", shiftFree: true, what: "Move the selected layer down (with Shift: ×10)", keys: ["ArrowDown"] },
    { id: "edit.deselect", group: "Layers and regions", what: "Deselect (large editor, nothing selected: close it)", keys: ["Escape"] },
    { id: "view.pan", group: "View", hold: true, what: "Hold and drag: Pan the canvas", keys: ["Space"] },
    { id: "view.fit", group: "View", what: "Fit the image in view", keys: ["Home"] },
    { id: "view.snap", group: "View", what: "Snap to grid on / off", keys: ["G"] },
    { id: "view.big", group: "View", what: "Large editor: Open / close", keys: ["Alt+Enter"], setting: "RegionGenie.Main.LargeEditorKey" },
    { id: "view.help", group: "View", what: "This list", keys: ["?"] },
    { id: "text.prev", group: "Text", ctx: "text", what: "Pop-up editor: The previous text field", keys: ["PageUp"], setting: "RegionGenie.Popup.PrevKey" },
    { id: "text.next", group: "Text", ctx: "text", what: "Pop-up editor: The next text field", keys: ["PageDown"], setting: "RegionGenie.Popup.NextKey" },
];
const BY_ID = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));

// what can't be changed: gestures of the mouse and keys held with it. [after which command id (or null = first), keys, what]
const FIXED = {
    "Tools": [["brush.larger", "Alt+Wheel", "Brush size"]],
    "While drawing": [
        [null, "Shift", "Equal sides; a straight brush line from the last stroke; 15° steps when rotating"],
        [null, "Alt", "Draw or resize from the centre"],
        [null, "Alt+Click", "Make the region under the pointer the active one"],
        [null, "Ctrl+Click", "Select object: Take a spot out of the selection when it covers too much (a red point). After a search by text: leave a found object out, or bring it back"],
        ["draw.accept", "Double-click", "Close the lasso outline"],
    ],
    "Layers and regions": [
        ["edit.deselect", "Right-click", "On the canvas: A menu for the region under the pointer"],
        ["edit.deselect", "Double-click", "A label on the canvas: Edit that region in the pop-up editor"],
    ],
    "View": [[null, "Wheel", "Zoom the canvas"], ["view.pan", "Middle-drag", "Pan the canvas"]],
    "Text": [[null, "Enter", "A region's prompt in the list: Done (Shift+Enter: a new line). Pop-up editor: A new line"],
             ["text.next", "Esc", "Pop-up editor: Close (the text stays as it is)"],
             ["text.next", "Ctrl+Up / Ctrl+Down", "A prompt box: Raise or lower the weight of the word or tag at the cursor, or of the selected words, as (tag:1.05). ComfyUI's own keys"]],
};
const GROUPS = ["Tools", "While drawing", "Layers and regions", "View", "Text"];
const COLUMN_OF = { "Layers and regions": 1, "View": 1, "Text": 1 };      // the sheet's second column; the rest: the first

// ---------------------------------------------------------------- the keys in use
let cache = { sig: null, map: null };
function readOverrides() {
    try { const v = getSetting(SET.shortcuts, "{}"); const o = typeof v === "string" ? JSON.parse(v || "{}") : v; return o && typeof o === "object" ? o : {}; }
    catch (e) { return {}; }
}
const clean = (list) => [...new Set((Array.isArray(list) ? list : []).map((t) => String(t || "").trim()).filter((t) => parseKey(t)))].slice(0, MAX_KEYS);
function bindings() {
    const raw = getSetting(SET.shortcuts, "{}");
    const sig = (typeof raw === "string" ? raw : JSON.stringify(raw)) + "|" + COMMANDS.filter((c) => c.setting).map((c) => getSetting(c.setting, c.keys[0])).join("|");
    if (cache.sig === sig) return cache.map;
    const over = readOverrides(), map = {};
    for (const c of COMMANDS) {
        let texts;
        if (c.setting) { const t = String(getSetting(c.setting, c.keys[0]) ?? "").trim(); texts = parseKey(t) ? [t] : []; }
        else texts = Array.isArray(over[c.id]) ? clean(over[c.id]) : c.keys;
        map[c.id] = { texts, parsed: texts.map(parseKey) };
    }
    cache = { sig, map };
    return map;
}
// Ctrl in a shortcut is Ctrl or ⌘; a symbol typed with Shift ("?", "+") needs no Shift written
function matches(e, k, shiftFree) {
    if (!k || (e.key || "").toLowerCase() !== k.key) return false;
    if ((e.ctrlKey || e.metaKey) !== (k.ctrl || k.meta) || e.altKey !== k.alt) return false;
    return shiftFree || e.shiftKey === k.shift || (k.key.length === 1 && !k.shift && /[^a-z0-9 ]/.test(k.key));
}
export const keysOf = (id) => bindings()[id]?.texts || [];
export const keyIs = (e, id) => !!bindings()[id]?.parsed.some((k) => matches(e, k, BY_ID[id].shiftFree));
// the key of a held command was let go (modifiers may have been let go first: only the key counts)
export const keyUpIs = (e, id) => !!bindings()[id]?.parsed.some((k) => (e.key || "").toLowerCase() === k.key);
// "Ctrl+Shift+Z / Ctrl+Y", or "" when the command has no key
export const keyText = (id) => keysOf(id).map(keyLabel).filter(Boolean).join(" / ");
// " (Ctrl+Z)" for the end of a tooltip's sentence, or ""
export const keyTip = (id) => { const t = keyText(id); return t ? ` (${t})` : ""; };
const isDefault = (c) => { const now = keysOf(c.id).map((t) => keyLabel(t)).join("|"); return now === c.keys.map((t) => keyLabel(t)).join("|"); };
// A text written with default keys in brackets, "Undo (Ctrl+Z)", with the keys in use: "Undo (Ctrl+U)"; a command
// without a key loses its brackets. Only brackets that hold exactly one command's default keys are touched.
let tokens = null;
export function keyed(text) {
    if (!tokens) { tokens = new Map(); for (const c of COMMANDS) { const t = c.keys.map(keyLabel).join(" / "); if (!tokens.has(t)) tokens.set(t, c.id); } }
    return String(text).replace(/( ?)\(([^()\n]+)\)/g, (m, sp, inner) => {
        const id = tokens.get(inner);
        if (!id) return m;
        const t = keyText(id);
        return t ? `${sp}(${t})` : "";
    });
}
export const changedCount = () => COMMANDS.filter((c) => !isDefault(c)).length;
// the shared code (which can't import this file) asks for keys through this
Object.assign(KEYS, { is: keyIs, keyed });

async function store(id, list) {
    const c = BY_ID[id]; list = clean(list);
    if (c.setting) await setSetting(c.setting, list[0] || "");
    else {
        const over = readOverrides();
        if (list.map(keyLabel).join("|") === c.keys.map(keyLabel).join("|")) delete over[id]; else over[id] = list;
        await setSetting(SET.shortcuts, JSON.stringify(over));
    }
}
const announce = () => { cache.sig = null; window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT)); };
// Give a command a key (in place of its key number 'slot', or as one more). A command of the same context that had
// the key loses it. Returns the commands that lost it.
export async function setKey(id, slot, text) {
    const c = BY_ID[id], want = keyLabel(text), lost = [];
    if (!c || !want) return lost;
    for (const o of COMMANDS) {
        if (o.id === id || (o.ctx || "main") !== (c.ctx || "main")) continue;
        const keep = keysOf(o.id).filter((t) => keyLabel(t) !== want);
        if (keep.length !== keysOf(o.id).length) { await store(o.id, keep); lost.push(o); }
    }
    const list = keysOf(id).slice();
    if (slot != null && slot < list.length) list[slot] = text; else list.push(text);
    await store(id, c.setting ? [text] : list);
    announce();
    return lost;
}
export async function removeKey(id, slot) { const list = keysOf(id).slice(); list.splice(slot, 1); await store(id, list); announce(); }
export async function resetKeys(id) { await store(id, BY_ID[id].keys); announce(); }
export async function resetAllKeys() {
    await setSetting(SET.shortcuts, "{}");
    for (const c of COMMANDS) if (c.setting) await setSetting(c.setting, c.keys[0]);
    announce();
}
// a key press as a shortcut's text: "Ctrl+Shift+Z", "F2", "?", "Space"; null for a modifier alone
export function eventKeyText(e) {
    const k = e.key || "";
    if (!k || ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Process", "Unidentified"].includes(k)) return null;
    const symbol = k.length === 1 && /[^a-z0-9 ]/i.test(k);
    const name = k === " " ? "Space" : k === "+" ? "Plus" : k.length === 1 ? k.toUpperCase() : k;
    return [(e.ctrlKey || e.metaKey) && "Ctrl", e.altKey && "Alt", e.shiftKey && !symbol && "Shift", name].filter(Boolean).join("+");
}

// ---------------------------------------------------------------- the sheet
// On the page, above everything of ComfyUI and of the pack except the tooltip: it also opens from the Settings dialog,
// whose own layer is above the pack's pop-up editors.
const CSS = `.rg-keys { position:fixed; z-index:100003; box-sizing:border-box; width:min(820px, calc(100vw - 16px)); max-height:min(88vh, calc(100vh - 16px));
  display:flex; flex-direction:column; outline:none; border-radius:8px; font:12.5px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  color:var(--input-text,#ddd); background:var(--comfy-menu-bg,#2b2b2b); border:1px solid var(--border-color,#555); box-shadow:0 8px 28px rgba(0,0,0,.55);
  pointer-events:auto; }      /* ComfyUI's Settings dialog switches the pointer off for the rest of the page */
.rg-keys-head { display:flex; align-items:center; gap:8px; padding:7px 8px 7px 12px; border-bottom:1px solid var(--border-color,#555); font-size:13px; }
.rg-keys-head .rg-keys-how { opacity:.7; font-size:12px; margin-right:auto; }
.rg-keys-head button { background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px; cursor:pointer;
  font:inherit; font-size:12px; padding:2px 8px; }
.rg-keys-head button:disabled { opacity:.4; cursor:default; }
.rg-keys-head .rg-x { padding:3px 5px; }
.rg-keys-note { padding:5px 12px; font-size:12px; color:#e8b339; border-bottom:1px solid var(--border-color,#555); }
.rg-keys-note:empty { display:none; }
/* two columns side by side (one under the other in a narrow window); what doesn't fit scrolls up and down. Not CSS
   columns: with a limited height those put the rest in more columns to the right, out of sight */
.rg-keys-body { flex:1 1 auto; min-height:0; overflow-x:hidden; overflow-y:auto; padding:4px 12px 12px; display:flex; flex-wrap:wrap; align-items:flex-start; gap:0 22px; }
.rg-keys-col { flex:1 1 330px; min-width:0; }
.rg-keys section { padding-top:8px; }
.rg-keys h4 { margin:0 0 4px; font-size:11px; font-weight:650; letter-spacing:.06em; text-transform:uppercase; opacity:.7; }
.rg-keys-row { display:flex; gap:10px; padding:2.5px 0; align-items:baseline; }
.rg-keys-k { flex:0 0 172px; display:flex; flex-wrap:wrap; gap:3px; justify-content:flex-end; align-items:center; }
.rg-keys kbd, .rg-keys .rg-key { display:inline-block; font:600 11px/15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding:0 5px;
  border:1px solid color-mix(in srgb, currentColor 45%, transparent); border-bottom-width:2px; border-radius:4px; color:inherit;
  background:color-mix(in srgb, currentColor 9%, transparent); white-space:nowrap; }
.rg-keys kbd { opacity:.6; border-style:dashed; }
.rg-keys .rg-key { cursor:pointer; }
.rg-keys .rg-key:hover, .rg-keys .rg-key:focus-visible { border-color:#5b8fd0; background:rgba(91,143,208,.25); outline:none; }
.rg-keys .rg-key.rec { border-color:#e8b339; background:rgba(232,179,57,.22); font-weight:600; }
.rg-keys .rg-key.none { opacity:.55; font-weight:400; border-style:dotted; }
.rg-keys .rg-key-act { width:17px; height:17px; padding:0; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:3px;
  background:transparent; color:inherit; opacity:.5; cursor:pointer; }
.rg-keys .rg-key-act:hover, .rg-keys .rg-key-act:focus-visible { opacity:1; background:color-mix(in srgb, currentColor 14%, transparent); outline:none; }
.rg-keys .rg-key-act svg { width:12px; height:12px; display:block; pointer-events:none; }
.rg-keys-row.changed > span:last-child { font-weight:600; }`;

let sheet = null;                                    // one sheet at a time, on the whole page
export const shortcutsOpen = () => sheet?.owner ?? (sheet ? true : null);
export function closeShortcuts() { sheet?.close(); }
// o: { owner (anything: told back by shortcutsOpen()), rect (a DOMRect to open over; none: the middle of the page), onClose }
export function openShortcuts(o = {}) {
    closeShortcuts();
    if (!document.getElementById("rg-keys-style")) { const st = document.createElement("style"); st.id = "rg-keys-style"; st.textContent = CSS; document.head.appendChild(st); }
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const box = mk("div", "rg-keys"); box.tabIndex = -1;
    const head = mk("div", "rg-keys-head");
    const how = mk("span", "rg-keys-how", "Click a key to change it.");
    const resetAll = mk("button", null, "Reset all"); resetAll.type = "button";
    resetAll.title = "Put every shortcut back to its default key.";
    const x = mk("button", "rg-btn rg-x"); x.type = "button"; x.innerHTML = svgIcon("close"); x.title = "Close (Esc)";
    head.append(mk("b", null, "Shortcuts"), how, resetAll, x);
    const note = mk("div", "rg-keys-note"); note.setAttribute("aria-live", "polite");
    const body = mk("div", "rg-keys-body");
    box.append(head, note, body);
    let rec = null;                                  // the key being changed: { id, slot, chip }
    const stopRec = () => { rec = null; };
    const fixedRow = (keys, what) => {
        const row = mk("div", "rg-keys-row"), kc = mk("span", "rg-keys-k");
        keys.split(" / ").forEach((k) => kc.append(mk("kbd", null, k)));
        kc.title = "A mouse gesture, a held key or a key of ComfyUI's own: It can't be changed.";
        row.append(kc, mk("span", null, what));
        return row;
    };
    const act = (icon, tip, fn) => { const b = mk("button", "rg-key-act"); b.type = "button"; b.innerHTML = svgIcon(icon); b.dataset.act = icon; b.title = tip; b.addEventListener("click", (e) => { e.preventDefault(); fn(); }); return b; };
    const cmdRow = (c) => {
        const row = mk("div", "rg-keys-row" + (isDefault(c) ? "" : " changed")), kc = mk("span", "rg-keys-k");
        row.dataset.cmd = c.id;
        const texts = keysOf(c.id);
        const chip = (slot, text) => {
            const recording = rec && rec.id === c.id && rec.slot === slot;
            const b = mk("button", "rg-key" + (recording ? " rec" : text ? "" : " none"), recording ? "Press a key…" : text ? keyLabel(text) : "no key");
            b.type = "button"; b.dataset.slot = String(slot);
            b.title = recording ? "Press the key or the combination for this. Esc: Leave it as it is." : "Click: Then press the new key or combination for this.";
            b.addEventListener("click", (e) => { e.preventDefault(); rec = recording ? null : { id: c.id, slot }; note.textContent = ""; render(); });
            return b;
        };
        if (!texts.length) kc.append(chip(0, ""));
        texts.forEach((t, i) => {
            kc.append(chip(i, t));
            if (rec && rec.id === c.id && rec.slot === i) kc.append(act("close", "Remove this key.", async () => { stopRec(); await removeKey(c.id, i); render(); }));
        });
        if (rec && rec.id === c.id && rec.slot === texts.length && texts.length) kc.append(chip(texts.length, ""));
        else if (texts.length && texts.length < MAX_KEYS && !c.setting) kc.append(act("plus", "Add a second key for this.", () => { rec = { id: c.id, slot: texts.length }; note.textContent = ""; render(); }));
        if (!isDefault(c)) kc.append(act("reset", `Back to the default (${c.keys.map(keyLabel).join(" / ")}).`, async () => { stopRec(); await resetKeys(c.id); note.textContent = ""; render(); }));
        row.append(kc, mk("span", null, c.what));
        return row;
    };
    function render() {
        const top = body.scrollTop;
        body.replaceChildren();
        const cols = [mk("div", "rg-keys-col"), mk("div", "rg-keys-col")];
        for (const g of GROUPS) {
            const sec = mk("section"); sec.append(mk("h4", null, g)); sec.dataset.group = g;
            const fixed = FIXED[g] || [];
            for (const [, k, what] of fixed.filter((f) => f[0] === null)) sec.append(fixedRow(k, what));
            for (const c of COMMANDS.filter((c) => c.group === g)) {
                sec.append(cmdRow(c));
                for (const [, k, what] of fixed.filter((f) => f[0] === c.id)) sec.append(fixedRow(k, what));
            }
            cols[COLUMN_OF[g] || 0].append(sec);
        }
        body.append(...cols);
        resetAll.disabled = !changedCount();
        how.textContent = rec ? "Press the new key or combination (Esc: leave it as it is)." : "Click a key to change it.";
        body.scrollTop = top;
        if (rec) body.querySelector(`.rg-keys-row[data-cmd="${rec.id}"] .rg-key.rec`)?.focus({ preventScroll: true });
    }
    resetAll.addEventListener("click", async (e) => { e.preventDefault(); stopRec(); await resetAllKeys(); note.textContent = "Every shortcut is back to its default."; render(); });
    render();
    document.body.appendChild(box);
    const w = box.offsetWidth, h = box.offsetHeight, r = o.rect;
    box.style.left = Math.round(Math.max(8, Math.min(r ? r.left + r.width / 2 - w / 2 : (window.innerWidth - w) / 2, window.innerWidth - w - 8))) + "px";
    box.style.top = Math.round(Math.max(8, Math.min(r ? Math.max(r.top, 0) + 40 : (window.innerHeight - h) / 2, window.innerHeight - h - 8))) + "px";
    const stop = (e) => e.stopPropagation();
    for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu"]) box.addEventListener(ev, stop);
    box.dataset.captureWheel = "true";
    const outside = (e) => { if (!box.contains(e.target) && !o.keep?.(e.target)) close(); };
    const key = async (e) => {
        if (rec) {                                       // the next key press is the new shortcut
            e.preventDefault(); e.stopPropagation();
            if (e.key === "Escape") { stopRec(); render(); return; }
            const text = eventKeyText(e);
            if (!text) return;                           // a modifier alone: wait for the key
            const { id, slot } = rec; stopRec();
            const lost = await setKey(id, slot, text);
            note.textContent = lost.length ? `${keyLabel(text)} was the key of “${lost.map((c) => c.what.split(" (")[0].split(". ")[0]).join("”, “")}”: ${lost.length > 1 ? "they have" : "it has"} ${lost.every((c) => keysOf(c.id).length) ? "one key less" : "no key"} now.` : "";
            render();
            return;
        }
        const typing = e.target?.tagName === "TEXTAREA" || e.target?.tagName === "INPUT" || e.target?.isContentEditable;
        if (e.key === "Escape" || (keyIs(e, "view.help") && !typing && !o.ownKeys?.(e.target))) { e.preventDefault(); e.stopPropagation(); close(); }
    };
    const onChange = () => { if (!rec) render(); };
    function close() {
        if (sheet?.box !== box) return;
        sheet = null;
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", key, true);
        window.removeEventListener(SHORTCUTS_EVENT, onChange);
        box.remove();
        o.onClose?.();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener(SHORTCUTS_EVENT, onChange);
    x.addEventListener("click", (e) => { e.preventDefault(); close(); });
    sheet = { box, close, owner: o.owner ?? true };
    box.focus({ preventScroll: true });
    return sheet;
}
