// The shortcut list on a node (rounds 38 and 39): "?" over the editor or the keyboard button in the bottom bar opens
// the sheet of rg_keys.js, where every key is shown and can be changed. One part of the Region Genie node's editor
// (see parts.js).
//
// The shortcuts themselves are the table in js/rg_keys.js (COMMANDS). The editor never compares a key by hand: the
// key handler (the end of popups.js) asks keyIs(e, "<command>"), and a text that names a key gets it from the table:
//   - a tooltip written with the default key in brackets, "Undo (Ctrl+Z)": set it with E.keyTitle(el, text) (E.btn,
//     E.iconBtn and the list's ico() do), or pass the text through keyed() where the title is set again and again;
//   - a hint or a message: keyText("<command>").
// When the user changes a key, retitleKeys() rewrites all of them.
import { nodeOffCanvas } from "../rg_shared.js";
import { openShortcuts, closeShortcuts, shortcutsOpen, keyed, SHORTCUTS_EVENT } from "../rg_keys.js";

export function* keys(E) {
    Object.assign(E, { toggleKeys, closeKeys, keyTitle, retitleKeys });
    yield;

    const keysBtn = E.iconBtn("keyboard", "Shortcuts: Every key and mouse gesture of this editor on one sheet; click a key there to change it (?).", () => toggleKeys());
    keysBtn.classList.add("rg-keys-btn");
    keysBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    E.notesBtn.after(keysBtn);
    E.keysBtn = keysBtn;

    // a tooltip that names keys: the text is kept on the element, so it can be written again with the keys in use
    function keyTitle(el, text) { el.__rgTitle = text; el.title = keyed(text); return el; }
    function retitleKeys() {
        for (const el of [E.wrap, ...E.wrap.querySelectorAll("*")]) if (el.__rgTitle) { const t = keyed(el.__rgTitle); if ((el.title || el.dataset.rgTip) !== t) el.title = t; }
        E.refreshVariantButtons(); E.setSnapIcon(); E.setBigBtn?.(); E.setStartCard?.();
        E.refreshUI();                                 // the list's buttons and the hints on the canvas
    }
    const onKeys = () => { if (!E.node.graph && !E.wrap.isConnected) { window.removeEventListener(SHORTCUTS_EVENT, onKeys); return; } retitleKeys(); };
    window.addEventListener(SHORTCUTS_EVENT, onKeys);

    let timer = 0;
    function closeKeys() { if (shortcutsOpen() === E) closeShortcuts(); }
    function toggleKeys() {
        if (shortcutsOpen() === E) { closeShortcuts(); return; }
        openShortcuts({
            owner: E, rect: E.wrap.getBoundingClientRect(),
            keep: (t) => keysBtn.contains(t),              // a click on the button closes it through toggleKeys()
            ownKeys: (t) => E.wrap.contains(t),            // "?" pressed in the editor: its own key handler toggles
            onClose: () => { clearInterval(timer); keysBtn.classList.remove("on"); if (E.wrap.isConnected) E.focusSink(); },
        });
        keysBtn.classList.add("on");
        // the sheet goes with its node (another workflow tab, the node deleted)
        timer = setInterval(() => { if (!E.wrap.isConnected || nodeOffCanvas(E.node)) closeShortcuts(); }, 300);
    }
}
