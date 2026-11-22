// Builds the example workflows in example_workflows/ (one per supported model) in a real ComfyUI page, so each
// file is what the current frontend and the current node save. Run it again when the node's saved data changes.
//   COMFY_DIR is not needed; ComfyUI must be running on 127.0.0.1:8188 with this pack installed.
//   node tests/make_examples.cjs            builds every file
//   node tests/make_examples.cjs check      loads every file again (legacy mode and Nodes 2.0) and checks it
// Loaders, file names and sampler settings follow ComfyUI's own templates for each model (comfyui_workflow_templates:
// image_moss_image_t2i(_bboxes), image_krea2_turbo_t2i, image_ideogram4_t2i, flux_dev_full_text_to_image,
// image_flux2_text_to_image, image_flux2_klein_text_to_image, image_flux3_klein_t2i, image_anima_base_v1,
// image_sdxl_simple). tests/test_examples.py checks the files without ComfyUI.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "..", "example_workflows");
const HF = "https://huggingface.co/";

// ---- the demo picture: the same scene and regions in every workflow that has regions
const SCENE = "a quiet harbor at sunrise, soft mist over the water, warm light, painterly";
const NEG = "blurry, low quality, watermark";
const REGIONS = [
    { box: [0.08, 0.2, 0.4, 0.86], prompt: "a white lighthouse on a rocky point, its lamp glowing" },
    { box: [0.5, 0.52, 0.92, 0.84], prompt: "a small red fishing boat with a folded sail, reflected in the calm water" },
    { box: [0.52, 0.1, 0.9, 0.36], prompt: "a flock of seagulls in the pale sky" },
];

// ---- model files: [file, folder under models/, download]
const F = {
    moss: ["moss_image_sft_int8_convrot.safetensors", "diffusion_models", HF + "Comfy-Org/MOSS-Image/resolve/main/diffusion_models/moss_image_sft_int8_convrot.safetensors"],
    mossClip: ["qwen3.5_9b_w4a8_gptq.safetensors", "text_encoders", HF + "Comfy-Org/MOSS-Image/resolve/main/text_encoders/qwen3.5_9b_w4a8_gptq.safetensors"],
    mossVae: ["flux2-vae_small.safetensors", "vae", HF + "Comfy-Org/MOSS-Image/resolve/main/vae/flux2-vae_small.safetensors"],
    krea: ["krea2_turbo_fp8_scaled.safetensors", "diffusion_models", HF + "Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors"],
    kreaClip: ["qwen3vl_4b_fp8_scaled.safetensors", "text_encoders", HF + "Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors"],
    qwenVae: ["qwen_image_vae.safetensors", "vae", HF + "Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors"],
    ideo: ["ideogram4_fp8_scaled.safetensors", "diffusion_models", HF + "Comfy-Org/Ideogram-4/resolve/main/diffusion_models/ideogram4_fp8_scaled.safetensors"],
    ideoUncond: ["ideogram4_unconditional_fp8_scaled.safetensors", "diffusion_models", HF + "Comfy-Org/Ideogram-4/resolve/main/diffusion_models/ideogram4_unconditional_fp8_scaled.safetensors"],
    ideoClip: ["qwen3vl_8b_fp8_scaled.safetensors", "text_encoders", HF + "Comfy-Org/Qwen3-VL/resolve/main/text_encoders/qwen3vl_8b_fp8_scaled.safetensors"],
    flux2Vae: ["flux2-vae.safetensors", "vae", HF + "Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors"],
    flux1: ["flux1-dev.safetensors", "diffusion_models", HF + "Comfy-Org/flux1-dev/resolve/main/flux1-dev.safetensors"],
    clipL: ["clip_l.safetensors", "text_encoders", HF + "comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"],
    t5: ["t5xxl_fp16.safetensors", "text_encoders", HF + "comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors"],
    ae: ["ae.safetensors", "vae", HF + "Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors"],
    flux2: ["flux2_dev_fp8mixed.safetensors", "diffusion_models", HF + "Comfy-Org/flux2-dev/resolve/main/split_files/diffusion_models/flux2_dev_fp8mixed.safetensors"],
    flux2Clip: ["mistral_3_small_flux2_bf16.safetensors", "text_encoders", HF + "Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_bf16.safetensors"],
    flux2SmallVae: ["full_encoder_small_decoder.safetensors", "vae", HF + "black-forest-labs/FLUX.2-small-decoder/resolve/main/full_encoder_small_decoder.safetensors"],
    klein: ["flux-2-klein-4b.safetensors", "diffusion_models", HF + "Comfy-Org/flux2-klein/resolve/main/split_files/diffusion_models/flux-2-klein-4b.safetensors"],
    kleinClip: ["qwen_3_4b.safetensors", "text_encoders", HF + "Comfy-Org/flux2-klein/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors"],
    flux3: ["flux3-image-klein-base-int8-convrot.safetensors", "diffusion_models", HF + "black-forest-labs/flux-3-image-klein-comfy/resolve/main/diffusion_models/flux3-image-klein-base-int8-convrot.safetensors"],
    flux3Clip: ["qwen3vl_4b_int8_convrot.safetensors", "text_encoders", HF + "black-forest-labs/flux-3-image-klein-comfy/resolve/main/text_encoders/qwen3vl_4b_int8_convrot.safetensors"],
    flux3Vae: ["flux2-vae.safetensors", "vae", HF + "black-forest-labs/flux-3-image-klein-comfy/resolve/main/vae/flux2-vae.safetensors"],
    anima: ["anima-base-v1.0.safetensors", "diffusion_models", HF + "circlestone-labs/Anima/resolve/main/split_files/diffusion_models/anima-base-v1.0.safetensors"],
    animaClip: ["qwen_3_06b_base.safetensors", "text_encoders", HF + "circlestone-labs/Anima/resolve/main/split_files/text_encoders/qwen_3_06b_base.safetensors"],
    animaVae: ["qwen_image_vae.safetensors", "vae", HF + "circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors"],
    sdxl: ["sd_xl_base_1.0.safetensors", "checkpoints", HF + "stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"],
    sd15: ["v1-5-pruned-emaonly-fp16.safetensors", "checkpoints", HF + "Comfy-Org/stable-diffusion-v1-5-archive/resolve/main/v1-5-pruned-emaonly-fp16.safetensors"],
};

