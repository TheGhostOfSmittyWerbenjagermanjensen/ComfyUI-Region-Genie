// The backdrop image, layout import / export, and the node's lifecycle (load, save, resize, run results).
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { nodeOffCanvas, getSetting, SET, SEPARATION_DEFAULT, UNTIL_DEFAULT, editLoras, controlFiles, hintsListeners, regionColors } from "../rg_shared.js";
import { closeLlmSettings } from "../rg_llm.js";
import { lassoRefreshers, ALL, DEFAULT_W, DEFAULT_H, LAYOUT_FORMAT } from "./shared.js";
import { normLoraOpts, parseState } from "./state.js";
import { chain, linkOf, remapOutputs } from "./graph.js";
import { activePalette } from "./colors.js";

export function* lifecycle(E) {
    Object.assign(E, {
        onEditModeChanged, setWidget, applyLayout, exportLayout, importLayoutText,
    });
    yield;

    // ---------------- backdrop ----------------
    function loadBackdrop(url, key, ref) {
        if (key === E.backdropKey) return;
        E.backdropKey = key;
        const img = new Image();
        img.onload = () => { if (E.backdropKey === key) { E.backdrop = img; E.backdropRef = ref || null; E.requestDraw(); } };
        img.onerror = () => { if (E.backdropKey === key) { E.backdrop = null; E.requestDraw(); } };
        img.src = url;
    }
    function liveBackdrop() {
        const inp = E.node.inputs?.find((i) => i.name === "image");
        if (!inp || inp.link == null) {
            if (E.backdrop || E.backdropKey) { E.backdrop = null; E.backdropKey = ""; E.backdropRef = null; if (E.pick) E.pickSettle(); E.requestDraw(); }
            return;
        }
        const link = linkOf(E.node.graph, inp.link);
        const src = link && E.node.graph?.getNodeById(link.origin_id);
        const iw = src?.widgets?.find((w) => w.name === "image");
        if (src && /LoadImage/.test(src.type || src.comfyClass || "") && typeof iw?.value === "string" && iw.value) {
            const v = iw.value.replace(/ \[(input|output|temp)\]$/, "");
            const cut = v.lastIndexOf("/");
            const sub = cut >= 0 ? v.slice(0, cut) : "", fn = cut >= 0 ? v.slice(cut + 1) : v;
            loadBackdrop(api.apiURL(`/view?filename=${encodeURIComponent(fn)}&type=input&subfolder=${encodeURIComponent(sub)}`), "input:" + iw.value,
                { filename: fn, subfolder: sub, type: "input" });
        }
    }

    // ---------------- layout import / export ----------------
    const sizeLinked = () => (E.node.inputs || []).some((i) =>
        ["width_in", "height_in", "size_from", "size_from_image", "size_from_latent"].includes(i.name) && i.link != null);
    // Edit Mode on: add the edit LoRA set in Settings for the model of the last run (for every model with one
    // when no run has said which), to the 'Whole image' LoRAs; off: remove the rows it added
    function onEditModeChanged() {
        E.hideMsg();
        const arch = E.modelArch(), all = editLoras();
        const probe = JSON.stringify(E.state.sceneLoras || []);
        const before = E.snapshot();
        if (E.syncEditLoras() && JSON.stringify(E.state.sceneLoras || []) !== probe) { E.pushUndo(before); E.save(); }
        if (E.isEdit()) {
            if (!all.length) E.hint("Edit Mode: No edit LoRA is set in Settings > Region Genie > Edit Mode");
            else if (arch && !all.some(([m]) => m === arch)) E.hint(`Edit Mode: No edit LoRA is set for ${arch} in Settings > Region Genie > Edit Mode`);
        }
        E.syncSettings(); E.onDimsChanged(); E.refreshUI();
    }
    function setWidget(w, v) {
        if (!w || w.value === v) return;
        w.value = v;
        try { w.callback?.(v); } catch (e) { /* ignore */ }
    }
    function applyLayout(st, scene, sig, size, sceneNeg, madeFor, sceneBg) {
        E.hideBanner();
        // a layout converted from another format (boxes, MOSS-Image / Ideogram JSON) has no colors of its own:
        // its regions take the user's region colors, in order (Settings > Region Genie > Region Genie node)
        if (st?.recolor && Array.isArray(st.regions)) {
            const list = regionColors();
            st = { ...st, regions: st.regions.map((r, i) => (i < list.length && !r.fromImage ? { ...r, color: list[i] } : r)) };
            delete st.recolor;
        }
        E.change(() => {
            const own = E.state.loraOpts;                    // a layout that says nothing about separation keeps this node's
            E.state = parseState(JSON.stringify(st), ...(madeFor || E.dims()));     // madeFor: size of an older file
            if (!E.state.loraOpts && own) E.state.loraOpts = own;
            if (sig) E.state.importSig = sig; else delete E.state.importSig;
            E.selId = null; E.filter = ALL; E.clickPoly = null;
            E.curRegion = E.state.regions[0]?.id ?? null;
        });
        if (scene != null) setWidget(E.sceneW, String(scene));
        if (sceneNeg != null) setWidget(E.sceneNegW, String(sceneNeg));
        if (sceneBg != null) setWidget(E.sceneBgW, String(sceneBg));
        if (size && !sizeLinked()) E.setManualSize(Math.round(size[0]), Math.round(size[1]));
        E.userView = false; E.onDimsChanged(); E.fitView(); E.requestDraw();
    }
    function exportLayout() {
        const [W, H] = E.dims();
        const out = { format: LAYOUT_FORMAT, version: 2, width: W, height: H,
                      scene_prompt_positive: E.sceneW?.value ?? "", scene_prompt_negative: E.sceneNegW?.value ?? "",
                      scene_prompt_background: E.sceneBgW?.value ?? "",
                      regions: E.state.regions, layers: E.state.layers,
                      ...(E.state.sceneLoras?.length ? { sceneLoras: E.state.sceneLoras } : {}),
                      ...(E.state.loraOpts ? { loraOpts: E.state.loraOpts } : {}),
                      ...(E.state.editMask ? { editMask: E.state.editMask } : {}) };
        const blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        const base = String(E.node.title || "layout").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "layout";
        a.download = `${base}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    async function importLayoutText(text, fromFile) {
        let d = null;
        try { d = JSON.parse(text); if (typeof d === "string") d = JSON.parse(d); } catch (e) { throw new Error("not valid JSON"); }
        if (d && Array.isArray(d.layers) && Array.isArray(d.regions)) {
            const size = Number(d.width) > 0 && Number(d.height) > 0 ? [Math.round(d.width), Math.round(d.height)] : null;
            applyLayout(d, d.scene_prompt_positive ?? d.scene_prompt ?? null, null, fromFile ? size : null,
                        d.scene_prompt_negative ?? null, size, d.scene_prompt_background ?? null);
            return;
        }
        const [W, H] = E.dims();          // other formats: converted by the Python side (same code as import_json)
        const r = await api.fetchApi("/region_genie/convert_layout", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ json: text, width: W, height: H }),
        });
        let res = null; try { res = await r.json(); } catch (e) { /* ignore */ }
        if (!r.ok || !res?.state) throw new Error(res?.error || `server returned ${r.status} (restart ComfyUI after updating the pack)`);
        applyLayout(res.state, res.scene_prompt, null, null, res.scene_prompt_negative, null, res.scene_prompt_background);
    }

    // ---------------- lifecycle ----------------
    function load() {
        E.layoutHad = null;                                  // a saved layout / standard choice stays as it is
        const [W, H] = E.dims();
        const wasV1 = (() => { try { const d = JSON.parse(E.dataW?.value || ""); return d && !Array.isArray(d.layers) && Array.isArray(d.ops); } catch (e) { return false; } })();
        E.state = parseState(E.dataW?.value, W, H);
        // separation / until (round 52): a node always says them from here on. Data that doesn't: a node saved while
        // 0.85 / 0.25 were the defaults keeps those (the Python side reads missing values the same way); a node that
        // is new takes the Settings' values (0.85 / 0.1 unless changed; 0.4 / 0.1 from round 52 to 67)
        if (!E.state.loraOpts) {
            E.state.loraOpts = normLoraOpts(E.configured ? { separation: 0.85, until: 0.25 }
                : { separation: +getSetting(SET.cmSeparation, SEPARATION_DEFAULT), until: +getSetting(SET.cmUntil, UNTIL_DEFAULT) });
        }
        E.version++;                                       // new state: drop cached label boxes / indices
        if (wasV1) E.save();
        E.undoStack = []; E.redoStack = [];
        // another workflow's steps and typed text are gone with it (they are kept in memory only, never saved)
        E.sceneKnown = null; E.textBefore = null; E.textDirty = false; E.textHist?.clear();
        E.selId = null; E.filter = ALL; E.clickPoly = null;
        E.curRegion = E.state.regions[0]?.id ?? null;
        E.lastDims = [0, 0]; E.userView = false;
        E.syncSettings();
        E.onDimsChanged(); E.refreshUI();
    }
    // (the results of a run come by themselves: a redraw of the list they cause waits for a field being typed in)
    const onRun = (message) => {
        if (Array.isArray(message?.region_info)) E.setRunInfo(message.region_info[0]);
        if (message?.dims) { E.execDims = message.dims; E.execGuess = E.guessInputDims(); E.onDimsChanged(); }
        if (Array.isArray(message?.prompt_format)) { E.lastFormat = String(message.prompt_format[0] || "") || null; E.syncModelSel(); }
        if (Array.isArray(message?.model_arch) && message.model_arch[0]) {
            E.node.properties = E.node.properties || {};
            E.node.properties.rg_model_arch = String(message.model_arch[0]);
            E.node.properties.rg_model_src = E.guessArch().sig;
            E.onModelChanged(true);
        }
        if (Array.isArray(message?.auto_separate) && !!message.auto_separate[0] !== E.autoSeparate) {
            E.autoSeparate = !!message.auto_separate[0];
            E.renderRegions();
        }
        let imp = null;
        try { imp = JSON.parse(message?.layout_import?.[0] || "null"); } catch (e) { /* ignore */ }
        if (imp?.action === "applied") applyLayout(imp.state, imp.scene_prompt, imp.sig, null, imp.scene_prompt_negative, null, imp.scene_prompt_background);
        let llmMsg = null;
        try { llmMsg = JSON.parse(message?.llm?.[0] || "null"); } catch (e) { /* ignore */ }
        if (llmMsg) E.storeLlmResults(llmMsg);
        let missing = null;
        try { missing = JSON.parse(message?.control_missing?.[0] || "null"); } catch (e) { /* ignore */ }
        if (Array.isArray(missing) && missing.length) E.showControlMissing(missing);
        let cms = null;
        try { cms = JSON.parse(message?.control_maps?.[0] || "null"); } catch (e) { cms = null; }
        if (!Array.isArray(cms) && Array.isArray(message?.control_map)) cms = [message.control_map[0]];
        if (Array.isArray(cms)) {
            const key = cms.map((cm) => (cm ? cm.filename + cm.subfolder : "")).join("|");
            if (key !== E.controlMapsKey) {
                E.controlMapsKey = key;
                E.controlMaps = cms.map(() => null);
                cms.forEach((cm, k) => {
                    if (!cm?.filename) return;
                    const img = new Image();
                    img.onload = () => E.background(() => { E.controlMaps[k] = img; E.renderRegions(); E.requestDraw(); });
                    img.src = api.apiURL(`/view?filename=${encodeURIComponent(cm.filename)}&type=${cm.type}&subfolder=${encodeURIComponent(cm.subfolder || "")}&t=${Date.now()}`);
                });
            }
        }
        if (E.controls().length && Array.isArray(message?.model_arch) && message.model_arch[0]) {
            const before = JSON.stringify(E.state.sceneLoras || []);
            if (E.syncControlLoras() && JSON.stringify(E.state.sceneLoras || []) !== before) { E.save(); E.renderRegions(); }
        }
        if (Array.isArray(message?.wildcards)) {
            let f = {};
            try { f = JSON.parse(message.wildcards[0] || "{}") || {}; } catch (e) { /* ignore */ }
            E.wcSetFilled(f, false);
        }
        else if (imp?.action === "pending") {
            E.pendingImport = imp;
            E.bannerText.textContent = `import_json has a new layout (${imp.state?.regions?.length ?? 0} regions). This run used the canvas.`;
            E.banner.style.display = "";
        }
        const imgs = message?.backdrop;
        if (Array.isArray(imgs) && imgs[0]?.filename) {
            const b = imgs[0], t = Date.now();
            loadBackdrop(api.apiURL(`/view?filename=${encodeURIComponent(b.filename)}&type=${b.type}&subfolder=${encodeURIComponent(b.subfolder || "")}&t=${t}`), "run:" + b.filename + t,
            { filename: b.filename, subfolder: b.subfolder || "", type: b.type || "temp" });
        }
        let detected = [];
        try { detected = JSON.parse(message?.detected?.[0] || "[]"); } catch (e) { /* ignore */ }
        E.detectedSet = new Set(detected.map((c) => String(c).toUpperCase()));
        const known = new Set(E.state.regions.map((r) => r.color.toUpperCase()));
        const fresh = detected.map((c) => String(c).toUpperCase()).filter((c) => !known.has(c));
        if (fresh.length) {
            E.change(() => {
                for (const c of fresh) {
                    const id = E.state.regions.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
                    E.state.regions.push({ id, color: c, prompt: "", type: "object", text: "", fromImage: true });
                }
            });
        }
        E.onDimsChanged();
    };
    chain(E.node, "onExecuted", function (message) { E.background(() => onRun(message)); });
    chain(E.node, "onConfigure", function (saved) { E.applySockets(saved); E.configured = true;
        E.moveSizeLinks(); E.renumberLinks(); setTimeout(() => { E.sizeCfg(); E.syncSizeRow(true); E.onDimsChanged(); }, 0); E.fixImportMode(); E.migrateFormat(); if (E.node.properties?.rg_list_h) E.cvBox.style.minHeight = E.CV_MIN + "px"; E.applyListH(); load(); E.pushLlmCache(); E.syncLlm(); E.updateLlmButtons(); });
    for (const w of [E.wW, E.hW]) if (w) chain(w, "callback", () => E.onDimsChanged());
    if (E.modeW) chain(E.modeW, "callback", () => E.requestDraw());

    const ro = new ResizeObserver(() => E.requestDraw());
    ro.observe(E.cvBox);
    E.sizeReady = true; E.syncSizeRow();
    // The bottom bar sits half-way between the line above it (the list's lower edge) and the node's lower edge
    // (round 43). A legacy node leaves room under the editor (ComfyUI's margin around a widget, 10 px); the bar gets
    // the same room above it. In Nodes 2.0 the node's badge follows right under the bar, at the bar's own distance, and
    // in the large editor the bar is at the window's edge: nothing to do there. The room is measured, not assumed, and
    // taken over when two looks in a row agree (the editor's place lags a frame behind while the graph is zoomed).
    let footSeen = null;
    function centerFoot() {
        let want = 0;
        const legacy = !E.big && !!E.wrap.closest(".dom-widget");
        if (legacy) {
            const fr = E.foot.getBoundingClientRect(), ds = app.canvas?.ds, cr = app.canvas?.canvas?.getBoundingClientRect();
            const k = E.foot.offsetHeight ? fr.height / E.foot.offsetHeight : 0;
            if (!k || !ds || !cr) return;
            const below = (cr.top + (E.node.pos[1] + E.node.size[1] + ds.offset[1]) * ds.scale - fr.bottom) / k;
            const gap = parseFloat(getComputedStyle(E.wrap).rowGap) || 0;           // the room the bar has above it anyway
            want = Math.max(0, Math.min(16, Math.round(below - gap)));
        }
        if (want !== footSeen) { footSeen = want; return; }
        const now = parseFloat(E.foot.style.marginTop) || 0;
        if (now !== want) E.foot.style.marginTop = want ? want + "px" : "";
    }
    E.centerFoot = centerFoot;
    const poll = setInterval(() => E.background(() => {
        if (E.editor && nodeOffCanvas(E.node)) E.closeEditor(true);     // another workflow tab, a subgraph, removed
        if (!E.node.graph) return;
        E.flushRegions();                                              // a redraw held back whose field is gone
        E.poseStripSync?.();                                           // the import button follows the pose_keypoint input's link
        centerFoot();
        for (const t of Object.values(E.sceneTA || {})) t?.__rgPlaceExpand?.();      // a scene prompt set by something else: its scroll bar may have come or gone
        if (E.pruneManagedLoras()) { E.save(); E.renderRegions(); }
        // an edit LoRA or a control file changed in Settings: the rows (and the LoRAs they add) follow (round 23)
        const sig = JSON.stringify([editLoras(), controlFiles()]);
        if (sig !== E.filesSig) {
            const first = !E.filesSig; E.filesSig = sig;
            if (!first) { const a = E.syncEditLoras(), b = E.syncControlLoras(); if (a || b) E.save(); if (E.isEdit() || E.controls().length) E.renderRegions(); }
        }
        E.fixImportMode();
        E.syncSettings();
        E.applyFieldFonts();
        E.onModelChanged(false);
        E.labelSizeInputs();
        E.onDimsChanged();
        liveBackdrop();
        E.syncLlm();
        E.updateLlmButtons();
    }), 500);
    chain(E.node, "onRemoved", function () {
        clearInterval(poll); E.closeEditor(true); ro.disconnect(); E.offLlmLib(); closeLlmSettings(); lassoRefreshers.delete(E.refreshVariantButtons); hintsListeners.delete(E.syncTips); for (const ev of ["pointerup", "pointercancel"]) window.removeEventListener(ev, E.tipsRelease, true); E.closeArrange(); if (E.pick) E.pickCancel();
        for (const t of E.PAN_EVENTS) window.removeEventListener(t, E.midPan, true);
        window.removeEventListener("pointerdown", E.hideSelOutside, true);
        window.removeEventListener("mousedown", E.noAutoScroll, true);
    });

    // test hooks
    E.node.__rgRender = (w, h) => {
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const x = c.getContext("2d"), s2 = document.createElement("canvas"); s2.width = w; s2.height = h;
        const saved = E.view; const [W] = E.dims();
        E.view = { z: w / W, x: 0, y: 0 };
        x.fillStyle = "#000"; x.fillRect(0, 0, w, h);
        const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h;
        E.renderComposite(tmp.getContext("2d"), w, h, s2, s2.getContext("2d"));
        x.drawImage(tmp, 0, 0);
        E.view = saved;
        return c.toDataURL();
    };
    E.node.__rgState = () => E.state;
    E.node.__rgSyncSize = () => E.syncSizeRow();           // tests: the size row's refresh, as the half-second check does it
    E.node.__rgRefresh = () => { E.version++; E.save(); E.refreshUI(); };
    // tests: a redraw of the list as the editor's own checks cause one; how many redraws were done / held back
    E.node.__rgBackgroundRedraw = () => E.background(() => E.renderRegions());
    E.node.__rgRedraws = () => ({ ...E.redraws, pending: E.renderPending });
    E.node.__rgActive = () => E.curRegion;
    E.node.__rgSetTool = (t) => E.setTool(t);
    E.node.__rgTool = () => E.tool;
    E.node.__rgDims = () => E.dims();                 // the canvas size (the size row shows the same)
    E.node.__rgSelectLayer = (id) => E.selectLayer(E.state.layers.find((l) => l.id === id) || null);    // tests
    E.node.__rgToolTips = () => Object.values(E.GROUPS).flatMap((g) => g.entries().map((e) => e[2]));   // tests: every tool version's tooltip
    E.node.__rgSetBackdrop = (img, ref) => { E.backdrop = img; E.backdropKey = "test:" + Math.random(); E.backdropRef = ref || null; E.requestDraw(); };
    // regions in output order (what Mask Picker / Regional LoRAs index into)
    E.node.__rgOutputRegions = () => {
        const map = E.outputIndexMap(), out = [];
        E.state.regions.forEach((r, k) => { if (map[k] != null) out[map[k]] = { color: E.colorOf(r.id), prompt: r.prompt, type: r.type, text: r.text, palette: activePalette(r) }; });
        return out;
    };
    E.node.__rgLabels = () => E.labelRects.map((r) => ({ ...r, active: r.rid === E.curRegion }));
    E.node.__rgRegionToClient = (px, py) => { const b = E.cv.getBoundingClientRect(); return [b.left + px * b.width / E.cv.width, b.top + py * b.height / E.cv.height]; };
    const toClient = (sx, sy) => { const r = E.cv.getBoundingClientRect(); return [r.left + sx * r.width / E.cv.width, r.top + sy * r.height / E.cv.height]; };
    E.node.__rgToClient = (ix, iy) => toClient(...E.toScr(ix, iy));
    E.node.__rgHandles = () => { const L = E.selLayer(); return L ? E.handles(L).map((h) => ({ kind: h.kind, at: toClient(h.x, h.y) })) : []; };
    E.node.__rgBox = () => { const L = E.selLayer(); return L ? E.boxCornersImg(L) : null; };
    E.node.__rgLayerMask = (id) => { const L = E.state.layers.find((l) => l.id === id) || E.selLayer(); if (!L) return null; const { w, h, r, m } = E.layerMask(L); return { w, h, r, m }; };
    E.node.__rgHint = (t) => E.hint(t);
    E.node.__rgView = () => ({ ...E.view, cw: E.cv.width, ch: E.cv.height });

    E.setTool("select");
    load();
    // wide enough for the whole toolbar in one row (Select ... labels eye) and a usable region list;
    // a new node gets a square canvas (legacy mode: measured once laid out, since fonts differ per system).
    // Round 38 tried a fixed 700 x 1040 instead; the owner found the canvas too small and wants it square (round 39).
    if (!E.node.size || E.node.size[0] < DEFAULT_W) {
        E.node.setSize?.([DEFAULT_W, Math.max(E.node.size?.[1] || 0, DEFAULT_H)]);
        let tries = 0, mine = null;
        const t0 = performance.now();
        const square = () => {
            if (E.configured || !E.node.graph && tries > 2) return;
            if (mine != null && Math.abs(E.node.size[1] - mine) > 1) return;     // the user (or something else) resized it meanwhile
            const b = E.cvBox.getBoundingClientRect();
            if (E.cvBox.closest("[data-node-id]")) return;                       // Nodes 2.0 lays out by itself
            if (!b.width || !b.height) { if (++tries < 30) requestAnimationFrame(square); return; }
            const k = app.canvas?.ds?.scale || 1;
            const d = (b.width - b.height) / k;
            if (Math.abs(d) > 1 && tries < 30) {
                mine = Math.round(E.node.size[1] + d);
                E.node.setSize([E.node.size[0], mine]); E.node.setDirtyCanvas?.(true, true);
                tries++; requestAnimationFrame(() => requestAnimationFrame(square));
            // square now; the fields above the editor settle a little later (the background field hides, the prompt
            // fields take their height), so look again a few times during the first seconds
            } else if (performance.now() - t0 < 2500) setTimeout(square, 250);
        };
        setTimeout(square, 0);
        // Settings > Region Genie: defaults for a node that was just added (not loaded or pasted)
        setTimeout(() => {
            if (E.configured) return;
            E.node.properties = E.node.properties || {};
            E.node.properties.rg_size = E.sizeDefaults();
            E.applySize();
            setWidget(E.modeW, getSetting(SET.cmImageMode, "backdrop (trace over)"));
            const f = Math.max(0, Math.round(+getSetting(SET.cmFeather, 0)) || 0);
            const sp = +getSetting(SET.cmSeparation, SEPARATION_DEFAULT), un = +getSetting(SET.cmUntil, UNTIL_DEFAULT);
            if (f) E.state.feather = f;
            const allSeparate = !!getSetting(SET.cmAllRegions, false), shareBg = !!getSetting(SET.cmShareBg, false);
            // always written (round 52): a node without it is one saved while 0.85 / 0.25 were the defaults, and keeps
            // those (normLoraOpts in state.js, and the Python side)
            E.state.loraOpts = normLoraOpts({ separation: sp, until: un, allRegions: allSeparate, shareBg });
            E.save(); E.syncSettings(); E.onDimsChanged(); E.refreshUI();
        }, 0);
    }
}
