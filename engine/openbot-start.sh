#!/bin/bash
# OpenBot Local engine launcher: /root/openbot-start.sh inside the rootfs.
#
# Runs the official OpenBot self-hosted server (OPENBOT_SERVER=1) inside PRoot on Android, no root.
# It mirrors upstream scripts/hosting/openbot-container (the Docker entrypoint): a D-Bus session, an
# unlocked GNOME keyring for Electron safeStorage (--password-store=gnome-libsecret), two virtual
# displays (:0 for OpenBot's window, :1 for agents via OPENBOT_AGENT_DISPLAY), then OpenBot itself.
# On top of that it adds what PRoot needs: no Chromium sandbox (no user namespaces / seccomp under
# ptrace), no zygote, no GPU, no /dev/shm, a private D-Bus socket path (no abstract sockets), a
# readiness probe on the control socket, a network-service crash-loop detector with automatic
# fallback to more conservative Chromium process models, and clear exit codes.
#
# Usage:
#   openbot-start.sh            Start in the foreground (the proot process lives as long as OpenBot).
#   openbot-start.sh --stop     Ask a running launcher to stop OpenBot gracefully (from another proot).
#   openbot-start.sh --print-flags   Print the Electron flags the current settings produce, then exit.
#
# Readiness (pick any): the log line "OPENBOT_LOCAL_READY ..." in /root/openbot.log, the file
# /run/openbot/engine.state containing "state=ready", or /root/openbot-status.sh exiting 0.
#
# Exit codes:
#   0  clean stop            10 OpenBot app missing      11 /proc or /dev not bound
#   12 D-Bus failed          13 Xvfb failed              14 keyring / Secret Service failed
#   15 OpenBot exited before ready                       16 not ready within OPENBOT_READY_TIMEOUT
#   17 network-service crash loop, no fallback left      18 OpenBot exited after ready (non-zero)
#   20 another launcher is already running               2  usage error
#
# Environment overrides (all optional):
#   OPENBOT_PROOT_PROFILE   minimal | safe (default) | inprocess | single. See flags_for_profile.
#   OPENBOT_AUTO_ESCALATE   1 (default): on a network-service crash loop, restart with the next
#                           profile (safe -> inprocess -> single) and remember the one that worked.
#   OPENBOT_FLAGS           Replace the computed Chromium flags entirely (space separated).
#   OPENBOT_EXTRA_FLAGS     Append flags (space separated), e.g. "--js-flags=--max-old-space-size=2048".
#   OPENBOT_DISABLE_FEATURES / OPENBOT_ENABLE_FEATURES  Extra comma lists merged into the single
#                           --disable-features / --enable-features switch (Chromium keeps only one).
#   OPENBOT_PASSWORD_STORE  gnome-libsecret (default, as upstream). "basic" only for diagnosis: the
#                           account session then cannot be stored and sign-in will not persist.
#   OPENBOT_DISPLAY_SIZE    Agent display size WIDTHxHEIGHT (640x480..2576x2576), default 1280x800.
#   OPENBOT_XVFB_SHM        0 (default) disables MIT-SHM in Xvfb (SysV shm is emulated and fragile
#                           under proot); 1 keeps it.
#   OPENBOT_XVFB_ARGS       Extra Xvfb arguments.
#   OPENBOT_READY_TIMEOUT   Seconds to wait for the control socket to answer (default 300).
#   OPENBOT_STOP_TIMEOUT    Seconds to wait for a graceful stop before SIGKILL (default 50).
#   OPENBOT_CRASH_THRESHOLD Network-service crash lines that count as a loop (default 5).
#   OPENBOT_VERBOSE         1: Chromium logging to the log file (--enable-logging=stderr).
#   OPENBOT_LOG             Log path (default /root/openbot.log).
#   OPENBOT_AUTH_API_URL    Passed through to OpenBot (another account server).
set -uo pipefail
umask 077

