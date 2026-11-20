// The node's sockets (round 40), in a real ComfyUI with this pack:
//   node tests/real_sockets.cjs [vue]
// A new node's short socket lists, the sockets list (tick / untick, connected ones stay, the node's bottom edge stays
// put), size_from with an image and with a latent, the size row = the canvas size, control_image with a Control row,
// the prompt ComfyUI is sent (output numbers set right, outputs_shown emptied), a run whose results come from the
// right outputs, save and load, and a workflow saved before round 40.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const vue = process.argv.includes("vue"), M = vue ? "Nodes 2.0" : "legacy";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = ["model", "positive", "negative", "latent", "prompt", "color_map", "masks", "bboxes", "elements", "character_boxes", "region_info", "width", "height"];

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1700, height: 1900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(200); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) { /* older */ }
        await s.set("Comfy.VueNodes.Enabled", vue); await s.set("Comfy.Locale", "en"); try { await s.set("Comfy.Minimap.Visible", false); } catch (e) { /* older */ } }, vue);
    await sleep(1000);
    const fresh = () => page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [520, 260]; app.graph.add(rg);
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true); window.__rg = rg;
        await new Promise((r) => setTimeout(r, 3200));
    });
    const socks = () => page.evaluate(() => window.__rg.__rgSockets());
    const geo = () => page.evaluate(() => { const n = window.__rg, w = document.querySelector(".rg-wrap"), c = document.querySelector(".rg-cv").getBoundingClientRect(), f = document.querySelector(".rg-foot").getBoundingClientRect();
        return { top: Math.round(n.pos[1]), h: Math.round(n.size[1]), bottom: Math.round(n.pos[1] + n.size[1]), wrap: w.offsetHeight, cv: [Math.round(c.width), Math.round(c.height)], footY: Math.round(f.bottom) }; });

    // ---------------- a new node
    await fresh();
    let s = await socks(), g = await geo();
    check(`${M}: a new node shows model, clip, vae, image, size_from (${s.inputs.join(", ")})`, s.inputs.join() === "model,clip,vae,image,size_from");
    check(`${M}: …and the sampler's four outputs (${s.outputs.join(", ")})`, s.outputs.join() === "model,positive,negative,latent");
    check(`${M}: the hidden outputs_shown widget carries them`, s.shown === "model,positive,negative,latent" && await page.evaluate(() => { const w = window.__rg.widgets.find((x) => x.name === "outputs_shown"); return !!w && w.hidden === true; }));
    if (!vue) check(`${M}: its canvas is square (${g.cv.join(" x ")}), the node 700 wide and shorter than before (${g.h})`, Math.abs(g.cv[0] - g.cv[1]) <= 2 && g.h < 1320 && await page.evaluate(() => Math.round(window.__rg.size[0])) === 700);
    check(`${M}: no size label in the tool bar; the size row shows the canvas size`, await page.evaluate(() => !document.querySelector(".rg-bar > .rg-hint") && document.querySelector(".rg-size-out").textContent === window.__rg.__rgDims().join(" × ")));

    // ---------------- the sockets list
    await page.locator(".rg-socks-btn").click(); await sleep(300);
    const list = () => page.evaluate(() => { const b = document.querySelector(".rg-socks"); if (!b) return null; const r = b.getBoundingClientRect();
        return { rows: [...b.querySelectorAll("label")].map((l) => ({ key: l.dataset.sock, on: l.querySelector("input").checked, off: l.querySelector("input").disabled, why: l.querySelector(".rg-socks-why")?.textContent || "" })),
            in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, top: document.elementFromPoint(r.left + 20, r.top + 12)?.closest(".rg-socks") === b }; });
    let l = await list();
    check(`${M}: the sockets button opens a list on top, in the window: 3 input rows and all 13 outputs`, !!l && l.in && l.top && l.rows.length === 16 && l.rows.slice(3).map((r) => r.key).join() === OUT.join());
    check(`${M}: the four shown outputs are ticked, the rest not; control_image waits for a Control row`, l.rows.slice(3).filter((r) => r.on).map((r) => r.key).join() === "model,positive,negative,latent"
        && l.rows.find((r) => r.key === "control").off && /Control row/.test(l.rows.find((r) => r.key === "control").why));
    const tick = async (key) => { await page.locator(`.rg-socks label[data-sock="${key}"] input`).click(); await sleep(900); };
    const g0 = await geo();
    await tick("masks"); await tick("height");
    s = await socks(); let g1 = await geo();
    check(`${M}: tick masks and height: two more outputs, in the order ticked (${s.outputs.join(", ")})`, s.outputs.join() === "model,positive,negative,latent,masks,height" && s.shown === s.outputs.join());
    check(`${M}: the editor kept its height (${g0.wrap} -> ${g1.wrap}) and its place on screen (bottom bar ${g0.footY} -> ${g1.footY}); the node's top moved up (${g0.top} -> ${g1.top})`,
        Math.abs(g1.wrap - g0.wrap) <= 2 && Math.abs(g1.footY - g0.footY) <= 2 && g1.top < g0.top && Math.abs(g1.bottom - g0.bottom) <= 2);
    await tick("size"); await tick("import");
    s = await socks(); const g2 = await geo();
    check(`${M}: tick width / height and import_json: the inputs show, labelled width and height (${s.inputs.join(", ")})`, s.inputs.join() === "model,clip,vae,image,size_from,width_in,height_in,import_json"
        && await page.evaluate(() => window.__rg.inputs.find((i) => i.name === "width_in").label === "width"));
    check(`${M}: …again the bottom edge stays (${g1.bottom} -> ${g2.bottom}), the editor's height too (${g1.wrap} -> ${g2.wrap})`, Math.abs(g2.bottom - g1.bottom) <= 2 && Math.abs(g2.wrap - g1.wrap) <= 2 && g2.top < g1.top);
    await tick("size"); await tick("import"); await tick("masks");
    s = await socks(); const g3 = await geo();
    check(`${M}: untick them: gone again, the node's top comes back down, the bottom edge stays`, s.inputs.join() === "model,clip,vae,image,size_from" && s.outputs.join() === "model,positive,negative,latent,height"
        && g3.top > g2.top && Math.abs(g3.bottom - g2.bottom) <= 2 && Math.abs(g3.wrap - g2.wrap) <= 2);
    // a connected output can't be unticked
    await page.evaluate(async () => { const LG = window.LiteGraph, rg = window.__rg; const pv = LG.createNode("PreviewAny") || LG.createNode("PreviewImage"); pv.pos = [1400, 300]; window.app.graph.add(pv); window.__pv = pv;
        rg.connect(rg.outputs.findIndex((o) => o.name === "height"), pv, 0); await new Promise((r) => setTimeout(r, 400)); });
    await page.keyboard.press("Escape"); await sleep(200);
    check(`${M}: Esc closes the list`, !(await list()));
    await page.locator(".rg-socks-btn").click(); await sleep(300);
    l = await list();
    check(`${M}: a connected output is ticked and can't be unticked ("${l.rows.find((r) => r.key === "height").why}")`, l.rows.find((r) => r.key === "height").off && l.rows.find((r) => r.key === "height").on && l.rows.find((r) => r.key === "height").why === "connected");
    await page.locator(".rg-socks-acts button", { hasText: "All outputs" }).click(); await sleep(1200);
    s = await socks();
    check(`${M}: All outputs: all 13 show (${s.outputs.length})`, s.outputs.length === 13 && OUT.every((n) => s.outputs.includes(n)));
    await page.locator(".rg-socks-acts button", { hasText: "Sampler only" }).click(); await sleep(1200);
    s = await socks();
    check(`${M}: Sampler only: the four, and the connected one (${s.outputs.join(", ")})`, s.outputs.join() === "model,positive,negative,latent,height");
    await page.mouse.click(1500, 1750); await sleep(200);
    check(`${M}: a click outside closes the list`, !(await list()));

    // ---------------- the prompt ComfyUI is sent
    const prompt = () => page.evaluate(async () => { const p = await window.app.graphToPrompt(); const rg = String(window.__rg.id);
        return { shown: p.output[rg].inputs.outputs_shown, links: Object.values(p.output).flatMap((n) => Object.entries(n.inputs || {}).filter(([, v]) => Array.isArray(v) && String(v[0]) === rg).map(([k, v]) => `${n.class_type}.${k}=${v[1]}`)) }; });
    let p = await prompt();
    check(`${M}: in the prompt, the link from 'height' (shown as output 4) carries the Python node's number 12, and outputs_shown is empty (${p.links.join(", ")}; "${p.shown}")`, p.links.length === 1 && /=12$/.test(p.links[0]) && p.shown === "");
    // ---------------- a run: the value that arrives is the height, not what the 5th output of the Python node is
    await page.evaluate(async () => { const rg = window.__rg; const w = rg.widgets.find((x) => x.name === "height"), ww = rg.widgets.find((x) => x.name === "width"); w.value = 768; ww.value = 1280; });
    const ran = await page.evaluate(async () => {
        await fetch("/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
        await window.app.queuePrompt(0, 1);
        for (let i = 0; i < 120; i++) {
            await new Promise((r) => setTimeout(r, 500));
            const e = Object.values(await (await fetch("/history")).json())[0];
            if (e?.status?.completed || e?.status?.status_str === "error") return { status: e.status.status_str, out: JSON.stringify(e.outputs).slice(0, 400), msg: JSON.stringify(e.status.messages || []).slice(0, 600) };
        }
        return { status: "timeout" };
    });
    check(`${M}: the workflow runs, and the preview fed from 'height' shows 768 (${ran.status}; ${ran.out})`, ran.status === "success" && /"text":\["768"\]/.test(ran.out));

    // ---------------- size_from: an image, then a latent; the size row is the canvas size
    await page.evaluate(async () => { const LG = window.LiteGraph, rg = window.__rg, app = window.app;
        const li = LG.createNode("LoadImage"); li.pos = [40, 300]; app.graph.add(li); li.widgets.find((w) => w.name === "image").value = "rg_test.png"; window.__li = li;
        const el = LG.createNode("EmptyLatentImage"); el.pos = [40, 800]; app.graph.add(el); el.widgets.find((w) => w.name === "width").value = 832; el.widgets.find((w) => w.name === "height").value = 1216; window.__el = el;
        li.connect(0, rg, rg.inputs.findIndex((i) => i.name === "size_from")); await new Promise((r) => setTimeout(r, 1500)); });
    const sz = () => page.evaluate(() => ({ dims: window.__rg.__rgDims(), row: document.querySelector(".rg-size-out").textContent, tip: document.querySelector(".rg-size-out").title || document.querySelector(".rg-size-out").dataset.rgTip || "", link: window.__rg.inputs.find((i) => i.name === "size_from").link != null }));
    let z = await sz();
    const imgSize = await page.evaluate(() => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = "/view?filename=rg_test.png&type=input"; }));
    check(`${M}: an image on size_from: the canvas is the image's size, and the size row says so (${z.row}; ${z.tip})`, z.link && z.dims.join() === imgSize.join() && z.row === imgSize.join(" × ") && /size_from \(an image\)/.test(z.tip));
    await page.evaluate(async () => { const rg = window.__rg; window.__el.connect(0, rg, rg.inputs.findIndex((i) => i.name === "size_from")); await new Promise((r) => setTimeout(r, 900)); });
    z = await sz();
    check(`${M}: a latent on the same socket: its size (${z.row}; ${z.tip})`, z.link && z.dims.join() === "832,1216" && z.row === "832 × 1216" && /size_from \(a latent\)/.test(z.tip));
    await page.evaluate(async () => { const rg = window.__rg; rg.disconnectInput(rg.inputs.findIndex((i) => i.name === "size_from")); await new Promise((r) => setTimeout(r, 700)); });
    z = await sz();
    check(`${M}: disconnected: back to the size row's own size (${z.row})`, z.dims.join() === "1280,768" && z.row === "1280 × 768");

    // ---------------- control_image comes with a Control row
    const gc0 = await geo();
    await page.locator('.rg-list .rg-row.scene button', { hasText: "＋Control" }).click(); await sleep(1200);
    await page.keyboard.press("Escape"); await sleep(300);
    s = await socks(); const gc1 = await geo();
    check(`${M}: ＋Control: the control_image input appears (${s.inputs.join(", ")}), the bottom edge stays`, s.inputs.includes("control_image") && Math.abs(gc1.bottom - gc0.bottom) <= 2 && Math.abs(gc1.wrap - gc0.wrap) <= 2);
    await page.locator('.rg-list .rg-row.ctrl:not(.edit) button[title^="Remove this Control row"]').first().click(); await sleep(1200);
    s = await socks();
    check(`${M}: the Control row removed: control_image goes again`, !s.inputs.includes("control_image"));

    // ---------------- save and load
    const round = await page.evaluate(async () => {
        const app = window.app, rg = window.__rg;
        await rg.__rgSetOutputs(["color_map", "masks"], true); await new Promise((r) => setTimeout(r, 900));
        const pv2 = window.LiteGraph.createNode("PreviewImage"); pv2.pos = [1400, 700]; app.graph.add(pv2);
        rg.connect(rg.outputs.findIndex((o) => o.name === "color_map"), pv2, 0);
        // an optional input that is connected must come back connected too
        await rg.__rgSetInput("size", true); await new Promise((r) => setTimeout(r, 900));
        const rs = window.LiteGraph.createNode("ResolutionSelector"); rs.pos = [40, 1300]; app.graph.add(rs);
        rs.connect(0, rg, rg.inputs.findIndex((i) => i.name === "width_in")); await new Promise((r) => setTimeout(r, 300));
        const before = rg.__rgSockets(), id = rg.id;
        const data = JSON.parse(JSON.stringify(app.graph.serialize()));
        const saved = data.nodes.find((x) => String(x.id) === String(id)).outputs.map((o) => o.name);
        await app.loadGraphData(JSON.parse(JSON.stringify(data))); await new Promise((r) => setTimeout(r, 2500));
        const n = app.graph.getNodeById(id); window.__rg = n;
        const p = await app.graphToPrompt();
        return { before, after: n.__rgSockets(), widthLinked: n.inputs.find((i) => i.name === "width_in")?.link != null && Object.keys(p.output[String(id)].inputs).includes("width_in"), links: Object.values(p.output).flatMap((x) => Object.entries(x.inputs || {}).filter(([, v]) => Array.isArray(v) && String(v[0]) === String(id)).map(([k, v]) => `${x.class_type}.${k}=${v[1]}`)).sort(), saved };
    });
    check(`${M}: saved and loaded: the same sockets (${round.after.outputs.join(", ")})`, JSON.stringify(round.before) === JSON.stringify(round.after) && round.saved.join() === round.after.outputs.join());
    check(`${M}: …and its links still carry the right numbers (${round.links.join(", ")})`, round.links.some((x) => /images=5$/.test(x)) && round.links.some((x) => /=12$/.test(x)));
    check(`${M}: …a connected optional input (width) is still there and still connected`, round.widthLinked === true && round.after.inputs.includes("width_in") && round.after.inputs.includes("height_in"));

    // ---------------- a workflow saved before round 40 (every socket, the old size inputs connected)
    const old = await page.evaluate(async (OUT) => {
        const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [520, 260]; app.graph.add(rg);
        await new Promise((r) => setTimeout(r, 1500));
        await rg.__rgShowAll(); await new Promise((r) => setTimeout(r, 600));
        const el = LG.createNode("EmptyLatentImage"); el.pos = [40, 800]; app.graph.add(el); el.widgets.find((w) => w.name === "width").value = 640; el.widgets.find((w) => w.name === "height").value = 960;
        const pv = LG.createNode("PreviewImage"); pv.pos = [1400, 700]; app.graph.add(pv);
        rg.connect(rg.outputs.findIndex((o) => o.name === "color_map"), pv, 0);
        const data = JSON.parse(JSON.stringify(app.graph.serialize()));
        // make it look as it was saved then: no marker, the outputs in the Python node's order, size_from_latent in place of size_from
        const n = data.nodes.find((x) => String(x.id) === String(rg.id)); delete n.properties.rg_sockets;
        const byName = Object.fromEntries(n.outputs.map((o) => [o.name, o]));
        n.outputs = OUT.map((name, i) => ({ ...byName[name], slot_index: i }));
        const cm = OUT.indexOf("color_map");
        for (const L of data.links) if (L[1] === rg.id) L[2] = cm;
        const sf = n.inputs.find((i) => i.name === "size_from"); sf.name = "size_from_latent"; sf.type = "LATENT"; delete sf.label; delete sf.localized_name;
        n.inputs.splice(n.inputs.indexOf(sf), 0, { name: "size_from_image", type: "IMAGE", link: null });
        const lid = Math.max(0, ...data.links.map((L) => (Array.isArray(L) ? L[0] : L.id))) + 1; if (data.last_link_id != null) data.last_link_id = lid; if (data.state?.lastLinkId != null) data.state.lastLinkId = lid;
        sf.link = lid; data.links.push([lid, el.id, 0, rg.id, n.inputs.indexOf(sf), "LATENT"]);
        const eln = data.nodes.find((x) => String(x.id) === String(el.id)); eln.outputs[0].links = [lid];
        const hBefore = n.size[1];
        await app.loadGraphData(data); await new Promise((r) => setTimeout(r, 2500));
        const m = app.graph.getNodeById(rg.id); window.__rg = m;
        const p = await app.graphToPrompt();
        return { s: m.__rgSockets(), dims: m.__rgDims(), sizeLinked: m.inputs.find((i) => i.name === "size_from")?.link != null, h: [Math.round(hBefore), Math.round(m.size[1])],
            links: Object.values(p.output).flatMap((x) => Object.entries(x.inputs || {}).filter(([, v]) => Array.isArray(v) && String(v[0]) === String(m.id)).map(([k, v]) => `${x.class_type}.${k}=${v[1]}`)),
            sizeIn: Object.keys(p.output[String(m.id)].inputs).filter((k) => /^size_from/.test(k)) };
    }, OUT);
    check(`${M}: an older workflow: the latent's link moved to size_from (${old.sizeIn.join(", ")}), the canvas takes its size (${old.dims.join(" x ")})`, old.sizeLinked && old.sizeIn.join() === "size_from" && old.dims.join() === "640,960"
        && !old.s.inputs.includes("size_from_latent") && !old.s.inputs.includes("size_from_image"));
    check(`${M}: …sockets that weren't connected are gone, the connected output stays and still means color_map (${old.s.outputs.join(", ")}; ${old.links.join(", ")})`,
        old.s.outputs.join() === "model,positive,negative,latent,color_map" && old.s.inputs.join() === "model,clip,vae,image,size_from" && old.links.join() === "PreviewImage.images=5");
    check(`${M}: …and the node's box is as it was saved (${old.h.join(" -> ")})`, Math.abs(old.h[0] - old.h[1]) <= 2);

    const errs = errors.filter((e) => !/ResizeObserver/.test(e));
    check(`${M}: no script errors${errs.length ? ` (${errs.slice(0, 2).join(" | ")})` : ""}`, !errs.length);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
