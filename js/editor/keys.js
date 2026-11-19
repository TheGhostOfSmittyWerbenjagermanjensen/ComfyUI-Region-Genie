// The shortcut list (round 38): every key and mouse gesture of the editor on one sheet, opened with "?" or the
// keyboard button in the bottom bar. One part of the Region Genie node's editor (see parts.js).
//
// The list is written here by hand, next to nothing that reads keys: when a shortcut is added or changed (the key
// handler at the end of popups.js, the pointer handlers in pointer.js, a pop-up's own keys), change it here too.
// tests/ui_review_items.cjs presses every single key of the "Tools" group and checks the tool it names.
import { svgIcon, keyLabel, popKeyText, escReverts, nodeOffCanvas } from "../rg_shared.js";
import { bigKeyText } from "./big.js";

let openSheet = null;                                // one sheet at a time, on the whole page: { box, E, close }

// [keys, what]; keys: "A / B" are two keys for the same thing, "A+B" is one combination
export function shortcutGroups() {
    const big = keyLabel(bigKeyText()), prev = keyLabel(popKeyText(-1)), next = keyLabel(popKeyText(1));
    return [
        ["Tools", [
            ["V", "Select: Move, resize and rotate layers", "select"],
            ["R / O / T", "Shape: Rectangle / ellipse / triangle", "shape"],
            ["B", "Brush", "brush"],
            ["E", "Eraser", "erase"],
            ["L", "Lasso", "lasso"],
            ["Shift+L", "Lasso erase", "lassoErase"],
            ["F", "Fill", "fill"],
            ["W", "Magic wand", "wand"],
            ["Q", "Select object", "object"],
            ["[ / ]", "Brush size, smaller / larger (also Alt+wheel)"],
        ]],
        ["While drawing", [
            ["Shift", "Equal sides; a straight brush line from the last stroke; 15° steps when rotating"],
            ["Alt", "Draw or resize from the centre"],
            ["Alt+click", "Make the region under the pointer the active one"],
            ["Enter / Double-click", "Close the lasso outline"],
            ["Enter", "Select object: Add the selection (Shift+Enter: one region for each object found)"],
            ["Ctrl+click", "Select object: A point that isn't part of the object"],
            ["Backspace", "Take back the last point"],
            ["Esc", "Cancel the outline or the selection"],
        ]],
        ["Layers and regions", [
            ["Ctrl+Z", "Undo"],
            ["Ctrl+Shift+Z / Ctrl+Y", "Redo"],
            ["Ctrl+D", "Duplicate the selected layer"],
            ["Ctrl+C / Ctrl+X / Ctrl+V", "Copy / cut / paste a layer (also into another Region Genie node)"],
            ["Del / Backspace", "Delete the selected layer"],
            ["Arrows", "Move the selected layer (Shift: ×10)"],
            ["Esc", "Deselect"],
            ["Right-click", "On the canvas: a menu for the region under the pointer"],
            ["Double-click", "A label on the canvas: edit that region in the pop-up editor"],
        ]],
        ["View", [
            ["Wheel", "Zoom the canvas"],
            ["Space+drag / Middle-drag", "Pan the canvas"],
            ["Home", "Fit the image in view"],
            ["G", "Snap to grid on / off"],
            ...(big ? [[big, "Large editor: Open / close (Settings > Region Genie > Region Genie node)"]] : []),
            ["?", "This list"],
        ]],
        ["Text", [
            ["Enter", "A region's prompt: done (Shift+Enter: a new line)"],
            ...(prev && next ? [[`${prev} / ${next}`, "Pop-up editor: the previous / next text field (Settings > Region Genie > Text size)"]] : []),
            ["Esc", `Pop-up editor: close, ${escReverts() ? "putting the text back" : "keeping the edits"} (Settings > Region Genie > Text size)`],
        ]],
    ];
}

export function* keys(E) {
    Object.assign(E, { toggleKeys, closeKeys });
    yield;

    const keysBtn = E.iconBtn("keyboard", "Shortcuts: Every key and mouse gesture of this editor on one sheet (?).", () => toggleKeys());
    keysBtn.classList.add("rg-keys-btn");
    keysBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    E.notesBtn.after(keysBtn);
    E.keysBtn = keysBtn;

    function closeKeys() { if (openSheet?.E === E) openSheet.close(); }
    function toggleKeys() {
        if (openSheet) { const mine = openSheet.E === E; openSheet.close(); if (mine) return; }
        const box = E.el("div", "rg-keys"); box.tabIndex = -1;
        const head = E.el("div", "rg-keys-head"), title = E.el("b"); title.textContent = "Shortcuts";
        const x = E.el("button", "rg-btn rg-x"); x.type = "button"; x.innerHTML = svgIcon("close"); x.title = "Close (Esc)";
        head.append(title, x);
        const body = E.el("div", "rg-keys-body");
        for (const [name, rows] of shortcutGroups()) {
            const sec = E.el("section"), h = E.el("h4"); h.textContent = name; sec.append(h);
            for (const [k, what] of rows) {
                const row = E.el("div", "rg-keys-row"), kc = E.el("span", "rg-keys-k"), wc = E.el("span");
                k.split(" / ").forEach((combo) => { const kbd = document.createElement("kbd"); kbd.textContent = combo; kc.append(kbd); });
                wc.textContent = what; row.append(kc, wc); sec.append(row);
            }
            body.append(sec);
        }
        box.append(head, body);
        document.body.appendChild(box);
        // over the editor (the node, or the large window), inside the page
        const r = E.wrap.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
        box.style.left = Math.round(Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))) + "px";
        box.style.top = Math.round(Math.max(8, Math.min(Math.max(r.top, 0) + 40, window.innerHeight - h - 8))) + "px";
        const stop = (e) => e.stopPropagation();
        for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu"]) box.addEventListener(ev, stop);
        box.dataset.captureWheel = "true";
        const outside = (e) => { if (!box.contains(e.target) && !keysBtn.contains(e.target)) close(); };
        const key = (e) => {
            if (e.key !== "Escape" && e.key !== "?") return;
            const t = e.target;
            if (e.key === "?" && (t?.tagName === "TEXTAREA" || t?.tagName === "INPUT" || t?.isContentEditable)) return;      // typed into a field
            if (e.key === "?" && E.wrap.contains(t)) return;                    // the editor's own handler closes it
            e.preventDefault(); e.stopPropagation(); close();
        };
        const timer = setInterval(() => { if (!E.wrap.isConnected || nodeOffCanvas(E.node)) close(); }, 300);
        function close() {
            clearInterval(timer);
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", key, true);
            box.remove(); openSheet = null;
            keysBtn.classList.remove("on");
            if (E.wrap.isConnected) E.focusSink();
        }
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", key, true);
        x.addEventListener("click", (e) => { e.preventDefault(); close(); });
        openSheet = { box, E, close };
        keysBtn.classList.add("on");
        box.focus({ preventScroll: true });
    }
}
