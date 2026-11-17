# Build 17 continuation

Base: `build17`, `0a0cd5f5747734ed50767fcd397ca85413499e6b`.

## Build blocker

The original APK job [44145986254](https://github.com/Ichiro786/openbot-local/actions/runs/44145986254) failed at `:openbot-engine:compileReleaseKotlin`. `PowerGovernor.kt` passed the nullable thermal listener to two APIs that require a non-null listener. The continuation captures it through a non-null `let` parameter for registration and removal. Compilation has not been rerun.

## Changes and limits

| Area | Source change | Verification still needed |
| --- | --- | --- |
| Old dialogs | 126 application alert calls in 79 files use one Android adapter. ColorOS uses the existing frost target; OFF uses Compose Material 3. Queue and callbacks retain their meanings. iOS/system prompts stay native. | Native display over sheets, Back, large text, keyboard, TalkBack, light/dark, blur count |
| Send gap | ColorOS removes the last-user spacer and follows the actual list end after measured layout and keyboard settle. Reader drag cancels it. | First/repeated send, send while reading older rows, keyboard open/closed, navigation during send |
| Streaming | Revisions coalesce per frame; new/final rows flush immediately. Disabled mode does not update the coalescing state. | Long markdown, final/error/stop, reduced motion, ColorOS OFF |
| Marketplace avatar | Generated face stays until the current URI displays and remains on image failure. | Import root cause is unconfirmed; test a fresh marketplace import and collect a redacted support log if it still fails |
| Header clipping | Marked ColorOS native header roots can draw through the header subview, toolbar and app bar. Unmarked headers restore the original clip flags. | New APK, every native header, repeated drag/toggle, screenshot comparison; the custom chat header has no confirmed clipping boundary |

Android bubble spring resizing and per-word fading were not re-enabled. The current code records previous paragraph flicker and lag with those paths. The change improves stream scheduling without claiming those visual effects are complete.

The header patch uses React Native 0.88.0's `view_tag_native_id` tag, confirmed in its `BaseViewManager.java`. The patch applies to exact react-native-screens 4.30.0 source. Only native compilation and phone checks can establish that the drawing change fixes the observed clipping.

## Checks completed

- `node scripts/mobile-dialog-service-smoke.ts`: seven service scenarios passed. Report: `.openbot-build/mobile-dialog-service-smoke.json`. This does not exercise native UI.
- Node's TypeScript stripper and module parser accepted the changed `.ts` service, adapter, chat hook and smoke files. This does not validate types or TSX.
- `git diff --check`: passed.
- Header patch application check against exact upstream source: passed.

`bun install --frozen-lockfile` could not run because Bun is absent. Project dependencies are not installed. Biome, mobile type validation, native compilation, app E2E, and device/heat measurements have not run. Broad checks were not started.

## Next steps

1. Run the narrow source checks in an environment with the pinned dependencies.
2. With an explicit build request, build this continuation branch with the existing Android APK workflow and the intended engine tag. The native changes need a new APK/runtime and cannot be an OTA update to an older binary.
3. Run the existing app E2E harness and the phone checks above. Test rapid repeated actions and actions during transitions.
4. Compare the 30-minute idle/heat result against 16.1 on the same phone and conditions. Do not report the old handoff measurements as new verification.
5. Resolve remaining avatar/chat-header evidence and review the requested spring/fade motion before calling all five UI requests complete.
6. After APK verification, prepare the full release changelog and README with current screenshots. Publishing a release or changing main/tags requires the user's explicit request from the earlier handoff.