export HOME=/root USER=root LOGNAME=root SHELL=/bin/bash
export LANG="${LANG:-C.UTF-8}"
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export TMPDIR=/tmp
# Fixed: the upstream `openbot` CLI hard-codes /run/openbot/control.sock, and OpenBot main puts its
# control socket in $XDG_RUNTIME_DIR, which must be a 0700 directory owned by the current uid.
export XDG_RUNTIME_DIR=/run/openbot
unset WAYLAND_DISPLAY LD_PRELOAD SESSION_MANAGER

LOG="${OPENBOT_LOG:-/root/openbot.log}"
APP="${OPENBOT_APP:-/opt/OpenBot/app/openbot}"
NONROOT_SHIM=/opt/openbot-local/lib/libopenbot-nonroot.so
SOCKET="$XDG_RUNTIME_DIR/control.sock"
BUS="$XDG_RUNTIME_DIR/bus"
STATE_FILE="$XDG_RUNTIME_DIR/engine.state"
ENGINE_PID_FILE="$XDG_RUNTIME_DIR/engine.pid"
APP_PID_FILE="$XDG_RUNTIME_DIR/openbot.pid"
LOCAL_STATE="$HOME/.config/openbot-local"
LOCK_FILE=/run/openbot-start.lock
READY_TIMEOUT="${OPENBOT_READY_TIMEOUT:-300}"
STOP_TIMEOUT="${OPENBOT_STOP_TIMEOUT:-50}"
CRASH_THRESHOLD="${OPENBOT_CRASH_THRESHOLD:-5}"
AUTO_ESCALATE="${OPENBOT_AUTO_ESCALATE:-1}"
PASSWORD_STORE="${OPENBOT_PASSWORD_STORE:-gnome-libsecret}"
PROFILES=(minimal safe inprocess single)

APP_PID=""
DBUS_PID=""
XVFB0_PID=""
XVFB1_PID=""
PROFILE=""
STOPPING=0

log() {
  printf '%s [openbot-start] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG" 2>/dev/null
  printf '[openbot-start] %s\n' "$*" >&2
}

