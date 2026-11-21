# Update engine to 0.76.1 and import mobile 1.4.12

- Engine: rebase the six local patches onto upstream 0.76.1 in one jump from 0.74.0, skipping 0.75.0 and 0.76.0 as separate releases. Upstream adds workflow folders, typed workflow answers, step settings, push-to-talk, parallel tasks, and up to 20 provider accounts. No new protocol-9 capability: the baseline stays exactly 256 and the full list is 283, so the 256 wire limit holds. The WhatsApp alias stays out of the capability lists (PR #19).
- App: import upstream mobile changes v0.74.0..v0.76.1 (987 files) into apps/mobile + packages. The fork's look is unchanged: ColorOS toggle and frost, zoom open, predictive Back, avatars, and the releases updater stay. Upstream's new workflow step settings, workflow folders, channel folders, and chat turn tracking are in. Upstream removed the diagrams feature.
- versionName 1.4.12 (upstream) / versionCode 10425.
