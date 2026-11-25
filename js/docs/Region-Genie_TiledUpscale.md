# Tiled Upscale (Region Genie)

Upscales an image in one node: it enlarges the image, then redraws it with your model in overlapping tiles that
are blended at every step (Mixture of Diffusers), several tiles per model call.

- Connect `image`, and `model`, `positive`, `negative` and `vae` as on a sampler.
- `upscale_model`: an upscale model (ESRGAN and the like) does the enlarging; with `none` the image is only
  resized with `resize_method`.
- `color_fix`: keeps the colors and brightness of the original image, which an upscale model or the redrawing
  can shift.
- `upscale_by`: how many times larger per side.
- Only the last part of the steps is run (`steps` x `denoise`: 4 of 20 at 0.2), as KSampler (Advanced) does.
- `denoise`: how much is redrawn. About 0.05 only polishes, about 0.2 adds fine detail, 0.3-0.4 invents more;
  higher and the tiles start to forget the picture.
- `tile_width` / `tile_height`: a size the model draws well at. Smaller tiles need less memory.
- `tile_overlap`: how much neighbouring tiles share; more hides seams better and takes more tiles.
- `tile_batch_size`: how many tiles go through the model in one call; raise it while they fit in memory.
- `tile_blend`: 1 is the usual blend; higher mixes tiles more softly, lower more crisply.
- Outputs: `image`, and `latent` (before decoding).

With Region Genie's `model`, `positive` and `negative` connected, regional LoRAs and region separation apply per
tile: each tile gets the part of every region that lies in it. ControlNet works with SD1.5
and SDXL; for other models it is left out while tiling.
