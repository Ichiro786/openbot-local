#!/usr/bin/env python3
"""Summarise an `strace -f -tt -T` capture per thread name: calls/s per thread, the top syscalls of each, and
the timeouts they wait with (the period of a timer shows up as the timeout of epoll/poll/futex/nanosleep).
  stsum.py <strace-tt file> <threads file (tid\\tcomm)> <seconds>"""
import re, sys
from collections import Counter, defaultdict

tt, thr, secs = sys.argv[1], sys.argv[2], float(sys.argv[3])
names = {}
for line in open(thr):
    t, n = line.rstrip("\n").split("\t", 1)
    names[t] = n
per = defaultdict(Counter)
waits = defaultdict(Counter)
for line in open(tt, errors="replace"):
    m = re.match(r"(\d+)\s+\S+\s+(?:<\.\.\. )?(\w+)", line)
    if not m:
        continue
    tid, sc = m.group(1), m.group(2)
    if "resumed>" in line and line.split()[2] == "<...":
        continue  # the resumed half of a call is counted at its start
    per[tid][sc] += 1
    if sc in ("epoll_pwait", "epoll_wait", "ppoll", "poll"):
        a = re.search(r"\(([^)]*)\)", line)
        if a:
            parts = [p.strip() for p in a.group(1).split(",")]
            tmo = parts[3] if sc.startswith("epoll") and len(parts) > 3 else (parts[2] if len(parts) > 2 else "?")
            waits[tid][f"{sc} timeout={tmo[:40]}"] += 1
    elif sc == "futex" and "FUTEX_WAIT" in line:
        a = re.search(r"\{tv_sec=(\d+), tv_nsec=(\d+)\}", line)
        waits[tid]["futex_wait " + (f"{int(a.group(1))}s+{int(a.group(2)) // 1000000}ms" if a else "no-timeout")] += 1
    elif sc in ("clock_nanosleep", "nanosleep"):
        a = re.search(r"\{tv_sec=(\d+), tv_nsec=(\d+)\}", line)
        waits[tid][f"{sc} " + (f"{int(a.group(1))}s+{int(a.group(2)) // 1000000}ms" if a else "?")] += 1
    elif sc in ("timerfd_settime",):
        a = re.search(r"it_value=\{tv_sec=(\d+), tv_nsec=(\d+)\}", line)
        waits[tid]["timerfd_settime " + (f"{int(a.group(1))}s+{int(a.group(2)) // 1000}us" if a else "?")] += 1
rows = sorted(per.items(), key=lambda x: -sum(x[1].values()))
total = sum(sum(c.values()) for _, c in rows)
print(f"== {tt}: {total / secs:.0f} syscalls/s over {secs:.0f}s, {len(rows)} threads")
for tid, c in rows[:15]:
    n = sum(c.values())
    print(f"  {n / secs:8.1f}/s  {names.get(tid, '?'):<22} tid {tid}: " + ", ".join(f"{k} {v / secs:.0f}" for k, v in c.most_common(6)))
    for k, v in waits[tid].most_common(4):
        print(f"{'':14}wait {k}: {v / secs:.1f}/s")
