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
  return 0 # a ready-signal uncover (no WARN) must not read as a failed zoom_open (41791315569 lane 2)
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
  # Build 11.2 (agent-colors-v1): 17 presets + automatic + exact custom hexes, all drawn, still animating.
  if grep -q 'colors=' "$OUT/$n-p1.xml"; then
    local pc; pc=$(grep -o 'plushcolor [#a-z0-9]*' "$OUT/$n-p1.xml" | sort -u | wc -l)
    log "  plush colours on screen: $pc ($(grep -o 'colors=[0-9]*' "$OUT/$n-p1.xml" | head -1))"
    [ "$pc" -ge 24 ] && log "ok: plush renders 17 presets + automatic + custom hexes" || { log "FAIL $n: plush colour grid incomplete ($pc)"; FAIL=1; }
    grep -q 'plushcolor #123456' "$OUT/$n-p1.xml" && grep -q 'plushcolor #fafafa' "$OUT/$n-p1.xml" && log "ok: exact avatarColor hexes drawn" || { log "FAIL $n: custom hex plush missing"; FAIL=1; }
    tapl "E2E faces toggle" 4 "$n-f0" || FAIL=1; sleep 1.5; dump "$n-f1"; grep -q 'faces=0' "$OUT/$n-f1.xml" || log "note $n: faces toggle text not seen"
    shot "$n-fa"; sleep 1.2; shot "$n-fb"; check "$n-faces-off" || return
    [ "$(md5sum < "$OUT/$n-fa.png")" = "$(md5sum < "$OUT/$n-fb.png")" ] && log "ok: faces OFF stops plush animation" || log "note $n: frames still differ with faces OFF (check shots)"
    tapl "E2E faces toggle" 4 "$n-f2" || FAIL=1; sleep 1; tapl "E2E reduce toggle" 4 "$n-r0" || FAIL=1; sleep 1.5
    shot "$n-ra"; sleep 1.2; shot "$n-rb"; check "$n-reduce" || return
    [ "$(md5sum < "$OUT/$n-ra.png")" = "$(md5sum < "$OUT/$n-rb.png")" ] && log "ok: Reduce Motion stops plush animation" || log "note $n: frames still differ with Reduce Motion (check shots)"
    tapl "E2E reduce toggle" 4 "$n-r1" || FAIL=1; sleep 1.5; shot "$n-c"; check "$n-restored" || return
    [ "$(md5sum < "$OUT/$n-c.png")" != "$(md5sum < "$OUT/$n-rb.png")" ] && log "ok: plush animates again after restore" || log "note $n: no change after restore"
  fi
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

# ---------------- build 11.2 (zoom-close, predictive back, colour picker) ----------------
DENS=$(adb shell wm density | grep -oE '[0-9]+' | tail -1); DENS=${DENS:-420}
close_last() { adb logcat -d -s ReactNativeJS 2>/dev/null | grep -oE 'E2ECLOSE.*' | tail -1; }
close_count() { adb logcat -d -s ReactNativeJS 2>/dev/null | grep -c 'E2ECLOSE done'; }
cancel_count() { adb logcat -d -s ReactNativeJS 2>/dev/null | grep -c 'E2ECLOSE cancel'; }
# $1 name $2 expected mode (button|gesture) $3 row bounds px "x1 y1 x2 y2" (uiautomator, before the open)
close_land() {
  local n=$1 want=$2 rowpx=$3 line
  line=$(close_last); log "  close ($n): $line"; echo "$n $line" >> "$OUT/close-summary.txt"
  local res; res=$(python3 - "$line" "$want" "$rowpx" "$DENS" <<'PYL'

import sys,re
line,want,rowpx,dens=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4])
d=dict(re.findall(r"(\w+)=(\S+)",line))
ok=True;out=[]
if not line.startswith("E2ECLOSE done"): print("FAIL: no E2ECLOSE done line"); sys.exit()
if d.get("mode")!=want: out.append(f"FAIL: mode={d.get('mode')} (want {want})"); ok=False
if d.get("live")=="1": out.append(f"ok: live-screen close (no row landing to check), {d.get('ms')} ms")
elif d.get("land","none")=="none" or d.get("row","none")=="none": out.append("FAIL: no land/row rect"); ok=False
else:
    L=[float(v) for v in d["land"].split(",")]; R=[float(v) for v in d["row"].split(",")]
    dj=max(abs(a-b) for a,b in zip(L,R))
    out.append(("ok" if dj<=2 else "FAIL")+f": landed on the row (JS), max diff {dj:.1f} dp"); ok&=dj<=2
    if rowpx.strip():
        x1,y1,x2,y2=map(int,rowpx.split()); s=dens/160
        U=[x1/s,y1/s,(x2-x1)/s,(y2-y1)/s]; du=max(abs(a-b) for a,b in zip(L,U))
        out.append(("ok" if du<=3 else "FAIL")+f": landed on the row bounds (uiautomator {rowpx}), max diff {du:.1f} dp"); ok&=du<=3
