// Browser checks of the round 6 UI: footer, image mode / min px, tag icon, canvas tools (headless Chromium, DPR 2)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    // the canvas tool options fold to an icon until hovered (round 12): hover them, then look
    const inStrip = async (loc) => { await page.locator(".rg-toolopts").hover().catch(() => {}); await page.waitForTimeout(40); return loc.isVisible(); };
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1100 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__settingsExt.setup());
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__node.__rgState())));
    const tip = (start) => page.locator(`.rg-bar .rg-btn.icon[title^="${start}"]`);
    const toClient = (x, y) => page.evaluate(([x, y]) => window.__node.__rgToClient(x, y), [x, y]);
    async function dragImg(pts, mods = []) {
        for (const m of mods) await page.keyboard.down(m);
        let [x, y] = await toClient(...pts[0]);
        await page.mouse.move(x, y); await page.mouse.down();
        for (const p of pts.slice(1)) { [x, y] = await toClient(...p); await page.mouse.move(x, y, { steps: 6 }); }
        await page.mouse.up();
        for (const m of mods) await page.keyboard.up(m);
        await page.waitForTimeout(60);
    }
    async function clickImg(x, y, mods = []) {
        for (const m of mods) await page.keyboard.down(m);
        const [cx, cy] = await toClient(x, y);
        await page.mouse.click(cx, cy);
        for (const m of mods) await page.keyboard.up(m);
        await page.waitForTimeout(60);
    }

    // ---- footer B
    const footText = await page.locator(".rg-settings").innerText();
    check("footer: no min px / import controls", !/min px|import/i.test(footText));
    check("footer: Generate / Edit segmented, Generate on", await page.locator(".rg-settings .rg-seg button.on", { hasText: "Generate" }).count() === 1);
    const llm = page.locator(".rg-settings .rg-llmset");
    check("footer: LLM Settings is an icon button", (await llm.innerText()).trim() === "" && (await llm.innerHTML()).includes("<svg"));
    check("footer: tag autocomplete button exists", await page.locator(".rg-settings .rg-ac-btn").count() === 1);
    check("footer: change select hidden in generate", await page.locator(".rg-settings label", { hasText: "change" }).isHidden());
    await page.evaluate(() => window.__node.onExecuted?.({ prompt_format: ["MOSS JSON"] }));
    const modelTip = await page.evaluate(() => document.querySelector(".rg-settings select.rg-model")?.title || "");
    check("format: no format select; the model dropdown's tooltip names the last run's format",
        await page.locator(".rg-settings .rg-fmt").count() === 0 && /last run's prompt format: MOSS JSON/.test(modelTip));

    // ---- run data: min px / import mode come from Settings
    const sent = () => page.evaluate(() => JSON.parse(window.__node.widgets.find((w) => w.name === "paint_data").serializeValue()));
    let d = await sent();
    check("run data: minPixels / importMode from Settings (defaults)", d.minPixels === 64 && d.importMode === "ask before replacing");
    await page.evaluate(() => { window.__settings["RegionGenie.Main.MinRegionPixels"] = 300; window.__settings["RegionGenie.Main.ImportMode"] = "always replace"; });
    d = await sent();
    check("run data follows a Settings change", d.minPixels === 300 && d.importMode === "always replace");

    // ---- image mode in the top bar: only with an image connected
    const imgBox = page.locator(".rg-cv .rg-imgmode .rg-seg").filter({ has: page.locator('button[title^="Image as a backdrop"]') });
    check("image mode hidden without an image", await imgBox.isHidden());
    await page.evaluate(() => { window.__node.inputs = [{ name: "image", link: 7 }]; });
    await page.waitForTimeout(1300);                                   // the node's poll
    check("image mode shown with an image connected", await imgBox.isVisible());
    const minIn = page.locator('.rg-cv .rg-imgmode input[title^="Min region pixels"]');
    check("min px hidden while backdrop", await minIn.isHidden());
    await page.locator('button[title^="Image as a color map"]').click();
    await page.waitForTimeout(100);
    check("color map picked: widget set, min px shown with the Setting", await page.evaluate(() => window.__node.widgets.find((w) => w.name === "image_mode").value) === "use as color map"
        && await minIn.isVisible() && await minIn.inputValue() === "300");
    await minIn.fill("120"); await minIn.press("Tab");
    check("min px writes the Setting", await page.evaluate(() => window.__settings["RegionGenie.Main.MinRegionPixels"]) === 120);
    await page.locator('button[title^="Image as a backdrop"]').click();
    await page.evaluate(() => { window.__node.inputs = []; });

    // ---- tool variants
    const wand = page.locator('.rg-bar .rg-btn.icon[title^="Magic wand"]');
    check("magic wand button", await wand.count() === 1);
    // the tools' lists are the pack's own menu (round 65): read the open one as { items: [{ content }], opts.callback(item) }
    await page.evaluate(() => { window.__toolMenu = () => { const rows = [...document.querySelectorAll(".rg-menu .rg-menu-item")];
        return { items: rows.map((row) => ({ content: (row.getAttribute("aria-checked") === "true" ? "✓ " : "   ") + row.querySelector(".rg-menu-label").textContent, row })), opts: { callback: (it) => it.row.click() } }; }; });
    await wand.click({ button: "right" });
    let items = await page.evaluate(() => window.__toolMenu().items.map((i) => i.content));
    check("wand right-click: 2 versions and Select object", items.length === 3 && items[0].startsWith("✓") && /Select object/.test(items[2]));
    await page.evaluate(() => window.__toolMenu().opts.callback(window.__toolMenu().items[1]));
    check("wand: global version picked", /^Magic wand \(all similar colors\)/.test(await wand.getAttribute("title")));
    const tolIn = page.locator('.rg-toolopts input[title^="Magic wand tolerance"]');
    check("tolerance field shown with the wand (folded strip, hovered)", await inStrip(tolIn));
    await page.evaluate(() => window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.WandTolerance").onChange(50));
    await page.waitForTimeout(50);
    check("Settings tolerance change shows in the field", await tolIn.inputValue() === "50");
    const lasso = page.locator('.rg-bar .rg-btn.icon[title^="Lasso"]').first();
    await lasso.click({ button: "right" });
    items = await page.evaluate(() => window.__toolMenu().items.map((i) => i.content));
    check("lasso right-click: plain / spline / magnetic", items.length === 3 && /magnetic/.test(items[2]));
    const fill = page.locator('.rg-bar .rg-btn.icon[title^="Fill"]');
    await fill.click({ button: "right" });
    await page.evaluate(() => window.__toolMenu().opts.callback(window.__toolMenu().items[1]));
    const gapIn = page.locator('.rg-toolopts input[title^="Fill, closing small gaps"]');
    check("fill gaps: version picked, gap field shown", /^Fill \(closing small gaps\)/.test(await fill.getAttribute("title")) && await inStrip(gapIn));
    check("tolerance hidden with another tool", await tolIn.isHidden());

    // ---- fill, closing small gaps: two holes joined by a 2 px channel
    await page.locator(".rg-head .rg-btn.icon").first().click();          // region A
    await page.locator(".rg-head .rg-btn.icon").first().click();          // region B (active, on top of the list)
    await page.evaluate(() => {
        const s = window.__node.__rgState(), A = s.regions[1].id;
        const sq = (x0, y0, x1, y1) => ({ t: "poly", e: true, p: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
        s.layers.push({ id: 1, name: "Wall", region: A, visible: true, shape: null, sides: 5, bw: 1, bh: 1, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0,
            ops: [{ t: "poly", e: false, p: [[0, 0], [1, 0], [1, 1], [0, 1]] }, sq(0.1, 0.3, 0.4, 0.7), sq(0.6, 0.3, 0.9, 0.7), sq(0.4, 0.495, 0.6, 0.505)] });
    });
    await page.keyboard.press("Escape");
    await fill.click();
    const filled = async () => {
        const s = await st(), L = s.layers.find((l) => l.name.startsWith("Fill"));
        if (!L) return null;
        const o = L.ops[L.ops.length - 1], m = new Uint8Array(o.w * o.h);
        let pos = 0, v = 0; for (const r of o.runs) { if (v) m.fill(1, pos, pos + r); pos += r; v ^= 1; }
        return (x, y) => m[Math.floor(y * o.h / 256) * o.w + Math.floor(x * o.w / 256)];
    };
    await clickImg(64, 128);
    let f = await filled();
    check("gap fill: the clicked hole is filled", f && f(64, 128) === 1 && f(40, 100) === 1);
    check("gap fill: doesn't leak through the 2 px channel", f && f(192, 128) === 0);
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = s.layers.filter((l) => !l.name.startsWith("Fill")); });
    await fill.click({ button: "right" });
    await page.evaluate(() => window.__toolMenu().opts.callback(window.__toolMenu().items[0]));
    await clickImg(64, 128);
    f = await filled();
    check("normal fill leaks through the channel", f && f(192, 128) === 1);
    // ---- gradient fill (round 26): the Fill button's linear and radial versions
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = s.layers.filter((l) => !l.name.startsWith("Fill")); window.__node.__rgRefresh(); });
    await fill.click({ button: "right" });
    items = await page.evaluate(() => window.__toolMenu().items.map((i) => i.content));
    check("fill right-click: fill, closing gaps, linear gradient, radial gradient", items.length === 4 && /linear gradient/.test(items[2]) && /radial gradient/.test(items[3]));
    await page.evaluate(() => window.__toolMenu().opts.callback(window.__toolMenu().items[2]));
    check("linear gradient picked: the button says so", /^Fill \(linear gradient\)/.test(await fill.getAttribute("title")));
    await clickImg(64, 128);
    check("a click without a drag fills nothing and says what to do", !(await st()).layers.some((l) => l.grad) && /Drag a line/.test(await page.evaluate(() => [...document.querySelectorAll(".rg-wrap *")].filter((e) => e.childElementCount === 0).map((e) => e.textContent).join(" | "))));
    await dragImg([[30, 128], [100, 128]]);
    let gl = (await st()).layers.find((l) => l.grad);
    check("drag: a layer of its own for the active region, with the line as its gradient", !!gl && /^Gradient/.test(gl.name) && gl.region === (await st()).regions[0].id
        && gl.grad.k === "linear" && Math.abs(gl.grad.a[0] - 30 / 256) < 0.01 && Math.abs(gl.grad.b[0] - 100 / 256) < 0.01 && Math.abs(gl.grad.a[1] - 0.5) < 0.01);
    const gpx = (x, y) => page.evaluate(async ([x, y]) => {
        const img = new Image(); img.src = window.__node.__rgRender(256, 256); await img.decode();
        const c = document.createElement("canvas"); c.width = 256; c.height = 256; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        const d = g.getImageData(x, y, 1, 1).data; return d[0] + d[1] + d[2];
    }, [x, y]);
    const [g0, g1, g2] = [await gpx(34, 128), await gpx(65, 128), await gpx(96, 128)];
    check(`on the canvas the region fades along the line (${g0} > ${g1} > ${g2})`, g0 > g1 + 40 && g1 > g2 + 40);
    const sentG = await page.evaluate(() => JSON.parse(window.__node.widgets.find((w) => w.name === "paint_data").serializeValue()).layers.find((l) => l.grad)?.grad);
    check("the gradient goes to the run with the layer", sentG?.k === "linear" && sentG.a.length === 2);
    await page.evaluate(() => window.__node.onConfigure?.({ properties: window.__node.properties })); await page.waitForTimeout(150);
    check("reloading the workflow keeps the gradient", (await st()).layers.find((l) => l.grad)?.grad.k === "linear");
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = s.layers.filter((l) => !l.grad); window.__node.__rgRefresh(); });
    await fill.click({ button: "right" });
    await page.evaluate(() => window.__toolMenu().opts.callback(window.__toolMenu().items[3]));
    await dragImg([[64, 128], [64, 160]]);
    gl = (await st()).layers.find((l) => l.grad);
    check("radial gradient: from the point outward", gl?.grad.k === "radial" && Math.abs(gl.grad.b[1] - 160 / 256) < 0.01 && (await gpx(64, 128)) > (await gpx(64, 152)) + 60);
    await fill.click({ button: "right" });
    await page.evaluate(() => window.__toolMenu().opts.callback(window.__toolMenu().items[0]));
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = []; });

    // ---- magic wand on an image: left half red, right half blue
    await page.evaluate(async () => {
        const c = document.createElement("canvas"); c.width = 256; c.height = 256;
        const x = c.getContext("2d"); x.fillStyle = "#c03030"; x.fillRect(0, 0, 128, 256); x.fillStyle = "#3040c0"; x.fillRect(128, 0, 128, 256);
        x.fillStyle = "#c83434"; x.fillRect(150, 20, 20, 20);          // a red-ish speck inside the blue half
        const img = new Image(); img.src = c.toDataURL(); await img.decode();
        window.__node.inputs = [{ name: "image", link: 7 }];          // keeps the node's poll from dropping the backdrop
        window.__node.__rgSetBackdrop(img);
    });
    await wand.click({ button: "right" });
    await page.evaluate(() => window.__toolMenu().opts.callback(window.__toolMenu().items[0]));
    await clickImg(40, 128);
    let s = await st();
    let W = s.layers.find((l) => l.name.startsWith("Wand"));
    const maskOf = (L) => { const o = L.ops[L.ops.length - 1], m = new Uint8Array(o.w * o.h); let pos = 0, v = 0; for (const r of o.runs) { if (v) m.fill(1, pos, pos + r); pos += r; v ^= 1; } return (x, y) => m[y * o.w + x]; };
    let m = W && maskOf(W);
    check("wand (connected): selects the red half only", m && m(10, 10) === 1 && m(120, 200) === 1 && m(200, 200) === 0 && m(160, 30) === 0);
    await page.keyboard.press("Escape");
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = []; });
    await wand.click({ button: "right" });
    await page.evaluate(() => window.__toolMenu().opts.callback(window.__toolMenu().items[1]));
    await clickImg(40, 128);
    W = (await st()).layers.find((l) => l.name.startsWith("Wand"));
    m = W && maskOf(W);
    check("wand (all similar colors): also the red speck", m && m(10, 10) === 1 && m(160, 30) === 1 && m(200, 200) === 0);
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = []; });

    // ---- magnetic lasso follows the red / blue edge at x = 128
    await lasso.click({ button: "right" });
    await page.evaluate(() => window.__toolMenu().opts.callback(window.__toolMenu().items[2]));
    check("lasso: magnetic version picked", /^Lasso \(magnetic\)/.test(await lasso.getAttribute("title")));
    await page.keyboard.press("Escape");
    await dragImg([[124, 40], [124, 120], [124, 200], [60, 200], [60, 40], [122, 40]]);
    s = await st();
    const P = s.layers.at(-1)?.ops.at(-1)?.p || [];
    const nearEdge = P.map(([x, y]) => [x * 256, y * 256]).filter(([x, y]) => y > 60 && y < 180 && x > 100);
    check("magnetic lasso: points pulled onto the edge", nearEdge.length >= 3 && nearEdge.every(([x]) => Math.abs(x - 128) <= 2));
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = []; });

    // ---- eyedropper: Alt+click picks the region under the pointer
    await page.evaluate(() => {
        const s = window.__node.__rgState(), A = s.regions[1].id;
        s.layers.push({ id: 5, name: "A", region: A, visible: true, shape: "rect", sides: 5, bw: 0.3, bh: 0.3, sx: 1, sy: 1, rot: 0, ox: -0.3, oy: -0.3, ops: [] });
    });
    const B = s.regions[0].id, A = s.regions[1].id;
    await page.locator('.rg-bar .rg-btn.icon[title^="Brush"]').click();
    await clickImg(200, 200);                                           // paints B somewhere empty
    check("brush paints the active region (B)", (await st()).layers.some((l) => l.region === B));
    await clickImg(50, 50, ["Alt"]);
    check("Alt+click: region A becomes active", await page.evaluate(() => window.__node.__rgActive()) === A);
    const nLayers = (await st()).layers.length;
    check("Alt+click doesn't paint", nLayers === 2);

    // ---- Shift+click straight line from the last stroke's end
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = []; });
    await page.keyboard.press("Escape");
    await clickImg(40, 220);
    await clickImg(200, 220, ["Shift"]);
    s = await st();
    const ops = s.layers.flatMap((l) => l.ops.map((o) => o.p.map(([x, y]) => [Math.round(x * 256), Math.round(y * 256)])));
    check("Shift+click: a 2-point line from the last stroke's end", ops.some((p) => p.length === 2 && p[0][0] === 40 && p[1][0] === 200));

    // ---- rounded rectangle, from the centre with Alt
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = []; });
    await page.locator('.rg-bar .rg-btn[data-group="shape"]').click({ button: "right" });
    await page.evaluate(() => window.__toolMenu().opts.callback(window.__toolMenu().items.find((i) => /Rounded rectangle/.test(i.content))));
    const radIn = page.locator('.rg-toolopts input[title^="Corner radius"]');
    check("rounded rectangle: radius field shown", await inStrip(radIn));
    await radIn.fill("30"); await radIn.press("Tab");
    await dragImg([[128, 128], [178, 158]], ["Alt"]);
    s = await st();
    let L = s.layers.at(-1);
    check("rounded rectangle drawn with its radius", L?.shape === "roundrect" && L.radius === 30);
    check("Alt: drawn from the centre", L && Math.abs(L.ox) < 1e-6 && Math.abs(L.oy) < 1e-6 && Math.abs(L.bw * 256 - 100) < 1 && Math.abs(L.bh * 256 - 60) < 1);
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    const shapePx = await page.evaluate(() => {
        const c = document.querySelector(".rg-cv canvas"), x = c.getContext("2d");
        const n = window.__node.__rgView(), at = (ix, iy) => x.getImageData(Math.round(n.x + ix * n.z), Math.round(n.y + iy * n.z), 1, 1).data;
        return { corner: at(82, 102), mid: at(128, 102), centre: at(128, 128) };
    });
    check("canvas: corner cut, edge middle filled", shapePx.corner[0] + shapePx.corner[1] + shapePx.corner[2] < shapePx.mid[0] + shapePx.mid[1] + shapePx.mid[2] - 30);

    // ---- arrange: flip, align, grow
    const arrange = page.locator('.rg-bar .rg-btn.icon[title^="Arrange"]');
    check("arrange disabled with no layer selected", await arrange.isDisabled());
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = []; });
    await page.locator('.rg-bar .rg-btn.icon[title^="Brush"]').click();
    await dragImg([[40, 40], [100, 40], [100, 80]]);
    await arrange.click();
    check("arrange pop-over opens", await page.locator(".rg-arrange").isVisible());
    const box0 = await page.evaluate(() => window.__node.__rgBox());
    const p0 = (await st()).layers[0].ops[0].p.map(([x, y]) => [x * 256, y * 256]);
    await page.locator('.rg-arrange button[title^="Flip horizontally"]').click();
    const p1 = (await st()).layers[0].ops[0].p.map(([x, y]) => [x * 256, y * 256]);
    const box1 = await page.evaluate(() => window.__node.__rgBox());
    const bx0 = Math.min(...box0.map((c) => c[0])), bx1 = Math.max(...box0.map((c) => c[0]));
    check("flip H mirrors the stroke in place", Math.abs(p1[0][0] - (bx0 + bx1 - p0[0][0])) < 1.5 && Math.abs(p1[0][1] - p0[0][1]) < 1e-6
        && Math.abs(Math.min(...box1.map((c) => c[0])) - bx0) < 1.5);
    await page.locator('.rg-arrange button[title^="Align to the left"]').click();
    const box2 = await page.evaluate(() => window.__node.__rgBox());
    check("align left: box at x = 0", Math.abs(Math.min(...box2.map((c) => c[0]))) < 1.5);
    await page.locator('.rg-arrange button[title^="Centre in the image"]').click();
    const box3 = await page.evaluate(() => window.__node.__rgBox());
    const cx = (Math.min(...box3.map((c) => c[0])) + Math.max(...box3.map((c) => c[0]))) / 2, cy = (Math.min(...box3.map((c) => c[1])) + Math.max(...box3.map((c) => c[1]))) / 2;
    check("centre: box centred", Math.abs(cx - 128) < 1.5 && Math.abs(cy - 128) < 1.5);
    const w0 = Math.max(...box3.map((c) => c[0])) - Math.min(...box3.map((c) => c[0]));
    await page.locator('.rg-arrange button[title^="Grow the layer"]').click();
    s = await st();
    const box4 = await page.evaluate(() => window.__node.__rgBox());
    const w1 = Math.max(...box4.map((c) => c[0])) - Math.min(...box4.map((c) => c[0]));
    check("grow 8 px: layer becomes pixels, 16 px wider", s.layers[0].ops.length === 1 && s.layers[0].ops[0].t === "bitmap" && Math.abs(w1 - w0 - 16) <= 2);
    await page.locator('.rg-arrange button[title^="Shrink the layer"]').click();
    const box5 = await page.evaluate(() => window.__node.__rgBox());
    const w2 = Math.max(...box5.map((c) => c[0])) - Math.min(...box5.map((c) => c[0]));
    check("shrink 8 px back", Math.abs(w2 - w0) <= 2);
    await page.screenshot({ path: require("path").join(__dirname, "out", "ui6_arrange.png"), clip: { x: 0, y: 0, width: 760, height: 200 } });
    await page.mouse.click(5, 1090);
    check("arrange closes on a click outside", await page.locator(".rg-arrange").count() === 0);
    // shape flipped upside down: a triangle turns 180°
    await page.evaluate(() => { const s = window.__node.__rgState(); s.layers = [{ id: 9, name: "T", region: s.regions[0].id, visible: true, shape: "triangle", sides: 5, bw: 0.4, bh: 0.4, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, ops: [] }]; });
    await page.locator('.rg-bar .rg-btn.icon[title^="Select:"]').click();
    await clickImg(128, 140);
    await arrange.click();
    await page.locator('.rg-arrange button[title^="Flip vertically"]').click();
    check("flip V on a triangle: turned 180°", Math.abs(Math.abs((await st()).layers[0].rot) - 180) < 1e-6);

    // ---- footer screenshot, and Settings: the new entries
    const ids = await page.evaluate(() => window.__settingsExt.settings.map((s) => s.id));
    check("Settings: wand / fill entries", ["RegionGenie.Tools.Wand", "RegionGenie.Tools.WandTolerance", "RegionGenie.Tools.Fill", "RegionGenie.Tools.FillGap"].every((i) => ids.includes(i)));
    await page.screenshot({ path: require("path").join(__dirname, "out", "ui6.png"), fullPage: false });
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
