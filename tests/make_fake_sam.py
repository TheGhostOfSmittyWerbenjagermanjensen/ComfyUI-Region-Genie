"""Test fixture: a SAM 3.1 checkpoint with ComfyUI's real architecture and key layout but RANDOM weights.
(The real file is on huggingface.co, which this sandbox can't reach.) Masks it makes are meaningless; it exists so
the Select object route runs through ComfyUI's own loader, model detection, text encoder and SAM 3.1 code."""
import sys
import torch
import os
sys.path.insert(0, os.environ.get("COMFY_DIR", "/tmp/comfy_src"))
import comfy.cli_args
comfy.cli_args.args.cpu = True
import comfy.ops
from comfy.ldm.sam3.detector import SAM3Model
from comfy.text_encoders.sam3_clip import SAM3ClipModelWrapper
from safetensors.torch import save_file

torch.manual_seed(0)
DT = torch.float16


def init_(m):
    with torch.no_grad():
        for n, p in m.named_parameters():
            if p.dim() == 1:
                p.copy_(torch.ones_like(p) if ("norm" in n or n.endswith("ln.weight") or "ln_" in n) and n.endswith("weight") else torch.zeros_like(p))
            else:
                p.copy_(torch.randn(p.shape) * 0.02)
        for n, b in m.named_buffers():
            if b.is_floating_point() and not torch.isfinite(b).all():
                b.zero_()


sam = SAM3Model(device="cpu", dtype=DT, operations=comfy.ops.manual_cast, image_model="SAM31")
init_(sam)
sd = {k: v.to(DT).contiguous() for k, v in sam.state_dict().items() if ".attn.freqs_cis" not in k}
del sam

clip = SAM3ClipModelWrapper(device="cpu", dtype=DT)
init_(clip)
csd = clip.state_dict()
del clip
P = "detector.backbone.language_backbone.encoder."
T = "sam3_clip.transformer.text_model."
inv = {"layer_norm1": "ln_1", "layer_norm2": "ln_2", "mlp.fc1": "mlp.c_fc", "mlp.fc2": "mlp.c_proj", "self_attn.out_proj": "attn.out_proj"}
for k, v in list(csd.items()):
    if not k.startswith(T):
        continue
    r = k[len(T):]
    if r == "embeddings.position_embedding.weight":
        sd[P + "positional_embedding"] = v
    elif r == "embeddings.token_embedding.weight":
        sd[P + "token_embedding.weight"] = v
    elif r.startswith("final_layer_norm."):
        sd[P + "ln_final." + r.split(".")[-1]] = v
    elif r.startswith("encoder.layers."):
        parts = r.split(".")
        i, rest = parts[2], ".".join(parts[3:])
        for a, b in inv.items():
            if rest.startswith(a + "."):
                sd[f"{P}transformer.resblocks.{i}.{b}.{rest.split('.')[-1]}"] = v
        if rest.startswith("self_attn.q_proj."):
            y = rest.split(".")[-1]
            q = csd[f"{T}encoder.layers.{i}.self_attn.q_proj.{y}"]
            kk = csd[f"{T}encoder.layers.{i}.self_attn.k_proj.{y}"]
            vv = csd[f"{T}encoder.layers.{i}.self_attn.v_proj.{y}"]
            sd[f"{P}transformer.resblocks.{i}.attn.in_proj_{y}"] = torch.cat([q, kk, vv])
sd = {k: v.to(DT).contiguous() for k, v in sd.items()}
out = sys.argv[1]
save_file(sd, out)
print("saved", out, len(sd), "tensors", sum(v.numel() for v in sd.values()) / 1e6, "M params")
