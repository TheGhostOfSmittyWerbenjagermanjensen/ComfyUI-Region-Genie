// Tiled Upscale (Region Genie) in the real ComfyUI (round 84): the "More settings" line.
//   - a new node shows the everyday settings; the six that are set once are folded away, and the node is shorter
//   - a click on the line shows them, another folds them again; the node's height follows
//   - the state and every value survive saving and loading the workflow; a changed folded setting is counted on the line
//   - a folded setting with a cable connected stays shown
//
//   node tests/real_tiled_upscale.cjs [vue] [shots <folder>]
// Needs a running ComfyUI with this pack.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/node-tools/node_modules/playwright"); } })();
const args = process.argv.slice(2), vue = args.includes("vue");
const shots = args.includes("shots") ? args[args.indexOf("shots") + 1] : null;
const M = vue ? "Nodes 2.0" : "legacy";
const fails = [];
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MORE = ["resize_method", "tile_blend", "upscale_model_tile_size", "upscale_model_half_precision", "vae_encode_tile_size", "vae_decode_tile_size"];

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: shots ? 2 : 1, viewport: { width: 1500, height: 1100 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(200); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; try { await s.set("Comfy.TutorialCompleted", true); } catch (e) { /* older */ }
        await s.set("Comfy.VueNodes.Enabled", vue); await s.set("Comfy.Locale", "en"); try { await s.set("Comfy.Minimap.Visible", false); } catch (e) { /* older */ } }, vue);
    await sleep(800);
    await page.evaluate(async () => {
        const app = window.app; app.graph.clear();
        const n = window.LiteGraph.createNode("Region-Genie_TiledUpscale"); n.pos = [120, 60]; app.graph.add(n);
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true); window.__tu = n;
        await new Promise((r) => setTimeout(r, 2000));
    });
    // what the page shows of the node: the folded widgets, the box's height, the line's text
    const look = () => page.evaluate((MORE) => {
        const n = window.app.graph.nodes.find((x) => x.type === "Region-Genie_TiledUpscale");
        const box = document.querySelector(`[data-node-id="${n.id}"]`);
        const btn = document.querySelector(".rg-tu-more button");
        const names = n.widgets.map((w) => w.name);
        return { hidden: MORE.filter((m) => n.widgets.find((w) => w.name === m)?.hidden).length,
                 height: Math.round(box ? box.getBoundingClientRect().height : n.size[1]),
                 text: btn?.innerText.replace(/\s+/g, " ").trim() || "", title: btn?.title || "", shown: !!btn && btn.getBoundingClientRect().width > 0,
                 lineAt: names.indexOf("rg_more"), firstMore: names.indexOf(MORE[0]),
                 vueRows: box ? [...box.querySelectorAll("label, .lg-node-widget")].length : null,
                 open: !!n.properties.rg_more };
    }, MORE);
    const shot = async (name) => { if (!shots) return; const n = await page.evaluate(() => { const n = window.__tu ?? window.app.graph.nodes[0]; const b = document.querySelector(`[data-node-id="${n.id}"]`)?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : { x: n.pos[0], y: n.pos[1] - 34, w: n.size[0], h: n.size[1] + 34 }; });
        await page.screenshot({ path: `${shots}/tu_${vue ? "vue" : "legacy"}_${name}.png`, clip: { x: Math.max(0, n.x - 12), y: Math.max(0, n.y - 12), width: n.w + 24, height: n.h + 24 } }); };
    const click = async () => { await page.click(".rg-tu-more button"); await sleep(700); };

    const a = await look();
    check(`${M}: a new node has the six set-once settings folded away, under a "More settings" line just above them (${JSON.stringify(a)})`,
          a.hidden === 6 && a.shown && a.text === "More settings" && !a.open && a.lineAt === a.firstMore - 1 && a.title.includes("set once"));
    await shot("closed");
    await click();
    const b = await look();
    check(`${M}: a click shows them and the node gets taller (${a.height} -> ${b.height} px, "${b.text}")`, b.hidden === 0 && b.open && b.text === "Fewer settings" && b.height >= a.height + 6 * 18);
    await shot("open");
    await page.evaluate(() => { const w = window.__tu.widgets.find((x) => x.name === "tile_blend"); w.value = 1.5; w.callback?.(1.5); const v = window.__tu.widgets.find((x) => x.name === "vae_decode_tile_size"); v.value = 1024; v.callback?.(1024); });
    await click();
    const c = await look();
    check(`${M}: folded again, the node is as short as before and the line counts the changed settings ("${c.text}", ${c.height} px)`,
          c.hidden === 6 && !c.open && Math.abs(c.height - a.height) <= 2 && c.text === "More settings 2 changed");
    await shot("changed");
    // save and load: the values and the fold
    await click();
    const loaded = async () => { await page.evaluate(async () => { const data = window.app.graph.serialize(); await window.app.loadGraphData(JSON.parse(JSON.stringify(data))); await new Promise((r) => setTimeout(r, 2500)); window.__tu = window.app.graph.nodes.find((x) => x.type === "Region-Genie_TiledUpscale"); }); return look(); };
    const d = await loaded();
    const vals = () => page.evaluate(() => Object.fromEntries(window.__tu.widgets.filter((w) => w.name !== "rg_more").map((w) => [w.name, w.value])));
    const v = await vals();
    check(`${M}: saved open and loaded: open, with every value in its own setting (${JSON.stringify(v)})`,
          d.open && d.hidden === 0 && Math.abs(d.height - b.height) <= 2 && v.tile_blend === 1.5 && v.vae_decode_tile_size === 1024 && v.upscale_by === 2 && v.denoise === 0.2 && v.tile_width === 1024
          && v.resize_method === "lanczos" && v.upscale_model === "none" && v.color_fix === true && v.preview === true && v.upscale_model_tile_size === 512);
    await click();
    const e = await loaded();
    const v2 = await vals();
    check(`${M}: saved folded and loaded: folded, values kept, as short as a new node (${e.text}, ${e.height} px)`, !e.open && e.hidden === 6 && v2.tile_blend === 1.5 && v2.vae_decode_tile_size === 1024 && v2.tile_overlap === 128 && Math.abs(e.height - a.height) <= 2);
    // a folded setting with a cable stays on the node; without the cable it folds again
    // (round 103: a folded setting has no input socket, so the cable is plugged in with the settings open, then they are folded)
    const h0Folded = await page.evaluate(() => window.__tu.computeSize()[1]);
    await click();
    const cable = await page.evaluate(async (h0) => {
        const n = window.__tu, LG = window.LiteGraph;
        const src = LG.createNode("PrimitiveFloat") || LG.createNode("PrimitiveNode");
        if (!src) return { made: false };
        src.pos = [-200, 400]; window.app.graph.add(src);
        const slot = n.inputs.findIndex((i) => (i.widget?.name ?? i.name) === "tile_blend");
        // folded by the pack (ComfyUI itself also calls a widget hidden while a cable feeds it: it draws the input's row instead)
        const hid = () => ["resize_method", "tile_blend", "upscale_model_tile_size"].map((m) => { const w = n.widgets.find((x) => x.name === m);
            return w._visibility ? !!w._visibility.suppression?.byExtension : !!w.hidden; });
        const tall = () => n.computeSize()[1];
        if (slot < 0) return { made: true, slot };
        src.connect(0, n, slot);
        await new Promise((r) => setTimeout(r, 400));
        document.querySelector(".rg-tu-more button").click();
        await new Promise((r) => setTimeout(r, 700));
        // (the socket's number changes when the folded settings' sockets go: looked up by name again)
        const at = () => n.inputs.findIndex((i) => (i.widget?.name ?? i.name) === "tile_blend");
        const on = hid(), linked = n.inputs[at()]?.link != null, h1 = tall();
        n.disconnectInput(at());
        await new Promise((r) => setTimeout(r, 600));
        return { made: true, slot, linked, on, off: hid(), grew: h1 - h0, back: tall() - h0 };
    }, h0Folded);
    check(`${M}: a folded setting with a cable stays shown, the others stay folded; unplugged, it folds again (${JSON.stringify(cable)})`,
          cable.made && cable.linked && JSON.stringify(cable.on) === "[true,false,true]" && JSON.stringify(cable.off) === "[true,true,true]" && cable.grew >= 16 && cable.back === 0);
    // round 103: a hidden field leaves no input socket behind (ComfyUI keeps and connects a hidden widget's socket
    // where the widget last was), and a field that is shown has its socket
    { const sock = await page.evaluate(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const n = window.app.graph._nodes.find((x) => x.type === "Region-Genie_TiledUpscale");
          const look = () => ({ stale: n.inputs.filter((i) => i.widget && n.widgets.find((w) => w.name === i.widget.name)?.hidden).map((i) => i.name),
                                missing: n.widgets.filter((w) => !w.hidden && n.constructor.nodeData?.input && ({ ...n.constructor.nodeData.input.required, ...n.constructor.nodeData.input.optional })[w.name]
                                    && !n.inputs.some((i) => i.widget?.name === w.name)).map((w) => w.name) });
          const res = [look()];
          for (let k = 0; k < 2; k++) { document.querySelector(".rg-tu-more button").click(); await wait(500); res.push(look()); }
          return res; });
      check(`${M}: no input socket is left of a hidden field, and every shown field has its own (${JSON.stringify(sock)})`, sock.length > 0 && sock.every((s) => !s.stale.length && !s.missing.length)); }
    check(`${M}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await browser.close();
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
    process.exit(fails.length ? 1 : 0);
})();
