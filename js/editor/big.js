// The large editor (round 36): the same editor in a window over ComfyUI, for a big canvas and a long region list.
// One part of the Region Genie node's editor (see parts.js for how the parts work together).
//
// Nothing is copied: the editor's own element (E.wrap) is moved from the node into the window and back, so every
// tool, pop-up and shortcut is the one the node has. ComfyUI positions a wrapper around the element, never the
// element itself (legacy nodes: div.dom-widget; Nodes 2.0: the widget's cell), so a placeholder keeps its place.
// Layout (the owner's choice, B): the tools in their row and the canvas on the left; on the right the size row,
// the scene prompts, the region list and the bottom bar. The size row is the node's own (moved too). The scene
// prompts are ComfyUI's fields and stay on the node; the window shows text boxes kept in step with them.
import { getSetting, SET, keyHit, keyLabel, nodeOffCanvas, autocompleteOnFocus } from "../rg_shared.js";
import { chain } from "./graph.js";

let current = null;                                  // the editor that is open large: one at a time, on the whole page

export const bigKeyText = () => String(getSetting(SET.bigKey, "Alt+Enter") ?? "");

export function* big(E) {
    Object.assign(E, {
        openBig, closeBig, toggleBig, syncBig, setBigBtn,
    });
    yield;

    E.big = null;                                    // while open: { ov, win, side, hole, sizeHole, fields, timer }
    const bigBtn = E.iconBtn("expand", "", () => toggleBig(), "toggle"); E.bigBtn = bigBtn;
    E.dimsLbl.before(bigBtn);
    function setBigBtn() {
        const k = keyLabel(bigKeyText());
        bigBtn.classList.toggle("on", !!E.big);
        bigBtn.title = (E.big ? "Large editor: ON. Click to put the editor back in the node."
            : "Large editor: Open this editor in a large window over ComfyUI, with the canvas on the left and the size, the scene prompts and the region list on the right.")
            + "\nClose: This button again, ✕ in the window's corner, or Esc with nothing selected."
            + (k ? `\nShortcut: Pressed while the pointer is over the editor; change it in the shortcut list (${k}).` : "");
    }
    setBigBtn();

    const SCENE = [["positive", () => E.sceneW, "scene_prompt_positive: the whole picture: setting, style, lighting ..."],
                   ["negative", () => E.sceneNegW, "scene_prompt_negative: what to avoid in the whole picture"],
                   ["background", () => E.sceneBgW, "scene_prompt_background: behind the regions: ground, floor, sky, room ... (Ideogram 4)"]];
    function sceneBox() {
        const box = E.el("div", "rg-big-scene"), fields = [];
        for (const [which, w, placeholder] of SCENE) {
            if (!w()) continue;
            const ta = E.el("textarea", "rg-big-ta"); ta.rows = which === "positive" ? 4 : 2; ta.spellcheck = false;
            ta.placeholder = placeholder; ta.dataset.scene = which; ta.value = String(w().value ?? "");
            ta.title = "The node's own " + w().name + " field: What you type here is typed there.";
            ta.addEventListener("input", () => E.setWidget(w(), ta.value));
            // Esc leaves the box (the keys are the editor's again); every other key is text
            ta.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); ta.blur(); E.focusSink(); } });
            fields.push({ which, w, ta });
            box.appendChild(ta);
        }
        return { box, fields };
    }
    // the text boxes follow the node's fields (a trigger word added, the LLM's text taken over, an import)
    function syncBig() {
        if (!E.big) return;
        for (const f of E.big.fields) {
            const v = String(f.w()?.value ?? "");
            if (document.activeElement !== f.ta && f.ta.value !== v) f.ta.value = v;
            const show = f.which !== "background" || E.sceneBgW?.__rgShown !== false ? "" : "none";
            if (f.ta.style.display !== show) f.ta.style.display = show;
        }
        const t = E.node.title || "Region Genie";
        if (E.big.title.textContent !== t) E.big.title.textContent = t;
    }
    function openBig() {
        if (E.big || !E.wrap.isConnected) return;
        current?.closeBig();
        E.closeArrange?.();
        const ov = E.el("div", "rg-big"), win = E.el("div", "rg-big-win"), head = E.el("div", "rg-big-head");
        const title = E.el("span", "rg-big-title");
        const x = E.btn("@close", "Put the editor back in the node (Esc with nothing selected does it too)", () => closeBig());
        head.append(title, x);
        const hole = E.el("div", "rg-big-hole"), sizeHole = E.el("div", "rg-big-hole small");
        hole.textContent = "This node's editor is open in the large window. ";
        const back = E.btn("Bring it back", "Close the large window and show the editor here again", () => closeBig());
        for (const ev of ["pointerdown", "mousedown"]) back.addEventListener(ev, (e) => e.stopPropagation());
        hole.appendChild(back);
        const { box, fields } = sceneBox();
        const side = E.el("div", "rg-big-side");
        E.wrap.replaceWith(hole);
        if (E.sizeEl?.isConnected) E.sizeEl.replaceWith(sizeHole);
        side.append(...(E.sizeEl ? [E.sizeEl] : []), box, E.tree, E.foot);
        E.wrap.appendChild(side);
        E.wrap.classList.add("rg-bigmode");
        win.append(head, E.wrap);
        ov.appendChild(win);
        document.body.appendChild(ov);
        // tag autocomplete and the wildcard list, once the boxes are on the page
        for (const f of fields) { try { autocompleteOnFocus(f.ta, E.node); } catch (e) { /* no autocomplete pack */ } }
        E.big = { ov, win, side, hole, sizeHole, fields, title, timer: 0 };
        current = E;
        // the node left the screen (another workflow tab, a subgraph, removed), or ComfyUI took the element back:
        // close, so the editor is never stranded in a window
        E.big.timer = setInterval(() => {
            if (!E.big) return;
            if (!E.node.graph || nodeOffCanvas(E.node) || E.wrap.parentElement !== win) closeBig();
            else syncBig();
        }, 300);
        syncBig(); setBigBtn();
        E.userView = false; E.fitView(); E.refreshUI(); E.focusSink();
    }
    function closeBig() {
        const b = E.big;
        if (!b) return;
        E.big = null;
        if (current === E) current = null;
        clearInterval(b.timer);
        E.closeArrange?.();
        E.wrap.classList.remove("rg-bigmode");
        // the node's own order again (as canvasUi.js builds it)
        E.wrap.append(E.keySink, E.bar1, E.banner, E.cvBox, E.msgBar, E.split, E.tree, E.foot);
        b.side.remove();
        if (E.sizeEl) { if (b.sizeHole.isConnected) b.sizeHole.replaceWith(E.sizeEl); else if (E.sizeEl.parentElement === b.side) E.sizeEl.remove(); }
        // back to where it was; when ComfyUI already took it back (or the node is gone) only the window goes
        if (b.hole.isConnected && E.wrap.parentElement === b.win) b.hole.replaceWith(E.wrap); else b.hole.remove();
        b.ov.remove();
        setBigBtn();
        E.applyListH?.();
        E.userView = false;
        if (E.wrap.isConnected) { E.fitView(); E.refreshUI(); E.focusSink(); }
    }
    function toggleBig() { if (E.big) closeBig(); else openBig(); }

    // the key (Settings > Region Genie > Region Genie node > Large editor: key), while the pointer is over the editor
    // or a field of it has the focus; before the editor's own keys
    E.wrap.addEventListener("keydown", (e) => {
        if (!keyHit(e, bigKeyText())) return;
        e.preventDefault(); e.stopPropagation();
        toggleBig();
    }, true);
    chain(E.node, "onRemoved", function () { closeBig(); });
}
