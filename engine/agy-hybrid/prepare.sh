#!/bin/bash
# OpenBot Local: prepare the Antigravity (Gemini) runtime ON THE DEVICE (bash port of prepare.py's CLI
# path, so the engine no longer ships CPython).
#
# Google's Antigravity CLI is one Go binary (`antigravity acp` is its ACP server) with no TCMalloc, so it
# runs on 39-bit VA Android kernels. Version and hashes are pinned to the engine's own
# native-runtime.lock.json (CLI_* below; build-rootfs.sh checks that app.asar names the pin). Downloaded
# from Google's GitHub release on the device and verified (archive and executable sha256); never shipped.
#   <root>/<version>/bin/antigravity        sh wrapper (OPENBOT_ANTIGRAVITY_PATH points here)
#   <root>/<version>/libexec/antigravity    Google's binary
#   <root>/current -> <version>             only after `--version` and ACP initialize pass
#
#   prepare.sh [--root DIR]           install the pinned CLI
#   prepare.sh [--root DIR] --check   installed=, latest= (the pin, no network), update=0|1, error=
#
# Progress on stderr: "[agy-hybrid] STAGE <name> [percent]" (download, verify, extract, smoke, done), as the
# app's Antigravity row reads it. Exit 0 = ready. A failure leaves <root>/current as it was.
set -uo pipefail

CLI_VERSION="1.5.4"
CLI_URL="https://github.com/google-antigravity/antigravity-cli/releases/download/$CLI_VERSION/agy_cli_linux_arm64.tar.gz"
CLI_SHA256="aa8870d1b93b646ed52fd0862752b3ec8c5e91afd22d943eb2a9a0b0671fd939"
CLI_EXE_SHA256="874d86300e64ff6f378abd55bcb45cbc1f8749fa422629c10ddecbac683b7b97"
SMOKE_TIMEOUT=180

ROOT=/root/.local/share/agy-hybrid
CHECK=0
while [ $# -gt 0 ]; do
  case $1 in
  --root) ROOT=$2; shift 2 ;;
  --check) CHECK=1; shift ;;
  *) echo "usage: $0 [--root DIR] [--check]" >&2; exit 2 ;;
  esac
done

log() { echo "[agy-hybrid] $*" >&2; }
stage() { log STAGE "$@"; }
die() { log "error: $*"; exit 1; }
installed() { head -n 1 "$ROOT/current/.ready" 2>/dev/null; }

if [ "$CHECK" = 1 ]; then
  have=$(installed)
  echo "installed=$have"
  echo "latest=$CLI_VERSION"
  echo "update=$([ "$have" = "$CLI_VERSION" ] && echo 0 || echo 1)"
  echo "error="
  exit 0
fi

ver=$CLI_VERSION
dest="$ROOT/$ver"
if [ -f "$dest/.ready" ] && [ "$(installed)" = "$ver" ] && [ -x "$dest/bin/antigravity" ]; then
  log "already prepared $dest"
  stage done 100
  exit 0
fi
mkdir -p "$ROOT" || die "cannot make $ROOT"
rm -rf "$ROOT/.$ver."* 2>/dev/null # leftovers of an interrupted run
free_kib=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
[ "${free_kib:-0}" -ge 439453 ] ||
  die "not enough storage: $((${free_kib:-0} / 1024)) MiB free, about 400 MiB needed while preparing (230 MiB after)"
work=$(mktemp -d "$ROOT/.$ver.XXXXXX") || die "cannot make a work folder"
trap 'rm -rf "$work"' EXIT

# Download with percent lines (curl itself prints nothing parseable).
tgz="$work/cli.tar.gz"
log "download $CLI_URL"
stage download 0
total=$(curl -fsSLI "$CLI_URL" 2>/dev/null | tr -d '\r' | awk 'tolower($1) == "content-length:" {n = $2} END {print n + 0}')
curl -fsSL --retry 3 -o "$tgz" "$CLI_URL" &
pid=$!
last=-1
while kill -0 "$pid" 2>/dev/null; do
  if [ "${total:-0}" -gt 0 ] && [ -f "$tgz" ]; then
    pct=$(($(stat -c %s "$tgz") * 100 / total))
    [ "$pct" -gt 100 ] && pct=100
    [ "$pct" != "$last" ] && { stage download "$pct"; last=$pct; }
  fi
  sleep 0.5
