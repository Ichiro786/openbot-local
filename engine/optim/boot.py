#!/usr/bin/env python3
"""Boot the OpenBot Local engine the way the Android app does and measure it (research/engine-optimize).

  boot.py --label L --rootfs R [--mode proot|chroot] [--genv K=V ...] [--henv K=V ...] [--cold]
          [--idle 60] [--settle 30] [--timeout 400] [--probes]

proot mode: termux/proot as the unprivileged user 'runner' (owner of the rootfs, like the app uid), with the
argv of ProotCommand.kt. chroot mode runs inside `unshare -m`, so its bind mounts die with the namespace
(lesson from the Hermes probe: never leave mounts behind a tree that is later removed).
Writes one JSON line to $OUT/boots.jsonl, the engine log to $OUT/boot-<label>.log, idle table to idle-<label>.txt.
"""
import argparse, json, os, pwd, re, signal, socket, subprocess, sys, time

OUT = os.environ.get("OUT", "out")
PROOT = os.environ.get("PROOT", "proot")
USER = os.environ.get("RUN_USER", "runner")
GPATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
HZ = os.sysconf("SC_CLK_TCK")
LIBS = ("libLLVM", "libgallium", "swiftshader", "libGLX_mesa", "dri/", "libonnxruntime", "libpython3.14")


def guest_env(extra=()):
    return ["HOME=/root", "USER=root", "TERM=xterm-256color", "LANG=C.UTF-8", "TMPDIR=/tmp", f"PATH={GPATH}"] + list(extra)


def proot_argv(r, guest):
    a = [PROOT, "--kill-on-exit", "--link2symlink", "--sysvipc", "-0", "-L", "-r", r, "-w", "/root",
         "-b", "/dev", "-b", "/proc", "-b", "/sys", "-b", "/dev/urandom:/dev/random", "-b", "/proc/self/fd:/dev/fd",
         "-b", "/proc/self/fd/0:/dev/stdin", "-b", "/proc/self/fd/1:/dev/stdout", "-b", "/proc/self/fd/2:/dev/stderr",
         "-b", f"{r}/tmp:/dev/shm"]
    fakes = os.path.join(r, "opt/openbot-local/proc")
    for name, g in (("max_user_watches", "/proc/sys/fs/inotify/max_user_watches"), ("cap_last_cap", "/proc/sys/kernel/cap_last_cap")):
        if os.path.isfile(os.path.join(fakes, name)):
            a += ["-b", f"{fakes}/{name}:{g}"]
    return a + ["/usr/bin/env", "-i"] + guest


def host_env(extra):
    e = {"PATH": "/usr/bin:/bin", "PROOT_TMP_DIR": os.environ.get("PROOT_TMP", "/tmp/prtmp")}
    for kv in extra:
        k, v = kv.split("=", 1); e[k] = v
    os.makedirs(e["PROOT_TMP_DIR"], exist_ok=True)
    u = pwd.getpwnam(USER); os.chown(e["PROOT_TMP_DIR"], u.pw_uid, u.pw_gid)
    return e


def chroot_cmd(r, guest):
    sh = (f"set -e; for d in proc sys dev dev/pts; do mount --bind /$d {r}/$d; done; "
          f"exec chroot {r} /usr/bin/env -i " + " ".join(f"'{x}'" for x in guest))
    return ["unshare", "-m", "--propagation", "private", "/bin/sh", "-c", sh]


def run_guest(r, mode, argv, envx=(), timeout=300):
    if mode == "proot":
        cmd = proot_argv(r, guest_env(envx) + argv)
        kw = dict(user=USER, group=USER, extra_groups=[], env=host_env(()), cwd=r)
    else:
        cmd = chroot_cmd(r, guest_env(envx) + argv); kw = dict(env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin"})
    t = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kw)
    return p.returncode, time.time() - t, p.stdout + p.stderr


def children_map():
    m = {}
    for d in os.listdir("/proc"):
        if d.isdigit():
            try:
                s = open(f"/proc/{d}/stat").read()
                m.setdefault(int(s[s.rfind(")") + 2:].split()[1]), []).append(int(d))
            except Exception:
                pass
    return m


def tree(root):
    m = children_map(); out = []; st = [root]
    while st:
        p = st.pop(); out.append(p); st += m.get(p, [])
    return out


def ctx_of(path):
    st = open(path).read()
    return int(re.search(r"voluntary_ctxt_switches:\s+(\d+)", st).group(1)) + int(re.search(r"nonvoluntary_ctxt_switches:\s+(\d+)", st).group(1))