if float(d.get("centre","1"))>0.01: out.append(f"FAIL: centre fallback used ({d.get('centre')})"); ok=False
if abs(float(d.get("p","1")))>0.02: out.append(f"FAIL: ended at p={d.get('p')}"); ok=False
if want=="gesture": out.append(("ok" if float(d.get("maxP","0"))>=0.2 else "FAIL")+f": gesture drove the shrink (max progress {d.get('maxP')})")
for o in out: print(o)
PYL
)
  while read -r l; do log "$l"; done <<< "$res"
  grep -q "FAIL" <<< "$res" && FAIL=1
  dump "$n-home"; [ -n "$(find_node "$OUT/$n-home.xml" "Toggle ColorOS")" ] && log "ok: home after close ($n)" || { log "FAIL $n: not home after close"; FAIL=1; home; }
}
row_px() { dump "$1"; node "$OUT/$1.xml" "E2E Zoom chat" b; }
# A slow left-edge back swipe as motion events (gesture navigation): out to $2 px, back to $3 px, release.
edge_swipe() { # $1 name $2 out_x $3 end_x
  local y=1300 x
  adb shell "screenrecord --time-limit 4 --bit-rate 20000000 /sdcard/$1.mp4" & local rec=$!
  sleep 0.6
  adb shell input motionevent DOWN 3 $y
  for x in $(seq 30 60 $2); do adb shell input motionevent MOVE $x $y; done
  if [ "$3" -lt "$2" ]; then for x in $(seq $2 -90 $3); do adb shell input motionevent MOVE $x $y; done; fi
  adb shell input motionevent UP $3 $y
  sleep 2.4; wait $rec 2>/dev/null
  adb pull /sdcard/$1.mp4 "$OUT/$1.mp4" >/dev/null 2>&1; adb shell rm -f /sdcard/$1.mp4
}
close_scn() { # $1 name $2 ON|OFF
  local n=$1 rp c0
  log "== zoom-close ($n, colorOS=$2, nav=$(adb shell settings get secure navigation_mode | tr -d '\r'))"
  home; rp=$(row_px "$n-r0"); c0=$(close_count)
  # 1. system Back key (no predictive start: React Native's Back -> non-interactive reverse zoom)
  zoom_open "$n-a" "$2" || return
  adb shell "screenrecord --time-limit 3 --bit-rate 20000000 /sdcard/$n-a-close.mp4" & local rec=$!
  sleep 0.6; gfx_reset; adb shell input keyevent 4; sleep 2.2; wait $rec 2>/dev/null; gfx "$n-a-close"
  adb pull /sdcard/$n-a-close.mp4 "$OUT/$n-a-close.mp4" >/dev/null 2>&1; check "$n-a-close" || return
  if [ "$2" = OFF ]; then
    [ "$(close_count)" = "$c0" ] && log "ok: OFF closes with the classic pop (no zoom-close)" || { log "FAIL $n: zoom-close ran with ColorOS OFF"; FAIL=1; }
    dump "$n-a-home"; [ -n "$(find_node "$OUT/$n-a-home.xml" "Toggle ColorOS")" ] || { log "FAIL $n: OFF back did not return home"; FAIL=1; home; }
    blur_max "$n-off"; return
  fi
  close_land "$n-a" button "$rp"
  # 2. header Back
  zoom_open "$n-b" "$2" || return
  adb shell "screenrecord --time-limit 6 --bit-rate 20000000 /sdcard/$n-b-close.mp4" & rec=$!
  sleep 0.6; gfx_reset
  tapl_last "Back" "$n-b-h" || { log "FAIL $n: no header Back"; FAIL=1; }
  sleep 2; wait $rec 2>/dev/null; gfx "$n-b-close"; adb pull /sdcard/$n-b-close.mp4 "$OUT/$n-b-close.mp4" >/dev/null 2>&1; check "$n-b-close" || return; close_land "$n-b" button "$rp"
  # 3. predictive back: slow edge swipe, released past the threshold
  zoom_open "$n-c" "$2" || return
  gfx_reset; edge_swipe "$n-c-swipe" 640 640; gfx "$n-c-close"; check "$n-c-close" || return; close_land "$n-c" gesture "$rp"
  # 4. predictive back cancelled: out and back to the edge -> springs back, the chat stays
  zoom_open "$n-d" "$2" || return
  local k0; k0=$(cancel_count)
  edge_swipe "$n-d-swipe" 520 10; check "$n-d-cancel" || return
  [ "$(cancel_count)" -gt "$k0" ] && log "ok: gesture cancel reported" || { log "FAIL $n: no gesture cancel"; FAIL=1; }
  expect_text "E2E CHAT OPEN" 5 "$n-d-chat"; shot "$n-d-chat"
  adb shell input keyevent 4; sleep 2; check "$n-d-back" || return; close_land "$n-d2" button "$rp"
  blur_max "$n-close"
}
# Build 11.2 stuck-Back regression (Syed's phone, a94d5ec): zoom-open chat -> agent page -> Appearance ->
# change colour -> Save -> back to the chat: header Back and system Back must both leave the chat.
at_home() { dump "$1"; [ -n "$(find_node "$OUT/$1.xml" "Toggle ColorOS")" ]; }
to_appearance_and_back() { # $1 name $2 key|swipe: how to come back to the chat $3 info: edit the bio instead of the colour
  local n=$1 xy
  tapl "E2E Open agent page" 6 "$n-ag0" || { log "FAIL $n: no agent page button"; FAIL=1; return 1; }; sleep 1.5
  expect_text "E2E AGENT PAGE OPEN" 8 "$n-ag1"
  if [ "${3:-}" = info ]; then
    tapl "E2E Edit info" 6 "$n-ap0" || { log "FAIL $n: no Edit info button"; FAIL=1; return 1; }; sleep 1.5
    expect_text "PICKER OPEN" 8 "$n-ap1"
    tapl "E2E Bio" 5 "$n-bio" || FAIL=1; sleep 0.5; adb shell input text "x"; sleep 0.5; adb shell input keyevent 111; sleep 0.5
  else
    tapl "E2E Appearance" 6 "$n-ap0" || { log "FAIL $n: no Appearance button"; FAIL=1; return 1; }; sleep 1.5
    expect_text "PICKER OPEN" 8 "$n-ap1"
    xy=$(find_node "$OUT/$n-ap1.xml" "Blue"); [ -n "$xy" ] && adb shell input tap $xy; sleep 0.8
  fi
  tapl "E2E Save" 5 "$n-ap2" || FAIL=1; sleep 0.8; dump "$n-ap3"
  grep -q 'DIRTY=0 SAVED=1' "$OUT/$n-ap3.xml" && log "ok: colour saved ($n)" || log "note $n: save state $(grep -oE 'DIRTY=[0-9] SAVED=[0-9]+' "$OUT/$n-ap3.xml" | head -1)"
  if [ "$2" = swipe ]; then edge_swipe "$n-sw1" 640 640; edge_swipe "$n-sw2" 640 640
  else adb shell input keyevent 4; sleep 1.5; adb shell input keyevent 4; fi
  sleep 1.5; check "$n-back-to-chat" || return 1
  expect_text "E2E CHAT OPEN" 6 "$n-chat"
}
stuck_scn() { # $1 name
  local n=$1
  log "== stuck-Back regression ($n)"
  # 1. agent page + Save, back by keys; leave with the HEADER Back
  home; zoom_open "$n-1" ON || return
  to_appearance_and_back "$n-1" key || return
  tapl_last "Back" "$n-1-h" || { log "FAIL $n: no header Back"; FAIL=1; }; sleep 2.5; check "$n-1-left" || return
  at_home "$n-1-home" && log "ok: header Back left the chat after agent page + Save" || { log "FAIL $n: header Back stuck after agent page + Save"; FAIL=1; home; }
  # 2. same, back by edge swipes; leave with SYSTEM Back (key)
  zoom_open "$n-2" ON || return
  to_appearance_and_back "$n-2" swipe || return
  adb shell input keyevent 4; sleep 2.5; check "$n-2-left" || return
  at_home "$n-2-home" && log "ok: system Back left the chat after agent page + Save" || { log "FAIL $n: system Back stuck after agent page + Save"; FAIL=1; home; }
  # 3. same, leave with the predictive back GESTURE
  zoom_open "$n-3" ON || return
  to_appearance_and_back "$n-3" key || return
  edge_swipe "$n-3-sw" 640 640; sleep 1; check "$n-3-left" || return
  at_home "$n-3-home" && log "ok: back gesture left the chat after agent page + Save" || { log "FAIL $n: back gesture stuck after agent page + Save"; FAIL=1; home; }
  # 4. a cancelled gesture, then a plain push/pop (agent page), then header Back and (again) system Back
  zoom_open "$n-4" ON || return
  edge_swipe "$n-4-cancel" 520 10; sleep 0.5
  tapl "E2E Open agent page" 6 "$n-4-ag" || FAIL=1; sleep 1.5; adb shell input keyevent 4; sleep 1.5
  expect_text "E2E CHAT OPEN" 6 "$n-4-chat"
  tapl_last "Back" "$n-4-h" || FAIL=1; sleep 2.5; check "$n-4-left" || return
  at_home "$n-4-home" && log "ok: header Back left the chat after cancel + push/pop" || { log "FAIL $n: header Back stuck after cancel + push/pop"; FAIL=1; home; }
  zoom_open "$n-5" ON || return
  tapl "E2E Open agent page" 6 "$n-5-ag" || FAIL=1; sleep 1.5; adb shell input keyevent 4; sleep 1.5
  adb shell input keyevent 4; sleep 2.5; check "$n-5-left" || return
  at_home "$n-5-home" && log "ok: system Back left the chat after push/pop" || { log "FAIL $n: system Back stuck after push/pop"; FAIL=1; home; }
  # 6-8. Syed 12:00 IST: the same after saving the agent's bio/info (any agent save), header / system / gesture
  zoom_open "$n-6" ON || return
  to_appearance_and_back "$n-6" key info || return
  tapl_last "Back" "$n-6-h" || FAIL=1; sleep 2.5; check "$n-6-left" || return
  at_home "$n-6-home" && log "ok: header Back left the chat after bio Save" || { log "FAIL $n: header Back stuck after bio Save"; FAIL=1; home; }
  zoom_open "$n-7" ON || return
  to_appearance_and_back "$n-7" swipe info || return
  adb shell input keyevent 4; sleep 2.5; check "$n-7-left" || return
  at_home "$n-7-home" && log "ok: system Back left the chat after bio Save" || { log "FAIL $n: system Back stuck after bio Save"; FAIL=1; home; }
  zoom_open "$n-8" ON || return
  to_appearance_and_back "$n-8" key info || return
  edge_swipe "$n-8-sw" 640 640; sleep 1; check "$n-8-left" || return
  at_home "$n-8-home" && log "ok: back gesture left the chat after bio Save" || { log "FAIL $n: back gesture stuck after bio Save"; FAIL=1; home; }
  blur_max "$n"
}
picker_scn() { # $1 name $2 ON|OFF
  local n=$1 xy b
  log "== picker ($n, colorOS=$2)"
  home; tapl "E2E Picker" 10 "$n-0" || { FAIL=1; return; }
  expect_text "PICKER OPEN colorOS=$2 cap=1" 10 "$n-1"; shot "$n-open"
  [ -n "$(find_node "$OUT/$n-1.xml" "Red")" ] && [ -n "$(find_node "$OUT/$n-1.xml" "Gray")" ] && [ -n "$(find_node "$OUT/$n-1.xml" "Automatic")" ] && log "ok: swatches (Red..Grey) + A present" || { log "FAIL $n: swatches/A missing"; FAIL=1; }
  b=$(node "$OUT/$n-1.xml" "Hue" b)
  if [ -z "$b" ] && [ "$2" = ON ]; then adb shell input swipe 540 1700 540 1100 400; sleep 1; dump "$n-1s"; b=$(node "$OUT/$n-1s.xml" "Hue" b); cp "$OUT/$n-1s.xml" "$OUT/$n-1.xml"; fi
  if [ "$2" = OFF ]; then
    [ -z "$b" ] && log "ok: no wheel with ColorOS OFF (build 11 picker)" || { log "FAIL $n: wheel shown with ColorOS OFF"; FAIL=1; }
    adb shell input keyevent 4; sleep 1; check "$n-back"; return
  fi
  [ -n "$b" ] || { log "FAIL $n: no colour wheel"; FAIL=1; adb shell input keyevent 4; return; }
  set -- $b; local cx=$(( ($1+$3)/2 )) cy=$(( ($2+$4)/2 )) r=$(( ($3-$1)/3 ))
  adb shell input swipe $((cx+r)) $cy $((cx+r/2)) $((cy-r)) 500; sleep 1.2; check "$n-drag" || return
  dump "$n-2"; shot "$n-custom"
  grep -qE 'CUSTOM=#[0-9a-fA-F]{6}' "$OUT/$n-2.xml" && log "ok: custom colour saved on release ($(grep -oE 'CUSTOM=#[0-9a-fA-F]{6}' "$OUT/$n-2.xml" | head -1))" || { log "FAIL $n: no custom colour after a wheel drag"; FAIL=1; }
  [ -n "$(find_node "$OUT/$n-2.xml" "Saturation")" ] && [ -n "$(find_node "$OUT/$n-2.xml" "Brightness")" ] && log "ok: hue/saturation/brightness controls labelled" || { log "FAIL $n: wheel a11y labels"; FAIL=1; }
  xy=$(find_node "$OUT/$n-2.xml" "Red"); adb shell input tap $xy; sleep 1; dump "$n-3"
  grep -q 'CUSTOM=none HUE=0' "$OUT/$n-3.xml" && log "ok: a preset clears the custom colour" || { log "FAIL $n: preset did not clear the custom colour"; FAIL=1; }
  adb shell input keyevent 4; sleep 1; check "$n-back" || return
  # A host without avatar-color-v1: the wheel snaps to the nearest preset, with the note.
  adb shell am start -a android.intent.action.VIEW -d "openbotlocal://e2e-picker?cap=0" $PKG >/dev/null 2>&1; sleep 2
  dump "$n-4"
  if grep -q "cap=0" "$OUT/$n-4.xml"; then
    b=$(node "$OUT/$n-4.xml" "Hue" b); set -- $b; cx=$(( ($1+$3)/2 )); cy=$(( ($2+$4)/2 )); r=$(( ($3-$1)/3 ))
    adb shell input swipe $((cx+r)) $cy $((cx+r/2)) $((cy-r)) 500; sleep 1.2; dump "$n-5"
    grep -qE 'CUSTOM=none HUE=[0-9]+' "$OUT/$n-5.xml" && log "ok: stock host snapped to preset ($(grep -oE 'HUE=[0-9]+' "$OUT/$n-5.xml" | head -1))" || { log "FAIL $n: stock host did not snap"; FAIL=1; }
    adb shell input keyevent 4; sleep 1
  else log "  stock-host picker: deep link did not open (info)"; adb shell input keyevent 4; sleep 1; fi
  check "$n-end"; blur_max "$n"
}