// ---- the graphs. "rg" is the Region Genie node, "save" the Save Image (Region Genie) node; both are added by build().
// nodes: [key, type, widgets by name, model file(s)]; links: [from key, output name, to key, input name]
const unet = (f) => ["unet", "UNETLoader", { unet_name: f[0], weight_dtype: "default" }, [f]];
const clip = (f, type) => ["clip", "CLIPLoader", { clip_name: f[0], type, device: "default" }, [f]];
const vae = (f) => ["vae", "VAELoader", { vae_name: f[0] }, [f]];
const LOAD3 = [["unet", "MODEL", "rg", "model"], ["clip", "CLIP", "rg", "clip"], ["vae", "VAE", "rg", "vae"]];
const KS = (steps, cfg, sampler, scheduler) => ["ks", "KSampler", { seed: 0, steps, cfg, sampler_name: sampler, scheduler, denoise: 1 }];
const KS_LINKS = [["rg", "model", "ks", "model"], ["rg", "positive", "ks", "positive"], ["rg", "negative", "ks", "negative"], ["rg", "latent", "ks", "latent_image"],
    ["ks", "LATENT", "dec", "samples"], ["vae", "VAE", "dec", "vae"]];
const CUSTOM = [["noise", "RandomNoise", { noise_seed: 0 }], ["sel", "KSamplerSelect", { sampler_name: "euler" }], ["sca", "SamplerCustomAdvanced", {}]];
const CUSTOM_LINKS = [["noise", "NOISE", "sca", "noise"], ["sel", "SAMPLER", "sca", "sampler"], ["rg", "latent", "sca", "latent_image"], ["sca", "output", "dec", "samples"], ["vae", "VAE", "dec", "vae"],
    ["rg", "width", "sch", "width"], ["rg", "height", "sch", "height"], ["sch", "SIGMAS", "sca", "sigmas"]];
const mossNodes = (slg) => [unet(F.moss), clip(F.mossClip, "moss_image"), vae(F.mossVae),
    ...(slg ? [["slg", "SkipLayerGuidanceDiTSimple", { double_layers: "", single_layers: "22", start_percent: 0, end_percent: 0.5 }]] : []), KS(25, 2.5, "er_sde", "simple")];