def sample(pids, threads=False):
    res = {}
    for p in pids:
        try:
            s = open(f"/proc/{p}/stat").read(); f = s[s.rfind(")") + 2:].split()
            st = open(f"/proc/{p}/status").read()
            rss = int((re.search(r"VmRSS:\s+(\d+)", st) or re.search(r"(0)", "0")).group(1))
            pss = 0
            try:
                pss = int(re.search(r"^Pss:\s+(\d+)", open(f"/proc/{p}/smaps_rollup").read(), re.M).group(1))
            except Exception:
                pass
            th = {}
            for t in os.listdir(f"/proc/{p}/task"):
                try:
                    ts = open(f"/proc/{p}/task/{t}/stat").read(); tf = ts[ts.rfind(")") + 2:].split()
                    th[t] = (ts[ts.find("(") + 1:ts.rfind(")")], ctx_of(f"/proc/{p}/task/{t}/status"), int(tf[11]) + int(tf[12]))
                except Exception:
                    pass
            cmd = open(f"/proc/{p}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")[:200]
            res[p] = dict(comm=s[s.find("(") + 1:s.rfind(")")], cmd=cmd, ticks=int(f[11]) + int(f[12]), ctx=sum(x[1] for x in th.values()),
                          rss=rss, pss=pss, thr=len(th), th=th)
        except Exception:
            pass
    return res


def role(cmd, comm):
    c = cmd
    if "--type=renderer" in c: return "electron-renderer"
    if "--type=gpu-process" in c: return "electron-gpu"
    if "--type=utility" in c:
        m = re.search(r"--utility-sub-type=(\S+)", c); return "electron-utility:" + (m.group(1).split(".")[-1] if m else "?")
    if "--type=zygote" in c: return "electron-zygote"
    if "/opt/OpenBot/app/openbot" in c: return "electron-main"
    for k in ("Xvfb :0", "Xvfb :1", "dbus-daemon", "gnome-keyring", "openbot-start", "proot", "sleep", "crashpad"):
        if k in c: return k
    return comm


def maps_hits(pid):
    try:
        txt = open(f"/proc/{pid}/maps").read()
    except Exception:
        return []
    return sorted({l for l in LIBS if l in txt})


def idle(root_pid, secs, label):
    pids = tree(root_pid); a = sample(pids, True); t0 = time.time(); time.sleep(secs); dt = time.time() - t0
    b = sample(tree(root_pid), True)
    rows = []; thr_rows = []
    for p, v in b.items():
        if p not in a: continue
        cpu = 100.0 * (v["ticks"] - a[p]["ticks"]) / HZ / dt; ctx = (v["ctx"] - a[p]["ctx"]) / dt
        r = role(v["cmd"], v["comm"])
        rows.append(dict(pid=p, role=r, cpu=round(cpu, 2), ctx=round(ctx, 1), rss_mb=round(v["rss"] / 1024, 1), pss_mb=round(v["pss"] / 1024, 1),
                         thr=v["thr"], libs=maps_hits(p), cmd=v["cmd"][:120]))
        for t, (tn, c, tk) in v["th"].items():
            if t in a[p]["th"]:
                d = (c - a[p]["th"][t][1]) / dt
                if d >= 0.5: thr_rows.append((round(d, 1), r, tn, round(100.0 * (tk - a[p]["th"][t][2]) / HZ / dt, 2)))
    rows.sort(key=lambda x: -x["ctx"]); thr_rows.sort(reverse=True)
    tot = dict(cpu=round(sum(x["cpu"] for x in rows), 2), ctx=round(sum(x["ctx"] for x in rows), 1),
               rss_mb=round(sum(x["rss_mb"] for x in rows), 1), pss_mb=round(sum(x["pss_mb"] for x in rows), 1), procs=len(rows))
    with open(f"{OUT}/idle-{label}.txt", "w") as f:
        f.write(f"idle {dt:.1f}s total {json.dumps(tot)}\n")
        for x in rows: f.write(json.dumps(x) + "\n")
        f.write("--- threads with >=0.5 wakeups/s (ctx/s, role, thread, cpu%)\n")
        for x in thr_rows[:60]: f.write(f"{x}\n")
    return tot, rows


