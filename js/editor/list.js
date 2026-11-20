// The region list: one tree of regions with their LoRAs, layers and palettes.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { svgIcon, setHTML, knownLoras, pickLora, contextMenu, fillTriggerChips } from "../rg_shared.js";
import { openColorPicker } from "../rg_colorpicker.js";
import { UNSPEC } from "./shared.js";
import { PAL_MAX, normPalette, activePalette } from "./colors.js";

export function* list(E) {
    Object.assign(E, {
        activateRegion, refreshUI, ico, chevron, grip, subHeader, toggleKind, updateExpandButtons, loraRows, addLoraTo, layerRows,
        regionSwatch, featherBox, paletteToggle, paletteRow,
    });
    yield;

    // ---------------- panel: one tree of regions -> LoRAs + layers ----------------
    function activateRegion(rid) {                // returns true if anything changed
        if (E.curRegion === rid) return false;
        E.curRegion = rid;
        return true;
    }
    function refreshUI() {
        if (E.curRegion != null && E.curRegion !== UNSPEC && !E.regionById(E.curRegion)) E.curRegion = E.state.regions[0]?.id ?? null;
        E.syncToolOpts();                              // the shape fields follow the selected layer
        const L = E.selLayer();
        if (L && L.shape === "star") E.sidesIn.value = String(L.sides);
        if (L && L.shape === "roundrect" && document.activeElement !== E.radiusIn) E.radiusIn.value = String(L.radius ?? 20);
        E.renderRegions();
        E.editor?.refresh();
        E.syncTips();
        E.requestDraw();
    }
    function ico(symbol, title, fn, cls = "ico") {
        const b = E.btn(symbol, title, fn);
        b.classList.add(cls);
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        return b;
    }
    const layersOf = (rid) => {                    // top first
        const out = [];
        for (let i = E.state.layers.length - 1; i >= 0; i--) if (E.state.layers[i].region === rid) out.push(E.state.layers[i]);
        return out;
    };
    // the layers listed under a region: its own and its holes (region 0 layers listed there), top first
    const listedOf = (rid) => {
        const out = [];
        for (let i = E.state.layers.length - 1; i >= 0; i--) {
            const L = E.state.layers[i];
            if (L.region === rid || (L.region === UNSPEC && E.holeOwner(L) === rid)) out.push(L);
        }
        return out;
    }; E.listedOf = listedOf;
    // what an open row / subsection shows; empty subsections are left out
    const subKinds = (r) => [
        ...(listedOf(r.id).length ? ["layers"] : []),
        ...((r.loras || []).length ? ["loras"] : []),
        ...(r.paletteOn ? ["palette"] : []),
    ]; E.subKinds = subKinds;
    function chevron(key, has, what) {
        const c = E.el("span", "rg-chev" + (has ? "" : " empty"));
        const open = has && E.expanded.has(key);
        c.textContent = has ? (open ? "▼" : "▶") : "•";
        c.title = has ? `${open ? "Hide" : "Show"} ${what}` : `No ${what} yet`;
        c.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            if (!has) return;
            if (E.expanded.has(key)) E.expanded.delete(key); else E.expanded.add(key);
            E.renderRegions();
        });
        return c;
    }
    // ---- drag to reorder (round 35): the grip at the start of a region's row or of a layer's row.
    // A region lands between two regions (the list order is the output order and the stacking order). A layer lands
    // above or below another layer, also another region's, or on a region's row (on top of that region's layers).
    // A line (or the lit region row) shows where; letting go outside the list changes nothing. One undo step.
    function grip(kind, id, onPick) {
        const g = E.el("span", "rg-grip"); g.innerHTML = svgIcon("grip");
        g.title = kind === "region" ? "Click: Make this region the active one.\nDrag: Move it up or down in the list (the output order; the top region is in front)."
            : "Click: Select this layer.\nDrag: Move it above or below another layer, or onto another region's row.";
        g.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            onPick?.();                                          // pressing the grip picks its row, as its prompt / name field does
            const line = E.el("div", "rg-dropline");
            let target = null;                                   // region: { to } | layer: { lid, after } or { rid }
            const self = () => E.regList.querySelector(kind === "region" ? `.rg-row.region[data-rid="${id}"]` : `.rg-row.layer[data-lid="${id}"]`);
            self()?.classList.add("dragging");
            E.wrap.classList.add("rg-sorting");
            const clear = () => { line.remove(); E.regList.querySelector(".rg-row.dropon")?.classList.remove("dropon"); };
            let last = null;
            const move = (ev) => {
                last = ev;
                const box = E.regList.getBoundingClientRect(), y = ev.clientY;
                clear(); target = null;
                if (ev.clientX < box.left - 40 || ev.clientX > box.right + 40 || y < box.top - 30 || y > box.bottom + 30) return;
                const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
                if (kind === "region") {
                    const rows = [...E.regList.querySelectorAll(".rg-row.region")];
                    let to = rows.findIndex((el) => y < mid(el)); if (to < 0) to = rows.length;
                    const from = E.state.regions.findIndex((r) => r.id === id);
                    if (to === from || to === from + 1) return;                 // where it already is
                    target = { to };
                    if (to < rows.length) rows[to].before(line); else E.regList.appendChild(line);
                    return;
                }
                const rows = [...E.regList.querySelectorAll(".rg-row.layer, .rg-row.region")];
                let best = null, bd = Infinity;
                for (const el of rows) { const r = el.getBoundingClientRect(), d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (d < bd) { bd = d; best = el; } }
                if (!best) return;
                if (best.classList.contains("region")) { target = { rid: Number(best.dataset.rid) }; best.classList.add("dropon"); return; }
                if (best.dataset.lid === String(id)) return;
                const after = y >= mid(best);
                target = { lid: Number(best.dataset.lid), after };
                if (after) best.after(line); else best.before(line);
            };
            // held near the list's top or bottom edge: the list scrolls, so a row out of view can be reached
            const scroller = setInterval(() => {
                if (!last) return;
                const box = E.regList.getBoundingClientRect(), y = last.clientY, was = E.regList.scrollTop;
                if (y < box.top + 16 && y > box.top - 30) E.regList.scrollTop -= 8; else if (y > box.bottom - 16 && y < box.bottom + 30) E.regList.scrollTop += 8;
                if (E.regList.scrollTop !== was) move(last);
            }, 40);
            const done = (ev) => {
                clearInterval(scroller);
                for (const t of ["pointermove", "pointerup", "pointercancel"]) window.removeEventListener(t, t === "pointermove" ? move : done, true);
                clear(); self()?.classList.remove("dragging"); E.wrap.classList.remove("rg-sorting");
                if (ev.type === "pointerup" && target) (kind === "region" ? dropRegion : dropLayer)(id, target);
                E.focusSink();
            };
            window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", done, true); window.addEventListener("pointercancel", done, true);
        });
        for (const ev of ["mousedown", "click", "dblclick"]) g.addEventListener(ev, (e) => e.stopPropagation());
        return g;
    }
    function dropRegion(id, { to }) {
        const from = E.state.regions.findIndex((r) => r.id === id);
        if (from < 0) return;
        E.change(() => {
            const [r] = E.state.regions.splice(from, 1);
            E.state.regions.splice(to > from ? to - 1 : to, 0, r);
            E.sortLayersByRegions();
        });
    }
    function dropLayer(id, t) {
        const L = E.state.layers.find((l) => l.id === id);
        if (!L) return;
        const hole = L.region === UNSPEC;
        if (t.rid != null) {                                     // onto a region's row: on top of that region's layers
            if (!E.regionById(t.rid)) return;
            E.change(() => {
                if (hole) L.owner = t.rid; else { L.region = t.rid; delete L.owner; E.curRegion = t.rid; }
                E.state.layers.splice(E.state.layers.indexOf(L), 1);
                E.state.layers.splice(E.slotFor(t.rid), 0, L);
                E.selId = L.id; E.openSub(t.rid, "layers");
            });
            return;
        }
        const T = E.state.layers.find((l) => l.id === t.lid);
        if (!T || T === L) return;
        const rid = T.region === UNSPEC ? E.holeOwner(T) : T.region;        // the region the target is listed under
        E.change(() => {
            if (hole) { if (rid != null) L.owner = rid; } else if (rid != null && L.region !== rid) { L.region = rid; delete L.owner; E.curRegion = rid; }
            E.state.layers.splice(E.state.layers.indexOf(L), 1);
            // the list shows the top layer first: "below T in the list" is right under T in the stack
            E.state.layers.splice(E.state.layers.indexOf(T) + (t.after ? 0 : 1), 0, L);
            E.sortLayersByRegions();                             // regions stay together, holes keep their slots
            E.selId = L.id; if (rid != null) E.openSub(rid, "layers");
        });
    }
    // a subsection header inside an open region: ▶ Layers (3)
    function subHeader(r, kind) {
        const key = `${r.id}:${kind}`, open = E.subOpen.has(key);
        const n = kind === "layers" ? listedOf(r.id).length : kind === "loras" ? (r.loras || []).length : normPalette(r.palette).length;
        const label = { layers: "Layers", loras: "LoRAs", palette: "Color palette" }[kind];
        const row = E.el("div", "rg-row sub");
        const ch = E.el("span", "rg-chev"); ch.textContent = open ? "▼" : "▶";
        const t = E.el("span", "rg-subname"); t.textContent = `${label} (${n})`;
        row.title = `${open ? "Hide" : "Show"} this region's ${label.toLowerCase()}`;
        row.append(ch, t);
        row.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            if (E.subOpen.has(key)) E.subOpen.delete(key); else E.subOpen.add(key);
            E.renderRegions();
        });
        return row;
    }
    // header buttons: kind = "layers" | "loras" | "palette" | "all"
    function kindTargets(kind) {
        const out = [];                                // [rowKey, subKey or null]
        for (const r of E.state.regions) {
            if (kind === "all") out.push([r.id, null]);        // every region has its options line, also without layers
            for (const k of subKinds(r)) if (kind === "all" || kind === k) out.push([r.id, `${r.id}:${k}`]);
        }
        if ((kind === "loras" || kind === "all") && (E.state.sceneLoras || []).length) out.push([E.SCENE, null]);
        return out;
    }
    const kindOpen = (kind) => {
        const t = kindTargets(kind);
        return t.length > 0 && t.every(([rk, sk]) => E.expanded.has(rk) && (sk == null || E.subOpen.has(sk)));
    };
    function toggleKind(kind) {
        const t = kindTargets(kind);
        if (kind === "all") {
            if (kindOpen("all")) { E.expanded.clear(); E.subOpen.clear(); }
            else for (const [rk, sk] of t) { E.expanded.add(rk); if (sk) E.subOpen.add(sk); }
        } else if (kindOpen(kind)) {
            for (const [rk, sk] of t) {
                if (!sk) { E.expanded.delete(rk); continue; }
                E.subOpen.delete(sk);
                // nothing else open in that region: close the region too
                const r = E.regionById(rk);
                if (r && !subKinds(r).some((k) => E.subOpen.has(`${rk}:${k}`))) E.expanded.delete(rk);
            }
        } else {
            for (const [rk, sk] of t) { E.expanded.add(rk); if (sk) E.subOpen.add(sk); }
        }
        E.renderRegions();
    }
    function updateExpandButtons() {
        const names = { loras: "LoRAs", all: "All" };              // layers and palettes: icons
        for (const [k, b] of Object.entries(E.expandBtns)) {
            const any = kindTargets(k).length > 0;
            const arrow = any && kindOpen(k) ? "▲" : "▼";
            const html = names[k] ? `${arrow} ${names[k]}` : `<span>${arrow}</span>${svgIcon(k)}`;
            if (b.__html !== html) { b.__html = html; b.innerHTML = html; b.classList.toggle("mixed", !names[k]); }
            b.disabled = !any;
        }
    }
    // one LoRA of a region (or of the whole image), with its trigger words as chips
    function loraRows(list, owner) {
        // owner: { prompt(): string, append(word) } (region prompt, or scene_prompt_positive for whole-image LoRAs)
        const frag = document.createDocumentFragment();
        list.forEach((lo, i) => {
            if (owner?.sceneOnly && (lo.edit || lo.control)) return;          // on the Edit / Control rows instead
            const row = E.el("div", "rg-row lora");
            const tag = E.el("span", "rg-hint"); tag.textContent = lo.control ? "Control" : lo.edit ? "Edit" : "LoRA";
            if (lo.edit) {
                tag.title = `Edit LoRA for ${lo.edit}, added by Edit Mode: Used only in Edit Mode with a ${lo.edit} model, `
                    + "and removed when the node is switched back to generate (Settings > Region Genie > Edit Mode).";
                row.classList.add("edit");
            }
            const on = E.el("input"); on.type = "checkbox"; on.checked = lo.on !== false; on.title = "On / off";
            on.addEventListener("change", () => E.change(() => { lo.on = on.checked; }));
            const pick = E.el("button", "rg-pick");
            const setLabel = () => {
                pick.textContent = lo.lora || "(choose a LoRA)";
                pick.title = lo.lora || "Choose a LoRA";
                pick.classList.toggle("missing", !!lo.lora && !!knownLoras() && !knownLoras().includes(lo.lora));
            };
            setLabel();
            pick.addEventListener("pointerdown", (e) => e.stopPropagation());
            pick.addEventListener("click", async (e) => {
                const ok = await pickLora(e, (name) => { E.change(() => { lo.lora = name; }); E.focusSink(); });
                if (!ok) E.hint("No LoRAs found in models/loras");
            });
            const str = E.el("input", "rg-num"); str.type = "number"; str.step = "0.05"; str.min = "-10"; str.max = "10";
            str.value = String(lo.strength); str.title = "LoRA strength";
            str.addEventListener("change", () => { const v = +str.value; if (Number.isFinite(v)) E.change(() => { lo.strength = v; }); });
            str.addEventListener("keydown", (e) => e.stopPropagation());
            const del = ico("@close", "Remove this LoRA", () => E.change(() => { list.splice(i, 1); }));
            row.append(tag, on, pick, E.rowWord("strength", str), str, del);
            frag.appendChild(row);
            const chips = E.el("div", "rg-trig");
            frag.appendChild(chips);
            if (!lo.lora) return;
            fillTriggerChips(chips, lo.lora, owner.prompt, (w) => owner.append([w]), E.el);
        });
        return frag;
    }
    function addLoraTo(list, ev, onAdded) {
        pickLora(ev, (name) => { onAdded?.(); E.change(() => { list.push({ lora: name, strength: 1, on: true }); }); E.focusSink(); })
            .then((ok) => { if (!ok) E.hint("No LoRAs found in models/loras"); });
    }
    function layerRows(rid) {
        const frag = document.createDocumentFragment();
        for (const L of listedOf(rid)) {
            const hole = L.region === UNSPEC;
            const row = E.el("div", "rg-row lvl1 layer" + (L.id === E.selId ? " sel" : "") + (hole ? " hole" : ""));
            row.dataset.lid = String(L.id);
            row.addEventListener("pointerdown", (e) => { if (e.target === row || e.target.classList.contains("rg-sw")) E.selectLayer(L); });
            const eye = ico(L.visible === false ? "@eyeOff" : "@eye", "Show / hide (hidden layers are not output)", () => E.change(() => { L.visible = L.visible === false; }));
            const sw = E.el("div", "rg-sw"); if (!hole) sw.style.background = E.colorOf(L.region) || "transparent";
            sw.title = hole ? "A hole: Select this layer" : "Select this layer";
            const cut = ico("@scissors", hole ? "Hole: On. This layer cuts its area out of every layer below it (no region there; black in "
                + "color_map). Click to paint this region again." : "Hole: Off. Click to make this layer cut a hole through every "
                + "layer below it (no region there).", () => E.toggleHole(L));
            cut.classList.toggle("on", hole);
            const name = E.el("input"); name.type = "text"; name.value = L.name; name.title = "Layer name";
            name.addEventListener("focus", () => { if (E.selId !== L.id || E.hiddenSel === L.id) { E.selId = L.id; E.hiddenSel = null; E.curRegion = L.region; E.markLayerRows(); E.requestDraw(); } });
            name.addEventListener("change", () => E.change(() => { L.name = name.value; }));
            name.addEventListener("keydown", (e) => e.stopPropagation());
            const up = ico("@up", L.region === UNSPEC ? "Move up one step in the stack (the hole then cuts through what it moved over)" : "Move up (in front of this region's other layers)", () => E.moveLayer(L, +1));
            up.disabled = E.moveTarget(L, +1) < 0;
            const dn = ico("@down", L.region === UNSPEC ? "Move down one step in the stack (what it moved under is no longer cut)" : "Move down (behind this region's other layers)", () => E.moveLayer(L, -1));
            dn.disabled = E.moveTarget(L, -1) < 0;
            const dup = ico("@copy", "Duplicate (Ctrl+D).\nRight-click: Duplicate into another region.", () => E.duplicate(L));
            dup.classList.add("variants");
            dup.addEventListener("pointerdown", (e) => { if (e.button === 2) e.stopPropagation(); });
            dup.addEventListener("contextmenu", (e) => {
                e.preventDefault(); e.stopPropagation();
                const items = [{ content: "Duplicate in this region", rid: L.region }];
                for (const it of E.regionTargets(L.region)) items.push({ content: `Duplicate to ${it.label}`, rid: it.rid });
                contextMenu(e, items, "Duplicate layer", (v) => { if (v && v.rid != null) E.duplicateTo(L, v.rid); E.focusSink(); });
            });
            const lower = (() => { const i = E.state.layers.indexOf(L); return E.state.layers.slice(0, i).reverse().find((l) => l.region === L.region && l.visible !== false); })();
            const md = ico("@mergeDown", "Merge down into the next lower layer of this region", () => E.mergeDown(L));
            md.disabled = !lower;
            const mv = ico("@moveTo", "Move this layer to another region", (e) => {
                const items = E.regionTargets(L.region).map((it) => ({ content: `Move to ${it.label}`, rid: it.rid }));
                contextMenu(e, items, "Move to region", (v) => { if (v && v.rid != null) E.moveLayerToRegion(L, v.rid); E.focusSink(); });
            });
            const er = ico("@eraseLayer", "Erase layer: Remove its shapes and paint, keep the empty layer", () => E.eraseLayer(L));
            const del = ico("@clear", "Delete layer (Delete / Backspace)", () => E.deleteSelected(L));
            // the grip selects the layer the way its name field does (no rebuilt list under the pointer)
            const pickLayer = () => { if (E.selId !== L.id || E.hiddenSel === L.id) { E.selId = L.id; E.hiddenSel = null; E.curRegion = L.region; E.markLayerRows(); E.markRegionRows(); E.requestDraw(); } };
            row.append(grip("layer", L.id, pickLayer), eye, sw, name, cut, up, dn, dup, md, mv, er, del);
            frag.appendChild(row);
        }
        return frag;
    }
    // ---- pieces of a region's row, shared by the list and the pop-up editor ----
    // the region's color: its own color, or the first palette color when it has a palette
    function regionSwatch(r, pick) {
        const pal = activePalette(r);
        let sw;
        if (r.fromImage && !pal.length) {
            sw = E.el("div", "rg-sw"); sw.style.background = r.color;
            sw.title = `${r.color} (found in the image, so its color can't change)`;
        } else {
            sw = E.el("button", "rg-sw pick"); sw.type = "button"; sw.style.background = E.colorOf(r.id);
            sw.title = pal.length ? `${E.colorOf(r.id)}: The region is shown in its first palette color. Click to change it.`
                : `${r.color}: Click to change the color (display only).`;
            const apply = (v) => {
                if (activePalette(r).length) { r.palette = normPalette(r.palette); r.palette[0] = v.toUpperCase(); }
                else r.color = E.uniqueColor(v, r.id);
            };
            sw.addEventListener("pointerdown", (e) => e.stopPropagation());
            sw.addEventListener("click", (e) => {
                e.preventDefault();
                pick?.();
                pickColor(sw, E.colorOf(r.id), apply);
            });
        }
        sw.dataset.swatch = String(r.id);
        return sw;
    }
    // the color picker on a swatch: changes show live, the whole pick is one undo step
    // before: a snapshot taken before an edit that already happened (a new palette color): then closing
    // the picker keeps that edit even when the color wasn't changed
    function pickColor(anchor, start, apply, before = null) {
        const added = before != null;
        openColorPicker(anchor, start, {
            onInput: (hex) => {
                if (before == null) before = E.snapshot();
                apply(hex); E.version++; liveColors();
                if (anchor.isConnected) anchor.style.background = hex;
            },
            onClose: (hex, changed) => {
                if ((!changed && !added) || before == null) return;
                E.pushUndo(before);
                E.save(); refreshUI(); E.focusSink();          // Ctrl+Z goes to the editor next
            },
        });
    }
    // colors changed while a color picker is open: update the canvas and the swatches, keep the picker
    function liveColors() {
        for (const s of E.wrap.querySelectorAll("[data-swatch]")) {
            const c = E.colorOf(Number(s.dataset.swatch) || s.dataset.swatch);
            if (!c) continue;
            if (s.tagName === "INPUT") { if (document.activeElement !== s) s.value = c.toLowerCase(); }
            else s.style.background = c;
        }
        if (E.editor) E.editor.box.style.borderColor = E.colorOf(E.editor.rid) || "#5b8fd0";
        E.requestDraw();
    }
    // mask feather: shared by all linked regions, or this region's own value when unlinked
    function featherBox(r) {
        const fBox = E.el("span", "rg-feather");
        const linked = r.featherLinked !== false;
        const fIn = E.el("input", "rg-num"); fIn.type = "number"; fIn.min = "0"; fIn.max = "512"; fIn.step = "1";
        fIn.value = String(linked ? (E.state.feather || 0) : (r.feather || 0));
        fIn.title = linked ? "Feather (px): Softens this region's mask edges in 'masks' and for its LoRAs. "
            + "\nLinked: The same value for every linked region." : "Feather (px) of this region only (unlinked)";
        fIn.addEventListener("keydown", (e) => e.stopPropagation());
        fIn.addEventListener("change", () => {
            const v = Math.max(0, Math.min(512, Math.round(+fIn.value || 0)));
            E.change(() => { if (r.featherLinked !== false) E.state.feather = v; else r.feather = v; });
        });
        const fLink = E.el("button", "rg-btn mini toggle" + (linked ? " on" : ""));
        setHTML(fLink, svgIcon(linked ? "link" : "unlink"));
        fLink.title = linked ? "Linked: Every linked region uses the same feather. Click to give this region its own value."
            : "Own feather value. Click to link it to the shared value again.";
        fLink.addEventListener("pointerdown", (e) => e.stopPropagation());
        fLink.addEventListener("click", (e) => {
            e.preventDefault();
            E.change(() => {
                if (r.featherLinked !== false) { r.featherLinked = false; r.feather = E.state.feather || 0; }
                else { r.featherLinked = true; delete r.feather; }
            });
        });
        const fEdge = E.el("button", "rg-btn mini toggle" + (r.featherEdges ? " on" : ""));
        setHTML(fEdge, svgIcon("edges"));
        fEdge.title = r.featherEdges ? "feather_canvas_edges on: Edges on the image border fade too. Click to keep them solid."
            : "feather_canvas_edges off: Edges on the image border stay solid. Click to fade them too.";
        fEdge.addEventListener("pointerdown", (e) => e.stopPropagation());
        fEdge.addEventListener("click", (e) => { e.preventDefault(); E.change(() => { if (r.featherEdges) delete r.featherEdges; else r.featherEdges = true; }); });
        const fIco = E.el("span", "rg-fico"); fIco.innerHTML = svgIcon("feather"); fIco.title = fIn.title;
        fBox.append(fIco, fIn, fLink, fEdge);
        return fBox;
    }
    // color palette on/off (a row of up to 5 colors under the region)
    function paletteToggle(r) {
        const b = E.el("button", "rg-btn mini toggle" + (r.paletteOn ? " on" : ""));
        b.innerHTML = svgIcon("palette");
        const n = normPalette(r.palette).length;
        b.title = r.paletteOn ? `Color palette on (${n} color${n === 1 ? "" : "s"}): Sent with the region in 'elements' and in `
            + "the MOSS-Image and Ideogram 4 JSON prompts; the first color shows the region. Click to turn it off."
            : "Color palette: Give this region up to 5 colors (MOSS-Image 'palette' / Ideogram 4 'color_palette'). Click to turn it on.";
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        b.addEventListener("click", (e) => {
            e.preventDefault();
            if (!r.paletteOn) E.openSub(r.id, "palette");    // show the new palette row right away
            E.change(() => { if (r.paletteOn) delete r.paletteOn; else r.paletteOn = true; });
        });
        return b;
    }
    // the palette row: swatches (click = change, right-click = remove) and + (add, up to 5)
    function paletteRow(r, inPopup) {
        const row = E.el("div", "rg-row pal" + (r.paletteOn ? "" : " off"));
        const tag = E.el("span", "rg-palico"); tag.innerHTML = svgIcon("palette");
        tag.title = r.paletteOn ? "Color palette of this region" : "Color palette (off, so not used; turn it on with the palette button)";
        row.appendChild(tag);
        const pal = normPalette(r.palette);
        pal.forEach((c, i) => {
            const sw = E.el("button", "rg-sw pal pick"); sw.type = "button"; sw.style.background = c;
            sw.dataset.pal = `${r.id}:${i}`;
            sw.title = `${c}: Click to change, right-click to remove` + (i === 0 ? " (the first color shows the region)." : ".");
            sw.addEventListener("pointerdown", (e) => e.stopPropagation());
            sw.addEventListener("click", (e) => {
                e.preventDefault();
                pickColor(sw, normPalette(r.palette)[i] || c, (v) => { r.palette = normPalette(r.palette); r.palette[i] = v.toUpperCase(); });
            });
            sw.addEventListener("contextmenu", (e) => {
                e.preventDefault(); e.stopPropagation();
                E.change(() => { r.palette = normPalette(r.palette); r.palette.splice(i, 1); if (!r.palette.length) delete r.palette; });
                E.focusSink();
            });
            row.appendChild(sw);
        });
        if (pal.length < PAL_MAX) {
            // "+" adds a white swatch in its place ("+" moves right, or hides at 5 colors), then opens the
            // color picker on that new swatch
            const add = E.el("button", "rg-paladd"); add.type = "button"; add.innerHTML = svgIcon("plus");
            add.title = `Add a color (${pal.length}/${PAL_MAX})`;
            add.addEventListener("pointerdown", (e) => e.stopPropagation());
            add.addEventListener("click", (e) => {
                e.preventDefault();
                const before = E.snapshot();
                const cur = normPalette(r.palette);
                if (cur.length >= PAL_MAX) return;
                cur.push("#FFFFFF");
                r.palette = cur; r.paletteOn = true;
                const i = cur.length - 1;
                E.save(); refreshUI();                         // the list and the pop-up show the new swatch
                const scope = inPopup ? E.editor?.box : E.regList;
                const sw = scope?.querySelector(`[data-pal="${r.id}:${i}"]`);
                if (!sw) { E.pushUndo(before); return; }
                pickColor(sw, "#FFFFFF", (v) => { r.palette = normPalette(r.palette); r.palette[i] = v.toUpperCase(); }, before);
            });
            row.appendChild(add);
        }
        if (!inPopup && !pal.length) {
            const h = E.el("span", "rg-hint"); h.textContent = "add up to 5 colors";
            row.appendChild(h);
        }
        return row;
    }
}
