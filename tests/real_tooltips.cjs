// Every tooltip of the pack follows the owner's rules (tests/tooltip_rules.cjs): one item per line, sentences start with a
// capital letter unless they start with a lowercase field / option name. Collects them in the real ComfyUI frontend
// (CPU, no model files): the nodes' input / output tooltips and descriptions, the Settings, and the title of every
// control shown by the editors in many states (regions with LoRAs and palettes, Edit Mode, Control, each tool and tool
// version, the pop-up editors, the presets editor, LLM Settings, the color picker, Regional LoRAs, Save Image).
// Usage: node real_tooltips.cjs [vue]
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const { lintTooltip } = require("./tooltip_rules.cjs");
const vue = process.argv[2] === "vue";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(2000);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(300); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) {} await s.set("Comfy.VueNodes.Enabled", vue); }, vue);
    await sleep(800);
    const tips = new Map();                        // text -> where it was seen
    const add = (where, list) => { for (const t of list) if (t && !tips.has(t)) tips.set(t, where); };
    // every title shown in the pack's own elements (and the tooltips of hidden ones in these containers)
    const harvest = async (where) => add(where, await page.evaluate(() => {
        const roots = document.querySelectorAll(".rg-wrap, .rg-size, .rg-pop, .rg-fpop, .rg-presets, .rg-rl-wrap, .rg-llm-pop, .rg-cp, .rg-save-out, .rg-save-top, .rg-toolopts");
        const out = new Set();
        // not the prompt fields' own text (a field's title can be what's typed in it)
        const own = (e) => (e.tagName === "TEXTAREA" || e.tagName === "INPUT") && e.value && e.title.startsWith(e.value);
        for (const r of roots) { if (r.title) out.add(r.title); for (const e of r.querySelectorAll("[title]")) if (e.title && !own(e)) out.add(e.title); }
        return [...out];
    }));

    // node definitions and Settings
    add("node definitions", await page.evaluate(async () => {
        const d = await (await fetch("/object_info")).json(), out = [];
        for (const [k, v] of Object.entries(d)) {
            if (!k.startsWith("Region-Genie_")) continue;
            for (const g of ["required", "optional"]) for (const spec of Object.values(v.input[g] || {})) if (spec[1]?.tooltip) out.push(spec[1].tooltip);
            out.push(...(v.output_tooltips || []).filter(Boolean));
            if (v.description) out.push(v.description);
        }
        return out;
    }));
    add("Settings", await page.evaluate(() => Object.values(window.app.ui.settings.settingsParamLookup).filter((d) => /^RegionGenie/.test(d.id)).map((d) => d.tooltip).filter(Boolean)));

    // the Region Genie node in many states
    await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [40, 40]; app.graph.add(rg); window.__rg = rg;
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 0.7; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 1500));
        const st = rg.__rgState();
        st.regions.push({ id: 1, color: "#E6194B", prompt: "a red cat", type: "object", text: "", loras: [{ lora: "style.safetensors", strength: 0.8, on: true }],
                          palette: ["#ff0000", "#00ff00"], paletteOn: true },
                        { id: 2, color: "#3CB44B", prompt: "a sign", type: "text", text: "OPEN", hidden: true });
        st.sceneLoras = [{ lora: "scene.safetensors", strength: 1, on: true }];
        const L = (id, region, ox, shape = "rect") => ({ id, name: "L" + id, region, visible: true, shape, sides: 5, bw: .5, bh: 1, sx: 1, sy: 1, rot: 0, ox, oy: 0, ops: [] });
        st.layers.push(L(1, 1, -.25), L(2, 2, .25, "star"));
        rg.__rgRefresh();
        await new Promise((r) => setTimeout(r, 500));
        [...document.querySelectorAll(".rg-wrap button")].find((b) => b.textContent.trim() === "▼ All")?.click();
        await new Promise((r) => setTimeout(r, 400));
    });
    await harvest("Region Genie node");
    add("tool versions", await page.evaluate(() => window.__rg.__rgToolTips()));
    for (const t of ["select", "shape", "brush", "lasso", "fill", "wand", "object", "erase", "lassoErase"]) {
        await page.evaluate((t) => window.__rg.__rgSetTool(t), t); await sleep(120); await harvest("tool " + t);
    }
    for (const m of ["MOSS-Image", "Ideogram 4", "Krea 2", ""]) { await page.selectOption("select.rg-model", m).catch(() => {}); await sleep(400); await harvest("model " + (m || "auto")); }
    // size row modes
    for (const re of [/presets list/, /typed in/, /aspect ratio/]) {
        await page.evaluate((src) => [...document.querySelectorAll(".rg-size button")].find((b) => new RegExp(src).test(b.title))?.click(), re.source); await sleep(300); await harvest("size row");
    }
    await page.evaluate(() => { const s = document.querySelector("select.rg-size-pre"); });
    // Edit Mode and Control
    await page.evaluate(() => [...document.querySelectorAll(".rg-settings button")].find((b) => b.textContent.trim() === "Edit")?.click()); await sleep(500);
    await page.evaluate(async () => { const st = window.__rg.__rgState(); st.editLoras = [{ lora: "x.safetensors", strength: 1, on: true }]; window.__rg.__rgRefresh(); await new Promise((r) => setTimeout(r, 400)); });
    await harvest("Edit Mode");                                   // the Edit rows (Settings' and the node's own), ＋Edit
    await page.evaluate(async () => { const st = window.__rg.__rgState(); st.editOff = true; window.__rg.__rgRefresh(); await new Promise((r) => setTimeout(r, 400)); });
    await harvest("Edit Mode, Settings row removed");
    await page.evaluate(async () => { const st = window.__rg.__rgState(); delete st.editOff; delete st.editLoras; window.__rg.__rgRefresh(); });
    await page.evaluate(() => [...document.querySelectorAll(".rg-settings button")].find((b) => b.textContent.trim() === "Generate")?.click()); await sleep(300);
    await page.evaluate(async () => { const st = window.__rg.__rgState(); st.controls = [{ kind: "depth", strength: 1, start: 0, end: 1 }, { kind: "canny", strength: 1, start: 0, end: 1 }]; window.__rg.__rgRefresh(); await new Promise((r) => setTimeout(r, 500)); });
    await harvest("Control");
    // pop-ups: scene and region, then the presets editor, the LLM settings, a color picker
    await page.evaluate(() => document.querySelector(".rg-scene-ta")?.parentElement?.querySelector(".rg-expand")?.click()); await sleep(400); await harvest("scene pop-up");
    await page.keyboard.press("Escape"); await sleep(200);
    await page.evaluate(() => document.querySelector(".rg-list .rg-pwrap .rg-expand")?.click()); await sleep(400); await harvest("region pop-up");
    await page.keyboard.press("Escape"); await sleep(200);
    await page.evaluate(() => [...document.querySelectorAll(".rg-size button")].find((b) => /presets list/.test(b.title))?.click()); await sleep(200);
    await page.locator("select.rg-size-pre").first().selectOption("__edit__").catch(() => {}); await sleep(400); await harvest("presets editor");
    await page.mouse.click(1550, 1050); await sleep(200);
    await page.evaluate(() => document.querySelector(".rg-llmset")?.click()); await sleep(800); await harvest("LLM settings");
    await page.keyboard.press("Escape"); await page.mouse.click(1550, 1050); await sleep(300);
    await page.evaluate(() => document.querySelector(".rg-list .rg-sw")?.click()); await sleep(500); await harvest("color picker");
    await page.keyboard.press("Escape"); await sleep(200);

    // the other nodes
    await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rl = LG.createNode("Region-Genie_RegionalLoRAs"); rl.pos = [40, 40]; app.graph.add(rl);
        rl.widgets.find((w) => w.name === "loras_data").value = JSON.stringify({ rows: [{ on: true, index: 0, lora: "a.safetensors", strength: 1, prompt: "row" }] });
        rl.onConfigure?.({});
        const sv = LG.createNode("Region-Genie_SaveImage"); sv.pos = [700, 40]; app.graph.add(sv);
        for (const n of ["Region-Genie_MaskPicker", "Region-Genie_BBoxToMasks", "Region-Genie_CreateHookLoRA"]) { const x = LG.createNode(n); x.pos = [40, 700]; app.graph.add(x); }
        app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 1500));
    });
    await harvest("other nodes");
    await page.evaluate(() => { const t = [...document.querySelectorAll(".rg-rl-wrap textarea")][0]; t?.parentElement?.querySelector(".rg-expand")?.click(); }); await sleep(400);
    await harvest("Regional LoRAs pop-up");

    // the rules
    let bad = 0;
    for (const [t, where] of tips) {
        const p = lintTooltip(t);
        if (!p.length) continue;
        bad++;
        console.log(`FAIL [${where}] ${t.replace(/\n/g, "⏎").slice(0, 140)}\n     ${p.join("\n     ")}`);
        if (process.env.TOOLTIP_DUMP) require("fs").appendFileSync(process.env.TOOLTIP_DUMP, JSON.stringify([where, t]) + "\n");
    }
    console.log(`${tips.size} tooltips checked (${vue ? "Nodes 2.0" : "legacy"}), ${bad} break the rules` + (errors.length ? `; page errors: ${errors.slice(0, 2).join(" | ")}` : ""));
    await browser.close();
    console.log(bad || errors.length ? `${bad + errors.length} failed` : "all passed");
    process.exit(bad || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
