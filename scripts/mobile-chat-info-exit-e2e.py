import argparse
import json
import math
import queue
import re
import shlex
import subprocess
import threading
import time
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".openbot-build/mobile-chat-info-exit-e2e"
MARK = "OPENBOT_MORPH_E2E "


def prepare():
    manifest = OUT / "instrumentation.json"
    if manifest.exists():
        raise RuntimeError("Instrumentation exists. Restore it first.")
    mobile = ROOT / "apps/mobile/src"
    motion = mobile / "shared/motion"
    native = next((p for p in [
        ROOT / "node_modules/react-native-screens",
        ROOT / "apps/mobile/node_modules/react-native-screens",
    ] if p.exists()), None)
    if native is None:
        raise RuntimeError("Install dependencies before instrumentation.")
    native = native.resolve()
    if not native.is_relative_to(ROOT):
        raise RuntimeError("The native package must be inside this checkout.")
    edits = {
        motion / "liveZoom.ts": [(
            "    entry.avatarOrigin = rect;",
            '    console.log("OPENBOT_MORPH_E2E " + JSON.stringify({ event: "home-avatar", rect }));\n'
            "    entry.avatarOrigin = rect;",
        )],
        mobile / "app/(app)/_layout.tsx": [(
            "    const zoom = liveZoomFor(route.key);",
            "    const zoom = liveZoomFor(route.key);\n"
            '    console.log("OPENBOT_MORPH_E2E " + JSON.stringify({ event: "chat-options", route: route.key, '
            'animation: zoom ? zoom.nativeClose ? chatAnimation : "none" : chatAnimation }));',
        ), (
            "              if (event.data?.closing) forgetAgentPage(route.key);",
            '              console.log("OPENBOT_MORPH_E2E " + JSON.stringify({ '
            'event: event.data?.closing ? "info-closed" : "info-open", route: route.key }));\n'
            "              if (event.data?.closing) forgetAgentPage(route.key);",
        )],
        motion / "LiveZoomScreen.tsx": [(
            "let gestureCancelledAt = 0;",
            'let gestureCancelledAt = 0;\nconst logMorphE2E = (event: string) => console.log("OPENBOT_MORPH_E2E " + event);',
        ), (
            "  useAnimatedStyle,",
            "  useAnimatedReaction,\n  useAnimatedStyle,",
        ), (
            "      st.settled = true;",
            '      console.log("OPENBOT_MORPH_E2E " + JSON.stringify({ event: "chat-ready", route: routeKey }));\n'
            "      st.settled = true;",
        ), (
            "      current.popped = true;",
            '      console.log("OPENBOT_MORPH_E2E " + JSON.stringify({ event: "morph-done", route: routeKey }));\n'
            "      current.popped = true;",
        ), (
            "      st.leaving = { popped: false, timer };",
            '      console.log("OPENBOT_MORPH_E2E " + JSON.stringify({ event: "morph-start", route: routeKey }));\n'
            "      st.leaving = { popped: false, timer };",
        ), (
            "  const dimStyle = useAnimatedStyle",
            '  useAnimatedReaction(() => { const c = card.get(); return c.closing && c.clock === 0 ? c : null; }, '
            '(c) => { if (c) scheduleOnRN(logMorphE2E, JSON.stringify({ '
            'event: "morph-land", route: routeKey, x: c.x, y: c.y, scale: c.scale, width, height, avatarScale })); });\n'
            "  const dimStyle = useAnimatedStyle",
        )],
        native / "android/src/main/java/com/swmansion/rnscreens/ScreenStack.kt": [(
            "        currentVisibleBottom = visibleBottom",
            "        currentVisibleBottom = visibleBottom\n"
            '        android.util.Log.i("OpenBotMorphE2E", "OPENBOT_MORPH_E2E " + org.json.JSONObject()'
            '.put("event", "native-stack").put("top", newTop?.screen?.screenId ?: "")'
            '.put("bottom", visibleBottom?.screen?.screenId ?: "").toString())',
        )],
    }
    changes = []
    for path, replacements in edits.items():
        before = path.read_text()
        after = before
        for anchor, replacement in replacements:
            if after.count(anchor) != 1:
                raise RuntimeError("Instrumentation anchor is absent or repeated: " + str(path.relative_to(ROOT)))
            after = after.replace(anchor, replacement)
        changes.append({"path": str(path.relative_to(ROOT)), "before": before, "after": after})
    manifest.write_text(json.dumps(changes))
    for change in changes:
        (ROOT / change["path"]).write_text(change["after"])


def restore():
    manifest = OUT / "instrumentation.json"
    changes = json.loads(manifest.read_text())
    for change in changes:
        if (ROOT / change["path"]).read_text() != change["after"]:
            raise RuntimeError("A file changed after instrumentation: " + change["path"])
    for change in changes:
        (ROOT / change["path"]).write_text(change["before"])
    manifest.unlink()


