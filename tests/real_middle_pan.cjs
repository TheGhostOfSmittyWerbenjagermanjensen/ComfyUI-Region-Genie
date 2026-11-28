// Round 103: the middle mouse button on the Region Genie node. On the canvas it moves the picture in the canvas (as it
// always did); anywhere else on the node's editor (the toolbar, the list header, the list, the bottom bar) it moves
// ComfyUI's graph, as it does over any other part of a node. In legacy mode the editor's HTML block kept those presses.
//   COMFY_URL (default http://127.0.0.1:8188)   node tests/real_middle_pan.cjs [vue]
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const vue = process.argv.includes("vue"), M = vue ? "Nodes 2.0" : "legacy";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 2400 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await page.evaluate(async (vue) => { await window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", vue); }, vue);
    await sleep(1500);
    await page.evaluate(async () => {
        const app = window.app; app.graph.clear();
        const n = window.LiteGraph.createNode("Region-Genie_Main"); n.pos = [300, 60]; app.graph.add(n); window.__rg = n;
        await new Promise((r) => setTimeout(r, 1800));
        // two regions, so the list has rows
        const st = n.__rgState();
        st.regions = [{ id: 1, color: "#E76F51", prompt: "a red fox", type: "object", text: "" }, { id: 2, color: "#2A9D8F", prompt: "a pine tree", type: "object", text: "" }];
        st.layers = [{ id: 1, name: "L1", region: 1, visible: true, shape: "rect", sides: 5, bw: 0.3, bh: 0.3, sx: 1, sy: 1, rot: 0, ox: -0.2, oy: 0, ops: [] },
                     { id: 2, name: "L2", region: 2, visible: true, shape: "ellipse", sides: 5, bw: 0.3, bh: 0.3, sx: 1, sy: 1, rot: 0, ox: 0.2, oy: 0, ops: [] }];
        n.__rgRefresh();
        await new Promise((r) => setTimeout(r, 600));
    });
    const reset = async () => { await page.evaluate(() => { const c = window.app.canvas; c.ds.scale = 1; c.ds.offset = [0, 0]; c.setDirty(true, true); }); await sleep(300); };
    const offs = () => page.evaluate(() => [...window.app.canvas.ds.offset].map((v) => Math.round(v)));
    const view = () => page.evaluate(() => { const v = window.__rg.__rgView(); return [Math.round(v.x), Math.round(v.y)]; });
    const mid = async (x, y, dx = 120, dy = 80) => {
        await page.mouse.move(x, y, { steps: 2 }); await page.mouse.down({ button: "middle" });
        await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 }); await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up({ button: "middle" }); await sleep(300);
    };
    await reset();
    // where to press: a point of each part that is not a button or a field (its own padding), and one on a row's text
    const spots = await page.evaluate(() => {
        const at = (sel, fx, fy) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? [r.left + r.width * fx, r.top + r.height * fy] : null; };
        return { "toolbar": at(".rg-bar", 0.97, 0.5), "list header": at(".rg-head", 0.03, 0.5), "region row": at(".rg-row.region", 0.5, 0.5), "list, below the rows": at(".rg-tree", 0.5, 0.92),
                 "bottom bar": at(".rg-foot", 0.97, 0.5), "Separate button": at(".rg-separate", 0.5, 0.5) };
    });
    for (const [what, p] of Object.entries(spots)) {
        if (!p) { check(`${M}: found the ${what}`, false); continue; }
        await reset();
        const v0 = await view(), before = await page.evaluate(() => JSON.stringify(window.__rg.__rgState().loraOpts || null));
        await mid(p[0], p[1]);
        const o = await offs();
        check(`${M}: a middle-button drag from the ${what} moves ComfyUI's graph (by ${o.join(", ")})`, o[0] > 80 && o[0] < 135 && o[1] > 50 && o[1] < 95);
        check(`${M}: …the picture in the canvas stays where it was, and nothing was clicked`, (await view()).join() === v0.join() && await page.evaluate(() => JSON.stringify(window.__rg.__rgState().loraOpts || null)) === before);
    }
    // the canvas keeps the middle button for itself: the picture moves, the graph doesn't
    await reset();
    const c = await page.evaluate(() => { const r = document.querySelector(".rg-cv canvas, canvas.rg-canvas, .rg-cv").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const v0 = await view();
    await mid(c[0], c[1], 60, 40);
    const v1 = await view(), o1 = await offs();
    check(`${M}: a middle-button drag on the canvas moves the picture in the canvas (${v0.join(", ")} -> ${v1.join(", ")}), not the graph (${o1.join(", ")})`, (v1[0] !== v0[0] || v1[1] !== v0[1]) && o1.join() === "0,0");
    // a text box that has the cursor keeps the middle button
    await reset();
    const ta = page.locator(".rg-row.region textarea, .rg-row.region input[type=text]").first();
    if (await ta.count()) {
        await ta.click(); await sleep(150);
        const b = await ta.boundingBox();
        await mid(b.x + b.width / 2, b.y + b.height / 2);
        check(`${M}: a text box that has the cursor keeps the middle button: the graph stays (${(await offs()).join(", ")})`, vue || (await offs()).join() === "0,0");
        await page.keyboard.press("Escape");
    }
    check(`${M}: no script errors (${errors.slice(0, 2).join(" | ")})`, !errors.filter((e) => !/ResizeObserver/.test(e)).length);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
