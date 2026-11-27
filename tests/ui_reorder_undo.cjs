// Round 93: every way of moving a region or a layer in front of / behind the others can be taken back and brought
// back by every Undo / Redo there is, while a region's pop-up is open on each of its tabs.
// Ways to move: a region's grip in the list; "Move down" in the row's right-click menu and in the canvas's; the
// Order buttons of the pop-up's Options tab; a layer's grip on the pop-up's Layers tab; a layer dropped on another
// region's row. Ways to undo: the keys, the buttons above the canvas, the buttons in the pop-up's title bar.
// After each: the order is what it was (Undo) and what the move made it (Redo), and the pop-up is still open on its tab.
const { chromium } = (() => { try { return require("playwright"); } catch (e) { return require("/opt/npm-tools/node_modules/playwright"); } })();
const fails = [];
const check = (name, ok, note) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) { fails.push(name); if (note) console.log("     " + note); } };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1200, height: 1100 } });
    page.on("pageerror", (e) => { fails.push("page error: " + e.message); console.log("PAGE ERROR", e.message); });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__settingsExt.setup());
    // three regions; the first has many layers (some are moved away to another region during the test)
    await page.evaluate(() => {
        const s = window.__node.__rgState();
        const lay = (id, region, i) => ({ id, name: "L" + id, region, visible: true, shape: "rect", sides: 5, bw: 0.18, bh: 0.18, sx: 1, sy: 1, rot: 0, ox: -0.3 + (i % 4) * 0.2, oy: -0.3 + Math.floor(i / 4) * 0.2, ops: [] });
        s.regions = [{ id: 1, color: "#E76F51", prompt: "one", type: "object", text: "" }, { id: 2, color: "#2A9D8F", prompt: "two", type: "object", text: "" }, { id: 3, color: "#E9C46A", prompt: "three", type: "object", text: "" }];
        s.layers = [lay(30, 3, 14), lay(20, 2, 13), ...Array.from({ length: 12 }, (_, i) => lay(101 + i, 1, i))];
        window.__node.__rgRefresh();
        document.querySelector(".rg-list").parentElement.style.height = "420px";
    });
    await page.waitForTimeout(300);
    const order = () => page.evaluate(() => { const s = window.__node.__rgState(); return s.regions.map((r) => r.id).join(",") + " | " + s.layers.map((l) => l.id + ":" + l.region).join(","); });
    const tabNow = () => page.evaluate(() => document.querySelector(".rg-pop .rg-pop-tabs .on")?.textContent?.trim().split(/\s|\(/)[0] || null);
    const dragTo = async (from, toEl, where) => {
        const g = await from.boundingBox(), t = await toEl.boundingBox();
        await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
        const y = where === "top" ? t.y + 2 : where === "bottom" ? t.y + t.height - 2 : t.y + t.height / 2;
        await page.mouse.move(g.x + 8, (g.y + y) / 2, { steps: 4 }); await page.mouse.move(t.x + 14, y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(160);
    };
    const rows = page.locator(".rg-list .rg-row.region");
    const menuPick = async (label) => { await page.locator(".rg-menu .rg-menu-item", { hasText: label }).first().click(); await page.waitForTimeout(160); };
    const MOVES = {
        "a region's grip in the list": { tabs: "all", go: async () => { const n = await rows.count(); await dragTo(rows.nth(n - 1).locator(".rg-grip"), rows.nth(0), "top"); } },
        "'Move down' in the row's right-click menu": { tabs: "all", go: async () => { const b = await rows.nth(0).boundingBox(); await page.mouse.click(b.x + 60, b.y + b.height / 2, { button: "right" }); await page.waitForTimeout(160); await menuPick("Move down"); } },
        "'Move down' in the canvas's right-click menu": { tabs: "all", go: async () => {
            const c = await page.evaluate(() => { const s = window.__node.__rgState(), n = window.__node, L = s.layers.filter((l) => l.region === s.regions[0].id).at(-1), [W, H] = n.__rgDims(), sh = Math.min(W, H);
                return n.__rgToClient(W / 2 + L.ox * sh, H / 2 + L.oy * sh); });
            await page.mouse.click(c[0], c[1], { button: "right" }); await page.waitForTimeout(160); await menuPick("Move down"); } },
        "the Order buttons of the Options tab": { tabs: ["options"], go: async () => { const b = page.locator('.rg-pop [data-pane="options"] [title^="Move down"], .rg-pop [data-pane="options"] [title^="Move up"]'); const n = await b.count();
            for (let i = 0; i < n; i++) if (!(await b.nth(i).isDisabled())) { await b.nth(i).click(); break; } await page.waitForTimeout(160); } },
        "a layer row's up / down button on the Layers tab": { tabs: ["layers"], go: async () => { const b = page.locator('.rg-pop [data-pane="layers"] .rg-row.layer [title^="Move down"]'); const n = await b.count();
            for (let i = 0; i < n; i++) if (!(await b.nth(i).isDisabled())) { await b.nth(i).click(); break; } await page.waitForTimeout(160); } },
        "a layer's grip on the Layers tab": { tabs: ["layers"], go: async () => { const l = page.locator(".rg-pop .rg-pop-layers .rg-row.layer"); const n = await l.count(); await dragTo(l.nth(0).locator(".rg-grip"), l.nth(n - 1), "bottom"); } },
        "a layer dropped on another region's row": { tabs: ["layers"], go: async () => { const l = page.locator(".rg-pop .rg-pop-layers .rg-row.layer");
            await dragTo(l.nth(0).locator(".rg-grip"), page.locator('.rg-list .rg-row.region:not([data-rid="1"])').first(), "middle"); } },
    };
    const popBtn = (ic) => page.locator(`.rg-pop .rg-pop-head .rg-hist[data-ic="${ic}"]`);
    const barBtn = (w) => page.locator(`.rg-bar [title^="${w}"]`);
    const UNDOS = {
        "the keys": [async () => { await page.keyboard.press("Control+z"); }, async () => { await page.keyboard.press("Control+Shift+z"); }],
        "the buttons above the canvas": [async () => { await barBtn("Undo").click({ timeout: 1500 }).catch(() => {}); }, async () => { await barBtn("Redo").click({ timeout: 1500 }).catch(() => {}); }],
        "the pop-up's buttons": [async () => { await popBtn("undo").click({ timeout: 1500 }).catch(() => {}); }, async () => { await popBtn("redo").click({ timeout: 1500 }).catch(() => {}); }],
    };
    let n = 0;
    for (const tab of ["prompt", "loras", "layers", "palette", "options"]) {
        for (const [mName, m] of Object.entries(MOVES)) {
            if (m.tabs !== "all" && !m.tabs.includes(tab)) continue;
            for (const [uName, [undo, redo]] of Object.entries(UNDOS)) {
                await page.evaluate((t) => window.__node.__rgEditTab(1, t), tab); await page.waitForTimeout(220);
                // the pop-up next to the list, clear of the rows and the canvas the test clicks
                await page.evaluate(() => { const b = document.querySelector(".rg-pop"); b.style.left = "640px"; b.style.top = "560px"; });
                const s0 = await order();
                await m.go();
                const s1 = await order();
                const name = `${tab} tab, ${mName}, ${uName}`;
                if (s1 === s0) { check(`${name}: the move changed the order`, false); continue; }
                await undo(); await page.waitForTimeout(170);
                const s2 = await order(), t2 = await tabNow();
                await redo(); await page.waitForTimeout(170);
                const s3 = await order(), t3 = await tabNow();
                const ok = s2 === s0 && s3 === s1 && t2 === t3 && !!t3;
                n++;
                check(`${name}: Undo puts the order back, Redo moves it again, the pop-up stays on its tab`, ok,
                      ok ? "" : `before ${s0}\n     moved  ${s1}\n     undone ${s2} (tab ${t2})\n     redone ${s3} (tab ${t3})`);
            }
        }
    }
    // typing first, then a move: the pop-up's Undo takes back the move (what was done last) and keeps the text
    await page.evaluate(() => window.__node.__rgEditTab(1, "prompt")); await page.waitForTimeout(220);
    await page.evaluate(() => { const b = document.querySelector(".rg-pop"); b.style.left = "640px"; b.style.top = "560px"; });
    const ta = page.locator(".rg-pop textarea").first();
    await ta.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" and more"); await page.waitForTimeout(120);
    const typed = await ta.inputValue();
    const o0 = await order();
    await MOVES["a region's grip in the list"].go();
    const o1 = await order();
    await popBtn("undo").click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(170);
    check("typed, then moved a region: the pop-up's Undo takes back the move and keeps the typed text", o1 !== o0 && await order() === o0 && await page.locator(".rg-pop textarea").first().inputValue() === typed);
    await page.locator(".rg-pop textarea").first().click(); await page.keyboard.type(" x"); await page.waitForTimeout(900); await page.keyboard.type(" y"); await page.waitForTimeout(120);
    await popBtn("undo").click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(150);
    const v2 = await page.locator(".rg-pop textarea").first().inputValue();
    check("typed again: the pop-up's Undo takes back the last typing only (the text's own steps), and no move", v2.startsWith(typed + " x") && !v2.endsWith("y") && await order() === o0, JSON.stringify(v2));
    console.log(`(${n} combinations)`);
    // ---- round 93, small items: "Hide this layer" in the canvas's right-click menu; the Large editor button lights up under the pointer
    await page.evaluate(() => window.__node.__rgCloseEditor()); await page.waitForTimeout(150);
    const top = await page.evaluate(() => { const s = window.__node.__rgState(), n = window.__node, L = s.layers.at(-1), [W, H] = n.__rgDims(), sh = Math.min(W, H);
        return { id: L.id, at: n.__rgToClient(W / 2 + L.ox * sh, H / 2 + L.oy * sh) }; });
    await page.mouse.click(top.at[0], top.at[1], { button: "right" }); await page.waitForTimeout(160);
    check("the canvas's right-click menu on a layer has 'Hide this layer'", await page.locator(".rg-menu .rg-menu-item", { hasText: "Hide this layer" }).count() === 1);
    await menuPick("Hide this layer");
    const vis = (id) => page.evaluate((i) => window.__node.__rgState().layers.find((l) => l.id === i)?.visible, id);
    check("it hides the layer under the pointer", await vis(top.id) === false);
    await barBtn("Undo").click(); await page.waitForTimeout(150);
    check("and Undo shows it again", await vis(top.id) !== false);
    const big = page.locator(".rg-bar .rg-bigbtn");
    const bg0 = await big.evaluate((b) => getComputedStyle(b).backgroundColor);
    await big.hover(); await page.waitForTimeout(120);
    const bg1 = await big.evaluate((b) => getComputedStyle(b).backgroundColor);
    check(`the Large editor button is lit in the highlight color under the pointer (${bg0} > ${bg1})`, bg1 === "rgb(58, 110, 165)" && bg0 !== bg1);
    // ---- round 99: the grid's size in the Snap button's menu; the Large button's place, word and shade; the start card's line
    await page.mouse.move(5, 5); await page.waitForTimeout(150);
    const bar = await page.evaluate(() => { const b = document.querySelector(".rg-bar .rg-bigbtn"), row = b.parentElement, kids = [...row.children], i = kids.indexOf(b);
        const fit = kids.find((k) => k.textContent.trim() === "Fit"), snap = row.querySelector(".rg-btn.grp.toggle"), cs = (e) => getComputedStyle(e);
        return { after: kids.slice(i + 1).map((k) => k.className.replace("rg-btn ", "").split(" ")[0] + (k.classList.contains("danger") ? ":danger" : "")).join(","), beforeGap: kids[i - 1]?.className,
                 text: b.textContent.trim(), nums: row.querySelectorAll("input").length, big: [cs(b).opacity, cs(b).backgroundColor], snap: [cs(snap).opacity, cs(snap).backgroundColor, snap.classList.contains("on")],
                 fit: [cs(fit).opacity, cs(fit).backgroundColor], tip: snap.title, right: Math.round(row.getBoundingClientRect().right - kids.at(-1).getBoundingClientRect().right), rows: new Set(kids.filter((k) => k.tagName === "BUTTON").map((k) => Math.round(k.getBoundingClientRect().top / 12))).size }; });
    check(`the Large editor's button says "Large", sits right of the gap, with a separator and Clear all after it (${bar.after})`, bar.text === "Large" && /rg-bargap/.test(bar.beforeGap) && bar.after === "rg-sep,icon:danger" && bar.right <= 8);
    check(`off, the Large button and the Snap button are as dark as the other buttons (${bar.big.join(" ")} / ${bar.snap.slice(0, 2).join(" ")} / Fit ${bar.fit.join(" ")})`,
          !bar.snap[2] && bar.big.join() === bar.fit.join() && bar.snap.slice(0, 2).join() === bar.fit.join());
    check("the toolbar has no number field any more, and is one row", bar.nums === 0 && bar.rows === 1);
    check(`the Snap button's tooltip says the grid's size (${bar.tip.split("\n").find((l) => /Grid size/.test(l))})`, /Grid size: 64 px\./.test(bar.tip));
    const dd = page.locator(".rg-bar .rg-btn.grp.toggle .rg-grp-dd");
    await dd.click(); await page.waitForTimeout(200);
    const gm = () => page.evaluate(() => { const m = document.querySelector(".rg-menu"); if (!m) return null; return { val: m.querySelector(".rg-gridsize input")?.value, sizes: [...m.querySelectorAll(".rg-gridsizes button")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join(" "),
        heads: [...m.querySelectorAll(".rg-menu-head")].map((h) => h.textContent.trim()).join("|"), scroll: m.scrollWidth - m.clientWidth > 1 || m.scrollHeight - m.clientHeight > 1 }; });
    let g0 = await gm();
    check(`the Snap button's menu starts with the grid's size: a field and five sizes (${g0?.val}; ${g0?.sizes}; ${g0?.heads})`, g0?.val === "64" && g0.sizes === "8 16 32 64* 128" && g0.heads.startsWith("Grid size|Grid") && !g0.scroll);
    await page.locator(".rg-menu .rg-gridsize input").click(); await page.keyboard.type("32"); await page.waitForTimeout(150);
    g0 = await gm();
    check(`typing a size changes the grid at once and keeps the menu open (grid ${await page.evaluate(() => window.__node.__rgGrid())}; ${g0?.sizes})`, await page.evaluate(() => window.__node.__rgGrid()) === 32 && g0?.sizes === "8 16 32* 64 128");
    await page.keyboard.press("Enter"); await page.waitForTimeout(150);
    check("Enter closes the menu and keeps the size", await page.locator(".rg-menu").count() === 0 && await page.evaluate(() => window.__node.__rgGrid()) === 32);
    await dd.click(); await page.waitForTimeout(200);
    await page.locator(".rg-menu .rg-gridsizes button", { hasText: "128" }).click(); await page.waitForTimeout(150);
    check("a click on a size sets it and closes the menu; the tooltip follows", await page.locator(".rg-menu").count() === 0 && await page.evaluate(() => window.__node.__rgGrid()) === 128
          && /Grid size: 128 px\./.test(await page.locator(".rg-bar .rg-btn.grp.toggle").getAttribute("title")));
    check("the start card has a line about the Large editor", /Large button above the canvas/.test(await page.evaluate(() => document.querySelector(".rg-start")?.textContent || "")));
    await browser.close();
    console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASS");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
