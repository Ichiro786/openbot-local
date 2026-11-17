#!/bin/sh
# OpenBot Local: Antigravity (Gemini) runtime helper, run by the app through runCommand.
# Engine >= 0.69: the runtime is Google's Antigravity CLI pinned in prepare.sh. Engine >= 0.72 ships no
# CPython: prepare.sh is bash, and the 1.4.x Python hybrid is gone (openbot-start.sh then uses OpenBot's
# managed copy of the same CLI until prepare installs it).
#   agy-hybrid.sh status        key=value: ready=0|1 installed=<ver> python=1 va_bits=<n> free_mib=<n>
#                               (python=1 is kept for the app: it means "the prepare tool is here")
#   agy-hybrid.sh check         key=value from prepare.sh --check (installed, latest = the engine's pin, update, error)
#   agy-hybrid.sh prepare       download Google's release on the phone, verify sha256, smoke-test; progress on stderr
#   agy-hybrid.sh remove        delete the prepared runtime (the engine falls back to OpenBot's managed copy)
#   agy-hybrid.sh signin-url    last Google sign-in link the server asked to open: "<epoch> <url>", if any
# The prepared runtime lives under /root (carried over on engine updates); /opt/agy-hybrid/current points at it.
set -u
TOOLS=/opt/agy-hybrid/tools
ROOT=/root/.local/share/agy-hybrid
STATE=/root/.config/openbot-local
LOGF=$STATE/agy-hybrid.log
mkdir -p "$STATE" 2>/dev/null

case "${1:-status}" in
status)
  ver=""
  [ -f "$ROOT/current/.ready" ] && ver=$(head -n 1 "$ROOT/current/.ready")
  echo "ready=$([ -n "$ver" ] && echo 1 || echo 0)"
  echo "installed=$ver"
  echo "python=$([ -f "$TOOLS/prepare.sh" ] && echo 1 || echo 0)"
  echo "va_bits=$(cat "$STATE/va-bits" 2>/dev/null)"
  echo "free_mib=$(df -Pm /root 2>/dev/null | awk 'NR==2 {print $4}')"
  ;;
check)
  exec bash "$TOOLS/prepare.sh" --root "$ROOT" --check
  ;;
prepare)
  printf '%s prepare started\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOGF"
  bash "$TOOLS/prepare.sh" --root "$ROOT" 2>&1 | tee -a "$LOGF"
  # A pipe hides prepare.sh's exit code in plain sh: success = runtime ready and "STAGE done" logged.
  if [ -f "$ROOT/current/.ready" ] && tail -n 3 "$LOGF" | grep -q 'STAGE done'; then rc=0; else rc=1; fi
  printf '%s prepare rc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" >>"$LOGF"
  exit "$rc"
  ;;
remove)
  rm -rf "$ROOT" "$STATE/agy-signin-url"
  echo "removed"
  ;;
signin-url)
  cat "$STATE/agy-signin-url" 2>/dev/null
  ;;
*)
  echo "usage: $0 status|check|prepare|remove|signin-url" >&2
  exit 2
  ;;
esac
