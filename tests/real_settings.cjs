// Every Region Genie setting shows in ComfyUI's Settings dialog, also when a LoRA / model file name contains characters
// the dialog's translation library reads as its own syntax (@ { } | %). Round 15: one LoRA named like 'char@v2' made
// every setting listing the LoRAs (control LoRAs, edit LoRAs) vanish with "SyntaxError: 10".
// Usage: COMFY_DIR=<ComfyUI folder> node real_settings.cjs   (needs ComfyUI on 127.0.0.1:8188 with this pack; it adds
// a few empty files to COMFY_DIR/models/loras and models/controlnet, named rgtest_…, and removes them afterwards)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path");
const DIR = process.env.COMFY_DIR || "/tmp/comfy_src";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// round 18: on Windows a LoRA in a subfolder starting with '@' is listed as 'sub\\@x': the backslash escaped the escape
// (the owner's 5 remaining "SyntaxError: 10"). Linux allows '\\' in a file name, so these stand in for such paths.
const ODD = ["rgtest_char@v2.safetensors", "rgtest_mix {style}.safetensors", "rgtest_a|b.safetensors", "rgtest_100% detail.safetensors", "rgtest_$x.safetensors",
    "rgtest_sub\\@author\\x.safetensors", "rgtest_sub\\{y}.safetensors", "rgtest_end\\.safetensors"];
