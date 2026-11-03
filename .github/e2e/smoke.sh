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

dump() { # $1 name. An emulator "Process system isn't responding" dialog (package android) is dismissed
  # with Wait and logged; one covered the whole baseline run 41635693145.
  local i
  for i in 1 2 3; do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1 || echo "<none/>" > "$OUT/$1.xml"
    grep -q "isn&apos;t responding\|isn't responding" "$OUT/$1.xml" || return 0
    local who; who=$(grep -o 'text="[^"]*responding"' "$OUT/$1.xml" | head -1)
    echo "[$(date +%T)] system dialog: $who -> Wait" >> "$OUT/steps.txt"
    case "$who" in *OpenBot*|*openbot*) echo "[$(date +%T)] FAIL: app ANR dialog" >> "$OUT/steps.txt"; echo 1 > "$OUT/.anr";; esac
    local xy; xy=$(find_node "$OUT/$1.xml" "Wait"); [ -n "$xy" ] && adb shell input tap $xy; sleep 1
  done
}
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null; }
# $1 xml $2 label (substring of text or content-desc) $3 mode: c = centre "x y", b = bounds "x1 y1 x2 y2"
node() {
  python3 - "$1" "$2" "${3:-c}" <<'PY'
import re,sys,html
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read()
label,mode=sys.argv[2],sys.argv[3]
for m in re.finditer(r'<node [^>]*>', xml):
    n=m.group(0)
    t=re.search(r' text="([^"]*)"',n); d=re.search(r' content-desc="([^"]*)"',n)
    if (t and label in html.unescape(t.group(1))) or (d and label in html.unescape(d.group(1))):
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

# ---------------- build 10 smoke (v3) ----------------
blurs() { # $1 name: mounted blur views in the window (upper bound of running blurs; info only)
  adb shell dumpsys activity top > "$OUT/$1-viewtree.txt" 2>/dev/null
  log "  blur views mounted ($1): $(grep -ciE 'BlurView|BlurTarget' "$OUT/$1-viewtree.txt") [$(grep -oiE '[A-Za-z.]*Blur[A-Za-z]*' "$OUT/$1-viewtree.txt" | sort | uniq -c | tr -s ' ' | tr '\n' ';')]"
}
selected_of() { python3 - "$1" "$2" <<'PYY'
import re,sys,html
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read()
for n in re.findall(r'<node [^>]*>',xml):
    d=re.search(r' content-desc="([^"]*)"',n)
    if d and html.unescape(d.group(1))==sys.argv[2]: print(re.search(r' selected="([a-z]*)"',n).group(1)); break
PYY
}
count() { python3 - "$1" "$2" <<'PY'
import re,sys,html
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read();l=sys.argv[2];c=0
for n in re.findall(r'<node [^>]*>',xml):
    t=re.search(r' text="([^"]*)"',n);d=re.search(r' content-desc="([^"]*)"',n)
    if (t and html.unescape(t.group(1))==l) or (d and html.unescape(d.group(1))==l): c+=1
print(c)
PY
}
edit_xy() { python3 - "$1" <<'PY'
import re,sys,html
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read()
for n in re.findall(r'<node [^>]*>',xml):
    if 'class="android.widget.EditText"' in n:
        x1,y1,x2,y2=map(int,re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n).groups()); print((x1+x2)//2,(y1+y2)//2,y2); break
PY
}
hold() { [ $# -ge 2 ] || { log "  hold: no target"; FAIL=1; return 1; }; adb shell input swipe $1 $2 $1 $2 900; }
tapl_last() { # $1 label $2 dumpname: taps the LAST node whose content-desc equals the label
  dump "$2"; local xy; xy=$(python3 - "$OUT/$2.xml" "$1" <<'PYY'
import re,sys,html
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read();last=""
for n in re.findall(r'<node [^>]*>',xml):
    d=re.search(r' content-desc="([^"]*)"',n)
    if d and html.unescape(d.group(1))==sys.argv[2]:
        x1,y1,x2,y2=map(int,re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n).groups()); last=f"{(x1+x2)//2} {(y1+y2)//2}"
print(last)
PYY
); [ -n "$xy" ] || { log "  missing: $1"; return 1; }; adb shell input tap $xy
}
tapl() { # $1 label $2 timeout $3 dumpname -> taps, returns 1 if missing
  local xy; xy=$(wait_for "$1" "$2" "$3") || { log "  missing: $1"; return 1; }
  adb shell input tap $xy; return 0
}
expect_text() { # $1 substring $2 timeout $3 name
  if wait_for "$1" "$2" "$3" >/dev/null; then log "ok: $1"; else log "FAIL: expected '$1'"; shot "$3"; FAIL=1; fi
}
home() { # back to the harness home (relaunches the app if a back key left it)
  local i; for i in 1 2 3; do dump hm; if [ -n "$(find_node "$OUT/hm.xml" "Copy crash log")" ]; then log "FAIL: a crash-log notice is on screen (an earlier JS/native crash)"; FAIL=1; xy=$(node "$OUT/hm.xml" "Dismiss" c); [ -n "$xy" ] && adb shell input tap $xy; sleep 1; dump hm; fi; if [ -z "$(find_node "$OUT/hm.xml" "Toggle ColorOS")" ] && ! adb shell dumpsys window | grep -q "mCurrentFocus.*$PKG"; then log "  app not in front: relaunch (pid=$(adb shell pidof $PKG | tr -d '\r'))"; adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 6; continue; fi; [ -n "$(find_node "$OUT/hm.xml" "Toggle ColorOS")" ] && [ "$(menu_open_kind hm)" = none ] && return 0; adb shell input keyevent 4; sleep 1.2; done
}

menu_scn() { # $1 name $2 expect ON|OFF : ••• menu -> Add agent sheet -> back
  local n=$1 xy
  xy=$(wait_for "Chat options" 20 "$n-0") || { log "FAIL $n: no ••• "; FAIL=1; return; }
  adb shell input tap $xy; sleep 1.2; check "$n-open" || return
  dump "$n-1"; log "  ••• menu kind: $(menu_open_kind "$n-1")"; shot "$n-1-dots"; blurs "$n-homemenu"
  xy=$(menu_row "Add agent" "$n-1") || { log "FAIL $n: ••• menu did not open"; FAIL=1; return; }
  if [ "$2" = ON ] && [ "$(cat "$OUT/.how" 2>/dev/null)" = geometry ]; then log "FAIL $n: glass rows not in the a11y tree (card not laid out?)"; FAIL=1; fi
  adb shell input tap $xy; sleep 2.5; check "$n-add-agent" || return
  if wait_for "E2E SHEET OPEN" 8 "$n-2-sheet" >/dev/null; then log "ok: E2E SHEET OPEN"; adb shell input keyevent 4; sleep 1.5; check "$n-sheet-back" || return; else log "FAIL $n: Add agent did not open the sheet (LAST=$(grep -o 'LAST=[a-z-]*' "$OUT/$n-2-sheet.xml" | head -1))"; shot "$n-2-nosheet"; FAIL=1; fi
  home
}
row_scn() { # agent-row long-press menu: every item, the sub-menus, back row, back key, outside tap
  local n=$1 rxy item
  for item in "Mark unread:mark-unread" "Pin:pin" "Hide:hide" "Info:info"; do
    rxy=$(wait_for "E2E Bot row" 10 "$n-r") || { log "FAIL $n: no row"; FAIL=1; return; }
    hold $rxy; sleep 1; check "$n-hold-${item#*:}" || return
    dump "$n-rm"; shot "$n-rowmenu"; log "  row menu kind: $(menu_open_kind "$n-rm")"
    tapl "${item%%:*}" 3 "$n-rm2" || { FAIL=1; continue; }
    sleep 1.5; check "$n-chose-${item#*:}" || return
    expect_text "LAST=${item#*:}" 5 "$n-last-${item#*:}"
  done
  # sub-menu: Move to folder -> Folder Beta
  rxy=$(wait_for "E2E Bot row" 10 "$n-r"); hold $rxy; sleep 1; check "$n-hold-sub" || return
  tapl "Move to folder" 3 "$n-s1" || FAIL=1; sleep 1.8; check "$n-sub-open" || return
  dump "$n-s2"; shot "$n-submenu"
  tapl "Folder Beta" 3 "$n-s3" || FAIL=1; sleep 1.5; check "$n-sub-chose" || return
  expect_text "LAST=folder-b" 5 "$n-last-folder"
  # sub-menu More -> back row -> Pin ; then back key in a sub-menu goes up one level, then closes
  rxy=$(wait_for "E2E Bot row" 10 "$n-r"); hold $rxy; sleep 1
  tapl "More" 3 "$n-m1" || FAIL=1; sleep 0.8
  if [ "$2" = ON ]; then
    tapl "Back, More" 3 "$n-m2" || { log "FAIL $n: no back row"; FAIL=1; }; sleep 0.8
    tapl "Pin" 3 "$n-m3" || FAIL=1; sleep 1.5; check "$n-back-row-pin" || return
    expect_text "LAST=pin" 5 "$n-last-pin2"
    rxy=$(wait_for "E2E Bot row" 10 "$n-r"); hold $rxy; sleep 1; tapl "More" 3 "$n-m4"; sleep 0.8
    adb shell input keyevent 4; sleep 0.8; dump "$n-m5"; [ -n "$(find_node "$OUT/$n-m5.xml" "Mark unread")" ] && log "ok: back key left the sub-menu" || { log "FAIL $n: back key did not return to the first level"; FAIL=1; }
  fi
  adb shell input keyevent 4; sleep 1; check "$n-backkey-close" || return
  dump "$n-m6"; [ "$(menu_open_kind "$n-m6")" = none ] && [ -n "$(find_node "$OUT/$n-m6.xml" "Toggle ColorOS")" ] && log "ok: back key closed the row menu" || { log "FAIL $n: row menu not closed by back"; FAIL=1; home; }
  rxy=$(wait_for "E2E Bot row" 10 "$n-r"); hold $rxy; sleep 1; adb shell input tap 540 2200; sleep 1; check "$n-outside" || return
  dump "$n-m7"; [ "$(menu_open_kind "$n-m7")" = none ] && log "ok: outside tap closed" || { log "FAIL $n: outside tap"; FAIL=1; home; }
}
zoom_scn() { # tap the zoom row, record the transition, then back
  local n=$1 xy
  xy=$(wait_for "E2E Zoom chat" 10 "$n-z0") || { log "FAIL $n: no zoom row"; FAIL=1; return; }
  adb shell "screenrecord --time-limit 4 --bit-rate 8000000 /sdcard/$n-zoom.mp4" & local rec=$!
  sleep 0.6; adb shell input tap $xy; sleep 3.6; wait $rec 2>/dev/null
  adb pull /sdcard/$n-zoom.mp4 "$OUT/$n-zoom.mp4" >/dev/null 2>&1
  check "$n-zoom" || return
  expect_text "E2E CHAT OPEN" 8 "$n-z1"; shot "$n-chat"
}
chat_scn() { # in /e2e-chat: message menus, reactions, rows, composer; then back
  local n=$1 xy e
  xy=$(wait_for "E2E agent message" 10 "$n-c0") || { log "FAIL $n: no agent message"; FAIL=1; return; }
  dump "$n-c0"; log "  rows (menu closed): Reply=$(count "$OUT/$n-c0.xml" Reply) Add reaction=$(count "$OUT/$n-c0.xml" "Add reaction") Copy message=$(count "$OUT/$n-c0.xml" "Copy message") Select text=$(count "$OUT/$n-c0.xml" "Select text")"
  if [ "$2" = ON ]; then
    [ "$(count "$OUT/$n-c0.xml" Reply)" = 0 ] && [ "$(count "$OUT/$n-c0.xml" "Add reaction")" = 0 ] && [ "$(count "$OUT/$n-c0.xml" "Select text")" = 0 ] && [ "$(count "$OUT/$n-c0.xml" "Copy message")" = 1 ] && log "ok: rows trimmed (agent keeps Copy; own row empty)" || { log "FAIL $n: action rows not as specified"; FAIL=1; }
    hold $xy; sleep 1.2; check "$n-hold-agent" || return
    dump "$n-c1"; shot "$n-msgmenu"
    log "  quick: $(for e in 👍 👎 ❤️ 😂 🎉; do printf '%s=%s ' $e $(count "$OUT/$n-c1.xml" "React with $e"); done) plus=$(count "$OUT/$n-c1.xml" "More emoji")"
    tapl "React with 👍" 3 "$n-c2" || FAIL=1; sleep 1.5; check "$n-quick-react" || return
    expect_text "REACTED a1 👍 valid=true" 5 "$n-c3"
    # saved: the row shows the reader's reaction; picking it again in the bar removes it (reviewer-3)
    expect_text "Remove your reaction 👍" 5 "$n-c3r"
    hold $xy; sleep 1.2; dump "$n-c3s"; blurs "$n-msgmenu"; log "  bar 👍 selected=$(selected_of "$OUT/$n-c3s.xml" "React with 👍")"
    tapl "React with 👍" 3 "$n-c3t" || FAIL=1; sleep 1.5; check "$n-quick-unreact" || return
    expect_text "REACTED a1 null valid=true" 5 "$n-c3u"
    [ "$(count "$OUT/$n-c3u.xml" "Remove your reaction 👍")" = 0 ] && log "ok: reaction removed from the row" || { log "FAIL $n: 👍 still on the row after removal"; FAIL=1; }
    hold $xy; sleep 1.2; tapl "More emoji" 3 "$n-c4" || FAIL=1; sleep 1; check "$n-plus" || return
    shot "$n-picker"; tapl "React with 🚀" 3 "$n-c5" || FAIL=1; sleep 1.5; check "$n-grid-react" || return
    expect_text "REACTED a1 🚀 valid=true" 5 "$n-c6"
    tapl "Remove your reaction 🚀" 5 "$n-c6r" || FAIL=1; sleep 1.2; check "$n-row-unreact" || return
    expect_text "REACTED a1 null valid=true" 5 "$n-c6u"
    hold $xy; sleep 1.2; tapl "More emoji" 3 "$n-c7"; sleep 0.8; adb shell input keyevent 4; sleep 0.8; dump "$n-c8"
    [ -n "$(find_node "$OUT/$n-c8.xml" "React with 👍")" ] && log "ok: back key left the emoji grid" || log "note: grid back state unclear"
    adb shell input keyevent 4; sleep 1; check "$n-grid-back" || return
    close_menu_if_open "$n-pre-copy"; hold $xy; sleep 1.2; tapl_last "Copy message" "$n-c9" || FAIL=1; sleep 1.5; check "$n-copy" || return
    expect_text "COPY a1" 5 "$n-c10"
    hold $xy; sleep 1.2; tapl "Select text" 3 "$n-c9s" || FAIL=1; sleep 1.5; check "$n-select" || return
    expect_text "SELECT a1" 5 "$n-c10s"
    xy=$(wait_for "E2E own message" 5 "$n-c11"); hold $xy; sleep 1.2; check "$n-hold-own" || return
    tapl "Reply" 3 "$n-c12" || FAIL=1; sleep 1.5; expect_text "REPLY u1" 5 "$n-c13"
  else
    [ "$(count "$OUT/$n-c0.xml" Reply)" -ge 2 ] && log "ok: OFF keeps build 9 rows" || { log "FAIL $n: OFF rows differ from build 9"; FAIL=1; }
    hold $xy; sleep 1.2; check "$n-hold-off" || return
    expect_text "SELECT a1" 5 "$n-c1"; dump "$n-c1b"; [ "$(menu_open_kind "$n-c1b")" = none ] || { log "FAIL $n: OFF opened a glass menu"; FAIL=1; }
  fi
  # item 6: header + agent page (before the composer, so no keyboard is up)
  dump "$n-h0"; shot "$n-header"
  log "  header: Back=$(count "$OUT/$n-h0.xml" Back) Info=$(count "$OUT/$n-h0.xml" "Info for E2E Agent") name=$(count "$OUT/$n-h0.xml" "E2E Agent")"
  if [ "$2" = ON ]; then
    [ "$(count "$OUT/$n-h0.xml" "Info for E2E Agent")" -ge 2 ] && log "ok: X header (name pill + ••• labelled)" || { log "FAIL $n: ColorOS header labels missing"; FAIL=1; }
  else
    [ "$(count "$OUT/$n-h0.xml" "Info for E2E Agent")" -le 1 ] && log "ok: OFF header is the build 9 one" || { log "FAIL $n: OFF shows the ColorOS header"; FAIL=1; }
  fi
  if [ -f "$OUT/.has-agent" ] || grep -q "E2E Open agent page" "$OUT/$n-h0.xml"; then
    tapl "E2E Open agent page" 3 "$n-a0" && sleep 1.5; check "$n-agent-open" || return
    expect_text "E2E AGENT PAGE OPEN" 8 "$n-a1"; shot "$n-agentpage"
    log "  agent page: Back=$(count "$OUT/$n-a1.xml" Back) NavUp=$(count "$OUT/$n-a1.xml" "Navigate up") appearance=$(count "$OUT/$n-a1.xml" "Edit appearance") Edit=$(count "$OUT/$n-a1.xml" Edit) browser=$(count "$OUT/$n-a1.xml" "Open browser") Memories=$(count "$OUT/$n-a1.xml" Memories) Skills=$(count "$OUT/$n-a1.xml" Skills) Files=$(count "$OUT/$n-a1.xml" Files)"
    if [ "$(count "$OUT/$n-a1.xml" "Navigate up")" -ge 1 ]; then tapl "Navigate up" 3 "$n-a2" || FAIL=1; else tapl "Back" 3 "$n-a2" || FAIL=1; fi; sleep 1.5; check "$n-agent-bar-back" || return
    expect_text "E2E CHAT OPEN" 6 "$n-a3"
    tapl "E2E Open agent page" 3 "$n-a4"; sleep 1.5; adb shell input keyevent 4; sleep 1.5; check "$n-agent-backkey" || return
    expect_text "E2E CHAT OPEN" 6 "$n-a5"
    local cap; for cap in "Edit appearance" "Edit" "Open browser" "Memories" "Skills" "Files"; do
      [ "$(count "$OUT/$n-a1.xml" "$cap")" -ge 1 ] || { log "FAIL $n: agent page hero lacks '$cap'"; FAIL=1; }
    done
  fi
  if [ "$2" = ON ]; then # the real ••• pill (last 'Info for E2E Agent' node) pushes /agent-info/[id]
    local dx; dx=$(python3 - "$OUT/$n-h0.xml" <<'PYY'
import re,sys,html
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read();last=""
for n in re.findall(r'<node [^>]*>',xml):
    if 'content-desc="Info for E2E Agent"' in n:
        x1,y1,x2,y2=map(int,re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n).groups()); last=f"{(x1+x2)//2} {(y1+y2)//2}"
print(last)
PYY
)
    if [ -n "$dx" ]; then adb shell input tap $dx; sleep 2; check "$n-dots-agentpage" || return; dump "$n-d1"; shot "$n-dots-agentpage"
      log "  ••• → page: chat still on top=$(count "$OUT/$n-d1.xml" "E2E agent message: hold me to react.") NavUp=$(count "$OUT/$n-d1.xml" "Navigate up") Memories=$(count "$OUT/$n-d1.xml" Memories)"
      [ "$(count "$OUT/$n-d1.xml" "E2E agent message: hold me to react.")" = 0 ] && log "ok: ••• pushed a page" || { log "FAIL $n: ••• did not open the agent page"; FAIL=1; }
      adb shell input keyevent 4; sleep 1.5; check "$n-dots-back" || return; expect_text "E2E CHAT OPEN" 6 "$n-d2"
    else log "FAIL $n: no ••• node"; FAIL=1; fi
  fi
  # composer: multiline + send
  dump "$n-k0"; set -- $(edit_xy "$OUT/$n-k0.xml"); [ -n "${1:-}" ] || { log "FAIL $n: no composer field"; FAIL=1; return; }
  local fy=$3; adb shell input tap $1 $2; sleep 1.8; check "$n-focus" || return
  adb shell input text "line1"; adb shell input keyevent 66; adb shell input text "line2"; adb shell input keyevent 66; adb shell input text "line3"; sleep 1
  dump "$n-k1"; shot "$n-composer-kb"
  adb shell dumpsys window InputMethod 2>/dev/null | grep -oE "(mFrame|mGivenContentInsets|touchableRegion)[^ ]*" | head -4 >> "$OUT/$n-ime.txt"
  log "  field before ${fy}, with keyboard: $(edit_xy "$OUT/$n-k1.xml")  ime: $(head -2 "$OUT/$n-ime.txt" | tr '\n' ' ')"
  tapl "Send message" 3 "$n-k2" || { log "FAIL $n: no send button"; FAIL=1; }; sleep 1.5; check "$n-send" || return
  expect_text 'SENT=line1\nline2\nline3' 5 "$n-k3"
  adb shell input keyevent 4; sleep 1.2; dump "$n-kb"; if [ -n "$(find_node "$OUT/$n-kb.xml" "E2E CHAT OPEN")" ]; then adb shell input keyevent 4; sleep 1.5; fi; check "$n-chat-back" || return
  dump "$n-k4"; [ -n "$(find_node "$OUT/$n-k4.xml" "Toggle ColorOS")" ] && log "ok: back returned home" || { log "FAIL $n: back did not return"; FAIL=1; home; }
}
toggle_to() { # $1 name $2 expected
  ensure_running "$1"; home
  local xy; xy=$(wait_for "Toggle ColorOS" 10 "$1") || { log "FAIL $1: toggle not found"; FAIL=1; return; }
  adb shell input tap $xy; sleep 1; check "$1-toggle" || return
  local st; st=$(state "$1b"); log "$st (live toggle, expect colorOS=$2)"; [ "$st" = "colorOS=$2" ] || { log "FAIL $1: toggle"; FAIL=1; }
}
round() { log "== round $1 (colorOS=$2)"; ensure_running "$1"; menu_scn "$1-dots" $2; row_scn "$1-row" $2; zoom_scn "$1-zoom" $2; chat_scn "$1-chat" $2; }

adb logcat -c; adb logcat -b crash -c
adb install -r -g "$APK" > "$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; exit 1; }
adb shell settings put global window_animation_scale 1
adb shell settings put global transition_animation_scale 1
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
if ! wait_for "E2E READY" 120 "00-launch" >/dev/null; then log "FAIL: harness never showed"; shot "00-launch"; FAIL=1; fi
shot "00-launch"; grep -o 'E2E READY[a-z ]*colorOS=[A-Z]*' "$OUT/00-launch.xml" | head -1 | tee -a "$OUT/steps.txt"
check launch || true
round on1 ON
toggle_to t1 OFF
round off OFF
toggle_to t2 ON
round on2 ON
adb logcat -d > "$OUT/logcat.txt" 2>/dev/null
adb logcat -d -b crash > "$OUT/crash-final.txt" 2>/dev/null
log "final pid: $(adb shell pidof $PKG | tr -d '\r')"
[ -f "$OUT/.anr" ] && FAIL=1
log "RESULT FAIL=$FAIL"
exit $FAIL