list_scn() { # $1 name $2 ON|OFF: the real chat list: focus -> keyboard up, send -> row + streamed reply (jank, back-steps, blur)
  local n=$1 xy rec
  log "== list ($n, colorOS=$2)"
  home; tapl "E2E List" 10 "$n-0" || { FAIL=1; return; }
  if ! wait_for "E2E LIST OPEN" 10 "$n-1" >/dev/null; then
    dump "$n-1e"; log "FAIL $n: list route did not open ($(grep -oE 'E2E LIST ERROR[^"]*' "$OUT/$n-1e.xml" | head -1))"; FAIL=1; home; return
  fi
  sleep 1.5; shot "$n-open"
  dump "$n-f0"; set -- $(edit_xy "$OUT/$n-f0.xml"); [ -n "${1:-}" ] || { log "FAIL $n: no composer field"; FAIL=1; home; return; }
  gfx_reset; adb shell "screenrecord --time-limit 3 --bit-rate 20000000 /sdcard/$n-focus.mp4" & rec=$!
  sleep 0.5; adb shell input tap $1 $2; sleep 2.2; wait $rec 2>/dev/null
  gfx "$n-focus"; adb pull /sdcard/$n-focus.mp4 "$OUT/$n-focus.mp4" >/dev/null 2>&1; check "$n-focus" || return
  dump "$n-f1"; local kb; kb=$(grep -oE 'E2EKB[^"&]*' "$OUT/$n-f1.xml" | head -1); log "  keyboard lift ($n): $kb"; echo "$n $kb" >> "$OUT/kb-summary.txt"
  local bs; bs=$(echo "$kb" | sed -E 's/.*backsteps=([0-9]+).*/\1/'); [ "${bs:-x}" = 0 ] && log "ok: keyboard lift never stepped back ($n)" || log "WARN $n: keyboard lift stepped back ($kb)"
  adb shell input text "hello%sfrom%se2e"; sleep 0.6
  dump "$n-s0"; xy=$(find_node "$OUT/$n-s0.xml" "Send message"); [ -n "$xy" ] || { log "FAIL $n: no Send"; FAIL=1; adb shell input keyevent 4; home; return; }
  gfx_reset; adb shell "screenrecord --time-limit 4 --bit-rate 20000000 /sdcard/$n-send.mp4" & rec=$!
  sleep 0.5; adb shell input tap $xy; sleep 3.4; wait $rec 2>/dev/null
  gfx "$n-send"; adb pull /sdcard/$n-send.mp4 "$OUT/$n-send.mp4" >/dev/null 2>&1; check "$n-send" || return
  expect_text "replied=1" 6 "$n-s1"; shot "$n-replied"
  blur_max "$n"
  adb shell input keyevent 4; sleep 1; home
}
toggle_to() { # $1 name $2 expected
  ensure_running "$1"; home
  local xy; xy=$(wait_for "Toggle ColorOS" 10 "$1") || { log "FAIL $1: toggle not found"; FAIL=1; return; }
  adb shell input tap $xy; sleep 1; check "$1-toggle" || return
  local st; st=$(state "$1b"); log "$st (live toggle, expect colorOS=$2)"; [ "$st" = "colorOS=$2" ] || { log "FAIL $1: toggle"; FAIL=1; }
}
round() { log "== round $1 (colorOS=$2)"; ensure_running "$1"; retry_infra menu_scn "$1-dots" $2; blur_max "$1-after-dots"; retry_infra row_scn "$1-row" $2; blur_max "$1-after-row"; zoom_scn "$1-zoom" $2; chat_scn "$1-chat" $2; blur_max "$1-after-chat"; close_scn "$1-close" $2; if [ "$2" = ON ]; then stuck_scn "$1-stuck"; fi; retry_infra picker_scn "$1-picker" $2; list_scn "$1-list" $2; retry_infra plush_scn "$1-plush"; retry_infra whatsapp_scn "$1-wa"; }

