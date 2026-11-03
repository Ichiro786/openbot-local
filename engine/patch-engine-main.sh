#!/usr/bin/env bash
# OpenBot Local: rebuild the engine's Electron main bundle from the upstream source of the same
# release with the fork's patches, and swap it into the extracted AppImage's app.asar.
#
#   patch-engine-main.sh <APP_SRC (squashfs-root)> <openbot version> <patch dir>
#
# Only out/main changes: preload, renderer, node_modules and the Electron binary stay the release's
# own, and the source tag pins the same lockfile, so the externalized deps match. A patch that no
# longer applies fails the build (never ships an unpatched engine under a patched revision).
# Linux Electron does not enforce the embedded asar integrity fuse (macOS/Windows only), so a
# repacked app.asar loads; rootfs.yml's smoke test (chroot + proot start) is the guard.
set -euo pipefail

APP_SRC=$1
VERSION=$2
PATCH_DIR=$3
WORK=${WORK_DIR:-/tmp}/engine-main-src
BUN=${BUN_BIN:-bun}

shopt -s nullglob
patches=("$PATCH_DIR"/*.patch)
[ ${#patches[@]} -gt 0 ] || { echo "no engine patches in $PATCH_DIR"; exit 0; }
[ -f "$APP_SRC/resources/app.asar" ] || { echo "::error::no resources/app.asar in $APP_SRC" >&2; exit 1; }

rm -rf "$WORK"
git clone -q --depth 1 --branch "v$VERSION" https://github.com/nightly-labs/openbot.git "$WORK/src"
for p in "${patches[@]}"; do
  echo "applying $(basename "$p")"
  git -C "$WORK/src" apply --check "$p"
  git -C "$WORK/src" apply "$p"
done

# --ignore-scripts: the postinstall downloads Electron and git hooks, which a bundle build does not need.
(cd "$WORK/src" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 "$BUN" install --frozen-lockfile --ignore-scripts &&
  "$BUN" x electron-vite build)
[ -f "$WORK/src/out/main/index.js" ] || { echo "::error::electron-vite produced no out/main/index.js" >&2; exit 1; }

ASAR=("$BUN" x --bun @electron/asar@3.4.1)
"${ASAR[@]}" extract "$APP_SRC/resources/app.asar" "$WORK/app"
[ -f "$WORK/app/out/main/index.js" ] || { echo "::error::app.asar has no out/main/index.js" >&2; exit 1; }
rm -rf "$WORK/app/out/main"
cp -a "$WORK/src/out/main" "$WORK/app/out/main"

# Same unpack set as electron-builder.yml asarUnpack, plus native addons (electron-builder unpacks
# *.node on its own).
rm -rf "$APP_SRC/resources/app.asar" "$APP_SRC/resources/app.asar.unpacked"
"${ASAR[@]}" pack "$WORK/app" "$APP_SRC/resources/app.asar" \
  --unpack "{*.node,out/main/agent-database-host.js,out/main/voice-transcription-host.js,out/main/voice-speech-host.js}" \
  --unpack-dir "{node_modules/effect,node_modules/@koromix}"
printf '%s\n' "${patches[@]##*/}" >"$APP_SRC/resources/openbot-local-patches.txt"
rm -rf "$WORK"
echo "engine main bundle rebuilt with ${#patches[@]} patch(es)"
