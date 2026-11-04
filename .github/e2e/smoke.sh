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
    echo "[$(date +%T)] system dialog: $who -> Wait" >> "$OUT/steps.txt"; touch "$OUT/.infra"
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
crashed() { # any fatal of the app since the last clear (run 41718194068: a systemui/gmail crash on the
  # busy emulator filled the crash buffer and every check failed; only $PKG or its pid counts now)
  adb logcat -d -b crash > "$OUT/crash-buffer-all.txt" 2>/dev/null
  local pid; pid=$(adb shell pidof $PKG | tr -d '\r')
  python3 - "$OUT/crash-buffer-all.txt" "$PKG" "${pid:-none}" > "$OUT/crash-buffer.txt" <<'PYC'
import sys,re
lines=open(sys.argv[1],errors="ignore").read().splitlines();pkg,pid=sys.argv[2],sys.argv[3]
pids=set([pid])
for l in lines:
    m=re.search(r"Process: (\S+), PID: (\d+)",l)
    if m and m.group(1).startswith(pkg): pids.add(m.group(2))
    m=re.search(r">>> (\S+) <<<",l); n=re.search(r"pid: (\d+)",l)
    if m and n and m.group(1).startswith(pkg): pids.add(n.group(1))
for l in lines:
    f=l.split()
    if len(f)>3 and (f[2] in pids or pkg in l): print(l)
PYC
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


# ---------------- build 11 helpers (review) ----------------
# Frame timing: gfxinfo framestats (ns). Prints frames, janky %, max ms and count over 32 ms for the window
# since the last reset; the raw dump is kept as $OUT/<name>-gfx.txt.
gfx_reset() { adb shell dumpsys gfxinfo $PKG reset >/dev/null 2>&1; }
gfx() { # $1 name
  adb shell dumpsys gfxinfo $PKG framestats > "$OUT/$1-gfx.txt" 2>/dev/null
  local r; r=$(python3 - "$OUT/$1-gfx.txt" <<'PYG'
import sys,re
t=open(sys.argv[1],errors="ignore").read()
jank=re.search(r"Janky frames: (\d+) \(([\d.]+)%\)",t); tot=re.search(r"Total frames rendered: (\d+)",t)
rows=[];hdr=None
for line in t.splitlines():
    if line.startswith("Flags,"): hdr=line.split(","); continue
    if hdr and re.match(r"^\d+,",line):
        v=line.split(",")
        try:
            d=dict(zip(hdr,v))
            if d.get("Flags","0")!="0": continue
            ms=(int(d["FrameCompleted"])-int(d["IntendedVsync"]))/1e6
            if 0<ms<5000: rows.append(ms)
        except Exception: pass
    elif hdr and line.strip()=="---PROFILEDATA---": hdr=None
rows.sort()
p90=rows[int(len(rows)*0.9)] if rows else 0
print(f"frames={len(rows)} total={tot.group(1) if tot else '?'} janky={jank.group(2) if jank else '?'}% max={rows[-1] if rows else 0:.1f}ms p90={p90:.1f}ms over32={sum(1 for x in rows if x>32)} over16={sum(1 for x in rows if x>16.7)}")
PYG
)
  log "  gfx ($1): $r"; echo "$1 $r" >> "$OUT/gfx-summary.txt"
}
# Blur counter: the harness shows the app's blurBudgetMax() as "BLURMAX=N" (most live blurs at once
# since launch) on home and in the chat. Read after each scenario; the first scenario that raises it is
# the one that broke the budget.
blur_mark() { :; }
blur_max() { # $1 scenario name
  local i mx=""
  for i in 1 2 3; do dump "$1-bm"; mx=$(grep -oE 'BLURMAX=[0-9]+' "$OUT/$1-bm.xml" | head -1 | cut -d= -f2); [ -n "$mx" ] && break; sleep 0.5; done
  if [ -z "$mx" ]; then log "  blur counter ($1): not on screen"; echo "$1 none" >> "$OUT/blur-summary.txt"; return; fi
  echo "$1 max=$mx" >> "$OUT/blur-summary.txt"
  if [ "$mx" -gt 2 ]; then log "FAIL $1: blurs live max=$mx (>2)"; FAIL=1; else log "ok: blurs live max so far=$mx ($1)"; fi
}
# A scenario that failed while an emulator system dialog was up is retried once (infra, not the app).
retry_infra() { # $@ scenario command
  local before=$FAIL; rm -f "$OUT/.infra"; "$@"
  if [ -f "$OUT/.infra" ] && [ "$FAIL" != "$before" ]; then
    log "RETRY (infra dialog during: $*)"; echo "$*" >> "$OUT/infra-retries.txt"; FAIL=$before; rm -f "$OUT/.infra"; home; "$@"
  fi
}
app_anr() { adb logcat -d 2>/dev/null | grep -E "ANR in $PKG" | head -3; }

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
  sleep 1; tapl "Folder Beta" 3 "$n-s3" || FAIL=1; sleep 1.5; check "$n-sub-chose" || return
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
zoom_open() { # $1 name: one recorded zoom open with frame stats; leaves the chat open
  local n=$1 xy
  xy=$(wait_for "E2E Zoom chat" 10 "$n-z0") || { log "FAIL $n: no zoom row"; FAIL=1; return 1; }
  blur_mark; gfx_reset
  adb shell "screenrecord --time-limit 3 --bit-rate 20000000 /sdcard/$n.mp4" & local rec=$!
  sleep 0.7; adb shell input tap $xy; sleep 2.6; wait $rec 2>/dev/null
  gfx "$n-open"; blur_max "$n-open"
  adb pull /sdcard/$n.mp4 "$OUT/$n.mp4" >/dev/null 2>&1; adb shell rm -f /sdcard/$n.mp4
  check "$n" || return 1
  expect_text "E2E CHAT OPEN" 8 "$n-z1"
  if [ "${2:-ON}" = ON ]; then zoom_timing "$n" "$n-z1"; else log "  zoom timing ($n): OFF (no zoom)"; fi
}
zoom_timing() { # $1 name $2 dump: the harness's ZOOMT marks (ms after zoomOpen) -> hold and tap->settled gates
  local z; z=$(grep -oE 'ZOOMT[^"&]*' "$OUT/$2.xml" | head -1)
  [ -n "$z" ] || { sleep 0.5; dump "$2t"; z=$(grep -oE 'ZOOMT[^"&]*' "$OUT/$2t.xml" | head -1); }
  [ -n "$z" ] || { z=$(adb logcat -d -s ReactNativeJS 2>/dev/null | grep -oE 'ZOOMT[^"]*' | tail -1); }
  log "  ready signal ($1): $(adb logcat -d -s ReactNativeJS 2>/dev/null | grep -oE 'E2EREADY.*' | tail -1) load $(adb shell cat /proc/loadavg | cut -d' ' -f1-3)"
  if [ -z "$z" ]; then log "FAIL $1: no ZOOMT timing marks"; FAIL=1; return; fi
  local r; r=$(python3 - "$z" <<'PYZ'
import sys,re
d={k:v for k,v in re.findall(r"(\w+)=([\w-]+)",sys.argv[1])}
g=lambda k:int(d[k]) if d.get(k,"-1").lstrip("-").isdigit() else -1
op,sk,pu,un,cl=g("opaque"),g("skel"),g("push"),g("uncover"),g("clear")
feat=max(0,(min(sk,un) if sk>=0 else un)-op) if op>=0 else -1
print(f"hold_featureless={feat} skeleton_hold={un-pu} tap_settled={cl} push={pu} uncover={un} via={d.get('via','?')}")
PYZ
)
  log "  zoom timing ($1): $z -> $r"; echo "$1 $r" >> "$OUT/zoom-timing.txt"
  local feat set; feat=$(echo "$r" | sed -E 's/.*hold_featureless=(-?[0-9]+).*/\1/'); set=$(echo "$r" | sed -E 's/.*tap_settled=(-?[0-9]+).*/\1/')
  [ "$feat" -ge 0 ] && [ "$feat" -le 120 ] && log "ok: featureless hold ${feat} ms (<=120)" || { log "FAIL $1: featureless hold ${feat} ms (>120)"; FAIL=1; }
  if [ "$set" -lt 0 ] || [ "$set" -gt 700 ]; then log "FAIL $1: tap->settled ${set} ms (emulator gate 700)"; FAIL=1
  elif [ "$set" -gt 450 ]; then log "WARN $1: tap->settled ${set} ms (<=700 emulator gate, >450 device target)"
  else log "ok: tap->settled ${set} ms (<=450)"; fi
  echo "$r" | grep -q "via=fallback" && log "WARN $1: uncover came from the 600 ms fallback, not the ready signal"
}
zoom_scn() { # three opens (spec gate: 3 recorded opens + 3 backs with framestats); the third stays in the chat
  local n=$1 i
  for i in 1 2; do
    zoom_open "$n$i" "$2" || return
    shot "$n$i-chat"; gfx_reset; adb shell input keyevent 4; sleep 1.6; gfx "$n$i-back"; check "$n$i-back" || return
    dump "$n$i-home"; [ -n "$(find_node "$OUT/$n$i-home.xml" "Toggle ColorOS")" ] || { log "FAIL $n$i: back did not return home"; FAIL=1; home; }
  done
  zoom_open "$n"3 "$2"; shot "$n-chat"
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
    header_geom "$n" "$OUT/$n-h0.xml"
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
    if [ -n "$dx" ]; then
      # build 11: Notes press physics on the header ••• (recorded press, drag 0.33 D, release; 20 fast press-cancels)
      press_drag "$n-press" "$dx" || return
      blur_max "$n-after-press"
      adb shell input tap $dx; sleep 2; check "$n-dots-agentpage" || return; dump "$n-d1"; shot "$n-dots-agentpage"
      log "  ••• → page: chat still on top=$(count "$OUT/$n-d1.xml" "E2E agent message: hold me to react.") NavUp=$(count "$OUT/$n-d1.xml" "Navigate up") Memories=$(count "$OUT/$n-d1.xml" Memories)"
      [ "$(count "$OUT/$n-d1.xml" "E2E agent message: hold me to react.")" = 0 ] && log "ok: ••• pushed a page" || { log "FAIL $n: ••• did not open the agent page"; FAIL=1; }
      adb shell input keyevent 4; sleep 1.5; check "$n-dots-back" || return; expect_text "E2E CHAT OPEN" 6 "$n-d2"
    else log "FAIL $n: no ••• node"; FAIL=1; fi
  fi
  [ "$2" = ON ] && { plus_menu_scn "$n-plus" || return; }
  [ "$2" = ON ] && { plus_kb_scn "$n-pkb" || return; }
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
header_geom() { # hotfix 11.1: compact agent pill (32 dp, hugs the name, <= 220 dp), no subtitle text, Back centred on avatar+pill (80 dp)
  local n=$1 r d; d=$(adb shell wm density | grep -oE "[0-9]+" | tail -1)
  r=$(python3 - "$2" "${d:-420}" <<'PYH'
import re,sys,html
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read(); dp=int(sys.argv[2])/160
pill=back=None; sub=0
for n in re.findall(r'<node [^>]*>',xml):
    t=re.search(r' text="([^"]*)"',n); d=re.search(r' content-desc="([^"]*)"',n)
    t=html.unescape(t.group(1)) if t else ""; d=html.unescape(d.group(1)) if d else ""
    b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n)
    if not b: continue
    b=tuple(map(int,b.groups()))
    if "Review helper" in t: sub+=1
    if pill is None and d.startswith("Info for E2E Agent"): pill=b
    if back is None and d=="Back": back=b
if not pill: print("nopill"); sys.exit()
h=(pill[3]-pill[1])/dp; w=(pill[2]-pill[0])/dp
gtop=pill[3]/dp-80; gmid=(gtop+pill[3]/dp)/2
bmid=((back[1]+back[3])/2/dp) if back else -1
print(f"h={h:.1f} w={w:.1f} pill={pill} sub={sub} groupTop={gtop:.1f} groupMid={gmid:.1f} backMid={bmid:.1f}")
PYH
)
  log "  header geometry ($n): $r"
  case "$r" in nopill) log "FAIL $n: no name pill node"; FAIL=1; return;; esac
  python3 - "$r" <<'PYC' || { log "FAIL $n: header geometry out of spec"; FAIL=1; return; }
import re,sys
v={k:float(x) for k,x in re.findall(r"(\w+)=(-?[\d.]+)\b",sys.argv[1]) if k in("h","w","sub","groupMid","backMid")}
ok=30<=v["h"]<=36 and v["w"]<=222 and v["sub"]==0 and (v["backMid"]<0 or abs(v["backMid"]-v["groupMid"])<=3)
sys.exit(0 if ok else 1)
PYC
  log "ok: compact agent pill, name only, Back centred on the group"
}
ime_top() { # IME top in screen px, or 0 when the keyboard is not shown (raw dumps kept in $OUT/ime-raw-*.txt)
  local k=$((${IMEK:-0}+1)); IMEK=$k
  adb shell dumpsys input_method 2>/dev/null > "$OUT/ime-raw-$k-im.txt"
  adb shell dumpsys window 2>/dev/null > "$OUT/ime-raw-$k-win.txt"
  python3 - "$OUT/ime-raw-$k-im.txt" "$OUT/ime-raw-$k-win.txt" <<'PYI'
import re,sys
im=open(sys.argv[1],errors="ignore").read(); w=open(sys.argv[2],errors="ignore").read()
shown=bool(re.search(r"(mInputShown|mIsInputViewShown|isInputViewShown|mDecorViewVisible|mWindowVisible)=true",im))
m=re.search(r"type=ime frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\] visible=true",w)
if m: print(m.group(2)); sys.exit()
blk=re.search(r"Window\{[^}]*InputMethod\}.*?(?=\n  Window #|\Z)",w,re.S)
b=blk.group(0) if blk else ""
vis=("mViewVisibility=0x0" in b) or ("isOnScreen=true" in b) or shown
g=re.search(r"mGivenContentInsets=\[\d+,(\d+)\]",b or w)
print(g.group(1) if (vis and g and int(g.group(1))>0) else 0)
PYI
}
plus_geom() { # $1 xml -> "rowsTop rowsBottom rowCount composerTop" (rows: the + menu's four rows; composer: min top of field and +)
  python3 - "$1" <<'PYG'
import re,sys,html
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read()
rows=[];ct=[]
for n in re.findall(r'<node [^>]*>',xml):
    t=re.search(r' text="([^"]*)"',n); d=re.search(r' content-desc="([^"]*)"',n)
    vals={html.unescape(t.group(1)) if t else "", html.unescape(d.group(1)) if d else ""}
    b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n)
    if not b: continue
    x1,y1,x2,y2=map(int,b.groups())
    if vals & {"Use skill or app","Files","Photos","Camera"}: rows.append((y1,y2))
    if 'class="android.widget.EditText"' in n or vals & {"Add attachment"}: ct.append(y1)