def ctl_status(r, n=20):
    path = f"{r}/run/openbot/control.sock"; ts = []
    for _ in range(n):
        t = time.time()
        try:
            s = socket.socket(socket.AF_UNIX); s.settimeout(5); s.connect(path)
            s.sendall(b"GET /v1/status HTTP/1.0\r\nHost: openbot\r\nConnection: close\r\n\r\n")
            data = b""
            while True:
                c = s.recv(65536)
                if not c: break
                data += c
            s.close(); ts.append(time.time() - t)
        except Exception as e:
            return dict(error=str(e))
        time.sleep(0.05)
    ts.sort()
    return dict(n=n, median_ms=round(1000 * ts[len(ts) // 2], 2), max_ms=round(1000 * ts[-1], 2), body=data.decode(errors="replace")[-300:])


def du(path):
    try:
        return int(subprocess.run(["du", "-sxB1", path], capture_output=True, text=True).stdout.split()[0])
    except Exception:
        return -1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True); ap.add_argument("--rootfs", required=True)
    ap.add_argument("--mode", default="proot"); ap.add_argument("--genv", action="append", default=[])
    ap.add_argument("--henv", action="append", default=[]); ap.add_argument("--cold", action="store_true")
    ap.add_argument("--idle", type=int, default=60); ap.add_argument("--settle", type=int, default=30)
    ap.add_argument("--timeout", type=int, default=400); ap.add_argument("--probes", action="store_true")
    a = ap.parse_args()
    r = os.path.realpath(a.rootfs); os.makedirs(OUT, exist_ok=True)
    res = dict(label=a.label, mode=a.mode, genv=a.genv, henv=a.henv)
    for f in ("run/openbot/engine.state",):
        try: os.remove(os.path.join(r, f))
        except FileNotFoundError: pass
    logf = os.path.join(r, "root/openbot.log")
    off = os.path.getsize(logf) if os.path.exists(logf) else 0
    res["root_before"] = du(f"{r}/root")
    if a.cold:
        subprocess.run(["sync"]); open("/proc/sys/vm/drop_caches", "w").write("3\n")
    guest = guest_env(["OPENBOT_PROOT_PROFILE=safe", f"OPENBOT_READY_TIMEOUT={a.timeout}"] + a.genv) + ["/bin/bash", "/root/openbot-start.sh"]
    if a.mode == "proot":
        cmd = proot_argv(r, guest); kw = dict(user=USER, group=USER, extra_groups=[], env=host_env(a.henv), cwd=r)
    else:
        cmd = chroot_cmd(r, guest); kw = dict(env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin"})
    out = open(f"{OUT}/boot-{a.label}.stdout", "w")
    t0 = time.time(); p = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, start_new_session=True, **kw)
    marks = {}; pats = {"dbus": "D-Bus session bus up", "xvfb": "Virtual displays", "keyring": "Keyring unlocked",
                        "launch": "Launching OpenBot", "ready": "OPENBOT_LOCAL_READY", "failed": "OPENBOT_LOCAL_FAILED"}
    pos = off; ready = False
    try:
        while time.time() - t0 < a.timeout + 30:
            if p.poll() is not None: break
            try:
                with open(logf, "rb") as f:
                    f.seek(pos); chunk = f.read(); pos += len(chunk)
                for k, pat in pats.items():
                    if k not in marks and pat.encode() in chunk: marks[k] = round(time.time() - t0, 2)
            except FileNotFoundError:
                pass
            try:
                if "state=ready" in open(f"{r}/run/openbot/engine.state").read():
                    marks.setdefault("state_ready", round(time.time() - t0, 2)); ready = True; break
            except FileNotFoundError:
                pass
            if "failed" in marks: break
            time.sleep(0.05)
        res["marks"] = marks; res["ready"] = ready; res["ready_s"] = marks.get("state_ready")
        print(f"[{a.label}] ready={ready} marks={marks}", flush=True)
        if ready:
            time.sleep(1)
            res["procs_at_ready"] = [(role(v['cmd'], v['comm']), v['rss']) for v in sample(tree(p.pid)).values()]
            res["ctl_status"] = ctl_status(r)
            if a.probes:
                pr = {}
                for name, argv in (("true", ["/bin/true"]), ("openbot-status-cli", ["/usr/local/bin/openbot", "status"]),
                                   ("engine-status-sh", ["/root/openbot-status.sh"])):
                    ts = []
                    for _ in range(3):
                        rc, s, o = run_guest(r, a.mode, argv); ts.append(round(s, 3))
                    pr[name] = dict(rc=rc, secs=ts, tail=o.strip()[-160:])
                res["probes"] = pr
            if a.idle:
                time.sleep(a.settle)
                tot, rows = idle(p.pid, a.idle, a.label); res["idle"] = tot
                res["idle_by_role"] = {}
                for x in rows:
                    d = res["idle_by_role"].setdefault(x["role"], dict(n=0, cpu=0, ctx=0, rss_mb=0, libs=[]))
                    d["n"] += 1; d["cpu"] = round(d["cpu"] + x["cpu"], 2); d["ctx"] = round(d["ctx"] + x["ctx"], 1)
                    d["rss_mb"] = round(d["rss_mb"] + x["rss_mb"], 1); d["libs"] = sorted(set(d["libs"]) | set(x["libs"]))
                print(f"[{a.label}] idle {tot}", flush=True)
    finally:
        ts = time.time()
        try:
            pid = int(re.search(r"engine_pid=(\d+)", open(f"{r}/run/openbot/engine.state").read()).group(1))
            os.kill(pid, signal.SIGTERM)
        except Exception as e:
            res["stop_note"] = str(e)
            try: os.killpg(p.pid, signal.SIGTERM)
            except Exception: pass
        try:
            p.wait(timeout=70); res["stop_s"] = round(time.time() - ts, 2)
        except subprocess.TimeoutExpired:
            res["stop_s"] = "timeout"
        for q in reversed(tree(p.pid)):
            try: os.kill(q, signal.SIGKILL)
            except Exception: pass
        try: os.killpg(p.pid, signal.SIGKILL)
        except Exception: pass
        try: p.wait(timeout=10)
        except Exception: pass
        res["exit"] = p.returncode
        with open(logf, "rb") as f:
            f.seek(off); open(f"{OUT}/boot-{a.label}.log", "wb").write(f.read())
        res["root_after"] = du(f"{r}/root")
        with open(f"{OUT}/boots.jsonl", "a") as f: f.write(json.dumps(res) + "\n")
        print(json.dumps({k: v for k, v in res.items() if k not in ("procs_at_ready",)})[:1500], flush=True)


if __name__ == "__main__":
    main()
