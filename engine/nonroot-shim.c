// libopenbot-nonroot.so: LD_PRELOAD shim for the OpenBot (Electron) processes inside the engine.
//
// OpenBot calls app.enableSandbox(), so every renderer gets --enable-sandbox. Electron aborts any
// process that has it while getuid() == 0 ("Running as root without --no-sandbox is not supported").
// In the engine everything is uid 0: proot -0 fakes root on Android, and the chroot smoke test is
// real root. The renderers still get --no-sandbox from the browser, so Chromium runs them
// unsandboxed either way; only Electron's uid check is in the way.
//
// This shim makes getuid() answer OPENBOT_NONROOT_UID (default 1000) in processes whose command line
// carries --enable-sandbox, and the real value everywhere else. geteuid() is untouched, so D-Bus
// (which authenticates with geteuid) and file ownership behave as before.
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

static int fake = -1;
static uid_t fake_uid = 1000;

static void detect(void) {
  char buf[16384];
  int fd = open("/proc/self/cmdline", O_RDONLY | O_CLOEXEC);
  fake = 0;
  if (fd < 0) return;
  ssize_t n = read(fd, buf, sizeof(buf) - 1);
  close(fd);
  if (n <= 0) return;
  buf[n] = '\0';
  for (ssize_t i = 0; i < n; i += (ssize_t)strlen(buf + i) + 1) {
    if (strcmp(buf + i, "--enable-sandbox") == 0) {
      fake = 1;
      break;
    }
  }
  const char *v = getenv("OPENBOT_NONROOT_UID");
  if (v && *v) fake_uid = (uid_t)strtoul(v, NULL, 10);
}

__attribute__((constructor)) static void init(void) { detect(); }

uid_t getuid(void) {
  if (fake < 0) detect();
  uid_t real = (uid_t)syscall(SYS_getuid);
  return (fake == 1 && real == 0) ? fake_uid : real;
}
