# Real-hardware checklist

Cloud sessions have no GPU, no real model files, no Windows and no 4K display, so the items below have only been checked with stand-ins. Tick an item when it works on a real machine; report anything that doesn't. Once an item is confirmed it can be deleted from this file.

Do sections 1 and 2 first: they cover the most with the fewest runs.

## 1. One run per model you use

For each model: connect `model`, `clip` and `vae`, draw two regions with prompts, run, and check that each region shows its own prompt.

**Example workflows (round 66, never run on a GPU):** open each from Templates > ComfyUI-Region-Genie (or `example_workflows/`), pick your files in the loaders, and run it.

- [ ] Each of the eleven runs without an error and gives a harbor with a lighthouse (left), a boat (lower right) and seagulls (upper right)
- [ ] The sampler settings suit your version of each model (they are ComfyUI's template values; the note in the workflow names the others)
- [ ] Ideogram 4 and Flux.2: the `width` / `height` links to the scheduler follow a changed image size
- [ ] A missing model file is reported with its download link when the workflow opens
- [ ] On GitHub, the README's Quick start diagram: the pan / zoom buttons no longer cover "Save Image"

- [ ] MOSS-Image, layout mode (regions placed by the layout prompt)
- [ ] MOSS-Image, standard mode (the layout / standard switch off, and with no regions drawn)
- [ ] MOSS-Image: with an empty canvas the switch shows standard; drawing the first region brings layout back, and the run's `prompt` is layout JSON
- [ ] Krea 2 (or MOSS-Image in standard mode): after a run the Separate button (keep all regions separate) is lit; one click turns it off, and the next run leaves it off
- [ ] Krea 2 (regions kept separate automatically)
- [ ] Ideogram 4
- [ ] Flux.1
- [ ] Flux.2 / Klein
- [ ] Flux 3
- [ ] Anima
- [ ] SDXL
- [ ] SD1.5
- [ ] The model in the bottom bar is guessed correctly before the first run (GGUF files, merges, renamed files, custom loader nodes)

## 2. Display: 4K, both node modes

Check once in legacy mode and once in Nodes 2.0.

- [ ] The footer and the toolbar each stay on one row at the default node width
- [ ] Number fields show every digit (the arrows don't cover any)
- [ ] Pop-up editors: drag, resize, ◀ / ▶, A− / A+, Page Up / Page Down
- [ ] Multi-line tooltips show their line breaks (node inputs, Settings, editor buttons)
- [ ] The divider between canvas and region list, the folded tool strip, the brush-size slider on the canvas edge
- [ ] The size row: presets pop-up, the chain button, the seed control
- [ ] The message bar under the canvas: selecting text, right-click, Copy link
- [ ] Region opacity (round 72): with an image connected the regions are see-through with a solid edge line; the opacity button in the canvas's top right corner (its slider drops down) changes it
- [ ] The same in the large editor on the 4K screen: dragging and zooming stay smooth below 100% (the edge lines are drawn by the graphics card per frame), in Firefox too
- [ ] Edge lines (round 73): smooth on tilted layers; a region under another has no line around it; two touching regions both have one; no blinking of the lines while dragging or zooming
- [ ] Labels without a box (round 73): readable over a real photo at 50%, and over light region colors at 100% (black text, white glow)
- [ ] Labels: text size 8 / 11 / 20 in Settings; zooming in enlarges the text, zooming out keeps it at the set size; shadow size and strength at their ends
- [ ] Settings > Region edge line: 1, 3.5, 10 and 0 look right; the canvas stays smooth with ten or more regions
- [ ] Snap to grid on: the grid lines are clearly visible on regions and on the empty canvas; the magnet's ▾ menu (Faint / Normal / Strong, show without snapping, Shift+G)

- [ ] Manual size mode at the default node width, both node modes: the ± step box fits in the row; clicking the small arrows of W / H with the mouse changes the value by the step; many fast clicks (up, down, mixed) on W, H, ±, MP and × all count, none snaps back (reported in Firefox 160 on Windows, legacy mode, very fast clicks; fixed and checked in Firefox on Linux with the focus kept out of the field: please confirm on Windows)

## 3. Model files (Settings, Edit rows, LLM)

- [ ] A model-file field opens ComfyUI's menu on the right folders; with rgthree-comfy's Auto Nest on, subfolders show as folders
- [ ] Typing in the menu finds a file in any subfolder
- [ ] The Region Genie tab in Settings opens quickly with your full library
- [ ] Check model files (Settings > Region Genie) reports nothing missing when everything is in place, and names a file after you move it away
- [ ] Browse… (with its switch on) picks a file outside ComfyUI's model folders, and a run loads it (Windows / Stability Matrix paths)

## 4. Control

- [ ] A ControlNet row (SDXL / SD1.5 / Flux.1): the result follows the control map
- [ ] Two ControlNet rows together
- [ ] Anima: one LLLite row, then two
- [ ] MOSS-Image color map + depth control LoRA, including a region with its control switch off
- [ ] Flux.1 depth / canny LoRA, and that its row's strength changes the effect
- [ ] A second MOSS-Image or Flux.1 LoRA control row shows ⚠, and the run really ignores it
- [ ] Depth Anything 3 making the depth map (no `control_image` connected)
- [ ] Control together with LoRAs per region; memory use is acceptable

- [ ] **Pose (round 61)**, with a model that has a pose ControlNet (SDXL / Illustrious / NoobAI with an OpenPose or union ControlNet, SD1.5 openpose, Flux.1 union, Anima pose patch) set for *your control_image*:
  - one figure, standing: the person takes the pose; then drag an arm up: the picture follows
  - two figures in two regions with different prompts: each character in its own pose
  - *Facing away*: the person is seen from behind; a hidden joint (e.g. a hand behind the back) isn't forced into view
  - each starting pose once: which ones the model reads well, which need better joint positions (tell me)
  - a union ControlNet without and with other Control rows (pose + depth)
  - Settings > Region Genie > Control: the four pose files and the SDPose model are picked with the file menu (and Browse…); a pose row uses the model's pose file, and the control_image file when none is set
  - the mouse wheel on a clicked number field, in your browser (Firefox too): over the field, over the list, the bottom bar and the node's title it steps the value; over the drawing canvas it zooms; outside the node it zooms the graph
  - **From the image** (needs `sdpose_wholebody_fp16.safetensors` in models/checkpoints): a box around a standing person gives a figure on that person; a sitting person; two people (one box each); how long the first read takes and the next ones; without the file: the message with the link; while a workflow runs: it says it waits
  - **the import button** with ComfyUI's SDPose Keypoint Extractor on the pose_keypoint input: one click runs the detector only (not the sampler) and the person appears as a figure; a second click adds nothing; change the figure and click: a second figure by default, the same figure reset with *Replace it* in Settings; load another photo and click: the new pose is added (or replaces)
  - a figure over no region, and a canvas with no regions at all: the person is still posed, described by scene_prompt_positive
  - **pose_keypoint output** into ComfyUI's SDPose Draw Keypoints: the same figures as on the canvas; **pose_keypoint input** from SDPose Keypoint Extractor: the person's pose is followed with a pose Control row
  - the Pose tool at 4K in both node modes: joints easy to grab, the strip readable; the new default node size (620 wide, square canvas in legacy mode)

## 5. Edit Mode

- [ ] Each model you edit with: the Edit row shows the Settings edit LoRA and the run changes only the chosen regions
- [ ] ＋Edit rows of the node's own are applied
- [ ] MOSS-Image with a LoRA trained with ai-toolkit
- [ ] MOSS-Image editing with the manual's settings (CFG 5 for Moss-Image-Edit, 3 for Edit-HQ; reference size 0 / 512), with *regions only* and with *whole image*; with and without a Skip Layer Guidance node (layer 22) on `model`
- [ ] The edit mask's grow / feather, keep / change per region

## 6. LoRAs per region

- [ ] MOSS-Image, Krea 2, Flux, Anima, SDXL: a LoRA on one region acts only there
- [ ] On an int8 / fp8 (quantized) model
- [x] No regions (empty canvas), MOSS-Image: the picture is identical to one made with CLIP Text Encode and Empty Flux 2 Latent at the same settings (the owner, Nov 21)
- [ ] No regions (empty canvas), the other models you use: the same as with ComfyUI's own text encode nodes; a whole-image LoRA still acts
- [ ] An SDXL-based checkpoint (Illustrious-XL or NoobAI-XL, also a v-prediction one): the bottom bar shows SDXL, regions are placed, a regional LoRA acts only in its region
- [ ] The Regional LoRAs node and Create Hook LoRA (Quantized)
- [ ] separation 0.85 / until 0.1 (the defaults again since 0.51, after the owner's tests across models; 0.4 / 0.1 from 0.43 to 0.50): each region ends up where it was drawn. 0.4 / 0.1 blends more; up to 0.99 with until up to 0.5 keeps styles strictly in their regions.
- [ ] A workflow saved before 0.43 whose separation / until were never changed opens with 0.85 / 0.25 and gives the same picture as before
- [ ] After updating to 0.43: the "keep all regions separate" Settings (all regions, and the per-model ones) are back at their defaults; set them again if you had changed them

## 7. Select object, lasso, wand

- [ ] Select object with the real SAM 3.1 file: mask quality, speed, find-all by text
- [ ] ComfyUI unloads and reloads SAM without trouble when memory is needed
- [ ] Magnetic lasso and magic wand on real photos
- [ ] Gradient fill (Fill button's list): a region with a LoRA or a distinct prompt fades across the filled area in the generated image

## 8. LLM Prompt Enhancer and wildcards

- [ ] A real LLM run for a region prompt and for the scene prompt
- [ ] An LLM file picked with Browse…, and an LLM LoRA
- [ ] Wildcards preview and run; the `__` list next to a tag autocomplete pack (LoRA Manager / pysssss)

## 9. Save Image (Region Genie)

- [ ] File sizes on real generations for PNG, WebP, JPEG, AVIF and EXR
- [ ] AVIF on an install where Pillow has no AVIF support
- [ ] A saved file dragged back onto ComfyUI loads its workflow

[← Back to the README](../README.md)

## 10. Languages (Chinese, Japanese, Korean, Spanish)

- Settings > Language set to one of the four, page reloaded: node names in the node menu and on the nodes, input / output names, tooltips and the dropdown choices show in that language; Settings > Region Genie shows translated sections, names, tooltips and options. Checked here only in a headless browser at normal scale, not on the 4K display.
- Longer names (Spanish, Japanese) on the nodes: nothing cut off or overlapping at the default node width, in both node modes.
- A workflow saved in one language opens and runs unchanged in English, and the other way round.
- The wording itself: every translation is machine-drafted. A native speaker should read at least the node names, the input names and the dropdown choices (`glossary.json` in each language folder lists them).

## 11. First-use help (round 33)

- On the 4K display, both node modes: the three first steps on an empty canvas and the hint line along the canvas's bottom edge are readable at the zoom you normally work at, and the hint line fades while you draw.
- After a real run: the button left of Export shows ⚠ with the number of notes (try a run without `clip`), and a click lists them under the canvas.
- Node Info on a selected Region Genie node shows the guide and its picture.
- R, V, B pressed while pointing at the toolbar or the region list pick the tool (and no longer trigger ComfyUI's own shortcuts).

## 12. Region rows (round 34)

- On the 4K display, both node modes (round 88): a region's prompt gets most of its row; the type icon, the layer count, the palette dots and the LoRAs button are readable and easy to hit; each opens the region's pop-up on its tab, and the pop-up keeps its size and place over all five tabs

## 13. Labels, colors, dragging (round 35)

- **MOSS-Image with a "color map" Control row and the new region colors** (purple, golden yellow, teal …): the regions are followed as before. The colors are only IDs to the control LoRA, but this was not run on a GPU.
- On the 4K display, both node modes: each region shows its number and as much of its prompt as fits inside it, readable at your usual zoom; with an image connected (backdrop) the text gets its dark plate.
- Drag a region and a layer by the six dots at the start of the row, also with the graph zoomed in or out: the line follows the pointer and the row lands where the line was.
- Settings > Region Genie > Region Genie node > Region colors: clicking a swatch opens the color picker above the Settings dialog; a changed list is used by the next new region.
- With ComfyUI's light theme: the region list, rows and pop-ups are readable.

## 14. The large editor (round 36)

- On the 4K display, both node modes: the button right of the labels button (or Alt+Enter over the editor) opens the editor in a window filling the page; drawing, the region list, pop-ups, the color picker and the tool menus all work in it and open above it.
- Close it with ✕, the button, the key, or Esc with nothing selected: the editor is back in the node exactly as it was, at the node's size.
- Type in the window's scene prompt boxes: the node's own fields have the text after closing.
- Ctrl+Enter while the window is open queues the workflow; after the run the notes button in the window's bottom bar updates.
- Switch to another workflow tab while it is open: the window closes and the editor is in its node when you come back.

## 15. Pop-up lists and grips (round 37)

- **Large editor, tag autocomplete on (ComfyUI-Custom-Scripts or ComfyUI-Lora-Manager):** type the start of a tag in the window's scene_prompt_positive and scene_prompt_negative boxes (and the background box with Ideogram 4): the list opens over the window, right under the line you type. Same for a wildcard (`__`).
- With the graph zoomed in and out (not 100 %): in a region's pop-up editor and in the large editor the tag list still starts right under the typed line, not on it and not far below.
- **ComfyUI-Lora-Manager's autocomplete** (with Custom-Scripts' switched off): its list also opens over the large editor and the pop-up editors. The automatic test only covers Custom-Scripts' list.
- Click (don't drag) the six dots of a region row: that region becomes the active one. Click a layer's six dots: the layer is selected and its region active. A drag still moves the row.

## 16. Tooltip, shortcut list, canvas menu, icons, node size (round 38)

- **On the 4K display, both node modes:** point at a tool button: after about half a second the pack's tooltip shows under it (dark box, the name in bold, the shortcut as a key), readable at your display scaling, and **no second, browser tooltip** appears next to it, also after you click a button and keep the pointer on it.
- Point at a few controls in each place: the tool bar, a region row, a layer row, the bottom bar, a pop-up editor, the LLM settings, the Regional LoRAs node, the Region colors field in Settings. Each shows the pack's tooltip.
- **?** while the pointer is over the node, and the keyboard button left of Export: the shortcut sheet opens over the node, readable, with your own keys for the large editor and previous / next field. Check that ? does not trigger something of ComfyUI or another pack.
- **Right-click on the canvas** (region and empty area), both node modes: the pack's menu opens at the pointer, ComfyUI's node menu does not. Right-click outside the canvas (the node's title, the tool bar) still opens what it did before.
- The icons: every button is readable at your usual zoom; none shows as an empty box or a colored emoji.
- Add a new Region Genie node (legacy mode): its canvas is square, and a workflow saved before keeps its node size.

## 17. Click areas, your own shortcuts (round 39)

- **Click areas, on the 4K display, both node modes:** click a row's small buttons (eye, the type icon, ✕ and the grip) slightly off: just above or below still counts; a click between two buttons goes to the nearer one, never to both. A tool button's small arrow still opens its list.
- **Changing a key on a real keyboard:** press ? over a node, click a key, press a new one: a letter, a function key, a combination with Ctrl / Alt / Shift, and (on macOS) one with ⌘. The new key works on the canvas at once and the old one doesn't; the tooltip and the hint line show it. Try a key ComfyUI itself uses (R, Ctrl+S): it acts in the editor only while the pointer is over the node.
- A non-US keyboard layout: the keys with symbols ([ ] ?) can be reached, or can be given keys that can.
- **Settings > Region Genie > Shortcuts > Edit…:** the list opens over the Settings dialog, takes a new key there, and closing it leaves the dialog open. After reloading ComfyUI the keys are still yours.
- Reset all: every key is back; the large editor opens with Alt+Enter again.

## 18. Sockets, size_from, the Edit area line (round 40)

- **A real run with hidden outputs:** on a new node tick `masks` and `color_map` in the sockets list (the cable button in the size row), connect them (Mask Picker, a preview) and run with a model: each receives its own data. Then untick one that isn't connected and run again.
- **Your own workflows from before this version:** open a few. Links are all still there (also into the old `size_from_image` / `size_from_latent` inputs, now on `size_from`), unconnected sockets are hidden, the node's box is where it was, and the run gives the same result as before.
- **Both node modes, 4K display:** tick and untick sockets: the node's top moves, the editor and the node's bottom edge stay; wires to other nodes follow.
- `size_from` with a real image and with a real latent (also one from another node than Empty Latent, where the size is only known after a run): the size at the right end of the size row and the canvas agree with the result.
- Edit Mode: the **Edit area** line is under *Whole image*, its dropdown and two fields act as the bottom bar's dropdown and the header's fields did; removing the Edit row with ✕ leaves it.
- A wildcard typed into any prompt brings the seed group into the bottom bar at once; removing the last wildcard hides it. The same on the Regional LoRAs node (top right of its rows editor).
- Ctrl+Up / Ctrl+Down in each kind of text box (scene prompts, a region's prompt in the list, a pop-up editor, the large editor, Regional LoRAs' prompts and a row's words): the tag at the cursor gets a weight, `(tag:1.05)`; back at 1 the brackets go. Also Cmd on a Mac, and in Firefox.
- Subgraphs: a Region Genie node inside a subgraph, with only some outputs shown and one of them leaving the subgraph, runs with the right data. (Not tested here.)
- "Save (API Format)" of a workflow whose node shows only some outputs: the file has the Python node's output numbers and an empty `outputs_shown`.

## 19. Label marks (round 41)

- On the 4K display, both node modes: a **character** region's label shows a small filled person before its prompt, in the text's color (white on dark regions, black on light ones), clear at your usual zoom. In Edit Mode a region set to keep shows a filled lock, and a kept character region the lock, then the person. No colored emoji anywhere in the labels.
- The Regional LoRAs node, connected to the node's `masks`: a row for a character region shows the same person before the prompt.

## 20. Pop-up text, the shortcut list, tooltips and lists (round 42)

- On the 4K display, both node modes, in a pop-up editor (a scene prompt, a region, and one of the Regional LoRAs node): **Enter** starts a new line; **Esc** and the close button close it with the text as it is. Undo / Redo (the buttons between ◀ ▶ and A− A+, and Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) take typing back in sensible steps; after closing and reopening, Undo still works. Paste, a wildcard from the list, an LLM result and a LoRA's trigger word each undo as one step.
- Typing with an input method (Chinese, Japanese, Korean): composing a word and then Undo behaves sensibly (this can't be tested here).
- The **shortcut list** (the keyboard button, and Settings > Region Genie > Shortcuts > Edit) shows all five sections at your window size, scrolling down for the rest; nothing is cut off at the right.
- **Tooltips:** rest the pointer on buttons in a pop-up's title bar and bottom row, in the node, the shortcut list, the LLM settings and the large editor: only the pack's tooltip appears, never a second (browser) one. Also in Firefox if you use it: the test runs in Chromium only. Tooltips of ComfyUI itself and of other packs (rgthree's progress bar at the top) look as they did before this pack's tooltip existed.
- In a pop-up, the **wildcard** button and **＋LoRA** open their lists in front of the pop-up. With a long LoRA list, the list still scrolls and its filter field takes typing.
- The small buttons in a pop-up's title bar are easy to hit; a click in the gap between two of them lands on one of them, and dragging the title bar still works when you start on the title or on empty space.
- Edit Mode with a loaded image: the label of a region set to **keep** has a dark plate and is readable over the picture; regions that aren't kept look as before.

## 21. Text boxes, Undo, the bottom bar (round 43)

- On the 4K display, both node modes, with long text in `scene_prompt_positive` and `scene_prompt_negative` so that they scroll: the pop-up button (⤢) is left of the scroll bar, not on it, also while the pointer rests on the scroll bar and it grows wider. Typed text wraps before the buttons; none of it is hidden under them or the scroll bar. Which kind of scroll bar your browser draws can't be seen from here: if the button still touches the bar, tell me how wide the bar gets.
- The region list: in a prompt box that isn't being edited the button is in the middle of the box's height; click into the box and it is in the bottom-right corner, left of the box's scroll bar.
- `scene_prompt_positive` has the sparkles button in its corner; clicking it lights it, puts a blue outline around the box and lights the button in the *Whole image* row. Is the outline visible enough with your theme, and not confused with the focus outline?
- The bottom bar of a legacy node: the same room above the buttons (to the line) as below them (to the node's edge). Nodes 2.0 was left as it was.
- A region's pop-up: one bottom row, the palette on the left, everything else on the right. With the pop-up dragged narrow the row wraps instead of overflowing.
- Undo: type in a scene prompt, click out, draw a shape, type in a region's prompt, click out. The tool bar's Undo goes back through these one by one, text edits as whole steps. In a text box, Ctrl+Z goes back about a word at a time, also after clicking out and back. After reloading the page or loading a workflow there is nothing to undo.
- With an input method (Chinese, Japanese, Korean) in the node's own text boxes: composing and Ctrl+Z behave sensibly (untested here; the node's boxes used the browser's own undo before this round).
- A list or menu open over a pop-up: Esc closes the list, the pop-up stays; Esc again closes the pop-up.

## 22. Settings text for other interfaces (round 44)

None of the programs that read this text could be run here; the files were only read back with the same libraries that wrote them.

- A real generation (Region Genie → sampler → VAE Decode → Save Image (Region Genie)), saved as PNG: hover the node's status line; the tooltip ends with the settings text. Are seed, steps, sampler, scheduler, cfg and the model right?
- Open that PNG in **A1111 or Forge → PNG Info**: the prompt, the negative prompt and the settings line show, and "Send to txt2img" fills the fields (a sampler A1111 doesn't have is skipped by it).
- Upload it to **Civitai** (or drop it on its metadata viewer): the settings are read; with a model / LoRA that has a `.metadata.json`, `.rgthree-info.json` or `.cm-info.json` next to it, the resource is linked.
- The same with **WebP and JPEG** (the text is in EXIF there).
- Drag each of those files into ComfyUI: the workflow still loads.
- With MOSS-Image or Ideogram 4 the prompt in the text is the JSON of the `prompt` output: does A1111 / Civitai still read the settings line under it?
- Your usual workflow's sampler nodes: if the status line says in yellow that a setting wasn't found, tell me which sampler / seed node it is, or tick that input in the cable button's list and connect it.
- A two-pass workflow (hi-res fix): the text has the first pass's settings and `Hires steps` / `Denoising strength` for the second.
- **Other ways of upscaling (round 46; checked on hand-built workflows only):** an image from each kind you use shows the right fields: an upscale model alone (`Hires upscaler`, no steps); hi-res fix followed by a tiled upscale (`Postprocess upscale by / upscaler`); base + refiner (`Refiner`, `Refiner switch at`); a face detailer (`ADetailer …`). Worth one try: drop such an image into A1111 / Forge's PNG Info, or upload it to Civitai, and see that the fields are read.
- **Your tiled upscale workflow (round 45):** the upscaled image's text starts with the first pass's steps / sampler / seed and `Size` (the first pass's size), and has `Denoising strength`, `Hires resize`, `Hires upscale`, `Hires steps` and `Hires upscaler` for the upscale. If it still shows only the upscale's values, the first pass wasn't found: please send the workflow (or name the upscale node).
- A model whose LoRA Manager files are kept in its central folder (not next to the model): no hash is found; say so if you use that mode.
- The cable button of Save Image (Region Genie) is on the right of its input rows, just above `filename_prefix`, in both node modes, at your zoom levels; it stays there when the node is resized, and moves down a row for each input you tick.
- Start a generation and, while it runs and finishes, type in a region's prompt in the list and in a number field (a LoRA's strength, a Control row's strength): the cursor stays in the field and nothing typed is lost when the run's results arrive; the list updates when you click elsewhere.

## 23. Arrange: flip, align, grow / shrink (round 45)

Tested in a stub page by the layers' pixels; worth a look on the real canvas at 4K:

- Flip horizontally / vertically on a rectangle, an ellipse and a star that are turned: each becomes its mirror picture and stays in place. On a triangle: upside down points it down.
- Flip a layer with a shape and a brush stroke on it: it mirrors in place (it used to jump sideways).
- Grow and shrink each shape by 8 and by 50 px: it stays that shape with the same corners, stays selectable as a shape (handles, resize), and doesn't move.
- Grow a brush stroke and a lasso outline: smooth round ends, no flattened sides; grow it several times: it doesn't creep.
- Grow a rectangle with a brush stroke on it: the rectangle's corners stay pointed, nothing moves.
- Align a turned ellipse to each edge: its pixels touch the edge.
- A rectangle in the top half with a brush stroke beside it (same layer): grow by 50 px three times, shrink by 50 px three times, repeat: it ends where it started each time (it used to move towards the top edge).
- A large image (over 2048 px on a side): growing a painted layer still looks right (it is worked out at 2048 px there).

## 24. Narrower node, header icons, hints (round 48)

- A new Region Genie node (legacy mode) is 580 px wide with a square canvas; the toolbar, the size row, the list header and the bottom bar are each one row, also on a 4K display with browser zoom or a larger font.
- With LoRAs or "Separate" on, the header shows an icon + field for separation and an icon + field for until; their tooltips name them.
- A long message (for example shrink a tiny layer by 50 px) appears on a line of its own under the header for a few seconds, then the header is one line again.
- The hints fade when the pointer comes onto the canvas, return when it leaves, and show for about three seconds after a tool switch (B, V …).
- The ? button in the canvas's lower right corner hides and shows the hints, in the large editor too; it doesn't sit on anything else there.
- Nodes 2.0: a new node is 580 px wide; its canvas is wider than tall (left as it is on purpose).

## 25. Settings: the short tab and the settings window (round 50)

- Settings > Region Genie is one screen: three sections, each topic one row with Edit….
- Your saved settings are all still there: open a few pages (Control, Edit Mode, LLM Prompt Enhancer) and check the files and presets you had set.
- A page's model-file field opens ComfyUI's menu over the window; with rgthree's nested folders on, the folders open and a file can be picked; Browse… (when on) opens its browser over the window.
- Region colors (page Region Genie node): the color picker opens over the window and Esc closes only the picker.
- Typing in ComfyUI's Search Settings a setting name (e.g. "WebP quality") shows the page's row.
- At 4K with a large ComfyUI font: the window fits the dialog, the left list isn't cut off, long rows don't run under their controls.
- Another language (Settings > Language): the window's pages, names and tooltips are in that language.

## 26. Presets mode and the word "separate" (round 51)

- Pick a preset, switch to manual and type another size, switch back to presets: the preset is the size again, and the dropdown offers "＋ Add" for the manual size.
- A workflow saved before this round that was in presets mode with a size "not in the list" still opens with that size.
- Your saved settings for keeping regions separate (the main switch and the per-model choices) are unchanged after the update.

## Tiled Upscale and Tiled Diffusion (rounds 75-76)

Nothing here has run on a real model yet.

- [ ] Tiled Upscale on Anima at 2x, denoise 0.2, tiles 1024 / overlap 128: no seams, detail added; speed next to Forge Neo's Mixture of Diffusers
- [ ] The same on SDXL, Flux, Krea 2, MOSS-Image, Qwen-Image, Z-Image: runs, no seams
- [ ] `tile_batch_size` 1, 2, 4: the same picture, faster with more while it fits in memory
- [ ] `tile_blend` 0.5, 1, 2: crisper to softer; `tile_overlap` 0 shows seams, 128 doesn't
- [ ] With an upscale model chosen in `upscale_model` (4x model, `upscale_by` 2): the image is resized down to 2x after it; `none` only resizes
- [ ] `color_fix` on / off with 4x-UltraSharpV2: on, the result has the original's brightness and colours, with no halos at strong edges and no loss of fine detail
- [ ] `vae_encode_tile_size` / `vae_decode_tile_size` 512 and 1024: the same picture with no seams from the VAE; less memory at large sizes
- [ ] `preview` off: no preview picture on the node during the run, in both node modes; other samplers in the same workflow still show theirs
- [ ] `upscale_model_tile_size` 512 / 1024 / 0 with 4x-UltraSharpV2 on a 1024 px image: time of "upscale model" in the console (before: about 12.6 s for all of enlarging), the same picture, no joins; whether 1024 or 0 pushes the diffusion model out of memory (a longer "sample")
- [ ] `upscale_model_half_precision` on: the console says bf16 for UltraSharpV2 (a DAT model), fp16 for an ESRGAN one; the picture next to full precision; time
- [ ] The console's timing line (enlarge, encode, sample, decode): which part takes the time next to the other pack's tiled upscale
- [ ] A small card: small tiles at batch 1 fit; ComfyUI doesn't offload more than without tiling
- [ ] ControlNet with SDXL in a tiled run; the warning for a transformer model's ControlNet
- [ ] The "More settings" line on the 4K display, both node modes, and in Firefox: folds and shows the six settings, the node's height follows, "N changed" is readable
- [ ] Regions in a tiled upscale (round 76's step 2): regional LoRAs stay in their regions in the upscale; at denoise 0.4+ tiles don't draw other regions' prompts; Anima, SDXL, Flux, Krea 2

## Regions list without sub-rows; a region's pop-up with tabs (rounds 87-88)

- [ ] A real run after "all LoRAs off" in the header: no LoRA is applied; the next click brings the same ones back and the run uses them
- [ ] The LoRAs tab with a real LoRA folder: the file list opens above the pop-up with its folders; trigger-word chips show and add their word
- [ ] A long LoRA list on *Whole image*: the chips are cut to what fits and "+N" counts the rest, at your usual node width
- [ ] The Palette tab: the picker in the tab follows the pointer smoothly; one drag is one Undo step
- [ ] Dragging a layer from the Layers tab onto another region's row in the list
- [ ] The handle between a text region's prompt and its text to render, in both node modes
- [ ] Canvas labels: the number and the type's mark above the prompt read well at 11 px on the 4K display; the box and the T are clear
- [ ] The large editor: the scene boxes' pop-up buttons sit left of the browser's resize grip and both can be used
- [ ] Firefox: the switch (a styled checkbox), the tabs, and dragging rows by their grips

