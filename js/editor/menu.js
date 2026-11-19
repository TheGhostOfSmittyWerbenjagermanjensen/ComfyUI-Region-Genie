// The canvas's right-click menu (round 38). One part of the Region Genie node's editor (see parts.js).
//
// On a region: what one does to the region under the pointer without looking for its row (edit its prompt, hide,
// reorder, duplicate or delete its layer, delete it); where regions overlap, the others under the pointer are listed
// to pick from. On empty canvas: add a region, paste, the view switches. Every entry calls the function its button
// or key calls: nothing is done here that the rest of the editor can't do.
import { keyLabel } from "../rg_shared.js";
import { openMenu, closeMenu } from "../rg_menu.js";
import { UNSPEC, CLIPBOARD } from "./shared.js";
import { bigKeyText } from "./big.js";

export function* menu(E) {
    Object.assign(E, { canvasMenu });
    yield;

    const short = (r) => { const p = (r.prompt || "").trim().replace(/\s+/g, " "); return p ? (p.length > 34 ? p.slice(0, 33) + "…" : p) : "(no prompt)"; };
    const numOf = (r) => { const i = E.state.regions.indexOf(r), el = E.regList?.querySelector(`.rg-idx[data-k="${i}"]`); return el?.textContent?.trim() || String(i); };
    const title = (r) => `${numOf(r)}: ${short(r)}`;

    function regionItems(r, L, others) {
        const i = E.state.regions.indexOf(r), n = E.state.regions.length;
        const lays = E.state.layers.filter((l) => l.region === r.id);
        const move = (d) => E.change(() => { [E.state.regions[i + d], E.state.regions[i]] = [E.state.regions[i], E.state.regions[i + d]]; E.sortLayersByRegions(); });
        return [
            { head: title(r), swatch: r.color },
            { label: "Edit prompt…", icon: "expand", key: "Double-click its label", fn: () => E.editPrompt(r.id, null) },
            { label: "Hide region", icon: "eyeOff", fn: () => E.change(() => { r.hidden = true; }) },
            null,
            { label: "Move up (in front)", icon: "up", disabled: i <= 0, fn: () => move(-1) },
            { label: "Move down (behind)", icon: "down", disabled: i >= n - 1, fn: () => move(1) },
            null,
            { label: "Duplicate this layer", icon: "copy", key: "Ctrl+D", fn: () => E.duplicate(L) },
            { label: "Delete this layer", icon: "clear", key: "Del", fn: () => E.deleteSelected(L) },
            { label: lays.length > 1 ? `Delete region and its ${lays.length} layers` : "Delete region", icon: "close", danger: true, fn: () => E.change(() => {
                E.state.regions.splice(E.state.regions.indexOf(r), 1);
                E.state.layers = E.state.layers.filter((l) => l.region !== r.id);
                if (E.curRegion === r.id) E.curRegion = E.state.regions[0]?.id ?? null;
                if (!E.selLayer()) E.selId = null;
            }) },
            ...(others.length ? [null, { head: "Also here" }, ...others.map((o) => ({ label: title(o.r), swatch: o.r.color, fn: () => { pickRegion(o.r, o.L); } }))] : []),
        ];
    }
    function emptyItems() {
        const big = keyLabel(bigKeyText());
        return [
            { label: "Add a region", icon: "regionAdd", fn: () => E.addRegionBtn.click() },
            { label: "Paste layer", icon: "layerAdd", key: "Ctrl+V", disabled: !CLIPBOARD.layer, fn: () => E.pasteLayer() },
            null,
            { label: "Fit the image in view", icon: "fit", key: "Home", fn: () => { E.userView = false; E.fitView(); E.requestDraw(); } },
            { label: "Labels on the canvas", checked: E.node.properties?.rg_labels !== false, fn: () => E.labBtn.click() },
            { label: "Snap to grid", key: "G", checked: !!E.snap, fn: () => { E.snap = !E.snap; E.setSnapIcon(); E.requestDraw(); } },
            null,
            { label: E.big ? "Back into the node" : "Large editor", icon: "expand", key: big || undefined, fn: () => E.toggleBig() },
            { label: "Shortcuts", icon: "keyboard", key: "?", fn: () => E.toggleKeys() },
        ];
    }
    // the region becomes the active one and its layer the selected one, as a click with the Select tool does
    function pickRegion(r, L) {
        E.selId = L.id; E.hiddenSel = null; E.curRegion = r.id;
        E.markLayerRows(); E.markRegionRows(); E.requestDraw();
    }
    function canvasMenu(e) {
        if (E.clickPoly || E.pick || E.drag) return;                       // an outline or a selection in the making keeps the pointer
        const [dx, dy] = E.evDisplay(e);
        const seen = new Set(), here = [];
        for (const L of E.hitLayers(dx, dy)) {
            if (L.region === UNSPEC || seen.has(L.region)) continue;
            const r = E.regionById(L.region);
            if (r) { seen.add(L.region); here.push({ r, L }); }
        }
        E.focusSink();
        if (here.length) pickRegion(here[0].r, here[0].L);
        const items = here.length ? regionItems(here[0].r, here[0].L, here.slice(1)) : emptyItems();
        openMenu(e.clientX, e.clientY, items, { onClose: () => { if (E.wrap.isConnected) E.focusSink(); } });
    }
    E.cv.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); canvasMenu(e); });
    // the menu goes with the editor (another workflow tab, the node deleted)
    E.closeMenu = closeMenu;
}
