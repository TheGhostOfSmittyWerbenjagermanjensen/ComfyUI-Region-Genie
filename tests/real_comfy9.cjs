// Round 9 checks in the real ComfyUI frontend + server (CPU; no model files needed).
// Usage: node real_comfy9.cjs [vue]   ("vue" = Nodes 2.0). Needs ComfyUI on 127.0.0.1:8188 with this pack (and Impact Pack
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
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg);
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
    check(`${M}: 'width' / 'height' inputs at the end, no old width / height sockets`, JSON.stringify(made.inputs.slice(-2)) === '["width","height"]' && made.widthSockets === 0);
    const row = page.locator(".rg-size").first();
    const rb = await row.boundingBox();
    check(`${M}: the row is one line (${Math.round(rb?.height)} px)`, rb && rb.height >= 18 && rb.height <= 30);
    await row.locator("select.rg-sel").first().selectOption("16:9 (Widescreen)");
    await page.waitForTimeout(200);
    const wv2 = await page.evaluate(() => ["width", "height"].map((n) => window.__rg.widgets.find((w) => w.name === n).value));
    check(`${M}: 16:9 sets 1368 x 768 (as Resolution Selector)`, JSON.stringify(wv2) === "[1368,768]");
    await page.screenshot({ path: require("path").join(__dirname, "out", `real9_${vue ? "vue" : "legacy"}.png`), clip: { x: 0, y: 0, width: 800, height: 700 } });

    // ---------------- a workflow saved before the size row: width linked to a primitive, no rg_size
    const old = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        const g = app.graph.serialize();
        const n = g.nodes.find((x) => x.type === "Region-Genie_Main");
        delete n.properties.rg_size;
        n.properties.rg_widget_values = { ...(n.properties.rg_widget_values || {}), width: 832, height: 1216 };
        const wv = n.widgets_values; if (Array.isArray(wv)) { const i = wv.indexOf(1368); if (i >= 0) { wv[i] = 832; wv[i + 1] = 1216; } }
        // an old 'width' widget socket with a link from an Int node
        const src = { id: 900, type: "PrimitiveInt", pos: [-300, 40], size: [220, 80], flags: {}, order: 0, mode: 0, inputs: [],
                      outputs: [{ name: "INT", type: "INT", links: [901] }], properties: {}, widgets_values: [640, "fixed"] };
        n.inputs = [...(n.inputs || []), { name: "width", type: "INT", widget: { name: "width" }, link: 901 }];
        g.nodes.push(src);
        g.links.push([901, 900, 0, n.id, n.inputs.length - 1, "INT"]);
        g.last_link_id = Math.max(g.last_link_id || 0, 901); g.last_node_id = Math.max(g.last_node_id || 0, 900);
        await app.loadGraphData(g);
        await new Promise((r) => setTimeout(r, 1500));
        const rg = app.graph.nodes.find((x) => x.type === "Region-Genie_Main"); window.__rg = rg;
        const W = (k) => rg.widgets.find((w) => w.name === k).value;
        const wi = rg.inputs.find((i) => i.name === "width_in");
        const l = wi?.link != null ? (app.graph.links.get?.(wi.link) ?? app.graph.links[wi.link]) : null;
        return { mode: rg.properties.rg_size?.mode, wv: [W("width"), W("height")], moved: !!l && String(l.origin_id) === "900",
                 oldGone: !rg.inputs.some((i) => i.name === "width"), out: document.querySelector(".rg-size-out")?.textContent };
    });
    check(`${M}: old workflow opens in manual mode with its size`, old.mode === "manual" && JSON.stringify(old.wv) === "[832,1216]");
    check(`${M}: its width link moved to the new 'width' input`, old.moved && old.oldGone);
    check(`${M}: the input decides the width (640 x 1216)`, /640 × 1216/.test(old.out || ""));

    // ---------------- a real run: Resolution Selector into width / height, one region hidden
    const run = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const rs = LG.createNode("ResolutionSelector"); rs.pos = [-300, 40]; app.graph.add(rs);
        rs.widgets.find((w) => w.name === "aspect_ratio").value = "16:9 (Widescreen)";
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); window.__rg = rg;
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

    check(`${M}: no Region Genie errors in the console` + (errors.length ? ": " + errors.slice(0, 3).join(" / ") : ""), errors.length === 0);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
