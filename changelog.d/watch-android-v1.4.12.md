### Changed

- Import upstream mobile changes v0.74.0..android-v1.4.12 (124 files) into apps/mobile + packages. The engine stays at 0.74.0-1. The fork's look is unchanged: no upstream change touches apps/mobile/src, so the ColorOS toggle and frost, zoom open, predictive Back, avatars, and the releases updater stay.
- Android: Google Play now lets you install the app on devices that do not have Wi-Fi or a portrait screen, such as some tablets, Chromebooks and Android XR headsets.
- The two new workflow capabilities (workflows-agent-files-v1, workflows-media-catalog-v2) enter as protocol 10 entries; the protocol 9 list stays frozen at exactly 256, inside the wire limit.
- versionName 1.4.12 (upstream) / versionCode 10422.
