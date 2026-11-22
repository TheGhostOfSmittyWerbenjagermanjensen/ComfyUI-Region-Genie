// The translations (locales/<language>/) in the real ComfyUI frontend, per language ComfyUI is switched to:
// every translated text passes ComfyUI's translation engine unchanged, node titles / input names / tooltips and the
// dropdown choices show translated while the saved values stay English, the Settings dialog shows every translated
// name, and the Region Genie editor still draws. First: the English reference (tests/i18n_en/) is up to date.
//
//   node tests/real_i18n.cjs [vue] [language ...]      default: every folder in locales/
// Needs a running ComfyUI with this pack, started AFTER the locale files were last changed (it reads them at start).
// It switches ComfyUI's language and puts English back at the end.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const vue = args.includes("vue");
const LOC = path.join(__dirname, "..", "locales");
const REF = path.join(__dirname, "i18n_en");
const langs = args.filter((a) => a !== "vue").length ? args.filter((a) => a !== "vue") : fs.readdirSync(LOC).filter((d) => fs.statSync(path.join(LOC, d)).isDirectory());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log((ok ? "ok   " : "FAIL ") + name); };
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === "object") flat(v, p ? `${p}.${k}` : k, out); else out[p ? `${p}.${k}` : k] = v; } return out; };
const plain = (t) => t.replace(/\{'([^']*)'\}/g, "$1");      // vue-i18n's literal form, as shown

