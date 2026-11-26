// The editor's CSS.
import { CHIP_CSS, WC_CSS } from "../rg_shared.js";

const STYLE = `
.rg-wrap { display:flex; flex-direction:column; gap:3px; width:100%; height:100%; min-height:460px; box-sizing:border-box;
  font:12px sans-serif; color:var(--input-text,#ddd); pointer-events:auto; outline:none; }
.rg-bar { display:flex; flex-wrap:wrap; align-items:center; gap:3px; }
.rg-btn, .rg-sel, .rg-num { background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555);
  border-radius:4px; padding:2px 6px; font:inherit; }
.rg-btn { cursor:pointer; white-space:nowrap; }
.rg-btn.on { background:var(--rg-accent-fill,#3a6ea5); border-color:var(--rg-accent,#5b8fd0); color:#fff; }
.rg-btn:disabled { opacity:.4; cursor:default; }
.rg-sel { padding:1px 2px; }
.rg-num { width:40px; padding:1px 3px; }
.rg-cv { flex:1 1 auto; min-height:260px; position:relative; overflow:hidden; border-radius:4px; background:#222; }
.rg-cv canvas { position:absolute; left:0; top:0; width:100%; height:100%; touch-action:none; }
.rg-btn.icon { padding:2px 4px; line-height:0; }
.rg-btn.icon svg { width:16px; height:16px; display:block; }
.rg-btn.mixed { display:inline-flex; align-items:center; gap:2px; }
.rg-btn.mixed svg { width:15px; height:15px; display:block; }
.rg-btn.icon.grp { display:inline-flex; align-items:center; padding:2px 0 2px 4px; }
.rg-btn.icon .rg-grp-ic { line-height:0; }
.rg-btn.icon .rg-grp-dd { line-height:0; margin-left:1px; padding:0 1px; opacity:.6; border-radius:2px; }
.rg-btn.icon .rg-grp-dd:hover { opacity:1; background:color-mix(in srgb, currentColor 13%, transparent); }
.rg-btn.icon .rg-grp-dd svg { width:8px; height:16px; }
.rg-toolopts { position:absolute; left:6px; top:6px; z-index:4; display:flex; align-items:center; gap:3px; padding:3px 4px;
  background:rgba(20,20,20,.85); border:1px solid var(--border-color,#555); border-radius:5px; box-shadow:0 2px 8px rgba(0,0,0,.5); }
.rg-toolopts .rg-optlab { line-height:0; opacity:.75; margin-left:2px; }
/* the Pose tool's strip (same place; always open while the tool is in use) and a figure's row in the list */
.rg-poseopts { position:absolute; left:6px; top:6px; z-index:4; display:flex; align-items:center; gap:3px; padding:3px 4px;
  background:rgba(24,24,24,.92); border:1px solid var(--border-color,#555); border-radius:6px; }
.rg-poseopts .rg-optlab { line-height:0; opacity:.75; margin:0 2px; }
.rg-poseopts .rg-optlab svg { width:14px; height:14px; display:block; }
.rg-poseopts .rg-btn { padding:2px 4px; line-height:0; }
.rg-poseopts .rg-btn svg { width:15px; height:15px; display:block; }
.rg-poseopts .rg-btn.on { background:var(--rg-accent-fill,#3a6ea5); border-color:var(--rg-accent,#5b8fd0); color:#fff; }
.rg-poseopts .rg-btn:disabled { opacity:.4; }
.rg-pose-ic { flex:0 0 14px; line-height:0; opacity:.8; cursor:pointer; }
.rg-pose-ic svg { width:14px; height:14px; display:block; }
.rg-toolopts .rg-optlab svg { width:14px; height:14px; display:block; }
.rg-toolopts .rg-num { width:46px; }
/* folded to its first icon (a rounded square) until hovered, typed in, clicked (pinned) or a selection waits for ✓ / ✕ */
.rg-toolopts:not(:hover):not(:focus-within):not(.pinned):not(.busy) > :not(.lead) { display:none !important; }
.rg-toolopts:not(:hover):not(:focus-within):not(.pinned):not(.busy) { padding:4px; }
.rg-toolopts:not(:hover):not(:focus-within):not(.pinned):not(.busy) .rg-optlab.lead { margin:0; opacity:.9; }
.rg-toolopts .rg-optlab.lead { cursor:pointer; }
.rg-toolopts.pinned .rg-optlab.lead { color:#7fb0ea; opacity:1; }
.rg-btn.danger { margin-left:6px; }
.rg-btn.danger:hover { background:#7a2c2c; border-color:#c0504d; color:#fff; }
.rg-btn.rg-separate { gap:3px; padding:1px 5px 1px 4px; font-size:11px; }
.rg-tips { position:absolute; left:48px; right:48px; bottom:6px; width:fit-content; margin:0 auto; z-index:3; box-sizing:border-box;
  display:flex; flex-wrap:wrap; justify-content:center; gap:1px 10px; padding:3px 8px; border-radius:5px; pointer-events:none; user-select:none;
  background:rgba(20,20,20,.72); color:#e8e8e8; font:11px/1.35 sans-serif; transition:opacity .15s; }
.rg-tips b { font-weight:600; color:#fff; }
.rg-tips span { white-space:nowrap; }
.rg-cv.held .rg-tips, .rg-cv.over:not(.flash) .rg-tips { opacity:0; }
.rg-imgmode { position:absolute; right:6px; top:6px; z-index:4; display:flex; align-items:center; gap:3px; padding:3px 4px;
  border-radius:5px; background:rgba(20,20,20,.72); }
.rg-tips-btn { position:absolute; right:6px; bottom:6px; z-index:4; opacity:.45; }
.rg-tips-btn:hover { opacity:1; }
.rg-tips-btn:not(.on) { background:rgba(30,30,30,.8); }
.rg-start { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:2; width:min(360px, calc(100% - 60px)); box-sizing:border-box;
  display:flex; flex-direction:column; gap:8px; pointer-events:none; user-select:none; transition:opacity .15s; }
.rg-start-card { display:flex; flex-direction:column; gap:6px; padding:10px 12px; border-radius:6px; box-sizing:border-box;
  background:rgba(28,28,28,.86); border:1px solid rgba(255,255,255,.14); color:#e8e8e8; font:12px/1.4 sans-serif; }
.rg-start b { font-size:13px; color:#fff; }
.rg-start span { display:flex; gap:7px; align-items:baseline; }
.rg-start i { flex:0 0 auto; font-style:normal; font-weight:700; color:#8fb8e8; }
.rg-start .more { opacity:.7; font-size:11px; }
.rg-cv.over .rg-start { opacity:0; }
.rg-cv.held .rg-start { display:none; }
/* Click areas (round 39): the small controls keep their look; an unseen area around each takes the click too, at least
   24 px tall and out to the middle of the 3 px gap to its neighbour. It lies behind the control's own content, so a
   part with its own click (the arrow of a tool button) still gets it. */
.rg-bar > .rg-btn, .rg-head .rg-btn, .rg-row .rg-btn, .rg-foot .rg-btn, .rg-row .rg-chev, .rg-row .rg-grip, .rg-row .rg-sw, .rg-row .rg-paladd {
  position:relative; isolation:isolate; }
.rg-bar > .rg-btn::before, .rg-head .rg-btn::before, .rg-row .rg-btn::before, .rg-foot .rg-btn::before, .rg-row .rg-chev::before,
.rg-row .rg-grip::before, .rg-row .rg-sw::before, .rg-row .rg-paladd::before {
  content:""; position:absolute; z-index:-1; left:-2.5px; right:-2.5px; top:50%; height:max(100%, 24px); transform:translateY(-50%); }   /* 1 px border + half the gap */
.rg-seg .rg-btn::before { left:0; right:0; }
/* the same in the pop-up editors: the title bar (6 px gaps), the type buttons (4 px), "use the filled text" */
.rg-pop-head .rg-btn, .rg-pop-types .rg-btn, .rg-pop-lbl .rg-btn, .rg-pop .rg-ac-btn { position:relative; isolation:isolate; }
.rg-pop-head .rg-btn::before, .rg-pop-types .rg-btn::before, .rg-pop-lbl .rg-btn::before, .rg-pop .rg-ac-btn::before {
  content:""; position:absolute; z-index:-1; left:-4px; right:-4px; top:50%; height:max(100%, 24px); transform:translateY(-50%); }
.rg-pop-types .rg-btn::before { left:-3px; right:-3px; }
.rg-pop .rg-row .rg-ac-btn::before { left:-2.5px; right:-2.5px; }
.rg-btn.variants { position:relative; }
.rg-btn.variants::after { content:""; position:absolute; right:1px; bottom:1px; width:0; height:0;
  border-style:solid; border-width:0 0 5px 5px; border-color:transparent transparent currentColor transparent; opacity:.7; }
.rg-btn.toggle:not(.on) { opacity:.55; }
.rg-sep { width:1px; align-self:stretch; background:var(--border-color,#555); margin:2px 3px; }
.rg-foot { display:flex; align-items:center; gap:4px; flex:0 0 auto; }
/* one row at any width (round 21): the dropdowns narrow (their text cut short) before anything wraps; system fonts
   that run wider (Windows, high DPR) used to push it onto a second row */
.rg-settings { display:flex; align-items:center; gap:8px; flex:0 1 auto; min-width:0; flex-wrap:nowrap; }
.rg-settings > * { flex:0 0 auto; }
.rg-settings label { display:flex; align-items:center; gap:3px; white-space:nowrap; flex:0 1 auto; min-width:0; }
.rg-settings .rg-sel { max-width:96px; min-width:44px; flex:0 1 auto; text-overflow:ellipsis; }
/* the model dropdown and MOSS-Image's layout / standard button: centred on one line (inline, they sat on the text
   baseline, the dropdown about 3 px lower than the button) */
.rg-settings .rg-modelbox { display:inline-flex; align-items:center; gap:4px; flex:0 1 auto; min-width:0; }
.rg-settings .rg-num { width:64px; }
.rg-llmset svg { width:14px; height:14px; }
.rg-seg { display:inline-flex; align-items:stretch; }
.rg-arrange { position:fixed; z-index:10000; display:flex; flex-direction:column; gap:4px; padding:6px 8px;
  background:var(--comfy-menu-bg,#1a1a1a); color:var(--input-text,#eee); border:1px solid var(--rg-accent,#5b8fd0); border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,.65); font:12px sans-serif; }
.rg-arrange-row { display:flex; align-items:center; gap:3px; }
.rg-arrange-row > .rg-hint:first-child { width:34px; }
.rg-arrange .rg-num { width:48px; }
.rg-find { width:150px; min-width:60px; flex:0 1 150px; padding:1px 5px; font:inherit; font-size:12px; color:var(--input-text,#ddd);
  background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#555); border-radius:4px; }
.rg-seg .rg-btn { border-radius:0; margin:0; }
.rg-seg .rg-btn + .rg-btn { border-left-width:0; }
.rg-seg .rg-btn:first-child { border-radius:4px 0 0 4px; }
.rg-seg .rg-btn:last-child { border-radius:0 4px 4px 0; }
.rg-seg .rg-btn:not(.icon) { padding:1px 7px; }
.rg-settings .rg-fmt .rg-sel { max-width:112px; }
.rg-row .rg-btn.mini { padding:0 2px; min-width:18px; line-height:0; }
.rg-row .rg-btn.mini svg { width:14px; height:14px; display:block; }
.rg-feather { display:flex; align-items:center; gap:2px; flex:0 0 auto; }
.rg-feather .rg-num { width:42px; }
.rg-fico, .rg-palico { display:inline-flex; opacity:.75; flex:0 0 auto; }
.rg-fico svg, .rg-palico svg { width:14px; height:14px; display:block; }
.rg-row.pal { margin-left:24px; gap:4px; padding-top:0; padding-bottom:0; min-height:18px; }
.rg-row.pal.off .rg-sw { opacity:.4; }
.rg-row.pal .rg-sw { width:16px; height:16px; }
.rg-paladd { position:relative; width:16px; height:16px; box-sizing:border-box; border:1px dashed #888; border-radius:3px;
  display:inline-flex; align-items:center; justify-content:center; font:600 13px/1 sans-serif; color:inherit; cursor:pointer; flex:0 0 auto; }
.rg-paladd:hover { border-color:var(--rg-accent,#5b8fd0); }
.rg-paladd { background:transparent; padding:0; }
button.rg-sw.pick { padding:0; cursor:pointer; font:inherit; }
button.rg-sw.pick:hover { outline:1px solid var(--rg-accent,#5b8fd0); }
.rg-row .rg-pwrap.rg-twrap { flex:0 1 72px; }
/* round 88: the handle between a text region's prompt and its text to render: drag it for more room on either side */
.rg-row .rg-tsplit { flex:0 0 7px; align-self:stretch; margin:0 -3px; position:relative; cursor:col-resize; touch-action:none; z-index:4; }
.rg-row .rg-tsplit::after { content:""; position:absolute; top:22%; bottom:22%; left:2px; width:3px; border-radius:2px; background:var(--border-color,#555); opacity:.9; }
.rg-row .rg-tsplit:hover::after, .rg-row .rg-tsplit.drag::after { background:var(--rg-accent,#5b8fd0); opacity:1; top:8%; bottom:8%; }
.rg-row .rg-pwrap.rg-twrap:has(textarea:focus) { flex:1.2 1 140px; }
.rg-pop { position:fixed; z-index:10000; box-sizing:border-box; display:flex; flex-direction:column; gap:5px; padding:6px 8px 5px;
  background:var(--comfy-menu-bg,#1a1a1a); color:var(--input-text,#eee); border:2px solid var(--rg-accent,#5b8fd0); border-radius:6px; box-shadow:0 4px 18px rgba(0,0,0,.65);
  overflow-y:auto; scrollbar-width:thin; font:12px sans-serif; }
.rg-pop-head { display:flex; align-items:center; gap:6px; font-weight:600; cursor:move; user-select:none; touch-action:none; }
.rg-pop-head .rg-btn { cursor:pointer; }
.rg-pop-head .rg-pop-font { padding:0 4px; line-height:16px; font-weight:normal; font-size:11px; }
.rg-pop-head .rg-pop-font ~ .rg-x { margin-left:0; }
.rg-pop.sized .rg-pop-field.grow { flex:1 1 auto; display:flex; flex-direction:column; min-height:60px; }
.rg-pop.sized .rg-pop-field.grow textarea { flex:1 1 auto; min-height:40px; resize:none; }
.rg-pop-grip { position:absolute; right:1px; bottom:1px; width:14px; height:14px; cursor:nwse-resize; touch-action:none; opacity:.7;
  background:linear-gradient(135deg, transparent 52%, var(--rg-accent,#5b8fd0) 52% 60%, transparent 60% 70%, var(--rg-accent,#5b8fd0) 70% 78%, transparent 78%); }
.rg-pop-grip:hover { opacity:1; }
.rg-pop-head .rg-idx { flex:0 0 auto; text-align:left; }
.rg-pop-head .rg-sw { cursor:default; }
.rg-pop-head .rg-x { margin-left:auto; padding:0 5px; line-height:16px; }
.rg-pop-head .rg-nav { padding:0 4px; line-height:16px; font-weight:normal; font-size:11px; }
/* ◀ ▶ A− A+ … ✕ stay at the right end, whatever the title's length (they don't move while stepping) */
.rg-pop-head .rg-nav.prev { margin-left:auto; }
.rg-pop-head .rg-hist { padding:1px 3px; line-height:0; }
.rg-pop-head .rg-hist svg { width:14px; height:14px; display:block; }
.rg-pop .rg-btn:disabled { opacity:.35; cursor:default; }
.rg-pop-gap { flex:1 1 auto; }
/* a region's pop-up: one bottom row, the color palette on the left and every other control on the right (round 43) */
.rg-pop .rg-row.pal.pop-ctl { flex-wrap:wrap; row-gap:3px; min-height:22px; }
.rg-pop .rg-row.pal.pop-ctl .rg-btn.mini.toggle:first-child { margin-right:2px; }
.rg-pop-types { display:flex; gap:4px; }
.rg-pop-types .rg-btn { flex:1 1 0; padding:3px 6px; }
.rg-pop-lbl { font-size:11px; opacity:.75; margin:0 0 2px 1px; }
.rg-pop textarea { width:100%; box-sizing:border-box; resize:none; background:var(--comfy-input-bg,#222); color:inherit;
  border:1px solid var(--border-color,#555); border-radius:4px; padding:3px 5px; font:inherit; line-height:15px; scrollbar-width:thin; }
.rg-pop textarea:focus { border-color:var(--rg-accent,#5b8fd0); outline:none; }
.rg-pop .rg-row { padding:1px 0; }
.rg-pop .rg-row.lora, .rg-pop .rg-row.pal { margin-left:0; }
.rg-pop .rg-trig { margin-left:30px; }
.rg-pop-dyn { display:flex; flex-direction:column; gap:3px; }
/* a pop-up's tabs (round 87): the panes lie on top of each other, so the pop-up is as tall as the tallest and keeps its size */
.rg-pop:focus { outline:none; }
.rg-pop-tabs { display:flex; gap:4px; }
.rg-pop-tabs .rg-btn { flex:1 1 0; padding:3px 6px; display:flex; justify-content:center; align-items:center; gap:5px; }
.rg-pop-tabs .rg-btn em { font-style:normal; opacity:.7; }
.rg-pop-tabs .rg-btn em.lit { color:var(--rg-on-soft,#e9c46a); opacity:1; font-weight:600; }
.rg-pop-tabs .rg-btn.on em.lit { color:var(--rg-on-pale,#ffe2a0); }
.rg-pop-panes { display:grid; flex:1 1 auto; }
.rg-pop-pane { grid-area:1 / 1; display:flex; flex-direction:column; gap:5px; min-width:0; }
.rg-pop-pane.off { visibility:hidden; pointer-events:none; }
.rg-pop-lorarows { position:relative; display:flex; flex-direction:column; }
.rg-pop-lorarows > .rg-hint { padding:4px 2px; }
.rg-pop .rg-row.rg-pop-addl { justify-content:flex-start; }
.rg-lora-drop { position:absolute; left:0; right:0; height:2px; background:var(--rg-accent,#5b8fd0); pointer-events:none; }
.rg-pop .rg-row.lora { font-size:12px; gap:5px; }
.rg-pop .rg-row.lora.dragging { opacity:.45; }
.rg-pop .rg-row.lora.off .rg-pick { opacity:.55; }
.rg-pop .rg-row.lora .rg-grip { opacity:.6; }
input.rg-switch { appearance:none; -webkit-appearance:none; width:26px; height:14px; border-radius:7px; background:#555; position:relative;
  cursor:pointer; flex:0 0 auto; margin:0 2px; border:0; }
input.rg-switch::after { content:""; position:absolute; left:2px; top:2px; width:10px; height:10px; border-radius:50%; background:#aaa; transition:left .1s; }
input.rg-switch:checked { background:var(--rg-on,#d9a441); }
input.rg-switch:checked::after { left:14px; background:var(--rg-on-ink,#1c1c1c); }
/* the other tabs of a region's pop-up (round 88) */
.rg-pop-layers { position:relative; display:flex; flex-direction:column; gap:1px; }
.rg-pop .rg-row.lvl1 { margin-left:0; }
.rg-pop-layers > .rg-hint, .rg-pop-pal > .rg-hint { padding:4px 2px; white-space:normal; }
.rg-pop-pal { display:flex; flex-direction:column; gap:7px; padding-top:2px; }
.rg-pop-palhead { display:flex; align-items:center; gap:7px; cursor:pointer; }
.rg-pop-palname { font-weight:600; white-space:nowrap; }
.rg-pop-palstate { font-weight:600; padding:0 7px; border-radius:8px; border:1px solid var(--border-color,#555); opacity:.75; }
.rg-pop-palhead.on .rg-pop-palstate { background:var(--rg-on,#d9a441); border-color:var(--rg-on,#d9a441); color:var(--rg-on-ink,#1c1c1c); opacity:1; }
.rg-pop-palhead .rg-hint { white-space:normal; }
.rg-pop-lorahead { padding:1px 0 4px; border-bottom:1px solid var(--border-color,#3a3a3a); }
.rg-pop-palrow { display:flex; align-items:center; gap:6px; }
.rg-pop-palrow.off .rg-sw.pal { opacity:.4; }
.rg-pop-palrow .rg-sw.pal.big { width:30px; height:22px; border-radius:4px; border:1px solid rgba(0,0,0,.6); padding:0; cursor:pointer; flex:0 0 auto; }
.rg-pop-palrow .rg-sw.pal.big.sel { outline:2px solid var(--rg-accent,#5b8fd0); outline-offset:1px; }
.rg-pop .rg-btn.rg-pop-paldel:hover { background:#8a2a2a; border-color:#d66; color:#fff; }
.rg-pop-opts { display:grid; grid-template-columns:max-content 1fr; gap:6px 12px; align-items:center; padding:2px 2px 0; }
.rg-pop-optl { font-weight:600; opacity:.85; }
.rg-pop-optc { display:flex; align-items:center; gap:6px; min-width:0; }
.rg-pop-optc .rg-hint { white-space:normal; }
/* the region row's small buttons: its type, its layers, its palette (round 88) */
.rg-row .rg-btn.rg-tybtn { flex:0 0 auto; }
button.rg-cnt { background:transparent; border:1px solid transparent; border-radius:4px; color:inherit; font:inherit; font-size:10px; cursor:pointer; padding:1px 3px; margin:0; opacity:.7; }
button.rg-cnt:hover, button.rg-paldots:hover { opacity:1; border-color:var(--border-color,#555); background:var(--comfy-input-bg,#222); }
button.rg-paldots { flex:0 0 auto; display:inline-flex; gap:2px; align-items:center; background:transparent; border:1px solid transparent; border-radius:4px; padding:3px; margin:0; cursor:pointer; }
button.rg-paldots i { width:8px; height:8px; border-radius:2px; display:block; }
/* LoRAs at a glance in the list (round 87): the one button of a row, the chips on Whole image, the header's switch */
.rg-btn.rg-lbtn.some { background:var(--rg-on,#d9a441); border-color:var(--rg-on,#d9a441); color:var(--rg-on-ink,#1c1c1c); font-weight:600; }
.rg-btn.rg-lbtn.alloff { border-color:var(--rg-on,#d9a441); color:var(--rg-on-soft,#e9c46a); }
.rg-row.has-lora { box-shadow:inset 3px 0 0 var(--rg-on,#d9a441); }
.rg-row.scene.has-chips .rg-pseudo { flex:0 0 auto; }
.rg-lchips { display:flex; flex:1 1 0; min-width:0; overflow:hidden; gap:4px; align-items:center; margin:0 4px 0 8px; }
.rg-lchip { flex:0 0 auto; display:inline-flex; gap:4px; align-items:center; height:18px; margin:0; padding:0 7px; border-radius:9px; border:1px solid var(--rg-on,#d9a441);
  background:transparent; color:var(--rg-on-soft,#e9c46a); font:inherit; font-size:11px; font-weight:normal; cursor:pointer; white-space:nowrap; }
.rg-lchip > span { max-width:130px; overflow:hidden; text-overflow:ellipsis; }       /* a long file name is cut short; the tooltip has all of it */
.rg-lchip b { color:var(--input-text,#fff); font-weight:500; flex:0 0 auto; }
.rg-lchip.more { background:var(--rg-on,#d9a441); color:var(--rg-on-ink,#1c1c1c); font-weight:600; }
.rg-lchip:hover { background:color-mix(in srgb, var(--rg-on,#d9a441) 25%, transparent); }
.rg-lchip.more:hover { background:var(--rg-on-soft,#e9c46a); }
.rg-btn.rg-lall.some { border-color:var(--rg-on,#d9a441); background:var(--rg-on-bg,#4a3c16); color:var(--rg-on-pale,#f3dfae); font-weight:600; }
.rg-btn.rg-lall.back { border-color:var(--rg-on,#d9a441); color:var(--rg-on-soft,#e9c46a); }
.rg-pop-foot { font-size:10px; opacity:.5; }
.rg-bslider { position:absolute; left:8px; top:50%; transform:translateY(-50%); width:30px; height:190px; opacity:.45;
  transition:opacity .12s; z-index:3; touch-action:none; cursor:ns-resize; }
.rg-bslider:hover, .rg-bslider.drag { opacity:1; }
/* region opacity: a button in the top right strip; its slider drops down while pointed at, dragged or clicked open */
.rg-opac { position:relative; display:inline-flex; }
.rg-oslider { position:absolute; left:calc(50% - 13px); top:calc(100% + 6px); width:26px; height:140px; display:none; border-radius:5px;
  background:rgba(20,20,20,.72); z-index:4; touch-action:none; cursor:ns-resize; }
.rg-opac:hover .rg-oslider, .rg-opac.open .rg-oslider, .rg-oslider.drag { display:block; }
.rg-oslider::before { content:""; position:absolute; left:0; right:0; top:-9px; height:9px; }   /* no gap under the button for the pointer to fall into */
.rg-oslider svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.rg-opac.open .rg-btn.icon { background:color-mix(in srgb, var(--rg-accent,#5b8fd0) 35%, transparent); }
.rg-oslider .rg-ohandle { left:50%; width:20px; box-sizing:border-box; transform:translateX(-50%); }   /* centered on the line (.rg-bhandle, below, sets the brush slider's) */
.rg-bslider svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.rg-bhandle { position:absolute; left:1px; width:28px; height:5px; margin-top:-2.5px; background:#f2f2f2; border:1px solid #111;
  border-radius:2px; box-shadow:0 0 3px rgba(0,0,0,.7); pointer-events:none; }
.rg-btip { position:absolute; left:44px; z-index:4; background:rgba(20,20,20,.95); color:#eee; font:11px sans-serif;
  padding:3px 6px; border-radius:4px; border:1px solid #555; white-space:nowrap; pointer-events:none; display:none; }
.rg-split { flex:0 0 7px; margin:-2px 0; position:relative; cursor:row-resize; touch-action:none; z-index:1; }
.rg-split::after { content:""; position:absolute; left:42%; right:42%; top:2px; height:3px; border-radius:2px; background:var(--border-color,#555); opacity:.8; }
.rg-split:hover::after, .rg-split.drag::after { background:var(--rg-accent,#5b8fd0); opacity:1; left:30%; right:30%; }
.rg-tree { flex:0 0 auto; height:220px; display:flex; flex-direction:column; gap:2px; min-height:0; }
.rg-row.lvl1 { margin-left:24px; }
.rg-row.sub { margin-left:31px; gap:4px; padding-top:0; padding-bottom:0; min-height:18px; font-size:11px; cursor:pointer; opacity:.9; }
.rg-row.sub:hover { background:color-mix(in srgb, currentColor 6%, transparent); }
.rg-big { position:fixed; inset:0; z-index:9000; box-sizing:border-box; padding:2vh 2vw; display:flex; background:rgba(0,0,0,.55); }
.rg-big-win { flex:1 1 auto; min-width:0; min-height:0; display:flex; flex-direction:column; background:var(--comfy-menu-bg,#2b2b2b);
  color:var(--input-text,#ddd); border:2px solid var(--rg-accent,#5b8fd0); border-radius:8px; box-shadow:0 10px 40px rgba(0,0,0,.7); overflow:hidden; }
.rg-big-head { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:4px 8px 4px 12px; font:600 13px sans-serif;
  border-bottom:1px solid var(--border-color,#555); }
.rg-big-head .rg-big-title { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rg-big-head .rg-btn { background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px;
  padding:1px 8px; font:12px sans-serif; cursor:pointer; }
.rg-wrap.rg-bigmode { flex:1 1 auto; width:auto !important; height:auto !important; min-height:0; display:grid; gap:4px 10px; padding:6px 8px 8px;
  grid-template-columns:minmax(0,1fr) clamp(380px, 34vw, 560px); grid-template-rows:auto auto minmax(0,1fr) auto; }
.rg-bigmode > .rg-bar { grid-column:1; grid-row:1; }
.rg-bigmode > .rg-banner { grid-column:1; grid-row:2; }
.rg-bigmode > .rg-cv { grid-column:1; grid-row:3; min-height:0; }
.rg-bigmode > .rg-msg { grid-column:1; grid-row:4; }
.rg-bigmode > .rg-split { display:none; }
.rg-big-side { grid-column:2; grid-row:1 / 5; display:flex; flex-direction:column; gap:6px; min-width:0; min-height:0; }
.rg-big-side > .rg-size { flex:0 0 auto; width:auto !important; height:auto !important; }
.rg-big-side > .rg-tree { flex:1 1 auto; height:auto !important; min-height:0; }
.rg-big-scene { flex:0 0 auto; display:flex; flex-direction:column; gap:4px; }
.rg-big-fld { position:relative; display:flex; }       /* a scene box of the large editor and the buttons in its corner */
.rg-big-ta { width:100%; box-sizing:border-box; resize:vertical; min-height:34px; background:var(--comfy-input-bg,#222); color:inherit;
  border:1px solid var(--border-color,#555); border-radius:4px; padding:3px 6px; font:12px/1.35 sans-serif; scrollbar-width:thin; }
.rg-big-ta:focus { border-color:var(--rg-accent,#5b8fd0); outline:none; }
.rg-big-hole { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; height:100%; min-height:40px; box-sizing:border-box;
  font:12px sans-serif; color:var(--input-text,#ddd); opacity:.75; border:1px dashed var(--border-color,#555); border-radius:6px; pointer-events:auto; }
.rg-big-hole.small { min-height:0; border:none; }
.rg-big-hole .rg-btn { background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px;
  padding:1px 8px; font:inherit; cursor:pointer; }
.rg-grip { flex:0 0 auto; width:11px; line-height:0; opacity:.4; cursor:grab; touch-action:none; user-select:none; }
.rg-grip svg { width:11px; height:14px; display:block; }
.rg-grip:hover { opacity:1; }
.rg-grip.pad { visibility:hidden; cursor:default; }
.rg-sorting, .rg-sorting * { cursor:grabbing !important; }
.rg-row.dragging { opacity:.45; }
.rg-row.dropon { outline:2px solid var(--rg-accent,#5b8fd0); outline-offset:-1px; }
.rg-dropline { flex:0 0 auto; height:0; margin:-2px 2px; border-top:2px solid var(--rg-accent,#5b8fd0); border-radius:1px; pointer-events:none; }
.rg-row.opts { margin-left:31px; gap:4px; padding-top:1px; padding-bottom:1px; min-height:22px; font-size:11px; }
.rg-row.opts .rg-word { margin-left:4px; }
.rg-row.opts .rg-word:first-child { margin-left:18px; }
.rg-subname { user-select:none; }
.rg-subbody .rg-row.lvl1, .rg-subbody .rg-row.lora, .rg-subbody .rg-row.pal { margin-left:38px; }
.rg-subbody .rg-row.lvl1.layer { margin-left:35px; }
.rg-subbody .rg-trig { margin-left:60px; }
.rg-row.lora { margin-left:24px; font-size:11px; padding-top:0; padding-bottom:0; }
.rg-row.lora .rg-num { width:calc(3.6ch + 26px); }    /* "0.95" next to the spin arrows, in any font */
.rg-row.region { background:color-mix(in srgb, currentColor 4.5%, transparent); }
.rg-row.scene .rg-pseudo, .rg-row.ctrl .rg-pseudo { font-style:normal; font-weight:600; user-select:none; }
.rg-row.scene, .rg-row.ctrl { cursor:pointer; }
.rg-row.scene:hover, .rg-row.ctrl:hover { background:color-mix(in srgb, currentColor 7%, transparent); }
.rg-editmask { display:inline-flex; align-items:center; gap:2px; margin-right:6px; }
.rg-editmask .rg-num { width:44px; }
.rg-row.editarea .rg-pseudo { font-style:normal; font-weight:600; user-select:none; flex:0 0 auto; margin-right:8px; }
.rg-row.editarea .rg-sel { max-width:none; }
.rg-row.editarea label { display:inline-flex; align-items:center; }
.rg-row.editarea .rg-editmask { margin-left:8px; }
.rg-editmask .rg-num::placeholder { color:inherit; opacity:.45; }
.rg-chev { flex:0 0 14px; text-align:center; cursor:pointer; opacity:.85; user-select:none; font-size:10px; }
.rg-chev.empty { opacity:.25; cursor:default; }
.rg-cnt { flex:0 0 auto; display:inline-flex; align-items:center; gap:1px; font-size:10px; opacity:.55; min-width:10px; }
.rg-cnt svg { width:11px; height:11px; display:block; }
.rg-row .rg-hint.rg-word, .rg-row.lora.edit > .rg-hint.rg-word { color:inherit; font-weight:normal; white-space:nowrap; }
.rg-row .rg-btn.ico { padding:0 3px; min-width:20px; text-align:center; line-height:16px; }
.rg-row .rg-btn.ico.rg-ib { height:18px; }
.rg-row .rg-btn.ico.rg-ib > svg { width:13px; height:13px; }
.rg-paladd > svg { width:10px; height:10px; display:block; margin:auto; }
.rg-warn > svg, .rg-msg-icon > svg { width:14px; height:14px; display:block; }
.rg-btn.rg-notes { display:inline-flex; align-items:center; gap:3px; }
.rg-btn.rg-notes > svg { width:13px; height:13px; display:block; }
.rg-row .rg-btn.txt { padding:0 5px; font-size:11px; }
.rg-pick { flex:1 1 0; width:0; min-width:0; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555); border-radius:4px;
  padding:0 16px 0 5px; font:inherit; cursor:pointer; position:relative; line-height:16px; }
.rg-pick::after { content:"▾"; position:absolute; right:4px; top:50%; transform:translateY(-50%); opacity:.7; }
.rg-pick.missing { color:#e88; }
.rg-row.lora.edit > .rg-hint { color:#8fb8e8; font-weight:600; }     /* edit LoRA added by Edit Mode */
.rg-trig { display:flex; flex-wrap:wrap; gap:3px; margin:0 0 2px 46px; align-items:center; font-size:10px; }
.rg-loraopts { display:flex; align-items:center; gap:3px; font-weight:normal; margin-left:auto; }
.rg-loraopts .rg-num { width:52px; }
.rg-head { display:flex; align-items:center; gap:3px; flex-wrap:wrap; font-weight:600; }
.rg-head .rg-btn { font-weight:normal; padding:1px 5px; }
.rg-head .rg-status { flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rg-head .rg-status:empty { display:none; }
.rg-head .rg-status.wide { flex:1 1 100%; order:9; white-space:normal; }
.rg-list { flex:1 1 auto; overflow-y:auto; display:flex; flex-direction:column; gap:2px; min-height:0;
  border:1px solid var(--border-color,#444); border-radius:4px; padding:2px; }
.rg-row { display:flex; align-items:center; gap:3px; padding:1px 2px; border-radius:4px; border:1px solid transparent; cursor:default; }
.rg-row.sel { border-color:var(--rg-accent,#5b8fd0); background:color-mix(in srgb, var(--rg-accent,#5b8fd0) 15%, transparent); }
.rg-row .rg-btn { padding:0 4px; }
.rg-idx { flex:0 0 18px; text-align:right; font:600 11px monospace; color:inherit; padding-right:1px; }
.rg-idx.none { opacity:.45; font-weight:400; }
.rg-sw { width:14px; height:14px; border-radius:3px; border:1px solid rgba(0,0,0,.75); flex:0 0 auto; cursor:pointer; }
input.rg-sw[type=color] { padding:0; background:none; -webkit-appearance:none; appearance:none; }
input.rg-sw[type=color]::-webkit-color-swatch-wrapper { padding:0; }
input.rg-sw[type=color]::-webkit-color-swatch { border:none; border-radius:2px; }
input.rg-sw[type=color]::-moz-color-swatch { border:none; border-radius:2px; }
.rg-pwrap { position:relative; display:flex; flex:1 1 auto; min-width:0; }
.rg-pwrap > textarea.rg-prompt { padding-right:18px !important; }
/* round 88: the button is a solid tile in the field's own color, so no text shows under it (a one-line field's text
   runs to the field's edge), and its icon is always plain to see */
.rg-expand { position:absolute; z-index:3; width:16px; height:16px; padding:0; margin:0; border:0; border-radius:3px; background:var(--comfy-input-bg,#222);
  box-shadow:-5px 0 4px var(--comfy-input-bg,#222); color:color-mix(in srgb, var(--input-text,#ddd) 70%, transparent); cursor:pointer; line-height:0; }
.rg-expand svg { width:12px; height:12px; display:block; margin:2px; }
.rg-expand:hover { color:#fff; background:var(--rg-accent-fill,#3a6ea5); box-shadow:none; }
/* the text field whose pop-up editor is open (round 91) */
textarea.rg-pop-open.rg-pop-open { outline:2px solid var(--rg-accent,#5b8fd0) !important; outline-offset:-1px !important; }
*:hover > .rg-expand { color:var(--input-text,#ddd); }
textarea.rg-scene-ta { padding-right:20px !important; }
/* more controls in a text box's corner, left of the pop-up button (placed by addExpandButton(), rg_shared.js) */
.rg-btn.rg-corner { position:absolute; z-index:3; margin:0; }
/* scene_prompt_positive shows its LLM Prompt Enhancer (round 43): the button in its corner, an outline while it is on */
.rg-btn.rg-llm-btn.rg-llm-corner { width:16px; height:16px; }
.rg-btn.rg-llm-btn.rg-llm-corner svg { width:12px; height:12px; }
.rg-btn.rg-llm-btn.rg-llm-corner:not(.on) { opacity:.5; }
.rg-btn.rg-llm-btn.rg-llm-corner:not(.on):hover { opacity:1; }
textarea.rg-scene-ta.rg-llm-on, textarea.rg-big-ta.rg-llm-on { outline:1.5px solid var(--p-primary-color, #4a9eff) !important; outline-offset:-1.5px; }
.rg-row textarea.rg-prompt { flex:1 1 auto; min-width:0; background:var(--comfy-input-bg,#222); color:inherit; resize:none;
  border:1px solid var(--border-color,#555); border-radius:3px; padding:1px 4px; font-family:inherit; font-size:var(--rg-fs-r,12px);
  line-height:var(--rg-lh-r,15px); height:calc(var(--rg-lh-r,15px) + 3px); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.rg-row textarea.rg-prompt.rg-text { font-size:var(--rg-fs-t,12px); line-height:var(--rg-lh-t,15px); height:calc(var(--rg-lh-t,15px) + 3px); }
.rg-row textarea.rg-prompt.rg-text:focus { height:calc(var(--rg-lh-t,15px) * 4 + 4px); }
.rg-row textarea.rg-prompt:focus { height:calc(var(--rg-lh-r,15px) * 4 + 4px); white-space:pre-wrap; overflow-x:hidden; overflow-y:auto; position:relative; z-index:2;
  scrollbar-gutter:stable; scrollbar-width:thin; padding-right:2px; }
.rg-row textarea.rg-prompt:focus::-webkit-scrollbar { width:8px; }
.rg-row textarea.rg-prompt:focus::-webkit-scrollbar-thumb { background:#666; border-radius:4px; }
.rg-row:has(textarea.rg-prompt:focus) { align-items:flex-start; }
.rg-row input[type=text] { flex:1 1 auto; min-width:0; background:var(--comfy-input-bg,#222); color:inherit;
  border:1px solid var(--border-color,#555); border-radius:3px; padding:1px 4px; font:inherit; }
.rg-row .rg-sel { flex:0 0 auto; max-width:78px; }
.rg-eye { width:20px; text-align:center; }
.rg-pseudo { font-style:italic; opacity:.85; flex:1 1 auto; }
.rg-hint { opacity:.65; font-size:11px; }
.rg-row.region.off > :not(.rg-reye):not(.rg-chev) { opacity:.45; }
.rg-size { display:flex; align-items:center; gap:3px; width:100%; height:100%; box-sizing:border-box; overflow:hidden;
  font:12px sans-serif; color:var(--input-text,#ddd); pointer-events:auto; }
.rg-size .rg-btn, .rg-size .rg-sel, .rg-size .rg-num, .rg-presets .rg-btn, .rg-presets .rg-num { background:var(--comfy-input-bg,#222);
  color:inherit; border:1px solid var(--border-color,#555); border-radius:4px; padding:1px 4px; font:inherit; }
.rg-size .rg-btn { cursor:pointer; }
.rg-size .rg-btn.on { background:var(--rg-accent-fill,#3a6ea5); border-color:var(--rg-accent,#5b8fd0); color:#fff; }
.rg-size .rg-btn.icon { padding:2px 4px; line-height:0; }
.rg-size .rg-btn.icon svg { width:16px; height:16px; display:block; }
.rg-size .rg-seg { display:inline-flex; flex:0 0 auto; }
.rg-size .rg-seg .rg-btn { border-radius:0; margin:0; }
.rg-size .rg-seg .rg-btn + .rg-btn { border-left-width:0; }
.rg-size .rg-seg .rg-btn:first-child { border-radius:4px 0 0 4px; }
.rg-size .rg-seg .rg-btn:last-child { border-radius:0 4px 4px 0; }
.rg-size-part { display:inline-flex; align-items:center; gap:3px; min-width:0; flex:0 1 auto; }
.rg-size .rg-sel { min-width:0; max-width:170px; flex:0 1 auto; }
.rg-size .rg-hint { opacity:.65; font-size:11px; }
.rg-size-out { margin-left:auto; padding-left:4px; white-space:nowrap; opacity:.8; font-variant-numeric:tabular-nums; }
.rg-size.ext .rg-size-part, .rg-size.ext .rg-seg { opacity:.45; }
.rg-size .rg-socks-btn { flex:0 0 auto; margin-left:3px; }
.rg-size.ext .rg-size-out { opacity:1; color:#8fb8e8; }
.rg-size.editsized .rg-size-part > select:first-child { opacity:.45; }
.rg-presets { position:fixed; z-index:10000; display:flex; flex-direction:column; gap:4px; padding:6px 8px; max-height:70vh;
  background:var(--comfy-menu-bg,#2a2a2a); color:var(--input-text,#ddd); border:1px solid var(--border-color,#555); border-radius:6px;
  font:12px sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.5); }
.rg-presets-head { display:flex; align-items:center; justify-content:space-between; gap:8px; font-weight:600; }
/* the list is one grid (round 69): handle | width | height | name | remove. A row's cells are the grid's own
   (display:contents), so each column is as wide as its widest field: --rg-pw / --rg-pn, set from the list. */
.rg-presets-list { display:grid; grid-template-columns:11px var(--rg-pw,70px) var(--rg-pw,70px) minmax(60px, 1fr) auto; gap:3px 5px; align-items:center;
  /* Its own least width: the columns at their full widths (26 px: the remove button; 20 px: four gaps; 12 px: the padding).
     The name column is what gives when a scroll bar takes room at the right, so nothing ever sticks out sideways.
     The padding holds the click areas, which reach past the controls (they made the list scroll by a pixel or two). */
  min-width:calc(11px + 2 * var(--rg-pw,70px) + var(--rg-pn,120px) + 26px + 20px + 12px); box-sizing:border-box;
  overflow-x:hidden; overflow-y:auto; padding:3px 6px; }
.rg-presets-row, .rg-presets-cols { display:contents; }
.rg-presets-list > .rg-hint { grid-column:1 / -1; }
.rg-presets-list .rg-num, .rg-presets-list .rg-presets-name { width:100% !important; min-width:0 !important; max-width:100% !important; box-sizing:border-box !important; margin:0 !important; }
.rg-presets-name { background:var(--comfy-input-bg,#222); color:inherit; border:1px solid var(--border-color,#555);
  border-radius:4px; padding:1px 4px; font:inherit; }
.rg-presets-col { display:flex; align-items:center; gap:3px; min-width:0; width:100%; box-sizing:border-box; margin:0; padding:1px 4px 2px; border:0; border-bottom:1px solid var(--border-color,#555); border-radius:3px 3px 0 0;
  background:none; color:inherit; font:600 11px sans-serif; text-align:left; cursor:pointer; opacity:.8; }
.rg-presets-col:hover { opacity:1; background:color-mix(in srgb, currentColor 10%, transparent); }
.rg-presets-col.on { opacity:1; color:#8fb8e8; }
.rg-presets-dir { line-height:0; } .rg-presets-dir svg { width:11px; height:11px; display:block; }
.rg-presets-drop { grid-column:1 / -1; height:2px; margin:-2.5px 0; border-radius:1px; background:#8fb8e8; pointer-events:none; }
.rg-presets .dragging { opacity:.45; }
/* click areas, as in the node (round 39): at least 24 px tall, out to the middle of the gap to the neighbour */
.rg-presets .rg-btn, .rg-presets .rg-grip, .rg-presets-col { position:relative; isolation:isolate; }
.rg-presets .rg-btn::before, .rg-presets .rg-grip::before, .rg-presets-col::before {
  content:""; position:absolute; z-index:-1; left:-3.5px; right:-3.5px; top:50%; height:max(100%, 24px); transform:translateY(-50%); }
.rg-presets .rg-grip::before { left:-5px; right:-3px; }
.rg-presets-col::before { left:-2.5px; right:-2.5px; }
.rg-presets-foot { display:flex; gap:4px; justify-content:flex-end; }
.rg-presets-adds { display:inline-flex; flex-wrap:wrap; gap:4px; margin-right:auto; }
.rg-presets .rg-btn:disabled { opacity:.4; }
.rg-wc-filled { box-shadow:inset 3px 0 0 -1px #c9a14a; }
.rg-pop-lbl .rg-wc-use { margin-left:6px; padding:0 3px; line-height:0; vertical-align:middle; }
.rg-pop .rg-wc-use svg, .rg-pop .rg-wc-pick svg { width:14px; height:14px; display:block; }
.rg-pop .rg-wc-pick { line-height:0; padding:1px 3px; }
.rg-row.ctrl.off .rg-pseudo { opacity:.6; }
.rg-row.ctrl.edit { cursor:default; }
.rg-row.ctrl.unused .rg-sel, .rg-row.ctrl.unused .rg-num, .rg-row.ctrl.unused .rg-hint { opacity:.5; }
.rg-warn { color:#e8b339; cursor:help; user-select:none; }
.rg-row.layer.hole .rg-sw { background:repeating-linear-gradient(135deg, #000 0 3px, #8a8a8a 3px 4px); }
.rg-row.layer .ico.on { color:var(--p-primary-color, #4a9eff); border-color:var(--p-primary-color, #4a9eff); }
.rg-row.ctrl.edit:hover { background:none; }
.rg-row .rg-ff { width:auto; min-width:0; max-width:none; flex:1 1 auto; gap:4px; }
.rg-row .rg-ff-name { padding:1px 18px 1px 5px; border-radius:4px; font-size:11px; }
.rg-row .rg-ff-name::after { right:5px; }
.rg-row .rg-ff-browse { width:22px; height:20px; border-radius:4px; }
.rg-row .rg-ff-browse svg { width:14px; height:14px; }
.rg-row.ctrl .rg-num { width:44px; }
.rg-row.ctrl .rg-sel { flex:0 1 190px; min-width:90px; max-width:190px; }      /* gives way first: the row fits a 580 px node (round 48) */
.rg-settings .rg-sel.rg-model { max-width:150px; }
.rg-settings .rg-sel.rg-model.picked { border-color:#c9a14a; }
.rg-subbody.ctrl .rg-ctrl-help { white-space:normal; line-height:14px; opacity:.8; }
.rg-subbody.ctrl .rg-row.lora { padding-left:30px; }
.rg-msg { display:flex; gap:6px; align-items:flex-start; flex:0 0 auto; font-size:12px; padding:4px 6px; margin:2px 0;
  background:#3a2424; border:1px solid #b05656; border-radius:4px; color:#f6dddd; user-select:text; -webkit-user-select:text; cursor:auto; }
.rg-msg-icon { flex:0 0 auto; line-height:20px; }
.rg-msg.info { background:color-mix(in srgb, var(--rg-accent,#5b8fd0) 14%, transparent); border-color:var(--rg-accent,#5b8fd0);  color:#dfe9f6; }
.rg-msg.notes { background:#3a3222; border-color:#a67c1a; color:#f3e6c4; }
.rg-msg-text { max-height:160px; overflow:auto; }
.rg-btn.rg-notes { font-size:12px; padding:1px 6px; }
.rg-btn.rg-notes.warn { color:#e8b339; border-color:#a67c1a; }
.rg-msg-text { flex:1 1 auto; min-width:0; line-height:20px; overflow-wrap:anywhere; white-space:pre-wrap; }
.rg-msg-text a { color:#9cc4ff; text-decoration:underline; cursor:pointer; }
.rg-msg .rg-btn { flex:0 0 auto; user-select:none; -webkit-user-select:none; }
.rg-banner { display:flex; flex-wrap:wrap; gap:6px; align-items:center; font-size:12px; padding:4px 6px; margin:2px 0;
  background:#3a3220; border:1px solid #b08d3c; border-radius:4px; color:#f2e3bf; }
`;

export function injectStyle() {
    for (const id of ["rg-style", "rg-style-v2", "rg-style-v3", "rg-style-v4", "rg-style-v5", "rg-style-v6", "rg-style-v7", "rg-style-v8"]) document.getElementById(id)?.remove();
    const s = document.createElement("style");
    s.id = "rg-style-v8";
    s.textContent = STYLE + CHIP_CSS + WC_CSS;
    document.head.appendChild(s);
}
