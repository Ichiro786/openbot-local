# OpenBot Local engine payload

The engine is an Ubuntu 24.04 arm64 rootfs with the official OpenBot Linux arm64 release in it.
The Android app (`run.openbot.local`) unpacks it once and starts it with PRoot, with no root.
Inside, `/root/openbot-start.sh` runs OpenBot as a self-hosted server (`OPENBOT_SERVER=1`). This
is the same server that upstream's Docker image runs.

## Files

| Path in this tree | Goes to | Purpose |
| --- | --- | --- |
| `.github/workflows/rootfs.yml` | repo | Builds and publishes the payload. Runs weekly and on manual dispatch. |
| `engine/build-rootfs.sh` | repo | Does the build: ubuntu-base, packages, AppImage, scripts, strip, pack. Runs as root on arm64. |
| `engine/smoke-test.sh` | repo | Starts the built tree once in a chroot or in proot, on an overlay. |
| `engine/openbot-start.sh` | `/root/openbot-start.sh` | Launcher (see below). |
| `engine/openbot-status.sh` | `/root/openbot-status.sh` | Readiness and status probe. |
| `engine/openbot-healthcheck.sh` | `/usr/local/bin/openbot-healthcheck` | Static payload check (libs, tools, CLI). |

## How the payload is built

The build mirrors upstream `docker/Dockerfile` and `scripts/install-server.sh`:

1. It reads `latest-linux-arm64.yml` from the latest OpenBot release, or from `v<version>` when a version is pinned. It downloads `OpenBot-<v>-arm64.AppImage`, checks its SHA-512 against the manifest, and runs `--appimage-extract`.
2. It takes the newest `ubuntu-base-24.04.x-base-arm64.tar.gz` from cdimage.ubuntu.com and checks it against `SHA256SUMS`.
3. In a native arm64 chroot, it installs:
   - the release's own `resources/hosting/packages.txt`, without `apparmor` (same as the Dockerfile)
   - the task's package list
   - the Dockerfile's extra tools: `git less openssh-client procps ripgrep tini unzip xz-utils`
   - `fonts-dejavu-core`
4. It puts the release at `/opt/OpenBot/app`, writes `container` to `/opt/OpenBot/hosted/mode`, and links `/usr/local/bin/openbot` to `resources/hosting/openbot`. That link is the upstream CLI (`openbot status | login | mobile-connect | logout | name | version`). In container mode it talks only to the control socket and never to systemd.
5. It adds the launcher, the status script, the health check, the fake `/proc` entries in `/opt/openbot-local/proc/`, a static `/etc/resolv.conf` and `/etc/hosts`, and `/opt/OpenBot/engine-version`.
6. It strips apt lists and caches, docs, man pages, info pages, translations, logs, and every Chromium `locales/*.pak` except `en-US`. `dpkg` path-excludes keep later installs lean as well.
7. It packs with `tar --numeric-owner --hard-dereference` (the Android app domain cannot create hard links), leaving `/dev`, `/proc` and `/sys` empty. It compresses with `xz -9 -T0`.

Outputs, attached to release `engine-<openbot version>` and kept 14 days as a workflow artifact:

- `rootfs-arm64.tar.xz`
- `rootfs-arm64.tar.xz.sha256`
- `engine.json`: version, sha256, `compressed_bytes`, `tar_bytes`, `installed_bytes`, file count

The rolling release `engine-latest` holds only `engine.json`, with `tag` and `url` added, so the app can find the newest payload with one request.

> **Private repo:** release assets of a private repository need a token to download. Phones
> cannot fetch them from `Ichiro786/openbot-local` while it is private. Publish the engine releases
> from a public repo (for example a small `openbot-local-engine` repo running this same workflow), or
> mirror the asset to another host.

### Expected size

These are estimates. The OpenBot 0.57.0 arm64 AppImage is 237 MB (squashfs), and ubuntu-base is about 29 MB. Each build writes the real figures to `engine.json` and the release notes.

| | Estimate |
| --- | --- |
| Download (`rootfs-arm64.tar.xz`) | ~260–340 MB |
| Unpacked on the phone | ~1.0–1.3 GB |
| Free space to require before unpacking | download + unpacked + ~300 MB for data, so plan on ~2 GB |

### Decoding on Android

`.tar.xz` decodes in pure Java with `org.tukaani:xz` (`XZInputStream`) plus Apache Commons Compress `TarArchiveInputStream`.

