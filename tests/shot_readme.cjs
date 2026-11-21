// The README's pictures: docs/images/editor.png (the whole node), editor-numbered.png (its parts numbered), lora.png (a
// region with a LoRA), popup-scene.png and popup-region.png (the pop-up editors), large-editor.png, rows.png (a Control row and an Edit row under Whole image), settings-tab.png, settings-window.png and save-image.png
// (Save Image after a run; it uses input/rg_demo.png when there is one). Needs a running ComfyUI with this pack (legacy mode, English, dark palette):
//   COMFY_DIR=<the ComfyUI folder> node tests/shot_readme.cjs
// Rules for the pictures (the owner's): a LoRA is shown with trigger-word chips, and no model name in red (not found).
// Retake them when the node's look changes.
const path = require("path");
const { chromium } = require("playwright");
// The LoRAs in the pictures: real files (a name that isn't found is shown in red) with trigger words (so the chips
// show). With COMFY_DIR set, empty demo files and their info files are put into its models/loras/rg_demo first.
const DEMO = { "rg_demo/red_dragon.safetensors": ["red dragon", "ember scales"], "rg_demo/oil_painting.safetensors": ["oil painting", "thick brushstrokes"] };
if (process.env.COMFY_DIR) {
  const fs = require("fs"), dir = path.join(process.env.COMFY_DIR, "models", "loras", "rg_demo");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, words] of Object.entries(DEMO)) {
    const f = path.join(process.env.COMFY_DIR, "models", "loras", name);
    if (!fs.existsSync(f)) fs.writeFileSync(f, "");
    fs.writeFileSync(f.replace(/\.safetensors$/, ".civitai.info"), JSON.stringify({ trainedWords: words }));
  }
}
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1500, height: 1650 } });
  await page.goto(process.env.COMFY_URL || "http://127.0.0.1:8188/");
  await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
  await page.evaluate(async () => { const s = window.app.extensionManager.setting; await s.set("Comfy.VueNodes.Enabled", false); await s.set("Comfy.Locale", "en"); try { await s.set("Comfy.ColorPalette", "dark"); await s.set("Comfy.Minimap.Visible", false); } catch (e) {} });
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const app = window.app, LG = window.LiteGraph; app.graph.clear();
    const rg = LG.createNode("Region-Genie_Main"); rg.pos = [90, 110]; app.graph.add(rg);
    app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true); window.__rg = rg;
    await new Promise((r) => setTimeout(r, 1800));
  });
  const cv = async () => await page.evaluate(() => { const r = document.querySelector(".rg-cv canvas").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  const [x, y, w, h] = await cv();
  const draw = async (a, b, c, d) => { await page.mouse.move(x + w * a, y + h * b); await page.mouse.down(); await page.mouse.move(x + w * c, y + h * d, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(300); };
  const add = page.locator('[title^="Add a region with a new color"]');
  const P = ["a windswept cliff at sunset, dramatic clouds, warm light on the rocks, the sea far below", "a knight in silver armor holding a sword, weathered face, red cape", "a red dragon breathing fire, wings spread wide, scales glinting in the low sun", "a wooden signpost, hand-painted"];
  const B = [[0.16, 0.2, 0.84, 0.86], [0.22, 0.44, 0.42, 0.84], [0.47, 0.34, 0.82, 0.66], [0.52, 0.7, 0.78, 0.83]];
  for (let i = 0; i < B.length; i++) {
    await add.click(); await page.waitForTimeout(150); await draw(...B[i]);
    const ta = page.locator(".rg-list textarea.rg-prompt").first(); await ta.click(); await page.keyboard.type(P[i]); await page.keyboard.press("Enter"); await page.waitForTimeout(80);
  }
  const sc = page.locator("textarea.rg-scene-ta").first(); await sc.click(); await page.keyboard.type("a fantasy battle on a cliff at sunset, dramatic lighting");
  await page.mouse.move(x + w * 0.5, y + h * 0.03); await page.mouse.click(x + w * 0.5, y + h * 0.03); await page.keyboard.press("v");
  await page.locator('[title^="Show or hide everything in the list"]').click(); await page.waitForTimeout(150);
  if (await page.locator(".rg-row.opts").count()) { await page.locator('[title^="Show or hide everything in the list"]').click(); await page.waitForTimeout(150); }
  await page.locator(".rg-row.region .rg-chev").nth(1).click(); await page.waitForTimeout(400);
  const clip = await page.evaluate(() => { const n = window.__rg, ds = window.app.canvas.ds, r = window.app.canvas.canvas.getBoundingClientRect(); return { x: r.x + (n.pos[0] + ds.offset[0]) * ds.scale - 8, y: r.y + (n.pos[1] - 34 + ds.offset[1]) * ds.scale, width: n.size[0] * ds.scale + 16, height: (n.size[1] + 42) * ds.scale }; });
  await page.mouse.move(4, 4); await page.waitForTimeout(700);        // the pointer away: no tooltip in the picture
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", "editor.png"), clip });
  // editor-numbered.png: the same picture with its six parts numbered (README quick start, the manual's first page)
  await page.evaluate(() => {
    const at = (sel, n, dy = 0) => { const e = typeof sel === "string" ? document.querySelector(sel) : sel; if (!e) return; const r = e.getBoundingClientRect(), b = document.createElement("div");
      b.className = "rg-shot-num"; b.textContent = n;
      b.style.cssText = `position:fixed;left:${r.left - 34}px;top:${r.top + Math.min(r.height / 2, 60) - 13 + dy}px;width:26px;height:26px;border-radius:50%;background:#f2c94c;color:#111;font:700 15px/26px sans-serif;text-align:center;z-index:99999;box-shadow:0 1px 4px #000a`;
      document.body.appendChild(b); };
    at(".rg-size", 1); at(document.querySelector("textarea.rg-scene-ta") || document.querySelector("textarea"), 2); at(".rg-bar", 3); at(".rg-cv", 4, 200); at(".rg-tree", 5); at(".rg-foot", 6);
  });
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", "editor-numbered.png"), clip: { ...clip, x: clip.x - 34, width: clip.width + 34 } });
  // the same picture is the help page's (js/docs/Region-Genie_Main.md, shown under Node Info)
  require("fs").copyFileSync(path.join(__dirname, "..", "docs", "images", "editor-numbered.png"), path.join(__dirname, "..", "js", "docs", "region-genie-parts.png"));
  await page.evaluate(() => document.querySelectorAll(".rg-shot-num").forEach((e) => e.remove()));
  // lora.png: a region opened, with a LoRA of its own
  // a LoRA that is really there (no red "not found" name in the picture): the first one ComfyUI lists
  await page.evaluate(async () => { try { const r = await (await fetch("/object_info/LoraLoaderModelOnly")).json(); window.__loras = r.LoraLoaderModelOnly.input.required.lora_name[0]; } catch (e) { window.__loras = []; } });
  await page.evaluate(() => { const n = window.__rg, s = n.__rgState(), lo = (window.__loras || []).find((x) => /rg_demo.red_dragon/.test(x)) || (window.__loras || [])[0];
    if (!lo) throw new Error("no LoRA file in ComfyUI: run with COMFY_DIR set");
    s.loraOpts = { ...(s.loraOpts || {}), separation: 0.4, until: 0.1 };          // the defaults, whatever this ComfyUI has in its Settings
    s.regions[1].loras = [{ lora: lo, strength: 0.8, on: true }]; n.__rgRefresh(); });
  await page.waitForTimeout(300);
  await page.locator(".rg-head .rg-btn", { hasText: "LoRAs" }).click(); await page.waitForTimeout(400);
  const loraClip = await page.evaluate(() => { const head = document.querySelector(".rg-head").getBoundingClientRect(), list = document.querySelector(".rg-list").getBoundingClientRect(), rows = [...document.querySelectorAll(".rg-list .rg-row")], lr = [...document.querySelectorAll(".rg-list .rg-row.lora, .rg-list .rg-lora")].pop(), last = (lr || rows[Math.min(rows.length - 1, 6)]).getBoundingClientRect();
    return { x: list.x - 6, y: head.y - 6, width: list.width + 12, height: last.bottom - head.y + 30 }; });
  await page.mouse.move(4, 4); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", "lora.png"), clip: loraClip });
  await page.locator(".rg-head .rg-btn", { hasText: "LoRAs" }).click(); await page.waitForTimeout(200);
  // popup-scene.png, popup-region.png: the pop-up editors of scene_prompt_positive and of a region's prompt
  await page.evaluate(() => { const n = window.__rg, s = n.__rgState(), lo = (window.__loras || []).find((x) => /rg_demo.oil_painting/.test(x)) || (window.__loras || [])[0];
    s.sceneLoras = [{ lora: lo, strength: 0.6, on: true }];
    s.regions[1].palette = ["#b3261e", "#f2a23a", "#3b2a1a"]; s.regions[1].paletteOn = true; n.__rgRefresh(); });
  await page.waitForTimeout(300);
  const popShot = async (name) => {
    await page.waitForTimeout(500); await page.mouse.move(4, 4); await page.waitForTimeout(600);
    const c = await page.evaluate(() => { const r = document.querySelector(".rg-pop").getBoundingClientRect(); return { x: r.x - 2, y: r.y - 2, width: r.width + 4, height: r.height + 4 }; });
    await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", name), clip: c });
  };
  await page.locator(".rg-expand").first().click(); await popShot("popup-scene.png");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.locator(".rg-row.region").nth(1).locator(".rg-expand").first().click(); await popShot("popup-region.png");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  // large-editor.png: the same editor in a window that fills the page
  await page.setViewportSize({ width: 1760, height: 960 });
  await page.locator('[title^="Large editor"]').first().click(); await page.waitForTimeout(900);
  await page.mouse.move(4, 4); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", "large-editor.png") });
  await page.keyboard.press("Alt+Enter"); await page.waitForTimeout(600);
  if (await page.locator(".rg-big").count()) { await page.locator('[title^="Large editor"]').first().click(); await page.waitForTimeout(600); }
  await page.setViewportSize({ width: 1500, height: 1650 }); await page.waitForTimeout(400);
  // rows.png: Edit Mode, with a Control row
  await page.locator('[title^="Edit: Change the image"]').click(); await page.waitForTimeout(300);
  await page.locator('[title^="Add a Control row"]').first().click(); await page.waitForTimeout(400); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  const rows = await page.evaluate(() => { const head = document.querySelector(".rg-head").getBoundingClientRect(), list = document.querySelector(".rg-list").getBoundingClientRect(), last = [...document.querySelectorAll(".rg-row.ctrl")].pop().getBoundingClientRect(); return { x: list.x - 6, y: head.y - 6, width: list.width + 12, height: last.bottom - head.y + 46 }; });
  await page.mouse.move(4, 4); await page.waitForTimeout(4000);       // the pointer away: no tooltip in the picture; the header's message gone
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", "rows.png"), clip: rows });
  // save-image.png: Save Image (Region Genie) after a run, with the picture and its file size
  await page.evaluate(async () => {
    const app = window.app, LG = window.LiteGraph; app.graph.clear();
    const li = LG.createNode("LoadImage"); li.pos = [60, 120]; app.graph.add(li);
    const w = li.widgets.find((x) => x.name === "image"); if (w.options.values.includes("rg_demo.png")) w.value = "rg_demo.png";
    const sv = LG.createNode("Region-Genie_SaveImage"); sv.pos = [420, 120]; app.graph.add(sv); li.connect(0, sv, sv.inputs.findIndex((i) => i.name === "images"));
    const f = sv.widgets.find((x) => x.name === "format"); if (f) { f.value = "webp"; f.callback?.("webp"); }
    app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true); window.__sv = sv;
    await new Promise((r) => setTimeout(r, 800)); await app.queuePrompt(0, 1);
  });
  await page.waitForFunction(() => /MB|KB|kB/.test(document.querySelector(".rg-save-status, .rg-saved, [class*='rg-save']")?.textContent || ""), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const svClip = await page.evaluate(() => { const n = window.__sv, ds = window.app.canvas.ds, r = window.app.canvas.canvas.getBoundingClientRect(); return { x: r.x + (n.pos[0] + ds.offset[0]) * ds.scale - 8, y: r.y + (n.pos[1] - 34 + ds.offset[1]) * ds.scale, width: n.size[0] * ds.scale + 16, height: (n.size[1] + 42) * ds.scale }; });
  await page.mouse.move(4, 4); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", "save-image.png"), clip: svClip });
  // settings-tab.png, settings-window.png: Settings > Region Genie, and the Region Genie settings window on a page
  await page.setViewportSize({ width: 1280, height: 860 }); await page.waitForTimeout(400);
  await page.keyboard.press("Control+,"); await page.waitForTimeout(1500);
  await page.evaluate(() => { const el = [...document.querySelectorAll('[role="dialog"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Region Genie"); el?.scrollIntoView(); el?.click(); });
  await page.waitForTimeout(1800); await page.mouse.move(5, 5);
  const dlg = await page.evaluate(() => { const r = document.querySelector('[role="dialog"]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", "settings-tab.png"), clip: dlg });
  await page.locator('[role="dialog"] .rg-page-row[data-page="tools"] button').click(); await page.waitForTimeout(900); await page.mouse.move(5, 5); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", "settings-window.png"), clip: dlg });
  await browser.close();
})();
