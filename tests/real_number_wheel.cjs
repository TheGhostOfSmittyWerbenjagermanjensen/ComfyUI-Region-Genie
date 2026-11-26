// The mouse wheel on a number field that has the focus (round 63): click into a number field of the pack, then turn
// the wheel anywhere over the same node: the value goes up or down by the field's step. Without the focus the wheel
// does what it did before (zoom). In the real ComfyUI frontend.
// Usage: node real_number_wheel.cjs [vue]   ("vue" = Nodes 2.0). Needs ComfyUI on 127.0.0.1:8188 with this pack.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const vue = process.argv[2] === "vue";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
    const browser = await chromium.launch(); const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1800, height: 1700 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:8188/"); await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(2000); for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(300); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) {} await s.set("Comfy.VueNodes.Enabled", vue); }, vue);
    await sleep(1000);
    await page.evaluate(async () => { const app = window.app, LG = window.LiteGraph; app.graph.clear(); const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 200]; app.graph.add(rg); window.__rg = rg;
        const hl = LG.createNode("Region-Genie_RegionalLoRAs"); hl.pos = [780, 200]; app.graph.add(hl); window.__hl = hl;
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true); await new Promise((r) => setTimeout(r, 1500));
        const st = rg.__rgState(); st.regions.push({ id: 1, color: "#E6194B", prompt: "a red cat", type: "object", text: "", loras: [{ lora: "x.safetensors", strength: 0.8, on: true }] });
        st.layers.push({ id: 1, name: "Rect 1", region: 1, visible: true, shape: "rect", sides: 5, bw: .5, bh: 1, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, ops: [] });
        st.controls = [{ kind: "depth", strength: 1, start: 0, end: 1 }]; rg.__rgRefresh(); await new Promise((r) => setTimeout(r, 500)); });
    const M = vue ? "Nodes 2.0" : "legacy";
    const mid = async (loc) => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const wheelAt = async (x, y, dy, n = 1) => { await page.mouse.move(x, y); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await sleep(90); } await sleep(150); };
    const cvMid = () => mid(page.locator(".rg-cv canvas"));
    const scale = () => page.evaluate(() => window.app.canvas.ds.scale);
    const zoomOf = () => page.evaluate(() => window.__rg.__rgView?.().z ?? null);

    // ---- the size row: megapixels, with the pointer over the field, over the canvas and over the list
    const mp = page.locator(".rg-size .rg-size-part").first().locator('input[type="number"]').first();
    await mp.click(); await sleep(100);
    const v0 = +(await mp.inputValue());
    await wheelAt(...(await mid(mp)), -100, 2);
    const v1 = +(await mp.inputValue());
    check(`${M}: megapixels has the focus, wheel up twice over the field: +2 steps (${v0} -> ${v1})`, Math.abs(v1 - v0 - 0.02) < 1e-6);
    const z0 = await zoomOf();
    await wheelAt(...(await cvMid()), -100, 2);
    check(`${M}: over the drawing canvas the wheel zooms the canvas and leaves the field alone (zoom ${z0} -> ${await zoomOf()})`, +(await mp.inputValue()) === v1 && z0 !== await zoomOf());
    await mp.click(); await sleep(100);
    await wheelAt(...(await mid(page.locator(".rg-head"))), 100, 3);
    const v2 = +(await mp.inputValue());
    check(`${M}: wheel down three times over the node's list header: -3 steps (${v1} -> ${v2})`, Math.abs(v2 - v1 + 0.03) < 1e-6);
    check(`${M}: the node took the value (its size follows)`, await page.evaluate(() => window.__rg.properties.rg_size.ratio.mp) === v2);
    await wheelAt(...(await mid(page.locator(".rg-foot"))), -100, 1);
    check(`${M}: over the bottom bar of the same node: it counts too`, Math.abs(+(await mp.inputValue()) - v2 - 0.01) < 1e-6);
    // the node's title (legacy: drawn on the graph canvas)
    const title = await page.evaluate(() => { const n = window.__rg, ds = window.app.canvas.ds, r = window.app.canvas.canvas.getBoundingClientRect(); return [r.x + (n.pos[0] + 200 + ds.offset[0]) * ds.scale, r.y + (n.pos[1] - 12 + ds.offset[1]) * ds.scale]; });
    const s0 = await scale(), t0 = +(await mp.inputValue());
    await wheelAt(title[0], title[1], -100, 1);
    const t1 = +(await mp.inputValue()), s1 = await scale();
    check(`${M}: over the node's title: it counts, and the graph doesn't zoom (${t0} -> ${t1}; scale ${s0} -> ${s1}; focus ${await page.evaluate(() => document.activeElement?.className)})`, Math.abs(t1 - t0 - 0.01) < 1e-6 && s1 === s0);
    // outside the node: the graph zooms as always, the field stays
    const o0 = +(await mp.inputValue());
    await wheelAt(735, 1250, -100, 1);
    check(`${M}: outside the node the wheel zooms the graph and leaves the field alone (${o0} -> ${await mp.inputValue()}; scale ${s0} -> ${await scale()}; under the pointer: ${await page.evaluate(() => { const e = document.elementFromPoint(735, 1250); return e?.tagName + "#" + e?.id; })})`, +(await mp.inputValue()) === o0 && await scale() !== s0);
    await page.evaluate((s) => { window.app.canvas.ds.scale = s; window.app.canvas.ds.offset = [0, 0]; window.app.canvas.setDirty(true, true); }, s0); await sleep(300);
    // over the other node: not this field's node
    const hlBox = await page.evaluate(() => { const n = window.__hl, ds = window.app.canvas.ds, r = window.app.canvas.canvas.getBoundingClientRect(); return [r.x + (n.pos[0] + 120 + ds.offset[0]) * ds.scale, r.y + (n.pos[1] - 12 + ds.offset[1]) * ds.scale]; });
    await wheelAt(hlBox[0], hlBox[1], -100, 1);
    check(`${M}: over another node: not counted`, +(await mp.inputValue()) === o0);
    await page.evaluate((s) => { window.app.canvas.ds.scale = s; window.app.canvas.ds.offset = [0, 0]; window.app.canvas.setDirty(true, true); }, s0); await sleep(300);

    // ---- without the focus: the canvas zooms, no field changes
    await page.locator(".rg-cv canvas").click({ position: { x: 20, y: 20 } }); await sleep(150);
    const n0 = +(await mp.inputValue()), zz = await zoomOf();
    await wheelAt(...(await cvMid()), -100, 2);
    check(`${M}: no field has the focus: the wheel zooms the canvas as before`, +(await mp.inputValue()) === n0 && (zz == null || zz !== await zoomOf()));

    // ---- other fields: the multiple, a Control row's strength, a region LoRA's strength, the step box
    // over: where the wheel is turned (the node's bottom bar; for a field of a pop-up, the pop-up itself)
    const field = async (name, loc, step, read, over = ".rg-foot") => {
        if (!(await loc.count())) return check(`${M}: ${name}: the field is there`, false);
        await loc.first().click(); await sleep(120);
        const a = +(await page.evaluate(() => document.activeElement.value));
        await wheelAt(...(await mid(page.locator(over))), -100, 2);
        const b = +(await page.evaluate(() => document.activeElement.value)), still = await page.evaluate(() => document.activeElement?.type === "number");
        await wheelAt(...(await mid(page.locator(over))), 100, 1);
        const c = +(await page.evaluate(() => document.activeElement.value));
        const saved = read ? await page.evaluate(read) : c;
        check(`${M}: ${name}: up twice, down once with the wheel over ${over === ".rg-foot" ? "the bottom bar" : "its pop-up"} (${a} -> ${b} -> ${c}); the field keeps the focus; saved (${saved})`,
            still && Math.abs(b - a - 2 * step) < 1e-6 && Math.abs(c - b + step) < 1e-6 && Math.abs(saved - c) < 1e-6);
    };
    await field("the multiple (×)", page.locator(".rg-size .rg-size-part").first().locator('input[type="number"]').nth(1), 4, () => window.__rg.properties.rg_size.ratio.multiple);
    await field("a Control row's strength", page.locator(".rg-row.ctrl input[type=number]").first(), 0.05, () => window.__rg.__rgState().controls[0].strength);
    // round 87: a region's LoRAs are on the LoRAs tab of its pop-up (moved off the node here, so the bottom bar is free)
    await page.evaluate(() => window.__rg.__rgEditTab(window.__rg.__rgState().regions[0].id, "loras")); await sleep(400);
    await page.evaluate(() => { const b = document.querySelector(".rg-pop"); b.style.left = "6px"; b.style.top = "6px"; }); await sleep(100);
    await field("a region LoRA's strength (in its pop-up)", page.locator(".rg-pop .rg-pop-lorarows input[type=number]").first(), 0.05, () => window.__rg.__rgState().regions[0].loras[0].strength, ".rg-pop");
    await page.evaluate(() => window.__rg.__rgCloseEditor()); await sleep(200);
    await page.evaluate(() => [...document.querySelector(".rg-size").querySelectorAll("button")].find((b) => /^Manual: /.test(b.title)).click()); await sleep(300);
    await field("manual width (by its step size)", page.locator(".rg-size .rg-size-part").nth(2).locator("input").nth(0), 64, () => window.__rg.properties.rg_size.manual.w);

    // ---- the Regional LoRAs node: a row's strength, the wheel over that node
    await page.evaluate(() => [...document.querySelectorAll(".rg-rl-head button")].find((b) => /Add LoRA/.test(b.textContent)).click()); await sleep(900);
    const rs = page.locator("input.rg-rl-str").first(); await rs.click(); await sleep(120);
    const r0 = +(await rs.inputValue());
    await wheelAt(...(await mid(page.locator(".rg-rl-head"))), -100, 2);
    const r1 = +(await page.evaluate(() => document.querySelector("input.rg-rl-str").value));
    check(`${M}: Regional LoRAs: a row's strength, wheel over that node's own area (${r0} -> ${r1}), saved`, Math.abs(r1 - r0 - 2 * (+(await page.evaluate(() => document.querySelector("input.rg-rl-str").step)) || 0.05)) < 1e-6
        && await page.evaluate(() => { try { return JSON.parse(window.__hl.widgets.find((w) => w.name === "loras_data").value).rows[0].strength; } catch (e) { return null; } }) === r1);
    await wheelAt(...(await cvMid()), -100, 1);
    check(`${M}: …but not with the wheel over the other node`, +(await page.evaluate(() => document.querySelector("input.rg-rl-str").value)) === r1);

    check(`${M}: no script errors`, !errors.length);
    if (errors.length) console.log(errors.slice(0, 3).join("\n"));
    await browser.close();
    console.log(fails.length ? fails.length + " failed" : "all passed"); process.exit(fails.length ? 1 : 0);
})();
