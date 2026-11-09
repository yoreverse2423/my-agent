#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WWW="$ROOT/android-watch/app/src/main/assets/www"
mkdir -p "$WWW/data" "$WWW/vendor"
cp "$ROOT/index.html" "$ROOT/style.css" "$ROOT/app.js" "$ROOT/site.webmanifest" "$WWW/"
cp "$ROOT/data/"*.json "$WWW/data/"
cp -R "$ROOT/vendor/." "$WWW/vendor/"
echo "synced → $WWW"
