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
    const settle = async () => { await page.mouse.move(880, 1090); await page.waitForTimeout(noGL ? 250 : 900); };     // WebGL without a graphics card is slow here: the lines come once the canvas rests
    const osl = page.locator(".rg-cv .rg-oslider"), opb = page.locator(".rg-cv .rg-opac > button");
    const title = () => opb.getAttribute("title");

    // one rectangle region, 64..192 in both directions
    await page.locator('button[title^="Add a region with a new color"]').click();
    let [x, y] = await toClient(64, 64); await page.mouse.move(x, y); await page.mouse.down();
    [x, y] = await toClient(192, 192); await page.mouse.move(x, y, { steps: 8 }); await page.mouse.up();
    await page.evaluate(() => { window.__node.__rgSetTool("select"); window.__node.__rgSelectLayer(-1); window.__node.properties.rg_labels = false; window.__node.__rgRefresh(); });
    await settle();
    const mixed = await px(128, 128), rim = await px(64.4, 128);
    check("no image: the opacity button is shown (its slider folded), at 50%", await opb.isVisible() && await osl.isHidden() && /^Region opacity: 50%/.test(await title()));
    await page.evaluate(() => { window.__node.properties.rg_fill = 1; window.__node.__rgRefresh(); }); await settle();
    const solid = await px(128, 128);
    check("no image, 100%: solid, edge and middle alike", near(await px(66, 128), solid, 2) && solid.some((v) => v > 60) && /^Region opacity: 100%/.test(await title()));
    check("no image, 50%: the middle is half the color on black, the edge line the solid color", near(mixed, solid.map((v) => Math.round(v * 0.5)), 6) && near(rim, solid, 6));
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

    // a second region inside the first (100..150). Each region is outlined along its own shape, so the first one
    // gets no line around the one lying on it (without WebGL the simple lines still follow it)
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const newRegion = async (a, b) => {
        await page.locator('button[title^="Add a region with a new color"]').click();
        [x, y] = await toClient(...a); await page.mouse.move(x, y); await page.mouse.down();
        [x, y] = await toClient(...b); await page.mouse.move(x, y, { steps: 8 }); await page.mouse.up();
        await page.evaluate(() => { window.__node.__rgSetTool("select"); window.__node.__rgSelectLayer(-1); });
        return rgb(await page.evaluate(() => { const s = window.__node.__rgState(); return s.regions.find((r) => r.id === s.layers[s.layers.length - 1].region).color; }));
    };
    const edge = async (v) => { await page.evaluate((v) => { window.__settings["RegionGenie.Main.EdgeLine"] = v; window.__node.__rgRefresh(); }, v); await settle(); };
    const inner = await newRegion([100, 100], [150, 150]);
    await page.evaluate(() => { window.__node.properties.rg_fill = 0.5; window.__node.__rgRefresh(); }); await settle();
    const dim = solid.map((v) => Math.round(v / 2));
    check("the region on top has its line", near(await px(100.5, 125), inner, 8) && near(await px(125, 149.5), inner, 8));
    if (noGL) check("simple lines: the outer region's line follows the inner one, corners too", near(await px(99.6, 125), solid, 6) && near(await px(99.6, 99.6), solid, 6));
    else check("the region under it has no line around it (its shape goes on underneath)", near(await px(99.3, 125), dim, 8) && near(await px(99.3, 99.3), dim, 8) && near(await px(125, 150.7), dim, 8));
    check("…and keeps the line along its own edge", near(await px(64.5, 125), solid, 6));
    // two regions that only touch (the first one's right edge, x = 192) both keep their lines
    const side = await newRegion([192, 70], [200, 180]); await settle();
    check("two regions that touch both keep their lines", near(await px(191.4, 125), solid, 8) && near(await px(192.6, 125), side, 8));
    if (!noGL) {
        const half = side.map((v) => Math.round(v / 2));
        check("the line is 3.5 px wide at first: see-through 4 image px in", near(await px(196, 125), half, 8));
        await edge(30);
        check("the width stops at 10 px; a line wider than half the shape fills it (10 px on an 18 px wide region)", near(await px(196, 125), side, 8) && near(await px(64 + 6.5, 125), dim, 8));
        await edge(0);
        check("0: no line", near(await px(192.6, 125), half, 8) && near(await px(64.5, 125), dim, 8));
        await edge(3.5);
    }
    await page.evaluate(() => { window.__node.properties.rg_fill = 1; window.__node.__rgRefresh(); }); await settle();

    // labels: the text size Setting, growing with the zoom but never under the set size, no box behind them
    const set = async (id, v) => { await page.evaluate(([id, v]) => { window.__settings[id] = v; window.__node.__rgRefresh(); }, [id, v]); await settle(); };
    await page.evaluate(() => { const s = window.__node.__rgState(); s.regions.forEach((r) => { r.prompt = "castle"; }); window.__node.properties.rg_labels = true; window.__node.__rgRefresh(); }); await settle();
    const labH = () => page.evaluate(() => { const l = window.__node.__rgLabels().find((r) => r.inside); return l ? Math.round(l.y1 - l.y0) : 0; });
    const h11 = await labH();
    check("labels inside the regions, without a plate", h11 > 0 && await page.evaluate(() => window.__node.__rgLabels().filter((r) => r.inside).every((r) => !r.plate)));
    await set("RegionGenie.Main.LabelSize", 22);
    const h22 = await labH();
    check(`the text size Setting doubles the label (${h11} -> ${h22} px high)`, Math.abs(h22 - 2 * h11) <= 3);
    await set("RegionGenie.Main.LabelSize", 11);
    const [zx, zy] = await toClient(128, 128); await page.mouse.move(zx, zy);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100); await settle();
    const zIn = await page.evaluate(() => window.__node.__rgView().z), hIn = await labH();
    await page.keyboard.press("Home"); await settle();
    const zFit = await page.evaluate(() => window.__node.__rgView().z);
    check(`zooming in enlarges the text with the image (zoom x${(zIn / zFit).toFixed(2)}: ${h11} -> ${hIn})`, zIn > zFit * 1.2 && Math.abs(hIn / h11 - zIn / zFit) < 0.15);
    await page.mouse.move(zx, zy); for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 100); await settle();
    const zOut = await page.evaluate(() => window.__node.__rgView().z), hOut = await labH();
    check(`zooming out never makes it smaller than the set size (zoom x${(zOut / zFit).toFixed(2)}: ${hOut})`, zOut < zFit * 0.9 && (hOut === 0 || Math.abs(hOut - h11) <= 1));
    await page.keyboard.press("Home"); await settle();
    // the shadow: a dark halo next to the white text; none with size 0 or strength 0
    const halo = () => page.evaluate(() => { const l = window.__node.__rgLabels().find((r) => r.inside), cv = document.querySelector(".rg-cv canvas"), c = cv.getContext("2d");
        const d = c.getImageData(Math.round(l.x0), Math.round(l.y0), Math.round(l.x1 - l.x0), Math.round(l.y1 - l.y0)).data; let m = 255; for (let i = 0; i < d.length; i += 4) m = Math.min(m, d[i] + d[i + 1] + d[i + 2]); return m; });
    await page.evaluate(() => { window.__node.properties.rg_fill = 1; window.__node.__rgRefresh(); }); await settle();
    const h0 = await halo(); await set("RegionGenie.Main.LabelShadow", 0); const hNone = await halo();
    await set("RegionGenie.Main.LabelShadow", 4); await set("RegionGenie.Main.LabelShadowStrength", 0); const hOff = await halo();
    await set("RegionGenie.Main.LabelShadowStrength", 300); const hStrong = await halo(); await set("RegionGenie.Main.LabelShadowStrength", 100);
    check(`the shadow darkens what is around the text; size 0 or strength 0 removes it; 300% is darker (${h0}, ${hNone}, ${hOff}, ${hStrong})`, h0 < hNone - 25 && Math.abs(hNone - hOff) < 12 && hStrong < h0 - 10);
    await page.evaluate(() => { window.__node.properties.rg_labels = false; window.__node.__rgRefresh(); }); await settle();

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
