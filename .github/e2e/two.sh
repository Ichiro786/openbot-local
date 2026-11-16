#!/usr/bin/env bash
# Build 16.1: KB161 on two APKs in one emulator boot: the old build 16 (reproduce) then the new 16.1 (verify).
set -u
R=0
for b in old new; do  # Build 16.1: old = build 16 2387ffb29 (reproduce), new = build 16.1 (verify)
  adb uninstall run.openbot.local >/dev/null 2>&1 || true
  APK="$GITHUB_WORKSPACE/apk-$b/e2e.apk" OUT="$GITHUB_WORKSPACE/e2e-out/$b" GEN_BUILD=$b bash .github/e2e/smoke.sh
  r=$?; echo "[two] $b exit $r" | tee -a "$GITHUB_WORKSPACE/e2e-out/two.txt"
  [ "$b" = new ] && R=$r
done
exit $R
