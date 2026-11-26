# Bump versionCode to 10434

- Raise `expo.android.versionCode` in `apps/mobile/app.json` from 10433 to 10434.
- Reason: PR #47 changed the engine only and left the version unchanged. Each release raises the version code by one, so apk-0.79.0 installs as an update over apk-0.78.0.
