// Ctrl+Up / Ctrl+Down (ComfyUI's own "edit attention": the weight of the word or tag at the cursor, "(tag:1.05)") in every
// text field of the pack, in the real ComfyUI frontend. ComfyUI handles a node's own text boxes; the pack does the same
// edit in its own fields (rg_shared.js, editAttention), whose key presses don't reach ComfyUI's listener.
// Usage: node real_attention.cjs [vue]   ("vue" = Nodes 2.0). Needs ComfyUI on 127.0.0.1:8188 with this pack.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const vue = process.argv[2] === "vue";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
    const browser = await chromium.launch(); const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1700, height: 1300 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:8188/"); await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(2000); for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(300); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) {} await s.set("Comfy.VueNodes.Enabled", vue); await s.set("Comfy.EditAttention.Delta", 0.05); }, vue);
    await sleep(1000);
    await page.evaluate(async () => { const app = window.app, LG = window.LiteGraph; app.graph.clear(); const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); window.__rg = rg;
        const hl = LG.createNode("Region-Genie_RegionalLoRAs"); hl.pos = [760, 40]; app.graph.add(hl); window.__hl = hl;
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 0.8; app.canvas.setDirty(true, true); await new Promise((r) => setTimeout(r, 1500));
        const st = rg.__rgState(); st.regions.push({ id: 1, color: "#E6194B", prompt: "a red cat", type: "text", text: "hello sign" });
        st.layers.push({ id: 1, name: "Rect 1", region: 1, visible: true, shape: "rect", sides: 5, bw: .5, bh: 1, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, ops: [] }); rg.__rgRefresh(); await new Promise((r) => setTimeout(r, 500)); });
    const M = vue ? "Nodes 2.0" : "legacy";
    const val = () => page.evaluate(() => document.activeElement.value);
    const field = async (name, loc) => {
        if (!(await loc.count())) return check(`${M}: ${name}: the field is there`, false);
        await loc.first().click(); await page.keyboard.press("Control+a"); await page.keyboard.type("big dog, park");
        await page.evaluate(() => document.activeElement.setSelectionRange(2, 2));
        await page.keyboard.press("Control+ArrowUp"); await sleep(120); const up = await val();
        await page.keyboard.press("Control+ArrowDown"); await sleep(120); const plain = await val();
        await page.keyboard.press("Control+ArrowDown"); await sleep(120); const dn = await val();
        check(`${M}: ${name}: Ctrl+Up, Ctrl+Down twice (${up} | ${plain} | ${dn})`, up === "(big:1.05) dog, park" && plain === "big dog, park" && dn === "(big:0.95) dog, park");
    };
    await field("scene_prompt_positive", page.locator("textarea.rg-scene-ta").first());
    await field("scene_prompt_negative", page.locator("textarea.rg-scene-ta").nth(1));
    await field("a region's prompt in the list", page.locator(".rg-list textarea.rg-prompt").first());
    await field("a region's text to render in the list", page.locator(".rg-list textarea.rg-text").first());
    check(`${M}: the node's data has the weighted texts`, await page.evaluate(() => { const r = window.__rg.__rgState().regions[0]; return r.prompt === "(big:0.95) dog, park" && r.text === "(big:0.95) dog, park"; }));
    // several words selected; a step is one Undo step of the field
    const rp = page.locator(".rg-list textarea.rg-prompt").first();
    await rp.click(); await page.keyboard.press("Control+a"); await page.keyboard.type("this is a tag, other");
    await page.evaluate(() => document.activeElement.setSelectionRange(0, 13));
    await page.keyboard.press("Control+ArrowDown"); await sleep(120); const multi = await val();
    const selTxt = await page.evaluate(() => { const t = document.activeElement; return t.value.slice(t.selectionStart, t.selectionEnd); });
    await page.keyboard.press("Control+ArrowUp"); await sleep(120); const back = await val();
    check(`${M}: several selected words get one weight, and lose it again at 1 (${multi} | ${back}; selected: ${selTxt})`, multi === "(this is a tag:0.95), other" && selTxt === "(this is a tag:0.95)" && back === "this is a tag, other");
    await page.keyboard.press("Control+ArrowUp"); await sleep(120);
    await page.keyboard.press("Control+z"); await sleep(200);
    check(`${M}: Undo in the field takes the step back (${await val()})`, (await val()) === "this is a tag, other");
    // the pop-up editors
    await page.locator(".rg-expand").first().click(); await sleep(500);
    await field("the scene prompt's pop-up editor", page.locator(".rg-pop textarea").first()); await page.keyboard.press("Escape"); await sleep(300);
    await page.locator(".rg-row.region .rg-expand").first().click(); await sleep(500);
    await field("a region's pop-up editor: prompt", page.locator(".rg-pop textarea").first());
    await field("a region's pop-up editor: text", page.locator(".rg-pop textarea").nth(1)); await page.keyboard.press("Escape"); await sleep(300);
    // the large editor
    await page.locator('[title^="Large editor"]').first().click(); await sleep(900);
    await field("the large editor: scene prompt", page.locator(".rg-big textarea.rg-big-ta").first());
    await field("the large editor: a region's prompt", page.locator(".rg-big textarea.rg-prompt").first());
    await page.keyboard.press("Alt+Enter"); await sleep(600);
    if (await page.locator(".rg-big").count()) { await page.locator('[title^="Large editor"]').first().click(); await sleep(600); }
    // the Regional LoRAs node: its prompt boxes and their pop-up editor
    const hlTa = () => page.evaluate(() => { const id = window.__hl.id; const all = [...document.querySelectorAll("textarea")].filter((t) => !t.closest(".rg-wrap") && !/rg-scene-ta|rg-prompt|rg-big/.test(t.className) && /rg-sbpad/.test(t.className)); all.forEach((t, i) => t.setAttribute("data-hl", i)); return all.length; });
    const nHl = await hlTa();
    await field("Regional LoRAs: positive_prompt", page.locator('textarea[data-hl="0"]'));
    if (nHl > 1) await field("Regional LoRAs: negative_prompt", page.locator('textarea[data-hl="1"]'));
    // a row's words (the small text box of a LoRA row)
    await page.evaluate(() => [...document.querySelectorAll(".rg-rl-head button")].find((b) => /Add LoRA/.test(b.textContent)).click()); await sleep(900);
    await field("Regional LoRAs: a row's words", page.locator("textarea.rg-rl-prompt"));
    check(`${M}: the row's words are saved with their weight`, await page.evaluate(() => { try { return JSON.parse(window.__hl.widgets.find((w) => w.name === "loras_data").value).rows[0].prompt === "(big:0.95) dog, park"; } catch (e) { return false; } }));
    check(`${M}: no script errors`, !errors.length);
    if (errors.length) console.log(errors.slice(0, 3).join("\n"));
    await browser.close();
    console.log(fails.length ? fails.length + " failed" : "all passed"); process.exit(fails.length ? 1 : 0);
})();
