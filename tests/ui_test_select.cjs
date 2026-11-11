// Browser checks of the Select object tool against a stubbed server (headless Chromium, DPR 2)
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
    const status = () => page.evaluate(() => [...document.querySelectorAll(".rg-hint")].map((e) => e.textContent).join(" | "));
    async function clickImg(x, y, mods = []) {
        for (const m of mods) await page.keyboard.down(m);
        const [cx, cy] = await toClient(x, y);
        await page.mouse.click(cx, cy);
        for (const m of mods) await page.keyboard.up(m);
        await page.waitForTimeout(120);
    }
    async function dragImg(a, b) {
        let [x, y] = await toClient(...a); await page.mouse.move(x, y); await page.mouse.down();
        [x, y] = await toClient(...b); await page.mouse.move(x, y, { steps: 6 }); await page.mouse.up();
        await page.waitForTimeout(120);
    }
    const sent = () => page.evaluate(() => window.__fetches.filter(([u]) => u.includes("sam_")).map(([u, o]) => [u, JSON.parse(o.body)]));

    // the stub server: a rectangle mask around the first include point (or the box); "find" returns two objects
    await page.evaluate(() => {
        const runsOf = (w, h, fn) => { const r = []; let cur = 0, n = 0; for (let i = 0; i < w * h; i++) { const v = fn(i % w, Math.floor(i / w)) ? 1 : 0; if (v !== cur) { r.push(n); n = 0; cur = v; } n++; } r.push(n); return r; };
        window.__busyOnce = false;
        window.__apiHandlers["/region_genie/sam_select"] = async (b) => {
            if (window.__busyOnce) { window.__busyOnce = false; return [409, { error: "busy", code: "busy" }]; }
            const [w, h] = b.size;
            if (b.text) {
                return [200, { ok: true, w, h, masks: [
                    { runs: runsOf(w, h, (x, y) => x < w * 0.25 && y < h * 0.25), score: 0.9, label: "cat", area: 1 },
                    { runs: runsOf(w, h, (x, y) => x > w * 0.75 && y > h * 0.75), score: 0.8, label: "dog", area: 1 }] }];
            }
            let [x0, y0, x1, y1] = b.box || [0, 0, 0, 0];
            if (!b.box) { const p = b.points.find((q) => q[2] === 1); [x0, y0, x1, y1] = [p[0] - 0.1, p[1] - 0.1, p[0] + 0.1, p[1] + 0.1]; }
            return [200, { ok: true, w, h, masks: [{ runs: runsOf(w, h, (x, y) => x >= x0 * w && x < x1 * w && y >= y0 * h && y < y1 * h), score: null, label: "", area: 1 }] }];
        };
    });

    const objBtn = page.locator('.rg-bar .rg-btn.icon[title^="Select object"]');
    check("Select object button", await objBtn.count() === 1);
    await page.keyboard.press("q").catch(() => {});
    await objBtn.click();
    const findIn = page.locator(".rg-bar .rg-find");
    check("find field shown with the tool", await findIn.isVisible());
    // no image yet
    await clickImg(64, 64);
    check("without an image: hint, no request", /needs an image/.test(await status()) && (await sent()).length === 0);

    await page.evaluate(async () => {
        const c = document.createElement("canvas"); c.width = 256; c.height = 256;
        const x = c.getContext("2d"); x.fillStyle = "#335"; x.fillRect(0, 0, 256, 256);
        const img = new Image(); img.src = c.toDataURL(); await img.decode();
        window.__node.inputs = [{ name: "image", link: 7 }];
        window.__node.__rgSetBackdrop(img, { filename: "photo.png", subfolder: "sub", type: "input" });
    });
    await page.locator(".rg-head .rg-btn.icon").first().click();           // a region to add to
    await objBtn.click();
    await clickImg(64, 64);
    await page.waitForTimeout(150);
    let s = await sent();
    const b0 = s.at(-1)?.[1];
    check("click sends one include point, normalized, with the image", b0 && b0.points.length === 1 && b0.points[0][2] === 1
        && Math.abs(b0.points[0][0] - 0.25) < 0.01 && b0.image.filename === "photo.png" && b0.image.subfolder === "sub");
    check("request: raster size, Settings model, keep loaded", b0.size[0] === 256 && b0.model === "sam3.1_multiplex_fp16.safetensors" && b0.keep_loaded === true);
    check("status: how to go on", /Enter: add/.test(await status()));
    const px = await page.evaluate(() => { const c = document.querySelector(".rg-cv canvas"), n = window.__node.__rgView(); const d = c.getContext("2d").getImageData(Math.round(n.x + 64 * n.z), Math.round(n.y + 64 * n.z), 1, 1).data; return [...d]; });
    check("selection shown on the canvas (tinted)", px[0] !== 0x33 || px[1] !== 0x33);
    await clickImg(200, 200, ["Control"]);
    s = await sent();
    check("Ctrl+click adds an exclude point", s.at(-1)[1].points.length === 2 && s.at(-1)[1].points[1][2] === 0);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(150);
    s = await sent();
    check("Backspace removes the last point and asks again", s.at(-1)[1].points.length === 1);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    s = await st();
    const L = s.layers.find((l) => l.name.startsWith("Object"));
    check("Enter adds the object as a layer of the active region", L && L.region === s.regions[0].id && L.ops[0].t === "bitmap");
    check("no release call while kept loaded… (sent anyway, keep_loaded true)", (await sent()).filter(([u]) => u.includes("release")).every(([, b]) => b.keep_loaded === true));

    // box
    await dragImg([150, 150], [220, 230]);
    s = await sent();
    const bb = s.at(-1)[1];
    check("drag sends a box", bb.box && Math.abs(bb.box[0] - 150 / 256) < 0.01 && Math.abs(bb.box[3] - 230 / 256) < 0.01 && bb.points.length === 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    check("Esc cancels (nothing added)", (await st()).layers.filter((l) => l.name.startsWith("Object")).length === 1);
    check("Esc sends release", (await sent()).at(-1)[0].includes("sam_release"));

    // unload setting
    await page.evaluate(() => { window.__settings["RegionGenie.Select.KeepLoaded"] = "unload"; });
    await clickImg(100, 100);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    s = await sent();
    check("unload setting: request and release say so", s.at(-2)[1].keep_loaded === false && s.at(-1)[0].includes("release") && s.at(-1)[1].keep_loaded === false);
    await page.evaluate(() => { window.__settings["RegionGenie.Select.KeepLoaded"] = "keep loaded"; });

    // busy: waits and asks again
    await page.evaluate(() => { window.__busyOnce = true; });
    const n0 = (await sent()).length;
    await clickImg(120, 120);
    check("busy: says it waits", /waits while a workflow is running/.test(await status()));
    await page.waitForTimeout(2300);
    check("busy: asks again by itself", (await sent()).length >= n0 + 2 && /Enter: add/.test(await status()));
    await page.keyboard.press("Escape");

    // find all
    await findIn.fill("cat, dog");
    await findIn.press("Enter");
    await page.waitForTimeout(200);
    s = await sent();
    check("find sends the text", s.at(-1)[1].text === "cat, dog" && s.at(-1)[1].points.length === 0 && s.at(-1)[1].threshold === 0.5);
    check("find: count shown", /Found 2/.test(await status()));
    await clickImg(230, 230, ["Control"]);
    check("Ctrl+click leaves one out", /1 kept/.test(await status()));
    await clickImg(230, 230, ["Control"]);
    check("Ctrl+click again brings it back", /Found 2:/.test(await status()) && !/kept/.test(await status()));
    const nReg = (await st()).regions.length;
    await page.keyboard.down("Shift"); await page.keyboard.press("Enter"); await page.keyboard.up("Shift");
    await page.waitForTimeout(150);
    s = await st();
    check("Shift+Enter: one new region each, named by what was found", s.regions.length === nReg + 2 && s.regions.slice(0, 2).map((r) => r.prompt).sort().join() === "cat,dog");
    check("find field cleared after adding", await findIn.inputValue() === "");
    // switching tools cancels
    await findIn.fill("cat"); await findIn.press("Enter"); await page.waitForTimeout(150);
    await page.locator('.rg-bar .rg-btn.icon[title^="Brush"]').click();
    await page.waitForTimeout(100);
    check("another tool cancels the selection", !/Found/.test(await status()) && (await sent()).at(-1)[0].includes("release"));
    // the error the server gives for a missing model reaches the user
    await page.evaluate(() => { window.__apiHandlers["/region_genie/sam_select"] = async () => [404, { error: "Select object needs the SAM 3.1 model: put …", code: "no_model" }]; });
    await objBtn.click();
    await clickImg(80, 80);
    check("missing model: the server's message is shown", /needs the SAM 3.1 model/.test(await status()));
    const ids = await page.evaluate(() => window.__settingsExt.settings.map((s) => s.id));
    check("Settings: Select object entries", ["RegionGenie.Select.Model", "RegionGenie.Select.KeepLoaded", "RegionGenie.Select.Threshold"].every((i) => ids.includes(i)));
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
