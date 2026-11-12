// Browser checks of the Select object tool against a stubbed server (headless Chromium, DPR 2)
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1100 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__settingsExt.setup());
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__node.__rgState())));
    const toClient = (x, y) => page.evaluate(([x, y]) => window.__node.__rgToClient(x, y), [x, y]);
    const status = () => page.evaluate(() => [...document.querySelectorAll(".rg-hint")].map((e) => e.textContent).join(" | "));
    async function clickImg(x, y, mods = []) {
        for (const m of mods) await page.keyboard.down(m);
        const [cx, cy] = await toClient(x, y);
        await page.mouse.click(cx, cy);
        for (const m of mods) await page.keyboard.up(m);
        await page.waitForTimeout(120);
    }
    async function dragImg(a, b) {
        let [x, y] = await toClient(...a); await page.mouse.move(x, y); await page.mouse.down();
        [x, y] = await toClient(...b); await page.mouse.move(x, y, { steps: 6 }); await page.mouse.up();
        await page.waitForTimeout(120);
    }
    const sent = () => page.evaluate(() => window.__fetches.filter(([u]) => u.includes("sam_")).map(([u, o]) => [u, JSON.parse(o.body)]));

    // the stub server: a rectangle mask around the first include point (or the box); "find" returns two objects
    await page.evaluate(() => {
        const runsOf = (w, h, fn) => { const r = []; let cur = 0, n = 0; for (let i = 0; i < w * h; i++) { const v = fn(i % w, Math.floor(i / w)) ? 1 : 0; if (v !== cur) { r.push(n); n = 0; cur = v; } n++; } r.push(n); return r; };
        window.__busyOnce = false;
        window.__apiHandlers["/region_genie/sam_select"] = async (b) => {
            if (window.__busyOnce) { window.__busyOnce = false; return [409, { error: "busy", code: "busy" }]; }
            const [w, h] = b.size;
            if (b.text) {
                return [200, { ok: true, w, h, masks: [
                    { runs: runsOf(w, h, (x, y) => x < w * 0.25 && y < h * 0.25), score: 0.9, label: "cat", area: 1 },
                    { runs: runsOf(w, h, (x, y) => x > w * 0.75 && y > h * 0.75), score: 0.8, label: "dog", area: 1 }] }];
            }
            let [x0, y0, x1, y1] = b.box || [0, 0, 0, 0];
            if (!b.box) { const p = b.points.find((q) => q[2] === 1); [x0, y0, x1, y1] = [p[0] - 0.1, p[1] - 0.1, p[0] + 0.1, p[1] + 0.1]; }
            return [200, { ok: true, w, h, masks: [{ runs: runsOf(w, h, (x, y) => x >= x0 * w && x < x1 * w && y >= y0 * h && y < y1 * h), score: null, label: "", area: 1 }] }];
        };
    });

    const objBtn = page.locator('.rg-bar .rg-btn.icon[title^="Select object"]');
    check("Select object button", await objBtn.count() === 1);
    check("Select object button has its icon", await objBtn.evaluate((b) => b.querySelector("svg")?.childElementCount > 0 && !/undefined/.test(b.innerHTML)));
    const blank = await page.evaluate(() => [...document.querySelectorAll(".rg-btn.icon")].filter((b) => /undefined/.test(b.innerHTML) || (b.querySelector("svg") && !b.querySelector("svg").childElementCount)).map((b) => b.title.slice(0, 30)));
    check("no icon button is blank" + (blank.length ? ": " + blank.join(", ") : ""), blank.length === 0);
    await page.keyboard.press("q").catch(() => {});
    await objBtn.click();
    const findIn = page.locator(".rg-bar .rg-find");
    check("find field shown with the tool", await findIn.isVisible());
    // no image yet
    await clickImg(64, 64);
    check("without an image: hint, no request", /needs an image/.test(await status()) && (await sent()).length === 0);

    await page.evaluate(async () => {
        const c = document.createElement("canvas"); c.width = 256; c.height = 256;
        const x = c.getContext("2d"); x.fillStyle = "#335"; x.fillRect(0, 0, 256, 256);
        const img = new Image(); img.src = c.toDataURL(); await img.decode();
        window.__node.inputs = [{ name: "image", link: 7 }];
        window.__node.__rgSetBackdrop(img, { filename: "photo.png", subfolder: "sub", type: "input" });
    });
    await page.locator(".rg-head .rg-btn.icon").first().click();           // a region to add to
    await objBtn.click();
    await clickImg(64, 64);
    await page.waitForTimeout(150);
    let s = await sent();
    const b0 = s.at(-1)?.[1];
    check("click sends one include point, normalized, with the image", b0 && b0.points.length === 1 && b0.points[0][2] === 1
        && Math.abs(b0.points[0][0] - 0.25) < 0.01 && b0.image.filename === "photo.png" && b0.image.subfolder === "sub");
    check("request: raster size, Settings model, keep loaded", b0.size[0] === 256 && b0.model === "sam3.1_multiplex_fp16.safetensors" && b0.keep_loaded === true);
    check("status: how to go on", /Enter or ✓: add/.test(await status()));
    const px = await page.evaluate(() => { const c = document.querySelector(".rg-cv canvas"), n = window.__node.__rgView(); const d = c.getContext("2d").getImageData(Math.round(n.x + 64 * n.z), Math.round(n.y + 64 * n.z), 1, 1).data; return [...d]; });
    check("selection shown on the canvas (tinted)", px[0] !== 0x33 || px[1] !== 0x33);
    await clickImg(200, 200, ["Control"]);
    s = await sent();
    check("Ctrl+click adds an exclude point", s.at(-1)[1].points.length === 2 && s.at(-1)[1].points[1][2] === 0);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(150);
    s = await sent();
    check("Backspace removes the last point and asks again", s.at(-1)[1].points.length === 1);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    s = await st();
    const L = s.layers.find((l) => l.name.startsWith("Object"));
    check("Enter adds the object as a layer of the active region", L && L.region === s.regions[0].id && L.ops[0].t === "bitmap");
    check("no release call while kept loaded… (sent anyway, keep_loaded true)", (await sent()).filter(([u]) => u.includes("release")).every(([, b]) => b.keep_loaded === true));

    // box
    await dragImg([150, 150], [220, 230]);
    s = await sent();
    const bb = s.at(-1)[1];
    check("drag sends a box", bb.box && Math.abs(bb.box[0] - 150 / 256) < 0.01 && Math.abs(bb.box[3] - 230 / 256) < 0.01 && bb.points.length === 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    check("Esc cancels (nothing added)", (await st()).layers.filter((l) => l.name.startsWith("Object")).length === 1);
    check("Esc sends release", (await sent()).at(-1)[0].includes("sam_release"));

    // unload setting
    await page.evaluate(() => { window.__settings["RegionGenie.Select.KeepLoaded"] = "unload"; });
    await clickImg(100, 100);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    s = await sent();
    check("unload setting: request and release say so", s.at(-2)[1].keep_loaded === false && s.at(-1)[0].includes("release") && s.at(-1)[1].keep_loaded === false);
    await page.evaluate(() => { window.__settings["RegionGenie.Select.KeepLoaded"] = "keep loaded"; });

    // busy: waits and asks again
    await page.evaluate(() => { window.__busyOnce = true; });
    const n0 = (await sent()).length;
    await clickImg(120, 120);
    check("busy: says it waits", /waits while a workflow is running/.test(await status()));
    await page.waitForTimeout(2300);
    check("busy: asks again by itself", (await sent()).length >= n0 + 2 && /Enter or ✓: add/.test(await status()));
    await page.keyboard.press("Escape");

    // find all
    await findIn.fill("cat, dog");
    await findIn.press("Enter");
    await page.waitForTimeout(200);
    s = await sent();
    check("find sends the text", s.at(-1)[1].text === "cat, dog" && s.at(-1)[1].points.length === 0 && s.at(-1)[1].threshold === 0.5);
    check("find: count shown", /Found 2/.test(await status()));
    await clickImg(230, 230, ["Control"]);
    check("Ctrl+click leaves one out", /1 kept/.test(await status()));
    await clickImg(230, 230, ["Control"]);
    check("Ctrl+click again brings it back", /Found 2:/.test(await status()) && !/kept/.test(await status()));
    const nReg = (await st()).regions.length;
    await page.keyboard.down("Shift"); await page.keyboard.press("Enter"); await page.keyboard.up("Shift");
    await page.waitForTimeout(150);
    s = await st();
    check("Shift+Enter: one new region each, named by what was found", s.regions.length === nReg + 2 && s.regions.slice(0, 2).map((r) => r.prompt).sort().join() === "cat,dog");
    check("find field cleared after adding", await findIn.inputValue() === "");
    // switching tools adds what is selected (it isn't thrown away)
    const okBtn = page.locator('.rg-bar .rg-btn.icon[title^="Add the selection"]');
    await findIn.fill("cat"); await findIn.press("Enter"); await page.waitForTimeout(150);
    check("✓ shown with a pending selection", await okBtn.isVisible() && await okBtn.isEnabled());
    const nOps = async () => (await st()).layers.reduce((n, l) => n + l.ops.filter((o) => o.t === "bitmap").length, 0);
    const nObj = await nOps();
    await page.locator('.rg-bar .rg-btn.icon[title^="Brush"]').click();
    await page.waitForTimeout(100);
    check("another tool adds the selection", await nOps() === nObj + 1
        && (await sent()).at(-1)[0].includes("release") && !await okBtn.isVisible());
    // ✓ button
    await objBtn.click();
    await clickImg(40, 200);
    const nObj2 = await nOps();
    await okBtn.click(); await page.waitForTimeout(120);
    check("✓ adds the selection", await nOps() === nObj2 + 1 && /Added the object/.test(await status()) && !await okBtn.isVisible());

    // Edit Mode: selections go into the active region like in Generate (layers to build each region); Shift+click adds and starts the next
    await page.locator(".rg-settings .rg-seg button", { hasText: "Edit" }).click();
    await page.waitForTimeout(120);
    await objBtn.click();
    let r0 = (await st()).regions.length, ops0 = await nOps();
    await clickImg(60, 60);
    check("edit: status says it goes to the active region", /to the active region/.test(await status()));
    await page.keyboard.press("Enter"); await page.waitForTimeout(150);
    s = await st();
    check("edit: Enter adds to the active region (no new region)", s.regions.length === r0 && await nOps() === ops0 + 1);
    await clickImg(200, 60);
    await clickImg(200, 200, ["Shift"]);
    await page.waitForTimeout(150);
    check("edit: Shift+click adds the first and starts the next", await nOps() === ops0 + 2 && /Enter or ✓/.test(await status()));
    await page.locator('.rg-bar .rg-btn.icon[title^="Brush"]').click(); await page.waitForTimeout(150);
    check("edit: switching tool adds the second", await nOps() === ops0 + 3 && (await st()).regions.length === r0);
    await page.locator(".rg-settings .rg-seg button", { hasText: "Generate" }).click();
    await page.waitForTimeout(120);

    // the expand button of a region prompt in the list: the region pop-up, by the row (double-click selects a word)
    const firstRid = (await st()).regions[0].id;
    const prIn = page.locator(`.rg-list textarea.rg-prompt[data-rid="${firstRid}"]`);
    await page.evaluate((rid) => { const r = window.__node.__rgState().regions.find((x) => x.id === rid); r.prompt = "a tall green tree"; window.__node.__rgRefresh(); }, firstRid);
    await page.waitForTimeout(100);
    await prIn.dblclick(); await page.waitForTimeout(150);
    const sel = await page.evaluate(() => { const t = document.activeElement; return t?.tagName === "TEXTAREA" ? t.value.slice(t.selectionStart, t.selectionEnd) : ""; });
    check("double-click in a list prompt selects a word (no pop-up)", await page.locator(".rg-pop").count() === 0 && /^(a|tall|green|tree)$/.test(sel));
    await page.mouse.click(5, 5);
    const exp = page.locator(`.rg-list .rg-pwrap:has(textarea[data-rid="${firstRid}"]) .rg-expand`);
    check("expand button in the prompt's bottom-right corner", await exp.count() === 1 && await (async () => {
        const [b, t] = [await exp.boundingBox(), await prIn.boundingBox()];
        return b.x + b.width <= t.x + t.width + 1 && b.x + b.width >= t.x + t.width - 24 && b.y + b.height <= t.y + t.height + 1; })());
    await exp.click(); await page.waitForTimeout(150);
    const pop = page.locator(".rg-pop");
    const popOk = await pop.count() === 1 && await page.evaluate(() => document.activeElement?.closest?.(".rg-pop") != null);
    check("expand button opens the region pop-up, prompt focused", popOk);
    if (popOk) {
        const [pb, rb] = [await pop.boundingBox(), await page.locator(`.rg-list textarea.rg-prompt[data-rid="${firstRid}"]`).boundingBox()];
        check("pop-up sits by the row", Math.abs(pb.y - (rb.y + rb.height)) < 80 || Math.abs(pb.y + pb.height - rb.y) < 80);
        await page.keyboard.type(" edited");
        await page.keyboard.press("Enter"); await page.waitForTimeout(100);
        check("pop-up edits the region's prompt", (await st()).regions[0].prompt.endsWith(" edited") && await pop.count() === 0);
    }

    // the error the server gives for a missing model: a message bar that stays
    const URL = "https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors";
    await page.evaluate((u) => { window.__apiHandlers["/region_genie/sam_select"] = async () => [404, { error: `Select object needs the SAM 3.1 model: put it in models/checkpoints (${u}), then try again`, code: "no_model" }]; }, URL);
    await page.locator(".rg-settings .rg-seg button", { hasText: "Edit" }).click();
    await objBtn.click();
    await clickImg(80, 80);
    const msg = page.locator(".rg-msg");
    check("missing model: message bar under the canvas", await msg.isVisible() && /needs the SAM 3.1 model/.test(await msg.textContent()));
    check("missing model: the link is a link", await msg.locator("a").getAttribute("href") === URL);
    await page.waitForTimeout(4000);
    check("missing model: still there after 4 s", await msg.isVisible());
    // select the link text and press Ctrl+C: the browser copies it (no layer copy), the message stays
    await page.evaluate(() => { const a = document.querySelector(".rg-msg a"), r = document.createRange(); r.selectNodeContents(a); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await page.locator(".rg-wrap, .rg-msg").first().evaluate((w) => w.focus?.());
    await page.keyboard.press("Control+c"); await page.waitForTimeout(100);
    check("Ctrl+C on selected message text: no layer copy, message stays", !/Copied '/.test(await status()) && await msg.isVisible());
    await msg.click({ button: "right" }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    check("right-click keeps the message", await msg.isVisible());
    await msg.locator("button", { hasText: "Copy link" }).click(); await page.waitForTimeout(100);
    check("Copy link button", /Link copied|Couldn't copy/.test(await status()));
    await page.locator(".rg-settings .rg-seg button", { hasText: "Generate" }).click(); await page.waitForTimeout(80);
    check("going back to Generate closes the message", !await msg.isVisible());
    await objBtn.click(); await clickImg(80, 80);
    await page.locator('.rg-bar .rg-btn.icon[title^="Brush"]').click(); await page.waitForTimeout(80);
    check("another tool closes the message", !await msg.isVisible());
    await objBtn.click(); await clickImg(80, 80);
    await msg.locator("button", { hasText: "✕" }).click(); await page.waitForTimeout(80);
    check("✕ closes the message", !await msg.isVisible());
    const ids = await page.evaluate(() => window.__settingsExt.settings.map((s) => s.id));
    check("Settings: Select object entries", ["RegionGenie.Select.Model", "RegionGenie.Select.KeepLoaded", "RegionGenie.Select.Threshold"].every((i) => ids.includes(i)));
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