- Stream it from the download. Do not hold the archive in memory. Decoding takes roughly 30–90 s on a modern phone, since xz decompression is single-threaded.
- **Symlinks:** create them with `Os.symlink(target, path)`, exactly as stored. Absolute targets such as `/usr/lib/...` are correct, because proot resolves them inside the rootfs.
- **Permissions:** apply the mode bits with `Os.chmod`, at least the exec bits. Owners are all 0 and can be ignored.
- **Hard links:** there are none (`--hard-dereference`).
- **Device files:** there are none.
- **Atomicity:** unpack into `rootfs.partial/`. Write `rootfs/.engine-version` from `engine.json`, then rename to `rootfs/`.
- **Checksum:** check the sha256 before unpacking.

zstd would decode about 3× faster through `com.github.luben:zstd-jni`, but it is about 10–15 % larger. To switch, replace `xz -T0 -9` with `zstd -19 -T0 --long=27` in `build-rootfs.sh` and decode with `ZstdInputStream` (needs `--long` window support: `setLongMax(27)`).

## Starting it: the proot command

Ship proot as a native library so Android lets you exec it, for example `jniLibs/arm64-v8a/libproot.so`, `libproot-loader.so` and `libtalloc.so`, with `android:extractNativeLibs="true"`. Use **termux/proot 5.1.107.91 or newer**: that release emulates `AF_NETLINK` when Android SELinux denies it, and fixes the 5.1.107.90 `IS_IN_SYSENTER` assertion on netlink `bind()`. Chromium's network stack opens netlink sockets.

Keep `$R` short. The Unix sockets inside (`/run/openbot/control.sock`, `/run/openbot/bus`, `/tmp/.X11-unix/X0`) map to `$R/...` on the host, and their total path must stay under 108 bytes, for example `/data/data/run.openbot.local/files/r`.

```sh
R=/data/data/run.openbot.local/files/r          # rootfs (short path!)
L=$nativeLibraryDir                              # /data/app/.../lib/arm64
export PROOT_TMP_DIR=$cacheDir/proot              # must exist, writable
export PROOT_LOADER=$L/libproot-loader.so
export LD_LIBRARY_PATH=$L                         # libtalloc
unset LD_PRELOAD
# export PROOT_NO_SECCOMP=1                       # fallback toggle, see Troubleshooting

$L/libproot.so \
  --kill-on-exit \
  --link2symlink \
  --sysvipc \
  -0 \
  -L \
  -r "$R" \
  -w /root \
  -b /dev \
  -b /proc \
  -b /sys \
  -b /dev/urandom:/dev/random \
  -b /proc/self/fd:/dev/fd \
  -b /proc/self/fd/0:/dev/stdin \
  -b /proc/self/fd/1:/dev/stdout \
  -b /proc/self/fd/2:/dev/stderr \
  -b "$R/tmp:/dev/shm" \
  -b "$R/opt/openbot-local/proc/max_user_watches:/proc/sys/fs/inotify/max_user_watches" \
  -b "$R/opt/openbot-local/proc/cap_last_cap:/proc/sys/kernel/cap_last_cap" \
  [-b "$R/opt/openbot-local/proc/loadavg:/proc/loadavg"]   # only if the real one is unreadable
  [-b "$R/opt/openbot-local/proc/stat:/proc/stat"]         # only if the real one is unreadable
  [-b "$R/opt/openbot-local/proc/uptime:/proc/uptime"]     # only if the real one is unreadable
  [-b "$R/opt/openbot-local/proc/version:/proc/version"]   # only if the real one is unreadable
  [-b "$R/opt/openbot-local/proc/vmstat:/proc/vmstat"]     # only if the real one is unreadable
  /usr/bin/env -i \
    HOME=/root USER=root TERM=xterm-256color LANG=C.UTF-8 TMPDIR=/tmp \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    OPENBOT_PROOT_PROFILE=safe \
    /bin/bash /root/openbot-start.sh
```

What each part is for:

- **`--kill-on-exit`:** when the launcher exits, proot kills every leftover process (Xvfb, dbus, keyring, agent tools). Stopping still has to be graceful, see "Stopping".
- **`--link2symlink`:** emulates hard links. dpkg, git and gnome-keyring's backup links need it.
- **`--sysvipc`:** emulates SysV IPC. The launcher already disables Xvfb's MIT-SHM, so this is a safety net.
- **`-0`:** fake root. The launcher expects uid 0, and Electron then also needs `--no-sandbox`.
- **`-L`:** fixes `lstat` sizes of symlinks under proot. You can drop it if your proot build lacks it.
- **`-b /dev /proc /sys`:** required. The launcher exits with code 11 without them.
- **`$R/tmp:/dev/shm`:** gives Chromium and gnome-keyring a writable `/dev/shm`. Chromium is also told `--disable-dev-shm-usage`.
- **Fake `/proc/sys` entries:** stop the inotify and capability probes from failing. Bind each `/proc/*` file only after checking from Kotlin that the real file is unreadable (`File("/proc/stat").canRead()` plus a read attempt).
- **Process environment:** start the proot process with a clean environment. Pass engine overrides (see below) through `env`, never through the Android process environment.

