// Region opacity (round 72): the slider on the canvas's right edge sets how solid the regions' colors are drawn,
// with one value over a connected image (50% at first) and one without (100%); below 100% a line along each
// region's edge stays solid. The snap grid's lines. (headless Chromium, DPR 2)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check0 = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
async function run(browser, noGL) {
    const tag = noGL ? " [JavaScript]" : " [WebGL]";
    const check = (name, ok) => check0(name + tag, ok);
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1100 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    if (noGL) await page.addInitScript(() => { window.__rgNoEdgeGL = true; });
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
    const osl = page.locator(".rg-cv .rg-oslider"), opb = page.locator(".rg-cv .rg-opac > button");
    const title = () => opb.getAttribute("title");

    // one rectangle region, 64..192 in both directions
    await page.locator('button[title^="Add a region with a new color"]').click();
    let [x, y] = await toClient(64, 64); await page.mouse.move(x, y); await page.mouse.down();
    [x, y] = await toClient(192, 192); await page.mouse.move(x, y, { steps: 8 }); await page.mouse.up();
    await page.evaluate(() => { window.__node.__rgSetTool("select"); window.__node.__rgSelectLayer(-1); window.__node.properties.rg_labels = false; window.__node.__rgRefresh(); });
    await settle();
    const mixed = await px(128, 128), rim = await px(64.4, 128);
    check("no image: the opacity button is shown (its slider folded), at 80%", await opb.isVisible() && await osl.isHidden() && /^Region opacity: 80%/.test(await title()));
    await page.evaluate(() => { window.__node.properties.rg_fill = 1; window.__node.__rgRefresh(); }); await settle();
    const solid = await px(128, 128);
    check("no image, 100%: solid, edge and middle alike", near(await px(66, 128), solid, 2) && solid.some((v) => v > 60) && /^Region opacity: 100%/.test(await title()));
    check("no image, 80%: the middle is 80% of the color on black, the edge line the solid color", near(mixed, solid.map((v) => Math.round(v * 0.8)), 6) && near(rim, solid, 6));
    check("the tooltip explains the edge line, one item per line", /\n.*edge stays solid\.\nPoint here: The slider drops down\. A click keeps it open\.\nWheel: Change it\./.test(await title()));
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
    check("the lines were drawn by " + (noGL ? "JavaScript" : "the graphics card"), await page.evaluate(() => window.__node.__rgEdgeBy()) === (noGL ? "js" : "gl"));
    check("the line is thin: 3 image px inside the edge is see-through again", near(await px(67.5, 128), half, 8));

    // the slider: a click near the bottom, the wheel; the value belongs to the node and to "with an image"
    await opb.click(); await page.waitForTimeout(80);
    const ob = await osl.boundingBox();
    await page.mouse.click(ob.x + ob.width / 2, ob.y + ob.height * 0.9); await settle();
    check("clicking the slider's low end: 0%, only the lines remain", /^Region opacity: 0%/.test(await title()) && near(await px(128, 128), [255, 255, 255], 2) && near(await px(64.4, 128), solid, 6));
    await opb.hover(); await page.mouse.wheel(0, -100); await page.mouse.wheel(0, -100); await settle();
    check("the wheel over the slider steps by 5%", /^Region opacity: 10%/.test(await title()));
    check("the value is kept in the node's properties", await page.evaluate(() => window.__node.properties.rg_fill_image === 0.1 && window.__node.properties.rg_fill === 1));
    await page.evaluate(() => { window.__node.inputs = []; window.__node.__rgSetBackdrop(null); }); await settle();
    check("without the image again: still 100% and solid", /^Region opacity: 100%/.test(await title()) && near(await px(128, 128), solid, 2));

    // the grid: the magnet's menu, the grid without snapping, the lines' strength
    const rowMax = () => page.evaluate(async () => {            // the brightest pixel of one row across the empty top of the canvas
        const cv = document.querySelector(".rg-cv canvas"), [cx, cy] = window.__node.__rgToClient(0, 20), [dx] = window.__node.__rgToClient(256, 20), r = cv.getBoundingClientRect();
        const x0 = Math.round((cx - r.left) * cv.width / r.width) + 4, x1 = Math.round((dx - r.left) * cv.width / r.width) - 4, yy = Math.round((cy - r.top) * cv.height / r.height);
        const d = cv.getContext("2d").getImageData(x0, yy, x1 - x0, 1).data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i]); return m; });
    const magnet = page.locator('.rg-bar button[title^="Snap to grid"]');
    const menuRows = () => page.evaluate(() => [...document.querySelectorAll(".rg-menu .rg-menu-label")].map((x) => x.textContent));
    const pick = async (label) => { await page.locator(".rg-menu .rg-menu-label", { hasText: label }).first().click(); await settle(); };
    check("no grid lines while snap is off", await rowMax() < 20);
    await magnet.locator(".rg-grp-dd").click(); await page.waitForTimeout(150);
    check("the magnet's ▾ opens the grid's menu", JSON.stringify(await menuRows()) === JSON.stringify(["Grid", "Snap to grid", "Show the grid without snapping", "Grid lines", "Faint", "Normal", "Strong"]));
    await pick("Show the grid without snapping");
    let g = await rowMax();
    check("show the grid without snapping: lines at about 30% white, snap stays off", g >= 60 && g <= 95 && /^Snap to grid: Off/.test(await magnet.getAttribute("title")) && /shown without snapping/.test(await magnet.getAttribute("title")));
    await magnet.click({ button: "right" }); await page.waitForTimeout(150); await pick("Strong");
    g = await rowMax();
    check("grid lines: Strong (about 50% white), kept as a Setting", g >= 110 && g <= 145 && await page.evaluate(() => window.__settings["RegionGenie.Main.GridLines"]) === "strong");
    await magnet.click({ button: "right" }); await page.waitForTimeout(150); await pick("Faint");
    g = await rowMax(); check("grid lines: Faint (about 15% white)", g >= 28 && g <= 50);
    await magnet.click({ button: "right" }); await page.waitForTimeout(150); await pick("Normal");
    const [kx, ky] = await toClient(20, 20); await page.mouse.move(kx, ky); await page.keyboard.press("Shift+G"); await settle();
    check("Shift+G hides the grid again", await rowMax() < 20);
    await magnet.locator(".rg-grp-ic").click(); await settle();
    g = await rowMax();
    check("a click on the magnet still switches snap, and the grid shows", g >= 60 && g <= 95 && /^Snap to grid: On/.test(await magnet.getAttribute("title")));
    await page.close();
}
(async () => {
    const browser = await chromium.launch();
    await run(browser, false);
    await run(browser, true);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
