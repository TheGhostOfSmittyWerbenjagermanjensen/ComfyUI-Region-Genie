// Color picker for Region Genie: a plain-DOM version of the ComfyUI frontend's own color picker
// (the one in Create Bounding Boxes: saturation/brightness square, hue slider, Hex / RGB fields, no alpha),
// plus HSL fields and copy / paste buttons.
// The frontend's component is Vue-only and not available to extensions, and it would not exist in legacy
// mode anyway, so this one is built by hand: it lives in document.body (position: fixed), so it looks the
// same in legacy nodes and Nodes 2.0 at any zoom.
//
//   openColorPicker(anchor, "#rrggbb", { onInput(hex), onClose(hex, changed) })
// onInput fires while the color changes; onClose fires once (outside click, Esc, Enter in a field, the
// anchor clicked again, or the anchor leaving the page).

const CSS = `
.rg-cp { position:fixed; z-index:100000; pointer-events:auto; box-sizing:border-box; width:232px; display:flex; flex-direction:column; gap:8px;
  padding:8px; border-radius:8px; border:1px solid color-mix(in srgb, var(--border-default, var(--border-color, #555)) 50%, transparent);
  background:var(--comfy-menu-bg, var(--background, #1e1e1e)); color:var(--fg-color, #ddd); box-shadow:0 4px 12px rgba(0,0,0,.45);
  font:12px/1.2 var(--font-inter, Inter, Arial, sans-serif); user-select:none; touch-action:none; }
.rg-cp * { box-sizing:border-box; }
/* as a part of a panel (a pop-up's Palette tab): no window of its own, wider than tall */
.rg-cp.inline { position:static; z-index:auto; width:100%; padding:0; border:0; background:transparent; box-shadow:none; }
.rg-cp.inline .rg-cp-sv { aspect-ratio:auto; height:96px; }
.rg-cp-sv { position:relative; width:100%; aspect-ratio:1/1; border-radius:2px; cursor:crosshair; touch-action:none; }
.rg-cp-sv::before, .rg-cp-sv::after { content:""; position:absolute; inset:0; border-radius:2px; }
.rg-cp-sv::before { background:linear-gradient(to right, #fff, transparent); }
.rg-cp-sv::after { background:linear-gradient(to bottom, transparent, #000); }
.rg-cp-knob { position:absolute; z-index:1; width:14px; height:14px; transform:translate(-50%, -50%); border-radius:50%;
  border:2px solid #fff; box-shadow:0 0 2px rgba(0,0,0,.6); pointer-events:none; }
.rg-cp-hue { position:relative; height:16px; border-radius:9999px; padding:1px; cursor:pointer; touch-action:none;
  background:linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%); }
.rg-cp-hue .rg-cp-knob { top:50%; width:14px; height:14px; }
.rg-cp-row { display:flex; align-items:center; gap:4px; }
.rg-cp-mode { height:24px; width:58px; flex:0 0 auto; border:0; border-radius:4px; padding:0 4px; font:inherit; font-size:12px;
  background:var(--comfy-input-bg, #2a2a2a); color:inherit; cursor:pointer; outline:none; }
.rg-cp-fields { flex:1 1 auto; min-width:0; height:24px; display:flex; align-items:center; gap:4px; padding:0 4px; border-radius:4px;
  background:var(--comfy-input-bg, #2a2a2a); color:var(--descrip-text, #aaa); }
.rg-cp-fields input { flex:1 1 0; min-width:0; width:0; border:0; background:transparent; color:inherit; font:inherit; text-align:center;
  padding:0; outline:none; -moz-appearance:textfield; appearance:textfield; }
.rg-cp-fields input::-webkit-inner-spin-button, .rg-cp-fields input::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
.rg-cp-fields input:focus { color:var(--input-text, #fff); }
.rg-cp-ico { flex:0 0 24px; width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; padding:0;
  border:0; border-radius:4px; background:var(--comfy-input-bg, #2a2a2a); color:var(--descrip-text, #aaa); cursor:pointer; }
.rg-cp-ico:hover { color:var(--input-text, #fff); filter:brightness(1.2); }
.rg-cp-ico.ok { color:#6c6; }
.rg-cp-ico.bad { color:#e77; }
.rg-cp-ico svg { width:14px; height:14px; display:block; }
.rg-cp-msg { font-size:11px; color:var(--descrip-text, #aaa); margin-top:-3px; }
.rg-cp-msg:empty { display:none; }
`;

