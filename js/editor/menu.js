// The canvas's right-click menu (round 38). One part of the Region Genie node's editor (see parts.js).
//
// On a region: what one does to the region under the pointer without looking for its row (edit its prompt, hide,
// reorder, duplicate or delete its layer, delete it); where regions overlap, the others under the pointer are listed
// to pick from. On empty canvas: add a region, paste, the view switches. Every entry calls the function its button
// or key calls: nothing is done here that the rest of the editor can't do.
import { keyText } from "../rg_keys.js";
import { openMenu, closeMenu } from "../rg_menu.js";
import { UNSPEC, CLIPBOARD } from "./shared.js";

export function* menu(E) {
    Object.assign(E, { canvasMenu, deleteRegion, rowMenu });
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
            // round 88: the other tabs of the region's pop-up
            { label: "LoRAs…", fn: () => E.editPrompt(r.id, null, "prompt", null, "loras") },
            { label: "Layers…", icon: "layers", fn: () => E.editPrompt(r.id, null, "prompt", null, "layers") },
            { label: "Color palette…", icon: "palette", fn: () => E.editPrompt(r.id, null, "prompt", null, "palette") },
            { label: "Options…", fn: () => E.editPrompt(r.id, null, "prompt", null, "options") },
            { label: "Hide region", icon: "eyeOff", fn: () => E.change(() => { r.hidden = true; }) },
            null,
            { label: "Move up (in front)", icon: "up", disabled: i <= 0, fn: () => move(-1) },
            { label: "Move down (behind)", icon: "down", disabled: i >= n - 1, fn: () => move(1) },
            null,
            ...(L ? [{ label: "Hide this layer", icon: "eyeOff", fn: () => E.change(() => { L.visible = false; }) },
                { label: "Duplicate this layer", icon: "copy", key: keyText("edit.duplicate").split(" / ")[0] || undefined, fn: () => E.duplicate(L) },
                { label: "Delete this layer", icon: "clear", key: keyText("edit.delete").split(" / ")[0] || undefined, fn: () => E.deleteSelected(L) }] : []),
            { label: lays.length > 1 ? `Delete region and its ${lays.length} layers` : "Delete region", icon: "close", danger: true, fn: () => deleteRegion(r) },
            ...(others.length ? [null, { head: "Also here" }, ...others.map((o) => ({ label: title(o.r), swatch: o.r.color, fn: () => { pickRegion(o.r, o.L); } }))] : []),
        ];
    }
    function emptyItems() {
        const key1 = (id) => keyText(id).split(" / ")[0] || undefined;
        return [
            { label: "Add a region", icon: "regionAdd", fn: () => E.addRegionBtn.click() },
            { label: "Paste layer", icon: "layerAdd", key: key1("edit.paste"), disabled: !CLIPBOARD.layer, fn: () => E.pasteLayer() },
            null,
            { label: "Fit the image in view", icon: "fit", key: key1("view.fit"), fn: () => { E.userView = false; E.fitView(); E.requestDraw(); } },
            { label: "Labels on the canvas", checked: E.node.properties?.rg_labels !== false, fn: () => E.labBtn.click() },
            { label: "Snap to grid", key: key1("view.snap"), checked: !!E.snap, fn: () => { E.snap = !E.snap; E.setSnapIcon(); E.requestDraw(); } },
            { label: "Show the grid without snapping", key: key1("view.grid"), checked: !!E.showGrid, fn: () => { E.showGrid = !E.showGrid; E.setSnapIcon(); E.requestDraw(); } },
            null,
            { label: E.big ? "Back into the node" : "Large editor", icon: "expand", key: key1("view.big"), fn: () => E.toggleBig() },
            { label: "Shortcuts", icon: "keyboard", key: key1("view.help"), fn: () => E.toggleKeys() },
        ];
    }
    // a region goes with its layers and pose figures (Undo brings them back); the first region becomes the active one
    function deleteRegion(r) {
        E.change(() => {
            const i = E.state.regions.indexOf(r);
            if (i < 0) return;
            E.state.regions.splice(i, 1);
            E.state.layers = E.state.layers.filter((l) => l.region !== r.id);
            if (E.state.poses) { E.state.poses = E.state.poses.filter((p) => p.region !== r.id); if (!E.state.poses.length) delete E.state.poses; }
            if (E.curRegion === r.id) E.curRegion = E.state.regions[0]?.id ?? null;
            if (!E.selLayer()) E.selId = null;
        });
    }
    // right-click on a region's row in the list: the region's part of the canvas menu (no layer is under the pointer)
    function rowMenu(r, e) {
        E.curRegion = r.id; E.markRegionRows(); E.requestDraw();
        openMenu(e.clientX, e.clientY, regionItems(r, null, []), { onClose: () => { if (E.wrap.isConnected) E.focusSink(); } });
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
