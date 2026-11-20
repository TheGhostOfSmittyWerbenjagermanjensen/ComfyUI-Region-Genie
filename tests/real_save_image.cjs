// Save Image (Region Genie) in the real ComfyUI frontend + server (CPU; no model files needed).
// Usage: COMFY_DIR=<ComfyUI folder> node real_save_image.cjs [vue]   ("vue" = Nodes 2.0).
// Needs ComfyUI on 127.0.0.1:8188 with this pack (bash tests/setup_real_comfy.sh --start); COMFY_DIR for the output folder.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path");
const vue = process.argv[2] === "vue";
const OUT = path.join(process.env.COMFY_DIR || "/tmp/comfy_src", "output");
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && /region|rg_|genie|save_image/i.test(m.text())) errors.push(m.text()); });
    await page.goto("http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(2000);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(300); }
    const M = vue ? "Nodes 2.0" : "legacy";
    const run = `rgsave_${vue ? "vue" : "leg"}_${Date.now() % 100000}`;
    await page.evaluate(async (vue) => {
        const s = window.app.extensionManager.setting;
        try { await s.set("Comfy.TutorialCompleted", true); } catch (e) {}
        await s.set("Comfy.VueNodes.Enabled", vue);
        await s.set("RegionGenie.Save.PngLevel", 3);
    }, vue);
    await sleep(1000);

    // a new node takes the Settings default; EmptyImage (2 images) and SolidMask feed it
    const made = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const img = LG.createNode("EmptyImage"); img.pos = [40, 40]; app.graph.add(img);
        const W = (n, k) => n.widgets.find((w) => w.name === k);
        W(img, "width").value = 64; W(img, "height").value = 48; W(img, "batch_size").value = 2; W(img, "color").value = 0x3366cc;
        const sm = LG.createNode("SolidMask"); sm.pos = [40, 300]; app.graph.add(sm);
        W(sm, "value").value = 0.25; W(sm, "width").value = 64; W(sm, "height").value = 48;
        const sv = LG.createNode("Region-Genie_SaveImage"); sv.pos = [420, 40]; app.graph.add(sv);
        img.connect(0, sv, 0);
        window.__sv = sv; window.__sm = sm;
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 1200));
        return { ok: !!sv.widgets, png: W(sv, "png_compression")?.value };
    });
    check(`${M}: the node exists; a new node takes the Settings default (PNG level 3)`, made.ok && made.png === 3);

    // only the chosen format's fields show
    const shown = () => page.evaluate((vue) => {
        const sv = window.__sv;
        const names = sv.widgets.filter((w) => !w.hidden && w.name !== "rg_saved" && w.type !== "converted-widget").map((w) => w.name);
        let dom = null;
        if (vue) {
            const box = document.querySelector(`[data-node-id="${sv.id}"]`);
            const txt = box?.innerText || "";
            dom = ["png_compression", "png_bit_depth", "webp_lossless", "webp_quality", "jpeg_quality", "jpeg_extension", "jpeg_workflow", "avif_quality", "exr_bit_depth", "exr_color_space", "invert_mask", "a1111_metadata"]
                .filter((n) => txt.includes(n));
        }
        return { names, dom };
    }, vue);
    const setW = (k, v) => page.evaluate(([k, v]) => { const w = window.__sv.widgets.find((x) => x.name === k); w.value = v; w.callback?.(v); }, [k, v]);
    const expect = {
        // (round 44: a1111_metadata, the switch for the settings text, with every format but EXR)
        png: ["filename_prefix", "format", "png_compression", "png_bit_depth", "a1111_metadata"],
        webp: ["filename_prefix", "format", "webp_lossless", "webp_quality", "a1111_metadata"],
        jpeg: ["filename_prefix", "format", "jpeg_quality", "jpeg_extension", "jpeg_workflow", "a1111_metadata"],
        avif: ["filename_prefix", "format", "avif_quality", "a1111_metadata"],
        exr: ["filename_prefix", "format", "exr_bit_depth", "exr_color_space"],
    };
    for (const f of ["png", "webp", "jpeg", "avif", "exr"]) {
        await setW("format", f); await sleep(300);
        const s = await shown();
        const want = expect[f];
        const domOk = !vue || JSON.stringify(s.dom) === JSON.stringify(want.filter((n) => n.includes("_") && n !== "filename_prefix"));
        check(`${M}: ${f}: only its fields show (${s.names.join(", ")})`, JSON.stringify(s.names) === JSON.stringify(want) && domOk);
    }
    await setW("format", "webp"); await setW("webp_lossless", true); await sleep(300);
    check(`${M}: webp lossless hides webp_quality`, !(await shown()).names.includes("webp_quality"));
    await setW("webp_lossless", false);
    await page.evaluate(async () => { window.__sm.connect(0, window.__sv, window.__sv.inputs.findIndex((i) => i.name === "mask")); await new Promise((r) => setTimeout(r, 300)); });
    await setW("format", "png"); await sleep(300);
    const withMask = (await shown()).names;
    await setW("format", "jpeg"); await sleep(300);
    const jpegMask = (await shown()).names;
    check(`${M}: invert_mask shows with a mask linked, not for jpeg`, withMask.includes("invert_mask") && !jpegMask.includes("invert_mask"));

    // a node made taller by hand keeps its height when the format changes (legacy; Nodes 2.0 sizes itself)
    const hgt = await page.evaluate(async () => {
        const sv = window.__sv, set = (k, v) => { const w = sv.widgets.find((x) => x.name === k); w.value = v; w.callback?.(v); };
        sv.setSize([sv.size[0], 700]);
        set("format", "avif"); await new Promise((r) => setTimeout(r, 200));
        set("format", "png"); await new Promise((r) => setTimeout(r, 200));
        return Math.round(sv.size[1]);
    });
    if (!vue) check(`${M}: a hand-enlarged node keeps its height when the format changes (${hgt})`, hgt >= 700);

    // every input has a tooltip
    const tips = await page.evaluate(() => {
        const d = window.__sv.constructor.nodeData;
        const all = { ...(d.input.required || {}), ...(d.input.optional || {}) };
        return Object.entries(all).filter(([, v]) => !(v[1]?.tooltip)).map(([k]) => k);
    });
    check(`${M}: every input has a tooltip` + (tips.length ? ": " + tips.join(", ") : ""), !tips.length);

    // runs, one per format
    const queue = async (fmt, extra = {}) => {
        await page.evaluate(([fmt, extra, run]) => {
            const sv = window.__sv;
            const set = (k, v) => { const w = sv.widgets.find((x) => x.name === k); if (w) { w.value = v; w.callback?.(v); } };
            set("format", fmt); set("filename_prefix", run + "/" + fmt);
            for (const [k, v] of Object.entries(extra)) set(k, v);
            window.__savedBefore = window.__rgSavedText?.();
        }, [fmt, extra, run]);
        const before = await page.evaluate(() => document.querySelector(".rg-save-out")?.title || "");
        await page.evaluate(() => window.app.queuePrompt(0, 1));
        for (let i = 0; i < 120; i++) {
            await sleep(500);
            const t = await page.evaluate(() => document.querySelector(".rg-save-out")?.title || "");
            if (t && t !== before && t.includes("_0000")) break;
        }
        return page.evaluate(() => ({ text: document.querySelector(".rg-save-out")?.textContent || "", tip: document.querySelector(".rg-save-out")?.title || "" }));
    };
    // prefix "<run>/<fmt>": the folder <run>, files named <fmt>_NNNNN.*
    const ls = (fmt) => { try { return fs.readdirSync(path.join(OUT, run)).filter((f) => f.startsWith(fmt + "_")).sort(); } catch (e) { return []; } };
    let r = await queue("png");
    check(`${M}: png run: 2 files, the readout shows the label and a size (${r.text})`, ls("png").join() === "png_00001.png,png_00002.png" && /PNG 3/.test(r.text) && /\d+(\.\d+)? (B|KB|MB)/.test(r.text));
    r = await queue("webp");
    check(`${M}: webp run`, ls("webp").length === 2 && /WebP q90/.test(r.text));
    r = await queue("jpeg");
    check(`${M}: jpeg run: 2 JPEGs + 2 sidecars, the mask note`, ls("jpeg").join() === "jpeg_00001.jpg,jpeg_00001.json,jpeg_00002.jpg,jpeg_00002.json" && /transparency/.test(r.text + r.tip));
    {   // the total is the images'; the .json files show apart
        const sz = (f) => fs.statSync(path.join(OUT, run, f)).size;
        const kb = (n) => (n < 1024 ? `${n} B` : (n / 1024 < 100 ? (n / 1024).toFixed(1) : String(Math.round(n / 1024))) + " KB");   // as the node
        const imgs = sz("jpeg_00001.jpg") + sz("jpeg_00002.jpg"), js = sz("jpeg_00001.json") + sz("jpeg_00002.json");
        check(`${M}: jpeg readout: the images' total, the .json files apart (${r.text})`, r.text.includes(`2 × JPEG q90 · ${kb(imgs)} total`)
            && r.text.includes(`+ 2 .json · ${kb(js)}`));
    }
    r = await queue("avif");
    check(`${M}: avif run`, ls("avif").length === 2 && /AVIF q80/.test(r.text));
    // EXR (round 14): ComfyUI's own encoder; scene-linear float, the mask as alpha, the workflow in the header
    r = await queue("exr", { exr_bit_depth: "32-bit float" });
    const exrs = ls("exr");
    let exrOk = false, exrInfo = "";
    if (exrs.length) {
        const f = path.join(OUT, run, exrs[0]), buf = fs.readFileSync(f);
        const head = buf.subarray(0, 4).toString("hex"), hasWf = buf.indexOf("workflow") > 0 && buf.indexOf("prompt") > 0;
        try {
            const py = "import av,sys,numpy as np\nc=av.open(sys.argv[1]);fr=next(c.decode(video=0));a=fr.to_ndarray(format=fr.format.name)\n"
                + "print(fr.width,fr.height,fr.format.name,round(float(a.max()),3))";
            exrInfo = require("child_process").execFileSync("python3", ["-c", py, f], { encoding: "utf8" }).trim();
        } catch (e) { exrInfo = "decode failed: " + String(e.message).slice(0, 80); }
        exrOk = head === "762f3101" && hasWf && /^64 48 gbrap?f32le/.test(exrInfo);
    }
    check(`${M}: exr run: 2 EXR files, float, 64 x 48, with the workflow in the header (${exrs.join(",")}; ${exrInfo}; ${r.text})`,
        exrs.length === 2 && exrOk && /EXR 32-bit float/.test(r.text));
    const stale = await page.evaluate(async () => {
        const out = document.querySelector(".rg-save-out"), fresh = !out.classList.contains("stale");
        const w = window.__sv.widgets.find((x) => x.name === "avif_quality"); w.value = 50; w.callback?.(50);
        await new Promise((r) => setTimeout(r, 100));
        return { fresh, stale: out.classList.contains("stale"), tip: out.title, op: getComputedStyle(out).opacity };
    });
    check(`${M}: after a setting change the readout is dimmed and says it's from the last run (${stale.op})`,
        stale.fresh && stale.stale && /^From the last run/.test(stale.tip) && +stale.op < 0.6);
    // the filename token
    const tok = await page.evaluate(async (run) => {
        const sv = window.__sv; const w = sv.widgets.find((x) => x.name === "filename_prefix");
        w.value = run + "/tok_%date:yyyy%";
        const p = await window.app.graphToPrompt();
        return p.output[String(sv.id)].inputs.filename_prefix;
    }, run);
    check(`${M}: %date:yyyy% is filled in when queued (${tok})`, tok === `${run}/tok_${new Date().getFullYear()}`);

    // without the frontend's helper, the node's own replacement gives the same as ComfyUI's
    const fb = await page.evaluate(async (run) => {
        const sv = window.__sv, sm = window.__sm, app = window.app;
        const img = app.graph.nodes.find((n) => n.type === "EmptyImage");
        const w = sv.widgets.find((x) => x.name === "filename_prefix"), mv = sm.widgets.find((x) => x.name === "value"), mw = sm.widgets.find((x) => x.name === "width");
        const keep = { fn: window.comfyAPI.utils.applyTextReplacements, title: img.title, v: mv.value, mw: mw.value, pre: w.value };
        const viaCore = (t) => keep.fn(app.graph, t);
        img.title = "SolidMask"; mv.value = 'a:b?c*d|e"f<g>h'; mw.value = 128;
        const texts = ["x_%SolidMask.width%", "x_%SolidMask.value%", "x_%date:yyyy-MM-dd%", "x_%date:yy-M-d%", "x_%date:yyyyMMdd%", "x_%Nope.width%", "x_%width%", "x_%SolidMask.nope%"];
        const core = texts.map(viaCore);
        window.comfyAPI.utils.applyTextReplacements = undefined;
        const own = [];
        for (const t of texts) { w.value = t; own.push(await w.serializeValue()); }      // await: another pack may wrap it
        window.comfyAPI.utils.applyTextReplacements = keep.fn;
        img.title = keep.title; mv.value = keep.v; mw.value = keep.mw; w.value = keep.pre;
        return { core, own };
    }, run);
    check(`${M}: the node's own token replacement matches ComfyUI's (${fb.own.join(" | ")})`, JSON.stringify(fb.own) === JSON.stringify(fb.core)
        && fb.core[0] === "x_128" && fb.core[1] === "x_a_b_c_d_e_f_g_h");

    // the files load their workflow back; the PNG has the mask's alpha (0.25 mask -> alpha 191)
    const back = await page.evaluate(async (run) => {
        const out = {};
        for (const [k, sub, name, type] of [["png", "png", "png_00001.png", "image/png"], ["webp", "webp", "webp_00001.webp", "image/webp"],
                                             ["avif", "avif", "avif_00001.avif", "image/avif"], ["json", "jpeg", "jpeg_00001.json", "application/json"]]) {
            window.app.graph.clear();
            const res = await fetch(`/view?filename=${name}&type=output&subfolder=${encodeURIComponent(run)}`);
            const blob = await res.blob();
            const done = await Promise.race([window.app.handleFile(new File([blob], name, { type })).then(() => "ok", (e) => "error: " + e),
                                             new Promise((r) => setTimeout(() => r("timeout"), 8000))]);
            await new Promise((r) => setTimeout(r, 1200));
            out[k] = window.app.graph.nodes.some((n) => n.type === "Region-Genie_SaveImage");
            out[k + "_how"] = done + " / " + res.status + " / " + blob.size;
        }
        const res = await fetch(`/view?filename=png_00001.png&type=output&subfolder=${encodeURIComponent(run)}`);
        const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none" });
        const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
        out.alpha = g.getImageData(5, 5, 1, 1).data[3];
        return out;
    }, run);
    console.log("drag-load:", JSON.stringify(back));
    check(`${M}: dropping the PNG loads its workflow`, back.png);
    check(`${M}: dropping the WebP loads its workflow`, back.webp);
    check(`${M}: dropping the AVIF loads its workflow`, back.avif);
    check(`${M}: dropping the JPEG's .json loads its workflow`, back.json);
    check(`${M}: the PNG has the mask's transparency (alpha ${back.alpha})`, Math.abs(back.alpha - 191) <= 1);

    // an API-format workflow keeps the node's values (not the Settings defaults)
    const api = await page.evaluate(async () => {
        window.app.graph.clear();
        await window.app.loadApiJson({
            "2": { class_type: "EmptyImage", inputs: { width: 64, height: 48, batch_size: 1, color: 0 } },
            "1": { class_type: "Region-Genie_SaveImage", inputs: { images: ["2", 0], filename_prefix: "api", format: "jpeg", png_compression: 5,
                   png_bit_depth: "16-bit", webp_lossless: true, webp_quality: 41, jpeg_quality: 60, jpeg_extension: ".jpeg",
                   jpeg_workflow: "none", avif_quality: 33 } },
        }, "api.json");
        await new Promise((r) => setTimeout(r, 1200));
        const n = window.app.graph.nodes.find((x) => x.type === "Region-Genie_SaveImage");
        return Object.fromEntries((n?.widgets || []).filter((w) => w.name !== "rg_saved").map((w) => [w.name, w.value]));
    });
    check(`${M}: an API-format workflow keeps the node's values (${JSON.stringify(api)})`, api.format === "jpeg" && api.jpeg_quality === 60
        && api.jpeg_extension === ".jpeg" && api.jpeg_workflow === "none" && api.png_compression === 5 && api.webp_lossless === true && api.avif_quality === 33);

    // round 20: a workflow saved before EXR (widget values by position, no exr fields): invert_mask's false used to
    // land in exr_bit_depth ("Value not in list: exr_bit_depth: False") whatever the format
    const pre = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const n = LG.createNode("Region-Genie_SaveImage"); n.pos = [100, 100]; app.graph.add(n);
        await new Promise((r) => setTimeout(r, 500));
        const cur = Object.fromEntries(n.widgets.map((w) => [w.name, w.value]));
        const old = ["filename_prefix", "format", "png_compression", "png_bit_depth", "webp_lossless", "webp_quality", "jpeg_quality",
                     "jpeg_extension", "jpeg_workflow", "avif_quality", "invert_mask"];
        const out = {};
        for (const props of [true, false]) {
            const g = app.graph.serialize(), s = g.nodes.find((x) => x.type === "Region-Genie_SaveImage");
            s.widgets_values = old.map((k) => (k === "format" ? "webp" : k === "invert_mask" ? true : cur[k]));
            if (props) s.properties.rg_widget_values = Object.fromEntries(old.map((k, i) => [k, s.widgets_values[i]])); else delete s.properties.rg_widget_values;
            await app.loadGraphData(g); await new Promise((r) => setTimeout(r, 1200));
            const p = await app.graphToPrompt();
            const inp = Object.values(p.output).find((x) => x.class_type === "Region-Genie_SaveImage").inputs;
            out[props ? "with" : "without"] = inp;
        }
        return out;
    });
    check(`${M}: a workflow saved before EXR loads with valid EXR fields (${pre.with.exr_bit_depth}, ${pre.with.exr_color_space}; ${pre.without.exr_bit_depth})`,
        pre.with.exr_bit_depth === "16-bit float" && pre.with.exr_color_space === "sRGB" && pre.with.format === "webp" && pre.with.invert_mask === true
        && pre.without.exr_bit_depth === "16-bit float" && pre.without.format === "webp");

    // ---------------- round 44: the settings text for other interfaces (A1111 / Forge style), and its optional inputs
    const META = ["positive_prompt", "negative_prompt", "seed", "steps", "cfg", "sampler_name", "scheduler", "denoise", "model_name"];
    const built = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const W = (n, k) => n.widgets.find((w) => w.name === k);
        const img = LG.createNode("EmptyImage"); img.pos = [40, 40]; app.graph.add(img);
        W(img, "width").value = 64; W(img, "height").value = 48; W(img, "batch_size").value = 1;
        const seed = LG.createNode("PrimitiveInt"); seed.pos = [40, 320]; app.graph.add(seed); W(seed, "value").value = 31;
        const txt = LG.createNode("PrimitiveString"); txt.pos = [40, 460]; app.graph.add(txt); W(txt, "value").value = "a test prompt, 日本語";
        const sv = LG.createNode("Region-Genie_SaveImage"); sv.pos = [460, 40]; app.graph.add(sv);
        img.connect(0, sv, 0);
        window.__sv = sv; window.__seed = seed; window.__txt = txt;
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 1200));
        return { inputs: sv.inputs.map((i) => i.name), shown: sv.__rgMetaInputs(), sw: W(sv, "a1111_metadata")?.value, h: sv.size[1] };
    });
    check(`${M}: a new node: the switch for the settings text is on, and none of its optional inputs shows (${built.shown.join(", ") || "none"})`,
        built.sw === true && built.shown.length === 0 && !META.some((n) => built.inputs.includes(n)) && built.inputs.includes("images"));
    const cable = page.locator(".rg-save-out .rg-save-socks").last();
    check(`${M}: a cable button at the end of the node's status line, with a tooltip`, await cable.count() === 1 && await cable.isVisible() && /^Inputs: /.test(await cable.getAttribute("title") || ""));
    await cable.click(); await sleep(400);
    const list = () => page.evaluate(() => { const b = document.querySelector(".rg-save-list"); if (!b) return null; const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
        return { rows: [...b.querySelectorAll("label")].map((l) => ({ n: l.dataset.sock, on: l.querySelector("input").checked, off: l.querySelector("input").disabled, why: l.querySelector(".rg-socks-why")?.textContent || "", tip: l.title })),
            inWin: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, onTop: b.contains(top) }; });
    let L = await list();
    check(`${M}: it opens the inputs list: nine inputs, none ticked, on top and inside the window`, !!L && L.rows.map((r) => r.n).join() === META.join() && L.rows.every((r) => !r.on && !r.off && r.tip.length > 12) && L.inWin && L.onTop);
    await page.locator('.rg-save-list label[data-sock="seed"]').click(); await sleep(400);
    let st = await page.evaluate(() => ({ inputs: window.__sv.inputs.map((i) => i.name), prop: window.__sv.properties.rg_meta_inputs, h: window.__sv.size[1] }));
    check(`${M}: ticking 'seed' gives the node a seed input (${st.inputs.filter((n) => n === "seed").length}); it is noted on the node; the list stays open`,
        st.inputs.includes("seed") && !st.inputs.includes("steps") && JSON.stringify(st.prop) === '["seed"]' && (await list())?.rows.find((r) => r.n === "seed").on === true);
    if (!vue) check(`${M}: the node grows by the new input's row (${built.h} -> ${st.h})`, st.h > built.h);
    await page.locator('.rg-save-list label[data-sock="positive_prompt"]').click(); await sleep(300);
    await page.evaluate(() => { const sv = window.__sv; window.__seed.connect(0, sv, sv.inputs.findIndex((i) => i.name === "seed")); window.__txt.connect(0, sv, sv.inputs.findIndex((i) => i.name === "positive_prompt")); });
    await sleep(700);
    L = await list();
    check(`${M}: a connected input is marked 'connected' in the list and can't be unticked`, L.rows.find((r) => r.n === "seed").off && L.rows.find((r) => r.n === "seed").why === "connected" && L.rows.find((r) => r.n === "positive_prompt").off);
    await page.locator('.rg-save-list label[data-sock="steps"]').click(); await sleep(300);
    await page.locator('.rg-save-list label[data-sock="steps"]').click(); await sleep(300);
    check(`${M}: an input ticked and unticked again is gone`, await page.evaluate(() => !window.__sv.inputs.some((i) => i.name === "steps")));
    await page.keyboard.press("Escape"); await sleep(300);
    check(`${M}: Esc closes the list`, await page.locator(".rg-save-list").count() === 0);
    // saved and loaded: the ticked inputs and their links are still there, the others are not
    const re = await page.evaluate(async () => {
        const app = window.app, g = app.graph.serialize();
        await app.loadGraphData(g); await new Promise((r) => setTimeout(r, 1500));
        const sv = app.graph.nodes.find((x) => x.type === "Region-Genie_SaveImage"); window.__sv = sv;
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        const p = await app.graphToPrompt(), inp = Object.values(p.output).find((x) => x.class_type === "Region-Genie_SaveImage").inputs;
        return { shown: sv.__rgMetaInputs(), linked: sv.inputs.filter((i) => i.link != null).map((i) => i.name), sent: Object.keys(inp).filter((k) => Array.isArray(inp[k])) };
    });
    check(`${M}: saved and loaded again: the two ticked inputs are there with their links, the rest stays hidden (${re.shown.join(", ")}; sent: ${re.sent.join(", ")})`,
        re.shown.join() === "positive_prompt,seed" && ["images", "positive_prompt", "seed"].every((n) => re.linked.includes(n)) && ["images", "positive_prompt", "seed"].every((n) => re.sent.includes(n)));
    // a run: the text is in the file, next to ComfyUI's own data
    const chunks = (file) => { const b = fs.readFileSync(file), out = {}; let p = 8;
        while (p < b.length) { const n = b.readUInt32BE(p), kind = b.toString("latin1", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + n);
            if (kind === "tEXt") { const z = d.indexOf(0); out[d.toString("latin1", 0, z)] = d.toString("latin1", z + 1); }
            if (kind === "iTXt") { const z = d.indexOf(0); out[d.toString("latin1", 0, z)] = d.toString("utf8", z + 5); }
            p += 12 + n; }
        return out; };
    r = await queue("png");
    let file = ls("png").pop();
    let info = file ? chunks(path.join(OUT, run, file)) : {};
    check(`${M}: a run with the two inputs connected: the PNG has the settings text with their values (${JSON.stringify((info.parameters || "").slice(0, 70))})`,
        (info.parameters || "").startsWith("a test prompt, 日本語\n") && /Seed: 31, Size: 64x48/.test(info.parameters) && /Version: ComfyUI$/.test(info.parameters));
    check(`${M}: ComfyUI's own workflow data is in the file as before`, !!info.workflow && !!info.prompt && JSON.parse(info.workflow).nodes.length >= 3);
    check(`${M}: the node's status line tells what was written (its tooltip)`, /Settings text written for other interfaces/.test(r.tip) && /Seed: 31/.test(r.tip) && await cable.count() === 1);
    r = await queue("jpeg");
    file = ls("jpeg").filter((f) => !f.endsWith(".json")).pop();
    const jb = file ? fs.readFileSync(path.join(OUT, run, file)) : Buffer.alloc(0);
    const be = (t) => { const le = Buffer.from(t, "utf16le"); for (let i = 0; i + 1 < le.length; i += 2) { const x = le[i]; le[i] = le[i + 1]; le[i + 1] = x; } return le; };
    check(`${M}: a JPEG has the text too, in its EXIF (where A1111 puts it), the workflow in the .json next to it`, jb.includes(Buffer.from("UNICODE\0", "latin1")) && jb.includes(be("Seed: 31")) && ls("jpeg").some((f) => f.endsWith(".json")));
    r = await queue("png", { a1111_metadata: false });
    file = ls("png").pop();
    info = file ? chunks(path.join(OUT, run, file)) : {};
    check(`${M}: with the switch off: no settings text, only ComfyUI's own data`, !("parameters" in info) && !!info.workflow && !/Settings text written/.test(r.tip));
    await setW("a1111_metadata", true);

    // a Region Genie node before the save node: the text holds the prompt as that node put it out (its 'prompt' output),
    // after a real run on the server (no sampler here: there is no model in a test run)
    const rgRun = await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph;
        app.graph.clear();
        const W = (n, k) => n.widgets.find((w) => w.name === k);
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [40, 40]; app.graph.add(rg);
        await new Promise((r) => setTimeout(r, 1500));
        rg.__rgShowAll?.();
        W(rg, "scene_prompt_positive").value = "a harbour at dawn"; W(rg, "scene_prompt_negative").value = "blurry, low quality";
        const sv = LG.createNode("Region-Genie_SaveImage"); sv.pos = [900, 40]; app.graph.add(sv);
        rg.connect(rg.outputs.findIndex((o) => o.name === "color_map"), sv, 0);
        window.__sv = sv;
        await new Promise((r) => setTimeout(r, 800));
        return { out: rg.outputs.map((o) => o.name).includes("color_map") };
    });
    r = await queue("png", { filename_prefix: run + "/rgnode" });
    file = (() => { try { return fs.readdirSync(path.join(OUT, run)).filter((f) => f.startsWith("rgnode_")).sort().pop(); } catch (e) { return null; } })();
    info = file ? chunks(path.join(OUT, run, file)) : {};
    check(`${M}: with a Region Genie node before it: the text has that node's prompt and negative prompt as the run used them (${JSON.stringify((info.parameters || "").slice(0, 80))})`,
        rgRun.out && (info.parameters || "").startsWith("a harbour at dawn") && /\nNegative prompt: blurry, low quality\n/.test(info.parameters) && /Version: ComfyUI$/.test(info.parameters));

    await page.screenshot({ path: path.join(__dirname, "out", `real_save_${vue ? "vue" : "legacy"}.png`) });
    check(`${M}: no page errors` + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""), !errors.length);
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Save.PngLevel", 9); });
    await browser.close();
    console.log(fails.length ? `${fails.length} failed` : "all passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
