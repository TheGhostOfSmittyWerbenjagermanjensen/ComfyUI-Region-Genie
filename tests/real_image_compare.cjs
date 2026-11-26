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
    check(`${M}: a batch of two counts as two pictures: five in all, the last one chosen (4 | 5)`, s.n === 5 && s.cur === 5 && s.prev === 4, JSON.stringify(s));
    await away(); let v = await look();
    check(`${M}: pointer off the picture: the last picture whole, no line (${hex(v.right)})`, v.left === null && !v.line && v.right === COLORS[3] && v.tagL === null && v.tagR === "5");
    await hover(0.5); await page.keyboard.press("2"); await hover(0.3);
    v = await look();
    check(`${M}: picture 2 chosen, pointer on the picture: picture 1 is left of it, picture 2 right (${hex(v.left)} | ${hex(v.right)})`, v.left === COLORS[0] && v.right === COLORS[1] && v.line);
    check(`${M}: the left picture is cut at the pointer (${v.clip})`, /inset\(0(px)? 7\d(\.\d+)?% 0(px)? 0(px)?\)/.test(v.clip));
    check(`${M}: the labels say which is which (${v.tagL} | ${v.tagR})`, v.tagL === "1" && v.tagR === "2");
    if (process.env.RG_SHOT) await page.screenshot({ path: process.env.RG_SHOT, clip: { x: 0, y: 40, width: 1100, height: 760 } });
    await away();
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
    await run(5); s = await S();
    check(`${M}: a run after loading: the last picture is the chosen one again (pictures 3 and 4 still hidden: 2 | 5)`, s.cur === 5 && s.prev === 2);
    await page.keyboard.press("ArrowLeft"); await run(5);
    check(`${M}: every run chooses the last picture again, also with as many pictures as before`, (await S()).cur === 5);
    // the two stepping keys are the user's: A / D in place of the arrows, then back
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Shortcuts", JSON.stringify({ "compare.prev": ["A"], "compare.next": ["D"] })); }); await sleep(300);
    await hover(0.5); await page.keyboard.press("a"); const k1 = (await S()).cur; await page.keyboard.press("ArrowLeft"); const k2 = (await S()).cur; await page.keyboard.press("d"); const k3 = (await S()).cur;
    check(`${M}: with A / D set in the shortcut list they step and the arrows no longer do (${k1}, ${k2}, ${k3})`, k1 === 2 && k2 === 2 && k3 === 5);
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Shortcuts", "{}"); }); await sleep(300);
    await page.keyboard.press("ArrowLeft");
    await chip(3).click(); s = await S();
    check(`${M}: after the next run they are still hidden; a click on a hidden number shows that picture again`, s.hidden.join() === "4" && s.cur === 3 && s.prev === 2);
    // ---- the plain case: two pictures
    await make(COLORS.slice(0, 2), false); await run(2);
    await hover(0.5); s = await S(); v = await look();
    check(`${M}: two pictures: 1 | 2 to start with`, s.n === 2 && s.cur === 2 && s.prev === 1 && v.left === COLORS[0] && v.right === COLORS[1]);
    await page.keyboard.press("1"); s = await S(); v = await look();
    check(`${M}: two pictures, 1 chosen: the sides swap (2 | 1)`, s.cur === 1 && s.prev === 2 && v.left === COLORS[1] && v.right === COLORS[0]);
    await page.locator(".rg-ic-opts button").nth(0).click(); await hover(0.5); s = await S();
    check(`${M}: two pictures, around the corner off: 1 alone, 2 still 1 | 2`, s.prev === 0 && (await page.keyboard.press("2"), (await S()).prev === 1));
    // ---- round 95: keys anywhere over the node; the wheel over the picture zooms the graph; the Large view
    const title = await page.evaluate(() => { const n = window.__cmp, c = window.app.canvas, r = c.canvas.getBoundingClientRect(), ds = c.ds;
        const vue = document.querySelector(`[data-node-id="${n.id}"]`);
        if (vue) { const b = vue.getBoundingClientRect(); return [b.left + b.width / 2, b.top + 12]; }
        return [r.left + (n.pos[0] + n.size[0] / 2 + ds.offset[0]) * ds.scale, r.top + (n.pos[1] - 12 + ds.offset[1]) * ds.scale]; });
    await page.locator(".rg-ic-opts button").nth(0).click();             // around the corner on again
    await page.mouse.move(title[0], title[1], { steps: 3 }); await sleep(150);
    await page.keyboard.press("1"); const t1 = (await S()).cur; await page.keyboard.press("ArrowRight"); const t2 = (await S()).cur;
    check(`${M}: the keys act with the pointer on the node's title, not only on its picture (${t1}, then ${t2})`, t1 === 1 && t2 === 2);
    await away(); await page.keyboard.press("1");
    check(`${M}: and not with the pointer off the node`, (await S()).cur === 2);
    const scale = () => page.evaluate(() => window.app.canvas.ds.scale);
    await hover(0.5); const sc0 = await scale();
    await page.mouse.wheel(0, -240); await sleep(400); const sc1 = await scale();
    await hover(0.5); await page.mouse.wheel(0, 240); await sleep(400); const sc2 = await scale();
    check(`${M}: the wheel over the node's picture zooms ComfyUI's graph in and out again (${sc0.toFixed(2)} > ${sc1.toFixed(2)} > ${sc2.toFixed(2)})`, sc1 > sc0 * 1.05 && sc2 < sc1 * 0.97);
    await page.evaluate(() => { const c = window.app.canvas; c.ds.scale = 1; c.ds.offset = [0, 0]; c.setDirty(true, true); }); await sleep(300);
    // round 96: a middle-button drag over the node moves the graph, on the picture and on the row of numbers
    const offs = () => page.evaluate(() => [...window.app.canvas.ds.offset].map((v) => Math.round(v)));
    for (const [what, loc] of [["picture", ".rg-ic-view"], ["row of numbers", ".rg-ic-bar"]]) {
        await page.evaluate(() => { const c = window.app.canvas; c.ds.scale = 1; c.ds.offset = [0, 0]; c.setDirty(true, true); }); await sleep(250);
        const b = await page.locator(loc).first().boundingBox(), x = b.x + b.width * 0.4, y = b.y + b.height / 2;
        await page.mouse.move(x, y, { steps: 2 }); await page.mouse.down({ button: "middle" });
        await page.mouse.move(x + 60, y + 40, { steps: 6 }); await page.mouse.move(x + 120, y + 80, { steps: 6 }); await page.mouse.up({ button: "middle" }); await sleep(300);
        const o = await offs();
        check(`${M}: a middle-button drag over the node's ${what} moves ComfyUI's graph (by ${o.join(", ")})`, o[0] > 80 && o[0] < 135 && o[1] > 50 && o[1] < 95);
        await page.mouse.move(x + 200, y + 120, { steps: 4 }); await sleep(150);
        check(`${M}: and lets go of it when the button is released`, (await offs()).join() === o.join());
    }
    await page.evaluate(() => { const c = window.app.canvas; c.ds.scale = 1; c.ds.offset = [0, 0]; c.setDirty(true, true); }); await sleep(300);
    // the Large view
    await page.locator(".rg-ic-opts .rg-ic-bigbtn").first().click(); await sleep(300);
    const bigView = page.locator(".rg-ic-big .rg-ic-view");
    const bb = await bigView.boundingBox();
    check(`${M}: the Large view opens over ComfyUI and fills most of the window (${Math.round(bb?.width)} × ${Math.round(bb?.height)})`, !!bb && bb.width > 1200 && bb.height > 800 && (await S()).big?.zoom === 1);
    await page.mouse.move(bb.x + bb.width * 0.25, bb.y + bb.height * 0.5, { steps: 3 }); await sleep(120);
    await page.keyboard.press("2"); await sleep(100);
    const bigLook = () => page.evaluate(() => { const v = document.querySelector(".rg-ic-big .rg-ic-view"), [r, l] = v.querySelectorAll("img"), st = v.querySelector(".rg-ic-stage").getBoundingClientRect(), b = v.getBoundingClientRect();
        return { clip: l.style.clipPath, leftShown: !l.hidden, stage: [st.left - b.left, st.top - b.top, st.width, st.height].map((x) => Math.round(x)), view: [Math.round(b.width), Math.round(b.height)], zoomText: document.querySelector(".rg-ic-big .rg-ic-zoom")?.textContent }; });
    let bl = await bigLook();
    check(`${M}: Large view: the slider and the keys work as on the node (1 | 2, cut at a quarter: ${bl.clip})`, (await S()).cur === 2 && bl.leftShown && /inset\(0(px)? 75(\.\d+)?% 0(px)? 0(px)?\)/.test(bl.clip));
    await page.mouse.wheel(0, -600); await sleep(200);
    let z1 = (await S()).big.zoom; bl = await bigLook();
    check(`${M}: Large view: the wheel zooms into the pictures (${z1.toFixed(2)}×, shown as ${bl.zoomText}); the place under the pointer stays there`, z1 > 1.8 && Math.abs((bb.width * 0.25 - bl.stage[0]) / bl.stage[2] - 0.25) < 0.01);
    check(`${M}: Large view, zoomed: the left picture is still cut exactly at the pointer`, (() => { const m = /inset\(0(?:px)? ([\d.]+)%/.exec(bl.clip); return !!m && Math.abs((1 - m[1] / 100) - (bb.width * 0.25 - bl.stage[0]) / bl.stage[2]) < 0.005; })(), bl.clip + " " + bl.stage.join());
    // a drag moves the pictures, never past their edge
    await page.mouse.down(); await page.mouse.move(bb.x + bb.width * 0.25 + 3000, bb.y + bb.height * 0.5 + 3000, { steps: 6 }); await page.mouse.up(); await sleep(150);
    bl = await bigLook();
    check(`${M}: Large view: a drag moves the pictures, and stops at their edge (${bl.stage.slice(0, 2).join(", ")})`, bl.stage[0] === 0 && bl.stage[1] === 0);
    await page.mouse.move(bb.x + bb.width * 0.6, bb.y + bb.height * 0.4, { steps: 3 });
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600); await sleep(250);
    bl = await bigLook();
    check(`${M}: Large view: zooming out stops when the picture fits its frame (${(await S()).big.zoom}×, ${bl.stage.join(", ")})`, (await S()).big.zoom === 1 && bl.stage[0] === 0 && bl.stage[1] === 0 && bl.stage[2] === bl.view[0] && bl.stage[3] === bl.view[1]);
    check(`${M}: Large view: the graph behind it did not zoom`, Math.abs(await scale() - 1) < 0.001);
    if (process.env.RG_SHOT) { await page.mouse.wheel(0, -500); await sleep(200); await page.screenshot({ path: process.env.RG_SHOT.replace(/\.png$/, "-large.png") }); }
    await page.keyboard.press("Escape"); await sleep(200);
    check(`${M}: Esc closes the Large view; the node is as it was`, await page.locator(".rg-ic-big").count() === 0 && (await S()).big === null && (await S()).cur === 2);
    await page.mouse.move(title[0], title[1], { steps: 3 }); await page.keyboard.press("Alt+Enter"); await sleep(250);
    const opened = await page.locator(".rg-ic-big").count();
    await page.keyboard.press("Alt+Enter"); await sleep(250);
    check(`${M}: its key opens and closes the Large view with the pointer over the node`, opened === 1 && await page.locator(".rg-ic-big").count() === 0);
    const fit = await page.evaluate(() => { const w = document.querySelector(".rg-ic"); return w.scrollWidth - w.clientWidth <= 1 && w.scrollHeight - w.clientHeight <= 1; });
    check(`${M}: nothing in the node needs a scroll bar`, fit);
    check(`${M}: no page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