const made = [];
// round 22: a large library (10000 LoRAs, Windows-style subfolder names) must not slow the Settings tab down
const BIG = Array.from({ length: 10000 }, (_, i) => `rgtest_big_SDXL\\@maker_${i % 97}\\style_${i}.safetensors`);
for (const sub of ["loras", "controlnet"]) {
    const d = path.join(DIR, "models", sub);
    fs.mkdirSync(d, { recursive: true });
    for (const n of sub === "loras" ? [...ODD, ...BIG] : ODD) { const f = path.join(d, n); if (!fs.existsSync(f)) { fs.writeFileSync(f, ""); made.push(f); } }
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().split("\n")[0]); });
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto("http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(2500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(300); }
    const lists = await page.evaluate(async () => (await (await fetch("/models/loras")).json()).filter((x) => /rgtest_/.test(x)));
    check(`the odd file names are listed by ComfyUI (${lists.length})`, lists.length === ODD.length + BIG.length);
    // a set value with odd characters must show too
    await page.evaluate(async () => { const s = window.app.extensionManager.setting; await s.set("RegionGenie.ModelFiles.Browse", false);
        await s.set("RegionGenie.Edit.LoRA.Krea2", "rgtest_char@v2.safetensors"); });
    errors.length = 0;
    await page.keyboard.press("Control+,"); await sleep(1500);
    const t0 = Date.now();
    page.evaluate(() => { const el = [...document.querySelectorAll('[role="dialog"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Region Genie"); el?.scrollIntoView(); el?.click(); }).catch(() => {});
    // round 50: the tab holds a few rows; the model-file fields are on pages of the Region Genie settings window
    const openPage = async (key) => { const b = page.locator(`[role="dialog"] .rg-page-row[data-page="${key}"] button`); await b.scrollIntoViewIfNeeded(); await b.click();
        await page.waitForSelector(`.rg-setwin .rg-setwin-nav button.on[data-page="${key}"]`, { timeout: 8000 }); await sleep(250); };
    const toPage = async (key) => { await page.locator(`.rg-setwin .rg-setwin-nav button[data-page="${key}"]`).click(); await sleep(350); };
    const closeWin = async () => { if (await page.locator(".rg-setwin").count()) { await page.locator(".rg-setwin .rg-setwin-x").click(); await sleep(250); } };
    const PAGES = ["size", "node", "tools", "text", "control", "edit", "llm", "separate", "sam", "hl", "save"];
    // what every page shows, gathered by walking through them: { text, fields, browse, selects }
    const walk = async () => { const out = { text: "", fields: 0, browse: 0, selects: 0 };
        for (const k of PAGES) { await toPage(k); const r = await page.evaluate(() => { const w = document.querySelector(".rg-setwin-page"), f = [...w.querySelectorAll(".rg-ff")];
            return { text: w.innerText, fields: f.length, browse: f.filter((x) => x.querySelector(".rg-ff-browse svg")).length, selects: f.filter((x) => x.querySelector("select")).length }; });
            out.text += "\n" + r.text; out.fields += r.fields; out.browse += r.browse; out.selects += r.selects; }
        return out; };
    let shownMs = -1;
    for (let i = 0; i < 100; i++) {
        const n = await Promise.race([page.evaluate(() => document.querySelectorAll('[role="dialog"] .rg-page-row').length), sleep(10000).then(() => -1)]);
        if (n > 0) { shownMs = Date.now() - t0; break; }
        await sleep(50);
    }
    const p0 = Date.now(); await page.evaluate(() => 1); const ping = Date.now() - p0;
    check(`with ${BIG.length + ODD.length} LoRAs the Region Genie tab opens fast and stays responsive (${shownMs} ms; then ${ping} ms)`, shownMs >= 0 && shownMs < 5000 && ping < 300);
    await sleep(1500);
    const r = await page.evaluate(() => {
        const txt = document.querySelector('[role="dialog"]')?.innerText || "";
        const all = Object.values(window.app.ui.settings.settingsParamLookup).filter((d) => /^RegionGenie/.test(d.id) && d.type !== "hidden");
        return { missing: all.filter((d) => !txt.includes(d.name.trim())).map((d) => d.name), n: all.length, heads: [...document.querySelectorAll('[role="dialog"] h3')].map((h) => h.textContent.trim()).filter((t) => /^(Basics|Models and files|Other nodes)$/.test(t)) };
    });
    check(`the tab is short: ${r.n} rows in three sections, all shown (${r.heads.join(" | ")}; missing: ${r.missing.slice(0, 6).join(" | ")})`, r.n >= 15 && r.n <= 22 && !r.missing.length
        && r.heads.join("|") === "Basics|Models and files|Other nodes");
    const tp = Date.now(); await openPage("edit"); const pageMs = Date.now() - tp;
    check(`a page opens quickly with ${BIG.length + ODD.length} LoRAs (${pageMs} ms)`, pageMs < 3000);
    const all0 = await walk();
    const moved = await page.evaluate(() => Object.values(window.app.ui.settings.settingsParamLookup).filter((d) => /^RegionGenie/.test(d.id) && d.rgPage && d.type === "hidden").map((d) => (d.rgLabel || d.name).trim()));      // (rgLabel: the short label a row shows under its heading, round 71)
    const lost = moved.filter((n) => !all0.text.includes(n));
    check(`every setting that left the tab is on a page of the window (${moved.length}; missing: ${lost.slice(0, 6).join(" | ")})`, moved.length > 95 && !lost.length);
    await toPage("edit");
    const i18n = errors.filter((e) => /SyntaxError|i18n|compile/i.test(e));
    check(`no translation errors while it shows (${i18n.slice(0, 2).join(" | ")})`, !i18n.length);
    // round 23: every model-file setting is a field that opens ComfyUI's classic menu (no Browse… by default)
    const off = { n: all0.fields, browse: all0.browse, selects: all0.selects };
    check(`Browse… off (default): every model-file setting is a file field, no dropdown, no Browse buttons (${off.n} fields, ${off.browse} buttons)`,
        off.n >= 27 && off.browse === 0 && off.selects === 0);
    // the edit LoRA field: its value as it is; the menu opens inside the dialog on the model folders, and the search finds a
    // 'sub\@author' name in a subfolder
    const kreaName = await page.evaluate(() => {
        const sp = [...document.querySelectorAll('[role="dialog"] .rg-setwin label')].find((e) => e.textContent.trim() === "Krea 2: edit LoRA");
        let r = sp; while (r && !r.querySelector?.(".rg-ff")) r = r.parentElement;
        const n = r.querySelector(".rg-ff-name"); n.id = "rgkrea"; n.scrollIntoView({ block: "center" }); return n.textContent;
    });
    check(`a set value with '@' shows as it is (${kreaName})`, kreaName === "rgtest_char@v2.safetensors");
    const tm = Date.now(); await page.click("#rgkrea"); await page.waitForSelector(".litecontextmenu", { timeout: 10000 }); const menuMs = Date.now() - tm;
    const menu = await page.evaluate(() => { const m = document.querySelector(".litecontextmenu");
        return { inDlg: !!m.closest('[role="dialog"]'), top: [...m.querySelectorAll(".litemenu-entry")].slice(0, 5).map((e) => e.textContent.trim()) }; });
    check(`the field opens ComfyUI's menu inside the dialog, on the model folders, quickly with ${BIG.length} LoRAs (${menuMs} ms; ${menu.top.join(" | ")})`,
        menu.inDlg && menu.top[0] === "None" && menu.top.some((t) => /controlnet/.test(t)) && menu.top.some((t) => /loras/.test(t)) && menuMs < 5000);
    await page.locator(".litecontextmenu .comfy-context-menu-filter").first().fill("@author"); await sleep(600);
    const found = await page.evaluate(() => [...document.querySelectorAll(".litecontextmenu .litemenu-entry")].filter((e) => e.offsetParent).map((e) => e.textContent.trim()));
    check(`the search finds 'sub\\@author' names (${found.slice(0, 2).join(" | ")})`, found.some((t) => t.includes("rgtest_sub\\@author\\x.safetensors")));
    await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelectorAll(".litecontextmenu").forEach((m) => m.remove())); await sleep(300);
    // Browse… on: Region Genie's pickers (the dialog follows the switch)
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.ModelFiles.Browse", true); });
    await page.keyboard.press("Escape"); await sleep(800);
    await page.keyboard.press("Control+,"); await sleep(1500);
    await page.evaluate(() => { const el = [...document.querySelectorAll('[role="dialog"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Region Genie"); el?.scrollIntoView(); el?.click(); });
    await sleep(2500);
    await openPage("edit");
    const all1 = await walk(); await toPage("edit");
    const pk = { n: all1.fields, buttons: all1.browse };
    check(`Browse… on: every model-file field has a Browse… button (${pk.n} fields, ${pk.buttons} buttons)`, pk.n >= 27 && pk.buttons === pk.n);
    // Browse…: a file outside ComfyUI's folders is saved by its full path
    const outDir = path.join(DIR, "..", "rgtest_outside", "@author");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "moss_edit_outside.safetensors");
    fs.writeFileSync(outFile, "");
    await page.evaluate(() => {
        const row = [...document.querySelectorAll('[role="dialog"] .rg-setwin label')].find((e) => e.textContent.trim() === "MOSS-Image: edit LoRA");
        let p = row; while (p && !p.querySelector?.(".rg-ff")) p = p.parentElement;
        p.querySelector(".rg-ff-browse").click();
    });
    await page.waitForSelector(".rg-fb", { state: "attached", timeout: 5000 });
    await sleep(600);
    const fbTop = await page.evaluate(() => { const b = document.querySelector(".rg-fb"), r = b.getBoundingClientRect(); return [[r.left + 8, r.top + 8], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]].every(([x, y]) => b.contains(document.elementFromPoint(x, y))); });
    check("Browse… opens its file browser over the settings window", fbTop);
    const startPath = await page.locator(".rg-fb-path input").inputValue();
    await page.locator(".rg-fb-path input").fill(outDir); await page.locator(".rg-fb-path input").press("Enter"); await sleep(700);
    const listed = await page.locator(".rg-fb-item", { hasText: "moss_edit_outside.safetensors" }).count();
    await page.locator(".rg-fb-item", { hasText: "moss_edit_outside.safetensors" }).click();
    await page.locator(".rg-fb button.primary").click(); await sleep(800);
    const saved = await page.evaluate(() => window.app.extensionManager.setting.get("RegionGenie.Edit.LoRA.MOSS"));
    const still = await page.evaluate(() => !!document.querySelector('[role="dialog"] .rg-ff') && !document.querySelector(".rg-fb")
        && [...document.querySelectorAll('[role="dialog"] .rg-ff-name')].some((x) => x.textContent === "moss_edit_outside.safetensors"));
    check("the Settings dialog and the window stay open after Browse…, the field shows the picked file", still && await page.locator(".rg-setwin").count() === 1);
    await closeWin();
    check(`Browse…: starts in ComfyUI's loras folder (${startPath})`, /models[\\/]loras$/.test(startPath));
    check(`Browse…: a file anywhere is listed, picked and saved by its full path (${listed}; ${saved})`, listed === 1 && saved === path.resolve(outFile));
    const exists = await page.evaluate(async (n) => (await (await fetch(`/region_genie/model_exists?folders=loras&name=${encodeURIComponent(n)}`)).json()).found, saved);
    check("the server finds the full path", exists === true);
    // round 24: Model files > Check model files lists the files that are set but can't be found
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Edit.LoRA.Flux1", "rgtest_missing_file.safetensors"); });
    const chk = page.locator('[role="dialog"] .rg-chk');
    await chk.locator("button").scrollIntoViewIfNeeded(); await chk.locator("button").click();
    await page.waitForFunction(() => { const o = document.querySelector('[role="dialog"] .rg-chk-out'); return o && o.textContent && o.textContent !== "Checking…"; }, null, { timeout: 15000 });
    const chkText = await chk.locator(".rg-chk-out").innerText();
    check(`Check model files: the missing edit LoRA is listed, the files that exist aren't (${chkText.replace(/\n/g, " | ").slice(0, 200)})`,
        /not found:/.test(chkText) && /Edit Mode > Flux\.1: edit LoRA: rgtest_missing_file\.safetensors/.test(chkText) && !/Krea 2/.test(chkText) && !/MOSS-Image: edit LoRA/.test(chkText));
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Edit.LoRA.Flux1", "(none)"); });
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Edit.LoRA.MOSS", "(none)"); });
    fs.rmSync(path.join(DIR, "..", "rgtest_outside"), { recursive: true, force: true });
    // Shortcuts (round 39): one row with a button; its list opens over the dialog and takes a new key there
    await page.evaluate(async () => { const s = window.app.extensionManager.setting; await s.set("RegionGenie.Shortcuts", "{}"); });
    const keysBtn = page.locator('[role="dialog"] .rg-keys-set button');
    await keysBtn.scrollIntoViewIfNeeded(); await sleep(200);
    check("Shortcuts: one row with an Edit… button (no row per key)", await keysBtn.count() === 1 && (await page.locator('[role="dialog"] .rg-keys-set span').textContent()) === "All default"
        && await page.evaluate(() => !/Large editor: key|key for the previous text field/.test(document.querySelector('[role="dialog"]').innerText)));
    await keysBtn.click(); await sleep(400);
    const onTop = await page.evaluate(() => { const b = document.querySelector(".rg-keys"); if (!b) return "not there"; const r = b.getBoundingClientRect();
        const pts = [[r.left + 10, r.top + 10], [(r.left + r.right) / 2, (r.top + r.bottom) / 2], [r.right - 10, r.bottom - 10]];
        return pts.every(([x, y]) => b.contains(document.elementFromPoint(x, y))) && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight ? true : "covered or outside the window"; });
    check(`Edit… opens the shortcut list over the Settings dialog, in the window (${onTop})`, onTop === true);
    await page.locator('.rg-keys-row[data-cmd="tool.fill"] .rg-key').first().click(); await sleep(150);
    await page.keyboard.press("Control+Shift+k"); await sleep(300);
    const set1 = await page.evaluate(() => ({ chip: document.querySelector('.rg-keys-row[data-cmd="tool.fill"] .rg-key').textContent, saved: window.app.extensionManager.setting.get("RegionGenie.Shortcuts"),
        info: document.querySelector('[role="dialog"] .rg-keys-set span')?.textContent, dlg: !!document.querySelector('[role="dialog"] .rg-keys-set') }));
    check(`click Fill's key, press Ctrl+Shift+K: taken, saved, and the row says so (${JSON.stringify(set1)})`, set1.chip === "Ctrl+Shift+K" && set1.saved === '{"tool.fill":["Ctrl+Shift+K"]}' && set1.info === "1 changed" && set1.dlg);
    await page.locator('.rg-keys-row[data-cmd="tool.fill"] .rg-key').first().click(); await sleep(150);
    await page.keyboard.press("Escape"); await sleep(250);
    check("Esc while it waits for a key: nothing changes, the list and the Settings dialog stay", await page.locator(".rg-keys").count() === 1 && await page.locator('[role="dialog"] .rg-keys-set').count() === 1
        && (await page.locator('.rg-keys-row[data-cmd="tool.fill"] .rg-key').first().textContent()) === "Ctrl+Shift+K");
    await page.locator(".rg-keys-head button", { hasText: "Reset all" }).click(); await sleep(300);
    await page.keyboard.press("Escape"); await sleep(300);
    check("Reset all, then Esc: the list closes, the Settings dialog stays open, nothing is saved", await page.locator(".rg-keys").count() === 0 && await page.locator('[role="dialog"] .rg-keys-set').count() === 1
        && await page.evaluate(() => window.app.extensionManager.setting.get("RegionGenie.Shortcuts")) === "{}");
    // ---------------------------------------------------------------- round 50: the Region Genie settings window
    const get = (id) => page.evaluate((id) => window.app.extensionManager.setting.get(id), id);
    const rowOf = (name) => page.locator(".rg-setwin-row").filter({ has: page.locator("label", { hasText: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }) });
    const onTopOf = (sel) => page.evaluate((sel) => { const b = document.querySelector(sel); if (!b) return "not there"; const r = b.getBoundingClientRect();
        const pts = [[r.left + 6, r.top + 6], [(r.left + r.right) / 2, (r.top + r.bottom) / 2], [r.right - 6, r.bottom - 6]];
        return pts.every(([x, y]) => b.contains(document.elementFromPoint(x, y))) ? true : "covered"; }, sel);
    const SAVE = ["RegionGenie.Tools.Hints", "RegionGenie.Tools.Lasso", "RegionGenie.Tools.WandTolerance", "RegionGenie.Main.RegionSeparation", "RegionGenie.Size.Presets", "RegionGenie.Control.Flux1Depth", "RegionGenie.Main.RegionColors"];
    const before = {}; for (const id of SAVE) before[id] = await get(id);
    // ComfyUI's own search finds a topic row by the name of a setting on its page
    const search = page.locator('[role="dialog"] input[placeholder*="Search"]').first();
    const found2 = {};
    for (const q of ["WebP quality", "canny ControlNet", "Magic wand", "Manual: width"]) { await search.fill(q); await sleep(900);
        found2[q] = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] .rg-page-row')].filter((e) => e.getClientRects().length).map((e) => e.dataset.page)); }
    await search.fill(""); await sleep(600);
    check(`ComfyUI's Search Settings finds the page of a setting that moved (${JSON.stringify(found2)})`, found2["WebP quality"].join() === "save" && found2["canny ControlNet"].join() === "control"
        && found2["Magic wand"].join() === "tools" && found2["Manual: width"].join() === "size");
    await page.evaluate(() => { const el = [...document.querySelectorAll('[role="dialog"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Region Genie"); el?.scrollIntoView(); el?.click(); });
    await sleep(1200);
    // every topic row opens the window on its own page
    const opened = [];
    for (const k of PAGES) { await openPage(k); opened.push(await page.evaluate(() => document.querySelector(".rg-setwin-nav button.on")?.dataset.page + ":" + document.querySelectorAll(".rg-setwin-row").length)); await closeWin(); }
    check(`each of the ${PAGES.length} topic rows opens the window on its page, with rows on it (${opened.join(" ")})`, opened.every((o, i) => o.split(":")[0] === PAGES[i] && +o.split(":")[1] > 0));
    await openPage("tools");
    const geo = await page.evaluate(() => { const w = document.querySelector(".rg-setwin"), d = w.closest('[role="dialog"]'), a = w.getBoundingClientRect(), b = d.getBoundingClientRect();
        return { inDlg: !!d, covers: Math.abs(a.left - b.left) < 3 && Math.abs(a.top - b.top) < 3 && Math.abs(a.right - b.right) < 3 && Math.abs(a.bottom - b.bottom) < 3,
            scrollX: document.querySelector(".rg-setwin-page").scrollWidth <= document.querySelector(".rg-setwin-page").clientWidth + 1 }; });
    check(`the window lives inside the Settings dialog and covers it; nothing of the dialog shows through (${JSON.stringify(geo)}, ${await onTopOf(".rg-setwin")})`, geo.inDlg && geo.covers && geo.scrollX && await onTopOf(".rg-setwin") === true);
    // a switch
    const sw = rowOf("Hints on the canvas").locator(".rg-setwin-sw");
    const h0 = await get("RegionGenie.Tools.Hints"); await sw.click(); await sleep(250);
    check("a switch: one click changes the setting and the switch", await get("RegionGenie.Tools.Hints") === !h0 && await sw.evaluate((b, on) => b.classList.contains("on") === on, !h0));
    check("…the page's entry on the left counts it", (await page.locator('.rg-setwin-nav button[data-page="tools"] span').textContent()) === "1");
    // a dropdown
    await rowOf("Lasso: default").locator("select").selectOption("spline"); await sleep(250);
    check("a dropdown: the choice is saved by its value", await get("RegionGenie.Tools.Lasso") === "spline");
    // a number: typed (the Settings dialog doesn't take the keyboard away from the window), clamped
    const num = rowOf("Magic wand: tolerance").locator('input[type="number"]');
    await num.click(); await num.fill("48"); await num.press("Tab"); await sleep(250);
    const typed = await get("RegionGenie.Tools.WandTolerance");
    await num.fill("99999"); await num.press("Tab"); await sleep(250);
    check(`a number: typing works inside the window and is saved; out of range goes to the limit (${typed}, ${await get("RegionGenie.Tools.WandTolerance")})`, typed === 48 && await get("RegionGenie.Tools.WandTolerance") <= 255);
    // Manual: step size: its arrows go to the multiples of 8, and no lower than 1
    await toPage("size");
    const stp = rowOf("Manual: step size").locator('input[type="number"]');
    const seq = [];
    await stp.fill("10"); for (const k of ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"]) { await stp.press(k); seq.push(await stp.inputValue()); }
    await stp.press("Tab"); await sleep(250);
    check(`Manual: step size: 10 down → 8 → 1 → 1, up → 8 → 16, saved (${seq}; ${await get("RegionGenie.Main.StepSize")})`, seq.join() === "8,1,1,8,16" && await get("RegionGenie.Main.StepSize") === 16);
    await stp.fill("64"); await stp.press("Tab"); await sleep(250);
    // a slider with its number
    await toPage("node");
    const sl = rowOf("separation");
    await sl.locator('input[type="number"]').fill("0.6"); await sl.locator('input[type="number"]').press("Tab"); await sleep(250);
    check("a slider: its number field sets it, and the slider follows", await get("RegionGenie.Main.RegionSeparation") === 0.6 && await sl.locator('input[type="range"]').inputValue() === "0.6");
    // the pack's own rows: the region colors (its color picker over the window)
    const colors = rowOf("Region colors");
    check("the region colors are drawn as in the old tab (swatches, +, Defaults)", await colors.locator(".rg-colors .sw").count() >= 6);
    await colors.locator(".rg-colors .sw").first().click(); await sleep(400);
    check(`a click on a region color opens the color picker over the window (${await onTopOf(".rg-cp")})`, await page.locator(".rg-cp").count() === 1 && await onTopOf(".rg-cp") === true);
    // it takes the pointer there (ComfyUI's dialog switches the pointer off for the rest of the page): drag in the color square
    const sv = await page.locator(".rg-cp .rg-cp-sv").boundingBox(), c0 = await colors.locator(".rg-colors .sw").first().evaluate((b) => b.style.background);
    await page.mouse.move(sv.x + 20, sv.y + 20); await page.mouse.down(); await page.mouse.move(sv.x + sv.width * 0.5, sv.y + sv.height * 0.6, { steps: 3 }); await page.mouse.up(); await sleep(250);
    check("…and can be used: dragging in its color square changes the swatch", await colors.locator(".rg-colors .sw").first().evaluate((b) => b.style.background) !== c0);
    await page.keyboard.press("Escape"); await sleep(300);
    check("Esc closes only the color picker; the window stays on its page", await page.locator(".rg-cp").count() === 0 && await page.locator('.rg-setwin-nav button.on[data-page="node"]').count() === 1);
    // a text
    await toPage("size");
    const txt = rowOf("Presets").locator('input[type="text"]');
    const pre0 = await txt.inputValue(); await txt.fill(pre0 + ", 640x640"); await txt.press("Tab"); await sleep(250);
    check("a text field is saved", String(await get("RegionGenie.Size.Presets")).endsWith("640x640"));
    // a model-file field: ComfyUI's menu opens over the window, inside the dialog; picking saves
    await toPage("control");
    const ff = rowOf("Flux.1: depth LoRA (e.g. flux1-depth-dev-lora)").locator(".rg-ff-name");
    await ff.click(); await page.waitForSelector(".litecontextmenu", { timeout: 10000 }); await sleep(300);
    const mn = await page.evaluate(() => { const m = document.querySelector(".litecontextmenu"), r = m.getBoundingClientRect(); const e = document.elementFromPoint(r.left + 20, r.top + 20);
        return { inDlg: !!m.closest('[role="dialog"]'), top: m.contains(e), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; });
    check(`a model-file field: ComfyUI's menu opens over the window, inside the dialog, in view (${JSON.stringify(mn)})`, mn.inDlg && mn.top && mn.inView);
    await page.locator(".litecontextmenu .comfy-context-menu-filter").first().fill("flux1-depth"); await sleep(700);
    check("…typing in the menu's filter works there too", await page.evaluate(() => [...document.querySelectorAll(".litecontextmenu .litemenu-entry")].filter((e) => e.offsetParent).some((e) => /flux1-depth-dev-lora/.test(e.textContent))));
    await page.keyboard.press("Escape"); await sleep(300);
    check("Esc with the menu open closes only the menu: the window stays", await page.locator(".litecontextmenu").count() === 0 && await page.locator(".rg-setwin").count() === 1);
    await ff.click(); await page.waitForSelector(".litecontextmenu", { timeout: 10000 });
    await page.locator(".litecontextmenu .comfy-context-menu-filter").first().fill("flux1-depth"); await sleep(700);
    await page.locator(".litecontextmenu .litemenu-entry", { hasText: "flux1-depth-dev-lora" }).first().click(); await sleep(500);
    check(`…picking a file saves it and the field shows it (${await get("RegionGenie.Control.Flux1Depth")})`, /flux1-depth-dev-lora/.test(String(await get("RegionGenie.Control.Flux1Depth"))) && /flux1-depth-dev-lora/.test(await ff.textContent()));
    // the LLM rows are the pack's own rows too
    await toPage("llm");
    check("the LLM page: the preset rows are drawn (a preset to edit, its fields), not placeholders", await page.locator(".rg-setwin-row select, .rg-setwin-row input").count() >= 10
        && !(await page.evaluate(() => [...document.querySelectorAll(".rg-setwin-ctl")].some((c) => c.textContent.trim() === "…"))));
    // the pack's tooltip, over the window; the browser's own never next to it
    await toPage("save");
    await page.evaluate(() => { window.__rgTakeTitles = true; });         // as for a person: the title is put aside while the pointer is on it
    const lab = rowOf("WebP quality").locator("label"); await lab.hover(); await sleep(900);
    const tip = await page.evaluate(() => { const t = document.querySelector(".rg-tip.on"); if (!t) return null; const r = t.getBoundingClientRect(); t.style.pointerEvents = "auto"; const top = t.contains(document.elementFromPoint(r.left + 8, r.top + 8)); t.style.pointerEvents = ""; return { text: t.innerText.slice(0, 40), top }; });
    check(`pointing at a setting's name shows the pack's tooltip, over the window (${JSON.stringify(tip)})`, !!tip && tip.text.length > 5 && tip.top
        && await lab.evaluate((l) => l.getAttribute("title") === ""));
    await page.mouse.move(5, 5); await sleep(200);
    await page.evaluate(() => { window.__rgTakeTitles = false; });
    // the window's own search, across pages
    const ws = page.locator(".rg-setwin-head input");
    await ws.fill("quality"); await sleep(300);
    const sr = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".rg-setwin-row label")].map((l) => l.textContent), grp: [...document.querySelectorAll(".rg-setwin-grp")].map((g) => g.textContent) }));
    check(`the window's search lists matching settings of every page, under their page's name (${sr.rows.join(" | ")})`, sr.rows.length >= 3 && sr.rows.every((t) => /quality/i.test(t)) && sr.grp.includes("Save Image"));
    await page.keyboard.press("Escape"); await sleep(200);
    check("Esc with a search typed clears the search; the window stays", await ws.inputValue() === "" && await page.locator(".rg-setwin").count() === 1);
    // Defaults for this page: asks first
    await toPage("tools");
    const def = page.locator(".rg-setwin-foot button");
    await def.click(); await sleep(150);
    const asked = await def.textContent(), unchanged = await get("RegionGenie.Tools.Lasso");
    await def.click(); await sleep(500);
    check(`Defaults for this page: the first click asks ("${asked}"), the second resets the page`, /again/i.test(asked) && unchanged === "spline" && await get("RegionGenie.Tools.Lasso") === "plain"
        && await get("RegionGenie.Tools.WandTolerance") === 32 && await get("RegionGenie.Tools.Hints") === true && (await page.locator('.rg-setwin-nav button[data-page="tools"] span').textContent()) === "");
    // Esc closes the window, not ComfyUI's dialog; the tab's row shows what changed
    await page.keyboard.press("Escape"); await sleep(300);
    check("Esc closes the window; ComfyUI's Settings stay open behind it", await page.locator(".rg-setwin").count() === 0 && await page.locator('[role="dialog"] .rg-page-row').count() === PAGES.length);
    check(`a topic row says how many of its settings were changed (${await page.locator('.rg-page-row[data-page="control"] span').textContent()})`, (await page.locator('.rg-page-row[data-page="control"] span').textContent()) === "1 changed"
        && (await page.locator('.rg-page-row[data-page="tools"] span').textContent()) === "");
    check("no script errors from the window", !errors.some((e) => /rg_settings_window|settings row/.test(e)));
    for (const id of SAVE) await page.evaluate(async ([id, v]) => { await window.app.extensionManager.setting.set(id, v); }, [id, before[id]]);
    await page.keyboard.press("Escape");
    await page.evaluate(async () => { const s = window.app.extensionManager.setting; await s.set("RegionGenie.Edit.LoRA.Krea2", "(none)");
        await s.set("RegionGenie.ModelFiles.Browse", false); });
    await browser.close();
    for (const f of made) try { fs.unlinkSync(f); } catch (e) { /* gone */ }
    console.log(fails.length ? `${fails.length} failed` : "all passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { for (const f of made) try { fs.unlinkSync(f); } catch (x) { /* gone */ } console.error(e); process.exit(1); });
