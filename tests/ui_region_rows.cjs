// Browser checks of the region rows. Round 34: the row keeps what is used all the time and the prompt gets the room.
// Round 88: nothing opens under a row any more; a region's layers, palette and options are tabs of its pop-up (with its
// prompt and LoRAs), reached from the row's small buttons and its right-click menu. The type is an icon with a menu.
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
        [x, y] = await toClient(c, d); await page.mouse.move(x, y, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(120);
    };
    const add = page.locator('[title^="Add a region with a new color"]');
    const rows = page.locator(".rg-row.region");
    const pop = page.locator(".rg-pop");
    const tab = async (rid, t) => { await page.evaluate(([rid, t]) => window.__node.__rgEditTab(rid, t), [rid, t]); await page.waitForTimeout(150); };
    const closePop = async () => { await page.evaluate(() => window.__node.__rgCloseEditor()); await page.waitForTimeout(80); };

    // three regions: two drawn, one left without a layer
    // (the stub node's image is 256 px wide)
    await add.click(); await page.waitForTimeout(100); await box(20, 20, 100, 100);
    await add.click(); await page.waitForTimeout(100); await box(140, 140, 230, 230);
    await add.click(); await page.waitForTimeout(100);
    check("three regions, two with a layer", (await st()).regions.length === 3 && await rows.count() === 3 && (await st()).layers.length === 2);

    // ---- the row itself: one line, nothing opens under it (round 88)
    const inRow = await page.evaluate(() => [...document.querySelectorAll(".rg-row.region")].map((r) => ({
        feather: !!r.querySelector(".rg-feather"), del: [...r.querySelectorAll("button")].some((b) => b.dataset.ic === "close"),
        move: [...r.querySelectorAll("button")].some((b) => ["up", "down", "mergeAll"].includes(b.dataset.ic)),
        lora: !!r.querySelector(".rg-lbtn"), llm: !!r.querySelector(".rg-llm-btn"), chev: !!r.querySelector(".rg-chev"),
        cnt: r.querySelector("button.rg-cnt")?.textContent.trim(), eye: !!r.querySelector(".rg-reye"), type: r.querySelector(".rg-tybtn")?.dataset.type, sel: !!r.querySelector("select"),
        w: r.querySelector(".rg-pwrap").getBoundingClientRect().width / r.getBoundingClientRect().width })));
    check(`the row keeps show / hide, the type (an icon), prompt, LLM, the layer count and the LoRAs button (${JSON.stringify(inRow[0])})`,
          inRow.every((r) => r.eye && r.type === "object" && !r.sel && r.llm && r.lora) && inRow.map((r) => r.cnt).sort().join() === "0,1,1");
    check("the row holds delete too (round 73), but not feather, merge or move, and no ▶", inRow.every((r) => !r.feather && r.del && !r.move && !r.chev));
    check(`the prompt takes more than half of the row (${inRow.map((r) => Math.round(r.w * 100) + "%").join(", ")})`, inRow.every((r) => r.w > 0.5));
    check("nothing is listed under a region's row, and the header has no open / close buttons",
          await page.locator(".rg-list .rg-row.opts, .rg-list .rg-row.sub, .rg-list .rg-subbody, .rg-list .rg-row.layer").count() === 0
          && await page.evaluate(() => [...document.querySelectorAll('.rg-head [title^="Show or hide"]')].every((b) => b.getClientRects().length === 0)));

    // ---- the type icon: a click lists the three types
    const rid0 = (await st()).regions[0].id;
    await rows.nth(0).locator(".rg-tybtn").click(); await page.waitForTimeout(150);
    const tm = await page.evaluate(() => [...document.querySelectorAll(".rg-menu .rg-menu-label")].map((x) => x.textContent));
    check(`the type icon opens a menu of the three types (${tm.join(" | ")})`, tm.join("|") === "object|character|text");
    await page.locator(".rg-menu .rg-menu-label", { hasText: "text" }).click(); await page.waitForTimeout(150);
    check("choosing one sets the region's type; the icon follows and the text field shows", (await st()).regions[0].type === "text"
          && await rows.nth(0).locator(".rg-tybtn").getAttribute("data-type") === "text" && await rows.nth(0).locator(".rg-text").count() === 1);
    await page.evaluate((rid) => { const n = window.__node; n.__rgState().regions.find((r) => r.id === rid).type = "object"; n.__rgRefresh(); }, rid0); await page.waitForTimeout(100);

    // ---- the row's small buttons open the region's pop-up on that tab
    const rid = (await st()).regions[1].id;
    await rows.nth(1).locator("button.rg-cnt").click(); await page.waitForTimeout(200);
    const tabs = await page.evaluate(() => ({ all: [...document.querySelectorAll(".rg-pop .rg-pop-tabs .rg-btn")].map((b) => b.dataset.tab), on: document.querySelector(".rg-pop .rg-pop-tabs .on")?.dataset.tab }));
    check(`the layer count opens the pop-up on its Layers tab; the tabs are Prompt, LoRAs, Layers, Palette, Options (${tabs.all})`, tabs.on === "layers" && tabs.all.join() === "prompt,loras,layers,palette,options");
    const lay = await page.evaluate(() => { const row = document.querySelector(".rg-pop .rg-pop-layers .rg-row.layer"); return { rows: document.querySelectorAll(".rg-pop .rg-pop-layers .rg-row.layer").length,
        btns: [...row.querySelectorAll("button")].map((b) => b.dataset.ic).filter(Boolean), grip: !!row.querySelector(".rg-grip"), name: !!row.querySelector("input[type=text]"),
        bar: [...document.querySelectorAll(".rg-pop .rg-pop-pane[data-pane=layers] > .rg-pop-addl button")].map((b) => b.dataset.ic) }; });
    check(`the Layers tab has the layer's row with everything it had in the list, and new layer / merge all under it (${lay.btns.join(" ")}; ${lay.bar.join(" ")})`,
          lay.rows === 1 && lay.grip && lay.name && ["eye", "scissors", "up", "down", "copy", "mergeDown", "moveTo", "eraseLayer", "clear"].every((b) => lay.btns.includes(b)) && lay.bar.join() === "layerAdd,mergeAll");
    await pop.locator('.rg-pop-pane[data-pane=layers] > .rg-pop-addl button[data-ic="layerAdd"]').click(); await page.waitForTimeout(150);
    check("new layer there adds a layer to this region; the tab and the row count 2", (await st()).layers.filter((l) => l.region === rid).length === 2
          && await pop.locator('.rg-pop-tabs [data-tab="layers"] em').textContent() === "2" && (await rows.nth(1).locator("button.rg-cnt").textContent()).trim() === "2");
    // drag the lower layer above the upper one by its grip
    const order0 = (await st()).layers.filter((l) => l.region === rid).map((l) => l.id);
    const g = await page.evaluate(() => [...document.querySelectorAll(".rg-pop .rg-pop-layers .rg-row.layer .rg-grip")].map((x) => { const r = x.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
    await page.mouse.move(g[1][0], g[1][1]); await page.mouse.down(); await page.mouse.move(g[0][0], g[0][1] - 9, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
    const order1 = (await st()).layers.filter((l) => l.region === rid).map((l) => l.id);
    check(`a layer row's grip moves the layer among the region's layers (${order0} -> ${order1})`, order1.join() === [...order0].reverse().join());

    // ---- the Palette tab
    await pop.locator('.rg-pop-tabs [data-tab="palette"]').click(); await page.waitForTimeout(120);
    const palUi = () => page.evaluate(() => { const b = document.querySelector(".rg-pop .rg-pop-pal"); return { sw: b.querySelector("input.rg-switch").checked, state: b.querySelector(".rg-pop-palstate").textContent,
        lit: b.querySelector(".rg-pop-palhead").classList.contains("on"), cols: b.querySelectorAll(".rg-sw.pal").length, sel: [...b.querySelectorAll(".rg-sw.pal")].findIndex((x) => x.classList.contains("sel")),
        picker: !!b.querySelector(".rg-cp.inline .rg-cp-sv"), floating: document.querySelectorAll("body > .rg-cp").length, dim: b.querySelector(".rg-pop-palrow").classList.contains("off") }; });
    let pu = await palUi();
    check(`the Palette tab says the palette is off: a switch, the word Off, no colors yet (${JSON.stringify(pu)})`, !pu.sw && pu.state === "Off" && !pu.lit && pu.cols === 0 && !pu.picker);
    await pop.locator(".rg-pop-pal input.rg-switch").click(); await page.waitForTimeout(150);
    pu = await palUi();
    check("the switch turns it on: it says On, lit", pu.sw && pu.state === "On" && pu.lit && (await st()).regions.find((r) => r.id === rid).paletteOn === true);
    await pop.locator(".rg-pop-pal .rg-pop-paladd").click(); await page.waitForTimeout(200);
    await pop.locator(".rg-pop-pal .rg-pop-paladd").click(); await page.waitForTimeout(200);
    pu = await palUi();
    check(`＋ adds a color and selects it; the color picker is a part of the tab, not a window of its own (${JSON.stringify(pu)})`, pu.cols === 2 && pu.sel === 1 && pu.picker && pu.floating === 0);
    // drag in the picker's square: the selected color changes live, and it is one undo step
    const sv = await pop.locator(".rg-pop-pal .rg-cp-sv").boundingBox();
    await page.mouse.move(sv.x + sv.width * 0.9, sv.y + sv.height * 0.2); await page.mouse.down(); await page.mouse.move(sv.x + sv.width * 0.8, sv.y + sv.height * 0.3, { steps: 4 }); await page.mouse.up();
    const live = (await st()).regions.find((r) => r.id === rid).palette;
    check(`dragging in the picker changes the selected color, not the other (${live})`, live[0] === "#FFFFFF" && live[1] !== "#FFFFFF" && await palUi().then((x) => x.picker && x.sel === 1));
    await page.waitForTimeout(700);
    await pop.locator(".rg-pop-pal .rg-sw.pal").first().click(); await page.waitForTimeout(150);
    check("a click on another color selects that one for the picker", (await palUi()).sel === 0 && (await pop.locator(".rg-pop-pal .rg-cp input").first().inputValue()).toLowerCase() === "#ffffff");
    await page.locator('.rg-bar [title^="Undo"]').click(); await page.waitForTimeout(200);
    check("Undo takes the picked color back in one step", (await st()).regions.find((r) => r.id === rid).palette[1] === "#FFFFFF");
    await pop.locator(".rg-pop-pal input.rg-switch").click(); await page.waitForTimeout(150);
    pu = await palUi();
    check("switched off: it says Off, the colors are kept and shown dimmed", !pu.sw && pu.state === "Off" && pu.cols === 2 && pu.dim && !(await st()).regions.find((r) => r.id === rid).paletteOn);
    await pop.locator(".rg-pop-pal input.rg-switch").click(); await page.waitForTimeout(150);
    await page.evaluate((rid) => { const n = window.__node; n.__rgState().regions.find((r) => r.id === rid).palette = ["#AA3333", "#33AA33"]; n.__rgRefresh(); }, rid); await page.waitForTimeout(150);
    const ridRow = (await st()).regions.findIndex((r) => r.id === rid);
    check("with two colors: the tab counts 2 and the row shows them as dots",
          await pop.locator('.rg-pop-tabs [data-tab="palette"] em').textContent() === "2" && await rows.nth(ridRow).locator("button.rg-paldots i").count() === 2
          && await pop.locator(".rg-pop-pal .rg-sw.pal").count() === 2);
    await closePop();
    await rows.nth(1).locator("button.rg-paldots").click(); await page.waitForTimeout(200);
    check("the row's palette dots open the pop-up on its Palette tab", await page.evaluate(() => document.querySelector(".rg-pop .rg-pop-tabs .on")?.dataset.tab) === "palette");

    // ---- the Options tab: feather, order, show / hide, delete
    await pop.locator('.rg-pop-tabs [data-tab="options"]').click(); await page.waitForTimeout(120);
    const opt = await page.evaluate(() => ({ labels: [...document.querySelectorAll(".rg-pop .rg-pop-opts .rg-pop-optl")].map((x) => x.textContent),
        btns: [...document.querySelectorAll(".rg-pop .rg-pop-opts button")].map((b) => b.dataset.ic).filter(Boolean), feather: !!document.querySelector(".rg-pop .rg-pop-opts .rg-feather input"),
        icons: [...document.querySelectorAll(".rg-pop .rg-pop-opts .rg-feather button svg")].every((s) => s.getBoundingClientRect().width > 6) }));
    check(`the Options tab has a line each for feather, order, show and delete (${opt.labels.join(", ")}; ${opt.btns.join(" ")})`,
          opt.labels.join("|") === "Feather|Order|Show|Delete" && opt.feather && opt.icons && ["up", "down", "eye", "close"].every((b) => opt.btns.includes(b)));
    const f = pop.locator(".rg-pop-opts .rg-feather input"); await f.fill("12"); await f.dispatchEvent("change"); await page.waitForTimeout(80);
    check("feather set on the Options tab", (await st()).feather === 12);
    await pop.locator('.rg-pop-opts button[data-ic="down"]').click(); await page.waitForTimeout(120);
    check("↓ there moves the region down, and the pop-up stays on that region and tab", (await st()).regions[2].id === rid
          && await page.evaluate(() => document.querySelector(".rg-pop .rg-pop-tabs .on")?.dataset.tab) === "options");
    await pop.locator('.rg-pop-opts button[data-ic="eye"]').click(); await page.waitForTimeout(120);
    check("the eye there hides the region", (await st()).regions.find((r) => r.id === rid).hidden === true);
    await pop.locator('.rg-pop-opts button[data-ic="eyeOff"]').click(); await page.waitForTimeout(120);
    // the pop-up keeps its size and place over all five tabs
    const sizes = [];
    for (const t of ["prompt", "loras", "layers", "palette", "options"]) { await pop.locator(`.rg-pop-tabs [data-tab="${t}"]`).click(); await page.waitForTimeout(100);
        sizes.push(await page.evaluate(() => { const b = document.querySelector(".rg-pop"), r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), b.scrollHeight - b.clientHeight <= 1].join(); })); }
    check(`the pop-up has the same place and size on every tab, and never a scroll bar (${sizes[0]})`, new Set(sizes).size === 1 && sizes[0].endsWith("true"));
    await pop.locator('.rg-pop-tabs [data-tab="options"]').click(); await page.waitForTimeout(100);
    await pop.locator('.rg-pop-opts button[data-ic="close"]').click(); await page.waitForTimeout(150);
    check("delete on the Options tab deletes the region and closes its pop-up", !(await st()).regions.some((r) => r.id === rid) && await pop.count() === 0);
    const [cx, cy] = await toClient(120, 120); await page.mouse.move(cx, cy); await page.keyboard.press("Control+z"); await page.waitForTimeout(120);
    check("Ctrl+Z brings it back", (await st()).regions.length === 3);
    await page.locator(".rg-row.region").nth(2).locator(".rg-rdel").click(); await page.waitForTimeout(100);
    check("the row's delete button deletes the region and its layers", (await st()).regions.length === 2 && !(await st()).regions.some((r) => r.id === rid));
    await page.mouse.move(cx, cy); await page.keyboard.press("Control+z"); await page.waitForTimeout(120);
    // right-click on a row: the region's menu (the canvas menu's entries for a region, without the layer ones)
    await page.locator(".rg-row.region").nth(1).locator(".rg-idx").click({ button: "right" }); await page.waitForTimeout(150);
    const rm = await page.evaluate(() => [...document.querySelectorAll(".rg-menu .rg-menu-label")].map((x) => x.textContent));
    check(`right-click on a row opens the region's menu, with an entry for each tab of its pop-up (${rm.slice(1).join(" | ")})`,
          JSON.stringify(rm.slice(1)) === JSON.stringify(["Edit prompt…", "LoRAs…", "Layers…", "Color palette…", "Options…", "Hide region", "Move up (in front)", "Move down (behind)", rm[rm.length - 1]]) && /^Delete region/.test(rm[rm.length - 1]));
    check("…and makes that region the active one", (await st()).regions[1].id === await page.evaluate(() => window.__node.__rgActive()));
    await page.locator(".rg-menu .rg-menu-label", { hasText: "Options…" }).click(); await page.waitForTimeout(200);
    check("its Options… opens the pop-up on the Options tab", await page.evaluate(() => document.querySelector(".rg-pop .rg-pop-tabs .on")?.dataset.tab) === "options");
    await closePop();
    await page.locator(".rg-row.region").nth(1).locator(".rg-idx").click({ button: "right" }); await page.waitForTimeout(150);
    const ridM = (await st()).regions[1].id;
    await page.locator(".rg-menu .rg-menu-label", { hasText: /^Delete region/ }).click(); await page.waitForTimeout(120);
    check("its Delete region deletes the region", !(await st()).regions.some((r) => r.id === ridM));
    await page.mouse.move(cx, cy); await page.keyboard.press("Control+z"); await page.waitForTimeout(120);
    check("a right-click on the prompt field keeps the browser's own menu", await page.evaluate(() => { const ta = document.querySelector(".rg-row.region .rg-prompt"); const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); ta.dispatchEvent(e); return !e.defaultPrevented && !document.querySelector(".rg-menu"); }));

    await tab((await st()).regions[1].id, "layers");
    await page.screenshot({ path: require("path").join(__dirname, "out", "ui_region_rows.png"), fullPage: false });
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
