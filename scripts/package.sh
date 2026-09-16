#!/bin/sh
# Eklentiyi yüklenebilir zip olarak paketler: dist/metalens-<sürüm>.zip
set -e
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/metalens-$VERSION"
rm -rf "$OUT" "$OUT.zip"
mkdir -p "$OUT"
cp -R manifest.json background.js content.js panel.js popup.html popup.js viewer.html viewer.js ui.css LICENSE icons lib _locales "$OUT/"
(cd dist && zip -qr -X "metalens-$VERSION.zip" "metalens-$VERSION")
echo "dist/metalens-$VERSION.zip"