set_state() { # set_state <state> [reason] [code]
  local tmp="$STATE_FILE.tmp"
  mkdir -p "$XDG_RUNTIME_DIR" 2>/dev/null
  {
    echo "state=$1"
    echo "reason=${2:-}"
    echo "code=${3:-}"
    echo "profile=${PROFILE:-}"
    echo "engine_pid=$$"
    echo "openbot_pid=${APP_PID:-}"
    echo "updated=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$tmp" 2>/dev/null && mv -f "$tmp" "$STATE_FILE" 2>/dev/null
}

die() { # die <code> <message>
  local code=$1
  shift
  log "FATAL: $*"
  printf 'OPENBOT_LOCAL_FAILED code=%s reason=%s\n' "$code" "$*" >>"$LOG" 2>/dev/null
  set_state failed "$*" "$code"
  cleanup
  exit "$code"
}

# ---------------------------------------------------------------- stop / print-flags sub-commands
if [ "${1:-}" = --stop ]; then
  pid=$(cat "$ENGINE_PID_FILE" 2>/dev/null) || { echo "Not running."; exit 0; }
  [[ $pid =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null || { echo "Not running."; exit 0; }
  kill -TERM "$pid"
  for _ in $(seq 1 $((STOP_TIMEOUT + 15))); do
    kill -0 "$pid" 2>/dev/null || { echo "Stopped."; exit 0; }
    sleep 1
  done
  echo "The launcher did not stop in time; killing it." >&2
  kill -KILL "$pid" 2>/dev/null
  exit 1
fi

# ---------------------------------------------------------------- helpers
display_size() { # same rules as upstream openbot-container
  if [[ $1 =~ ^([1-9][0-9]{2,3})x([1-9][0-9]{2,3})$ ]] &&
    [ "${BASH_REMATCH[1]}" -ge 640 ] && [ "${BASH_REMATCH[1]}" -le 2576 ] &&
    [ "${BASH_REMATCH[2]}" -ge 480 ] && [ "${BASH_REMATCH[2]}" -le 2576 ]; then
    echo "$1"
    return
  fi
  [ -z "$1" ] || log "OPENBOT_DISPLAY_SIZE is not WIDTHxHEIGHT from 640x480 to 2576x2576. The display is 1280x800."
  echo 1280x800
}

profile_index() {
  local i
  for i in "${!PROFILES[@]}"; do [ "${PROFILES[$i]}" = "$1" ] && { echo "$i"; return 0; }; done
  return 1
}

join_csv() { local IFS=,; echo "$*"; }

# Chromium honours only ONE --disable-features and ONE --enable-features switch (the last one), so
# each is built as a single comma list.
flags_for_profile() { # prints one flag per line
  local profile=$1 disable=() enable=() f=()
  if [ -n "${OPENBOT_FLAGS:-}" ]; then
    # shellcheck disable=SC2086
    printf '%s\n' --password-store="$PASSWORD_STORE" $OPENBOT_FLAGS
    return
  fi
  f+=(--password-store="$PASSWORD_STORE")
  # Always: no namespaces/seccomp under ptrace, no zygote (fork-server breaks under proot), no GPU,
  # no /dev/shm (Android has none; we bind a dir there only so open() does not fail).
  f+=(--no-sandbox --no-zygote --disable-gpu --disable-dev-shm-usage --ozone-platform=x11)
  if [ "$profile" != minimal ]; then
    f+=(--disable-gpu-compositing --disable-setuid-sandbox --disable-seccomp-filter-sandbox)
    f+=(--disable-breakpad --no-first-run --disable-background-networking)
    # Fewer ptrace'd helper processes, and the network service inside the browser process: an
    # out-of-process network service is what crash-loops under proot ("Network service crashed or
    # was terminated, restarting service"); in-process it either works or fails loudly once.
    disable+=(NetworkServiceSandbox AudioServiceOutOfProcess Vulkan)
    enable+=(NetworkServiceInProcess NetworkServiceInProcess2)
  fi
  if [ "$profile" = inprocess ] || [ "$profile" = single ]; then
    f+=(--in-process-gpu --renderer-process-limit=2)
    disable+=(SpareRendererForSitePerProcess)
  fi
  if [ "$profile" = single ]; then
    # Last resort. Electron does not officially support --single-process; it can break renderers.
    f+=(--single-process)
  fi
  if [ "${OPENBOT_VERBOSE:-0}" = 1 ]; then f+=(--enable-logging=stderr --log-level=0); fi
  # shellcheck disable=SC2206
  [ -n "${OPENBOT_DISABLE_FEATURES:-}" ] && disable+=(${OPENBOT_DISABLE_FEATURES//,/ })
  # shellcheck disable=SC2206
  [ -n "${OPENBOT_ENABLE_FEATURES:-}" ] && enable+=(${OPENBOT_ENABLE_FEATURES//,/ })
  [ "${#disable[@]}" -gt 0 ] && f+=(--disable-features="$(join_csv "${disable[@]}")")
  [ "${#enable[@]}" -gt 0 ] && f+=(--enable-features="$(join_csv "${enable[@]}")")
  printf '%s\n' "${f[@]}"
  # shellcheck disable=SC2086
  [ -n "${OPENBOT_EXTRA_FLAGS:-}" ] && printf '%s\n' $OPENBOT_EXTRA_FLAGS
  return 0
}

choose_profile() {
  local p="${OPENBOT_PROOT_PROFILE:-}"
  if [ -z "$p" ] && [ -s "$LOCAL_STATE/profile" ]; then p=$(<"$LOCAL_STATE/profile"); fi
  [ -n "$p" ] || p=safe
  profile_index "$p" >/dev/null || { log "Unknown OPENBOT_PROOT_PROFILE '$p'; using safe."; p=safe; }
  echo "$p"
}

if [ "${1:-}" = --print-flags ]; then
  PROFILE=$(choose_profile)
  echo "# profile=$PROFILE"
  flags_for_profile "$PROFILE"
  exit 0
fi
[ "$#" -eq 0 ] || { echo "Usage: $0 [--stop | --print-flags]" >&2; exit 2; }

stop_pid() { # stop_pid <pid> <timeout seconds>
  local pid=$1 t=$2
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM "$pid" 2>/dev/null
  for _ in $(seq 1 $((t * 5))); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.2
  done
  kill -KILL "$pid" 2>/dev/null
}

cleanup() {
  if [ -n "$APP_PID" ]; then stop_pid "$APP_PID" "$STOP_TIMEOUT"; fi
  pkill -u "$(id -u)" -x gnome-keyring-d >/dev/null 2>&1 || pkill -f gnome-keyring-daemon >/dev/null 2>&1
  stop_pid "$XVFB1_PID" 5
  stop_pid "$XVFB0_PID" 5
  stop_pid "$DBUS_PID" 5
  rm -f "$APP_PID_FILE" "$ENGINE_PID_FILE" "$SOCKET" "$BUS" \
    /tmp/.X0-lock /tmp/.X1-lock /tmp/.X11-unix/X0 /tmp/.X11-unix/X1 2>/dev/null
}

on_signal() {
  [ "$STOPPING" = 1 ] && return
  STOPPING=1
  log "Stop requested; stopping OpenBot (up to ${STOP_TIMEOUT}s)."
  set_state stopping "signal"
  cleanup
  set_state stopped "signal" 0
  printf 'OPENBOT_LOCAL_STOPPED code=0\n' >>"$LOG" 2>/dev/null
  exit 0
}
trap on_signal TERM INT HUP QUIT

control_status() { # prints the control-socket answer plus a final status=<http code> line
  [ -S "$SOCKET" ] || return 1
  curl --silent --max-time 5 --unix-socket "$SOCKET" --write-out 'status=%{http_code}\n' \
    http://openbot/v1/status 2>/dev/null
}

# ---------------------------------------------------------------- preflight
mkdir -p "$(dirname "$LOG")" "$LOCAL_STATE" 2>/dev/null
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 20971520 ]; then
  mv -f "$LOG" "$LOG.1"
fi
touch "$LOG" 2>/dev/null || { echo "Cannot write $LOG" >&2; exit 11; }

mkdir -p /run 2>/dev/null
exec 9>"$LOCK_FILE"
flock -n 9 || { log "Another openbot-start.sh is already running."; exit 20; }

log "----- OpenBot Local engine starting (pid $$) -----"
[ -r /opt/OpenBot/engine-version ] && log "engine: $(tr '\n' ' ' </opt/OpenBot/engine-version)"
[ -x "$APP" ] || die 10 "OpenBot is missing at $APP. The rootfs payload is incomplete."
[ -r /proc/self/status ] || die 11 "/proc is not available. Start proot with -b /proc."
[ -c /dev/null ] && [ -r /dev/urandom ] || die 11 "/dev is not available. Start proot with -b /dev."

tracer=$(sed -n 's/^TracerPid:[[:space:]]*//p' /proc/self/status 2>/dev/null)
[ "${tracer:-0}" != 0 ] && log "Running under a ptrace supervisor (proot), TracerPid=$tracer."
[ "$(id -u)" = 0 ] || log "Warning: uid $(id -u); proot -0 is expected. Continuing."
log "kernel: $(uname -r 2>/dev/null) arch: $(uname -m 2>/dev/null)"

# User virtual-address size, from the end of this process's stack mapping (0x7f_ffff_ffff on a 39-bit
# kernel, 0xffff_ffff_ffff on a 48-bit one). Android GKI arm64 kernels usually use 39 bits. Google's
# Antigravity ACP server (the Gemini provider, agy_acp_server.par, 1.2.1 to at least 1.4.1) is built with
# TCMalloc for 48 bits: it reserves memory with MAP_FIXED_NOREPLACE near 0x6c00_0000_0000 and aborts
# ("MmapAligned() failed ... TCMalloc assumes a 48-bit virtual address space") before it answers ACP
# initialize. OpenBot then reports only "could not activate the managed CLI".
# See google-antigravity/antigravity-cli#64. proot cannot change this; it is the kernel's layout.
va_bits() {
  local top bits=0
  top=$(sed -n 's/^[0-9a-f]*-\([0-9a-f]*\) .*\[stack\]$/\1/p' /proc/self/maps 2>/dev/null | tail -n 1)
  [ -n "$top" ] || return 1
  top=$((16#$top))
  while [ "$top" -gt 1 ]; do top=$((top >> 1)); bits=$((bits + 1)); done
  echo $((bits + 1))
}
VA_BITS=$(va_bits) || VA_BITS=""
if [ -n "$VA_BITS" ]; then
  log "user address space: ${VA_BITS}-bit"
  echo "$VA_BITS" >"$LOCAL_STATE/va-bits" 2>/dev/null
  if [ "$VA_BITS" -lt 48 ]; then
    log "Warning: ${VA_BITS}-bit user address space. Google's Gemini (Antigravity) ACP server aborts at start in TCMalloc on such kernels (antigravity-cli#64); its setup ends in \"could not activate the managed CLI\". Other providers are not affected."
  fi
fi

chmod 1777 /tmp 2>/dev/null
touch /tmp/.openbot-write-test 2>/dev/null && rm -f /tmp/.openbot-write-test || die 11 "/tmp is not writable."
mkdir -p /dev/shm 2>/dev/null
if ! { touch /dev/shm/.openbot-test 2>/dev/null && rm -f /dev/shm/.openbot-test; }; then
  log "Warning: /dev/shm is not writable (bind a directory there: -b <rootfs>/tmp:/dev/shm). Chromium uses /tmp."
fi
[ -r /proc/sys/fs/inotify/max_user_watches ] ||
  log "Note: /proc/sys/fs/inotify/max_user_watches is unreadable (bind /opt/openbot-local/proc/max_user_watches over it)."

# libdbus aborts clients when there is no machine id. The payload ships it empty; make one per device.
if [ ! -s /etc/machine-id ]; then
  dbus-uuidgen --ensure=/etc/machine-id 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' >/etc/machine-id
fi
mkdir -p /var/lib/dbus && ln -sf /etc/machine-id /var/lib/dbus/machine-id 2>/dev/null

mkdir -p "$XDG_RUNTIME_DIR" && chmod 0700 "$XDG_RUNTIME_DIR" || die 11 "Cannot make $XDG_RUNTIME_DIR."
echo $$ >"$ENGINE_PID_FILE"
rm -f "$SOCKET" "$BUS" "$APP_PID_FILE" /tmp/.X0-lock /tmp/.X1-lock /tmp/.X11-unix/X0 /tmp/.X11-unix/X1
set_state starting "preflight"

# ---------------------------------------------------------------- D-Bus (path socket, no abstract)
dbus-daemon --session --address="unix:path=$BUS" --nofork --nopidfile >>"$LOG" 2>&1 &
DBUS_PID=$!
for _ in $(seq 1 100); do [ -S "$BUS" ] && break; kill -0 "$DBUS_PID" 2>/dev/null || break; sleep 0.1; done
[ -S "$BUS" ] || die 12 "dbus-daemon did not start (see log)."
export DBUS_SESSION_BUS_ADDRESS="unix:path=$BUS"
log "D-Bus session bus up at $BUS."

# ---------------------------------------------------------------- Xvfb :0 (OpenBot) and :1 (agents)
xvfb_args=(-nolisten tcp)
[ "${OPENBOT_XVFB_SHM:-0}" = 1 ] || xvfb_args+=(-extension MIT-SHM)
# shellcheck disable=SC2206
[ -n "${OPENBOT_XVFB_ARGS:-}" ] && xvfb_args+=($OPENBOT_XVFB_ARGS)
mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
Xvfb :0 -screen 0 1280x800x24 "${xvfb_args[@]}" >>"$LOG" 2>&1 &
XVFB0_PID=$!
Xvfb :1 -screen 0 "$(display_size "${OPENBOT_DISPLAY_SIZE:-}")x24" "${xvfb_args[@]}" >>"$LOG" 2>&1 &
XVFB1_PID=$!
for display in :0 :1; do
  for _ in $(seq 1 200); do
    xdpyinfo -display "$display" >/dev/null 2>&1 && break
    sleep 0.1
  done
  xdpyinfo -display "$display" >/dev/null 2>&1 || die 13 "The virtual display $display did not start (see Xvfb lines in the log)."
done
export DISPLAY=:0 OPENBOT_AGENT_DISPLAY=:1
log "Virtual displays :0 and :1 are up."

# ---------------------------------------------------------------- GNOME keyring (as upstream)
state="$HOME/.config/openbot-container"
keyrings="$HOME/.local/share/keyrings"
mkdir -p "$state" "$keyrings"
if [ ! -s "$state/keyring-password" ] && [ -e "$keyrings/login.keyring" ]; then
  die 14 "The keyring exists, but its password file $state/keyring-password is missing."
fi
if [ ! -s "$state/keyring-password" ]; then
  temporary=$(mktemp "$state/keyring-password.XXXXXX")
  head -c 32 /dev/urandom | base64 | tr -d '\n' >"$temporary"
  mv -f "$temporary" "$state/keyring-password"
  chmod 0600 "$state/keyring-password"
fi
printf login >"$keyrings/default"
if [ "$PASSWORD_STORE" = gnome-libsecret ]; then
  unlocked=$(gnome-keyring-daemon --unlock --components=secrets <"$state/keyring-password" 2>>"$LOG") ||
    die 14 "gnome-keyring-daemon --unlock failed."
  eval "$unlocked"
  started=$(gnome-keyring-daemon --start --components=secrets 2>>"$LOG") ||
    die 14 "gnome-keyring-daemon --start failed."
  eval "$started"
  export GNOME_KEYRING_CONTROL
  ok=0
  for _ in $(seq 1 50); do
    if dbus-send --session --print-reply --dest=org.freedesktop.secrets /org/freedesktop/secrets \
      org.freedesktop.DBus.Properties.Get string:org.freedesktop.Secret.Service string:Collections >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 0.2
  done
  [ "$ok" = 1 ] || die 14 "The Secret Service (org.freedesktop.secrets) does not answer on D-Bus; Electron safeStorage would fail."
  log "Keyring unlocked; Secret Service answers."
else
  log "Warning: --password-store=$PASSWORD_STORE. The account session cannot be stored securely."
fi

# ---------------------------------------------------------------- OpenBot
export OPENBOT_SERVER=1
export ELECTRON_DISABLE_SANDBOX=1 ELECTRON_OZONE_PLATFORM_HINT=x11 NO_AT_BRIDGE=1 GTK_A11Y=none
export LIBGL_ALWAYS_SOFTWARE=1 GDK_BACKEND=x11
[ "${OPENBOT_VERBOSE:-0}" = 1 ] && export ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1

PROFILE=$(choose_profile)
launch() {
  local flags=()
  mapfile -t flags < <(flags_for_profile "$PROFILE")
  LAUNCH_OFFSET=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
  log "Launching OpenBot, profile=$PROFILE: $APP ${flags[*]}"
  # As uid 0 (proot -0, or a chroot) Electron aborts every renderer, because OpenBot enables the
  # renderer sandbox; the shim makes getuid() non-zero in those processes only (nonroot-shim.c).
  local preload=""
  if [ "$(id -u)" = 0 ] && [ -f "$NONROOT_SHIM" ] && [ "${OPENBOT_NONROOT_SHIM:-1}" = 1 ]; then preload=$NONROOT_SHIM; fi
  LD_PRELOAD=$preload "$APP" "${flags[@]}" >>"$LOG" 2>&1 &
  APP_PID=$!
  echo "$APP_PID" >"$APP_PID_FILE"
  set_state starting "launched"
}

crash_count() {
  tail -c +"$((LAUNCH_OFFSET + 1))" "$LOG" 2>/dev/null | grep -c 'Network service crashed' || true
}

next_profile() {
  local i
  i=$(profile_index "$PROFILE") || return 1
  [ $((i + 1)) -lt "${#PROFILES[@]}" ] || return 1
  echo "${PROFILES[$((i + 1))]}"
}

hint_from_log() {
  local tail_text
  tail_text=$(tail -c +"$((LAUNCH_OFFSET + 1))" "$LOG" 2>/dev/null)
  grep -q 'NETLINK' <<<"$tail_text" &&
    log "Hint: netlink is denied by Android SELinux. Use termux/proot >= 5.1.107.91 (netlink emulation) or set PROOT_NO_SECCOMP=1 on the proot process."
  grep -q 'IS_IN_SYSENTER' <<<"$tail_text" &&
    log "Hint: proot assertion IS_IN_SYSENTER: upgrade proot to >= 5.1.107.91 or set PROOT_NO_SECCOMP=1."
  grep -qi 'os_crypt\|safeStorage\|libsecret' <<<"$tail_text" &&
    log "Hint: keyring / os_crypt errors in the log; check the gnome-keyring lines above."
  return 0
}

launch
deadline=$((SECONDS + READY_TIMEOUT))
ready=0
while :; do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    wait "$APP_PID" 2>/dev/null
    code=$?
    hint_from_log
    if [ "$ready" = 0 ]; then
      if [ "$(crash_count)" -ge 1 ] && [ "$AUTO_ESCALATE" = 1 ] && np=$(next_profile); then
        log "OpenBot exited (code $code) after network-service crashes; retrying with profile=$np."
        PROFILE=$np
        launch
        deadline=$((SECONDS + READY_TIMEOUT))
        continue
      fi
      die 15 "OpenBot exited with code $code before it was ready (see log above)."
    fi
    APP_PID=""
    if [ "$code" = 0 ]; then
      log "OpenBot exited cleanly."
      set_state stopped "openbot exited" 0
      printf 'OPENBOT_LOCAL_STOPPED code=0\n' >>"$LOG"
      cleanup
      exit 0
    fi
    die 18 "OpenBot exited with code $code."
  fi

  if [ "$ready" = 0 ]; then
    if answer=$(control_status) && grep -qx 'status=200' <<<"$answer"; then
      ready=1
      echo "$PROFILE" >"$LOCAL_STATE/profile"
      version=$(sed -n 's/^version=//p' <<<"$answer")
      account=$(sed -n 's/^account=//p' <<<"$answer")
      server=$(sed -n 's/^server=//p' <<<"$answer")
      set_state ready "control socket answers" 0
      printf 'OPENBOT_LOCAL_READY version=%s account=%s server=%s profile=%s socket=%s\n' \
        "$version" "$account" "$server" "$PROFILE" "$SOCKET" >>"$LOG"
      log "Ready: OpenBot $version, account=$account, server=$server."
      [ "$account" = signed_in ] || log "Not signed in yet. Run: openbot login (or POST /v1/login/start on the control socket)."
    else
      count=$(crash_count)
      if [ "$count" -ge "$CRASH_THRESHOLD" ]; then
        hint_from_log
        if [ "$AUTO_ESCALATE" = 1 ] && np=$(next_profile); then
          log "Network service crash loop ($count crashes) with profile=$PROFILE; restarting with profile=$np."
          stop_pid "$APP_PID" 15
          wait "$APP_PID" 2>/dev/null
          PROFILE=$np
          launch
          deadline=$((SECONDS + READY_TIMEOUT))
          continue
        fi
        die 17 "Network service crash loop ($count crashes) with profile=$PROFILE and no fallback left."
      fi
      if [ "$SECONDS" -ge "$deadline" ]; then
        hint_from_log
        die 16 "OpenBot did not answer on $SOCKET within ${READY_TIMEOUT}s."
      fi
    fi
    sleep 1
  else
    sleep 2
  fi
done
