// Browser checks of round 42: the pop-up editors' text (a region's pop-up: the stub page has no scene prompt boxes;
// tests/real_fields_popups.cjs does the same for the scene prompts and the Regional LoRAs node in the real ComfyUI). Enter is a new line; Esc and the close button close the pop-up
// and the text stays; Undo / Redo buttons (and the Undo / Redo keys) with steps that outlive the pop-up; the tag
// autocomplete switch and the wildcard button in the bottom row, left of the LLM button; the buttons' click areas;
// no browser tooltip next to the pack's own on a button in the title bar; the shortcut list in a low or narrow window.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1100 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.addInitScript(() => { window.__rgTakeTitles = true; });        // the real thing: a title is put aside while the pointer is on it
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__settingsExt.setup());
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__node.__rgState())));
    const sceneVal = async () => (await st()).regions[0].prompt;                  // the text where it lives: the region's prompt
    const away = async () => { await page.mouse.move(860, 1080); await page.waitForTimeout(80); };
    const pop = page.locator(".rg-pop");
    const popTa = page.locator(".rg-pop textarea").first();
    const head = () => page.evaluate(() => [...document.querySelectorAll(".rg-pop-head > *")].filter((e) => getComputedStyle(e).display !== "none")
        .map((e) => e.dataset.ic || (e.classList.contains("rg-x") ? "close" : e.textContent.trim())));
    const hist = () => page.evaluate(() => { const b = (ic) => document.querySelector(`.rg-pop-head .rg-hist[data-ic="${ic}"]`); return [!b("undo").disabled, !b("redo").disabled]; });
    const undoB = page.locator('.rg-pop-head .rg-hist[data-ic="undo"]'), redoB = page.locator('.rg-pop-head .rg-hist[data-ic="redo"]');

    // a region to work with
    await page.evaluate(() => window.__node.__rgSetTool("shape"));
    const [bx, by] = await page.evaluate(() => { const c = document.querySelector(".rg-cv canvas").getBoundingClientRect(); return [c.x, c.y]; });
    await page.mouse.move(bx + 60, by + 60); await page.mouse.down(); await page.mouse.move(bx + 170, by + 160, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
    const rid = (await st()).regions[0].id;

    // ---- a region's pop-up
    const openPop = async () => { await page.locator(".rg-list .rg-pwrap .rg-expand").first().click(); await page.waitForTimeout(150); };
    await openPop();
    check("a region's pop-up opens, its text box focused", await pop.count() === 1 && await page.evaluate(() => document.activeElement?.closest?.(".rg-pop") != null));
    const h = await head();
    check(`title bar, from the left: ◀ ▶, Undo, Redo, A− A+, close (${h.join(" ")})`, h.slice(-7).join("|") === "◀|▶|undo|redo|A−|A+|close");
    check("nothing typed yet: Undo and Redo are greyed", (await hist()).join() === "false,false");
    await page.keyboard.type("a red fox");
    await page.keyboard.press("Enter");
    await page.keyboard.type("in the snow"); await page.waitForTimeout(80);
    check(`Enter is a new line, and the pop-up stays open (${JSON.stringify(await sceneVal())})`, await pop.count() === 1 && await sceneVal() === "a red fox\nin the snow" && await popTa.inputValue() === "a red fox\nin the snow");
    check("typing gives Undo something to take back", (await hist()).join() === "true,false");
    await page.keyboard.press("Escape"); await page.waitForTimeout(120);
    check("Esc closes the pop-up and the text stays", await pop.count() === 0 && await sceneVal() === "a red fox\nin the snow");
    // open again: the steps are still there
    await openPop();
    check("opened again: Undo still has the steps from before", (await hist()).join() === "true,false");
    let steps = 0;
    while ((await hist())[0] && steps < 20) { await undoB.click(); await page.waitForTimeout(40); steps++; }
    check(`Undo, step by step, goes back to the empty text of the start (${steps} steps), in the node too`, steps >= 2 && steps <= 8 && await popTa.inputValue() === "" && await sceneVal() === "");
    check("the text box kept the cursor through the clicks", await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA" && !!document.activeElement.closest(".rg-pop")));
    check("at the start: Undo greyed, Redo ready", (await hist()).join() === "false,true");
    for (let i = 0; i < steps; i++) { await redoB.click(); await page.waitForTimeout(40); }
    check("Redo brings every step back", await popTa.inputValue() === "a red fox\nin the snow" && await sceneVal() === "a red fox\nin the snow" && (await hist()).join() === "true,false");
    // the keys of Undo / Redo act on the text here, not on the regions
    const nReg = (await st()).regions.length;
    await page.keyboard.press("Control+z"); await page.waitForTimeout(60);
    const afterZ = await popTa.inputValue();
    await page.keyboard.press("Control+y"); await page.waitForTimeout(60);
    check(`Ctrl+Z / Ctrl+Y in the text box: the text's own steps (${JSON.stringify(afterZ)})`, afterZ !== "a red fox\nin the snow" && "a red fox\nin the snow".startsWith(afterZ) && await popTa.inputValue() === "a red fox\nin the snow"
        && (await st()).regions.length === nReg);
    await page.keyboard.press("Control+z"); await page.keyboard.press("Control+Shift+z"); await page.waitForTimeout(60);
    check("Ctrl+Shift+Z redoes too", await popTa.inputValue() === "a red fox\nin the snow");
    // a new edit after Undo drops the steps that were taken back
    await page.keyboard.press("Control+z"); await page.waitForTimeout(40);
    await page.keyboard.type("!"); await page.waitForTimeout(60);
    check("typing after an Undo: nothing left to redo", (await hist()).join() === "true,false");
    // text set by code (the LLM, a LoRA's words, "use the filled text") is a step of its own
    await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(60);
    await page.evaluate(() => { const n = window.__node; n.__rgState().regions[0].prompt = "set by code"; n.__rgRefresh(); });
    await page.waitForTimeout(150);
    const byCode = await popTa.inputValue();
    await undoB.click(); await page.waitForTimeout(60);
    check(`a text set by code is one step: Undo puts the typed text back (${JSON.stringify(byCode)} -> ${JSON.stringify(await popTa.inputValue())})`, byCode === "set by code" && /!$/.test(await popTa.inputValue()));
    // the bottom row: tag switch (hidden here: no autocomplete pack in the stub page), wildcard button, LLM, ＋LoRA
    const bottom = await page.evaluate(() => [...document.querySelectorAll(".rg-pop .pop-ctl > *")].map((e) => e.classList.contains("rg-ac-btn") ? "tag" : e.classList.contains("rg-wc-pick") ? "wildcard" : e.classList.contains("rg-llm-btn") ? "llm" : e.classList.contains("rg-pop-gap") ? "gap" : e.textContent.trim()));
    check(`bottom row: the region's own controls, then on the right tag switch, wildcard, LLM, ＋LoRA (${bottom.join(" | ")})`, bottom.slice(-5).join("|") === "gap|tag|wildcard|llm|＋LoRA" && bottom.indexOf("gap") >= 2);
    check("no tag switch or wildcard button is left in the title bar", await page.locator(".rg-pop-head .rg-ac-btn, .rg-pop-head .rg-wc-pick").count() === 0);
    check("the line at the bottom says what Esc does now", /Esc: close \(the text stays\)/.test(await page.locator(".rg-pop-foot").innerText()) && !/Enter/.test(await page.locator(".rg-pop-foot").innerText()));

    // ---- no browser tooltip next to the pack's: a button in the title bar (which has a tooltip of its own)
    const nativeTip = (x, y) => page.evaluate(([x, y]) => { for (let e = document.elementFromPoint(x, y); e; e = e.parentElement) if (e.hasAttribute("title")) return e.getAttribute("title"); return ""; }, [x, y]);
    const tipText = () => page.evaluate(() => document.querySelector(".rg-tip.on")?.innerText || "");
    const bad = [];
    const hb = await page.evaluate(() => [...document.querySelectorAll(".rg-pop-head > button, .rg-pop .pop-ctl button, .rg-pop-grip")].filter((b) => b.getClientRects().length && getComputedStyle(b).display !== "none")
        .map((b) => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, b.dataset.ic || b.className]; }));
    for (const [x, y, name] of hb) {
        await away(); await page.mouse.move(x, y); await page.waitForTimeout(650);
        const nat = await nativeTip(x, y), own = await tipText();
        if (nat !== "" || !own || /Drag to move/.test(own)) bad.push(`${name}: browser ${JSON.stringify(nat.slice(0, 30))}, pack ${JSON.stringify(own.slice(0, 30))}`);
    }
    check(`every button of the pop-up (${hb.length}): the pack's tooltip shows its own text and the browser has nothing to show, not the title bar's "Drag to move" either (${bad.join("; ")})`, hb.length >= 8 && !bad.length);
    await away();
    check("the title bar's own tooltip is back when the pointer has left", /^Drag to move/.test(await page.locator(".rg-pop-head").getAttribute("title") || ""));

    // ---- click areas (round 39's rule, now in the pop-up too): at least 24 px tall, and no dead strip between neighbours
    const areas = await page.evaluate(() => {
        const out = [];
        const bs = [...document.querySelectorAll(".rg-pop-head > button")].filter((b) => getComputedStyle(b).display !== "none");
        for (const b of bs) {
            const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, dis = b.disabled;
            const hit = (x, y) => document.elementFromPoint(x, y)?.closest("button") === b;
            let up = 0, down = 0;
            while (up < 20 && hit(cx, r.top - up - 0.5)) up++;
            while (down < 20 && hit(cx, r.bottom + down + 0.5)) down++;
            out.push({ name: b.dataset.ic || b.textContent.trim() || "close", h: Math.round(r.height + up + down), dis });
        }
        // the middle of the gap between two neighbours belongs to one of them
        let dead = 0;
        for (let i = 0; i + 1 < bs.length; i++) { const a = bs[i].getBoundingClientRect(), c = bs[i + 1].getBoundingClientRect();
            for (let x = a.right + 0.5; x < c.left; x += 1) { const e = document.elementFromPoint(x, a.top + a.height / 2)?.closest("button"); if (e !== bs[i] && e !== bs[i + 1]) dead++; } }
        return { out, dead };
    });
    check(`title bar buttons: each takes clicks over at least 24 px of height (${areas.out.map((a) => a.name + " " + a.h).join(", ")})`, areas.out.length >= 7 && areas.out.every((a) => a.h >= 24));
    check(`…and the gaps between them are no dead strips (${areas.dead} dead px)`, areas.dead === 0);

    // ---- the close button keeps the text as well
    await popTa.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" KEPT"); await page.waitForTimeout(60);
    const beforeX = await sceneVal();
    await page.locator(".rg-pop-head .rg-x").click(); await page.waitForTimeout(120);
    check("the close button closes the pop-up and the text stays", await pop.count() === 0 && / KEPT$/.test(beforeX) && await sceneVal() === beforeX);

    // ---- outside the pop-up the same key undoes the editor's last step: the whole edit of the prompt
    await page.locator(".rg-cv canvas").hover(); await page.keyboard.press("Control+z"); await page.waitForTimeout(150);
    const afterEditorUndo = await sceneVal();
    check(`after closing, Ctrl+Z on the node is the editor's undo again: it takes the last edit of the prompt back as one step (${JSON.stringify(afterEditorUndo)})`, afterEditorUndo !== beforeX && !/ KEPT$/.test(afterEditorUndo));
    await page.keyboard.press("Control+y"); await page.waitForTimeout(150);

    // ---- the shortcut list: every section can be reached, whatever the window's size
    const sheet = () => page.evaluate(() => { const b = document.querySelector(".rg-keys-body"); if (!b) return null; const br = b.getBoundingClientRect(), box = b.closest(".rg-keys").getBoundingClientRect();
        const secs = [...b.querySelectorAll("section")].map((s) => { const r = s.getBoundingClientRect(); return { name: s.querySelector("h4").textContent, inside: r.left >= br.left - 1 && r.right <= br.right + 1, left: Math.round(r.left - br.left), top: Math.round(r.top - br.top + b.scrollTop) }; });
        b.scrollTop = b.scrollHeight;
        const last = b.querySelector("section:last-of-type .rg-keys-row:last-child")?.getBoundingClientRect(), lastSec = [...b.querySelectorAll("section")].pop().getBoundingClientRect();
        const r = { secs, sideways: b.scrollWidth > b.clientWidth + 1, inWin: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, endSeen: lastSec.bottom <= br.bottom + 1, scrolls: b.scrollHeight > b.clientHeight + 1 };
        b.scrollTop = 0; return r; });
    const names = "Tools|While drawing|Layers and regions|View|Text";
    for (const [w, hgt, what] of [[900, 1100, "a tall window"], [900, 420, "a low window"], [460, 700, "a narrow window"]]) {
        await page.setViewportSize({ width: w, height: hgt }); await page.waitForTimeout(150);
        await page.evaluate(() => document.querySelector(".rg-keys-btn").click()); await page.waitForTimeout(200);
        const sh = await sheet();
        const cols = sh ? new Set(sh.secs.map((s) => s.left)).size : 0;
        check(`shortcut list in ${what} (${w}×${hgt}): all five sections inside it${sh?.scrolls ? ", the rest by scrolling down" : ""}, nothing off to the side (${cols} column${cols === 1 ? "" : "s"})`,
            !!sh && sh.secs.map((s) => s.name).join("|") === names && sh.secs.every((s) => s.inside) && !sh.sideways && sh.inWin && sh.endSeen && cols === (w < 700 ? 1 : 2));
        await page.keyboard.press("Escape"); await page.waitForTimeout(120);
    }
    await page.setViewportSize({ width: 900, height: 1100 });

    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