function ensureStyle() {
    if (document.getElementById("rg-cp-style")) return;
    const s = document.createElement("style"); s.id = "rg-cp-style"; s.textContent = CSS; document.head.appendChild(s);
}

// the frontend's colorUtil conversions (HSB in 0-360 / 0-100 / 0-100)
export function hsbToRgb(h, s, b) {
    const hh = ((h % 360) + 360) % 360, ss = Math.max(0, Math.min(100, s)) / 100, vv = Math.max(0, Math.min(100, b)) / 100;
    const c = vv * ss, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = vv - c;
    const [rp, gp, bp] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
    // rounded (the frontend floors, which turns a typed #12AB34 into #11AA34)
    return [Math.round((rp + m) * 255), Math.round((gp + m) * 255), Math.round((bp + m) * 255)];
}
export function rgbToHsb(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (max === g) h = ((b - r) / d + 2) * 60;
        else h = ((r - g) / d + 4) * 60;
    }
    return [h, max === 0 ? 0 : (d / max) * 100, max * 100];
}
const toHex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export function normalizeHex(v) {
    const d = String(v || "").trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(d)) return "#" + [...d].map((c) => c + c).join("").toLowerCase();
    return /^[0-9a-fA-F]{6}$/.test(d) ? "#" + d.toLowerCase() : null;
}
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    let h = 0, s = 0;
    if (d !== 0) {
        s = d / (1 - Math.abs(2 * l - 1));
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (max === g) h = ((b - r) / d + 2) * 60;
        else h = ((r - g) / d + 4) * 60;
    }
    return [h, s * 100, l * 100];
}
export function hslToRgb(h, s, l) {
    const hh = ((h % 360) + 360) % 360, ss = Math.max(0, Math.min(100, s)) / 100, ll = Math.max(0, Math.min(100, l)) / 100;
    const c = (1 - Math.abs(2 * ll - 1)) * ss, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = ll - c / 2;
    const [rp, gp, bp] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((rp + m) * 255), Math.round((gp + m) * 255), Math.round((bp + m) * 255)];
}
// text for each format, as the (Deno) Ideogram Director writes it: #4ecb8d, rgb(78, 203, 141), hsl(150, 55%, 55%)
export function formatColor(hex, mode) {
    const [r, g, b] = hexToRgb(hex);
    if (mode === "rgb") return `rgb(${r}, ${g}, ${b})`;
    if (mode === "hsl") { const [h, s, l] = rgbToHsl(r, g, b); return `hsl(${Math.round(h) % 360}, ${Math.round(s)}%, ${Math.round(l)}%)`; }
    return hex.toLowerCase();
}
// any common color text -> "#rrggbb" (or null): #rgb, #rrggbb(aa), rgb()/rgba(), hsl()/hsla(), hsv()/hsb(),
// or three plain numbers "78, 203, 141" (read as RGB)
export function parseColor(text) {
    const t = String(text || "").trim().toLowerCase();
    if (!t) return null;
    const hx = t.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/);
    if (hx && !(hx[1].length === 3 && hx[2])) return normalizeHex(hx[1]);
    const fn = t.match(/^(rgba?|hsla?|hsva?|hsba?)?\s*\(?\s*([^)]*?)\s*\)?\s*;?$/);
    if (!fn) return cssColor(t);
    const parts = fn[2].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 3) return cssColor(t);
    const num = (p, scale) => {                       // "50%" -> 50 (or of `scale` for rgb), "0.5turn" etc. not handled
        const v = parseFloat(p);
        if (!Number.isFinite(v)) return NaN;
        return p.endsWith("%") && scale ? (v / 100) * scale : v;
    };
    const kind = (fn[1] || "rgb").replace(/a$/, "");
    if (kind === "rgb") {
        const c = parts.slice(0, 3).map((p) => num(p, 255));
        if (!c.every(Number.isFinite)) return null;
        return toHex(c.map((v) => Math.max(0, Math.min(255, v))));
    }
    const h = parseFloat(parts[0]), a = parseFloat(parts[1]), b = parseFloat(parts[2]);
    if (![h, a, b].every(Number.isFinite)) return null;
    return toHex(kind === "hsl" ? hslToRgb(h, a, b) : hsbToRgb(h, a, b));
}
// anything else the browser understands as a CSS color ("red", "rebeccapurple", hwb(...), ...)
function cssColor(t) {
    if (typeof document?.createElement !== "function") return null;
    const c = document.createElement("canvas").getContext("2d");
    if (!c) return null;
    c.fillStyle = "#010203";
    c.fillStyle = t;
    const v = String(c.fillStyle).toLowerCase();
    if (v === "#010203" && t.replace(/\s/g, "") !== "#010203") return null;
    return normalizeHex(v) || parseColor(v === t ? "" : v);
}
// clipboard (falls back to execCommand where the async clipboard isn't allowed, e.g. plain http on a LAN address)
async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
}
const ICON = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
};

