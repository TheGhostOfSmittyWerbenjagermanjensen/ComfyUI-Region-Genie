// Round 102: Arrange on more than one layer. Flip and align a whole region (its layers as one, hidden ones and its
// holes and pose figures following), picked regions (together as one block, or each on its own), the whole picture
// (mirrored across the image's centre line, also from the canvas's right-click menu), and the new "mirror across the
// image" buttons for a single layer. Everything is judged by the layers' pixels on the image (__rgLayerMask) against
// what the test works out itself; one Undo takes each action back.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok, note) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) { fails.push(name); if (note) console.log("     " + note); } };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 900, height: 1100 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const W = 512, H = 384, S = 384;
    await page.evaluate(([W, H]) => { for (const [n, v] of [["width", W], ["height", H]]) { const w = window.__node.widgets.find((w) => w.name === n); w.value = v; w.callback?.(v); } }, [W, H]);
    await page.waitForTimeout(600);

    // the scene: region A (id 1): a triangle, a turned ellipse, a lasso outline, a hidden rectangle, a hole cut out of
    // it, a pose figure; region B (id 2): a rectangle on the right; region C (id 3): nothing yet
    const setScene = () => page.evaluate(([W, H, S]) => {
        const st = window.__node.__rgState(), u = (px) => px / S;            // image px -> layer units
        const shape = (id, region, shape, x, y, w, h, rot = 0, extra = {}) => ({ id, name: `L${id}`, region, visible: true, shape, sides: 5, bw: u(w), bh: u(h), sx: 1, sy: 1, rot,
            ox: u(x + w / 2 - W / 2), oy: u(y + h / 2 - H / 2), ops: [], ...extra });
        st.regions = [{ id: 1, color: "#E76F51", prompt: "a", type: "object", text: "" }, { id: 2, color: "#2A9D8F", prompt: "b", type: "object", text: "" },
                      { id: 3, color: "#E9C46A", prompt: "c", type: "object", text: "" }];
        st.layers = [
            shape(30, 2, "rect", 380, 150, 70, 120),
            shape(10, 1, "triangle", 60, 40, 90, 120),
            shape(11, 1, "ellipse", 150, 150, 80, 50, 25),
            { id: 12, name: "L12", region: 1, visible: true, shape: null, sides: 5, bw: W / S, bh: H / S, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0,
              ops: [{ t: "poly", e: false, p: [[u(80), u(220)], [u(170), u(250)], [u(120), u(330)]] }] },
            shape(13, 1, "rect", 230, 60, 40, 40, 0, { visible: false }),
            shape(14, 0, "rect", 74, 138, 16, 16, 0, { owner: 1 }),          // (not under the figure's middle: a hole there would make it no region's)
        ];
        const P = (x, y) => [u(x - W / 2), u(y - H / 2)];
        const pts = [P(105, 60), P(105, 75), P(92, 77), P(88, 95), P(86, 112), P(118, 77), P(124, 95), P(128, 110), P(97, 120), P(95, 140), P(94, 155),
                     P(113, 120), P(116, 140), P(118, 155), P(101, 57), P(109, 57), P(97, 59), P(113, 59)];
        st.poses = [{ id: 1, name: "Pose 1", region: 1, visible: true, pts }];
        window.__node.__rgRefresh();
    }, [W, H, S]);
    await setScene(); await page.waitForTimeout(300);

    // the test's own tools: a layer's pixels on the image, boxes, mirrors, shifts, overlap
    await page.evaluate(([W, H]) => {
        const T = window.__T = { W, H };
        T.mask = (id) => { const r = window.__node.__rgLayerMask(id); if (r.w !== W || r.h !== H) throw new Error("raster " + r.w + "x" + r.h); return r.m; };
        T.union = (ids) => { const out = new Uint8Array(W * H); for (const id of ids) { const m = T.mask(id); for (let i = 0; i < m.length; i++) if (m[i]) out[i] = 1; } return out; };
        T.box = (m) => { let x0 = W, x1 = -1, y0 = H, y1 = -1; for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (m[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1 + 1, y1 + 1]; };
        // mirrored about the line x = c ("h") or y = c ("v") (image px; pixel k covers k .. k+1)
        T.mirror = (m, axis, c) => { const out = new Uint8Array(W * H); for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (m[i]) {
            const xx = axis === "h" ? Math.round(2 * c - x - 1) : x, yy = axis === "v" ? Math.round(2 * c - y - 1) : y; if (xx >= 0 && xx < W && yy >= 0 && yy < H) out[yy * W + xx] = 1; } return out; };
        T.shift = (m, dx, dy) => { const out = new Uint8Array(W * H); for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (m[i]) { const xx = x + Math.round(dx), yy = y + Math.round(dy); if (xx >= 0 && xx < W && yy >= 0 && yy < H) out[yy * W + xx] = 1; } return out; };
        T.iou = (a, b) => { let i = 0, n = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) n++; } return n ? i / n : 1; };
        T.snap = () => { const o = {}; for (const L of window.__node.__rgState().layers) o[L.id] = T.mask(L.id); return o; };
        T.pose = () => JSON.parse(JSON.stringify(window.__node.__rgState().poses[0].pts));
    }, [W, H]);
    const ALL_IDS = [30, 10, 11, 12, 13, 14], A_SHOWN = [10, 11, 12, 14], A_ALL = [10, 11, 12, 13, 14];
    // compare: every layer now against the test's expectation (fn: id -> expected mask, from the masks before)
    const expect = (name, fn, ids = ALL_IDS) => page.evaluate(([fn, ids]) => {
        const T = window.__T, before = T.before, bad = [];
        for (const id of ids) { const want = new Function("T", "before", "id", "return " + fn)(T, before, id), got = T.mask(id), q = T.iou(want, got); if (q < 0.96) bad.push(`${id}: ${q.toFixed(3)}`); }
        return bad;
    }, [fn, ids]).then((bad) => check(name, !bad.length, bad.join(", ")));
    const keepBefore = () => page.evaluate(() => { window.__T.before = window.__T.snap(); window.__T.poseBefore = window.__T.pose(); });

    const arrangeBtn = page.locator('.rg-bar .rg-btn.icon[title^="Arrange"]');
    const pop = page.locator(".rg-arrange");
    const openArrange = async () => { if (!(await pop.count())) { await arrangeBtn.click(); await page.waitForTimeout(150); } };
    const closeArrange = async () => { if (await pop.count()) { await arrangeBtn.click(); await page.waitForTimeout(100); } };
    const applyTo = async (text) => { await openArrange(); await pop.locator(".rg-arrange-seg .rg-btn", { hasText: text }).first().click(); await page.waitForTimeout(120); };
    const press = async (titleStart) => { await openArrange(); await pop.locator(`button[title^="${titleStart}"]`).first().click(); await page.waitForTimeout(250); };
    const undo = async () => { await closeArrange(); await page.locator('.rg-bar [title^="Undo"]').click(); await page.waitForTimeout(200); };
    const tip = (w) => page.locator(`.rg-bar [title^="${w}"]`).getAttribute("title");

    // ---- the pop-up: Apply to, with nothing selected
    await page.evaluate(() => window.__node.__rgSelectLayer(null));
    check("with layers on the canvas and none selected, Arrange is ready", !(await arrangeBtn.isDisabled()));
    await openArrange();
    const rowNames = () => pop.evaluate((p) => [...p.querySelectorAll(".rg-arrange-row > .rg-hint:first-child")].map((h) => h.textContent).join("|"));
    const choices = await pop.evaluate((p) => [...p.querySelectorAll(".rg-arrange-row:first-child .rg-btn")].map((b) => b.textContent + (b.disabled ? "(off)" : "") + (b.classList.contains("on") ? "*" : "")).join(" "));
    check(`"Apply to" has Layer, Region, All and Pick…; with nothing selected Layer is off (${choices})`, /^Layer\(off\) Region\S* All\S* Pick…\S*$/.test(choices));
    check(`the rows: ${await rowNames()}`, /^Apply to\|(Several\|)?Flip\|Align\|Edge$/.test(await rowNames()));
    const flipBtns = await pop.evaluate((p) => [...p.querySelectorAll(".rg-arrange-row")].find((r) => r.firstChild.textContent === "Flip").querySelectorAll("button").length);
    check(`the Flip row has four buttons: two in place, two across the image (${flipBtns})`, flipBtns === 4);

    // ---- a region, flipped in place: about the middle of its shown layers; the hidden one, the hole and the figure follow
    await page.evaluate(() => window.__node.__rgSelectLayer(10));
    await applyTo("Region");
    check("Edge is for a single layer only: its buttons are off for a region", await pop.evaluate((p) => [...p.querySelectorAll(".rg-arrange-row.off button")].length === 2 && [...p.querySelectorAll(".rg-arrange-row.off button")].every((b) => b.disabled)));
    await keepBefore();
    await page.evaluate((ids) => { const T = window.__T, b = T.box(T.union(ids)); T.cx = (b[0] + b[2]) / 2; }, A_SHOWN.filter((id) => id !== 14));
    await press("Flip horizontally");
    await expect("region 0 flipped in place: each of its layers mirrored about the middle of its shown layers (the hidden one and the hole too)", "T.mirror(before[id], 'h', T.cx)", A_ALL);
    await expect("region 1 did not move", "before[id]", [30]);
    const poseOk = await page.evaluate(() => { const T = window.__T, a = T.poseBefore, b = T.pose(), [W, H] = [T.W, T.H], S = Math.min(W, H), cu = (T.cx - W / 2) / S;
        const SW = [0, 1, 5, 6, 7, 2, 3, 4, 11, 12, 13, 8, 9, 10, 15, 14, 17, 16];
        return b.every((p, k) => Math.abs(p[0] - (2 * cu - a[SW[k]][0])) < 0.005 && Math.abs(p[1] - a[SW[k]][1]) < 1e-9); });      // (within 2 px: the editor's box and the test's can differ by a pixel)
    const pdbg = await page.evaluate(() => { const T = window.__T; return JSON.stringify({ reg: window.__node.__rgState().poses[0].region, a: T.poseBefore.slice(0, 3), b: T.pose().slice(0, 3), cx: T.cx }); });
    check("its pose figure is mirrored with it, its left and right joints swapped", poseOk, pdbg);
    check(`Undo names the step (${await tip("Undo")})`, /^Undo: Flipping region 0 horizontally \(/.test(await tip("Undo")));
    await undo();
    await expect("one Undo puts every layer back", "before[id]");
    check("…and the figure", await page.evaluate(() => JSON.stringify(window.__T.pose()) === JSON.stringify(window.__T.poseBefore)));
    check(`Redo names the same step (${await tip("Redo")})`, /^Redo: Flipping region 0 horizontally \(/.test(await tip("Redo")));

    // ---- the whole picture, mirrored from the canvas's right-click menu: across the image's vertical centre line
    await keepBefore();
    { const [x, y] = await page.evaluate(() => window.__node.__rgToClient(300, 330)); await page.mouse.click(x, y, { button: "right" }); await page.waitForTimeout(200); }
    const item = page.locator(".rg-menu .rg-menu-item", { hasText: "Mirror the whole picture" });
    check("the canvas's right-click menu has 'Mirror the whole picture'", await item.count() === 1);
    await item.click(); await page.waitForTimeout(300);
    await expect("the whole picture is mirrored left to right across the image's centre line", `T.mirror(before[id], 'h', ${W / 2})`);
    check(`Undo: ${await tip("Undo")}`, /^Undo: Mirroring the whole picture horizontally \(/.test(await tip("Undo")));
    await undo();
    await expect("and one Undo takes it back", "before[id]");

    // ---- All, vertically, from the pop-up's "across the image" button
    await keepBefore();
    await applyTo("All");
    await press("Mirror vertically");
    await expect("All, mirrored vertically across the image's horizontal centre line", `T.mirror(before[id], 'v', ${H / 2})`);
    await undo();

    // ---- a region aligned: its shown layers as one block; the hidden one moves by the same amount
    await keepBefore();
    await page.evaluate((ids) => { const T = window.__T, b = T.box(T.union(ids)); T.dx = -b[0]; T.dy = T.H - b[3]; }, [10, 11, 12]);
    await applyTo("Region");
    await press("Align to the left edge");
    await expect("region 0 aligned to the left edge as one block: every layer moved by the same amount", "T.shift(before[id], T.dx, 0)", A_ALL);
    await expect("region 1 stays", "before[id]", [30]);
    await undo();

    // ---- picked regions: Together (one block) and Each (each on its own), centred horizontally
    await applyTo("Pick");
    const chips = await pop.evaluate((p) => [...p.querySelectorAll(".rg-arrange-chip")].map((c) => c.textContent + (c.disabled ? "(off)" : "") + (c.classList.contains("on") ? "*" : "")).join(" "));
    check(`Pick shows a chip per region; the empty one is off, the active one picked (${chips})`, chips === "0* 1 2(off)");
    check("with one region picked there is no Together / Each switch", !/Several/.test(await rowNames()));
    await pop.locator(".rg-arrange-chip", { hasText: "1" }).click(); await page.waitForTimeout(120);
    check(`with two picked the Together / Each switch shows (${await rowNames()})`, /Several/.test(await rowNames()));
    await keepBefore();
    await page.evaluate(() => { const T = window.__T, b = T.box(T.union([10, 11, 12, 30])); T.dx = T.W / 2 - (b[0] + b[2]) / 2; });
    await press("Centre horizontally");
    await expect("Together: both regions centred as one block (each layer moved by the same amount)", "T.shift(before[id], T.dx, 0)");
    await undo();
    await openArrange();
    await pop.locator(".rg-arrange-seg .rg-btn", { hasText: "Each" }).click(); await page.waitForTimeout(120);
    await keepBefore();
    await page.evaluate(() => { const T = window.__T, a = T.box(T.union([10, 11, 12])), b = T.box(T.union([30])); T.dxA = T.W / 2 - (a[0] + a[2]) / 2; T.dxB = T.W / 2 - (b[0] + b[2]) / 2; });
    await press("Centre horizontally");
    await expect("Each: region 0 centred on its own", "T.shift(before[id], T.dxA, 0)", A_ALL);
    await expect("Each: region 1 centred on its own", "T.shift(before[id], T.dxB, 0)", [30]);
    check(`Undo: ${await tip("Undo")}`, /^Undo: Aligning 2 regions, each to the horizontal centre \(/.test(await tip("Undo")));
    await undo();
    await openArrange();
    await pop.locator(".rg-arrange-seg .rg-btn", { hasText: "Together" }).click(); await page.waitForTimeout(120);

    // ---- one layer, mirrored across the image's centre line (the new button)
    await page.evaluate(() => window.__node.__rgSelectLayer(30));
    await applyTo("Layer");
    check("for a single layer, Edge is on again", await pop.evaluate((p) => !p.querySelector(".rg-arrange-row.off")));
    await keepBefore();
    await press("Mirror horizontally");
    await expect("one layer mirrored across the image's centre line; nothing else moves", `id === 30 ? T.mirror(before[id], 'h', ${W / 2}) : before[id]`);
    check(`Undo: ${await tip("Undo")}`, /^Undo: Mirroring layer "L30" horizontally across the image \(/.test(await tip("Undo")));
    await undo();

    // ---- an image under the regions (Edit Mode's source, the backdrop) is an input: the hint says it stays
    await applyTo("All");
    // (the stub node has no image input, so the editor drops a backdrop at its next look: set and pressed in one go)
    await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 4; c.height = 3; window.__node.__rgSetBackdrop(c);
        document.querySelector('.rg-arrange button[title^="Flip horizontally"]').click(); });
    await page.waitForTimeout(150);
    const hint = await page.evaluate(() => document.querySelector(".rg-status")?.textContent || "");
    check(`with a picture under the regions, a mirror says it stays as it was (${hint})`, /image under them is an input/.test(hint));
    await undo();
    await page.evaluate(() => window.__node.__rgSetBackdrop(null));

    console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
    await browser.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