The app must also provide:

- **Foreground service:** run proot from a foreground service with a partial wake lock. Android kills background processes, and phantom-process limits (Android 12+) can kill child processes. Advise users to disable the phantom process killer when they see unexpected deaths (`adb shell device_config set_sync_disabled_for_tests persistent; adb shell device_config put activity_manager max_phantom_processes 2147483647`, or the "Disable child process restrictions" developer option on Android 14+).
- **DNS (optional):** before each start, write the device's DNS servers from `ConnectivityManager.getLinkProperties(...).dnsServers` into `$R/etc/resolv.conf`. The payload ships 1.1.1.1 and 8.8.8.8.

### Engine overrides (pass via `env` inside proot)

| Variable | Default | Effect |
| --- | --- | --- |
| `OPENBOT_PROOT_PROFILE` | `safe` (or the last profile that reached ready) | Chromium flag set, see the table below |
| `OPENBOT_AUTO_ESCALATE` | `1` | On a network-service crash loop, restart with the next profile and remember the one that works |
| `OPENBOT_FLAGS` | unset | Replace all computed Chromium flags (`--password-store` is still passed) |
| `OPENBOT_EXTRA_FLAGS` | unset | Append flags |
| `OPENBOT_DISABLE_FEATURES` / `OPENBOT_ENABLE_FEATURES` | unset | Merged into the single `--disable-features` / `--enable-features` switch |
| `OPENBOT_PASSWORD_STORE` | `gnome-libsecret` | `basic` is for diagnosis only. The session then cannot be stored, so sign-in will not persist |
| `OPENBOT_DISPLAY_SIZE` | `1280x800` | Agent display `:1` (same rules as upstream) |
| `OPENBOT_XVFB_SHM` | `0` | `1` keeps MIT-SHM in Xvfb |
| `OPENBOT_XVFB_ARGS` | unset | Extra Xvfb args |
| `OPENBOT_READY_TIMEOUT` | `300` | Seconds to wait for the control socket |
| `OPENBOT_STOP_TIMEOUT` | `50` | Graceful stop window before SIGKILL |
| `OPENBOT_CRASH_THRESHOLD` | `5` | "Network service crashed" lines that count as a loop |
| `OPENBOT_VERBOSE` | `0` | `1` sends Chromium logging (`--enable-logging=stderr`, `ELECTRON_ENABLE_LOGGING`) to the log |
| `OPENBOT_AUTH_API_URL` | unset | Passed through to OpenBot |

The profiles (`/root/openbot-start.sh --print-flags` prints the effective set):

- **`minimal`:** `--no-sandbox --no-zygote --disable-gpu --disable-dev-shm-usage --ozone-platform=x11`
- **`safe` (default):**
  - everything in minimal
  - `--disable-gpu-compositing --disable-setuid-sandbox --disable-seccomp-filter-sandbox --disable-breakpad --no-first-run --disable-background-networking`
  - `--disable-features=NetworkServiceSandbox,AudioServiceOutOfProcess,Vulkan`
  - `--enable-features=NetworkServiceInProcess,NetworkServiceInProcess2`
- **`inprocess`:** everything in safe, plus `--in-process-gpu --renderer-process-limit=2` and `SpareRendererForSitePerProcess` disabled
- **`single`:** everything in inprocess, plus `--single-process`. This is a last resort, because Electron does not support it and renderers can break.

Every profile also passes `--password-store=gnome-libsecret`, as upstream does. The process environment adds `ELECTRON_DISABLE_SANDBOX=1 NO_AT_BRIDGE=1 GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1`.

## What the launcher does

`/root/openbot-start.sh` stays in the foreground for as long as OpenBot runs. In order, it:

