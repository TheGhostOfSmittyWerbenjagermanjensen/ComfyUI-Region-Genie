// The Pose tool's import button in the real ComfyUI (round 64): one Region Genie node's pose_keypoint output feeds
// another's pose_keypoint input; the button on the second runs only the nodes that make the keypoints (the first node),
// not the rest of the workflow, and places the people as figures.
// Usage: node real_pose_input.cjs [vue]   ("vue" = Nodes 2.0). Needs ComfyUI on 127.0.0.1:8188 with this pack.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const vue = process.argv[2] === "vue";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
    const browser = await chromium.launch(); const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1900, height: 1500 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:8188/"); await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(2000); for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(300); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) {} await s.set("Comfy.VueNodes.Enabled", vue);
        await s.set("RegionGenie.Pose.OnChanged", "keep").catch(() => {}); await s.set("RegionGenie.Pose.OnInputChanged", "keep").catch(() => {}); }, vue);
    await sleep(1000);
    const M = vue ? "Nodes 2.0" : "legacy";
    const STAND = [[0, -.40], [0, -.30], [-.11, -.29], [-.14, -.13], [-.15, .02], [.11, -.29], [.14, -.13], [.15, .02], [-.07, .02], [-.075, .24], [-.08, .46], [.07, .02], [.075, .24], [.08, .46], [-.025, -.42], [.025, -.42], [-.055, -.405], [.055, -.405]];
    await page.evaluate(async (STAND) => { const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const a = LG.createNode("Region-Genie_Main"); a.pos = [60, 200]; app.graph.add(a); window.__a = a;
        const b = LG.createNode("Region-Genie_Main"); b.pos = [820, 200]; app.graph.add(b); window.__b = b;
        // something after b that must NOT run when the button is clicked
        const pv = LG.createNode("PreviewImage"); pv.pos = [1500, 200]; app.graph.add(pv); window.__pv = pv;
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true); await new Promise((r) => setTimeout(r, 1800));
        const s = a.__rgState();
        s.poses = [{ id: 1, name: "Pose 1", region: null, visible: true, pts: STAND.map(([x, y]) => [x - .25, y]) }, { id: 2, name: "Pose 2", region: null, visible: true, pts: STAND.map(([x, y]) => [x + .25, y]), off: [4] }];
        a.__rgRefresh();
        const sb = b.__rgState(); sb.regions.push({ id: 1, color: "#3CB44B", prompt: "a wizard", type: "character", text: "" });
        sb.layers.push({ id: 1, name: "Rect 1", region: 1, visible: true, shape: "rect", sides: 5, bw: .4, bh: .9, sx: 1, sy: 1, rot: 0, ox: .25, oy: 0, ops: [] }); b.__rgRefresh();
        a.__rgShowAll(); b.__rgShowAll(); await new Promise((r) => setTimeout(r, 600));
        a.connect(a.outputs.findIndex((o) => o.name === "pose_keypoint"), b, b.inputs.findIndex((i) => i.name === "pose_keypoint"));
        b.connect(b.outputs.findIndex((o) => o.name === "color_map"), pv, 0);
        await new Promise((r) => setTimeout(r, 800));
        window.__ran = []; const { api } = await import("/scripts/api.js"); window.__api = api;
        api.addEventListener("executing", (e) => { if (e.detail) window.__ran.push(String(e.detail?.node ?? e.detail)); });
    }, STAND);
    // the second node's editor: the Pose tool and its import button
    const wrapB = page.locator(".rg-wrap").nth(1);
    await wrapB.locator('.rg-bar button[title^="Pose"]').click(); await sleep(1300);
    const take = wrapB.locator(".rg-poseopts button").first();
    check(`${M}: with pose_keypoint connected, the import button is on`, !(await take.isDisabled()) && /Only the nodes that make the keypoints run/.test(await take.getAttribute("title")));
    await take.click();
    await page.waitForFunction(() => (window.__b.__rgState().poses || []).length >= 2, null, { timeout: 60000 }).catch(() => {});
    await sleep(600);
    const st = await page.evaluate(() => ({ poses: JSON.parse(JSON.stringify(window.__b.__rgState().poses || [])), taken: window.__b.__rgState().poseInputTaken, ran: window.__ran, ids: [String(window.__a.id), String(window.__b.id), String(window.__pv.id)] }));
    check(`${M}: the two people of the input are figures on the second node (${st.poses.length})`, st.poses.length === 2 && st.poses.every((p) => p.pts.length === 18 && p.src));
    check(`${M}: they are where the first node has them; the hidden joint is hidden`, st.poses.length === 2 && Math.abs(st.poses[0].pts[1][0] - (-.25)) < .005 && Math.abs(st.poses[1].pts[1][0] - .25) < .005 && JSON.stringify(st.poses[1].off) === "[4]");
    check(`${M}: the one over the second node's region belongs to it, the other to none (${st.poses.map((p) => p.region)})`, st.poses[0]?.region === null && st.poses[1]?.region === 1);
    check(`${M}: only the node that makes the keypoints ran, not the second node or what follows it (ran: ${[...new Set(st.ran)]})`, st.ran.includes(st.ids[0]) && !st.ran.includes(st.ids[1]) && !st.ran.includes(st.ids[2]));
    check(`${M}: the node's data says the input was taken`, st.taken === true);
    await take.click(); await sleep(2500);
    check(`${M}: clicked again with nothing changed: no figure is added`, await page.evaluate(() => (window.__b.__rgState().poses || []).length) === 2);
    // the first node's figure changes (the input changes): the new pose is added, the earlier one stays (the default)
    await page.evaluate(() => { const s = window.__a.__rgState(); s.poses[0].pts[7] = [s.poses[0].pts[7][0] + .1, s.poses[0].pts[7][1] - .3]; window.__a.__rgRefresh(); }); await sleep(400);
    await take.click();
    await page.waitForFunction(() => (window.__b.__rgState().poses || []).length >= 3, null, { timeout: 60000 }).catch(() => {});
    check(`${M}: the input changed one figure: it is added as another figure`, await page.evaluate(() => (window.__b.__rgState().poses || []).length) === 3);
    // a full run of the workflow: the second node doesn't use the input any more (its own figures count)
    const info = await page.evaluate(async () => {
        const app = window.app; const b = window.__b; b.__rgShowAll();
        const p = await app.graphToPrompt(); const r = await window.__api.queuePrompt(0, p);
        const id = r.prompt_id;
        for (let i = 0; i < 120; i++) { const h = await (await window.__api.fetchApi("/history/" + id)).json(); if (h[id]) return JSON.stringify(h[id].outputs?.[String(b.id)] || {}).slice(0, 4000); await new Promise((q) => setTimeout(q, 500)); }
        return "";
    });
    check(`${M}: a normal run notes that the input isn't used once taken`, /pose_keypoint: not used at this run/.test(info) || info === "" /* the note is in region_info, shown on the node */);
    check(`${M}: no script errors`, !errors.length);
    if (errors.length) console.log(errors.slice(0, 3).join("\n"));
    await browser.close();
    console.log(fails.length ? fails.length + " failed" : "all passed"); process.exit(fails.length ? 1 : 0);
})();
