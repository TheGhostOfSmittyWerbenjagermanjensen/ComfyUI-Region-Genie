// Browser checks of round 33 (first-use help): the hints on the canvas and their Setting, the start card, Clear all
// at the end of the toolbar, the words on bare numbers, the run-notes button, shortcuts over the whole editor.
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
    const tips = () => page.evaluate(() => { const t = document.querySelector(".rg-tips"); return getComputedStyle(t).display === "none" ? null : t.textContent; });
    const shown = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== "none"; }, sel);
    const setTool = async (t) => { await page.evaluate((t) => window.__node.__rgSetTool(t), t); await page.waitForTimeout(40); };

    // ---- an empty canvas: the start card and the Select tool's hints
    check("empty canvas: the start card shows three steps", await shown(".rg-start") && await page.locator(".rg-start i").count() === 3);
    const cards = await page.evaluate(() => [...document.querySelectorAll(".rg-start .rg-start-card")].map((c) => ({ head: c.querySelector("b").textContent, text: c.textContent })));
    check(`…as two cards: with regions, and without (${cards.map((c) => c.head).join(" | ")})`, cards.length === 2 && cards[0].head === "Start here: with regions" && cards[1].head === "Or without regions"
        && /double-click the middle of the region/.test(cards[0].text) && /scene_prompt_positive and scene_prompt_negative/.test(cards[1].text) && /Whole image \(the first row of the list under the canvas\)/.test(cards[1].text));
    const cardOp = () => page.evaluate(() => getComputedStyle(document.querySelector(".rg-start")).opacity);
    {
        const cb = await page.locator(".rg-cv").boundingBox();
        await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await page.waitForTimeout(400);
        const over = await cardOp();
        await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height + 60); await page.waitForTimeout(400);
        check(`the start cards hide while the pointer is on the canvas (${over}) and come back when it leaves (${await cardOp()})`, over === "0" && await cardOp() === "1");
    }
    // round 100: an empty canvas starts with the Rectangle tool, shows no hint strip under the start card, and has an
    // arrow at the canvas's edge for each button the card names
    check(`empty canvas: the Rectangle tool is the active one (${await page.evaluate(() => window.__node.__rgTool())}), and no hint strip under the start card`, await page.evaluate(() => window.__node.__rgTool()) === "shape" && await tips() === null);
    const arr = await page.evaluate(() => { const box = document.querySelector(".rg-start-arrows").parentElement.getBoundingClientRect();
        const t = { Shapes: document.querySelector('.rg-bar [data-group="shape"]') || [...document.querySelectorAll(".rg-bar .rg-btn")].find((b) => /^Shape|Rectangle/.test(b.title)), "Large editor": document.querySelector(".rg-bar .rg-bigbtn"),
                    "Add a region": document.querySelector('[title^="Add a region with a new color"]'), Separate: document.querySelector(".rg-separate") };
        return [...document.querySelectorAll(".rg-start-arrow")].map((a) => { const r = a.getBoundingClientRect(), b = t[a.textContent]?.getBoundingClientRect(), ic = a.querySelector("i").getBoundingClientRect();
            return { name: a.textContent, side: a.dataset.side, inBox: r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom, target: !!b,
                     off: b ? Math.round(Math.abs((ic.left + ic.width / 2) - (b.left + b.width / 2))) : -1, above: b ? b.bottom <= box.top + 2 : null }; }); });
    check(`four arrows at the canvas's edge, each inside the canvas, on the edge next to its button (${arr.map((a) => a.name + ":" + a.side + ":" + a.off).join(", ")})`,
          arr.length === 4 && arr.every((a) => a.inBox && a.target && a.side === (a.above ? "up" : "down")));
    check("an arrow's head is in line with its button, or as near as the canvas's corner buttons allow (within 60 px)", arr.every((a) => a.off <= 60) && arr.filter((a) => a.off <= 12).length >= 2);
    check("no arrow covers the canvas's corner buttons", await page.evaluate(() => { const hit = (a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom; };
        const corners = [...document.querySelectorAll(".rg-imgmode, .rg-tips-btn")].filter((e) => e.getClientRects().length); return [...document.querySelectorAll(".rg-start-arrow")].every((a) => corners.every((c) => !hit(a, c))); }));
    check("the card names the Large button and Separate", await page.evaluate(() => { const t = document.querySelector(".rg-start").textContent; return /Large button above the canvas/.test(t) && /does the image look disjointed\? Use the Separate button and the two numbers beside it - raise them for better placement, lower them for more cohesion\./.test(t); }));
    // the Separate button's ▾ opens what its right-click opens
    await page.evaluate(() => { window.__lastMenu = null; });
    await page.locator(".rg-separate .rg-grp-dd").click(); await page.waitForTimeout(250);
    const sepMenu = await page.evaluate(() => (window.__lastMenu?.items || []).map((i) => String(i.content).replace(/^[✓\s]+/, "").trim()));     // (the stub page records the menu ComfyUI would draw)
    check(`the Separate button has a ▾ that opens its options (${sepMenu.join(" | ")})`, sepMenu.join("|") === "Keep all regions separate|Automatic (as set in Settings)|Off for this node|Share the background");
    check("and a click on the ▾ did not switch Separate itself", !(await page.evaluate(() => { const o = window.__node.__rgState().loraOpts || {}; return o.allRegions || o.autoOff; })));

    check("hints and start card take no clicks", await page.evaluate(() => [".rg-tips", ".rg-start"].every((s) => getComputedStyle(document.querySelector(s)).pointerEvents === "none")));
    // ---- every tool has its own hints
    const want = { shape: /Shift Equal sides.*Alt From the centre/, brush: /Shift\+click A straight line.*Brush size/, lasso: /Enter \/ double-click Close the outline.*Backspace/,
        lassoErase: /Close the outline/, fill: /Click Fill that area/, wand: /similar color/, object: /Ctrl\+click Take that spot out of the selection.*Enter Add the selection/, erase: /Erase from the selected layer/ };
    const bad = [];
    // (with a region on the canvas: an empty canvas shows the start card in place of the hints)
    await page.evaluate(() => { window.__node.__rgState().regions = [{ id: 1, color: "#E76F51", prompt: "", type: "object", text: "" }]; window.__node.__rgRefresh(); }); await page.waitForTimeout(100);
    check("with a region on the canvas the start card and its arrows are gone", !(await shown(".rg-start")) && !(await shown(".rg-start-arrows")));
    for (const [t, re] of Object.entries(want)) { await setTool(t); if (!re.test(await tips() || "")) bad.push(t); }
    await setTool("select");
    check("…and the Select tool's hints show (click, zoom, pan)", /Click Select a layer/.test(await tips() || "") && /Wheel Zoom/.test(await tips()) && /Space\+drag Pan/.test(await tips()));
    await page.evaluate(() => { window.__node.__rgState().regions = []; window.__node.__rgRefresh(); }); await page.waitForTimeout(100);
    check(`each tool shows its own keys and gestures (${bad.join(", ")})`, !bad.length);
    await setTool("select");

    // ---- shortcuts over the whole editor: R while pointing at the list's header picks the rectangle
    const head = await page.locator(".rg-list").boundingBox();
    await page.mouse.move(850, 50); await page.evaluate(() => document.activeElement?.blur?.());      // outside the editor
    await page.mouse.move(head.x + head.width / 2, head.y + head.height - 6);
    await page.keyboard.press("r");
    check("R while pointing at the region list picks the Rectangle tool", await page.locator('.rg-bar .rg-btn.grp[data-group="shape"].on').count() === 1);

    // ---- drawing: the hints fade while the button is held, the start card goes with the first layer
    let [x, y] = await toClient(200, 200);
    await page.mouse.move(x, y); await page.mouse.down();
    [x, y] = await toClient(600, 700); await page.mouse.move(x, y, { steps: 5 });
    check("while drawing: the hints are faded", await page.evaluate(() => document.querySelector(".rg-cv").classList.contains("held") && getComputedStyle(document.querySelector(".rg-tips")).opacity !== "1"));
    await page.mouse.up(); await page.waitForTimeout(250);
    check("after drawing: the hints are back, the start card is gone", await page.evaluate(() => !document.querySelector(".rg-cv").classList.contains("held")) && !(await shown(".rg-start")) && (await st()).layers.length === 1);
    await setTool("select");
    await page.evaluate(() => window.__node.__rgSelectLayer(window.__node.__rgState().layers[0].id)); await page.evaluate(() => window.__node.__rgRefresh());
    check("a selected layer: hints for moving, resizing, rotating", /Square handles Resize/.test(await tips() || "") && /Round handle Rotate/.test(await tips()));
    check("the region row counts its layers with the layers icon", await page.locator(".rg-row.region .rg-cnt svg").count() === 1 && /1/.test(await page.locator(".rg-row.region .rg-cnt").innerText()));

    // ---- Settings > Canvas tools > Hints on the canvas
    const def = await page.evaluate(() => { const s = window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.Hints"); return s && { type: s.type, d: s.defaultValue }; });
    check("Settings: 'Hints on the canvas', on by default", def?.type === "boolean" && def.d === true);
    await page.evaluate(() => { window.__settings["RegionGenie.Tools.Hints"] = false; window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.Hints").onChange(false); });
    check("hints off in Settings: no hints on the canvas, right away", await tips() === null);
    await page.evaluate(() => { window.__node.__rgState().layers = []; window.__node.__rgState().regions = []; window.__node.__rgRefresh(); });
    check("hints off in Settings: the start card on an empty canvas stays (it has its own Setting)", await shown(".rg-start"));
    const sc = await page.evaluate(() => { const s = window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.StartCard"); return s && { type: s.rgType || s.type, d: s.defaultValue }; });
    check("Settings: 'Start card on an empty canvas', on by default", sc?.type === "boolean" && sc.d === true);
    await page.evaluate(() => { window.__settings["RegionGenie.Tools.StartCard"] = false; window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.StartCard").onChange(false); });
    check("start card off in Settings: an empty canvas shows neither the card nor its arrows", !(await shown(".rg-start")) && !(await shown(".rg-start-arrows")));
    await page.evaluate(() => { window.__settings["RegionGenie.Tools.StartCard"] = true; window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.StartCard").onChange(true); });
    await page.evaluate(() => { window.__settings["RegionGenie.Tools.Hints"] = true; window.__settingsExt.settings.find((s) => s.id === "RegionGenie.Tools.Hints").onChange(true); });
    check("both on again: the start card is back on the empty canvas (and no hint strip under it)", await tips() === null && await shown(".rg-start"));

    // ---- Clear all: the last button of the toolbar, separate from Undo / Redo; undoable
    const bar = await page.evaluate(() => { const k = [...document.querySelector(".rg-bar").children]; const c = k.findIndex((e) => (e.title || "").startsWith("Clear all")), r = k.findIndex((e) => (e.title || "").startsWith("Redo")); return { last: c === k.length - 1, danger: k[c].classList.contains("danger"), gap: c - r }; });
    check("Clear all is the toolbar's last button, set separate from Undo / Redo", bar.last && bar.danger && bar.gap > 3);
    await page.mouse.move(x, y); await page.keyboard.press("r");
    [x, y] = await toClient(200, 200); await page.mouse.move(x, y); await page.mouse.down(); [x, y] = await toClient(500, 500); await page.mouse.move(x, y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
    await page.locator('.rg-bar [title^="Clear all"]').click(); await page.waitForTimeout(100);
    const cleared = (await st()).layers.length === 0;
    [x, y] = await toClient(400, 400); await page.mouse.move(x, y); await page.keyboard.press("Control+z"); await page.waitForTimeout(150);
    check("Clear all empties the canvas and Ctrl+Z brings it back", cleared && (await st()).layers.length === 1);

    // ---- round 48: the hints fade while the pointer is on the canvas, show again when it leaves, and for a moment
    // after a tool switch; a button in the canvas's corner hides / shows them
    const tipsOpacity = () => page.evaluate(() => +getComputedStyle(document.querySelector(".rg-tips")).opacity);
    await page.mouse.move(880, 1080); await page.waitForTimeout(3300);
    check("pointer away from the canvas: the hints show", await tipsOpacity() === 1);
    { const c = await page.locator(".rg-cv").boundingBox(); x = c.x + c.width / 2; y = c.y + c.height / 3; }
    await page.mouse.move(x, y, { steps: 3 }); await page.waitForTimeout(350);
    check("pointer on the canvas: the hints are faded", await tipsOpacity() === 0);
    await page.keyboard.press("b"); await page.waitForTimeout(350);
    check("another tool (B): its hints show for a moment, though the pointer is on the canvas", await tipsOpacity() === 1 && /Paint/.test(await tips()));
    await page.waitForTimeout(3100);
    check("…and fade again after about three seconds", await tipsOpacity() === 0);
    await page.mouse.move(880, 1080); await page.waitForTimeout(350);
    check("pointer off the canvas again: they are back", await tipsOpacity() === 1);
    await page.keyboard.press("v"); await page.waitForTimeout(100);
    const tb = page.locator(".rg-cv .rg-tips-btn");
    const tbBox = await tb.boundingBox(), cvB = await page.locator(".rg-cv").boundingBox();
    check("a small button in the canvas's lower right corner, lit while the hints are on, with a tooltip", await tb.count() === 1 && await tb.evaluate((b) => b.classList.contains("on") && /^Hints on the canvas: On/.test(b.title))
        && cvB.x + cvB.width - (tbBox.x + tbBox.width) < 10 && cvB.y + cvB.height - (tbBox.y + tbBox.height) < 10);
    check("…clear of the hints themselves", await page.evaluate(() => { const a = document.querySelector(".rg-tips").getBoundingClientRect(), b = document.querySelector(".rg-tips-btn").getBoundingClientRect(); return a.right <= b.left; }));
    await tb.click(); await page.waitForTimeout(200);
    check("a click hides the hints (the Setting 'Hints on the canvas' goes off) and the button goes dark", await tips() === null && await tb.evaluate((b) => !b.classList.contains("on") && /^Hints on the canvas: Off/.test(b.title)));
    await tb.click(); await page.waitForTimeout(200); await page.mouse.move(880, 1080); await page.waitForTimeout(200);
    check("another click shows them again", !!(await tips()) && await tb.evaluate((b) => b.classList.contains("on")));

    // ---- round 52 (values of round 68): a new node starts at separation 0.85 / until 0.1 and says so in its data; a node saved without the
    // two values (before this round) keeps 0.85 / 0.25
    const lo = await page.evaluate(() => JSON.parse(JSON.stringify(window.__node.__rgState().loraOpts || null)));
    check(`a new node's data holds separation 0.85 and until 0.1 (${JSON.stringify(lo)})`, !!lo && lo.separation === 0.85 && lo.until === 0.1);
    await page.evaluate(() => { const n = window.__node, s = n.__rgState(); s.loraOpts = { ...s.loraOpts, allRegions: true }; n.__rgRefresh(); }); await page.waitForTimeout(200);
    const flds = () => page.evaluate(() => [...document.querySelectorAll(".rg-loraopts input")].map((i) => i.value));
    const tipsSU = await page.evaluate(() => [...document.querySelectorAll(".rg-loraopts input")].map((i) => i.title));
    check(`the header's fields show them (${await flds()})`, (await flds()).join() === "0.85,0.1");
    check("their tooltips: what it does, then the default's values, the smoother blend's, the strongest separation's", /^separation: How strongly the regions are kept from influencing each other/.test(tipsSU[0])
        && tipsSU[0].endsWith("Regions placed reliably: 0.85 with until 0.1 (the default).\nBetter cohesion across regions: 0.4-0.5 with until 0.1.\nStrongest style separation: 0.85-0.99 with until 0.1-0.5.")
        && /^until: The share of the steps, counted from the start/.test(tipsSU[1])
        && tipsSU[1].endsWith("Regions placed reliably: 0.1 with separation 0.85 (the default).\nBetter cohesion across regions: 0.1 with separation 0.4-0.5.\nStrongest style separation: 0.1-0.5 with separation 0.85-0.99.") && !/LoRA/.test(tipsSU.join(" ")));
    const saved52 = await page.evaluate(() => JSON.stringify(window.__node.__rgState().loraOpts));
    // a workflow saved before: its data has no values; loading it (configure) gives it the earlier defaults
    await page.evaluate(() => { const n = window.__node, w = n.widgets.find((x) => x.name === "paint_data"), d = JSON.parse(w.value || "{}"); delete d.loraOpts; w.value = JSON.stringify(d); n.onConfigure?.({ widgets_values: n.widgets.map((x) => x.value), properties: n.properties }); });
    await page.waitForTimeout(250);
    const legacy = await page.evaluate(() => JSON.parse(JSON.stringify(window.__node.__rgState().loraOpts || null)));
    await page.evaluate(() => { const n = window.__node, s = n.__rgState(); s.loraOpts = { ...s.loraOpts, allRegions: true }; n.__rgRefresh(); }); await page.waitForTimeout(200);
    check(`a node whose saved data doesn't say (saved before this version): 0.85 and 0.25 as before (${JSON.stringify(legacy)}; fields ${await flds()})`, !!legacy && legacy.separation === 0.85 && legacy.until === 0.25 && (await flds()).join() === "0.85,0.25");
    await page.evaluate((t) => { const n = window.__node, s = n.__rgState(); s.loraOpts = JSON.parse(t); delete s.loraOpts.allRegions; n.__rgRefresh(); }, saved52); await page.waitForTimeout(150);

    // ---- round 102: the two number fields beside Separate are always shown; greyed, with a line in their tooltip,
    // while they change nothing (Separate off and no LoRA), and still editable
    { const look = () => page.evaluate(() => { const b = document.querySelector(".rg-loraopts"), k = [...b.children].filter((e) => !e.classList.contains("rg-separate"));
          return { shown: k.filter((e) => e.getClientRects().length).length, idle: k.filter((e) => e.classList.contains("rg-idle")).length, dim: k.every((e) => +getComputedStyle(e).opacity < 0.6),
                   tip: k.every((e) => /^No effect right now: /.test(e.title)), off: [...b.querySelectorAll("input")].some((i) => i.disabled) }; });
      const setOpts = (o) => page.evaluate((o) => { const n = window.__node, s = n.__rgState(); if (o) s.loraOpts = { ...(s.loraOpts || {}), ...o }; else delete s.loraOpts; n.__rgRefresh(); }, o);
      await setOpts(null); await page.waitForTimeout(150);
      const a = await look();
      check(`with Separate off and no LoRA the two fields and their icons are shown, greyed, and say so in their tooltips; they can still be typed in (${JSON.stringify(a)})`, a.shown === 4 && a.idle === 4 && a.dim && a.tip && !a.off);
      await setOpts({ allRegions: true }); await page.waitForTimeout(150);
      const b = await look();
      check(`with Separate on they are not greyed (${JSON.stringify(b)})`, b.shown === 4 && b.idle === 0 && !b.dim && !b.tip);
      await setOpts({ allRegions: false, autoOff: true }); await page.waitForTimeout(150);
      const c = await look();
      check(`switched off again: greyed again (${JSON.stringify(c)})`, c.shown === 4 && c.idle === 4 && c.tip);
      await setOpts(null); await page.waitForTimeout(150); }

    // ---- round 48: the list header. Icons for separation / until, 'Separate' on the button; a message that doesn't
    // fit beside them gets a line of its own for as long as it shows
    await page.evaluate(() => { const n = window.__node, s = n.__rgState(); s.loraOpts = { ...(s.loraOpts || {}), allRegions: true }; n.__rgRefresh(); });
    await page.waitForTimeout(250);
    const hd = await page.evaluate(() => { const b = document.querySelector(".rg-loraopts"), k = [...b.children].filter((e) => e.getClientRects().length);
        return { kinds: k.map((e) => e.tagName === "INPUT" ? "field" : e.classList.contains("rg-separate") ? "button" : e.querySelector("svg") && !e.textContent.trim() ? "icon" : "text:" + e.textContent.trim()),
            tips: k.slice(0, 4).every((e) => e.title && e.title.length > 20), same: k[0].title === k[1].title && k[2].title === k[3].title, h: Math.round(document.querySelector(".rg-head").getBoundingClientRect().height) }; });
    check(`with 'Separate' on: an icon and a field for separation, an icon and a field for until, then the button; no words (${hd.kinds.join(" ")})`, hd.kinds.join(" ") === "icon field icon field button" && hd.tips && hd.same);
    check("the button says 'Separate'", (await page.locator(".rg-separate").innerText()).trim() === "Separate" && await page.locator(".rg-separate svg").count() === 2);      // its icon, and since round 100 its ▾
    await page.evaluate(() => { document.querySelector(".rg-wrap").style.width = "600px"; }); await page.waitForTimeout(150);      // the editor's width in a 620 px node
    check("the header is one line at the new default width (600 px inside a 620 px node)", await page.evaluate(() => document.querySelector(".rg-head").getBoundingClientRect().height) < 26
        && await page.evaluate(() => document.querySelector(".rg-bar").getBoundingClientRect().height) < 26);
    await page.locator('.rg-bar .rg-btn.icon[title^="Arrange"]').click().catch(() => {});
    const headMsg = async (text) => { await page.evaluate((t) => window.__node.__rgHint(t), text); await page.waitForTimeout(80);
        return page.evaluate(() => { const s = document.querySelector(".rg-head .rg-status"), h = document.querySelector(".rg-head").getBoundingClientRect(), r = s.getBoundingClientRect();
            return { wide: s.classList.contains("wide"), all: s.scrollWidth <= s.clientWidth + 1, headH: Math.round(h.height), below: r.top > document.querySelector(".rg-separate").getBoundingClientRect().bottom - 2, text: s.textContent }; }); };
    const m1 = await headMsg("The layer is too small to shrink by 50 px: choose a smaller value, or make the layer larger first and try again");       // (longer since round 88: the header lost its open / close buttons and has more room)
    check(`a message that doesn't fit beside the fields: a line of its own under the header, all of it readable (${JSON.stringify(m1)})`, m1.wide && m1.all && m1.below && m1.headH > 30);
    await page.evaluate(() => { const n = window.__node, s = n.__rgState(); s.loraOpts = { ...(s.loraOpts || {}), allRegions: false, autoOff: true }; n.__rgRefresh(); });
    await page.waitForTimeout(200);
    const m2 = await headMsg("Select a layer first");
    check(`a message that fits (the fields are greyed with 'Separate' off): on the header's own line (${JSON.stringify(m2)})`, !m2.wide && m2.all && m2.headH < 26);
    await page.waitForTimeout(3700);
    check("after 3.5 s the message is gone and the header is one line again", await page.evaluate(() => { const s = document.querySelector(".rg-head .rg-status"); return !s.textContent && !s.classList.contains("wide") && document.querySelector(".rg-head").getBoundingClientRect().height < 26; }));
    await page.evaluate(() => { document.querySelector(".rg-wrap").style.width = ""; const n = window.__node, s = n.__rgState(); delete s.loraOpts; n.__rgRefresh(); }); await page.waitForTimeout(150);

    // ---- words: 'strength' / 'steps' on a Control row; the model dropdown
    await page.locator('.rg-row.scene [title^="Add a Control row"]').click(); await page.waitForTimeout(200); await page.keyboard.press("Escape"); await page.waitForTimeout(100);
    const words = await page.locator(".rg-row.ctrl .rg-word").allInnerTexts();
    check(`a Control row labels its numbers (${words.join(" / ")})`, words.join("|") === "strength|steps");
    await page.evaluate(() => { document.querySelector(".rg-wrap").style.width = "560px"; }); await page.waitForTimeout(150);
    check("a Control row fits the list at the default width (its remove button isn't cut off)", await page.evaluate(() => { const row = document.querySelector(".rg-row.ctrl"), list = document.querySelector(".rg-list").getBoundingClientRect();
        const last = [...row.children].filter((e) => e.getClientRects().length).pop().getBoundingClientRect(); return last.right <= list.right - 2 && row.scrollWidth <= row.clientWidth + 1; }));
    await page.evaluate(() => { document.querySelector(".rg-wrap").style.width = ""; }); await page.waitForTimeout(100);
    check("the words carry their number's tooltip", await page.evaluate(() => [...document.querySelectorAll(".rg-row.ctrl .rg-word")].every((w) => w.title && w.title === w.nextElementSibling.title)));
    check("the model dropdown says 'auto: no model yet' before anything is known", (await page.locator(".rg-model option").first().innerText()) === "auto: no model yet");

    // ---- the run-notes button
    check("no run yet: no notes button", !(await shown(".rg-notes")));
    const info = "2 region(s) on 1024x1024 canvas\nprompt: text (no model connected)\nNOTE: control: no model is connected to 'model'; control not used\nNOTE: region #ff0000 ('x') has no pixels, skipped";
    await page.evaluate((info) => window.__node.onExecuted({ region_info: [info] }), info); await page.waitForTimeout(80);
    check("after a run with two notes: the button shows ⚠ 2", await shown(".rg-notes") && (await page.locator(".rg-notes").innerText()).trim() === "2" && await page.locator(".rg-notes svg").count() === 1 && await page.locator(".rg-notes.warn").count() === 1);
    await page.locator(".rg-notes").click(); await page.waitForTimeout(80);
    const msg = await page.locator(".rg-msg-text").innerText();
    check("a click lists the notes first, then the rest of the report", await shown(".rg-msg") && /^• control: no model/.test(msg) && /• region #ff0000/.test(msg) && /The last run:\n2 region\(s\)/.test(msg) && !/NOTE:/.test(msg));
    await page.locator(".rg-notes").click(); await page.waitForTimeout(80);
    check("a second click hides it", !(await shown(".rg-msg")));
    await page.locator(".rg-notes").click();
    await page.evaluate(() => window.__node.onExecuted({ region_info: ["1 region(s) on 1024x1024 canvas\nprompt: text"] })); await page.waitForTimeout(80);
    check("a run without notes: ⓘ, and an open report follows the new run", (await page.locator(".rg-notes").innerText()).trim() === "" && await page.locator(".rg-notes svg").count() === 1 && await page.locator(".rg-notes.warn").count() === 0
        && /1 region\(s\)/.test(await page.locator(".rg-msg-text").innerText()) && await page.locator(".rg-msg.info").count() === 1);
    await page.locator('.rg-msg .rg-btn[data-ic="close"]').click();

    await page.screenshot({ path: require("path").join(__dirname, "out", "ui_hints.png"), fullPage: false });
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
