import { app } from "../../scripts/app.js";
import { NODE_NAMES } from "./editor/state.js";
import { injectStyle } from "./editor/style.js";
import { chain } from "./editor/graph.js";
import { buildEditor } from "./editor/parts.js";

app.registerExtension({
    name: "RegionGenie.Main",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!NODE_NAMES.includes(nodeData.name)) return;
        injectStyle();

        chain(nodeType.prototype, "onNodeCreated", function () { buildEditor(this, { nodeData }); });
    },
});
