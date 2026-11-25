// Switching between legacy nodes and Nodes 2.0 and back (round 83): the buttons in the corner of the node's own text
// boxes are there again each time: the pop-up button of scene_prompt_positive / scene_prompt_negative (with the LLM
// button next to the positive one) and of the Regional LoRAs node's prompts. Legacy mode puts the same text box into a
// new parent element when it comes back; the buttons live in that parent.
//
//   node tests/real_mode_switch.cjs
// Needs a running ComfyUI with this pack.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1700, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(200); }
    const mode = async (vue) => { await page.evaluate(async (vue) => { await window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", vue); }, vue); await sleep(4000); };
    await page.evaluate(async () => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) { /* older */ }
        await s.set("Comfy.VueNodes.Enabled", false); await s.set("Comfy.Locale", "en"); });
    await sleep(800);
    await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [330, 70]; app.graph.add(rg);
        const rl = LG.createNode("Region-Genie_RegionalLoRAs"); rl.pos = [1250, 70]; app.graph.add(rl);
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 0.7; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 2500));
    });
    // per text box (the one on the page now): is its pop-up button next to it, shown, and with it the LLM button
    const look = () => page.evaluate(() => {
        const out = {};
        for (const f of ["scene_prompt_positive", "scene_prompt_negative", "positive_prompt", "negative_prompt"]) {
            const t = [...document.querySelectorAll(`textarea[data-rg-field="${f}"]`)].find((x) => x.isConnected && x.offsetWidth);
            const b = t?.parentElement?.querySelector(":scope > .rg-expand");
            const shown = (el) => !!el && el.isConnected && el.getBoundingClientRect().width > 0;
            out[f] = { box: !!t, expand: shown(b) && b.__rgFor === t, llm: shown(t?.parentElement?.querySelector(":scope > .rg-llm-corner")) };
        }
        return out;
    });
    const ok = (s) => ["scene_prompt_positive", "scene_prompt_negative", "positive_prompt", "negative_prompt"].every((f) => s[f].box && s[f].expand) && s.scene_prompt_positive.llm;
    let s = await look();
    check(`legacy at first: every text box has its pop-up button, scene_prompt_positive its LLM button (${JSON.stringify(s)})`, ok(s));
    for (let round = 1; round <= 2; round++) {
        await mode(true); s = await look();
        check(`switch ${round} to Nodes 2.0: the buttons are there (${JSON.stringify(s)})`, ok(s));
        await mode(false); s = await look();
        check(`switch ${round} back to legacy: the buttons are there again (${JSON.stringify(s)})`, ok(s));
    }
    // and they work: the pop-up opens from the button
    await page.evaluate(() => { const t = [...document.querySelectorAll('textarea[data-rg-field="scene_prompt_negative"]')].find((x) => x.offsetWidth); t.parentElement.querySelector(":scope > .rg-expand").click(); });
    await sleep(500);
    check("after the switches the pop-up button opens the pop-up editor", await page.evaluate(() => !!document.querySelector(".rg-pop")));
    check(`no page errors (${errors.join(" | ")})`, errors.length === 0);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
