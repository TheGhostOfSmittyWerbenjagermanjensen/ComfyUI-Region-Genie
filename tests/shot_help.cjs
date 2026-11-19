// The numbered picture for the node's help page: js/docs/region-genie-parts.png
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1.5, viewport: { width: 1100, height: 1500 } });
  await page.goto("http://127.0.0.1:8188/");
  await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
  await page.evaluate(async () => { const s = window.app.extensionManager.setting; await s.set("Comfy.VueNodes.Enabled", false); await s.set("Comfy.Locale", "en"); try { await s.set("Comfy.Minimap.Visible", false); } catch (e) {} });
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const app = window.app, LG = window.LiteGraph; app.graph.clear();
    const rg = LG.createNode("Region-Genie_Main"); rg.pos = [150, -70]; app.graph.add(rg); rg.size = [700, 1060];
    app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true); window.__rg = rg;
    await new Promise((r) => setTimeout(r, 1800));
  });
  const cv = async () => await page.evaluate(() => { const r = document.querySelector(".rg-cv canvas").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  const [x, y, w, h] = await cv();
  const draw = async (a, b, c, d) => { await page.mouse.move(x + w * a, y + h * b); await page.mouse.down(); await page.mouse.move(x + w * c, y + h * d, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(300); };
  await page.mouse.move(x + w / 2, y + h / 2); await page.keyboard.press("r");
  await draw(0.56, 0.3, 0.76, 0.86);
  await page.locator('[title^="Add a region with a new color"]').click(); await draw(0.26, 0.42, 0.5, 0.86);
  const tas = page.locator(".rg-list textarea.rg-prompt");
  await tas.nth(0).click(); await page.keyboard.type("a knight in silver armor"); await page.keyboard.press("Enter");
  await tas.nth(1).click(); await page.keyboard.type("a red dragon breathing fire"); await page.keyboard.press("Enter");
  const st = page.locator("textarea.rg-scene-ta").first(); await st.click(); await page.keyboard.type("a fantasy battle on a cliff at sunset, dramatic lighting");
  await page.mouse.move(x + w / 2, y + h * 0.15); await page.mouse.click(x + w * 0.5, y + h * 0.12); await page.keyboard.press("r");
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => {
    const q = (s) => document.querySelector(s)?.getBoundingClientRect();
    const size = q(".rg-size"), sc = document.querySelectorAll("textarea.rg-scene-ta")[0].getBoundingClientRect(), bar = q(".rg-bar"), cvb = q(".rg-cv"), list = q(".rg-list"), foot = q(".rg-foot"), wrap = q(".rg-wrap");
    const marks = [[size, 1], [sc, 2], [bar, 3], [cvb, 4], [list, 5], [foot, 6]];
    for (const [r, n] of marks) {
      const d = document.createElement("div"); d.textContent = n;
      d.style.cssText = `position:fixed;left:${wrap.left - 34}px;top:${r.top + Math.min(r.height / 2, 60) - 11}px;width:22px;height:22px;border-radius:50%;background:#f5b324;color:#111;font:700 13px/22px sans-serif;text-align:center;z-index:99999;box-shadow:0 0 0 2px #111;`;
      document.body.appendChild(d);
    }
    return { x: wrap.left - 46, y: size.top - 10, width: wrap.width + 58, height: foot.bottom - size.top + 20 };
  });
  await page.screenshot({ path: process.argv[2], clip });
  await browser.close();
})();
