// Image Compare (Region Genie) in the real ComfyUI (round 93).
// Four sources (plain colors; one is a batch of two) into the node, a real run, then: the inputs that appear, a batch
// counted per image, the slider (which picture is left / right of the pointer, by its pixels), the number keys
// (number row and numpad), the arrow keys, around the corner and its button, the labels and their button, hiding
// pictures, keys only while the pointer is over the node, save and load, and the plain two-picture case.
//   node tests/real_image_compare.cjs [vue]
// Needs a running ComfyUI with this pack; no model files.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const path = require("path");
const fails = [];
const check = (name, ok, note) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) { fails.push(name); if (note) console.log("     " + note); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vue = process.argv[2] === "vue", M = vue ? "Nodes 2.0" : "legacy";
const COLORS = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00];          // image_1 … image_4 (image_4: a batch of two)

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1700, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(200); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) { /* older */ }
        await s.set("Comfy.VueNodes.Enabled", vue); await s.set("Comfy.Locale", "en"); }, vue);
    await sleep(vue ? 4000 : 800);

    const make = (colors, batchLast) => page.evaluate(async ([colors, batchLast]) => {
        const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const cmp = LG.createNode("Region-Genie_ImageCompare"); cmp.pos = [520, 80]; app.graph.add(cmp); window.__cmp = cmp;
        await new Promise((r) => setTimeout(r, 600));
        const start = cmp.inputs.map((i) => i.name);
        for (let k = 0; k < colors.length; k++) {
            const src = LG.createNode("EmptyImage"); src.pos = [60, 80 + k * 190]; app.graph.add(src);
            const W = (n) => src.widgets.find((w) => w.name === n);
            W("width").value = 96; W("height").value = 64; W("color").value = colors[k]; W("batch_size").value = batchLast && k === colors.length - 1 ? 2 : 1;
            src.connect(0, cmp, cmp.inputs.findIndex((i) => i.name === `image_${k + 1}`));
            await new Promise((r) => setTimeout(r, 250));
        }
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 800));
        return { start, now: cmp.inputs.map((i) => i.name) };
    }, [colors, batchLast]);
    const run = async (n) => { await page.evaluate(() => window.app.queuePrompt(0)); await page.waitForFunction((n) => window.__cmp.__rgCompare.state().n === n, n, { timeout: 60000 }); await sleep(700); };
    const S = () => page.evaluate(() => window.__cmp.__rgCompare.state());
    const view = page.locator(".rg-ic-view").first();
    // what the page shows: the middle pixel of the right / left picture, the left picture's cut, the labels
    const look = () => page.evaluate(async () => {
        const v = document.querySelector(".rg-ic-view"), [r, l] = v.querySelectorAll("img");
        const px = async (img) => { if (img.hidden || !img.src) return null; if (!img.complete) await new Promise((res) => { img.onload = res; img.onerror = res; });
            const c = document.createElement("canvas"); c.width = 4; c.height = 4; const g = c.getContext("2d"); g.drawImage(img, 0, 0, 4, 4); const d = g.getImageData(1, 1, 1, 1).data; return (d[0] << 16) | (d[1] << 8) | d[2]; };
        const vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
        return { right: await px(r), left: await px(l), clip: l.style.clipPath, line: vis(v.querySelector(".rg-ic-line")),
                 tagL: vis(v.querySelector(".rg-ic-tag.l")) ? v.querySelector(".rg-ic-tag.l").textContent : null, tagR: vis(v.querySelector(".rg-ic-tag.r")) ? v.querySelector(".rg-ic-tag.r").textContent : null,
                 chips: [...document.querySelectorAll(".rg-ic-chips button")].map((b) => b.textContent + (b.classList.contains("cur") ? "*" : "") + (b.classList.contains("hid") ? "h" : "")).join(" ") };
    });
    const hover = async (fx) => { const b = await view.boundingBox(); await page.mouse.move(b.x + b.width * fx, b.y + b.height / 2, { steps: 3 }); await sleep(150); };
    const away = async () => { await page.mouse.move(1500, 1000, { steps: 3 }); await sleep(150); };
    const hex = (n) => (n == null ? "none" : "#" + n.toString(16).padStart(6, "0"));

    // ---- five pictures from four inputs
    const ins = await make(COLORS, true);
    check(`${M}: a new node has image_1 and image_2 (${ins.start.join(", ")})`, ins.start.join() === "image_1,image_2");
    check(`${M}: with four cables there is one free input after them (${ins.now.join(", ")})`, ins.now.join() === "image_1,image_2,image_3,image_4,image_5");
    await run(5);
    let s = await S();
    check(`${M}: a batch of two counts as two pictures: five in all, the second one chosen (so 1 | 2)`, s.n === 5 && s.cur === 2 && s.prev === 1, JSON.stringify(s));
    await hover(0.3);
    let v = await look();
    check(`${M}: pointer on the picture: picture 1 is left of it, picture 2 right (${hex(v.left)} | ${hex(v.right)})`, v.left === COLORS[0] && v.right === COLORS[1] && v.line);
    check(`${M}: the left picture is cut at the pointer (${v.clip})`, /inset\(0(px)? 7\d(\.\d+)?% 0(px)? 0(px)?\)/.test(v.clip));
    check(`${M}: the labels say which is which (${v.tagL} | ${v.tagR})`, v.tagL === "1" && v.tagR === "2");
    if (process.env.RG_SHOT) await page.screenshot({ path: process.env.RG_SHOT, clip: { x: 0, y: 40, width: 1100, height: 760 } });
    await away(); v = await look();
    check(`${M}: pointer off the picture: the chosen picture whole, no line`, v.left === null && !v.line && v.right === COLORS[1] && v.tagL === null && v.tagR === "2");
    // ---- keys
    await page.keyboard.press("4"); s = await S();
    check(`${M}: a key pressed with the pointer away from the node does nothing`, s.cur === 2);
    await hover(0.5);
    await page.keyboard.press("4"); s = await S(); v = await look();
    check(`${M}: 4 on the number row: 3 | 4 (${hex(v.left)} | ${hex(v.right)})`, s.cur === 4 && s.prev === 3 && v.left === COLORS[2] && v.right === COLORS[3]);
    await page.keyboard.press("Numpad1"); s = await S(); v = await look();
    check(`${M}: 1 on the numpad: picture 1, with the last picture on its left (5 | 1)`, s.cur === 1 && s.prev === 5 && v.left === COLORS[3] && v.right === COLORS[0]);
    await page.keyboard.press("ArrowRight"); const a1 = (await S()).cur; await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); const a2 = (await S()).cur;
    check(`${M}: the arrow keys step to the next and the one before, around the ends (${a1}, then ${a2})`, a1 === 2 && a2 === 5);
    await page.keyboard.press("9"); check(`${M}: a number with no picture does nothing`, (await S()).cur === 5);
    // ---- the two buttons
    await page.keyboard.press("1");
    const btns = page.locator(".rg-ic-opts button");
    await btns.nth(0).click(); await hover(0.5); s = await S(); v = await look();
    check(`${M}: around the corner off: picture 1 shows alone`, s.wrap === false && s.cur === 1 && s.prev === 0 && v.left === null && !v.line);
    await btns.nth(0).click(); await hover(0.5);
    check(`${M}: and on again: the last picture is back on its left`, (await S()).prev === 5);
    await btns.nth(1).click(); await hover(0.5); v = await look();
    check(`${M}: the label button hides the numbers`, v.tagL === null && v.tagR === null);
    await btns.nth(1).click(); await hover(0.5);
    check(`${M}: and shows them again`, (await look()).tagR === "1");
    // ---- hiding pictures: 2 and 5 next to each other
    const chip = (n) => page.locator(".rg-ic-chips button").nth(n - 1);
    await chip(3).click({ button: "right" }); await chip(4).click({ button: "right" }); await sleep(150);
    await hover(0.5); await page.keyboard.press("5"); s = await S(); v = await look();
    check(`${M}: pictures 3 and 4 hidden: picture 5 has picture 2 on its left (${v.chips})`, s.hidden.join() === "3,4" && s.cur === 5 && s.prev === 2 && v.left === COLORS[1] && v.right === COLORS[3]);
    await page.keyboard.press("3"); await page.keyboard.press("ArrowLeft"); s = await S();
    check(`${M}: a hidden picture's number does nothing, and the arrows step over hidden pictures`, s.cur === 2);
    // ---- saved with the node
    const kept = await page.evaluate(async () => {
        const app = window.app, data = JSON.parse(JSON.stringify(app.graph.serialize()));
        await app.loadGraphData(data); await new Promise((r) => setTimeout(r, 2500));
        const cmp = app.graph._nodes.find((n) => n.type === "Region-Genie_ImageCompare"); window.__cmp = cmp;
        return { ...cmp.__rgCompare.state(), inputs: cmp.inputs.map((i) => i.name).join(), links: cmp.inputs.filter((i) => i.link != null).length };
    });
    check(`${M}: save and load keep the hidden pictures, the inputs and their cables (${kept.inputs})`, kept.hidden.join() === "3,4" && kept.inputs === "image_1,image_2,image_3,image_4,image_5" && kept.links === 4, JSON.stringify(kept));
    await run(5); await chip(3).click(); s = await S();
    check(`${M}: after the next run they are still hidden; a click on a hidden number shows that picture again`, s.hidden.join() === "4" && s.cur === 3 && s.prev === 2);
    // ---- the plain case: two pictures
    await make(COLORS.slice(0, 2), false); await run(2);
    await hover(0.5); s = await S(); v = await look();
    check(`${M}: two pictures: 1 | 2 to start with`, s.n === 2 && s.cur === 2 && s.prev === 1 && v.left === COLORS[0] && v.right === COLORS[1]);
    await page.keyboard.press("1"); s = await S(); v = await look();
    check(`${M}: two pictures, 1 chosen: the sides swap (2 | 1)`, s.cur === 1 && s.prev === 2 && v.left === COLORS[1] && v.right === COLORS[0]);
    await page.locator(".rg-ic-opts button").nth(0).click(); await hover(0.5); s = await S();
    check(`${M}: two pictures, around the corner off: 1 alone, 2 still 1 | 2`, s.prev === 0 && (await page.keyboard.press("2"), (await S()).prev === 1));
    const fit = await page.evaluate(() => { const w = document.querySelector(".rg-ic"); return w.scrollWidth - w.clientWidth <= 1 && w.scrollHeight - w.clientHeight <= 1; });
    check(`${M}: nothing in the node needs a scroll bar`, fit);
    check(`${M}: no page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