(async () => {
    try { execFileSync("node", [path.join(__dirname, "i18n_extract.cjs"), "--check"], { stdio: "pipe", env: process.env }); check("the English reference (tests/i18n_en/) matches the running ComfyUI", true); }
    catch (e) { console.log(String(e.stdout || e.message).trim()); check("the English reference (tests/i18n_en/) matches the running ComfyUI", false); }

    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1900, height: 1300 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    const ready = async () => { await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting && window.app?.ui?.settings?.settingsParamLookup, null, { timeout: 90000 }); await sleep(2500); for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(200); } };
    await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/"); await ready();
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) {} await s.set("Comfy.VueNodes.Enabled", vue); }, vue);
    const en = { nodes: read(REF, "nodeDefs.json"), settings: read(REF, "settings.json"), main: read(REF, "main.json") };
    try {
        for (const lang of langs) {
            const dir = path.join(LOC, lang), T = (s) => `${lang}${vue ? " (Nodes 2.0)" : ""}: ${s}`;
            const nodes = read(dir, "nodeDefs.json"), settings = read(dir, "settings.json"), main = read(dir, "main.json");
            await page.evaluate(async (lang) => { await window.app.extensionManager.setting.set("Comfy.Locale", lang); }, lang);
            await sleep(1200); await page.reload(); await ready(); errors.length = 0;

            // 1. every text through ComfyUI's translation engine
            const want = { ...flat({ nodeDefs: nodes }), ...flat({ settings }), ...flat({ settingsCategories: main.settingsCategories }) };
            const got = await page.evaluate((keys) => {
                const root = [...document.querySelectorAll("body > *, #vue-app")].find((e) => e.__vue_app__);
                const g = root.__vue_app__.config.globalProperties, out = {};
                for (const k of keys) { try { out[k] = g.$t(k); } catch (e) { out[k] = "THROWS: " + String(e.message).slice(0, 60); } }
                return out;
            }, Object.keys(want));
            const bad = Object.keys(want).filter((k) => got[k] !== plain(want[k]));
            check(T(`all ${Object.keys(want).length} texts come out of ComfyUI's translation engine as written${bad.length ? ` (${bad.slice(0, 3).map((k) => `${k} -> ${String(got[k]).slice(0, 40)}`).join(" | ")})` : ""}`), !bad.length);

            // 2. the nodes: titles, names, dropdown choices; values stay English
            const r = await page.evaluate(async () => {
                const app = window.app, LG = window.LiteGraph; app.graph.clear(); const out = {}; let x = 40;
                for (const id of ["Region-Genie_Main", "Region-Genie_RegionalLoRAs", "Region-Genie_SaveImage", "Region-Genie_MaskPicker", "Region-Genie_BBoxToMasks", "Region-Genie_CreateHookLoRA"]) {
                    const n = LG.createNode(id); n.pos = [x, 60]; app.graph.add(n); x += (n.size?.[0] || 400) + 40;
                    out[id] = { title: n.title, nid: n.id,
                        inputs: Object.fromEntries((n.inputs || []).map((i) => [i.name, i.label ?? i.localized_name ?? null])),
                        outputs: (n.outputs || []).map((o) => o.label ?? o.localized_name ?? null),
                        widgets: Object.fromEntries((n.widgets || []).map((w) => [w.name, { label: w.label ?? null, type: w.type, value: w.value, shown: w.type === "combo" && w.options?.getOptionLabel ? w.options.getOptionLabel(w.value) : null }])) };
                }
                await new Promise((r) => setTimeout(r, 2500));
                app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 0.7; app.canvas.setDirty(true, true);
                out.editor = !!document.querySelector(".rg-root, .rg-editor, [class*='rg-'] canvas");
                const p = await app.graphToPrompt();
                out.prompt = Object.fromEntries(Object.values(p.output).map((n) => [n.class_type, n.inputs]));
                return out;
            });
            const ids = Object.keys(nodes).filter((id) => r[id]);
            check(T(`node titles are translated (${ids.map((id) => r[id].title).join(" | ")})`), ids.every((id) => r[id].title === plain(nodes[id].display_name)));
            const nameBad = [];
            for (const id of ids) {
                for (const [k, e] of Object.entries(nodes[id].inputs)) {
                    const shown = r[id].inputs[k] ?? r[id].widgets[k]?.label;
                    if (shown == null) continue;                                  // hidden / replaced by the editor
                    // the width_in / height_in sockets show as the width / height inputs (js/editor/sizeRow.js)
                    const name = id === "Region-Genie_Main" && /^(width|height)_in$/.test(k) ? nodes[id].inputs[k.slice(0, -3)].name : e.name;
                    if (!String(shown).startsWith(plain(name))) nameBad.push(`${id}.${k}: ${shown}`);
                }
                Object.entries(nodes[id].outputs).forEach(([i, e]) => { if (r[id].outputs[i] !== plain(e.name)) nameBad.push(`${id} output ${i}: ${r[id].outputs[i]}`); });
            }
            check(T(`input / output names are translated${nameBad.length ? ` (${nameBad.slice(0, 4).join(" | ")})` : ""}`), !nameBad.length);
            const C = main.regionGenie.choices, cw = [];
            for (const id of ids) for (const [k, w] of Object.entries(r[id].widgets)) if (w.type === "combo" && typeof w.value === "string" && C[w.value]) cw.push({ id, k, w });
            check(T(`dropdown choices show translated (${cw.length} dropdowns, e.g. ${cw[0]?.w.value} -> ${cw[0]?.w.shown})`), cw.length >= 8 && cw.every((c) => c.w.shown === plain(C[c.w.value])));
            const sv = r.prompt["Region-Genie_SaveImage"] || {}, rl = r.prompt["Region-Genie_RegionalLoRAs"] || {};
            check(T(`the values sent with a run stay English (format: ${sv.format}, jpeg_workflow: ${sv.jpeg_workflow}, lora_masking: ${rl.lora_masking})`),
                sv.format === "png" && sv.jpeg_workflow === "sidecar .json" && rl.lora_masking === "inside the model (one pass)");
            if (vue) {
                const txt = await page.evaluate(() => document.body.innerText);
                check(T("Nodes 2.0 draws the translated title and choice"), txt.includes(plain(nodes["Region-Genie_SaveImage"].display_name).replace(" ✨", "")) && txt.includes(plain(C["inside the model (one pass)"])));
            }
            check(T("the Region Genie editor draws"), await page.evaluate(() => !!document.querySelector(".rg-toolbar, .rg-foot, .rg-list, .rg-wrap")));
            fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
            await page.screenshot({ path: path.join(__dirname, "out", `i18n_${lang}_${vue ? "vue" : "legacy"}_nodes.png`) });

            // 3. the Settings dialog
            await page.keyboard.press("Control+,"); await sleep(1500);
            await page.evaluate(() => { const el = [...document.querySelectorAll('[role="dialog"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Region Genie"); el?.scrollIntoView(); el?.click(); });
            await sleep(3500);
            // round 50: the tab's rows, then every page of the Region Genie settings window
            let s = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || ""));
            const first = page.locator('[role="dialog"] .rg-page-row button').first(); await first.scrollIntoViewIfNeeded(); await first.click(); await sleep(900);
            const navN = await page.locator(".rg-setwin-nav button").count();
            for (let i = 0; i < navN; i++) { await page.locator(".rg-setwin-nav button").nth(i).click(); await sleep(350);
                s += "\n" + await page.evaluate(() => { const w = document.querySelector(".rg-setwin"); return w.innerText + "\n" + [...w.querySelectorAll("option")].map((o) => o.textContent).join("\n"); }); }
            check(T(`the settings window opens with ${navN} pages`), navN === 11);
            const squash = (t) => t.replace(/\s+/g, " ");
            const visible = Object.keys(en.settings);
            const miss = visible.filter((k) => !squash(s).includes(squash(plain(settings[k].name)).trim()));
            check(T(`the Settings dialog shows every translated Setting name (${visible.length}${miss.length ? `; missing: ${miss.slice(0, 4).join(" | ")}` : ""})`), !miss.length);
            // the sections that are shown: the tab's three, and the headings of the pages made of several old sections
            const SHOWN = ["Basics", "Models and files", "Other nodes", "Region Genie node", "Tag autocomplete", "Wildcards (Impact Pack)", "LLM Prompt Enhancer", "LLM cache"];
            const cats = Object.entries(main.settingsCategories).filter(([k]) => SHOWN.includes(k));
            const cmiss = cats.filter(([, v]) => !s.includes(plain(v))).map(([k]) => k);
            check(T(`and every translated section name (${cats.length}${cmiss.length ? `; missing: ${cmiss.join(" | ")}` : ""})`), !cmiss.length);
            const opt = settings.RegionGenie_Size_Mode?.options || {};
            check(T(`and translated options (${Object.values(opt)[0]})`), Object.values(opt).some((v) => s.includes(plain(v))));
            await page.screenshot({ path: path.join(__dirname, "out", `i18n_${lang}_${vue ? "vue" : "legacy"}_settings.png`) });
            await page.keyboard.press("Escape"); await sleep(400);          // the window
            await page.keyboard.press("Escape"); await sleep(500);          // ComfyUI's Settings
            const errs = errors.filter((e) => !/ResizeObserver/.test(e));
            check(T(`no script errors${errs.length ? ` (${errs.slice(0, 2).join(" | ")})` : ""}`), !errs.length);
        }
    } finally {
        await page.evaluate(async () => { await window.app.extensionManager.setting.set("Comfy.Locale", "en"); }).catch(() => {});
        await sleep(800);
        await browser.close();
    }
    console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
    process.exit(failed ? 1 : 0);
})();
