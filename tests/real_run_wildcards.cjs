// Round 9 checks in the real ComfyUI frontend + server (CPU; no model files needed).
// Usage: node real_run_wildcards.cjs [vue]   ("vue" = Nodes 2.0). Needs ComfyUI on 127.0.0.1:8188 with this pack (and Impact Pack
// for the wildcard checks).
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const vue = process.argv[2] === "vue";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && /region|rg_|genie/i.test(m.text())) errors.push(m.text()); });
    await page.goto("http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await page.waitForTimeout(2000);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
    await page.evaluate(async (vue) => {
        const s = window.app.extensionManager.setting;
        try { await s.set("Comfy.TutorialCompleted", true); } catch (e) {}
        await s.set("Comfy.VueNodes.Enabled", vue);
    }, vue);
    await page.waitForTimeout(1000);
    const M = vue ? "Nodes 2.0" : "legacy";

    // ---------------- a new node: the size row
    const made = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); await new Promise((r) => setTimeout(r, 30)); await rg.__rgShowAll();
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        window.__rg = rg;
        await new Promise((r) => setTimeout(r, 1500));
        const W = (n) => rg.widgets.find((w) => w.name === n);
        return { first: rg.widgets[0].name, hidden: W("width").hidden && W("height").hidden, size: rg.properties.rg_size?.mode,
                 wv: [W("width").value, W("height").value],
                 inputs: rg.inputs.filter((i) => !i.widget).map((i) => i.label || i.name),
                 widthSockets: rg.inputs.filter((i) => i.name === "width" || i.name === "height").length };
    });
    check(`${M}: size row is the first widget, width / height hidden`, made.first === "rg_size" && made.hidden);
    check(`${M}: new node starts in aspect ratio mode, 1024 x 1024`, made.size === "aspect ratio" && JSON.stringify(made.wv) === "[1024,1024]");
    check(`${M}: the 'width' / 'height' inputs (when shown) are labelled so, no old width / height sockets`, made.inputs.includes("width") && made.inputs.includes("height") && made.widthSockets === 0);
    const row = page.locator(".rg-size").first();
    const rb = await row.boundingBox();
    check(`${M}: the row is one line (${Math.round(rb?.height)} px)`, rb && rb.height >= 18 && rb.height <= 30);
    await row.locator("select.rg-sel").first().selectOption("16:9 (Widescreen)");
    await page.waitForTimeout(200);
    const wv2 = await page.evaluate(() => ["width", "height"].map((n) => window.__rg.widgets.find((w) => w.name === n).value));
    check(`${M}: 16:9 sets 1368 x 768 (as Resolution Selector)`, JSON.stringify(wv2) === "[1368,768]");
    await page.screenshot({ path: require("path").join(__dirname, "out", `real9_${vue ? "vue" : "legacy"}.png`), clip: { x: 0, y: 0, width: 800, height: 700 } });

    // ---------------- a workflow saved before the size row: no rg_size
    const old = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        const g = app.graph.serialize();
        const n = g.nodes.find((x) => x.type === "Region-Genie_Main");
        delete n.properties.rg_size;
        n.properties.rg_widget_values = { ...(n.properties.rg_widget_values || {}), width: 832, height: 1216 };
        const wv = n.widgets_values; if (Array.isArray(wv)) { const i = wv.indexOf(1368); if (i >= 0) { wv[i] = 832; wv[i + 1] = 1216; } }
        await app.loadGraphData(g);
        await new Promise((r) => setTimeout(r, 1500));
        const rg = app.graph.nodes.find((x) => x.type === "Region-Genie_Main"); window.__rg = rg;
        const W = (k) => rg.widgets.find((w) => w.name === k).value;
        return { mode: rg.properties.rg_size?.mode, wv: [W("width"), W("height")], out: document.querySelector(".rg-size-out")?.textContent };
    });
    check(`${M}: old workflow opens in manual mode with its size`, old.mode === "manual" && JSON.stringify(old.wv) === "[832,1216]");
    // (round 103: a wire into the old 'width' field's socket is no longer moved to the width input; that check went with the step)

    // ---------------- a real run: Resolution Selector into width / height, one region hidden
    const run = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rs = LG.createNode("ResolutionSelector"); rs.pos = [-300, 40]; app.graph.add(rs);
        rs.widgets.find((w) => w.name === "aspect_ratio").value = "16:9 (Widescreen)";
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); await new Promise((r) => setTimeout(r, 30)); await rg.__rgShowAll(); window.__rg = rg;
        rs.connect(0, rg, rg.inputs.findIndex((i) => i.name === "width_in"));
        rs.connect(1, rg, rg.inputs.findIndex((i) => i.name === "height_in"));
        const pv = LG.createNode("PreviewImage"); pv.pos = [900, 40]; app.graph.add(pv);
        rg.connect(rg.outputs.findIndex((o) => o.name === "color_map"), pv, 0);
        await new Promise((r) => setTimeout(r, 800));
        const st = rg.__rgState();
        st.regions.push({ id: 1, color: "#E6194B", prompt: "left", type: "object", text: "" },
                        { id: 2, color: "#3CB44B", prompt: "right", type: "object", text: "", hidden: true });
        const L = (id, region, ox) => ({ id, name: "Rect " + id, region, visible: true, shape: "rect", sides: 5, bw: 16 / 9 / 2, bh: 1, sx: 1, sy: 1, rot: 0, ox, oy: 0, ops: [] });
        st.layers.push(L(1, 1, -16 / 9 / 4), L(2, 2, 16 / 9 / 4));
        rg.__rgRefresh();
        await new Promise((r) => setTimeout(r, 300));
        const shown = document.querySelector(".rg-size-out")?.textContent;
        await fetch("/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
        await app.queuePrompt(0, 1);
        let out = null;
        for (let i = 0; i < 120 && !out; i++) {
            await new Promise((r) => setTimeout(r, 500));
            const h = await (await fetch("/history")).json();
            const e = Object.values(h).find((x) => Object.values(x.outputs || {}).some((o) => o.images));
            if (e) out = { status: e.status?.status_str, img: Object.values(e.outputs).find((o) => o.images).images[0] };
        }
        if (!out) return { shown, err: "no output" };
        const img = new Image(); img.src = `/view?filename=${encodeURIComponent(out.img.filename)}&type=${out.img.type}&subfolder=${encodeURIComponent(out.img.subfolder || "")}`;
        await img.decode();
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        const at = (x, y) => [...g.getImageData(Math.floor(x * img.width), Math.floor(y * img.height), 1, 1).data].slice(0, 3);
        return { shown, status: out.status, size: [img.width, img.height], left: at(0.25, 0.5), right: at(0.75, 0.5) };
    });
    check(`${M}: row shows the input size before the run (${run.shown})`, /1368 × 768/.test(run.shown || ""));
    check(`${M}: run ok, output 1368 x 768 from the Resolution Selector`, run.status === "success" && JSON.stringify(run.size) === "[1368,768]");
    check(`${M}: shown region in the color map, hidden region black`, run.left?.some((v) => v > 40) && run.right?.every((v) => v < 10));

    // ---------------- round 10: expand buttons, the pop-up editor (drag, resize, A+), no node drag underneath
    const r10 = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); await new Promise((r) => setTimeout(r, 30)); await rg.__rgShowAll(); window.__rg = rg;
        app.canvas.ds.offset = [0, -200]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);    // the pop-up fully on screen
        await new Promise((r) => setTimeout(r, 1500));
        const tas = [...document.querySelectorAll("textarea.rg-scene-ta")].filter((t) => t.offsetParent);
        return { n: tas.length, btns: tas.filter((t) => t.parentElement.querySelector(":scope > .rg-expand")).length, pos: [...rg.pos] };
    });
    // round 12: scene_prompt_background shows only for Ideogram 4 (the model isn't known here)
    check(`${M}: an expand button on each scene prompt shown (2: positive, negative)`, r10.n === 2 && r10.btns === 2);
    const sceneTa = page.locator("textarea.rg-scene-ta").first();
    await sceneTa.fill("a quiet harbour at dawn");
    await sceneTa.dblclick(); await page.waitForTimeout(200);
    check(`${M}: double-click in a scene prompt selects a word, no pop-up`, await page.locator(".rg-pop").count() === 0
        && await page.evaluate(() => { const t = document.activeElement; return t?.tagName === "TEXTAREA" && t.selectionEnd > t.selectionStart; }));
    await sceneTa.hover();
    await page.locator("textarea.rg-scene-ta").first().locator("xpath=..").locator(":scope > .rg-expand").click();
    await page.waitForTimeout(300);
    const spop = page.locator(".rg-pop").first();
    check(`${M}: the expand button opens the scene pop-up`, await spop.count() === 1);
    const b1 = await spop.boundingBox();
    const sh = await spop.locator(".rg-pop-head").boundingBox();
    await page.mouse.move(sh.x + 40, sh.y + sh.height / 2); await page.mouse.down();
    await page.mouse.move(sh.x + 40 + 30, sh.y + sh.height / 2 + 60, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(150);
    const b2 = await spop.boundingBox();
    const nodePos = await page.evaluate(() => [...window.__rg.pos]);
    check(`${M}: dragging the title bar moves the pop-up, not the node`, b2.y - b1.y > 40 && JSON.stringify(nodePos) === JSON.stringify(r10.pos));
    const g = await spop.locator(".rg-pop-grip").boundingBox();
    await page.mouse.move(g.x + 6, g.y + 6); await page.mouse.down();
    await page.mouse.move(g.x + 6 - 80, g.y + 6 + 100, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(150);
    const b3 = await spop.boundingBox();
    check(`${M}: the corner grip resizes it`, b3.width < b2.width - 40 && b3.height > b2.height + 40);
    await spop.locator(".rg-pop-font", { hasText: "A+" }).click(); await page.waitForTimeout(100);
    const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".rg-pop textarea")).fontSize));
    check(`${M}: A+ makes the pop-up text larger (${fs} px)`, fs === 15);
    await page.keyboard.press("Escape"); await page.waitForTimeout(100);
    // put the shared Settings back for the next run of this test
    await page.evaluate(async () => { const s = window.app.extensionManager.setting; await s.set("RegionGenie.Text.PopupScene", 14); await s.set("RegionGenie.Popup.Sizes", "{}"); });

    // ---------------- round 10: Control (no model files here: the run notes it, the map overlay is fed a run's image)
    const c10 = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); await new Promise((r) => setTimeout(r, 30)); await rg.__rgShowAll(); window.__rg = rg;
        const pv = LG.createNode("PreviewImage"); pv.pos = [900, 40]; app.graph.add(pv);
        rg.connect(rg.outputs.findIndex((o) => o.name === "color_map"), pv, 0);
        app.canvas.ds.offset = [0, -560]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 1500));
        const st = rg.__rgState();
        st.regions.push({ id: 1, color: "#E6194B", prompt: "a boat", type: "object", text: "" });
        st.layers.push({ id: 1, name: "Rect 1", region: 1, visible: true, shape: "rect", sides: 5, bw: 0.5, bh: 1, sx: 1, sy: 1, rot: 0, ox: -0.25, oy: 0, ops: [] });
        rg.__rgRefresh();
        await new Promise((r) => setTimeout(r, 300));
        return { lastInputs: rg.inputs.filter((i) => !i.widget).map((i) => i.name).filter((x) => ["control_image", "width_in", "height_in"].includes(x)), setting: app.extensionManager.setting.get("RegionGenie.Control.MOSS"),
                 row: !![...document.querySelectorAll(".rg-list .rg-row.scene button")].find((b) => b.textContent.trim() === "＋Control") && !document.querySelector(".rg-list .rg-row.ctrl:not(.edit)") };
    });
    check(`${M}: no control_image input before a Control row; ＋Control and its Settings exist`, JSON.stringify(c10.lastInputs.slice().sort()) === '["height_in","width_in"]' && c10.row && c10.setting === "(none)");
    await page.evaluate(() => [...document.querySelectorAll(".rg-list .rg-row.scene button")].find((b) => b.textContent.trim() === "＋Control").click());
    await page.waitForTimeout(200);
    const c11 = await page.evaluate(async () => {
        const app = window.app, rg = window.__rg;
        await fetch("/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
        await app.queuePrompt(0, 1);
        let out = null;
        for (let i = 0; i < 120 && !out; i++) {
            await new Promise((r) => setTimeout(r, 500));
            const e = Object.values(await (await fetch("/history")).json())[0];
            if (e?.status?.status_str) out = e;
        }
        const o = out?.outputs?.[String(rg.id)], img = Object.values(out?.outputs || {}).find((x) => x.images)?.images?.[0];
        return { status: out?.status?.status_str, info: o?.region_info?.[0] || "", img };
    });
    check(`${M}: a run with control on and no model: runs, and says why control isn't used`, c11.status === "success" && /control: no model is connected/.test(c11.info));
    // the map overlay: hand the editor a run's image as its control map
    const ov = await page.evaluate(async (img) => {
        const rg = window.__rg;
        rg.onExecuted({ control_map: [img] });
        await new Promise((r) => setTimeout(r, 800));
        const eye = document.querySelector(".rg-list .rg-row.ctrl .rg-btn.icon");
        const before = !!eye && !eye.disabled;
        eye?.click();
        await new Promise((r) => setTimeout(r, 300));
        return { enabled: before, shown: eye ? /Hide this row's control map/.test(document.querySelector(".rg-list .rg-row.ctrl .rg-btn.icon").title) : false };
    }, c11.img);
    check(`${M}: after a run the control map can be shown on the canvas`, ov.enabled && ov.shown);
    await page.evaluate(() => { document.querySelector('.rg-list .rg-row.ctrl:not(.edit) button[title^="Remove this Control row"]')?.click(); });

    // ---------------- the model guess and the missing-file message (round 10)
    const g10 = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const ld = LG.createNode("UNETLoader"); ld.pos = [-400, 40]; app.graph.add(ld);
        ld.widgets.find((w) => w.name === "unet_name").value = "moss_image_sft_int8_convrot.safetensors";
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); await new Promise((r) => setTimeout(r, 30)); await rg.__rgShowAll(); window.__rg = rg;
        ld.connect(0, rg, rg.inputs.findIndex((i) => i.name === "model"));
        app.canvas.ds.offset = [0, -560]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 1800));
        const sel = document.querySelector(".rg-settings select.rg-model");
        return { first: sel?.options[0]?.textContent };
    });
    check(`${M}: the model is guessed from the loader before any run (${g10.first})`, g10.first === "auto · MOSS-Image");
    await page.evaluate(() => [...document.querySelectorAll(".rg-list .rg-row.scene button")].find((b) => b.textContent.trim() === "＋Control").click());
    await page.waitForTimeout(400);
    const mtxt = await page.locator(".rg-msg").first().textContent().catch(() => "");
    check(`${M}: control on with no MOSS LoRA set: the message gives the official link and folder`,
        /moss_image_color_depth_control\.safetensors/.test(mtxt) && /ComfyUI\/models\/loras/.test(mtxt)
        && await page.locator(".rg-msg a").first().getAttribute("href") === "https://huggingface.co/Comfy-Org/MOSS-Image/resolve/main/loras/moss_image_color_depth_control.safetensors");
    await page.evaluate(() => document.querySelector('.rg-list .rg-row.ctrl:not(.edit) button[title^="Remove this Control row"]').click());
    await page.waitForTimeout(200);

    // ---------------- round 11: the toolbar stays one row with every tool (default node width)
    const rowsOk = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); await new Promise((r) => setTimeout(r, 30)); await rg.__rgShowAll();
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 1200));
        const bar = document.querySelector(".rg-bar"), sink = document.querySelector(".rg-keysink");
        let ok = true;
        for (const k of ["v", "r", "b", "l", "f", "w", "q", "e"]) {
            sink.focus(); sink.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
            await new Promise((r) => setTimeout(r, 60));
            if (bar.offsetHeight > 32) ok = false;                // one row is 22-26 px; a wrapped one about 50
        }
        return ok;
    });
    check(`${M}: the row of tools stays one row with every tool`, rowsOk);

    // ---------------- round 41: a character region carries the drawn person mark in the Regional LoRAs node's list
    const mk = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); await new Promise((r) => setTimeout(r, 30)); await rg.__rgShowAll();
        const st = rg.__rgState();
        const rect = (id, rid, ox) => ({ id, name: "Rect " + id, region: rid, visible: true, shape: "rect", sides: 5, bw: 0.4, bh: 0.8, sx: 1, sy: 1, rot: 0, ox, oy: 0, ops: [] });
        st.regions.push({ id: 1, color: "#8F73D1", prompt: "a knight in silver armor", type: "character", text: "" }, { id: 2, color: "#E3B341", prompt: "a stone wall", type: "object", text: "" });
        st.layers.push(rect(1, 1, -0.25), rect(2, 2, 0.25));
        rg.__rgRefresh();
        const n = LG.createNode("Region-Genie_RegionalLoRAs"); n.pos = [820, 40]; app.graph.add(n);
        rg.connect(rg.outputs.findIndex((o) => o.name === "masks"), n, n.inputs.findIndex((i) => i.name === "masks"));
        await new Promise((r) => setTimeout(r, 600));
        for (let i = 0; i < 2; i++) { [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "+ Add LoRA").click(); await new Promise((r) => setTimeout(r, 300)); }
        await new Promise((r) => setTimeout(r, 1500));
        return [...document.querySelectorAll(".rg-rl-region")].map((e) => ({ text: e.textContent, mark: !!e.querySelector(".rg-rl-mark svg path"), title: e.title || e.dataset.rgTip || "" }));
    });
    check(`${M}: Regional LoRAs: the character region's row shows the drawn person mark before its prompt, the object region's doesn't (${JSON.stringify(mk).slice(0, 220)})`,
        mk.length === 2 && mk[0].mark && mk[0].text === "a knight in silver armor" && /Type: Character\./.test(mk[0].title) && !mk[1].mark && !/[\u{1F464}\u{1F512}]/u.test(mk.map((x) => x.text).join("")));

    // ---------------- round 11: Regional LoRAs — positive_prompt (renamed), old workflows, the floating pop-up editor
    const rl = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); await new Promise((r) => setTimeout(r, 30)); await rg.__rgShowAll();
        const n = LG.createNode("Region-Genie_RegionalLoRAs"); n.pos = [820, 40]; app.graph.add(n);
        rg.connect(rg.outputs.findIndex((o) => o.name === "prompt"), n, n.inputs.findIndex((i) => i.name === "positive_prompt"));
        n.widgets.find((w) => w.name === "negative_prompt").value = "blurry";
        await new Promise((r) => setTimeout(r, 800));
        const g = app.graph.serialize();
        // the same workflow as saved before the rename: 'prompt' instead of 'positive_prompt'
        const sn = g.nodes.find((x) => x.type === "Region-Genie_RegionalLoRAs");
        for (const i of sn.inputs || []) if (i.name === "positive_prompt") { i.name = "prompt"; if (i.widget) i.widget.name = "prompt"; i.label = undefined; i.localized_name = undefined; }
        const wv = sn.properties.rg_widget_values || {};
        sn.properties.rg_widget_values = Object.fromEntries(Object.entries(wv).map(([k, v]) => [k === "positive_prompt" ? "prompt" : k, v]));
        await app.loadGraphData(g);
        await new Promise((r) => setTimeout(r, 1500));
        const m = app.graph.nodes.find((x) => x.type === "Region-Genie_RegionalLoRAs"), r2 = app.graph.nodes.find((x) => x.type === "Region-Genie_Main");
        window.__rl = m;
        const pin = m.inputs.find((i) => i.name === "positive_prompt");
        const l = pin?.link != null ? (app.graph.links.get?.(pin.link) ?? app.graph.links[pin.link]) : null;
        return { has: !!m.widgets.find((w) => w.name === "positive_prompt"), old: m.inputs.some((i) => i.name === "prompt"),
                 linked: !!l && String(l.origin_id) === String(r2.id), neg: m.widgets.find((w) => w.name === "negative_prompt").value };
    });
    check(`${M}: Regional LoRAs: 'positive_prompt' (renamed from 'prompt')`, rl.has);
    check(`${M}: an old workflow's 'prompt' link moves to positive_prompt, values kept`, rl.linked && !rl.old && rl.neg === "blurry");
    const rlPos = await page.evaluate(() => { const app = window.app; app.canvas.ds.offset = [-700, 0]; app.canvas.setDirty(true, true); return [...window.__rl.pos]; });
    await page.waitForTimeout(600);
    await page.evaluate(() => { const t = [...document.querySelectorAll("textarea")].find((x) => x.value === "blurry"); if (t) t.dataset.rgtest = "neg"; });
    const negTa = page.locator('textarea[data-rgtest="neg"]').first();
    const negExp = negTa.locator("xpath=..").locator(":scope > .rg-expand");
    check(`${M}: Regional LoRAs: an expand button on negative_prompt`, await negExp.count() === 1);
    await negTa.hover(); await negExp.click(); await page.waitForTimeout(300);
    const fp = page.locator(".rg-fpop");
    check(`${M}: it opens the floating pop-up editor with the text`, await fp.count() === 1 && await fp.locator("textarea").inputValue() === "blurry");
    await fp.locator("textarea").press("End"); await fp.locator("textarea").type(", jpeg artifacts");
    await fp.locator(".rg-fpop-font", { hasText: "A+" }).click();
    const f1 = await fp.locator("textarea").evaluate((t) => parseFloat(getComputedStyle(t).fontSize));
    const fhb = await fp.locator(".rg-fpop-head").boundingBox();
    await page.mouse.move(fhb.x + 30, fhb.y + 8); await page.mouse.down(); await page.mouse.move(fhb.x + 90, fhb.y + 68, { steps: 5 }); await page.mouse.up();
    const fb1 = await fp.boundingBox();
    const fgb = await fp.locator(".rg-fpop-grip").boundingBox();
    await page.mouse.move(fgb.x + 6, fgb.y + 6); await page.mouse.down(); await page.mouse.move(fgb.x + 86, fgb.y + 66, { steps: 5 }); await page.mouse.up();
    const fb2 = await fp.boundingBox();
    check(`${M}: pop-up: A+ (${f1} px), drag moves it, the grip resizes it, the node stays put`, f1 === 15 && Math.abs(fb1.x - fhb.x - 52) < 30
        && fb2.width > fb1.width + 60 && JSON.stringify(await page.evaluate(() => [...window.__rl.pos])) === JSON.stringify(rlPos));
    // round 42: the text of a pop-up always stays. Enter is a new line; Esc and the close button close it; Undo / Redo
    const negV = () => page.evaluate(() => window.__rl.widgets.find((w) => w.name === "negative_prompt").value);
    const fHist = () => page.evaluate(() => ["undo", "redo"].map((ic) => !document.querySelector(`.rg-fpop-head .rg-hist[data-ic="${ic}"]`)?.disabled).join());
    const fOrder = await page.evaluate(() => [...document.querySelectorAll(".rg-fpop-head > button")].filter((e) => getComputedStyle(e).display !== "none")
        .map((e) => e.dataset.ic || (e.classList.contains("rg-x") ? "close" : e.textContent.trim() || "icon")).join(" "));
    check(`${M}: pop-up title bar: ◀ ▶, Undo, Redo, A− A+, …, close (${fOrder})`, /^◀ ▶ undo redo A− A\+ (icon )?close$/.test(fOrder));
    const fBottom = await page.evaluate(() => [...document.querySelectorAll(".rg-fpop-ctl > *")].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.classList.contains("rg-ac-btn") ? "tag" : "wildcard").join(" "));
    check(`${M}: …and below the text, on the right: the tag autocomplete switch and the wildcard button (${fBottom})`, fBottom === "tag wildcard"
        && await page.evaluate(() => { const c = document.querySelector(".rg-fpop-ctl").getBoundingClientRect(), b = document.querySelector(".rg-fpop").getBoundingClientRect(), l = [...document.querySelectorAll(".rg-fpop-ctl > *")].pop().getBoundingClientRect(), t = document.querySelector(".rg-fpop textarea").getBoundingClientRect();
            return c.top >= t.bottom - 1 && l.right > b.right - 40; }));
    await fp.locator("textarea").press("Enter"); await fp.locator("textarea").type("second line"); await page.waitForTimeout(200);
    check(`${M}: Enter is a new line and the pop-up stays open`, await fp.count() === 1 && await negV() === "blurry, jpeg artifacts\nsecond line");
    await page.keyboard.press("Control+z"); await page.waitForTimeout(80);
    const z1 = await negV();
    await page.keyboard.press("Control+y"); await page.waitForTimeout(80);
    check(`${M}: Ctrl+Z / Ctrl+Y in the text box take the last typing back and bring it again (${JSON.stringify(z1)})`, z1 !== "blurry, jpeg artifacts\nsecond line" && "blurry, jpeg artifacts\nsecond line".startsWith(z1) && await negV() === "blurry, jpeg artifacts\nsecond line");
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    check(`${M}: Esc closes it and the field keeps the text`, await fp.count() === 0 && await negV() === "blurry, jpeg artifacts\nsecond line");
    await negExp.click(); await page.waitForTimeout(200);
    check(`${M}: opened again: Undo still has the steps (${await fHist()})`, await fHist() === "true,false");
    let fSteps = 0;
    while ((await fHist()).startsWith("true") && fSteps < 20) { await page.locator('.rg-fpop-head .rg-hist[data-ic="undo"]').click(); await page.waitForTimeout(40); fSteps++; }
    check(`${M}: the Undo button, step by step, goes back to the text the field had at the start (${fSteps} steps)`, fSteps >= 2 && await negV() === "blurry" && await fp.locator("textarea").inputValue() === "blurry");
    await page.locator('.rg-fpop-head .rg-hist[data-ic="redo"]').click(); await page.waitForTimeout(60);
    check(`${M}: Redo brings a step back`, (await negV()).startsWith("blurry") && (await negV()).length > 6);
    while ((await fHist()).endsWith("true")) { await page.locator('.rg-fpop-head .rg-hist[data-ic="redo"]').click(); await page.waitForTimeout(40); }
    await page.keyboard.press("Control+z"); await page.waitForTimeout(60);      // "second line" goes: one line again, as the checks below expect
    while (/\n/.test(await negV())) { await page.keyboard.press("Control+z"); await page.waitForTimeout(40); }
    await page.locator(".rg-fpop textarea").type(" EXTRA");
    await page.locator(".rg-fpop-head .rg-x").click(); await page.waitForTimeout(150);
    const afterX = await negV();
    check(`${M}: the close button closes it and the text stays (${JSON.stringify(afterX)})`, await fp.count() === 0 && / EXTRA$/.test(afterX));
    await page.evaluate(() => { const n = window.__rl, w = n.widgets.find((x) => x.name === "negative_prompt"); w.value = "blurry, jpeg artifacts"; w.callback?.(w.value); });
    await page.evaluate(async () => { const s = window.app.extensionManager.setting; await s.set("RegionGenie.Text.PopupScene", 14); await s.set("RegionGenie.Popup.Sizes", "{}"); });

    // ---------------- wildcards (needs Impact Pack, and a wildcards/rgtest/color.txt file in it)
    const wcInstalled = await page.evaluate(async () => (await (await fetch("/region_genie/wildcards")).json()).installed);
    if (!wcInstalled) console.log("SKIP wildcards: Impact Pack is not installed");
    else {
        const wc = await page.evaluate(async () => {
            const app = window.app, LG = window.LiteGraph;
            app.graph.clear();
            const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); await new Promise((r) => setTimeout(r, 30)); await rg.__rgShowAll(); window.__rg = rg;
            const pv = LG.createNode("PreviewImage"); pv.pos = [900, 40]; app.graph.add(pv);
            rg.connect(rg.outputs.findIndex((o) => o.name === "color_map"), pv, 0);
            await new Promise((r) => setTimeout(r, 1200));
            const seedW = rg.widgets.find((w) => w.name === "wildcard_seed");
            const ctl = document.querySelector(".rg-wc");
            const before = (await app.graphToPrompt()).output[rg.id].inputs.wildcard_seed;
            const st = rg.__rgState();
            st.regions.push({ id: 1, color: "#E6194B", prompt: "a __rgtest/color__ car", type: "object", text: "" });
            st.layers.push({ id: 1, name: "Rect 1", region: 1, visible: true, shape: "rect", sides: 5, bw: 1, bh: 1, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, ops: [] });
            rg.__rgRefresh();
            seedW.value = 5; rg.properties.rg_wc_mode = "fixed";
            app.canvas.ds.offset = [0, -560]; app.canvas.setDirty(true, true);       // the list and the footer in view
            await new Promise((r) => setTimeout(r, 400));
            const after = (await app.graphToPrompt()).output[rg.id].inputs.wildcard_seed;
            return { hidden: !!seedW.hidden, socket: rg.inputs.some((i) => i.name === "wildcard_seed"), shown: !!ctl && getComputedStyle(ctl).display !== "none",
                     before, after };
        });
        check(`${M}: wildcard seed control in the footer, hidden widget, no socket`, wc.shown && wc.hidden && !wc.socket);
        check(`${M}: seed sent as 0 while no field has wildcards, as set once one has`, wc.before === 0 && wc.after === 5);
        // preview with this seed
        await page.locator(".rg-wc .rg-btn[title^='Preview']").first().click();
        await page.waitForTimeout(800);
        const pv = await page.evaluate(() => { const t = document.querySelector(".rg-list textarea.rg-prompt"); return { cls: t.classList.contains("rg-wc-filled"), title: t.title }; });
        const expected = await page.evaluate(async () => (await (await fetch("/region_genie/wildcards/fill", { method: "POST", body: JSON.stringify({ fields: { r1: "a __rgtest/color__ car" }, seed: 5 }) })).json()).filled.r1.filled);
        check(`${M}: preview marks the field and shows the filled text (${expected})`, pv.cls && pv.title.includes(expected));
        // a real run: the same text as the preview (seed fixed), the seed stays
        const runWc = await page.evaluate(async () => {
            const app = window.app, rg = window.__rg;
            await fetch("/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
            await app.queuePrompt(0, 1);
            let out = null;
            for (let i = 0; i < 120 && !out; i++) {
                await new Promise((r) => setTimeout(r, 500));
                const h = await (await fetch("/history")).json();
                const e = Object.values(h)[0];
                if (e?.status?.completed || e?.status?.status_str) out = e;
            }
            const o = out?.outputs?.[String(rg.id)];
            return { status: out?.status?.status_str, filled: o?.wildcards ? JSON.parse(o.wildcards[0]) : null,
                     seed: rg.widgets.find((w) => w.name === "wildcard_seed").value };
        });
        check(`${M}: run fills the wildcards like the preview`, runWc.status === "success" && runWc.filled?.r1?.filled === expected);
        check(`${M}: fixed seed stays after the run`, runWc.seed === 5);
        // randomize: a new seed after the run
        await page.evaluate(() => { window.__rg.properties.rg_wc_mode = "randomize"; });
        await page.evaluate(async () => { await window.app.queuePrompt(0, 1); });
        await page.waitForTimeout(1500);
        check(`${M}: randomize gives a new seed after queueing`, await page.evaluate(() => window.__rg.widgets.find((w) => w.name === "wildcard_seed").value !== 5));
        // right-click the seed: use the filled text in all fields
        await page.locator(".rg-wc").first().click({ button: "right" });
        await page.waitForTimeout(300);
        await page.locator(".litemenu-entry", { hasText: "Use the filled text in all fields" }).first().click();
        await page.waitForTimeout(300);
        const used = await page.evaluate(() => window.__rg.__rgState().regions[0].prompt);
        check(`${M}: 'use the filled text' puts it in the field`, used === expected);
        // the region pop-up: __ autocomplete and the picker
        await page.locator(".rg-list .rg-pwrap .rg-expand").first().click();
        await page.waitForTimeout(400);
        const ta = page.locator(".rg-pop textarea").first();
        await ta.press("End"); await ta.type(" __rgt");
        await page.waitForTimeout(300);
        const acOk = await page.locator(".rg-wc-ac .rg-wc-item", { hasText: "__rgtest/color__" }).first().isVisible().catch(() => false);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(200);
        const afterAc = await page.evaluate(() => ({ v: document.querySelector(".rg-pop textarea")?.value, open: !!document.querySelector(".rg-pop") }));
        check(`${M}: typing __ suggests wildcards; Enter inserts one and keeps the pop-up open`, acOk && afterAc.open && afterAc.v?.endsWith("__rgtest/color__"));
        await page.locator(".rg-pop .rg-wc-pick").first().click();
        await page.waitForTimeout(300);
        await page.locator(".litemenu-entry", { hasText: "__samples/flower__" }).first().click();
        await page.waitForTimeout(200);
        const afterPick = await page.evaluate(() => document.querySelector(".rg-pop textarea")?.value || "");
        check(`${M}: the pop-up's wildcard picker inserts at the cursor`, afterPick.includes("__samples/flower__"));
        await page.keyboard.press("Escape");
        // Regional LoRAs: the seed control and the per-field Setting go with the run
        const rl = await page.evaluate(async () => {
            const app = window.app, LG = window.LiteGraph;
            const n = LG.createNode("Region-Genie_RegionalLoRAs"); n.pos = [60, 900]; app.graph.add(n);
            await new Promise((r) => setTimeout(r, 1200));
            const vis = () => [...document.querySelectorAll(".rg-rl-head .rg-wc")].some((e) => getComputedStyle(e).display !== "none");
            const idle = vis();                                   // no wildcard in any field yet: the seed group is hidden (round 60)
            n.widgets.find((w) => w.name === "positive_prompt").value = "a {red|blue} hat";
            await new Promise((r) => setTimeout(r, 1500));
            const p = (await app.graphToPrompt()).output[n.id]?.inputs || {};
            return { ctl: !!n.widgets.find((w) => w.name === "wildcard_seed")?.hidden && !n.inputs.some((i) => i.name === "wildcard_seed"),
                     shown: vis(), idle,
                     seed: p.wildcard_seed, per: (() => { try { return "wcPerField" in JSON.parse(p.loras_data); } catch (e) { return false; } })() };
        });
        check(`${M}: Regional LoRAs: the seed control shows only while a field has a wildcard`, !rl.idle && rl.shown);
        check(`${M}: Regional LoRAs: seed control, hidden widget, per-field Setting sent`, rl.ctl && rl.shown && typeof rl.seed === "number" && rl.per);
        await page.screenshot({ path: require("path").join(__dirname, "out", `real9_wc_${vue ? "vue" : "legacy"}.png`) });
    }

    check(`${M}: no Region Genie errors in the console` + (errors.length ? ": " + errors.slice(0, 3).join(" / ") : ""), errors.length === 0);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