# Run 41718194068 started while the emulator was still delivering BOOT_COMPLETED (skipped 315 frames,
# JS timers seconds late): wait for it (max 240 s) and let the system settle before the app starts.
for i in $(seq 1 120); do adb logcat -d 2>/dev/null | grep -q "Finished processing BOOT_COMPLETED" && break; sleep 2; done
echo "[$(date +%T)] boot settle: BOOT_COMPLETED processed after ~$((i*2)) s; load $(adb shell cat /proc/loadavg | tr -d '\r')" | tee -a "$OUT/steps.txt"
# 41726795282 still ran at load ~24 (every frame > 250 ms): wait for the 1-min load to fall under 8 (max 300 s).
for i in $(seq 1 60); do l=$(adb shell cat /proc/loadavg | cut -d' ' -f1 | cut -d. -f1); [ "${l:-99}" -lt 8 ] && break; sleep 5; done
echo "[$(date +%T)] load before start $(adb shell cat /proc/loadavg | tr -d '\r')" | tee -a "$OUT/steps.txt"
adb logcat -c; adb logcat -b crash -c
# API 37.0 (41806961872): "Failure calling service package: Broken pipe" once; retry while the package service settles.
# API 37.0 (41812759046): 4 streamed installs all "Broken pipe" at load ~21. Push the APK first, then a
# non-streamed pm install from /data/local/tmp (no 350 MB binder pipe); wait for the package service each try.
adb push "$APK" /data/local/tmp/e2e.apk > "$OUT/push.txt" 2>&1 || cat "$OUT/push.txt"
for t in 1 2 3 4 5 6; do adb wait-for-device; for w in $(seq 1 30); do adb shell pm path android >/dev/null 2>&1 && break; sleep 2; done; adb shell pm install -r -g /data/local/tmp/e2e.apk > "$OUT/install.txt" 2>&1 && grep -q Success "$OUT/install.txt" && break; [ $t -ge 4 ] && adb install -r -g --no-streaming "$APK" > "$OUT/install.txt" 2>&1 && break; echo "[$(date +%T)] install try $t failed: $(tail -1 "$OUT/install.txt" 2>/dev/null)" | tee -a "$OUT/steps.txt"; sleep 20; done
adb shell rm -f /data/local/tmp/e2e.apk
grep -q Success "$OUT/install.txt" || { cat "$OUT/install.txt"; exit 1; }
# Emulator launcher ANRs ("Pixel Launcher isn't responding") ate taps in runs 41698820646 and 41693238776:
# hide error dialogs system-wide (an app ANR is still caught from logcat, below) and stop the launcher.
adb shell settings put global hide_error_dialogs 1
adb shell settings put secure anr_show_background 0
adb shell pm disable-user --user 0 com.google.android.apps.nexuslauncher >/dev/null 2>&1 || true
# Build 11.2: gesture navigation, so a left-edge swipe is a predictive back gesture (API 34).
adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural >/dev/null 2>&1 || true
sleep 2; echo "[$(date +%T)] navigation_mode=$(adb shell settings get secure navigation_mode | tr -d '\r') (2 = gesture)" | tee -a "$OUT/steps.txt"
adb shell settings put global window_animation_scale 1
adb shell settings put global transition_animation_scale 1
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
if ! wait_for "E2E READY" 120 "00-launch" >/dev/null; then log "FAIL: harness never showed"; shot "00-launch"; FAIL=1; fi
shot "00-launch"; grep -o 'E2E READY[a-z ]*colorOS=[A-Z]*' "$OUT/00-launch.xml" | head -1 | tee -a "$OUT/steps.txt"
check launch || true
# Build 11.3: Back on the REAL chat screen (AgentChatScreen over a stand-in workspace), random-input lanes,
# each looped REALN times. After a lane, the chat must be gone within ~3 s. If not: probe 1 = one settled
# header Back tap (gone now = "IGNORED": the lane's taps were lost, e.g. under the open overlay); still
# there = probe 2 = system Back key; still there = "STUCK" (Syed's bug). STUCK fails the run.
REALN=${REALN:-$(cat .github/e2e/realn 2>/dev/null || echo 20)}
# Build 11.3 open timing: never cached. The ZOOMT text line above the rows appears after the first zoom and
# moved the row down 86 px, so a cached centre missed it: every real lane after real_setup tapped empty space.
real_row() { wait_for "E2E Real chat" 10 rr0; }
real_open() { local xy; xy=$(real_row) || return 1; adb shell input tap $xy; sleep "${1:-2.6}"; }
real_tap() { adb shell input tap $1 $2; }
edge_quick() { # $1 out_x $2 end_x : left-edge swipe as motion events, no recording
  local y=1300 x; adb shell input motionevent DOWN 3 $y
  for x in $(seq 30 90 $1); do adb shell input motionevent MOVE $x $y; done
  if [ "$2" -lt "$1" ]; then for x in $(seq $1 -120 $2); do adb shell input motionevent MOVE $x $y; done; fi
  adb shell input motionevent UP $2 $y
}
edge_cancel_tap() { # $1 delay: back gesture out and back (cancel); the release and a header Back tap in ONE adb shell, tap $1 s after the release
  local y=1300 x; adb shell input motionevent DOWN 3 $y
  for x in 120 240 360 420; do adb shell input motionevent MOVE $x $y; done
  for x in 300 180 60 10; do adb shell input motionevent MOVE $x $y; done
  adb shell "(sleep $1; input tap $BACKXY) & input motionevent UP 10 $y; wait"
}
on_home() { dump "$1"; [ -n "$(find_node "$OUT/$1.xml" "Toggle ColorOS")" ]; }
on_real() { grep -q "E2E REAL OPEN" "$OUT/$1.xml"; }
real_judge() { # $1 lane $2 iter $3 mode
  local n="rl-$3-$1-$2" k
  for k in 1 2 3; do sleep 1; if on_home "$n"; then echo "$3 $1 $2 ok" >> "$OUT/real-lanes.txt"; return 0; fi; done
  check "$n" || { echo "$3 $1 $2 CRASH" >> "$OUT/real-lanes.txt"; ensure_running "$n"; home; return 0; }
  local where=other; on_real "$n" && where=chat; shot "$n"
  real_tap $BACKXY; sleep 2.5
  if on_home "$n-p1"; then log "  lane $3/$1 iter $2: IGNORED (on $where after the lane; one settled header Back left)"; echo "$3 $1 $2 IGNORED $where" >> "$OUT/real-lanes.txt"; return 0; fi
  shot "$n-p1"; adb shell input keyevent 4; sleep 2.5
  if on_home "$n-p2"; then log "FAIL lane $3/$1 iter $2: STUCK header Back (on $where; header Back did nothing, system Back left)"; echo "$3 $1 $2 STUCK-HEADER $where" >> "$OUT/real-lanes.txt"; FAIL=1; return 0; fi
  log "FAIL lane $3/$1 iter $2: STUCK header AND system Back (on $where)"; shot "$n-p2"; echo "$3 $1 $2 STUCK-BOTH $where" >> "$OUT/real-lanes.txt"; FAIL=1
  adb logcat -d -s ReactNativeJS 2>/dev/null | tail -40 > "$OUT/$n-js.txt"; home
}
real_setup() { # opens the real chat once: rendered? coordinates of Back, the name pill, the composer
  home; real_open 3.5 || { log "FAIL real: no E2E Real chat row"; FAIL=1; return 1; }
  dump real0; shot real0
  if grep -q "E2E REAL ERROR" "$OUT/real0.xml" || ! on_real real0; then
    log "FAIL real: the real chat screen did not render: $(grep -oE 'E2E REAL ERROR[^"]*' "$OUT/real0.xml" | head -1)"
    adb logcat -d -s ReactNativeJS 2>/dev/null | grep -E "E2EREAL|Error" | tail -20 | tee -a "$OUT/steps.txt"; FAIL=1; home; return 1
  fi
  BACKXY=$(python3 - "$OUT/real0.xml" <<'PYB'
import re,sys,html
xml=open(sys.argv[1],encoding="utf8",errors="ignore").read();last=""
for n in re.findall(r'<node [^>]*>',xml):
    d=re.search(r' content-desc="([^"]*)"',n)
    if d and html.unescape(d.group(1))=="Back":
        x1,y1,x2,y2=map(int,re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n).groups()); last=f"{(x1+x2)//2} {(y1+y2)//2}"
