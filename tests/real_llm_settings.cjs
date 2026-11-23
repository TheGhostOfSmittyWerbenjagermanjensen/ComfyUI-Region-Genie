// Round 19: the LLM Prompt Enhancer's presets in ComfyUI's Settings (one row per field) and Browse… for the LLM file
// and the LLM LoRAs, in the node's LLM settings pop-up and in Settings. Both places edit the same preset library.
// Usage: COMFY_DIR=<ComfyUI folder> node real_llm_settings.cjs [vue]   (needs ComfyUI on 127.0.0.1:8188 with this pack;
// it backs up and restores the preset library, and makes / removes rgtest_llm_outside next to COMFY_DIR)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const fs = require("fs"), path = require("path");
const DIR = process.env.COMFY_DIR || "/tmp/comfy_src";
const vue = process.argv[2] === "vue", M = vue ? "Nodes 2.0" : "legacy";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIB = "region_genie%2Fllm_presets.json";
const outDir = path.join(DIR, "..", "rgtest_llm_outside", "@llm");
fs.mkdirSync(outDir, { recursive: true });
const outLlm = path.join(outDir, "qwen_outside.safetensors");
fs.writeFileSync(outLlm, "");

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    page.on("console", (m) => { if (m.type() === "error" && /SyntaxError|i18n|Region Genie/.test(m.text())) errors.push(m.text().split("\n")[0]); });
    await page.goto("http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(2000);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(300); }
    // start from the default library (a run that stopped half-way may have left test values in it)
    await page.evaluate(async (f) => { await fetch(`/userdata/${f}`, { method: "DELETE" }); }, LIB);
    await page.reload(); await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(2000);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(300); }
    const backup = await page.evaluate(async (f) => { const r = await fetch(`/userdata/${f}`); return r.status === 200 ? await r.text() : null; }, LIB);
    const readLib = () => page.evaluate(async (f) => { const r = await fetch(`/userdata/${f}`); return r.status === 200 ? await r.json() : null; }, LIB);
    // round 21: Browse… is off by default; this test checks it with it on (and the default at the end)
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; await s.set("Comfy.VueNodes.Enabled", vue); await s.set("RegionGenie.LLM.EditPreset", "");
        await s.set("RegionGenie.ModelFiles.Browse", true); }, vue);
    await sleep(800);
    // a node, so the LLM module is loaded the way it is in use
    await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [60, 40]; app.graph.add(rg); window.__rg = rg;
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 1500));
    });

    // ---- Settings > Region Genie > LLM Prompt Enhancer
    const openSettings = async () => {
        await page.keyboard.press("Control+,"); await sleep(1500);
        await page.evaluate(() => { const el = [...document.querySelectorAll('[role="dialog"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Region Genie"); el?.click(); });
        await sleep(2500);
        // round 50: the LLM settings are a page of the Region Genie settings window
        const b = page.locator('[role="dialog"] .rg-page-row[data-page="llm"] button'); await b.scrollIntoViewIfNeeded(); await b.click();
        await page.waitForSelector('.rg-setwin .rg-setwin-nav button.on[data-page="llm"]', { timeout: 8000 }); await sleep(500);
    };
    await openSettings();
    const rowOf = (label) => page.evaluate((label) => {
        const span = [...document.querySelectorAll('[role="dialog"] .rg-setwin label')].find((e) => e.textContent.trim() === label);
        let row = span; while (row && !row.querySelector?.(".rg-lset")) row = row.parentElement;
        if (row) row.querySelector(".rg-lset").dataset.test = label;
        return !!row;
    }, label);
    const names = ["Character", "Object", "Text", "Scene", "Preset",
        "Name", "LLM", "LLM type", "LLM LoRAs", "System prompt", "max_length", "sampling",
        "temperature", "top_k", "top_p", "min_p", "repetition_penalty", "presence_penalty",
        "seed", "thinking", "default template", "mtp"];
    const found = [];
    for (const n of names) if (await rowOf(n)) found.push(n);
    check(`${M}: every LLM setting of the pop-up has a row in Settings (${found.length}/${names.length}; missing: ${names.filter((n) => !found.includes(n)).join(" | ")})`,
        found.length === names.length);
    const sel = (label) => `[data-test="${label}"]`;
    // round 71: laid out like the node's pop-up: headings over the rows, short labels under them, nothing past the edge
    const lay = await page.evaluate(() => { const p = document.querySelector(".rg-setwin-page"), pr = p.getBoundingClientRect();
        const kids = [...p.children], at = (t) => kids.findIndex((k) => k.classList.contains("rg-setwin-grp") && k.textContent === t);
        const rowAt = (label) => kids.findIndex((k) => k.querySelector?.(":scope > label")?.textContent.trim() === label);
        return { heads: kids.filter((k) => k.classList.contains("rg-setwin-grp")).map((k) => k.textContent),
            order: [at("Preset for each prompt type"), rowAt("Character"), rowAt("Scene"), at("Edit preset (shared by all your workflows)"), rowAt("Preset"), rowAt("Name"), rowAt("mtp"), at("LLM cache")],
            scroll: p.scrollWidth - p.clientWidth, over: [...p.querySelectorAll(".rg-setwin-row *")].filter((e) => e.getBoundingClientRect().right > pr.right + 1).length }; });
    check(`${M}: the page has the pop-up's sections as headings (${lay.heads.join(" | ")})`, lay.heads.join("|") === "LLM Prompt Enhancer|Preset for each prompt type|Edit preset (shared by all your workflows)|LLM cache");
    check(`${M}: each prompt type under its heading, then 'Edit preset' with the preset to edit and all its fields right below, then the cache (${lay.order})`, lay.order.every((v, i) => v >= 0 && (!i || v > lay.order[i - 1])));
    check(`${M}: no row runs past the page's right edge, no sideways scroll bar (${lay.scroll}, ${lay.over})`, lay.scroll <= 0 && lay.over === 0);
    const lib0 = await readLib();
    const target = await page.locator(`${sel("Preset")} select`).inputValue();
    check(`${M}: 'Preset to edit' starts with the Object default (${target})`, !!target && (!lib0 || target === lib0.defaults.object));
    // max_length: saved at once to the library
    await page.locator(`${sel("max_length")} input`).fill("1234");
    await page.locator(`${sel("max_length")} input`).press("Tab"); await sleep(900);
    let lib = await readLib();
    check(`${M}: a Settings row saves the preset at once (max_length ${lib?.presets?.[target]?.max_length})`, lib?.presets?.[target]?.max_length === 1234);
    // sampling off: the sampling fields are greyed out; on: usable
    const dis = async () => page.locator(`${sel("temperature")} input`).isDisabled();
    const before = await dis();
    await page.locator(`${sel("sampling")} input`).click(); await sleep(900);
    await rowOf("temperature");
    const after = await dis();
    lib = await readLib();
    check(`${M}: sampling greys out / enables temperature … seed (${before} → ${after})`, before !== after && lib.presets[target].sampling === !before ? true : before !== after);
    await page.locator(`${sel("sampling")} input`).click(); await sleep(700);
    // Escape in the folder browser closes only the browser (checked in the pop-up below too)
    // the LLM: dropdown + Browse…; Browse… to a file outside ComfyUI saves its full path
    // round 23: the LLM is a file field: ComfyUI's menu ("None (the connected clip)" + text_encoders) and Browse… beside it
    const pickerOk = await page.evaluate((s) => { const p = document.querySelector(`${s} .rg-ff`); return !!p?.querySelector(".rg-ff-name") && !!p?.querySelector(".rg-ff-browse svg")
        && p.querySelector(".rg-ff-name").textContent.startsWith("The connected clip") && !p.querySelector("select"); }, sel("LLM"));
    check(`${M}: Preset: LLM is a file field (shows the connected clip) with Browse…`, pickerOk);
    await page.locator(`${sel("LLM")} .rg-ff-name`).click(); await sleep(700);
    const llmMenu = await page.evaluate(() => [...document.querySelectorAll(".litecontextmenu .litemenu-entry")].map((e) => e.textContent.trim()).slice(0, 3));
    check(`${M}: its menu starts with "None (the connected clip …)" (${llmMenu[0]})`, /^None \(The connected clip/.test(llmMenu[0] || ""));
    await page.evaluate(() => document.querySelectorAll(".litecontextmenu").forEach((m) => m.remove())); await sleep(200);
    await page.locator(`${sel("LLM")} .rg-ff-browse`).click();
    await page.waitForSelector(".rg-fb", { state: "attached", timeout: 5000 }); await sleep(600);
    const start = await page.locator(".rg-fb-path input").inputValue();
    await page.locator(".rg-fb-path input").fill(outDir); await page.locator(".rg-fb-path input").press("Enter"); await sleep(800);
    await page.locator(".rg-fb-item", { hasText: "qwen_outside.safetensors" }).click();
    await page.locator(".rg-fb button.primary").click(); await sleep(1000);
    lib = await readLib();
    check(`${M}: Browse… for the LLM starts in text_encoders and saves the full path (${start.split(/[\\/]/).slice(-2).join("/")}; ${lib.presets[target].llm})`,
        /text_encoders$/.test(start) && lib.presets[target].llm === path.resolve(outLlm));
    await rowOf("LLM type");
    check(`${M}: with an LLM file, 'LLM type' can be set`, !(await page.locator(`${sel("LLM type")} select`).isDisabled()));
    // an LLM LoRA: ＋LoRA adds a row with a picker
    await page.locator(`${sel("LLM LoRAs")} > button`).click(); await sleep(300);
    const loraRow = await page.evaluate((s) => { const r = document.querySelector(`${s} .rg-lset-lora`); return !!r?.querySelector(".rg-ff-name") && !!r?.querySelector(".rg-ff-browse"); }, sel("LLM LoRAs"));
    check(`${M}: ＋LoRA adds an LLM LoRA row with a file field and Browse…`, loraRow);
    // pick a LoRA in it: ComfyUI's menu, its filter
    await page.locator(`${sel("LLM LoRAs")} .rg-lset-lora .rg-ff-name`).first().click(); await sleep(700);
    await page.locator(".litecontextmenu .comfy-context-menu-filter").first().fill("style_12."); await sleep(500);
    const loraPicked = await page.evaluate(() => { const e = [...document.querySelectorAll(".litecontextmenu .litemenu-entry")].find((x) => x.offsetParent && /style_12\.safetensors$/.test(x.textContent.trim()));
        e?.click(); return e ? "style_12.safetensors" : ""; });
    await sleep(900);
    lib = await readLib();
    check(`${M}: an LLM LoRA picked in Settings is saved (${loraPicked})`, !!loraPicked && lib.presets[target].loras.some((x) => x.lora === loraPicked));
    // New: a copy under a new name becomes the one edited; Delete removes it again
    await page.locator(`${sel("Preset")} button`, { hasText: "New" }).click(); await sleep(1200);
    lib = await readLib();
    await rowOf("Preset"); await rowOf("Name");
    const now = await page.locator(`${sel("Preset")} select`).inputValue();
    const nameNow = await page.locator(`${sel("Name")} input`).inputValue();
    check(`${M}: New copies the preset and edits the copy (${now})`, now !== target && !!lib.presets[now] && nameNow === now && lib.presets[now].max_length === 1234);
    await page.locator(`${sel("Name")} input`).fill("rgtest renamed"); await page.locator(`${sel("Name")} input`).press("Enter"); await sleep(1200);
    lib = await readLib();
    check(`${M}: Preset: name renames it`, !!lib.presets["rgtest renamed"] && !lib.presets[now]);
    await rowOf("Preset");
    const delB = page.locator(`${sel("Preset")} button`, { hasText: "Delete" });
    await delB.click(); await sleep(200); await page.locator(`${sel("Preset")} button`, { hasText: "Delete?" }).click(); await sleep(1200);
    lib = await readLib();
    check(`${M}: Delete (twice) removes it`, !lib.presets["rgtest renamed"]);
    // a default per type
    await rowOf("Text");
    const opts = await page.locator(`${sel("Text")} select option`).allTextContents();
    check(`${M}: 'Default preset' rows list the presets (${opts.length})`, opts.length >= 2);
    // round 71: 'Preset to edit' fills every row below it, also the one the keyboard focus is in (in Firefox on Windows
    // the focus stayed in the system prompt box after a click on the dropdown, and the box kept the old preset's text)
    {
        const rowEl = (name) => `[...document.querySelectorAll(".rg-setwin-row")].find((r) => r.querySelector("label")?.textContent.trim() === ${JSON.stringify(name)})`;
        const sys = () => page.evaluate(`${rowEl("System prompt")}.querySelector("textarea").value`);
        const pickEdit = (v) => page.evaluate(`(() => { const s = ${rowEl("Preset")}.querySelector("select"); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);   // the choice changes, the focus stays where it is
        const names = await page.evaluate(`[...${rowEl("Preset")}.querySelectorAll("select option")].map((o) => o.value)`);
        const first = await page.evaluate(`${rowEl("Preset")}.querySelector("select").value`), other = names.find((n) => n !== first && /Scene|Region/.test(n));
        const before = await sys();
        await page.evaluate(`${rowEl("System prompt")}.querySelector("textarea").focus()`); await sleep(150);
        await pickEdit(other); await sleep(900);
        const after = await sys(), nameNow = await page.evaluate(`${rowEl("Name")}.querySelector("input").value`);
        check(`${M}: another 'Preset to edit' with the focus in the system prompt box: the box shows the new preset's prompt, and the name row its name (${nameNow})`,
            !!other && after !== before && after.length > 40 && nameNow === other);
        await page.evaluate(`${rowEl("System prompt")}.querySelector("textarea").focus()`); await sleep(150);
        await pickEdit(first); await sleep(900);
        check(`${M}: …and back: the first preset's prompt again, unchanged`, await sys() === before);
    }
    await page.keyboard.press("Escape"); await sleep(400);          // the window
    check(`${M}: Esc closes the settings window first, ComfyUI's Settings stay`, await page.locator(".rg-setwin").count() === 0 && await page.locator('[role="dialog"] .rg-page-row').count() > 5);
    await page.keyboard.press("Escape"); await sleep(600);          // ComfyUI's Settings

    // ---- the node's LLM settings pop-up shows the same values, with Browse… for the LLM file and the LoRAs
    await page.evaluate(() => document.querySelector(".rg-llmset")?.click()); await sleep(1200);
    const pop = await page.evaluate(() => {
        const p = document.querySelector(".rg-llm-pop");
        if (!p) return null;
        const llm = p.querySelector(".row .rg-ff-name");
        return { browse: p.querySelectorAll(".rg-ff-browse").length, llm: llm?.title || "", name: llm?.textContent || "", select: !!p.querySelector(".rg-ff select"),
                 max: [...p.querySelectorAll(".grid label")].find((l) => l.textContent.startsWith("max_length"))?.querySelector("input")?.value };
    });
    check(`${M}: the pop-up's LLM is a file field with Browse… and shows the file set in Settings (${pop?.name})`,
        !!pop && pop.browse >= 1 && pop.llm.includes(path.resolve(outLlm)) && pop.name === "qwen_outside.safetensors" && !pop.select);
    check(`${M}: the pop-up shows the max_length set in Settings (${pop?.max})`, pop?.max === "1234");
    const popLora = await page.evaluate(() => {
        const p = document.querySelector(".rg-llm-pop");
        return [...p.querySelectorAll(".lora")].some((r) => r.querySelector(".rg-ff-name") && r.querySelector(".rg-ff-browse"));
    });
    check(`${M}: the pop-up's LLM LoRA rows have a file field and Browse…`, popLora);
    // Browse… from the pop-up (the dialog opens above it; a pick marks the preset changed)
    await page.evaluate(() => document.querySelector(".rg-llm-pop .row .rg-ff-browse").click());
    await page.waitForSelector(".rg-fb", { state: "attached", timeout: 5000 }); await sleep(500);
    await page.locator(".rg-fb-list").click({ position: { x: 5, y: 5 } }); await sleep(200);
    await page.keyboard.press("Escape"); await sleep(400);
    check(`${M}: clicks and Escape in Browse… close only the browser, not the pop-up`, await page.locator(".rg-fb").count() === 0
        && await page.locator(".rg-llm-pop").count() === 1);
    await page.keyboard.press("Escape");

    // Browse… off (the default): the same file fields (ComfyUI's menu), no Browse buttons
    await page.evaluate(async () => { await window.app.extensionManager.setting.set("RegionGenie.ModelFiles.Browse", false); });
    await page.keyboard.press("Escape"); await sleep(400);
    await page.evaluate(() => document.querySelector(".rg-llmset")?.click()); await sleep(1200);
    const off = await page.evaluate(() => {
        const p = document.querySelector(".rg-llm-pop");
        return { browse: p.querySelectorAll(".rg-ff-browse").length, fields: p.querySelectorAll(".rg-ff-name").length, selects: p.querySelectorAll(".rg-ff select, .lora select").length };
    });
    check(`${M}: with Browse… off: the same file fields, no Browse buttons, no dropdowns (${JSON.stringify(off)})`,
        off.browse === 0 && off.fields >= 2 && off.selects === 0);
    await page.keyboard.press("Escape");
    check(`${M}: no errors (${errors.slice(0, 2).join(" | ")})`, !errors.length);
    // restore the library and the setting
    await page.evaluate(async ([f, b]) => {
        if (b != null) await fetch(`/userdata/${f}?overwrite=true`, { method: "POST", body: b });
        else await fetch(`/userdata/${f}`, { method: "DELETE" });
        await window.app.extensionManager.setting.set("RegionGenie.LLM.EditPreset", "");
    }, [LIB, backup]);
    await browser.close();
    fs.rmSync(path.join(DIR, "..", "rgtest_llm_outside"), { recursive: true, force: true });
    console.log(fails.length ? `${fails.length} failed` : "all passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { fs.rmSync(path.join(DIR, "..", "rgtest_llm_outside"), { recursive: true, force: true }); console.error(e); process.exit(1); });
