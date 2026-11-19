// The Region Genie node's editor, in parts.
//
// The editor of one node used to be a single function of about 4,900 lines. It is now split into the parts below, in
// the order they run. All parts of one node share one object, E (created in region_genie.js):
//   - a function or value that only its own part uses is an ordinary local;
//   - one that another part uses is on E: its own part publishes it (functions: Object.assign(E, …) at the top;
//     values: 'E.name = name' after the declaration) and the other parts read E.name;
//   - a variable that changes and is used by several parts lives on E only (E.state, E.tool …).
// Each part is a generator with one 'yield': buildEditor() first runs every part up to its yield (so all functions
// are on E, whatever the order of the files), then runs the parts' bodies in order.
import { core } from "./core.js";
import { toolbar } from "./toolbar.js";
import { footer } from "./footer.js";
import { model } from "./model.js";
import { rows } from "./rows.js";
import { canvasUi } from "./canvasUi.js";
import { sizeRow } from "./sizeRow.js";
import { view } from "./view.js";
import { regions } from "./regions.js";
import { render } from "./render.js";
import { selectTools } from "./selectTools.js";
import { pointer } from "./pointer.js";
import { popups } from "./popups.js";
import { list } from "./list.js";
import { llm } from "./llm.js";
import { lifecycle } from "./lifecycle.js";
import { big } from "./big.js";
import { keys } from "./keys.js";
import { menu } from "./menu.js";

const PARTS = [core, toolbar, footer, model, rows, canvasUi, sizeRow, view, regions, render, selectTools, pointer, popups, list, llm, lifecycle, big, keys, menu];

export function buildEditor(node, outer = {}) {
    const E = { node, ...outer };
    const parts = PARTS.map((part) => part(E));
    for (const p of parts) p.next();        // 1: every part publishes its functions on E
    for (const p of parts) p.next();        // 2: the parts run, in order
    return E;
}
