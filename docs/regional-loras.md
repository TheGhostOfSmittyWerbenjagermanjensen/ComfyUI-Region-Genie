# Regional LoRAs

## LoRAs per region (the Region Genie node's model output)

```
Load Diffusion Model (MOSS) ── model ──► Region Genie ── model ─────► KSampler  model
Load CLIP (Qwen3.5 9B) ─────── clip ───►              ── positive ──► KSampler  positive
                                                      ── negative ──► KSampler  negative
                                                      ── latent ────► KSampler  latent_image
```

(An Empty Latent node of your own works too, at the same size as the canvas.)

- `model` = your model with the regions' LoRAs. It carries only the LoRAs, not the prompts.
- `positive` = `prompt` encoded with the connected clip (see [Which format `prompt` uses](region-genie.md)). This is what puts `scene_prompt_positive`, each region's prompt and the boxes into the picture, so it must be the sampler's positive. (Encoding that output yourself with CLIP Text Encode gives the same result.) A separate generic positive prompt replaces the layout: the model then draws whatever it likes, with only the LoRA styles split by region.
- `negative` = `scene_prompt_negative` encoded with the same clip.

Everything happens in one model pass:

- each regional LoRA changes only its region's image (its masks, exactly as painted) and its own region's caption in the prompt, so trigger words are read with their LoRA, as in training. The caption part needs `clip` and the prompt to be exactly the text `positive` encodes (the `positive` output, or the same text encoded yourself); otherwise the LoRAs act on the image only and the console says so,
- each LoRA region's caption is kept apart in attention from the other regions' image and captions at every step, so one region's LoRA-changed caption and trigger words can't restyle the rest (shared text: scene prompt, regions without LoRAs, stays open to all),
- **Keep all regions apart** (the **apart** button with four tiles, at the right end of the list header; off by default): on, every region, with or without LoRAs, is kept apart from the others and from the background for the first part of sampling ('until') at the separation strength, and each region's caption speaks only to its own region; off, only regions with LoRAs are. It can help keep characters' details and styles from mixing, and with the models without a layout format (Krea 2, Flux, Anima, SDXL / SD1.5) it is what places each region's prompt (so it turns on by itself there, see [Which format `prompt` uses](region-genie.md)). **Clicking** the switch always changes what it shows: lit (on for this node, or turned on by itself in the last run) becomes off for this node, also where a run would turn it on by itself; off becomes on. **Right-click** the button (the small triangle in its corner) for *Keep all regions apart* (on for this node), *Automatic (as set in Settings)* (the default: on by itself where the model needs it), *Off for this node*, and **Share the background**: the kept-apart regions (all regions, or those with LoRAs) are then kept apart from each other only, not from the image around them, so lighting, perspective and setting stay one picture; each caption still speaks only to its own region. The icon shows the tiles on a shaded backdrop while it is on. Needs a MOSS-Image, Krea 2, Ideogram 4, Flux, Anima or SDXL / SD1.5 model on `model`; while active, attention can't use fused kernels, so sampling is a little slower and uses more VRAM. Without regional LoRAs and with the switch off, separation does nothing.
- **separation / until** (in the list header, shown once a LoRA is set or the switch is on): how strongly regions are kept apart (also used for the captions), and for which part of the steps the image of different LoRA regions sees less of each other (0.85–0.99 for 0.1–0.5 of the steps; default 0.85 / 0.25). 1 / 1 gives independent pictures glued together,
- whole-image LoRAs are merged into the model weights before sampling, exactly like a chain of Load LoRA (model only) nodes: same speed and same result.

Put each LoRA's trigger words in its region's prompt (click its chips), not in `scene_prompt_positive`. LoRA weights for the text encoder (the "clip" part of a LoRA file) are not used. Regional LoRAs on `model` work with **MOSS-Image, Krea 2, Ideogram 4, Flux.1, Flux.2 / Klein, Flux 3, Anima, SDXL and SD1.5** (int8 / fp8 / quantized models included); for other models use the Regional LoRAs node (separate passes).

## Create Hook LoRA (Quantized)