class Driver:
    def __init__(self, args):
        self.args = args
        self.events = []
        self.pending = queue.Queue()
        self.reader = None

    def adb(self, *args):
        return subprocess.check_output(["adb", "-s", self.args.serial, *args], text=True, timeout=25)

    def start(self):
        self.reader = subprocess.Popen([
            "adb", "-s", self.args.serial, "logcat", "-T", "1", "-v", "raw", "-s",
            "ReactNativeJS:I", "OpenBotMorphE2E:I", "*:S",
        ], stdout=subprocess.PIPE, text=True)

        def read():
            for line in self.reader.stdout:
                if MARK in line:
                    try:
                        self.pending.put(json.JSONDecoder().raw_decode(line.split(MARK, 1)[1])[0])
                    except ValueError:
                        self.pending.put({"event": "invalid-event"})
            self.pending.put({"event": "reader-stopped"})

        threading.Thread(target=read, daemon=True).start()
        self.adb("shell", "log", "-t", "OpenBotMorphE2E", shlex.quote(MARK + '{"event":"driver-ready"}'))
        self.wait(lambda: self.event("driver-ready"), "Log reader ready")

    def event(self, name, start=0):
        return next((e for e in reversed(self.events[start:]) if e["event"] == name), None)

    def wait(self, predicate, label):
        deadline = time.monotonic() + self.args.deadline
        while time.monotonic() < deadline:
            if predicate():
                return
            try:
                event = self.pending.get(timeout=min(0.2, max(0.001, deadline - time.monotonic())))
                self.events.append(event)
                if event["event"] == "reader-stopped":
                    raise RuntimeError("The log reader stopped.")
                if event["event"] == "invalid-event":
                    raise RuntimeError("The app sent an invalid test event.")
            except queue.Empty:
                pass
        raise AssertionError("No state or event: " + label)

    def tap(self, label):
        self.adb("shell", "uiautomator", "dump", "/sdcard/openbot-morph-e2e.xml")
        xml = self.adb("shell", "cat", "/sdcard/openbot-morph-e2e.xml")
        matches = [n for n in ET.fromstring(xml).iter("node")
                   if label in (n.get("text"), n.get("content-desc"))]
        if len(matches) != 1:
            raise AssertionError("Expected one accessible control: " + label)
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", matches[0].get("bounds", ""))
        if not bounds:
            raise AssertionError("The control has no bounds: " + label)
        x1, y1, x2, y2 = map(int, bounds.groups())
        self.adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))

    def run(self):
        self.start()
        for visit_info in (False, True):
            start = len(self.events)
            self.tap(self.args.agent_label)
            self.wait(lambda: self.event("chat-ready", start), "Chat open")
            chat = self.event("chat-ready", start)["route"]
            origin = self.event("home-avatar", start)
            assert origin, "The home avatar was not measured."
            if visit_info:
                info_start = len(self.events)
                self.tap(self.args.info_label)
                if self.args.menu_label:
                    self.tap(self.args.menu_label)
                self.wait(lambda: self.event("info-open", info_start) and
                          any(e["event"] == "native-stack" and "agent-info/" in e["top"]
                              for e in self.events[info_start:]), "Agent info open")
                info = next(e for e in reversed(self.events[info_start:])
                            if e["event"] == "native-stack" and "agent-info/" in e["top"])
                assert info["bottom"].startswith("connected"), "Agent info detached the home morph destination."
                back_start = len(self.events)
                self.adb("shell", "input", "keyevent", "4")
                self.wait(lambda: self.event("info-closed", back_start) and
                          any(e["event"] == "native-stack" and e["top"] == chat
                              for e in self.events[back_start:]), "Back in chat")
            close_start = len(self.events)
            self.tap(self.args.back_label)
            self.wait(lambda: self.event("morph-done", close_start) and self.event("morph-land", close_start),
                      "Morph close complete")
            assert self.event("morph-start", close_start)["route"] == chat
            assert self.event("morph-done", close_start)["route"] == chat
            options = [e for e in self.events[start:] if e["event"] == "chat-options" and e["route"] == chat]
            assert options and all(e["animation"] == "none" for e in options), "Chat used a native slide."
            land = self.event("morph-land", close_start)
            rect = origin["rect"]
            assert land["route"] == chat
            for value in (*rect.values(), land["x"], land["y"], land["scale"]):
                assert math.isfinite(value), "The morph contains a non-finite value."
            assert rect["width"] > 0 and rect["height"] > 0
            assert abs(land["x"] + land["width"] / 2 - rect["x"] - rect["width"] / 2) <= 1
            assert abs(land["y"] + land["height"] / 2 - rect["y"] - rect["height"] / 2) <= 1
            assert abs(land["scale"] * land["width"] - min(rect["width"], rect["height"]) * land["avatarScale"]) <= 1
            self.wait(lambda: any(e["event"] == "native-stack" and e["top"].startswith("connected")
                                  for e in self.events[close_start:]), "Home restored")

    def close(self):
        if self.reader:
            self.reader.terminate()
            try:
                self.reader.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.reader.kill()
                self.reader.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(
        description="Check direct close and Agent info return in the real Android app.",
        epilog="In an isolated CI checkout: install dependencies, run --prepare, build and install the test APK, "
        "then run --restore. Start with a signed-in test server, home visible, ColorOS ON, and reduced motion OFF. "
        "Run with --serial, --agent-label and --info-label. Use --menu-label for a native Agent info menu item. "
        "Use the same script on old and new source. Keep both report.json artifacts. No build runs in this script.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--prepare", action="store_true")
    mode.add_argument("--restore", action="store_true")
    parser.add_argument("--serial")
    parser.add_argument("--agent-label")
    parser.add_argument("--info-label")
    parser.add_argument("--menu-label")
    parser.add_argument("--back-label", default="Back")
    parser.add_argument("--deadline", type=float, default=30)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.prepare:
        prepare()
        return
    if args.restore:
        restore()
        return
    driver = Driver(args)
    report = {"status": "running", "checks": "Direct close; Agent info return; native home attachment; morph endpoint; no native chat slide"}
    try:
        if not all((args.serial, args.agent_label, args.info_label)):
            raise RuntimeError("Set --serial, --agent-label and --info-label.")
        report["source"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        driver.run()
        report["status"] = "pass"
    except (AssertionError, OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        report.update(status="fail", reason=str(error) or type(error).__name__)
    finally:
        driver.close()
        report["events"] = driver.events
        (OUT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": report["status"], "artifact": str(OUT / "report.json")}))
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
