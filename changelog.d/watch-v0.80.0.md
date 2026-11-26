### Changed

- Engine: rebase the six local patches onto upstream 0.80.0. No new protocol-9 capability: the baseline stays exactly 256 and the full list is 316, because the four new capabilities are protocol-10 only, so the 256 wire limit holds. The WhatsApp alias stays out of the capability lists (PR #19).
- App: import upstream 0.80.0 over android-v1.4.14 (575 files). The fork look stays: ColorOS toggle and frost, zoom open, predictive Back, Back handling, and avatars. A ready over-the-air update now shows its own banner with release notes; the store path still downloads the fork APK from the fork release page.
- App: chat markdown now splits display-math blocks; the streaming tail veil stays on the last block. Channel rows now show an unread count badge with the same badge the agent rows already use.
- App: raise Android versionCode to 10436.
