# Council judge 3 (responsiveness): latency probes. Sourced by smoke.sh when .github/e2e/latency exists.
# Writes $OUT/lat/*.mp4 (one per recorded tap, show_touches ON so the touch spot marks the tap frame),
# $OUT/lat/taps.txt (name x y), $OUT/lat/start.txt (am start -W), $OUT/lat/*.pftrace (perfetto),
# $OUT/lat/race.txt (rapid-input lanes). Frame analysis is done off-runner.
LAT=$OUT/lat; mkdir -p $LAT
adb shell settings put system show_touches 1
rec_tap() { # $1 name $2 x $3 y : 3 s recording, tap at ~0.9 s
  adb shell "screenrecord --time-limit 3 --bit-rate 16000000 /sdcard/l.mp4" & local r=$!
  sleep 0.9; adb shell input tap $2 $3; sleep 2.3; wait $r 2>/dev/null
  adb pull /sdcard/l.mp4 "$LAT/$1.mp4" >/dev/null 2>&1; adb shell rm -f /sdcard/l.mp4
  echo "$1 $2 $3" >> $LAT/taps.txt
}
rec_cmd() { # $1 name $2 adb shell command (no touch spot for keys: tap time = recording start + 0.9 s)
  adb shell "screenrecord --time-limit 3 --bit-rate 16000000 /sdcard/l.mp4" & local r=$!
  sleep 0.9; adb shell "$2"; sleep 2.3; wait $r 2>/dev/null
  adb pull /sdcard/l.mp4 "$LAT/$1.mp4" >/dev/null 2>&1; adb shell rm -f /sdcard/l.mp4
  echo "$1 key" >> $LAT/taps.txt
}
ptrace() { # $1 name $2 seconds : perfetto sched+atrace in the background; returns at once
  cat > $LAT/cfg.txt <<EOF
buffers { size_kb: 65536 fill_policy: RING_BUFFER }
data_sources { config { name: "linux.ftrace" ftrace_config {
  ftrace_events: "sched/sched_switch" ftrace_events: "sched/sched_wakeup" ftrace_events: "sched/sched_waking"
  atrace_categories: "view" atrace_categories: "gfx" atrace_categories: "input" atrace_categories: "am"
  atrace_categories: "wm" atrace_categories: "dalvik" atrace_categories: "sched" atrace_apps: "$PKG" } } }
data_sources { config { name: "linux.process_stats" } }
duration_ms: $(( $2 * 1000 ))
EOF
  adb push $LAT/cfg.txt /data/local/tmp/cfg.txt >/dev/null 2>&1
  adb shell "cat /data/local/tmp/cfg.txt | perfetto --txt -c - -o /data/misc/perfetto-traces/$1.pftrace" > $LAT/$1-perfetto.log 2>&1 &
  PT=$!; sleep 1.2
}
ptrace_pull() { wait $PT 2>/dev/null; adb pull /data/misc/perfetto-traces/$1.pftrace $LAT/ >/dev/null 2>&1 || echo "no trace $1" >> $LAT/race.txt; }
js_marks() { adb logcat -d -s ReactNativeJS 2>/dev/null | grep -oE '(E2EMARK|E2EZOOM|E2EREADY|E2EKB|E2ECLOSE)[^"]*' | tail -${1:-14}; }
race() { echo "$*" | tee -a $LAT/race.txt >> "$OUT/steps.txt"; }

log "== LATENCY lane (judge 3)"
# 1. App start: cold (force-stop) and warm (HOME, then start) via am start -W, x5 each, and launch -> E2E READY.
ACT=$(adb shell cmd package resolve-activity --brief $PKG | tail -1 | tr -d '\r'); echo "activity $ACT" > $LAT/start.txt
for i in 1 2 3 4 5; do
  adb shell am force-stop $PKG; sleep 2; t0=$(date +%s%N)
  adb shell am start -W -n $ACT 2>&1 | grep -E "TotalTime|WaitTime|LaunchState" | tr '\n' ' ' | sed "s/^/cold $i /" >> $LAT/start.txt
  wait_for "E2E READY" 60 "ls-c$i" >/dev/null; echo " readyHostMs=$(( ($(date +%s%N)-t0)/1000000 ))" >> $LAT/start.txt
done
for i in 1 2 3 4 5; do
  adb shell input keyevent 3; sleep 2
  adb shell am start -W -n $ACT 2>&1 | grep -E "TotalTime|WaitTime|LaunchState" | tr '\n' ' ' | sed "s/^/warm $i /" >> $LAT/start.txt; echo >> $LAT/start.txt
  sleep 1.5
