// Browser checks of round 36: the large editor (the same editor moved into a window over the page and back).
// (The stub node's image is 256 px wide; the stub puts the editor straight into the page.)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1500, height: 1000 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__settingsExt.setup());
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__node.__rgState())));
    const toClient = (x, y) => page.evaluate(([x, y]) => window.__node.__rgToClient(x, y), [x, y]);
    const box = async (a, b, c, d) => {
        let [x, y] = await toClient(a, b); await page.mouse.move(x, y); await page.mouse.down();
        [x, y] = await toClient(c, d); await page.mouse.move(x, y, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(150);
    };
    const W = (name) => page.evaluate((name) => window.__node.widgets.find((w) => w.name === name).value, name);
    const btn = page.locator('.rg-bar [title^="Large editor"]');
    const add = page.locator('[title^="Add a region with a new color"]');
    const cvSize = () => page.evaluate(() => { const r = document.querySelector(".rg-cv").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    const ORDER = "rg-keysink,rg-bar,rg-banner,rg-cv,rg-msg,rg-split,rg-tree,rg-foot";
    const order = () => page.evaluate(() => [...document.querySelector(".rg-wrap").children].map((c) => c.className.split(" ")[0]).join(","));

    // ---- on the node first: a region and a scene prompt
    await add.click(); await page.waitForTimeout(100); await box(20, 20, 120, 120);
    await page.evaluate(() => { window.__node.widgets.find((w) => w.name === "scene_prompt_positive").value = "from the node"; });
    const small = await cvSize();
    check("the tool bar has the Large editor button, off", await btn.count() === 1 && !(await btn.evaluate((b) => b.classList.contains("on"))) && /\(Alt\+Enter\)/.test(await btn.getAttribute("title")));
    check("the node's own order of parts", await order() === ORDER);

    // ---- open
    await btn.click(); await page.waitForTimeout(400);
    const open = await page.evaluate(() => {
        const ov = document.querySelector(".rg-big"), win = ov?.querySelector(".rg-big-win"), wrap = document.querySelector(".rg-wrap"), side = wrap.querySelector(".rg-big-side");
        const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
        return { inWin: wrap.parentElement === win, mode: wrap.classList.contains("rg-bigmode"), hole: document.querySelectorAll(".rg-big-hole").length,
            side: side && [...side.children].map((c) => c.className.split(" ")[0]).join(","), win: r(win), cv: r(document.querySelector(".rg-cv")), sideR: side && r(side), bar: r(document.querySelector(".rg-bar")),
            split: getComputedStyle(document.querySelector(".rg-split")).display, vw: innerWidth, vh: innerHeight };
    });
    check("the editor is in a window over the page; placeholders hold its place and the size row's", open.inWin && open.mode && open.hole === 2);
    check(`the window fills the page (${open.win.join(" ")} of ${open.vw} x ${open.vh})`, open.win[0] < 60 && open.win[1] < 40 && open.win[2] > open.vw - 60 && open.win[3] > open.vh - 40);
    check("right-hand panel: size row, scene prompts, region list, bottom bar", open.side === "rg-size,rg-big-scene,rg-tree,rg-foot");
    check("layout B: tools above the canvas on the left, the panel to their right, no divider", open.bar[3] <= open.cv[1] + 1 && open.bar[0] < open.sideR[0] && open.cv[2] <= open.sideR[0] && open.sideR[1] <= open.bar[1] + 2 && open.split === "none");
    const bigCv = await cvSize();
    check(`the canvas is much larger (${small.join("x")} -> ${bigCv.join("x")})`, bigCv[0] > small[0] * 1.2 && bigCv[1] > small[1] * 1.15);
    check("the button shows it is on", await btn.evaluate((b) => b.classList.contains("on")));

    // ---- it is the same editor: draw, list, undo
    await add.click(); await page.waitForTimeout(100); await box(140, 140, 240, 240);
    check("drawing in the window adds to the same canvas", (await st()).layers.length === 2 && (await st()).regions.length === 2);
    const ta = page.locator(".rg-list textarea.rg-prompt").first(); await ta.click(); await page.keyboard.type("typed large"); await page.keyboard.press("Enter");
    check("a region prompt typed in the window is the region's prompt", (await st()).regions[0].prompt === "typed large");

    // ---- the scene prompts: text boxes in step with the node's fields, both ways
    const pos = page.locator('.rg-big-ta[data-scene="positive"]'), neg = page.locator('.rg-big-ta[data-scene="negative"]');
    check("the window's scene prompt shows the node's text", await pos.inputValue() === "from the node");
    await neg.click(); await page.keyboard.type("blurry");
    check("typing there types into the node's field", await W("scene_prompt_negative") === "blurry");
    await page.evaluate(() => { window.__node.widgets.find((w) => w.name === "scene_prompt_positive").value = "changed on the node"; });
    await page.waitForTimeout(450);
    check("a change of the node's field shows in the window", await pos.inputValue() === "changed on the node");

    // ---- Esc: first deselects, then closes
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    check("Esc in a scene prompt box leaves the box (the window stays)", await page.locator(".rg-big").count() === 1 && await page.evaluate(() => document.activeElement?.classList.contains("rg-keysink")));
    let [x, y] = await toClient(128, 128); await page.mouse.move(x, y);
    await page.evaluate(() => { window.__node.__rgSetTool("select"); window.__node.__rgSelectLayer(window.__node.__rgState().layers[0].id); });
    await page.keyboard.press("Escape"); await page.waitForTimeout(150);
    check("Esc with a layer selected only deselects", await page.locator(".rg-big").count() === 1);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({ big: document.querySelectorAll(".rg-big, .rg-big-hole, .rg-big-side").length, mode: document.querySelector(".rg-wrap").classList.contains("rg-bigmode"),
        wrapParent: document.querySelector(".rg-wrap").parentElement.tagName, sizeParent: document.querySelector(".rg-size").parentElement.tagName }));
    check("Esc with nothing selected closes the window: the editor and the size row are back where they were", back.big === 0 && !back.mode && back.wrapParent === "BODY" && back.sizeParent === "BODY");
    check("the node's own order of parts again", await order() === ORDER);
    check("the canvas has the node's size again", Math.abs((await cvSize())[1] - small[1]) < 4);
    check("everything done in the window is still there", (await st()).layers.length === 2 && (await st()).regions[0].prompt === "typed large" && await W("scene_prompt_negative") === "blurry");
    [x, y] = await toClient(128, 128); await page.mouse.move(x, y); await page.keyboard.press("Control+z"); await page.waitForTimeout(120);
    check("and the editor still works on the node (Ctrl+Z)", (await st()).regions[0].prompt !== "typed large" || (await st()).layers.length === 1);

    // ---- the key, and its Setting
    await page.keyboard.press("Alt+Enter"); await page.waitForTimeout(300);
    check("Alt+Enter opens it", await page.locator(".rg-big").count() === 1);
    await page.locator(".rg-big-head .rg-btn").click(); await page.waitForTimeout(300);
    check("✕ closes it", await page.locator(".rg-big").count() === 0);
    const def = await page.evaluate(() => { const s = window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Main.LargeEditorKey"); return s && [s.type, s.defaultValue]; });
    check("the large editor's key is saved under its own id, Alt+Enter by default (changed in the shortcut list, no row in Settings)", def?.[0] === "hidden" && def[1] === "Alt+Enter");
    await page.evaluate(() => { window.__settings["RegionGenie.Main.LargeEditorKey"] = "F9"; });
    [x, y] = await toClient(128, 128); await page.mouse.move(x, y);
    await page.keyboard.press("Alt+Enter"); await page.waitForTimeout(250);
    const notOld = await page.locator(".rg-big").count() === 0;
    await page.keyboard.press("F9"); await page.waitForTimeout(300);
    check("with the key set to F9: Alt+Enter does nothing, F9 opens it", notOld && await page.locator(".rg-big").count() === 1);
    await page.screenshot({ path: require("path").join(__dirname, "out", "ui_large_editor.png"), fullPage: false });
    // ---- the node is removed while the window is open
    await page.evaluate(() => window.__node.onRemoved());
    await page.waitForTimeout(200);
    check("removing the node closes the window", await page.locator(".rg-big").count() === 0);

    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
