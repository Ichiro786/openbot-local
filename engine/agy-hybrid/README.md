# Antigravity (Gemini) hybrid runtime

Google's Antigravity ACP server (`agy_acp_server.par`, the Gemini provider) is linked with TCMalloc built
for a 48-bit address space and aborts on 39-bit Android kernels (google-antigravity/antigravity-cli#64),
up to at least 1.4.5. The hybrid runs the server's own Python frontend, extracted from the official PAR,
on a stock CPython 3.14 (glibc malloc), next to Google's official `localharness_external` (Go).

Nothing from Google ships in the APK, the rootfs or this repo. The rootfs carries only:

- `/opt/python3.14`: python-build-standalone CPython 3.14, aarch64 gnu (PSF licence)
- `/opt/agy-hybrid/tools/`: these scripts
- `/opt/agy-hybrid/current` -> `/root/.local/share/agy-hybrid/current` (under `/root`, so engine updates keep it)

On the phone (Server settings > Local engine > Antigravity (Gemini) > Set up), `agy-hybrid.sh prepare` runs
`prepare.py`, which reads the linux-aarch64 entry of the ACP registry, downloads the zip from
dl.google.com, checks its sha256, extracts the Python sources (every bundled `.so` dropped), installs
public wheels for the replaced native packages into a venv, smoke-tests ACP `initialize`, and only then
moves `current`. `openbot-start.sh` exports `OPENBOT_ANTIGRAVITY_PATH=/opt/agy-hybrid/current/bin/agy_acp_server`
when `current/.ready` exists and rewrites `antigravity-package.json` from the server's `_version.py`.

| File | Role |
| --- | --- |
| `prepare.py` | builds the runtime; `--check` prints installed/latest; progress as `[agy-hybrid] STAGE <name> <pct>` on stderr |
| `agy_hybrid.py` | bootstrap: sys.path, merged `google` namespace, protobuf runtime check off, `FieldDescriptor.label` restored on protobuf >= 7.34, runs `acp_server.main`; `openbot-start.sh` copies it over a prepared runtime on each start |
| `agy_acp_server` | sh launcher (what OpenBot runs); sets the harness path and `BROWSER=open-url` |
| `open-url` | BROWSER stand-in: records the Google sign-in link in `/root/.config/openbot-local/agy-signin-url`, never writes to stdout (the ACP channel) |
| `agy-hybrid.sh` | what the app runs: `status`, `check`, `prepare`, `remove`, `signin-url` |

Log: `/root/.config/openbot-local/agy-hybrid.log`.
