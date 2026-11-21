#!/usr/bin/env bash
# Builds the two Lambda folders (installs production dependencies for Linux x64, the Lambda platform).
# Run from the repo root:  bash aws/build.sh      Output: aws/screenshot-build and aws/transcode-build (git-ignored).
set -euo pipefail
cd "$(dirname "$0")"
export npm_config_platform=linux npm_config_arch=x64 npm_config_libc=glibc   # ffmpeg-static downloads the matching binary
for fn in screenshot transcode; do
  rm -rf "$fn-build"; mkdir "$fn-build"
  cp "$fn/package.json" "$fn/index.js" "$fn-build/"
  [ -f "$fn/package-lock.json" ] && cp "$fn/package-lock.json" "$fn-build/"
  (cd "$fn-build" && if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; else npm install --omit=dev --no-audit --no-fund; fi)
  du -sh "$fn-build"
done
