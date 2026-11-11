# Phase 1 chat layout plan — build11-5

**Goal:** Open each chat at its newest messages. Keep the composer and list stable during zoom and keyboard changes. Keep content behind the ColorOS header unreadable.

**Base:** `b6575424bb317bc1f8d6ebddd4350b3649d7d7c4` from `build11-4`.

**Scope at first approval:** Phase 1 only. Mobile agent, channel and task chats share the affected code. The Android CI harness also needs changes. No engine, protocol, database, desktop, web or Signal change is planned.

**Method:** Brainstorm, plan, E2E failure, small fix, E2E pass, review. Reuse Legend List 3.6.0 and the current motion code. Add no dependency.

## Evidence and limits

I read HANDOFF.md, the root and mobile rules, mobile DESIGN.md, and reference/CHAT-LOADING-BUG.md. I inspected all three videos as local frame sequences. I inspected zoom at 60 frames per second and a keyboard transition at 30 frames per second. These samples cannot prove zero dropped frames at 120 Hz. The private files and extracted frames stay local and out of commits and CI uploads.

The reference note identifies the recordings as build #102. Thus HANDOFF.md's description of the phone reports as #101 is not sufficient to clear #102.

Three agents audited list/data flow, motion/header/keyboard, and CI. I checked their reports against the source and harness. Their reports support the code facts below. No new app run has confirmed a complete root cause. No app code has changed. Installed-source review confirms that opening scroll repairs cancel native bootstrap, and that the sent-message spacer creates a separate bottom-inset floor.

## Findings and proposed changes

| Bug | Confirmed facts and root-cause status | Proposed fix and proof required |
| --- | --- | --- |
| 1. Old messages at open, then jumps | Cached history is marked ready before catch-up completes (`agent-chat-view.tsx:142,262`). A disconnected latest page replaces row keys (`conversation-store.ts:186`). Zoom changes six opening rows to the full loaded window (`chat-message-list.tsx:1391`). Motion ignores `catchingUp` (`use-chat-motion.ts:73`). Any offset drop over 24 dp permanently sets `scrolledUp`, including a possible measurement or inset correction (`:507`). This stops three #102 imperative pin repairs, while native following can remain enabled. These are confirmed code paths. Their event order on the phone is unconfirmed. | Give native list anchoring one clear owner. Keep the newest row as the opening anchor across measurement, prepend and catch-up. Distinguish reader scroll from list geometry changes. Preserve search and sent-message anchors. Remove duplicate opening scroll commands after native following passes the E2E cases. First reproduce the jump on the old code and record the event that releases or displaces the anchor. |
| 2. Composer in the middle; blank zoom frames | The composer mounts before list readiness and sits inside the whole-screen scale/translation (`chat-view.tsx:1161`; `LiveZoomScreen.tsx:321`). Rows can remain hidden until measured, while first placement accepts only the last row size or a deadline (`use-chat-motion.ts:353`; `chat-message-list.tsx:1774`). The sampled first zoom shows a composer near the moving screen's bottom. It does not confirm the severe middle-screen case. | Trace the list reveal, visible rows, zoom and composer together. Keep the composer at the physical bottom throughout opening. If the zoom transform causes the defect, separate its opening transform from the composer, within the existing route and motion ownership. Preserve the close and predictive Back paths. If reveal/measurement causes the blank frames, fix that readiness boundary. Do not change both paths without separate evidence. |
| 3. Keyboard plus tall composer jumps; blank band | Video frames show the waiting row staying near the header while a large empty band opens below it. The composer uses custom keyboard values, including ColorOS fallback animation; the keyboard-aware list handles keyboard events separately (`use-chat-motion.ts:83–256`; `chat-message-list.tsx:1782`). Composer clearance, native end following, visible-row preservation, trailing anchor space and imperative scrolls act together. The offset-drop latch can stop the pin repairs. The exact cause of the recorded band remains unconfirmed. | Use one keyboard/end-position owner. Feed composer clearance through the supported Legend inset path. Keep reader-selected positions stable. Remove overlapping correction paths only after a trace confirms the conflict. Reproduce the attachment, five-line draft and unresolved question together. Test keyboard show/hide, text growth/shrink and attachment add/remove. Do not add a settling timer or reduce composer features to hide the defect. |
| 4. Sharp text behind header controls | The #102 band already covers the header row and fades 24 dp below it. Band zIndex 19 sits below controls at 20 (`chat-header-coloros.tsx:167,312`). The blur is paused during opening and some menus; the remaining dim and button fills are translucent. Thus that path cannot hide sharp text. The videos also show settled sharp text. Its capture failure is unconfirmed. | Keep the selected band geometry and control order. Use sufficient fallback coverage while the blur is unavailable. Check blur-target readiness and mount order. Compare the patched `blurRegion` capture with stock capture using the same mask and tint. Change capture only if this comparison proves the fault. Preserve one header blur and one composer blur. |

