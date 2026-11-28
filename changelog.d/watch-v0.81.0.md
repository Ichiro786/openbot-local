### Changed

- Engine: rebase the six local patches onto upstream 0.81.0. No new protocol-9 capability: the baseline stays exactly 256 and the full list is 321, because the five new capabilities are protocol-10 only, so the 256 wire limit holds. The WhatsApp alias stays out of the capability lists (PR #19).
- App: import upstream 0.81.0 over v0.80.0 (505 files). The fork look stays: ColorOS toggle and frost, zoom open, predictive Back, Back handling, and avatars. The watch complication keeps the fork gauge and checkmark view; upstream replaces it with a Buddy face and gradient cards.
- App: add sync, remote chat content, workflow media clips, plugin catalog, and attachment dimensions (all protocol-10 capabilities). Remote chat content is off by default.
- App: raise Android versionCode to 10437.
