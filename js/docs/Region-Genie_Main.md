# Region Genie

Paint regions on the node's canvas, give each one its own prompt, and send the result straight to a sampler: the
node outputs the model, the encoded prompts and the latent, plus masks, boxes and a color map for other nodes
(those show when you tick them in the sockets list: see 1 below).

![The parts of the node](region-genie-parts.png)

## Your first image

1. Connect your loader's `model`, `clip` and `vae` to the node.
2. Pick a shape (**R** for a rectangle) and drag a box on the canvas. That is your first region.
3. Type what belongs there in the region's prompt, in the list under the canvas.
4. For another region, press the add-region button (a box with a plus, above the list) and draw again.
5. Describe the whole picture in `scene_prompt_positive`.
6. Connect `model`, `positive`, `negative` and `latent` to your sampler, and run.

## The parts of the node

1. **Image size**: by aspect ratio, from a list of presets, or typed in. The cable button at its right end lists
   the node's inputs and outputs: tick the ones you need (masks, a color map, boxes, the prompt as text, width and
   height inputs …). A connected one always stays.
2. **Scene prompts**: the whole picture, and what to avoid. The corner button opens a larger editor.
3. **Tools**: select, shapes, brush, lasso, fill, magic wand / Select object, eraser, arrange; then undo, redo, snap,
   fit and labels. A button with a small arrow holds more versions: click the arrow or right-click.
4. **Canvas**: the image area sits in a checkered margin. Each region shows its number and as much of its prompt
   as fits inside it; double-click that text to edit the region. The line along the bottom edge shows the keys and
   gestures of the tool in use.
5. **Regions**: one row per region, with its number (the `index` other nodes use), color, type and prompt. The
   arrow at the start of a row opens it: feather, palette, merge, move and delete, then its layers and LoRAs.
   Drag a region or a layer by the six dots at the start of its row to reorder it; a click on them picks the row.
   *Whole image* holds LoRAs and Control for the whole picture.
6. **Bottom bar**: Generate / Edit, the model, the LLM Prompt Enhancer, tag autocomplete, the wildcard seed (while a prompt has a wildcard), and
   Export / Import. After a run, a button here shows what the run reported, with a ⚠ when something needs attention.

## Good to know

- **Which model?** The dropdown in the bottom bar follows the connected model by itself. It decides how the regions
  reach the model: as a layout (MOSS-Image, Ideogram 4) or as plain sentences (Krea 2, Flux, Anima, SDXL / SD1.5).
- **apart** (right of the list's header) keeps the regions from blending into each other on plain-text models. It
  turns on by itself when it is needed; click it to turn it off for this node.
- **Edit** (bottom bar) changes an existing image on the `image` input instead of making a new one.
- **More room:** the button with two arrows in the tool bar (or Alt+Enter) opens the same editor in a large window
  over ComfyUI, with the region list beside the canvas. ✕ or Esc puts it back in the node.
- **Nothing is lost by trying:** Ctrl+Z undoes every change in the editor, Clear all and typed text included (each visit to a text box is one step; with the cursor in a box, Ctrl+Z goes back through that box's text). The history is kept in memory only, never saved.
- **Shortcuts** work while the pointer is over the node: V select, R / O / T shapes, B brush, L lasso, F fill,
  W magic wand, Q Select object, E eraser, G snap, Home fit, Space+drag pan, wheel zoom. **Press ?** (or the
  keyboard button in the bottom bar) for the whole list; click a key there to give it another key.
- **Right-click the canvas** for a menu: on a region, what you can do with it (edit its prompt, hide, reorder,
  duplicate, delete); on empty canvas, add a region, paste, fit, labels, snap.
- Every button explains itself when you point at it, and the defaults for new nodes are in
  **Settings > Region Genie**.

## More

The full manual: [Region Genie](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/region-genie.md), [Control](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/control.md),
[Edit Mode](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/edit-mode.md), [Regional LoRAs](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/regional-loras.md),
[LLM Prompt Enhancer](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/llm-prompt-enhancer.md), [Wildcards](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/wildcards.md).
