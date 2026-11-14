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
for (const sub of ["loras", "controlnet"]) {
    const d = path.join(DIR, "models", sub);
    fs.mkdirSync(d, { recursive: true });
    for (const n of ODD) { const f = path.join(d, n); if (!fs.existsSync(f)) { fs.writeFileSync(f, ""); made.push(f); } }
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
    check(`the odd file names are listed by ComfyUI (${lists.length})`, lists.length === ODD.length);
    // a set value with odd characters must show too
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Edit.LoRA.Krea2", "rgtest_char@v2.safetensors"); });
    errors.length = 0;
    await page.keyboard.press("Control+,"); await sleep(1500);
    await page.evaluate(() => { const el = [...document.querySelectorAll('[role="dialog"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Region Genie"); el?.scrollIntoView(); el?.click(); });
    await sleep(2500);
    const r = await page.evaluate(() => {
        const txt = document.querySelector('[role="dialog"]')?.innerText || "";
        const all = Object.values(window.app.ui.settings.settingsParamLookup).filter((d) => /^RegionGenie/.test(d.id) && d.type !== "hidden");
        return { missing: all.filter((d) => !txt.includes(d.name.trim())).map((d) => d.name), n: all.length };
    });
    check(`every Region Genie setting shows in the dialog (${r.n}; missing: ${r.missing.slice(0, 6).join(" | ")})`, r.n > 80 && !r.missing.length);
    const i18n = errors.filter((e) => /SyntaxError|i18n|compile/i.test(e));
    check(`no translation errors while it shows (${i18n.slice(0, 2).join(" | ")})`, !i18n.length);
    // round 18: every model-file setting is Region Genie's own picker (dropdown + Browse…); names show as they are
    const pk = await page.evaluate(() => {
        const pickers = [...document.querySelectorAll('[role="dialog"] .rg-file')];
        const sels = pickers.map((p) => p.querySelector("select"));
        const krea = sels.find((x) => x.value === "rgtest_char@v2.safetensors");
        const opts = sels[0] ? [...sels[0].options].map((o) => o.textContent) : [];
        return { n: pickers.length, krea: !!krea, backslash: sels.some((x) => [...x.options].some((o) => o.value === "rgtest_sub\\@author\\x.safetensors")),
                 buttons: pickers.filter((p) => p.querySelector("button svg")).length, first: opts.slice(0, 3).join(" | ") };
    });
    check(`every model-file setting is a picker with a Browse… button (${pk.n} pickers, ${pk.buttons} buttons)`, pk.n === 27 && pk.buttons === 27);
    check(`a set value with '@' shows as it is; a 'sub\\@author' name is listed (${pk.first})`, pk.krea && pk.backslash);
    // Browse…: a file outside ComfyUI's folders is saved by its full path
    const outDir = path.join(DIR, "..", "rgtest_outside", "@author");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "moss_edit_outside.safetensors");
    fs.writeFileSync(outFile, "");
    await page.evaluate(() => {
        const row = [...document.querySelectorAll('[role="dialog"] span')].find((e) => e.textContent.trim() === "MOSS-Image: edit LoRA");
        let p = row; while (p && !p.querySelector?.(".rg-file")) p = p.parentElement;
        p.querySelector(".rg-file button").click();
    });
    await page.waitForSelector(".rg-fb", { state: "attached", timeout: 5000 });
    await sleep(600);
    const startPath = await page.locator(".rg-fb-path input").inputValue();
    await page.locator(".rg-fb-path input").fill(outDir); await page.locator(".rg-fb-path input").press("Enter"); await sleep(700);
    const listed = await page.locator(".rg-fb-item", { hasText: "moss_edit_outside.safetensors" }).count();
    await page.locator(".rg-fb-item", { hasText: "moss_edit_outside.safetensors" }).click();
    await page.locator(".rg-fb button.primary").click(); await sleep(800);
    const saved = await page.evaluate(() => window.app.extensionManager.setting.get("RegionGenie.Edit.LoRA.MOSS"));
    const still = await page.evaluate(() => !!document.querySelector('[role="dialog"] .rg-file') && !document.querySelector(".rg-fb")
        && [...document.querySelectorAll('[role="dialog"] .rg-file select')].some((x) => x.value.endsWith("moss_edit_outside.safetensors")));
    check("the Settings dialog stays open after Browse…, its dropdown shows the picked file", still);
    check(`Browse…: starts in ComfyUI's loras folder (${startPath})`, /models[\\/]loras$/.test(startPath));
    check(`Browse…: a file anywhere is listed, picked and saved by its full path (${listed}; ${saved})`, listed === 1 && saved === path.resolve(outFile));
    const exists = await page.evaluate(async (n) => (await (await fetch(`/region_genie/model_exists?folders=loras&name=${encodeURIComponent(n)}`)).json()).found, saved);
    check("the server finds the full path", exists === true);
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Edit.LoRA.MOSS", "(none)"); });
    fs.rmSync(path.join(DIR, "..", "rgtest_outside"), { recursive: true, force: true });
    await page.keyboard.press("Escape");
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Edit.LoRA.Krea2", "(none)"); });
    await browser.close();
    for (const f of made) try { fs.unlinkSync(f); } catch (e) { /* gone */ }
    console.log(fails.length ? `${fails.length} failed` : "all passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { for (const f of made) try { fs.unlinkSync(f); } catch (x) { /* gone */ } console.error(e); process.exit(1); });
