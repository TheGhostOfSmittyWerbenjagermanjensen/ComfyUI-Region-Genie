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
    check(`the strip on the canvas lists the 13 starting poses and "From the image" (${names.length})`, await strip.isVisible() && names.length === 14 && /^From the image/.test(names[13])
        && ["Standing", "Walking", "Running", "Jumping", "Sitting", "Squatting", "Crawling", "Lying on the back", "Lying on the side", "One arm raised", "Both arms raised", "Facing away", "T-pose"].every((x) => names.includes(x)));
    check("with no figure selected, flip / duplicate / delete are off", await strip.locator("button:disabled").count() === 5);
    check("the region labels are out of the way while the Pose tool is in use (the hints name the tool's moves)", /Drag a box/.test(await page.evaluate(() => document.querySelector(".rg-tips").textContent)));

    // ---- drag a box: a figure is drawn into it, in the region under it
    await drag([-.40, -.38], [-.10, .38]);
    let P = await poses();
    const b0 = box(P[0]?.pts || [[0, 0]]);
    check(`a dragged box gives a figure of 18 joints, fitted into the box (${b0.map((v) => v.toFixed(2))})`, P.length === 1 && P[0].pts.length === 18
        && b0[0] >= -.41 && b0[2] <= -.09 && b0[1] >= -.39 && b0[3] <= .39 && Math.abs(b0[3] - b0[1] - .76) < .02);
    check("it belongs to the region under it (region 1) and is selected", P[0].region === 1 && await strip.locator("button:disabled").count() === 2);
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
    const jb = strip.locator("button").nth(2);
    check("the hide-joint button names the joint that was grabbed", /left wrist/.test(await jb.getAttribute("title")));
    await jb.click(); await sleep(100);
    check("hide joint: the joint is out of the pose map (off), the button is lit", JSON.stringify((await poses())[0].off) === "[7]" && await jb.evaluate((b) => b.classList.contains("on")));
    await jb.click(); await sleep(100);
    check("again: shown again", !(await poses())[0].off);

    // ---- the whole figure: flip, resize, turn
    await strip.locator("button").nth(1).click(); await sleep(100);
    let F = (await poses())[0];
    check("flip: the picture is mirrored and the sides are renamed with it (still facing us; the raised wrist is now the right one, on our left)",
        F.pts[2][0] < F.pts[5][0] && F.pts[4][1] < F.pts[7][1] - .2 && F.pts[4][0] < F.pts[1][0]);
    await strip.locator("button").nth(1).click(); await sleep(100);
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
    check("a click on empty canvas deselects (the box is gone, the buttons are off)", await strip.locator("button:disabled").count() === 5);

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

    // ---- From the image: the box goes to the server (ComfyUI's pose detector), the answer becomes a figure
    await page.evaluate(() => window.__node.__rgSetTool("pose")); await sleep(80);
    await strip.locator("select").selectOption("__image__"); await sleep(60);
    await drag([-.40, -.38], [-.10, .38]);
    check("From the image without an image under the canvas: a hint, no request, no figure", (await poses()).length === 2
        && await page.evaluate(() => window.__fetches.filter(([u]) => u.includes("pose_detect")).length) === 0 && /needs an image/.test(await page.evaluate(() => document.querySelector(".rg-status")?.textContent || document.querySelector(".rg-head").textContent)));
    await page.evaluate(async () => {
        const c = document.createElement("canvas"); c.width = 256; c.height = 256; const x = c.getContext("2d"); x.fillStyle = "#335"; x.fillRect(0, 0, 256, 256);
        const img = new Image(); img.src = c.toDataURL(); await img.decode();
        window.__node.inputs = [{ name: "image", link: 7 }]; window.__node.__rgSetBackdrop(img, { filename: "photo.png", subfolder: "", type: "input" });
        // the detector's answer: a person in the box's middle, as fractions of the image; the left wrist and ankle unsure
        window.__apiHandlers["/region_genie/pose_detect"] = async (b) => { window.__poseBody = b; const [x0, y0, x1, y1] = b.box;
            const base = [[.5, .1], [.5, .2], [.39, .21], [.36, .37], [.35, .52], [.61, .21], [.64, .37], [.65, .52], [.43, .52], [.425, .74], [.42, .96], [.57, .52], [.575, .74], [.58, .96], [.475, .08], [.525, .08], [.445, .095], [.555, .095]];
            return [200, { people: [{ pts: base.map(([x, y]) => [x0 + x * (x1 - x0), y0 + y * (y1 - y0)]), scores: base.map((_, k) => (k === 7 || k === 13 ? 0.1 : 0.9)) }] }]; };
    });
    await sleep(150);
    await drag([-.40, -.38], [-.10, .38]); await sleep(300);
    P = await poses();
    const body = await page.evaluate(() => window.__poseBody);
    const [dW, dH] = await page.evaluate(() => window.__node.__rgDims());
    check(`From the image: the box is sent as fractions of the image, with the image (${(body?.box || []).map((v) => v.toFixed(2))})`, !!body && body.image?.filename === "photo.png"
        && body.box.every((v) => v > 0 && v < 1) && body.box[0] < body.box[2] && body.box[1] < body.box[3]);
    const nf = P[P.length - 1];
    check("the answer is a figure in that box, in the region under it; the joints the detector wasn't sure of are hidden", P.length === 3 && nf.region === 1 && JSON.stringify(nf.off) === "[7,13]"
        && nf.pts[1][0] > -.40 && nf.pts[1][0] < -.10 && nf.pts[0][1] < nf.pts[10][1] && Math.abs(nf.pts[1][0] - (-.25)) < .03);
    await page.evaluate(() => { window.__apiHandlers["/region_genie/pose_detect"] = async () => [404, { error: "Pose from the image needs the SDPose model: put sdpose_wholebody_fp16.safetensors in ComfyUI/models/checkpoints (https://huggingface.co/x), press R to refresh, then try again", code: "no_model" }]; });
    await drag([.10, -.38], [.40, .38]); await sleep(300);
    check("without the model: the message bar says where to get it; no figure", (await poses()).length === 3 && /SDPose model/.test(await page.evaluate(() => document.querySelector(".rg-msg")?.textContent || "")));
    await page.keyboard.press("Control+z"); await sleep(150);
    check("Undo takes the read figure back", (await poses()).length === 2);
    await page.evaluate(() => { window.__node.__rgSetTool("select"); document.querySelector(".rg-msg button, .rg-msg .x")?.click(); }); await sleep(80);

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
    const afterGone = (await st()).poses || [];
    check("a figure whose region is gone belongs to no region (it isn't lost)", afterGone.length === 2 && afterGone.some((p) => p.region === null) && afterGone.some((p) => p.region === 2));

    // ---- round 64: a figure belongs to the region under its middle, or to none
    await page.evaluate(() => window.__node.__rgSetTool("pose")); await sleep(80);
    await strip.locator("select").selectOption("standing"); await sleep(60);
    const nBefore = (await st()).regions.length;
    await drag([-.48, -.45], [-.36, -.05]);                                   // over no region (region 1 is gone)
    P = await poses();
    const free = P[P.length - 1];
    check("a figure drawn over no region belongs to none, and no region is made for it", free.region === null && (await st()).regions.length === nBefore);
    check("it is listed under Whole image", await page.evaluate(() => { const rows = [...document.querySelectorAll(".rg-list .rg-row")]; const i = rows.findIndex((r) => r.classList.contains("pose") && r.classList.contains("sel")); const j = rows.findIndex((r) => r.classList.contains("region")); return i >= 0 && (j < 0 || i < j); }));
    const fm = [(free.pts[1][0] + free.pts[8][0] + free.pts[11][0]) / 3, (free.pts[1][1] + free.pts[8][1] + free.pts[11][1]) / 3];
    await drag(fm, [.25, 0]);                                                 // onto region 2's rectangle
    check("dragged so its middle is over a region: it belongs to that region", (await poses()).find((p) => p.id === free.id).region === 2);
    const fm2 = (await poses()).find((p) => p.id === free.id).pts; const m2 = [(fm2[1][0] + fm2[8][0] + fm2[11][0]) / 3, (fm2[1][1] + fm2[8][1] + fm2[11][1]) / 3];
    await drag(m2, [-.42, -.2]);
    check("dragged off every region: it belongs to none again", (await poses()).find((p) => p.id === free.id).region === null);
    // the region is moved under the figure instead: that counts too (looked up whenever the editor saves)
    await page.evaluate(() => { const n = window.__node, s = n.__rgState(); s.layers.find((l) => l.region === 2).ox = -.42; s.layers.find((l) => l.region === 2).oy = -.2; n.__rgRefresh(); }); await sleep(200);
    check("the region moved under the figure: the figure belongs to it", (await poses()).find((p) => p.id === free.id).region === 2);
    await page.evaluate(() => { const n = window.__node, s = n.__rgState(); s.layers.find((l) => l.region === 2).ox = .25; s.layers.find((l) => l.region === 2).oy = 0; n.__rgRefresh(); }); await sleep(200);

    // ---- round 64: the pose_keypoint input's figures onto the canvas (the strip's import button)
    const takeBtn = strip.locator("button").nth(0);
    check("the import button is off until the pose_keypoint input is connected, and says how", await takeBtn.isDisabled() && /sockets list/.test(await takeBtn.getAttribute("title")));
    const base18 = [[.5, .1], [.5, .2], [.39, .21], [.36, .37], [.35, .52], [.61, .21], [.64, .37], [.65, .52], [.43, .52], [.425, .74], [.42, .96], [.57, .52], [.575, .74], [.58, .96], [.475, .08], [.525, .08], [.445, .095], [.555, .095]];
    await page.evaluate(async (base18) => {
        const { api } = await import("/scripts/api.js"); const { app } = await import("/scripts/app.js");
        const n = window.__node; n.inputs = [...(n.inputs || []), { name: "pose_keypoint", link: 9 }];
        const L = {}; api.addEventListener = (t, f) => { (L[t] = L[t] || []).push(f); }; api.removeEventListener = (t, f) => { L[t] = (L[t] || []).filter((x) => x !== f); };
        // the people the input gives: two, side by side (as fractions of the image); the tests change them through window.__people
        const person = (dx, w = .2) => ({ pts: base18.map(([x, y]) => [dx + x * w, .1 + y * .8]), scores: base18.map(() => .9) });
        window.__person = person; window.__people = [person(.05), person(.7)];
        app.graphToPrompt = async () => ({ workflow: {}, output: { "5": { class_type: "LoadImage", inputs: { image: "a.png" } }, "6": { class_type: "SDPoseKeypointExtractor", inputs: { image: ["5", 0] } },
            "9": { class_type: "KSampler", inputs: { latent: [String(n.id), 3] } }, [String(n.id)]: { class_type: "Region-Genie_Main", inputs: { pose_keypoint: ["6", 0] } } } });
        api.queuePrompt = async (num, p) => { window.__queued = p; const fid = Object.keys(p.output).find((k) => p.output[k].class_type === "PreviewAny");
            setTimeout(() => { for (const f of [...(L.executed || [])]) f({ detail: { node: fid, output: { text: ["KEYPOINTS-AS-TEXT"] } } }); }, 30); return { prompt_id: "p1" }; };
        window.__apiHandlers["/region_genie/pose_people"] = async (b) => { window.__peopleBody = b; return [200, { people: window.__people }]; };
    }, base18);
    await sleep(700);
    check("with the input connected the button is on; its tooltip says what it does", !(await takeBtn.isDisabled()) && /Only the nodes that make the keypoints run/.test(await takeBtn.getAttribute("title")));
    const count0 = (await poses()).length;
    await takeBtn.click(); await sleep(400);
    const q = await page.evaluate(() => ({ keys: Object.keys(window.__queued.output).map((k) => window.__queued.output[k].class_type).sort(), fetch: Object.values(window.__queued.output).find((x) => x.class_type === "PreviewAny").inputs.source, sent: window.__peopleBody?.text?.[0] }));
    check(`the click queues only the nodes that make the keypoints, and ComfyUI's Preview as Text node after them (${q.keys}); its text goes to the pack's server`, q.keys.join() === "LoadImage,PreviewAny,SDPoseKeypointExtractor" && q.fetch.join() === "6,0" && q.sent === "KEYPOINTS-AS-TEXT");
    P = await poses();
    const got = P.slice(count0);
    check(`both people are placed as figures; the one over region 2 belongs to it, the other to none (${got.map((g) => g.region)})`, got.length === 2 && got[0].region === null && got[1].region === 2 && got.every((g) => g.src && g.src.sig && g.src.own));
    check("the node's data says the input was taken (a run then uses the canvas's figures)", (await st()).poseInputTaken === true);
    await takeBtn.click(); await sleep(400);
    check("again with nothing changed: nothing is added", (await poses()).length === count0 + 2);
    // the user changes one of them: only that one is imported again; by default it is kept and another is added
    const w = got[0].pts[4]; await drag(w, [w[0] - .05, w[1] - .1]);
    await takeBtn.click(); await sleep(400);
    P = await poses();
    check("one figure changed on the canvas: only that one comes in again, next to the changed one (the default)", P.length === count0 + 3 && P.filter((g) => g.src?.i === 0).length === 2 && P.filter((g) => g.src?.i === 1).length === 1);
    await page.keyboard.press("Control+z"); await sleep(150);
    await page.evaluate(() => { window.__settings["RegionGenie.Pose.OnChanged"] = "replace"; });
    await takeBtn.click(); await sleep(400);
    P = await poses();
    const back = P.find((g) => g.id === got[0].id);
    check("with 'Replace it': the changed figure is put back to the input's pose, none added", P.length === count0 + 2 && Math.abs(back.pts[4][0] - got[0].pts[4][0]) < 1e-6 && Math.abs(back.pts[4][1] - got[0].pts[4][1]) < 1e-6);
    // the input changes the second person's pose: by default the earlier figure stays and the new pose is added
    await page.evaluate(() => { window.__people = [window.__people[0], window.__person(.72, .22)]; });
    await takeBtn.click(); await sleep(400);
    P = await poses();
    check("the input changed one figure: it is added, the earlier one stays (the default)", P.length === count0 + 3 && P.filter((g) => g.src?.i === 1).length === 2);
    await page.keyboard.press("Control+z"); await sleep(150);
    await page.evaluate(() => { window.__settings["RegionGenie.Pose.OnInputChanged"] = "replace"; });
    await takeBtn.click(); await sleep(400);
    P = await poses();
    check("with 'Replace it': the earlier figure takes the input's new pose", P.length === count0 + 2 && P.filter((g) => g.src?.i === 1).length === 1 && P.find((g) => g.id === got[1].id).pts[2][0] !== got[1].pts[2][0]);
    await page.keyboard.press("Control+z"); await sleep(150);
    check("Undo takes an import back in one step", (await poses()).find((g) => g.id === got[1].id).pts[2][0] === got[1].pts[2][0]);
    await page.evaluate(() => { delete window.__settings["RegionGenie.Pose.OnChanged"]; delete window.__settings["RegionGenie.Pose.OnInputChanged"]; window.__node.__rgSetTool("select"); });

    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
