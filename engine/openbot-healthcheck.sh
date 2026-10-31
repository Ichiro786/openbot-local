#!/bin/bash
# OpenBot Local engine payload check: /usr/local/bin/openbot-healthcheck inside the rootfs.
# Static checks that the payload can start: the app, its shared libraries, the server tools and the
# upstream `openbot` CLI in container mode. It starts nothing. The CI build runs it in a chroot, and
# the Android app can run it after unpacking (inside proot) before the first start.
# Exit 0 when every check passes, 1 otherwise.
set -uo pipefail
APP=/opt/OpenBot/app/openbot
failures=0
ok() { printf 'ok    %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }

[ -x "$APP" ] && ok "app binary $APP" || bad "app binary $APP missing"
[ -r /opt/OpenBot/app/resources/app.asar ] || [ -d /opt/OpenBot/app/resources/app ] &&
  ok "app resources" || bad "app resources (resources/app.asar) missing"
if [ -x "$APP" ]; then
  missing=$(ldd "$APP" 2>/dev/null | awk '/not found/ {print $1}' | sort -u | tr '\n' ' ')
  [ -z "$missing" ] && ok "shared libraries of $APP" || bad "missing libraries: $missing"
  for lib in /opt/OpenBot/app/*.so; do
    [ -e "$lib" ] || continue
    m=$(ldd "$lib" 2>/dev/null | awk '/not found/ {print $1}' | sort -u | tr '\n' ' ')
    [ -z "$m" ] || bad "missing libraries for $lib: $m"
  done
fi
for cmd in bash curl dbus-daemon dbus-send dbus-uuidgen gnome-keyring-daemon Xvfb xdpyinfo xauth \
  flock pkill openssl git base64 mktemp; do
  command -v "$cmd" >/dev/null 2>&1 && ok "command $cmd" || bad "command $cmd not found"
done
[ "$(cat /opt/OpenBot/hosted/mode 2>/dev/null)" = container ] && ok "hosted mode = container" ||
  bad "/opt/OpenBot/hosted/mode is not 'container'"
[ -x "$(readlink -f /usr/local/bin/openbot 2>/dev/null)" ] && ok "openbot CLI on PATH" || bad "openbot CLI link broken"
[ -x /root/openbot-start.sh ] && ok "/root/openbot-start.sh" || bad "/root/openbot-start.sh missing"
[ -x /root/openbot-status.sh ] && ok "/root/openbot-status.sh" || bad "/root/openbot-status.sh missing"
bash -n /root/openbot-start.sh 2>/dev/null && ok "launcher syntax" || bad "launcher syntax error"
[ -s /etc/resolv.conf ] && ok "/etc/resolv.conf" || bad "/etc/resolv.conf empty"
for f in loadavg stat uptime version vmstat cap_last_cap max_user_watches; do
  [ -r "/opt/openbot-local/proc/$f" ] || bad "fake proc entry /opt/openbot-local/proc/$f missing"
done
ok "fake proc entries checked"
[ -r /opt/OpenBot/engine-version ] && ok "engine-version: $(tr '\n' ' ' </opt/OpenBot/engine-version)"

if [ "$failures" -eq 0 ]; then
  echo "HEALTHCHECK OK"
  exit 0
fi
echo "HEALTHCHECK FAILED ($failures)"
exit 1
