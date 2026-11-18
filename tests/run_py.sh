#!/usr/bin/env bash
# Python tests with stubbed torch / comfy (no ComfyUI or GPU needed). Needs numpy, Pillow, scipy.
set -e
cd "$(dirname "$0")"
status=0
for t in test_edit_mode.py test_shapes_import.py test_hidden_regions.py test_prompt_format.py test_save_image.py test_model_paths.py test_i18n.py; do
  echo "== $t"; python3 "$t" || status=1
done
exit $status
