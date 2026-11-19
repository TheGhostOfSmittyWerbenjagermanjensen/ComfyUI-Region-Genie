// Browser checks of round 34 (region row declutter, layout B): the row keeps what is used all the time and the prompt
// gets the room; feather, palette, merge, move and delete are on the options line of the opened region.
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
    const box = async (a, b, c, d) => {
        let [x, y] = await toClient(a, b); await page.mouse.move(x, y); await page.mouse.down();
        [x, y] = await toClient(c, d); await page.mouse.move(x, y, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(120);
    };
    const add = page.locator('[title^="Add a region with a new color"]');
    const all = page.locator('[title^="Show or hide everything in the list"]');
    const rows = page.locator(".rg-row.region"), opts = page.locator(".rg-row.opts");

    // three regions: two drawn, one left without a layer
    // (the stub node's image is 256 px wide)
    await add.click(); await page.waitForTimeout(100); await box(20, 20, 100, 100);
    await add.click(); await page.waitForTimeout(100); await box(140, 140, 230, 230);
    await add.click(); await page.waitForTimeout(100);
    check("three regions, two with a layer", (await st()).regions.length === 3 && await rows.count() === 3 && (await st()).layers.length === 2);
    // close everything
    await all.click(); await page.waitForTimeout(80);
    if (await opts.count()) { await all.click(); await page.waitForTimeout(80); }
    check("closed: no options line", await opts.count() === 0);

    // ---- the row itself
    const inRow = await page.evaluate(() => [...document.querySelectorAll(".rg-row.region")].map((r) => ({
        feather: !!r.querySelector(".rg-feather"), del: [...r.querySelectorAll("button")].some((b) => b.textContent.trim() === "✕"),
        move: [...r.querySelectorAll("button")].some((b) => ["↑", "↓", "⇊"].includes(b.textContent.trim())),
        lora: [...r.querySelectorAll("button")].some((b) => b.textContent.trim() === "＋LoRA"), llm: !!r.querySelector(".rg-llm-btn"),
        cnt: !!r.querySelector(".rg-cnt"), eye: !!r.querySelector(".rg-reye"), type: !!r.querySelector("select"),
        w: r.querySelector(".rg-pwrap").getBoundingClientRect().width / r.getBoundingClientRect().width })));
    check("the row keeps show / hide, type, prompt, LLM, the layer count and ＋LoRA", inRow.every((r) => r.eye && r.type && r.llm && r.cnt && r.lora));
    check("the row no longer holds feather, merge, move or delete", inRow.every((r) => !r.feather && !r.del && !r.move));
    check(`the prompt takes more than half of the row (${inRow.map((r) => Math.round(r.w * 100) + "%").join(", ")})`, inRow.every((r) => r.w > 0.5));

    // ---- ▶ opens a region: its options line comes first, also for a region without layers
    const chev = (i) => rows.nth(i).locator(".rg-chev");
    check("every region can be opened, also one without layers", await page.evaluate(() => [...document.querySelectorAll(".rg-row.region .rg-chev")].every((c) => !c.classList.contains("empty") && c.textContent === "▶")));
    await chev(0).click(); await page.waitForTimeout(80);
    check("a region without layers opens to its options line", await opts.count() === 1 && await page.locator(".rg-row.sub").count() === 0);
    await chev(0).click(); await chev(1).click(); await page.waitForTimeout(80);
    const line = await page.evaluate(() => { const o = document.querySelector(".rg-row.opts"); return { after: o.previousElementSibling.classList.contains("region"), before: o.nextElementSibling?.classList.contains("sub"),
        words: [...o.querySelectorAll(".rg-word")].map((w) => w.textContent), tips: [...o.querySelectorAll(".rg-word")].every((w) => w.title),
        btns: [...o.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean), feather: !!o.querySelector(".rg-feather input") }; });
    check("the options line sits between the region's row and its Layers header", line.after && line.before);
    check(`it holds feather, palette, merge, move and delete (${line.words.join(", ")}; ${line.btns.join(" ")})`, line.feather && line.words.join("|") === "feather|palette" && line.tips && ["⇊", "↑", "↓", "✕"].every((b) => line.btns.includes(b)));

    // ---- they work from there
    const rid = (await st()).regions[1].id;
    const f = opts.locator(".rg-feather input"); await f.fill("12"); await f.dispatchEvent("change"); await page.waitForTimeout(80);
    check("feather set on the options line", (await st()).feather === 12);
    await opts.locator('button[title^="Color palette"]').click(); await page.waitForTimeout(150); await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    check("palette switched on from the options line; its section shows under it", (await st()).regions.find((r) => r.id === rid).paletteOn === true && await page.locator(".rg-row.sub", { hasText: "Color palette" }).count() === 1);
    await opts.locator("button", { hasText: "↓" }).click(); await page.waitForTimeout(100);
    check("↓ moves the region down, and it stays open", (await st()).regions[2].id === rid && await opts.count() === 1);
    await opts.locator("button", { hasText: "✕" }).click(); await page.waitForTimeout(100);
    check("✕ deletes the region and its layers", (await st()).regions.length === 2 && !(await st()).regions.some((r) => r.id === rid));
    const [cx, cy] = await toClient(120, 120); await page.mouse.move(cx, cy); await page.keyboard.press("Control+z"); await page.waitForTimeout(120);
    check("Ctrl+Z brings it back", (await st()).regions.length === 3);

    // ---- ▼ All opens every region (each has its options line), again closes them
    await all.click(); await page.waitForTimeout(80);
    if (await opts.count() !== 3) { await all.click(); await page.waitForTimeout(80); }
    check("▼ All opens every region, also the one without layers", await opts.count() === 3);
    await all.click(); await page.waitForTimeout(80);
    check("▼ All again closes them", await opts.count() === 0);

    await chev(1).click(); await page.waitForTimeout(80);
    await page.screenshot({ path: require("path").join(__dirname, "out", "ui_region_rows.png"), fullPage: false });
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