print(min([r[0] for r in rows],default=-1),max([r[1] for r in rows],default=-1),len(rows),min(ct,default=-1))
PYG
}
plus_kb_scn() { # hotfix 11.1: the + menu sits above the composer and the IME, with the keyboard closed and open
  local n=$1 xy g ime ime2 k i
  for k in closed open; do
    if [ $k = open ]; then
      dump "$n-f0"; set -- $(edit_xy "$OUT/$n-f0.xml"); [ -n "${1:-}" ] || { log "FAIL $n: no composer field"; FAIL=1; return 0; }
      adb shell input tap $1 $2; ime=0
      for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; ime=$(ime_top); [ "${ime:-0}" -gt 0 ] && break; done
      dump "$n-f1"; set -- $(edit_xy "$OUT/$n-f1.xml")
      [ "${ime:-0}" -gt 0 ] || { log "FAIL $n: keyboard did not open (field bottom ${3:-?}, ime-raw-${IMEK})"; FAIL=1; adb shell input keyevent 4; return 0; }
      sleep 1.2; ime=$(ime_top)
    else ime=0; fi
    dump "$n-$k-0"; g=$(plus_geom "$OUT/$n-$k-0.xml"); set -- $g; local ctop=$4
    xy=$(find_node "$OUT/$n-$k-0.xml" "Add attachment") || true
    [ -n "$xy" ] || { log "FAIL $n ($k): no +"; FAIL=1; return 0; }
    adb shell input tap $xy; sleep 1.5; check "$n-$k-open" || return 1
    dump "$n-$k-1"; shot "$n-$k"; ime2=$( [ $k = open ] && ime_top || echo 0 )
    set -- $(plus_geom "$OUT/$n-$k-1.xml")
    log "  + menu keyboard $k: rows y ${1}..${2} (n=$3), composer top ${ctop}, IME top ${ime} (after open ${ime2}), + at ${xy}"
    if [ "$3" -lt 4 ]; then log "FAIL $n ($k): + menu rows missing (n=$3)"; FAIL=1
    elif [ "$2" -ge "$ctop" ]; then log "FAIL $n ($k): + menu rows reach below the composer top ($2 >= $ctop)"; FAIL=1
    elif [ "${ime2:-0}" -gt 0 ] && [ "$2" -ge "$ime2" ]; then log "FAIL $n ($k): + menu rows under the IME ($2 >= $ime2)"; FAIL=1
    else log "ok: + menu above the composer$( [ "${ime2:-0}" -gt 0 ] && echo " and the IME") (keyboard $k)"; fi
    [ $k = open ] && [ "${ime2:-0}" = 0 ] && log "note $n: the keyboard closed when the + menu opened"
    # outside tap (with the IME up, back would go to the keyboard first)
    adb shell input tap 540 520; sleep 1.2; check "$n-$k-close" || return 1
    dump "$n-$k-2"; [ "$(count "$OUT/$n-$k-2.xml" "Use skill or app")" = 0 ] || { log "FAIL $n ($k): + menu not closed by an outside tap"; FAIL=1; close_menu_if_open "$n-$k-left"; }
  done
  [ "$(ime_top)" -gt 0 ] && { adb shell input keyevent 4; sleep 1; }
  return 0
}
plus_menu_scn() { # item 7: composer + -> GlassMenu (rows, blur count, framestats), back / outside close, an action
  local n=$1 xy rows i
  xy=$(wait_for "Add attachment" 5 "$n-0") || { log "FAIL $n: no + (Add attachment) in the composer"; FAIL=1; return 0; }
  for i in 1 2 3; do
    gfx_reset; adb shell input tap $xy; sleep 1.2; check "$n-open$i" || return 1
    dump "$n-o$i"; [ $i = 1 ] && shot "$n-open"
    rows="$(for r in "Use skill or app" Files Photos Camera; do printf '%s=%s ' "$r" "$(count "$OUT/$n-o$i.xml" "$r")"; done)"
    log "  + menu open $i: kind=$(menu_open_kind "$n-o$i") rows: $rows"
    gfx "$n-open$i"; blur_max "$n-open$i"
    for r in "Use skill or app" Files Photos Camera; do [ "$(count "$OUT/$n-o$i.xml" "$r")" -ge 1 ] || { log "FAIL $n: + menu row '$r' missing"; FAIL=1; }; done
    case $i in
      1) gfx_reset; adb shell input keyevent 4; sleep 1; gfx "$n-close-back" ;;
      2) gfx_reset; adb shell input tap 540 520; sleep 1; gfx "$n-close-outside" ;;
      3) tapl "Use skill or app" 3 "$n-o3t" || FAIL=1; sleep 1.2; check "$n-skill" || return 1; expect_text "USE SKILL" 5 "$n-skill" ;;
    esac
    check "$n-close$i" || return 1
    dump "$n-c$i"
    if [ "$(count "$OUT/$n-c$i.xml" "Use skill or app")" = 0 ] && [ -n "$(find_node "$OUT/$n-c$i.xml" "E2E CHAT OPEN")" ]; then log "ok: + menu closed ($i)"; else log "FAIL $n: + menu not closed ($i)"; FAIL=1; close_menu_if_open "$n-left$i"; fi
  done
  return 0
}
press_drag() { # $1 name $2 "x y" : press, drag 0.33 D down-left while held (recorded), release; then 20 fast press-drag-cancels
  local n=$1 x y i; set -- $2; x=$1; y=$2
  adb shell "screenrecord --time-limit 3 --bit-rate 20000000 /sdcard/$n.mp4" & local rec=$!
  sleep 0.6
  adb shell input motionevent DOWN $x $y; sleep 0.25
  for i in 1 2 3 4 5 6; do adb shell input motionevent MOVE $((x - i*4)) $((y + i*18)); done
  sleep 0.15; adb exec-out screencap -p > "$OUT/$n-held.png" 2>/dev/null
  adb shell input motionevent MOVE $((x + 400)) $((y + 500)); adb shell input motionevent UP $((x + 400)) $((y + 500))
  wait $rec 2>/dev/null; adb pull /sdcard/$n.mp4 "$OUT/$n.mp4" >/dev/null 2>&1; adb shell rm -f /sdcard/$n.mp4
  check "$n-drag" || return 1
  gfx_reset
  for i in $(seq 1 20); do adb shell "input motionevent DOWN $x $y; input motionevent MOVE $((x+300)) $((y+400)); input motionevent UP $((x+300)) $((y+400))"; done
  sleep 1; gfx "$n-rapid"; check "$n-rapid20" || return 1
}
plush_scn() { # upstream v0.60 plush avatars, all moods, animating
  local n=$1
  tapl "E2E Plush" 5 "$n-p0" || { log "note $n: no plush route (target has no plush)"; return; }
  sleep 2; check "$n-open" || return
  expect_text "E2E PLUSH OPEN" 8 "$n-p1"
  log "  plush moods on screen: $(grep -o 'plush [a-z]*' "$OUT/$n-p1.xml" | sort -u | tr '\n' ' ')"
  shot "$n-a"; sleep 1.2; shot "$n-b"; sleep 3; check "$n-animate" || return
  [ "$(md5sum < "$OUT/$n-a.png")" != "$(md5sum < "$OUT/$n-b.png")" ] && log "ok: plush frames change" || log "note $n: two plush screenshots identical (still faces?)"
  adb shell input keyevent 4; sleep 1.2; check "$n-back" || return
}
whatsapp_scn() { # the real WhatsApp page over a fake whatsapp-mobile-v1 engine; then a host without it
  local n=$1 xy
  tapl "E2E WhatsApp" 5 "$n-w0" || { log "note $n: no WhatsApp route (target has no page)"; return; }
  sleep 2; check "$n-open" || return
  expect_text "E2E WHATSAPP OPEN cap=1" 8 "$n-w1"
  expect_text "Get pairing code" 8 "$n-w2"; shot "$n-page"
  dump "$n-w3"; set -- $(edit_xy "$OUT/$n-w3.xml"); [ -n "${1:-}" ] || { log "FAIL $n: no phone field"; FAIL=1; return; }
  adb shell input tap $1 $2; sleep 1; adb shell input text "+15551234567"; sleep 0.8; adb shell input keyevent 111; sleep 0.8
  tapl "Get pairing code" 5 "$n-w4" || { FAIL=1; return; }; sleep 1; check "$n-start" || return
  expect_text "WA link/start" 4 "$n-w5"
  expect_text "ABCD-1234" 8 "$n-w6"; shot "$n-code"
  expect_text "Number linked" 14 "$n-w7"
  expect_text "+15551234567" 10 "$n-w8"; shot "$n-linked"
  adb shell input keyevent 4; sleep 1.2; check "$n-back" || return; home
  tapl "E2E WhatsApp none" 5 "$n-x0" || { FAIL=1; return; }; sleep 2; check "$n-none" || return
  expect_text "doesn't support WhatsApp from the phone" 8 "$n-x1"; shot "$n-none"
  [ -z "$(find_node "$OUT/$n-x1.xml" "Get pairing code")" ] && log "ok: no link UI without the capability" || { log "FAIL $n: link UI shown without whatsapp-mobile-v1"; FAIL=1; }
  adb shell input keyevent 4; sleep 1.2; check "$n-none-back" || return; home
}
toggle_to() { # $1 name $2 expected
  ensure_running "$1"; home
  local xy; xy=$(wait_for "Toggle ColorOS" 10 "$1") || { log "FAIL $1: toggle not found"; FAIL=1; return; }
  adb shell input tap $xy; sleep 1; check "$1-toggle" || return
  local st; st=$(state "$1b"); log "$st (live toggle, expect colorOS=$2)"; [ "$st" = "colorOS=$2" ] || { log "FAIL $1: toggle"; FAIL=1; }
}
round() { log "== round $1 (colorOS=$2)"; ensure_running "$1"; retry_infra menu_scn "$1-dots" $2; blur_max "$1-after-dots"; retry_infra row_scn "$1-row" $2; blur_max "$1-after-row"; zoom_scn "$1-zoom" $2; chat_scn "$1-chat" $2; blur_max "$1-after-chat"; retry_infra plush_scn "$1-plush"; retry_infra whatsapp_scn "$1-wa"; }

