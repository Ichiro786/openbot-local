# OpenBot Local — handoff (build #102, branch build11-4)

Written 2026-11-10 for the next agent (Codex). Read this before touching code.

## Where things stand
- Branch `build11-4`, commit `b08608612` = build #102 (base #101 `5824211d0`, #100 `d8cfe4bde`).
- Signed APK: android-local run 42780664463 (artifact `openbot-local-apk-103`; GitHub run number 103 = Syed's #102). Engine bundled: `engine-0.61.0-2`.
- e2e harness lives on branch `build11-2-ci` (`.github/e2e/`); emulator API 36 runs via that branch.
- main, tags, releases and `engine-latest` untouched. Do not touch them without Syed's explicit go-ahead.

## Bugs Syed saw on his phone with #101 (Realme RMX5011, Android 17, 120 Hz)
1. **Open lands on old messages (every agent chat).** Opening a chat rests ~2 s on an older reply (scroll-down arrow visible), then jumps to latest. Reopen repeats it; sometimes it jumps up again after reaching the bottom. Long markdown-heavy replies (bullet lists) make it worse.
   - #100: pin to end released on a fixed 600 ms timer.
   - #101: pin held until content still for 600 ms (4 s cap), started after catch-up + zoom settle. Failed on the phone.
   - #102: no timer. Chat stays pinned to latest from open until the reader drags, scrolls away (status-bar tap), opens at a search hit, or sends. While pinned: every content-size change scrolls to end; `atLatest` going false (UI-thread reaction) scrolls to end; composer height change scrolls to end next frame. File: `use-chat-motion.ts` (shared by agent/channel/task chats). **Unproven on phone.**
   - Suspected mechanisms: rows measured late (variable-height markdown), estimated item size, Legend List maintainVisibleContentPosition keeping a non-end position, the catch-up page replacing the list, and the zoom open rendering only latest rows first then inserting older rows in a background transition. Preferred direction: anchor newest-at-bottom by construction (Legend List alignItemsAtEnd/initialScrollAtEnd/maintainScrollAtEnd, or inverted list), not timers.
2. **Composer drawn mid-screen during the zoom open**, plus blank/half-empty frames. Not reproduced in the frames the #102 builder sampled; not changed.
3. **Keyboard + tall composer** (attachment chip + multiline text): list jumps between an older question card (Reply in the chat / Skip) and the latest "Waiting for your answer" row, blank band appears. These are the list's last rows; with the keyboard up the viewport is ~1 row. #102 only handles composer growth.
4. **Header see-through.** Message text (incl. a message's blue "Try now" button — NOT app UI, no such string in apps/mobile or i18n) scrolled under the header and read sharp next to Back, name pill and •••. #102: ColorOS GlassBand frost covers the full header row and fades over 24 dp below (`chat-header-coloros.tsx`, pill cut-out removed). This changes the 11.3 look Syed picked. Emulator screenshots confirm.

## Emulator evidence (API 36)
- #102 full run 42779996118: 59/59 real lanes OK (ColorOS ON L1–L18, OFF L2/L3/L9), 0 stuck Back, 0 crash, blur ≤2. Known FAILs: soft gate tap→settled 1.0–1.2 s (gate 700 ms), harness label "mode=gesture (want button)".
- Open-at-latest: #101 (run 42779975887) and #102 both open VEYR 16/16 and SHORTY 16/16 at latest. LORE lane is broken (its marker message never existed; local fix 5b169989f not pushed). **The emulator does not reproduce bug 1, even on #101.** Earlier #101 "old 0/24" claims were invalid (stand-in server lacked `state: "online"`).
- With `state: "online"` the stand-in server shows a fake queued-message strip above the composer in test chats; harness artefact, not app behaviour.

## Not done
- **Engine:** upstream newest v0.66.0 (tag ea60abe92, 2026-11-09). Our three 0.61.0 patches (branch `engine-patches-0.60`): DM channel context, WhatsApp mobile API, Antigravity warm sessions. All conflict on v0.66.0: channel-history.ts, channel-service.ts, packages/contracts team-protocol current.ts, Antigravity drain code. Rebase by hand; build via rootfs.yml with smoke_test on; never publish an engine whose smoke test fails; don't move `engine-latest` until the app works with it.
- **App upstream:** no shared git history with nightly-labs/openbot (syncs were patch imports). Last import d0a347b02. Since then to v0.66.0: 78 apps/mobile commits (315 files, ~+20k) and 188 packages commits (1152 files, ~+56k). Contracts changed, so engine and app must move together.

## Hard rules
- Never touch main, tags, releases; never force-push; never `git add -A`; never commit `apps/mobile/tsconfig.zz-touched.json`.
- Never `usePreventRemove` or route-removal holds on chat Back. Every input-blocking flag needs a guaranteed reset.
- Worklets: never call a helper declared later in the file (undefined under release Hermes → crash on first touch).
- Visual changes go behind the ColorOS toggle; OFF must match build #82. Max 2 blurs per screen. No RN Modal for frosted menus.
- Keep ours where it overlaps upstream and is better (frost, avatars, ColorOS toggle, zoom open, predictive Back, Back handling).
- A fix counts only if the bug reproduces on old code and not on new, repeated, including fast/repeated taps and taps mid-animation. Phone is the final judge.
