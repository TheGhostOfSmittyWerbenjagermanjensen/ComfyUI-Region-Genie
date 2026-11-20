// ComfyUI loads every .js file of the pack's js/ folder (also the ones in sub-folders) as a script of its own, in no
// fixed order. So the pack must start whichever of its files is loaded first: two files that import each other break
// that (round 39: rg_shared.js <-> rg_keys.js left the pack without its Settings and its nodes without their editors
// whenever rg_keys.js came first). This loads the stub page once per file, with that file first.
const fs = require("fs");
const path = require("path");
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { if (!ok) { console.log("FAIL " + name); fails.push(name); } };

const ROOT = path.join(__dirname, "..", "js");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith(".js") ? [path.relative(ROOT, path.join(dir, d.name)).split(path.sep).join("/")] : []));

(async () => {
    const files = walk(ROOT).sort();
    const browser = await chromium.launch();
    let ok = 0;
    for (const f of files) {
        const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
        await page.goto("http://127.0.0.1:8765/index.html?first=" + encodeURIComponent(f));
        const ready = await page.waitForFunction(() => window.__ready === true, null, { timeout: 8000 }).then(() => true, () => false);
        const st = ready ? await page.evaluate(() => ({ settings: window.__settingsExt?.settings?.length || 0, editor: !!document.querySelector(".rg-wrap .rg-bar"), state: !!window.__node?.__rgState })) : null;
        const good = ready && !errors.length && st.settings > 80 && st.editor && st.state;
        check(`${f} loaded first: the pack starts (${ready ? JSON.stringify(st) : "the page never got ready"}${errors.length ? "; " + errors.slice(0, 2).join(" | ") : ""})`, good);
        if (good) ok++;
        await page.close();
    }
    console.log(`${ok} of ${files.length} files: the pack starts when that file is loaded first`);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
