# Tiled Upscale and Tiled Diffusion

Two nodes that redraw a large picture in overlapping tiles, so a model can upscale an image that is bigger than it draws well at, or than the graphics card has memory for at once.

- [What they do](#what-they-do)
- [Tiled Upscale: one node for the whole upscale](#tiled-upscale-one-node-for-the-whole-upscale)
- [Tiled Diffusion: for your own sampler](#tiled-diffusion-for-your-own-sampler)
- [The tile settings](#the-tile-settings)
- [Choosing the denoise](#choosing-the-denoise)
- [What works with it, and what doesn't yet](#what-works-with-it-and-what-doesnt-yet)

## What they do

- **The method** is Mixture of Diffusers. At every sampling step the picture is cut into overlapping tiles, the model works on each tile, and the tiles' results are blended back into one picture before the next step.
  - Where tiles overlap, each pixel listens most to the tile it lies deepest in. That is what hides the seams.
  - Because the tiles are blended at every step (not once at the end), neighbouring tiles agree with each other.
- **Several tiles go through the model in one call** (`tile_batch_size`), on every model. That makes it fast when memory allows, and small tiles one at a time make it fit on a small card.
- **No extra model is needed:** the model that made the picture redraws it. An upscale model (ESRGAN and the like) is optional.

## Tiled Upscale: one node for the whole upscale

**Tiled Upscale (Region Genie)** takes an image and gives back the upscaled image. In order, it:

1. Enlarges the image with the upscale model, when one is chosen.
2. Resizes it to the exact size (`upscale_by` times the original, rounded to a size the model's latent fits).
3. Encodes it with the VAE.
4. Adds noise according to `denoise` and redraws it in tiles with your model, running only the last part of the steps.
5. Decodes the result.

With `color_fix` on, the colors are brought back to the original image's after step 2 and after step 5.

| Input | What it is |
|---|---|
| `image` | The image to upscale |
| `model`, `positive`, `negative`, `vae` | As on a sampler: the model (with its LoRAs), the prompts and the VAE |
| `upscale_by` | How many times larger per side (1 only redraws at the same size) |
| `upscale_model` | An upscale model for the enlarging, from `models/upscale_models`. `none`: the image is only resized |
| `denoise` | How much is redrawn (0.2 at first); see below |
| `seed`, `steps`, `cfg`, `sampler_name`, `scheduler` | As on a sampler |
| `tile_width`, `tile_height`, `tile_overlap`, `tile_batch_size` | The tile settings; see below |
| `color_fix` | Keeps the colors and brightness of the original image (on at first); see below |
| `preview` | Shows the picture on the node while it is redrawn (on at first). Off: no preview picture |
| `resize_method` | How the image is resized: by itself, or after the upscale model when its factor differs |
| `tile_blend` | How widely tiles are mixed where they overlap; see below |
| `upscale_model_tile_size`, `upscale_model_half_precision` | How the upscale model is run; see below |
| `vae_encode_tile_size`, `vae_decode_tile_size` | The VAE works in tiles of this size in pixels; 0 (at first) is in one piece; see below |

The settings you change from image to image come first. The last four rows are set once and are folded away on the node: click **More settings** to show them, **Fewer settings** to fold them again. The line says how many of them differ from a new node's values ("2 changed"), a folded setting with a cable connected stays visible, and the fold is saved with the workflow.

- **Outputs:** `image`, and `latent` (the same picture before decoding).
- **Only the last part of the steps is run:** `steps` times `denoise`, so 4 of 20 at a denoise of 0.2. That is what KSampler (Advanced) does when it starts at a later step, and it is much faster than a sampler's own `denoise`, which runs every step.
- With `denoise` 0 it only enlarges.
- **`color_fix`:** an upscale model, the VAE or the redrawing can shift the colors, often towards brighter. With it on, the coarse colors of the result are matched to the original image's (areas of about 8 px of the original and larger); the new fine detail is kept. The `latent` output is the picture before the last of the two fixes.
- **VAE tile sizes:** the tiles above only limit what the model needs. The VAE still encodes and decodes the whole enlarged image, which is what runs out of memory first on a small card at large sizes. ComfyUI switches to tiles by itself when that happens, after the failed try; a size set here skips the failed try and lets you choose the size (512 or 1024 are usual). In one piece is fastest while it fits.
- **The upscale model's speed:** a heavy upscale model can take longer than the redrawing.
  - `upscale_model_tile_size` (512 at first): the model works on pieces of the image of this size. 512 is what ComfyUI's own Upscale Image (using Model) node uses, with the same picture. Larger pieces are faster and need more memory: 1024 takes a 1024 px image in one piece, which took a quarter less time with a heavy model on the owner's card; 0 is the whole image at once. When the memory runs out, the pieces are halved.
  - `upscale_model_half_precision` (off at first): runs the model at half precision where it allows it (fp16, or bf16 for models that only take that, such as DAT ones). It needs less memory and can be faster; on the owner's card with a DAT model (bf16) it was a little faster (8.6 s for 9.3 s). Compare the picture once with it on and off.
- **The console shows where the time went:** one line per run with the size, the number of tiles, the steps run, how the upscale model was run (pieces, precision), and the seconds for loading the upscale model, the upscale model itself, the resize, the color fix, encoding, sampling and decoding.
- Every tile gets the whole prompt. Describe the picture as you did when making it.

## Tiled Diffusion: for your own sampler

**Tiled Diffusion (Region Genie)** takes a model and gives back the model, sampling in tiles. Put it before any sampler when you want your own chain of nodes: your own encode and decode, a custom sampler, several passes.

- It has the five tile settings and nothing else.
- For speed, use KSampler (Advanced) and start at a later step (steps 20, start at step 16 for a fifth redrawn). A plain KSampler's `denoise` runs all its steps.
- Tiles only help from an existing picture at a low denoise. From an empty latent every tile draws a picture of its own.

## The tile settings

- **`tile_width`, `tile_height`** (pixels, 1024 at first): the size of one tile. Use a size the model draws well at. Smaller tiles need less memory and take more model calls.
- **`tile_overlap`** (pixels, 128 at first): how much neighbouring tiles share at least. More overlap hides seams better and needs more tiles. An eighth to a quarter of the tile is usual.
- **`tile_batch_size`** (2 at first): how many tiles go through the model in one call. Raise it while they fit in memory; 1 needs the least.
- **`tile_blend`** (1 at first): how widely a tile's say spreads from its middle where tiles overlap.
  - 1 is Mixture of Diffusers as it is defined, and as other implementations have it.
  - Higher mixes the tiles over a wider band, towards a plain average: softer, and it can smear detail.
  - Lower makes each pixel follow the tile it is deepest in: crisper, and a seam can show sooner.
- A picture no larger than one tile is sampled in the ordinary way.

## Choosing the denoise

- About 0.05: only polish.
- About 0.2: fine detail. A good start.
- 0.3 to 0.4: more invention.
- Higher: the tiles start to forget the picture, and things from the prompt appear where they don't belong.

## What works with it, and what doesn't yet

- **Models:** every model ComfyUI samples with. A tile is treated as a picture of its own, which is what makes several tiles per call possible everywhere.
- **LoRAs:** as usual, applied to the model before the node.
- **ControlNet:** works for models whose ControlNet output is image-shaped (SD1.5, SDXL). For the newer transformer models it is left out while tiling, with a warning in ComfyUI's console.
- **Reference images** (edit models): each tile gets the whole reference, not its part of it.
- **Regions from Region Genie:** connect Region Genie's `model`, `positive` and `negative` as for a normal run. Each tile then gets the part of every region that lies in it.
  - Regional LoRAs act only where their region falls inside a tile.
  - Regions are kept separate per tile, and a region that isn't in a tile leaves its part of the prompt out of that tile. So a tile hears only the regions it shows, which helps at a higher denoise.
  - This holds for the models whose regions are placed by keeping them separate (Krea 2, Flux, Anima, SDXL / SD1.5). For MOSS-Image and Ideogram 4 the regional LoRAs follow the tiles, but the layout in the prompt still describes the whole picture to every tile.
  - It adds no model calls.
- **Memory:** ComfyUI still reserves memory as if the whole picture went through at once, so on a small card it may move more of the model off the card than needed.
