// Round 93: the search through every folder of a menu that rgthree-comfy sorts into folders ("Auto Nest
// Subdirectories in Menus"), for any node's list of files and for the pack's own LoRA list.
// - A Load LoRA node's list (legacy nodes; Nodes 2.0 draws its own dropdowns, which are not nested): the menu is
//   nested; typing in its filter box lists files of every folder, each with its folder; a click sets the widget.
// - With the Setting off, the filter box is ComfyUI's and rgthree's own again.
// - The Region Genie node's ＋LoRA list: the same search; a pick adds the LoRA.
//   node tests/real_menu_search.cjs [vue]
// Needs a running ComfyUI with this pack and rgthree-comfy (auto nest on), and LoRA files in sub-folders
// (tests/setup_real_comfy.sh makes them).
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const path = require("path");
const fails = [];
const check = (name, ok, note) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) { fails.push(name); if (note) console.log("     " + note); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vue = process.argv[2] === "vue", M = vue ? "Nodes 2.0" : "legacy";
const SET = "RegionGenie.ModelFiles.SearchAllFolders";

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1700, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(200); }
    await page.evaluate(async ([vue, SET]) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) { /* older */ }
        await s.set("Comfy.VueNodes.Enabled", vue); await s.set("Comfy.Locale", "en"); await s.set(SET, true); }, [vue, SET]);
    await sleep(vue ? 4000 : 800);
    const info = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const ll = LG.createNode("LoraLoader"); ll.pos = [60, 120]; app.graph.add(ll);
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [520, 70]; app.graph.add(rg);
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 2500));
        window.__ll = ll; window.__rg = rg;
        const w = ll.widgets.find((x) => x.name === "lora_name");
        const all = w.options.values;
        const deep = all.filter((v) => /[\\/].*[\\/]/.test(v)), one = all.filter((v) => /[\\/]/.test(v));
        return { n: all.length, deep, one };
    });
    const target = info.deep[0] || info.one[0];
    check(`${M}: the test ComfyUI has LoRA files in sub-folders (${info.n} files; using ${target})`, !!target);
    if (!target) { await browser.close(); process.exit(1); }
    const k = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\")), dir = target.slice(0, k), file = target.slice(k + 1), word = file.replace(/\.safetensors$/, "");
    const filt = () => page.locator(".litecontextmenu .comfy-context-menu-filter").first();
    const hits = () => page.evaluate(() => [...document.querySelectorAll(".litecontextmenu .rg-ff-hit")].filter((e) => e.offsetParent).map((e) => ({ name: e.querySelector(".rg-ff-n")?.textContent, dir: e.querySelector(".rg-ff-d")?.textContent || "", w: e.scrollWidth - e.clientWidth })));
    const closeMenus = async () => { await page.evaluate(() => { try { window.LiteGraph.closeAllContextMenus(window); } catch (e) { /* older */ } document.querySelectorAll(".litecontextmenu").forEach((m) => m.remove()); }); await sleep(200); };

    if (!vue) {
        const openCombo = async () => {
            const p = await page.evaluate(() => { const n = window.__ll, w = n.widgets.find((x) => x.name === "lora_name"), c = window.app.canvas, r = c.canvas.getBoundingClientRect(), ds = c.ds;
                return [r.left + (n.pos[0] + n.size[0] / 2 + ds.offset[0]) * ds.scale, r.top + (n.pos[1] + w.last_y + 10 + ds.offset[1]) * ds.scale]; });
            await page.mouse.click(p[0], p[1]); await sleep(700);
        };
        await openCombo();
        const nested = await page.evaluate(() => [...document.querySelectorAll(".litecontextmenu .litemenu-entry")].filter((e) => e.textContent.trim().startsWith("📁")).length);
        check(`a Load LoRA node's list is sorted into folders by rgthree (${nested} folders)`, nested > 0);
        await filt().fill(word); await sleep(500);
        let h = await hits();
        const mine = h.find((x) => x.name === file);
        check(`typing '${word}' in the filter box finds the file two folders down (${h.length} hit${h.length === 1 ? "" : "s"})`, !!mine, JSON.stringify(h.slice(0, 4)));
        check(`the hit shows its folder (${mine?.dir})`, !!mine && dir.split(/[\\/]/).every((part) => mine.dir.includes(part)));
        check("no hit is wider than the menu (nothing to scroll sideways)", h.every((x) => x.w <= 1) && await page.evaluate(() => { const m = document.querySelector(".litecontextmenu"); return m.scrollWidth - m.clientWidth <= 1 && m.getBoundingClientRect().right <= window.innerWidth; }));
        await page.screenshot({ path: path.join(__dirname, "out", "real_menu_search.png"), clip: { x: 0, y: 60, width: 760, height: 520 } });
        // a word of the folder's name finds its files too, after the files that have the word in their own name
        await filt().fill(dir.split(/[\\/]/).pop().toLowerCase()); await sleep(500);
        h = await hits();
        check(`a folder's name finds the files in it (${h.length})`, h.some((x) => x.name === file));
        await filt().fill(word); await sleep(400);
        await page.locator(".litecontextmenu .rg-ff-hit", { hasText: file }).first().click(); await sleep(500);
        check("a click on the hit sets the node's value to that file, with its folders", await page.evaluate(() => window.__ll.widgets.find((x) => x.name === "lora_name").value) === target);
        check("and the menu is closed", await page.locator(".litecontextmenu").count() === 0);
        // the keys: arrows and Enter
        await openCombo(); await filt().fill(word); await sleep(500);
        await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowUp"); await page.keyboard.press("Enter"); await sleep(500);
        check("Enter picks the marked hit", await page.locator(".litecontextmenu").count() === 0 && (await page.evaluate(() => window.__ll.widgets.find((x) => x.name === "lora_name").value)).endsWith(".safetensors"));
        // the Setting off: the filter box is ComfyUI's own again
        await page.evaluate(async (SET) => window.app.extensionManager.setting.set(SET, false), SET); await sleep(300);
        await openCombo(); await filt().fill(word); await sleep(500);
        check("with the Setting off, the filter box searches the open folder only (no hits from other folders)", (await hits()).length === 0);
        await closeMenus();
        await page.evaluate(async (SET) => window.app.extensionManager.setting.set(SET, true), SET); await sleep(300);
    }
    // the Region Genie node's own LoRA list
    await page.evaluate(() => { const b = [...document.querySelectorAll(".rg-row .rg-btn, .rg-row button")].find((x) => x.offsetParent && x.textContent.trim() === "＋LoRA"); b?.click(); }); await sleep(900);
    if (await page.locator(".litecontextmenu").count() === 0) {            // the button opened the Whole image pop-up's LoRAs tab: its ＋LoRA opens the list
        await page.evaluate(() => { const b = [...document.querySelectorAll(".rg-pop button")].find((x) => x.offsetParent && x.textContent.trim() === "＋LoRA"); b?.click(); }); await sleep(900);
    }
    check(`${M}: the node's ＋LoRA opens ComfyUI's list`, await page.locator(".litecontextmenu").count() > 0);
    await filt().fill(word); await sleep(500);
    const h2 = await hits();
    check(`${M}: the same search in the node's LoRA list (${h2.length} hit${h2.length === 1 ? "" : "s"}), each with its folder`, h2.some((x) => x.name === file && x.dir.length > 2), JSON.stringify(h2.slice(0, 3)));
    await page.locator(".litecontextmenu .rg-ff-hit", { hasText: file }).first().click().catch(() => {}); await sleep(700);
    const got = await page.evaluate(() => { const s = window.__rg.__rgState(); return [...(s.sceneLoras || []), ...s.regions.flatMap((r) => r.loras || [])].map((x) => x.lora); });
    check(`${M}: a click on the hit adds that LoRA to the node (${got.join(", ")})`, got.includes(target));
    await closeMenus();
    check(`${M}: no page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
