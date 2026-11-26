// Region Genie: the settings window (round 50).
//
// ComfyUI's Settings > Region Genie keeps a short list: the switches that are flipped often, and one row per topic.
// A topic row's "Edit…" opens this window on that topic's page; every topic is listed on the left, so the other pages
// are one click away. The settings on the pages are ordinary ComfyUI settings (same ids, same saved values): they are
// only registered as "hidden" so ComfyUI doesn't list them (see SETTINGS_PAGES in rg_shared.js), and drawn here from
// their own type (rgType): a switch, a number, a slider, a dropdown, a text, or the pack's own row (a model-file
// field, the region colors, an LLM preset row …).
//
// Where it lives: inside ComfyUI's Settings dialog, covering it. That dialog lets nothing outside it take clicks or
// the keyboard, and the menus the pack's rows open are moved into it (keepMenusIn in rg_shared.js): inside the
// dialog, the window is under those menus and over the dialog's own content without any z-index contest.
//
// Texts: names, tooltips and dropdown choices are shown in ComfyUI's language, from the same locale files ComfyUI
// reads for its own Settings rows (served at /i18n).
//
// This file imports rg_shared.js, so rg_shared.js must only import it when a row's button is clicked (as rg_keys.js).
import { api } from "../../scripts/api.js";
import { getSetting, setSetting, svgIcon, SETTINGS_PAGES, settingDefs, pageChanged } from "./rg_shared.js";

const CSS = `.rg-setwin { position:absolute; inset:0; z-index:5; display:flex; flex-direction:column; box-sizing:border-box; border-radius:inherit; overflow:hidden;
  font:13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--input-text,#ddd); background:var(--comfy-menu-bg,#232323); pointer-events:auto; outline:none; }
.rg-setwin-head { display:flex; align-items:center; gap:10px; padding:10px 12px 10px 16px; border-bottom:1px solid var(--border-color,#444); }
.rg-setwin-head b { font-size:15px; margin-right:auto; }
.rg-setwin-head input { width:220px; box-sizing:border-box; padding:4px 8px; border-radius:5px; border:1px solid var(--border-color,#555);
  background:var(--comfy-input-bg,#1a1a1a); color:inherit; font:inherit; }
.rg-setwin button { font:inherit; color:inherit; cursor:pointer; }
.rg-setwin-btn { background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#555); border-radius:5px; padding:4px 12px; }
.rg-setwin-btn:hover { border-color:var(--rg-accent,#5b8fd0); }
.rg-setwin-btn.warn { border-color:#c0504d; color:#ffb3ae; }
.rg-setwin-x { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:5px; background:none; border:1px solid transparent; }
.rg-setwin-x:hover { border-color:var(--border-color,#555); }
.rg-setwin-x svg { width:16px; height:16px; }
.rg-setwin-main { flex:1 1 auto; min-height:0; display:flex; }
.rg-setwin-nav { flex:0 0 210px; overflow:auto; padding:8px 0; border-right:1px solid var(--border-color,#444); background:rgba(0,0,0,.14); }
.rg-setwin-nav button { display:flex; align-items:center; justify-content:space-between; gap:6px; width:100%; text-align:left; padding:7px 14px;
  background:none; border:0; border-left:3px solid transparent; }
.rg-setwin-nav button:hover { background:rgba(255,255,255,.06); }
.rg-setwin-nav button.on { background:color-mix(in srgb, var(--rg-accent,#5b8fd0) 22%, transparent); border-left-color:var(--rg-accent,#5b8fd0); }
.rg-setwin-nav button span { opacity:.6; font-size:11px; white-space:nowrap; }
.rg-setwin-page { flex:1 1 auto; min-width:0; overflow:auto; padding:10px 18px 16px; }
.rg-setwin-grp { font-weight:700; margin:16px 0 4px; padding-top:10px; border-top:1px solid var(--border-color,#444); }
.rg-setwin-grp:first-child { margin-top:2px; padding-top:0; border-top:0; }
.rg-setwin-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:5px 0; min-height:30px; }
.rg-setwin-row > label { flex:1 1 auto; min-width:0; opacity:.9; }
.rg-setwin-row > .rg-setwin-ctl { flex:0 1 auto; display:flex; align-items:center; gap:8px; max-width:62%; min-width:0; }
.rg-setwin-ctl select, .rg-setwin-ctl input[type=number], .rg-setwin-ctl input[type=text] { box-sizing:border-box; padding:4px 8px; border-radius:5px;
  border:1px solid var(--border-color,#555); background:var(--comfy-input-bg,#1a1a1a); color:inherit; font:inherit; max-width:100%; }
.rg-setwin-ctl input[type=number] { width:86px; }
.rg-setwin-ctl input[type=text] { width:320px; }
.rg-setwin-ctl input[type=range] { width:140px; }
.rg-setwin-sw { position:relative; flex:0 0 auto; width:36px; height:20px; border-radius:10px; border:0; padding:0; background:#555; transition:background .12s; }
.rg-setwin-sw::after { content:""; position:absolute; left:3px; top:3px; width:14px; height:14px; border-radius:50%; background:#1b1b1b; transition:left .12s; }
.rg-setwin-sw.on { background:#0b8ce9; }
.rg-setwin-sw.on::after { left:19px; }
.rg-setwin-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px 8px 16px; border-top:1px solid var(--border-color,#444);
  font-size:12px; }
.rg-setwin-foot span { opacity:.65; }
.rg-setwin-none { opacity:.6; padding:14px 0; }`;

