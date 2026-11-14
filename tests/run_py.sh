#!/usr/bin/env bash
# Python tests with stubbed torch / comfy (no ComfyUI or GPU needed). Needs numpy, Pillow, scipy.
set -e
cd "$(dirname "$0")"
status=0
for t in test_round5.py test_round6.py test_round9.py test_round12.py test_save_image.py test_model_paths.py; do
  echo "== $t"; python3 "$t" || status=1
done
exit $status
