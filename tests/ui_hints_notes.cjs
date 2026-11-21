// Browser checks of round 33 (first-use help): the hints on the canvas and their Setting, the start card, Clear all
// at the end of the toolbar, the words on bare numbers, the run-notes button, shortcuts over the whole editor.
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
    const toClient = (x, y) => page.evaluate(([x, y]) => window.__node.__rgToClient(x, y), [x, y]);
    const tips = () => page.evaluate(() => { const t = document.querySelector(".rg-tips"); return getComputedStyle(t).display === "none" ? null : t.textContent; });
    const shown = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== "none"; }, sel);
    const setTool = async (t) => { await page.evaluate((t) => window.__node.__rgSetTool(t), t); await page.waitForTimeout(40); };

    // ---- an empty canvas: the start card and the Select tool's hints
    check("empty canvas: the start card shows three steps", await shown(".rg-start") && await page.locator(".rg-start i").count() === 3);
    check("empty canvas: hints for the Select tool (click, zoom, pan)", /Click Select a layer/.test(await tips() || "") && /Wheel Zoom/.test(await tips()) && /Space\+drag Pan/.test(await tips()));
    check("hints and start card take no clicks", await page.evaluate(() => [".rg-tips", ".rg-start"].every((s) => getComputedStyle(document.querySelector(s)).pointerEvents === "none")));
    // ---- every tool has its own hints
    const want = { shape: /Shift Equal sides.*Alt From the centre/, brush: /Shift\+click A straight line.*Brush size/, lasso: /Enter \/ double-click Close the outline.*Backspace/,
        lassoErase: /Close the outline/, fill: /Click Fill that area/, wand: /similar color/, object: /Ctrl\+click Take that spot out of the selection.*Enter Add the selection/, erase: /Erase from the selected layer/ };
    const bad = [];
    for (const [t, re] of Object.entries(want)) { await setTool(t); if (!re.test(await tips() || "")) bad.push(t); }
    check(`each tool shows its own keys and gestures (${bad.join(", ")})`, !bad.length);
    await setTool("select");

    // ---- shortcuts over the whole editor: R while pointing at the list's header picks the rectangle
    const head = await page.locator(".rg-list").boundingBox();
    await page.mouse.move(850, 50); await page.evaluate(() => document.activeElement?.blur?.());      // outside the editor
    await page.mouse.move(head.x + head.width / 2, head.y + head.height - 6);
    await page.keyboard.press("r");
    check("R while pointing at the region list picks the Rectangle tool", await page.locator('.rg-bar .rg-btn.grp[data-group="shape"].on').count() === 1);

    // ---- drawing: the hints fade while the button is held, the start card goes with the first layer
    let [x, y] = await toClient(200, 200);
    await page.mouse.move(x, y); await page.mouse.down();
    [x, y] = await toClient(600, 700); await page.mouse.move(x, y, { steps: 5 });
    check("while drawing: the hints are faded", await page.evaluate(() => document.querySelector(".rg-cv").classList.contains("held") && getComputedStyle(document.querySelector(".rg-tips")).opacity !== "1"));
    await page.mouse.up(); await page.waitForTimeout(250);
    check("after drawing: the hints are back, the start card is gone", await page.evaluate(() => !document.querySelector(".rg-cv").classList.contains("held")) && !(await shown(".rg-start")) && (await st()).layers.length === 1);
    await setTool("select");
    await page.evaluate(() => window.__node.__rgSelectLayer(window.__node.__rgState().layers[0].id)); await page.evaluate(() => window.__node.__rgRefresh());
    check("a selected layer: hints for moving, resizing, rotating", /Square handles Resize/.test(await tips() || "") && /Round handle Rotate/.test(await tips()));
    check("the region row counts its layers with the layers icon", await page.locator(".rg-row.region .rg-cnt svg").count() === 1 && /1/.test(await page.locator(".rg-row.region .rg-cnt").innerText()));

    // ---- Settings > Canvas tools > Hints on the canvas
    const def = await page.evaluate(() => { const s = window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.Hints"); return s && { type: s.type, d: s.defaultValue }; });
    check("Settings: 'Hints on the canvas', on by default", def?.type === "boolean" && def.d === true);
    await page.evaluate(() => { window.__settings["RegionGenie.Tools.Hints"] = false; window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.Hints").onChange(false); });
    check("hints off in Settings: no hints on the canvas, right away", await tips() === null);
    await page.evaluate(() => { window.__node.__rgState().layers = []; window.__node.__rgState().regions = []; window.__node.__rgRefresh(); });
    check("hints off in Settings: no start card on an empty canvas either", !(await shown(".rg-start")));
    await page.evaluate(() => { window.__settings["RegionGenie.Tools.Hints"] = true; window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.Hints").onChange(true); });
    check("hints on again: both are back", await tips() !== null && await shown(".rg-start"));

    // ---- Clear all: the last button of the toolbar, apart from Undo / Redo; undoable
    const bar = await page.evaluate(() => { const k = [...document.querySelector(".rg-bar").children]; const c = k.findIndex((e) => (e.title || "").startsWith("Clear all")), r = k.findIndex((e) => (e.title || "").startsWith("Redo")); return { last: c === k.length - 1, danger: k[c].classList.contains("danger"), gap: c - r }; });
    check("Clear all is the toolbar's last button, set apart from Undo / Redo", bar.last && bar.danger && bar.gap > 3);
    await page.mouse.move(x, y); await page.keyboard.press("r");
    [x, y] = await toClient(200, 200); await page.mouse.move(x, y); await page.mouse.down(); [x, y] = await toClient(500, 500); await page.mouse.move(x, y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
    await page.locator('.rg-bar [title^="Clear all"]').click(); await page.waitForTimeout(100);
    const cleared = (await st()).layers.length === 0;
    [x, y] = await toClient(400, 400); await page.mouse.move(x, y); await page.keyboard.press("Control+z"); await page.waitForTimeout(150);
    check("Clear all empties the canvas and Ctrl+Z brings it back", cleared && (await st()).layers.length === 1);

    // ---- round 48: the hints fade while the pointer is on the canvas, show again when it leaves, and for a moment
    // after a tool switch; a button in the canvas's corner hides / shows them
    const tipsOpacity = () => page.evaluate(() => +getComputedStyle(document.querySelector(".rg-tips")).opacity);
    await page.mouse.move(880, 1080); await page.waitForTimeout(3300);
    check("pointer away from the canvas: the hints show", await tipsOpacity() === 1);
    { const c = await page.locator(".rg-cv").boundingBox(); x = c.x + c.width / 2; y = c.y + c.height / 3; }
    await page.mouse.move(x, y, { steps: 3 }); await page.waitForTimeout(350);
    check("pointer on the canvas: the hints are faded", await tipsOpacity() === 0);
    await page.keyboard.press("b"); await page.waitForTimeout(350);
    check("another tool (B): its hints show for a moment, though the pointer is on the canvas", await tipsOpacity() === 1 && /Paint/.test(await tips()));
    await page.waitForTimeout(3100);
    check("…and fade again after about three seconds", await tipsOpacity() === 0);
    await page.mouse.move(880, 1080); await page.waitForTimeout(350);
    check("pointer off the canvas again: they are back", await tipsOpacity() === 1);
    await page.keyboard.press("v"); await page.waitForTimeout(100);
    const tb = page.locator(".rg-cv .rg-tips-btn");
    const tbBox = await tb.boundingBox(), cvB = await page.locator(".rg-cv").boundingBox();
    check("a small button in the canvas's lower right corner, lit while the hints are on, with a tooltip", await tb.count() === 1 && await tb.evaluate((b) => b.classList.contains("on") && /^Hints on the canvas: On/.test(b.title))
        && cvB.x + cvB.width - (tbBox.x + tbBox.width) < 10 && cvB.y + cvB.height - (tbBox.y + tbBox.height) < 10);
    check("…clear of the hints themselves", await page.evaluate(() => { const a = document.querySelector(".rg-tips").getBoundingClientRect(), b = document.querySelector(".rg-tips-btn").getBoundingClientRect(); return a.right <= b.left; }));
    await tb.click(); await page.waitForTimeout(200);
    check("a click hides the hints (the Setting 'Hints on the canvas' goes off) and the button goes dark", await tips() === null && await tb.evaluate((b) => !b.classList.contains("on") && /^Hints on the canvas: Off/.test(b.title)));
    await tb.click(); await page.waitForTimeout(200); await page.mouse.move(880, 1080); await page.waitForTimeout(200);
    check("another click shows them again", !!(await tips()) && await tb.evaluate((b) => b.classList.contains("on")));

    // ---- round 48: the list header. Icons for separation / until, 'Separate' on the button; a message that doesn't
    // fit beside them gets a line of its own for as long as it shows
    await page.evaluate(() => { const n = window.__node, s = n.__rgState(); s.loraOpts = { ...(s.loraOpts || {}), allRegions: true }; n.__rgRefresh(); });
    await page.waitForTimeout(250);
    const hd = await page.evaluate(() => { const b = document.querySelector(".rg-loraopts"), k = [...b.children].filter((e) => e.getClientRects().length);
        return { kinds: k.map((e) => e.tagName === "INPUT" ? "field" : e.classList.contains("rg-apart") ? "button" : e.querySelector("svg") && !e.textContent.trim() ? "icon" : "text:" + e.textContent.trim()),
            tips: k.slice(0, 4).every((e) => e.title && e.title.length > 20), same: k[0].title === k[1].title && k[2].title === k[3].title, h: Math.round(document.querySelector(".rg-head").getBoundingClientRect().height) }; });
    check(`with 'Separate' on: an icon and a field for separation, an icon and a field for until, then the button; no words (${hd.kinds.join(" ")})`, hd.kinds.join(" ") === "icon field icon field button" && hd.tips && hd.same);
    check("the button says 'Separate'", (await page.locator(".rg-apart").innerText()).trim() === "Separate" && await page.locator(".rg-apart svg").count() === 1);
    await page.evaluate(() => { document.querySelector(".rg-wrap").style.width = "560px"; }); await page.waitForTimeout(150);      // the editor's width in a 580 px node
    check("the header is one line at the new default width (560 px inside a 580 px node)", await page.evaluate(() => document.querySelector(".rg-head").getBoundingClientRect().height) < 26
        && await page.evaluate(() => document.querySelector(".rg-bar").getBoundingClientRect().height) < 26);
    await page.locator('.rg-bar .rg-btn.icon[title^="Arrange"]').click().catch(() => {});
    const headMsg = async (text) => { await page.evaluate((t) => window.__node.__rgHint(t), text); await page.waitForTimeout(80);
        return page.evaluate(() => { const s = document.querySelector(".rg-head .rg-status"), h = document.querySelector(".rg-head").getBoundingClientRect(), r = s.getBoundingClientRect();
            return { wide: s.classList.contains("wide"), all: s.scrollWidth <= s.clientWidth + 1, headH: Math.round(h.height), below: r.top > document.querySelector(".rg-apart").getBoundingClientRect().bottom - 2, text: s.textContent }; }); };
    const m1 = await headMsg("The layer is too small to shrink by 50 px");
    check(`a message that doesn't fit beside the fields: a line of its own under the header, all of it readable (${JSON.stringify(m1)})`, m1.wide && m1.all && m1.below && m1.headH > 30);
    await page.evaluate(() => { const n = window.__node, s = n.__rgState(); s.loraOpts = { ...(s.loraOpts || {}), allRegions: false, autoOff: true }; n.__rgRefresh(); });
    await page.waitForTimeout(200);
    const m2 = await headMsg("Select a layer first");
    check(`a message that fits (the fields are hidden with 'Separate' off): on the header's own line (${JSON.stringify(m2)})`, !m2.wide && m2.all && m2.headH < 26);
    await page.waitForTimeout(3700);
    check("after 3.5 s the message is gone and the header is one line again", await page.evaluate(() => { const s = document.querySelector(".rg-head .rg-status"); return !s.textContent && !s.classList.contains("wide") && document.querySelector(".rg-head").getBoundingClientRect().height < 26; }));
    await page.evaluate(() => { document.querySelector(".rg-wrap").style.width = ""; const n = window.__node, s = n.__rgState(); delete s.loraOpts; n.__rgRefresh(); }); await page.waitForTimeout(150);

    // ---- words: 'strength' / 'steps' on a Control row; the model dropdown
    await page.locator('.rg-row.scene [title^="Add a Control row"]').click(); await page.waitForTimeout(200); await page.keyboard.press("Escape"); await page.waitForTimeout(100);
    const words = await page.locator(".rg-row.ctrl .rg-word").allInnerTexts();
    check(`a Control row labels its numbers (${words.join(" / ")})`, words.join("|") === "strength|steps");
    check("the words carry their number's tooltip", await page.evaluate(() => [...document.querySelectorAll(".rg-row.ctrl .rg-word")].every((w) => w.title && w.title === w.nextElementSibling.title)));
    check("the model dropdown says 'auto: no model yet' before anything is known", (await page.locator(".rg-model option").first().innerText()) === "auto: no model yet");

    // ---- the run-notes button
    check("no run yet: no notes button", !(await shown(".rg-notes")));
    const info = "2 region(s) on 1024x1024 canvas\nprompt: text (no model connected)\nNOTE: control: no model is connected to 'model'; control not used\nNOTE: region #ff0000 ('x') has no pixels, skipped";
    await page.evaluate((info) => window.__node.onExecuted({ region_info: [info] }), info); await page.waitForTimeout(80);
    check("after a run with two notes: the button shows ⚠ 2", await shown(".rg-notes") && (await page.locator(".rg-notes").innerText()).trim() === "2" && await page.locator(".rg-notes svg").count() === 1 && await page.locator(".rg-notes.warn").count() === 1);
    await page.locator(".rg-notes").click(); await page.waitForTimeout(80);
    const msg = await page.locator(".rg-msg-text").innerText();
    check("a click lists the notes first, then the rest of the report", await shown(".rg-msg") && /^• control: no model/.test(msg) && /• region #ff0000/.test(msg) && /The last run:\n2 region\(s\)/.test(msg) && !/NOTE:/.test(msg));
    await page.locator(".rg-notes").click(); await page.waitForTimeout(80);
    check("a second click hides it", !(await shown(".rg-msg")));
    await page.locator(".rg-notes").click();
    await page.evaluate(() => window.__node.onExecuted({ region_info: ["1 region(s) on 1024x1024 canvas\nprompt: text"] })); await page.waitForTimeout(80);
    check("a run without notes: ⓘ, and an open report follows the new run", (await page.locator(".rg-notes").innerText()).trim() === "" && await page.locator(".rg-notes svg").count() === 1 && await page.locator(".rg-notes.warn").count() === 0
        && /1 region\(s\)/.test(await page.locator(".rg-msg-text").innerText()) && await page.locator(".rg-msg.info").count() === 1);
    await page.locator('.rg-msg .rg-btn[data-ic="close"]').click();

    await page.screenshot({ path: require("path").join(__dirname, "out", "ui_hints.png"), fullPage: false });
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
