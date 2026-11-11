#!/usr/bin/env bash
# Browser tests of the editor in a stub page (no ComfyUI needed). Needs Node and Playwright with Chromium:
#   npm i -D playwright && npx playwright install chromium
set -e
cd "$(dirname "$0")"
mkdir -p harness/extensions/rg out
cp ../js/*.js harness/extensions/rg/
(cd harness && python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1) & SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
status=0
for t in ui_test.cjs ui_test6.cjs ui_test_select.cjs; do
  echo "== $t"; node "$t" || status=1
done
exit $status
