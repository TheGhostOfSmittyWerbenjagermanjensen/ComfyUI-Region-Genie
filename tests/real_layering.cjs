// Pop-up lists and pop-ups are where they belong and on top, for EVERY text field of the pack, in the real ComfyUI.
//
// Why: a list that opens under something (or not at all, or far from the text) looks like a feature that is broken,
// and it has happened more than once (round 26: the tag list under a pop-up editor; round 37: no tag list in the
// large editor's scene boxes). Run this whenever something that can affect it changes: a pop-up editor, the large
// editor, a z-index, a text field, the autocomplete or wildcard code, or a new place where text is typed.
//
// For each text field, in each place it can be typed in (on the node, in its pop-up editor, in the large editor):
//   - the tag autocomplete list opens, lies inside the window, starts under the line being typed, and nothing covers it
//   - the same for the wildcard list (__name)
// Then the pack's own tooltip, shortcut list and canvas menu (on the node and over the large editor), and
// the other things that pop up over the large editor: tool menu, LoRA menu, color picker, region pop-up editor,
// LLM settings.
//
//   node tests/real_layering.cjs [vue]
// Needs a running ComfyUI with this pack, ComfyUI-Custom-Scripts (its autocomplete on, with a word starting "blon":
// tests/setup_real_comfy.sh sets both up), ComfyUI Impact Pack with the test wildcard rgtest/color, and at least
// one LoRA file (an empty .safetensors will do) for the LoRA menu.
const path = require("path");
const fs = require("fs");
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();