print(last)
PYB
)
  PILLXY=$(find_node "$OUT/real0.xml" "VEYR, threads"); EDITXY=$(edit_xy "$OUT/real0.xml" | cut -d' ' -f1,2)
  log "real chat rendered: Back=[$BACKXY] pill=[$PILLXY] composer=[$EDITXY] threadMenu=$( [ -n "$PILLXY" ] && echo yes || echo no)"
  [ -n "$BACKXY" ] || { log "FAIL real: no header Back"; FAIL=1; home; return 1; }
  # Build 11.3 frost: the header with the thread menu open (dark), for the before/after with a menu up.
  if [ -n "$PILLXY" ]; then
    adb shell cmd uimode night yes; sleep 1.5; real_tap $PILLXY; sleep 1.5; shot real-menu; blur_max real-menu
    python3 - "$OUT/real-menu.png" "$OUT/real-menu-top.png" <<'PYM' || true
import sys
from PIL import Image
im=Image.open(sys.argv[1]); w,h=im.size; im.crop((0,0,w,int(h*0.4))).save(sys.argv[2])
PYM
    adb shell input keyevent 4; sleep 1; adb shell cmd uimode night no; sleep 1.5; dump real0; on_real real0 || { home; real_open 3.5; }
  fi
  real_tap $BACKXY; sleep 2.5; on_home real0h && log "ok: real chat left by header Back" || { log "FAIL real: first header Back did not leave"; FAIL=1; home; }
}
real_lanes() { # $1 mode label (ON|OFF) $2 iterations $3 lanes
  local m=$1 N=$2 i L
  for L in $3; do
    log "== real lane $m/$L x$N"
    for i in $(seq 1 $N); do
      case $L in
        L1) real_open 0.35 || return; real_tap $BACKXY; sleep 0.12; real_tap $BACKXY; sleep 0.12; real_tap $BACKXY ;;   # rapid taps during the open
        L2) real_open 2.6 || return; real_tap $BACKXY ;;                                                            # settled, one tap
        L3) real_open 0.35 || return; adb shell input keyevent 4 ;;                                                 # system Back during the open
        L4) real_open 2.6 || return; [ -n "$PILLXY" ] && real_tap $PILLXY; sleep 1.2; adb shell input keyevent 4; sleep 0.8; real_tap $BACKXY ;;  # thread menu, key closes it, header Back
        L5) real_open 2.6 || return; [ -n "$PILLXY" ] && real_tap $PILLXY; sleep 1.2; real_tap $BACKXY; sleep 0.8; real_tap $BACKXY ;;        # thread menu, tap closes it, header Back
        L6) real_open 2.6 || return; edge_quick 520 10; real_tap $BACKXY ;;                                         # cancelled back gesture, header Back at once
        L7) real_open 2.6 || return; [ -n "$EDITXY" ] && real_tap $EDITXY; sleep 1.5; adb shell input keyevent 111; sleep 0.6; real_tap $BACKXY ;;  # keyboard up/down, header Back
        L8) real_open 2.6 || return; edge_quick 640 640 ;;                                                          # back gesture released
        L9) real_open 2.6 || return; real_tap $BACKXY; sleep 0.25; real_tap $BACKXY ;;                              # double tap (second during the close)
        L10) real_open 2.6 || return; adb shell input keyevent 4; real_tap $BACKXY; real_tap $BACKXY ;;               # header taps right after a system Back (predictive start/invoke on 36+)
        L11) real_open 2.6 || return; edge_quick 400 400; real_tap $BACKXY; sleep 0.1; real_tap $BACKXY ;;           # header taps right after a committed back gesture
        L12) real_open 2.6 || return; real_tap $BACKXY; sleep 0.1; adb shell input keyevent 4 ;;                     # system Back during the header zoom-close
        L13) real_open 2.6 || return; [ -n "$PILLXY" ] && real_tap $PILLXY; sleep 0.4; real_tap $BACKXY; sleep 0.3; real_tap $BACKXY; sleep 0.3; real_tap $BACKXY ;;  # taps during the thread menu open
        L14) real_open 2.6 || return; adb shell input swipe 540 900 540 1500 250; real_tap $BACKXY ;;                # list drag, header Back at once
        L15) real_open 2.6 || return; edge_quick 520 10; edge_quick 520 10; real_tap $BACKXY; sleep 0.15; adb shell input keyevent 4 ;;  # 2 cancelled gestures, tap, key
        L17) real_open 2.6 || return; d=$(echo "0 0.08 0.16 0.24 0.32" | cut -d' ' -f$(( (i-1)%5+1 ))); edge_cancel_tap $d ;;  # header tap DURING the predictive cancel (before onBackCancelled)
        L18) real_open 2.6 || return; d=$(echo "0 0.08 0.16 0.24 0.32" | cut -d' ' -f$(( (i-1)%5+1 ))); edge_cancel_tap $d; sleep 1.5; real_tap $BACKXY ;;  # same, then one settled header Back
        L16) real_open 1.0 || return; edge_quick 400 400; sleep 0.2; real_open 0.6; real_tap $BACKXY; sleep 0.1; real_tap $BACKXY ;;  # back gesture, reopen during the close, rapid taps
      esac
      real_judge $L $i $m
    done
    log "  lane $m/$L: $(grep -c "^$m $L .* ok" "$OUT/real-lanes.txt") ok, $(grep -c "^$m $L .* IGNORED" "$OUT/real-lanes.txt") ignored, $(grep -c "^$m $L .* STUCK" "$OUT/real-lanes.txt") stuck, $(grep -c "^$m $L .* CRASH" "$OUT/real-lanes.txt") crash"
  done
}
real_timing() { # build 11.3 open timing: 6 zoom opens of the real chat (with history), stages per open; open 3 recorded
  local i xy; log "== real open timing x6"
  for i in 1 2 3 4 5 6; do
    xy=$(real_row) || return
    if [ $i = 3 ]; then
      adb shell "screenrecord --time-limit 3 --bit-rate 20000000 /sdcard/rt-open.mp4" & local rec=$!
      sleep 0.7; adb shell input tap $xy; sleep 2.6; wait $rec 2>/dev/null
      adb pull /sdcard/rt-open.mp4 "$OUT/rt-open.mp4" >/dev/null 2>&1; adb shell rm -f /sdcard/rt-open.mp4
    else adb shell input tap $xy; sleep 2.6; fi
    dump "rt-$i-c"; on_real "rt-$i-c" && echo "--- open $i: chat shown" >> "$OUT/real-timing.txt" || log "  timing open $i: chat NOT shown"
    { echo "--- open $i"; adb logcat -d -s ReactNativeJS 2>/dev/null | grep -oE '(E2EMARK|E2EZOOM|E2EREADY)[^"]*' | tail -12; } >> "$OUT/real-timing.txt"
    real_tap $BACKXY; sleep 2.2; on_home "rt-$i" || { log "  timing open $i: not home after Back"; home; }
  done
  log "  real open timing: $(grep -oE 'ZOOMT.*' "$OUT/real-timing.txt" | tr '\n' ' | ')"
}
header_shot() { # build 11.3 scope: the ColorOS chat header over scrolled text (real ChatHeader + list), dark
  log "== header frost shot ($1)"
  home; tapl "E2E List" 10 "$1-0" || { log "  header shot: no List row"; return; }
  wait_for "E2E LIST OPEN" 10 "$1-1" >/dev/null || { log "  header shot: list did not open"; home; return; }
  sleep 1.5; adb shell input swipe 540 900 540 1250 400; sleep 1.5; shot "header-$1"
  python3 - "$OUT/header-$1.png" "$OUT/header-$1-top.png" <<'PYH' || true
import sys
from PIL import Image
im=Image.open(sys.argv[1]); w,h=im.size; im.crop((0,0,w,int(h*0.22))).save(sys.argv[2])
PYH
  adb shell input keyevent 4; sleep 1; home; blur_max "header-$1"
}
if [ -f .github/e2e/quick113 ]; then
  adb shell cmd uimode night yes; sleep 1; header_shot q; adb shell cmd uimode night no; sleep 1
  if [ -f .github/e2e/header-only ]; then log "RESULT FAIL=$FAIL (header only)"; exit $FAIL; fi
  log "== QUICK113 lane: real chat Back lanes + stuck + close (target $(cat "$(dirname "$APK")/target-sha.txt" 2>/dev/null), api $(adb shell getprop ro.build.version.sdk | tr -d '\r'))"
  touch "$OUT/real-lanes.txt"; ensure_running q
  if real_setup; then real_timing; real_lanes ON $REALN "$(cat .github/e2e/lanes 2>/dev/null || echo L1 L2 L3 L4 L5 L6 L7 L8 L9)"; fi
  stuck_scn q-stuck; close_scn q-close ON
  toggle_to q-off OFF; if [ -n "${BACKXY:-}" ]; then real_lanes OFF 5 "L2 L3 L9"; fi; toggle_to q-on ON
  log "real lanes summary: $(cut -d' ' -f4 "$OUT/real-lanes.txt" | sort | uniq -c | tr '\n' ' ')"
  adb logcat -d > "$OUT/logcat.txt" 2>/dev/null; adb logcat -d -b crash > "$OUT/crash-final.txt" 2>/dev/null
  if [ -n "$(app_anr)" ]; then log "FAIL: app ANR"; FAIL=1; fi
  log "RESULT FAIL=$FAIL"; exit $FAIL
fi
# Quick lane (release deadline): .github/e2e/quick = stuck-Back regression + zoom-close only, on a reused APK.
if [ -f .github/e2e/quick ]; then
  log "== QUICK lane: stuck + close (target $(cat "$(dirname "$APK")/target-sha.txt" 2>/dev/null))"
  ensure_running q; stuck_scn q-stuck; close_scn q-close ON
  adb logcat -d > "$OUT/logcat.txt" 2>/dev/null; adb logcat -d -b crash > "$OUT/crash-final.txt" 2>/dev/null
  if [ -n "$(app_anr)" ]; then log "FAIL: app ANR"; FAIL=1; fi
  log "RESULT FAIL=$FAIL"; exit $FAIL
fi
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
    adb shell input keyevent 4; sleep 1.5; list_scn dark-list ON
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
