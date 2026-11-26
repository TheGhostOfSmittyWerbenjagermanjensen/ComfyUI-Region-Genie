// The region list: one tree of regions with their LoRAs, layers and palettes.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { svgIcon, setHTML, knownLoras, pickLora, contextMenu, fillTriggerChips } from "../rg_shared.js";
import { openColorPicker } from "../rg_colorpicker.js";
import { UNSPEC } from "./shared.js";
import { PAL_MAX, normPalette, activePalette } from "./colors.js";

export function* list(E) {
    Object.assign(E, {
        activateRegion, refreshUI, ico, chevron, grip, subHeader, toggleKind, updateExpandButtons, loraRows, addLoraTo, layerRows,
        ownLoras, loraCount, loraButton, loraChips, toggleAllLoras, syncLoraAll, paletteTab,
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
        E.syncSockets?.();                             // control_image comes and goes with the Control rows
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
        ...(listedOf(r.id).length || E.posesOf(r.id).length ? ["layers"] : []),
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
            : "Click: Select this layer.\nDrag: Move it above or below another layer of this region, or onto another region's row in the list.";
        g.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            // round 88: a layer's row is in its region's pop-up (the Layers tab); there it moves among that region's layers
            const list = (kind === "layer" && g.closest(".rg-pop-layers")) || E.regList;
            onPick?.();                                          // pressing the grip picks its row, as its prompt / name field does
            const line = E.el("div", "rg-dropline");
            let target = null;                                   // region: { to } | layer: { lid, after } or { rid }
            const self = () => list.querySelector(kind === "region" ? `.rg-row.region[data-rid="${id}"]` : `.rg-row.layer[data-lid="${id}"]`);
            self()?.classList.add("dragging");
            E.wrap.classList.add("rg-sorting");
            const clear = () => { line.remove(); list.querySelector(".rg-row.dropon")?.classList.remove("dropon"); E.regList.querySelector(".rg-row.dropon")?.classList.remove("dropon"); };
            let last = null;
            const move = (ev) => {
                last = ev;
                const box = list.getBoundingClientRect(), y = ev.clientY;
                clear(); target = null;
                // from a pop-up's Layers tab onto another region's row in the list (where the pop-up doesn't cover it):
                // the layer moves into that region, as it did when the layers were rows of the list
                if (list !== E.regList) {
                    const pb = list.closest(".rg-pop").getBoundingClientRect(), inPop = ev.clientX >= pb.left && ev.clientX <= pb.right && y >= pb.top && y <= pb.bottom;
                    const over = inPop ? null : [...E.regList.querySelectorAll(".rg-row.region")].find((el) => { const r = el.getBoundingClientRect(); return y >= r.top && y <= r.bottom && ev.clientX >= r.left && ev.clientX <= r.right; });
                    if (over) { target = { rid: Number(over.dataset.rid) }; over.classList.add("dropon"); return; }
                    if (!inPop) return;
                }
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
                const rows = [...list.querySelectorAll(".rg-row.layer, .rg-row.region")];
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
                const box = list.getBoundingClientRect(), y = last.clientY, was = list.scrollTop;
                if (y < box.top + 16 && y > box.top - 30) list.scrollTop -= 8; else if (y > box.bottom - 16 && y < box.bottom + 30) list.scrollTop += 8;
                if (list.scrollTop !== was) move(last);
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
        const n = kind === "layers" ? listedOf(r.id).length + E.posesOf(r.id).length : kind === "loras" ? (r.loras || []).length : normPalette(r.palette).length;
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
            // rounds 87 / 88: what a row holds is on the tabs of its pop-up; nothing opens under a row any more
            if (b.style.display !== "none") b.style.display = "none";
            continue;
            const any = kindTargets(k).length > 0;
            const arrow = any && kindOpen(k) ? "▲" : "▼";
            const html = names[k] ? `${arrow} ${names[k]}` : `<span>${arrow}</span>${svgIcon(k)}`;
            if (b.__html !== html) { b.__html = html; b.innerHTML = html; b.classList.toggle("mixed", !names[k]); }
            b.disabled = !any;
        }
    }
    // ---- LoRAs at a glance (round 87): the list shows that a row has LoRAs, and how many are on; the LoRAs
    // themselves are in the row's pop-up (its LoRAs tab). The Edit and Control LoRAs have their own rows and don't count.
    function ownLoras(list) { return (list || []).filter((x) => !x.edit && !x.control); }
    function loraCount(list) { const own = ownLoras(list); return { all: own.length, on: own.filter((x) => x.on !== false && x.lora).length }; }
    const loraShort = (name) => String(name || "").split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, "");
    // the one LoRAs button of a row: grey "＋LoRA" with none listed, amber "LoRAs 2" with some on ("2/3" when some are
    // off), an amber outline "LoRAs (0/3)" when all listed ones are off. A click always opens the pop-up's LoRAs tab.
    function loraButton(list, what, open) {
        const { all, on } = loraCount(list);
        const b = E.btn(all ? `LoRAs (${on === all ? on : `${on}/${all}`})` : "＋LoRA", "", open);        // (the number in brackets: round 89)
        b.classList.add("txt", "rg-lbtn", all ? (on ? "some" : "alloff") : "none");
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        b.title = all ? `LoRAs of ${what}: ${on} of ${all} on. Click to show and change them.`
            : `No LoRAs on ${what} yet. Click to add one.`;
        return b;
    }
    // the LoRAs that are on, as chips with their strength (the Whole image row has the room): as many as fit, then "+N"
    function loraChips(list, open) {
        const box = E.el("span", "rg-lchips");
        const on = ownLoras(list).filter((x) => x.on !== false && x.lora);
        const chips = on.map((x) => {
            const c = E.el("button", "rg-lchip"); c.type = "button";
            const n = E.el("span"); n.textContent = loraShort(x.lora);
            const s = E.el("b"); s.textContent = String(x.strength);
            c.append(n, s); c.title = `${x.lora}\nStrength ${x.strength}. Click to show and change the LoRAs.`;
            return c;
        });
        const more = E.el("button", "rg-lchip more"); more.type = "button";
        for (const c of [...chips, more]) {
            c.addEventListener("pointerdown", (e) => e.stopPropagation());
            c.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); open(); });
        }
        box.append(...chips, more);
        const fit = () => {
            if (!box.isConnected || !box.clientWidth) return;
            for (const c of chips) c.style.display = "";
            more.style.display = "none";
            let hidden = 0;
            while (box.scrollWidth > box.clientWidth + 1 && hidden < chips.length) {
                hidden++;
                chips[chips.length - hidden].style.display = "none";
                more.style.display = ""; more.textContent = `+${hidden}`;
                more.title = `${hidden} more LoRA${hidden === 1 ? "" : "s"} on. Click to show and change the LoRAs.`;
            }
        };
        box.__rgFit = fit;
        try { new ResizeObserver(fit).observe(box); } catch (e) { /* old browser */ }
        return box;
    }
    // every LoRA list of the node: the whole image's, then each region's
    const loraLists = () => [E.state.sceneLoras || [], ...E.state.regions.map((r) => r.loras || [])];
    // the header's switch: all LoRAs off; the next click puts back the ones it switched off (kept as lo.wasOn, saved
    // with the node, so it also works after a reload)
    function toggleAllLoras() {
        const own = loraLists().flatMap(ownLoras);
        const on = own.filter((x) => x.on !== false);
        if (on.length) E.change(() => { for (const x of own) delete x.wasOn; for (const x of on) { x.on = false; x.wasOn = true; } });
        else if (own.some((x) => x.wasOn)) E.change(() => { for (const x of own) if (x.wasOn) { x.on = true; delete x.wasOn; } });
    }
    function syncLoraAll() {
        const b = E.loraAllBtn;
        if (!b) return;
        const own = loraLists().flatMap(ownLoras);
        const on = own.filter((x) => x.on !== false && x.lora).length, back = own.filter((x) => x.wasOn).length;
        // round 89: the word, as on the rows' buttons (it was a power icon and the number): "LoRAs (7)", or "LoRAs off"
        const text = on ? `LoRAs (${on})` : "LoRAs off";
        if (b.textContent !== text) b.textContent = text;
        b.classList.toggle("some", on > 0);
        b.classList.toggle("back", !on && back > 0);
        b.style.display = own.length ? "" : "none";
        b.title = on ? `${on} LoRA${on === 1 ? " is" : "s are"} on in this node (whole image and regions).\nClick: Switch them all off. The next click switches the same ones back on.`
            : back ? `All LoRAs are off.\nClick: Switch the ${back} back on that this button switched off.`
            : "All LoRAs are off. Switch them on in a row's LoRAs.";
    }
    // one LoRA of a region (or of the whole image), with its trigger words as chips
    // owner.pop: in a pop-up's LoRAs tab: a grip to drag the row up or down, and the on / off box as a switch
    function loraRows(list, owner) {
        // owner: { prompt(): string, append(word) } (region prompt, or scene_prompt_positive for whole-image LoRAs)
        const frag = document.createDocumentFragment();
        list.forEach((lo, i) => {
            if (owner?.sceneOnly && (lo.edit || lo.control)) return;          // on the Edit / Control rows instead
            const row = E.el("div", "rg-row lora");
            row.dataset.li = String(i);
            const tag = owner?.pop ? loraGrip(list, i) : E.el("span", "rg-hint");
            if (!owner?.pop) tag.textContent = lo.control ? "Control" : lo.edit ? "Edit" : "LoRA";
            if (lo.edit) {
                tag.title = `Edit LoRA for ${lo.edit}, added by Edit Mode: Used only in Edit Mode with a ${lo.edit} model, `
                    + "and removed when the node is switched back to generate (Settings > Region Genie > Edit Mode).";
                row.classList.add("edit");
            }
            const on = E.el("input"); on.type = "checkbox"; on.checked = lo.on !== false; on.title = "On / off";
            if (owner?.pop) { on.classList.add("rg-switch"); row.classList.toggle("off", lo.on === false); }
            on.addEventListener("change", () => E.change(() => { lo.on = on.checked; delete lo.wasOn; }));
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
    // the grip of a LoRA row in a pop-up: drag it up or down in its list. A line shows where it lands; one undo step.
    function loraGrip(list, i) {
        const g = E.el("span", "rg-grip"); g.innerHTML = svgIcon("grip");
        g.title = "Drag to move this LoRA up or down in the list.";
        g.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const box = g.closest(".rg-pop-lorarows");
            if (!box) return;
            const rows = [...box.querySelectorAll(":scope > .rg-row.lora")];
            const me = rows.find((r) => Number(r.dataset.li) === i);
            const line = E.el("div", "rg-lora-drop");
            box.appendChild(line);
            let to = null;                                  // the list index it would land before (list.length: at the end)
            g.setPointerCapture?.(e.pointerId);
            me?.classList.add("dragging");
            const move = (ev) => {
                const br = box.getBoundingClientRect();
                let y = br.bottom - 1; to = list.length;
                for (const r of rows) {
                    const rr = r.getBoundingClientRect(), chips = r.nextElementSibling?.classList.contains("rg-trig") ? r.nextElementSibling.getBoundingClientRect() : rr;
                    if (ev.clientY < (rr.top + Math.max(rr.bottom, chips.bottom)) / 2) { y = rr.top - 1; to = Number(r.dataset.li); break; }
                }
                line.style.top = Math.round(y - br.top + box.scrollTop) + "px";
            };
            const up = () => {
                g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up);
                line.remove(); me?.classList.remove("dragging");
                if (to == null || to === i || to === i + 1) return;
                E.change(() => { const [x] = list.splice(i, 1); list.splice(to > i ? to - 1 : to, 0, x); });
            };
            g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
        });
        return g;
    }
    function addLoraTo(list, ev, onAdded) {
        pickLora(ev, (name) => { onAdded?.(); E.change(() => { list.push({ lora: name, strength: 1, on: true }); }); E.focusSink(); })
            .then((ok) => { if (!ok) E.hint("No LoRAs found in models/loras"); });
    }
    function layerRows(rid) {
        const frag = document.createDocumentFragment();
        frag.appendChild(E.poseRows(rid, ico));           // the region's pose figures (pose.js), above its layers
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
            E.change(() => { if (r.paletteOn) delete r.paletteOn; else r.paletteOn = true; });
        });
        return b;
    }
    // The Palette tab of a region's pop-up (round 88): a switch that says whether the palette is on, the colors as
    // large swatches (a click selects one; the selected one is changed in the color picker right under them, which is
    // a part of the tab, not a window of its own), + to add one, and a button that removes the selected one.
    // st: kept by the pop-up between refreshes: { sel, picker, key, before, timer }.
    function paletteTab(box, r, st) {
        const pal = normPalette(r.palette), on = !!r.paletteOn;
        st.sel = Math.max(0, Math.min(pal.length - 1, st.sel ?? 0));
        // a change in the picker: shown live; once the color has rested for half a second it is one undo step
        const commit = () => {
            clearTimeout(st.timer); st.timer = 0;
            if (st.before == null) return;
            E.pushUndo(st.before); st.before = null;
            E.save(); E.renderRegions();
        };
        st.flush = commit;
        const head = E.el("label", "rg-pop-palhead" + (on ? " on" : ""));
        const sw = E.el("input", "rg-switch"); sw.type = "checkbox"; sw.checked = on;
        sw.title = on ? "The color palette is on: Its colors are sent with the region. Click to turn it off (the colors are kept)."
            : "The color palette is off: Nothing is sent. Click to turn it on.";
        sw.addEventListener("change", () => { commit(); E.change(() => { if (sw.checked) r.paletteOn = true; else delete r.paletteOn; }); });
        const name = E.el("span", "rg-pop-palname"); name.textContent = "Color palette";
        const state = E.el("span", "rg-pop-palstate"); state.textContent = on ? "On" : "Off";
        const note = E.el("span", "rg-hint");
        note.textContent = on ? "these colors are sent with the region (MOSS-Image and Ideogram 4 read them)" : "nothing is sent; the switch turns it on";
        head.append(sw, name, state, note);
        const row = E.el("div", "rg-pop-palrow" + (on ? "" : " off"));
        pal.forEach((c, i) => {
            const b = E.el("button", "rg-sw pal big" + (i === st.sel ? " sel" : "")); b.type = "button"; b.style.background = c;
            b.dataset.pal = `${r.id}:${i}`;
            b.title = `${c}: Click to select it and change it below; right-click to remove it` + (i === 0 ? " (the first color shows the region)." : ".");
            b.addEventListener("click", (e) => { e.preventDefault(); if (st.sel !== i) { commit(); st.sel = i; paletteTab(box, r, st); } });
            b.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); removeAt(i); });
            row.appendChild(b);
        });
        const removeAt = (i) => {
            commit();
            E.change(() => { r.palette = normPalette(r.palette); r.palette.splice(i, 1); if (!r.palette.length) { delete r.palette; delete r.paletteOn; } });
        };
        if (pal.length < PAL_MAX) {
            const add = ico("@plus", `Add a color (${pal.length} of ${PAL_MAX})`, () => {
                commit();
                st.sel = pal.length;
                E.change(() => { const cur = normPalette(r.palette); cur.push("#FFFFFF"); r.palette = cur; r.paletteOn = true; });
            });
            add.classList.add("rg-pop-paladd");
            row.appendChild(add);
        }
        // the picker stays as it is while the same color of the same region is selected (a redraw mustn't end a drag)
        const key = pal.length ? `${r.id}:${st.sel}` : "";
        if (st.key !== key) { st.picker?.close(); st.picker = null; st.key = key; st.host = null; }
        if (!st.host) st.host = E.el("div", "rg-pop-palpick");
        if (key && !st.picker) {
            const i = st.sel;
            st.picker = openColorPicker(null, pal[i], { inline: st.host, onInput: (hex) => {
                if (st.before == null) st.before = E.snapshot();
                r.palette = normPalette(r.palette); r.palette[i] = hex.toUpperCase();
                E.version++; liveColors();
                const b = box.querySelector(`[data-pal="${r.id}:${i}"]`); if (b) b.style.background = hex;
                clearTimeout(st.timer); st.timer = setTimeout(commit, 500);
            } });
        } else if (key && st.before == null) st.picker.set(pal[st.sel]);          // changed elsewhere (Undo)
        const empty = E.el("span", "rg-hint");
        empty.textContent = pal.length ? "" : "No colors yet: ＋ adds one (up to 5). The first color shows the region.";
        // the picker fills the tab's width; the button that removes the selected color is at the right end of the
        // swatches' row, so it stands just above the picker's top right corner
        if (pal.length) {
            const del = ico("@clear", "Remove the selected color (also: right-click a color). Removing the last one turns the palette off.", () => removeAt(st.sel));
            del.classList.add("rg-pop-paldel");
            const gap = E.el("span"); gap.style.flex = "1 1 auto";
            row.append(gap, del);
        }
        box.replaceChildren(head, row, ...(pal.length ? [st.host] : [empty]));
    }
    // the palette row: swatches (click = change, right-click = remove) and + (add, up to 5)
    function paletteRow(r, inPopup) {
        const row = E.el("div", "rg-row pal" + (r.paletteOn ? "" : " off"));
        // in the list: a plain mark (the on / off button is on the options line above). In the pop-up editor the
        // row starts with the on / off button itself: one palette button there, not two (round 43)
        if (inPopup) row.appendChild(paletteToggle(r));
        else {
            const tag = E.el("span", "rg-palico"); tag.innerHTML = svgIcon("palette");
            tag.title = r.paletteOn ? "Color palette of this region" : "Color palette (off, so not used; turn it on with the palette button)";
            row.appendChild(tag);
        }
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
                // the last color removed: the palette is off again (its button no longer shows it as on)
                E.change(() => { r.palette = normPalette(r.palette); r.palette.splice(i, 1); if (!r.palette.length) { delete r.palette; delete r.paletteOn; } });
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