1. Takes a lock, because only one launcher may run (exit 20 otherwise). It checks the app, `/proc`, `/dev`, `/tmp` and `/dev/shm`, and creates `/etc/machine-id` on first start, since libdbus aborts without one.
2. Makes `/run/openbot`, mode 0700. OpenBot main refuses any other mode for its control socket, and the upstream CLI hard-codes `/run/openbot/control.sock`.
3. Starts `dbus-daemon --session` on a path socket, `unix:path=/run/openbot/bus`. Abstract sockets are avoided under proot.
4. Starts `Xvfb :0` (1280x800, OpenBot's window) and `Xvfb :1` (`OPENBOT_DISPLAY_SIZE`, agents), both with `-nolisten tcp -extension MIT-SHM`, and waits for them with `xdpyinfo`.
5. Sets up the GNOME keyring exactly as upstream `openbot-container` does. The password file lives in `~/.config/openbot-container/keyring-password`, and the keyring is in `~/.local/share/keyrings` with `default` set to `login`. It runs `gnome-keyring-daemon --unlock --components=secrets` and then `--start`, and checks that `org.freedesktop.secrets` answers on D-Bus. Without that, Electron safeStorage, and so the account session, fails.
6. Runs `/opt/OpenBot/app/openbot` with the profile's flags. It sets `OPENBOT_SERVER=1`, `DISPLAY=:0`, `OPENBOT_AGENT_DISPLAY=:1`, and `XDG_RUNTIME_DIR=/run/openbot`. Output goes to `/root/openbot.log`, which is rotated above 20 MB.
7. Polls `GET /v1/status` on the control socket. When it answers 200, the launcher writes the ready marker and keeps supervising.
8. While supervising, if "Network service crashed" appears `OPENBOT_CRASH_THRESHOLD` times before ready, or OpenBot exits after such crashes, it restarts once per step with the next profile: safe, then inprocess, then single. The profile that reaches ready is saved in `~/.config/openbot-local/profile`.
9. On SIGTERM, SIGINT or SIGHUP, it sends SIGTERM to OpenBot only, which stops its agents and closes its database. It waits up to `OPENBOT_STOP_TIMEOUT`, then stops Xvfb, the keyring and dbus, and exits 0.

Data lives in `/root` inside the rootfs (`$R/root` on the host):

- `~/.config/OpenBot`: database, logs, provider runtimes, browser data
- `~/OpenBot`: agent workspaces
- the keyring and its password file

Keep these together. The keyring holds the key of the encrypted data, so back up or wipe them as one unit. When updating the engine, unpack the new payload and carry `$R/root` over, or keep `root/` outside the rootfs and bind it with `-b $DATA:/root`.

## Readiness: how the app knows it is up

The server publishes **no TCP port**. Its only local endpoint is the Unix control socket, so readiness comes from the launcher. Use any of these, in order of cost:

1. **State file (cheapest, host side, no proot call):** read `$R/run/openbot/engine.state`.

   ```
   state=starting|ready|stopping|stopped|failed
   reason=...
   code=<exit code on failure>
   profile=safe
   engine_pid=<launcher pid>
   openbot_pid=<pid>
   updated=<UTC>
   ```

   The process ids are real host pids, because proot does not virtualise pids. Treat `state=ready` with a live `engine_pid` as up.

2. **Log markers** in `$R/root/openbot.log`. Tail it, or watch the proot process's stderr.

   ```
   OPENBOT_LOCAL_READY version=0.57.0 account=signed_out server=unconfigured profile=safe socket=/run/openbot/control.sock
   OPENBOT_LOCAL_FAILED code=14 reason=The Secret Service (org.freedesktop.secrets) does not answer on D-Bus; ...
   OPENBOT_LOCAL_STOPPED code=0
   ```

3. **Status script:** a second proot call (same flags, any command) can run `/root/openbot-status.sh [--json] [--wait N]`. It exits 0 when ready, 1 while starting, 2 when down. It prints `up`, `engine_state`, `profile`, `account`, `server` (`unconfigured|starting|online|error`), `version`, and `memory_level`.

4. **Control socket directly from Kotlin:**
   - `$R/run/openbot/control.sock` is a real host socket owned by the app uid, mode 0600. Connect with `android.net.LocalSocket` and `LocalSocketAddress(path, Namespace.FILESYSTEM)`, then send plain HTTP/1.0.
   - Every answer is `key=value` lines.
   - The routes are the ones the upstream CLI uses:
     - `GET /v1/status`
     - `POST /v1/login/start` (`email`, optional `name`), which returns `challenge`
     - `POST /v1/login/verify` (`challenge`, `code`, optional `name`)
     - `POST /v1/login/claim`
     - `POST /v1/name`
     - `POST /v1/mobile-connect`
     - `POST /v1/logout`
   - Bodies are `application/x-www-form-urlencoded`, at most 4 KiB.

### Sign-in

Interactive `openbot login` requires a TTY, because the upstream CLI checks `[ -t 0 ]`. The app has two options:

- run it in a proot terminal session, or
- run the email-code flow itself on the control socket: `login/start`, then `login/verify`.

After sign-in, `server` becomes `online` and the phone shows up as a Remote host of that account in the desktop app, the iPhone app and `openbot.run/app`.

## Stopping

To stop gracefully, do one of these:

- send SIGTERM to `engine_pid` from the state file (an app may signal its own processes), or
- run `/root/openbot-start.sh --stop` in a second proot call.

Do not kill the proot process first. `--kill-on-exit` would SIGKILL OpenBot before it closes its database.

## Exit codes of openbot-start.sh

| Code | Meaning |
| --- | --- |
| 0 | Clean stop |
| 2 | Usage error |
| 10 | `/opt/OpenBot/app/openbot` missing (incomplete payload) |
| 11 | `/proc`, `/dev` or `/tmp` unusable, or log unwritable |
| 12 | dbus-daemon failed |
| 13 | Xvfb failed |
| 14 | Keyring or Secret Service failed |
| 15 | OpenBot exited before ready |
| 16 | Not ready within `OPENBOT_READY_TIMEOUT` |
| 17 | Network-service crash loop, no fallback profile left |
| 18 | OpenBot exited with a non-zero code after ready |
| 20 | Another launcher is running |

## Troubleshooting under proot (what was researched, and why the defaults are what they are)

- **`Network service crashed or was terminated, restarting service` loop.** These are the known causes, most likely first:
  1. **Netlink denied by Android SELinux** (Android 11+ for untrusted apps). Chromium's network stack (`AddressTrackerLinux`, interface enumeration) uses `AF_NETLINK`. Use termux/proot 5.1.107.91 or newer, which emulates netlink with an AF_UNIX fallback. Avoid 5.1.107.90, which aborts with `IS_IN_SYSENTER` on netlink `bind()`. If you are stuck on an older proot, set `PROOT_NO_SECCOMP=1` on the proot process; it is slower but avoids the seccomp fast path. (termux/proot#388; termux/termux-app#2993; the "Could not bind NETLINK socket" lines from `address_tracker_linux.cc`.)
  2. **The out-of-process network service under ptrace.** `NetworkServiceInProcess(2)` keeps it in the browser process, so a real fault shows up once in the log instead of as an endless restart loop. `NetworkServiceSandbox` is disabled for the same reason.
  3. **os_crypt / keyring.** Electron 40 betas crash-looped the network service when cookie encryption could not get its key (electron/electron#49383, fixed for 40.0.0 stable). The launcher therefore refuses to start OpenBot until the Secret Service answers (exit 14) instead of letting Chromium spin.

  Set `OPENBOT_VERBOSE=1` to get Chromium's own error line before the crash. The launcher prints a hint when it sees `NETLINK`, `IS_IN_SYSENTER` or keyring errors.
- **`--no-sandbox` and `--no-zygote`:** proot has no user namespaces and no seccomp-bpf for the guest, and the zygote fork server breaks under ptrace. Upstream discourages `--no-sandbox` on a desktop. Here it is unavoidable, and the phone's app sandbox is the boundary instead.
- **`--disable-gpu` and `--disable-gpu-compositing`:** there is no GPU or DRM node. The `inprocess` profile adds `--in-process-gpu` to save one ptrace'd process.
- **`/dev/shm`:** Android has none, so bind `$R/tmp` there. `--disable-dev-shm-usage` is also always set.
- **Fake `/proc/sys` entries:** `max_user_watches` and `cap_last_cap` are unreadable for apps, which logs inotify warnings and breaks capability probes.
- **Hard links:** the app domain cannot create them, so the archive has none and `--link2symlink` covers runtime.
- **Slow start:** ptrace makes every syscall costly. A first start (keyring creation plus the first database migration) can take several minutes on a mid-range phone, which is why `OPENBOT_READY_TIMEOUT` defaults to 300 s.

## Not verified

- The workflow and the scripts were written and syntax-checked only. Neither the workflow nor a start on a phone has been run.
- The CI smoke tests (chroot, and the distro's proot on GitHub's kernel) do not reproduce Android's SELinux restrictions. Their result is recorded in the release notes, and they never block publishing.
- It is unknown whether OpenBot main itself refuses `--no-sandbox` or running as uid 0. Upstream's container entrypoint checks for user namespaces and refuses root, but that check is in the shell script this launcher replaces. If main also refuses, it will show as exit 15 with OpenBot's own message in the log.
- If OpenBot main appends its own `--disable-features` or `--enable-features`, Chromium keeps only one of each switch, and ours may be overridden. Check the effective switches with `OPENBOT_VERBOSE=1`.
- The size figures are estimates until the first build.
