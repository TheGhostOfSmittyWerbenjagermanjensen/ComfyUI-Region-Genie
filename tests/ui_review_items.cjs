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

    // ---- the pack's own tooltip
    const undo = page.locator('.rg-bar [title^="Undo"]');
    const [ux, uy, ub] = await center(undo);
    await away();
    await page.mouse.move(ux, uy); await page.waitForTimeout(150);
    check("pointing at a button: nothing at once, and the browser's own tooltip has nothing to show (the title is put aside)",
        !(await tip()) && await page.evaluate(([x, y]) => { const b = document.elementFromPoint(x, y).closest("button"); return !b.hasAttribute("title") && /^Undo/.test(b.dataset.rgTip); }, [ux, uy]));
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
    check("a press hides it, and the title is back on the pressed button", !(await tip()) && await page.locator('.rg-bar [title^="Redo"]').count() === 1);
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
            && await page.evaluate(([x, y]) => !document.elementFromPoint(x, y).closest("button").hasAttribute("title"), [sx, sy]));
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
    // ---- the shortcut list
    const sheet = () => page.evaluate(() => { const b = document.querySelector(".rg-keys"); if (!b) return null; const r = b.getBoundingClientRect();
        return { groups: [...b.querySelectorAll("h4")].map((h) => h.textContent), rows: b.querySelectorAll(".rg-keys-row").length, in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
            onPage: b.parentElement === document.body, tools: [...b.querySelector("section").querySelectorAll(".rg-keys-row")].map((x) => [[...x.querySelectorAll("kbd")].map((k) => k.textContent), x.lastChild.textContent]) }; });
    const kb = page.locator(".rg-keys-btn");
    check("a keyboard button in the bottom bar, its tooltip names the key", await kb.count() === 1 && /\(\?\)/.test(await kb.getAttribute("title")));
    await kb.click(); await page.waitForTimeout(120);
    let sh = await sheet();
    check(`the button opens the shortcut list on the page, inside the window (${sh?.groups.join(", ")}; ${sh?.rows} rows)`, !!sh && sh.onPage && sh.in && sh.groups.join("|") === "Tools|While drawing|Layers and regions|View|Text" && sh.rows > 30);
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
    // every single key the list names under Tools picks that tool
    const wantTool = { V: "select", R: "shape", O: "shape", T: "shape", B: "brush", E: "erase", L: "lasso", "Shift+L": "lassoErase", F: "fill", W: "wand", Q: "object" };
    const listed = (sh?.tools || []).flatMap(([ks]) => ks).filter((k) => wantTool[k]);
    const wrong = [];
    for (const k of listed) {
        await page.evaluate(() => window.__node.__rgSetTool(window.__node.__rgTool() === "select" ? "brush" : "select"));
        await page.mouse.move(cx0, cy0); await page.keyboard.press(k); await page.waitForTimeout(40);
        const now = await page.evaluate(() => window.__node.__rgTool());
        if (now !== wantTool[k]) wrong.push(`${k}: ${now}`);
        if (k === "Q") { await page.keyboard.press("Escape"); }
    }
    check(`each tool key in the list picks its tool (${listed.length} keys; ${wrong.join(", ")})`, listed.length === Object.keys(wantTool).length && !wrong.length);
    await page.evaluate(() => window.__node.__rgSetTool("select"));

    // every button with a drawn icon: no text glyph left as a label
    const glyphs = await page.evaluate(() => [...document.querySelectorAll(".rg-wrap button")].filter((b) => /^[✕↑↓▲◉○✂⧉⤓⇄⌫🗑⇊↺⬆＋⚠ⓘ×]$/u.test(b.textContent.trim())).map((b) => b.textContent.trim() + " " + (b.title || "").slice(0, 30)));
    check(`no button is labelled with a bare symbol any more (${glyphs.join("; ")})`, !glyphs.length);

    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
