// The connected model: the footer pick, the guess from the graph, layout / standard, what the settings row shows.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { app } from "../../../scripts/app.js";
import {
    svgIcon, setHTML, knownLoras, editLoras, CONTROL_FILES, controlFiles, CONTROL_DOWNLOADS, controlFolder, controlLabel, knownModels,
    controlFolders, splitValue, isFullPath,
} from "../rg_shared.js";

export function* model(E) {
    Object.assign(E, {
        guessArch, syncEditLoras, onModelChanged, syncModelSel, syncLayoutBtn, showControlMissing, checkControlFiles,
    });
    yield;

    // Edit Mode: keep this region as it is in the source (lock) or let it change (pencil)
    // ---- the connected model: picked in the footer, else the last run's (while 'model' still comes from the same
    // loader), else a guess from the graph (the loader's file name / type, or the text encoder loader's type)
    const MODEL_NAMES = ["MOSS-Image", "Krea 2", "Ideogram 4", "Flux.1", "Flux.2", "Flux 3", "Anima", "SDXL", "SD1.5"];
    function archFromText(t) {
        t = String(t || "");
        if (/moss/i.test(t)) return "MOSS-Image";
        if (/krea/i.test(t)) return "Krea 2";
        if (/ideogram/i.test(t)) return "Ideogram 4";
        if (/flux[\s._-]*3(?!\d)/i.test(t)) return "Flux 3";
        if (/flux[\s._-]*2(?!\d)|klein/i.test(t)) return "Flux.2";
        if (/flux|kontext/i.test(t)) return "Flux.1";
        if (/anima/i.test(t)) return "Anima";
        if (/sd[\s._-]*1[\s._-]*5|v1-5|sd15/i.test(t)) return "SD1.5";
        if (/sdxl|sd[\s._-]*xl|illustrious|pony|noob/i.test(t)) return "SDXL";
        return null;
    }
    const loaderFile = (n) => {
        const ws = n?.widgets || [];
        const w = ws.find((x) => typeof x.value === "string" && /\.(safetensors|gguf|ckpt|pt|pth|sft|bin)$/i.test(x.value))
            || ws.find((x) => /name/i.test(x.name) && typeof x.value === "string");
        return w ? String(w.value) : "";
    };
    // follow 'model' up to its source (through LoRA loaders, model patches, reroutes ...)
    function modelSource() {
        let n = E.node;
        for (let i = 0; i < 24; i++) {
            const f = E.feeder(n, "model");
            if (!f) return n === E.node ? null : { n, file: loaderFile(n) };
            n = f.src;
            if (!n.inputs?.some((x) => x.name === "model")) return { n, file: loaderFile(n) };
        }
        return null;
    }
    function clipType() {                      // the text encoder loader's 'type' (CLIPLoader, DualCLIPLoader ...)
        let n = E.node;
        for (let i = 0; i < 24; i++) {
            const f = E.feeder(n, "clip");
            if (!f) return "";
            n = f.src;
            const t = n.widgets?.find((w) => w.name === "type");
            if (t && !n.inputs?.some((x) => x.name === "clip" && x.link != null)) return String(t.value || "");
        }
        return "";
    }
    function guessArch() {
        const src = modelSource();
        const arch = (src && (archFromText(src.file) || archFromText(src.n.comfyClass || src.n.type) || archFromText(src.n.title)))
            || archFromText(clipType());
        return { arch: arch || null, sig: src ? `${src.n.id}:${src.file}` : "" };
    }
    function modelInfo() {                     // { arch, how: "picked" | "last run" | "guess" | null, guess }
        const pick = E.node.properties?.rg_model_pick;
        const g = guessArch(), run = E.node.properties?.rg_model_arch || null, runSig = E.node.properties?.rg_model_src;
        if (pick && MODEL_NAMES.includes(pick)) return { arch: pick, how: "picked", guess: g.arch };
        if (run && (runSig == null || runSig === g.sig || !g.sig)) return { arch: run, how: "last run", guess: g.arch };
        return { arch: g.arch, how: g.arch ? "guess" : null, guess: g.arch };
    }
    const modelArch = () => modelInfo().arch; E.modelArch = modelArch;
    // the edit LoRAs Edit Mode wants in Whole image: the one for the model, or every one while the model isn't known
    function syncEditLoras() {
        const all = editLoras(), arch = modelArch();
        const want = !E.isEdit() || E.state.editOff ? [] : arch ? all.filter(([m]) => m === arch) : all;
        const cur = E.state.sceneLoras || [];
        const kept = cur.filter((x) => !x.edit || want.some(([m, l]) => x.edit === m && x.lora === l));
        const add = want.filter(([m, l]) => !kept.some((x) => x.edit === m && x.lora === l)).map(([m, lora]) => ({ lora, strength: 1, on: true, edit: m }));
        if (kept.length === cur.length && !add.length) return false;
        E.state.sceneLoras = [...kept, ...add];
        if (!E.state.sceneLoras.length) delete E.state.sceneLoras;
        return true;
    }
    let syncedArch; E.filesSig = "";
    // the model changed (picked, rewired, or a run said so): the Control and Edit Mode LoRAs follow it (no undo step)
    function onModelChanged(force) {
        const arch = modelArch();
        if (!force && arch === syncedArch) return;
        syncedArch = arch;
        const a = E.syncControlLoras(), b = syncEditLoras();
        if (a || b) E.save();
        // the Edit / Control rows show the model's LoRA and files: redraw them now (round 23)
        if (a || b || E.isEdit() || E.controls().length) E.renderRegions();
        syncModelSel();
        if (E.controls().length) checkControlFiles(false);
    }
    // the footer select: auto (with what it found) or a model picked to correct it
    const modelSel = E.el("select", "rg-sel rg-model");
    modelSel.addEventListener("pointerdown", (e) => e.stopPropagation());
    // MOSS-Image: layout (its layout JSON, with the region boxes) or standard (a plain text prompt)
    const layoutBtn = E.iconBtn("mossLayout", "", () => {
        E.node.properties = E.node.properties || {};
        if (E.node.properties.rg_moss_layout === false) delete E.node.properties.rg_moss_layout;
        else E.node.properties.rg_moss_layout = false;
        app.graph?.change?.();
        syncModelSel();
    }, "rg-layout");
    E.modelBox.append(modelSel, layoutBtn);         // in the bottom bar, after Edit Mode
    modelSel.addEventListener("change", () => {
        E.node.properties = E.node.properties || {};
        if (modelSel.value) E.node.properties.rg_model_pick = modelSel.value; else delete E.node.properties.rg_model_pick;
        app.graph?.change?.();
        onModelChanged(true);
    });
    function syncModelSel() {
        const info = modelInfo(), pick = E.node.properties?.rg_model_pick || "";
        const auto = !pick && info.arch ? `auto · ${info.arch}` : pick && info.guess ? `auto (${info.guess})` : "auto · model?";
        const opts = [["", auto], ...MODEL_NAMES.map((m) => [m, m])];
        const sig = JSON.stringify(opts);
        if (modelSel.dataset.sig !== sig) { modelSel.replaceChildren(...opts.map(([v, t]) => E.opt(v, t))); modelSel.dataset.sig = sig; }
        if (document.activeElement !== modelSel) modelSel.value = pick;
        modelSel.title = "The model this node works with. It sets the format of the 'prompt' and 'positive' outputs "
            + "(MOSS-Image: MOSS layout JSON, Ideogram 4: Ideogram caption JSON, the others: Plain text), the LoRAs "
            + "Control and Edit Mode add to Whole image, and the control files.\n"
            + (pick ? `Picked: ${pick}. ` : info.how === "last run" ? `Auto: ${info.arch}, from the last run. `
                : info.how === "guess" ? `Auto: ${info.arch}, guessed from the model loader's file / type (the run checks the model itself). `
                : "Auto: Not known yet (no run, and nothing to guess from); the run checks the connected model. ")
            + "Pick a model to correct a wrong guess; 'auto' follows the graph and the runs again."
            + (E.lastFormat ? `\nThe last run's prompt format: ${E.lastFormat}.` : "");
        modelSel.classList.toggle("picked", !!pick);
        // MOSS-Image's layout / standard switch
        layoutBtn.style.display = info.arch === "MOSS-Image" ? "" : "none";
        syncLayoutBtn();
        E.syncBackground();
    }
    // round 20: the icon shows the mode the run will use: standard by itself while no region is drawn and shown
    // (holes don't count) and in Edit Mode, even when layout is chosen; layout comes back with a region
    let layoutAuto = null;
    function syncLayoutBtn(anyRegion) {
        if (anyRegion === undefined) anyRegion = E.outputIndexMap().some((v) => v != null);
        const want = E.node.properties?.rg_moss_layout !== false, edit = E.isEdit();
        const layout = want && anyRegion && !edit;
        const key = `${want}|${anyRegion}|${edit}`;
        if (key === layoutAuto) return;
        layoutAuto = key;
        setHTML(layoutBtn, svgIcon(layout ? "mossLayout" : "mossStandard"));
        layoutBtn.classList.toggle("on", layout);
        const why = !want ? "" : edit ? "\nStandard by itself: Edit Mode always sends plain text (the edit LoRA takes an instruction)."
            : !anyRegion ? "\nStandard by itself: No region is drawn and shown. Layout comes back when one is." : "";
        layoutBtn.title = (layout
            ? "MOSS-Image layout mode: The prompt is MOSS layout JSON, with each region's box. Click for standard mode."
            : want ? "MOSS-Image standard mode (for now): The prompt is plain text. Click to choose standard mode for good."
            : "MOSS-Image standard mode: The prompt is plain text (the regions as sentences; masks still steer them). Click for layout mode.")
            + why;
    }
    // the files the Control row needs for the model and kind, and the ones ComfyUI doesn't have: the message bar
    // shows where to get them (like Select object's missing-model message)
    function neededControlFiles(c, arch) {
        const files = controlFiles(), need = [];
        const mapMade = !E.isLinked("control_image") && ["depth", "color+depth"].includes(c.kind);
        if (arch === "MOSS-Image") {
            if (["color", "color+depth", "depth"].includes(c.kind)) need.push("MOSS");
        } else if (arch === "Flux.1") {
            if (c.kind === "depth") need.push(files.Flux1Depth || !files["Flux1.depth"] ? "Flux1Depth" : "Flux1.depth");
            else if (c.kind === "canny") need.push(files.Flux1Canny || !files["Flux1.canny"] ? "Flux1Canny" : "Flux1.canny");
            else if (c.kind === "other") need.push("Flux1.other");
        } else if (arch === "SDXL" || arch === "SD1.5" || arch === "Anima") {
            const k = { SDXL: "SDXL", "SD1.5": "SD15", Anima: "Anima" }[arch];
            if (["depth", "canny", "other"].includes(c.kind)) need.push(`${k}.${c.kind}`);
        }
        if (mapMade && need.length) need.push("DA3");
        return need;
    }
    function missingControlFiles(keys) {
        const files = controlFiles(), out = [];
        for (const key of keys) {
            const sv = splitValue(files[key] || ""), folder = sv.folder || controlFolder(key);
            const list = folder === "loras" ? (knownLoras() || []) : (sv.folder ? [folder] : controlFolders(key)).flatMap((f) => knownModels(f) || []);
            if (!files[key]) out.push([key, "unset"]);
            // a full path (Browse…) is checked by the run, which notes a file it can't find
            else if (!isFullPath(files[key]) && list.length && !list.includes(sv.name)) out.push([key, "missing", files[key]]);
        }
        return out;
    }
    function showControlMissing(items) {
        if (!items.length) return false;
        const lines = items.map(([key, why, name]) => {
            const d = CONTROL_DOWNLOADS[key], folder = controlFolder(key);
            const state = why === "missing" ? `'${name}' isn't in ComfyUI/models/${folder} (ComfyUI doesn't see it)` : "no file is set";
            return `${controlLabel(key)}: ${state}. Download ${d?.file || "one"}${d ? ` (${d.url})` : ""}${d?.note ? ` — ${d.note}` : ""} `
                + `into ComfyUI/models/${folder}, refresh ComfyUI (R), then pick it in Settings > Region Genie > Control (or keep it `
                + "anywhere and pick it there with the folder button, Browse…).";
        });
        E.showMsg(lines.join("\n"));
        return true;
    }
    function checkControlFiles(refreshLists) {
        const rows = E.controls(), arch = modelArch();
        if (!rows.length) return;
        if (refreshLists) for (const f of new Set(CONTROL_FILES.map((x) => x[2]))) if (f !== "loras") knownModels(f, true);
        if (arch && !["MOSS-Image", "Flux.1", "SDXL", "SD1.5", "Anima"].includes(arch)) {
            E.showMsg(`Control: ComfyUI has no ControlNet support for ${arch} yet, so this node can't apply control with it. `
                + "If the model was guessed wrong, pick the right one in the bottom bar.");
            return;
        }
        const keys = [...new Set(rows.flatMap((c) => neededControlFiles(c, arch)))];
        if (!showControlMissing(missingControlFiles(keys))) E.hideMsg();
    }
}