done
log "  start: $(tr '\n' '|' < $LAT/start.txt)"
home
# 2. Cold first chat open with perfetto (first open of the real chat in this process = no still).
adb shell am force-stop $PKG; sleep 1; adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
wait_for "E2E READY" 60 lr0 >/dev/null; sleep 4; adb logcat -c
xy=$(real_row); ptrace open-cold 6; rec_tap open-cold $xy; ptrace_pull open-cold
echo "--- open-cold" >> $LAT/marks.txt; js_marks >> $LAT/marks.txt
dump lo1; BACKXY=$(node "$OUT/lo1.xml" "Back" c); PILLXY=$(find_node "$OUT/lo1.xml" "VEYR, threads"); EDITXY=$(edit_xy "$OUT/lo1.xml" | cut -d' ' -f1,2)
PLUSXY=$(find_node "$OUT/lo1.xml" "Add attachment"); log "  real chat: back=[$BACKXY] pill=[$PILLXY] edit=[$EDITXY] plus=[$PLUSXY]"
ptrace close-hdr 5; rec_tap close-hdr-0 $BACKXY; ptrace_pull close-hdr
# 3. Warm opens + header Back, x5 recorded (tap -> first change; Back tap -> close start)
for i in 1 2 3 4 5; do
  adb logcat -c; xy=$(real_row) || break; rec_tap open-$i $xy
  echo "--- open-$i" >> $LAT/marks.txt; js_marks >> $LAT/marks.txt
  dump lo-$i; on_real lo-$i || { race "open-$i: chat not shown after 3.2 s"; home; continue; }
  [ $i = 2 ] && ptrace close-warm 5
  rec_tap back-$i $BACKXY; [ $i = 2 ] && ptrace_pull close-warm
  sleep 0.5; on_home lb-$i || { race "back-$i: not home 2.8 s after header Back"; home; }
done
# 4. Home glass ••• menu x5 (Back key closes it)
for i in 1 2 3; do
  dump lm0; xy=$(find_node "$OUT/lm0.xml" "Chat options"); [ -n "$xy" ] || break
  rec_tap dots-$i $xy; adb shell input keyevent 4; sleep 1.2
done
# 5. Harness ColorOS toggle x2 (OFF then back ON)
for i in 1 2; do dump lt0; xy=$(find_node "$OUT/lt0.xml" "Toggle ColorOS"); [ -n "$xy" ] && rec_tap toggle-$i $xy; sleep 0.8; done
state lt1 >> $LAT/race.txt
# 6. Inside the real chat: thread pill menu, + menu, composer focus (IME), each x3
real_open 3.0
for i in 1 2 3; do
  [ -n "$PILLXY" ] && { rec_tap pill-$i $PILLXY; adb shell input keyevent 4; sleep 1.2; }
  [ -n "$PLUSXY" ] && { rec_tap plus-$i $PLUSXY; adb shell input keyevent 4; sleep 1.2; }
  [ -n "$EDITXY" ] && { adb logcat -c; ptrace ime-$i 5; rec_tap ime-$i $EDITXY; ptrace_pull ime-$i; echo "--- ime-$i $(ime_top)" >> $LAT/marks.txt; js_marks 4 >> $LAT/marks.txt; adb shell input keyevent 4; sleep 1.2; }
done
# 7. Typing: 80 chars typed into the composer; read back the field (dropped characters?)
if [ -n "$EDITXY" ]; then
  real_tap $EDITXY; sleep 1.2; T0=$(date +%s%N); adb shell input text "abcdefghij0123456789abcdefghij0123456789abcdefghij0123456789abcdefghij0123456789"; T1=$(date +%s%N)
  sleep 1; dump ltype; got=$(python3 - "$OUT/ltype.xml" <<'P'
import re,sys,html
x=open(sys.argv[1],errors="ignore").read()
for n in re.findall(r'<node [^>]*>',x):
    if 'android.widget.EditText' in n: print(len(html.unescape(re.search(r' text="([^"]*)"',n).group(1)))); break
P
); race "type80: field length=$got (expect 80) inputMs=$(( (T1-T0)/1000000 ))"
  # typing while the keyboard is still rising: tap the field and type at once
  adb shell input keyevent 4; sleep 0.8; adb shell input keyevent 4; sleep 1; real_open 3.0
  adb shell "input tap $EDITXY; input text 0123456789"; sleep 1.5; dump ltype2
  got=$(grep -o 'class="android.widget.EditText"[^>]*' "$OUT/ltype2.xml" | grep -oE ' text="[^"]*"' | head -1); race "type-during-ime-rise: $got"
  adb shell input keyevent 4; sleep 0.8
