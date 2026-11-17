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
        && await modeBtn("Image size: width and height").evaluate((b) => b.classList.contains("on")));
    await modeBtn("Image size from an aspect ratio").click(); await page.waitForTimeout(60);
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
    check("readout and canvas follow", /4736 × 3584/.test(await sizeOut()) && /4736 x 3584/.test(await status()));
    await ratioCase("21:9 (Ultrawide)", 2, 64);
    await row.locator(".rg-size-part").first().locator(".rg-btn.icon").click(); await page.waitForTimeout(60);
    check("swap: 9:21 portrait = 960 x 2240", JSON.stringify(await wv()) === "[960,2240]");
    // presets
    await modeBtn("Image size from the presets").click(); await page.waitForTimeout(60);
    const pre = row.locator("select.rg-size-pre");
    check("presets mode keeps the size (960 x 2240, shown as not in the list)", JSON.stringify(await wv()) === "[960,2240]"
        && /960 × 2240\s+\(not in the list\)/.test(await pre.locator("option[data-extra]").textContent())
        && /isn't in the list/.test(await pre.getAttribute("title")));
    check("presets: the 9 starting sizes + Edit list…", await pre.locator("option:not([disabled]):not([data-extra])").count() === 10
        && (await pre.locator("option").last().textContent()) === "Edit list…");
    await pre.selectOption("1216x832"); await page.waitForTimeout(60);
    check("preset 1216 x 832 (the 'not in the list' entry goes)", JSON.stringify(await wv()) === "[1216,832]" && await pre.locator("option[data-extra]").count() === 0);
    check("presets show their ratio", /1216 × 832\s+\(3:2\)/.test(await pre.locator("option[value='1216x832']").textContent()));
    await pre.selectOption("__edit__"); await page.waitForTimeout(100);
    const pop = page.locator(".rg-presets");
    check("Edit list… opens the editor, the choice stays", await pop.isVisible() && await pre.inputValue() === "1216x832");
    await pop.locator(".rg-presets-row").first().locator(".rg-presets-name").fill("square"); await pop.locator(".rg-presets-row").first().locator(".rg-presets-name").press("Tab");
    await pop.locator(".rg-presets-row").nth(1).locator("button", { hasText: "✕" }).click();
    await page.waitForTimeout(60);
    const setTxt = () => page.evaluate(() => window.__settings["RegionGenie.Size.Presets"]);
    check("editing saves to the shared Setting", /^1024x1024 square; 896x1152;/.test(await setTxt() || ""));
    await page.mouse.click(5, 5); await page.waitForTimeout(80);
    check("a click outside closes it", !await pop.isVisible());
    check("list follows the Setting (8 sizes, named one)", await pre.locator("option:not([disabled])").count() === 9
        && /square/.test(await pre.locator("option[value='1024x1024']").textContent()));
    // manual
    await modeBtn("Image size: width and height").click(); await page.waitForTimeout(60);
    const man = row.locator(".rg-size-part").nth(2), [wIn, hIn] = [man.locator("input").nth(0), man.locator("input").nth(1)];
    await wIn.fill("1000"); await wIn.press("Enter"); await hIn.fill("600"); await hIn.press("Enter"); await page.waitForTimeout(60);
    check("manual 1000 x 600", JSON.stringify(await wv()) === "[1000,600]");
    await man.locator('.rg-btn.icon[title^="Keep the ratio"]').click();
    await wIn.fill("500"); await wIn.press("Enter"); await page.waitForTimeout(60);
    check("keep ratio: 500 x 300", JSON.stringify(await wv()) === "[500,300]");
    await man.locator('.rg-btn.icon[title^="Swap"]').click(); await page.waitForTimeout(60);
    check("swap: 300 x 500", JSON.stringify(await wv()) === "[300,500]");
    // presets mode takes the size the other mode made; '＋ Current size' in the editor adds it to the list
    await modeBtn("Image size from the presets").click(); await page.waitForTimeout(60);
    const backToPreset = JSON.stringify(await wv());
    check("presets mode keeps the manual size (300 x 500)", backToPreset === "[300,500]");
    await pre.selectOption("__edit__"); await page.waitForTimeout(100);
    await page.locator(".rg-presets button", { hasText: "Current size" }).click(); await page.waitForTimeout(60);
    check("＋ Current size adds 300 x 500 to the list", /300x500/.test(await setTxt() || "") && await pre.locator("option[data-extra]").count() === 0
        && await pre.inputValue() === "300x500");
    await page.locator(".rg-presets button", { hasText: "✕" }).last().click().catch(() => {});
    await page.mouse.click(5, 5); await page.waitForTimeout(60);
    await modeBtn("Image size from an aspect ratio").click(); await page.waitForTimeout(60);
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
    await crow.locator("select").selectOption("color"); await page.waitForTimeout(80);
    const [cs, ca, cb] = [crow.locator("input.rg-num").nth(0), crow.locator("input.rg-num").nth(1), crow.locator("input.rg-num").nth(2)];
    await cs.fill("0.8"); await cs.press("Enter"); await ca.fill("10"); await ca.press("Enter"); await cb.fill("70"); await cb.press("Enter");
    await page.waitForTimeout(80);
    s = await st();
    check("strength / start / end", s.controls[0].kind === "color" && s.controls[0].strength === 0.8 && Math.abs(s.controls[0].start - 0.1) < 1e-9 && Math.abs(s.controls[0].end - 0.7) < 1e-9);
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
    check("▾ opens the shape list (8 shapes, the current one ticked)", await page.evaluate(() => window.__lastMenu.items.length === 8 && window.__lastMenu.items[2].content.startsWith("✓")));
    await page.evaluate(() => window.__lastMenu.opts.callback(window.__lastMenu.items.find((i) => /Star/.test(i.content))));
    await page.waitForTimeout(60);
    check("star picked: star icon, star points in the canvas strip", (await icon("shape")).includes("M8 1.8l1.8 4") && await inStrip(page.locator('.rg-toolopts input[title^="Number of star points"]')));
    await key("Shift+L");
    check("Shift+L: the eraser button shows lasso erase", /^Lasso erase/.test(await grp("erase").getAttribute("title")) && await grp("erase").evaluate((b) => b.classList.contains("on")));
    await key("e");
    check("E: back to the eraser on the same button", /^Eraser/.test(await grp("erase").getAttribute("title")));
    await grp("erase").click({ button: "right" });
    check("eraser list: the eraser and the three lasso erase versions", await page.evaluate(() => window.__lastMenu.items.map((i) => i.content).join("|")).then((t) => /Eraser.*Lasso erase.*spline.*magnetic/.test(t)));
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
