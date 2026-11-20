# Save Image (Region Genie)

Saves images to ComfyUI's output folder like ComfyUI's own save node, with more formats and their compression or
quality settings, to keep generated images smaller on disk.

- `format`: png, webp, jpeg, avif or exr. Only the settings of the chosen format show on the node.
- The workflow is stored in the file where the format allows it; for JPEG, `jpeg_workflow` chooses a sidecar
  `.json`, the JPEG itself (EXIF) or none.
- `mask` gives PNG, WebP, AVIF and EXR an alpha channel (1 = transparent, like Load Image's mask); `invert_mask` flips it. JPEG has no transparency.
- `a1111_metadata` (on by default) also writes what the image was made with (prompt, seed, steps, sampler, cfg, model,
  LoRAs) as text the way A1111 and Forge do, so other interfaces and sites can read it. It is read from the workflow
  that ran; nothing has to be connected. When another node computes a value (a seed, say), the node says so after the
  run: the **cable button** at the end of its status line lists optional inputs to connect such values to.
- The defaults for new nodes are in **Settings > Region Genie > Save Image**.

The full manual: [Save Image (Region Genie)](https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie/blob/main/docs/save-image.md).
