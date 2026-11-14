// Round 12 checks in the real ComfyUI frontend + server (CPU; no model files needed).
// Usage: node real_comfy12.cjs [vue]   ("vue" = Nodes 2.0). Needs ComfyUI on 127.0.0.1:8188 with this pack
// (bash tests/setup_real_comfy.sh --start).
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const vue = process.argv[2] === "vue";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && /region|rg_|genie/i.test(m.text())) errors.push(m.text()); });
    await page.goto("http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(2000);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(300); }
    await page.evaluate(async (vue) => {
        const s = window.app.extensionManager.setting;
        try { await s.set("Comfy.TutorialCompleted", true); } catch (e) {}
        await s.set("Comfy.VueNodes.Enabled", vue);
        await s.set("RegionGenie.Popup.EscKeeps", "put the text back");
    }, vue);
    await sleep(1000);
    const M = vue ? "Nodes 2.0" : "legacy";
    // a Region Genie node with two regions (one with a LoRA and a palette), zoomed out so the node fits
    await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); window.__rg = rg;
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 0.72; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 1500));
        const st = rg.__rgState();
        st.regions.push({ id: 1, color: "#E6194B", prompt: "a red cat", type: "object", text: "",
                          loras: [{ lora: "style.safetensors", strength: 0.8, on: true }], palette: ["#ff0000", "#00ff00"], paletteOn: true },
                        { id: 2, color: "#3CB44B", prompt: "a green dog", type: "object", text: "" });
        const L = (id, region, ox) => ({ id, name: "Rect " + id, region, visible: true, shape: "rect", sides: 5, bw: .5, bh: 1, sx: 1, sy: 1, rot: 0, ox, oy: 0, ops: [] });
        st.layers.push(L(1, 1, -.25), L(2, 2, .25));
        rg.__rgRefresh();
        await new Promise((r) => setTimeout(r, 500));
    });

    // ---------------- number fields fit their value (every own number field shown)
    const numFit = () => page.evaluate(async () => {
        const bad = [], cv = document.createElement("canvas").getContext("2d");
        let n = 0;
        for (const i of document.querySelectorAll("input[type=number]")) {
            if (!i.closest('[class^="rg-"], [class*=" rg-"]') || !i.offsetParent) continue;
            n++;
            const keep = i.value;
            for (const v of [keep, "0.95", "1.25", "-0.75", "12", "128", "1024", "16384"]) {
                i.value = v;
                const cs = getComputedStyle(i); cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
                const room = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 16;   // the spin arrows
                if (cv.measureText(v).width > room) bad.push(`${(i.title || i.className).slice(0, 30)}: '${v}'`);
            }
            i.value = keep;
            const w2 = i.offsetWidth; i.value = "1"; const w1 = i.offsetWidth; i.value = keep;
            if (w1 > 80) bad.push(`${(i.title || i.className).slice(0, 30)}: not narrow with 1 digit (${w1}px)`);
            void w2;
        }
        return { n, bad };
    });
    // ---------------- every control shown has a tooltip, and stays the same element (a redraw under the mouse hides it)
    const tipAudit = () => page.evaluate(async () => {
        const roots = [...document.querySelectorAll(".rg-wrap, .rg-size, .rg-pop, .rg-presets, .rg-rl-wrap, .rg-fpop")];
        const els = [];
        for (const r of roots) for (const e of r.querySelectorAll("button, select, input, [role=slider], .rg-optlab, .rg-split, .rg-pop-grip"))
            if (e.offsetParent && !els.includes(e) && e.type !== "hidden" && !e.classList.contains("rg-keysink")) els.push(e);
        const tipOf = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { if (x.title) return x.title; if (x.matches(".rg-wrap, .rg-pop, .rg-fpop, .rg-rl-wrap")) break; } return ""; };
        const before = els.map((e) => ({ e, first: e.firstChild }));
        await new Promise((r) => setTimeout(r, 1300));
        const bad = [];
        for (const { e, first } of before) {
            const t = tipOf(e);
            const textField = e.tagName === "INPUT" && e.type === "text" && e.placeholder;
            if (!t && !textField) bad.push(`no tooltip: ${e.tagName}.${e.className} '${(e.textContent || e.value || "").slice(0, 20)}'`);
            if (first && e.firstChild !== first) bad.push(`redrawn: ${e.tagName}.${e.className} '${t.slice(0, 30)}'`);
        }
        return { n: els.length, bad };
    });

    // expand everything in the list
    await page.evaluate(() => [...document.querySelectorAll(".rg-wrap button")].find((b) => b.textContent.trim() === "▼ All")?.click());
    await sleep(300);
    let f = await numFit();
    check(`${M}: number fields fit 1 to 5 digits, decimals and minus (${f.n} fields)` + (f.bad.length ? ": " + f.bad.slice(0, 4).join("; ") : ""), f.n >= 5 && !f.bad.length);
    let a = await tipAudit();
    check(`${M}: every control has a tooltip and isn't redrawn (${a.n} controls)` + (a.bad.length ? ": " + a.bad.slice(0, 5).join("; ") : ""), a.n > 30 && !a.bad.length);
    const linkTip = await page.evaluate(async () => {
        const seg = [...document.querySelectorAll(".rg-size button")].find((b) => /typed in/.test(b.title)); seg.click();
        await new Promise((r) => setTimeout(r, 700));
        const l = [...document.querySelectorAll(".rg-size button")].find((b) => /ratio/.test(b.title) && b.offsetParent && /Keep the ratio|Ratio kept/.test(b.title));
        const first = l?.firstChild;
        await new Promise((r) => setTimeout(r, 1200));
        return { tip: l?.title || "", same: !!first && l.firstChild === first };
    });
    check(`${M}: the chain button has a tooltip and keeps it (not redrawn every half second)`, /Keep the ratio/.test(linkTip.tip) && linkTip.same);

    // ---------------- presets mode keeps the size; ＋ Current size adds it
    const sz = await page.evaluate(async () => {
        const row = document.querySelector(".rg-size"), W = () => ["width", "height"].map((n) => window.__rg.widgets.find((w) => w.name === n).value);
        const man = row.querySelectorAll(".rg-size-part")[2].querySelectorAll("input");
        man[0].value = "1000"; man[0].dispatchEvent(new Event("change")); man[1].value = "760"; man[1].dispatchEvent(new Event("change"));
        await new Promise((r) => setTimeout(r, 100));
        [...row.querySelectorAll("button")].find((b) => /presets list/.test(b.title)).click();
        await new Promise((r) => setTimeout(r, 200));
        const pre = row.querySelector("select.rg-size-pre");
        return { wv: W(), extra: pre.querySelector("option[data-extra]")?.textContent || "", val: pre.value };
    });
    check(`${M}: presets mode keeps the manual size (1000 x 760, 'not in the list')`, JSON.stringify(sz.wv) === "[1000,760]" && /not in the list/.test(sz.extra) && sz.val === "1000x760");
    await page.locator("select.rg-size-pre").first().selectOption("__edit__");
    await sleep(200);
    await page.locator(".rg-presets button", { hasText: "Current size" }).click();
    await sleep(200);
    const added = await page.evaluate(() => ({ set: window.app.extensionManager.setting.get("RegionGenie.Size.Presets"),
        extra: !!document.querySelector("select.rg-size-pre option[data-extra]") }));
    check(`${M}: ＋ Current size adds it to the list`, /1000x760/.test(added.set) && !added.extra);
    await page.evaluate(() => [...document.querySelectorAll(".rg-presets button")].find((b) => b.textContent === "✕" && /Close/.test(b.title))?.click());
    await page.evaluate(() => window.app.extensionManager.setting.set("RegionGenie.Size.Presets", "1024x1024; 1152x896; 896x1152; 1216x832; 832x1216; 1344x768; 768x1344; 1536x640; 640x1536"));

    // ---------------- the model dropdown sets the format; MOSS layout switch; background only for Ideogram 4
    const ms = () => page.evaluate(() => {
        const bg = window.__rg.widgets.find((w) => w.name === "scene_prompt_background");
        const tas = [...document.querySelectorAll(`[data-node-id="${window.__rg.id}"] textarea, .rg-scene-ta`)].filter((t) => t.offsetParent && !t.closest(".rg-wrap"));
        const lb = document.querySelector(".rg-layout");
        const pd = JSON.parse(window.__rg.widgets.find((w) => w.name === "paint_data").serializeValue());
        return { fmt: document.querySelectorAll(".rg-fmt").length, layout: !!lb && lb.style.display !== "none", layoutOn: lb?.classList.contains("on"),
                 bgHidden: !!bg.hidden, sceneBoxes: tas.length, pick: pd.modelPick || "", mossLayout: pd.mossLayout };
    });
    let s0 = await ms();
    check(`${M}: no format select; no layout switch and no background while the model isn't known`, s0.fmt === 0 && !s0.layout && s0.bgHidden && s0.sceneBoxes === 2);
    await page.locator("select.rg-model").first().selectOption("MOSS-Image"); await sleep(700);
    let s1 = await ms();
    check(`${M}: MOSS-Image: layout switch shown (layout), background hidden, sent with the run`, s1.layout && s1.layoutOn && s1.bgHidden && s1.pick === "MOSS-Image" && s1.mossLayout === undefined);
    // round 14: Edit Mode's LoRAs never stay in Generate (also after Ctrl+Z), nor a control LoRA with Control off
    const managed = await page.evaluate(async () => {
        const s = window.app.extensionManager.setting, rg = window.__rg, wait = (ms) => new Promise((r) => setTimeout(r, ms));
        await s.set("RegionGenie.Edit.LoRA.MOSS", "edit_test.safetensors");
        const seg = (t) => [...document.querySelectorAll(".rg-settings button")].find((b) => b.textContent.trim() === t)?.click();
        const tags = () => (rg.__rgState().sceneLoras || []).map((l) => (l.edit ? "edit" : l.control ? "control" : "own")).join(",");
        seg("Edit"); await wait(700); const inEdit = tags();
        seg("Generate"); await wait(700); const inGen = tags();
        document.querySelector(".rg-keysink")?.focus();
        document.querySelector(".rg-keysink")?.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
        await wait(1200); const afterUndo = tags();
        // a control LoRA left in the list with Control off (e.g. an old workflow)
        const st = rg.__rgState(); st.sceneLoras = [...(st.sceneLoras || []), { lora: "ctl.safetensors", strength: 1, on: true, control: "MOSS-Image", ckind: "moss" }];
        st.control = { ...(st.control || {}), on: false }; rg.__rgRefresh(); await wait(1200); const ctlOff = tags();
        await s.set("RegionGenie.Edit.LoRA.MOSS", "(none)");
        return { inEdit, inGen, afterUndo, ctlOff };
    });
    check(`${M}: Edit Mode's LoRA goes when switching to Generate, also after Ctrl+Z; a control LoRA goes with Control off (${JSON.stringify(managed)})`,
        managed.inEdit.includes("edit") && !managed.inGen.includes("edit") && !managed.afterUndo.includes("edit") && !managed.ctlOff.includes("control"));
    // round 20: holes are a ✂ switch on a layer (no 'Unspecified' row); the Layout icon shows Standard while no region
    // is drawn and shown (holes don't count)
    const hl = await page.evaluate(async () => {
        const rg = window.__rg, wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const lay = () => { const b = document.querySelector(".rg-layout"); return { on: b.classList.contains("on"), title: b.title }; };
        const st = rg.__rgState(), keep = JSON.parse(JSON.stringify({ regions: st.regions, layers: st.layers }));
        st.regions = []; st.layers = []; rg.__rgRefresh(); await wait(900);
        const empty = lay();
        const unspecRow = [...document.querySelectorAll(".rg-list .rg-row")].some((r) => /Unspecified/.test(r.textContent));
        st.regions = [{ id: 1, color: "#E6194B", prompt: "a red cat", type: "object", text: "" }];
        st.layers = [{ id: 1, name: "Rect 1", region: 1, visible: true, shape: "rect", sides: 5, bw: 0.5, bh: 1, sx: 1, sy: 1, rot: 0, ox: -0.25, oy: 0, ops: [] }];
        rg.__rgRefresh(); await wait(900);
        const drawn = lay();
        st.regions[0].hidden = true; rg.__rgRefresh(); await wait(900);
        const hidden = lay();
        delete st.regions[0].hidden; rg.__rgRefresh(); await wait(600);
        rg.__rgSelectLayer(1); await wait(500);
        const cut = [...document.querySelectorAll('.rg-list .rg-row.layer[data-lid="1"] button')].find((b) => b.textContent === "✂");
        const offTitle = cut?.title || "";
        cut?.click(); await wait(900);
        const L = rg.__rgState().layers[0];
        const row = document.querySelector('.rg-list .rg-row.layer[data-lid="1"]');
        const asHole = { region: L.region, owner: L.owner, listed: !!row, hatched: !!row?.classList.contains("hole"),
                         on: !![...(row?.querySelectorAll("button") || [])].find((b) => b.textContent === "✂" && b.classList.contains("on")) };
        const holeOnly = lay();
        [...document.querySelectorAll('.rg-list .rg-row.layer[data-lid="1"] button')].find((b) => b.textContent === "✂")?.click(); await wait(900);
        const back = { region: rg.__rgState().layers[0].region, owner: rg.__rgState().layers[0].owner };
        const again = lay();
        // an old workflow's 'Unspecified' layer (region 0, no owner): listed under the region of the layer below it
        st.regions = [{ id: 1, color: "#E6194B", prompt: "a", type: "object", text: "" }, { id: 2, color: "#3CB44B", prompt: "b", type: "object", text: "" }];
        st.layers = [{ id: 1, name: "B", region: 2, visible: true, shape: "rect", sides: 5, bw: 0.5, bh: 1, sx: 1, sy: 1, rot: 0, ox: 0.25, oy: 0, ops: [] },
                     { id: 2, name: "Unspecified 2", region: 0, visible: true, shape: "rect", sides: 5, bw: 0.2, bh: 0.2, sx: 1, sy: 1, rot: 0, ox: 0.25, oy: 0, ops: [] },
                     { id: 3, name: "A", region: 1, visible: true, shape: "rect", sides: 5, bw: 0.5, bh: 1, sx: 1, sy: 1, rot: 0, ox: -0.25, oy: 0, ops: [] }];
        rg.__rgRefresh(); await wait(400); rg.__rgSelectLayer(2); await wait(600);
        const oldRow = document.querySelector('.rg-list .rg-row.layer[data-lid="2"]');
        const rows = [...document.querySelectorAll(".rg-list .rg-row")];
        const under = rows.slice(0, rows.indexOf(oldRow)).reverse().find((r) => r.classList.contains("region"))?.querySelector("textarea")?.value;
        const oldHole = { listed: !!oldRow?.classList.contains("hole"), under: under === "b" };
        st.regions = keep.regions; st.layers = keep.layers; rg.__rgRefresh(); await wait(600);
        return { empty, unspecRow, drawn, hidden, offTitle, asHole, holeOnly, back, again, oldHole };
    });
    check(`${M}: no 'Unspecified' row; with no regions the Layout icon shows Standard and says why`,
        !hl.unspecRow && !hl.empty.on && /Standard by itself: No region is drawn and shown/.test(hl.empty.title));
    check(`${M}: a drawn region brings Layout back; hiding it shows Standard again`, hl.drawn.on && !hl.hidden.on);
    check(`${M}: ✂ on a layer makes it a hole, still listed under its region (hatched, ✂ lit) (${JSON.stringify(hl.asHole)})`,
        /^Hole: Off/.test(hl.offTitle) && hl.asHole.region === 0 && hl.asHole.owner === 1 && hl.asHole.listed && hl.asHole.hatched && hl.asHole.on);
    check(`${M}: an old workflow's 'Unspecified' layer is listed as a hole under the region below it (${JSON.stringify(hl.oldHole)})`, hl.oldHole.listed && hl.oldHole.under);
    check(`${M}: only a hole left: Standard; ✂ again paints the region again and Layout is back`,
        !hl.holeOnly.on && hl.back.region === 1 && hl.back.owner === undefined && hl.again.on);
    // round 18: in Edit Mode the Edit row is always there; with no edit LoRA for the model it offers the picker, and a
    // pick there sets the Setting and adds the LoRA to Whole image
    const fsx = require("fs"), pathx = require("path");
    const editFile = pathx.join(process.env.COMFY_DIR || "/tmp/comfy_src", "models", "loras", "rgtest_edit_row.safetensors");
    fsx.writeFileSync(editFile, "");
    const er = await page.evaluate(async () => {
        const s = window.app.extensionManager.setting, rg = window.__rg, wait = (ms) => new Promise((r) => setTimeout(r, ms));
        await s.set("RegionGenie.Edit.LoRA.MOSS", "(none)");
        const seg = (t) => [...document.querySelectorAll(".rg-settings button")].find((b) => b.textContent.trim() === t)?.click();
        const genRow = !!document.querySelector(".rg-row.ctrl.edit");
        seg("Edit"); await wait(900);
        const row = document.querySelector(".rg-row.ctrl.edit");
        const text = row?.innerText.replace(/\s+/g, " ") || "";
        const sel = row?.querySelector(".rg-file select"), btn = row?.querySelector(".rg-file button");
        sel?.dispatchEvent(new FocusEvent("focus"));                 // opening the dropdown reads the folder again
        for (let i = 0; i < 20 && sel && ![...sel.options].some((o) => o.value === "rgtest_edit_row.safetensors"); i++) await wait(250);
        const listed = !!sel && [...sel.options].some((o) => o.value === "rgtest_edit_row.safetensors");
        if (sel) { sel.value = "rgtest_edit_row.safetensors"; sel.dispatchEvent(new Event("change")); }
        await wait(1200);
        const setting = s.get("RegionGenie.Edit.LoRA.MOSS");
        const tags = (rg.__rgState().sceneLoras || []).filter((x) => x.edit).map((x) => x.edit + ":" + x.lora).join();
        const after = document.querySelector(".rg-row.ctrl.edit")?.innerText.replace(/\s+/g, " ") || "";
        seg("Generate"); await wait(700);
        const genAfter = !!document.querySelector(".rg-row.ctrl.edit");
        await s.set("RegionGenie.Edit.LoRA.MOSS", "(none)");
        return { genRow, text, picker: !!sel && !!btn, listed, setting, tags, after, genAfter };
    });
    fsx.unlinkSync(editFile);
    check(`${M}: Edit row: only in Edit Mode, says there's no edit LoRA for the model, with a picker (${er.text.slice(0, 60)})`,
        !er.genRow && /^Edit No edit LoRA for MOSS-Image:/.test(er.text) && er.picker && er.listed && !er.genAfter);
    check(`${M}: Edit row: a pick sets the Setting and adds the LoRA to Whole image (${er.setting}; ${er.tags})`,
        er.setting === "rgtest_edit_row.safetensors" && er.tags === "MOSS-Image:rgtest_edit_row.safetensors" && /LoRA for MOSS-Image:/.test(er.after));
    await page.evaluate(() => document.querySelector(".rg-layout").click()); await sleep(200);
    s1 = await ms();
    check(`${M}: the switch: standard mode, sent with the run`, !s1.layoutOn && s1.mossLayout === false);
    await page.locator("select.rg-model").first().selectOption("Ideogram 4"); await sleep(700);
    const s2 = await ms();
    check(`${M}: Ideogram 4: the background field shows, no layout switch`, !s2.bgHidden && s2.sceneBoxes === 3 && !s2.layout);
    await page.locator("select.rg-model").first().selectOption("Krea 2"); await sleep(700);
    const s3 = await ms();
    check(`${M}: Krea 2: background hidden again`, s3.bgHidden && s3.sceneBoxes === 2);
    const tip = await page.evaluate(() => document.querySelector("select.rg-model").title);
    check(`${M}: the model dropdown's tooltip says it sets the prompt format`, /format of the 'prompt' and 'positive'/.test(tip));
    // round 13: MOSS-Image's standard mode is plain text too, so it has its own 'keep all regions apart automatically'
    const mossApart = await page.evaluate(async () => {
        const s = window.app.extensionManager.setting, id = "RegionGenie.Main.AutoApart.MOSS";
        const def = window.app.ui.settings.settingsParamLookup?.[id] || s.settingsById?.[id];
        await s.set(id, "off");
        const pd = JSON.parse(window.__rg.widgets.find((w) => w.name === "paint_data").serializeValue());
        await s.set(id, "default");
        return { name: def?.name || "", sent: pd.autoApart?.["MOSS-Image"], keys: Object.keys(pd.autoApart || {}).join(",") };
    });
    // round 16: the node says MOSS-Image everywhere, and stores it so (round 17)
    await page.locator("select.rg-model").first().selectOption("MOSS-Image"); await sleep(600);
    const shown = await page.evaluate(async () => {
        const out = [];
        for (const r of document.querySelectorAll(".rg-wrap, .rg-size")) {
            if (/MOSS Image/.test(r.innerText)) out.push("text: " + r.innerText.match(/.{0,30}MOSS Image.{0,20}/)[0]);
            for (const e of r.querySelectorAll("[title]")) if (/MOSS Image/.test(e.title)) out.push("title: " + e.title.match(/.{0,30}MOSS Image.{0,20}/)[0]);
            for (const o of r.querySelectorAll("option")) if (/MOSS Image/.test(o.textContent)) out.push("option: " + o.textContent);
        }
        const d = await (await fetch("/object_info")).json();
        for (const [k, v] of Object.entries(d)) if (k.startsWith("Region-Genie_")) {
            const tips = [...Object.values(v.input.required || {}), ...Object.values(v.input.optional || {})].map((x) => x[1]?.tooltip || "");
            for (const t of [...tips, ...(v.output_tooltips || []), v.description || ""]) if (/MOSS Image/.test(t)) out.push(k + ": " + t.match(/.{0,30}MOSS Image.{0,20}/)[0]);
        }
        const sel = document.querySelector("select.rg-model");
        return { out, value: sel.value, text: sel.selectedOptions[0]?.textContent };
    });
    check(`${M}: the node says MOSS-Image everywhere and stores it so (${shown.text}; ${shown.value}; ${shown.out.slice(0, 3).join(" | ")})`,
        !shown.out.length && shown.value === "MOSS-Image" && shown.text === "MOSS-Image");
    await page.locator("select.rg-model").first().selectOption(""); await sleep(400);
    const mossNames = await page.evaluate(() => Object.values(window.app.ui.settings.settingsParamLookup).filter((d) => /^RegionGenie/.test(d.id))
        .flatMap((d) => [d.name, d.tooltip || ""]).filter((t) => /MOSS[ -]Image/.test(t)));
    check(`${M}: Settings say MOSS-Image (the official name), never 'MOSS Image' (${mossNames.length} mentions)`,
        mossNames.length >= 6 && mossNames.every((t) => !/MOSS Image/.test(t)));
    check(`${M}: Settings has 'MOSS-Image: keep all regions apart automatically', sent with the run (${mossApart.name}; ${mossApart.keys}; ${mossApart.sent})`,
        /^MOSS-Image/.test(mossApart.name) && mossApart.sent === "off");
    // an old workflow with the format select set
    const mig = await page.evaluate(async () => {
        const app = window.app;
        const out = {};
        for (const [fmt, key] of [["Ideogram JSON", "ideo"], ["text", "text"]]) {
            const g = app.graph.serialize();
            const n = g.nodes.find((x) => x.type === "Region-Genie_Main");
            delete n.properties.rg_model_pick; delete n.properties.rg_moss_layout;
            n.properties.rg_widget_values = { ...(n.properties.rg_widget_values || {}), prompt_format: fmt };
            const fw = window.__rg.widgets.findIndex((w) => w.name === "prompt_format");
            if (Array.isArray(n.widgets_values) && fw >= 0) { const i = n.widgets_values.indexOf("auto"); if (i >= 0) n.widgets_values[i] = fmt; }
            await app.loadGraphData(g);
            await new Promise((r) => setTimeout(r, 1500));
            const rg = app.graph.nodes.find((x) => x.type === "Region-Genie_Main"); window.__rg = rg;
            out[key] = { pick: rg.properties.rg_model_pick || "", layout: rg.properties.rg_moss_layout, fmt: rg.widgets.find((w) => w.name === "prompt_format").value };
        }
        return out;
    });
    check(`${M}: old workflow, format 'Ideogram JSON': Ideogram 4 picked`, mig.ideo.pick === "Ideogram 4" && mig.ideo.fmt === "auto");
    check(`${M}: old workflow, format 'text': MOSS standard mode`, mig.text.layout === false && mig.text.fmt === "auto");
    // round 17: a workflow saved when the model was stored as 'MOSS Image' loads as MOSS-Image (pick, edit / control LoRA tags)
    const old = await page.evaluate(async () => {
        const app = window.app;
        const g = app.graph.serialize();
        const n = g.nodes.find((x) => x.type === "Region-Genie_Main");
        n.properties.rg_model_pick = "MOSS Image";
        const conv = (v) => { const d = JSON.parse(v); d.sceneLoras = [{ lora: "e.safetensors", strength: 1, on: true, edit: "MOSS Image" },
            { lora: "c.safetensors", strength: 1, on: true, control: "MOSS Image", ckind: "moss" }]; return JSON.stringify(d); };
        const isPd = (v) => typeof v === "string" && /^\{"v":/.test(v);
        if (Array.isArray(n.widgets_values)) n.widgets_values = n.widgets_values.map((v) => (isPd(v) ? conv(v) : v));
        if (isPd(n.properties.rg_widget_values?.paint_data)) n.properties.rg_widget_values.paint_data = conv(n.properties.rg_widget_values.paint_data);
        await app.loadGraphData(g);
        await new Promise((r) => setTimeout(r, 1500));
        const rg = app.graph.nodes.find((x) => x.type === "Region-Genie_Main"); window.__rg = rg;
        const pd = JSON.parse(rg.widgets.find((w) => w.name === "paint_data").serializeValue());
        const sel = document.querySelector("select.rg-model");
        return { pick: rg.properties.rg_model_pick, sel: sel?.value, sent: pd.modelPick, tags: JSON.stringify(rg.__rgState().sceneLoras || []) };
    });
    check(`${M}: an old workflow's 'MOSS Image' becomes MOSS-Image (pick, LoRA tags) (${JSON.stringify(old)})`,
        old.pick === "MOSS-Image" && old.sel === "MOSS-Image" && old.sent === "MOSS-Image" && !/MOSS Image/.test(old.tags));
    await page.evaluate(async () => { window.__rg.properties.rg_model_pick = undefined; delete window.__rg.properties.rg_model_pick; delete window.__rg.properties.rg_moss_layout;
        window.app.canvas.ds.offset = [0, 0]; window.app.canvas.ds.scale = 0.72; window.app.canvas.setDirty(true, true); await new Promise((r) => setTimeout(r, 800)); });

    // ---------------- pop-up editors
    const geo = () => page.evaluate(() => { const b = document.querySelector(".rg-pop"); if (!b) return null; const r = b.getBoundingClientRect();
        return { body: b.parentElement === document.body, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
                 title: b.querySelector(".rg-pop-head span")?.textContent || "", ta: b.querySelector("textarea")?.value ?? "",
                 nav: Math.round([...b.querySelectorAll(".rg-nav")].find((x) => x.textContent === "◀").getBoundingClientRect().left - r.left) }; });
    await page.evaluate(() => document.querySelector(".rg-scene-ta")?.parentElement?.querySelector(".rg-expand")?.click());
    await sleep(300);
    const g0 = await geo();
    check(`${M}: scene pop-up opens on top of the page`, !!g0 && g0.body && /scene_prompt_positive/.test(g0.title));
    await page.mouse.click(1450, 1000, { button: "left" }); await page.mouse.click(1450, 1000, { button: "right" }); await sleep(200);
    await page.keyboard.press("Escape").catch(() => {});
    await page.mouse.click(1450, 1000, { button: "middle" }); await sleep(200);
    const g1 = await geo();
    check(`${M}: clicks elsewhere (left, right, middle) don't close it`, !!g1);
    if (!g1) await page.evaluate(() => document.querySelector(".rg-scene-ta")?.parentElement?.querySelector(".rg-expand")?.click());
    await sleep(200);
    const hb = await page.locator(".rg-pop .rg-pop-head span").first().boundingBox();
    await page.mouse.move(hb.x + 5, hb.y + 5); await page.mouse.down(); await page.mouse.move(hb.x + 805, hb.y - 200, { steps: 6 }); await page.mouse.up();
    const g2 = await geo();
    check(`${M}: dragged outside the node (to the right; ${g1?.x} -> ${g2.x})`, g2.x > g1.x + 700 && g2.x > 800);
    for (let i = 0; i < 3; i++) await page.evaluate(() => [...document.querySelectorAll(".rg-pop .rg-pop-font")].find((b) => b.textContent === "A+").click());
    await sleep(100);
    const g3 = await geo();
    check(`${M}: A+ doesn't change the pop-up's size`, g3.w === g2.w && g3.h === g2.h);
    for (let i = 0; i < 3; i++) await page.evaluate(() => [...document.querySelectorAll(".rg-pop .rg-pop-font")].find((b) => b.textContent === "A−").click());
    const seen = [];
    const step = async (sym) => { await page.evaluate((s) => [...document.querySelectorAll(".rg-pop .rg-nav")].find((b) => b.textContent === s).click(), sym); await sleep(250); return geo(); };
    for (let i = 0; i < 4; i++) seen.push(await step("▶"));
    check(`${M}: ▶ steps scene positive → negative → region 1 → region 2 → back to the first`,
        /negative/.test(seen[0].title) && seen[1].ta === "a red cat" && seen[2].ta === "a green dog" && /scene_prompt_positive/.test(seen[3].title));
    check(`${M}: ... in the same place and size`, seen.every((g) => g.x === g2.x && g.y === g2.y && g.w === g2.w && g.h === g2.h));
    check(`${M}: ◀ / ▶ stay in one place in the header while stepping (${seen.map((g) => g.nav).join(", ")})`, seen.every((g) => g.nav === seen[0].nav));
    const back = await step("◀");
    check(`${M}: ◀ from the first goes to the last`, back.ta === "a green dog");
    // hotkeys: Page Down / Page Up (Settings > Region Genie > Text size), typing in the field
    const keyStep = async (key) => { await page.locator(".rg-pop textarea").first().focus(); await page.keyboard.press(key); await sleep(250); return geo(); };
    const k1 = await keyStep("PageDown"), k2 = await keyStep("PageDown"), k3 = await keyStep("PageUp");
    check(`${M}: Page Down / Page Up step to the next / previous field (${[k1, k2, k3].map((g) => g?.ta || g?.title.slice(0, 12)).join(" | ")})`,
        /scene_prompt_positive/.test(k1?.title) && /negative/.test(k2?.title) && /scene_prompt_positive/.test(k3?.title) && k1.x === back.x && k1.w === back.w);
    const navTip = await page.evaluate(() => [...document.querySelectorAll(".rg-pop .rg-nav")].map((b) => b.title).join(" / ") + " || " + document.querySelector(".rg-pop .rg-pop-foot")?.textContent);
    check(`${M}: the arrows' tooltips and the footer name the keys (${navTip.split(" || ")[1]})`, /Page Up/.test(navTip.split(" || ")[0]) && /Page Down/.test(navTip.split(" || ")[0])
        && /Page Up \/ Page Down: previous \/ next field/.test(navTip.split(" || ")[1]));
    await page.evaluate(async () => { const s = window.app.extensionManager.setting; await s.set("RegionGenie.Popup.PrevKey", "Alt+ArrowLeft"); await s.set("RegionGenie.Popup.NextKey", "alt+right"); });
    const k4 = await keyStep("PageDown"), k5 = await keyStep("Alt+ArrowRight"), k6 = await keyStep("Alt+ArrowLeft");
    await page.evaluate(async () => { const s = window.app.extensionManager.setting; await s.set("RegionGenie.Popup.PrevKey", "PageUp"); await s.set("RegionGenie.Popup.NextKey", "PageDown"); });
    check(`${M}: keys set in Settings (Alt+← / Alt+→) replace them`, /scene_prompt_positive/.test(k4?.title) && /negative/.test(k5?.title) && /scene_prompt_positive/.test(k6?.title));
    await page.locator(".rg-pop textarea").first().click(); await page.keyboard.press("End"); await page.keyboard.type(" XYZ");
    await page.keyboard.press("Escape"); await sleep(200);
    const rv = await page.evaluate(() => window.__rg.__rgState().regions[1].prompt);
    check(`${M}: Esc closes it and puts the text back (default)`, !(await geo()) && rv === "a green dog");
    await page.evaluate(() => window.app.extensionManager.setting.set("RegionGenie.Popup.EscKeeps", "keep the edits"));
    await page.evaluate(() => [...document.querySelectorAll(".rg-list .rg-pwrap .rg-expand")][1]?.click()); await sleep(250);
    const foot = await page.evaluate(() => document.querySelector(".rg-pop .rg-pop-foot")?.textContent || "");
    await page.locator(".rg-pop textarea").first().click(); await page.keyboard.press("End"); await page.keyboard.type(" XYZ");
    await page.keyboard.press("Escape"); await sleep(200);
    const kv = await page.evaluate(() => window.__rg.__rgState().regions[1].prompt);
    check(`${M}: Setting 'keep the edits': Esc keeps the text (and the footer says so)`, kv === "a green dog XYZ" && /keeping the edits/.test(foot));
    await page.evaluate(() => window.app.extensionManager.setting.set("RegionGenie.Popup.EscKeeps", "put the text back"));
    // with a pop-up open
    await page.evaluate(() => [...document.querySelectorAll(".rg-list .rg-pwrap .rg-expand")][0]?.click()); await sleep(300);
    a = await tipAudit();
    check(`${M}: pop-up open: every control has a tooltip (${a.n} controls)` + (a.bad.length ? ": " + a.bad.slice(0, 5).join("; ") : ""), !a.bad.length);
    f = await numFit();
    check(`${M}: pop-up open: number fields fit` + (f.bad.length ? ": " + f.bad.slice(0, 4).join("; ") : ""), !f.bad.length);
    // another graph (a workflow tab) closes it
    await page.evaluate(async () => { const s = window.app.graph.serialize(); window.__saved = s; await window.app.loadGraphData({ ...s, nodes: [], links: [] }); });
    await sleep(800);
    check(`${M}: loading another graph closes the pop-up`, !(await geo()));
    await page.evaluate(async () => { await window.app.loadGraphData(window.__saved); await new Promise((r) => setTimeout(r, 1500));
        window.__rg = window.app.graph.nodes.find((x) => x.type === "Region-Genie_Main");
        window.app.canvas.ds.offset = [0, 0]; window.app.canvas.ds.scale = 0.72; window.app.canvas.setDirty(true, true); await new Promise((r) => setTimeout(r, 800)); });

    // ---------------- the divider between the canvas and the Regions list
    const sp = () => page.evaluate(() => ({ tree: document.querySelector(".rg-tree").offsetHeight, cv: document.querySelector(".rg-cv").offsetHeight,
                                             node: Math.round(window.__rg.size[1]), prop: window.__rg.properties.rg_list_h }));
    const d0 = await sp();
    const sb = await page.locator(".rg-split").first().boundingBox();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down();
    await page.mouse.move(sb.x + sb.width / 2, sb.y - 100, { steps: 6 }); await page.mouse.up(); await sleep(200);
    const d1 = await sp();
    check(`${M}: dragging the divider up: a taller list, a shorter canvas, the node keeps its size`, d1.tree > d0.tree + 100 && d1.cv < d0.cv && d1.node === d0.node && d1.prop === d1.tree);
    await page.locator(".rg-split").first().dblclick(); await sleep(200);
    const d2 = await sp();
    check(`${M}: double-click: the usual list height`, d2.tree === 220 && d2.prop === undefined);

    // ---------------- the tool options fold to an icon
    await page.evaluate(() => window.__rg.__rgSetTool("object")); await sleep(300);
    const strip = () => page.evaluate(() => { const s = document.querySelector(".rg-toolopts"), r = s.getBoundingClientRect();
        return { w: Math.round(r.width), find: !!s.querySelector(".rg-find")?.offsetParent, tip: s.querySelector(".lead")?.title || "" }; });
    const t0 = await strip();
    const stb = await page.locator(".rg-toolopts").first().boundingBox();
    await page.mouse.move(stb.x + 8, stb.y + 8); await sleep(200);
    const t1 = await strip();
    await page.mouse.move(1500, 1050); await sleep(200);
    const t2 = await strip();
    await page.mouse.click(stb.x + 8, stb.y + 8); await page.mouse.move(1500, 1050); await sleep(200);
    const t3 = await strip();
    check(`${M}: Select object: the options are a small icon (${t0.w}px) with a tooltip`, !t0.find && t0.w < 30 && /Find all/.test(t0.tip) && /Hover/.test(t0.tip));
    check(`${M}: hover opens 'find all…', leaving folds it`, t1.find && t1.w > 60 && !t2.find);
    check(`${M}: a click keeps it open`, t3.find);
    await page.mouse.click(stb.x + 8, stb.y + 8); await sleep(100);
    await page.evaluate(() => window.__rg.__rgSetTool("select"));

    // ---------------- the Regional LoRAs node: ◀ / ▶ through its fields, no outside-click close
    const rl = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        const n = LG.createNode("Region-Genie_RegionalLoRAs"); n.pos = [900, 40]; app.graph.add(n); window.__rl = n;
        n.widgets.find((w) => w.name === "positive_prompt").value = "pos text";
        n.widgets.find((w) => w.name === "negative_prompt").value = "neg text";
        const dw = n.widgets.find((w) => w.name === "loras_data");
        dw.value = JSON.stringify({ rows: [{ on: true, index: 0, lora: "a.safetensors", strength: 1, prompt: "row one" },
                                           { on: true, index: 1, lora: "b.safetensors", strength: 0.5, prompt: "row two" }] });
        n.onConfigure?.({});
        app.canvas.ds.offset = [-500, 0]; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 1500));
        return !!document.querySelector(".rg-rl-wrap");
    });
    if (rl) {
        await page.evaluate(() => { const t = [...document.querySelectorAll("textarea")].find((x) => x.value === "pos text"); t?.parentElement?.querySelector(".rg-expand")?.click(); });
        await sleep(300);
        const fp = () => page.evaluate(() => { const b = document.querySelector(".rg-fpop"); if (!b) return null; const r = b.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), v: b.querySelector("textarea").value,
                     nav: Math.round([...b.querySelectorAll(".rg-nav")].find((x) => x.textContent === "◀").getBoundingClientRect().left - r.left) }; });
        const p0 = await fp();
        await page.mouse.click(1550, 1050); await sleep(200);
        check(`Regional LoRAs (${M}): pop-up stays open on a click elsewhere`, !!p0 && !!(await fp()));
        const vals = [];
        for (let i = 0; i < 4; i++) { await page.evaluate(() => [...document.querySelectorAll(".rg-fpop .rg-nav")].find((b) => b.textContent === "▶").click()); await sleep(200); vals.push(await fp()); }
        check(`Regional LoRAs (${M}): ▶ steps positive → negative → row 1 → row 2 → positive, same place and size`,
            vals.map((x) => x?.v).join("|") === "neg text|row one|row two|pos text" && vals.every((x) => x.x === p0.x && x.y === p0.y && x.w === p0.w && x.h === p0.h));
        check(`Regional LoRAs (${M}): ◀ / ▶ stay in one place in the header (${vals.map((x) => x.nav).join(", ")})`, vals.every((x) => x.nav === vals[0].nav));
        await page.locator(".rg-fpop textarea").first().focus(); await page.keyboard.press("PageDown"); await sleep(200);
        const kd = await fp();
        await page.locator(".rg-fpop textarea").first().focus(); await page.keyboard.press("PageUp"); await sleep(200);
        const ku = await fp();
        check(`Regional LoRAs (${M}): Page Down / Page Up step through the fields (${kd?.v} | ${ku?.v})`, kd?.v === "neg text" && ku?.v === "pos text");
        a = await tipAudit();
        check(`Regional LoRAs (${M}): every control has a tooltip` + (a.bad.length ? ": " + a.bad.slice(0, 5).join("; ") : ""), !a.bad.length);
        f = await numFit();
        check(`Regional LoRAs (${M}): number fields fit` + (f.bad.length ? ": " + f.bad.slice(0, 4).join("; ") : ""), !f.bad.length);
        await page.keyboard.press("Escape");
        // an API-format workflow keeps the node's values (not the Settings defaults)
        const rapi = await page.evaluate(async () => {
            const s = window.app.extensionManager.setting;
            await s.set("RegionGenie.RegionalLoRAs.Feather", 9);
            window.app.graph.clear();
            await window.app.loadApiJson({ "1": { class_type: "Region-Genie_RegionalLoRAs", inputs: { feather: 3, region_separation: 0.4,
                separation_until: 0.6, separate_all_regions: true, share_background: true, positive_prompt: "p", negative_prompt: "n" } } }, "api.json");
            await new Promise((r) => setTimeout(r, 1200));
            const n = window.app.graph.nodes.find((x) => x.type === "Region-Genie_RegionalLoRAs");
            const fresh = window.LiteGraph.createNode("Region-Genie_RegionalLoRAs"); window.app.graph.add(fresh);
            await new Promise((r) => setTimeout(r, 300));
            const freshFeather = fresh.widgets.find((w) => w.name === "feather").value;
            await s.set("RegionGenie.RegionalLoRAs.Feather", 0);
            return { ...Object.fromEntries((n?.widgets || []).map((w) => [w.name, w.value])), freshFeather };
        });
        check(`Regional LoRAs (${M}): a newly added node still takes the Settings default (feather ${rapi.freshFeather})`, rapi.freshFeather === 9);
        check(`Regional LoRAs (${M}): an API-format workflow keeps its values (feather ${rapi.feather}, separation ${rapi.region_separation})`,
            rapi.feather === 3 && rapi.region_separation === 0.4 && rapi.separation_until === 0.6 && rapi.separate_all_regions === true && rapi.share_background === true);
        await page.keyboard.press("Escape");
    } else check(`Regional LoRAs (${M}): the node's editor is there`, false);

    await page.screenshot({ path: require("path").join(__dirname, "out", `real12_${vue ? "vue" : "legacy"}.png`) });
    check(`${M}: no page errors` + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""), !errors.length);
    await browser.close();
    console.log(fails.length ? `${fails.length} failed` : "all passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
