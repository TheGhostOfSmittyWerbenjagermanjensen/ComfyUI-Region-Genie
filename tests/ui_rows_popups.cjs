// Round 9 browser checks (stub page): region eye. (Size row and wildcards are added below as they are built.)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
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
    const status = () => page.evaluate(() => [...document.querySelectorAll(".rg-hint")].map((e) => e.textContent).join(" | "));
    // a pixel of the rendered canvas (64 x 64), image x / y in 0..1
    const px = (x, y) => page.evaluate(async ([x, y]) => {
        const img = new Image(); img.src = window.__node.__rgRender(64, 64); await img.decode();
        const c = document.createElement("canvas"); c.width = 64; c.height = 64; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        return [...g.getImageData(Math.floor(x * 64), Math.floor(y * 64), 1, 1).data].slice(0, 3);
    }, [x, y]);

    // ---------------- region eye
    const addRegion = page.locator(".rg-head .rg-btn.icon").first();
    await addRegion.click(); await addRegion.click();
    await page.evaluate(() => {
        const s = window.__node.__rgState();
        const L = (id, region, ox) => ({ id, name: "Rect " + id, region, visible: true, shape: "rect", sides: 5, bw: 0.5, bh: 1, sx: 1, sy: 1, rot: 0, ox, oy: 0, ops: [] });
        s.layers.push(L(1, s.regions[1].id, -0.25), L(2, s.regions[0].id, 0.25));
        s.regions[0].prompt = "right"; s.regions[1].prompt = "left";
    });
    await page.evaluate(() => window.__node.__rgRefresh());
    await page.waitForTimeout(150);
    const eyes = page.locator(".rg-row.region .rg-reye");
    check("an eye on each region row", await eyes.count() === 2);
    check("both regions drawn", (await px(0.75, 0.5)).some((v) => v > 0) && (await px(0.25, 0.5)).some((v) => v > 0));
    check("both in the outputs", (await page.evaluate(() => window.__node.__rgOutputRegions().length)) === 2);
    await eyes.first().click(); await page.waitForTimeout(120);
    let s = await st();
    check("eye hides the region (flag on the region)", s.regions[0].hidden === true);
    check("its layers keep their own show / hide", s.layers.every((l) => l.visible === true));
    check("hidden region not drawn", (await px(0.75, 0.5)).every((v) => v === 0) && (await px(0.25, 0.5)).some((v) => v > 0));
    const out = await page.evaluate(() => window.__node.__rgOutputRegions());
    check("hidden region left out of the outputs", out.length === 1 && out[0].prompt === "left");
    check("hidden row dimmed, index '–'", await page.locator(".rg-row.region.off").count() === 1
        && (await page.locator(".rg-row.region.off .rg-idx").textContent()) === "–");
    check("hidden region's label not drawn", (await page.evaluate(() => window.__node.__rgLabels().map((l) => l.rid))).length === 1);
    await page.keyboard.press("Control+z"); await page.waitForTimeout(100);
    check("undo shows it again", !(await st()).regions[0].hidden);
    await page.keyboard.press("Control+y"); await page.waitForTimeout(100);
    check("redo hides it again", (await st()).regions[0].hidden === true);
    // drawing into the hidden (active) region shows it again
    await page.evaluate(() => { const s = window.__node.__rgState(); });
    await page.locator(".rg-row.region.off .rg-prompt").click();                 // make it the active region
    await page.locator('.rg-bar .rg-btn.icon[title^="Shape"]').click();
    const a = await page.evaluate(() => window.__node.__rgToClient(20, 200)), b = await page.evaluate(() => window.__node.__rgToClient(60, 240));
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(120);
    s = await st();
    check("drawing into a hidden region shows it again (with a note)", !s.regions[0].hidden && s.layers.length === 3 && /was hidden/.test(await status()));
    await eyes.nth(1).click(); await page.waitForTimeout(80);
    await eyes.nth(1).click(); await page.waitForTimeout(80);
    check("clicking twice: back as it was", !(await st()).regions[1].hidden);

    // ---------------- image size row
    const row = page.locator(".rg-size");
    const wv = () => page.evaluate(() => [window.__node.widgets.find((w) => w.name === "width").value, window.__node.widgets.find((w) => w.name === "height").value]);
    const modeBtn = (t) => row.locator(`.rg-seg .rg-btn[title^="${t}"]`);
    const sizeOut = () => row.locator(".rg-size-out").textContent();
    check("size row: one row with the 3 modes", await row.count() === 1 && await row.locator(".rg-seg .rg-btn").count() === 3);
    // the stub node is set up like one loaded from a workflow saved before the size row: manual, with its size
    check("node without size settings: manual mode with its width / height", JSON.stringify(await wv()) === "[256,256]"
        && await modeBtn("Manual: Image size").evaluate((b) => b.classList.contains("on")));
    await modeBtn("Aspect ratio: Image size").click(); await page.waitForTimeout(60);
    check("aspect ratio mode from Settings defaults: 1:1, 1 MP = 1024 x 1024", JSON.stringify(await wv()) === "[1024,1024]");
    // the same results as ComfyUI's Resolution Selector (values from comfy_extras/nodes_resolution.py)
    const ratioCase = async (aspect, mp, mult) => {
        await row.locator("select.rg-sel").first().selectOption(aspect);
        const [mpIn, multIn] = [row.locator(".rg-size-part").first().locator("input.rg-num").nth(0), row.locator(".rg-size-part").first().locator("input.rg-num").nth(1)];
        await mpIn.fill(String(mp)); await mpIn.press("Enter");
        await multIn.fill(String(mult)); await multIn.press("Enter");
        await page.waitForTimeout(60);
        return JSON.stringify(await wv());
    };
    check("16:9, 1 MP, x8 = 1368 x 768", await ratioCase("16:9 (Widescreen)", 1, 8) === "[1368,768]");
    check("2:3, 1.5 MP, x16 = 1024 x 1536", await ratioCase("2:3 (Portrait Photo)", 1.5, 16) === "[1024,1536]");
    check("21:9, 2 MP, x64 = 2240 x 960", await ratioCase("21:9 (Ultrawide)", 2, 64) === "[2240,960]");
    check("4:3, 16 MP, x128 = 4736 x 3584", await ratioCase("4:3 (Standard)", 16, 128) === "[4736,3584]");
    check("the size row's readout and the canvas follow", /4736 × 3584/.test(await sizeOut()) && JSON.stringify(await page.evaluate(() => window.__node.__rgDims())) === "[4736,3584]");
    await ratioCase("21:9 (Ultrawide)", 2, 64);
    await row.locator(".rg-size-part").first().locator(".rg-btn.icon").click(); await page.waitForTimeout(60);
    check("swap: 9:21 portrait = 960 x 2240", JSON.stringify(await wv()) === "[960,2240]");
    // presets
    await modeBtn("Presets: Image size").click(); await page.waitForTimeout(60);
    const pre = row.locator("select.rg-size-pre");
    // round 51: presets mode has its own size (a new node: the first preset), not the one the other mode made
    check("presets mode shows its own preset (1024 x 1024), not the aspect ratio's size", JSON.stringify(await wv()) === "[1024,1024]" && await pre.inputValue() === "1024x1024"
        && await pre.locator("option[data-extra]").count() === 0);
    const addOpts = async () => (await pre.locator("option").allTextContents()).filter((t) => /^＋ Add/.test(t));
    check(`…and offers the sizes of the other two modes as entries to add (${(await addOpts()).join(" | ")})`, (await addOpts()).length === 2 && /^＋ Add 960 × 2240\s+\(the aspect ratio size\)/.test((await addOpts())[0])
        && /^＋ Add 256 × 256\s+\(the manual size\)/.test((await addOpts())[1]));
    check("presets: the 9 starting sizes, the two entries to add, Edit list…", await pre.locator("option:not([disabled])").count() === 12
        && (await pre.locator("option").last().textContent()) === "Edit list…" && /＋ Add …:/.test(await pre.getAttribute("title")));
    await pre.selectOption("1216x832"); await page.waitForTimeout(60);
    check("preset 1216 x 832", JSON.stringify(await wv()) === "[1216,832]" && await pre.locator("option[data-extra]").count() === 0);
    check("presets show their ratio", /1216 × 832\s+\(3:2\)/.test(await pre.locator("option[value='1216x832']").textContent()));
    await pre.selectOption("__edit__"); await page.waitForTimeout(100);
    const pop = page.locator(".rg-presets");
    check("Edit list… opens the editor, the choice stays", await pop.isVisible() && await pre.inputValue() === "1216x832");
    await pop.locator(".rg-presets-row").first().locator(".rg-presets-name").fill("square"); await pop.locator(".rg-presets-row").first().locator(".rg-presets-name").press("Tab");
    await pop.locator(".rg-presets-row").nth(1).locator('button[data-ic="close"]').click();
    await page.waitForTimeout(60);
    const setTxt = () => page.evaluate(() => window.__settings["RegionGenie.Size.Presets"]);
    check("editing saves to the shared Setting", /^1024x1024 square; 896x1152;/.test(await setTxt() || ""));
    // ---- round 69: columns with headers that sort, a handle to drag a row, no up / down buttons
    const prow = () => page.evaluate(() => [...document.querySelectorAll(".rg-presets .rg-presets-row")].map((r) => { const i = r.querySelectorAll("input"); return [+i[0].value, +i[1].value, i[2].value || i[2].placeholder]; }));
    const lay = await page.evaluate(() => { const rows = [...document.querySelectorAll(".rg-presets .rg-presets-row")], col = (k) => rows.map((r) => r.children[k].getBoundingClientRect());
        const same = (rs) => new Set(rs.map((r) => Math.round(r.left) + ":" + Math.round(r.width))).size === 1;
        const heads = [...document.querySelectorAll(".rg-presets .rg-presets-col")];
        return { same: [0, 1, 2, 3, 4].map((k) => same(col(k))), heads: heads.map((h) => h.textContent.trim()), headAt: heads.map((h, k) => Math.round(h.getBoundingClientRect().left) === Math.round(col(k + 1)[0].left) && Math.round(h.getBoundingClientRect().width) === Math.round(col(k + 1)[0].width)),
            wEq: Math.round(col(1)[0].width) === Math.round(col(2)[0].width), grips: rows.every((r) => r.children[0].classList.contains("rg-grip") && r.children[0].querySelector("svg")), btns: rows.every((r) => r.querySelectorAll("button").length === 1),
            area: rows.every((r) => [r.children[0], r.children[4]].every((e) => { const b = e.getBoundingClientRect(), a = getComputedStyle(e, "::before"); return parseFloat(a.height) >= 24 && parseFloat(a.width) > b.width; })) }; });
    check(`the list is a table: every column's fields start at one place and are equally wide (${lay.same}); width and height are as wide as each other`, lay.same.every(Boolean) && lay.wEq);
    const fits = await page.evaluate(() => { const L = document.querySelector(".rg-presets-list"), P = document.querySelector(".rg-presets"); return [L.scrollWidth - L.clientWidth, L.scrollHeight - L.clientHeight, P.scrollWidth - P.clientWidth, P.scrollHeight - P.clientHeight, getComputedStyle(L).overflowX]; });
    check(`nothing in the list sticks out of it: no scroll bar for a pixel or two (${fits})`, fits.slice(0, 4).every((d) => d <= 0) && fits[4] === "hidden");
    check(`headers Width, Height, Name stand over their columns (${lay.heads})`, lay.heads.join() === "Width,Height,Name" && lay.headAt.every(Boolean));
    check("each row has a handle on the left and one button, remove; the click areas of both are at least 24 px tall and wider than they look", lay.grips && lay.btns && lay.area);
    const before69 = await prow(), keyOf = (r) => r.join("/");
    const hd = (name) => page.locator(".rg-presets .rg-presets-col", { hasText: name });
    await hd("Width").click(); await page.waitForTimeout(80);
    let now69 = await prow();
    check(`Width sorts the rows by width, smallest first (${now69.map((r) => r[0])}), and shows an arrow`, now69.every((r, i) => !i || now69[i - 1][0] <= r[0]) && await hd("Width").getAttribute("data-dir") === "up" && await page.locator(".rg-presets .rg-presets-dir").count() === 1);
    check("…whole rows moved: each width still has its height and name", now69.map(keyOf).sort().join() === before69.map(keyOf).sort().join());
    check("…and the new order is the saved list's", (await setTxt()).split(";").map((t) => +t.trim().split("x")[0]).join() === now69.map((r) => r[0]).join());
    await hd("Width").click(); await page.waitForTimeout(80);
    now69 = await prow();
    check(`a second click: largest first (${now69.map((r) => r[0])})`, now69.every((r, i) => !i || now69[i - 1][0] >= r[0]) && await hd("Width").getAttribute("data-dir") === "down");
    await hd("Height").click(); await page.waitForTimeout(80);
    now69 = await prow();
    check(`Height sorts by height (${now69.map((r) => r[1])}); the arrow is on Height only`, now69.every((r, i) => !i || now69[i - 1][1] <= r[1]) && await hd("Height").getAttribute("data-dir") === "up" && await hd("Width").getAttribute("data-dir") === null);
    await hd("Name").click(); await page.waitForTimeout(80);
    now69 = await prow();
    const unnamed = now69.filter((r) => /^\d+:\d+$/.test(r[2])), named = now69.filter((r) => !/^\d+:\d+$/.test(r[2]));
    check(`Name: the rows that show a ratio come first, from the tallest picture to the widest (${unnamed.map((r) => r[2])}), then the named ones (${named.map((r) => r[2])})`,
        unnamed.length >= 5 && named.length === 1 && now69.slice(0, unnamed.length).every((r, i) => r === unnamed[i]) && unnamed.every((r, i) => !i || unnamed[i - 1][0] / unnamed[i - 1][1] <= r[0] / r[1]));
    await hd("Name").click(); await page.waitForTimeout(80);
    check("…a second click: the opposite order, the named one first", (await prow())[0][2] === "square" && (await prow()).map(keyOf).join() === [...now69].reverse().map(keyOf).join());
    // drag the first row's handle below the third row
    const g0 = await page.locator(".rg-presets .rg-presets-row .rg-grip").nth(0).boundingBox(), g2 = await page.locator(".rg-presets .rg-presets-row .rg-grip").nth(2).boundingBox();
    const b4 = await prow();
    await page.mouse.move(g0.x + g0.width / 2, g0.y + g0.height / 2); await page.mouse.down(); await page.mouse.move(g0.x + 3, g2.y + g2.height - 1, { steps: 6 });
    const lineAt = await page.evaluate(() => { const l = document.querySelector(".rg-presets .rg-presets-drop"); return l ? Math.round(l.getBoundingClientRect().top) : null; });
    await page.mouse.up(); await page.waitForTimeout(100);
    const af = await prow();
    check(`dragging a handle moves that row: the first row is now the third (a line showed where: ${lineAt})`, lineAt !== null && lineAt > g2.y && keyOf(af[2]) === keyOf(b4[0]) && keyOf(af[0]) === keyOf(b4[1]) && keyOf(af[1]) === keyOf(b4[2]) && af.length === b4.length);
    check("…saved, the pop-up is still open, and no header claims an order the list no longer has", (await setTxt()).split(";").length === af.length && await pop.isVisible() && await page.locator(".rg-presets .rg-presets-dir").count() === 0);
    await page.mouse.click(5, 5); await page.waitForTimeout(80);
    check("a click outside closes it", !await pop.isVisible());
    check("list follows the Setting (8 sizes, named one; two to add, Edit list…)", await pre.locator("option:not([disabled])").count() === 11
        && /square/.test(await pre.locator("option[value='1024x1024']").textContent()));
    // manual
    await modeBtn("Manual: Image size").click(); await page.waitForTimeout(60);
    const man = row.locator(".rg-size-part").nth(2), [wIn, hIn] = [man.locator("input").nth(0), man.locator("input").nth(1)];
    await wIn.fill("1000"); await wIn.press("Enter"); await hIn.fill("600"); await hIn.press("Enter"); await page.waitForTimeout(60);
    check("manual 1000 x 600", JSON.stringify(await wv()) === "[1000,600]");
    // round 53: the step size box (right of the keep-ratio button): the arrows of width / height go by it
    const stepIn = man.locator("input").nth(2);
    const order = await man.evaluate((m) => { const k = [...m.children]; return k.indexOf(m.querySelectorAll("input")[2]) > k.findIndex((x) => /^Keep the ratio/.test(x.title)); });
    // a node without a step of its own (a new one) takes the Setting's
    await page.evaluate(() => { window.__settings["RegionGenie.Main.StepSize"] = 32; delete window.__node.properties.rg_size.manual.step; });
    await modeBtn("Manual: Image size").click(); await page.waitForTimeout(80);
    const d32 = +(await stepIn.inputValue());
    await page.evaluate(() => { delete window.__settings["RegionGenie.Main.StepSize"]; delete window.__node.properties.rg_size.manual.step; });
    await modeBtn("Manual: Image size").click(); await page.waitForTimeout(80);
    check(`a new node takes its step from the Setting "Manual: step size" (${d32})`, d32 === 32);
    check(`a step size box right of the keep-ratio button, 64 to start (${await stepIn.inputValue()})`, order && await stepIn.inputValue() === "64" && /^Step size: /.test(await stepIn.getAttribute("title")));
    await wIn.focus(); await wIn.press("ArrowUp"); await wIn.press("Enter"); await page.waitForTimeout(60);
    check(`width's up arrow: 1000 + 64 (${await wv()})`, JSON.stringify(await wv()) === "[1064,600]");
    await hIn.focus(); await hIn.press("ArrowDown"); await hIn.press("ArrowDown"); await hIn.press("Enter"); await page.waitForTimeout(60);
    check(`height's down arrow twice: 600 - 128 (${await wv()})`, JSON.stringify(await wv()) === "[1064,472]");
    await stepIn.focus(); await stepIn.press("ArrowUp"); await stepIn.press("Enter"); await page.waitForTimeout(60);
    check(`the step box's own arrows go by 8 (${await stepIn.inputValue()})`, await stepIn.inputValue() === "72");
    await stepIn.fill("10"); await stepIn.press("Enter"); await page.waitForTimeout(60);
    await wIn.focus(); await wIn.press("ArrowUp"); await wIn.press("Enter"); await page.waitForTimeout(60);
    await stepIn.focus(); await stepIn.press("ArrowUp"); await stepIn.press("Enter"); await page.waitForTimeout(60);
    check(`a typed step (10): width + 10, and the step box's up arrow then goes to the next multiple of 8 (${await wv()}, ${await stepIn.inputValue()})`, JSON.stringify(await wv()) === "[1074,472]" && await stepIn.inputValue() === "16");
    check("the node keeps the step size", await page.evaluate(() => window.__node.properties.rg_size.manual.step) === 16);
    const stepKeys = async (...keys) => { await stepIn.focus(); for (const k of keys) await stepIn.press(k); const v = await stepIn.inputValue(); await stepIn.press("Enter"); await page.waitForTimeout(40); return v; };
    await stepIn.fill("10"); await stepIn.press("Enter");
    const dn10 = await stepKeys("ArrowDown"), dn8 = await stepKeys("ArrowDown"), dn1 = await stepKeys("ArrowDown"), up1 = await stepKeys("ArrowUp");
    check(`the step box's arrows: 10 down → 8, 8 down → 1, 1 down stays 1, 1 up → 8 (${[dn10, dn8, dn1, up1]})`, [dn10, dn8, dn1, up1].join() === "8,1,1,8"
        && await page.evaluate(() => window.__node.properties.rg_size.manual.step) === 8);
    await wIn.fill("1001"); await wIn.press("Enter"); await page.waitForTimeout(60);
    check(`a typed width can be any number (${await wv()})`, JSON.stringify(await wv()) === "[1001,472]" && await wIn.evaluate((i) => i.validity.valid));
    await stepIn.fill("64"); await stepIn.press("Enter"); await wIn.fill("1000"); await wIn.press("Enter"); await hIn.fill("600"); await hIn.press("Enter"); await page.waitForTimeout(60);
    // a click on a field's arrows where the click doesn't focus the field (Safari, Firefox on macOS): "input" now,
    // "change" on release. The editor's own refresh in between must not put the old value back
    const pend = await page.evaluate(async () => {
        const part = document.querySelectorAll(".rg-size .rg-size-part")[2], [w, , st] = part.querySelectorAll("input");
        document.activeElement?.blur?.();
        const out = [];
        for (const [i, v] of [[w, "1064"], [st, "72"]]) {
            i.value = v; i.dispatchEvent(new Event("input", { bubbles: true }));
            window.__node.__rgSyncSize(); out.push(i.value);                  // the half-second check
            i.dispatchEvent(new Event("change", { bubbles: true })); window.__node.__rgSyncSize(); out.push(i.value);
        }
        w.value = "1128"; w.dispatchEvent(new Event("input", { bubbles: true }));     // and no "change" at all: taken over by itself
        await new Promise((r) => setTimeout(r, 600)); window.__node.__rgSyncSize();
        return { out, late: w.value, wv: window.__node.widgets.find((x) => x.name === "width").value, step: window.__node.properties.rg_size.manual.step };
    });
    check(`an arrow click without focus isn't undone by the editor's refresh (${pend.out}; later ${pend.late}, width ${pend.wv}, step ${pend.step})`, pend.out.join() === "1064,1064,72,72" && pend.late === "1128" && pend.wv === 1128 && pend.step === 72);
    await stepIn.fill("64"); await stepIn.press("Enter"); await wIn.fill("1000"); await wIn.press("Enter"); await page.waitForTimeout(60);
    const tips3 = await row.locator(".rg-seg .rg-btn").evaluateAll((bs) => bs.map((b) => b.title));
    check(`the three mode buttons' tooltips start with their names (${tips3.map((t) => t.split(":")[0])})`, tips3[0] === "Aspect ratio: Image size from an aspect ratio and megapixels, like ComfyUI's Resolution Selector"
        && tips3[1] === "Presets: Image size from the presets list (shared by every Region Genie node; 'Edit list…' at its end)" && tips3[2] === "Manual: Image size from manually selected width and height values");
    await man.locator('.rg-btn.icon[title^="Keep the ratio"]').click();
    await wIn.fill("500"); await wIn.press("Enter"); await page.waitForTimeout(60);
    check("keep ratio: 500 x 300", JSON.stringify(await wv()) === "[500,300]");
    await man.locator('.rg-btn.icon[title^="Swap"]').click(); await page.waitForTimeout(60);
    check("swap: 300 x 500", JSON.stringify(await wv()) === "[300,500]");
    // back in presets mode: the preset picked there last time; the manual size is offered as an entry to add
    await modeBtn("Presets: Image size").click(); await page.waitForTimeout(60);
    const backToPreset = JSON.stringify(await wv());
    check("presets mode has the preset picked last time (1216 x 832), not the manual size", backToPreset === "[1216,832]" && await pre.inputValue() === "1216x832");
    check(`…with both other sizes to add (${(await addOpts()).join(" | ")})`, (await addOpts()).length === 2 && (await addOpts()).some((t) => /300 × 500\s+\(the manual size\)/.test(t))
        && (await addOpts()).some((t) => /960 × 2240\s+\(the aspect ratio size\)/.test(t)));
    await pre.selectOption("__add__:300x500"); await page.waitForTimeout(100);
    check("picking '＋ Add 300 × 500' adds it to the list and makes it the size", /300x500/.test(await setTxt() || "") && JSON.stringify(await wv()) === "[300,500]" && await pre.inputValue() === "300x500"
        && (await addOpts()).length === 1);
    await pre.selectOption("__edit__"); await page.waitForTimeout(100);
    const ab = page.locator(".rg-presets .rg-presets-adds button");
    check(`'Edit list…' has a button for the size still missing (${(await ab.allTextContents()).join(" | ")})`, await ab.count() === 1 && /960 × 2240/.test(await ab.first().textContent())
        && /aspect ratio/.test(await ab.first().getAttribute("title")) && await page.locator(".rg-presets button", { hasText: "Current size" }).count() === 0);
    await ab.first().click(); await page.waitForTimeout(80);
    check("…it adds that size to the list; this node's size stays", /960x2240/.test(await setTxt() || "") && JSON.stringify(await wv()) === "[300,500]" && await ab.count() === 0);
    await page.locator('.rg-presets button[data-ic="close"]').last().click().catch(() => {});
    await page.mouse.click(5, 5); await page.waitForTimeout(60);
    // a preset that was removed from the list stays this node's size, marked
    await page.evaluate(() => { window.__settings["RegionGenie.Size.Presets"] = "1024x1024; 1216x832"; }); await page.waitForTimeout(700);
    check("a preset removed from the list stays the size, shown as not in the list", JSON.stringify(await wv()) === "[300,500]" && /300 × 500\s+\(not in the list\)/.test(await pre.locator("option[data-extra]").textContent().catch(() => "")));
    await modeBtn("Aspect ratio: Image size").click(); await page.waitForTimeout(60);
    check("the other modes keep their own settings", JSON.stringify(await wv()) === "[960,2240]");
    const props = await page.evaluate(() => window.__node.properties.rg_size);
    check("kept in the node's properties (saved with the workflow)", props.mode === "aspect ratio" && props.manual.w === 300 && props.preset.w === 300);

    // ---------------- pop-up editor: bigger, A− / A+, drag, resize (round 10)
    await page.evaluate(() => { const s = window.__node.__rgState(); s.regions[0].prompt = "a red boat on calm water"; window.__node.__rgRefresh(); });
    await page.waitForTimeout(100);
    const expBtn = page.locator(".rg-list .rg-pwrap .rg-expand").first();
    await expBtn.click(); await page.waitForTimeout(150);
    const ppop = page.locator(".rg-pop");
    const wrapW = await page.evaluate(() => document.querySelector(".rg-wrap").clientWidth);
    let pb = await ppop.boundingBox();
    check("pop-up: wider by default (560 px or the node's width)", !!pb && Math.round(pb.width) === Math.min(560, wrapW - 12));
    // round 26: a tag autocomplete list opened from a pop-up editor shows on top of it. The packs' lists sit at z-index 9999
    // (ComfyUI-Custom-Scripts) / 10000 (LoRA Manager), the pop-up at 10000; the lists Region Genie opens carry 'rg-ac'.
    const acTop = await page.evaluate(() => {
        const r = document.querySelector(".rg-pop textarea").getBoundingClientRect(), out = {};
        for (const [name, cls, z] of [["plain", "pysssss-autocomplete", 9999], ["pys", "pysssss-autocomplete rg-ac", 9999], ["lm", "comfy-autocomplete-dropdown rg-ac", 10000]]) {
            const d = document.createElement("div"); d.className = cls;
            d.style.cssText = `position:fixed;left:${r.left + 10}px;top:${r.top + 10}px;width:120px;height:60px;background:#123;z-index:${z}`;
            document.body.appendChild(d);
            out[name] = document.elementFromPoint(r.left + 40, r.top + 40) === d;
            d.remove();
        }
        return out;
    });
    check(`an autocomplete list from a pop-up editor is on top of it (was behind: ${!acTop.plain})`, !acTop.plain && acTop.pys && acTop.lm);
    // round 28: the pop-up has the node's tag autocomplete switch too (hidden here: no autocomplete pack in the stub page);
    // it is the same switch as the bottom bar's, so both buttons follow a click on either
    const acSw = await page.evaluate(() => {
        const pop = document.querySelector(".rg-pop .pop-ctl .rg-ac-btn"), foot = document.querySelector(".rg-settings .rg-ac-btn"), n = window.__node;
        if (!pop || !foot) return { pop: !!pop, foot: !!foot };
        const on0 = [pop.classList.contains("on"), foot.classList.contains("on")];
        pop.click();
        const off = [pop.classList.contains("on"), foot.classList.contains("on"), n.properties.rg_autocomplete];
        foot.click();
        const on1 = [pop.classList.contains("on"), foot.classList.contains("on"), n.properties.rg_autocomplete];
        return { pop: true, foot: true, on0, off, on1, after: [pop.nextElementSibling, pop.nextElementSibling?.nextElementSibling].map((e) => e?.classList.contains("rg-wc-pick") ? "wildcard" : e?.classList.contains("rg-llm-btn") ? "llm" : "?").join(), focus: document.activeElement?.tagName };
    });
    check(`pop-up: the tag autocomplete switch sits in the bottom row before the wildcard and LLM buttons (round 42), and it and the bottom bar's button switch together (${JSON.stringify(acSw)})`,
        acSw.pop && acSw.foot && acSw.after === "wildcard,llm" && acSw.on0.join() === "true,true" && acSw.off.join() === "false,false,false" && acSw.on1.join() === "true,true,true");
    const fsOf = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".rg-pop textarea")).fontSize));
    check("pop-up: region prompt text 14 px by default", await fsOf() === 14);
    await ppop.locator(".rg-pop-font", { hasText: "A+" }).click(); await page.waitForTimeout(60);
    await ppop.locator(".rg-pop-font", { hasText: "A+" }).click(); await page.waitForTimeout(60);
    check("A+ twice: 16 px, saved in Settings", await fsOf() === 16 && await page.evaluate(() => window.__settings["RegionGenie.Text.PopupRegion"]) === 16);
    // drag by the title bar
    const hb = await ppop.locator(".rg-pop-head").boundingBox();
    await page.mouse.move(hb.x + 60, hb.y + hb.height / 2); await page.mouse.down();
    await page.mouse.move(hb.x + 60 - 40, hb.y + hb.height / 2 + 70, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(80);
    const pb2 = await ppop.boundingBox();
    check("drag the title bar: the pop-up moves", Math.abs(pb2.y - pb.y - 70) < 3 && Math.abs(pb2.x - pb.x + 40) < 3 || Math.abs(pb2.y - pb.y - 70) < 3);
    check("the pop-up is on top of the page (can go anywhere on the screen)", await page.evaluate(() => document.querySelector(".rg-pop").parentElement === document.body));
    // resize from the corner
    const gb = await ppop.locator(".rg-pop-grip").boundingBox();
    await page.mouse.move(gb.x + 6, gb.y + 6); await page.mouse.down();
    await page.mouse.move(gb.x + 6 - 100, gb.y + 6 + 120, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(80);
    const pb3 = await ppop.boundingBox();
    const taH = await page.evaluate(() => document.querySelector(".rg-pop textarea").offsetHeight);
    check("resize from the corner: narrower and taller, the prompt box grows", Math.abs(pb3.width - (pb2.width - 100)) < 3 && pb3.height > pb2.height + 20 && taH > 120);
    const sizes = await page.evaluate(() => JSON.parse(window.__settings["RegionGenie.Popup.Sizes"] || "{}"));
    check("the size is kept for every node (Settings)", sizes.region?.w === Math.round(pb3.width) || Math.abs(sizes.region?.w - pb3.width) < 2);
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    await expBtn.click(); await page.waitForTimeout(150);
    const pb4 = await ppop.boundingBox();
    check("reopened: same size, next to the field again", Math.abs(pb4.width - pb3.width) < 2 && Math.abs(pb4.height - pb3.height) < 2 && Math.abs(pb4.x - pb.x) < 3);
    await ppop.locator(".rg-pop-head span").first().dblclick(); await page.waitForTimeout(80);
    await ppop.locator(".rg-pop-grip").dblclick(); await page.waitForTimeout(80);
    const pb5 = await ppop.boundingBox();
    check("double-click title / grip: back to the automatic place and default size", !(await page.evaluate(() => window.__node.properties.rg_pop?.region))
        && Math.round(pb5.width) === Math.min(560, wrapW - 12));
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    // the node's own fields: text size from Settings
    await page.evaluate(() => { window.__settings["RegionGenie.Text.NodeRegion"] = 16; });
    await page.waitForTimeout(700);
    const nodeFs = await page.evaluate(() => { const t = document.querySelector(".rg-list textarea.rg-prompt"); return [parseFloat(getComputedStyle(t).fontSize), t.offsetHeight]; });
    check("node's region prompts: 16 px from Settings, the field grows to fit", nodeFs[0] === 16 && nodeFs[1] >= 22);
    await page.evaluate(() => { window.__settings["RegionGenie.Text.NodeRegion"] = 0; });
    await page.waitForTimeout(700);
    check("0: back to 12 px", await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".rg-list textarea.rg-prompt")).fontSize)) === 12);

    // ---------------- Control rows (round 10; round 23: several, ＋Control stays, ✕ per row, no details, no Whole image line)
    const crow = page.locator(".rg-list .rg-row.ctrl:not(.edit)");
    const ctlAdd = () => page.locator(".rg-list .rg-row.scene button", { hasText: "＋Control" }).click();
    const ctlRemove = (k = 0) => page.locator('.rg-list .rg-row.ctrl:not(.edit) button[title^="Remove this Control row"]').nth(k).click();
    check("no Control row by default; ＋Control on the Whole image row", await crow.count() === 0 && !((await st()).controls || []).length
        && await page.locator(".rg-list .rg-row.scene button", { hasText: "＋Control" }).isVisible());
    await page.evaluate(() => { window.__settings["RegionGenie.Control.MOSS"] = "moss_ctrl.safetensors"; window.__settings["RegionGenie.Control.SDXL.canny"] = "cn_canny.safetensors"; });
    await ctlAdd(); await page.waitForTimeout(80);
    s = await st();
    check("＋Control: a row, and ＋Control stays (for more rows)", await crow.count() === 1 && await page.locator(".rg-list .rg-row.scene button", { hasText: "＋Control" }).isVisible());
    check("the row: depth; MOSS control LoRA kept with Whole image's LoRAs (no run yet: every model)", s.controls?.length === 1 && s.controls[0].kind === "depth"
        && (s.sceneLoras || []).some((x) => x.lora === "moss_ctrl.safetensors" && x.control === "MOSS-Image" && x.ckind === "moss"));
    check("no chevron or details on the Control row", await crow.locator(".rg-chev").evaluate((e) => getComputedStyle(e).visibility) === "hidden"
        && await page.locator(".rg-subbody.ctrl").count() === 0);
    await page.locator(".rg-list .rg-row.scene").click({ position: { x: 30, y: 8 } }); await page.waitForTimeout(80);
    check("Whole image doesn't list the Control LoRA (no duplicate)", await page.locator(".rg-list .rg-row.lora .rg-hint", { hasText: "Control" }).count() === 0);
    await crow.locator("select").selectOption("canny"); await page.waitForTimeout(80);
    check("canny: the MOSS LoRA goes (it reads color / depth only)", !((await st()).sceneLoras || []).some((x) => x.control));
    // (after a change of kind the list is drawn again at once, and sometimes once more within the editor's half-second
    // check, when the row's LoRA is put back. Until round 44 a number typed just then was dropped with the old row, which
    // failed this check once on GitHub's runner; now such a redraw waits for the field: checked right below.)
    await crow.locator("select").selectOption("color"); await page.waitForTimeout(80);
    const [cs, ca, cb] = [crow.locator("input.rg-num").nth(0), crow.locator("input.rg-num").nth(1), crow.locator("input.rg-num").nth(2)];
    await cs.fill("0.8"); await cs.press("Enter"); await ca.fill("10"); await ca.press("Enter"); await cb.fill("70"); await cb.press("Enter");
    await page.waitForTimeout(80);
    s = await st();
    check("strength / start / end", s.controls[0].kind === "color" && s.controls[0].strength === 0.8 && Math.abs(s.controls[0].start - 0.1) < 1e-9 && Math.abs(s.controls[0].end - 0.7) < 1e-9);
    // round 44c: a redraw of the list that nobody asked for (the half-second check, a run's results) waits while a field
    // of the list is being typed in, so the typed number isn't dropped
    const redraws = () => page.evaluate(() => window.__node.__rgRedraws());
    const rd0 = await redraws();
    await cs.fill("0.55");                                 // typed, not entered yet
    await page.evaluate(() => window.__node.__rgBackgroundRedraw());
    const mid = await page.evaluate(() => ({ r: window.__node.__rgRedraws(), v: document.activeElement?.value, inList: !!document.activeElement?.closest(".rg-list") }));
    check(`a redraw the editor starts by itself while a number is being typed: held back, the field and its text stay (${JSON.stringify(mid)})`,
        mid.r.held === rd0.held + 1 && mid.r.done === rd0.done && mid.r.pending && mid.v === "0.55" && mid.inList);
    await cs.press("Enter"); await page.waitForTimeout(150);
    const rd1 = await redraws();
    check("Enter: the number is taken, and the list is drawn again (nothing left waiting)", (await st()).controls[0].strength === 0.55 && rd1.done > rd0.done && !rd1.pending);
    await page.evaluate(() => window.__node.__rgBackgroundRedraw());
    check("with no field in use the same redraw happens at once", (await redraws()).done === rd1.done + 1 && (await redraws()).held === rd1.held);
    // a region's prompt keeps the cursor through such a redraw, and the list catches up when the cursor leaves
    const pta = page.locator(".rg-list textarea.rg-prompt").first();
    await pta.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" zz");
    const rd2 = await redraws();
    await page.evaluate(() => window.__node.__rgBackgroundRedraw());
    await page.keyboard.type("y");
    const typed = await page.evaluate(() => ({ v: document.activeElement?.value || "", ta: document.activeElement?.tagName, r: window.__node.__rgRedraws() }));
    check(`a region's prompt being typed: the redraw waits, typing goes on in the same box (${JSON.stringify(typed.v.slice(-6))})`, typed.ta === "TEXTAREA" && / zzy$/.test(typed.v) && typed.r.held === rd2.held + 1 && typed.r.pending);
    await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(150);
    const rd3 = await redraws();
    check("the cursor leaves the box: the list is drawn, with the typed prompt", !rd3.pending && rd3.done > rd2.done && / zzy$/.test((await st()).regions.find((r) => / zzy$/.test(r.prompt))?.prompt || ""));
    // a dropdown that has the focus holds nothing back (it has no typed text to lose)
    await crow.locator("select").focus();
    await page.evaluate(() => window.__node.__rgBackgroundRedraw());
    check("a dropdown with the focus doesn't hold a redraw back", (await redraws()).done === rd3.done + 1 && !(await redraws()).pending);
    await cs.fill("0.8"); await cs.press("Enter"); await page.waitForTimeout(100);
    check("the kind's tooltip names the file (model not known: says so)", /The file depends on the model/.test(await crow.locator("select").getAttribute("title")));
    // a second row
    await ctlAdd(); await page.waitForTimeout(80);
    await crow.nth(1).locator("select").selectOption("canny"); await page.waitForTimeout(80);
    s = await st();
    check("a second Control row (canny) next to the first (color)", await crow.count() === 2 && s.controls.map((c) => c.kind).join() === "color,canny");
    // per-region switch: one per region, for all rows
    const rtog = page.locator('.rg-row.region .rg-btn.mini[title^="Control acts on this region"]');
    check("a control switch on each region row while a Control row is there", await rtog.count() === (await st()).regions.length);
    await rtog.first().click(); await page.waitForTimeout(80);
    check("switching a region off: noControl on the region", (await st()).regions[0].noControl === true);
    // what the run gets: the rows and the files from Settings
    const sent = await page.evaluate(() => JSON.parse(window.__node.widgets.find((w) => w.name === "paint_data").serializeValue()));
    check("paint_data: the Control rows and the Settings' files", sent.controls?.length === 2 && sent.controls[0].kind === "color" && sent.controlFiles?.MOSS === "moss_ctrl.safetensors"
        && sent.controlFiles["SDXL.canny"] === "cn_canny.safetensors" && sent.regions[0].noControl === true);
    await ctlRemove(1); await page.waitForTimeout(80);
    // the model of the last run decides which LoRAs are added; a Flux.1 LoRA takes its row's strength
    await page.evaluate(() => { window.__node.properties.rg_model_arch = "Flux.1"; window.__settings["RegionGenie.Control.Flux1Depth"] = "flux-depth-lora.safetensors"; });
    await crow.locator("select").selectOption("depth"); await page.waitForTimeout(80);
    s = await st();
    const fl = (s.sceneLoras || []).filter((x) => x.control);
    check("last run was Flux.1: only the Flux.1 depth LoRA, at the row's strength", fl.map((x) => x.lora).join() === "flux-depth-lora.safetensors" && fl[0].strength === 0.8);
    await cs.fill("0.6"); await cs.press("Enter"); await page.waitForTimeout(80);
    check("the row's strength drives the Flux.1 LoRA", ((await st()).sceneLoras || []).find((x) => x.control)?.strength === 0.6);
    check("the kind's tooltip names the Flux.1 LoRA", /File for Flux\.1: flux-depth-lora\.safetensors \(depth LoRA/.test(await crow.locator("select").getAttribute("title")));
    // round 24: a second row that needs the model's one extra input (MOSS-Image's control LoRA, Flux.1's depth / canny LoRA) is marked
    await ctlAdd(); await page.waitForTimeout(80);
    await crow.nth(1).locator("select").selectOption("depth"); await page.waitForTimeout(80);
    check("two Flux.1 depth-LoRA rows: the second is marked as not used, the first isn't", await crow.nth(1).locator(".rg-warn").count() === 1 && await crow.nth(0).locator(".rg-warn").count() === 0
        && /rg-row ctrl unused/.test(await crow.nth(1).getAttribute("class")) && /^Not used in a run: Flux\.1's depth \/ canny LoRAs take one map per run/.test(await crow.nth(1).locator(".rg-warn").getAttribute("title")));
    await crow.nth(1).locator("select").selectOption("canny"); await page.waitForTimeout(80);
    check("canny with no canny LoRA set is a ControlNet: no mark", await page.locator(".rg-list .rg-warn").count() === 0);
    await page.evaluate(() => { window.__node.properties.rg_model_arch = "MOSS-Image"; window.__node.__rgState().controls = [{ kind: "color", strength: 1, start: 0, end: 1 }, { kind: "canny", strength: 1, start: 0, end: 1 }, { kind: "depth", strength: 1, start: 0, end: 1 }]; window.__node.__rgRefresh(); });
    await page.waitForTimeout(80);
    check("MOSS-Image: color then depth: the depth row is marked, a canny row between them isn't", await crow.nth(2).locator(".rg-warn").count() === 1 && await page.locator(".rg-list .rg-warn").count() === 1
        && /MOSS-Image's control LoRA takes one map/.test(await crow.nth(2).locator(".rg-warn").getAttribute("title")));
    await page.evaluate(() => { window.__node.properties.rg_model_arch = "Flux.1"; const st = window.__node.__rgState(); st.controls = [{ ...st.controls[0], kind: "depth", strength: 0.6, start: 0.1, end: 0.7 }]; window.__node.__rgRefresh(); });
    await page.waitForTimeout(80);
    await crow.locator("select").selectOption("canny"); await page.waitForTimeout(80);
    await crow.locator("select").selectOption("depth"); await page.waitForTimeout(80);      // through the row, so the control LoRAs follow
    // reloading the workflow keeps control, the region switches, the region eye and the LLM switches (loader fix)
    await page.evaluate(() => { const st = window.__node.__rgState(); st.regions[1].hidden = true; st.regions[1].llm = true; st.sceneLlm = true; window.__node.__rgRefresh(); });
    await page.evaluate(() => window.__node.onConfigure?.({ properties: window.__node.properties }));
    await page.waitForTimeout(100);
    s = await st();
    check("reload keeps the Control row, noControl, hidden, llm, sceneLlm, control LoRA tags", s.controls?.length === 1 && s.controls[0].kind === "depth" && s.regions[0].noControl
        && s.regions[1].hidden && s.regions[1].llm && s.sceneLlm && (s.sceneLoras || []).some((x) => x.control === "Flux.1" && x.ckind === "depth"));
    await page.evaluate(() => { const st = window.__node.__rgState(); delete st.regions[1].hidden; window.__node.__rgRefresh(); });
    // ✕: the row and its LoRAs go; undo brings them back
    await ctlRemove(); await page.waitForTimeout(80);
    check("✕: the row goes", await crow.count() === 0);
    check("…and the control LoRAs too", !((await st()).controls || []).length && !((await st()).sceneLoras || []).some((x) => x.control));
    await page.keyboard.press("Control+z"); await page.waitForTimeout(80);
    check("undo: the row again with its LoRA", (await st()).controls?.length === 1 && ((await st()).sceneLoras || []).some((x) => x.control));
    // an old workflow's single Control ('control' with 'on') becomes a row
    await page.evaluate(() => { const n = window.__node, w = n.widgets.find((x) => x.name === "paint_data"); const d = JSON.parse(w.value);
        delete d.controls; d.control = { on: true, kind: "canny", strength: 0.5, start: 0, end: 1 }; w.value = JSON.stringify(d);
        n.onConfigure?.({ properties: n.properties, widgets_values: n.widgets.map((x) => x.value) }); });
    await page.waitForTimeout(150);
    s = await st();
    check("an old workflow's Control becomes a row", s.controls?.length === 1 && s.controls[0].kind === "canny" && s.controls[0].strength === 0.5 && !s.control);

    // ---------------- the model: guessed from the graph, picked in the footer; Control / Edit LoRAs follow (round 10)
    await page.evaluate(() => {
        const n = window.__node, st = n.__rgState();
        delete st.controls; delete st.controlLast;
        st.sceneLoras = (st.sceneLoras || []).filter((x) => !x.control && !x.edit);
        delete n.properties.rg_model_arch; delete n.properties.rg_model_src; delete n.properties.rg_model_pick;
        // Load Diffusion Model (moss…) -> LoRA loader -> Region Genie.model
        const loader = { id: 50, type: "UNETLoader", inputs: [], outputs: [{ name: "MODEL" }], widgets: [{ name: "unet_name", value: "moss_image_sft_int8_convrot.safetensors" }] };
        const lora = { id: 51, type: "LoraLoaderModelOnly", inputs: [{ name: "model", link: 12 }], outputs: [{ name: "MODEL" }], widgets: [{ name: "lora_name", value: "style.safetensors" }] };
        const nodes = { 50: loader, 51: lora };
        n.graph.links = { 11: { id: 11, origin_id: 51, origin_slot: 0 }, 12: { id: 12, origin_id: 50, origin_slot: 0 } };
        n.graph.getNodeById = (id) => nodes[id] || null;
        lora.graph = n.graph; loader.graph = n.graph;
        n.inputs = [...(n.inputs || []).filter((i) => i.name !== "model"), { name: "model", link: 11 }];
        window.__loader = loader;
        Object.assign(window.__settings, { "RegionGenie.Control.MOSS": "moss_ctrl.safetensors", "RegionGenie.Control.Flux1Depth": "flux-depth-lora.safetensors",
            "RegionGenie.Edit.LoRA.MOSS": "a.safetensors", "RegionGenie.Edit.LoRA.Flux1": "edit.safetensors" });
        n.__rgRefresh();
    });
    await page.waitForTimeout(700);
    const msel = page.locator(".rg-settings select.rg-model");
    check("footer model select: auto · MOSS-Image, guessed through the LoRA loader", (await msel.locator("option").first().textContent()) === "auto · MOSS-Image");
    await ctlAdd(); await page.waitForTimeout(150);
    s = await st();
    check("control on before any run: only the guessed model's LoRA (MOSS)", (s.sceneLoras || []).filter((x) => x.control).map((x) => x.lora).join() === "moss_ctrl.safetensors");
    const msg = page.locator(".rg-msg");
    check("the MOSS LoRA isn't among ComfyUI's LoRAs: message with the download link and folder", await msg.isVisible()
        && /moss_ctrl\.safetensors' isn't in ComfyUI\/models\/loras/.test(await msg.textContent())
        && (await msg.locator("a").first().getAttribute("href")) === "https://huggingface.co/Comfy-Org/MOSS-Image/resolve/main/loras/moss_image_color_depth_control.safetensors");
    check("…and the depth map needs Depth Anything 3 (not set): its link too", /Depth Anything 3 model .*no file is set/.test(await msg.textContent())
        && (await msg.locator("a").count()) === 2);
    await msel.selectOption("Flux.1"); await page.waitForTimeout(150);
    s = await st();
    check("picking Flux.1 corrects it: the Flux.1 depth LoRA replaces MOSS's", (s.sceneLoras || []).filter((x) => x.control).map((x) => x.lora).join() === "flux-depth-lora.safetensors");
    check("the pick is saved on the node and marked", await page.evaluate(() => window.__node.properties.rg_model_pick) === "Flux.1"
        && await msel.evaluate((e) => e.classList.contains("picked")));
    await msel.selectOption("Krea 2"); await page.waitForTimeout(150);
    check("Krea 2: says ComfyUI has no ControlNet for it", /no ControlNet support for Krea 2/.test(await msg.textContent()));
    await msel.selectOption(""); await page.waitForTimeout(150);
    check("back to auto: the guess again", ((await st()).sceneLoras || []).filter((x) => x.control).map((x) => x.lora).join() === "moss_ctrl.safetensors");
    // rewiring: the loader's file changes -> the guess follows (a run's answer wins while the loader is the same)
    await page.evaluate(() => { window.__loader.widgets[0].value = "flux1-dev-fp8.safetensors"; });
    await page.waitForTimeout(700);
    check("another loader file: the guess follows (auto · Flux.1) and so do the LoRAs", (await msel.locator("option").first().textContent()) === "auto · Flux.1"
        && ((await st()).sceneLoras || []).filter((x) => x.control).map((x) => x.lora).join() === "flux-depth-lora.safetensors");
    await page.evaluate(() => window.__node.onExecuted({ model_arch: ["SDXL"] }));
    await page.waitForTimeout(700);
    check("a run's answer wins over the guess for the same loader", (await msel.locator("option").first().textContent()) === "auto · SDXL"
        && !((await st()).sceneLoras || []).some((x) => x.control));
    await page.evaluate(() => { window.__loader.widgets[0].value = "moss_image_base.safetensors"; });
    await page.waitForTimeout(700);
    check("after rewiring, the new guess beats the old run", (await msel.locator("option").first().textContent()) === "auto · MOSS-Image");
    // Edit Mode: its edit LoRA follows the same model
    await ctlRemove(); await page.waitForTimeout(100);
    await page.locator(".rg-settings .rg-seg button", { hasText: "Edit" }).click(); await page.waitForTimeout(150);
    s = await st();
    check("Edit Mode adds only the guessed model's edit LoRA", (s.sceneLoras || []).filter((x) => x.edit).map((x) => x.edit + ":" + x.lora).join() === "MOSS-Image:a.safetensors");
    await msel.selectOption("Flux.1"); await page.waitForTimeout(150);
    s = await st();
    check("picking Flux.1: the edit LoRA follows", (s.sceneLoras || []).filter((x) => x.edit).map((x) => x.edit + ":" + x.lora).join() === "Flux.1:edit.safetensors");
    // round 23: the Edit row shows the model's LoRA at once; ✕ removes it for this node; ＋Edit (Edit Mode only) brings it
    // back, then adds this node's own Edit rows
    const erow = page.locator(".rg-list .rg-row.ctrl.edit");
    check("the Edit row follows the model at once (Flux.1: its edit LoRA)", /Flux\.1:/.test(await erow.first().textContent()) && /edit\.safetensors/.test(await erow.first().textContent()));
    check("Whole image doesn't list the edit LoRA (no duplicate)", await page.locator(".rg-list .rg-row.lora .rg-hint", { hasText: "Edit" }).count() === 0);
    const estr = erow.first().locator("input.rg-num");
    await estr.fill("0.7"); await estr.press("Enter"); await page.waitForTimeout(80);
    check("the Edit row's strength is the edit LoRA's", ((await st()).sceneLoras || []).find((x) => x.edit)?.strength === 0.7);
    const eadd = page.locator(".rg-list .rg-row.scene button", { hasText: "＋Edit" });
    await erow.first().locator('button[title^="Remove the Edit row"]').click(); await page.waitForTimeout(100);
    s = await st();
    check("✕ on the Edit row: gone for this node, its LoRA too; ＋Edit shown", s.editOff === true && !(s.sceneLoras || []).some((x) => x.edit)
        && await erow.count() === 0 && await eadd.isVisible());
    await eadd.click(); await page.waitForTimeout(100);
    check("＋Edit brings the Settings row back", !(await st()).editOff && await erow.count() === 1 && ((await st()).sceneLoras || []).some((x) => x.edit));
    await eadd.click(); await page.waitForTimeout(100);
    s = await st();
    check("＋Edit again: an Edit row of this node's own", await erow.count() === 2 && (s.editLoras || []).length === 1);
    await page.evaluate(() => { window.__node.__rgState().editLoras[0].lora = "relight.safetensors"; window.__node.__rgRefresh(); });
    const sent2 = await page.evaluate(() => JSON.parse(window.__node.widgets.find((w) => w.name === "paint_data").serializeValue()));
    check("paint_data carries this node's Edit LoRAs", (sent2.editLoras || [])[0]?.lora === "relight.safetensors");
    await page.locator(".rg-settings .rg-seg button", { hasText: "Generate" }).click(); await page.waitForTimeout(150);
    check("back to Generate: the edit LoRA leaves; no Edit rows, no ＋Edit", !((await st()).sceneLoras || []).some((x) => x.edit)
        && await erow.count() === 0 && !(await eadd.isVisible()));
    await page.evaluate(() => { const st = window.__node.__rgState(); delete st.editLoras; window.__node.__rgRefresh(); });
    await msel.selectOption(""); await page.waitForTimeout(100);

    // ---------------- toolbar: one row whatever the tool; grouped buttons with ▾; options strip; opacity slider (round 11)
    const key = async (k) => { await page.evaluate(() => document.querySelector(".rg-keysink").focus()); await page.keyboard.press(k); await page.waitForTimeout(60); };
    const barRows = () => page.evaluate(() => { const b = document.querySelector(".rg-bar"); return [b.offsetHeight, [...b.children].filter((e) => e.offsetParent).reduce((a, e) => a + e.offsetWidth + 3, -3), b.clientWidth]; });
    let oneRow = true;
    for (const k of ["v", "r", "b", "l", "f", "w", "q", "e", "Shift+L"]) { await key(k); const [h, need, w] = await barRows(); if (h > 30 || need > w) oneRow = false; }
    check("toolbar: one row for every tool (no image)", oneRow);
    const grp = (g) => page.locator(`.rg-bar .rg-btn[data-group="${g}"]`);
    const icon = (g) => grp(g).locator(".rg-grp-ic").innerHTML();
    await key("o");
    check("shape button shows the active shape (O: ellipse)", (await icon("shape")).includes("ellipse") && /^Shape \(Ellipse\)/.test(await grp("shape").getAttribute("title")));
    await grp("shape").locator(".rg-grp-dd").click();
    const shapeRows = await page.evaluate(() => [...document.querySelectorAll(".rg-menu .rg-menu-item")].map((r) => ({ label: r.querySelector(".rg-menu-label").textContent,
        icon: !!r.querySelector(".rg-menu-ic svg")?.childElementCount, tick: r.getAttribute("aria-checked"), key: r.querySelector(".rg-menu-key")?.textContent || "", title: r.title })));
    check("▾ opens the shape list (8 shapes, the current one ticked)", shapeRows.length === 8 && shapeRows[2].tick === "true" && shapeRows.filter((r) => r.tick === "true").length === 1);
    check(`…each row is the shape's icon and its name in brackets (${shapeRows.map((r) => r.label).join(" ")})`, shapeRows.every((r) => r.icon && /^\(.+\)$/.test(r.label)) && shapeRows[0].label === "(Rectangle)");
    check(`…each with its key (${shapeRows.map((r) => r.key).join(" ")}) and its tooltip, which names the key`, shapeRows.map((r) => r.key).join(" ") === "R Shift+R O T N X S H"
        && shapeRows.every((r) => r.title.startsWith("Shape " + r.label + ":") && r.title.endsWith(`(${r.key}).`)));
    await page.locator(".rg-menu .rg-menu-item", { hasText: "(Heart)" }).hover(); await page.waitForTimeout(900);
    check("pointing at a row shows its tooltip", await page.evaluate(() => { const t = document.querySelector(".rg-tip"); return !!t && t.classList.contains("on") && /^Shape \(Heart\)/.test(t.textContent); }));
    check("…beside the list, not over its rows", await page.evaluate(() => { const t = document.querySelector(".rg-tip").getBoundingClientRect(), m = document.querySelector(".rg-menu").getBoundingClientRect(); return t.left >= m.right || t.right <= m.left; }));
    await page.locator(".rg-menu .rg-menu-item", { hasText: "(Star)" }).click();
    await page.waitForTimeout(60);
    check("star picked: star icon, star points in the canvas strip", (await icon("shape")).includes("M8 1.8l1.8 4") && await inStrip(page.locator('.rg-toolopts input[title^="Number of star points"]')));
    await key("Shift+L");
    check("Shift+L: the eraser button shows lasso erase", /^Lasso erase/.test(await grp("erase").getAttribute("title")) && await grp("erase").evaluate((b) => b.classList.contains("on")));
    await key("e");
    check("E: back to the eraser on the same button", /^Eraser/.test(await grp("erase").getAttribute("title")));
    // the tools' lists are the pack's own menu (round 65): read the open one as { items: [{ content }], opts.callback(item) }
    await page.evaluate(() => { window.__toolMenu = () => { const rows = [...document.querySelectorAll(".rg-menu .rg-menu-item")];
        return { items: rows.map((row) => ({ content: (row.getAttribute("aria-checked") === "true" ? "✓ " : "   ") + row.querySelector(".rg-menu-label").textContent, row })), opts: { callback: (it) => it.row.click() } }; }; });
    await grp("erase").click({ button: "right" });
    check("eraser list: the eraser and the three lasso erase versions", await page.evaluate(() => window.__toolMenu().items.map((i) => i.content).join("|")).then((t) => /Eraser.*Lasso erase.*spline.*magnetic/.test(t)));
    await key("w");
    check("W: the wand button shows the wand, tolerance in the strip", /^Magic wand/.test(await grp("wand").getAttribute("title")) && await inStrip(page.locator('.rg-toolopts input[title^="Magic wand tolerance"]')));
    await key("b");
    check("the strip hides with a tool without options", await page.locator(".rg-toolopts").isHidden());
    // with an image: still one row, opacity on the canvas's right edge
    await page.evaluate(async () => { const c = document.createElement("canvas"); c.width = c.height = 64; const i = new Image(); i.src = c.toDataURL(); await i.decode();
        window.__node.inputs = [...window.__node.inputs.filter((x) => x.name !== "image"), { name: "image", link: 7 }]; window.__node.__rgSetBackdrop(i, { filename: "p.png", subfolder: "", type: "input" }); });
    await page.waitForTimeout(700);
    oneRow = true;
    for (const k of ["v", "r", "w", "q"]) { await key(k); const [h, need, w] = await barRows(); if (h > 30 || need > w) oneRow = false; }
    check("toolbar: one row for every tool (image connected)", oneRow);
    const osl = page.locator(".rg-cv .rg-oslider");
    check("image opacity: a slider on the canvas's right edge, with a tooltip", await osl.isVisible() && /^Image opacity: 50%/.test(await osl.getAttribute("title"))
        && await page.evaluate(() => { const r = document.querySelector(".rg-oslider").getBoundingClientRect(), c = document.querySelector(".rg-cv").getBoundingClientRect(); return c.right - r.right < 20; }));
    const ob = await osl.boundingBox();
    await page.mouse.click(ob.x + ob.width / 2, ob.y + ob.height * 0.15);
    await page.waitForTimeout(60);
    check("clicking near the top: about 90-100%", /^Image opacity: (90|95|100)%/.test(await osl.getAttribute("title")));

    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
