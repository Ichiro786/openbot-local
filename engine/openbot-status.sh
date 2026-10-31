#!/bin/bash
# OpenBot Local engine status: /root/openbot-status.sh inside the rootfs.
#
# Reports whether the OpenBot server started by openbot-start.sh is up, from three sources:
# the launcher state file (/run/openbot/engine.state), the OpenBot process, and the answer of the
# OpenBot control socket (/run/openbot/control.sock, GET /v1/status - the same call `openbot status`
# makes). Prints key=value lines (or one JSON object with --json).
#
# Usage: openbot-status.sh [--json] [--quiet] [--wait SECONDS]
#   --wait N   keep checking for up to N seconds until the server is ready (exit 0) or failed.
#
# Exit codes: 0 ready (control socket answers 200), 1 starting / not answering yet,
#             2 failed, stopped or not running, 3 usage error.
set -uo pipefail
export XDG_RUNTIME_DIR=/run/openbot
SOCKET="$XDG_RUNTIME_DIR/control.sock"
STATE_FILE="$XDG_RUNTIME_DIR/engine.state"
APP_PID_FILE="$XDG_RUNTIME_DIR/openbot.pid"
ENGINE_PID_FILE="$XDG_RUNTIME_DIR/engine.pid"

json=0
quiet=0
wait_for=0
while [ "$#" -gt 0 ]; do
  case $1 in
    --json) json=1; shift ;;
    --quiet | -q) quiet=1; shift ;;
    --wait)
      [[ ${2:-} =~ ^[0-9]+$ ]] || { echo "Usage: $0 [--json] [--quiet] [--wait SECONDS]" >&2; exit 3; }
      wait_for=$2
      shift 2
      ;;
    -h | --help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Usage: $0 [--json] [--quiet] [--wait SECONDS]" >&2; exit 3 ;;
  esac
done

alive() { [[ ${1:-} =~ ^[1-9][0-9]*$ ]] && kill -0 "$1" 2>/dev/null; }
field() { sed -n "s/^$1=//p" <<<"$2" | head -n 1; }

check() {
  engine_state=$(field state "$(cat "$STATE_FILE" 2>/dev/null)")
  state_reason=$(field reason "$(cat "$STATE_FILE" 2>/dev/null)")
  profile=$(field profile "$(cat "$STATE_FILE" 2>/dev/null)")
  engine_pid=$(cat "$ENGINE_PID_FILE" 2>/dev/null || true)
  openbot_pid=$(cat "$APP_PID_FILE" 2>/dev/null || true)
  engine_alive=false; alive "$engine_pid" && engine_alive=true
  openbot_alive=false; alive "$openbot_pid" && openbot_alive=true
  socket=false; [ -S "$SOCKET" ] && socket=true
  http=""; version=""; account=""; email=""; server=""; server_name=""; memory_level=""
  if [ "$socket" = true ]; then
    answer=$(curl --silent --max-time 5 --unix-socket "$SOCKET" --write-out 'status=%{http_code}\n' \
      http://openbot/v1/status 2>/dev/null || true)
    http=$(field status "$answer")
    version=$(field version "$answer")
    account=$(field account "$answer")
    email=$(field email "$answer")
    server=$(field server "$answer")
    server_name=$(field server_name "$answer")
    memory_level=$(field memory_level "$answer")
  fi
  if [ "$http" = 200 ]; then
    up=ready; rc=0
  elif [ "$engine_alive" = true ] && [ "$engine_state" != failed ]; then
    up=starting; rc=1
  else
    up=down; rc=2
  fi
}

check
if [ "$wait_for" -gt 0 ]; then
  end=$((SECONDS + wait_for))
  while [ "$rc" = 1 ] && [ "$SECONDS" -lt "$end" ]; do
    sleep 2
    check
  done
fi

if [ "$quiet" = 0 ]; then
  if [ "$json" = 1 ]; then
    esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
    printf '{"up":"%s","engine_state":"%s","reason":"%s","profile":"%s","engine_alive":%s,"openbot_alive":%s,"socket":%s,"http":"%s","version":"%s","account":"%s","email":"%s","server":"%s","server_name":"%s","memory_level":"%s"}\n' \
      "$up" "$(esc "$engine_state")" "$(esc "$state_reason")" "$(esc "$profile")" "$engine_alive" "$openbot_alive" \
      "$socket" "$http" "$(esc "$version")" "$(esc "$account")" "$(esc "$email")" "$(esc "$server")" \
      "$(esc "$server_name")" "$(esc "$memory_level")"
  else
    cat <<EOF
up=$up
engine_state=$engine_state
reason=$state_reason
profile=$profile
engine_alive=$engine_alive
openbot_alive=$openbot_alive
socket=$socket
http=$http
version=$version
account=$account
email=$email
server=$server
server_name=$server_name
memory_level=$memory_level
EOF
  fi
fi
exit "$rc"
