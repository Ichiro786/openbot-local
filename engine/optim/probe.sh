#!/bin/bash
# research/engine-optimize: size, unpack speed, boot time and idle cost of the OpenBot Local engine on a native
# arm64 runner, the app's way (termux/proot, unprivileged owner of the rootfs, ProotCommand.kt argv).
#   probe.sh setup|compress|boots|slim
# Each phase writes $OUT/<phase>/ and the workflow uploads it right after. Chroot runs live in `unshare -m`,
# so no bind mount can outlive them; trees are only ever removed by this script after the engine is stopped.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PHASE=${1:?phase}
export OUT=${OUT_ROOT:-$PWD/out}/$PHASE; mkdir -p "$OUT"
TAG=${ENGINE_TAG:-engine-0.70.0-3}
W=${WORK:-/var/ob}; mkdir -p "$W"; chmod 755 "$W"
export PROOT_TMP=$W/prtmp
XZ=$W/$TAG/rootfs-arm64.tar.xz
log() { echo "== $(date -u +%H:%M:%S) $* | free $(df --output=avail -BG "$W" | tail -n1 | tr -d ' ') mem $(free -m | awk '/Mem/{print $7}')M" | tee -a "$OUT/steps.txt"; }
t() { local s; s=$(date +%s.%N); "$@"; local rc=$?; echo "TIME $(echo "$(date +%s.%N) - $s" | bc) rc=$rc :: $*" | tee -a "$OUT/times.txt"; return $rc; }
boot() { timeout 900 python3 "$HERE/boot.py" "$@" 2>&1 | tee -a "$OUT/boot-driver.txt"; }
mounted_under() { findmnt -rn -o TARGET | grep -c "^$1" || true; }
safe_rm() { # never remove a tree that still has a mount under it
  if [ "$(mounted_under "$1")" != 0 ]; then echo "REFUSING rm -rf $1: mounts under it" | tee -a "$OUT/steps.txt"; findmnt -rn | grep "$1"; return 1; fi
  rm -rf "$1"; }
xextract() { safe_rm "$2" || return 1; mkdir -p "$2"; xz -T1 -dc "$1" | tar -C "$2" -x -m --no-same-owner && chown -R runner:runner "$2"; }
zextract() { safe_rm "$2" || return 1; mkdir -p "$2"; zstd -q -T1 -dc --long=27 "$1" | tar -C "$2" -x -m --no-same-owner && chown -R runner:runner "$2"; }
topdu() { du -x -B1M -d"${2:-3}" "$1" 2>/dev/null | sort -rn | head -n "${3:-50}" | sed "s|$1||"; }

case $PHASE in
setup)
  log "host: $(nproc) cpus, $(free -g | awk '/Mem/{print $2}') GB, $(uname -r)"; lscpu | grep -E 'Model name|MHz|Vendor' | tee -a "$OUT/steps.txt"
  "$PROOT" --version 2>&1 | head -n 3 | tee -a "$OUT/steps.txt"
  gh release download "$TAG" --repo "$GITHUB_REPOSITORY" -D "$W/$TAG" -p 'rootfs-arm64.tar.xz*' -p engine.json &&
    (cd "$W/$TAG" && sha256sum -c rootfs-arm64.tar.xz.sha256) | tee -a "$OUT/steps.txt"
  ls -l "$W/$TAG" | tee -a "$OUT/steps.txt"; cp "$W/$TAG/engine.json" "$OUT/"
  ;;

compress)
  log "xz decode, one thread (the app decodes with one thread)"
  t bash -c "xz -T1 -dc '$XZ' | wc -c" | tee -a "$OUT/sizes.txt"
  log "zstd re-encodes"
  t bash -c "xz -T0 -dc '$XZ' | zstd -q -T0 -12 -o '$W/r.12.tar.zst'"
  t bash -c "xz -T0 -dc '$XZ' | zstd -q -T0 -19 --long=27 -o '$W/r.19L.tar.zst'"
  t bash -c "xz -T0 -dc '$XZ' | zstd -q -T0 --ultra -22 --long=27 -o '$W/r.22L.tar.zst'"
  ls -l "$XZ" "$W"/r.*.zst | tee -a "$OUT/sizes.txt"
  for f in "$W"/r.*.tar.zst; do t bash -c "zstd -q -T1 -dc --long=27 '$f' > /dev/null"; done
  log "Java: the app's decoder (tukaani xz + commons-compress tar) vs zstd-jni"
  mkdir -p "$W/jars"
  for u in org/tukaani/xz/1.10/xz-1.10.jar org/apache/commons/commons-compress/1.27.1/commons-compress-1.27.1.jar \
    commons-io/commons-io/2.16.1/commons-io-2.16.1.jar org/apache/commons/commons-lang3/3.16.0/commons-lang3-3.16.0.jar \
    commons-codec/commons-codec/1.17.1/commons-codec-1.17.1.jar com/github/luben/zstd-jni/1.5.7-6/zstd-jni-1.5.7-6.jar; do
    curl -sfL -o "$W/jars/$(basename $u)" "https://repo1.maven.org/maven2/$u"; done
  java -version 2>&1 | head -1 | tee -a "$OUT/steps.txt"
  for args in "xz $XZ tar" "zstd $W/r.19L.tar.zst tar" "zstd $W/r.12.tar.zst tar" "xz $XZ tar" "zstd $W/r.19L.tar.zst tar"; do
    timeout 900 java -Xmx512m -cp "$W/jars/*" "$HERE/Bench.java" $args 2>&1 | tail -n 3 | tee -a "$OUT/java-bench.txt"
  done
  log "unpack to disk like the app (one thread, no mtimes, no owners)"
  sync; echo 3 >/proc/sys/vm/drop_caches; t xextract "$XZ" "$W/ux"
  sync; echo 3 >/proc/sys/vm/drop_caches; t zextract "$W/r.19L.tar.zst" "$W/uz"
  echo "files: $(find "$W/ux" -xdev | wc -l)" | tee -a "$OUT/sizes.txt"
  safe_rm "$W/ux"; safe_rm "$W/uz"; rm -f "$W/r.12.tar.zst" "$W/r.22L.tar.zst"
  ;;

