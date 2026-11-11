window.__settings = window.__settings || {};
window.__exts = [];
window.LiteGraph = { ContextMenu: class { constructor(items, opts) { window.__lastMenu = { items, opts }; } } };
export const app = {
  registerExtension(e) { window.__exts.push(e); },
  extensionManager: { setting: { get: (id) => window.__settings[id], set: async (id, v) => { window.__settings[id] = v; } }, toast: { add() {} } },
  canvas: { ds: { scale: 1 } }, graph: { change() {} }, ui: {},
};
