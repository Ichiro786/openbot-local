#!/usr/bin/env bash
# Stages the engine payload into the APK assets, where EngineInstaller.kt reads it:
#
#   android/src/main/assets/engine/rootfs-arm64.tar.xz         (EngineConfig.BUNDLED_ASSET)
#   android/src/main/assets/engine/rootfs-arm64.tar.xz.sha256  (EngineConfig.BUNDLED_SHA256)
#   android/src/main/assets/engine/engine.json                 (EngineConfig.BUNDLED_MANIFEST)
#
# Usage: stage-engine-payload.sh [engine-<version>]
#   Without a tag: the newest engine-<number...> release (engine-latest, drafts skipped).
# Env:
#   GITHUB_TOKEN   needed for a private repo (Contents: read)
#   ENGINE_REPO    owner/repo with the releases (default: $GITHUB_REPOSITORY, else Ichiro786/openbot-local)
#   ENGINE_TAG     same as the argument
# Exit codes: 0 staged, 1 error, 3 no engine release exists yet.
# The staged files are git-ignored (modules/openbot-engine/.gitignore).
set -euo pipefail
export LC_ALL=C

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MODULE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
DEST="$MODULE_DIR/android/src/main/assets/engine"
REPO="${ENGINE_REPO:-${GITHUB_REPOSITORY:-Ichiro786/openbot-local}}"
TAG="${1:-${ENGINE_TAG:-}}"
API="${GITHUB_API_URL:-https://api.github.com}"
ASSET=rootfs-arm64.tar.xz

fail() { echo "stage-engine-payload: $*" >&2; exit 1; }
for c in curl jq sha256sum; do command -v "$c" >/dev/null || fail "missing $c"; done

auth=()
[ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
api() {
  curl --fail-with-body --silent --show-error --location --retry 3 \
    -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${auth[@]}" "$@"
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

if [ -n "$TAG" ]; then
  if ! api -o "$WORK/release.json" "$API/repos/$REPO/releases/tags/$TAG"; then
    fail "release $TAG not found in $REPO (private repo without GITHUB_TOKEN?)"
  fi
else
  api -o "$WORK/releases.json" "$API/repos/$REPO/releases?per_page=100" ||
    fail "cannot list releases of $REPO (private repo without GITHUB_TOKEN?)"
  # Newest by numeric version, only releases that carry the payload.
  jq --arg a "$ASSET" '
    [ .[] | select(.draft | not)
      | select(.tag_name | test("^engine-[0-9]+(\\.[0-9]+)*$"))
      | select(any(.assets[]; .name == $a)) ]
    | sort_by(.tag_name | ltrimstr("engine-") | split(".") | map(tonumber))
    | last // empty' "$WORK/releases.json" >"$WORK/release.json"
  if [ ! -s "$WORK/release.json" ]; then
    echo "::error::No engine-<version> release with $ASSET exists in $REPO yet. Run the 'Engine rootfs' workflow (rootfs.yml) first." >&2
    exit 3
  fi
fi
TAG=$(jq -r .tag_name "$WORK/release.json")
echo "==> $REPO $TAG"

download() { # asset-name dest
  local id
  id=$(jq -r --arg n "$1" '.assets[] | select(.name == $n) | .id' "$WORK/release.json" | head -n1)
  [ -n "$id" ] || fail "$TAG has no asset $1"
  # The API answers with a redirect to signed storage; curl drops the Authorization header on the
  # cross-host redirect.
  curl --fail --silent --show-error --location --retry 3 \
    -H "Accept: application/octet-stream" "${auth[@]}" -o "$2" "$API/repos/$REPO/releases/assets/$id"
}

mkdir -p "$DEST"
rm -f "$DEST/$ASSET" "$DEST/$ASSET.sha256" "$DEST/engine.json"
download "$ASSET.sha256" "$WORK/$ASSET.sha256"
download engine.json "$WORK/engine.json"
download "$ASSET" "$DEST/$ASSET.part"

want=$(awk '{print tolower($1); exit}' "$WORK/$ASSET.sha256")
[[ $want =~ ^[0-9a-f]{64}$ ]] || fail "malformed $ASSET.sha256"
have=$(sha256sum "$DEST/$ASSET.part" | cut -d' ' -f1)
[ "$have" = "$want" ] || { rm -f "$DEST/$ASSET.part"; fail "$ASSET sha256 $have, expected $want"; }
json_sha=$(jq -r '.sha256 // empty' "$WORK/engine.json")
[ -z "$json_sha" ] || [ "$json_sha" = "$want" ] || fail "engine.json sha256 $json_sha differs from $ASSET.sha256"

# engine.json as published; make sure it names its tag so the app compares versions by tag.
jq --arg tag "$TAG" '.tag = (.tag // $tag)' "$WORK/engine.json" >"$DEST/engine.json"
printf '%s  %s\n' "$want" "$ASSET" >"$DEST/$ASSET.sha256"
mv "$DEST/$ASSET.part" "$DEST/$ASSET"

size=$(stat -c %s "$DEST/$ASSET")
echo "==> staged $TAG: $ASSET $((size / 1048576)) MiB, sha256 $want"
echo "    installed_bytes: $(jq -r '.installed_bytes // "?"' "$DEST/engine.json")"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "tag=$TAG"; echo "sha256=$want"; echo "bytes=$size"; } >>"$GITHUB_OUTPUT"
fi
