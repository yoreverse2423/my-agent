#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK_SRC="$ROOT/android-watch/app/build/outputs/apk/release/app-release.apk"
OUT="$ROOT/downloads/xiaoxuexiji-watch-armeabi-v7a.apk"
mkdir -p "$ROOT/downloads"
cp "$APK_SRC" "$OUT"
sha256sum "$OUT" | awk '{print $1"  xiaoxuexiji-watch-armeabi-v7a.apk"}' > "$OUT.sha256"
ls -lh "$OUT" "$OUT.sha256"
cat "$OUT.sha256"
