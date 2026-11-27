// Browser checks of round 38: the pack's own tooltip, the shortcut sheet, the canvas's right-click menu, the drawn
// icons on buttons.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1100 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.addInitScript(() => { window.__rgTakeTitles = true; });        // the real thing: a title is put aside while the pointer is on it
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__settingsExt.setup());
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__node.__rgState())));
    const toClient = (x, y) => page.evaluate(([x, y]) => window.__node.__rgToClient(x, y), [x, y]);
    const tip = () => page.evaluate(() => { const t = document.querySelector(".rg-tip.on"); return t ? { text: t.innerText, keys: [...t.querySelectorAll("kbd")].map((k) => k.textContent), bold: [...t.querySelectorAll("b")].map((b) => b.textContent),
        lines: t.children.length, r: (() => { const r = t.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })() } : null; });
    const away = async () => { await page.mouse.move(860, 1080); await page.waitForTimeout(80); };
    const center = async (loc) => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2, b]; };

    // what the browser's own tooltip would show at a point: the title of the nearest element around it that has the
    // attribute ("" = nothing; an empty title also switches off the titles further out)
    const nativeTip = (x, y) => page.evaluate(([x, y]) => { for (let e = document.elementFromPoint(x, y); e; e = e.parentElement) if (e.hasAttribute("title")) return e.getAttribute("title"); return ""; }, [x, y]);
    // ---- the pack's own tooltip
    const undo = page.locator('.rg-bar [title^="Undo"]');
    const [ux, uy, ub] = await center(undo);
    await away();
    await page.mouse.move(ux, uy); await page.waitForTimeout(150);
    check("pointing at a button: nothing at once, and the browser's own tooltip has nothing to show (the title is put aside, the attribute empty)",
        !(await tip()) && await nativeTip(ux, uy) === "" && await page.evaluate(([x, y]) => { const b = document.elementFromPoint(x, y).closest("button"); return b.getAttribute("title") === "" && /^Undo/.test(b.dataset.rgTip); }, [ux, uy]));
    check("…while code that reads the button's title still gets the text", await page.evaluate(([x, y]) => /^Undo/.test(document.elementFromPoint(x, y).closest("button").title), [ux, uy]));
    await page.waitForTimeout(600);
    let t = await tip();
    check(`after a moment the pack's tooltip shows the text, with the shortcut as a key (${JSON.stringify(t?.text)})`, !!t && /^Undo/.test(t.text) && t.keys.join() === "Ctrl+Z" && !/\(Ctrl\+Z\)/.test(t.text));
    check("it sits right under the button, inside the window", !!t && t.r[1] >= ub.y + ub.height && t.r[1] < ub.y + ub.height + 14 && t.r[0] >= 0 && t.r[2] <= 900 && Math.abs((t.r[0] + t.r[2]) / 2 - ux) < 30);
    // the next button: at once (no second wait)
    const [rx, ry] = await center(page.locator('.rg-bar [title^="Redo"]'));
    await page.mouse.move(rx, ry); await page.waitForTimeout(180);
    t = await tip();
    check("moving to the next button shows its tooltip at once, two keys as two keys", !!t && /^Redo/.test(t.text) && t.keys.join("|") === "Ctrl+Shift+Z|Ctrl+Y");
    check("the button left behind has its title again", await undo.count() === 1);
    await page.mouse.down(); await page.waitForTimeout(60);
    check("a press hides it, and the browser's tooltip still has nothing to show", !(await tip()) && await nativeTip(rx, ry) === ""
        && await page.evaluate(([x, y]) => /^Redo/.test(document.elementFromPoint(x, y).closest("button").title), [rx, ry]));
    await page.mouse.up(); await page.mouse.move(rx + 2, ry + 1); await page.waitForTimeout(700);
    check("…and it stays away until the pointer has left and come back (no browser tooltip either)", !(await tip()) && await page.locator('.rg-bar [title^="Redo"]').count() === 0);
    await away();
    check("away from the editor: no tooltip, every title back", !(await tip()) && await page.locator('.rg-bar [title^="Redo"]').count() === 1 && await page.locator("[data-rg-tip]").count() === 0);
    // several lines: one item per line, the names in bold
    await page.evaluate(() => window.__node.__rgSetTool("shape"));
    const [bx, by, bb] = await page.evaluate(() => { const c = document.querySelector(".rg-cv canvas").getBoundingClientRect(); return [c.x, c.y, c.width]; });
    await page.mouse.move(bx + 60, by + 60); await page.mouse.down(); await page.mouse.move(bx + 160, by + 150, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
    const grip = page.locator(".rg-row.region .rg-grip").first();
    const [gx, gy] = await center(grip);
    await away(); await page.mouse.move(gx, gy); await page.waitForTimeout(650);
    t = await tip();
    check(`a tooltip of two items: two lines, each name in bold (${JSON.stringify(t?.bold)})`, !!t && t.lines === 2 && t.bold.join("|") === "Click:|Drag:");
    await page.keyboard.press("Shift"); await page.waitForTimeout(60);
    check("a key press hides it", !(await tip()));
    // a title that changes under the pointer (the snap button): the tooltip follows, the browser's stays away
    await away();
    const snap = page.locator('.rg-bar [title*="(G)"]').first();
    if (await snap.count()) {
        const [sx, sy] = await center(snap);
        await page.mouse.move(sx, sy); await page.waitForTimeout(650);
        const before = (await tip())?.text;
        await page.evaluate(([x, y]) => { const b = document.elementFromPoint(x, y).closest("button"); b.title = "Changed while pointed at (G)"; }, [sx, sy]);
        await page.waitForTimeout(80);
        t = await tip();
        check("a title set while the pointer is on the button: the tooltip shows the new text", !!before && !!t && /^Changed while pointed at/.test(t.text) && t.keys.join() === "G"
            && await nativeTip(sx, sy) === "");
        // round 42: the editor sets many titles again on every refresh, often to the same text, and some as an attribute:
        // neither may bring the browser's tooltip back next to the pack's
        await page.evaluate(([x, y]) => { const b = document.elementFromPoint(x, y).closest("button"); b.title = b.title; b.setAttribute("title", "Set as an attribute (G)"); }, [sx, sy]);
        await page.waitForTimeout(80);
        t = await tip();
        check(`a title set again, or set as an attribute, while pointed at: still nothing for the browser to show (${JSON.stringify(await nativeTip(sx, sy))})`,
            await nativeTip(sx, sy) === "" && !!t && /^Set as an attribute/.test(t.text));
        await away();
        check("…and the last text is the button's title once the pointer has left", await page.locator('.rg-bar [title^="Set as an attribute"]').count() === 1);
    } else check("a button with (G) in its tooltip exists", false);
    await away();
    // a large element (a prompt box): the tooltip goes next to the pointer
    const ta = page.locator(".rg-list textarea.rg-prompt").first();
    if (await ta.count() && await ta.getAttribute("title")) {
        const [tx, ty] = await center(ta);
        await page.mouse.move(tx, ty); await page.waitForTimeout(650);
        t = await tip();
        check("a text box's tooltip opens next to the pointer", !!t && Math.abs(t.r[0] - tx) < 60 && Math.abs(t.r[1] - ty) < 60);
        await away();
    }
    // ---- the shortcut list: every key, and changing them
    const sheet = () => page.evaluate(() => { const b = document.querySelector(".rg-keys"); if (!b) return null; const r = b.getBoundingClientRect();
        const row = (x) => ({ id: x.dataset.cmd || null, keys: [...x.querySelectorAll(".rg-key, kbd")].map((k) => k.textContent), fixed: !x.dataset.cmd, changed: x.classList.contains("changed"), what: x.lastChild.textContent });
        return { groups: [...b.querySelectorAll("h4")].map((h) => h.textContent), rows: [...b.querySelectorAll(".rg-keys-row")].map(row), in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
            onPage: b.parentElement === document.body, note: b.querySelector(".rg-keys-note").textContent, how: b.querySelector(".rg-keys-how").textContent, resetOff: b.querySelector(".rg-keys-head button").disabled }; });
    const rowOf = (sh, id) => sh.rows.find((r) => r.id === id);
    const chip = (id, slot = 0) => page.locator(`.rg-keys-row[data-cmd="${id}"] .rg-key[data-slot="${slot}"]`);
    const rebind = async (id, press, slot = 0) => { await chip(id, slot).click(); await page.waitForTimeout(60); await page.keyboard.press(press); await page.waitForTimeout(120); };
    const saved = () => page.evaluate(() => JSON.parse(window.__settings["RegionGenie.Shortcuts"] || "{}"));
    const toolNow = () => page.evaluate(() => window.__node.__rgTool());
    const kb = page.locator(".rg-keys-btn");
    check("a keyboard button in the bottom bar, its tooltip names the key", await kb.count() === 1 && /\(\?\)/.test(await kb.getAttribute("title")));
    await kb.click(); await page.waitForTimeout(120);
    let sh = await sheet();
    check(`the button opens the shortcut list on the page, inside the window (${sh?.groups.join(", ")}; ${sh?.rows.length} rows)`, !!sh && sh.onPage && sh.in && sh.groups.join("|") === "Tools|While drawing|Layers and regions|View|Text|Image Compare node" && sh.rows.length > 40);
    check("keys that can be changed are buttons; mouse gestures and held keys are listed but fixed", !!sh && sh.rows.filter((r) => !r.fixed).length === 45 && sh.rows.filter((r) => r.fixed).length >= 11
        && rowOf(sh, "edit.redo").keys.join("|") === "Ctrl+Shift+Z|Ctrl+Y" && sh.rows.some((r) => r.fixed && r.keys[0] === "Ctrl+Click" && /Take a spot out of the selection/.test(r.what)));
    check("nothing changed yet: 'Reset all' is greyed", !!sh && sh.resetOff && !sh.rows.some((r) => r.changed));
    check("the button is lit while the list is open", await kb.evaluate((b) => b.classList.contains("on")));
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    check("Esc closes it", !(await sheet()) && !(await kb.evaluate((b) => b.classList.contains("on"))));
    // "?" over the editor opens it, "?" again closes it
    const [cx0, cy0] = await page.evaluate(() => { const c = document.querySelector(".rg-cv canvas").getBoundingClientRect(); return [c.x + 20, c.y + 20]; });
    await away(); await page.evaluate(() => document.activeElement?.blur?.());
    await page.mouse.move(cx0, cy0); await page.keyboard.press("?"); await page.waitForTimeout(120);
    sh = await sheet();
    check("? while pointing at the editor opens it", !!sh);
    await page.keyboard.press("?"); await page.waitForTimeout(80);
    check("? again closes it", !(await sheet()));
    await page.mouse.move(cx0, cy0); await page.keyboard.press("?"); await page.waitForTimeout(100);
    await page.mouse.click(880, 1090); await page.waitForTimeout(80);
    check("a click outside closes it", !(await sheet()));
    // every key the list names for a tool picks that tool
    const wantTool = { "tool.select": "select", "tool.rect": "shape", "tool.ellipse": "shape", "tool.triangle": "shape", "tool.brush": "brush", "tool.erase": "erase", "tool.lasso": "lasso",
        "tool.lassoErase": "lassoErase", "tool.fill": "fill", "tool.wand": "wand", "tool.object": "object" };
    const wrong = [];
    for (const [id, want] of Object.entries(wantTool)) {
        const k = rowOf(sh, id)?.keys[0];
        await page.evaluate(() => window.__node.__rgSetTool(window.__node.__rgTool() === "select" ? "brush" : "select"));
        await page.mouse.move(cx0, cy0); await page.keyboard.press(k); await page.waitForTimeout(40);
        if (await toolNow() !== want) wrong.push(`${k}: ${await toolNow()}`);
        if (id === "tool.object") { await page.keyboard.press("Escape"); }
    }
    check(`each tool key in the list picks its tool (${wrong.join(", ")})`, !wrong.length);
    await page.evaluate(() => window.__node.__rgSetTool("brush"));
    // ---- changing a key
    await kb.click(); await page.waitForTimeout(120);
    await chip("tool.select").click(); await page.waitForTimeout(80);
    sh = await sheet();
    check("click a key: it waits for the new one", rowOf(sh, "tool.select").keys[0] === "Press a key…" && /Press the new key/.test(sh.how));
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    sh = await sheet();
    check("Esc then leaves the key as it is, and the list stays open", !!sh && rowOf(sh, "tool.select").keys.join() === "V");
    await rebind("tool.select", "k");
    sh = await sheet();
    check("click, then K: Select's key is K, marked as changed, and saved", rowOf(sh, "tool.select").keys.join() === "K" && rowOf(sh, "tool.select").changed && !sh.resetOff && JSON.stringify(await saved()) === '{"tool.select":["K"]}');
    check("the tool was not switched by the key press itself", await toolNow() === "brush");
    check("the Select button's tooltip names the new key at once", /layers \(K\)\./.test(await page.locator(".rg-bar .rg-btn").first().getAttribute("title")));
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    await page.mouse.move(cx0, cy0); await page.keyboard.press("v"); await page.waitForTimeout(40);
    const afterV = await toolNow();
    await page.keyboard.press("k"); await page.waitForTimeout(40);
    check("on the canvas: V does nothing now, K picks Select", afterV === "brush" && await toolNow() === "select");
    check("the hints on the canvas use the keys in use too (Home for Fit)", /Home Fit/.test(await page.evaluate(() => document.querySelector(".rg-tips").textContent)));
    // a key that another command has: it is taken from that one, and the list says so
    await kb.click(); await page.waitForTimeout(120);
    await rebind("tool.brush", "k");
    sh = await sheet();
    check(`a key in use is taken from the other command, with a note (${sh.note})`, rowOf(sh, "tool.brush").keys.join() === "K" && rowOf(sh, "tool.select").keys.join() === "no key" && /K was the key of “Select/.test(sh.note) && /no key now/.test(sh.note));
    // a second key, a combination, a key with its own Setting
    await page.locator('.rg-keys-row[data-cmd="tool.brush"] .rg-key-act[data-act="plus"]').click(); await page.waitForTimeout(60);
    await page.keyboard.press("j"); await page.waitForTimeout(120);
    await rebind("edit.undo", "Control+u");
    await rebind("view.fit", "Shift+F2");
    await rebind("view.big", "F9");
    sh = await sheet();
    check("a second key (B, then K and J), a combination (Ctrl+U), Shift+F2, and the large editor's key (F9)", rowOf(sh, "tool.brush").keys.join("|") === "K|J" && rowOf(sh, "edit.undo").keys.join() === "Ctrl+U"
        && rowOf(sh, "view.fit").keys.join() === "Shift+F2" && rowOf(sh, "view.big").keys.join() === "F9" && await page.evaluate(() => window.__settings["RegionGenie.Main.LargeEditorKey"]) === "F9");
    check("only the changed commands are saved", Object.keys(await saved()).sort().join() === "edit.undo,tool.brush,tool.select,view.fit");
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    await page.evaluate(() => window.__node.__rgSetTool("select"));
    await page.mouse.move(cx0, cy0); await page.keyboard.press("j"); await page.waitForTimeout(40);
    const viaP = await toolNow();
    const n0 = (await st()).regions.length;
    await page.locator('[title^="Add a region with a new color"]').click(); await page.waitForTimeout(120); await page.evaluate(() => document.activeElement?.blur?.());
    await page.mouse.move(cx0, cy0); await page.keyboard.press("Control+z"); await page.waitForTimeout(80);
    const afterCtrlZ = (await st()).regions.length;
    await page.keyboard.press("Control+u"); await page.waitForTimeout(80);
    check("P picks the brush; Ctrl+Z no longer undoes, Ctrl+U does", viaP === "brush" && afterCtrlZ === n0 + 1 && (await st()).regions.length === n0);
    check("tooltips and the menu follow: Undo (Ctrl+U), Fit (Shift+F2)", /^Undo: .*\(Ctrl\+U\)\.$/.test(await page.locator('.rg-bar [title^="Undo"]').getAttribute("title"))
        && /\(Shift\+F2\)/.test(await page.locator('.rg-bar [title^="Fit the image"]').getAttribute("title")));
    await page.keyboard.press("F9"); await page.waitForTimeout(300);
    const bigOpen = await page.locator(".rg-big").count();
    await page.keyboard.press("F9"); await page.waitForTimeout(300);
    check("F9 opens and closes the large editor", bigOpen === 1 && await page.locator(".rg-big").count() === 0);
    // reset one, reset all
    await kb.click(); await page.waitForTimeout(120);
    await page.locator('.rg-keys-row[data-cmd="edit.undo"] .rg-key-act[data-act="reset"]').click(); await page.waitForTimeout(120);
    sh = await sheet();
    check("the arrow on a changed row puts its default back (Ctrl+Z)", rowOf(sh, "edit.undo").keys.join() === "Ctrl+Z" && !rowOf(sh, "edit.undo").changed && !("edit.undo" in await saved()));
    // remove a key: the row shows 'no key'
    await chip("view.snap").click(); await page.waitForTimeout(60);
    await page.locator('.rg-keys-row[data-cmd="view.snap"] .rg-key-act[data-act="close"]').click(); await page.waitForTimeout(120);
    sh = await sheet();
    check("a key can be removed: Snap has no key, and its tooltip no brackets", rowOf(sh, "view.snap").keys.join() === "no key" && !/\(G\)/.test(await page.locator('.rg-bar [title^="Snap to grid"]').getAttribute("title")));
    await page.locator(".rg-keys-head button", { hasText: "Reset all" }).click(); await page.waitForTimeout(150);
    sh = await sheet();
    check("Reset all: every key is the default again, nothing saved", !sh.rows.some((r) => r.changed) && sh.resetOff && rowOf(sh, "tool.select").keys.join() === "V" && rowOf(sh, "view.big").keys.join() === "Alt+Enter"
        && JSON.stringify(await saved()) === "{}" && await page.evaluate(() => window.__settings["RegionGenie.Main.LargeEditorKey"]) === "Alt+Enter");
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    // Settings: one row with a button, in place of a row per key
    const setRow = await page.evaluate(async () => { const all = window.__settingsExt.settings, s = all.find((x) => x.id === "RegionGenie.Shortcuts");
        const el = typeof s?.type === "function" ? s.type() : null; if (el) document.body.appendChild(el);
        await new Promise((r) => setTimeout(r, 300));          // the count is filled in once the shortcut file is loaded
        return { name: s?.name, cat: s?.category?.slice(0, 2).join(" > "), btn: el?.querySelector("button")?.textContent, info: el?.querySelector("span")?.textContent,
            oldRows: ["RegionGenie.Main.LargeEditorKey", "RegionGenie.Popup.PrevKey", "RegionGenie.Popup.NextKey"].map((id) => all.find((x) => x.id === id)?.type).join() }; });
    check(`Settings > Region Genie has one 'Shortcuts' row with an Edit… button (${setRow.info}); the three key rows are gone`, setRow.name === "Shortcuts" && setRow.cat === "Region Genie > Basics"
        && setRow.btn === "Edit…" && setRow.info === "All default" && setRow.oldRows === "hidden,hidden,hidden");
    await page.locator(".rg-keys-set button").click(); await page.waitForTimeout(150);
    sh = await sheet();
    check("its button opens the same list, in the middle of the page", !!sh && sh.in && sh.rows.length > 40);
    await rebind("tool.wand", "m");
    check("a change made there shows on the row ('1 changed') and works on the node", await page.locator(".rg-keys-set span").textContent() === "1 changed");
    await page.locator(".rg-keys-head button", { hasText: "Reset all" }).click(); await page.waitForTimeout(120);
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    await page.evaluate(() => { document.querySelector(".rg-keys-set")?.remove(); window.__node.__rgSetTool("select"); window.scrollTo(0, 0); });
    await page.waitForTimeout(150);

    // ---- the canvas's right-click menu
    const menu = () => page.evaluate(() => { const m = document.querySelector(".rg-menu"); if (!m) return null; const r = m.getBoundingClientRect();
        return { head: [...m.querySelectorAll(".rg-menu-head")].map((h) => h.textContent), items: [...m.querySelectorAll(".rg-menu-item")].map((i) => i.querySelector(".rg-menu-label").textContent),
            off: [...m.querySelectorAll(".rg-menu-item.off")].map((i) => i.querySelector(".rg-menu-label").textContent), keys: [...m.querySelectorAll(".rg-menu-key")].map((k) => k.textContent),
            ticks: [...m.querySelectorAll('.rg-menu-item[aria-checked="true"]')].map((i) => i.querySelector(".rg-menu-label").textContent), at: [r.left, r.top], in: r.right <= innerWidth && r.bottom <= innerHeight, onPage: m.parentElement === document.body }; });
    const item = (label) => page.locator(".rg-menu-item", { hasText: label }).first();
    // a second region overlapping the first (the first was drawn at 60..160 x 60..150 from the canvas's corner)
    await page.locator('[title^="Add a region with a new color"]').click(); await page.waitForTimeout(120);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.mouse.move(bx + 120, by + 110); await page.mouse.down(); await page.mouse.move(bx + 230, by + 200, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
    await page.evaluate(() => window.__node.__rgSetTool("select"));
    let s0 = await st();
    const [ridA, ridB] = [s0.regions[1].id, s0.regions[0].id];           // B was added last: it is on top (first in the list)
    check("two regions to test with, the newer one in front", s0.regions.length === 2 && s0.layers.length === 2);
    // empty canvas
    await page.mouse.click(bx + 30, by + 30, { button: "right" }); await page.waitForTimeout(120);
    let m = await menu();
    check(`right-click on empty canvas: the canvas menu, at the pointer, on the page (${m?.items.join(" | ")})`, !!m && m.onPage && m.in && Math.abs(m.at[0] - (bx + 30)) < 3 && Math.abs(m.at[1] - (by + 30)) < 3
        && ["Add a region", "Paste layer", "Fit the image in view", "Labels on the canvas", "Snap to grid", "Large editor", "Shortcuts"].every((x) => m.items.includes(x)));
    check("nothing copied yet: Paste is greyed; Labels is ticked; keys at the right end", !!m && m.off.join() === "Paste layer" && m.ticks.includes("Labels on the canvas") && ["Ctrl+V", "Home", "G", "?"].every((k) => m.keys.includes(k)));
    await item("Labels on the canvas").click(); await page.waitForTimeout(100);
    check("Labels on the canvas: the menu closes and the labels go", !(await menu()) && await page.evaluate(() => window.__node.properties.rg_labels === false));
    await page.mouse.click(bx + 30, by + 30, { button: "right" }); await page.waitForTimeout(100);
    check("…the menu shows it unticked now", !(await menu()).ticks.includes("Labels on the canvas"));
    await item("Labels on the canvas").click(); await page.waitForTimeout(80);
    await page.mouse.click(bx + 30, by + 30, { button: "right" }); await page.waitForTimeout(100);
    await page.keyboard.press("Escape"); await page.waitForTimeout(60);
    check("Esc closes the menu", !(await menu()));
    await page.mouse.click(bx + 30, by + 30, { button: "right" }); await page.waitForTimeout(100);
    await page.mouse.click(bx + 520, by + 30); await page.waitForTimeout(80);
    check("a click elsewhere closes it", !(await menu()));
    // on a region (where only the first one is)
    await page.mouse.click(bx + 80, by + 80, { button: "right" }); await page.waitForTimeout(120);
    m = await menu();
    check(`right-click on a region: its menu, the region named at the top (${m?.head.join(" / ")}; ${m?.items.join(" | ")})`, !!m && m.head.length === 1 && /\(no prompt\)/.test(m.head[0])
        && ["Edit prompt…", "Hide region", "Move up (in front)", "Move down (behind)", "Duplicate this layer", "Delete this layer", "Delete region"].every((x) => m.items.includes(x)));
    check("…it is the active region now, its layer selected", await page.evaluate(() => window.__node.__rgActive()) === ridA && await page.locator(".rg-row.region.active, .rg-row.region.cur").count() >= 0);
    check("the last region in the list can't move down", !!m && m.off.join() === "Move down (behind)");
    await item("Move up (in front)").click(); await page.waitForTimeout(120);
    s0 = await st();
    check("Move up: the region is first in the list now", s0.regions[0].id === ridA);
    await page.keyboard.press("Control+z"); await page.waitForTimeout(120);
    check("one undo step takes it back", (await st()).regions[0].id === ridB);
    // where both overlap: the top one, the other listed
    await page.mouse.click(bx + 140, by + 130, { button: "right" }); await page.waitForTimeout(120);
    m = await menu();
    check(`where two regions overlap: the one in front, the other under "Also here" (${m?.head.join(" / ")})`, !!m && m.head.length === 2 && m.head[1] === "Also here"
        && await page.evaluate(() => window.__node.__rgActive()) === ridB && m.items.filter((x) => /\(no prompt\)/.test(x)).length === 1);
    await page.locator(".rg-menu-item", { hasText: "(no prompt)" }).last().click(); await page.waitForTimeout(100);
    check("picking the other one makes it the active region", !(await menu()) && await page.evaluate(() => window.__node.__rgActive()) === ridA);
    // duplicate / delete layer, hide, delete region
    await page.mouse.click(bx + 80, by + 80, { button: "right" }); await page.waitForTimeout(100);
    await item("Duplicate this layer").click(); await page.waitForTimeout(120);
    check("Duplicate this layer: one more layer in that region", (await st()).layers.filter((l) => l.region === ridA).length === 2);
    await page.keyboard.press("Control+z"); await page.waitForTimeout(100);
    await page.mouse.click(bx + 80, by + 80, { button: "right" }); await page.waitForTimeout(100);
    await item("Hide region").click(); await page.waitForTimeout(120);
    check("Hide region: hidden, and no longer under the pointer", (await st()).regions.find((r) => r.id === ridA).hidden === true);
    await page.mouse.click(bx + 80, by + 80, { button: "right" }); await page.waitForTimeout(100);
    check("…a right-click there now gives the empty-canvas menu", (await menu())?.items.includes("Add a region"));
    await page.keyboard.press("Escape"); await page.keyboard.press("Control+z"); await page.waitForTimeout(120);
    await page.mouse.click(bx + 80, by + 80, { button: "right" }); await page.waitForTimeout(100);
    await item("Delete region").click(); await page.waitForTimeout(120);
    s0 = await st();
    check("Delete region: the region and its layer go", s0.regions.length === 1 && s0.layers.length === 1 && s0.regions[0].id === ridB);
    await page.keyboard.press("Control+z"); await page.waitForTimeout(120);
    check("…and one undo brings both back", (await st()).regions.length === 2 && (await st()).layers.length === 2);
    // keyboard in the menu
    await page.mouse.click(bx + 30, by + 30, { button: "right" }); await page.waitForTimeout(100);
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(150);
    check("arrow down and Enter run the first entry (Add a region)", !(await menu()) && (await st()).regions.length === 3);
    await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press("Control+z"); await page.waitForTimeout(100);
    await page.evaluate(() => window.__node.__rgSetTool("select"));

    // ---- click areas: the look stays, a click just outside a small control still counts (at least 24 px tall)
    const areas = await page.evaluate(() => {
        const bad = [], sizes = [];
        const all = [...document.querySelectorAll(".rg-bar > .rg-btn, .rg-head .rg-btn, .rg-row .rg-btn, .rg-foot .rg-btn, .rg-row .rg-chev, .rg-row .rg-grip:not(.pad), .rg-row .rg-sw")]
            .filter((b) => b.offsetParent && !b.disabled && getComputedStyle(b).visibility !== "hidden");
        for (const b of all) {
            const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, need = Math.max(0, (24 - r.height) / 2);
            sizes.push(Math.round(r.height));
            for (const y of [r.top - need + 0.6, r.bottom + need - 0.6]) {
                if (need < 0.7) continue;
                const t = document.elementFromPoint(cx, y);
                // the area ends where the list's own edge cuts it off (the first and last row in view)
                const clip = (b.closest(".rg-list") || b.closest(".rg-tree"))?.getBoundingClientRect();
                if (clip && (y < clip.top || y > clip.bottom)) continue;
                if (!t || !(t === b || b.contains(t))) bad.push(`${b.className.slice(0, 26)} "${(b.title || b.dataset.rgTip || "").slice(0, 22)}" -> ${t ? t.className.slice(0, 20) : "nothing"}`);
            }
        }
        return { n: all.length, bad, minH: Math.min(...sizes), maxH: Math.max(...sizes) };
    });
    check(`${areas.n} small controls: a click up to 24 px tall around each lands on it (${areas.bad.slice(0, 4).join("; ")})`, areas.n > 25 && !areas.bad.length);
    check(`…and they look as before (heights ${areas.minH} to ${areas.maxH} px)`, areas.maxH <= 24);
    const dd = page.locator('.rg-bar .rg-btn.grp[data-group="shape"] .rg-grp-dd');
    await dd.click(); await page.waitForTimeout(150);
    check("a tool button's arrow still opens its list (the click area lies behind it)", await page.locator(".rg-menu .rg-menu-item").count() === 8);
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);

    // ---- round 40: the rows. No size label in the tool bar; a fixed "Edit area" line in Edit Mode
    check("the tool bar has no size label (the size row at the top shows the canvas size)", await page.locator(".rg-bar > .rg-hint").count() === 0
        && await page.evaluate(() => { const b = [...document.querySelector(".rg-bar").children].filter((c) => c.offsetParent); return b[b.length - 1].matches('[title^="Clear all"], [data-rg-tip^="Clear all"]'); }));
    check("Generate mode: no Edit area line; the list header has no mask fields, the bottom bar no edit_area", await page.locator(".rg-row.editarea").count() === 0 && await page.locator(".rg-head .rg-editmask").count() === 0
        && await page.locator(".rg-foot select").evaluateAll((els) => els.every((e) => ![...e.options].some((o) => o.value === "whole image"))));
    await page.locator('.rg-foot [title^="Edit: Change the image"]').click(); await page.waitForTimeout(200);
    const ea = () => page.evaluate(() => { const r = document.querySelector(".rg-row.editarea"); if (!r) return null; const prev = r.previousElementSibling;
        return { n: document.querySelectorAll(".rg-row.editarea").length, label: r.querySelector(".rg-pseudo")?.textContent, after: prev?.classList.contains("scene") || prev?.classList.contains("empty") || !!prev?.querySelector?.(".rg-hint"),
            sel: [...(r.querySelector("select")?.options || [])].map((o) => o.value), nums: r.querySelectorAll(".rg-editmask input").length, x: !!r.querySelector('button[data-ic="close"]'),
            oneLine: r.getBoundingClientRect().height < 30, head: document.querySelectorAll(".rg-head .rg-editmask").length }; });
    let e1 = await ea();
    check(`Edit Mode: one "Edit area" line under Whole image, with edit_area and the two mask fields, and no ✕ (${JSON.stringify(e1)})`, !!e1 && e1.n === 1 && e1.label === "Edit area" && e1.sel.join("|") === "only the regions|whole image"
        && e1.nums === 2 && !e1.x && e1.oneLine && e1.head === 0);
    await page.locator(".rg-row.editarea select").selectOption("whole image"); await page.waitForTimeout(100);
    check("its dropdown sets edit_area", await page.evaluate(() => window.__node.widgets.find((w) => w.name === "edit_area").value) === "whole image");
    await page.locator(".rg-row.editarea .rg-editmask input").first().fill("12"); await page.keyboard.press("Tab"); await page.waitForTimeout(150);
    check("its first field sets the edit mask's grow", (await st()).editMask?.grow === 12);
    const editX = page.locator('.rg-row.ctrl.edit button[data-ic="close"]').first();
    if (await editX.count()) { await editX.click(); await page.waitForTimeout(150); }
    e1 = await ea();
    check("the Edit row removed (✕): the Edit area line stays, with its values", !!e1 && e1.n === 1 && await page.locator(".rg-row.editarea select").inputValue() === "whole image"
        && await page.locator(".rg-row.editarea .rg-editmask input").first().inputValue() === "12");
    await page.locator('.rg-foot .rg-seg .rg-btn').first().click(); await page.waitForTimeout(200);
    check("back in Generate mode: the line is gone", await page.locator(".rg-row.editarea").count() === 0);
    // ---- round 40: a node that shows only some outputs. The prompt's links get the Python node's output numbers
    const mapped = await page.evaluate(async () => {
        const { mapShownOutputs } = await import("./extensions/rg/editor/sockets.js");
        const NAMES = ["model", "positive", "negative", "latent", "prompt", "color_map", "masks", "bboxes", "elements", "character_boxes", "region_info", "width", "height"];
        const p = { "5": { class_type: "Region-Genie_Main", inputs: { outputs_shown: "model,positive,negative,latent,masks,height", paint_data: "{}" } },
            "6": { class_type: "Region-Genie_Main", inputs: { outputs_shown: "" } },
            "7": { class_type: "KSampler", inputs: { model: ["5", 0], positive: ["5", 1], latent_image: ["5", 3], steps: 20 } },
            "8": { class_type: "MaskPreview", inputs: { mask: ["5", 4] } }, "9": { class_type: "PreviewAny", inputs: { source: ["5", 5] } },
            "10": { class_type: "PreviewImage", inputs: { images: ["6", 5] } }, "11": { class_type: "Other", inputs: { a: ["12", 4], list: [1, 2] } } };
        const moved = mapShownOutputs(p, NAMES);
        return { moved, p };
    });
    check(`the shown outputs become the Python node's numbers: masks 4 -> 6, height 5 -> 12; the first four stay (${mapped.moved} changed)`, mapped.moved === 2 && mapped.p["8"].inputs.mask[1] === 6 && mapped.p["9"].inputs.source[1] === 12
        && mapped.p["7"].inputs.model[1] === 0 && mapped.p["7"].inputs.latent_image[1] === 3);
    check("outputs_shown is emptied; a node that shows all outputs, other nodes and plain values are left alone", mapped.p["5"].inputs.outputs_shown === "" && mapped.p["10"].inputs.images[1] === 5
        && mapped.p["11"].inputs.a[1] === 4 && JSON.stringify(mapped.p["11"].inputs.list) === "[1,2]" && mapped.p["7"].inputs.steps === 20);

    // every button with a drawn icon: no text glyph left as a label
    const glyphs = await page.evaluate(() => [...document.querySelectorAll(".rg-wrap button")].filter((b) => /^[✕↑↓▲◉○✂⧉⤓⇄⌫🗑⇊↺⬆＋⚠ⓘ×]$/u.test(b.textContent.trim())).map((b) => b.textContent.trim() + " " + (b.title || "").slice(0, 30)));
    check(`no button is labelled with a bare symbol any more (${glyphs.join("; ")})`, !glyphs.length);

    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
