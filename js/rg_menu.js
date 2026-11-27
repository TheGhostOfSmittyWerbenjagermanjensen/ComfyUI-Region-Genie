// Region Genie: a small menu of the pack's own (the canvas's right-click menu). On the page, at the pointer, not zoomed
// with the graph; each entry can have an icon, a shortcut shown at its right end, a tick, or a region's color.
//   openMenu(x, y, items, { onClose })
//   items: { label, icon, key, fn, disabled, danger, checked, swatch, title, tick } · { head, swatch } (a title line) · null (a line)
//   title: the row's tooltip. tick (true / false): a tick column before the icon, for a list where one entry is the current one.
import { svgIcon } from "./rg_shared.js";

const CSS = `.rg-menu { position:fixed; z-index:10600; min-width:190px; max-width:min(340px, calc(100vw - 12px)); max-height:calc(100vh - 12px);
  overflow:auto; box-sizing:border-box; padding:4px; border-radius:7px; outline:none; user-select:none;
  font:12.5px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--input-text,#ddd);
  background:var(--comfy-menu-bg,#2b2b2b); border:1px solid var(--border-color,#555); box-shadow:0 6px 22px rgba(0,0,0,.5); }
.rg-menu-item { display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:4px; cursor:pointer; white-space:nowrap; }
.rg-menu-item.cur, .rg-menu-item:hover { background:color-mix(in srgb, currentColor 14%, transparent); }
.rg-menu-item.off { opacity:.4; cursor:default; background:none; }
.rg-menu-item.danger { color:#f08a8a; }
.rg-menu-ic { flex:0 0 16px; height:16px; display:inline-flex; align-items:center; justify-content:center; }
.rg-menu-ic svg { width:15px; height:15px; display:block; }
.rg-menu-tick { flex:0 0 12px; height:16px; display:inline-flex; align-items:center; justify-content:center; margin-right:-3px; }
.rg-menu-tick svg { width:12px; height:12px; display:block; }
.rg-menu-sw { width:11px; height:11px; border-radius:3px; border:1px solid rgba(0,0,0,.5); box-sizing:border-box; }
.rg-menu-label { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.rg-menu-key { flex:0 0 auto; margin-left:14px; opacity:.6; font:11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.rg-menu-head { display:flex; align-items:center; gap:8px; padding:4px 8px 5px; font-size:11.5px; opacity:.75; white-space:nowrap; }
.rg-menu-head .rg-menu-label { font-weight:650; }
.rg-menu-sep { height:1px; margin:4px 2px; background:var(--border-color,#555); }
.rg-menu-custom { padding:3px 8px 4px 32px; }`;

let open = null;                                     // one menu at a time

export function closeMenu() { open?.close(); }
export function openMenu(x, y, items, opts = {}) {
    closeMenu();
    if (!document.getElementById("rg-menu-style")) { const st = document.createElement("style"); st.id = "rg-menu-style"; st.textContent = CSS; document.head.appendChild(st); }
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const box = mk("div", "rg-menu"); box.tabIndex = -1; box.setAttribute("role", "menu");
    const rows = [];
    const lead = (it) => {
        const ic = mk("span", "rg-menu-ic");
        if (it.swatch) { const sw = mk("span", "rg-menu-sw"); sw.style.background = it.swatch; ic.append(sw); }
        else if (it.checked != null) { if (it.checked) ic.innerHTML = svgIcon("check"); }      // a switch: a tick or nothing
        else if (it.icon) ic.innerHTML = svgIcon(it.icon);
        return ic;
    };
    for (const it of items) {
        if (!it) { if (box.lastChild && !box.lastChild.classList.contains("rg-menu-sep")) box.append(mk("div", "rg-menu-sep")); continue; }
        // a row of the caller's own (round 99: the grid size field and its sizes): any element, not a menu entry
        if (it.custom) { const c = mk("div", "rg-menu-custom"); c.append(it.custom); box.append(c); continue; }
        if (it.head != null) { const h = mk("div", "rg-menu-head"); h.append(lead(it), mk("span", "rg-menu-label", it.head)); box.append(h); continue; }
        const row = mk("div", "rg-menu-item" + (it.disabled ? " off" : "") + (it.danger ? " danger" : "")); row.setAttribute("role", "menuitem");
        if (it.tick != null) { const tk = mk("span", "rg-menu-tick"); if (it.tick) tk.innerHTML = svgIcon("check"); row.append(tk); row.setAttribute("aria-checked", String(!!it.tick)); }
        row.append(lead(it), mk("span", "rg-menu-label", it.label));
        if (it.title) row.title = it.title;
        if (it.key) row.append(mk("span", "rg-menu-key", it.key));
        if (it.checked != null) row.setAttribute("aria-checked", String(!!it.checked));
        if (!it.disabled) { row.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); close(); it.fn?.(e); }); rows.push(row); }
        box.append(row);
    }
    if (box.lastChild?.classList.contains("rg-menu-sep")) box.lastChild.remove();
    document.body.appendChild(box);
    const w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = Math.round(Math.max(4, Math.min(x, window.innerWidth - w - 4))) + "px";
    box.style.top = Math.round(Math.max(4, y + h > window.innerHeight - 4 ? y - h : y)) + "px";
    const stop = (e) => e.stopPropagation();
    for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "wheel"]) box.addEventListener(ev, stop);
    box.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); });
    let cur = -1;
    const mark = (i) => { rows[cur]?.classList.remove("cur"); cur = i; rows[cur]?.classList.add("cur"); rows[cur]?.scrollIntoView({ block: "nearest" }); };
    const key = (e) => {
        // typing in a field of the menu (a custom row): the keys are the field's; Esc and Tab still close the menu
        if (e.target?.tagName === "INPUT" && box.contains(e.target) && e.key !== "Escape" && e.key !== "Tab") return;
        if (e.key === "Escape") close();
        else if (e.key === "ArrowDown") mark((cur + 1) % rows.length);
        else if (e.key === "ArrowUp") mark((cur - 1 + rows.length) % rows.length);
        else if (e.key === "Enter" && rows[cur]) rows[cur].click();
        else if (e.key === "Tab") close();
        else return;
        e.preventDefault(); e.stopPropagation();
    };
    const outside = (e) => { if (!box.contains(e.target)) close(); };
    function close() {
        if (open?.box !== box) return;
        open = null;
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", key, true);
        document.removeEventListener("wheel", outside, true);
        window.removeEventListener("blur", close); window.removeEventListener("resize", close);
        box.remove();
        opts.onClose?.();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("wheel", outside, true);
    window.addEventListener("blur", close); window.addEventListener("resize", close);
    open = { box, close };
    return open;
}
