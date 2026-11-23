# LLM Prompt Enhancer

Region prompts and `scene_prompt_positive` can be rewritten by an LLM when the workflow runs, before the layout is built, so the LLM never sees or touches the JSON.

**In short:**

1. Press the sparkles button on a region (or on *Whole image*). Lit means on.
2. Run the workflow. The LLM rewrites that prompt; a green dot on the button says the result is ready (hover to read it).
3. Click the lit button to go back to your own text, or to keep the LLM's text and edit it.
4. The sparkles button in the bottom bar opens **LLM Settings**: which LLM, what it sees, and the presets.

Nothing needs installing: by default it uses the text encoder already connected to `clip`.

**The details:**

- **Turning it on:** the sparkles button on a region row (or on the *Whole image* row, for `scene_prompt_positive`). Lit = on.
  - The same button is in the corner of the `scene_prompt_positive` box itself, and that box has a blue outline while its enhancer is on.
  - A green dot means the text used in the last run is ready; hover to read it (and the thinking, if any).
  - An orange dot means the LLM returned nothing last time, so the typed prompt was used.
- **Turning it off:** click the lit button and choose:
  - *restore my original prompt*: your typed prompt is used again.
  - *keep the enhanced text to edit*: the enhanced text replaces your prompt in the field, for editing by hand (Ctrl+Z undoes it for regions).
  - With no result yet it just turns off.
- **Right-click** the button: run again with a new seed, copy the enhanced text or the thinking, keep the enhanced text, or open LLM Settings.
- **When the LLM runs:** only when a prompt, its preset or "what the LLM sees" changed.
  - Results are reused across runs in the session and from saved workflows. A workflow keeps the results it used and brings them back when it is opened, also after a restart.
  - LoRA trigger words in your prompt that the LLM dropped are added back.
- **LLM cache** (Settings > Region Genie > LLM Prompt Enhancer > LLM cache):
  - *Keep LLM results on disk between ComfyUI restarts* is off by default, since workflows already carry their own results.
    - On, they are also saved to `<ComfyUI user dir>/region_genie/llm_cache.json`, which only helps workflows queued through the API without being opened.
    - Turning it off deletes that file.
  - *Forget LLM results after* (days, default 30; 0 = never) and *Most LLM results to keep* (default 500, oldest dropped first) apply to the memory and the disk cache.
- **LLM Settings** (the sparkles button at the bottom of the node):
  - *What the LLM sees:* only the prompt, or the prompt plus the scene and the other regions as context (it still rewrites only the one prompt). The default is in Settings.
  - *Preset for each prompt type:* character, object, text and scene each use a preset. Choosing one here changes this node only; *Make default* applies it to every node that hasn't chosen its own.
  - *Edit preset:* presets live in your ComfyUI user data (`region_genie/llm_presets.json`) and are shared by all workflows.
    - Each has:
      - The LLM: the connected `clip` by default (for MOSS-Image that is its Qwen3.5 9B already in memory), or a file from `models/text_encoders` with its Load CLIP type.
      - LLM-only LoRAs with strengths. They are applied like core "Load LoRA (Text Encoder)", to a copy, so the image model and the clip used for conditioning are not changed.
      - The system prompt.
      - Every setting of core "Generate Text" (`max_length`, sampling with `temperature`, `top_k`, `top_p`, `min_p`, `repetition_penalty`, `presence_penalty`, `seed`, `thinking`, the default template, `mtp`).
    - Defaults: `max_length` 8192, sampling off, thinking on, default template on, `mtp` auto.
    - As in Generate Text, with sampling off the sampling values and the seed are hidden and not used (greedy decoding: the same input always gives the same text), and changing them doesn't make the LLM run again.
    - New, Save (rename by changing the name), Delete.
    - A workflow keeps a copy of the settings it used, so it gives the same result on another machine. A preset that is only in a workflow can be saved to your library.
  - *The LLM file and the LLM LoRAs:* file fields that open ComfyUI's menu (the LLM: "None (the connected clip …)" and `models/text_encoders`; a LoRA: `models/loras`).
    - With *Browse… for model files* on (Settings > Region Genie) each has the folder button (**Browse…**) too, so a file kept anywhere on the ComfyUI machine works (saved by its full path).
- **The same in ComfyUI's Settings** (Settings > Region Genie > LLM Prompt Enhancer):
  - The page has the pop-up's sections:
    - **Preset for each prompt type:** the default preset for Character, Object, Text and Scene.
    - **Edit preset (shared by all your workflows):** *Preset* picks the one to edit (with New and Delete), and its fields follow right below.
    - The fields: Name, LLM (with Browse…), LLM type, LLM LoRAs, System prompt, max_length, sampling, temperature … seed, thinking, default template, mtp.
  - **Delete** is off while the preset is the default of a prompt type: choose another default first. The last remaining preset can't be deleted.
  - They edit the same presets as the node's LLM Settings and save at once. The sampling values are greyed out while sampling is off.
  - A node's own choices (its preset per type, its own *What the LLM sees*) stay in the node's LLM Settings.
- The generation is ComfyUI's own Generate Text node, called with these settings; it works with the LLM types Generate Text supports (Qwen3 / Qwen3.5, Gemma ...).

[← Back to the README](../README.md)