# Run 41718194068 started while the emulator was still delivering BOOT_COMPLETED (skipped 315 frames,
# JS timers seconds late): wait for it (max 240 s) and let the system settle before the app starts.
for i in $(seq 1 120); do adb logcat -d 2>/dev/null | grep -q "Finished processing BOOT_COMPLETED" && break; sleep 2; done
echo "[$(date +%T)] boot settle: BOOT_COMPLETED processed after ~$((i*2)) s; load $(adb shell cat /proc/loadavg | tr -d '\r')" | tee -a "$OUT/steps.txt"
# 41726795282 still ran at load ~24 (every frame > 250 ms): wait for the 1-min load to fall under 8 (max 300 s).
for i in $(seq 1 60); do l=$(adb shell cat /proc/loadavg | cut -d' ' -f1 | cut -d. -f1); [ "${l:-99}" -lt 8 ] && break; sleep 5; done
echo "[$(date +%T)] load before start $(adb shell cat /proc/loadavg | tr -d '\r')" | tee -a "$OUT/steps.txt"
adb logcat -c; adb logcat -b crash -c
adb install -r -g "$APK" > "$OUT/install.txt" 2>&1 || { cat "$OUT/install.txt"; exit 1; }
# Emulator launcher ANRs ("Pixel Launcher isn't responding") ate taps in runs 41698820646 and 41693238776:
# hide error dialogs system-wide (an app ANR is still caught from logcat, below) and stop the launcher.
adb shell settings put global hide_error_dialogs 1
adb shell settings put secure anr_show_background 0
adb shell pm disable-user --user 0 com.google.android.apps.nexuslauncher >/dev/null 2>&1 || true
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
# Rim gate (top-edge middle <= 0.04 over the fill) needs the dark theme: in light the glass fill is near
# white and a white glint cannot be measured (41726795282). Dark mode, relaunch, zoom into the chat, shots.
log "== dark mode shots (rim)"
adb shell cmd uimode night yes; sleep 2; adb shell am force-stop $PKG; sleep 1
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
if wait_for "E2E READY" 60 "dk-0" >/dev/null; then
  shot "dark-home"
  if zoom_open dark-zoom ON; then
    sleep 1.5; shot "dark-chat"; dump "dark-chat"
    xy=$(find_node "$OUT/dark-chat.xml" "Add attachment")
    if [ -n "$xy" ]; then adb shell input tap $xy; sleep 1.5; shot "dark-plus"; adb shell input keyevent 4; sleep 1; fi
    hold $(find_node "$OUT/dark-chat.xml" "E2E agent message"); sleep 1.5; shot "dark-msgmenu"; adb shell input keyevent 4; sleep 1
    check dark-shots || true
    blur_max dark-after
  fi
else log "  dark mode: harness did not come back"; fi
adb shell cmd uimode night no
adb logcat -d > "$OUT/logcat.txt" 2>/dev/null
adb logcat -d -b crash > "$OUT/crash-final.txt" 2>/dev/null
log "final pid: $(adb shell pidof $PKG | tr -d '\r')"
[ -f "$OUT/.anr" ] && FAIL=1
if [ -n "$(app_anr)" ]; then log "FAIL: app ANR: $(app_anr | tr '\n' ' ')"; FAIL=1; fi
log "infra retries: $(cat "$OUT/infra-retries.txt" 2>/dev/null | wc -l)"
log "RESULT FAIL=$FAIL"
exit $FAIL