boots)
  log "extract like the app"
  t xextract "$XZ" "$W/rn"
  { du -sx -B1 "$W/rn"; du -sx -B1 --apparent-size "$W/rn"; find "$W/rn" -xdev | wc -l; } | tee "$OUT/du-fresh.txt"
  topdu "$W/rn" 4 70 >"$OUT/du-fresh-top.txt"
  ls -la "$W/rn/root" >"$OUT/root-fresh.txt" 2>&1
  B=(--rootfs "$W/rn" --timeout 400)
  touch "$W/marker"
  log "boots (proot, app argv, uid runner)"
  boot --label b1-first-cold "${B[@]}" --cold --probes --idle 60 --settle 30
  find "$W/rn/root" -xdev -type f -printf '%s\t%p\n' | sort -rn | sed "s|$W/rn||" >"$OUT/root-after-b1.txt"
  topdu "$W/rn/root" 5 60 >"$OUT/du-root-after-b1.txt"
  boot --label b2-second-cold "${B[@]}" --cold --idle 0
  boot --label b3-warm-long "${B[@]}" --idle 180 --settle 45
  boot --label b4-noseccomp "${B[@]}" --henv PROOT_NO_SECCOMP=1 --idle 60 --settle 30
  boot --label b5-xvfb-noglx "${B[@]}" --genv "OPENBOT_XVFB_ARGS=-extension GLX" --idle 60 --settle 30
  boot --label b6-profile-inprocess "${B[@]}" --genv OPENBOT_PROOT_PROFILE=inprocess --idle 60 --settle 30
  boot --label b7-compilecache-fill "${B[@]}" --genv NODE_COMPILE_CACHE=/root/.cache/node-compile-cache --idle 0
  du -sx -B1 "$W/rn/root/.cache/node-compile-cache" 2>&1 | tee -a "$OUT/steps.txt"
  boot --label b8-compilecache-use "${B[@]}" --genv NODE_COMPILE_CACHE=/root/.cache/node-compile-cache --idle 0
  boot --label b9-warm-again "${B[@]}" --idle 0
  boot --label b10-chroot "${B[@]}" --mode chroot --idle 60 --settle 30
  chown -R runner:runner "$W/rn"
  log "growth after all boots"
  find "$W/rn/root" -xdev -type f -printf '%s\t%p\n' | sort -rn | sed "s|$W/rn||" >"$OUT/root-after-all.txt"
  topdu "$W/rn/root" 5 60 >"$OUT/du-root-after-all.txt"
  { du -sx -B1 "$W/rn"; find "$W/rn" -xdev -newer "$W/marker" -type f | sed "s|$W/rn||" | grep -v '^/root/' | head -n 100; } >"$OUT/changed-outside-root.txt"
  cp "$W/rn/root/.config/OpenBot/logs/"*.log "$OUT/" 2>/dev/null; find "$W/rn/root" -name '*.log' -size -5M -newer "$W/marker" -exec cp {} "$OUT/" \; 2>/dev/null
  ;;

