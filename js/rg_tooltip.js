// Region Genie: the pack's own tooltip, in place of the browser's.
//
// Every control of the pack still gets its text the plain way ('el.title = "…"'): nothing else in the code knows about
// this file. While the pointer is over such a control, its text is put aside (in data-rg-tip) and its title attribute is
// left EMPTY, and this tooltip shows the text; the attribute is back as soon as the pointer leaves. Empty, not removed:
// an element without a title shows the title of the nearest element around it that has one (a button in a pop-up's
// title bar would show "Drag to move …" next to its own tooltip), and an empty title is what switches that off. While
// it is aside, 'el.title' still reads and takes the text (see take()), so code that reads a title, or sets one again
// on every refresh, works as always and never puts the browser's tooltip back. It only acts on elements inside the
// pack's own boxes (a class starting with "rg-").
//
// The text is shown as it is written (see tests/tooltip_rules.cjs): one item per line; a line's "Name:" in bold; a
// shortcut in brackets, "(Ctrl+Z)" or "(V)", as a key.
//
// In a browser driven by a test tool (navigator.webdriver) the title is left where it is: the tests find controls by
// their title, also the one the pointer rests on. Everything else runs the same. tests/ui_review_items.cjs sets
// window.__rgTakeTitles to test the real thing.
const ROOT = '[class^="rg-"], [class*=" rg-"]';
const SHOW_MS = 450, SOON_MS = 60, WARM_MS = 500;       // the wait; a tooltip was just up: next one at once
const BIG_W = 260, BIG_H = 70;                            // larger than this: the tooltip goes next to the pointer

const MODS = "(?:Ctrl|Shift|Alt|Cmd|Meta)";
const KEYS = "(?:[A-Z0-9\\[\\]?]|F\\d{1,2}|Home|End|Del|Delete|Ins|Esc|Enter|Space|Tab|Backspace|Page Up|Page Down|[←→↑↓])";
const COMBO = `(?:${MODS}\\+)*${KEYS}`;
const KEY_RE = new RegExp(`\\((${COMBO}(?: / ${COMBO})*)\\)`, "g");
const NAME_RE = /^([^:.\n]{1,48}):(\s)/;

const CSS = `.rg-tip { position:fixed; z-index:100010; left:0; top:0; max-width:min(360px, calc(100vw - 12px)); box-sizing:border-box;
  padding:6px 9px; border-radius:6px; pointer-events:none; user-select:none; white-space:pre-wrap; overflow-wrap:anywhere;
  font:12.5px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; text-align:left; letter-spacing:normal;
  color:var(--input-text, #ddd); background:var(--comfy-menu-bg, #2b2b2b); border:1px solid var(--border-color, #555);
  box-shadow:0 4px 14px rgba(0,0,0,.45); opacity:0; transition:opacity .08s; }
.rg-tip.on { opacity:1; }
.rg-tip > div + div { margin-top:3px; }
.rg-tip b { font-weight:650; }
.rg-tip kbd { display:inline-block; font:600 11px/15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding:0 5px; margin:0 1px;
  border:1px solid color-mix(in srgb, currentColor 45%, transparent); border-bottom-width:2px; border-radius:4px;
  background:color-mix(in srgb, currentColor 9%, transparent); white-space:nowrap; vertical-align:1px; }`;

let tip = null, cur = null, timer = 0, lastUp = -1e9, shown = false, quiet = false, px = 0, py = 0, watch = null, alive = 0, touch = false;