**Create Hook LoRA (Quantized)** is a drop-in replacement for ComfyUI's "Create Hook LoRA" that works with int8 / fp8 / other quantized diffusion models.

The core Hook LoRA bakes the LoRA into the model weights whenever the sampler switches conditioning. That step doesn't support quantized layers (it fails with errors like `'Linear' object has no attribute 'weight_scale'`). This node leaves the weights alone. It adds the LoRA's effect to each layer's output, and only while the model is computing the conditioning the hook is attached to.

### Regional LoRA wiring

```
Load int8 model ──────────────┬──────────────────────────────► KSampler (model)
                              │
                              └► Create Hook LoRA (Quantized) ─► HOOKS ─────┐
                                                                            │
CLIP Text Encode (region prompt, + negative) ─► Cond Pair Set Props ◄───────┘ hooks
                                                 ▲ mask  ◄─ Mask Picker or BBoxes to Masks (mask)
                                                 │ strength, set_cond_area = "mask bounds" or "default"
                                                 ▼
                                   Cond Pair Set Props Combine (with the base prompt pair) ─► KSampler
```

- Connect the same MODEL you sample with to the node's `model` input. The node only uses it to match LoRA keys to layers.
- Don't use `Set CLIP Hooks` or the core `Create Hook LoRA` with this node. The core node is the one that triggers the quantized error. This node has no CLIP strength, which most current DiT LoRAs don't use anyway.
- For several regional LoRAs, make one node and one `Cond Pair Set Props` per region. To stack two LoRAs on one region, chain them through `prev_hooks`.
- After a run the node also shows the LoRA's trigger words (from the same files as the chips in the Region Genie node).
- Supported: LoRA and LoCon (linear and conv layers, including Tucker "mid" weights), LoKr, LoHa, and DoRA on any of these (linear layers), plus fused-qkv slices. The math comes from ComfyUI's own bypass implementations. Skipped, with a note: OFT/BOFT/GLoRA, DoRA on conv layers, and bias/norm "diff" patches.
- LoHa can't be applied piece by piece, so each patched layer rebuilds its full weight change every step. It's slower, and it needs some temporary VRAM; the console prints an estimate.
- DoRA reads each layer's weights once on first use, which takes a few seconds. After that, input-channel DoRA costs about one extra layer computation per patched layer.
- Console: one line when the node runs (what was applied and skipped), and one `active in this run` line on every run, even when the node is cached. The same summary also appears on the node.
- Speed: each hooked region is already an extra model pass with any hook LoRA. On top of that this adds two small matrix multiplications per patched layer, with no requantizing of weights.

## Regional LoRAs (the node)

Several regional LoRAs in one node, working like the LoRAs of the Region Genie node: give it the model, clip, the region masks and the prompt, and connect its `model`, `positive` and `negative` to the sampler.

```
Load model ───────────── model ──► Regional LoRAs ── model ─────► KSampler  model
Load CLIP ────────────── clip ───►                ── positive ──► KSampler  positive
Region Genie ─────────── masks ──►                ── negative ──► KSampler  negative
     └─ prompt ─────────── positive_prompt ►
```