const MOSS_NEG = "nsfw, worst quality, bad anatomy, watermark, jpeg artifact";

const SPECS = [
    { file: "01-moss-image-layout", title: "MOSS-Image: layout (regions)", regions: true, neg: MOSS_NEG, nodes: mossNodes(true),
      links: [["unet", "MODEL", "slg", "model"], ["slg", "MODEL", "rg", "model"], ...LOAD3.slice(1), ...KS_LINKS],
      note: "Each region's box and prompt go to MOSS-Image in its own layout format (the layout / standard switch in the node's bottom bar shows which is in use).\n\nSkip-layer guidance (layer 22, first half of the steps) is on, as in ComfyUI's own MOSS-Image layout template." },
    { file: "02-moss-image-text-to-image", title: "MOSS-Image: plain text-to-image (no regions)", regions: false, neg: MOSS_NEG, nodes: mossNodes(false), links: [...LOAD3, ...KS_LINKS],
      scene: "Cinematic photograph of a quiet harbor at sunrise: a white lighthouse on a rocky point, a small red fishing boat on calm water, seagulls in a pale sky, soft mist, warm low light, 35mm film grain",
      note: "No regions: the canvas is empty, so the node works as a plain prompt node. scene_prompt_positive and scene_prompt_negative are the prompts, the size row sets the image size.\n\nDraw a region at any time to switch to a layout." },
    { file: "03-krea-2", title: "Krea 2 (Turbo)", regions: true, nodes: [unet(F.krea), clip(F.kreaClip, "krea2"), vae(F.qwenVae), KS(8, 1, "euler", "simple")], links: [...LOAD3, ...KS_LINKS],
      note: "Krea 2 has no layout format: the Separate button ties each prompt to its region by attention (it turns on by itself).\n\nTurbo runs at cfg 1, so the negative prompt has no effect." },
    { file: "04-ideogram-4", title: "Ideogram 4", regions: true,
      nodes: [unet(F.ideo), ["unetNeg", "UNETLoader", { unet_name: F.ideoUncond[0], weight_dtype: "default" }, [F.ideoUncond]], clip(F.ideoClip, "ideogram4"), vae(F.flux2Vae),
          ["cfgo", "CFGOverride", { cfg: 3, start_percent: 0.7, end_percent: 1 }], ["zero", "ConditioningZeroOut", {}], ["guider", "DualModelGuider", { cfg: 7 }],
          ["sch", "Ideogram4Scheduler", { steps: 20, mu: 0, std: 1.75 }], ...CUSTOM],
      links: [...LOAD3, ["rg", "model", "cfgo", "model"], ["cfgo", "MODEL", "guider", "model"], ["rg", "positive", "guider", "positive"], ["unetNeg", "MODEL", "guider", "model_negative"],
          ["rg", "positive", "zero", "conditioning"], ["zero", "CONDITIONING", "guider", "negative"], ["guider", "GUIDER", "sca", "guider"], ...CUSTOM_LINKS],
      note: "Each region's box and prompt go to Ideogram 4 in its own caption format.\n\nThe sampler part is ComfyUI's own Ideogram 4 template (\"Default\" preset: 20 steps, mu 0, std 1.75): a second, unconditional model guides instead of a negative prompt, so scene_prompt_negative is not used." },
    { file: "05-flux-1-dev", title: "Flux.1 dev", regions: true,
      nodes: [unet(F.flux1), ["clip", "DualCLIPLoader", { clip_name1: F.clipL[0], clip_name2: F.t5[0], type: "flux", device: "default" }, [F.clipL, F.t5]], vae(F.ae), KS(20, 1, "euler", "simple")],
      links: [...LOAD3, ...KS_LINKS], note: "Flux.1 has no layout format: the Separate button ties each prompt to its region by attention (it turns on by itself).\n\nFlux.1 dev runs at cfg 1, so the negative prompt has no effect." },
    { file: "06-flux-2-dev", title: "Flux.2 dev", regions: true,
      nodes: [unet(F.flux2), clip(F.flux2Clip, "flux2"), vae(F.flux2SmallVae), ["fg", "FluxGuidance", { guidance: 4 }], ["guider", "BasicGuider", {}], ["sch", "Flux2Scheduler", { steps: 20 }], ...CUSTOM],
      links: [...LOAD3, ["rg", "positive", "fg", "conditioning"], ["fg", "CONDITIONING", "guider", "conditioning"], ["rg", "model", "guider", "model"], ["guider", "GUIDER", "sca", "guider"], ...CUSTOM_LINKS],
      note: "Flux.2 has no layout format: the Separate button ties each prompt to its region by attention (it turns on by itself).\n\nFlux.2 dev uses guidance (4) instead of a negative prompt, so scene_prompt_negative is not used." },
    { file: "07-flux-2-klein", title: "Flux.2 Klein (4B, distilled)", regions: true,
      nodes: [unet(F.klein), clip(F.kleinClip, "flux2"), vae(F.flux2Vae), ["guider", "CFGGuider", { cfg: 1 }], ["sch", "Flux2Scheduler", { steps: 4 }], ...CUSTOM],
      links: [...LOAD3, ["rg", "model", "guider", "model"], ["rg", "positive", "guider", "positive"], ["rg", "negative", "guider", "negative"], ["guider", "GUIDER", "sca", "guider"], ...CUSTOM_LINKS],
      note: "Flux.2 Klein has no layout format: the Separate button ties each prompt to its region by attention (it turns on by itself).\n\nThe distilled model runs 4 steps at cfg 1, so the negative prompt has no effect. For the base model (flux-2-klein-base-4b) use 20 steps and cfg 5." },
    { file: "08-flux-3-klein", title: "Flux 3 Klein", regions: true, nodes: [unet(F.flux3), clip(F.flux3Clip, "flux3"), vae(F.flux3Vae), KS(50, 3.5, "euler", "simple")], links: [...LOAD3, ...KS_LINKS],
      note: "Flux 3 has no layout format in this node: the Separate button ties each prompt to its region by attention (it turns on by itself).\n\nSettings are those of ComfyUI's Flux 3 Klein (base) template: 50 steps, cfg 3.5. For the distilled model (flux3-image-klein-int8-convrot) use 16 steps and cfg 1." },
    { file: "09-anima", title: "Anima", regions: true, neg: "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia",
      nodes: [unet(F.anima), clip(F.animaClip, "stable_diffusion"), vae(F.animaVae), KS(30, 4, "euler", "simple")], links: [...LOAD3, ...KS_LINKS],
      note: "Anima has no layout format: the Separate button ties each prompt to its region by attention (it turns on by itself)." },
    { file: "10-sdxl", title: "SDXL", regions: true,
      nodes: [["ckpt", "CheckpointLoaderSimple", { ckpt_name: F.sdxl[0] }, [F.sdxl]], KS(25, 7, "dpmpp_2m", "karras")],
      links: [["ckpt", "MODEL", "rg", "model"], ["ckpt", "CLIP", "rg", "clip"], ["ckpt", "VAE", "rg", "vae"], ...KS_LINKS.slice(0, 5), ["ckpt", "VAE", "dec", "vae"]],
      note: "SDXL has no layout format: the Separate button ties each prompt to its region by attention (it turns on by itself).\n\nAny SDXL-based checkpoint works here (Illustrious-XL, NoobAI-XL ...): pick yours in the loader." },
    { file: "11-sd-1-5", title: "SD1.5", regions: true, size: [512, 512],
      nodes: [["ckpt", "CheckpointLoaderSimple", { ckpt_name: F.sd15[0] }, [F.sd15]], KS(20, 8, "euler", "normal")],
      links: [["ckpt", "MODEL", "rg", "model"], ["ckpt", "CLIP", "rg", "clip"], ["ckpt", "VAE", "rg", "vae"], ...KS_LINKS.slice(0, 5), ["ckpt", "VAE", "dec", "vae"]],
      note: "SD1.5 has no layout format: the Separate button ties each prompt to its region by attention (it turns on by itself).\n\nThe image size is 512 × 512, SD1.5's own." },
];

