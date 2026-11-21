// Reads every text ComfyUI can translate for this pack (node definitions, Settings) from a running ComfyUI and
// writes the English reference the translations in locales/<language>/ are checked against: tests/i18n_en/*.json.
//
//   node tests/i18n_extract.cjs            rewrite tests/i18n_en/ (run it after changing a node text or a Setting)
//   node tests/i18n_extract.cjs --check    only compare; exit 1 when the reference is out of date
//
// The reference is NOT a locale ComfyUI loads: English comes from the code itself. tests/test_i18n.py then checks
// that every language has exactly the reference's entries (see locales/README.md).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const URL = process.env.COMFY_URL || "http://127.0.0.1:8188/";
const OUT = path.join(__dirname, "i18n_en");
const check = process.argv.includes("--check");
const norm = (k) => String(k).replace(/\./g, "_");          // the frontend's normalizeI18nKey

async function collect(page) {
    return await page.evaluate(async () => {
        const info = await (await fetch("/object_info")).json();
        const nodes = {};
        for (const [id, d] of Object.entries(info)) {
            if (!/Region-Genie/i.test(d.python_module || "")) continue;
            const inputs = {};
            for (const group of ["required", "optional"]) {
                for (const [name, spec] of Object.entries(d.input?.[group] || {})) {
                    const opts = spec?.[1] || {};
                    const e = { name };
                    if (opts.tooltip) e.tooltip = opts.tooltip;
                    // dropdown choices written in the node itself (not file lists, which come from the disk)
                    if (Array.isArray(spec?.[0])) {
                        const list = spec[0].filter((v) => typeof v === "string");
                        const files = list.some((v) => /\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx)$/i.test(v)) || /lora_name|^lora_\d+$/.test(name);
                        if (!files) e.choices = list.filter((v) => !/^[\d.]+$/.test(v));
                    }
                    inputs[name] = e;
                }
            }
            const outputs = {};
            (d.output_name || d.output || []).forEach((name, i) => {
                outputs[i] = { name };
                if (d.output_tooltips?.[i]) outputs[i].tooltip = d.output_tooltips[i];
            });
            nodes[id] = { display_name: d.display_name, description: d.description || "", inputs, outputs };
        }
        const settings = {}, categories = new Set();
        for (const s of Object.values(window.app.ui.settings.settingsParamLookup)) {
            // a setting on a page of the Region Genie settings window is "hidden" for ComfyUI's own list, but shown (and
            // translated) in the window: rgPage marks those
            if (!/^RegionGenie\./.test(s.id) || (s.type === "hidden" && !s.rgPage)) continue;
            const e = { name: s.name };
            if (s.tooltip) e.tooltip = s.tooltip;
            if (Array.isArray(s.options)) {
                const texts = s.options.map((o) => (typeof o === "string" ? o : o?.text)).filter((t) => typeof t === "string");
                if (texts.length) e.options = texts;
            }
            settings[s.id] = e;
            (s.category || []).slice(0, 2).forEach((c) => categories.add(c));
            if (s.rgPage && s.rgSection) categories.add(s.rgSection);      // a heading on its page of the settings window
        }
        return { nodes, settings, categories: [...categories] };
    });
}

// The shapes ComfyUI's /i18n expects (nodeDefs.json, settings.json, main.json).
function shape(raw) {
    const nodeDefs = {};
    for (const [id, d] of Object.entries(raw.nodes)) {
        const n = { display_name: d.display_name };
        if (d.description) n.description = d.description;
        n.inputs = {};
        for (const [name, e] of Object.entries(d.inputs)) {
            const o = { name: e.name };
            if (e.tooltip) o.tooltip = e.tooltip;
            n.inputs[norm(name)] = o;
        }
        n.outputs = {};
        for (const [i, e] of Object.entries(d.outputs)) {
            const o = { name: e.name };
            if (e.tooltip) o.tooltip = e.tooltip;
            n.outputs[i] = o;
        }
        nodeDefs[norm(id)] = n;
    }
    const settings = {};
    for (const [id, e] of Object.entries(raw.settings)) {
        const o = { name: e.name };
        if (e.tooltip) o.tooltip = e.tooltip;
        if (e.options) { o.options = {}; for (const t of e.options) o.options[norm(t)] = t; }
        settings[norm(id)] = o;
    }
    const settingsCategories = {};
    for (const c of raw.categories.sort()) settingsCategories[norm(c)] = c;
    // dropdown choices of node inputs: ComfyUI has no key for them, the pack's own script applies these (js/rg_i18n.js)
    const choices = {};
    for (const [id, d] of Object.entries(raw.nodes)) {
        for (const [name, e] of Object.entries(d.inputs)) {
            if (!e.choices?.length) continue;
            for (const c of e.choices) choices[c] = c;
        }
    }
    return { "nodeDefs.json": nodeDefs, "settings.json": settings, "main.json": { settingsCategories, regionGenie: { choices } } };
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(URL);
    await page.waitForFunction(() => window.app?.graph && window.app?.ui?.settings?.settingsParamLookup, null, { timeout: 90000 });
    await page.waitForTimeout(2500);
    const locale = await page.evaluate(() => window.app.extensionManager.setting.get("Comfy.Locale"));
    if (locale && locale !== "en") { console.log(`FAIL: ComfyUI's language is '${locale}'; set it to English first`); process.exit(1); }
    const files = shape(await collect(page));
    await browser.close();
    let stale = 0;
    fs.mkdirSync(OUT, { recursive: true });
    for (const [name, data] of Object.entries(files)) {
        const text = JSON.stringify(data, null, 2) + "\n";
        const file = path.join(OUT, name);
        const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        if (old === text) continue;
        stale++;
        if (check) console.log(`FAIL: tests/i18n_en/${name} is out of date (run: node tests/i18n_extract.cjs)`);
        else { fs.writeFileSync(file, text); console.log(`wrote tests/i18n_en/${name}`); }
    }
    if (!stale) console.log("ok: tests/i18n_en/ matches the running ComfyUI");
    process.exit(check && stale ? 1 : 0);
})();
