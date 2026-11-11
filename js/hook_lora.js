import { app } from "../../scripts/app.js";
import { padWidgets } from "./rg_shared.js";

// Show the node's LoRA summary (layers patched, adapter types, skips) on the node.
const NODE_NAMES = ["Region-Genie_CreateHookLoRA", "RegionalMaskKit_CreateHookLoRASingle"];   // new ID, old ID
const INFO_WIDGET = "lora_summary";

async function showInfo(node, text) {
    if (typeof text !== "string") return;
    let w = node.widgets?.find((w) => w.name === INFO_WIDGET);
    if (!w) {
        try {
            const { ComfyWidgets } = await import("../../scripts/widgets.js");
            w = ComfyWidgets["STRING"](node, INFO_WIDGET, ["STRING", { multiline: true, "pysssss.autocomplete": false }], app).widget;
            w.serialize = false;
            if (w.inputEl) {
                w.inputEl.readOnly = true;
                w.inputEl.style.opacity = 0.75;
            }
            padWidgets(node, [INFO_WIDGET]);                 // room for an overlay scrollbar
        } catch (e) {
            console.warn("[Region Genie] could not add summary widget:", e);
            return;
        }
    }
    w.value = text;
    node.setSize?.([node.size[0], Math.max(node.size[1], node.computeSize()[1])]);
    node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "RegionGenie.HookLoRASummary",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!NODE_NAMES.includes(nodeData.name)) return;
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            showInfo(this, message?.lora_info?.[0]);
        };
    },
});
