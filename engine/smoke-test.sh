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
  cat >"$M/tmp/agy-acp-probe.py" <<'PY'
import json, os, subprocess, sys, threading, time
exe = sys.argv[1]
home = "/tmp/agy-probe-gemini"
os.makedirs(home, exist_ok=True)
env = dict(os.environ, WSL_DISTRO_NAME="OpenBot", DISPLAY=":0")
out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=60, env=env)
print("--version ->", repr(out.stdout), "rc", out.returncode)
p = subprocess.Popen([exe, "acp", f"--gemini-dir={home}", "--app-data-dir=antigravity-acp"], stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
killer = threading.Timer(240, p.kill); killer.daemon = True; killer.start()
def call(i, method, params):
    t = time.time()
    p.stdin.write((json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params}) + "\n").encode()); p.stdin.flush()
    while True:
        line = p.stdout.readline()
        if not line: return None, time.time() - t
        msg = json.loads(line)
        if msg.get("id") == i: return msg, time.time() - t
init, dt = call(1, "initialize", {"protocolVersion": 1, "clientCapabilities": {}, "clientInfo": {"name": "openbot", "version": "0.69.0"}})
print(f"initialize ({dt:.2f}s):", json.dumps(init)[:700])
new, dt = call(2, "session/new", {"cwd": "/root", "mcpServers": []})
print(f"session/new ({dt:.2f}s):", json.dumps(new)[:300])
p.kill()
ok = bool(init and init.get("result", {}).get("agentInfo")) and bool(new)
print("ACP HANDSHAKE:", "OK" if ok else "FAILED")
sys.exit(0 if ok else 1)
PY
  agy_path=$(sed -n 's/.*Antigravity (Gemini): .* at \(\/[^ ]*\)[. (].*/\1/p' "$M/root/openbot.log" | tail -n 1)
  [ -n "$agy_path" ] || agy_path=/opt/agy-hybrid/current/bin/antigravity
  echo "----- Antigravity: ACP handshake, no sign-in ($agy_path) -----"
  chroot "$M" /usr/bin/env -i "${envs[@]}" /usr/local/bin/python3.14 /tmp/agy-acp-probe.py "$agy_path" || agy_ok=0
  # The 1.4 bridge: a phone that kept only the older hybrid after this engine update.
  if [ "${SMOKE_ANTIGRAVITY_BRIDGE:-1}" = 1 ]; then
    # 1.4.5 is the hybrid that phones prepared (the ACP registry has moved on to 1.5.0).
    echo "----- Antigravity: 1.4.5 hybrid bridge (prepare --legacy-hybrid, then the 0.69 command line) -----"
    chroot "$M" /usr/bin/curl -fsSL -o /tmp/acp-1.4.5.zip \
      https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.4.5-linux-arm64.zip
    chroot "$M" /usr/bin/env -i "${envs[@]}" /usr/local/bin/python3.14 -u /opt/agy-hybrid/tools/prepare.py \
      --legacy-hybrid --root /tmp/agyh --python /usr/local/bin/python3.14 --zip /tmp/acp-1.4.5.zip \
      --sha256 7d64246633ae094f67e3bbcd2d679e89048f91346d5339313336e7483f40f056 --version 1.4.5 2>&1 |
      grep -v -E 'STAGE (download|verify|extract|install) [0-9]+$' | tail -n 12
    if chroot "$M" /usr/bin/env -i "${envs[@]}" /usr/local/bin/python3.14 /tmp/agy-acp-probe.py /tmp/agyh/current/bin/agy_acp_server; then
      echo "BRIDGE: OK"
    else
      echo "BRIDGE: FAILED (does not fail the smoke test)"
    fi
  fi
  if [ "$agy_ok" = 1 ]; then echo "ANTIGRAVITY PROBE: PASS"; else echo "ANTIGRAVITY PROBE: FAIL"; rc=1; fi
fi
exit "$rc"
