#!/usr/bin/env bash
# Build 15.3: GENLONG on two APKs in one emulator boot: the old build 15.2 (reproduce) then the new 15.3 (verify).
set -u
R=0
for b in old new; do
  adb uninstall run.openbot.local >/dev/null 2>&1 || true
  APK="$GITHUB_WORKSPACE/apk-$b/e2e.apk" OUT="$GITHUB_WORKSPACE/e2e-out/$b" GEN_BUILD=$b bash .github/e2e/smoke.sh
  r=$?; echo "[two] $b exit $r" | tee -a "$GITHUB_WORKSPACE/e2e-out/two.txt"
  [ "$b" = new ] && R=$r
done
exit $R
