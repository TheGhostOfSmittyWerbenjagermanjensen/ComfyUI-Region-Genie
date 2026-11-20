// Browser checks of round 35: the prompt written inside its region on the canvas, the calm region colors and their
// Setting, and drag to reorder regions and layers by the grip. (The stub node's image is 256 px wide.)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1100 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__settingsExt.setup());
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__node.__rgState())));
    const toClient = (x, y) => page.evaluate(([x, y]) => window.__node.__rgToClient(x, y), [x, y]);
    const box = async (a, b, c, d) => {
        let [x, y] = await toClient(a, b); await page.mouse.move(x, y); await page.mouse.down();
        [x, y] = await toClient(c, d); await page.mouse.move(x, y, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(150);
    };
    const add = page.locator('[title^="Add a region with a new color"]');
    const rows = page.locator(".rg-row.region");
    const region = async (a, b, c, d, prompt) => {
        await add.click(); await page.waitForTimeout(100); await box(a, b, c, d);
        if (prompt) { const t = rows.first().locator("textarea.rg-prompt"); await t.click(); await page.keyboard.type(prompt); await page.keyboard.press("Enter"); await page.waitForTimeout(80); }
    };
    // labels in client pixels: { rid, inside, x0, y0, x1, y1 }
    const labels = () => page.evaluate(() => window.__node.__rgLabels().map((l) => { const [x0, y0] = window.__node.__rgRegionToClient(l.x0, l.y0), [x1, y1] = window.__node.__rgRegionToClient(l.x1, l.y1); return { rid: l.rid, inside: !!l.inside, x0, y0, x1, y1 }; }));

    // ---- colors: purple first, then golden yellow, then the rest of the list, in order
    const LONG = "a windswept cliff at sunset, dramatic clouds, warm light on the rocks, the sea far below, gulls in the distance";
    await region(20, 20, 236, 236, LONG);
    await region(100, 110, 160, 170, "a knight");
    await region(4, 4, 13, 10, "a small bird");
    const s0 = await st();
    const byPrompt = (s, p) => s.regions.find((r) => r.prompt.startsWith(p));
    check(`new regions take the calm colors in order: purple, golden yellow, teal (${s0.regions.map((r) => r.color).reverse().join(" ")})`,
        byPrompt(s0, "a windswept").color === "#8F73D1" && byPrompt(s0, "a knight").color === "#E3B341" && byPrompt(s0, "a small").color === "#3FA9A0");

    // ---- the prompt inside its region
    await page.evaluate(() => window.__node.__rgSetTool("select")); await page.waitForTimeout(250);
    const L = await labels(), A = byPrompt(s0, "a windswept"), B = byPrompt(s0, "a knight"), C = byPrompt(s0, "a small");
    const la = L.find((l) => l.rid === A.id), lb = L.find((l) => l.rid === B.id), lc = L.find((l) => l.rid === C.id);
    const [ax0, ay0] = await toClient(20, 20), [ax1, ay1] = await toClient(236, 236), [bx0, by0] = await toClient(100, 110), [bx1, by1] = await toClient(160, 170);
    const within = (l, x0, y0, x1, y1) => l && l.x0 >= x0 - 1 && l.y0 >= y0 - 1 && l.x1 <= x1 + 1 && l.y1 <= y1 + 1;
    check("a region with room has its prompt written inside it", la?.inside && lb?.inside && within(la, ax0, ay0, ax1, ay1) && within(lb, bx0, by0, bx1, by1));
    check("a long prompt takes several lines there (more than the old three-line label could hold)", la && la.y1 - la.y0 > 30);
    check("the text of a region lies clear of the region drawn over it", la && (la.x1 <= bx0 || la.x0 >= bx1 || la.y1 <= by0 || la.y0 >= by1));
    check("a region too small for a line of text keeps the compact label", lc && !lc.inside);
    // double-click the text: the region's pop-up editor
    await page.mouse.dblclick((lb.x0 + lb.x1) / 2, (lb.y0 + lb.y1) / 2); await page.waitForTimeout(250);
    check("double-click on the text opens that region's pop-up editor", await page.locator(".rg-pop").count() === 1 && /a knight/.test(await page.locator(".rg-pop textarea").first().inputValue()));
    await page.keyboard.press("Escape"); await page.waitForTimeout(150);
    check("the double-click drew nothing and moved nothing", JSON.stringify((await st()).layers) === JSON.stringify(s0.layers));

    // ---- Settings > Region colors: the user's own list
    const def = await page.evaluate(() => { const s = window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Main.RegionColors"); return s && { fn: typeof s.type === "function", d: s.defaultValue }; });
    check("Settings: 'Region colors' starts with purple and golden yellow", def?.fn && def.d.startsWith("#8F73D1, #E3B341"));
    const ui = await page.evaluate(async () => {
        const s = window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Main.RegionColors");
        let set = null; const el = s.type(s.name, (v) => { set = v; }, "#FF8800, #00AAFF, #000000, bad, #ff8800");
        document.body.appendChild(el); el.id = "colorsUi";
        const sw = () => [...el.querySelectorAll(".sw")].map((b) => b.dataset.color);
        const a = sw();
        el.querySelectorAll(".act")[0].click(); const b = sw(), setB = set;                    // ＋
        el.querySelector(".sw").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); const c = sw(), setC = set;
        await new Promise((r) => setTimeout(r, 50));
        return { a, b, c, setB, setC, stored: window.__settings["RegionGenie.Main.RegionColors"], tips: [...el.querySelectorAll("[title]")].every((e) => e.title) };
    });
    check("the list reads colors as given, without black, bad or repeated entries", ui.a.join() === "#FF8800,#00AAFF");
    check("＋ adds the next built-in color; right-click removes one; both are saved", ui.b.join() === "#FF8800,#00AAFF,#8F73D1" && ui.c.join() === "#00AAFF,#8F73D1" && ui.stored === "#00AAFF, #8F73D1" && ui.setC === ui.stored);
    await page.evaluate(() => { window.__settings["RegionGenie.Main.RegionColors"] = "#FF8800, #00AAFF"; document.getElementById("colorsUi").remove(); });
    await region(200, 4, 250, 14, "");
    check("a new region takes the first of the user's colors that isn't on the canvas", (await st()).regions[0].color === "#FF8800");
    // a layout converted from boxes arrives with Python's colors and the "recolor" mark: the user's colors replace them
    await page.evaluate(() => window.__node.onExecuted({ layout_import: [JSON.stringify({ action: "applied", sig: "x1", scene_prompt: "",
        state: { v: 2, recolor: true, regions: [{ id: 1, color: "#8F73D1", prompt: "one", type: "object", text: "" }, { id: 2, color: "#E3B341", prompt: "two", type: "object", text: "" }, { id: 3, color: "#3FA9A0", prompt: "three", type: "object", text: "" }], layers: [] } })] }));
    await page.waitForTimeout(150);
    check("a layout converted from boxes is colored with the user's colors (a third region keeps the built-in one)", (await st()).regions.map((r) => r.color).join() === "#FF8800,#00AAFF,#3FA9A0");
    let [ux, uy] = await toClient(128, 128); await page.mouse.move(ux, uy); await page.keyboard.press("Control+z"); await page.waitForTimeout(150);
    await page.evaluate(() => { delete window.__settings["RegionGenie.Main.RegionColors"]; });

    // ---- drag a region by its grip
    await page.evaluate(() => { document.querySelector(".rg-list").parentElement.style.height = "560px"; });      // room for every row
    await page.waitForTimeout(250);
    const order = async () => (await st()).regions.map((r) => r.prompt.split(" ").slice(0, 2).join(" "));
    const before = await order();
    check(`every region row and layer row starts with a grip (${before.length} regions)`, await page.locator(".rg-row.region > .rg-grip:first-child").count() === before.length);
    const dragTo = async (from, toEl, where) => {            // where: "top" | "bottom" | "middle"
        const g = await from.boundingBox(), t = await toEl.boundingBox();
        await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
        const y = where === "top" ? t.y + 2 : where === "bottom" ? t.y + t.height - 2 : t.y + t.height / 2;
        await page.mouse.move(g.x + 8, (g.y + y) / 2, { steps: 4 }); await page.mouse.move(g.x + 8, y, { steps: 4 });
    };
    // a click on a grip (no drag) picks its row, as the prompt field does
    const lastRid = (await st()).regions.at(-1).id;
    const gl = await rows.nth(before.length - 1).locator(".rg-grip").boundingBox();
    await page.mouse.click(gl.x + gl.width / 2, gl.y + gl.height / 2); await page.waitForTimeout(120);
    check("a click on a region's grip makes that region the active one (and moves nothing)", await page.evaluate(() => window.__node.__rgActive()) === lastRid
        && await rows.nth(before.length - 1).evaluate((r) => r.classList.contains("sel")) && (await order()).join() === before.join());
    const g1 = await rows.nth(1).locator(".rg-grip").boundingBox();
    await page.mouse.click(g1.x + g1.width / 2, g1.y + g1.height / 2); await page.waitForTimeout(120);
    check("and another region's grip makes that one active", await page.evaluate(() => window.__node.__rgActive()) === (await st()).regions[1].id && await page.locator(".rg-row.region.sel").count() === 1);
    await dragTo(rows.nth(before.length - 1).locator(".rg-grip"), rows.nth(0), "top");
    check("while dragging: a line shows where the region will land", await page.locator(".rg-list .rg-dropline").count() === 1 && await page.locator(".rg-row.region.dragging").count() === 1);
    await page.mouse.up(); await page.waitForTimeout(150);
    const after = await order();
    check(`the last region dragged to the top is first now (${after.join(" | ")})`, after[0] === before[before.length - 1] && after.slice(1).join() === before.slice(0, -1).join());
    check("its layers moved to the front with it", (await st()).layers.at(-1).region === (await st()).regions[0].id);
    await page.mouse.move(ux, uy); await page.keyboard.press("Control+z"); await page.waitForTimeout(150);
    check("Ctrl+Z puts the order back", (await order()).join() === before.join());
    // let go outside the list: nothing changes
    const g0 = await rows.nth(0).locator(".rg-grip").boundingBox();
    await page.mouse.move(g0.x + 5, g0.y + 5); await page.mouse.down(); await page.mouse.move(820, 80, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(100);
    check("dropped outside the list: nothing moves", (await order()).join() === before.join() && await page.locator(".rg-dropline").count() === 0);

    // ---- drag layers: within a region, and onto another region
    const knight = byPrompt(await st(), "a knight"), cliff = byPrompt(await st(), "a windswept");
    await page.evaluate((rid) => { const n = window.__node, s = n.__rgState(); const l = s.layers.find((x) => x.region === rid); s.layers.push({ ...JSON.parse(JSON.stringify(l)), id: 99, name: "Second" }); n.__rgRefresh(); }, knight.id);
    await page.locator('[title^="Show or hide everything in the list"]').click(); await page.waitForTimeout(100);
    if (!(await page.locator(".rg-row.layer").count())) { await page.locator('[title^="Show or hide everything in the list"]').click(); await page.waitForTimeout(100); }
    const lrow = (lid) => page.locator(`.rg-row.layer[data-lid="${lid}"]`);
    const first = (await st()).layers.find((l) => l.region === knight.id && l.id !== 99).id;
    const stackOf = async (rid) => (await st()).layers.filter((l) => l.region === rid).map((l) => l.id);
    check("the copy is on top of the knight's layers", (await stackOf(knight.id)).join() === `${first},99`);
    // a click on a layer's grip selects that layer, as its name field does
    await page.evaluate(() => window.__node.__rgSelectLayer(null)); await page.waitForTimeout(80);
    const lg = await lrow(first).locator(".rg-grip").boundingBox();
    await page.mouse.click(lg.x + lg.width / 2, lg.y + lg.height / 2); await page.waitForTimeout(120);
    check("a click on a layer's grip selects that layer and makes its region active", await lrow(first).evaluate((r) => r.classList.contains("sel"))
        && await page.evaluate(() => window.__node.__rgActive()) === knight.id && await page.locator(`.rg-row.region.sel[data-rid="${knight.id}"]`).count() === 1
        && (await stackOf(knight.id)).join() === `${first},99`);
    await dragTo(lrow(99).locator(".rg-grip"), lrow(first), "bottom"); await page.mouse.up(); await page.waitForTimeout(150);
    check("a layer dragged below another goes under it in the stack", (await stackOf(knight.id)).join() === `99,${first}`);
    await dragTo(lrow(99).locator(".rg-grip"), page.locator(`.rg-row.region[data-rid="${cliff.id}"]`), "middle");
    check("over a region's row: the row lights up", await page.locator(".rg-row.region.dropon").count() === 1);
    await page.mouse.up(); await page.waitForTimeout(150);
    const moved = (await st()).layers.find((l) => l.id === 99);
    check("dropped on another region's row: the layer moves into that region, on top of its layers", moved.region === cliff.id && (await stackOf(cliff.id)).at(-1) === 99);

    // ---- round 41: the marks before a label's prompt are drawn shapes, not emoji: a person for a character region,
    // a lock for a region kept as it is in Edit Mode. They take 14 px each before the text.
    const raw = (rid) => page.evaluate((rid) => { const l = window.__node.__rgLabels().find((x) => x.rid === rid); return l ? { w: l.x1 - l.x0, marks: l.marks || [], inside: !!l.inside, plate: l.plate } : null; }, rid);
    const setReg = async (rid, patch) => { await page.evaluate(([rid, patch]) => { Object.assign(window.__node.__rgState().regions.find((r) => r.id === rid), patch); window.__node.__rgRefresh(); }, [rid, patch]); await page.waitForTimeout(150); };
    const dprNow = await page.evaluate(() => window.devicePixelRatio || 1);
    const l0 = await raw(cliff.id);
    await setReg(cliff.id, { type: "character" });
    const l1 = await raw(cliff.id);
    check(`a character region's label carries the person mark and still fits its region (at most ${14 * dprNow} canvas px wider; ${Math.round(l0?.w)} -> ${Math.round(l1?.w)})`, !!l0 && !l0.marks.length && l1.marks.join() === "person" && l1.w > l0.w * 0.8 && l1.w <= l0.w + 14 * dprNow + 2);
    const drawn = await page.evaluate(() => { const calls = []; const P = CanvasRenderingContext2D.prototype, f = P.fillText, fl = P.fill; let fills = 0;
        P.fillText = function (t) { calls.push(String(t)); return f.apply(this, arguments); }; P.fill = function (p) { if (p instanceof Path2D) fills++; return fl.apply(this, arguments); };
        window.__node.__rgRefresh();
        return new Promise((res) => setTimeout(() => { P.fillText = f; P.fill = fl; res({ emoji: calls.some((t) => /[\u{1F464}\u{1F512}]/u.test(t)), fills }); }, 300)); });
    check(`no emoji is written on the canvas any more; the mark is a filled shape (${drawn.fills} shape fills in one redraw)`, !drawn.emoji && drawn.fills >= 1);
    await page.locator('.rg-foot [title^="Edit: Change the image"]').click(); await page.waitForTimeout(200);
    await setReg(cliff.id, { keep: true });
    const l2 = await raw(cliff.id);
    check("in Edit Mode a kept character region carries the lock, then the person", l2.marks.join() === "lock,person");
    // round 42: a kept region is an outline over the picture it keeps, so its label (number and prompt) gets a dark plate
    const corner = (rid) => page.evaluate((rid) => { const l = window.__node.__rgLabels().find((x) => x.rid === rid), g = document.querySelector(".rg-cv canvas").getContext("2d");
        const d = g.getImageData(Math.round(l.x0 + 1), Math.round(l.y0 + 1), 1, 1).data; return d[0] + d[1] + d[2]; }, rid);
    const litKept = await corner(cliff.id);
    await setReg(cliff.id, { keep: false });
    const l3 = await raw(cliff.id), litPlain = await corner(cliff.id);
    check(`in Edit Mode the label of a kept region lies on a dark plate; not kept: none (${l2.inside}, ${l2.plate} / ${l3.plate}; brightness at the label's corner ${litKept} / ${litPlain})`,
        l2.inside && l2.plate === true && l3.plate === false && litKept < litPlain * 0.75);
    await setReg(cliff.id, { keep: true });
    await page.locator(".rg-foot .rg-seg .rg-btn").first().click(); await page.waitForTimeout(200);
    check("back in Generate mode: the lock goes, the person stays, and so does the plate", (await raw(cliff.id)).marks.join() === "person" && (await raw(cliff.id)).plate === false);
    await setReg(cliff.id, { type: "object", keep: false });
    check("an object region has no mark", (await raw(cliff.id)).marks.length === 0);

    await page.screenshot({ path: require("path").join(__dirname, "out", "ui_labels_colors_drag.png"), fullPage: false });
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
