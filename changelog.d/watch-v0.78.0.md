### Changed

- Engine: rebase the six local patches onto upstream 0.78.0. No new protocol-9 capability: the baseline stays exactly 256 and the full list is 303, so the 256 wire limit holds. The WhatsApp alias stays out of the capability lists (PR #19).
- App: import upstream mobile changes v0.77.0..v0.78.0 (437 files) into apps/mobile + packages. The fork's look is unchanged: ColorOS toggle and frost, zoom open, predictive Back, avatars, and the land-on-blob close morph stay. Home rows are shorter with larger avatars (upstream): row avatars are 60 dp and pinned avatars are 70 dp, and the morph measures the real rect, so it lands on the blob. With ColorOS on, a channel still opens at the latest message (build 16). Server settings keep the Local Engine section.
- Upstream removes the pin transition (agent-pin-transition, toggleAgentPinAnimated). The fork's AgentPinAvatar is now a sized view that registers the avatar rect for the morph; row avatars register the same way. Pin and unpin now use upstream's new motion (agent-pin-motion).
- versionName 1.4.14 (upstream) / versionCode 10433.

### Added

- Hide a server from the server list (per account, also on desktop and web).
- One-time routines on the phone.
- "Use the full-screen camera" switch in Settings > Conversations, with a one-time tip in the small camera.
- Voice in channels on the desktop.
- Server logo page: add, change or remove the server logo, and select the shape and color.
- Workflow notifications on the phone.
