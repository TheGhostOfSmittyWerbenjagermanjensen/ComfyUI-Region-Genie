// Round 9 browser checks (stub page): region eye. (Size row and wildcards are added below as they are built.)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
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
    const status = () => page.evaluate(() => [...document.querySelectorAll(".rg-hint")].map((e) => e.textContent).join(" | "));
    // a pixel of the rendered canvas (64 x 64), image x / y in 0..1
    const px = (x, y) => page.evaluate(async ([x, y]) => {
        const img = new Image(); img.src = window.__node.__rgRender(64, 64); await img.decode();
        const c = document.createElement("canvas"); c.width = 64; c.height = 64; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        return [...g.getImageData(Math.floor(x * 64), Math.floor(y * 64), 1, 1).data].slice(0, 3);
    }, [x, y]);

    // ---------------- region eye
    const addRegion = page.locator(".rg-head .rg-btn.icon").first();
    await addRegion.click(); await addRegion.click();
    await page.evaluate(() => {
        const s = window.__node.__rgState();
        const L = (id, region, ox) => ({ id, name: "Rect " + id, region, visible: true, shape: "rect", sides: 5, bw: 0.5, bh: 1, sx: 1, sy: 1, rot: 0, ox, oy: 0, ops: [] });
        s.layers.push(L(1, s.regions[1].id, -0.25), L(2, s.regions[0].id, 0.25));
        s.regions[0].prompt = "right"; s.regions[1].prompt = "left";
    });
    await page.evaluate(() => window.__node.__rgRefresh());
    await page.waitForTimeout(150);
    const eyes = page.locator(".rg-row.region .rg-reye");
    check("an eye on each region row", await eyes.count() === 2);
    check("both regions drawn", (await px(0.75, 0.5)).some((v) => v > 0) && (await px(0.25, 0.5)).some((v) => v > 0));
    check("both in the outputs", (await page.evaluate(() => window.__node.__rgOutputRegions().length)) === 2);
    await eyes.first().click(); await page.waitForTimeout(120);
    let s = await st();
    check("eye hides the region (flag on the region)", s.regions[0].hidden === true);
    check("its layers keep their own show / hide", s.layers.every((l) => l.visible === true));
    check("hidden region not drawn", (await px(0.75, 0.5)).every((v) => v === 0) && (await px(0.25, 0.5)).some((v) => v > 0));
    const out = await page.evaluate(() => window.__node.__rgOutputRegions());
    check("hidden region left out of the outputs", out.length === 1 && out[0].prompt === "left");
    check("hidden row dimmed, index '–'", await page.locator(".rg-row.region.off").count() === 1
        && (await page.locator(".rg-row.region.off .rg-idx").textContent()) === "–");
    check("hidden region's label not drawn", (await page.evaluate(() => window.__node.__rgLabels().map((l) => l.rid))).length === 1);
    await page.keyboard.press("Control+z"); await page.waitForTimeout(100);
    check("undo shows it again", !(await st()).regions[0].hidden);
    await page.keyboard.press("Control+y"); await page.waitForTimeout(100);
    check("redo hides it again", (await st()).regions[0].hidden === true);
    // drawing into the hidden (active) region shows it again
    await page.evaluate(() => { const s = window.__node.__rgState(); });
    await page.locator(".rg-row.region.off .rg-prompt").click();                 // make it the active region
    await page.locator('.rg-bar .rg-btn.icon[title^="Shape"]').click();
    const a = await page.evaluate(() => window.__node.__rgToClient(20, 200)), b = await page.evaluate(() => window.__node.__rgToClient(60, 240));
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(120);
    s = await st();
    check("drawing into a hidden region shows it again (with a note)", !s.regions[0].hidden && s.layers.length === 3 && /was hidden/.test(await status()));
    await eyes.nth(1).click(); await page.waitForTimeout(80);
    await eyes.nth(1).click(); await page.waitForTimeout(80);
    check("clicking twice: back as it was", !(await st()).regions[1].hidden);

    // ---------------- image size row
    const row = page.locator(".rg-size");
    const wv = () => page.evaluate(() => [window.__node.widgets.find((w) => w.name === "width").value, window.__node.widgets.find((w) => w.name === "height").value]);
    const modeBtn = (t) => row.locator(`.rg-seg .rg-btn[title^="${t}"]`);
    const sizeOut = () => row.locator(".rg-size-out").textContent();
    check("size row: one row with the 3 modes", await row.count() === 1 && await row.locator(".rg-seg .rg-btn").count() === 3);
    // the stub node is set up like one loaded from a workflow saved before the size row: manual, with its size
    check("node without size settings: manual mode with its width / height", JSON.stringify(await wv()) === "[256,256]"
        && await modeBtn("Image size: width and height").evaluate((b) => b.classList.contains("on")));
    await modeBtn("Image size from an aspect ratio").click(); await page.waitForTimeout(60);
    check("aspect ratio mode from Settings defaults: 1:1, 1 MP = 1024 x 1024", JSON.stringify(await wv()) === "[1024,1024]");
    // the same results as ComfyUI's Resolution Selector (values from comfy_extras/nodes_resolution.py)
    const ratioCase = async (aspect, mp, mult) => {
        await row.locator("select.rg-sel").first().selectOption(aspect);
        const [mpIn, multIn] = [row.locator(".rg-size-part").first().locator("input.rg-num").nth(0), row.locator(".rg-size-part").first().locator("input.rg-num").nth(1)];
        await mpIn.fill(String(mp)); await mpIn.press("Enter");
        await multIn.fill(String(mult)); await multIn.press("Enter");
        await page.waitForTimeout(60);
        return JSON.stringify(await wv());
    };
    check("16:9, 1 MP, x8 = 1368 x 768", await ratioCase("16:9 (Widescreen)", 1, 8) === "[1368,768]");
    check("2:3, 1.5 MP, x16 = 1024 x 1536", await ratioCase("2:3 (Portrait Photo)", 1.5, 16) === "[1024,1536]");
    check("21:9, 2 MP, x64 = 2240 x 960", await ratioCase("21:9 (Ultrawide)", 2, 64) === "[2240,960]");
    check("4:3, 16 MP, x128 = 4736 x 3584", await ratioCase("4:3 (Standard)", 16, 128) === "[4736,3584]");
    check("readout and canvas follow", /4736 × 3584/.test(await sizeOut()) && /4736 x 3584/.test(await status()));
    await ratioCase("21:9 (Ultrawide)", 2, 64);
    await row.locator(".rg-size-part").first().locator(".rg-btn.icon").click(); await page.waitForTimeout(60);
    check("swap: 9:21 portrait = 960 x 2240", JSON.stringify(await wv()) === "[960,2240]");
    // presets
    await modeBtn("Image size from the presets").click(); await page.waitForTimeout(60);
    const pre = row.locator("select.rg-size-pre");
    check("presets: the 9 starting sizes + Edit list…", await pre.locator("option:not([disabled])").count() === 10
        && (await pre.locator("option").last().textContent()) === "Edit list…");
    await pre.selectOption("1216x832"); await page.waitForTimeout(60);
    check("preset 1216 x 832", JSON.stringify(await wv()) === "[1216,832]");
    check("presets show their ratio", /1216 × 832\s+\(3:2\)/.test(await pre.locator("option[value='1216x832']").textContent()));
    await pre.selectOption("__edit__"); await page.waitForTimeout(100);
    const pop = page.locator(".rg-presets");
    check("Edit list… opens the editor, the choice stays", await pop.isVisible() && await pre.inputValue() === "1216x832");
    await pop.locator(".rg-presets-row").first().locator(".rg-presets-name").fill("square"); await pop.locator(".rg-presets-row").first().locator(".rg-presets-name").press("Tab");
    await pop.locator(".rg-presets-row").nth(1).locator("button", { hasText: "✕" }).click();
    await page.waitForTimeout(60);
    const setTxt = () => page.evaluate(() => window.__settings["RegionGenie.Size.Presets"]);
    check("editing saves to the shared Setting", /^1024x1024 square; 896x1152;/.test(await setTxt() || ""));
    await page.mouse.click(5, 5); await page.waitForTimeout(80);
    check("a click outside closes it", !await pop.isVisible());
    check("list follows the Setting (8 sizes, named one)", await pre.locator("option:not([disabled])").count() === 9
        && /square/.test(await pre.locator("option[value='1024x1024']").textContent()));
    // manual
    await modeBtn("Image size: width and height").click(); await page.waitForTimeout(60);
    const man = row.locator(".rg-size-part").nth(2), [wIn, hIn] = [man.locator("input").nth(0), man.locator("input").nth(1)];
    await wIn.fill("1000"); await wIn.press("Enter"); await hIn.fill("600"); await hIn.press("Enter"); await page.waitForTimeout(60);
    check("manual 1000 x 600", JSON.stringify(await wv()) === "[1000,600]");
    await man.locator('.rg-btn.icon[title^="Keep the ratio"]').click();
    await wIn.fill("500"); await wIn.press("Enter"); await page.waitForTimeout(60);
    check("keep ratio: 500 x 300", JSON.stringify(await wv()) === "[500,300]");
    await man.locator('.rg-btn.icon[title^="Swap"]').click(); await page.waitForTimeout(60);
    check("swap: 300 x 500", JSON.stringify(await wv()) === "[300,500]");
    // each mode keeps its own settings
    await modeBtn("Image size from the presets").click(); await page.waitForTimeout(60);
    const backToPreset = JSON.stringify(await wv());
    await modeBtn("Image size from an aspect ratio").click(); await page.waitForTimeout(60);
    check("modes keep their own settings", backToPreset === "[1216,832]" && JSON.stringify(await wv()) === "[960,2240]");
    const props = await page.evaluate(() => window.__node.properties.rg_size);
    check("kept in the node's properties (saved with the workflow)", props.mode === "aspect ratio" && props.manual.w === 300 && props.preset.w === 1216);

    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
