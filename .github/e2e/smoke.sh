#!/usr/bin/env bash
# Emulator smoke test for the ColorOS menu -> formSheet path (review branch only).
# v2 (18:45 IST): the ColorOS glass menu's rows are not in the uiautomator tree (only its full-screen
# "Close" backdrop is), so a row is tapped by its a11y node when present, else by geometry from the
# ••• anchor while the backdrop is up. Every action is followed by a pid + crash-buffer check, and
# each live toggle is verified (the menu is closed first so the tap cannot land on the card).
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
# $1 xml $2 label (substring of text or content-desc) $3 mode: c = centre "x y", b = bounds "x1 y1 x2 y2"
node() {
  python3 - "$1" "$2" "${3:-c}" <<'PY'
import re,sys
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read()
label,mode=sys.argv[2],sys.argv[3]
for m in re.finditer(r'<node [^>]*>', xml):
    n=m.group(0)
    t=re.search(r' text="([^"]*)"',n); d=re.search(r' content-desc="([^"]*)"',n)
    if (t and label in t.group(1)) or (d and label in d.group(1)):
        b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n)
        if b:
            x1,y1,x2,y2=map(int,b.groups())
            print(f"{x1} {y1} {x2} {y2}" if mode=="b" else f"{(x1+x2)//2} {(y1+y2)//2}"); break
PY
}
find_node() { node "$1" "$2" c; }
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
  adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime: (FATAL|Process)|ReactNativeJS.*(Error|Exception)|SIGSEGV|SIGABRT|libc  *: Fatal" >> "$OUT/fatal-lines.txt" 2>/dev/null
  [ -s "$OUT/crash-buffer.txt" ] || ! alive
}
# check after every action: $1 step name. Returns 1 on crash (and records it).
check() {
  if crashed; then log "FAIL CRASH after: $1 (pid=$(adb shell pidof $PKG | tr -d '\r'))"; shot "crash-$1"; FAIL=1; return 1; fi
  log "  alive after: $1 (pid=$(adb shell pidof $PKG | tr -d '\r'))"
}
ensure_running() {
  if ! alive; then
    log "relaunching after crash ($1)"
    adb logcat -d -b crash > "$OUT/crash-before-$1.txt" 2>/dev/null; adb logcat -b crash -c
    adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 8
  fi
}
# Glass menu geometry, measured on run 41635731673 (pixel_6, 1080x2400): ••• anchor [912,138][1038,264],
# card [450,285][1038,641], "Add agent" row centre (744,353) = (anchor.x2 - 294, anchor.y2 + 89).
menu_row() { # $1 label $2 dump name -> echoes "x y"; logs how it was found
  local xy ab
  xy=$(wait_for "$1" 3 "$2") && { echo "$xy"; echo "a11y" > "$OUT/.how"; return 0; }
  if [ -n "$(find_node "$OUT/$2.xml" "Close")" ]; then
    ab=$(node "$OUT/$2.xml" "Chat options" b)
    [ -n "$ab" ] || return 1
    set -- $ab   # x1 y1 x2 y2
    echo "$(( $3 - 294 )) $(( $4 + 89 ))"; echo "geometry" > "$OUT/.how"; return 0
  fi
  return 1
}
menu_open_kind() { # $1 dump name -> glass | heroui | none
  if [ -n "$(find_node "$OUT/$1.xml" "Close")" ]; then echo glass
  elif [ -n "$(find_node "$OUT/$1.xml" "Add agent")" ]; then echo heroui
  else echo none; fi
}
state() { dump "$1"; grep -o 'colorOS=[A-Z]*' "$OUT/$1.xml" | head -1; }
close_menu_if_open() { # $1 name
  dump "$1"
  if [ "$(menu_open_kind "$1")" != none ]; then adb shell input keyevent 4; sleep 1; check "$1-close-leftover-menu" || true; fi
}

