#!/usr/bin/env bash
# OpenBot Local: rebuild the engine's Electron bundles from the upstream source of the same
# release with the fork's patches, and swap them into the extracted AppImage's app.asar.
#
#   patch-engine-main.sh <APP_SRC (squashfs-root)> <openbot version> <patch dir>
#
# Source: tag v<version>, or the upstream commit named in <patch dir>/UPSTREAM_REF (40-hex sha) to
# ship upstream main after the release. out/main, out/preload and out/renderer are swapped together
# (the engine runs full Electron under Xvfb, so preload and renderer must match main's IPC);
# node_modules and the Electron binary stay the release's own. Every bare package that the new main
# bundle imports must exist in the release's node_modules, else the build fails. A patch that no
# longer applies fails the build (never ships an unpatched engine under a patched revision).
# Linux Electron does not enforce the embedded asar integrity fuse (macOS/Windows only), so a
# repacked app.asar loads; rootfs.yml's smoke test (chroot + proot start) is the guard.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

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
REF=""
[ -f "$PATCH_DIR/UPSTREAM_REF" ] && REF=$(tr -d '[:space:]' <"$PATCH_DIR/UPSTREAM_REF")
if [ -n "$REF" ]; then
  [[ $REF =~ ^[0-9a-f]{40}$ ]] || { echo "::error::UPSTREAM_REF is not a 40-hex sha: $REF" >&2; exit 1; }
  git init -q "$WORK/src"
  git -C "$WORK/src" fetch -q --depth 1 https://github.com/nightly-labs/openbot.git "$REF"
  git -C "$WORK/src" checkout -q --detach FETCH_HEAD
  echo "engine source: upstream $REF (OpenBot $VERSION + later main)"
else
  git clone -q --depth 1 --branch "v$VERSION" https://github.com/nightly-labs/openbot.git "$WORK/src"
fi
for p in "${patches[@]}"; do
  echo "applying $(basename "$p")"
  git -C "$WORK/src" apply --check "$p"
  git -C "$WORK/src" apply "$p"
done

# --ignore-scripts: the postinstall downloads Electron and git hooks, which a bundle build does not need.
(cd "$WORK/src" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 "$BUN" install --frozen-lockfile --ignore-scripts)
if [ "$VERSION" = "0.67.1" ]; then
  bash "$SCRIPT_DIR/check-upgrade.sh" "$WORK/src"
fi
(cd "$WORK/src" && "$BUN" x electron-vite build)
[ -f "$WORK/src/out/main/index.js" ] || { echo "::error::electron-vite produced no out/main/index.js" >&2; exit 1; }

ASAR=("$BUN" x --bun @electron/asar@3.4.1)
"${ASAR[@]}" extract "$APP_SRC/resources/app.asar" "$WORK/app"
[ -f "$WORK/app/out/main/index.js" ] || { echo "::error::app.asar has no out/main/index.js" >&2; exit 1; }
for part in main preload renderer; do
  [ -d "$WORK/src/out/$part" ] || { echo "::error::electron-vite produced no out/$part" >&2; exit 1; }
  rm -rf "${WORK:?}/app/out/$part"
  cp -a "$WORK/src/out/$part" "$WORK/app/out/$part"
done
# Externalized packages of the new main/preload must be in the release's node_modules (only npm-style
# names count: the bundles also hold quoted prose and Swift snippets). The optional Baileys peers
# (electron.vite.config.ts rollupOptions.external) are missing on purpose.
# Bun lists its own ws/undici shims as built-ins; Electron's Node does not have them.
builtins=$("$BUN" -e "console.log(require('node:module').builtinModules.filter((m) => !/^(bun|ws|undici)($|:)/.test(m)).join('\\n'))")
missing=$(grep -ohE '(require\(|from |import\()"[^"./][^"]*"' "$WORK/app/out/main"/*.js "$WORK/app/out/preload"/*.cjs |
  sed -E 's/.*"([^"]+)"/\1/' | { grep -vE '^(node:|electron($|/))' || true; } |
  sed -E 's#^(@[^/]+/[^/]+|[^@/][^/]*).*#\1#' | sort -u |
  { grep -E '^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$' || true; } | while read -r pkg; do
    case $pkg in jimp | sharp | audio-decode | link-preview-js) continue ;; esac
    grep -qxF "$pkg" <<<"$builtins" || [ -e "$WORK/app/node_modules/$pkg/package.json" ] || echo "$pkg"
  done)
[ -z "$missing" ] || { echo "::error::main/preload import packages the release lacks: $missing" >&2; exit 1; }

# Same unpack set as electron-builder.yml asarUnpack, plus native addons (electron-builder unpacks
# *.node on its own).
rm -rf "$APP_SRC/resources/app.asar" "$APP_SRC/resources/app.asar.unpacked"
"${ASAR[@]}" pack "$WORK/app" "$APP_SRC/resources/app.asar" \
  --unpack "{*.node,out/main/agent-database-host.js,out/main/voice-transcription-host.js,out/main/voice-speech-host.js}" \
  --unpack-dir "{node_modules/effect,node_modules/@koromix}"
printf '%s\n' "${REF:+upstream $REF}" "${patches[@]##*/}" | sed '/^$/d' >"$APP_SRC/resources/openbot-local-patches.txt"
rm -rf "$WORK"
echo "engine main/preload/renderer rebuilt with ${#patches[@]} patch(es)${REF:+ on upstream $REF}"
