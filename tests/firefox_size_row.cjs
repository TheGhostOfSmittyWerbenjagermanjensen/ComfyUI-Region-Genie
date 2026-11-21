// Firefox check (real mouse clicks; real ComfyUI): the small arrows of the size row's number fields.
// Firefox doesn't move the focus into a number field when its arrows are clicked, so the editor's half-second refresh
// could write the old value back between press and release (round 53: fast clicks "snapped back").
// Usage: node firefox_size_row.cjs [vue]     ("vue" = Nodes 2.0). Needs ComfyUI on 127.0.0.1:8188 with this pack and
// Firefox from tests/setup_firefox.sh (RG_FIREFOX_DIR, default /opt/rg-firefox). Not part of the usual runs: Chromium
// is the default browser of the tests; run this (and write more like it) when a bug is reported in Firefox.
const path = require("path");
const DIR = process.env.RG_FIREFOX_DIR || "/opt/rg-firefox";
const { Builder, By } = require(path.join(DIR, "node_modules", "selenium-webdriver"));
const firefox = require(path.join(DIR, "node_modules", "selenium-webdriver", "firefox"));
const vue = process.argv[2] === "vue";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const HOLD = +(process.env.RG_HOLD || 110), GAP = +(process.env.RG_GAP || 30);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const opts = new firefox.Options().setBinary(path.join(DIR, "firefox", "firefox")).addArguments("-headless").windowSize({ width: 1600, height: 1100 });
    const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(opts).setFirefoxService(new firefox.ServiceBuilder(path.join(DIR, "geckodriver"))).build();
    try {
        await driver.manage().setTimeouts({ script: 60000 });
        await driver.get("http://127.0.0.1:8188/");
        for (let i = 0; i < 90 && !(await driver.executeScript("return !!(window.app && window.app.graph && window.app.extensionManager && window.app.extensionManager.setting)")); i++) await sleep(1000);
        await sleep(2000);
        await driver.executeAsyncScript(`const done = arguments[arguments.length - 1], vue = arguments[0]; (async () => {
            const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) {}
            await s.set("Comfy.VueNodes.Enabled", vue); await new Promise((r) => setTimeout(r, 1000));
            const app = window.app; app.graph.clear(); const rg = LiteGraph.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); window.__rg = rg;
            app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true); await new Promise((r) => setTimeout(r, 1500));
            [...document.querySelector(".rg-size").querySelectorAll("button")].find((b) => /^Manual: /.test(b.title)).click(); await new Promise((r) => setTimeout(r, 300));
            window.__f = (i) => document.querySelectorAll(".rg-size .rg-size-part")[2].querySelectorAll("input")[i];
            done(); })();`, vue);
        for (let i = 0; i < 3; i++) { await driver.actions().sendKeys("").perform().catch(() => {}); await sleep(200); }
        const M = vue ? "Nodes 2.0" : "legacy";
        const val = (i) => driver.executeScript("return window.__f(arguments[0]).value", i);
        const click = async (x, y, hold) => { await driver.actions({ async: true }).move({ x: Math.round(x), y: Math.round(y) }).press().pause(hold).release().perform(); };
        let focusSeen = null;
        for (const [name, idx] of [["width", 0], ["the step box", 2]]) {
            await driver.executeScript("const s = window.__f(2); s.value = '8'; s.dispatchEvent(new Event('change')); const w = window.__f(0); w.value = '1024'; w.dispatchEvent(new Event('change')); document.activeElement && document.activeElement.blur();");
            await sleep(300);
            const b = await driver.executeScript("const r = window.__f(arguments[0]).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]", idx);
            const yUp = b[1] + b[3] * 0.3, yDn = b[1] + b[3] * 0.7; let x = 0;
            for (let dx = 3; dx < 24 && !x; dx += 3) { const before = await val(idx); await click(b[0] + b[2] - dx, yUp, 30); await sleep(250); if (await val(idx) !== before) x = b[0] + b[2] - dx; }
            if (!x) { check(`${M}: ${name}: its up arrow was found`, false); continue; }
            if (focusSeen == null) focusSeen = await driver.executeScript("return document.activeElement === window.__f(arguments[0])", idx);
            // 40 clicks, each held for a moment (as a hand does), up with a down now and then: every one must count
            let lost = 0; const seen = [];
            for (let k = 0; k < 40; k++) {
                const up = k % 5 !== 4, before = +(await val(idx));
                await click(x, up ? yUp : yDn, HOLD); await sleep(GAP);
                const after = +(await val(idx));
                if (after === before) { lost++; if (seen.length < 4) seen.push(before); }
            }
            await sleep(700);
            const end = +(await val(idx)), saved = await driver.executeScript("const m = window.__rg.properties.rg_size.manual; return arguments[0] === 0 ? m.w : m.step", idx);
            check(`${M}: ${name}: 40 clicks on its arrows all count (lost ${lost}${seen.length ? " at " + seen.join(", ") : ""}), and the node has the value shown (${end} / ${saved})`, lost === 0 && end === saved);
        }
        console.log(`note: Firefox ${focusSeen ? "moved" : "did not move"} the focus into the field on an arrow click`);
    } finally { await driver.quit(); }
    console.log(fails.length ? fails.length + " failed" : "all passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