scenario() { # $1 name $2 expected colorOS (ON|OFF)
  local n=$1 xy kind st
  log "== scenario $n (expect colorOS=$2)"
  ensure_running "$n"
  xy=$(wait_for "Chat options" 30 "$n-0-home") || { log "FAIL $n: Chat options not found"; shot "$n-0-home"; FAIL=1; return; }
  st=$(grep -o 'colorOS=[A-Z]*' "$OUT/$n-0-home.xml" | head -1); log "  state: $st"
  [ "$st" = "colorOS=$2" ] || { log "FAIL $n: wrong state $st"; FAIL=1; }
  shot "$n-0-home"
  adb shell input tap $xy; sleep 1.2; check "$n-open-menu" || return
  dump "$n-1-menu"; kind=$(menu_open_kind "$n-1-menu"); shot "$n-1-menu"; log "  menu kind: $kind"
  xy=$(menu_row "Add agent" "$n-1-menu") || { log "FAIL $n: menu did not open"; FAIL=1; return; }
  log "  Add agent at $xy via $(cat "$OUT/.how")"
  if [ "$(cat "$OUT/.how")" = geometry ]; then sleep 2; dump "$n-1b-menu-later"; log "  a11y rows after 2 s: $([ -n "$(find_node "$OUT/$n-1b-menu-later.xml" "Add agent")" ] && echo present || echo absent)"; fi
  adb shell input tap $xy
  sleep 0.15; shot "$n-2-closing"
  sleep 2.5
  check "$n-add-agent" || { shot "$n-3-crash"; return; }
  if wait_for "E2E SHEET OPEN" 8 "$n-3-sheet" >/dev/null; then log "ok $n: sheet opened"; else log "FAIL $n: sheet did not open"; FAIL=1; fi
  shot "$n-3-sheet"
  adb shell input keyevent 4; sleep 1.5
  check "$n-sheet-back" || return
  xy=$(wait_for "Toggle ColorOS" 10 "$n-4-back") || { log "FAIL $n: did not return to harness"; FAIL=1; return; }
  [ "$(menu_open_kind "$n-4-back")" = none ] || { log "FAIL $n: a menu/backdrop is still up after the sheet closed"; FAIL=1; }
  shot "$n-4-back"
  # Rapid: open, tap outside, open, back key, open, Add agent.
  xy=$(wait_for "Chat options" 5 "$n-5") && adb shell input tap $xy; sleep 0.8; check "$n-rapid-open1" || return
  dump "$n-5b"; log "  rapid open1 menu: $(menu_open_kind "$n-5b")"; shot "$n-5b"
  adb shell input tap 60 1500; sleep 0.8; check "$n-rapid-outside-tap" || return
  sleep 0.6; dump "$n-5c"; kind=$(menu_open_kind "$n-5c"); log "  after outside tap menu: $kind"; [ "$kind" = none ] || { log "FAIL $n: outside tap did not close"; FAIL=1; }
  xy=$(wait_for "Chat options" 5 "$n-6") && adb shell input tap $xy; sleep 0.8; check "$n-rapid-open2" || return
  dump "$n-6b"; log "  rapid open2 menu: $(menu_open_kind "$n-6b")"
  adb shell input keyevent 4; sleep 0.8; check "$n-rapid-back-key" || return
  sleep 0.6; dump "$n-6c"; kind=$(menu_open_kind "$n-6c"); log "  after back key menu: $kind"; [ "$kind" = none ] || { log "FAIL $n: back key did not close"; FAIL=1; }
  dump "$n-6d"; [ -n "$(find_node "$OUT/$n-6d.xml" "Chat options")" ] || { log "FAIL $n: back key left the harness screen"; FAIL=1; }
  xy=$(wait_for "Chat options" 5 "$n-7") && adb shell input tap $xy; sleep 0.8; check "$n-rapid-open3" || return
  xy=$(menu_row "Add agent" "$n-8") && { log "  rapid Add agent via $(cat "$OUT/.how")"; adb shell input tap $xy; }
  sleep 2.5
  check "$n-rapid-add-agent" || { shot "$n-9-crash"; return; }
  wait_for "E2E SHEET OPEN" 8 "$n-9-sheet" >/dev/null && log "ok $n: rapid sequence sheet opened" || { log "FAIL $n: rapid sequence no sheet"; FAIL=1; }
  shot "$n-9-sheet"
  # Very fast double tap on the anchor, then a row while the spring is still running.
  adb shell input keyevent 4; sleep 1.5; check "$n-rapid-sheet-back" || return
  xy=$(wait_for "Chat options" 5 "$n-10") && { adb shell input tap $xy; sleep 0.1; adb shell input tap $xy; }
  sleep 0.3; check "$n-double-tap-anchor" || return
  close_menu_if_open "$n-10b"; check "$n-after-double-tap" || return
}
toggle_to() { # $1 name $2 expected after toggle
  ensure_running "$1"; close_menu_if_open "$1-pre"
  local xy; xy=$(wait_for "Toggle ColorOS" 10 "$1") || { log "FAIL $1: toggle not found"; FAIL=1; return; }
  adb shell input tap $xy; sleep 1; check "$1-toggle" || return
  local st; st=$(state "$1b"); log "$st (live toggle, expect colorOS=$2)"
  [ "$st" = "colorOS=$2" ] || { log "FAIL $1: toggle did not reach $2"; FAIL=1; }
}

adb logcat -c; adb logcat -b crash -c
adb install -r -g "$APK" > "$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; exit 1; }
adb shell settings put global window_animation_scale 1
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
if ! wait_for "E2E READY" 120 "00-launch" >/dev/null; then log "FAIL: harness never showed"; shot "00-launch"; FAIL=1; fi
shot "00-launch"
grep -o 'E2E READY[a-z ]*colorOS=[A-Z]*' "$OUT/00-launch.xml" | head -1 | tee -a "$OUT/steps.txt"
check launch || true

scenario on1 ON
toggle_to t1 OFF   # live, no restart
scenario off OFF
toggle_to t2 ON
scenario on2 ON

adb logcat -d > "$OUT/logcat.txt" 2>/dev/null
adb logcat -d -b crash > "$OUT/crash-final.txt" 2>/dev/null
log "final pid: $(adb shell pidof $PKG | tr -d '\r')"
log "RESULT FAIL=$FAIL"
exit $FAIL
