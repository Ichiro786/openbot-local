#!/usr/bin/env python3
"""OpenBot Local: prepare the Antigravity (Gemini) runtime ON THE DEVICE.

Default (engine >= 0.69): Google's Antigravity CLI (one Go binary, `antigravity acp` is its ACP server). It
has no TCMalloc, so it runs on 39-bit VA Android kernels. Version and hashes are pinned to the engine's own
native-runtime.lock.json (CLI_* below; build-rootfs.sh checks the pin is in app.asar). Downloaded from
Google's GitHub release on the device and verified (archive and executable sha256); never shipped.
  <root>/<version>/bin/antigravity        sh wrapper (OPENBOT_ANTIGRAVITY_PATH points here)
  <root>/<version>/libexec/antigravity    Google's binary
  <root>/current -> <version>             only after `--version` and ACP initialize pass
  prepare.py [--root DIR]                 install the pinned CLI
  prepare.py [--root DIR] --check         installed=, latest= (the pin, no network), update=0|1

--legacy-hybrid: the 1.4.x hybrid below (engines <= 0.61 only; kept for rollback and the CI bridge test).

Legacy hybrid: the Antigravity ACP "hybrid" runtime.

Runs Google's own ACP server Python frontend (extracted from the official linux-arm64 PAR) on a stock
CPython 3.14 (glibc malloc, no TCMalloc), plus Google's official localharness_external (Go, VA-safe).
Never ships or re-hosts Google files: it downloads from dl.google.com on the device, checks the sha256 from
the ACP registry, and extracts locally. The PAR itself is never executed.

Usage:
  prepare.py [--root DIR] [--python /path/python3.14] [--zip local.zip --sha256 HEX --version X.Y.Z]
  prepare.py [--root DIR] --check     prints key=value lines: installed=, latest=, update=0|1 (no changes)
Result:
  <root>/<version>/antigravity-package.json   {"version": "<version from acp_server/_version.py>"}
  <root>/<version>/bin/agy_acp_server         sh launcher (OPENBOT_ANTIGRAVITY_PATH points here)
  <root>/<version>/bin/agy_hybrid.py          bootstrap
  <root>/<version>/bin/localharness_external  official binary
  <root>/<version>/src/google3/...            extracted Python (bundled .so and replaced pkgs removed)
  <root>/<version>/venv/                      CPython 3.14 venv with public wheels
  <root>/current -> <version>                 only after the smoke test passes
Progress lines on stderr: "[agy-hybrid] STAGE <name> [percent]" (download, verify, extract, install,
smoke, done). Exit 0 = ready. Any failure leaves <root>/current untouched (the previous runtime keeps working).
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, threading, urllib.request, zipfile

REGISTRY = "https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json"
PLATFORM = "linux-aarch64"
ACP_MAIN = "google3/cloud/developer_experience/antigravity_extensions/acp_server"
TP = "google3/third_party/py"
# Bundled pure-Python packages that must come from public wheels instead (native parts or metadata checks).
# name in third_party/py -> (pypi name, pin from bundled version?)
REPLACE = {"pydantic": ("pydantic", True), "pydantic_core": (None, False),   # pydantic pins its own core
           "PIL": ("pillow", True), "psutil": ("psutil", True), "cryptography": ("cryptography", False)}
ALWAYS = ["protobuf"]  # public protobuf; the bundled one is internal (7.38.0, not on PyPI)
HERE = os.path.dirname(os.path.abspath(__file__))
SMOKE_TIMEOUT = 180
# Antigravity CLI pinned to OpenBot 0.69.0's native-runtime.lock.json ("antigravity", linux-arm64).
CLI_VERSION = "1.5.4"
CLI_URL = f"https://github.com/google-antigravity/antigravity-cli/releases/download/{CLI_VERSION}/agy_cli_linux_arm64.tar.gz"
CLI_SHA256 = "aa8870d1b93b646ed52fd0862752b3ec8c5e91afd22d943eb2a9a0b0671fd939"
CLI_EXE_SHA256 = "874d86300e64ff6f378abd55bcb45cbc1f8749fa422629c10ddecbac683b7b97"
CLI_WRAPPER = """#!/bin/sh
# OpenBot Local: Google's Antigravity CLI, downloaded on this phone by /opt/agy-hybrid/tools/prepare.py.
# stdout is the ACP JSON-RPC channel: nothing here may print to it.
D=$(cd "$(dirname "$0")" && pwd)
# The CLI replaces itself when it updates; the engine pins the version it was tested with.
export AGY_CLI_DISABLE_AUTO_UPDATE=true
# Without a display the CLI refuses the Google sign-in ("No browser is available here"); with one it runs
# `xdg-open <link>` from PATH, which the engine replaces with its own opener and relays to the app.
[ -n "${DISPLAY:-}" ] || export DISPLAY=:0
exec "$D/../libexec/antigravity" "$@"
"""

def log(*a): print("[agy-hybrid]", *a, file=sys.stderr, flush=True)

def stage(name, pct=None): log("STAGE", name, *([] if pct is None else [int(pct)]))

def sha256(p):
    h = hashlib.sha256(); size = os.path.getsize(p) or 1; done = 0; last = -1
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b); done += len(b)
            pct = done * 100 // size
            if pct // 10 != last: last = pct // 10; stage("verify", pct)
    return h.hexdigest()

def bundled_version(src, top):
    for cand in ("version.py", "__init__.py", "_version.py", "__about__.py"):
        p = os.path.join(src, TP, top, cand)
        if os.path.exists(p):
            m = re.search(r"^(?:__version__|VERSION|version)\s*[:=][^'\"\n]*['\"]([0-9][^'\"]*)['\"]",
                          open(p, errors="ignore").read(), re.M)
            if m: return m.group(1)

def registry():
    reg = json.load(urllib.request.urlopen(REGISTRY, timeout=60))
    art = reg["distribution"]["binary"][PLATFORM]
    return art["archive"], art["sha256"], reg["version"]

def installed(root):
    try:
        return open(os.path.join(root, "current", ".ready")).read().strip() or None
    except OSError:
        return None

def download(url, dest):
    stage("download", 0)
    last = [-1]
    def hook(blocks, bs, total):
        if total > 0:
            pct = min(100, blocks * bs * 100 // total)
            if pct != last[0]: last[0] = pct; stage("download", pct)
    urllib.request.urlretrieve(url, dest, hook)

def switch_current(root, ver):
    cur = os.path.join(root, "current"); tmp = cur + ".new"
    prev = installed(root)   # a running engine may still use it until restarted: keep one back
    if os.path.lexists(tmp): os.remove(tmp)
    os.symlink(ver, tmp); os.replace(tmp, cur)
    for old in os.listdir(root):
        if old not in (ver, prev, "current") and re.fullmatch(r"\d+\.\d+\.\d+", old):
            shutil.rmtree(os.path.join(root, old), ignore_errors=True)

def acp_initialize(argv, env, timeout=SMOKE_TIMEOUT):
    """ACP initialize; returns the parsed answer or exits."""
    req = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": 1, "clientInfo": {"name": "openbot", "version": "0"}, "clientCapabilities": {}}})
    p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
    timer = threading.Timer(timeout, p.kill); timer.start()
    try:
        p.stdin.write((req + "\n").encode()); p.stdin.flush()
        line = p.stdout.readline()
    finally:
        timer.cancel(); p.kill(); p.wait()
    if not line: sys.exit(f"smoke test: no answer to ACP initialize within {timeout}s")
    return json.loads(line)

def cli_main(a):
    ver = CLI_VERSION
    if a.check:
        have = installed(a.root)
        print(f"installed={have or ''}\nlatest={ver}\nupdate={int(have != ver)}\nerror=")
        return
    dest = os.path.join(a.root, ver)
    if (os.path.exists(os.path.join(dest, ".ready")) and installed(a.root) == ver
            and os.access(os.path.join(dest, "bin", "antigravity"), os.X_OK)):
        log("already prepared", dest); stage("done", 100); return
    os.makedirs(a.root, exist_ok=True)
    for old in os.listdir(a.root):   # leftovers of an interrupted run
        if old.startswith(f".{ver}."): shutil.rmtree(os.path.join(a.root, old), ignore_errors=True)
    free = shutil.disk_usage(a.root).free
    if free < 450_000_000:
        sys.exit(f"not enough storage: {free // 1048576} MiB free, about 400 MiB needed while preparing (230 MiB after)")
    work = tempfile.mkdtemp(prefix=f".{ver}.", dir=a.root)
    try:
        tgz = os.path.join(work, "cli.tar.gz")
        log("download", CLI_URL); download(CLI_URL, tgz)
        stage("verify", 0)
        got = sha256(tgz)
        if got != CLI_SHA256: sys.exit(f"sha256 mismatch: {got} != {CLI_SHA256}")
        stage("extract", 0)
        import tarfile
        os.makedirs(os.path.join(work, "bin")); os.makedirs(os.path.join(work, "libexec"))
        exe = os.path.join(work, "libexec", "antigravity")
        with tarfile.open(tgz) as t:
            m = next((m for m in t.getmembers() if m.isfile() and os.path.basename(m.name) == "antigravity"), None)
            if m is None: sys.exit("the Antigravity CLI archive has no `antigravity` executable")
            with t.extractfile(m) as f, open(exe, "wb") as o: shutil.copyfileobj(f, o, 1 << 20)
        os.remove(tgz)
        os.chmod(exe, 0o755)
        if sha256(exe) != CLI_EXE_SHA256: sys.exit("sha256 mismatch for the antigravity executable")
        stage("extract", 100)
        wrapper = os.path.join(work, "bin", "antigravity")
        open(wrapper, "w").write(CLI_WRAPPER); os.chmod(wrapper, 0o755)
        json.dump({"version": ver}, open(os.path.join(work, "antigravity-package.json"), "w"))

        # Smoke test: what the engine runs. `--version` must print the bare version (cli.ts
        # parseAntigravityVersion), and `acp --gemini-dir=<abs> --app-data-dir=antigravity-acp` must answer
        # ACP initialize with agentInfo.version == the pin.
        stage("smoke")
        home = os.path.join(work, ".smokehome")
        env = dict(os.environ, HOME=home, WSL_DISTRO_NAME="OpenBot")
        out = subprocess.run([wrapper, "--version"], capture_output=True, text=True, timeout=120, env=env).stdout
        if not re.fullmatch(r"\s*" + re.escape(ver) + r"\s*", out):
            sys.exit(f"smoke test: `antigravity --version` printed {out.strip()[:80]!r}, expected {ver}")
        ans = acp_initialize([wrapper, "acp", f"--gemini-dir={os.path.join(home, '.gemini')}",
                              "--app-data-dir=antigravity-acp"], env)
        got_ver = ans["result"]["agentInfo"]["version"]
        if got_ver != ver: sys.exit(f"smoke test: the CLI reports {got_ver}, expected {ver}")
        shutil.rmtree(home, ignore_errors=True)
        open(os.path.join(work, ".ready"), "w").write(ver + "\n")

        if os.path.exists(dest): shutil.rmtree(dest)
        os.rename(work, dest)
        switch_current(a.root, ver)
        log("ready", dest); stage("done", 100)
    except BaseException:
        shutil.rmtree(work, ignore_errors=True); raise

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/opt/agy-hybrid")
    ap.add_argument("--python", default=os.environ.get("AGY_HYBRID_PYTHON", "python3.14"))
    ap.add_argument("--zip"); ap.add_argument("--sha256"); ap.add_argument("--version")
    ap.add_argument("--keep-zip", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--legacy-hybrid", action="store_true")
    a = ap.parse_args()

    if not a.legacy_hybrid:
        return cli_main(a)

    if a.check:
        have = installed(a.root)
        try:
            latest = registry()[2]; err = ""
        except Exception as e:  # offline: report what is installed
            latest = ""; err = str(e).replace("\n", " ")[:200]
        print(f"installed={have or ''}\nlatest={latest}\nupdate={int(bool(latest) and latest != have)}\nerror={err}")
        return

    if a.zip:
        url, want, ver = None, a.sha256, a.version
    else:
        stage("registry")
        url, want, ver = registry()
    if not re.fullmatch(r"\d+\.\d+\.\d+", ver or ""): sys.exit(f"bad version {ver!r}")
    dest = os.path.join(a.root, ver)
    if os.path.exists(os.path.join(dest, ".ready")) and installed(a.root) == open(os.path.join(dest, ".ready")).read().strip():
        log("already prepared", dest); stage("done", 100); return
    os.makedirs(a.root, exist_ok=True)
    for old in os.listdir(a.root):   # leftovers of an interrupted run
        if old.startswith(f".{ver}."): shutil.rmtree(os.path.join(a.root, old), ignore_errors=True)
    free = shutil.disk_usage(a.root).free
    if free < 2_600_000_000:
        sys.exit(f"not enough storage: {free // 1048576} MiB free, about 2500 MiB needed while preparing (340 MiB after)")
    work = tempfile.mkdtemp(prefix=f".{ver}.", dir=a.root)
    try:
        zp = a.zip or os.path.join(work, "acp.zip")
        if url:
            log("download", url); download(url, zp)
        stage("verify", 0)
        got = sha256(zp)
        if want and got != want: sys.exit(f"sha256 mismatch: {got} != {want}")
        stage("extract", 0)
        os.makedirs(os.path.join(work, "bin"))
        with zipfile.ZipFile(zp) as outer:
            outer.extract("localharness_external", os.path.join(work, "bin"))
            outer.extract("agy_acp_server.par", work)
        if url and not a.keep_zip: os.remove(zp)
        os.chmod(os.path.join(work, "bin", "localharness_external"), 0o755)
        par = os.path.join(work, "agy_acp_server.par")
        src = os.path.join(work, "src")
        n = 0
        with zipfile.ZipFile(par) as z:   # ELF launcher + ZIP overlay; zipfile handles the prefix
            items = [i for i in z.infolist() if i.filename.startswith("google3/") and not i.filename.endswith("/")
                     and not (i.filename.endswith(".so") or ".so." in i.filename)]  # .so need the PAR's libc++/TCMalloc
            for i in items:
                z.extract(i, src); n += 1
                if n % 500 == 0: stage("extract", n * 100 // len(items))
        os.remove(par)
        log("extracted", n, "files")
        vfile = os.path.join(src, ACP_MAIN, "_version.py")
        real = re.search(r"__version__\s*=\s*['\"]([\d.]+)['\"]", open(vfile).read()).group(1)
        if real != ver: log(f"note: registry says {ver}, server says {real}; manifest uses {real}")

        stage("install", 0)
        pins = list(ALWAYS)
        for top, (pypi, pin) in REPLACE.items():
            v = bundled_version(src, top) if pin else None
            if pypi: pins.append(f"{pypi}=={v}" if v else pypi)
            shutil.rmtree(os.path.join(src, TP, top), ignore_errors=True)
        venv = os.path.join(work, "venv")
        subprocess.run([a.python, "-m", "venv", venv], check=True, stdout=sys.stderr)
        vpy = os.path.join(venv, "bin", "python")
        stage("install", 30)
        log("pip install", pins)
        r = subprocess.run([vpy, "-m", "pip", "install", "-q", "--disable-pip-version-check", "--only-binary=:all:", *pins],
                           stdout=sys.stderr)
        if r.returncode:   # pinned wheel missing for this arch/python: fall back to unpinned
            subprocess.run([vpy, "-m", "pip", "install", "-q", "--disable-pip-version-check", "--only-binary=:all:",
                            *[p.split("==")[0] for p in pins]], check=True, stdout=sys.stderr)
        open(os.path.join(work, "pins.txt"), "w").write("\n".join(pins) + "\n")
        stage("install", 70)
        # The launcher runs with PYTHONDONTWRITEBYTECODE=1: compile once here so starts stay fast.
        subprocess.run([vpy, "-m", "compileall", "-q", "-j", "0", "-x", r"/(test|tests)/", src],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        stage("install", 100)

        shutil.copy(os.path.join(HERE, "agy_hybrid.py"), os.path.join(work, "bin", "agy_hybrid.py"))
        shutil.copy(os.path.join(HERE, "agy_acp_server"), os.path.join(work, "bin", "agy_acp_server"))
        os.chmod(os.path.join(work, "bin", "agy_acp_server"), 0o755)
        json.dump({"version": real}, open(os.path.join(work, "antigravity-package.json"), "w"))

        # Smoke test: ACP initialize must answer with agentInfo.version == real.
        stage("smoke")
        req = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": 1, "clientInfo": {"name": "zed", "version": "0"}, "clientCapabilities": {}}})
        env = dict(os.environ, AGY_ACP_FORCE_FILE_STORAGE="1", HOME=os.path.join(work, ".smokehome"),
                   GEMINI_HOME=os.path.join(work, ".smokehome", ".gemini"), BROWSER="/bin/true")
        p = subprocess.Popen([os.path.join(work, "bin", "agy_acp_server"), "--uid="], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
        timer = threading.Timer(SMOKE_TIMEOUT, p.kill); timer.start()
        try:
            p.stdin.write((req + "\n").encode()); p.stdin.flush()
            line = p.stdout.readline()
        finally:
            timer.cancel(); p.kill(); p.wait()
        if not line: sys.exit(f"smoke test: no answer to ACP initialize within {SMOKE_TIMEOUT}s")
        got_ver = json.loads(line)["result"]["agentInfo"]["version"]
        if got_ver != real: sys.exit(f"smoke test: server reports {got_ver}, expected {real}")
        shutil.rmtree(env["HOME"], ignore_errors=True)
        open(os.path.join(work, ".ready"), "w").write(real + "\n")

        if os.path.exists(dest): shutil.rmtree(dest)
        os.rename(work, dest)
        cur = os.path.join(a.root, "current"); tmp = cur + ".new"
        prev = installed(a.root)   # a running engine may still use it until restarted: keep one back
        if os.path.lexists(tmp): os.remove(tmp)
        os.symlink(ver, tmp); os.replace(tmp, cur)
        for old in os.listdir(a.root):
            if old not in (ver, prev, "current") and re.fullmatch(r"\d+\.\d+\.\d+", old):
                shutil.rmtree(os.path.join(a.root, old), ignore_errors=True)
        log("ready", dest); stage("done", 100)
    except BaseException:
        shutil.rmtree(work, ignore_errors=True); raise

if __name__ == "__main__":
    main()