const noteText = (spec) => {
    const files = [], seen = new Set();
    for (const n of spec.nodes) for (const f of n[3] || []) { if (!seen.has(f[0])) { seen.add(f[0]); files.push(f); } }
    return `## Region Genie: ${spec.title}\n\n${spec.note}\n\n**Model files** (pick your own in the loaders if yours are named differently):\n`
        + files.map((f) => `- [${f[0]}](${f[2]}) → \`models/${f[1]}\``).join("\n")
        + "\n\nManual: https://github.com/TheGhostOfSmittyWerbenjagermanjensen/ComfyUI-Region-Genie";
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(vue) {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1700, height: 1750 } });
    await page.goto("http://127.0.0.1:8188/");
    await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.setting, null, { timeout: 90000 });
    await sleep(1500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await sleep(150); }
    await page.evaluate(async (vue) => { const s = window.app.extensionManager.setting; await s.set("Comfy.VueNodes.Enabled", vue); await s.set("Comfy.Locale", "en"); try { await s.set("Comfy.Minimap.Visible", false); } catch (e) { /* older */ } }, vue);
    await sleep(800);
    return { browser, page };
}

async function build(page, spec) {
    // 1. the Region Genie node alone, at 100 %: its regions are drawn with the mouse, as a user would
    await page.evaluate(async () => {
        const app = window.app, LG = window.LiteGraph; app.graph.clear();
        const rg = LG.createNode("Region-Genie_Main"); rg.pos = [90, 110]; app.graph.add(rg);
        app.canvas.ds.offset = [0, 0]; app.canvas.ds.scale = 1; app.canvas.setDirty(true, true); window.__rg = rg;
        await new Promise((r) => setTimeout(r, 1800));
    });
    if (spec.size) {
        await page.evaluate(([w, h]) => { const n = window.__rg; for (const [name, v] of [["width", w], ["height", h]]) { const wd = n.widgets.find((x) => x.name === name); wd.value = v; wd.callback?.(v); } n.__rgSyncSize(); }, spec.size);
        await sleep(900);
    }
    if (spec.regions) {
        // the image's rectangle on the canvas: the empty image is black, the area around it a checkerboard
        const [x, y, w, h] = await page.evaluate(() => {
            const c = document.querySelector(".rg-cv canvas"), r = c.getBoundingClientRect(), ctx = c.getContext("2d");
            const black = (px, py) => { const d = ctx.getImageData(px, py, 1, 1).data; return d[0] + d[1] + d[2] < 12 && d[3] > 250; };
            const cx = c.width >> 1, cy = c.height >> 1; let x0 = cx, x1 = cx, y0 = cy, y1 = cy;
            while (x0 > 0 && black(x0 - 1, cy)) x0--; while (x1 < c.width - 1 && black(x1 + 1, cy)) x1++;
            while (y0 > 0 && black(cx, y0 - 1)) y0--; while (y1 < c.height - 1 && black(cx, y1 + 1)) y1++;
            const sx = r.width / c.width, sy = r.height / c.height;
            return [r.x + x0 * sx, r.y + y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy];
        });
        const add = page.locator('[title^="Add a region with a new color"]');
        for (const r of REGIONS) {
            await add.click(); await sleep(150);
            const [a, b, c, d] = r.box;
            await page.mouse.move(x + w * a, y + h * b); await page.mouse.down(); await page.mouse.move(x + w * c, y + h * d, { steps: 5 }); await page.mouse.up(); await sleep(300);
        }
        await page.keyboard.press("v"); await page.mouse.click(x + w * 0.5, y + h * 0.97); await sleep(150);        // Select tool, nothing selected
        // each prompt to the region whose layer was drawn for it (the layers are in drawing order)
        const order = await page.evaluate((prompts) => { const n = window.__rg, s = n.__rgState();
            s.layers.forEach((L, i) => { const r = s.regions.find((x) => x.id === L.region); if (r) r.prompt = prompts[i]; }); n.__rgRefresh(); return s.regions.map((r) => r.prompt.slice(0, 12)); }, REGIONS.map((r) => r.prompt));
        if (new Set(order).size !== REGIONS.length) throw new Error("regions and prompts don't match: " + order.join(" | "));
    }
    await page.evaluate(([pos, neg]) => { const n = window.__rg; for (const [name, v] of [["scene_prompt_positive", pos], ["scene_prompt_negative", neg]]) { const wd = n.widgets.find((x) => x.name === name); wd.value = v; wd.callback?.(v); } },
        [spec.scene || SCENE, spec.neg || NEG]);
    // width / height outputs, where a scheduler needs them
    if (spec.links.some((l) => l[0] === "rg" && (l[1] === "width" || l[1] === "height"))) {
        await page.locator(".rg-socks-btn").click(); await sleep(300);
        for (const key of ["width", "height"]) { await page.locator(`.rg-socks label[data-sock="${key}"] input`).click(); await sleep(900); }
        await page.keyboard.press("Escape"); await page.mouse.click(5, 5); await sleep(300);
    }
    // 2. the other nodes and the links
    const res = await page.evaluate(async ({ spec, note }) => {
        const app = window.app, LG = window.LiteGraph, rg = window.__rg, by = { rg }, errors = [];
        const set = (n, values) => { for (const [name, v] of Object.entries(values || {})) { const w = n.widgets?.find((x) => x.name === name); if (!w) { errors.push(`${n.type}: no widget ${name}`); continue; } w.value = v; } };
        const make = (key, type, values, files) => {
            const n = LG.createNode(type); if (!n) { errors.push("no node type " + type); return null; }
            app.graph.add(n); set(n, values);
            if (files?.length) n.properties.models = files.map(([name, directory, url]) => ({ name, url, directory }));      // ComfyUI offers the download when a file is missing
            by[key] = n; return n;
        };
        for (const [key, type, values, files] of spec.nodes) make(key, type, values, files);
        make("dec", "VAEDecode", {});
        make("save", "Region-Genie_SaveImage", { filename_prefix: "RegionGenie/" + spec.file.replace(/^\d+-/, "") });
        const nt = make("note", "MarkdownNote", { text: note });
        const idx = (list, name) => { let i = (list || []).findIndex((s) => s.name === name); if (i < 0) i = (list || []).findIndex((s) => s.type === name); return i; };
        const link = (a, out, b, inp) => {
            const A = by[a], B = by[b]; if (!A || !B) { errors.push(`link ${a}.${out} -> ${b}.${inp}: node missing`); return; }
            let o = idx(A.outputs, out), i = idx(B.inputs, inp);
            if (i < 0) { const w = B.widgets?.find((x) => x.name === inp); if (w && B.convertWidgetToInput) { B.convertWidgetToInput(w); i = idx(B.inputs, inp); } }
            if (o < 0 || i < 0) { errors.push(`link ${a}.${out} -> ${b}.${inp}: socket not found (${o}, ${i})`); return; }
            if (!A.connect(o, B, i)) errors.push(`link ${a}.${out} -> ${b}.${inp}: refused`);
        };
        for (const l of spec.links) link(...l);
        link("dec", "IMAGE", "save", "images");
        await new Promise((r) => setTimeout(r, 600));
        // 3. places: loaders | Region Genie | sampler nodes | decode and save; the note under the loaders
        const col = (keys, x, y0) => { let y = y0; for (const k of keys) { const n = by[k]; if (!n) continue; n.pos = [x, y]; y += n.size[1] + 70; } return y; };
        const loaders = spec.nodes.filter((n) => /Loader/.test(n[1])).map((n) => n[0]);
        const pre = spec.nodes.filter((n) => n[0] === "slg").map((n) => n[0]);
        const mid = spec.nodes.map((n) => n[0]).filter((k) => !loaders.includes(k) && !pre.includes(k));
        const yNote = col([...loaders, ...pre], 40, 80);
        nt.pos = [40, yNote + 10]; nt.size = [360, 420];
        rg.pos = [460, 80];
        col(mid, 460 + rg.size[0] + 60, 80);
        const xr = 460 + rg.size[0] + 60 + Math.max(...mid.map((k) => by[k].size[0]), 300) + 60;
        col(["dec", "save"], xr, 80);
        app.canvas.ds.scale = 0.55; app.canvas.ds.offset = [110, 60]; app.canvas.setDirty(true, true);
        await new Promise((r) => setTimeout(r, 500));
        // required inputs: each is a link or a widget
        const defs = await (await fetch("/object_info")).json();
        for (const n of app.graph._nodes) {
            const req = defs[n.type]?.input?.required || {};
            for (const name of Object.keys(req)) {
                const inp = n.inputs?.find((i) => i.name === name), wid = n.widgets?.find((w) => w.name === name);
                if (!(inp && inp.link != null) && !wid) errors.push(`${n.type}: required input ${name} is not connected`);
            }
        }
        const info = { regions: rg.__rgState().regions.length, layers: rg.__rgState().layers.length, dims: [rg.widgets.find((w) => w.name === "width").value, rg.widgets.find((w) => w.name === "height").value],
            model: document.querySelector(".rg-foot select")?.selectedOptions?.[0]?.textContent || "", outs: rg.outputs.map((o) => o.name).join(",") };
        const ns = app.graph._nodes;
        for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) { const A = ns[i], B = ns[j];
            if (A.pos[0] < B.pos[0] + B.size[0] && B.pos[0] < A.pos[0] + A.size[0] && A.pos[1] - 30 < B.pos[1] + B.size[1] && B.pos[1] - 30 < A.pos[1] + A.size[1]) errors.push(`${A.type} and ${B.type} overlap`); }
        const data = app.graph.serialize();
        data.extra = { ...(data.extra || {}), ds: { scale: 0.55, offset: [110, 60] } };
        return { errors, info, data };
    }, { spec, note: noteText(spec) });
    return res;
}

