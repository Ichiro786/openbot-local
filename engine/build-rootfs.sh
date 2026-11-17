#!/bin/bash
# Builds the OpenBot Local engine payload: an Ubuntu 24.04 arm64 rootfs with the OpenBot Linux arm64
# release unpacked at /opt/OpenBot/app, packed as rootfs-arm64.tar.xz for PRoot on Android.
#
# Runs as root on an arm64 Ubuntu host (GitHub runner ubuntu-24.04-arm). It mirrors upstream
# docker/Dockerfile: verify the AppImage against the release manifest (as scripts/install-server.sh
# does), --appimage-extract it, install resources/hosting/packages.txt without apparmor plus the
# Dockerfile's extra tools, put the release at /opt/OpenBot/app, write `container` to
# /opt/OpenBot/hosted/mode and link the `openbot` CLI.
#
# Environment:
#   OUT_DIR           where the payload goes (default ./out)
#   WORK_DIR          scratch (default ./build)
#   OPENBOT_VERSION   a release to package, e.g. 0.57.0 (default: the latest release manifest)
#   UBUNTU_BASE_DIR   ubuntu-base release dir URL (default 24.04 release on cdimage.ubuntu.com)
#   KEEP_APP_LOCALES  space separated Chromium locale .pak names to keep (default "en-US")
#   XZ_LEVEL          xz preset (default 9)
#   GIT_SHA           recorded in engine-version (default: unknown)
#   ENGINE_REVISION   payload revision for the same OpenBot version: tag engine-<version>-<n> (default: none)
#   SIZE_GATE_MIB     fail when the unpacked rootfs is larger (default 1050)
#   ZSTD_LEVEL        zstd preset for rootfs-arm64.tar.zst (default 19, with --long=27)
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
OUT_DIR=$(realpath -m "${OUT_DIR:-./out}")
WORK_DIR=$(realpath -m "${WORK_DIR:-./build}")
ROOTFS="$WORK_DIR/rootfs"
RELEASES=https://github.com/nightly-labs/openbot/releases
UBUNTU_BASE_DIR="${UBUNTU_BASE_DIR:-https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release}"
KEEP_APP_LOCALES="${KEEP_APP_LOCALES:-en-US}"
XZ_LEVEL="${XZ_LEVEL:-9}"
ENGINE_REVISION="${ENGINE_REVISION:-}"

fail() { echo "build-rootfs: $*" >&2; exit 1; }
step() { echo "::group::$*" 2>/dev/null || true; echo "==> $*"; }
endstep() { echo "::endgroup::" 2>/dev/null || true; }
fetch() { curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --silent --show-error --retry 3 "$@"; }

[ "$(id -u)" -eq 0 ] || fail "run as root"
[ "$(uname -m)" = aarch64 ] || fail "run on an arm64 host (the chroot runs arm64 binaries natively)"
for c in curl tar xz zstd sha256sum openssl chroot cc jq; do command -v "$c" >/dev/null || fail "missing $c"; done
[[ -z $ENGINE_REVISION || $ENGINE_REVISION =~ ^[1-9][0-9]*$ ]] || fail "ENGINE_REVISION must be a positive number"

