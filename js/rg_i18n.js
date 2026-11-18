// Translated dropdown choices on this pack's nodes.
//
// ComfyUI translates node names, input / output names, tooltips and Settings from the pack's locales/<language>/
// files by itself (it follows Settings > Language). The one thing it has no key for is the choices of a node's
// dropdown, so this script shows them translated: the texts come from "regionGenie.choices" in
// locales/<language>/main.json (ComfyUI serves every pack's locale files at /i18n). Only the label changes: the
// widget's value, and so the saved workflow and the API prompt, stay the English word.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

let all = null;                                             // { language: { regionGenie: { choices: { english: translated } } } }

const locale = () => { try { return app.extensionManager?.setting?.get?.("Comfy.Locale") || "en"; } catch (e) { return "en"; } };
const choices = () => all?.[locale()]?.regionGenie?.choices;

// The label of a dropdown choice in ComfyUI's language (the value itself when there is no translation).
export function choiceLabel(value) {
    const t = typeof value === "string" ? choices()?.[value] : undefined;
    return typeof t === "string" && t ? t : (value ?? "");
}

// The name of a node input in ComfyUI's language (the English name when there is no translation).
export function inputLabel(nodeClass, input) {
    const t = all?.[locale()]?.nodeDefs?.[nodeClass]?.inputs?.[input]?.name;
    return typeof t === "string" && t ? t : input;
}

app.registerExtension({
    name: "RegionGenie.I18n",
    async init() {
        try { all = await (await api.fetchApi("/i18n")).json(); } catch (e) { all = {}; }
    },
    nodeCreated(node) {
        if (!String(node.comfyClass || "").startsWith("Region-Genie_") || !choices()) return;      // English: nothing changes
        for (const w of node.widgets || []) {
            if (w.type === "combo" && w.options && !w.options.getOptionLabel) w.options.getOptionLabel = choiceLabel;
        }
    },
});
