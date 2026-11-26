#!/usr/bin/env bash
# Python tests with stubbed torch / comfy (no ComfyUI or GPU needed). Needs numpy, Pillow, scipy; hypothesis for test_properties.py (without it that file is skipped).
set -e
cd "$(dirname "$0")"
status=0
for t in test_edit_mode.py test_shapes_import.py test_hidden_regions.py test_prompt_format.py test_save_image.py test_gen_params.py test_model_paths.py test_i18n.py test_examples.py test_properties.py test_image_compare.py; do
  echo "== $t"; python3 "$t" || status=1
done
exit $status
