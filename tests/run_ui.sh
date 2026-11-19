#!/usr/bin/env bash
# Browser tests of the editor in a stub page (no ComfyUI needed). Needs Node and Playwright with Chromium:
#   npm i -D playwright && npx playwright install chromium
set -e
cd "$(dirname "$0")"
mkdir -p harness/extensions/rg out
rm -rf harness/extensions/rg && mkdir -p harness/extensions/rg && cp -r ../js/. harness/extensions/rg/
python3 -m http.server 8765 --bind 127.0.0.1 --directory harness >/dev/null 2>&1 & SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
status=0
for t in ui_editor.cjs ui_footer_tools.cjs ui_select_object.cjs ui_rows_popups.cjs ui_hints_notes.cjs ui_region_rows.cjs; do
  echo "== $t"; node "$t" || status=1
done
exit $status
