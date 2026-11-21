// Browser checks of round 50 in the stub page: the short Settings tab (which settings stay rows, which moved to pages),
// and the Region Genie settings window (pages, each kind of control, search, defaults, Esc). The real dialog, its
// layering and ComfyUI's own search are checked in real_settings.cjs.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => { const all = window.__settingsExt.settings.filter((s) => /^RegionGenie/.test(s.id));
        const shown = all.filter((s) => s.type !== "hidden");
        return { all: all.length, shown: shown.map((s) => s.name), sections: [...new Set(shown.map((s) => s.category[1]))], rows: all.filter((s) => s.rgRow).map((s) => s.rgRow),
            moved: all.filter((s) => s.rgType && s.type === "hidden").length, unplaced: all.filter((s) => s.rgType && !s.rgPage).map((s) => s.name),
            ids: all.filter((s) => s.rgRow).map((s) => s.id), order: shown.every((s, i) => i === 0 || s.sortOrder < shown[i - 1].sortOrder) }; });
    check(`the tab lists ${info.shown.length} rows in three sections (${info.sections.join(" | ")}), of ${info.all} settings`, info.shown.length >= 15 && info.shown.length <= 22
        && info.sections.join("|") === "Basics|Models and files|Other nodes" && info.order);
    check("the switches that stay as rows", ["Hints on the canvas", "Snap to grid on", "Tag autocomplete on in new Region Genie nodes", "New regions start with the LLM Prompt Enhancer on",
        "Plain-text prompts: keep all regions separate automatically", "Shortcuts", "Browse… for model files", "Check model files"].every((n) => info.shown.includes(n)));
    check(`eleven topic rows (${info.rows.join(" ")})`, info.rows.join() === "size,node,tools,text,control,edit,llm,separate,sam,hl,save");
    check(`every setting that left the tab has a page (${info.moved} moved; without a page: ${info.unplaced.join(" | ")})`, info.moved > 95 && !info.unplaced.length);
    check("a topic row's id carries the names of its page's settings, for ComfyUI's search", info.ids.find((i) => /Page\.save/.test(i)).includes("WebP quality") && info.ids.find((i) => /Page\.control/.test(i)).includes("canny ControlNet")
        && info.ids.every((i) => /^[A-Za-z0-9 .,:_\-]+$/.test(i)));
    // a stand-in for ComfyUI's Settings dialog, with the tab's rows in it
    await page.evaluate(() => { const d = document.createElement("div"); d.setAttribute("role", "dialog"); d.id = "dlg"; d.style.cssText = "position:fixed;left:40px;top:40px;width:1000px;height:700px;background:#222;overflow:auto;z-index:50";
        for (const s of window.__settingsExt.settings.filter((s) => s.rgRow)) d.appendChild(s.type(s.name, () => {}, ""));
        document.body.appendChild(d); });
    const st = (id) => page.evaluate((id) => window.__settings[id], id);
    const openPage = async (k) => { await page.locator(`#dlg .rg-page-row[data-page="${k}"] button`).click(); await page.waitForSelector(`.rg-setwin-nav button.on[data-page="${k}"]`); await page.waitForTimeout(120); };
    const rowOf = (name) => page.locator(".rg-setwin-row").filter({ has: page.locator("label", { hasText: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }) });
    await openPage("tools");
    const geo = await page.evaluate(() => { const w = document.querySelector(".rg-setwin"), d = document.getElementById("dlg"), a = w.getBoundingClientRect(), b = d.getBoundingClientRect();
        return { in: d.contains(w), covers: Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2,
            nav: [...w.querySelectorAll(".rg-setwin-nav button")].map((x) => x.firstChild.textContent), rows: w.querySelectorAll(".rg-setwin-row").length }; });
    check(`Edit… opens the window inside the dialog, covering it, on its page (${geo.rows} rows; pages: ${geo.nav.join(" | ")})`, geo.in && geo.covers && geo.rows === 7 && geo.nav.length === 11
        && geo.nav.join("|") === "Image size|Region Genie node|Canvas tools|Text size|Control|Edit Mode|LLM Prompt Enhancer|Keeping regions separate, per model|Select object|Regional LoRAs|Save Image");
    check("every row has a name with a tooltip and a control", await page.evaluate(() => [...document.querySelectorAll(".rg-setwin-row")].every((r) => r.querySelector("label").textContent && r.querySelector("label").title.length > 10 && r.querySelector(".rg-setwin-ctl").childElementCount > 0)));
    await rowOf("Hints on the canvas").locator(".rg-setwin-sw").click(); await page.waitForTimeout(80);
    await rowOf("Lasso: default").locator("select").selectOption("magnetic"); await page.waitForTimeout(80);
    const n = rowOf("Fill: gap size (px)").locator('input[type="number"]'); await n.fill("9"); await n.press("Tab"); await page.waitForTimeout(80);
    check("a switch, a dropdown and a number each save their setting", await st("RegionGenie.Tools.Hints") === false && await st("RegionGenie.Tools.Lasso") === "magnetic" && await st("RegionGenie.Tools.FillGap") === 9);
    check("the page's entry on the left counts the three changes", (await page.locator('.rg-setwin-nav button[data-page="tools"] span').textContent()) === "3");
    await page.locator('.rg-setwin-nav button[data-page="hl"]').click(); await page.waitForTimeout(120);
    const sl = rowOf("region_separation"); await sl.locator('input[type="number"]').fill("0.5"); await sl.locator('input[type="number"]').press("Tab"); await page.waitForTimeout(80);
    check("a slider follows its number field, and saves", await sl.locator('input[type="range"]').inputValue() === "0.5" && await page.evaluate(() => Object.entries(window.__settings).some(([k, v]) => /Separation/i.test(k) && v === 0.5)));
    await page.locator('.rg-setwin-nav button[data-page="node"]').click(); await page.waitForTimeout(120);
    check("a page made of several old sections has their names as headings; the pack's own rows are drawn (region colors)", (await page.locator(".rg-setwin-grp").allTextContents()).join("|") === "Tag autocomplete|Wildcards (Impact Pack)|Region Genie node"
        && await rowOf("Region colors").locator(".rg-colors .sw").count() >= 6);
    check("…Shortcuts isn't on a page (its row opens its own sheet)", await rowOf("Shortcuts").count() === 0);
    // search across the pages
    const ws = page.locator(".rg-setwin-head input"); await ws.fill("quality"); await page.waitForTimeout(120);
    const sr = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".rg-setwin-row label")].map((l) => l.textContent), grp: [...document.querySelectorAll(".rg-setwin-grp")].map((g) => g.textContent), on: document.querySelectorAll(".rg-setwin-nav button.on").length }));
    check(`the search lists matches from every page under the page's name (${sr.rows.join(" | ")})`, sr.rows.length >= 3 && sr.rows.every((t) => /quality/i.test(t)) && sr.grp.join() === "Save Image" && sr.on === 0);
    await ws.fill("zzzz"); await page.waitForTimeout(100);
    check("no match says so", /No setting/.test(await page.locator(".rg-setwin-page").innerText()));
    await page.keyboard.press("Escape"); await page.waitForTimeout(100);
    check("Esc clears the search first; the window stays on its page", await ws.inputValue() === "" && await page.locator(".rg-setwin").count() === 1 && await page.locator('.rg-setwin-nav button.on[data-page="node"]').count() === 1);
    // defaults for a page
    await page.locator('.rg-setwin-nav button[data-page="tools"]').click(); await page.waitForTimeout(120);
    const def = page.locator(".rg-setwin-foot button"); await def.click(); await page.waitForTimeout(80);
    const asked = await def.textContent(), still = await st("RegionGenie.Tools.FillGap");
    await def.click(); await page.waitForTimeout(250);
    check(`Defaults for this page asks first ("${asked}"), then resets this page only`, /again/i.test(asked) && still === 9 && await st("RegionGenie.Tools.FillGap") === 4 && await st("RegionGenie.Tools.Hints") === true
        && await st("RegionGenie.Tools.Lasso") === "plain" && await page.evaluate(() => Object.entries(window.__settings).some(([k, v]) => /Separation/i.test(k) && v === 0.5)));
    await def.click(); await page.waitForTimeout(3300);
    check("an unanswered question goes away after three seconds", (await def.textContent()) === "Defaults for this page");
    await page.keyboard.press("Escape"); await page.waitForTimeout(120);
    check("Esc closes the window; the dialog and its rows are still there", await page.locator(".rg-setwin").count() === 0 && await page.locator("#dlg .rg-page-row").count() === 11);
    check(`a topic row says what was changed on its page (${await page.locator('#dlg .rg-page-row[data-page="hl"] span').textContent()})`, (await page.locator('#dlg .rg-page-row[data-page="hl"] span').textContent()) === "1 changed"
        && (await page.locator('#dlg .rg-page-row[data-page="tools"] span').textContent()) === "");
    await openPage("save"); await page.locator(".rg-setwin-x").click(); await page.waitForTimeout(100);
    check("the close button closes it too", await page.locator(".rg-setwin").count() === 0);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED:\n  ` + fails.join("\n  ") : "\nALL PASS");
    process.exit(fails.length ? 1 : 0);
})();
