// The Control and Edit rows under Whole image, the per-region control / keep switches, and the message bar.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
import { app } from "../../../scripts/app.js";
import {
    svgIcon, setHTML, getSetting, setSetting, SET, controlFiles, CONTROL_KIND_HELP, NO_LORA, fileField, MODEL_ROOTS, splitValue,
    isFullPath, EDIT_MODELS,
} from "../rg_shared.js";

export function* rows(E) {
    Object.assign(E, {
        syncControlLoras, pruneManagedLoras, addControl, editRows, addEditRow, controlRow, controlToggle, keepToggle, hideBanner,
        showMsg, hideMsg, notify,
    });
    yield;

    // ---- Control (ControlNet / control LoRAs): the row under Whole image, the per-region switch, the LoRAs it adds
    const CONTROL_KIND_LABELS = [["color", "color map (MOSS)"], ["color+depth", "color map + depth (MOSS)"], ["depth", "depth"],
                                 ["canny", "canny"], ["other", "your control_image"]];
    const CONTROL_DEFAULT = { kind: "depth", strength: 1, start: 0, end: 1 };
    const controls = () => E.state.controls || []; E.controls = controls;           // the Control rows (round 23: several)
    E.controlMaps = []; E.controlMapsKey = ""; E.controlShowK = -1;   // each row's map of the last run; the one shown
    // the control LoRAs the Control rows want (kept with Whole image's LoRAs, not listed there): [{lora, control: model,
    // ckind, strength}]; a Flux.1 depth / canny LoRA takes its row's strength
    function wantedControlLoras() {
        const files = controlFiles(), arch = E.modelArch(), out = [];
        for (const c of controls()) {
            const add = (key, model, ckind, strength) => {
                if (!files[key] || (arch && arch !== model)) return;
                if (!out.some((x) => x.lora === files[key] && x.control === model && x.ckind === ckind)) out.push({ lora: files[key], control: model, ckind, strength });
            };
            if (["color", "color+depth", "depth"].includes(c.kind)) add("MOSS", "MOSS-Image", "moss", 1);
            if (c.kind === "depth") add("Flux1Depth", "Flux.1", "depth", c.strength);
            if (c.kind === "canny") add("Flux1Canny", "Flux.1", "canny", c.strength);
        }
        return out;
    }
    // keep those LoRAs in step (inside a change(): one undo step with the switch that caused it)
    function syncControlLoras() {
        const want = wantedControlLoras(), cur = E.state.sceneLoras || [];
        const same = (a, b) => a.lora === b.lora && a.control === b.control && a.ckind === b.ckind;
        let changed = false;
        const kept = cur.filter((x) => !x.control || want.some((w) => same(w, x)));
        for (const x of kept) {
            const w = x.control && want.find((y) => same(y, x));
            if (w && x.strength !== w.strength) { x.strength = w.strength; changed = true; }
        }
        const add = want.filter((w) => !kept.some((x) => x.control && same(w, x))).map((w) => ({ ...w, on: true }));
        if (kept.length === cur.length && !add.length && !changed) return false;
        E.state.sceneLoras = [...kept, ...add];
        if (!E.state.sceneLoras.length) delete E.state.sceneLoras;
        return true;
    }
    // Edit Mode's LoRAs never stay in Generate, nor a control LoRA while Control is off: whatever put them there (Ctrl+Z
    // after switching back, an old workflow, a Setting changed meanwhile). Only removes; adding is syncEditLoras' /
    // syncControlLoras' job (on a mode, model or Control change)
    function pruneManagedLoras() {
        const cur = E.state.sceneLoras || [], ctlOn = controls().length > 0, edit = E.isEdit() && !E.state.editOff;
        const kept = cur.filter((x) => !(x.edit && !edit) && !(x.control && !ctlOn));
        if (kept.length === cur.length) return false;
        if (kept.length) E.state.sceneLoras = kept; else delete E.state.sceneLoras;
        return true;
    }
    function setControl(k, patch) {
        E.change(() => { E.state.controls[k] = { ...E.state.controls[k], ...patch }; syncControlLoras(); });
        E.checkControlFiles(true);
    }
    function addControl() {
        E.change(() => {
            // the first row: as the last one removed; more rows: the first kind not in use yet
            const used = new Set(controls().map((c) => c.kind));
            const row = !controls().length && E.state.controlLast ? { ...CONTROL_DEFAULT, ...E.state.controlLast }
                : { ...CONTROL_DEFAULT, kind: ["depth", "canny", "other", "color", "color+depth"].find((k) => !used.has(k)) || "depth" };
            E.state.controls = [...controls(), row];
            syncControlLoras();
        });
        E.checkControlFiles(true);
    }
    function removeControl(k) {
        E.change(() => {
            E.state.controlLast = { ...E.state.controls[k] };
            E.state.controls.splice(k, 1);
            if (!E.state.controls.length) delete E.state.controls;
            syncControlLoras();
        });
        if (E.controlShowK === k) E.controlShowK = -1;
        controls().length ? E.checkControlFiles(false) : hideMsg();
    }
    // the file a Control row uses for the node's model (its kind's tooltip names it)
    function controlFileFor(c, arch) {
        const f = controlFiles(), n = (k) => f[k] ? (isFullPath(f[k]) ? f[k] : splitValue(f[k]).name) : "none set (Settings > Region Genie > Control)";
        if (!arch) return "The file depends on the model, which isn't known yet (pick it in the bottom bar).";
        if (arch === "MOSS-Image") return ["color", "color+depth", "depth"].includes(c.kind) ? `File for MOSS-Image: ${n("MOSS")} (control LoRA).`
            : "MOSS-Image reads only the color map and / or depth.";
        if (arch === "Flux.1") {
            if (c.kind === "depth" && f.Flux1Depth) return `File for Flux.1: ${n("Flux1Depth")} (depth LoRA, at this row's strength).`;
            if (c.kind === "canny" && f.Flux1Canny) return `File for Flux.1: ${n("Flux1Canny")} (canny LoRA, at this row's strength).`;
            return ["depth", "canny", "other"].includes(c.kind) ? `File for Flux.1: ${n(`Flux1.${c.kind}`)} (ControlNet).` : "Flux.1 doesn't read a color map.";
        }
        const k = { SDXL: "SDXL", "SD1.5": "SD15", Anima: "Anima" }[arch];
        if (k) return ["depth", "canny", "other"].includes(c.kind) ? `File for ${arch}: ${n(`${k}.${c.kind}`)}.` : `${arch} doesn't read a color map.`;
        return `ComfyUI has no ControlNet for ${arch} yet.`;
    }
    // ---- round 23: the Edit rows (Edit Mode only). The first is the edit LoRA set in Settings > Region Genie >
    // Edit Mode for the node's model (✕ removes it for this node); ＋Edit adds rows of this node's own LoRAs, used
    // in Edit Mode with any model. The files: ComfyUI's menu on the model folders (Browse… with the Settings switch).
    const rowNum = (v, title, lo, hi, step, set) => {
        const i = E.el("input", "rg-num"); i.type = "number"; i.min = String(lo); i.max = String(hi); i.step = String(step);
        i.value = String(v); i.title = title;
        i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") i.blur(); });
        i.addEventListener("change", () => set(Math.min(hi, Math.max(lo, +i.value || 0))));
        i.addEventListener("pointerdown", (e) => e.stopPropagation());
        return i;
    };
    const rowLabel = (text, title) => {
        const pad = E.el("span", "rg-chev"); pad.style.visibility = "hidden"; pad.textContent = "▶";   // lines up with the regions
        const lbl = E.el("span", "rg-pseudo"); lbl.textContent = text; lbl.title = title;
        return [pad, lbl];
    };
    const rowX = (title, fn) => { const x = E.iconBtn("close", title, fn); x.addEventListener("pointerdown", (e) => e.stopPropagation()); return x; };
    function editRows() {
        const frag = document.createDocumentFragment();
        if (!E.state.editOff) {
            const row = E.el("div", "rg-row ctrl edit");
            row.append(...rowLabel("Edit", "The edit LoRA set in Settings > Region Genie > Edit Mode for the node's model: Used only in "
                + "Edit Mode, with that model."));
            const arch = E.modelArch(), m = EDIT_MODELS.find(([name]) => name === arch);
            const t = E.el("span", "rg-hint"); t.style.flex = "0 0 auto";
            if (!m) {
                t.textContent = "The model isn't known yet: Pick it in the bottom bar to choose its edit LoRA here";
                t.title = "Until the model is known, the edit LoRAs set for every model in Settings > Region Genie > Edit Mode are used.";
                row.append(t);
            } else {
                const id = SET.editLora + "." + m[1], cur = getSetting(id, NO_LORA) || NO_LORA;
                t.textContent = `${arch}:`;
                const f = fileField({
                    roots: MODEL_ROOTS, home: "loras", none: NO_LORA, value: cur, cls: "rg-row-ff", menuTitle: `${arch}: edit LoRA`,
                    title: `The edit LoRA for ${arch} (the same as Settings > Region Genie > Edit Mode > '${arch}: edit LoRA')`,
                    onPick: async (v) => { await setSetting(id, v); E.onModelChanged(true); },
                });
                const lo = (E.state.sceneLoras || []).find((x) => x.edit === arch);
                const str = rowNum(lo ? lo.strength : 1, "Strength of the edit LoRA (1 = as trained)", -10, 10, 0.05,
                    (v) => E.change(() => { const x = (E.state.sceneLoras || []).find((y) => y.edit === arch); if (x) x.strength = v; }));
                str.disabled = !lo;
                row.append(t, f, str);
            }
            row.append(rowX("Remove the Edit row: This node doesn't use the edit LoRA from Settings (the setting stays). ＋Edit brings it back.",
                () => E.change(() => { E.state.editOff = true; E.syncEditLoras(); })));
            frag.appendChild(row);
        }
        (E.state.editLoras || []).forEach((lo, k) => {
            const row = E.el("div", "rg-row ctrl edit");
            row.append(...rowLabel("Edit", "A LoRA of this node's own for Edit Mode (added with ＋Edit): Used only in Edit Mode, "
                + "with any model (e.g. a relighting or style add-on for an edit model)."));
            const f = fileField({
                roots: MODEL_ROOTS, home: "loras", none: "", noneLabel: false, emptyLabel: "(choose a LoRA)", value: lo.lora, cls: "rg-row-ff", menuTitle: "Edit LoRA (this node)",
                title: "A LoRA used in Edit Mode only, in this node", onPick: (v) => E.change(() => { lo.lora = v; }),
            });
            const str = rowNum(lo.strength, "Strength (1 = as trained)", -10, 10, 0.05, (v) => E.change(() => { lo.strength = v; }));
            row.append(f, str, rowX("Remove this Edit row", () => E.change(() => {
                E.state.editLoras.splice(k, 1); if (!E.state.editLoras.length) delete E.state.editLoras;
            })));
            frag.appendChild(row);
        });
        return frag;
    }
    function addEditRow() {
        E.change(() => {
            if (E.state.editOff) { delete E.state.editOff; E.syncEditLoras(); }         // the Settings one first
            else E.state.editLoras = [...(E.state.editLoras || []), { lora: "", strength: 1, on: true }];
        });
    }
    // ---- the Control rows (round 23: several; ＋Control adds one, ✕ removes it; no details under them)
    function controlRow(c, k) {
        const row = E.el("div", "rg-row ctrl");
        row.append(...rowLabel("Control", "Control: The model follows a map (ControlNet / control LoRA for the connected model). "
            + "The files are set in Settings > Region Genie > Control."));
        const kind = E.el("select", "rg-sel");
        kind.title = (CONTROL_KIND_HELP[c.kind] || "") + "\n" + controlFileFor(c, E.modelArch())
            + "\n\nWhat the model follows: The regions' color map and / or depth (MOSS-Image's control LoRA), depth, canny, or "
            + "the map on 'control_image'. Depth and canny are made from 'image' when control_image isn't connected.";
        for (const [v, t] of CONTROL_KIND_LABELS) kind.appendChild(E.opt(v, t));
        kind.value = c.kind;
        kind.addEventListener("change", () => setControl(k, { kind: kind.value }));
        kind.addEventListener("pointerdown", (e) => e.stopPropagation());
        const str = rowNum(c.strength, "Strength (1 = as trained)", 0, 10, 0.05, (v) => setControl(k, { strength: v }));
        const a = rowNum(Math.round(c.start * 100), "Start, in % of the steps", 0, 100, 1, (v) => setControl(k, { start: v / 100 }));
        const b = rowNum(Math.round(c.end * 100), "End, in % of the steps (ending early keeps the layout, then lets the shapes loosen)", 0, 100, 1, (v) => setControl(k, { end: v / 100 }));
        const pct = E.el("span", "rg-hint"); pct.textContent = "%";
        const dash = E.el("span", "rg-hint"); dash.textContent = "–";
        const map = E.controlMaps[k], shown = E.controlShowK === k;
        const eye = E.iconBtn(shown ? "eye" : "eyeOff", map ? (shown ? "Hide this row's control map on the canvas" : "Show this row's control map of the last run on the canvas")
            : "This row's control map shows here after a run", () => { E.controlShowK = shown ? -1 : k; E.renderRegions(); E.requestDraw(); });
        eye.disabled = !map;
        eye.addEventListener("pointerdown", (e) => e.stopPropagation());
        const gap = E.el("span"); gap.style.flex = "1 1 auto";
        row.append(kind, str, a, dash, b, pct, gap, eye, rowX("Remove this Control row (its settings are kept for the next ＋Control)", () => removeControl(k)));
        return row;
    }
    function controlToggle(r) {
        const on = !r.noControl;
        const b = E.el("button", "rg-btn mini" + (on ? " toggle on" : ""));
        setHTML(b, svgIcon(on ? "control" : "controlOff"));
        b.title = on ? "Control acts on this region. Click to leave it out (while any region is left out, the control acts only inside the regions still on)."
            : "Control leaves this region out. Click to include it again.";
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        b.addEventListener("click", (e) => { e.preventDefault(); E.change(() => { if (r.noControl) delete r.noControl; else r.noControl = true; }); });
        return b;
    }
    function keepToggle(r) {
        const b = E.el("button", "rg-btn mini" + (r.keep ? " toggle on" : ""));
        setHTML(b, svgIcon(r.keep ? "lock" : "pencil"));
        b.title = r.keep
            ? "Keep (Edit Mode): This region stays as it is in the source image, also with change = whole image, and "
                + "the edit mask never grows into it. Its prompt is still part of the prompt. Click to let it change."
            : "Change (Edit Mode): The sampler may change this region. Click to keep it as it is in the source image "
                + "(it is hatched on the canvas then).";
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        b.addEventListener("click", (e) => { e.preventDefault(); E.change(() => { if (r.keep) delete r.keep; else r.keep = true; }); });
        return b;
    }
    const foot = E.el("div", "rg-foot"); E.foot = foot;
    const footGap = E.el("span"); footGap.style.flex = "1 1 auto";
    foot.append(E.settings, footGap, E.exportBtn, E.importBtn, E.fileIn);

    // banner shown when import_json brings a new layout while the canvas has content ("ask before replacing")
    const banner = E.el("div", "rg-banner"); E.banner = banner; banner.style.display = "none";
    E.pendingImport = null;
    const bannerText = E.el("span"); E.bannerText = bannerText;
    const replaceBtn = E.btn("Replace canvas", "Load the layout from import_json (undoable). Run again to use it.", () => {
        const p = E.pendingImport; hideBanner(); if (p) E.applyLayout(p.state, p.scene_prompt, p.sig, null, p.scene_prompt_negative, null, p.scene_prompt_background);
    });
    const keepBtn = E.btn("Keep canvas", "Ignore this import_json; it won't ask again until import_json changes.", () => {
        const p = E.pendingImport; hideBanner(); if (p) { E.state.importSig = p.sig; E.save(); }
    });
    banner.append(bannerText, replaceBtn, keepBtn);
    function hideBanner() { E.pendingImport = null; banner.style.display = "none"; }
    // message bar under the canvas (Select object errors): stays until closed, another tool is picked or the mode
    // changes. Its text can be selected and copied, links open in a new tab, "Copy link" copies the first link.
    const msgBar = E.el("div", "rg-msg"); E.msgBar = msgBar; msgBar.style.display = "none";
    const msgIcon = E.el("span", "rg-msg-icon"); msgIcon.textContent = "⚠";
    const msgText = E.el("div", "rg-msg-text");
    let msgUrl = "";
    const msgCopy = E.btn("Copy link", "Copy the link to the clipboard", async () => {
        E.hint(await copyText(msgUrl) ? "Link copied" : "Couldn't copy: select the link and press Ctrl+C");
    });
    const msgClose = E.btn("✕", "Close this message", () => { hideMsg(); E.focusSink(); });
    msgBar.append(msgIcon, msgText, msgCopy, msgClose);
    // keep LiteGraph / Nodes 2.0 from treating a text selection as a node drag; the browser's own menu on right-click
    for (const ev of ["pointerdown", "mousedown", "dblclick", "contextmenu", "wheel"]) msgBar.addEventListener(ev, (e) => e.stopPropagation());
    function showMsg(text) {
        msgText.replaceChildren();
        msgUrl = "";
        const re = /https?:\/\/[^\s()<>"']+/g;
        let last = 0, m;
        while ((m = re.exec(text))) {
            const url = m[0].replace(/[.,;:]+$/, "");
            msgText.append(text.slice(last, m.index));
            const a = E.el("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = url;
            msgText.append(a);
            last = m.index + url.length;
            if (!msgUrl) msgUrl = url;
        }
        msgText.append(text.slice(last));
        msgCopy.style.display = msgUrl ? "" : "none";
        msgBar.style.display = "";
    }
    function hideMsg() { if (msgBar.style.display !== "none") msgBar.style.display = "none"; }
    const msgSelected = () => {
        const sel = window.getSelection?.();
        return !!(sel && !sel.isCollapsed && msgBar.style.display !== "none" && msgBar.contains(sel.anchorNode));
    }; E.msgSelected = msgSelected;
    async function copyText(t) {
        try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* not a secure page: fall back */ }
        const ta = document.createElement("textarea");
        ta.value = t; ta.style.cssText = "position:fixed;left:-9999px;top:0;";
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        ta.remove(); E.focusSink();
        return ok;
    }
    function notify(msg, isError) {
        try { app.extensionManager?.toast?.add({ severity: isError ? "error" : "info", summary: "Region Genie", detail: msg, life: 5000 }); }
        catch (e) { console[isError ? "error" : "log"]("[Region Genie]", msg); }
    }

    E.configured = false;              // loaded from a workflow: keep its size
    const cvBox = E.el("div", "rg-cv"); E.cvBox = cvBox;
    // Nodes 2.0 sends wheel events over nodes to the graph unless the element is marked like this
    // and contains the focused element (the hidden keyboard field, focused on hover below).
    E.wrap.dataset.captureWheel = "true";        // only here: the nearest marked ancestor must contain the focus
    const cv = E.el("canvas"); E.cv = cv;
    cvBox.append(cv, E.optStrip, E.bdBox);            // the tool options (top left) and the image opacity (right edge)
    const ctx = cv.getContext("2d"); E.ctx = ctx;
}
