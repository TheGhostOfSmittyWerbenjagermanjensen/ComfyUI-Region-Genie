# Tiled Diffusion (Region Genie)

Makes a model sample in overlapping tiles that are blended at every step (Mixture of Diffusers), for pictures
larger than the model or the memory allows at once. Put it before your own sampler; **Tiled Upscale (Region
Genie)** does a whole upscale in one node.

- `tile_width` / `tile_height`: a size the model draws well at. Smaller tiles need less memory.
- `tile_overlap`: how much neighbouring tiles share; more hides seams better and takes more tiles.
- `tile_batch_size`: how many tiles go through the model in one call; raise it while they fit in memory.
- `tile_blend`: 1 is the usual blend; higher mixes tiles more softly, lower more crisply.

Use it from an existing picture at a low denoise (about 0.2); with KSampler (Advanced), start at a later step
(20 steps, start at 16) so only those last steps are run. From an empty latent every tile draws a picture of
its own.
