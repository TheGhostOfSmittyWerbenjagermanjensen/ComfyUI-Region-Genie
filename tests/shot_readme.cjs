// The README's pictures of the node: docs/images/editor.png (the whole node) and docs/images/rows.png (a Control row
// and an Edit row under Whole image). Needs a running ComfyUI with this pack (legacy mode, English, dark palette):
//   node tests/shot_readme.cjs
// Retake them when the node's look changes.
const path = require("path");
const { chromium } = require("playwright");
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
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", "editor.png"), clip });
  // rows.png: Edit Mode, with a Control row
  await page.locator('[title^="Edit: Change the image"]').click(); await page.waitForTimeout(300);
  await page.locator('[title^="Add a Control row"]').first().click(); await page.waitForTimeout(400); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  const rows = await page.evaluate(() => { const head = document.querySelector(".rg-head").getBoundingClientRect(), list = document.querySelector(".rg-list").getBoundingClientRect(), last = [...document.querySelectorAll(".rg-row.ctrl")].pop().getBoundingClientRect(); return { x: list.x - 6, y: head.y - 6, width: list.width + 12, height: last.bottom - head.y + 46 }; });
  await page.screenshot({ path: path.join(__dirname, "..", "docs", "images", "rows.png"), clip: rows });
  await browser.close();
})();
