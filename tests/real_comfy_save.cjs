// Save Image (Region Genie) in the real ComfyUI frontend + server (CPU; no model files needed).
// Usage: COMFY_DIR=<ComfyUI folder> node real_comfy_save.cjs [vue]   ("vue" = Nodes 2.0).
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
            dom = ["png_compression", "png_bit_depth", "webp_lossless", "webp_quality", "jpeg_quality", "jpeg_extension", "jpeg_workflow", "avif_quality", "invert_mask"]
                .filter((n) => txt.includes(n));
        }
        return { names, dom };
    }, vue);
    const setW = (k, v) => page.evaluate(([k, v]) => { const w = window.__sv.widgets.find((x) => x.name === k); w.value = v; w.callback?.(v); }, [k, v]);
    const expect = {
        png: ["filename_prefix", "format", "png_compression", "png_bit_depth"],
        webp: ["filename_prefix", "format", "webp_lossless", "webp_quality"],
        jpeg: ["filename_prefix", "format", "jpeg_quality", "jpeg_extension", "jpeg_workflow"],
        avif: ["filename_prefix", "format", "avif_quality"],
    };
    for (const f of ["png", "webp", "jpeg", "avif"]) {
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
    r = await queue("avif");
    check(`${M}: avif run`, ls("avif").length === 2 && /AVIF q80/.test(r.text));
    // the filename token
    const tok = await page.evaluate(async (run) => {
        const sv = window.__sv; const w = sv.widgets.find((x) => x.name === "filename_prefix");
        w.value = run + "/tok_%date:yyyy%";
        const p = await window.app.graphToPrompt();
        return p.output[String(sv.id)].inputs.filename_prefix;
    }, run);
    check(`${M}: %date:yyyy% is filled in when queued (${tok})`, tok === `${run}/tok_${new Date().getFullYear()}`);

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

    await page.screenshot({ path: path.join(__dirname, "out", `real_save_${vue ? "vue" : "legacy"}.png`) });
    check(`${M}: no page errors` + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""), !errors.length);
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.Save.PngLevel", 9); });
    await browser.close();
    console.log(fails.length ? `${fails.length} failed` : "all passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
