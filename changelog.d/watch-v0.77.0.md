### Changed

- Engine: rebase the six local patches onto upstream 0.77.0. Upstream adds a steer for Claude agents while a tool runs, Antigravity session files, and a reworded style plan. No new protocol-9 capability: the baseline stays exactly 256 and the full list is 297, so the 256 wire limit holds. The WhatsApp alias stays out of the capability lists (PR #19).
- App: import upstream mobile changes v0.76.1..v0.77.0 (930 files) into apps/mobile + packages. The fork's look is unchanged: ColorOS toggle and frost, zoom open, predictive Back, avatars, and the releases updater stay. The drawer header keeps the PR #39 top clearance. The send button keeps the keyboard open on send (PR #25). The drawer header button is now a settings gear (upstream).
- versionName 1.4.12 (upstream) / versionCode 10431.

### Added

- Location sharing: an agent can ask for the phone location, and the phone shares it once or always allows it.
- WhatsApp read-only chats for allowed contacts and groups.
- Ghost, jellyfish, and octopus avatar shapes.
- OpenBot credits in the mobile app.
- Workflow plan 013: workflows are typed and portable.
