#!/usr/bin/env python3
"""Drive the synthetic real-chat harness. Save events, results and visual evidence."""
import argparse
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time
import xml.etree.ElementTree as ET


class BehaviorFailure(AssertionError):
    """The instrumented app did not satisfy the requested behavior."""


class WaitDeadline(AssertionError):
    """The requested event did not arrive before the deadline."""


class Driver:
    def __init__(self, out, deadline):
        self.out = out
        out.mkdir(parents=True, exist_ok=True)
        self.deadline = deadline
        self.pending = queue.Queue()
        self.events = []
        self.visit = None
        self.back = None
        self.host_timeout = False
        self.reader = None
        self.log = None
        self.report = {
            "hardware": "Android emulator; phone behavior is unverified",
            "completion": "events; deadlines fail only",
            "results": [],
            "diagnostics": [],
            "status": "running",
        }
        self.save_report()

    def save_report(self):
        temporary = self.out / "report.json.tmp"
        temporary.write_text(json.dumps(self.report, indent=2) + "\n", encoding="utf8")
        temporary.replace(self.out / "report.json")

    def diagnostic(self, operation, action, result=None):
        try:
            return action()
        except Exception as error:
            if isinstance(error, subprocess.TimeoutExpired):
                self.host_timeout = True
            target = self.report if result is None else result
            target.setdefault("diagnostics", []).append({"operation": operation, "reason": str(error)})
            if result is not None and result.get("status") == "pass":
                result.update(status="harness-error", reason=operation + ": " + str(error))
            return None

    def start(self):
        self.log = (self.out / "events.jsonl").open("w", encoding="utf8")
        self.reader = subprocess.Popen(
            ["adb", "logcat", "-v", "raw", "-s", "ReactNativeJS:I", "*:S"],
            stdout=subprocess.PIPE, text=True, encoding="utf8", errors="replace")
        threading.Thread(target=self.read_events, daemon=True).start()

    def stop_process(self, process):
        # Only signal the local child that this driver started.
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)

    def close(self):
        if self.reader is not None:
            self.diagnostic("stop logcat", lambda: self.stop_process(self.reader))
        if self.log is not None:
            self.diagnostic("close event log", self.log.close)

    def adb(self, *args, binary=False):
        try:
            return subprocess.check_output(["adb", *args], timeout=25, text=not binary)
        except subprocess.TimeoutExpired:
            # The remote operation can still run. Do not start another dump or recovery command.
            self.host_timeout = True
            raise

    def read_events(self):
        for line in self.reader.stdout:
            if "E2ELAYOUT " in line:
                try:
                    event = json.JSONDecoder().raw_decode(line.split("E2ELAYOUT ", 1)[1])[0]
                    self.pending.put(event)
                except (ValueError, IndexError):
                    self.pending.put({"event": "invalid-event"})

    def take(self, timeout=0):
        try:
            event = self.pending.get(timeout=timeout)
        except queue.Empty:
            return None
        self.log.write(json.dumps(event, separators=(",", ":")) + "\n")
        self.log.flush()
        if event.get("event") == "invalid-event":
            raise AssertionError("Invalid E2ELAYOUT JSON")
        if self.visit is None or event.get("visit") == self.visit:
            self.events.append(event)
        return event

    def wait(self, predicate, label, behavior=False):
        until = time.monotonic() + self.deadline
        while time.monotonic() < until:
            self.drain()
            if predicate():
                return
            self.take(min(0.15, max(0, until - time.monotonic())))
            if self.reader.poll() is not None:
                raise AssertionError("adb logcat stopped")
        observed = self.latest("view").get("ready") and self.latest("native-end")
        if behavior and observed:
            raise BehaviorFailure("Deadline: " + label)
        raise WaitDeadline("Deadline: " + label)

    def drain(self):
        while self.take() is not None:
            pass

    def fence(self):
        self.drain()
        return len(self.events)

    def nodes(self):
        self.adb("shell", "uiautomator", "dump", "/sdcard/e2e-layout.xml")
        return ET.fromstring(self.adb("shell", "cat", "/sdcard/e2e-layout.xml")).iter("node")

    def find(self, label=None, editor=False):
        for node in self.nodes():
            match = node.get("class") == "android.widget.EditText" if editor else (
                label == node.get("content-desc") or label in node.get("text", ""))
            if match:
                bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
                if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
                    return ((bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2)
        return None

    def node(self, label=None, editor=False):
        result = None
        def found():
            nonlocal result
            result = self.find(label, editor)
            return result is not None
        self.wait(found, "control " + str(label or "composer"))
        return result

    def tap(self, point):
        self.adb("shell", "input", "tap", *map(str, point))

    def shot(self, name):
        (self.out / (name + ".png")).write_bytes(self.adb("exec-out", "screencap", "-p", binary=True))

    def latest(self, kind):
        return next((e for e in reversed(self.events) if e["event"] == kind), {})

    def following(self, fence=0):
        # A resolved imperative scroll does not prove placement. Legend and the native
        # keyboard scroll view must independently report the end after real measurement.
        fresh = self.events[fence:]
        state = next((e for e in reversed(fresh) if "tailMeasured" in e), {})
        view = self.latest("view")
        rows = self.latest("row-window")
        native = self.latest("native-end")
        native_fresh = next((e for e in reversed(fresh) if e["event"] in ("native-end", "native-inset")), {})
        motion = self.latest("motion")
        return (view.get("ready") and not view.get("catchingUp") and view.get("historyVisible")
                and rows.get("allRows") and state.get("tailMeasured") and state.get("latestVisible")
                and state.get("count") == rows.get("count") and view.get("atLatest")
                and state.get("atEnd") and native.get("visible") and motion.get("revealed")
                and bool(native_fresh)
                and (not self.color_os or bool(self.latest("zoom-settled"))))

    def open(self, case, action=None):
        point = self.node("Layout " + case)
        self.drain()
        previous_visit = self.visit or 0
        self.events = []
        self.visit = None
        if action:
            x, y = point
            self.adb("shell", f"input tap {x} {y}; {action}")
        else:
            self.tap(point)
        self.wait(lambda: self.latest("open").get("name") == case
                  and self.latest("open").get("colorOS") == self.color_os
                  and self.latest("open").get("visit", 0) > previous_visit, "matching open event")
        self.visit = self.latest("open")["visit"]
        self.events = [event for event in self.events if event.get("visit") == self.visit]

    def close_chat(self):
        self.adb("shell", "input", "keyevent", "4")
        self.return_home()

    def return_home(self):
        try:
            self.node("E2E LAYOUT READY")
        except AssertionError:
            if self.find("Back"):
                raise BehaviorFailure("Back did not return to the controls") from None
            raise

    def behavior_failure(self, result, reason):
        self.behavior_failures.append(reason)
        result.update(status="behavior-failure", reason="; ".join(self.behavior_failures))
        self.save_report()

    def expect_following(self, result, label, fence=0, signal=None):
        def after_action():
            if signal is None:
                return self.following(fence)
            signal_index = next((index for index in range(fence, len(self.events)) if signal(self.events[index])), None)
            return signal_index is not None and self.following(fence)
        try:
            self.wait(after_action, label, behavior=True)
            return True
        except BehaviorFailure as error:
            self.behavior_failure(result, str(error))
        except WaitDeadline:
            if not self.latest("motion") or not self.latest("view") or not self.find(editor=True):
                raise
            fresh = self.events[fence:]
            proof = any(event["event"] in ("native-end", "native-inset") for event in fresh)
            if not proof:
                self.behavior_failure(result, label + ": unverified; no fresh native proof (effective inset may be unchanged)")
            else:
                self.behavior_failure(result, label + ": deadline with a usable composer and live telemetry")
        return False

    def cycle(self, case, name, visual, result):
        self.behavior_failures = []
        if case in ("fast", "back-opening", "mid-animation"):
            # These are input schedules, not layout-settled conditions. All are sent in
            # one adb shell so host round trips cannot move the taps after animation.
            if case == "back-opening":
                action = "sleep 0.04; input keyevent 4"
            else:
                # Header Back uses the same measured point from a completed chat.
                if self.back is None:
                    raise AssertionError("Header Back was not measured in an earlier open")
                x, y = self.back
                delay = "0.12" if case == "fast" else "0.25"
                action = f"sleep {delay}; input tap {x} {y}; sleep 0.04; input tap {x} {y}"
            self.open(case, action)
            self.return_home()
        else:
            self.open(case)
            try:
                self.wait(lambda: self.latest("motion").get("revealed"), "first visible rows")
            except WaitDeadline:
                if not self.find(editor=True):
                    raise AssertionError("Reveal deadline: no usable composer; app or harness is unavailable") from None
                if not self.latest("motion") or not self.latest("view"):
                    raise AssertionError("Reveal instrumentation is absent despite a usable composer") from None
                self.behavior_failure(result, "Reveal deadline with a usable composer")
            first = next((e for e in self.events if e["event"] == "motion" and e.get("revealed")), {})
            if first and not first.get("latestVisible"):
                self.behavior_failure(result, "First visible rows do not include the latest row")
            if visual:
                self.shot(name + ("-first" if first else "-unrevealed"))
            following = self.expect_following(result, "latest measured row and native end")
            if following and self.back is None:
                self.back = self.node("Back")
            if case == "tall":
                self.wait(lambda: bool(self.find("e2e-layout.txt")), "synthetic attachment loaded")
                editor = self.node(editor=True)
                previous = self.fence()
                self.tap(editor)
                shown = lambda event: event["event"] == "keyboard" and event.get("phase") == "onEnd" and event.get("height", 0) > 0
                self.wait(lambda: any(shown(event) for event in self.events[previous:]), "keyboard show")
                self.expect_following(result, "tall composer follows end", previous, shown)
                if visual:
                    self.shot(name + "-keyboard")
                previous = self.fence()
                old_height = self.latest("composer").get("height")
                if not old_height:
                    raise AssertionError("Composer size is absent before shrink")
                shrank = lambda event: event["event"] == "composer" and event.get("height", old_height) < old_height
                self.adb("shell", "input keycombination 113 29; input keyevent 67")
                self.wait(lambda: any(shrank(event) for event in self.events[previous:]), "composer shrink")
                self.expect_following(result, "short composer follows end", previous, shrank)
                previous = self.fence()
                self.adb("shell", "input", "keyevent", "111")
                self.wait(lambda: any(e["event"] == "keyboard" and e.get("phase") == "onEnd"
                                     and e.get("height") == 0 for e in self.events[previous:]), "keyboard hide")
                self.expect_following(result, "keyboard hidden follows end", previous,
                                      lambda event: event["event"] == "keyboard" and event.get("phase") == "onEnd" and event.get("height") == 0)
                self.tap(self.node("e2e-layout.txt"))
                self.tap(self.node("Remove"))
                self.node(editor=True)
            if visual:
                self.shot(name + "-end")
            self.close_chat()
        if self.behavior_failures:
            raise BehaviorFailure("; ".join(self.behavior_failures))

    def stop_incomplete(self, reason):
        self.report["incompleteReason"] = reason
        self.save_report()
        print("Stop: " + reason, flush=True)
        return 1

    def recover(self):
        for _ in range(3):
            if self.find("E2E LAYOUT READY"):
                return True
            self.adb("shell", "input", "keyevent", "4")
        return self.find("E2E LAYOUT READY") is not None

    def run(self, cycles, cases):
        results = self.report["results"]
        self.report["requested"] = {"cycles": cycles, "cases": cases, "colorOS": ["ON", "OFF"]}
        self.save_report()
        started = time.monotonic()
        previous_failure = None
        consecutive_failures = 0
        self.tap(self.node("E2E Layout"))
        for state in ("ON", "OFF"):
            if self.find("E2E LAYOUT READY colorOS=" + state) is None:
                self.tap(self.node("Layout toggle"))
                self.node("E2E LAYOUT READY colorOS=" + state)
            self.color_os = state == "ON"
            self.back = None
            for case in cases:
                for index in range(cycles):
                    if time.monotonic() - started >= 3300:
                        return self.stop_incomplete("55 minute driver budget reached; remaining cycles are unverified")
                    name = f"{state}-{case}-{index + 1:02}"
                    result = {"case": case, "colorOS": state, "cycle": index + 1, "status": "running"}
                    results.append(result)
                    self.save_report()
                    recording = None
                    recording_pid = None
                    recording_path = "/sdcard/e2e-layout-" + name + ".mp4"
                    try:
                        if index == 0:
                            recording = subprocess.Popen(
                                ["adb", "shell", "echo $$; exec screenrecord --time-limit 30 " + recording_path],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
                            process_id = queue.Queue()
                            threading.Thread(target=lambda: process_id.put(recording.stdout.readline()), daemon=True).start()
                            try:
                                recording_pid = process_id.get(timeout=5).strip()
                            except queue.Empty:
                                self.host_timeout = True
                                raise WaitDeadline("screenrecord process ID") from None
                            if not recording_pid.isdigit():
                                raise AssertionError("screenrecord process ID is absent")
                        self.cycle(case, name, index == 0, result)
                        result["status"] = "pass"
                    except (AssertionError, subprocess.SubprocessError, ET.ParseError, OSError) as error:
                        if result["status"] != "behavior-failure":
                            kind = "behavior-failure" if isinstance(error, BehaviorFailure) else "harness-error"
                            result.update(status=kind, reason=str(error))
                        elif not isinstance(error, BehaviorFailure) or str(error) != result["reason"]:
                            result.setdefault("diagnostics", []).append({"operation": "cycle continuation", "reason": str(error)})
                    finally:
                        if result["status"] == "running":
                            result.update(status="interrupted", reason="The cycle stopped before a result")
                        self.diagnostic("drain cycle events", self.drain, result)
                        result["events"] = len(self.events)
                        result["visit"] = self.visit
                        result["firstVisible"] = next((e for e in self.events if e["event"] == "motion" and e.get("revealed")), None)
                        result["lastState"] = next((e for e in reversed(self.events) if "tailMeasured" in e), None)
                        result["durationZeroKeyboardEvents"] = sum(e["event"] == "keyboard" and e.get("duration") == 0 for e in self.events)
                        result["scrolledUpObserved"] = any(e.get("scrolledUp") is True for e in self.events)
                        # Save the first error before a screenshot or recorder cleanup can fail.
                        self.save_report()
                        if result["status"] != "pass" and not self.host_timeout:
                            self.diagnostic("failure screenshot", lambda: self.shot(name + "-failure"), result)
                        if recording is not None:
                            if recording_pid and recording_pid.isdigit() and recording.poll() is None and not self.host_timeout:
                                self.diagnostic("stop owned screenrecord", lambda: self.adb("shell", "kill", "-2", recording_pid), result)
                            self.diagnostic("wait for screenrecord", lambda: recording.wait(timeout=5), result)
                            self.diagnostic("stop screenrecord adb", lambda: self.stop_process(recording), result)
                            if not self.host_timeout and recording_pid and recording_pid.isdigit():
                                self.diagnostic("pull screenrecord", lambda: self.adb("pull", recording_path, str(self.out / (name + ".mp4"))), result)
                        self.save_report()
                        print(json.dumps(result), flush=True)
                    if self.host_timeout:
                        return self.stop_incomplete("A host command timed out; remote operation cleanup is unverified")
                    if result["status"] != "pass":
                        failure = (result["status"], result.get("reason"))
                        consecutive_failures = consecutive_failures + 1 if failure == previous_failure else 1
                        previous_failure = failure
                        if consecutive_failures >= 2:
                            return self.stop_incomplete("The same failure occurred twice in a row; remaining cycles are unverified")
                        recovered = self.diagnostic("return to layout controls", self.recover, result)
                        self.save_report()
                        if not recovered:
                            return self.stop_incomplete("Recovery did not confirm the controls; remaining cycles are unverified")
                    else:
                        previous_failure = None
                        consecutive_failures = 0
        self.report["completed"] = True
        self.save_report()
        return 1 if any(r["status"] != "pass" for r in results) else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(os.environ.get("OUT", ".openbot-build/mobile-chat-layout")))
    parser.add_argument("--cycles", type=int, default=20)
    parser.add_argument("--deadline", type=float, default=10)
    parser.add_argument("--cases", nargs="+", default=["short-fresh", "short-warm", "long-fresh", "long-warm",
                                                        "overlap", "disconnected", "tall", "fast", "back-opening", "mid-animation"])
    args = parser.parse_args()
    if args.cycles < 20:
        parser.error("At least 20 cycles are required")
    driver = Driver(args.out, args.deadline)
    exit_code = 1
    try:
        driver.start()
        exit_code = driver.run(args.cycles, args.cases)
    except BaseException as error:
        driver.report["incompleteReason"] = "Driver setup or execution stopped: " + type(error).__name__ + ": " + str(error)
        driver.report["diagnostics"].append({"operation": "driver", "reason": repr(error)})
    finally:
        try:
            driver.close()
        finally:
            if driver.report["diagnostics"] or driver.report.get("incompleteReason"):
                exit_code = 1
            driver.report["status"] = "complete" if exit_code == 0 else "failed"
            driver.save_report()
    return 2 if driver.host_timeout else exit_code


if __name__ == "__main__":
    raise SystemExit(main())
