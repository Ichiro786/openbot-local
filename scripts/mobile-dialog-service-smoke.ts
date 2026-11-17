import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AppDialogController } from "../apps/mobile/src/shared/lib/app-dialog-state.ts";

const service = new AppDialogController();
const events: string[] = [];
const checks: string[] = [];
assert.equal(service.show({ title: "Before mount", buttons: [] }), false);
checks.push("No host falls back to native");
const unmount = service.mount();
service.show({
  title: "Delete confirmation",
  buttons: [
    { text: "Cancel", style: "cancel", onPress: () => events.push("cancel") },
    { text: "Delete", style: "destructive", onPress: () => events.push("delete") },
  ],
});
const first = service.getSnapshot();
assert.ok(first);
service.show({
  title: "Queued failure",
  buttons: [{ text: "Close" }],
  options: { cancelable: true, onDismiss: () => events.push("dismiss") },
});
assert.equal(service.getSnapshot()?.key, first.key);
assert.equal(service.settle(first.key, null), false);
assert.equal(service.settle(first.key, 99), false);
assert.deepEqual(events, []);
checks.push("Queued alerts preserve the pending decision; noncancelable Back does not act");
service.setFrosted(first.key, true);
assert.equal(service.getFrosted(), true);
assert.equal(service.settle(first.key, 1), true);
assert.equal(service.settle(first.key, 1), false);
assert.deepEqual(events, ["delete"]);
assert.equal(service.getFrosted(), false);
checks.push("Destructive choice acts once; repeated taps and stale callbacks do not act");
const second = service.getSnapshot();
assert.ok(second);
assert.equal(service.settle(first.key, 0), false);
assert.equal(service.settle(second.key, null), true);
assert.deepEqual(events, ["delete", "dismiss"]);
assert.equal(service.getSnapshot(), null);
checks.push("Outside dismissal calls onDismiss, never a button action");
service.show({
  title: "Cancel confirmation",
  buttons: [{ text: "Cancel", style: "cancel", onPress: () => events.push("cancel") }],
  options: { onDismiss: () => events.push("wrong-dismiss") },
});
const cancel = service.getSnapshot();
assert.ok(cancel);
service.settle(cancel.key, 0);
assert.deepEqual(events, ["delete", "dismiss", "cancel"]);
checks.push("Cancel button and outside dismissal retain separate callbacks");
service.show({
  title: "Follow-up",
  buttons: [{ text: "Next", onPress: () => void service.show({ title: "Next decision", buttons: [] }) }],
});
const follow = service.getSnapshot();
assert.ok(follow);
service.settle(follow.key, 0);
assert.equal(service.getSnapshot()?.title, "Next decision");
checks.push("A callback can open another dialog after its own request is removed");
unmount();
assert.equal(service.getSnapshot(), null);
assert.equal(service.settle(follow.key, 0), false);
assert.equal(service.show({ title: "After unmount", buttons: [] }), false);
checks.push("Root teardown clears requests and prevents stale actions");

const report = fileURLToPath(new URL("../.openbot-build/mobile-dialog-service-smoke.json", import.meta.url));
await mkdir(fileURLToPath(new URL("../.openbot-build/", import.meta.url)), { recursive: true });
await writeFile(report, `${JSON.stringify({ passed: checks.length, checks, events, scope: "Dialog service only; no native UI" }, null, 2)}\n`);
// Machine-readable: the smoke check artifact is the result.
process.stdout.write(`${JSON.stringify({ passed: checks.length, report })}\n`);
