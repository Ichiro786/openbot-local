# Update engine to 0.74.0 and import mobile 1.4.11

- Engine: rebase the five local patches onto upstream 0.74.0. Upstream restructured the capability lists (protocol 10) and the ACP client, and removed comments repo-wide. The WhatsApp alias stays out of the capability lists (PR #19). Protocol 10 sends a 12-entry list with a baseline marker, so the 256 wire limit holds: the baseline is exactly 256 and the full list is 267.
- App: import upstream mobile changes v0.73.0..v0.74.0 (3052 files) into apps/mobile + packages. The fork's look is unchanged: ColorOS toggle and frost, zoom open, predictive Back, avatars, and the releases updater stay. Upstream's new side-question route, chat backdrops, and workflow media catalog are in.
- versionName 1.4.11 (upstream) / versionCode 10421.
