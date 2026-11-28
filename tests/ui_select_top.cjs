// Round 103: the Select tool takes what is seen on top at the pointer. Before, a press anywhere inside the selected
// layer's box stayed with that layer, also where another layer lay over it. Checked by which layer is selected after
// a press and which layer moved after a drag (ox / oy in the node's data; a resize by the layer's width, bw × sx).
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 900, height: 1100 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const S = 512;
    await page.evaluate((S) => { for (const n of ["width", "height"]) { const w = window.__node.widgets.find((w) => w.name === n); w.value = S; w.callback?.(S); } }, S);
    await page.waitForTimeout(600);
    // region A (id 1), behind: a rectangle, x 100..300, y 150..350. Region B (id 2), in front: an ellipse in the box
    // x 250..450, y 100..300. They overlap; the ellipse's box has empty corners, one over the rectangle, one over nothing
    const A = 10, B = 20;
    const setScene = () => page.evaluate((S) => {
        const st = window.__node.__rgState(), u = (px) => px / S;
        const shape = (id, region, shape, x, y, w, h) => ({ id, name: `L${id}`, region, visible: true, shape, sides: 5, bw: u(w), bh: u(h), sx: 1, sy: 1, rot: 0, ox: u(x + w / 2 - S / 2), oy: u(y + h / 2 - S / 2), ops: [] });
        st.regions = [{ id: 1, color: "#E76F51", prompt: "a", type: "object", text: "" }, { id: 2, color: "#2A9D8F", prompt: "b", type: "object", text: "" }];
        st.layers = [shape(10, 1, "rect", 100, 150, 200, 200), shape(20, 2, "ellipse", 250, 100, 200, 200)];
        window.__node.__rgSetTool("select"); window.__node.__rgSelectLayer(null); window.__node.__rgRefresh();
    }, S);
    const OVER = [280, 200];          // both there; the ellipse is seen
    const B_CORNER_ON_A = [262, 284]; // inside the ellipse's box, outside the ellipse: the rectangle is seen
    const B_CORNER_BARE = [440, 110]; // inside the ellipse's box, outside the ellipse, nothing under it
    const A_ALONE = [150, 300];       // the rectangle only
    const BARE = [60, 450];           // nothing, in no box
    const pos = () => page.evaluate((S) => Object.fromEntries(window.__node.__rgState().layers.map((L) => [L.id, [Math.round(L.ox * S), Math.round(L.oy * S), Math.round(L.bw * (L.sx ?? 1) * S)]])), S);
    const sel = () => page.evaluate(() => window.__node.__rgSelected?.() ?? null);
    const client = (p) => page.evaluate(([x, y]) => window.__node.__rgToClient(x, y), p);
    // press at p (image px), drag by (dx, dy) image px, release; returns what moved, in image px
    const drag = async (p, dx, dy, mods = []) => {
        const before = await pos(), a = await client(p), b = await client([p[0] + dx, p[1] + dy]);
        for (const m of mods) await page.keyboard.down(m);
        await page.mouse.move(a[0], a[1]); await page.mouse.down();
        await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 }); await page.mouse.move(b[0], b[1], { steps: 4 });
        await page.mouse.up();
        for (const m of mods) await page.keyboard.up(m);
        await page.waitForTimeout(150);
        const after = await pos();
        return Object.fromEntries(Object.keys(after).map((id) => [id, [after[id][0] - before[id][0], after[id][1] - before[id][1], after[id][2] - before[id][2]]]));
    };
    const moved = (d, id, dx, dy) => Math.abs(d[id][0] - dx) <= 2 && Math.abs(d[id][1] - dy) <= 2;
    const still = (d, id) => d[id][0] === 0 && d[id][1] === 0 && d[id][2] === 0;
    const start = async (selected) => { await setScene(); await page.waitForTimeout(150); await page.evaluate((id) => { window.__node.__rgSelectLayer(id); window.__node.__rgRefresh(); }, selected); await page.waitForTimeout(100); };

    await start(A);
    let d = await drag(OVER, 30, 20);
    check(`the layer behind is selected; a press where the one in front covers it takes the one in front (selected ${await sel()}, moved ${JSON.stringify(d)})`, await sel() === B && moved(d, B, 30, 20) && still(d, A));

    await start(B);
    d = await drag(B_CORNER_ON_A, 30, 20);
    check(`the ellipse is selected; a press in an empty corner of its box where the rectangle shows takes the rectangle (selected ${await sel()}, ${JSON.stringify(d)})`, await sel() === A && moved(d, A, 30, 20) && still(d, B));

    await start(B);
    d = await drag(B_CORNER_BARE, -30, 20);
    check(`…and in an empty corner with nothing under it, the ellipse itself moves (selected ${await sel()}, ${JSON.stringify(d)})`, await sel() === B && moved(d, B, -30, 20) && still(d, A));

    await start(B);
    d = await drag(OVER, 20, 20);
    check(`the layer in front is selected: a press on it where both are moves it, as before (${JSON.stringify(d)})`, await sel() === B && moved(d, B, 20, 20) && still(d, A));

    await start(A);
    d = await drag(OVER, 30, 20, ["Alt"]);
    check(`Alt+drag from a spot where the selected layer is covered moves the selected layer (selected ${await sel()}, ${JSON.stringify(d)})`, await sel() === A && moved(d, A, 30, 20) && still(d, B));
    await start(A);
    d = await drag(BARE, 30, -20, ["Alt"]);
    check(`Alt+drag from empty canvas outside its box moves it too (${JSON.stringify(d)})`, await sel() === A && moved(d, A, 30, -20) && still(d, B));

    await start(null);
    d = await drag(A_ALONE, 200, -150);
    check(`a layer grabbed where it is seen and dragged under another stays the one that is dragged, all the way (selected ${await sel()}, ${JSON.stringify(d)})`, await sel() === A && moved(d, A, 200, -150) && still(d, B));

    // the selected rectangle's right-hand handle (300, 250) lies on the ellipse: it still resizes the rectangle
    await start(A);
    d = await drag([300, 250], 40, 0);
    check(`a handle of the selected layer that lies over another layer still resizes the selected one (${JSON.stringify(d)})`, await sel() === A && d[A][2] >= 35 && still(d, B));

    await start(A);
    d = await drag(BARE, 0, 0);
    check("a click on empty canvas outside the box selects nothing, as before", await sel() === null);
    check("the Select tool's hints name Alt+drag while a layer is selected", await (async () => { await start(A); return /Alt\+drag Move it from anywhere/.test(await page.evaluate(() => document.querySelector(".rg-tips").textContent)); })());

    console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
    await browser.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
