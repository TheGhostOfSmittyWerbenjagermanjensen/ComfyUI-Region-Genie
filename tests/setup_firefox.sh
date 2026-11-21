#!/usr/bin/env bash
# Firefox for the tests that need it (tests/firefox_*.cjs): Firefox from archive.mozilla.org (checksum checked),
# geckodriver from GitHub and selenium-webdriver from npm (the pre-installed Playwright only drives Chromium).
#
#   bash tests/setup_firefox.sh [DIR]
#
# DIR: where it goes (default /opt/rg-firefox; the tests read RG_FIREFOX_DIR). Safe to run again: what is there is kept.
# About 90 MB to download, under a minute. The cloud environment's network settings must allow archive.mozilla.org.
# Environment: FIREFOX_VERSION (default 160.0.1: the current release when this was written; use the version the bug was reported in), GECKODRIVER_VERSION (default 0.36.0).
# Chromium is the tests' default browser. Use Firefox when a bug is reported there; don't run every suite in both.
set -euo pipefail
DIR="${1:-/opt/rg-firefox}"
V="${FIREFOX_VERSION:-160.0.1}"; G="${GECKODRIVER_VERSION:-0.36.0}"
BASE="https://archive.mozilla.org/pub/firefox/releases/$V"
mkdir -p "$DIR"; cd "$DIR"
if [ ! -x firefox/firefox ] || ! firefox/firefox --version 2>/dev/null | grep -q " ${V%esr}"; then
    rm -rf firefox
    echo "== Firefox $V"
    curl -fsSL -o ff.tar.xz "$BASE/linux-x86_64/en-US/firefox-$V.tar.xz"
    curl -fsSL -o SHA512SUMS "$BASE/SHA512SUMS"
    want="$(grep " linux-x86_64/en-US/firefox-$V.tar.xz\$" SHA512SUMS | cut -d' ' -f1)"
    have="$(sha512sum ff.tar.xz | cut -d' ' -f1)"
    [ -n "$want" ] && [ "$want" = "$have" ] || { echo "checksum of the Firefox download doesn't match" >&2; rm -f ff.tar.xz; exit 1; }
    tar xJf ff.tar.xz; rm -f ff.tar.xz SHA512SUMS
fi
if [ ! -x geckodriver ]; then
    echo "== geckodriver $G"
    curl -fsSL -o gd.tgz "https://github.com/mozilla/geckodriver/releases/download/v$G/geckodriver-v$G-linux64.tar.gz"
    tar xzf gd.tgz; rm -f gd.tgz
fi
if [ ! -d node_modules/selenium-webdriver ]; then
    echo "== selenium-webdriver"
    [ -f package.json ] || npm init -y >/dev/null
    npm install --silent selenium-webdriver
fi
echo "ready: $("$DIR/firefox/firefox" --version) in $DIR"
