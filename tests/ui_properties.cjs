// Property tests of the editor (stub page): rules that must hold for every input, tried with generated inputs.
// The other tests check the cases somebody thought of; these look for the ones nobody did.
// - Saved data: whatever text the paint_data widget holds (damaged, old, hand-edited), reading it never fails, and
//   reading what was read gives the same again (so save > load > save changes nothing).
// - Undo / Redo: after any sequence of actions (draw, add a region, type a prompt, hide, delete), Undo walks back
//   through exactly the saved states the actions left, one step per action, and Redo walks forward through them.
// The inputs come from a seeded generator, so a run is the same every time; a failure prints its seed and input.
//   RG_SEEDS=40 node tests/ui_properties.cjs      a longer search (default 8 action sequences, 600 saved-data inputs)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok, note) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) { fails.push(name); if (note) console.log("     " + String(note).slice(0, 900)); } };
const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const SEEDS = +process.env.RG_SEEDS || 8;

(async () => {
    const browser = await chromium.launch();
    const open = async () => {
        const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 900, height: 1100 } });
        page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
        await page.goto("http://127.0.0.1:8765/index.html");
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
        await page.waitForTimeout(300);
        await page.evaluate(() => window.__settingsExt.setup());
        return page;
    };

    // ---- saved data ------------------------------------------------------------------------------------------
    let page = await open();
    const res = await page.evaluate(async (count) => {
        const { parseState } = await import("/extensions/rg/editor/state.js");
        let seed = 12345;
        const r = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
        const pick = (a) => a[Math.floor(r() * a.length)];
        const junk = (d = 0) => { const k = Math.floor(r() * (d > 2 ? 6 : 9));
            return [null, true, false, Math.round(r() * 2000 - 1000) / 10, pick(["", "x", "MOSS Image", "#12ab9F", "rect", "\\@a\u00e9\u{1F600}\"", "1", "NaN"]), -0,
                    () => Array.from({ length: Math.floor(r() * 4) }, () => junk(d + 1)), () => Object.fromEntries(Array.from({ length: Math.floor(r() * 4) }, () => [pick(KEYS), junk(d + 1)])), () => stateLike(d + 1)][k]; };
        const val = (d) => { const v = junk(d); return typeof v === "function" ? v() : v; };
        const KEYS = ["v", "regions", "layers", "ops", "id", "color", "prompt", "type", "text", "loras", "lora", "strength", "on", "palette", "paletteOn", "feather", "featherLinked", "featherEdges",
                      "name", "region", "owner", "visible", "shape", "sides", "bw", "bh", "sx", "sy", "rot", "ox", "oy", "cx", "cy", "radius", "grad", "poses", "pts", "off", "src", "sceneLoras", "loraOpts",
                      "separation", "until", "allRegions", "autoOff", "editMask", "controls", "control", "kind", "start", "end", "editLoras", "llm", "sceneLlm", "importSig", "width", "height", "edit"];
        // something shaped like the editor's data, with wrong and missing values mixed in
        const maybe = (good, d) => (r() < 0.75 ? good() : val(d));
        const lora = (d) => ({ lora: maybe(() => pick(["a.safetensors", "sub\\b.safetensors", ""]), d), strength: maybe(() => r() * 2, d), on: maybe(() => r() < 0.5, d) });
        const region = (d, i) => ({ id: maybe(() => i + 1, d), color: maybe(() => "#" + Math.floor(r() * 0xffffff).toString(16).padStart(6, "0"), d), prompt: maybe(() => pick(["", "a fox", "x\ny"]), d),
            type: maybe(() => pick(["object", "character", "text"]), d), ...(r() < 0.5 ? { loras: maybe(() => [lora(d), lora(d)], d) } : {}),
            ...(r() < 0.4 ? { palette: maybe(() => ["#112233", "#AABBCC"], d), paletteOn: maybe(() => true, d) } : {}), ...(r() < 0.3 ? { feather: val(d), featherLinked: val(d) } : {}) });
        const layer = (d, i) => ({ id: maybe(() => i + 1, d), name: maybe(() => "Layer " + i, d), region: maybe(() => Math.floor(r() * 4), d), visible: maybe(() => r() < 0.8, d),
            shape: maybe(() => pick([null, "rect", "ellipse", "roundrect", "star", "polygon"]), d), sides: maybe(() => 5, d), bw: maybe(() => r(), d), bh: maybe(() => r(), d), sx: maybe(() => 1, d), sy: maybe(() => 1, d),
            rot: maybe(() => r() * 6, d), ...(r() < 0.5 ? { ox: maybe(() => r() - 0.5, d), oy: maybe(() => r() - 0.5, d) } : { cx: maybe(() => r(), d), cy: maybe(() => r(), d) }), ops: maybe(() => [], d),
            ...(r() < 0.2 ? { grad: val(d), radius: val(d), owner: val(d) } : {}) });
        function stateLike(d) {
            const s = { v: maybe(() => 2, d), regions: maybe(() => Array.from({ length: Math.floor(r() * 4) }, (_, i) => region(d, i)), d) };
            if (r() < 0.85) s.layers = maybe(() => Array.from({ length: Math.floor(r() * 4) }, (_, i) => layer(d, i)), d);
            for (const k of ["sceneLoras", "loraOpts", "feather", "editMask", "controls", "control", "controlLast", "editLoras", "poses", "llm", "sceneLlm", "sceneLlmSalt", "importSig", "editOff", "poseInputTaken"]) if (r() < 0.25) s[k] = val(d);
            if (r() < 0.2) s.sceneLoras = [lora(d)];
            if (r() < 0.2) s.poses = [{ id: val(d), pts: Array.from({ length: 18 }, () => [r(), r()]), region: val(d), off: val(d) }];
            return s;
        }
        const out = { n: 0, threw: null, unstable: null };
        for (let i = 0; i < count; i++) {
            const v = r() < 0.2 ? val(0) : stateLike(0);
            let text; try { text = r() < 0.03 ? "{not json" : JSON.stringify(v); } catch (e) { continue; }
            out.n++;
            let a;
            try { a = parseState(text, 1024, 768); } catch (e) { out.threw = out.threw || { text, error: String(e) }; continue; }
            try {
                const once = JSON.stringify(a), twice = JSON.stringify(parseState(once, 1024, 768));
                if (once !== twice && !out.unstable) { let k = 0; while (once[k] === twice[k]) k++; out.unstable = { text: text.slice(0, 200), once: once.slice(Math.max(0, k - 120), k + 120), twice: twice.slice(Math.max(0, k - 120), k + 120) }; }
            } catch (e) { out.threw = out.threw || { text, error: "second read: " + String(e) }; }
        }
        return out;
    }, SEEDS * 75);
    check(`saved data: ${res.n} generated texts (damaged, old, odd values) are all read without an error`, !res.threw, res.threw && `${res.threw.error}\n     input: ${res.threw.text}`);
    check("saved data: reading what was read gives the same again (save > load > save changes nothing)", !res.unstable,
          res.unstable && `input: ${res.unstable.text}\n     first:  ${res.unstable.once}\n     second: ${res.unstable.twice}`);
    await page.close();

    // ---- Undo / Redo -----------------------------------------------------------------------------------------
    const bad = [], used = new Set();
    let steps = 0;
    for (let seed = 1; seed <= SEEDS && !bad.length; seed++) {
        page = await open();
        const r = rng(seed * 7919), int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
        const saved = () => page.evaluate(() => { const s = JSON.parse(JSON.stringify(window.__node.__rgState())); return JSON.stringify(s); });
        const cv = () => page.evaluate(() => { const c = document.querySelector(".rg-cv canvas").getBoundingClientRect(); return [c.x, c.y, c.width, c.height]; });
        const aside = async () => { const [bx, by, bw] = await cv(); await page.evaluate(() => window.__node.__rgSetTool("select")); await page.mouse.click(bx + bw - 5, by + 5); await page.waitForTimeout(100); };
        const ACTIONS = {
            draw: async () => { const [bx, by, bw, bh] = await cv(); const x0 = int(20, bw - 120), y0 = int(20, bh - 120), w = int(30, 90), h = int(30, 90);
                await page.evaluate(() => window.__node.__rgSetTool("shape"));
                await page.mouse.move(bx + x0, by + y0); await page.mouse.down(); await page.mouse.move(bx + x0 + w, by + y0 + h, { steps: 3 }); await page.mouse.up(); await page.waitForTimeout(120); },
            addRegion: async () => { await page.locator('[title^="Add a region with a new color"]').click(); await page.waitForTimeout(120); },
            type: async () => { const t = page.locator(".rg-list textarea.rg-prompt"); const n = await t.count(); if (!n) return;
                await t.nth(int(0, n - 1)).click(); await page.keyboard.type(["a fox", " at dusk", "x", "red, blue"][int(0, 3)]); await page.waitForTimeout(80); await aside(); },
            eye: async () => { const b = page.locator('.rg-list [title^="Hidden: Not drawn"], .rg-list [title^="Show / hide this region"]'); const n = await b.count(); if (!n) return;
                await b.nth(int(0, n - 1)).click(); await page.waitForTimeout(100); },
            remove: async () => { const b = page.locator('.rg-list [title^="Delete region"]'); const n = await b.count(); if (!n) return;
                await b.nth(int(0, n - 1)).click(); await page.waitForTimeout(120); },
        };
        const names = Object.keys(ACTIONS), done = [], hist = [await saved()];
        for (let i = 0; i < 9; i++) {
            const a = i < 2 ? "draw" : names[int(0, names.length - 1)];
            await ACTIONS[a]();
            const s = await saved();
            if (s !== hist[hist.length - 1]) { hist.push(s); done.push(a); }
        }
        for (const a of done) used.add(a);
        await aside();
        const undo = page.locator('.rg-bar [title^="Undo"]'), redo = page.locator('.rg-bar [title^="Redo"]');
        const where = (what, i) => `seed ${seed}, actions: ${done.join(", ")}\n     ${what} at step ${i} of ${hist.length - 1}`;
        for (let i = hist.length - 2; i >= 0 && !bad.length; i--) {
            if (await undo.isDisabled()) { bad.push(where("Undo is not available", i)); break; }
            await undo.click(); await page.waitForTimeout(110); steps++;
            const s = await saved();
            if (s !== hist[i]) bad.push(where("Undo did not give the state before action '" + done[i] + "'", i) + `\n     expected: ${hist[i].slice(0, 300)}\n     got:      ${s.slice(0, 300)}`);
        }
        if (!bad.length && !(await undo.isDisabled())) bad.push(where("Undo is still available after every action was undone", 0));
        for (let i = 1; i < hist.length && !bad.length; i++) {
            if (await redo.isDisabled()) { bad.push(where("Redo is not available", i)); break; }
            await redo.click(); await page.waitForTimeout(110); steps++;
            const s = await saved();
            if (s !== hist[i]) bad.push(where("Redo did not give the state after action '" + done[i - 1] + "'", i) + `\n     expected: ${hist[i].slice(0, 300)}\n     got:      ${s.slice(0, 300)}`);
        }
        await page.close();
    }
    check(`Undo / Redo: ${SEEDS} generated action sequences, ${steps} steps: each Undo gives the state before one action, each Redo the state after it`, !bad.length, bad[0]);

    check(`the sequences used every kind of action (${[...used].join(", ")})`, used.size === 5);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
