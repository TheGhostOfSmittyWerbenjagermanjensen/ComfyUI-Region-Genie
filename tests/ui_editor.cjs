// Browser checks of the round 5 UI in region_genie.js / rg_shared.js (headless Chromium, DPR 2)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1100 } });
    page.on("pageerror", (e) => fails.push("page error: " + e.message) && console.log("PAGE ERROR", e.message));
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    // lasso starts as set in Settings (spline), and follows a Settings change
    const lassoTitle = () => page.evaluate(() => [...document.querySelectorAll(".rg-bar .rg-btn.icon")].map((b) => b.title).find((t) => t.startsWith("Lasso:") || t.startsWith("Lasso (")));
    check("lasso starts as the Settings default (spline)", /^Lasso \(spline\)/.test(await lassoTitle()));
    await page.evaluate(() => window.__settingsExt.setup());
    const cacheCalls = await page.evaluate(() => window.__fetches.filter(([u]) => u.includes("llm_cache_config")).map(([, o]) => JSON.parse(o.body)));
    check("setup tells the server the LLM cache settings (disk off by default)", cacheCalls.length === 1 && cacheCalls[0].disk === false && cacheCalls[0].days === 30 && cacheCalls[0].max === 500);
    await page.evaluate(() => window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.Lasso").onChange("plain"));
    check("changing the lasso setting switches the button", /^Lasso: Straight/.test(await lassoTitle()));
    await page.evaluate(() => window.__settingsExt.settings.find((s) => s.id === "RegionGenie.LLM.CacheOnDisk").onChange(true));
    const last = await page.evaluate(() => JSON.parse(window.__fetches.filter(([u]) => u.includes("llm_cache_config")).pop()[1].body));
    check("turning disk caching on is sent to the server", last.disk === true);
    const ids = await page.evaluate(() => window.__settingsExt.settings.map((s) => s.id));
    check("new Settings are registered", ["RegionGenie.Tools.Lasso", "RegionGenie.Tools.LassoErase", "RegionGenie.LLM.CacheOnDisk",
        "RegionGenie.LLM.CacheDays", "RegionGenie.LLM.CacheMaxEntries", "RegionGenie.Edit.MaskGrow", "RegionGenie.Edit.MaskFeather",
        "RegionGenie.Main.ShareBackground", "RegionGenie.RegionalLoRAs.ShareBackground"].every((i) => ids.includes(i)));

    // Whole image row: a click anywhere on it (not its buttons) opens it; empty -> a hint row
    const sceneLabel = page.locator(".rg-row.scene .rg-pseudo");
    await sceneLabel.click();
    check("click on the Whole image row opens it (hint when empty)", await page.locator(".rg-list .rg-row.lora .rg-hint", { hasText: "No whole-image LoRAs yet" }).count() === 1);
    await page.locator(".rg-row.scene").click({ position: { x: 300, y: 5 } });
    check("a second click closes it", await page.locator(".rg-list .rg-hint", { hasText: "No whole-image LoRAs yet" }).count() === 0);
    await page.locator(".rg-row.scene .rg-llm-btn").click();
    check("the sparkle button doesn't toggle the row", await page.locator(".rg-list .rg-hint", { hasText: "No whole-image LoRAs yet" }).count() === 0);

    // Edit Mode: keep toggle, header grow / feather, hatching
    check("grow / feather hidden in generate", await page.locator(".rg-editmask").isHidden());
    await page.locator(".rg-head .rg-btn.icon").first().click();          // add a region
    await page.evaluate(() => {
        const st = window.__node.__rgState();
        st.layers.push({ id: 1, name: "Rect 1", region: st.regions[0].id, visible: true, shape: "rect", sides: 5, bw: 0.5, bh: 0.5, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, ops: [] });
    });
    check("no keep toggle in generate", await page.locator(".rg-row.region button[title^='Change (Edit Mode)']").count() === 0);
    const modeBtn = (t) => page.locator(".rg-settings .rg-seg button", { hasText: t });
    await modeBtn("Edit").click();
    await page.waitForTimeout(150);
    check("keep toggle shows in Edit Mode (pencil = change)", await page.locator(".rg-row.region button[title^='Change (Edit Mode)']").count() === 1);
    check("grow / feather shown in Edit Mode", await page.locator(".rg-editmask").isVisible());
    const ph = await page.locator(".rg-editmask input").evaluateAll((els) => els.map((e) => [e.placeholder, e.value]));
    check("grow / feather empty with the Settings defaults as placeholders", JSON.stringify(ph) === JSON.stringify([["8", ""], ["16", ""]]));
    const cvBefore = await page.evaluate(() => { const c = document.querySelector(".rg-cv canvas"); return c.toDataURL(); });
    await page.locator(".rg-row.region button[title^='Change (Edit Mode)']").click();
    await page.waitForTimeout(200);
    const st = await page.evaluate(() => window.__node.__rgState().regions[0]);
    check("click sets the region to keep", st.keep === true);
    check("the toggle now shows the lock", await page.locator(".rg-row.region button.on[title^='Keep (Edit Mode)']").count() === 1);
    // hatching: some pixels in the kept rectangle are dark stripes, others light
    const px = await page.evaluate(() => {
        const c = document.querySelector(".rg-cv canvas"), x = c.getContext("2d");
        const n = window.__node.__rgView(), cxs = n.x + 128 * n.z, cys = n.y + 128 * n.z;
        const d = x.getImageData(Math.round(cxs - 20), Math.round(cys - 40), 40, 1).data;     // a strip above the label
        const lum = []; for (let i = 0; i < d.length; i += 4) lum.push(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
        return { min: Math.min(...lum), max: Math.max(...lum) };
    });
    check("kept region is hatched on the canvas", px.max - px.min > 60);
    check("canvas changed after keep", cvBefore !== await page.evaluate(() => document.querySelector(".rg-cv canvas").toDataURL()));
    const growIn = page.locator(".rg-editmask input").first();
    await growIn.fill("5"); await growIn.press("Tab");
    const sent = await page.evaluate(() => JSON.parse(window.__node.widgets.find((w) => w.name === "paint_data").serializeValue()));
    check("grow typed -> saved on the node", JSON.stringify(sent.editMask) === JSON.stringify({ grow: 5, feather: 16 }));
    check("run data: edit settings and LLM cache settings sent", !!sent.edit && sent.llmCache?.disk === false);
    check("region keep saved", sent.regions[0].keep === true);
    await growIn.fill(""); await growIn.press("Tab");
    const sent2 = await page.evaluate(() => JSON.parse(window.__node.widgets.find((w) => w.name === "paint_data").serializeValue()));
    const own = await page.evaluate(() => window.__node.__rgState().editMask || null);
    check("emptying grow follows Settings again", sent2.editMask.grow === 8 && own === null);
    const lbl = await page.evaluate(() => window.__node.__rgLabels().length);
    check("label drawn", lbl === 1);

    // shared background: right-click menu on the four-tiles button
    const tiles = page.locator(".rg-loraopts > button.rg-apart");
    await tiles.click({ button: "right" });
    const items = await page.evaluate(() => window.__lastMenu.items.map((i) => i.content));
    check("right-click menu: keep apart, automatic, off, share the background", items.length === 4 && /Keep all regions apart/.test(items[0]) && /^✓ Automatic/.test(items[1]) && /Off for this node/.test(items[2]) && /Share the background/.test(items[3]));
    await page.evaluate(() => window.__lastMenu.opts.callback(window.__lastMenu.items[3]));
    const opts = await page.evaluate(() => window.__node.__rgState().loraOpts);
    check("Share the background turns on (keep-apart unchanged)", opts.shareBg === true && !opts.allRegions);
    check("icon shows the shaded backdrop", (await tiles.innerHTML()).includes('opacity=".32"'));
    await tiles.click({ button: "right" });
    check("menu marks it as on", (await page.evaluate(() => window.__lastMenu.items[3].content)).startsWith("✓"));
    await page.evaluate(() => window.__lastMenu.opts.callback(window.__lastMenu.items[0]));
    check("Keep all regions apart from the menu", (await page.evaluate(() => window.__node.__rgState().loraOpts)).allRegions === true);
    await tiles.click();
    check("plain click still toggles keep-apart", !(await page.evaluate(() => window.__node.__rgState().loraOpts)).allRegions);
    // the button is a real switch, also when the last run turned 'keep all regions apart' on by itself
    const lo = () => page.evaluate(() => window.__node.__rgState().loraOpts || {});
    const lit = () => tiles.evaluate((b) => b.classList.contains("on"));
    check("off on the node: autoOff is saved, the button is off", (await lo()).autoOff === true && !(await lit()));
    await tiles.click({ button: "right" });
    await page.evaluate(() => window.__lastMenu.opts.callback(window.__lastMenu.items[1]));         // Automatic
    check("menu > Automatic: neither on nor off for this node", !(await lo()).autoOff && !(await lo()).allRegions && !(await lit()));
    await page.evaluate(() => window.__node.onExecuted({ auto_apart: [true] })); await page.waitForTimeout(80);
    check("a run turned it on by itself: the button is lit and says so", await lit() && /ON automatically in the last run/.test(await tiles.getAttribute("title")));
    await tiles.click(); await page.waitForTimeout(80);
    const sentOff = await page.evaluate(() => JSON.parse(window.__node.widgets.find((w) => w.name === "paint_data").serializeValue()).loraOpts);
    check("clicking it then switches it off (it used to stay lit): off, autoOff sent with the run", !(await lit()) && sentOff.autoOff === true && !sentOff.allRegions
        && /OFF for this node/.test(await tiles.getAttribute("title")));
    await tiles.click(); await page.waitForTimeout(80);
    check("and on again: on for this node", await lit() && (await lo()).allRegions === true && !(await lo()).autoOff);
    await tiles.click({ button: "right" });
    await page.evaluate(() => window.__lastMenu.opts.callback(window.__lastMenu.items[1]));         // back to Automatic
    await page.evaluate(() => window.__node.onExecuted({ auto_apart: [false] })); await page.waitForTimeout(80);
    check("back to automatic, and the next run without it: off", !(await lit()) && !(await lo()).autoOff && !(await lo()).allRegions);

    await page.locator(".rg-row.scene .rg-pseudo").click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: require("path").join(__dirname, "out", "ui_edit.png"), clip: { x: 0, y: 380, width: 700, height: 620 } });
    // back to generate: toggles and grow / feather hide, keep flag stays saved
    await modeBtn("Generate").click();
    await page.waitForTimeout(150);
    check("generate: keep toggle and grow / feather hidden", await page.locator(".rg-row.region button[title^='Keep (Edit Mode)']").count() === 0 && await page.locator(".rg-editmask").isHidden());
    // ---- round 29: Alt+drag on a resize handle resizes from the centre
    const setRect = () => page.evaluate(async () => { const n = window.__node, s = n.__rgState();
        s.regions = [{ id: 1, color: "#E6194B", prompt: "", type: "object", text: "" }];
        s.layers = [{ id: 1, name: "R", region: 1, visible: true, shape: "rect", sides: 5, bw: 0.4, bh: 0.3, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, ops: [] }];
        n.__rgRefresh(); n.__rgSetTool("select"); n.__rgSelectLayer(1); await new Promise((r) => setTimeout(r, 150)); });
    const boxOf = () => page.evaluate(() => { const c = window.__node.__rgBox(); const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
        return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
    const pull = async (pick, dx, dy, mods = []) => {
        const hs = await page.evaluate(() => window.__node.__rgHandles().filter((h) => h.kind === "scale").map((h) => h.at));
        const h = pick(hs);
        for (const m of mods) await page.keyboard.down(m);
        await page.mouse.move(h[0], h[1]); await page.mouse.down(); await page.mouse.move(h[0] + dx, h[1] + dy, { steps: 5 }); await page.mouse.up();
        for (const m of mods) await page.keyboard.up(m);
        await page.waitForTimeout(100);
    };
    const corner = (hs) => hs.reduce((a, b) => (b[0] + b[1] > a[0] + a[1] ? b : a));          // bottom right
    const rightMid = (hs) => { const ys = hs.map((h) => h[1]), my = (Math.min(...ys) + Math.max(...ys)) / 2; return hs.filter((h) => Math.abs(h[1] - my) < 2).reduce((a, b) => (b[0] > a[0] ? b : a)); };
    const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
    await setRect(); const b0 = await boxOf(), c0 = [(b0.x0 + b0.x1) / 2, (b0.y0 + b0.y1) / 2];
    await pull(corner, 30, 20); const b1 = await boxOf();
    check("resize without Alt: the opposite corner stays, the dragged corner moves", near(b1.x0, b0.x0) && near(b1.y0, b0.y0) && b1.x1 > b0.x1 + 5 && b1.y1 > b0.y1 + 5);
    await setRect(); await pull(corner, 30, 20, ["Alt"]); const b2 = await boxOf();
    check("Alt+drag a corner: the centre stays, both sides move the same amount", near((b2.x0 + b2.x1) / 2, c0[0]) && near((b2.y0 + b2.y1) / 2, c0[1])
        && b2.x1 > b0.x1 + 5 && near(b2.x1 - b0.x1, b0.x0 - b2.x0) && near(b2.y1 - b0.y1, b0.y0 - b2.y0) && near(b2.x1 - b0.x1, b1.x1 - b0.x1));
    await setRect(); await pull(corner, 30, 20, ["Alt", "Shift"]); const b3 = await boxOf();
    check("Alt+Shift: from the centre, proportions kept", near((b3.x0 + b3.x1) / 2, c0[0]) && near((b3.y0 + b3.y1) / 2, c0[1]) && Math.abs((b3.x1 - b3.x0) / (b3.y1 - b3.y0) - 0.4 / 0.3) < 0.02 && b3.x1 > b0.x1 + 5);
    await setRect(); await pull(rightMid, -25, 0, ["Alt"]); const b4 = await boxOf();
    check("Alt+drag a side handle: that side and the opposite one move, the height stays", near((b4.x0 + b4.x1) / 2, c0[0]) && b4.x1 < b0.x1 - 5 && near(b0.x1 - b4.x1, b4.x0 - b0.x0) && near(b4.y0, b0.y0) && near(b4.y1, b0.y1));
    await page.keyboard.press("Control+z"); await page.waitForTimeout(100);
    check("one undo step puts the size back", near((await boxOf()).x1, b0.x1));
    await page.screenshot({ path: require("path").join(__dirname, "out", "ui.png"), fullPage: false });
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
