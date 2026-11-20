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
    let shownMs = -1;
    for (let i = 0; i < 100; i++) {
        const n = await Promise.race([page.evaluate(() => document.querySelectorAll('[role="dialog"] .rg-ff').length), sleep(10000).then(() => -1)]);
        if (n > 0) { shownMs = Date.now() - t0; break; }
        await sleep(50);
    }
    const p0 = Date.now(); await page.evaluate(() => 1); const ping = Date.now() - p0;
    check(`with ${BIG.length + ODD.length} LoRAs the Region Genie tab opens fast and stays responsive (${shownMs} ms; then ${ping} ms)`, shownMs >= 0 && shownMs < 5000 && ping < 300);
    await sleep(1500);
    const r = await page.evaluate(() => {
        const txt = document.querySelector('[role="dialog"]')?.innerText || "";
        const all = Object.values(window.app.ui.settings.settingsParamLookup).filter((d) => /^RegionGenie/.test(d.id) && d.type !== "hidden");
        return { missing: all.filter((d) => !txt.includes(d.name.trim())).map((d) => d.name), n: all.length };
    });
    check(`every Region Genie setting shows in the dialog (${r.n}; missing: ${r.missing.slice(0, 6).join(" | ")})`, r.n > 80 && !r.missing.length);
    const i18n = errors.filter((e) => /SyntaxError|i18n|compile/i.test(e));
    check(`no translation errors while it shows (${i18n.slice(0, 2).join(" | ")})`, !i18n.length);
    // round 23: every model-file setting is a field that opens ComfyUI's classic menu (no Browse… by default)
    const off = await page.evaluate(() => {
        const f = [...document.querySelectorAll('[role="dialog"] .rg-ff')];
        return { n: f.length, browse: document.querySelectorAll('[role="dialog"] .rg-ff-browse').length,
                 selects: [...f].filter((x) => x.querySelector("select")).length };
    });
    check(`Browse… off (default): every model-file setting is a file field, no dropdown, no Browse buttons (${off.n} fields, ${off.browse} buttons)`,
        off.n >= 27 && off.browse === 0 && off.selects === 0);
    // the edit LoRA field: its value as it is; the menu opens inside the dialog on the model folders, and the search finds a
    // 'sub\@author' name in a subfolder
    const kreaName = await page.evaluate(() => {
        const sp = [...document.querySelectorAll('[role="dialog"] span')].find((e) => e.textContent.trim() === "Krea 2: edit LoRA");
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
    const pk = await page.evaluate(() => { const f = [...document.querySelectorAll('[role="dialog"] .rg-ff')];
        return { n: f.length, buttons: f.filter((p) => p.querySelector(".rg-ff-browse svg")).length }; });
    check(`Browse… on: every model-file field has a Browse… button (${pk.n} fields, ${pk.buttons} buttons)`, pk.n >= 27 && pk.buttons === pk.n);
    // Browse…: a file outside ComfyUI's folders is saved by its full path
    const outDir = path.join(DIR, "..", "rgtest_outside", "@author");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "moss_edit_outside.safetensors");
    fs.writeFileSync(outFile, "");
    await page.evaluate(() => {
        const row = [...document.querySelectorAll('[role="dialog"] span')].find((e) => e.textContent.trim() === "MOSS-Image: edit LoRA");
        let p = row; while (p && !p.querySelector?.(".rg-ff")) p = p.parentElement;
        p.querySelector(".rg-ff-browse").click();
    });
    await page.waitForSelector(".rg-fb", { state: "attached", timeout: 5000 });
    await sleep(600);
    const startPath = await page.locator(".rg-fb-path input").inputValue();
    await page.locator(".rg-fb-path input").fill(outDir); await page.locator(".rg-fb-path input").press("Enter"); await sleep(700);
    const listed = await page.locator(".rg-fb-item", { hasText: "moss_edit_outside.safetensors" }).count();
    await page.locator(".rg-fb-item", { hasText: "moss_edit_outside.safetensors" }).click();
    await page.locator(".rg-fb button.primary").click(); await sleep(800);
    const saved = await page.evaluate(() => window.app.extensionManager.setting.get("RegionGenie.Edit.LoRA.MOSS"));
    const still = await page.evaluate(() => !!document.querySelector('[role="dialog"] .rg-ff') && !document.querySelector(".rg-fb")
        && [...document.querySelectorAll('[role="dialog"] .rg-ff-name')].some((x) => x.textContent === "moss_edit_outside.safetensors"));
    check("the Settings dialog stays open after Browse…, its field shows the picked file", still);
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
    await page.keyboard.press("Escape");
    await page.evaluate(async () => { const s = window.app.extensionManager.setting; await s.set("RegionGenie.Edit.LoRA.Krea2", "(none)");
        await s.set("RegionGenie.ModelFiles.Browse", false); });
    await browser.close();
    for (const f of made) try { fs.unlinkSync(f); } catch (e) { /* gone */ }
    console.log(fails.length ? `${fails.length} failed` : "all passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { for (const f of made) try { fs.unlinkSync(f); } catch (x) { /* gone */ } console.error(e); process.exit(1); });
