// Round 97: where the Whole image row's pop-up opens. Its LoRAs button (and a LoRA chip) opens the scene prompt's
// pop-up on the LoRAs tab: just below the Whole image row, or just above it when there is no room below; not up at
// the scene prompt's text box above the canvas. The scene text box's own pop-up button still opens it by the box.
//   node tests/real_scene_popup_place.cjs [vue]
// Needs a running ComfyUI with this pack.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok, note) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) { fails.push(name); if (note) console.log("     " + note); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vue = process.argv[2] === "vue", M = vue ? "Nodes 2.0" : "legacy";

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1700, height: 1300 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(200); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) { /* older */ }
        await s.set("Comfy.VueNodes.Enabled", vue); await s.set("Comfy.Locale", "en"); }, vue);
    await sleep(vue ? 4000 : 800);
    const place = (y) => page.evaluate(async (y) => {
        const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [330, y]; app.graph.add(rg); window.__rg = rg;
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 2500));
    }, y);
    const rects = () => page.evaluate(() => { const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
        const vis = (sel) => [...document.querySelectorAll(sel)].find((e) => e.offsetParent && e.getBoundingClientRect().width > 0);
        return { pop: r(document.querySelector(".rg-pop.scene")), row: r(vis(".rg-row.scene")), box: r(vis('textarea[data-rg-field="scene_prompt_positive"]')), cv: r(vis(".rg-cv canvas")), tab: document.querySelector(".rg-pop.scene .rg-pop-tabs .on")?.textContent?.trim() || "", H: window.innerHeight }; });
    const openFromRow = async () => { await page.evaluate(() => { const row = [...document.querySelectorAll(".rg-row.scene")].find((e) => e.offsetParent); [...row.querySelectorAll("button, .rg-btn")].find((b) => /LoRA/.test(b.textContent))?.click(); }); await sleep(700); };
    const close = async () => { await page.evaluate(() => window.__rg.__rgCloseEditor()); await sleep(300); };
    const near = (a, b) => Math.abs(a - b) <= 14;

    // the row high in the window (the node moved up): there is room below the row
    await place(70);
    const row0 = (await rects()).row.top;
    await place(70 - (row0 - 320));
    await openFromRow();
    let g = await rects();
    check(`${M}: the Whole image row's LoRAs button opens the pop-up on its LoRAs tab (${g.tab})`, !!g.pop && /^LoRAs/.test(g.tab));
    check(`${M}: just below the Whole image row (row ends at ${g.row?.bottom}, pop-up starts at ${g.pop?.top})`, !!g.pop && !!g.row && near(g.pop.top, g.row.bottom) && g.pop.top >= g.row.bottom - 2, JSON.stringify(g));
    check(`${M}: so not over the canvas above the row`, !!g.pop && g.pop.top > g.cv.bottom - 4);
    await close();
    // the node low on the page: no room below, so just above the row
    await place(70 + (1300 - 150 - row0));
    await openFromRow();
    g = await rects();
    check(`${M}: with no room below, just above the row (pop-up ends at ${g.pop?.bottom}, row starts at ${g.row?.top})`, !!g.pop && near(g.pop.bottom, g.row.top) && g.pop.bottom <= g.row.top + 2 && g.pop.bottom <= g.H, JSON.stringify(g));
    await close();
    // the scene text box's own button: by the text box, as before
    await place(70);
    await page.evaluate(() => { const t = [...document.querySelectorAll('textarea[data-rg-field="scene_prompt_positive"]')].find((x) => x.offsetParent); t.parentElement.querySelector(":scope > .rg-expand").click(); }); await sleep(700);
    g = await rects();
    check(`${M}: the scene text box's own pop-up button still opens it by the text box (box ends at ${g.box?.bottom}, pop-up starts at ${g.pop?.top})`, !!g.pop && (near(g.pop.top, g.box.bottom) || near(g.pop.bottom, g.box.top)), JSON.stringify(g));
    await close();
    check(`${M}: no page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
