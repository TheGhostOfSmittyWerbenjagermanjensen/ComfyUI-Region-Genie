// The footer: Export / Import, image mode, Generate / Edit, wildcards and the seed control; keeping the footer in step with the settings.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { svgIcon, autocompleteToggle, getSetting, setSetting, SET, editMaskDefaults, wildcardSeedControl, OLD_MOSS, MOSS } from "../rg_shared.js";
import { sparkleSvg, openLlmSettings, closeLlmSettings } from "../rg_llm.js";

export function* footer(E) {
    Object.assign(E, {
        syncBackground, migrateFormat, wcMarkScene, wcSetFilled, editMaskNow,
    });
    yield;

    // ---- layout files (bottom right of the node)
    const exportBtn = E.btn("Export", "Save this layout (regions, LoRAs, layers, scene prompt, size) as a .json file. "
        + "Load it again with Import, or through the import_json input.", E.exportLayout); E.exportBtn = exportBtn;
    const importBtn = E.btn("Import", "Load a layout file: One saved with Export, or MOSS-Image layout JSON, "
        + "Ideogram caption JSON / elements, or bboxes (boxes become rectangles). Undoable.", () => fileIn.click()); E.importBtn = importBtn;
    const fileIn = E.el("input"); E.fileIn = fileIn; fileIn.type = "file"; fileIn.accept = ".json,.txt,application/json,text/plain"; fileIn.style.display = "none";
    fileIn.addEventListener("change", async () => {
        const f = fileIn.files?.[0]; fileIn.value = "";
        if (f) { try { await E.importLayoutText(await f.text(), true); } catch (e) { E.notify(`Import failed: ${e.message || e}`, true); } }
    });
    // footer (bottom left): mode, edit_area (Edit Mode), model, LLM Settings, tag autocomplete, wildcard seed
    const settings = E.el("div", "rg-settings"); E.settings = settings;
    const setSel = (w, label, opts, title) => {
        const lab = E.el("label"); lab.title = title;
        if (label) { const t = E.el("span", "rg-hint"); t.textContent = label; lab.appendChild(t); }
        const sel = E.el("select", "rg-sel");
        for (const [v, txt] of opts) sel.appendChild(E.opt(v, txt));
        sel.title = title;
        sel.addEventListener("change", () => { E.setWidget(w, sel.value); E.requestDraw(); });
        lab.appendChild(sel);
        return { lab, sel, sync: () => { if (w && document.activeElement !== sel && sel.value !== w.value) sel.value = w.value; } };
    };
    // a row of buttons that act as one choice (segmented control)
    const segmented = (items, onPick) => {
        const box = E.el("span", "rg-seg"), btns = {};
        for (const [v, html, title] of items) {
            const b = E.el("button", "rg-btn" + (html.startsWith("<svg") ? " icon" : ""));
            b.type = "button"; b.innerHTML = html; b.title = title;
            b.addEventListener("pointerdown", (e) => e.stopPropagation());
            b.addEventListener("click", (e) => { e.preventDefault(); onPick(v); E.focusSink(); });
            btns[v] = b; box.appendChild(b);
        }
        return { box, set: (v) => { for (const [k, b] of Object.entries(btns)) { b.classList.toggle("on", k === v); b.setAttribute("aria-pressed", String(k === v)); } } };
    }; E.segmented = segmented;
    // ---- image_mode (top bar, only while an image is connected and not in Edit Mode)
    const imgLinked = () => (E.node.inputs || []).some((i) => i.name === "image" && i.link != null);
    const imgSeg = segmented([
        ["backdrop (trace over)", svgIcon("imgBackdrop"), "Image as a backdrop: The connected image is shown under the canvas to trace over (image_mode).\n"
            + "Default for new nodes: Settings > Region Genie > Region Genie node > image_mode."],
        ["use as color map", svgIcon("imgColorMap"), "Image as a color map: The connected image's colors become the regions; painting "
            + "goes on top.\nThe field next to it sets the min region pixels (image_mode)."],
    ], (v) => { E.setWidget(E.modeW, v); syncSettings(); E.requestDraw(); });
    const minIn = E.el("input", "rg-num"); minIn.type = "number"; minIn.min = "1"; minIn.max = "1000000"; minIn.step = "1";
    minIn.title = "Min region pixels (color map). A color becomes a region when it has at least this many flat pixels; "
        + "blended edges go to the nearest region, specks of other colors become unspecified. It is one setting for every node "
        + "(Settings > Region Genie > Region Genie node).";
    minIn.addEventListener("keydown", (e) => e.stopPropagation());
    minIn.addEventListener("change", () => {
        const v = Math.max(1, Math.min(1000000, Math.round(+minIn.value || 64)));
        minIn.value = String(v); setSetting(SET.cmMinPixels, v); E.setWidget(E.minW, v);
    });
    const imgBox = E.el("span", "rg-bar"); imgBox.style.display = "none";
    imgBox.append(imgSeg.box, minIn);
    E.bar1.insertBefore(imgBox, E.barGap);
    const minPixelsNow = () => Math.max(1, Math.round(+getSetting(SET.cmMinPixels, 64)) || 64); E.minPixelsNow = minPixelsNow;
    const importModeNow = () => getSetting(SET.cmImportMode, "ask before replacing") === "always replace" ? "always replace" : "ask before replacing"; E.importModeNow = importModeNow;
    // ---- mode: generate / edit
    const editSeg = segmented([
        ["generate", "Generate", "Generate a new image (mode)."],
        ["edit", "Edit", "Edit: Change the image on 'image' (image-to-image). What may change and the mask's edge: The 'Edit area' line under Whole image.\n"
            + "Connect: 'vae' too, and use the 'latent' output (sampler denoise below 1 for models without a reference image).\n"
            + "Size: The image's shape at the pixel count of width x height; the image is the backdrop.\n"
            + "Reference image: Sent to models that read one (Settings > Region Genie > Edit Mode).\n"
            + "Edit LoRA: The one set there for the model (the Edit row under Whole image; ＋Edit adds more)."],
    ], (v) => { if (E.editW?.value === v) return; E.setWidget(E.editW, v); E.onEditModeChanged(); syncSettings(); });
    const areaCtl = setSel(E.areaW, "", [["only the regions", "regions only"], ["whole image", "whole image"]],
        "edit_area (Edit Mode): What the sampler may change.\nRegions only: The 'latent' output carries a mask of "
        + "the regions set to change; the rest is kept (like inpainting).\nWhole image: Everything except the regions "
        + "set to keep (no mask when none is kept); the regions still steer where each prompt goes.");
    // the model dropdown (and MOSS-Image's layout / standard switch) go here; they also set the prompt format
    // (the old 'format' select is gone: the hidden prompt_format widget stays "auto", see migrateFormat)
    const modelBox = E.el("span", "rg-modelbox"); E.modelBox = modelBox;
    E.lastFormat = null;                 // the format the last run used (in the model dropdown's tooltip)
    // scene_prompt_background is Ideogram 4's alone (its caption JSON requires one): shown only while the model is
    // Ideogram 4 (picked or found); its text is kept while hidden
    const bgSize = E.sceneBgW ? Object.getOwnPropertyDescriptor(E.sceneBgW, "computeSize") : null;
    function syncBackground() {
        if (!E.sceneBgW) return;
        const show = E.modelArch() === "Ideogram 4";
        if (E.sceneBgW.__rgShown === show) return;
        E.sceneBgW.__rgShown = show;
        E.sceneBgW.hidden = !show;
        if (show) { if (bgSize) Object.defineProperty(E.sceneBgW, "computeSize", bgSize); else delete E.sceneBgW.computeSize; }
        else E.sceneBgW.computeSize = () => [0, -4];
        const elB = E.sceneBgW.element || E.sceneBgW.inputEl;
        if (elB) elB.style.display = show ? "" : "none";
        if (!show && E.editor?.which === "background") E.closeEditor(true);
        E.node.setDirtyCanvas?.(true, true);
    }
    // a workflow saved with the old format select: its choice becomes a model pick (or MOSS's standard mode)
    function migrateFormat() {
        // saved before the model was stored as MOSS-Image (its official name)
        if (E.node.properties?.rg_model_pick === OLD_MOSS) E.node.properties.rg_model_pick = MOSS;
        const v = E.fmtW?.value;
        if (!E.fmtW || !v || v === "auto") return;
        E.node.properties = E.node.properties || {};
        if (!E.node.properties.rg_model_pick) {
            if (v === "MOSS JSON") E.node.properties.rg_model_pick = "MOSS-Image";
            else if (v === "Ideogram JSON") E.node.properties.rg_model_pick = "Ideogram 4";
        }
        if (v === "text") E.node.properties.rg_moss_layout = false;
        E.fmtW.value = "auto";
    }
    const acCtl = autocompleteToggle(E.node, E.el);
    const llmSetBtn = E.iconBtn("shape", "LLM Prompt Enhancer settings: What the LLM sees, the preset for each prompt type, and the "
        + "presets themselves (LLM, LLM-only LoRAs, system prompt, Generate Text settings)", () => {
        if (document.querySelector(".rg-llm-pop")) { closeLlmSettings(); return; }
        openLlmSettings(llmSetBtn, E.llmHost);
    }); E.llmSetBtn = llmSetBtn;
    llmSetBtn.innerHTML = sparkleSvg(false);
    llmSetBtn.classList.add("rg-llmset");
    // ---- wildcards (Impact Pack): what each field became in the last run (or a preview), and the seed control
    function wcMarkScene() {
        for (const [which, w] of [["positive", E.sceneW], ["negative", E.sceneNegW], ["background", E.sceneBgW]]) {
            E.wcMark(E.sceneTA[which], E.SCENE_KEYS[which], String(w?.value ?? ""));
        }
    }
    function wcSetFilled(filled, preview, msg) {
        E.wcFilled = { ...(preview ? {} : E.wcFilled), ...(filled || {}) };
        if (!preview) E.wcFilled = { ...(filled || {}) };
        wcMarkScene(); E.renderRegions(); E.editor?.refresh(); E.requestDraw();
        const n = Object.keys(filled || {}).length;
        if (msg) E.hint(msg);
        else if (preview) E.hint(n ? `Preview: wildcards filled in ${n} field${n > 1 ? "s" : ""} (hover a field, or see the labels). Right-click the seed: use the filled text` : "Nothing to fill");
    }
    function wcUseAll() {
        let n = 0;
        for (const [which, w] of [["positive", E.sceneW], ["negative", E.sceneNegW], ["background", E.sceneBgW]]) {
            const f = E.filledFor(E.SCENE_KEYS[which], String(w?.value ?? ""));
            if (f != null) { E.setWidget(w, f); n++; }
        }
        const regs = E.state.regions.filter((r) => E.filledFor("r" + r.id, r.prompt || "") != null || E.filledFor(`r${r.id}.text`, r.text || "") != null);
        if (regs.length) E.change(() => {
            for (const r of regs) {
                const p = E.filledFor("r" + r.id, r.prompt || ""), t = E.filledFor(`r${r.id}.text`, r.text || "");
                if (p != null) { r.prompt = p; n++; }
                if (t != null) { r.text = t; n++; }
            }
        });
        wcMarkScene(); E.editor?.refresh();
        E.hint(n ? `The filled text is now in ${n} field${n > 1 ? "s" : ""} (Ctrl+Z undoes the regions)` : "No filled text yet: run the workflow or preview first");
    }
    // (shown only while a prompt field has a wildcard: round 40, to keep the bottom bar short)
    const wcCtl = wildcardSeedControl(E.node, E.el, { fields: E.wcFields, onFilled: wcSetFilled, useAll: wcUseAll, hideIdle: true });
    settings.append(editSeg.box, modelBox, llmSetBtn, acCtl.el, wcCtl.el);
    E.areaLab = areaCtl.lab;                       // edit_area: on the Edit Mode line of the list (rows.js), not in this bar
    E.wcRefresh = () => wcCtl.refresh();           // the seed group shows only while a prompt has a wildcard: looked at on every change
    const syncSettings = () => {
        migrateFormat(); areaCtl.sync(); acCtl.refresh(); wcCtl.refresh();
        editSeg.set(E.isEdit() ? "edit" : "generate");
        imgSeg.set(E.modeW?.value === "use as color map" ? "use as color map" : "backdrop (trace over)");
        const ed = E.isEdit();
        const show = (n, on) => { const d = on ? "" : "none"; if (n.style.display !== d) n.style.display = d; };
        show(imgBox, !ed && imgLinked());
        show(minIn, E.modeW?.value === "use as color map");
        if (document.activeElement !== minIn && +minIn.value !== minPixelsNow()) minIn.value = String(minPixelsNow());
        E.syncEditMaskBox();
    }; E.syncSettings = syncSettings;
    // the edit mask's grow / feather this run uses: the node's own values, else the Settings defaults
    function editMaskNow() {
        const d = editMaskDefaults(), m = E.state.editMask || {};
        return { grow: m.grow ?? d.grow, feather: m.feather ?? d.feather };
    }
}