All mobile paths above are under `apps/mobile/src/features/`. The conversation store is under `workspace/model/`; chat files are under `chat/components/`. Shared motion and glass files are under `apps/mobile/src/shared/`.

## Approach choice

1. **Preferred: keep the forward Legend list.** It already has `initialScrollAtEnd`, `maintainScrollAtEnd`, visible-position preservation and `anchoredEndSpace`. Adding those props again cannot fix this. Read the exact installed 3.6.0 source before changing their interaction. Use `alignItemsAtEnd` for short histories only if it preserves the sent-message policy and OFF appearance.
2. **If the changing opening window is the cause:** pass all loaded row keys from the first list mount. Keep costly media and actions deferred. Check the zoom cost before accepting this change.
3. **Inverted list:** consider only if the installed native API cannot keep the required anchor. It adds risk to search, older pages, keyboard behavior and accessibility order.

Legend's current v3 docs confirm that end following is proximity-based and that `alignItemsAtEnd` adds top space for short content. They do not prove the exact installed behavior: [Legend v3 API](https://legendapp.com/open-source/list/v3/api/).

Expo SDK 58 documents a blur update issue when blur renders before dynamic content. This supports a capture-order test, not a confirmed diagnosis: [Expo SDK 58 BlurView](https://docs.expo.dev/versions/v58.0.0/sdk/blur-view/).

## Execution checklist

### Task 1: Establish the baseline before fixes

- [x] Show this plan to the user before app or harness code changes. Approved in chat.
- [x] Run `bun install --frozen-lockfile` with Bun 1.4.2 from `.openbot-build/toolchain/bun`. Install passed. The lockfile is unchanged.
- [x] Read installed Legend 3.6.0 and keyboard-controller 1.22.7 source. Check real end-state, inset, measured-size and keyboard behavior. Read the local native patches.
- [x] Add a focused E2E driver under `scripts/` on `build11-2-ci`. Extend its existing real-chat fixtures and harness instrumentation. Use synthetic chats only. Keep `state: "online"`.
- [x] Record JSON events for catch-up, row-window change, native readiness/end state, offset, content size, viewport, composer, keyboard, reveal and zoom. Record no message text or private data. Put reports under `.openbot-build/` locally and the existing E2E output folder in CI.
- [x] Use events for completion. A deadline may fail a test; it must not declare layout settled. Keep visual details in screenshots/video for human review. Add no unit test, snapshot assertion, markup assertion or data-testid.
- [x] Set `.github/e2e/target-ref` to the full baseline SHA. Use a normal descendant commit and push to `build11-2-ci`; its workflow has no dispatch trigger. Do all checkout work in this dedicated worktree. Do not create another worktree.
- [ ] Run short/long Markdown histories, fresh/warm opens, overlapping/disconnected catch-up and repeated reopens. Check the first visible rows, not only the existing 2.6 s and 4.1 s samples.
- [ ] Repeat fast taps, Back during opening and taps mid-animation. Include the tall-composer/question case. Use at least 20 cycles per affected case and toggle state.
- [ ] Write the confirmed event sequence for each reproduced bug before its fix. If a phone-only case still does not reproduce, report that limit. Do not mark it fixed.

### Task 2: Apply and verify each confirmed fix

- [ ] Modify only the files required by the confirmed cause. Expected files: `use-chat-motion.ts`, `chat-message-list.tsx`, `chat-view.tsx` and `chat-header-coloros.tsx`. Change `LiveZoomScreen.tsx`, `chat-composer.tsx` or `shared/glass/GlassBand.tsx` only if their traces require it.
- [ ] Run the same E2E case after each change. Require an old-code failure and repeated new-code passes under the same fixture and harness.
- [ ] Check agent, channel and task consumers. Check search placement/return to latest, send/cancel/error, older pagination, user drag/return and accessibility scrolling.
- [ ] Check ColorOS ON/OFF, light/dark, reduced motion and live toggle changes. Identify the build #82 comparison before certifying OFF visual parity. That comparison is not yet established.
- [ ] Keep visual changes behind ColorOS. Add no route-removal hold, usePreventRemove, RN Modal frost or third blur. Keep worklet helpers before all worklets that call them. Every new input-blocking flag, if required, needs bounded recovery and cancel/error/blur/unmount resets.

### Task 3: Focused checks and review

- [ ] Run `bun run test:changed` with its existing one-worker selection. Report no related tests if the selection is empty; do not replace E2E proof with that result.
- [ ] Run Biome only on changed files. Run each check separately. Do not run whole-repository lint, format, full tests, aggregate typecheck, local builds or full mobile typecheck.
- [ ] Use a narrow typecheck only if the repository already supports the affected scope. The pre-commit hook and CI own full mobile type validation. Never commit `apps/mobile/tsconfig.zz-touched.json` and never bypass the hook.
- [ ] Review the diff with Superpowers review and Ponytail review. Check evidence, cancellation, Back recovery, helper order, blur count and shared consumers. Add no unrelated cleanup.
- [ ] Stage explicit paths only. Exclude reference/, extracted frames and TASKS.md. Commit on build11-5. Push normally. Open no PR.

### Task 4: CI and signed APK

- [ ] Run the same API 36 harness on the candidate SHA. Retain all requested Back, zoom, predictive Back, stuck-Back and regression checks. Report that current QUICK113 selects 59 cases, not every L1–L18 lane.
- [ ] Keep the known LORE, 700 ms soft timing and navigation-mode label failures separate. Do not repair them in this task. Stop after any same unexpected failure occurs twice; report the evidence.
- [ ] Verify the E2E APK uses release Hermes from its build output or libraries. It is x86_64; the phone APK is arm64-v8a. Do not claim these platforms are identical.
- [ ] Run the existing signed APK workflow with the engine pinned to the current version:

```bash
gh workflow run android-local.yml --repo Ichiro786/openbot-local --ref build11-5 -f engine_tag=engine-0.61.0-2 -f skip_payload=false -f clear_cache=false
```

- [ ] Keep signing unchanged. Do not run apk-release.yml. Touch no main, tag, release or engine-latest ref.
- [ ] Confirm workflow success and actual artifact contents. Report the app commit, harness commit, CI links, artifact name and engine tag. Artifact pattern: `openbot-local-apk-<run_number>`. Do not invent a run number.
- [ ] Give a separate phone test list for Android 17/ColorOS IME, arm64 release Hermes, native blur and 120 Hz frame pacing. An API 36 pass cannot prove zero stutter on the Realme RMX5011.
- [x] The user approved engine and app updates on 2026-11-11. The scope below replaces the Phase 1 stop.

## Completion rule

A downloaded APK is not proof of a fix. A baseline that never fails cannot establish a new-code fix. If the emulator still cannot reproduce a case, label that case unproven and state what the phone must test. No build or fix is complete at the time this plan is written.

## Installed-source findings before baseline

- Legend 3.6.0 public scrollToEnd queues work, then immediately calls supersedeInitialScroll (`react-native.js:7203`). Native onReady can fire before that queued command runs. A later command resolves an earlier scroll promise. Thus the opening repair and its promise callback can bypass native placement.
- sizeAtIndex reads known measured sizes. One known last row does not establish every tail row.
- The keyboard adapter passes anchoredEndSpace as blankSpace. Its effective bottom inset is max(blankSpace, keyboard + composer), clamped to one viewport. This can leave a blank band when sent-message space is enabled on ordinary opening. Composer clearance is not added twice.
- The adapter already corrects scroll on composer-size changes. The app adds another JS correction.
- A real native IME resize emits a duration-zero event burst. The list applies its destination padding at once; the custom ColorOS composer can animate for 240 ms. Trace this case before changing keyboard timing.
- Region blur coordinates look correct at settled scale. The decor background normally supplies an opaque canvas. Neither a native coordinate fault nor transparent capture is confirmed. Keep them as A/B hypotheses.
- APK workflow run82 uses258c6db; run83 usesc18bf2282. The user's build numbering may differ from workflow numbering. Both source references must be checked before a strict build82 OFF claim.

## Scope update — approved 2026-11-11

The user asked to fix the issues and build a test APK with the latest engine and app. This approves Phase 2 now. Keep all other hard rules. Use Superpowers and Ponytail.

Pinned upstream release: v0.67.1, commit `1cfcc5694e369b7b3892698166050dc8505104b9`. Published 2026-11-10. Mobile version: 1.4.9. Import base: `d0a347b02c4a2636fff19b4c2e74308aa4c09f69`. Use the stable release, not later main. Old engine patch base: v0.61.0, `73604bc1f48328aa4935cbd23dbbeaee7910b8d1`. Its packaged database schema is55. The old local backend checkout ends48, but that checkout was not the packaged source.

Root reviewed two independent audits. The engine patch source is `origin/engine-0.61`, not the old branch named in HANDOFF.md. The engine bundler there swaps main, preload and renderer together. It checks that external packages exist in the released AppImage. The current branch has only the older0.59 patch and older bundler.

The saved baseline run42888189190 completed. It recorded80 opens in ColorOS ON. Short warm had3 end-check failures; long fresh had1. All40 fresh opens set scrolledUp without a user drag. The long failure ended with atEnd=false after changing from6 to140 rows. Thus a geometry change can release the app's opening repairs. A UIAutomator timeout stopped the new driver before stress, tall, fast and OFF cases. The old59 Back lanes passed. LORE marker failures remain known. These results do not prove a complete phone root cause.

### Task 5: Rebase the engine patches

**Files:** `engine/patches/0.67.1/*.patch`, `engine/patches/0.67.1/UPSTREAM_REF`, `engine/patch-engine-main.sh`, and the two existing hybrid bootstrap fixes under `engine/agy-hybrid/`.

**Interfaces:** Input is the exact upstream release and the three patches from `origin/engine-0.61:engine/patches/0.61.0/`. Output is an ordered patch set that applies to the exact source pin. Root owns all checks, commits and workflows.

- [ ] Keep DM channel context, the optional WhatsApp mobile API, and Antigravity warm sessions.
- [ ] Preserve upstream channel memory deltas, isolated channels, capabilities, route authorization and new timing hooks.
- [ ] Keep frozen Team APIv1–v9 wire meaning. Keep the optional WhatsApp alias.
- [ ] Add a narrow legacy-hybrid adapter. The saved hybrid has no native1.5 CLI shape. Preserve true version detection, old arguments/environment/account folders, old zed client identity and serving sign-in suppression. Native1.5 paths must keep upstream behavior. Do not report a false version.
- [ ] Carry the protobuf FieldDescriptor.label and saved-bootstrap refresh fixes from the0.61 branch.
- [ ] Keep new patch helpers before every worklet caller. No app source is owned by this task. Do not create another checkout or worktree.
- [ ] Root checks patch application in memory against the pin. Root reviews each rebased patch before CI. No local engine build.

### Task 6: Build and use an engine artifact safely

**Files:** `.github/workflows/rootfs.yml`, `.github/workflows/android-local.yml`, `engine/patch-engine-main.sh`, `engine/README.md`, and `apps/mobile/modules/openbot-engine/scripts/stage-engine-payload.sh` if needed.

- [ ] Use artifact-only rootfs operation with contents:read. Remove release and pointer writes from this test-branch workflow. Require both chroot and PRoot smoke tests to pass before uploading a usable payload. Save failed smoke diagnostics separately.
- [ ] In patched upstream CI, run these protected fixtures with one worker: openbot-database-schema-parity, browser-proxy-migration, routine-run-place-migration, agent-skill-loads-migration, messaging-pings-migration, agent-memory-site-migration. Save reports. These cover row preservation, late failure, rollback, retry, foreign keys and integrity for55→60.
- [ ] Add disposable old-data engine smoke for chats, files and provider state. Do not use any real profile or credential.
- [ ] Add an android-local engine_run_id input. Verify successful rootfs run provenance, version/source manifest and SHA-256 before staging its named artifact. Keep signing unchanged. No tag or release writes.
- [ ] Keep installed engine rollback claims accurate. Moving /root to old binaries cannot undo a committed SQLite migration. Keep the newer-database guard.

### Task 7: Merge the app from the same upstream pin

**Files:** Mobile and required shared workspaces: brand, contracts, i18n, logging, team-client, telemetry, user-errors. Native patch files and required desktop consumers of changed contracts are included.

- [ ] Use complete git-tree diffs, not the truncated GitHub compare response. Merge in small reviewed groups from the exact import base. Preserve all local-only files.
- [ ] First import bounded workspace reads, catch-up arrival suppression and startup gate removal. Keep local zoom, repeat-tap handling, prefetch and Back recovery.
- [ ] Keep installed Expo/RN versions. Merge native fixes for Reanimated4.7.1, Worklets0.13.0, keyboard-controller1.22.7, reserved-regions0.2.0, screens4.30.0 and widgets58.0.22. Keep the local expo-blur patch, buildFromSource setting and four ColorOS screen animation resources.
- [ ] Merge shared contracts in groups with real desktop consumers. New endpoint groups and changed voice/search/routine/appearance contracts must have real owners. No placeholder endpoint, type assertion bypass or disabled check.
- [ ] Merge mobile source with the fork's frost, avatars, ColorOS toggle, zoom and predictive Back intact. Upstream use-chat-motion is unchanged from the import base; keep ours and fix the confirmed local cause.
- [ ] Keep run.openbot.local, openbotlocal, local groups and native plugins. Keep upstream OTA updates disabled. Do not copy upstream OTA URL or certificate into the fork. No new self-update service is planned.
- [ ] Add only mobile-required new dependencies through the matching Expo58 install path. Expected additions: expo-network, react-native-webrtc and its config plugin.
- [ ] Use the release-upgrade-safety skill before changing app versions. Audit committed data/wire changes. Leave private reference files out of git.
- [ ] Repair the test driver timeout/report path. Reuse the baseline APK when only the host-side driver changes. Run the missing old-code cases before their fixes. Run the same driver against the updated candidate.
- [ ] Apply the original four chat fixes only with cause and old/new evidence. Keep phone-only limits explicit. Use narrow checks and enabled commit hooks.
- [ ] Build the signed arm64 APK through android-local with the exact successful engine artifact. Report source commits, run links, artifact and device proof limits. No PR, main change, tag, release or engine-latest change.
