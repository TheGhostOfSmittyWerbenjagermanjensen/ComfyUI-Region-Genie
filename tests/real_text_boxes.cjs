// The node's own text boxes in the real ComfyUI (round 43):
//   - the pop-up button of a text box never lies on the scroll bar, and the text never runs under the button, the LLM
//     button next to it or the scroll bar; with classic scroll bars (they take their own room) and with overlay ones
//     (drawn over the text: Windows 11, macOS)
//   - a one-line region prompt has the button in the middle of its height
//   - scene_prompt_positive shows its LLM Prompt Enhancer: a button in its corner and an outline while it is on
//   - Undo / Redo cover the scene prompts and every visit to a text box; the Undo keys in a box go through its own text
//   - none of that history survives loading a workflow
//   - the bottom bar is half-way between the line above it and the node's lower edge (legacy nodes)
//
//   node tests/real_text_boxes.cjs [vue] [classic]
// "classic": the browser draws classic scroll bars (without it: overlay scroll bars, as headless Chromium has them).
// Needs a running ComfyUI with this pack.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const args = process.argv.slice(2), vue = args.includes("vue"), classic = args.includes("classic");
const M = (vue ? "Nodes 2.0" : "legacy") + (classic ? ", classic scroll bars" : ", overlay scroll bars");
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launch(classic ? { ignoreDefaultArgs: ["--hide-scrollbars"] } : {});
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1700, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(200); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) { /* older */ }
        await s.set("Comfy.VueNodes.Enabled", vue); await s.set("Comfy.Locale", "en"); try { await s.set("Comfy.Minimap.Visible", false); } catch (e) { /* older */ } }, vue);
    await sleep(800);
    const newGraph = () => page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [330, 70]; app.graph.add(rg);
        const rl = LG.createNode("Region-Genie_RegionalLoRAs"); rl.pos = [1250, 70]; app.graph.add(rl);
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 0.7; app.canvas.setDirty(true, true); window.__rg = rg; window.__rl = rl;
        await new Promise((r) => setTimeout(r, 2500));
    });
    await newGraph();
    const osb = await page.evaluate(() => document.documentElement.classList.contains("rg-osb"));
    check(`${M}: the pack sees the kind of scroll bar the browser draws (overlay: ${osb})`, osb === !classic);
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__rg.__rgState())));
    const W = (name) => page.evaluate((name) => String(window.__rg.widgets.find((w) => w.name === name).value ?? ""), name);
    const setW = async (name, v) => { await page.evaluate(([name, v]) => { const w = window.__rg.widgets.find((x) => x.name === name); w.value = v; w.callback?.(v);
        const t = document.querySelector(`textarea[data-rg-field="${name}"]`); if (t) { if (t.value !== v) t.value = v; t.dispatchEvent(new Event("input", { bubbles: true })); } }, [name, v]); await sleep(700); };
    const cv = () => page.evaluate(() => { const r = document.querySelector(".rg-cv canvas").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    const away = async () => { await page.mouse.move(5, 600); await sleep(150); };
    const leaveBox = async () => { const c = await cv(); await page.evaluate(() => window.__rg.__rgSetTool("select")); await page.mouse.click(c[0] + c[2] - 5, c[1] + 5); await sleep(200); };
    let c = await cv();
    await page.mouse.move(c[0] + c[2] / 2, c[1] + c[3] / 2); await page.keyboard.press("r");
    await page.mouse.move(c[0] + c[2] * 0.2, c[1] + c[3] * 0.2); await page.mouse.down(); await page.mouse.move(c[0] + c[2] * 0.6, c[1] + c[3] * 0.6, { steps: 4 }); await page.mouse.up(); await sleep(300);

    // everything about a text box and what sits in its corner, in the box's own (unscaled) pixels
    const corner = (sel) => page.evaluate((sel) => {
        const t = document.querySelector(sel); if (!t) return null;
        const host = t.parentElement, b = host.querySelector(":scope > .rg-expand"), llm = host.querySelector(":scope > .rg-llm-corner");
        const r = t.getBoundingClientRect(), k = r.width / t.offsetWidth, cs = getComputedStyle(t), br = b.getBoundingClientRect(), lr = llm?.getBoundingClientRect();
        const bar = t.offsetWidth - t.clientWidth - 2 * t.clientLeft;                      // a classic scroll bar's width (0: overlay or none)
        const inner = r.right - (t.clientLeft + bar) * k;                                  // where the text area ends
        const leftmost = Math.min(br.left, lr ? lr.left : 1e9);
        return { h: Math.round(r.height / k), scrolls: t.scrollHeight > t.clientHeight + 1, bar, pad: parseFloat(cs.paddingRight),
            btnFromEdge: Math.round((r.right - br.right) / k * 10) / 10, btnTop: Math.round((br.top - r.top) / k * 10) / 10, btnBottom: Math.round((r.bottom - br.bottom) / k * 10) / 10,
            textGap: Math.round((leftmost - (inner - parseFloat(cs.paddingRight) * k)) / k * 10) / 10,          // >= 0: the text stops before the controls
            llm: !!llm, llmOn: !!llm?.classList.contains("on"), llmGap: lr ? Math.round((br.left - lr.right) / k * 10) / 10 : null, llmMid: lr ? Math.round(((lr.top + lr.bottom) / 2 - (br.top + br.bottom) / 2) / k * 10) / 10 : null,
            outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0, inBox: br.left >= r.left && br.top >= r.top - 1 && br.bottom <= r.bottom + 1 };
    }, sel);
    const POS = 'textarea[data-rg-field="scene_prompt_positive"]', NEG = 'textarea[data-rg-field="scene_prompt_negative"]';
    const BAR = 14;                                    // the room an overlay scroll bar is given
    // the room the scroll bar takes in a box: its own width when it takes room in the layout (classic scroll bars; and
    // the text boxes of Nodes 2.0, which keep a 15 px gutter for theirs whatever the browser draws), else BAR while the
    // box scrolls
    const barOf = (g) => g.bar || (g.scrolls ? BAR : 0);

    // ---------------- short text: nothing scrolls
    await setW("scene_prompt_positive", "a quiet harbour at dawn"); await setW("scene_prompt_negative", "blurry");
    let p = await corner(POS), n = await corner(NEG);
    check(`${M}: short text, nothing to scroll: the pop-up button is in the box's bottom-right corner (${p.btnFromEdge} px from the edge${p.bar ? `, left of the ${p.bar} px the box keeps for its scroll bar` : ""})`,
        !p.scrolls && p.inBox && p.btnFromEdge >= barOf(p) + 1 && p.btnFromEdge <= barOf(p) + 4 && p.btnBottom <= 4 && n.btnFromEdge <= barOf(n) + 4);
    check(`${M}: scene_prompt_positive has the LLM button left of it, at the same height; scene_prompt_negative has none`, p.llm && p.llmGap >= 1 && p.llmGap <= 6 && Math.abs(p.llmMid) <= 1 && !n.llm);
    check(`${M}: the text stops before the buttons (positive ${p.textGap} px, negative ${n.textGap} px to spare)`, p.textGap >= 0 && n.textGap >= 0 && p.pad > n.pad);

    // ---------------- long text: the box scrolls
    const long = Array.from({ length: 14 }, (_, i) => `line ${i + 1} of a long prompt that goes on to the right edge of the box wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww`).join("\n");
    await setW("scene_prompt_positive", long); await setW("scene_prompt_negative", long);
    p = await corner(POS); n = await corner(NEG);
    check(`${M}: long text: both boxes scroll${p.bar ? ` (scroll bar ${p.bar} px wide)` : " (the scroll bar is drawn over the text)"}`, p.scrolls && n.scrolls && (vue || (classic ? p.bar > 0 : p.bar === 0)));
    check(`${M}: the pop-up button is off the scroll bar (${p.btnFromEdge} px from the box's edge; the bar takes ${barOf(p)})`, p.btnFromEdge >= barOf(p) + 1 && n.btnFromEdge >= barOf(n) + 1 && p.btnFromEdge <= barOf(p) + 5);
    check(`${M}: the text stops before the buttons and the scroll bar (positive ${p.textGap} px, negative ${n.textGap} px to spare)`, p.textGap >= 0 && n.textGap >= 0);
    // typed text really wraps before the buttons: the widest line of the text is narrower than the room left of them
    const wrap = await page.evaluate((sel) => { const t = document.querySelector(sel); return { sw: t.scrollWidth, cw: t.clientWidth }; }, POS);
    check(`${M}: no line of text is wider than the box (it wraps before the buttons)`, wrap.sw <= wrap.cw + 1);

    // ---------------- a region's prompt in the list
    const ROW = ".rg-list textarea.rg-prompt";
    await page.evaluate(() => document.querySelector(".rg-tree")?.scrollIntoView?.({ block: "nearest" }));
    let r0 = await corner(ROW);
    check(`${M}: a one-line region prompt: the pop-up button is in the middle of its height (${r0.btnTop} above, ${r0.btnBottom} below)`, r0.h < 28 && Math.abs(r0.btnTop - r0.btnBottom) <= 1 && r0.textGap >= 0);
    await page.evaluate((v) => { const n = window.__rg; n.__rgState().regions[0].prompt = v; n.__rgRefresh(); }, long.replace(/\n/g, " ")); await sleep(300);
    await page.evaluate((sel) => document.querySelector(sel).focus(), ROW); await sleep(400);
    r0 = await corner(ROW);
    check(`${M}: the open region prompt (${r0.h} px): the button in the bottom-right corner, off its scroll bar (${r0.btnFromEdge} px from the edge, bar ${r0.bar}), the text before it`,
        r0.h > 50 && r0.btnBottom <= 5 && r0.btnTop > 20 && r0.btnFromEdge >= r0.bar + 1 && r0.textGap >= 0);
    await leaveBox();
    await page.evaluate(() => { const n = window.__rg; n.__rgState().regions[0].prompt = ""; n.__rgRefresh(); }); await sleep(200);
    await setW("scene_prompt_positive", "a quiet harbour at dawn"); await setW("scene_prompt_negative", "blurry");

    // ---------------- the LLM Prompt Enhancer shows on scene_prompt_positive
    const llmState = () => page.evaluate(() => ({ state: !!window.__rg.__rgState().sceneLlm, row: !!document.querySelector(".rg-row.scene .rg-llm-btn")?.classList.contains("on") }));
    p = await corner(POS);
    check(`${M}: enhancer off: the corner button is dimmed, no outline around the box`, p.llm && !p.llmOn && !p.outline && !(await llmState()).state);
    const lb = await page.locator(`${POS} >> xpath=.. >> .rg-llm-corner`).boundingBox();
    await page.mouse.click(lb.x + lb.width / 2, lb.y + lb.height / 2); await sleep(700);
    p = await corner(POS); n = await corner(NEG);
    let ls = await llmState();
    check(`${M}: a click on it switches the enhancer on: the button is lit, the box has an outline, the Whole image row's button follows (${JSON.stringify(ls)})`, ls.state && ls.row && p.llmOn && p.outline && !n.outline);
    check(`${M}: the click didn't put the cursor in the text box`, await page.evaluate((sel) => document.activeElement !== document.querySelector(sel), POS));
    await page.evaluate(() => document.querySelector(".rg-row.scene .rg-llm-btn").click()); await sleep(700);
    p = await corner(POS); ls = await llmState();
    check(`${M}: switched off in the Whole image row: the corner button and the outline follow`, !ls.state && !p.llmOn && !p.outline);

    // ---------------- Undo / Redo and text
    const undoBtn = page.locator('.rg-bar [title^="Undo"]').first(), redoBtn = page.locator('.rg-bar [title^="Redo"]').first();
    const typeIn = async (sel, text, replace = true) => { await page.locator(sel).first().click(); if (replace) { await page.keyboard.press("Control+a"); await page.keyboard.press("Delete"); } else await page.keyboard.press("Control+End"); await page.keyboard.type(text); await sleep(150); };
    await typeIn(POS, "a red fox in deep snow");
    check(`${M}: while typing in the scene prompt, the Undo button is ready`, !(await undoBtn.isDisabled()));
    await leaveBox();
    c = await cv();
    await page.evaluate(() => window.__rg.__rgSetTool("shape"));
    await page.mouse.move(c[0] + c[2] * 0.65, c[1] + c[3] * 0.2); await page.mouse.down(); await page.mouse.move(c[0] + c[2] * 0.9, c[1] + c[3] * 0.45, { steps: 4 }); await page.mouse.up(); await sleep(300);
    const nLay = (await st()).layers.length;
    await typeIn(NEG, "watermark");
    await leaveBox();
    await undoBtn.click(); await sleep(250);
    check(`${M}: Undo, after clicking out of the box: the negative prompt's text goes back`, await W("scene_prompt_negative") === "blurry" && await page.locator(NEG).inputValue() === "blurry" && await W("scene_prompt_positive") === "a red fox in deep snow");
    await undoBtn.click(); await sleep(250);
    check(`${M}: Undo again: the shape drawn before it`, (await st()).layers.length === nLay - 1 && await W("scene_prompt_positive") === "a red fox in deep snow");
    await undoBtn.click(); await sleep(250);
    check(`${M}: Undo again: the positive prompt's text, as one step, in the widget and in the box`, await W("scene_prompt_positive") === "a quiet harbour at dawn" && await page.locator(POS).inputValue() === "a quiet harbour at dawn");
    await redoBtn.click(); await redoBtn.click(); await redoBtn.click(); await sleep(300);
    check(`${M}: Redo three times: all of it is back`, await W("scene_prompt_positive") === "a red fox in deep snow" && await W("scene_prompt_negative") === "watermark" && (await st()).layers.length === nLay);
    // the Undo keys in a box: that box's own text, also after other things were done
    await typeIn(POS, ", at dusk", false);
    await leaveBox();
    await page.locator(POS).first().click(); await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+z"); await sleep(120);
    const z1 = await W("scene_prompt_positive");
    await page.keyboard.press("Control+z"); await sleep(120);
    const z2 = await W("scene_prompt_positive");
    check(`${M}: back in the box: Ctrl+Z goes back through its own text, step by step (${JSON.stringify(z1)}, ${JSON.stringify(z2)})`, z1 !== "a red fox in deep snow, at dusk" && "a red fox in deep snow, at dusk".startsWith(z1) && z2.length < z1.length
        && await page.locator(POS).inputValue() === z2 && (await st()).layers.length === nLay);
    await page.keyboard.press("Control+y"); await page.keyboard.press("Control+y"); await sleep(150);
    check(`${M}: Ctrl+Y brings it back`, await W("scene_prompt_positive") === "a red fox in deep snow, at dusk");
    await leaveBox();
    // typed in the pop-up editor: one step too
    await page.evaluate((sel) => document.querySelector(sel).parentElement.querySelector(".rg-expand").click(), POS); await sleep(400);
    await page.locator(".rg-pop textarea").first().click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" POPUP"); await sleep(100);
    await page.keyboard.press("Escape"); await sleep(300);
    check(`${M}: text typed in the pop-up editor stays when it closes`, / POPUP$/.test(await W("scene_prompt_positive")));
    await undoBtn.click(); await sleep(250);
    check(`${M}: …and is one step of Undo`, await W("scene_prompt_positive") === "a red fox in deep snow, at dusk");
    // a change from outside the editor is a step of its own
    await page.evaluate(() => { const w = window.__rg.widgets.find((x) => x.name === "scene_prompt_negative"); w.value = "set from outside"; w.callback?.(w.value); }); await sleep(200);
    c = await cv(); await page.mouse.move(c[0] + c[2] * 0.5, c[1] + c[3] * 0.9); await page.keyboard.press("Control+z"); await sleep(250);
    check(`${M}: a scene prompt changed from outside the editor: Undo takes just that back`, await W("scene_prompt_negative") === "watermark" && await W("scene_prompt_positive") === "a red fox in deep snow, at dusk" && (await st()).layers.length === nLay);

    // ---------------- the Regional LoRAs node's own boxes: the Undo keys go through the box's text
    const RLP = 'textarea[data-rg-field="positive_prompt"]';
    if (await page.locator(RLP).count()) {
        await page.locator(RLP).first().click(); await page.keyboard.type("oil painting, thick strokes"); await sleep(120);
        await page.mouse.click(1650, 1050); await sleep(150);
        await page.locator(RLP).first().click(); await page.keyboard.press("Control+End"); await page.keyboard.press("Control+z"); await sleep(120);
        const rv = await page.locator(RLP).inputValue();
        check(`${M}: Regional LoRAs, positive_prompt: after clicking out and back, Ctrl+Z still takes typing back (${JSON.stringify(rv)})`, rv !== "oil painting, thick strokes" && "oil painting, thick strokes".startsWith(rv)
            && await page.evaluate(() => window.__rl.widgets.find((w) => w.name === "positive_prompt").value) === rv);
        await page.mouse.click(1650, 1050); await sleep(150);
    } else check(`${M}: Regional LoRAs: its positive_prompt box was found`, false);

    // ---------------- the bottom bar
    const foot = await page.evaluate((vue) => {
        const f = document.querySelector(".rg-foot"), fr = f.getBoundingClientRect(), k = fr.height / f.offsetHeight, tree = document.querySelector(".rg-tree").getBoundingClientRect();
        const n = window.__rg, ds = window.app.canvas.ds, cr = window.app.canvas.canvas.getBoundingClientRect();
        const below = vue ? null : (cr.top + (n.pos[1] + n.size[1] + ds.offset[1]) * ds.scale - fr.bottom) / k;
        const kids = [...f.querySelectorAll("button, select, .rg-seg")].filter((e) => e.getClientRects().length && !e.closest(".rg-seg > *") ).map((e) => { const r = e.getBoundingClientRect(); return Math.abs((r.top - fr.top) - (fr.bottom - r.bottom)) / k; });
        return { above: Math.round((fr.top - tree.bottom) / k * 10) / 10, below: below == null ? null : Math.round(below * 10) / 10, off: Math.round(Math.max(...kids) * 10) / 10, n: kids.length };
    }, vue);
    check(`${M}: every control of the bottom bar is in the middle of the bar's height (${foot.n} controls, at most ${foot.off} px off)`, foot.n >= 6 && foot.off <= 1);
    if (!vue) check(`${M}: the bar is half-way between the line above it and the node's lower edge (${foot.above} px above, ${foot.below} px below)`, Math.abs(foot.above - foot.below) <= 1 && foot.above >= 3);
    else check(`${M}: the bar keeps its usual room above it (${foot.above} px; the node's badge follows below)`, foot.above >= 2 && foot.above <= 5);

    // ---------------- nothing of the history survives loading a workflow, and none of it is in the saved workflow
    const saved = await page.evaluate(() => JSON.stringify(window.app.graph.serialize()));
    check(`${M}: the saved workflow holds the texts as they are now and nothing of the history (no earlier text, no steps)`, !/__scene|"steps"/.test(saved) && /a red fox in deep snow, at dusk/.test(saved)
        && !/a quiet harbour|POPUP|set from outside|blurry/.test(saved));
    await page.evaluate(async (s) => { await window.app.loadGraphData(JSON.parse(s)); await new Promise((r) => setTimeout(r, 2000));
        window.__rg = window.app.graph.nodes.find((x) => x.type === "Region-Genie_Main"); window.app.canvas.ds.offset = [0, 0]; window.app.canvas.ds.scale = 0.7; window.app.canvas.setDirty(true, true); await new Promise((r) => setTimeout(r, 1000)); }, saved);
    check(`${M}: after loading the workflow: the texts are there, Undo and Redo have nothing`, await W("scene_prompt_positive") === "a red fox in deep snow, at dusk" && await undoBtn.isDisabled() && await redoBtn.isDisabled());
    await page.locator(POS).first().click(); await page.keyboard.press("Control+End"); await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z"); await sleep(200);
    check(`${M}: …and Ctrl+Z in the box has no earlier text to go back to`, await W("scene_prompt_positive") === "a red fox in deep snow, at dusk");
    p = await corner(POS);
    check(`${M}: the loaded node's scene prompt has its buttons again`, p.llm && p.inBox && p.textGap >= 0);

    const errs = errors.filter((e) => !/ResizeObserver/.test(e));
    check(`${M}: no script errors${errs.length ? ` (${errs.slice(0, 2).join(" | ")})` : ""}`, !errs.length);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
