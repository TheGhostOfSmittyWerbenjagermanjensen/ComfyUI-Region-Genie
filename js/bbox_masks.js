import { app } from "../../scripts/app.js";
import { padWidgets } from "./rg_shared.js";

// After "BBoxes to Masks" or "Mask Picker" runs, show the valid index range in the index
// widget's label (e.g. "index (0-2)") and list every bbox on the node.
// The index itself is never capped, so bboxes added later can be selected
// before the next run. Values past the last known bbox are flagged in the label.
const NODE_NAMES = ["Region-Genie_BBoxToMasks", "Region-Genie_MaskPicker",
                    "RegionalMaskKit_BBoxesToMasks", "RegionalMaskKit_MaskPicker"];      // new IDs, old IDs (old workflows)
const INFO_WIDGET = "bbox_list";
const HARD_MAX = 255;

function updateLabel(node) {
    const w = node.widgets?.find((w) => w.name === "index");
    if (!w) return;
    const count = node.__bboxCount;
    if (typeof count !== "number") {
        w.label = undefined;
    } else if (count === 0) {
        w.label = "index (none found)";
    } else {
        const last = count - 1;
        const range = last === 0 ? "0" : `0-${last}`;
        w.label = w.value > last ? `index (${range}) - not found yet` : `index (${range})`;
    }
    node.setDirtyCanvas?.(true, true);
}

function hookIndexWidget(node) {
    const w = node.widgets?.find((w) => w.name === "index");
    if (!w || w.__bboxHooked) return;
    w.__bboxHooked = true;
    w.options = w.options || {};
    w.options.max = HARD_MAX; // undo the cap from the previous version
    const cb = w.callback;
    w.callback = function () {
        const r = cb?.apply(this, arguments);
        updateLabel(node);
        return r;
    };
}

async function applyInfo(node, text) {
    if (typeof text !== "string") return;
    let iw = node.widgets?.find((w) => w.name === INFO_WIDGET);
    if (!iw) {
        try {
            const { ComfyWidgets } = await import("../../scripts/widgets.js");
            iw = ComfyWidgets["STRING"](node, INFO_WIDGET, ["STRING", { multiline: true, "pysssss.autocomplete": false }], app).widget;
            iw.serialize = false;
            if (iw.inputEl) {
                iw.inputEl.readOnly = true;
                iw.inputEl.style.opacity = 0.75;
            }
            padWidgets(node, [INFO_WIDGET]);                 // room for an overlay scrollbar
        } catch (e) {
            console.warn("[Region Genie] could not add bbox list widget:", e);
            return;
        }
    }
    iw.value = text;
    node.setSize?.([node.size[0], Math.max(node.size[1], node.computeSize()[1])]);
}

app.registerExtension({
    name: "RegionGenie.IndexRange",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!NODE_NAMES.includes(nodeData.name)) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated?.apply(this, arguments);
            hookIndexWidget(this);
            return r;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            hookIndexWidget(this);
            const count = message?.bbox_count?.[0];
            if (typeof count === "number") this.__bboxCount = count;
            updateLabel(this);
            applyInfo(this, message?.bbox_info?.[0]);
        };
    },
});
