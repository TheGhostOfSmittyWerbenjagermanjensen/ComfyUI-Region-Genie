// Smoke test in the real ComfyUI frontend (1.58.5) + server (0.45, CPU, random-weight SAM 3.1 fixture).
// Usage: node real_smoke.cjs [vue]   ("vue" = Nodes 2.0)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const vue = process.argv[2] === "vue";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && /region|rg_|genie/i.test(m.text())) errors.push(m.text()); });
    await page.goto("http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await page.waitForTimeout(2000);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
    await page.evaluate(async () => { try { await window.app.extensionManager.setting.set("Comfy.TutorialCompleted", true); } catch (e) {} });
    await page.evaluate(async (vue) => {
        await window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", vue);
    }, vue);
    await page.waitForTimeout(1000);
    const ok = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const load = LG.createNode("LoadImage"); load.pos = [40, 80]; app.graph.add(load);
        load.widgets.find((w) => w.name === "image").value = "rg_test.png";
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [420, 40]; app.graph.add(rg);
        const slot = rg.inputs.findIndex((i) => i.name === "image");
        load.connect(0, rg, slot);
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        window.__rg = rg;
        return { rg: !!rg.__rgState, slot, regs: Object.keys(LG.registered_node_types).filter((k) => k.startsWith("Region-Genie")).length };
    });
    check(`${vue ? "Nodes 2.0" : "legacy"}: Region Genie node created with its editor`, ok.rg && ok.slot >= 0 && ok.regs === 6);
    await page.waitForTimeout(2500);
    const bd = await page.evaluate(() => !!window.__rg.__rgView && document.querySelectorAll(".rg-bar .rg-seg").length > 0);
    check("image-mode buttons show with Load Image connected", bd);
    // the tool row in the real frontend
    const btn = page.locator('.rg-bar .rg-btn[data-group="wand"]').first();
    check("Magic wand / Select object button present", await btn.count() === 1);
    // Select object shares the magic wand's button (round 11): pick it from the button's ▾ list
    await btn.locator(".rg-grp-dd").click(); await page.waitForTimeout(400);
    await page.locator(".litecontextmenu .litemenu-entry", { hasText: "Select object" }).first().click();
    await page.waitForTimeout(400);
    check("Select object picked from the ▾ list: the button shows it", /^Select object/.test(await btn.getAttribute("title")));
    await page.locator(".rg-toolopts").first().hover().catch(() => {});      // folded to an icon until hovered (round 12)
    const findVis = await page.locator(".rg-toolopts .rg-find").first().isVisible();
    check("find field visible", findVis);
    const respP = page.waitForResponse((r) => r.url().includes("/region_genie/sam_select"), { timeout: 240000 });
    const [cx, cy] = await page.evaluate(() => window.__rg.__rgToClient(120, 300));
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(300);
    const st1 = await page.evaluate(() => [...document.querySelectorAll(".rg-hint")].map((e) => e.textContent).join(" | "));
    check("status while the model loads", /Loading SAM 3.1|Selecting/.test(st1));
    const resp = await respP;
    const j = await resp.json();
    const req = JSON.parse(resp.request().postData());
    check("request carries the Load Image file", req.image?.filename === "rg_test.png" && req.image.type === "input");
    check(`server answered ok (${j.ms} ms, cached ${j.cached})`, resp.status() === 200 && j.ok === true && Array.isArray(j.masks));
    await page.waitForTimeout(300);
    const st2 = await page.evaluate(() => [...document.querySelectorAll(".rg-hint")].map((e) => e.textContent).join(" | "));
    check("random weights -> empty mask -> 'Nothing selected there' hint", /Nothing selected there|Enter: add/.test(st2));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.screenshot({ path: require("path").join(__dirname, "out", `real_${vue ? "vue" : "legacy"}.png`) });
    check("no Region Genie errors in the console", errors.length === 0);
    if (errors.length) console.log(errors.slice(0, 5).join("\n"));
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
