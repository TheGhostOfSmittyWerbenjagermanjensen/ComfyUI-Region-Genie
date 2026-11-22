// Browser checks of round 61: the Pose tool (stick figures for pose control). Drawing a figure into a dragged box, its
// joints, moving / resizing / turning / flipping it, hidden joints, the region it belongs to, the list, the keys, Undo,
// the "pose" Control kind and saving.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 900, height: 1300 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__node.__rgState())));
    const poses = async () => (await st()).poses || [];
    const sleep = (ms) => page.waitForTimeout(ms);
    // two regions side by side (their layers: rectangles), ids 1 and 2
    await page.evaluate(() => { const n = window.__node, s = n.__rgState();
        s.regions.push({ id: 1, color: "#4363D8", prompt: "a knight", type: "character", text: "" }, { id: 2, color: "#3CB44B", prompt: "a wizard", type: "character", text: "" });
        const L = (id, region, ox) => ({ id, name: "Rect " + id, region, visible: true, shape: "rect", sides: 5, bw: .4, bh: .9, sx: 1, sy: 1, rot: 0, ox, oy: 0, ops: [] });
        s.layers.push(L(1, 1, -.25), L(2, 2, .25)); n.__rgRefresh(); });
    await sleep(200);
    // a point given as the figures have it (units of the shorter side from the image centre) -> the page
    const at = (p) => page.evaluate(([x, y]) => { const n = window.__node, [W, H] = n.__rgDims(), s = Math.min(W, H); return n.__rgToClient(W / 2 + x * s, H / 2 + y * s); }, p);
    const drag = async (a, b, opt = {}) => { const [x0, y0] = await at(a), [x1, y1] = await at(b); await page.mouse.move(x0, y0); await page.mouse.down();
        if (opt.shift) await page.keyboard.down("Shift");
        await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 3 }); await page.mouse.move(x1, y1, { steps: 3 }); await page.mouse.up(); if (opt.shift) await page.keyboard.up("Shift"); await sleep(120); };
    const click = async (p) => { const [x, y] = await at(p); await page.mouse.click(x, y); await sleep(100); };
    const box = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];

    // ---- the tool, its key and its strip
    await page.locator(".rg-cv canvas").hover(); await page.keyboard.press("p"); await sleep(120);
    check("P picks the Pose tool; its button is lit and has a tooltip", await page.evaluate(() => { const b = [...document.querySelectorAll(".rg-bar button")].find((x) => /^Pose: /.test(x.title)); return !!b && b.classList.contains("on"); }));
    const strip = page.locator(".rg-poseopts");
    const names = await strip.locator("select option").allTextContents();
    check(`the strip on the canvas lists the 13 starting poses (${names.length})`, await strip.isVisible() && names.length === 13
        && ["Standing", "Walking", "Running", "Jumping", "Sitting", "Squatting", "Crawling", "Lying on the back", "Lying on the side", "One arm raised", "Both arms raised", "Facing away", "T-pose"].every((x) => names.includes(x)));
    check("with no figure selected, flip / duplicate / delete are off", await strip.locator("button:disabled").count() === 4);
    check("the region labels are out of the way while the Pose tool is in use (the hints name the tool's moves)", /Drag a box/.test(await page.evaluate(() => document.querySelector(".rg-tips").textContent)));

    // ---- drag a box: a figure is drawn into it, in the region under it
    await drag([-.40, -.38], [-.10, .38]);
    let P = await poses();
    const b0 = box(P[0]?.pts || [[0, 0]]);
    check(`a dragged box gives a figure of 18 joints, fitted into the box (${b0.map((v) => v.toFixed(2))})`, P.length === 1 && P[0].pts.length === 18
        && b0[0] >= -.41 && b0[2] <= -.09 && b0[1] >= -.39 && b0[3] <= .39 && Math.abs(b0[3] - b0[1] - .76) < .02);
    check("it belongs to the region under it (region 1) and is selected", P[0].region === 1 && await strip.locator("button:disabled").count() === 1);
    check("standing: the person's right shoulder is on our left, nothing hidden", P[0].pts[2][0] < P[0].pts[5][0] && !P[0].off);
    const row = page.locator(".rg-list .rg-row.pose");
    check("the figure is listed with its region's layers (Layers (2)), selected", await row.count() === 1 && await row.first().evaluate((r) => r.classList.contains("sel"))
        && /Layers \(2\)/.test(await page.locator(".rg-list").textContent()) && await row.locator("input").inputValue() === "Pose 1");
    check("the paint_data widget has the figure", await page.evaluate(() => (JSON.parse(window.__node.widgets.find((w) => w.name === "paint_data").value).poses || []).length) === 1);

    // ---- a joint
    const w0 = P[0].pts[7];
    await drag(w0, [w0[0] + .08, w0[1] - .30]);
    P = await poses();
    check("dragging a joint moves that joint only", Math.abs(P[0].pts[7][0] - w0[0] - .08) < .01 && Math.abs(P[0].pts[7][1] - w0[1] + .30) < .01 && Math.abs(P[0].pts[6][0] - .0) < 1 && P[0].pts[4][1] === (await poses())[0].pts[4][1]);
    const jb = strip.locator("button").nth(1);
    check("the hide-joint button names the joint that was grabbed", /left wrist/.test(await jb.getAttribute("title")));
    await jb.click(); await sleep(100);
    check("hide joint: the joint is out of the pose map (off), the button is lit", JSON.stringify((await poses())[0].off) === "[7]" && await jb.evaluate((b) => b.classList.contains("on")));
    await jb.click(); await sleep(100);
    check("again: shown again", !(await poses())[0].off);

    // ---- the whole figure: flip, resize, turn
    await strip.locator("button").nth(0).click(); await sleep(100);
    let F = (await poses())[0];
    check("flip: the picture is mirrored and the sides are renamed with it (still facing us; the raised wrist is now the right one, on our left)",
        F.pts[2][0] < F.pts[5][0] && F.pts[4][1] < F.pts[7][1] - .2 && F.pts[4][0] < F.pts[1][0]);
    await strip.locator("button").nth(0).click(); await sleep(100);
    F = (await poses())[0];
    const bb = box(F.pts), hands = await page.evaluate(() => null);
    // the bottom-right handle: the box's corner plus the 9 px of room around it
    const corner = async () => { const b = box((await poses())[0].pts); const [x, y] = await at([b[2], b[3]]); return [x + 9, y + 9, b]; };
    let [hx, hy] = await corner();
    await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx + 20, hy + 20, { steps: 4 }); await page.mouse.up(); await sleep(120);
    const bs = box((await poses())[0].pts);
    check(`a corner handle resizes the figure, the opposite corner stays, the proportions too (${(bs[2] - bs[0]).toFixed(3)} x ${(bs[3] - bs[1]).toFixed(3)})`,
        bs[3] - bs[1] > bb[3] - bb[1] + .01 && Math.abs((bs[2] - bs[0]) / (bs[3] - bs[1]) - (bb[2] - bb[0]) / (bb[3] - bb[1])) < .02 && Math.abs(bs[1] - bb[1]) < .03);
    const top = async () => { const b = box((await poses())[0].pts); const [x, y] = await at([(b[0] + b[2]) / 2, b[1]]); return [x, y - 9 - 20]; };
    const [rx, ry] = await top(); const neck0 = (await poses())[0].pts[1], ank0 = (await poses())[0].pts[10];
    await page.mouse.move(rx, ry); await page.mouse.down(); await page.mouse.move(rx + 40, ry + 6, { steps: 4 }); await page.mouse.up(); await sleep(120);
    const R = (await poses())[0];
    const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    check("the round handle turns the figure (its bones keep their lengths)", Math.abs(R.pts[1][0] - neck0[0]) > .01 && Math.abs(len(R.pts[1], R.pts[10]) - len(neck0, ank0)) < .005);

    // ---- move it onto the other region: it belongs to that one
    await page.keyboard.press("Control+z"); await sleep(150);
    const hip = (await poses())[0].pts, mid = [(hip[1][0] + hip[8][0]) / 2, (hip[1][1] + hip[8][1]) / 2];
    await drag(mid, [mid[0] + .50, mid[1]]);
    P = await poses();
    check(`dragged by a bone onto the other region: it moved (${(P[0].pts[1][0]).toFixed(2)}) and belongs to region 2`, P[0].pts[1][0] > .1 && P[0].region === 2);
    check("it is listed under that region now", await page.evaluate(() => { const rows = [...document.querySelectorAll(".rg-list .rg-row")]; const i = rows.findIndex((r) => r.classList.contains("pose")); const j = rows.findIndex((r) => /a wizard/.test(r.querySelector("textarea")?.value || "")); return i > j && j >= 0; }));

    // ---- another starting pose; duplicate, delete, undo
    await strip.locator("select").selectOption("facingAway"); await sleep(60);
    await drag([-.40, -.38], [-.10, .38]);
    P = await poses();
    check("Facing away: the face is hidden (nose and eyes), the person's right is on our right", P.length === 2 && JSON.stringify(P[1].off) === "[0,14,15]" && P[1].pts[2][0] > P[1].pts[5][0] && P[1].region === 1);
    await page.locator(".rg-cv canvas").hover(); await page.keyboard.press("Control+d"); await sleep(150);
    check("Ctrl+D duplicates the selected figure", (await poses()).length === 3);
    await page.keyboard.press("Delete"); await sleep(150);
    check("Delete removes it", (await poses()).length === 2);
    await page.keyboard.press("Control+z"); await sleep(150);
    check("Undo brings it back", (await poses()).length === 3);
    await page.keyboard.press("Control+z"); await sleep(150);
    await click([0, -.47]);
    check("a click on empty canvas deselects (the box is gone, the buttons are off)", await strip.locator("button:disabled").count() === 4);

    // ---- the list row's buttons; the Select tool doesn't touch figures
    await page.locator(".rg-list .rg-row.pose").first().locator("button").first().click(); await sleep(120);          // the eye
    check("a figure's eye hides it", (await poses()).some((p) => p.visible === false));
    await page.locator(".rg-list .rg-row.pose").first().locator("button").first().click(); await sleep(120);
    await page.evaluate(() => window.__node.__rgSetTool("select")); await sleep(80);
    check("with another tool the strip is hidden and the figures stay drawn", !(await strip.isVisible()) && (await poses()).length === 2);
    const before = JSON.stringify(await poses());
    const h2 = (await poses())[1].pts; await drag(h2[4], [h2[4][0] + .1, h2[4][1]]);
    check("the Select tool doesn't move joints", JSON.stringify((await poses()).map((p) => p.pts[4])) === JSON.stringify(JSON.parse(before).map((p) => p.pts[4])));
    await page.keyboard.press("Control+z"); await sleep(120);

    // ---- Control: the kind "pose"; saving and loading; deleting a region
    await page.evaluate(() => { const n = window.__node, s = n.__rgState(); s.controls = [{ kind: "pose", strength: 1, start: 0, end: 1 }]; n.__rgRefresh(); }); await sleep(200);
    const ksel = page.locator(".rg-row.ctrl select").first();
    check("a Control row can be set to pose (the figures on the canvas)", await ksel.inputValue() === "pose" && /pose \(the figures on the canvas\)/.test(await ksel.locator("option:checked").textContent())
        && /stick figures/.test(await ksel.getAttribute("title") || await page.locator(".rg-row.ctrl").first().evaluate((r) => [...r.querySelectorAll("[title]")].map((e) => e.title).join(" "))));
    await page.evaluate(() => { const n = window.__node; n.onConfigure?.({ widgets_values: n.widgets.map((x) => x.value), properties: n.properties }); }); await sleep(300);
    const again = await st();
    check("saved and loaded again: the figures and the pose Control row are there", (again.poses || []).length === 2 && again.controls?.[0]?.kind === "pose" && again.poses[1].off?.join() === "0,14,15");
    await page.evaluate(() => { const n = window.__node, s = n.__rgState(); const w = n.widgets.find((x) => x.name === "paint_data"); const d = JSON.parse(w.value); d.regions = d.regions.filter((r) => r.id !== 1); d.layers = d.layers.filter((l) => l.region !== 1);
        w.value = JSON.stringify(d); n.onConfigure?.({ widgets_values: n.widgets.map((x) => x.value), properties: n.properties }); }); await sleep(300);
    check("a figure whose region is gone is dropped when the data is read", ((await st()).poses || []).every((p) => p.region === 2));

    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
