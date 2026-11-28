### Changed

- App: import upstream android-v1.4.15 over v0.81.1 (69 files). The engine stays 0.81.1-1: upstream adds no new team-protocol capability, so protocol-9 stays exactly 256. New signal messages (go-away, resume-from, ingress-routes) target the Cloudflare Signal service or the host only; the phone client degrades cleanly when the host lacks them. Account requests now use a short access token with a session-token fallback.
- App: the fork look stays: ColorOS toggle and frost, zoom open, predictive Back, Back handling, and avatars. Upstream changes are logic only: keep the message field steady while typing, continue Android dictation until Stop, show the account with the most plan limit left, show Gemini with "No usage reading", reconnect faster after a Wi-Fi and mobile data move under a VPN, and slow the retry pace for an offline server.
- App: raise Android versionCode to 10440. Version stays 1.4.15. This update ships as apk-0.81.1-2.