done
wait "$pid" || die "download failed: $CLI_URL"
stage download 100

stage verify 0
got=$(sha256sum "$tgz" | cut -d' ' -f1)
[ "$got" = "$CLI_SHA256" ] || die "sha256 mismatch: $got != $CLI_SHA256"

stage extract 0
mkdir -p "$work/bin" "$work/libexec"
member=$(tar -tzf "$tgz" | grep -E '(^|/)antigravity$' | head -n 1)
[ -n "$member" ] || die "the Antigravity CLI archive has no \`antigravity\` executable"
tar -xzOf "$tgz" "$member" >"$work/libexec/antigravity" || die "cannot extract $member"
rm -f "$tgz"
chmod 0755 "$work/libexec/antigravity"
[ "$(sha256sum "$work/libexec/antigravity" | cut -d' ' -f1)" = "$CLI_EXE_SHA256" ] ||
  die "sha256 mismatch for the antigravity executable"
stage extract 100
cat >"$work/bin/antigravity" <<'EOF'
#!/bin/sh
# OpenBot Local: Google's Antigravity CLI, downloaded on this phone by /opt/agy-hybrid/tools/prepare.sh.
# stdout is the ACP JSON-RPC channel: nothing here may print to it.
D=$(cd "$(dirname "$0")" && pwd)
# The CLI replaces itself when it updates; the engine pins the version it was tested with.
export AGY_CLI_DISABLE_AUTO_UPDATE=true
# Without a display the CLI refuses the Google sign-in ("No browser is available here"); with one it runs
# `xdg-open <link>` from PATH, which the engine replaces with its own opener and relays to the app.
[ -n "${DISPLAY:-}" ] || export DISPLAY=:0
exec "$D/../libexec/antigravity" "$@"
EOF
chmod 0755 "$work/bin/antigravity"
printf '{"version": "%s"}\n' "$ver" >"$work/antigravity-package.json"

# Smoke test: what the engine runs. `--version` must print the bare version (cli.ts
# parseAntigravityVersion), and `acp --gemini-dir=<abs> --app-data-dir=antigravity-acp` must answer ACP
# initialize with agentInfo.version == the pin.
stage smoke
home="$work/.smokehome"
mkdir -p "$home"
out=$(HOME="$home" WSL_DISTRO_NAME=OpenBot timeout 120 "$work/bin/antigravity" --version 2>/dev/null | tr -d '[:space:]')
[ "$out" = "$ver" ] || die "smoke test: \`antigravity --version\` printed '${out:0:80}', expected $ver"
coproc ACP { HOME="$home" WSL_DISTRO_NAME=OpenBot exec "$work/bin/antigravity" acp \
  "--gemini-dir=$home/.gemini" --app-data-dir=antigravity-acp 2>/dev/null; }
acp_pid=$ACP_PID
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"openbot","version":"0"},"clientCapabilities":{}}}' >&"${ACP[1]}"
answer=""
IFS= read -r -t "$SMOKE_TIMEOUT" answer <&"${ACP[0]}"
kill "$acp_pid" 2>/dev/null
wait "$acp_pid" 2>/dev/null
[ -n "$answer" ] || die "smoke test: no answer to ACP initialize within ${SMOKE_TIMEOUT}s"
got_ver=$(sed -n 's/.*"agentInfo":{[^}]*"version":"\([^"]*\)".*/\1/p' <<<"$answer")
[ "$got_ver" = "$ver" ] || die "smoke test: the CLI reports '${got_ver:-?}', expected $ver"
rm -rf "$home"
echo "$ver" >"$work/.ready"

rm -rf "$dest"
mv "$work" "$dest" || die "cannot move the runtime into $dest"
trap - EXIT
prev=$(installed)
ln -sfn "$ver" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current" || die "cannot switch $ROOT/current"
# A running engine may still use the previous runtime until it restarts: keep that one back.
# openbot-start.sh removes it at the next start.
for old in "$ROOT"/*; do
  name=${old##*/}
  [[ $name =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
  [ "$name" = "$ver" ] || [ "$name" = "$prev" ] || rm -rf "$old"
done
log "ready $dest"
stage done 100