fi
adb shell input keyevent 4; sleep 1.5; home
# 8. Rapid input / race lanes on the real chat
real_open 2.6; ptrace streamless-dbl 5; adb shell "input tap $BACKXY & input keyevent 4; wait"; ptrace_pull streamless-dbl; sleep 2.5
on_home lr1 && race "R1 header Back + system Back together: home ok" || { race "R1 header Back + system Back together: NOT home"; home; }
xy=$(real_row); adb shell "input tap $xy; sleep 0.08; input tap $xy"; sleep 3; dump lr2; on_real lr2 && race "R2 double tap row: chat open" || race "R2 double tap row: chat NOT open"
real_tap $BACKXY; sleep 2.5; on_home lr2b && race "R2 one header Back after double-tap open: home ok" || { race "R2: one header Back did NOT return home (second chat stacked?)"; real_tap $BACKXY; sleep 2.5; on_home lr2c && race "R2: second Back needed" || home; }
xy=$(real_row); dump lr3a; dxy=$(find_node "$OUT/lr3a.xml" "Chat options"); adb shell "input tap $xy; sleep 0.15; input tap $dxy"; sleep 3; dump lr3; race "R3 row then ••• 150 ms: $(on_real lr3 && echo chat || echo notchat) menu=$(menu_open_kind lr3)"; shot lr3; home
for i in 1 2 3 4 5; do xy=$(real_row); adb shell "input tap $xy; sleep 0.6; input tap $xy"; sleep 2.6; dump lr4-$i; c=$(on_real lr4-$i && echo chat || echo notchat); real_tap $BACKXY; sleep 2.5; on_home lr4h-$i && race "R4 tap row + tap same spot 600 ms later (in chat): $c, Back home ok" || { race "R4 $i: Back NOT home"; home; }; done
touch "$OUT/real-lanes.txt"; real_lanes ON 5 "L10 L11 L12 L15 L16 L1 L3 L9"
# 9. Send + streaming: E2E List (fake engine reply), send x3 recorded, double-tap Send, scroll + Back during the stream
home; tapl "E2E List" 10 ll0 && wait_for "E2E LIST OPEN" 10 ll1 >/dev/null && sleep 1.5
dump ll2; set -- $(edit_xy "$OUT/ll2.xml"); FX="$1 $2"
for i in 1 2 3; do
  real_tap $FX; sleep 1.2; adb shell input text "msg%s$i"; sleep 0.6; dump ls-$i; sxy=$(find_node "$OUT/ls-$i.xml" "Send message")
  [ -n "$sxy" ] || { race "send-$i: no Send button"; continue; }
  adb logcat -c; [ $i = 2 ] && ptrace send 6; rec_tap send-$i $sxy; [ $i = 2 ] && ptrace_pull send; sleep 2
  dump ls-$i-r; race "send-$i: $(grep -oE 'replied=[0-9]+' "$OUT/ls-$i-r.xml" | head -1) msg$i bubbles=$(count "$OUT/ls-$i-r.xml" "msg $i")"
done
real_tap $FX; sleep 1; adb shell input text "dbl"; sleep 0.6; dump lsd; sxy=$(find_node "$OUT/lsd.xml" "Send message")
[ -n "$sxy" ] && { adb shell "input tap $sxy; sleep 0.09; input tap $sxy"; sleep 4; dump lsd2; race "R5 double-tap Send: dbl bubbles=$(grep -c 'text="dbl"' "$OUT/lsd2.xml") field=$(grep -o 'class="android.widget.EditText"[^>]*' "$OUT/lsd2.xml" | grep -oE ' text="[^"]*"' | head -1)"; }
real_tap $FX; sleep 1; adb shell input text "scroll"; sleep 0.6; dump lss; sxy=$(find_node "$OUT/lss.xml" "Send message")
[ -n "$sxy" ] && { adb shell "input tap $sxy; sleep 0.3; input swipe 540 900 540 1500 200; input keyevent 4; sleep 0.2; input keyevent 4"; sleep 2.5; dump lss2; race "R6 send, drag, Back x2 during the stream: $(grep -q 'E2E LIST OPEN' "$OUT/lss2.xml" && echo 'STILL IN LIST' || echo left) $(on_home lss3 && echo home || echo nothome)"; }
home; check latency || true
adb shell "dumpsys gfxinfo $PKG" > $LAT/gfxinfo-final.txt 2>/dev/null
adb logcat -d > "$OUT/logcat.txt" 2>/dev/null
grep -E "Choreographer.*Skipped|Davey" "$OUT/logcat.txt" > $LAT/skipped.txt
log "  latency lane done: races: $(tr '\n' '|' < $LAT/race.txt)"
