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
//   - in a pop-up editor: the menus its buttons open (the wildcard list, the LoRA list: ComfyUI's own menu) are on top
//     of the pop-up (round 42: they opened behind it); since round 43 also the LLM button's menu, the LLM settings
//     opened from it and a list in them, the palette's color picker, and the LoRA list of a LoRA row
// Then the pack's own tooltip, shortcut list and canvas menu (on the node and over the large editor), and
// the other things that pop up over the large editor: tool menu, LoRA menu, color picker, region pop-up editor,
// LLM settings.
// And everywhere along the way (the node, each pop-up editor, the shortcut list, the large editor, the LLM settings):
// with the pointer on a control, the browser has no tooltip of its own to show next to the pack's, neither the
// control's title nor the title of a box around it (round 42: a pop-up's title bar showed through on its buttons).
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
    // a menu opened by a button of a pop-up editor (ComfyUI's own menu) is on top of the pop-up
    const dropMenus = async () => { await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelectorAll(".litecontextmenu").forEach((m) => m.remove())); await sleep(200); };
    async function menuFrom(label, button, what, click = {}) {
        if (!(await button.count()) || !(await button.first().isVisible())) { skip(`${label}: the ${what} list`, "its button isn't shown here"); return; }
        await button.first().click(click); await sleep(800);
        const top = await onTop(".litecontextmenu");
        const over = await page.evaluate(() => { const m = [...document.querySelectorAll(".litecontextmenu")].pop(), p = [...document.querySelectorAll(".rg-pop, .rg-fpop")].pop(); if (!m || !p) return false;
            const a = m.getBoundingClientRect(), b = p.getBoundingClientRect(); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; });
        check(`${M}: ${label}: the ${what} list opens over the pop-up, with nothing covering it (${top}${over ? "" : "; it doesn't lie on the pop-up"})`, top === true && over);
        await dropMenus();
    }
    // everything else a pop-up editor's controls can open (round 43: "no layering issues with any list in any pop-up"):
    // the LLM button's menu and the LLM settings from it (with a list of their own), the color picker of the palette,
    // and the LoRA list of a LoRA row that was added in the pop-up
    const removeMenus = async () => { await page.evaluate(() => { try { window.LiteGraph?.closeAllContextMenus?.(window); } catch (e) { /* older */ } document.querySelectorAll(".litecontextmenu").forEach((m) => m.remove()); }); await sleep(200); };
    // rounds 87-88: a pop-up has tabs (Prompt, LoRAs, and for a region Layers, Palette, Options)
    const toTab = async (t) => { const b = page.locator(`.rg-pop .rg-pop-tabs [data-tab="${t}"]`); if (await b.count() && await b.first().isVisible()) { await b.first().click(); await sleep(250); return true; } return false; };
    const ADD_LORA = ".rg-pop .rg-pop-pane[data-pane=loras] .rg-pop-addl .rg-btn";
    async function popExtras(label, { llm = true, palette = false, loraRow = false } = {}) {
        await toTab("prompt");
        if (llm && await page.locator(".rg-pop .rg-llm-btn").count()) {
            await menuFrom(label, page.locator(".rg-pop .rg-llm-btn"), "LLM button's menu (right-click)", { button: "right" });
            // Esc with such a menu open closes the menu, not the pop-up under it (round 43)
            await page.locator(".rg-pop textarea").first().focus();
            await page.locator(".rg-pop .rg-llm-btn").first().click({ button: "right" }); await sleep(500);
            await page.keyboard.press("Escape"); await sleep(300);
            check(`${M}: ${label}: Esc with a menu open closes the menu and leaves the pop-up`, await page.locator(".litecontextmenu").count() === 0 && await page.locator(".rg-pop").count() === 1);
            await page.locator(".rg-pop .rg-llm-btn").first().click({ button: "right" }); await sleep(600);
            await page.evaluate(() => [...document.querySelectorAll(".litecontextmenu .litemenu-entry")].find((e) => /LLM Settings/.test(e.textContent))?.click()); await sleep(800);
            check(`${M}: ${label}: the LLM settings, opened from that menu, are over the pop-up (${await onTop(".rg-llm-pop")})`, await onTop(".rg-llm-pop") === true);
            const sel = page.locator(".rg-llm-pop .rg-ff-name, .rg-llm-pop .rg-pick");
            if (await sel.count() && await sel.first().isVisible()) {
                await sel.first().click(); await sleep(800);
                const t = await onTop(".litecontextmenu");
                check(`${M}: ${label}: a file list of the LLM settings opens over them (${t})`, t === true);
                await removeMenus();
            }
            // (no Esc from here on: with nothing else open it would close the pop-up editor itself)
            await page.evaluate(() => [...document.querySelectorAll(".rg-llm-pop [title^='Close'], .rg-llm-pop .rg-x")].pop()?.click()); await sleep(300);
            await page.evaluate(() => document.querySelector(".rg-llm-pop")?.remove()); await removeMenus();
            check(`${M}: ${label}: the pop-up is still open after all that`, await page.locator(".rg-pop").count() === 1);
        }
        if (palette && await toTab("palette")) {
            // round 88: the palette's color picker is a part of the Palette tab, not a window that could end up behind
            await page.locator(".rg-pop .rg-pop-paladd").first().click(); await sleep(500);
            const pk = await page.evaluate(() => { const p = document.querySelector(".rg-pop .rg-pop-pal .rg-cp.inline .rg-cp-sv"); if (!p) return { there: false };
                const r = p.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { there: true, onTop: p.contains(top) || p === top, floating: document.querySelectorAll("body > .rg-cp").length }; });
            check(`${M}: ${label}: the palette's color picker is inside the Palette tab, in view, with no picker window (${JSON.stringify(pk)})`, pk.there && pk.onTop && pk.floating === 0);
            await page.locator(".rg-pop .rg-pop-pal .rg-pop-paldel").click(); await sleep(300);          // the color added here goes again
            await nativeTips(`${label}, Palette tab`, 2);
        }
        for (const t of ["layers", "options"]) if (await toTab(t)) await nativeTips(`${label}, ${t} tab`, 2);
        if (loraRow && await toTab("loras")) {
            const add = page.locator(ADD_LORA);
            if (await add.count()) {
                await add.first().click(); await sleep(800);
                const picked = await page.evaluate(() => { const e = [...document.querySelectorAll(".litecontextmenu .litemenu-entry")].find((x) => x.offsetParent && /\.safetensors$/.test(x.textContent.trim())); e?.click(); return !!e; });
                await sleep(900); await removeMenus();
                if (picked && await page.locator(".rg-pop .rg-pop-lorarows .rg-pick").count()) await menuFrom(label, page.locator(".rg-pop .rg-pop-lorarows .rg-pick"), "LoRA list of a LoRA row");
                else skip(`${label}: the LoRA list of a LoRA row`, "no LoRA file to add a row with");
                await nativeTips(`${label}, LoRAs tab`, 3);
            }
        }
        await toTab("prompt");
    }
    // With the pointer on a control, what would the browser's own tooltip show? The title of the nearest element around
    // the pointer that has the attribute: it must be empty. Asked for every control with a tooltip that is in view.
    const ROOT = '[class^="rg-"], [class*=" rg-"]';
    async function nativeTips(label, min = 3) {
        await page.mouse.move(3, 3); await sleep(150);
        await page.evaluate(() => { window.__rgTakeTitles = true; });
        const spots = await page.evaluate((ROOT) => {
            const out = [], seen = new Set();
            for (const el of document.querySelectorAll("[title]")) {
                const box = el.closest(ROOT);                // (<html> can carry a class of the pack: that is not one of its boxes)
                if (!el.getAttribute("title").trim() || !box || box === document.documentElement || box === document.body || el.closest(".rg-tip")) continue;
                const r = el.getBoundingClientRect();
                if (r.width < 3 || r.height < 3) continue;
                // a point of the element that isn't on a child with a tooltip of its own
                for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5], [0.5, 0.2], [0.03, 0.5], [0.5, 0.92]]) {
                    const x = r.left + r.width * fx, y = r.top + r.height * fy;
                    if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
                    const hit = document.elementFromPoint(x, y);
                    if (!hit || hit.closest("[title]") !== el) continue;
                    const key = Math.round(x) + "," + Math.round(y);
                    if (!seen.has(key)) { seen.add(key); out.push([x, y, (el.dataset.ic || el.className || el.tagName).toString().slice(0, 28), el.getAttribute("title").slice(0, 24)]); }
                    break;
                }
            }
            return out;
        }, ROOT);
        const bad = [];
        let shown = 0, asked = 0;
        for (let i = 0; i < spots.length; i++) {
            const [x, y, name, text] = spots[i];
            await page.mouse.move(x, y); await sleep(45);
            const nat = await page.evaluate(([x, y]) => { for (let e = document.elementFromPoint(x, y); e; e = e.parentElement) if (e.hasAttribute("title")) return e.getAttribute("title"); return ""; }, [x, y]);
            if (nat !== "") bad.push(`${name} "${text}": the browser would show "${nat.slice(0, 30)}"`);
            if (i % 12 === 0) {                              // now and then: the pack's own tooltip does come up, with this control's text
                asked++; await page.mouse.move(3, 3); await sleep(650); await page.mouse.move(x, y); await sleep(750);
                const own = await page.evaluate(() => document.querySelector(".rg-tip.on")?.innerText || "");
                const nat2 = await page.evaluate(([x, y]) => { for (let e = document.elementFromPoint(x, y); e; e = e.parentElement) if (e.hasAttribute("title")) return e.getAttribute("title"); return ""; }, [x, y]);
                if (own.trim()) shown++;
                if (nat2 !== "") bad.push(`${name} "${text}": after a rest the browser would show "${nat2.slice(0, 30)}"`);
            }
        }
        await page.mouse.move(3, 3); await sleep(450);
        const left = await page.evaluate(() => document.querySelectorAll("[data-rg-tip]").length);
        await page.evaluate(() => { window.__rgTakeTitles = false; });
        check(`${M}: ${label}: pointer on each of ${spots.length} controls with a tooltip: the browser has none of its own to show; the pack's came up on ${shown} of ${asked} tried${bad.length ? " (" + bad.slice(0, 4).join("; ") + ")" : ""}`,
            spots.length >= min && !bad.length && shown >= Math.ceil(asked * 0.7));
        check(`${M}: ${label}: every title is back where it was once the pointer has left (${left} still aside)`, left === 0);
    }
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
    await menuFrom("pop-up editor of a region", page.locator(".rg-pop .rg-wc-pick"), "wildcard");
    await toTab("loras"); await menuFrom("pop-up editor of a region", page.locator(ADD_LORA), "LoRA"); await toTab("prompt");
    await popExtras("pop-up editor of a region", { palette: true, loraRow: true });
    await nativeTips("pop-up editor of a region", 12);
    await closePop();
    await nativeTips("node, its lower part", 15);
    await show("top");
    await nativeTips("node, its upper part", 15);
    // the scene prompts' pop-up editors
    for (let i = 0; i < nScene; i++) {
        await expandOf(scene.nth(i)); await sleep(500);
        check(`${M}: ${SCENE_NAMES[i]}: its pop-up editor is on top (${await onTop(".rg-pop")})`, await onTop(".rg-pop") === true);
        await fieldLists(`pop-up editor of ${SCENE_NAMES[i]}`, page.locator(".rg-pop textarea").first());
        await menuFrom(`pop-up editor of ${SCENE_NAMES[i]}`, page.locator(".rg-pop .rg-wc-pick"), "wildcard");
        if (i === 0) { await toTab("loras"); await menuFrom(`pop-up editor of ${SCENE_NAMES[i]}`, page.locator(ADD_LORA), "LoRA"); await popExtras(`pop-up editor of ${SCENE_NAMES[i]}`, { loraRow: true }); }
        if (i < 2) await nativeTips(`pop-up editor of ${SCENE_NAMES[i]}`, 7);
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
            await menuFrom(`Regional LoRAs, pop-up editor of ${name}`, page.locator(".rg-fpop-ctl .rg-btn.icon"), "wildcard");
            if (name === "positive_prompt") await nativeTips("Regional LoRAs, pop-up editor", 7);
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

    await nativeTips("Regional LoRAs node", 6);
    // the pack's tooltip leaves everything outside its own boxes alone (round 42: with its "rg-osb" class on <html> it
    // took over every tooltip on the page)
    const foreign = await page.evaluate(() => { const d = document.createElement("div"); d.id = "rg-test-foreign"; d.title = "Not the pack's"; d.style.cssText = "position:fixed;right:4px;bottom:4px;width:40px;height:20px;z-index:99999;background:#444";
        document.body.appendChild(d); document.documentElement.classList.add("rg-osb"); window.__rgTakeTitles = true; const r = d.getBoundingClientRect(); return [r.left + 20, r.top + 10]; });
    await page.mouse.move(foreign[0], foreign[1]); await sleep(900);
    const fr = await page.evaluate(() => { const d = document.getElementById("rg-test-foreign"); const r = { title: d.getAttribute("title"), aside: d.dataset.rgTip, tip: !!document.querySelector(".rg-tip.on") }; d.remove(); window.__rgTakeTitles = false; return r; });
    await page.mouse.move(3, 3); await sleep(200);
    check(`${M}: an element outside the pack's boxes keeps its own tooltip, also with the pack's class on the page itself (${JSON.stringify(fr)})`, fr.title === "Not the pack's" && fr.aside == null && !fr.tip);

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
    // every section of it is there (round 42: only the first two were, the rest lay off to the side)
    const secs = await page.evaluate(() => { const b = document.querySelector(".rg-keys-body"), br = b.getBoundingClientRect();
        return { names: [...b.querySelectorAll("section h4")].map((h) => h.textContent).join("|"), inside: [...b.querySelectorAll("section")].every((s) => { const r = s.getBoundingClientRect(); return r.left >= br.left - 1 && r.right <= br.right + 1; }),
                 sideways: b.scrollWidth > b.clientWidth + 1 }; });
    check(`${M}: node: the shortcut list has its five sections, none off to the side (${secs.names})`, secs.names === "Tools|While drawing|Layers and regions|View|Text" && secs.inside && !secs.sideways);
    await nativeTips("shortcut list", 20);
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
    await menuFrom("large editor, pop-up editor of a region", page.locator(".rg-pop .rg-wc-pick"), "wildcard");
    await toTab("loras"); await menuFrom("large editor, pop-up editor of a region", page.locator(ADD_LORA), "LoRA"); await toTab("prompt");
    await popExtras("large editor, pop-up editor of a region", { palette: true });
    await closePop();
    // the other things that pop up over the window
    const g = await page.locator(".rg-big .rg-btn.icon.grp").first().boundingBox();
    await page.mouse.click(g.x + g.width - 4, g.y + g.height / 2); await sleep(400);
    check(`${M}: large editor: a tool's menu opens over the window (${await onTop(".rg-menu")})`, await onTop(".rg-menu") === true);
    await page.locator(".rg-menu .rg-menu-item").nth(1).hover(); await sleep(900);
    check(`${M}: large editor: a row's tooltip shows over the menu`, await page.evaluate(() => { const t = document.querySelector(".rg-tip"), m = document.querySelector(".rg-menu"); if (!t || !m || !t.classList.contains("on") || !t.textContent.trim()) return false;
        return +getComputedStyle(t).zIndex > +getComputedStyle(m).zIndex && +getComputedStyle(t).zIndex > +(getComputedStyle(document.querySelector(".rg-big")).zIndex || 0); }));
    await nativeTips("a tool's list", 3);
    await page.keyboard.press("Escape"); await sleep(200);
    // rounds 87-88: a region's type menu; its LoRAs button opens the pop-up on the LoRAs tab, and ＋LoRA there the list
    await page.locator(".rg-big .rg-row.region .rg-tybtn").first().click(); await sleep(400);
    check(`${M}: large editor: a region's type menu opens over the window (${await onTop(".rg-menu")})`, await onTop(".rg-menu") === true);
    await nativeTips("the type menu", 1);
    await page.keyboard.press("Escape"); await sleep(200);
    await page.locator(".rg-big .rg-row.region .rg-lbtn").first().click(); await sleep(700);
    check(`${M}: large editor: the LoRAs button opens the region's pop-up over the window, on its LoRAs tab (${await onTop(".rg-pop")})`,
          await onTop(".rg-pop") === true && await page.evaluate(() => document.querySelector(".rg-pop .rg-pop-tabs .on")?.dataset.tab) === "loras");
    await page.locator(ADD_LORA).click(); await sleep(700);
    check(`${M}: large editor: the LoRA menu opens over the window (${await onTop(".litecontextmenu")})`, await onTop(".litecontextmenu") === true);
    await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelectorAll(".litecontextmenu").forEach((m) => m.remove())); await sleep(200);
    await page.evaluate(() => window.__rg?.__rgCloseEditor?.()); await sleep(200);
    if (await page.locator(".rg-pop").count()) { await page.keyboard.press("Escape"); await sleep(200); }
    await page.locator(".rg-big .rg-row.region .rg-sw.pick").first().click(); await sleep(400);
    check(`${M}: large editor: the color picker opens over the window (${await onTop(".rg-cp")})`, await onTop(".rg-cp") === true);
    await page.keyboard.press("Escape"); await sleep(300);
    await page.locator(".rg-big .rg-llmset").click(); await sleep(600);
    check(`${M}: large editor: the LLM settings open over the window (${await onTop(".rg-llm-pop")})`, await onTop(".rg-llm-pop") === true);
    await nativeTips("LLM settings", 6);
    await page.keyboard.press("Escape"); await sleep(300);
    await page.evaluate(() => document.querySelector(".rg-llm-pop")?.remove());
    await tipAt('.rg-big .rg-bar [title^="Undo"]', "large editor");
    await nativeTips("large editor", 30);
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
