// Graph helpers: chaining node callbacks, links, moving links of old workflows to renamed outputs.

export function chain(obj, prop, fn) {
    const orig = obj[prop];
    obj[prop] = function () {
        const r = orig?.apply(this, arguments);
        fn.apply(this, arguments);
        return r;
    };
}

export function linkOf(graph, id) {
    const links = graph?.links;
    if (!links) return null;
    return typeof links.get === "function" ? links.get(id) : links[id];
}

// Outputs before the 'prompt' output replaced moss_layout_json, ideogram_json and text_prompt: on load, links of a
// saved Region Genie node are moved to the output of the same name (those three to 'prompt').
const OLD_OUTPUT_NAMES = { moss_layout_json: "prompt", ideogram_json: "prompt", text_prompt: "prompt" };
export function remapOutputs(node, names, types) {
    const outs = node.outputs;
    if (!Array.isArray(outs) || !Array.isArray(names) || !names.length) return false;
    if (outs.length === names.length && outs.every((o, i) => o?.name === names[i])) return false;
    const graph = node.graph;
    const slots = names.map(() => null), links = names.map(() => []);
    for (const o of outs) {
        const j = names.indexOf(OLD_OUTPUT_NAMES[o?.name] ?? o?.name);
        if (j === -1) {                                     // an output that no longer exists: drop its links
            for (const id of o?.links || []) {
                const l = linkOf(graph, id);
                if (l) { try { graph.removeLink(id); } catch (e) { /* ignore */ } }
            }
            continue;
        }
        if (!slots[j]) slots[j] = o;
        for (const id of o.links || []) { const l = linkOf(graph, id); if (l) { l.origin_slot = j; links[j].push(id); } }
    }
    node.outputs = names.map((n, j) => {
        const o = slots[j] || { name: n, type: types?.[j] ?? "*", links: null };
        o.name = n; o.type = types?.[j] ?? o.type;
        if (o.label && OLD_OUTPUT_NAMES[o.label]) delete o.label;
        if ("localized_name" in o) o.localized_name = n;
        o.links = links[j].length ? links[j] : null;
        return o;
    });
    node.setDirtyCanvas?.(true, true);
    return true;
}