async function check(page, mode) {
    let bad = 0;
    for (const spec of SPECS) {
        const data = JSON.parse(fs.readFileSync(path.join(OUT, spec.file + ".json"), "utf8"));
        const r = await page.evaluate(async (data) => {
            const app = window.app; await app.loadGraphData(data); await new Promise((r) => setTimeout(r, 2500));
            const rg = app.graph._nodes.find((n) => n.type === "Region-Genie_Main");
            const missing = app.graph._nodes.filter((n) => !window.LiteGraph.registered_node_types[n.type]).map((n) => n.type);
            const p = await app.graphToPrompt();
            const linksOk = Object.values(p.output).every((n) => Object.values(n.inputs).every((v) => !Array.isArray(v) || v.length !== 2 || typeof v[0] !== "string" || p.output[v[0]]));
            const rgOut = p.output[String(rg.id)];
            const users = Object.values(p.output).flatMap((n) => Object.entries(n.inputs).filter(([, v]) => Array.isArray(v) && v[0] === String(rg.id)).map(([k, v]) => `${n.class_type}.${k}=${v[1]}`));
            return { nodes: app.graph._nodes.length, missing, regions: rg.__rgState?.().regions.length, linksOk, prompt: Object.keys(p.output).length, users, shown: rgOut?.inputs?.outputs_shown,
                dialog: !!document.querySelector(".p-dialog, .comfy-missing-nodes") && document.querySelector(".p-dialog")?.textContent?.slice(0, 80) };
        }, data);
        const NAMES = ["model", "positive", "negative", "latent", "prompt", "color_map", "masks", "bboxes", "elements", "character_boxes", "region_info", "width", "height", "pose_keypoint"];
        const want = spec.links.filter((l) => l[0] === "rg").map((l) => NAMES.indexOf(l[1])).sort().join();
        const got = r.users.map((u) => +u.split("=")[1]).sort().join();
        const ok = r.nodes === data.nodes.length && !r.missing.length && r.regions === (spec.regions ? REGIONS.length : 0) && r.linksOk && r.shown === "" && want === got;
        if (!ok) bad++;
        console.log(`${ok ? "PASS" : "FAIL"} ${mode}: ${spec.file}: ${r.nodes} nodes, ${r.regions} regions, outputs used ${got}${ok ? "" : " " + JSON.stringify(r)}`);
        for (let i = 0; i < 2; i++) { await page.keyboard.press("Escape"); await sleep(100); }
    }
    return bad;
}

(async () => {
    if (process.argv[2] === "check") {
        let bad = 0;
        for (const vue of [false, true]) { const { browser, page } = await open(vue); bad += await check(page, vue ? "Nodes 2.0" : "legacy"); await browser.close(); }
        console.log(bad ? `\n${bad} failed` : "\nall passed"); process.exit(bad ? 1 : 0);
    }
    fs.mkdirSync(OUT, { recursive: true });
    const { browser, page } = await open(false);
    let bad = 0;
    for (const spec of SPECS) {
        const r = await build(page, spec);
        const ok = !r.errors.length && r.info.regions === (spec.regions ? REGIONS.length : 0);
        if (!ok) bad++;
        console.log(`${ok ? "built" : "FAILED"} ${spec.file}: ${JSON.stringify(r.info)} ${r.errors.join("; ")}`);
        fs.writeFileSync(path.join(OUT, spec.file + ".json"), JSON.stringify(r.data, null, 2) + "\n");
        if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, spec.file + ".png") });
    }
    await browser.close();
    process.exit(bad ? 1 : 0);
})();
