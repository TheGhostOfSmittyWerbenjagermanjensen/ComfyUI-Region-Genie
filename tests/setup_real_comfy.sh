#!/usr/bin/env bash
# Sets up a real ComfyUI (CPU, no model files) with this pack and ComfyUI Impact Pack, for tests/real_run_wildcards.cjs.
#
#   bash tests/setup_real_comfy.sh [DIR] [--start]
#
# DIR: where ComfyUI goes (default /tmp/comfy_src). --start: also start ComfyUI on 127.0.0.1:8188 in the background and
# wait until it is ready (log: DIR/comfy.log). Safe to run again: what is already there is kept.
# Downloads about 5 GB (torch from PyPI and ComfyUI's requirements); a few minutes on a cloud machine.
# Environment: COMFY_TAG (default v0.45.2, the ComfyUI release the tests were written against), COMFY_PORT (default 8188).
set -euo pipefail
PACK="$(cd "$(dirname "$0")/.." && pwd)"
DIR="/tmp/comfy_src"; START=0
for a in "$@"; do case "$a" in --start) START=1 ;; *) DIR="$a" ;; esac; done
TAG="${COMFY_TAG:-v0.45.2}"; PORT="${COMFY_PORT:-8188}"
PIP=(python3 -m pip install -q)
if python3 -m pip install --help 2>/dev/null | grep -q -- --break-system-packages; then PIP+=(--break-system-packages); fi

echo "== ComfyUI $TAG in $DIR"
[ -d "$DIR/.git" ] || git clone -q --depth 1 https://github.com/Comfy-Org/ComfyUI.git "$DIR"
git -C "$DIR" fetch -q --depth 1 origin tag "$TAG"
git -C "$DIR" checkout -q "$TAG"

echo "== Python packages (torch from PyPI, ComfyUI's requirements, the tests' extras)"
"${PIP[@]}" torch torchvision torchaudio
"${PIP[@]}" -r "$DIR/requirements.txt"
"${PIP[@]}" scipy segment-anything

echo "== ComfyUI Impact Pack (for the wildcard checks) and this pack"
IMPACT="$DIR/custom_nodes/ComfyUI-Impact-Pack"
[ -d "$IMPACT/.git" ] || git clone -q --depth 1 https://github.com/ltdrdata/ComfyUI-Impact-Pack.git "$IMPACT"
REQS="$(mktemp)"
grep -v -E "sam2|segment-anything" "$IMPACT/requirements.txt" > "$REQS" || true      # SAM extras aren't needed for wildcards
"${PIP[@]}" -r "$REQS"
rm -f "$REQS"
ln -sfn "$PACK" "$DIR/custom_nodes/ComfyUI-Region-Genie"
mkdir -p "$IMPACT/wildcards/rgtest"
printf "red\ngreen\nblue\npurple\n" > "$IMPACT/wildcards/rgtest/color.txt"         # the test wildcard real_run_wildcards.cjs uses

echo "== ComfyUI-Custom-Scripts (tag autocomplete, for tests/real_layering.cjs) and a LoRA file for the LoRA menu"
SCRIPTS="$DIR/custom_nodes/ComfyUI-Custom-Scripts"
[ -d "$SCRIPTS/.git" ] || git clone -q --depth 1 https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git "$SCRIPTS"
mkdir -p "$SCRIPTS/user" "$DIR/models/loras"
[ -s "$SCRIPTS/user/autocomplete.txt" ] || printf "blue_sky\nblack_cat\nblonde_hair\nblush\nblurry_background\n" > "$SCRIPTS/user/autocomplete.txt"
[ -e "$DIR/models/loras/rgtest_layering.safetensors" ] || : > "$DIR/models/loras/rgtest_layering.safetensors"

echo "== rgthree-comfy with its menu folders on, and LoRA files in sub-folders (tests/real_menu_search.cjs)"
RGTHREE="$DIR/custom_nodes/rgthree-comfy"
[ -d "$RGTHREE/.git" ] || git clone -q --depth 1 https://github.com/rgthree/rgthree-comfy.git "$RGTHREE"
[ -s "$RGTHREE/rgthree_config.json" ] || printf '{\n  "features": { "menu_auto_nest": { "subdirs": true, "threshold": 20 } }\n}\n' > "$RGTHREE/rgthree_config.json"
mkdir -p "$DIR/models/loras/Flux/Styles" "$DIR/models/loras/SDXL"
for n in 1 2 3; do : > "$DIR/models/loras/Flux/Styles/flux_style_$n.safetensors"; : > "$DIR/models/loras/SDXL/sdxl_lora_$n.safetensors"; done
for n in $(seq 1 24); do [ -e "$DIR/models/loras/style_$n.safetensors" ] || : > "$DIR/models/loras/style_$n.safetensors"; done   # past rgthree's threshold of 20

echo "== a test image in the input folder (real_smoke.cjs, real_sockets.cjs)"
mkdir -p "$DIR/input"
[ -e "$DIR/input/rg_test.png" ] || python3 -c "from PIL import Image; Image.new('RGB', (768, 512), (90, 140, 200)).save('$DIR/input/rg_test.png')"

if [ "$START" = 1 ]; then
    echo "== starting ComfyUI on 127.0.0.1:$PORT (log: $DIR/comfy.log)"
    # detached: its own output goes to the log, so this script (and a pipe it writes to) can finish
    ( cd "$DIR" && exec nohup python3 main.py --cpu --listen 127.0.0.1 --port "$PORT" ) > "$DIR/comfy.log" 2>&1 < /dev/null &
    PID=$!
    for _ in $(seq 1 180); do
        if grep -q "To see the GUI" "$DIR/comfy.log" 2>/dev/null; then echo "ready (pid $PID)"; break; fi
        if ! kill -0 "$PID" 2>/dev/null; then echo "ComfyUI stopped while starting:"; tail -8 "$DIR/comfy.log"; exit 1; fi
        sleep 1
    done
    grep -q "To see the GUI" "$DIR/comfy.log" || { echo "ComfyUI didn't start within 3 minutes:"; tail -8 "$DIR/comfy.log"; exit 1; }
    grep -E "IMPORT FAILED" "$DIR/comfy.log" && { echo "a custom node failed to import (see $DIR/comfy.log)"; exit 1; } || true
else
    echo "== done. Start it with: cd $DIR && python3 main.py --cpu --listen 127.0.0.1 --port $PORT"
fi
echo "Then: node tests/real_run_wildcards.cjs   and   node tests/real_run_wildcards.cjs vue   (and COMFY_DIR=$DIR python3 tests/test_control.py)"