- **positive_prompt** (called `prompt` before; saved workflows keep their text and link): the positive prompt. Connect `prompt` of the Region Genie node (or MOSS-Image Layout Prompt), or type a prompt. **negative_prompt** is encoded as `negative`. With Impact Pack, typed prompts and the rows' words take wildcards (see [Wildcards](wildcards.md); the seed is at the top right of the rows editor).
- **Pop-up editor:** the **⤢** button in the bottom-right corner of `positive_prompt`, `negative_prompt` and each row's words opens a larger editor right at the field. It floats over the page (so it can be bigger than this small node and isn't shrunk by the canvas zoom): drag its title bar to move it, the ◢ grip to resize it (remembered), A− / A+ for the text size (the pop-up keeps its size), ⤓ to use the filled text, **◀ / ▶** to step through `positive_prompt`, `negative_prompt` and each row's words (wrapping around; same place and size; also **Page Up / Page Down**, or the keys you set in **Settings > Region Genie > Region Genie node > Shortcuts**). Below the text, on the right, are the tag autocomplete switch and the {⁎} button that inserts a wildcard. **Enter** starts a new line. The pop-up always keeps its text: **Esc** and the close button only close it, and the **Undo / Redo** buttons in the header (after ◀ / ▶; also Ctrl+Z and Ctrl+Shift+Z / Ctrl+Y) take a change back, step by step, also after the pop-up was closed and opened again. It stays open until Esc, the close button, another pop-up or another workflow tab; clicks elsewhere don't close it. **Settings > Region Genie > Text size** applies here too: the prompt fields count as *scene prompts*, the rows' words as *region prompts*.
- Each **row** is one LoRA: on/off, `index` (the region number shown in the Region Genie node), LoRA file, strength, and words for that region. When `masks` comes from the Region Genie node, every row shows the colour and prompt of the region it points to. The LoRA button opens ComfyUI's list menu, so the list filter and "auto nest subdirectories" from ComfyUI-Easy-Use or rgthree apply.
- **Index −1** LoRAs are merged into the model like Load LoRA (model only) in *inside the model* mode.
- **Row words** are added to that region's caption in the layout JSON (index −1: to the scene caption). With a plain-text prompt they are added as their own sentence. The LoRA's **trigger words** are shown as chips under the row; click one to add it (✓ = already in the row or in the region's caption). A phrase already in the caption isn't added twice.
- **Rows with the same index** stack: both LoRAs act together inside that region. **Index −1** applies a LoRA everywhere.
- **feather** softens the mask edges so each LoRA fades into its surroundings.

**lora_masking**

- *inside the model (one pass)*, the default: for MOSS-Image, Krea 2, Ideogram 4, Flux, Anima and SDXL / SD1.5 this is the same engine as the Region Genie node's `model` output. Each LoRA acts only on its region's image tokens and its region's caption (so trigger words are read with their LoRA), in a single pass for all LoRAs. The regions' captions are kept apart from the other regions in attention. Overlapping regions get both LoRAs. Other models fall back to separate passes automatically.
- *separate passes (classic hooks)*: ComfyUI's hook method, one model pass per region with that region's words added to the prompt; the sampler blends the passes by mask each step and the plain prompt fills the rest (ComfyUI's *default* conditioning, 1 minus the sum of the masks). The `model` output is the model unchanged; the LoRAs ride on `positive` / `negative`. Works with any model, but every pass sees the whole image, so strong style LoRAs tend to bleed across regions.

**region_separation** / **separation_until** (inside-the-model mode, defaults 0.85 / 0.25, as in the Region Genie node): a LoRA limited to its region still reaches the rest of the picture through attention, because every image token looks at every other one. region_separation removes that fraction of the attention between the image of different LoRA regions; separation_until applies it only for the first part of the steps so the seams blend at the end. 0.85–0.99 with 0.1–0.5 works well; 1 / 1 gives independent pictures glued together. **separate_all_regions** (off by default) keeps every mask apart this way, with or without LoRAs, as the Region Genie node's "keep all regions apart" switch (inside-the-model mode; MOSS-Image, Krea 2, Ideogram 4, Flux, Anima, SDXL / SD1.5). **share_background** (off by default) keeps those regions apart from each other only, not from the rest of the image (the Region Genie node's *Share the background*). While it is on, attention runs without fused kernels (SageAttention etc. ignore masks), which is slower.

If one region still takes on the other's style:
1. Check each LoRA on its own first: one row, index −1 (everywhere). If the "photo" LoRA alone doesn't make the whole picture photographic with your prompt, it can't win a region either. Style words in the scene caption (e.g. "painting") pull everything one way.
2. Raise region_separation toward 1 and separation_until toward 0.5.
3. Last resort that always separates: render the picture twice with the same seed and layout (once per LoRA, index −1), combine the latents with the region mask (Latent Composite Masked), then a short low-denoise pass (0.3–0.45) to blend the seam.

The console shows which LoRAs were active in each run and on which region, and after the first step how many layers each LoRA actually changed (0 means its keys didn't match the model). If styles still mix, check for caching/speed-up nodes on the model (they can reuse one pass's result for another).

[← Back to the README](../README.md)
