# Save Image (Region Genie)

Saves images to ComfyUI's output folder like ComfyUI's Save Image (Advanced), with more formats and compression / quality settings, to keep generated images smaller on disk. Only the settings of the chosen format show on the node.

| format | settings | pixels | size (rough, varies by image) | workflow inside (drag the file into ComfyUI to load it) |
|---|---|---|---|---|
| **png** | `png_compression` 0-9, `png_bit_depth` 8-bit / 16-bit | exact at every level | level 9 is usually only 5-15% smaller than level 4 (ComfyUI's default), and slower | yes |
| **webp** | `webp_lossless`, or `webp_quality` 1-100 | lossless: exact; quality: a little detail lost | lossless: usually 25-35% smaller than PNG; quality: often 5-20x smaller | yes |
| **jpeg** | `jpeg_quality` 1-100, `jpeg_extension` .jpg / .jpeg, `jpeg_workflow` | a little detail lost | often 5-20x smaller than PNG | see below |
| **avif** | `avif_quality` 1-100 | a little detail lost | usually the smallest | yes |
| **exr** | `exr_bit_depth` 16 / 32-bit float, `exr_color_space` sRGB / HDR / linear / linear ACEScg | float, scene-linear (for compositing and HDR) | larger than PNG | in its header (ComfyUI can't load it from there yet) |

- **PNG compression** never changes the picture: 0 = no compression (big, fast), 9 = smallest (slowest; the default here). **16-bit** keeps finer gradients for editing later, at about twice the size.
- **JPEG and the workflow:** ComfyUI can't load a workflow from a JPEG, so `jpeg_workflow` decides:
  - **sidecar .json** (default) writes the workflow to a small `.json` file next to each JPEG, with the same name; drag that file into ComfyUI to load it.
  - **none**: no workflow.
  - **inside the JPEG (EXIF)**: readable by other tools, not by ComfyUI.
    - A JPEG's EXIF holds about 64 KB, so a bigger workflow goes into the `.json` instead (the node says so).
    - In an API run there is no workflow, only the prompt, and a prompt that doesn't fit isn't saved, which the node also says.
  - From quality 90 up, JPEG keeps the full color detail; below 90 it stores colors at half resolution (smaller files).
- **AVIF** needs Pillow 11.3 or newer (`pip install -U pillow`), or a ComfyUI recent enough to save AVIF itself (then without transparency); otherwise the run stops and says so.
- **EXR** works as in ComfyUI's Save Image (Advanced), with its own code. It needs ComfyUI v0.45 or newer.
  - The images are converted from `exr_color_space` to scene-linear light (sRGB: the inverse sRGB curve; HDR: the inverse HLG curve; the linear ones unchanged).
  - They are written as 16 or 32-bit float, with the color space and the workflow in the header.
- **Transparency:** connect a `mask`. PNG, WebP, AVIF and EXR get an alpha channel; JPEG has none and ignores it, with a note.
  - As ComfyUI's Load Image mask, **1 = transparent**, so a Load Image's image and mask save back as they were.
  - **invert_mask** (shown while a mask is connected): 1 = opaque, e.g. a region mask from the Region Genie node or Mask Picker to keep the region and clear the rest.
  - A mask of another size is resized; one mask applies to every image of a batch.
  - An image that already has transparency (4 channels, e.g. from Join Image with Alpha or a background remover) keeps it when no mask is connected; a connected mask takes its place.
  - WebP lossless also keeps the colors under fully transparent pixels.
- **filename_prefix** works as in ComfyUI's save nodes: a subfolder (`portraits/ComfyUI`), `%date:yyyy-MM-dd%`, `%Node title.widget%`.
  - Files are numbered `ComfyUI_00001.png`, `ComfyUI_00002.jpg` … (one count for all formats, upper / lower case ignored, and an existing file is never overwritten).
  - `%batch_num%` is the image's place in the batch.
- **After a run** the node shows what it saved and how big it is, e.g. `PNG 9 · 1.42 MB` or `4 × WebP q90 · 1.9 MB total`.
  - JPEG's `.json` files show separately (`2 × JPEG q90 · 1.1 MB total + 2 .json · 8.2 KB`), and notes in yellow.
  - Hover it for each file and its size.
  - When you change a setting afterwards, it dims until the next run (it shows the last run's files, not what the new setting would give).
- **Settings for other interfaces (`a1111_metadata`, on by default):** besides ComfyUI's own workflow data, the node writes what the image was made with as text, the way A1111 and Forge do.
  - Their "PNG Info", other interfaces and sites such as Civitai can read it.
  - ComfyUI's workflow stays in the file as before, so dragging the file into ComfyUI still loads it.

  Example:

  ```
  a red fox, in snow <lora:ink:0.8>
  Negative prompt: blurry
  Steps: 28, Sampler: DPM++ 2M SDE, Schedule type: Karras, CFG scale: 6.5, Seed: 123456789012, Size: 1024x768, Model hash: ab12cd34ef, Model: juggernaut, Version: ComfyUI
  ```

  - **Where it goes:** PNG: a `parameters` text entry. JPEG, WebP, AVIF: the EXIF "UserComment" field (a JPEG gets it whatever `jpeg_workflow` says). EXR: not written.
  - **Nothing to connect in an ordinary workflow.** The node reads the workflow that ran: from its `images` input back to the sampler (seed, steps, cfg, sampler, scheduler, denoise), on to the model and LoRA loaders, the VAE, and the prompts.
    - It knows KSampler, KSampler (Advanced), SamplerCustom and SamplerCustomAdvanced with their sampler / scheduler / noise / guider nodes.
    - Another pack's sampler is read by its input names (`seed`, `steps`, `cfg`, `sampler_name`, `scheduler`).
  - **With a Region Genie node**, the prompt is exactly that node's `prompt` output for the run (after wildcards and the LLM; JSON for MOSS-Image and Ideogram 4), and the negative prompt as it was used.
    - Its LoRAs, also the regional ones, are added as `<lora:name:strength>` tags (the format has no way to say "only in this region").
    - The same holds for the Regional LoRAs node.
  - **Names** are translated to A1111's (`euler_ancestral` → "Euler a", `dpmpp_2m` + `karras` → "DPM++ 2M" + "Karras"); a name A1111 has no word for is written as ComfyUI has it.
  - **More than one pass.** The text always describes the first pass; what came after is written in the fields A1111 / Forge and its common extensions use:
    - **Hi-res fix** (the picture is enlarged and sampled again): `Denoising strength`, `Hires resize`, `Hires upscale`, `Hires steps`, `Hires upscaler`.
      - Also `Hires sampler` / `Hires schedule type` / `Hires CFG Scale` where they differ from the first pass's.
      - `Hires upscaler` is the upscale model's name, `Latent`, or the resize method; a model wins over a plain resize after it.
      - `Size` is then the size the first pass was made at.
      - The second pass's seed has no place in that format and isn't written.
      - The second pass may be:
        - A sampler fed a latent (also through a decode, a resize and an encode).
        - A node that takes the decoded picture and samples it again itself (Ultimate SD Upscale and similar tiled upscalers).
        - Impact Pack's iterative upscale (its settings are read from the provider node connected to it).
      - Enlarged with nothing sampled again (an upscale model alone, or another pack's upscaler): the same fields without strength and steps.
      - A second pass at the same size: `Denoising strength` and `Hires steps` only.
    - **Enlarged again after that** (a tiled upscale or an upscale model after hi-res fix): `Postprocess upscale by` and `Postprocess upscaler`, as A1111's Extras tab writes them. That pass's own steps and strength have no field and aren't written.
    - **A refiner** (two advanced samplers sharing the steps, the second with another model): `Refiner` (its name, and its hash where a metadata file has one) and `Refiner switch at` (0.8 = after 80% of the steps).
      - With the same model on both it is one pass and nothing extra is written.
    - **Detailers** (Impact Pack's FaceDetailer and other "Detailer" nodes): in the names of the ADetailer extension.
      - `ADetailer model` (the detector's file), `ADetailer confidence`, `ADetailer dilate erode`, `ADetailer mask blur`, `ADetailer denoising strength`.
      - Steps / CFG / sampler with their `use separate …` flags where they differ from the first pass.
      - A second detailer has `2nd` after each name, as ADetailer writes it.
    - The passes are found by walking back along the picture from the save node, also through switches and nodes of other packs.
  - **Hashes** (`Model hash`, `Lora hashes`: what Civitai links a model by) are only read from a file that already holds one; nothing is ever hashed, so saving is never slowed down.
    - Looked for next to the model file, in this order:
      1. `<name>.metadata.json` (ComfyUI LoRA Manager).
      2. `<file>.rgthree-info.json` (rgthree).
      3. `<name>.cm-info.json` (Stability Matrix).
      4. `<name>.civitai.info` (Civitai Helper).
      5. Then the hash kohya-based trainers write into a `.safetensors` file's own header.
    - A model with none of these is written by name only.
  - **Values the workflow doesn't show.** Only what is written in the workflow can be read: a value typed on the sampler, or held by a plain value node (ComfyUI's primitives, a seed node).
    - A seed or step count that another node *computes* can't, and the node then says so in yellow in its status line.
    - For those, the **cable button** opens the node's inputs list. It is on the right of the node's input rows, just above `filename_prefix` (the same button as on the Region Genie node).
    - Tick `positive_prompt`, `negative_prompt`, `seed`, `steps`, `cfg`, `sampler_name`, `scheduler`, `denoise` or `model_name` to get that input on the node, and connect the value.
    - A connected value wins over what was read.
    - The inputs are hidden until ticked; a connected one always stays.
  - **To see what was written**, hover the node's status line after a run: the text is at the end of its tooltip.
  - `--disable-metadata` writes none of it. Turn `a1111_metadata` off for ComfyUI's own data only.
- **Size limits:** WebP images can be at most 16383 px wide or tall and JPEG 65535 px; a bigger image stops the run with a message saying so (PNG and AVIF have no such limit here).
- The `images` output passes the images through. `--disable-metadata` saves no workflow anywhere (no `.json` either).
- **Settings > Region Genie > Save Image:** how new nodes start (format, PNG compression, EXR bit depth / color space, WebP lossless / quality, JPEG quality / extension / workflow, AVIF quality). Nodes already in a workflow keep their own values.

[← Back to the README](../README.md)
