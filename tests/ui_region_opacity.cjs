// Region opacity (round 72): the slider on the canvas's right edge sets how solid the regions' colors are drawn,
// with one value over a connected image (50% at first) and one without (100%); below 100% a line along each
// region's edge stays solid. The snap grid's lines. (headless Chromium, DPR 2)
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
    const toClient = (x, y) => page.evaluate(([x, y]) => window.__node.__rgToClient(x, y), [x, y]);
    // the canvas's pixel under an image point
    const px = async (x, y) => { const [cx, cy] = await toClient(x, y); return page.evaluate(([cx, cy]) => {
        const cv = document.querySelector(".rg-cv canvas"), r = cv.getBoundingClientRect();
        const d = cv.getContext("2d").getImageData(Math.round((cx - r.left) * cv.width / r.width), Math.round((cy - r.top) * cv.height / r.height), 1, 1).data;
        return [d[0], d[1], d[2]]; }, [cx, cy]); };
    const near = (a, b, tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
    const settle = async () => { await page.mouse.move(880, 1090); await page.waitForTimeout(250); };
    const osl = page.locator(".rg-cv .rg-oslider");
    const title = () => osl.getAttribute("title");

    // one rectangle region, 64..192 in both directions
    await page.locator('button[title^="Add a region with a new color"]').click();
    let [x, y] = await toClient(64, 64); await page.mouse.move(x, y); await page.mouse.down();
    [x, y] = await toClient(192, 192); await page.mouse.move(x, y, { steps: 8 }); await page.mouse.up();
    await page.evaluate(() => { window.__node.__rgSetTool("select"); window.__node.__rgSelectLayer(-1); window.__node.properties.rg_labels = false; window.__node.__rgRefresh(); });
    await settle();
    const solid = await px(128, 128);
    check("no image: the slider is shown, at 100%", await osl.isVisible() && /^Region opacity: 100%/.test(await title()));
    check("no image: the region is drawn solid, edge and middle alike", near(await px(66, 128), solid, 2) && solid.some((v) => v > 60));
    check("the tooltip explains the edge line, one item per line", /\n.*edge stays solid\.\nDrag or wheel: Change it\./.test(await title()));

    // a white image under it: 50%, the middle is mixed with the image, the edge line is the solid color
    await page.evaluate(async () => {
        const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 64, 64);
        const img = new Image(); img.src = c.toDataURL(); await img.decode();
        window.__node.inputs = [{ name: "image", link: 7 }]; window.__node.__rgSetBackdrop(img);
    });
    await settle();
    check("with an image: 50%", /^Region opacity: 50%/.test(await title()));
    const mid = await px(128, 128), half = solid.map((v) => Math.round((v + 255) / 2));
    check("with an image: the image is shown at full strength next to the region", near(await px(32, 32), [255, 255, 255], 2));
    check("with an image: the region's middle is half its color, half the image", near(mid, half, 8));
    check("with an image: a line along the region's edge keeps the solid color", near(await px(64.4, 128), solid, 6) && near(await px(128, 191.6), solid, 6));
    check("the line is thin: 3 image px inside the edge is see-through again", near(await px(67.5, 128), half, 8));

    // the slider: a click near the bottom, the wheel; the value belongs to the node and to "with an image"
    const ob = await osl.boundingBox();
    await page.mouse.click(ob.x + ob.width / 2, ob.y + ob.height * 0.9); await settle();
    check("clicking the slider's low end: 0%, only the lines remain", /^Region opacity: 0%/.test(await title()) && near(await px(128, 128), [255, 255, 255], 2) && near(await px(64.4, 128), solid, 6));
    await osl.hover(); await page.mouse.wheel(0, -100); await page.mouse.wheel(0, -100); await settle();
    check("the wheel over the slider steps by 5%", /^Region opacity: 10%/.test(await title()));
    check("the value is kept in the node's properties", await page.evaluate(() => window.__node.properties.rg_fill_image === 0.1 && window.__node.properties.rg_fill === undefined));
    await page.evaluate(() => { window.__node.inputs = []; window.__node.__rgSetBackdrop(null); }); await settle();
    check("without the image again: still 100% and solid", /^Region opacity: 100%/.test(await title()) && near(await px(128, 128), solid, 2));

    // the snap grid: clearly visible lines on the black of an empty canvas (64 px grid: a line at x = 64 … none at 32)
    await page.locator('button[title^="Snap to grid: Off"]').click(); await settle();
    const gl = await page.evaluate(async () => {            // the brightest pixel of one row across the empty top of the canvas
        const cv = document.querySelector(".rg-cv canvas"), [cx, cy] = window.__node.__rgToClient(0, 20), [dx] = window.__node.__rgToClient(256, 20), r = cv.getBoundingClientRect();
        const x0 = Math.round((cx - r.left) * cv.width / r.width) + 4, x1 = Math.round((dx - r.left) * cv.width / r.width) - 4, yy = Math.round((cy - r.top) * cv.height / r.height);
        const d = cv.getContext("2d").getImageData(x0, yy, x1 - x0, 1).data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i]); return m; });
    check("a grid line on black is about 30% white", gl >= 60 && gl <= 95);

    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