// "Undo (Ctrl+Z)" -> text, <kbd>Ctrl+Z</kbd>
function fillLine(box, text) {
    const m = NAME_RE.exec(text);
    if (m) { const b = document.createElement("b"); b.textContent = m[1] + ":"; box.append(b); text = text.slice(m[1].length + 1); }
    let at = 0;
    for (const k of text.matchAll(KEY_RE)) {
        if (k.index > at) box.append(text.slice(at, k.index));
        k[1].split(" / ").forEach((combo, i) => { if (i) box.append(" "); const kbd = document.createElement("kbd"); kbd.textContent = combo; box.append(kbd); });
        at = k.index + k[0].length;
    }
    if (at < text.length) box.append(text.slice(at));
}
function fill(text) {
    tip.replaceChildren();
    for (const line of String(text).split("\n")) {
        if (!line.trim()) continue;
        const d = document.createElement("div"); fillLine(d, line); tip.append(d);
    }
}
function place() {
    const r = cur.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    let x, y;
    if (r.width > BIG_W || r.height > BIG_H) { x = px + 12; y = py + 18; if (y + h > H - 4) y = py - h - 10; }       // a text box, the canvas: at the pointer
    else { x = r.left + r.width / 2 - w / 2; y = r.bottom + 7; if (y + h > H - 4) y = r.top - h - 7; }
    tip.style.left = Math.round(Math.max(4, Math.min(x, W - w - 4))) + "px";
    tip.style.top = Math.round(Math.max(4, Math.min(y, H - h - 4))) + "px";
}
const textOf = (el) => el?.dataset?.rgTip || "";
// the text goes aside while the pointer is on the element, and the attribute stays empty (the browser then has nothing
// to show: not this element's title, and not the title of an element around it)
const keepTitles = () => !!navigator.webdriver && !window.__rgTakeTitles;
function retitle() { if (shown && cur) { if (textOf(cur).trim()) { fill(textOf(cur)); place(); } else hide(); } }
function take(el) {
    el.dataset.rgTip = el.getAttribute("title") || "";
    if (keepTitles()) return;
    el.setAttribute("title", "");
    // 'el.title' while the text is aside: reads give the text, writes change the text aside (and the tooltip that is up)
    try {
        Object.defineProperty(el, "title", { configurable: true, get() { return this.dataset.rgTip ?? ""; },
            set(v) { this.dataset.rgTip = String(v ?? ""); if (this === cur) retitle(); } });
    } catch (e) { /* not possible on this element: the observer below still takes a new title */ }
}
function giveBack(el) {
    if (!el || el.dataset.rgTip == null) return;
    const text = el.dataset.rgTip;
    delete el.title;                                        // the property of take(); the element's own 'title' is back
    delete el.dataset.rgTip;
    if (text) el.setAttribute("title", text); else if (el.getAttribute("title") === "" && !keepTitles()) el.removeAttribute("title");
}
function hide() {
    clearTimeout(timer); timer = 0;
    if (shown) { shown = false; lastUp = performance.now(); tip.classList.remove("on"); }
}
function show() {
    timer = 0;
    if (!cur || quiet || !cur.isConnected) return;
    const text = textOf(cur);
    if (!text.trim()) return;
    if (!tip.isConnected) document.body.appendChild(tip);
    fill(text); place();
    tip.classList.add("on"); shown = true;
}
function leave() {
    hide();
    watch?.disconnect();
    giveBack(cur);
    cur = null; quiet = false;
    clearInterval(alive); alive = 0;
}
function enter(el) {
    cur = el; quiet = false;
    take(el);
    // a title set as an attribute while the pointer is here (el.title = "…" goes to take()'s property): take that one too
    watch = watch || new MutationObserver(() => {
        if (!cur || keepTitles()) { if (cur && cur.hasAttribute("title")) { cur.dataset.rgTip = cur.getAttribute("title"); retitle(); } return; }
        const now = cur.getAttribute("title");
        if (now === "") return;                             // as take() left it
        cur.dataset.rgTip = now || "";
        cur.setAttribute("title", "");
        retitle();
    });
    watch.observe(el, { attributes: true, attributeFilter: ["title"] });
    // no event tells that the element was taken off the page under the pointer, or that another one is there now (a
    // rebuilt list, a pop-up opened by a key): look
    alive = setInterval(() => {
        if (!cur) return;
        if (!cur.isConnected) { leave(); }
        const now = owner(document.elementFromPoint(px, py));
        if (now === cur || (cur && cur.contains(document.elementFromPoint(px, py)) && !now)) return;
        if (cur) leave();
        if (now) { enter(now); quiet = true; clearTimeout(timer); timer = 0; }      // no tooltip until the pointer moves in again; the title is aside
    }, 300);
    if (!textOf(el).trim()) return;
    timer = setTimeout(show, performance.now() - lastUp < WARM_MS ? SOON_MS : SHOW_MS);
}
// the pack's element that carries the tooltip under this event target
// (the page itself can carry a class of the pack, "rg-osb" on <html>: that is not one of its boxes, or every tooltip of
// ComfyUI and of other packs would be taken over)
function owner(t) {
    const el = t?.closest?.("[title], [data-rg-tip]");
    const box = el?.closest(ROOT);
    return box && box !== document.documentElement && box !== document.body && !el.closest(".rg-tip") ? el : null;
}

function install() {
    if (typeof document === "undefined" || document.getElementById("rg-tip-style")) return;
    const st = document.createElement("style"); st.id = "rg-tip-style"; st.textContent = CSS; document.head.appendChild(st);
    tip = document.createElement("div"); tip.className = "rg-tip"; tip.setAttribute("role", "tooltip");
    const over = (e) => {
        if (e.pointerType) touch = e.pointerType === "touch";
        if (touch) return;
        px = e.clientX; py = e.clientY;
        const el = owner(e.target);
        if (el === cur) return;
        if (cur) leave();
        if (el) enter(el);
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("mouseover", over, true);      // the browser's own "the element under the resting pointer changed"
    document.addEventListener("pointermove", (e) => { px = e.clientX; py = e.clientY; }, true);
    // a press: the tooltip goes, and stays away until the pointer has left and come back (the title stays aside)
    document.addEventListener("pointerdown", (e) => { touch = e.pointerType === "touch"; if (!cur) return; hide(); quiet = true; }, true);
    document.addEventListener("keydown", () => { if (shown || timer) { hide(); quiet = true; } }, true);
    document.addEventListener("wheel", () => { if (shown || timer) hide(); }, { capture: true, passive: true });
    document.addEventListener("scroll", () => { if (shown) hide(); }, true);
    document.addEventListener("mouseout", (e) => { if (!e.relatedTarget && cur) leave(); }, true);       // out of the window
    window.addEventListener("blur", () => { if (cur) leave(); });
}
install();

// for tests: the text of the tooltip that is up ("" when none)
export const tooltipShown = () => (shown && tip ? tip.innerText : "");