const vue = process.argv[2] === "vue";
const M = vue ? "Nodes 2.0" : "legacy";
const fails = [], skips = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const skip = (name, why) => { console.log("SKIP " + name + ": " + why); skips.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG_LIST = ".pysssss-autocomplete, .comfy-autocomplete-dropdown", WC_LIST = ".rg-wc-ac";

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1700, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(200); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) { /* older */ }
        await s.set("Comfy.VueNodes.Enabled", vue); await s.set("Comfy.Locale", "en"); try { await s.set("Comfy.Minimap.Visible", false); } catch (e) { /* older */ } }, vue);
    await sleep(800);
    // a graph zoom other than 1, so a list placed by the wrong scale shows
    await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [160, 190]; app.graph.add(rg);
        const rl = LG.createNode("Region-Genie_RegionalLoRAs"); rl.pos = [1050, 190]; app.graph.add(rl);
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 0.7; app.canvas.setDirty(true, true); window.__rg = rg; window.__rl = rl;
        await new Promise((r) => setTimeout(r, 2000));
    });

    // what a list looks like right now, next to the field it belongs to
    const probe = (field, selector) => field.evaluate((el, selector) => {
        const lists = [...document.querySelectorAll(selector)].filter((l) => { const r = l.getBoundingClientRect(); return l.isConnected && getComputedStyle(l).display !== "none" && r.width > 4 && r.height > 4; });
        const l = lists[lists.length - 1];
        if (!l) return null;
        const r = l.getBoundingClientRect(), f = el.getBoundingClientRect(), cs = getComputedStyle(el);
        const scale = el.offsetHeight ? f.height / el.offsetHeight : 1;
        const line = (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2) * scale;
        const pts = [[r.left + 6, r.top + 5], [(r.left + r.right) / 2, (r.top + r.bottom) / 2], [r.right - 6, r.bottom - 5]];
        const covered = pts.map(([x, y]) => document.elementFromPoint(x, y)).filter((t) => !t || !l.contains(t)).map((t) => t ? t.tagName.toLowerCase() + "." + String(t.className).slice(0, 30) : "nothing");
        return { inWindow: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, covered,
                 // under the first line of the text (not on it), and not far below the field; starting within the field's width
                 placed: r.top >= f.top + line * 0.95 && r.top <= f.bottom + 30 && r.left >= f.left - 12 && r.left <= f.right,
                 at: [r.left, r.top, r.width, r.height].map(Math.round), field: [f.left, f.top, f.width, f.height].map(Math.round), z: getComputedStyle(l).zIndex };
    }, selector);
    const clear = async () => { await page.keyboard.press("Control+a"); await page.keyboard.press("Delete"); await sleep(150); };
    let wildcards = null;                                  // null = not known yet, false = no wildcard pack
    // the two lists of one text field
    async function fieldLists(label, field) {
        await field.scrollIntoViewIfNeeded().catch(() => {});
        await field.click(); await clear();
        await page.keyboard.type("blon", { delay: 60 }); await sleep(800);
        const t = await probe(field, TAG_LIST);
        check(`${M}: ${label}: the tag list opens, in the window, under the typed line, with nothing over it${t ? ` (list ${t.at.join(" ")}; field ${t.field.join(" ")}${t.covered.length ? "; covered by " + t.covered.join(", ") : ""})` : " (no list)"}`,
            !!t && t.inWindow && t.placed && !t.covered.length);
        await clear();
        if (wildcards !== false) {
            await page.keyboard.type("__rgt", { delay: 60 }); await sleep(700);
            const w = await probe(field, WC_LIST);
            if (wildcards === null) { wildcards = !!w; if (!w) skip("the wildcard lists", "no wildcard list on the first field (ComfyUI Impact Pack with the wildcard rgtest/color is needed)"); }
            if (wildcards) check(`${M}: ${label}: the wildcard list opens, in the window, with nothing over it${w ? ` (list ${w.at.join(" ")}${w.covered.length ? "; covered by " + w.covered.join(", ") : ""})` : " (no list)"}`,
                !!w && w.inWindow && !w.covered.length && w.at[1] >= w.field[1] && w.at[1] <= w.field[1] + w.field[3] + 40);
            await clear();
        }
        await sleep(100);
    }
    // is this element the top thing where it is drawn?
    const onTop = (selector) => page.evaluate((selector) => {
        const all = [...document.querySelectorAll(selector)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; });
        const l = all[all.length - 1];
        if (!l) return "not there";
        const r = l.getBoundingClientRect();
        const pts = [[r.left + 8, r.top + 8], [(r.left + r.right) / 2, (r.top + r.bottom) / 2], [r.right - 8, r.bottom - 8]].filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
        const bad = pts.map(([x, y]) => document.elementFromPoint(x, y)).filter((t) => !t || !l.contains(t));
        return bad.length ? "covered by " + bad.map((t) => t ? t.tagName.toLowerCase() + "." + String(t.className).slice(0, 30) : "nothing").join(", ") : true;
    }, selector);
    const closePop = async () => { await page.evaluate(() => [...document.querySelectorAll(".rg-pop [title^='Close'], .rg-fpop [title^='Close']")].pop()?.click()); await sleep(300); };
    const expandOf = (field) => field.evaluate((el) => { const b = el.parentElement.querySelector(".rg-expand") || el.parentElement.parentElement.querySelector(".rg-expand"); b?.click(); return !!b; });

    // the Region Genie node is taller than the window at this zoom: show its top or its bottom
    const show = async (part) => { await page.evaluate((part) => { const app = window.app, n = window.__rg, s = app.canvas.ds.scale;
        app.canvas.ds.offset = [0, part === "bottom" ? -(n.pos[1] + n.size[1] + 60 - innerHeight / s) : 0]; app.canvas.setDirty(true, true); }, part); await sleep(600); };

    // ---------------- the Region Genie node ----------------
    const cv = await page.evaluate(() => { const r = document.querySelector(".rg-cv canvas").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    await page.mouse.move(cv[0] + cv[2] / 2, cv[1] + cv[3] / 2); await page.keyboard.press("r");
    await page.mouse.move(cv[0] + cv[2] * 0.3, cv[1] + cv[3] * 0.3); await page.mouse.down(); await page.mouse.move(cv[0] + cv[2] * 0.7, cv[1] + cv[3] * 0.7, { steps: 4 }); await page.mouse.up(); await sleep(300);
    // Ideogram 4 picked: scene_prompt_background shows too
    await page.locator(".rg-model").selectOption("Ideogram 4"); await sleep(700);
    const scene = page.locator('textarea[data-rg-field^="scene_prompt_"]');
    const nScene = await scene.count();
    check(`${M}: the node shows its three scene prompts with Ideogram 4 picked (${nScene})`, nScene === 3);
    const SCENE_NAMES = ["scene_prompt_positive", "scene_prompt_negative", "scene_prompt_background"];
    for (let i = 0; i < nScene; i++) await fieldLists(`node, ${SCENE_NAMES[i]}`, scene.nth(i));
    await show("bottom");
    await fieldLists("node, a region's prompt", page.locator(".rg-list textarea.rg-prompt").first());
    await expandOf(page.locator(".rg-list textarea.rg-prompt").first()); await sleep(500);
    check(`${M}: a region's pop-up editor is on top (${await onTop(".rg-pop")})`, await onTop(".rg-pop") === true);
    await fieldLists("pop-up editor of a region, its prompt", page.locator(".rg-pop textarea").first());
    await closePop();
    await show("top");
    // the scene prompts' pop-up editors
    for (let i = 0; i < nScene; i++) {
        await expandOf(scene.nth(i)); await sleep(500);
        check(`${M}: ${SCENE_NAMES[i]}: its pop-up editor is on top (${await onTop(".rg-pop")})`, await onTop(".rg-pop") === true);
        await fieldLists(`pop-up editor of ${SCENE_NAMES[i]}`, page.locator(".rg-pop textarea").first());
        await closePop();
    }

    // ---------------- the Regional LoRAs node ----------------
    const rlRoot = page.locator(".rg-rl-wrap");
    for (const name of ["positive_prompt", "negative_prompt"]) {
        if (!(await page.locator(`textarea[data-rg-field="${name}"]`).count())) { check(`${M}: Regional LoRAs, ${name}: its text box was found`, false); continue; }
        await fieldLists(`Regional LoRAs node, ${name}`, page.locator(`textarea[data-rg-field="${name}"]`));
        await expandOf(page.locator(`textarea[data-rg-field="${name}"]`)); await sleep(500);
        if (await page.locator(".rg-fpop textarea").count()) {
            check(`${M}: Regional LoRAs, ${name}: its pop-up editor is on top (${await onTop(".rg-fpop")})`, await onTop(".rg-fpop") === true);
            await fieldLists(`Regional LoRAs, pop-up editor of ${name}`, page.locator(".rg-fpop textarea").first());
            await closePop();
        } else check(`${M}: Regional LoRAs, ${name}: the pop-up editor opened`, false);
    }
    // a row (+ Add LoRA adds one; no LoRA file has to be chosen for its words field)
    await rlRoot.locator("button", { hasText: "+ Add LoRA" }).click(); await sleep(600);
    if (!(await rlRoot.locator("textarea.rg-rl-prompt").count())) check(`${M}: Regional LoRAs: + Add LoRA adds a row with a words field`, false);
    else {
        await fieldLists("Regional LoRAs node, a row's words", rlRoot.locator("textarea.rg-rl-prompt").first());
        await expandOf(rlRoot.locator("textarea.rg-rl-prompt").first()); await sleep(500);
        if (await page.locator(".rg-fpop textarea").count()) { await fieldLists("Regional LoRAs, pop-up editor of a row's words", page.locator(".rg-fpop textarea").first()); await closePop(); }
        else check(`${M}: Regional LoRAs, a row's words: the pop-up editor opened`, false);
    }

    // ---------------- the pack's own tooltip, shortcut list and canvas menu, on the node ----------------
    // (the tooltip is transparent to the pointer, so "on top" is asked with that switched off for a moment)
    const tipTop = () => page.evaluate(() => { const t = document.querySelector(".rg-tip.on"); if (!t) return "not there"; const r = t.getBoundingClientRect();
        t.style.pointerEvents = "auto"; const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); t.style.pointerEvents = "";
        return hit && t.contains(hit) && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight ? true : "covered or outside the window"; });
    const tipAt = async (sel, name) => {
        const b = await page.locator(sel).first().boundingBox();
        await page.mouse.move(5, 500); await sleep(700);
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await sleep(800);
        const t = await page.evaluate(() => { const t = document.querySelector(".rg-tip.on"); if (!t) return null; const r = t.getBoundingClientRect(); return { top: r.top, fs: parseFloat(getComputedStyle(t).fontSize), text: t.innerText }; });
        check(`${M}: ${name}: the pack's tooltip shows, on top and in the window (${await tipTop()})`, await tipTop() === true);
        check(`${M}: ${name}: right under the button, at its own text size whatever the graph zoom`, !!t && t.top >= b.y + b.height && t.top < b.y + b.height + 14 && t.fs >= 12 && t.text.length > 4);
        await page.mouse.move(5, 500); await sleep(200);
    };
    await show("top");
    await tipAt('.rg-bar [title^="Undo"]', "node");
    const cv2 = await page.evaluate(() => { const r = document.querySelector(".rg-cv canvas").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    await page.mouse.click(cv2[0] + cv2[2] * 0.06, cv2[1] + cv2[3] * 0.08, { button: "right" }); await sleep(400);
    check(`${M}: node: right-click on the canvas opens the pack's menu, on top (${await onTop(".rg-menu")})`, await onTop(".rg-menu") === true);
    check(`${M}: node: …and not ComfyUI's node menu`, await page.evaluate(() => !document.querySelector(".litecontextmenu, .p-contextmenu, .p-tieredmenu, [role='menu']:not(.rg-menu)")));
    await page.keyboard.press("Escape"); await sleep(200);
    await page.mouse.click(cv2[0] + cv2[2] * 0.5, cv2[1] + cv2[3] * 0.5, { button: "right" }); await sleep(400);
    check(`${M}: node: right-click on the region: its menu`, await page.locator(".rg-menu-item", { hasText: "Edit prompt" }).count() === 1);
    await page.keyboard.press("Escape"); await sleep(200);
    await show("bottom");
    await page.locator(".rg-keys-btn").click(); await sleep(400);
    check(`${M}: node: the shortcut list opens on top, in the window (${await onTop(".rg-keys")})`, await onTop(".rg-keys") === true);
    await page.keyboard.press("Escape"); await sleep(200);
    check(`${M}: node: Esc closes the shortcut list`, await page.locator(".rg-keys").count() === 0);
    await show("top");

    // ---------------- the large editor ----------------
    await page.locator('.rg-bar [title^="Large editor"]').click(); await sleep(700);
    check(`${M}: the large editor is on top (${await onTop(".rg-big-win")})`, await onTop(".rg-big-win") === true);
    for (const which of ["positive", "negative", "background"]) await fieldLists(`large editor, scene_prompt_${which}`, page.locator(`.rg-big-ta[data-scene="${which}"]`));
    await fieldLists("large editor, a region's prompt", page.locator(".rg-big .rg-list textarea.rg-prompt").first());
    await expandOf(page.locator(".rg-big .rg-list textarea.rg-prompt").first()); await sleep(500);
    check(`${M}: large editor: a region's pop-up editor opens over the window (${await onTop(".rg-pop")})`, await onTop(".rg-pop") === true);
    await fieldLists("large editor, pop-up editor of a region", page.locator(".rg-pop textarea").first());
    await closePop();
    // the other things that pop up over the window
    const g = await page.locator(".rg-big .rg-btn.icon.grp").first().boundingBox();
    await page.mouse.click(g.x + g.width - 4, g.y + g.height / 2); await sleep(400);
    check(`${M}: large editor: a tool's menu opens over the window (${await onTop(".litecontextmenu")})`, await onTop(".litecontextmenu") === true);
    await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelectorAll(".litecontextmenu").forEach((m) => m.remove())); await sleep(200);
    await page.locator(".rg-big .rg-row.region button", { hasText: "＋LoRA" }).first().click(); await sleep(700);
    check(`${M}: large editor: the LoRA menu opens over the window (${await onTop(".litecontextmenu")})`, await onTop(".litecontextmenu") === true);
    await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelectorAll(".litecontextmenu").forEach((m) => m.remove())); await sleep(200);
    await page.locator(".rg-big .rg-row.region .rg-sw.pick").first().click(); await sleep(400);
    check(`${M}: large editor: the color picker opens over the window (${await onTop(".rg-cp")})`, await onTop(".rg-cp") === true);
    await page.keyboard.press("Escape"); await sleep(300);
    await page.locator(".rg-big .rg-llmset").click(); await sleep(600);
    check(`${M}: large editor: the LLM settings open over the window (${await onTop(".rg-llm-pop")})`, await onTop(".rg-llm-pop") === true);
    await page.keyboard.press("Escape"); await sleep(300);
    await page.evaluate(() => document.querySelector(".rg-llm-pop")?.remove());
    await tipAt('.rg-big .rg-bar [title^="Undo"]', "large editor");
    const cv3 = await page.evaluate(() => { const r = document.querySelector(".rg-big .rg-cv canvas").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    await page.mouse.click(cv3[0] + cv3[2] * 0.04, cv3[1] + cv3[3] * 0.06, { button: "right" }); await sleep(400);
    check(`${M}: large editor: the canvas's right-click menu opens over the window (${await onTop(".rg-menu")})`, await onTop(".rg-menu") === true);
    await page.keyboard.press("Escape"); await sleep(200);
    await page.locator(".rg-big .rg-keys-btn").click(); await sleep(400);
    check(`${M}: large editor: the shortcut list opens over the window (${await onTop(".rg-keys")})`, await onTop(".rg-keys") === true);
    await page.keyboard.press("Escape"); await sleep(200);
    check(`${M}: large editor: Esc closed the list, not the window`, await page.locator(".rg-keys").count() === 0 && await page.locator(".rg-big").count() === 1);
    fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, "out", `layering_${vue ? "vue" : "legacy"}.png`) });
    await page.locator(".rg-big-head .rg-btn").click(); await sleep(400);
    check(`${M}: the large editor closes again`, await page.locator(".rg-big").count() === 0);

    const errs = errors.filter((e) => !/ResizeObserver/.test(e));
    check(`${M}: no script errors${errs.length ? ` (${errs.slice(0, 2).join(" | ")})` : ""}`, !errs.length);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : `\nall passed${skips.length ? ` (${skips.length} skipped)` : ""}`);
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
