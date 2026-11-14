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
const ODD = ["rgtest_char@v2.safetensors", "rgtest_mix {style}.safetensors", "rgtest_a|b.safetensors", "rgtest_100% detail.safetensors", "rgtest_$x.safetensors"];
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
    check(`the odd file names are listed by ComfyUI (${lists.length})`, lists.length === 5);
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
    // the dropdown shows the odd names as they are
    const opts = await page.evaluate(async () => {
        // the line after the setting's name in the dialog's text is its current value
        const lines = (document.querySelector('[role="dialog"]')?.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean);
        const i = lines.findIndex((l) => /^Krea 2: edit LoRA/.test(l));
        return i < 0 ? "" : lines.slice(i, i + 2).join(" → ");
    });
    check(`a set value with '@' shows as it is (${opts.replace(/\n/g, " ").slice(0, 80)})`, /rgtest_char@v2\.safetensors/.test(opts));
    await page.keyboard.press("Escape");
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Edit.LoRA.Krea2", "(none)"); });
    await browser.close();
    for (const f of made) try { fs.unlinkSync(f); } catch (e) { /* gone */ }
    console.log(fails.length ? `${fails.length} failed` : "all passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { for (const f of made) try { fs.unlinkSync(f); } catch (x) { /* gone */ } console.error(e); process.exit(1); });
