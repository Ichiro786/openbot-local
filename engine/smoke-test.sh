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
  chroot "$M" /usr/bin/env -i "${envs[@]}" /bin/bash /root/openbot-start.sh &
  runner=$!
elif [ "$MODE" = proot ]; then
  command -v proot >/dev/null || { echo "proot is not installed" >&2; exit 2; }
  PROOT_NO_SECCOMP=${PROOT_NO_SECCOMP:-} proot --kill-on-exit --link2symlink -0 -r "$M" -w /root \
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
exit "$rc"