let current = null;
let lastClosed = { anchor: null, t: 0 };
let displayMode = "hex";                         // remembered between pickers, like the frontend's

export const inColorPicker = (t) => !!t?.closest?.(".rg-cp");
export function closeColorPicker() { current?.close(); }
// true right after the picker of this anchor was closed by pressing on the anchor (so a click there toggles)
export const justClosedBy = (anchor) => lastClosed.anchor === anchor && performance.now() - lastClosed.t < 500;

// inline: an element to build the picker into, as a part of that panel (the Palette tab of a region's pop-up): it has
// no place of its own, isn't closed by a click elsewhere or by Esc, and stays until its close() is called. The api's
// set(hex) shows another color in it without reporting a change.
export function openColorPicker(anchor, hex, { onInput, onClose, inline = null } = {}) {
    if (!inline && justClosedBy(anchor)) { lastClosed = { anchor: null, t: 0 }; return null; }   // that press closed it
    if (!inline) closeColorPicker();
    ensureStyle();
    const start = normalizeHex(hex) || "#000000";
    let [h, s, v] = rgbToHsb(...hexToRgb(start));
    let last = start, changed = false;

    const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    const panel = el("div", "rg-cp");
    panel.setAttribute("role", "dialog");
    const sv = el("div", "rg-cp-sv"); sv.setAttribute("role", "slider"); sv.title = "Saturation and brightness";
    const svKnob = el("div", "rg-cp-knob"); sv.appendChild(svKnob);
    const hue = el("div", "rg-cp-hue"); hue.setAttribute("role", "slider"); hue.title = "Hue";
    const hueKnob = el("div", "rg-cp-knob"); hue.appendChild(hueKnob);
    const row = el("div", "rg-cp-row");
    const mode = el("select", "rg-cp-mode"); mode.title = "Color format";
    for (const [val, label] of [["hex", "Hex"], ["rgb", "RGB"], ["hsl", "HSL"]]) { const o = el("option"); o.value = val; o.textContent = label; mode.appendChild(o); }
    mode.value = displayMode;
    const fields = el("div", "rg-cp-fields");
    const copyBtn = el("button", "rg-cp-ico"); copyBtn.type = "button"; copyBtn.innerHTML = ICON.copy;
    const pasteBtn = el("button", "rg-cp-ico"); pasteBtn.type = "button"; pasteBtn.innerHTML = ICON.paste;
    pasteBtn.title = "Paste a color (hex, rgb(...), hsl(...) or three numbers)";
    const msg = el("div", "rg-cp-msg");
    row.append(mode, fields, copyBtn, pasteBtn);
    panel.append(sv, hue, row, msg);

    let hexIn = null, numIns = [];
    // typed HSL values are kept as typed while they still give the current color: white or grey have no
    // saturation / hue of their own, and recomputing them would wipe what was just typed in another field
    let hslKeep = null;
    const curHex = () => toHex(hsbToRgb(h, s, v));
    const NUM_FIELDS = {
        rgb: [["Red", 255], ["Green", 255], ["Blue", 255]],
        hsl: [["Hue", 360], ["Saturation (%)", 100], ["Lightness (%)", 100]],
    };
    // set the colour from typed / pasted values, keeping the typed hue (so grey or black don't lose it)
    function setFromRgb(rgb, keepHue) {
        const [nh, ns, nv] = rgbToHsb(...rgb);
        h = keepHue != null && ns > 0 ? keepHue : (ns > 0 ? nh : h); s = ns; v = nv;
    }
    function buildFields() {
        fields.textContent = ""; hexIn = null; numIns = [];
        copyBtn.title = `Copy (${{ hex: "#4ecb8d", rgb: "rgb(78, 203, 141)", hsl: "hsl(150, 55%, 55%)" }[displayMode]} format)`;
        if (displayMode === "hex") {
            hexIn = el("input"); hexIn.type = "text"; hexIn.spellcheck = false; hexIn.setAttribute("aria-label", "Hex"); hexIn.title = "The color as a hex value";
            fieldEvents(hexIn, () => {
                const n = normalizeHex(hexIn.value);
                if (n) { setFromRgb(hexToRgb(n)); update(false); }
            });
            fields.appendChild(hexIn);
        } else {
            for (const [name, max] of NUM_FIELDS[displayMode]) {
                const i = el("input"); i.type = "number"; i.min = "0"; i.max = String(max); i.setAttribute("aria-label", name); i.title = name;
                fieldEvents(i, () => {
                    const vals = numIns.map((x) => (x.value === "" ? NaN : +x.value));
                    if (!vals.every(Number.isFinite)) return;
                    const c = vals.map((x, k) => Math.max(0, Math.min(NUM_FIELDS[displayMode][k][1], x)));
                    if (displayMode === "rgb") { setFromRgb(c.map(Math.round)); update(false); }
                    else { setFromRgb(hslToRgb(...c), c[0] % 360); update(false); hslKeep = { vals: c.map(Math.round), hex: curHex() }; }
                });
                numIns.push(i); fields.appendChild(i);
            }
        }
        syncFields(true);
    }
    // like the frontend: a field being edited keeps what you type; it shows the color again when left
    function fieldEvents(input, apply) {
        input.addEventListener("focus", () => { input.dataset.editing = "1"; input.select?.(); });
        input.addEventListener("input", apply);
        input.addEventListener("blur", () => { delete input.dataset.editing; syncFields(true); });
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") { apply(); if (inline) input.blur(); else close(); }
        });
    }
    function syncFields(force) {
        const rgb = hsbToRgb(h, s, v);
        if (hexIn && (force || !hexIn.dataset.editing)) hexIn.value = toHex(rgb);
        const vals = displayMode !== "hsl" ? rgb
            : hslKeep && hslKeep.hex === toHex(rgb) ? hslKeep.vals
            : (() => { const [hh, ss, ll] = rgbToHsl(...rgb); return [Math.round(ss > 0 ? h : hh) % 360, Math.round(ss), Math.round(ll)]; })();
        numIns.forEach((i, k) => { if (force || !i.dataset.editing) i.value = String(vals[k]); });
    }
    // a pasted colour in any format (field paste, Ctrl+V on the panel, or the paste button)
    function applyPasted(text) {
        const hex = parseColor(text);
        if (!hex) { say(`Not a color: ${String(text).trim().slice(0, 28) || "(empty)"}`); flash(pasteBtn, false); return false; }
        setFromRgb(hexToRgb(hex));
        update(true);
        say(""); flash(pasteBtn, true);
        return true;
    }
    let msgTimer = 0;
    function say(text) { msg.textContent = text; clearTimeout(msgTimer); if (text) msgTimer = setTimeout(() => { msg.textContent = ""; }, 3000); }
    function flash(btn, ok) {
        const icon = btn === copyBtn ? ICON.copy : ICON.paste;
        btn.classList.toggle("ok", ok); btn.classList.toggle("bad", !ok);
        if (ok) btn.innerHTML = ICON.check;
        setTimeout(() => { btn.classList.remove("ok", "bad"); btn.innerHTML = icon; }, 900);
    }
    copyBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const text = formatColor(curHex(), displayMode);
        const ok = await copyText(text);
        flash(copyBtn, ok); say(ok ? `Copied ${text}` : "Copying was blocked by the browser");
    });
    pasteBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        let text = null;
        try { text = await navigator.clipboard.readText(); } catch (err) { text = null; }
        if (text == null) { say("The browser blocked reading the clipboard: press Ctrl+V now"); pasteBtn.focus(); return; }
        applyPasted(text);
    });
    // Ctrl+V while the picker has focus (also the fallback when the paste button can't read the clipboard)
    const onPaste = (e) => {
        if (!panel.contains(document.activeElement)) return;
        const text = e.clipboardData?.getData("text") ?? "";
        const inField = document.activeElement?.tagName === "INPUT";
        // plain typing-style paste into one field (a single number or a partial hex) stays normal
        if (inField && !parseColor(text) && !/[(,]/.test(text)) return;
        e.preventDefault(); e.stopPropagation();
        if (applyPasted(text) && inField) { delete document.activeElement.dataset.editing; syncFields(true); }
    };
    window.addEventListener("paste", onPaste, true);
    function update(fromPointer = true) {
        sv.style.backgroundColor = `hsl(${h}, 100%, 50%)`;
        svKnob.style.left = `${s}%`; svKnob.style.top = `${100 - v}%`;
        hueKnob.style.left = `${(h / 360) * 100}%`;
        sv.setAttribute("aria-valuetext", `${Math.round(s)}%, ${Math.round(v)}%`);
        syncFields(fromPointer);
        const x = curHex();
        if (x !== last) { last = x; changed = true; onInput?.(x); }
    }
    // pointer dragging on the square / the hue bar (pointer capture keeps it going outside the panel)
    function drag(target, fn) {
        const at = (e) => { const r = target.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))); update(true); };
        target.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            document.activeElement?.blur?.();
            target.setPointerCapture(e.pointerId); at(e);
        });
        target.addEventListener("pointermove", (e) => { if (target.hasPointerCapture(e.pointerId)) at(e); });
    }
    drag(sv, (x, y) => { s = Math.round(x * 100); v = Math.round((1 - y) * 100); });
    drag(hue, (x) => { h = Math.round(x * 360); });
    mode.addEventListener("change", () => { displayMode = mode.value; buildFields(); });
    // keep events away from the canvas / node underneath
    for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "wheel", "contextmenu", "keyup", "keypress"]) panel.addEventListener(ev, (e) => e.stopPropagation());
    panel.addEventListener("contextmenu", (e) => e.preventDefault());

    if (inline) { panel.classList.add("inline"); inline.appendChild(panel); } else document.body.appendChild(panel);
    buildFields();
    update(false);
    changed = false;                                  // the first paint is not a change
    if (inline) {
        let closedI = false;
        const apiI = { panel, get hex() { return last; },
            set(x) { const n = normalizeHex(x); if (!n || n === last) return; setFromRgb(hexToRgb(n)); last = n; update(true); },
            close() { if (closedI) return; closedI = true; window.removeEventListener("paste", onPaste, true); clearTimeout(msgTimer); panel.remove(); onClose?.(last, changed); } };
        return apiI;
    }

    function place() {
        const r = anchor.getBoundingClientRect(), pw = panel.offsetWidth, ph = panel.offsetHeight, pad = 10;
        let top = r.bottom + 7;
        if (top + ph > window.innerHeight - pad && r.top - 7 - ph >= pad) top = r.top - 7 - ph;
        top = Math.max(pad, Math.min(window.innerHeight - ph - pad, top));
        const left = Math.max(pad, Math.min(window.innerWidth - pw - pad, r.left));
        panel.style.left = `${left}px`; panel.style.top = `${top}px`;
    }
    place();
    let raf = 0;
    const follow = () => {                            // stays with its swatch while the canvas moves
        if (!anchor.isConnected) { close(); return; }
        place(); raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    const outside = (e) => {
        if (panel.contains(e.target)) return;
        if (anchor.contains(e.target)) lastClosed = { anchor, t: performance.now() };
        close();
    };
    const keys = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", keys, true);

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("pointerdown", outside, true);
        window.removeEventListener("keydown", keys, true);
        window.removeEventListener("paste", onPaste, true);
        clearTimeout(msgTimer);
        panel.remove();
        if (current === api) current = null;
        onClose?.(last, changed);
    }
    const api = { close, panel, get hex() { return last; } };
    current = api;
    return api;
}
