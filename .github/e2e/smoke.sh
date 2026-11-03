#!/usr/bin/env bash
# Emulator smoke test for the ColorOS menu -> formSheet path (review branch only).
set -u
PKG=run.openbot.local
OUT=${OUT:-e2e-out}
mkdir -p "$OUT"
FAIL=0
log() { echo "[$(date +%T)] $*" | tee -a "$OUT/steps.txt"; }

dump() { # $1 name
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1 || echo "<none/>" > "$OUT/$1.xml"
}
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null; }
# find "text or content-desc" in the last dump, print centre "x y"
find_node() { # $1 xml $2 label (substring)
  python3 - "$1" "$2" <<'PY'
import re,sys
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read()
label=sys.argv[2]
for m in re.finditer(r'<node [^>]*>', xml):
    n=m.group(0)
    t=re.search(r' text="([^"]*)"',n); d=re.search(r' content-desc="([^"]*)"',n)
    if (t and label in t.group(1)) or (d and label in d.group(1)):
        b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n)
        if b:
            x1,y1,x2,y2=map(int,b.groups()); print((x1+x2)//2,(y1+y2)//2); break
PY
}
wait_for() { # $1 label $2 timeout_s $3 name -> echoes "x y"
  local end=$(( $(date +%s) + $2 )) xy=""
  while [ "$(date +%s)" -lt "$end" ]; do
    dump "$3"; xy=$(find_node "$OUT/$3.xml" "$1")
    [ -n "$xy" ] && { echo "$xy"; return 0; }
    sleep 1
  done
  return 1
}
alive() { [ -n "$(adb shell pidof $PKG | tr -d '\r')" ]; }
crashed() { # any fatal since the last clear
  adb logcat -d -b crash > "$OUT/crash-buffer.txt" 2>/dev/null
  adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime: |ReactNativeJS.*(Error|Exception)|SIGSEGV|SIGABRT|libc  *: Fatal" >> "$OUT/fatal-lines.txt" 2>/dev/null
  [ -s "$OUT/crash-buffer.txt" ] || ! alive
}

ensure_running() {
  if ! alive; then
    log "relaunching after crash ($1)"
    adb logcat -d -b crash > "$OUT/crash-before-$1.txt" 2>/dev/null; adb logcat -b crash -c
    adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 8
  fi
}
scenario() { # $1 name
  local n=$1 xy
  log "== scenario $n"
  ensure_running "$n"
  xy=$(wait_for "Chat options" 30 "$n-0-home") || { log "FAIL $n: Chat options not found"; shot "$n-0-home"; FAIL=1; return; }
  shot "$n-0-home"
  adb shell input tap $xy; sleep 1.2
  xy=$(wait_for "Add agent" 10 "$n-1-menu") || { log "FAIL $n: menu did not open"; shot "$n-1-menu"; FAIL=1; return; }
  shot "$n-1-menu"
  adb shell input tap $xy
  sleep 0.15; shot "$n-2-closing"
  sleep 2.5
  if crashed; then log "FAIL $n: CRASH after Add agent"; shot "$n-3-crash"; FAIL=1; return; fi
  if wait_for "E2E SHEET OPEN" 8 "$n-3-sheet" >/dev/null; then log "ok $n: sheet opened"; else log "FAIL $n: sheet did not open"; FAIL=1; fi
  shot "$n-3-sheet"
  # The menu must be gone (no invisible overlay left swallowing touches).
  adb shell input keyevent 4; sleep 1.5
  if crashed; then log "FAIL $n: CRASH on sheet close"; FAIL=1; return; fi
  xy=$(wait_for "Toggle ColorOS" 10 "$n-4-back") || { log "FAIL $n: did not return to harness"; FAIL=1; return; }
  shot "$n-4-back"
  # Rapid: open, tap outside, open, back key, open, Add agent.
  xy=$(wait_for "Chat options" 5 "$n-5") && adb shell input tap $xy; sleep 0.8
  adb shell input tap 60 1500; sleep 0.8
  xy=$(wait_for "Chat options" 5 "$n-6") && adb shell input tap $xy; sleep 0.8
  adb shell input keyevent 4; sleep 0.8
  xy=$(wait_for "Chat options" 5 "$n-7") && adb shell input tap $xy; sleep 0.8
  xy=$(wait_for "Add agent" 5 "$n-8") && adb shell input tap $xy; sleep 2.5
  if crashed; then log "FAIL $n: CRASH in rapid sequence"; shot "$n-9-crash"; FAIL=1; return; fi
  wait_for "E2E SHEET OPEN" 8 "$n-9-sheet" >/dev/null && log "ok $n: rapid sequence sheet opened" || { log "FAIL $n: rapid sequence no sheet"; FAIL=1; }
  shot "$n-9-sheet"
  adb shell input keyevent 4; sleep 1.5
}

adb logcat -c; adb logcat -b crash -c
adb install -r -g "$APK" > "$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; exit 1; }
adb shell settings put global window_animation_scale 1
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
if ! wait_for "E2E READY" 120 "00-launch" >/dev/null; then log "FAIL: harness never showed"; shot "00-launch"; FAIL=1; fi
shot "00-launch"
grep -o 'E2E READY colorOS=[A-Z]*' "$OUT/00-launch.xml" | head -1 | tee -a "$OUT/steps.txt"

scenario on1
# Live toggle OFF (no restart), then back ON.
ensure_running t1; xy=$(wait_for "Toggle ColorOS" 10 "t1") && adb shell input tap $xy; sleep 1
dump t1b; grep -o 'colorOS=[A-Z]*' "$OUT/t1b.xml" | head -1 | tee -a "$OUT/steps.txt"
scenario off
ensure_running t2; xy=$(wait_for "Toggle ColorOS" 10 "t2") && adb shell input tap $xy; sleep 1
dump t2b; grep -o 'colorOS=[A-Z]*' "$OUT/t2b.xml" | head -1 | tee -a "$OUT/steps.txt"
scenario on2

adb logcat -d > "$OUT/logcat.txt" 2>/dev/null
adb logcat -d -b crash > "$OUT/crash-final.txt" 2>/dev/null
log "RESULT FAIL=$FAIL"
exit $FAIL
