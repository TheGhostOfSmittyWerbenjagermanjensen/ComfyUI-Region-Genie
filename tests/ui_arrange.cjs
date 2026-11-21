// Browser checks of "Arrange the selected layer": flip, align, grow / shrink, for every shape, brush strokes, lasso
// outlines, pixel layers, turned and stretched layers. Everything is judged by the layer's pixels on the image
// (__rgLayerMask), against pictures worked out here independently of the editor's own code.
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
    const W = 512, H = 384, S = 384, G = 8;
    await page.evaluate(([W, H]) => { for (const [n, v] of [["width", W], ["height", H]]) { const w = window.__node.widgets.find((w) => w.name === n); w.value = v; w.callback?.(v); } }, [W, H]);
    await page.waitForTimeout(700);
    check("a 512 x 384 image", JSON.stringify(await page.evaluate(() => window.__node.__rgDims())) === "[512,384]");
    // a region to put layers into
    await page.evaluate(() => window.__node.__rgSetTool("shape"));
    { const b = await page.locator(".rg-cv canvas").boundingBox(); await page.mouse.move(b.x + b.width / 2 - 30, b.y + b.height / 2 - 30); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 + 30, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150); }
    await page.evaluate(() => window.__node.__rgSetTool("select"));

    // ---- the test's own tools, in the page
    await page.evaluate(async ([W, H, S]) => {
        const { shapeVerts } = await import("/extensions/rg/editor/geometry.js");
        const T = window.__T = { W, H, S };
        T.mask = () => { const r = window.__node.__rgLayerMask(9); return r.m; };
        T.layer = () => window.__node.__rgState().layers.find((l) => l.id === 9);
        T.toImg = (L, lx, ly) => { const th = L.rot * Math.PI / 180, dx = (lx - L.bw / 2) * L.sx * S, dy = (ly - L.bh / 2) * L.sy * S;
            return [W / 2 + L.ox * S + Math.cos(th) * dx - Math.sin(th) * dy, H / 2 + L.oy * S + Math.sin(th) * dx + Math.cos(th) * dy]; };
        T.outline = (L) => shapeVerts(L.shape, L.sides, L.bw, L.bh, L.radius).map(([u, v]) => T.toImg(L, u * L.bw, v * L.bh));
        T.bbox = (m) => { let x0 = W, x1 = -1, y0 = H, y1 = -1, n = 0, sx = 0, sy = 0;
            for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (m[i]) { n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
            return { x0, y0, x1: x1 + 1, y1: y1 + 1, n, cx: sx / n + 0.5, cy: sy / n + 0.5 }; };
        // a mask grown (r > 0) or shrunk by r px: every pixel within r of a set one, tried offset by offset
        T.grow = (m, r) => { const a = Math.abs(r), R = Math.ceil(a), offs = [];
            for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= a * a + 1e-6) offs.push([dx, dy]);
            const src = r > 0 ? m : m.map((v) => (v ? 0 : 1)), out = new Uint8Array(W * H);
            for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (src[i]) for (const [dx, dy] of offs) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < W && yy >= 0 && yy < H) out[yy * W + xx] = 1; }
            return r > 0 ? out : out.map((v) => (v ? 0 : 1)); };
        // is `got` the picture `want`, give or take tol px along its edge? Returns the number of pixels that aren't
        T.off = (got, want, tol = 1.5) => { const big = T.grow(want, tol), small = T.grow(want, -tol); let bad = 0;
            for (let i = 0; i < got.length; i++) if ((got[i] && !big[i]) || (!got[i] && small[i])) bad++;
            return bad; };
        T.fillPoly = (P) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
            x.beginPath(); P.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); x.fill();
            const d = x.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0; return m; };
        // a convex outline with every side moved out by g: the pixels on the inner side of all the moved sides
        T.sidesMoved = (P, g) => { let area = 0; P.forEach((a, i) => { const b = P[(i + 1) % P.length]; area += a[0] * b[1] - b[0] * a[1]; });
            const sg = area >= 0 ? 1 : -1, m = new Uint8Array(W * H);
            const E = P.map((a, i) => { const b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [a, sg * dy / l, -sg * dx / l]; });
            for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) m[i] = E.every(([a, nx, ny]) => (x + 0.5 - a[0]) * nx + (y + 0.5 - a[1]) * ny <= g) ? 1 : 0;
            return m; };
        T.mirror = (m, axis, c) => { const out = new Uint8Array(W * H);               // about the line x = c (or y = c)
            for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (m[i]) { const xx = axis === "h" ? Math.round(2 * c - x - 1) : x, yy = axis === "v" ? Math.round(2 * c - y - 1) : y; if (xx >= 0 && xx < W && yy >= 0 && yy < H) out[yy * W + xx] = 1; }
            return out; };
        T.pixMid = () => { const l = T.layer(), b = l.shape && !l.ops.length ? (() => { const P = T.outline(l), xs = P.map((p) => p[0]), ys = P.map((p) => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; })() : T.bbox(T.mask());
            return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };
    }, [W, H, S]);

    const base = { id: 9, name: "T", visible: true, shape: null, sides: 5, bw: W / S, bh: 1, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0, ops: [] };
    const put = async (c) => { await page.evaluate(([b, c]) => { const s = window.__node.__rgState(); s.layers = [{ ...b, region: s.regions[0].id, ...JSON.parse(JSON.stringify(c)) }]; window.__node.__rgSelectLayer(9); }, [base, c]); await page.waitForTimeout(60); };
    const act = async (title) => { if (!(await page.locator(".rg-arrange").count())) await page.locator('.rg-bar .rg-btn.icon[title^="Arrange"]').click();
        await page.locator(`.rg-arrange button[title^="${title}"]`).click(); await page.waitForTimeout(80); };
    const setPx = async (n) => { if (!(await page.locator(".rg-arrange").count())) await page.locator('.rg-bar .rg-btn.icon[title^="Arrange"]').click();
        const i = page.locator(".rg-arrange input"); await i.fill(String(n)); await i.dispatchEvent("change"); };
    const GROW = "Grow the layer", SHRINK = "Shrink the layer", FH = "Flip horizontally", FV = "Flip vertically";
    const layer = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__T.layer())));
    const stroke = { t: "stroke", e: false, d: 0.09, p: [[0.3, 0.25], [0.8, 0.35], [0.55, 0.75]] };
    const lasso = { t: "poly", e: false, p: [[0.3, 0.2], [0.9, 0.3], [0.7, 0.8], [0.35, 0.6]] };
    const shapes = {
        "rectangle": { shape: "rect", bw: 0.5, bh: 0.3 },
        "rectangle, turned 30° and stretched": { shape: "rect", bw: 0.5, bh: 0.3, rot: 30, sx: 0.7, sy: 1.2, ox: 0.1 },
        "rounded rectangle": { shape: "roundrect", bw: 0.5, bh: 0.3, radius: 30 },
        "ellipse": { shape: "ellipse", bw: 0.5, bh: 0.3 },
        "ellipse, turned": { shape: "ellipse", bw: 0.5, bh: 0.3, rot: -40, oy: 0.05 },
        "triangle": { shape: "triangle", bw: 0.4, bh: 0.4, ox: 0.1 },
        "triangle, turned 70°": { shape: "triangle", bw: 0.4, bh: 0.3, rot: 70 },
        "pentagon": { shape: "polygon", sides: 5, bw: 0.4, bh: 0.4 },
        "hexagon": { shape: "polygon", sides: 6, bw: 0.4, bh: 0.4, rot: 15 },
        "star": { shape: "star", sides: 5, bw: 0.5, bh: 0.5 },
        "heart": { shape: "heart", bw: 0.4, bh: 0.4, oy: -0.05 },
    };
    const paints = {
        "brush stroke": { ops: [stroke] },
        "brush stroke, layer turned and stretched": { ops: [stroke], rot: 25, sx: 0.8, sy: 1.1, ox: 0.05 },
        "lasso outline": { ops: [lasso] },
        "rectangle with a brush stroke on it": { shape: "rect", bw: 0.3, bh: 0.2, ox: -0.25, oy: -0.15, ops: [{ t: "stroke", e: false, d: 0.05, p: [[0.25, 0.15], [0.55, 0.35], [0.5, 0.5]] }] },
        "star with part erased": { shape: "star", sides: 5, bw: 0.5, bh: 0.5, ops: [{ t: "stroke", e: true, d: 0.1, p: [[0.1, 0.1], [0.3, 0.3]] }] },
    };

    // ---------------------------------------------------------------- grow / shrink: shapes stay shapes
    for (const [name, c] of Object.entries(shapes)) {
        await put(c);
        const before = await layer();
        await act(GROW);
        const L = await layer();
        check(`grow, ${name}: still that shape (not pixels), turned and stretched as before`, L.shape === c.shape && L.ops.length === 0 && L.rot === before.rot && L.sx === before.sx && L.sy === before.sy && (L.sides === before.sides));
        const r = await page.evaluate(([before, G, kind]) => {
            const T = window.__T, got = T.mask();
            let want, tol = 1.5;
            if (kind === "rect" || kind === "triangle" || kind === "polygon") want = T.sidesMoved(T.outline(before), G);     // every side G px out, corners still corners
            else if (kind === "star") {                         // the same star, larger: its sides are all G px further from its middle
                const P = T.outline(before), c = T.toImg(before, before.bw / 2, before.bh / 2), a = P[0], b = P[1];
                const dist = Math.abs((b[0] - a[0]) * (a[1] - c[1]) - (a[0] - c[0]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]), k = (dist + G) / dist;
                want = T.fillPoly(P.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k]));
            } else if (kind === "heart") want = T.fillPoly(T.outline({ ...before, bw: before.bw + 2 * G / T.S / before.sx, bh: before.bh + 2 * G / T.S / before.sy }));   // the same heart, its box G px larger on every side
            else want = T.grow(T.fillPoly(T.outline(before)), G);    // round outlines: every point within G px
            const b0 = T.bbox(T.fillPoly(T.outline(before))), b1 = T.bbox(got);
            return { bad: T.off(got, want, tol), move: Math.hypot(b1.cx - b0.cx, b1.cy - b0.cy), grew: [b0.x0 - b1.x0, b1.x1 - b0.x1, b0.y0 - b1.y0, b1.y1 - b0.y1] };
        }, [before, G, c.shape]);
        check(`…its edge is ${G} px further out all round, the outline otherwise the same (${r.bad} pixels off)`, r.bad === 0);
        if (["rect", "roundrect", "ellipse", "star"].includes(c.shape) || (c.shape === "polygon" && c.sides === 6))
            check(`…and it hasn't moved (its middle is ${r.move.toFixed(2)} px from where it was)`, r.move < 0.6);
        await act(SHRINK);
        const back = await layer();
        check(`shrink by the same: the shape as it was at the start`, back.shape === c.shape && ["bw", "bh", "ox", "oy"].every((k) => Math.abs(back[k] - before[k]) < 1e-6)
            && (c.shape !== "roundrect" || Math.abs(back.radius - before.radius) < 1e-6));
        await act(SHRINK);
        const r2 = await page.evaluate(([before, G, kind]) => {
            const T = window.__T, got = T.mask();
            const want = kind === "rect" || kind === "triangle" || kind === "polygon" ? T.sidesMoved(T.outline(before), -G) : kind === "star" ? null
                : kind === "heart" ? T.fillPoly(T.outline({ ...before, bw: before.bw - 2 * G / T.S / before.sx, bh: before.bh - 2 * G / T.S / before.sy })) : T.grow(T.fillPoly(T.outline(before)), -G);
            return want ? T.off(got, want, 1.5) : 0;
        }, [before, G, c.shape]);
        check(`…and once more: its edge is ${G} px further in all round (${r2} pixels off)`, r2 === 0 && (await layer()).shape === c.shape);
    }
    // a rounded rectangle's corners: still round, their radius G px larger
    await put(shapes["rounded rectangle"]);
    await act(GROW);
    let L = await layer();
    const rad = (l) => l.radius / 100 * Math.min(l.bw, l.bh) * S;
    check(`rounded rectangle grown: the corners' radius is ${G} px larger (${rad(shapes["rounded rectangle"]).toFixed(1)} -> ${rad(L).toFixed(1)} px)`, Math.abs(rad(L) - rad(shapes["rounded rectangle"]) - G) < 0.01);
    // too small to shrink: left alone, with a message
    await put({ shape: "rect", bw: 0.03, bh: 0.2 });
    await act(SHRINK);
    L = await layer();
    check("a shape too small to shrink that far is left as it is, and the editor says so", L.shape === "rect" && Math.abs(L.bw - 0.03) < 1e-9
        && /too small to shrink/.test(await page.evaluate(() => document.body.innerText)));
    for (const k of ["star", "heart", "triangle"]) {
        await put({ ...shapes[k], bw: 0.06, bh: 0.06 });
        await act(SHRINK);
        L = await layer();
        check(`…a small ${k} too`, L.shape === shapes[k].shape && Math.abs(L.bw - 0.06) < 1e-9);
    }
    // a gradient on a shape stays where it is on the image
    await put({ ...shapes.rectangle, grad: { k: "linear", a: [0.1, 0.15], b: [0.4, 0.15] } });
    const gradAt = () => page.evaluate(() => { const T = window.__T, l = T.layer(); return [T.toImg(l, ...l.grad.a), T.toImg(l, ...l.grad.b)]; });
    const g0 = await gradAt();
    await act(GROW);
    const g1 = await gradAt();
    check("a fade on the shape keeps its place on the image when the shape grows", g0.flat().every((v, i) => Math.abs(v - g1.flat()[i]) < 1e-6));

    // ---------------------------------------------------------------- grow / shrink: painted layers become pixels
    for (const [name, c] of Object.entries(paints)) {
        for (const [title, g] of [[GROW, G], [SHRINK, -4]]) {
            await put(c);
            await setPx(Math.abs(g));
            const before = await page.evaluate(() => { window.__before = window.__T.mask(); return true; });
            await act(title);
            L = await layer();
            const r = await page.evaluate(([g, sharp]) => { const T = window.__T, got = T.mask(), want = T.grow(window.__before, g);
                // pointed corners put back: more than the round picture, never beyond every side moved g px
                let extra = 0, bad = 0; const big = T.grow(want, 1.5), small = T.grow(want, -1.5), lim = sharp ? T.grow(window.__before, g * 4.2) : big;
                for (let i = 0; i < got.length; i++) { if (got[i] && !big[i]) { extra++; if (!lim[i]) bad++; } if (!got[i] && small[i]) bad++; }
                return { bad, extra }; }, [g, g > 0 && !c.ops.some((o) => o.e) && (c.shape || c.ops.some((o) => o.t === "poly"))]);
            check(`${title.split(" ")[0].toLowerCase()} by ${Math.abs(g)} px, ${name}: pixels, every point of its edge ${Math.abs(g)} px ${g > 0 ? "out" : "in"}, nothing moved (${r.bad} pixels off)`,
                r.bad === 0 && L.shape === null && L.ops.length === 1 && L.ops[0].t === "bitmap" && L.rot === 0 && L.ox === 0);
            if (g > 0 && (c.shape === "rect" || name === "lasso outline")) check(`…and its pointed corners are still pointed (${r.extra} pixels beyond a rounded corner)`, r.extra > 8);
            if (g > 0 && c.ops.some((o) => o.e)) check("…with something erased, corners are rounded instead (nothing comes back where it was erased)", r.extra === 0);
        }
    }
    await setPx(G);
    // growing in steps = growing once; a pixel layer doesn't creep
    await put(paints["brush stroke"]);
    await setPx(4); await act(GROW); await act(GROW); await act(GROW);
    await page.evaluate(() => { window.__three = window.__T.mask(); });
    await put(paints["brush stroke"]);
    await setPx(12); await act(GROW);
    check("three times 4 px = once 12 px (a pixel layer grows the same way again and again, without creeping)", await page.evaluate(() => window.__T.off(window.__three, window.__T.mask(), 1.5)) === 0);
    await setPx(G);
    // a circle of pixels grows into a circle (no flattened sides)
    await put({ shape: "ellipse", bw: 0.3, bh: 0.3, ops: [{ t: "stroke", e: false, d: 0.01, p: [[0.15, 0.15]] }] });
    await setPx(20); await act(GROW);
    const circ = await page.evaluate(() => { const T = window.__T, b = T.bbox(T.mask()), m = T.mask(); let rmin = 1e9, rmax = 0;
        for (let y = 1; y < T.H - 1; y++) for (let x = 1; x < T.W - 1; x++) { const i = y * T.W + x; if (m[i] && !(m[i - 1] && m[i + 1] && m[i - T.W] && m[i + T.W])) { const r = Math.hypot(x + 0.5 - b.cx, y + 0.5 - b.cy); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); } }
        return [rmin, rmax]; });
    check(`a circle grown by 20 px is a circle (edge ${circ[0].toFixed(1)} to ${circ[1].toFixed(1)} px from its middle, wanted ${(0.15 * S + 20).toFixed(1)})`, circ[1] - circ[0] < 1.6 && Math.abs((circ[0] + circ[1]) / 2 - (0.15 * S + 20)) < 1);
    await setPx(G);
    // everything shrunk away: left alone
    await put({ ops: [{ t: "stroke", e: false, d: 0.02, p: [[0.3, 0.3], [0.6, 0.3]] }] });
    await act(SHRINK);
    L = await layer();
    check("a stroke thinner than the shrink is left as it is (not emptied)", L.ops.length === 1 && L.ops[0].t === "stroke");
    // undo
    await put(paints["brush stroke"]);
    await act(GROW);
    await page.locator('.rg-bar [title^="Undo"]').click(); await page.waitForTimeout(100);
    L = await layer();
    check("Undo brings the stroke back", !!L && L.ops.length === 1 && L.ops[0].t === "stroke");

    // ---------------------------------------------------------------- flip
    const flips = { ...shapes, ...paints, "pixel layer (a grown stroke)": null, "shape with a fade": { ...shapes.triangle, rot: 20, grad: { k: "linear", a: [0.1, 0.1], b: [0.3, 0.35] } } };
    for (const [name, c0] of Object.entries(flips)) {
        for (const [title, axis] of [[FH, "h"], [FV, "v"]]) {
            if (c0) await put(c0); else { await put(paints["brush stroke"]); await act(GROW); }
            const c = c0 || {};
            const before = await layer();
            const pre = await page.evaluate(() => { const T = window.__T; window.__before = T.mask(); const l = T.layer(); return { mid: T.pixMid(), box: T.bbox(window.__before), grad: l.grad ? [T.toImg(l, ...l.grad.a), T.toImg(l, ...l.grad.b)] : null }; });
            await act(title);
            L = await layer();
            const r = await page.evaluate(([axis, mid]) => { const T = window.__T, got = T.mask(), want = T.mirror(window.__before, axis, axis === "h" ? mid[0] : mid[1]), l = T.layer();
                let same = 0, n = 0; for (let i = 0; i < got.length; i++) { if (got[i] || window.__before[i]) n++; if (got[i] !== window.__before[i]) same++; }
                return { bad: T.off(got, want, 1.5), changed: same, mid: T.pixMid(), box: T.bbox(got), grad: l.grad ? [T.toImg(l, ...l.grad.a), T.toImg(l, ...l.grad.b)] : null }; }, [axis, pre.mid]);
            const word = axis === "h" ? "left-right" : "upside down";
            check(`flip ${word}, ${name}: the mirror picture of what was there, in the same place (${r.bad} pixels off)`, r.bad === 0 && Math.hypot(r.mid[0] - pre.mid[0], r.mid[1] - pre.mid[1]) < 0.75);
            check("…its pixels cover the same area of the image as before", ["x0", "x1", "y0", "y1"].every((k) => Math.abs(r.box[k] - pre.box[k]) <= (c.shape === "heart" ? 4 : 1.5)));     // a heart's tip is thinner than a pixel: it isn't counted
            check("…and it is still what it was (a shape stays that shape, strokes stay strokes)", L.shape === before.shape && L.ops.length === before.ops.length && L.ops.every((o, i) => o.t === before.ops[i].t)
                && Math.abs(L.bw - before.bw) < 1e-9 && L.sx === before.sx && L.sy === before.sy);
            if (!c.shape && !c.rot && c0) check("…a paint layer that isn't turned keeps its frame (fills still go into it)", L.ox === 0 && L.oy === 0 && L.rot === 0);
            if (c.rot || ["triangle", "star", "heart"].includes(c.shape) || !c.shape) check("…and it does look different afterwards", r.changed > 20 || (c.shape === "star" && axis === "h") || (c.shape === "heart" && axis === "h") || (c.shape === "triangle" && axis === "h" && !c.rot));
            if (pre.grad) check("…its fade is mirrored with it", pre.grad.every((p, i) => { const q = r.grad[i], k = axis === "h" ? 0 : 1; return Math.abs(q[k] - (2 * pre.mid[k] - p[k])) < 0.75 && Math.abs(q[1 - k] - p[1 - k]) < 0.75; }));
            await act(title);
            check("…twice = as it was", await page.evaluate(() => window.__T.off(window.__T.mask(), window.__before, 1.5)) === 0);
        }
    }
    // a turned rectangle: left-right turns it the other way (the old code left it as it was)
    await put(shapes["rectangle, turned 30° and stretched"]);
    await act(FH);
    check("flip left-right on a rectangle turned 30°: now turned -30°", (await layer()).rot === -30);
    await put(shapes.triangle);
    await act(FV);
    check("flip upside down on a triangle: its point is at the bottom", await page.evaluate(() => { const T = window.__T, m = T.mask(), b = T.bbox(m); let top = 0, bot = 0;
        for (let x = 0; x < T.W; x++) { top += m[(b.y0 + 2) * T.W + x]; bot += m[(b.y1 - 3) * T.W + x]; } return top > bot * 5; }));

    // ---------------------------------------------------------------- align
    const ALIGN = { "Align to the left": ["x0", 0], "Align to the right": ["x1", W], "Align to the top": ["y0", 0], "Align to the bottom": ["y1", H] };
    for (const [name, c] of [["ellipse, turned", shapes["ellipse, turned"]], ["brush stroke, layer turned and stretched", paints["brush stroke, layer turned and stretched"]], ["triangle, turned 70°", shapes["triangle, turned 70°"]]]) {
        await put(c);
        const res = [];
        for (const [title, [k, v]] of Object.entries(ALIGN)) { await act(title); const b = await page.evaluate(() => window.__T.bbox(window.__T.mask())); res.push(Math.abs(b[k] - v)); }
        check(`align, ${name}: its own pixels touch the left, right, top and bottom edge of the image (off by ${res.map((v) => v.toFixed(1))} px)`, res.every((v) => v <= 1));
        await act("Centre horizontally"); let b = await page.evaluate(() => window.__T.bbox(window.__T.mask()));
        const okH = Math.abs((b.x0 + b.x1) / 2 - W / 2) <= 1 && b.y1 === H;
        await act("Centre vertically"); b = await page.evaluate(() => window.__T.bbox(window.__T.mask()));
        const okV = Math.abs((b.y0 + b.y1) / 2 - H / 2) <= 1 && Math.abs((b.x0 + b.x1) / 2 - W / 2) <= 1;
        await act("Align to the left"); await act("Align to the top"); await act("Centre in the image"); b = await page.evaluate(() => window.__T.bbox(window.__T.mask()));
        check("…centre horizontally moves it sideways only, centre vertically up / down only, centre in the image both", okH && okV && Math.abs((b.y0 + b.y1) / 2 - H / 2) <= 1 && Math.abs((b.x0 + b.x1) / 2 - W / 2) <= 1);
        const sh = await layer();
        check("…and it is only moved (same shape, size and turn)", sh.shape === (c.shape || null) && sh.rot === (c.rot || 0) && Math.abs(sh.bw - (c.bw || W / S)) < 1e-9);
    }
    // a layer that runs off the image is aligned by its whole box on that side
    await put({ shape: "rect", bw: 0.5, bh: 0.3, ox: -0.6 });
    await act("Align to the left");
    L = await layer();
    check("a shape partly off the image: align left brings all of it in", Math.abs((W / 2 + L.ox * S) - 0.25 * S) < 1);

    await page.screenshot({ path: require("path").join(__dirname, "out", "ui_arrange.png") });
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED:\n  ` + fails.join("\n  ") : "\nALL PASS");
    process.exit(fails.length ? 1 : 0);
})();