let tr = null;                                   // every pack's locale files: { language: { settings: { id: { name, tooltip, options } } } }
const norm = (k) => String(k).replace(/\./g, "_");          // the frontend's key for a setting id
const lang = () => { try { return getSetting("Comfy.Locale", "en") || "en"; } catch (e) { return "en"; } };
const trOf = (d) => tr?.[lang()]?.settings?.[norm(d.id)];
const nameOf = (d) => trOf(d)?.name || d.name;
const tipOf = (d) => trOf(d)?.tooltip || d.tooltip || "";
const optLabel = (d, text) => trOf(d)?.options?.[text] || text;
const catLabel = (text) => tr?.[lang()]?.settingsCategories?.[norm(text)] || text;
const pageTitle = (key) => { const row = settingDefs().find((d) => d.rgRow === key); return row ? nameOf(row) : key; };
const kind = (d) => d.rgType || d.type;

let win = null, onKey = null;

export function closeSettingsWindow() {
    if (!win) return;
    win.remove(); win = null;
    if (onKey) { document.removeEventListener("keydown", onKey, true); onKey = null; }
    window.dispatchEvent(new Event("rg-settings"));          // the tab's rows show their "n changed" again
}

// one setting as a row: its name (with its tooltip) and the control for its kind
// short: Under its section's heading a row can show a shorter label (rgLabel). In another language the label is the
// translated name without its "Preset: " start, which the heading says already.
const shortOf = (d) => { const t = trOf(d)?.name; return !d.rgLabel ? nameOf(d) : !t || t === d.name ? d.rgLabel : t.replace(/^[^:：]{1,30}[:：]\s*/, "").replace(/^./, (c) => (/^[A-Z]/.test(d.rgLabel) ? c.toUpperCase() : c)); };
function row(d, redraw, short = false) {
    const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    const r = mk("div", "rg-setwin-row"); r.dataset.id = d.id;
    const lab = mk("label"); lab.textContent = short ? shortOf(d) : nameOf(d); lab.title = tipOf(d);
    const ctl = mk("div", "rg-setwin-ctl");
    const cur = () => getSetting(d.id, d.defaultValue);
    const set = async (v) => { await setSetting(d.id, v); window.dispatchEvent(new Event("rg-settings")); redraw?.(); };
    const k = kind(d);
    if (typeof k === "function") {
        // the pack's own row (a model-file field, the region colors, an LLM preset row …): built as ComfyUI would
        let el = null;
        try { el = k(nameOf(d), (v) => { set(v); }, cur(), d.attrs || {}); } catch (e) { console.warn("[Region Genie] settings row", d.id, e); }
        if (el) ctl.appendChild(el);
    } else if (k === "boolean") {
        const b = mk("button", "rg-setwin-sw" + (cur() ? " on" : "")); b.type = "button"; b.setAttribute("role", "switch");
        b.setAttribute("aria-checked", cur() ? "true" : "false"); b.title = tipOf(d);
        b.addEventListener("click", () => { const v = !cur(); b.classList.toggle("on", v); b.setAttribute("aria-checked", v ? "true" : "false"); set(v); });
        ctl.appendChild(b);
    } else if (k === "combo") {
        const s = mk("select"); s.title = tipOf(d);
        const opts = typeof d.options === "function" ? d.options(cur()) : d.options || [];
        for (const o of opts) {
            const text = typeof o === "object" ? o.text : String(o), value = typeof o === "object" ? o.value : o;
            const e = mk("option"); e.textContent = optLabel(d, text); e.value = String(value); e.__v = value; s.appendChild(e);
        }
        s.value = String(cur());
        s.addEventListener("change", () => set(s.selectedOptions[0]?.__v ?? s.value));
        ctl.appendChild(s);
    } else if (k === "number" || k === "slider") {
        const a = d.attrs || {};
        const n = mk("input"); n.type = "number"; n.title = tipOf(d);
        for (const key of ["min", "max", "step"]) if (a[key] != null) n[key] = String(a[key]);
        // stepBase: the arrows go to stepBase + multiples of step, and no lower than min (Manual: step size: 1, 8, 16 …)
        if (a.stepBase != null) { n.min = String(a.stepBase); n.addEventListener("input", () => { if (n.value !== "" && +n.value < +a.min) n.value = String(a.min); }); }
        n.value = String(cur());
        const clamp = (v) => { let x = +v; if (!Number.isFinite(x)) x = +d.defaultValue; if (a.min != null) x = Math.max(+a.min, x); if (a.max != null) x = Math.min(+a.max, x); return x; };
        let range = null;
        if (k === "slider") {
            range = mk("input"); range.type = "range"; range.title = tipOf(d);
            for (const key of ["min", "max", "step"]) if (a[key] != null) range[key] = String(a[key]);
            range.value = String(cur());
            range.addEventListener("input", () => { n.value = range.value; });
            range.addEventListener("change", () => set(clamp(range.value)));
            ctl.appendChild(range);
        }
        n.addEventListener("change", () => { const v = clamp(n.value); n.value = String(v); if (range) range.value = String(v); set(v); });
        n.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); });
        ctl.appendChild(n);
    } else {                                                     // text
        const t = mk("input"); t.type = "text"; t.title = tipOf(d); t.value = String(cur() ?? "");
        t.addEventListener("change", () => set(t.value));
        t.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); });
        ctl.appendChild(t);
    }
    r.append(lab, ctl);
    return r;
}

