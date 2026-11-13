# Antigravity (Gemini) runtime on the phone

OpenBot 0.69 runs Gemini through Google's **Antigravity CLI** (>= 1.5.3): `<cli> --version` must print a
bare `x.y.z`, and `<cli> acp --gemini-dir=<abs> --app-data-dir=antigravity-acp` is its ACP server. The CLI
is one Go binary with no TCMalloc, so it runs on 39-bit VA Android kernels (checked with a seccomp
39-bit simulation: `--version`, ACP `initialize` and `session/new` all answer; Go's heap falls back below
2^39). `prepare.py` downloads it on the phone from Google's GitHub release, pinned to the version and
sha256 in the engine's own `native-runtime.lock.json` (`CLI_*`; `build-rootfs.sh` warns when app.asar
does not name the pin), and checks both the archive and the executable.

Engines up to 0.61 used the **hybrid** instead: Google's 1.4.x ACP server (`agy_acp_server.par`) is linked
with TCMalloc built for a 48-bit address space and aborts on 39-bit kernels
(google-antigravity/antigravity-cli#64), so the hybrid runs that server's own Python frontend, extracted
from the PAR, on a stock CPython 3.14 next to Google's `localharness_external`. It stays available as
`prepare.py --legacy-hybrid`. Its launcher also answers the 0.69 command line (`--version`, `acp` with the
two folder flags mapped to `GEMINI_HOME`), so a phone that has only the hybrid keeps Gemini after the engine
update until the app's auto-update (`check` reports the pinned CLI as `latest`) installs the CLI.

Nothing from Google ships in the APK, the rootfs or this repo. The rootfs carries only:

- `/opt/python3.14`: python-build-standalone CPython 3.14, aarch64 gnu (PSF licence)
- `/opt/agy-hybrid/tools/`: these scripts
- `/opt/agy-hybrid/current` -> `/root/.local/share/agy-hybrid/current` (under `/root`, so engine updates keep it)

On the phone (Server settings > Local engine > Antigravity (Gemini) > Set up), `agy-hybrid.sh prepare` runs
`prepare.py`, which installs the runtime, smoke-tests it, and only then moves `current` (the previous one is
kept). `openbot-start.sh` exports `OPENBOT_ANTIGRAVITY_PATH` to `current/bin/antigravity` (CLI) or
`current/bin/agy_acp_server` (hybrid) when `current/.ready` exists.

| File | Role |
| --- | --- |
| `prepare.py` | installs the pinned CLI (default) or the legacy hybrid; `--check` prints installed/latest; progress as `[agy-hybrid] STAGE <name> <pct>` on stderr |
| `agy_hybrid.py` | hybrid bootstrap: sys.path, merged `google` namespace, protobuf runtime check off, `FieldDescriptor.label` restored on protobuf >= 7.34, runs `acp_server.main`; `openbot-start.sh` copies it (and the launcher) over a prepared hybrid on each start |
| `agy_acp_server` | hybrid sh launcher; sets the harness path, `AGY_ACP_FORCE_FILE_STORAGE=1` and `BROWSER=open-url`; bridges the 0.69 command line |
| `open-url` | hybrid BROWSER stand-in: records the Google sign-in link in `/root/.config/openbot-local/agy-signin-url`, never writes to stdout (the ACP channel). The CLI does not use it: it runs `xdg-open`, which the engine replaces with its own opener and relays to the app |
| `agy-hybrid.sh` | what the app runs: `status`, `check`, `prepare`, `remove`, `signin-url` |

Log: `/root/.config/openbot-local/agy-hybrid.log`.