boots2)
  log "extract like the app"
  t xextract "$XZ" "$W/rn"
  B=(--rootfs "$W/rn" --timeout 400)
  log "warm-up boot (fills userData and downloads bun, like a first start)"
  boot --label w0-first "${B[@]}" --idle 0
  log "boot-time repeats: baseline vs NODE_COMPILE_CACHE, warm page cache and cold, interleaved"
  CC=NODE_COMPILE_CACHE=/root/.cache/node-compile-cache
  boot --label cc-fill "${B[@]}" --genv "$CC" --idle 0
  for i in 1 2 3 4 5; do
    boot --label "rep-base-warm-$i" "${B[@]}" --idle 0
    boot --label "rep-cc-warm-$i" "${B[@]}" --genv "$CC" --idle 0
  done
  for i in 1 2 3; do
    boot --label "rep-base-cold-$i" "${B[@]}" --cold --idle 0
    boot --label "rep-cc-cold-$i" "${B[@]}" --cold --genv "$CC" --idle 0
  done
  du -sx -B1 "$W/rn/root/.cache/node-compile-cache" | tee -a "$OUT/steps.txt"
  log "idle variants (proot)"
  boot --label i1-gpu-off "${B[@]}" --genv OPENBOT_DISABLE_GPU=1 --idle 90 --settle 30
  boot --label i2-lean "${B[@]}" --genv OPENBOT_DISABLE_GPU=1 --genv "OPENBOT_XVFB_ARGS=-extension GLX" --genv OPENBOT_PROOT_PROFILE=inprocess --idle 90 --settle 30
  boot --label i3-base-10min "${B[@]}" --idle 600 --settle 60
  log "chroot (same uid) for the proot overhead, with host strace of the Electron processes"
  boot --label c1-chroot-strace "${B[@]}" --mode chroot --idle 60 --settle 30 --strace
  boot --label c2-chroot-gpu-off-strace "${B[@]}" --mode chroot --genv OPENBOT_DISABLE_GPU=1 --idle 60 --settle 30 --strace
  chown -R runner:runner "$W/rn"
  topdu "$W/rn/root" 5 40 >"$OUT/du-root-after.txt"
  for f in "$OUT"/strace-tt-*.txt; do
    [ -f "$f" ] || continue
    { echo "== $f"; awk '{print $3}' "$f" | sed 's/(.*//' | sort | uniq -c | sort -rn | head -n 15
      grep -o '<[^>]*>' "$f" | sort | uniq -c | sort -rn | head -n 25; } >>"$OUT/strace-summary.txt"
  done
  ;;

slim)
  [ -d "$W/rn" ] || t xextract "$XZ" "$W/rn"
  B=(--rootfs "$W/rn" --timeout 400)
  before=$(du -sx -B1 "$W/rn" | cut -f1)
  log "slim 1: Mesa (LLVM, gallium, DRI, GBM backends, GLX/EGL mesa) out; Xvfb then has no GLX provider"
  L=$W/rn/usr/lib/aarch64-linux-gnu
  rm -rf "$L"/libLLVM* "$L"/libgallium* "$L/dri" "$L/gbm" "$L"/libGLX_mesa* "$L"/libEGL_mesa* "$L"/libvulkan_*.so 2>/dev/null
  a1=$(du -sx -B1 "$W/rn" | cut -f1); echo "SLIM1 mesa saved $(((before-a1)/1048576)) MiB" | tee -a "$OUT/slim.txt"
  boot --label s1-nomesa "${B[@]}" --probes --idle 60 --settle 30
  boot --label s2-nomesa-noglx "${B[@]}" --genv "OPENBOT_XVFB_ARGS=-extension GLX" --idle 0
  log "slim 2: icon themes except Adwaita/hicolor, GTK4, bundled CPython (agy prepare only), Chromium license dup"
  rm -rf "$W"/rn/usr/share/icons/{Humanity,Humanity-Dark,ubuntu-mono-dark,ubuntu-mono-light,LoginIcons} "$L"/libgtk-4.so* \
    "$W/rn/opt/python3.14" "$W/rn/opt/OpenBot/app/resources/licenses/LICENSES.chromium.html"
  a2=$(du -sx -B1 "$W/rn" | cut -f1); echo "SLIM2 saved $(((a1-a2)/1048576)) MiB more, total $((a2/1048576)) MiB" | tee -a "$OUT/slim.txt"
  boot --label s3-slim2 "${B[@]}" --idle 60 --settle 30
  log "launcher: replace the ready-loop 'sleep 2' polling with wait (test copy only)"
  cp -p "$W/rn/root/openbot-start.sh" "$W/start.bak"
  python3 - "$W/rn/root/openbot-start.sh" <<'PY'
import sys; p = sys.argv[1]; s = open(p).read()
old = "  else\n    sleep 2\n  fi\ndone"
new = "  else\n    wait \"$APP_PID\" 2>/dev/null; continue\n  fi\ndone"
assert old in s, "pattern"; open(p, "w").write(s.replace(old, new)); print("patched wait loop")
PY
  boot --label s4-launcher-wait "${B[@]}" --idle 60 --settle 30
  cp -p "$W/start.bak" "$W/rn/root/openbot-start.sh"
  safe_rm "$W/rn"
  ;;
esac
log "phase $PHASE done"
