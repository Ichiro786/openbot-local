#!/bin/bash
# Starts the packed engine once and waits for OPENBOT_LOCAL_READY, without changing the build tree.
# The rootfs is the read-only lower layer of an overlay, so no keyring, session or log of the test run
# reaches the payload.
#
#   smoke-test.sh <rootfs dir> chroot   real chroot as root (checks the payload and the launcher)
#   smoke-test.sh <rootfs dir> proot    the distro's proot (checks the no-namespace path; GitHub's
#                                       kernel still allows netlink, so it does not reproduce Android)
#
# Exit 0 when the control socket answered; prints the tail of /root/openbot.log either way.
set -uo pipefail
ROOTFS=$(realpath "${1:?rootfs dir}")
MODE=${2:-chroot}
TIMEOUT=${SMOKE_TIMEOUT:-300}
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 2; }

work=$(mktemp -d /tmp/openbot-smoke.XXXXXX)
mkdir -p "$work/upper" "$work/work" "$work/merged"
mount -t overlay overlay -o "lowerdir=$ROOTFS,upperdir=$work/upper,workdir=$work/work" "$work/merged"
M="$work/merged"
mounted=("$M")
cleanup() {
  [ -n "${runner:-}" ] && kill -TERM "$runner" 2>/dev/null
  sleep 3
  pkill -KILL -f "$M" 2>/dev/null
  local i
  for ((i = ${#mounted[@]} - 1; i >= 0; i--)); do umount -l "${mounted[$i]}" 2>/dev/null; done
  rm -rf "$work"
}
trap cleanup EXIT
cp -L /etc/resolv.conf "$M/etc/resolv.conf"

envs=(HOME=/root PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 TERM=dumb
  OPENBOT_READY_TIMEOUT="$TIMEOUT" OPENBOT_PROOT_PROFILE="${OPENBOT_PROOT_PROFILE:-safe}")

if [ "$MODE" = chroot ]; then
  for d in proc sys dev dev/pts; do mount --bind "/$d" "$M/$d"; mounted+=("$M/$d"); done
  mkdir -p "$M/dev/shm"
  # Antigravity (Gemini): install the runtime the way the app's Set up does, in the overlay only (Google's
  # files never reach the payload), so the engine below starts with OPENBOT_ANTIGRAVITY_PATH set.
  if [ "${SMOKE_ANTIGRAVITY:-1}" = 1 ]; then
    echo "----- Antigravity: agy-hybrid prepare (overlay only) -----"
    chroot "$M" /usr/bin/env -i "${envs[@]}" /bin/sh /opt/agy-hybrid/tools/agy-hybrid.sh prepare 2>&1 |
      grep -v -E 'STAGE (download|verify|extract) [0-9]+$' | tail -n 20
    chroot "$M" /usr/bin/env -i "${envs[@]}" /bin/sh /opt/agy-hybrid/tools/agy-hybrid.sh status
  fi
  chroot "$M" /usr/bin/env -i "${envs[@]}" /bin/bash /root/openbot-start.sh &
  runner=$!
elif [ "$MODE" = proot ]; then
  command -v proot >/dev/null || { echo "proot is not installed" >&2; exit 2; }
  # The distro proot (5.1.0) predates --kill-on-exit; the Termux build the app ships has it.
  # Same for --link2symlink in some distro builds.
  extra=()
  help=$(proot --help 2>&1 || true)
  grep -q -- '--kill-on-exit' <<<"$help" && extra+=(--kill-on-exit)
  grep -q -- '--link2symlink' <<<"$help" && extra+=(--link2symlink)
  PROOT_NO_SECCOMP=${PROOT_NO_SECCOMP:-} proot "${extra[@]}" -0 -r "$M" -w /root \
    -b /dev -b /proc -b /sys -b "$M/tmp:/dev/shm" \
    /usr/bin/env -i "${envs[@]}" /bin/bash /root/openbot-start.sh &
  runner=$!
else
  echo "mode must be chroot or proot" >&2
  exit 2
fi

rc=1
for _ in $(seq 1 $((TIMEOUT + 30))); do
  if grep -q 'OPENBOT_LOCAL_READY' "$M/root/openbot.log" 2>/dev/null; then rc=0; break; fi
  if grep -q 'OPENBOT_LOCAL_FAILED' "$M/root/openbot.log" 2>/dev/null; then break; fi
  kill -0 "$runner" 2>/dev/null || break
  sleep 1
done
echo "----- tail of /root/openbot.log ($MODE) -----"
tail -n 120 "$M/root/openbot.log" 2>/dev/null
if [ "$rc" = 0 ]; then
  echo "----- openbot-status.sh -----"
  if [ "$MODE" = chroot ]; then
    chroot "$M" /usr/bin/env -i PATH=/usr/bin:/bin /root/openbot-status.sh
  else
    proot -0 -r "$M" -b /proc -b /dev /usr/bin/env -i PATH=/usr/bin:/bin /root/openbot-status.sh
  fi
  echo "SMOKE TEST ($MODE): READY"
else
  echo "SMOKE TEST ($MODE): NOT READY"
fi

# Antigravity probe (chroot): the engine's own CLI detection (cli.ts resolveAntigravityCli: `--version`,
# logged as "Resolved a provider CLI."), then the ACP handshake the engine makes, without a sign-in.
if [ "$MODE" = chroot ] && [ "${SMOKE_ANTIGRAVITY:-1}" = 1 ]; then
  agy_ok=0
  echo "----- Antigravity: openbot-start.sh lines -----"
  grep -a 'Antigravity (Gemini)' "$M/root/openbot.log" | tail -n 3
  if [ "$rc" = 0 ]; then
    plog=""
    for _ in $(seq 1 120); do
      plog=$(find "$M/root" -path '*/providers/providers.log' 2>/dev/null | head -n 1)
      if [ -n "$plog" ] && grep -a '"provider":"antigravity"' "$plog" | grep -a -q -v '"to":"checking"'; then break; fi
      sleep 1
    done
    echo "----- Antigravity: engine provider log (${plog:-no providers.log}) -----"
    [ -n "$plog" ] && grep -a 'antigravity' "$plog" | tail -n 15
    if [ -n "$plog" ] && grep -a 'Resolved a provider CLI' "$plog" | grep -a '"provider":"antigravity"' |
      grep -a -q '"version":"[0-9]*\.[0-9]*\.[0-9]*"'; then
      echo "ENGINE DETECTION: antigravity resolved"
      agy_ok=1
    else
      echo "ENGINE DETECTION: antigravity NOT resolved"
    fi
  fi
  cat >"$M/tmp/agy-acp-probe.sh" <<'SH'
#!/bin/bash
# ACP handshake without a sign-in: --version, initialize, session/new (the engine's sign-in probe).
exe=$1
home=/tmp/agy-probe-gemini
mkdir -p "$home"
export WSL_DISTRO_NAME=OpenBot DISPLAY=:0
echo "--version -> '$(timeout 60 "$exe" --version 2>/dev/null)'"
coproc ACP { exec "$exe" acp "--gemini-dir=$home" --app-data-dir=antigravity-acp 2>/dev/null; }
call() { # call <id> <method> <params json>: prints the answer with that id
  local line t=$SECONDS
  printf '{"jsonrpc":"2.0","id":%s,"method":"%s","params":%s}\n' "$1" "$2" "$3" >&"${ACP[1]}"
  while IFS= read -r -t 120 line <&"${ACP[0]}"; do
    case $line in *"\"id\":$1,"* | *"\"id\":$1}"*) echo "$2 ($((SECONDS - t))s): ${line:0:700}"; return 0 ;; esac
  done
  echo "$2: no answer"
  return 1
}
ok=1
# Not in a pipeline: bash closes the coproc's descriptors in subshells.
call 1 initialize '{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"openbot","version":"0.72.0"}}' >/tmp/agy-init.txt
cat /tmp/agy-init.txt
grep -q '"agentInfo"' /tmp/agy-init.txt || ok=0
call 2 session/new '{"cwd":"/root","mcpServers":[]}' || ok=0
kill "$ACP_PID" 2>/dev/null
echo "ACP HANDSHAKE: $([ "$ok" = 1 ] && echo OK || echo FAILED)"
[ "$ok" = 1 ]
SH
  agy_path=$(sed -n 's/.*Antigravity (Gemini): .* at \(\/[^ ]*\)[. (].*/\1/p' "$M/root/openbot.log" | tail -n 1)
  [ -n "$agy_path" ] || agy_path=/opt/agy-hybrid/current/bin/antigravity
  echo "----- Antigravity: ACP handshake, no sign-in ($agy_path) -----"
  chroot "$M" /usr/bin/env -i "${envs[@]}" /bin/bash /tmp/agy-acp-probe.sh "$agy_path" || agy_ok=0
  if [ "$agy_ok" = 1 ]; then echo "ANTIGRAVITY PROBE: PASS"; else echo "ANTIGRAVITY PROBE: FAIL"; rc=1; fi
fi
exit "$rc"
