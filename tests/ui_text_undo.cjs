// Browser checks of round 43: text and Undo; the pop-up button of a text box.
// - A visit to a text box (click in, type, click out) is one step of the editor's Undo, in order with drawing.
// - While the cursor is in a box, the Undo keys go back through that box's own text, also after clicking out and back.
// - Nothing of it is saved with the workflow.
// - The pop-up button sits in the middle of a one-line prompt box and in the bottom-right corner of an open one; the
//   text never runs under it.
// (The scene prompts are text boxes of ComfyUI itself, which the stub page doesn't have: tests/real_text_boxes.cjs
// checks them, the scroll bars and the bottom bar in the real ComfyUI; ui_large_editor.cjs has the large editor's.)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1100 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__settingsExt.setup());
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__node.__rgState())));
    const prompt0 = async () => (await st()).regions[0]?.prompt;
    const cvRect = () => page.evaluate(() => { const c = document.querySelector(".rg-cv canvas").getBoundingClientRect(); return [c.x, c.y, c.width, c.height]; });
    const draw = async (x0, y0, x1, y1) => { const [bx, by] = await cvRect(); await page.evaluate(() => window.__node.__rgSetTool("shape"));
        await page.mouse.move(bx + x0, by + y0); await page.mouse.down(); await page.mouse.move(bx + x1, by + y1, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150); };
    const undoBtn = page.locator('.rg-bar [title^="Undo"]'), redoBtn = page.locator('.rg-bar [title^="Redo"]');
    const pr = page.locator(".rg-list textarea.rg-prompt").first();
    const clickCanvasEdge = async () => { const [bx, by, bw] = await cvRect(); await page.evaluate(() => window.__node.__rgSetTool("select")); await page.mouse.click(bx + bw - 6, by + 6); await page.waitForTimeout(120); };

    await draw(40, 40, 120, 120);
    check("one region to start with", (await st()).regions.length === 1 && (await st()).layers.length === 1);

    // ---- a visit to the box is one step; the Undo button is ready as soon as something is typed
    await pr.click(); await page.keyboard.type("a red fox in the snow"); await page.waitForTimeout(120);
    check("while typing, before leaving the box: the Undo button is ready", !(await undoBtn.isDisabled()));
    await clickCanvasEdge();
    check("the text is the region's prompt", await prompt0() === "a red fox in the snow");
    await draw(130, 40, 200, 110);
    const n2 = (await st()).layers.length;
    await undoBtn.click(); await page.waitForTimeout(120);
    check("Undo takes back what was done last: the second shape, not the text", (await st()).layers.length === n2 - 1 && await prompt0() === "a red fox in the snow");
    await undoBtn.click(); await page.waitForTimeout(120);
    check("Undo again: the whole text typed in that visit, as one step", await prompt0() === "" && (await st()).layers.length === n2 - 1);
    await undoBtn.click(); await page.waitForTimeout(120);
    check("Undo again: the first shape", (await st()).layers.length === 0);
    await redoBtn.click(); await redoBtn.click(); await redoBtn.click(); await page.waitForTimeout(150);
    check("Redo three times: shape, text, shape are back", (await st()).layers.length === n2 && await prompt0() === "a red fox in the snow");
    // Undo clicked while the cursor is still in the box: that visit's text goes
    await pr.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(", at dusk"); await page.waitForTimeout(80);
    await undoBtn.click(); await page.waitForTimeout(150);
    check("the Undo button, clicked while the cursor is still in the box, takes back that visit's typing", await prompt0() === "a red fox in the snow");
    await redoBtn.click(); await page.waitForTimeout(120);
    check("and Redo brings it back", await prompt0() === "a red fox in the snow, at dusk");

    // ---- in the box, the Undo keys go through the box's own text, also after clicking out, doing something, coming back
    await clickCanvasEdge(); await draw(40, 140, 110, 200);
    const pr2 = page.locator(".rg-list textarea.rg-prompt").first();
    await pr2.click(); await page.keyboard.press("Control+End"); await page.waitForTimeout(60);
    const seen = [];
    for (let i = 0; i < 12 && (await pr2.inputValue()) !== ""; i++) { await page.keyboard.press("Control+z"); await page.waitForTimeout(40); seen.push(await pr2.inputValue()); }
    check(`back in the box after doing something else: Ctrl+Z goes back through its text, step by step, to the empty start (${seen.length} steps: ${JSON.stringify(seen.slice(0, 3))} …)`,
        seen.length >= 3 && seen.length <= 10 && seen[seen.length - 1] === "" && seen[0] !== "" && "a red fox in the snow, at dusk".startsWith(seen[0]) && await prompt0() === "");
    check("…and the shapes were left alone", (await st()).layers.length === n2 + 1);
    for (let i = 0; i < seen.length; i++) { await page.keyboard.press("Control+Shift+z"); await page.waitForTimeout(40); }
    check("Ctrl+Shift+Z in the box brings every step back", await pr2.inputValue() === "a red fox in the snow, at dusk" && await prompt0() === "a red fox in the snow, at dusk");
    await clickCanvasEdge();

    // ---- nothing of it is saved with the workflow
    const saved = await page.evaluate(() => { const n = window.__node, d = n.widgets.find((w) => w.name === "region_data" || /data/.test(w.name)); const o = n.serialize ? JSON.stringify(n.serialize()) : ""; return { data: String(d?.value || ""), node: o }; });
    check("the workflow holds the text as it is now and nothing of its history", /a red fox in the snow, at dusk/.test(saved.data) && !/__scene/.test(saved.data + saved.node) && !/"steps"/.test(saved.data + saved.node)
        && (saved.data.match(/a red fox/g) || []).length === 1);

    // ---- the pop-up button of a prompt box
    const geo = (focus) => page.evaluate(() => { const t = document.querySelector(".rg-list textarea.rg-prompt"), b = t.parentElement.querySelector(".rg-expand"); const r = t.getBoundingClientRect(), br = b.getBoundingClientRect(), cs = getComputedStyle(t);
        const classic = t.offsetWidth - t.clientWidth - 2 * t.clientLeft;
        return { h: Math.round(r.height), top: Math.round((br.top - r.top) * 10) / 10, bottom: Math.round((r.bottom - br.bottom) * 10) / 10, right: Math.round((r.right - br.right) * 10) / 10, bw: Math.round(br.width), pad: parseFloat(cs.paddingRight), classic,
            textEnd: Math.round((r.right - t.clientLeft - classic - parseFloat(cs.paddingRight)) * 10) / 10, btnLeft: Math.round(br.left * 10) / 10 }; });
    const g0 = await geo();
    check(`a one-line prompt box: the pop-up button is in the middle of its height (${g0.top} above, ${g0.bottom} below; box ${g0.h} px)`, g0.h < 26 && Math.abs(g0.top - g0.bottom) <= 1);
    check(`…and the text stops before it (text ends at ${g0.textEnd}, button starts at ${g0.btnLeft})`, g0.textEnd <= g0.btnLeft);
    await page.locator(".rg-list textarea.rg-prompt").first().click(); await page.waitForTimeout(250);
    const g1 = await geo();
    check(`the open prompt box (${g1.h} px tall): the button is in its bottom-right corner (${g1.bottom} from the bottom, ${g1.top} from the top)`, g1.h > 50 && g1.bottom <= 5 && g1.top > 25);
    check(`…left of the scroll bar (${g1.classic} px wide; button ${g1.right} px from the edge), and the text stops before it`, g1.right >= g1.classic + 1 && g1.textEnd <= g1.btnLeft);
    await clickCanvasEdge();
    const g2 = await geo();
    check("closed again: back in the middle", Math.abs(g2.top - g2.bottom) <= 1);

    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
