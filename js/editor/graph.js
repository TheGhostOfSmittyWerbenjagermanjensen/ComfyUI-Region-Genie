// Graph helpers: chaining node callbacks, links, moving a saved node's links to the outputs of the same name.

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

// On load, links of a saved Region Genie node are moved to the output of the same name (outputs added or reordered
// since the workflow was saved); links of an output that no longer exists are dropped.
export function remapOutputs(node, names, types) {
    const outs = node.outputs;
    if (!Array.isArray(outs) || !Array.isArray(names) || !names.length) return false;
    if (outs.length === names.length && outs.every((o, i) => o?.name === names[i])) return false;
    const graph = node.graph;
    const slots = names.map(() => null), links = names.map(() => []);
    for (const o of outs) {
        const j = names.indexOf(o?.name);
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
        if ("localized_name" in o) o.localized_name = n;
        o.links = links[j].length ? links[j] : null;
        return o;
    });
    node.setDirtyCanvas?.(true, true);
    return true;
}