// Opens the window on a page. anchor: the button in ComfyUI's Settings dialog that asked for it.
export async function openSettingsWindow(anchor, key) {
    const dlg = anchor?.closest?.('[role="dialog"]') || document.querySelector('[role="dialog"]');
    if (!dlg) return;
    closeSettingsWindow();
    if (!document.getElementById("rg-setwin-style")) { const st = document.createElement("style"); st.id = "rg-setwin-style"; st.textContent = CSS; document.head.appendChild(st); }
    if (tr === null) { try { tr = await (await api.fetchApi("/i18n")).json(); } catch (e) { tr = {}; } }
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const defs = settingDefs().filter((d) => d.rgPage).sort((x, y) => x.rgIndex - y.rgIndex);
    const box = mk("div", "rg-setwin"); box.tabIndex = -1;
    const head = mk("div", "rg-setwin-head");
    const search = mk("input"); search.type = "text"; search.placeholder = "Search these settings…";
    search.title = "Type part of a setting's name: Every page is searched.";
    const x = mk("button", "rg-setwin-x"); x.type = "button"; x.innerHTML = svgIcon("close"); x.title = "Back to ComfyUI's Settings (Esc)";
    head.append(mk("b", null, "Region Genie settings"), search, x);
    const main = mk("div", "rg-setwin-main"), nav = mk("div", "rg-setwin-nav"), page = mk("div", "rg-setwin-page");
    const foot = mk("div", "rg-setwin-foot");
    const reset = mk("button", "rg-setwin-btn", "Defaults for this page"); reset.type = "button";
    reset.title = "Put every setting on this page back to its default.\nA second click within three seconds does it.";
    foot.append(mk("span", null, "Changes are saved as you make them."), reset);
    main.append(nav, page); box.append(head, main, foot);
    let cur = SETTINGS_PAGES.some((p) => p[0] === key) ? key : SETTINGS_PAGES[0][0];
    const navBtns = {};
    const counts = () => { for (const [k, b] of Object.entries(navBtns)) { const n = pageChanged(k); b.lastChild.textContent = n ? String(n) : ""; b.lastChild.title = n ? `${n} changed from the default` : ""; } };
    const show = () => {
        const q = search.value.trim().toLowerCase();
        page.replaceChildren();
        for (const [k, b] of Object.entries(navBtns)) b.classList.toggle("on", !q && k === cur);
        reset.style.display = q ? "none" : "";
        const list = q ? defs.filter((d) => nameOf(d).toLowerCase().includes(q) || d.name.toLowerCase().includes(q)) : defs.filter((d) => d.rgPage === cur);
        if (!list.length) { page.appendChild(mk("div", "rg-setwin-none", q ? "No setting has that in its name." : "")); return; }
        let last = null;
        for (const d of list) {
            // a search lists the page each match is on; a page is divided by the sections its settings came from
            const grp = q ? pageTitle(d.rgPage) : catLabel(d.rgSection);
            if (grp !== last && (q || new Set(list.map((y) => y.rgSection)).size > 1)) { page.appendChild(mk("div", "rg-setwin-grp", grp)); last = grp; }
            page.appendChild(row(d, counts, !q));
        }
        page.scrollTop = 0;
    };
    for (const [k] of SETTINGS_PAGES) {
        const b = mk("button"); b.type = "button"; b.dataset.page = k;
        b.append(document.createTextNode(pageTitle(k)), mk("span"));
        b.addEventListener("click", () => { cur = k; search.value = ""; show(); });
        nav.appendChild(b); navBtns[k] = b;
    }
    let armed = 0;
    reset.addEventListener("click", async () => {
        if (Date.now() - armed > 3000) {                           // the first click asks, the second does it
            armed = Date.now(); reset.classList.add("warn"); reset.textContent = "Click again to reset this page";
            setTimeout(() => { if (Date.now() - armed >= 3000) { reset.classList.remove("warn"); reset.textContent = "Defaults for this page"; } }, 3100);
            return;
        }
        armed = 0; reset.classList.remove("warn"); reset.textContent = "Defaults for this page";
        for (const d of defs) if (d.rgPage === cur && typeof kind(d) !== "function") await setSetting(d.id, d.defaultValue);
        window.dispatchEvent(new Event("rg-settings")); counts(); show();
    });
    search.addEventListener("input", show);
    search.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); });
    x.addEventListener("click", closeSettingsWindow);
    // Esc: what is on top first (a menu or picker of the pack, the search text), then the window; never ComfyUI's dialog
    onKey = (e) => {
        if (e.key !== "Escape" || !win) return;
        if (document.querySelector(".litecontextmenu, .rg-cp, .rg-keys, .rg-fb")) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (search.value) { search.value = ""; show(); return; }
        closeSettingsWindow();
    };
    document.addEventListener("keydown", onKey, true);
    if (getComputedStyle(dlg).position === "static") dlg.style.position = "relative";
    dlg.appendChild(box); win = box;
    counts(); show();
    box.focus({ preventScroll: true });
}