MOUNTS=()
cleanup_mounts() {
  local i
  for ((i = ${#MOUNTS[@]} - 1; i >= 0; i--)); do umount -l "${MOUNTS[$i]}" 2>/dev/null || true; done
  MOUNTS=()
}
trap cleanup_mounts EXIT
bind_mount() { mkdir -p "$2"; mount --bind "$1" "$2"; MOUNTS+=("$2"); }

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR" "$OUT_DIR"

# ------------------------------------------------------------------ 1. OpenBot release
step "Resolve and verify the OpenBot arm64 AppImage"
if [ -n "${OPENBOT_VERSION:-}" ]; then
  manifest=$(fetch "$RELEASES/download/v$OPENBOT_VERSION/latest-linux-arm64.yml")
else
  manifest=$(fetch "$RELEASES/latest/download/latest-linux-arm64.yml")
fi
version=$(sed -n 's/^version: *//p' <<<"$manifest" | head -n 1)
path=$(sed -n 's/^path: *//p' <<<"$manifest" | head -n 1)
sha512=$(sed -n 's/^sha512: *//p' <<<"$manifest" | head -n 1)
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "the release manifest has no valid version"
[ "$path" = "OpenBot-$version-arm64.AppImage" ] || fail "the release manifest names another file: $path"
[[ $sha512 =~ ^[A-Za-z0-9+/]{86}==$ ]] || fail "the release manifest has no valid SHA-512"
echo "OpenBot $version ($path)"
fetch --output "$WORK_DIR/OpenBot.AppImage" "$RELEASES/download/v$version/$path"
[ "$(openssl dgst -sha512 -binary "$WORK_DIR/OpenBot.AppImage" | openssl base64 -A)" = "$sha512" ] ||
  fail "the AppImage does not match the release manifest"
chmod 0700 "$WORK_DIR/OpenBot.AppImage"
(cd "$WORK_DIR" && ./OpenBot.AppImage --appimage-extract >/dev/null)
APP_SRC="$WORK_DIR/squashfs-root"
[ -x "$APP_SRC/openbot" ] || fail "the AppImage has no openbot binary"
[ -x "$APP_SRC/resources/hosting/openbot" ] || fail "the release has no resources/hosting/openbot CLI (too old for server mode)"
[ -f "$APP_SRC/resources/hosting/packages.txt" ] || fail "the release has no resources/hosting/packages.txt"
chmod -R u+rwX,go=rX "$APP_SRC"
rm -f "$WORK_DIR/OpenBot.AppImage"
endstep

# OpenBot Local engine patches (engine/patches/<version>/*.patch), e.g. DM context in group chats.
# Publish a patched payload under a revision: engine-<version>-<n> (rootfs.yml input "revision").
if compgen -G "$SCRIPT_DIR/patches/$version/*.patch" >/dev/null; then
  step "Rebuild the engine main bundle with the fork's patches"
  [ -n "${ENGINE_REVISION:-}" ] || fail "engine/patches/$version exists: set a payload revision (engine-$version-<n>)"
  bash "$SCRIPT_DIR/patch-engine-main.sh" "$APP_SRC" "$version" "$SCRIPT_DIR/patches/$version"
  endstep
fi

# ------------------------------------------------------------------ 2. Ubuntu base
step "Download and verify ubuntu-base 24.04 arm64"
sums=$(fetch "$UBUNTU_BASE_DIR/SHA256SUMS")
base_file=$(grep -oE 'ubuntu-base-24\.04(\.[0-9]+)?-base-arm64\.tar\.gz' <<<"$sums" | sort -uV | tail -n 1)
[ -n "$base_file" ] || fail "no ubuntu-base arm64 tarball in $UBUNTU_BASE_DIR/SHA256SUMS"
base_sha=$(awk -v f="$base_file" '$2 == f || $2 == "*"f {print $1}' <<<"$sums" | head -n 1)
fetch --output "$WORK_DIR/$base_file" "$UBUNTU_BASE_DIR/$base_file"
echo "$base_sha  $WORK_DIR/$base_file" | sha256sum -c -
mkdir -p "$ROOTFS"
tar -xpzf "$WORK_DIR/$base_file" -C "$ROOTFS" --numeric-owner
rm -f "$WORK_DIR/$base_file"
base_version=${base_file#ubuntu-base-}
base_version=${base_version%-base-arm64.tar.gz}
endstep

# ------------------------------------------------------------------ 3. Packages (chroot)
step "Install the OpenBot runtime packages"
cp -L /etc/resolv.conf "$ROOTFS/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' >"$ROOTFS/usr/sbin/policy-rc.d"
chmod 0755 "$ROOTFS/usr/sbin/policy-rc.d"
# Keep docs, man pages and most translations out from the first install on, and for later installs
# done inside the payload on the phone.
cat >"$ROOTFS/etc/dpkg/dpkg.cfg.d/01-openbot-local-nodoc" <<'EOF'
path-exclude /usr/share/doc/*
path-include /usr/share/doc/*/copyright
path-exclude /usr/share/man/*
path-exclude /usr/share/info/*
path-exclude /usr/share/groff/*
path-exclude /usr/share/lintian/*
path-exclude /usr/share/linda/*
path-exclude /usr/share/locale/*
path-include /usr/share/locale/locale.alias
EOF
cat >"$ROOTFS/etc/apt/apt.conf.d/01-openbot-local" <<'EOF'
APT::Install-Recommends "false";
APT::Install-Suggests "false";
Acquire::Languages "none";
EOF
bind_mount /proc "$ROOTFS/proc"
bind_mount /sys "$ROOTFS/sys"
bind_mount /dev "$ROOTFS/dev"
bind_mount /dev/pts "$ROOTFS/dev/pts"

# The release's own list (as docker/Dockerfile) without apparmor, which only a host kernel loads, and
# without the agent-display desktop (openbox, lxterminal, pcmanfm, hsetroot: upstream's container starts
# it for remote desktop; this launcher does not, and nothing on the phone views that display).
release_pkgs=$(sed -e 's/#.*//' -e '/^[[:space:]]*$/d' -e '/^apparmor$/d' \
  -e '/^\(openbox\|lxterminal\|pcmanfm\|hsetroot\)$/d' "$APP_SRC/resources/hosting/packages.txt")
# The task's list (overlaps the release list) and docker/Dockerfile's extra tools.
extra_pkgs="ca-certificates curl openssl dbus dbus-x11 gnome-keyring libsecret-1-0 x11-utils xauth xvfb
libasound2t64 libgbm1 libgtk-3-0t64 libnss3 libxss1 git
less openssh-client procps ripgrep tini unzip xz-utils
util-linux bash coreutils fonts-dejavu-core"
pkgs=$(printf '%s\n%s\n' "$release_pkgs" "$extra_pkgs" | tr ' ' '\n' | sed '/^$/d' | sort -u | tr '\n' ' ')
echo "Packages: $pkgs"
chroot "$ROOTFS" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin DEBIAN_FRONTEND=noninteractive \
  bash -euc "apt-get update && apt-get -y upgrade && apt-get install -y --no-install-recommends $pkgs"
endstep

# ------------------------------------------------------------------ 4. OpenBot + engine scripts
step "Install OpenBot and the engine scripts"
mkdir -p "$ROOTFS/opt/OpenBot"
cp -a "$APP_SRC" "$ROOTFS/opt/OpenBot/app"
chown -R 0:0 "$ROOTFS/opt/OpenBot/app"
# No SUID anywhere (Android cannot honour it, and upstream ships none either).
find "$ROOTFS/opt/OpenBot/app" -perm /6000 -type f -exec chmod ug-s {} +
install -d -m 0755 "$ROOTFS/opt/OpenBot/hosted"
printf 'container\n' >"$ROOTFS/opt/OpenBot/hosted/mode"
ln -sfn /opt/OpenBot/app/resources/hosting/openbot "$ROOTFS/usr/local/bin/openbot"
install -m 0755 "$SCRIPT_DIR/openbot-start.sh" "$ROOTFS/root/openbot-start.sh"
install -m 0755 "$SCRIPT_DIR/openbot-status.sh" "$ROOTFS/root/openbot-status.sh"
install -m 0755 "$SCRIPT_DIR/openbot-healthcheck.sh" "$ROOTFS/usr/local/bin/openbot-healthcheck"
ln -sfn /root/openbot-start.sh "$ROOTFS/usr/local/bin/openbot-start"
ln -sfn /root/openbot-status.sh "$ROOTFS/usr/local/bin/openbot-engine-status"
install -d -m 0700 "$ROOTFS/run/openbot"

# Fake /proc entries for Android, where untrusted apps cannot read these. The app binds each one
# over the real path only when the real one is unreadable (see README-ENGINE.md).
fp="$ROOTFS/opt/openbot-local/proc"
install -d -m 0755 "$fp"
printf '0.12 0.07 0.02 2/165 765\n' >"$fp/loadavg"
printf '284684.56 513853.46\n' >"$fp/uptime"
printf 'Linux version 6.1.0-openbot-local (proot@localhost) (gcc) #1 SMP PREEMPT\n' >"$fp/version"
printf '40\n' >"$fp/cap_last_cap"
printf '524288\n' >"$fp/max_user_watches"
cat >"$fp/stat" <<'EOF'
cpu  1957 0 2877 93280 262 342 254 87 0 0
cpu0 31 0 226 12027 82 10 4 9 0 0
intr 63361 0 9 0 0 0 0 3 0 0 0 0 0 0 0 0 0
ctxt 38014093
btime 1694292441
processes 26442
procs_running 1
procs_blocked 0
softirq 75663 0 5903 6 25375 10774 0 243 11685 0 21677
EOF
cat >"$fp/vmstat" <<'EOF'
nr_free_pages 1743136
nr_zone_inactive_anon 179281
nr_zone_active_anon 7183
nr_zone_inactive_file 22858
nr_zone_active_file 51328
nr_mlock 0
pgpgin 198
pgpgout 0
pswpin 0
pswpout 0
EOF
chmod 0644 "$fp"/*

# getuid() shim for the Electron renderers (see nonroot-shim.c). Built on the arm64 Ubuntu 24.04
# host, the same glibc as the payload.
install -d -m 0755 "$ROOTFS/opt/openbot-local/lib"
cc -O2 -Wall -shared -fPIC -o "$ROOTFS/opt/openbot-local/lib/libopenbot-nonroot.so" "$SCRIPT_DIR/nonroot-shim.c"
chmod 0755 "$ROOTFS/opt/openbot-local/lib/libopenbot-nonroot.so"

# Antigravity (Gemini) runtime tools. OpenBot >= 0.69 uses Google's Antigravity CLI (Go, 39-bit safe),
# which prepare.sh downloads on the phone (pinned below), checks (sha256) and smoke-tests under /root (kept
# on engine updates). /opt/agy-hybrid/current points at it; openbot-start.sh uses it once it is .ready.
# Only our scripts ship here, nothing from Google. No CPython since 0.72: prepare.sh is bash, and the 1.4
# Python hybrid of engines <= 0.61 is gone (see agy-hybrid/README.md).
install -d -m 0755 "$ROOTFS/opt/agy-hybrid/tools"
install -m 0644 "$SCRIPT_DIR/agy-hybrid/prepare.sh" "$ROOTFS/opt/agy-hybrid/tools/prepare.sh"
for f in open-url agy-hybrid.sh; do install -m 0755 "$SCRIPT_DIR/agy-hybrid/$f" "$ROOTFS/opt/agy-hybrid/tools/$f"; done
ln -sfn /root/.local/share/agy-hybrid/current "$ROOTFS/opt/agy-hybrid/current"
ln -sfn /opt/agy-hybrid/tools/agy-hybrid.sh "$ROOTFS/usr/local/bin/agy-hybrid"
# prepare.sh pins the Antigravity CLI that this OpenBot build was tested with (native-runtime.lock.json,
# bundled in app.asar). A different pin would hand the engine a CLI it does not expect.
agy_cli_sha=$(sed -n 's/^CLI_SHA256="\([0-9a-f]\{64\}\)".*/\1/p' "$SCRIPT_DIR/agy-hybrid/prepare.sh")
agy_cli_ver=$(sed -n 's/^CLI_VERSION="\([0-9.]*\)".*/\1/p' "$SCRIPT_DIR/agy-hybrid/prepare.sh")
[ -n "$agy_cli_sha" ] && [ -n "$agy_cli_ver" ] || fail "no CLI_VERSION / CLI_SHA256 in agy-hybrid/prepare.sh"
if grep -q -a -F "$agy_cli_sha" "$ROOTFS/opt/OpenBot/app/resources/app.asar"; then
  echo "Antigravity CLI pin $agy_cli_ver matches this OpenBot's native-runtime.lock.json"
else
  echo "::warning::prepare.sh pins Antigravity CLI $agy_cli_ver ($agy_cli_sha), which this OpenBot's app.asar does not name; update CLI_* in engine/agy-hybrid/prepare.sh"
fi
printf 'antigravity_cli=%s\n' "$agy_cli_ver" >"$ROOTFS/opt/agy-hybrid/tools/versions"

# Static DNS and identity. Android has no readable /etc/resolv.conf; the app may overwrite this file
# with the device's DNS servers before each start.
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\noptions single-request-reopen\n' >"$ROOTFS/etc/resolv.conf"
printf '127.0.0.1 localhost openbot-local\n::1 localhost ip6-localhost ip6-loopback\n' >"$ROOTFS/etc/hosts"
printf 'openbot-local\n' >"$ROOTFS/etc/hostname"
# One machine id per device: the launcher creates it on first start.
: >"$ROOTFS/etc/machine-id"
rm -f "$ROOTFS/var/lib/dbus/machine-id"

cat >"$ROOTFS/opt/OpenBot/engine-version" <<EOF
openbot=$version
ubuntu_base=$base_version
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
git=${GIT_SHA:-unknown}
revision=${ENGINE_REVISION:-0}
patches=$(cat "$ROOTFS/opt/OpenBot/app/resources/openbot-local-patches.txt" 2>/dev/null | paste -sd, - || true)
EOF
chmod 0644 "$ROOTFS/opt/OpenBot/engine-version"
endstep

step "Health check (chroot)"
chroot "$ROOTFS" /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/root /usr/local/bin/openbot-healthcheck
endstep

# ------------------------------------------------------------------ 5. Shrink
step "Strip caches, docs and locales"
size_before=$(du -smx "$ROOTFS" 2>/dev/null | cut -f1 || true) # /proc etc. are still bind-mounted here
chroot "$ROOTFS" /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin bash -c 'apt-get clean'
cleanup_mounts
rm -f "$ROOTFS/usr/sbin/policy-rc.d"
rm -rf "$ROOTFS"/var/lib/apt/lists/* "$ROOTFS"/var/cache/apt/* "$ROOTFS"/var/cache/debconf/*-old \
  "$ROOTFS"/var/cache/ldconfig/* "$ROOTFS"/var/log/* "$ROOTFS"/tmp/* "$ROOTFS"/var/tmp/* \
  "$ROOTFS"/root/.cache "$ROOTFS"/root/.bash_history
find "$ROOTFS/usr/share/doc" -mindepth 1 ! -name copyright ! -type d -delete 2>/dev/null || true
find "$ROOTFS/usr/share/doc" -mindepth 1 -type d -empty -delete 2>/dev/null || true
rm -rf "$ROOTFS"/usr/share/{man,info,groff,lintian,linda,bug,doc-base,gtk-doc,help}
find "$ROOTFS/usr/share/locale" -mindepth 1 -maxdepth 1 ! -name locale.alias -exec rm -rf {} + 2>/dev/null || true
find "$ROOTFS/usr/share/i18n/locales" -mindepth 1 -maxdepth 1 ! -name 'C' ! -name 'en_US' ! -name 'en_GB' \
  ! -name 'i18n*' ! -name 'iso14651_t1*' ! -name 'translit_*' -exec rm -rf {} + 2>/dev/null || true
find "$ROOTFS" -xdev -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
# Chromium UI translations of the Electron shell; OpenBot's own UI strings live in app.asar.
if [ -d "$ROOTFS/opt/OpenBot/app/locales" ]; then
  keep_expr=()
  for l in $KEEP_APP_LOCALES; do keep_expr+=(! -name "$l.pak"); done
  find "$ROOTFS/opt/OpenBot/app/locales" -name '*.pak' "${keep_expr[@]}" -delete
fi
# Files that nothing maps on the phone (research/engine-optimize, measured: same boot and idle without them).
# Mesa (LLVM, gallium, DRI, GBM, GLX/EGL/Vulkan drivers): Electron runs --disable-gpu with its own
# SwiftShader, and Xvfb runs -extension GLX. The packages stay installed for their dependants.
L="$ROOTFS/usr/lib/aarch64-linux-gnu"
rm -rf "$L"/libLLVM* "$L"/libgallium* "$L/dri" "$L/gbm" "$L"/libGLX_mesa* "$L"/libEGL_mesa* "$L"/libvulkan_*.so
# Icon themes other than the GTK fallbacks (Adwaita, hicolor); GTK 4 (pulled by gcr4, Electron loads GTK 3);
# the second copy of Chromium's licence (the app folder keeps LICENSES.chromium.html).
find "$ROOTFS/usr/share/icons" -mindepth 1 -maxdepth 1 ! -name Adwaita ! -name hicolor ! -name default -exec rm -rf {} +
rm -f "$L"/libgtk-4.so*
rm -f "$ROOTFS/opt/OpenBot/app/resources/licenses/LICENSES.chromium.html"
mkdir -p "$ROOTFS/tmp" "$ROOTFS/var/tmp" "$ROOTFS/var/log" "$ROOTFS/var/lib/apt/lists/partial" "$ROOTFS/var/cache/apt/archives/partial"
chmod 1777 "$ROOTFS/tmp" "$ROOTFS/var/tmp"
# Nothing of a test run may ship: no keyring, no session, no log.
rm -rf "$ROOTFS/root/.config" "$ROOTFS/root/.local" "$ROOTFS/root/openbot.log"* "$ROOTFS/run/openbot"/* "$ROOTFS/run/openbot-start.lock"
size_after=$(du -sm "$ROOTFS" | cut -f1)
echo "rootfs: ${size_before} MiB -> ${size_after} MiB"
# Size gate: a dependency that drags in a toolkit or a driver stack should fail here, not on the phone.
[ "$size_after" -le "${SIZE_GATE_MIB:-1050}" ] ||
  fail "the rootfs is ${size_after} MiB, over the ${SIZE_GATE_MIB:-1050} MiB gate (SIZE_GATE_MIB)"
endstep

# ------------------------------------------------------------------ 6. Pack
step "Pack rootfs-arm64.tar.zst and rootfs-arm64.tar.xz"
# --hard-dereference: Android's app domain cannot create hard links, so every hard link is stored as
# a regular file. /dev, /proc and /sys stay empty: proot binds the host's.
# zstd (decodes about 9x faster than xz on the phone's one-thread path) is what the APK bundles; xz stays
# one more release for apps that update from the network and only know .tar.xz.
tar -C "$ROOTFS" --numeric-owner --owner=0 --group=0 --hard-dereference --sort=name \
  --exclude='./dev/*' --exclude='./proc/*' --exclude='./sys/*' -cf "$WORK_DIR/rootfs.tar" .
xz -T0 "-$XZ_LEVEL" --check=crc64 -c "$WORK_DIR/rootfs.tar" >"$OUT_DIR/rootfs-arm64.tar.xz" &
xz_pid=$!
zstd -q -T0 "-${ZSTD_LEVEL:-19}" --long=27 -c "$WORK_DIR/rootfs.tar" >"$OUT_DIR/rootfs-arm64.tar.zst"
wait "$xz_pid" || fail "xz failed"
rm -f "$WORK_DIR/rootfs.tar"
(cd "$OUT_DIR" && sha256sum rootfs-arm64.tar.xz >rootfs-arm64.tar.xz.sha256 &&
  sha256sum rootfs-arm64.tar.zst >rootfs-arm64.tar.zst.sha256)
zst_sha=$(cut -d' ' -f1 "$OUT_DIR/rootfs-arm64.tar.zst.sha256")
zst_bytes=$(stat -c %s "$OUT_DIR/rootfs-arm64.tar.zst")
sha=$(cut -d' ' -f1 "$OUT_DIR/rootfs-arm64.tar.xz.sha256")
compressed=$(stat -c %s "$OUT_DIR/rootfs-arm64.tar.xz")
uncompressed=$(xz --robot --list "$OUT_DIR/rootfs-arm64.tar.xz" | awk '$1 == "totals" {print $5}')
installed=$(du -sb "$ROOTFS" | cut -f1)
files=$(find "$ROOTFS" | wc -l)
cat >"$OUT_DIR/engine.json" <<EOF
{
  "name": "openbot-local-engine",
  "tag": "engine-$version${ENGINE_REVISION:+-$ENGINE_REVISION}",
  "version": "$version",
  "openbot_version": "$version",
  "ubuntu_base": "$base_version",
  "arch": "arm64",
  "asset": "rootfs-arm64.tar.xz",
  "sha256": "$sha",
  "compressed_bytes": $compressed,
  "zst_asset": "rootfs-arm64.tar.zst",
  "zst_sha256": "$zst_sha",
  "zst_bytes": $zst_bytes,
  "tar_bytes": ${uncompressed:-0},
  "installed_bytes": $installed,
  "files": $files,
  "start": "/root/openbot-start.sh",
  "status": "/root/openbot-status.sh",
  "ready_marker": "OPENBOT_LOCAL_READY",
  "built": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git": "${GIT_SHA:-unknown}"
}
EOF
echo "OPENBOT_VERSION=$version" >"$OUT_DIR/build.env"
cat "$OUT_DIR/engine.json"
endstep
