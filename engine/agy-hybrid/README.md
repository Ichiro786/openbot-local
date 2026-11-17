# Antigravity (Gemini) runtime on the phone

OpenBot >= 0.69 runs Gemini through Google's **Antigravity CLI** (>= 1.5.3): `<cli> --version` must print a
bare `x.y.z`, and `<cli> acp --gemini-dir=<abs> --app-data-dir=antigravity-acp` is its ACP server. The CLI
is one Go binary with no TCMalloc, so it runs on 39-bit VA Android kernels (checked with a seccomp
39-bit simulation: `--version`, ACP `initialize` and `session/new` all answer; Go's heap falls back below
2^39). `prepare.sh` downloads it on the phone from Google's GitHub release, pinned to the version and
sha256 in the engine's own `native-runtime.lock.json` (`CLI_*`; `build-rootfs.sh` warns when app.asar
does not name the pin), and checks both the archive and the executable.

Engines up to 0.61 used a Python **hybrid** (Google's 1.4.x ACP server frontend on a bundled CPython 3.14,
because that server's TCMalloc aborts on 39-bit kernels). Engines 0.69 to 0.71 still shipped CPython for
it and bridged its command line. Since 0.72 the engine ships no CPython (−78 MiB): `prepare.sh` is bash,
and on a phone that still has only the hybrid `openbot-start.sh` leaves `OPENBOT_ANTIGRAVITY_PATH` unset,
so OpenBot uses its own managed copy of the same 1.5.4 CLI until the app's auto-update (`check` reports
the pin as `latest`) runs `prepare` and installs the pinned one. The launcher then removes the old runtime.

Nothing from Google ships in the APK, the rootfs or this repo. The rootfs carries only:

- `/opt/agy-hybrid/tools/`: these scripts
- `/opt/agy-hybrid/current` -> `/root/.local/share/agy-hybrid/current` (under `/root`, so engine updates keep it)

| File | Role |
| --- | --- |
| `prepare.sh` | installs the pinned CLI, smoke-tests `--version` and ACP `initialize`, then moves `current` (keeps the previous one for a running engine); `--check` prints installed/latest/update; progress as `[agy-hybrid] STAGE <name> <pct>` on stderr |
| `agy-hybrid.sh` | what the app runs (POSIX sh): `status`, `check`, `prepare`, `remove`, `signin-url`. `status` still prints `python=1` (the app reads it as "the tools are here") |
| `open-url` | BROWSER stand-in that records a sign-in link in `/root/.config/openbot-local/agy-signin-url`, never writes to stdout (the ACP channel). The CLI itself runs `xdg-open`, which the engine replaces with its own opener and relays to the app |

Log: `/root/.config/openbot-local/agy-hybrid.log`.
