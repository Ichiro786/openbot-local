const { existsSync } = require("node:fs");
const { join } = require("node:path");

// Android notifications come through Firebase Cloud Messaging, which needs the Firebase file of the
// app. The file is optional, so the app builds before the Firebase project exists, and such a build
// gets no notifications on Android. The file has public identifiers only; the account service has the
// key that sends.
//
// OpenBot Local fork: the upstream google-services.json is registered for `run.openbot.mobile`, and the
// Google Services Gradle plugin fails the build when no client matches the applicationId
// (`run.openbot.local`). So the upstream file is ignored; push notifications are off in this build.
// To re-enable, register `run.openbot.local` in your own Firebase project and drop the file at
// ./google-services.local.json.
const GOOGLE_SERVICES_FILE = "./google-services.local.json";

/** @param {{ config: import('expo/config').ExpoConfig }} context */
module.exports = ({ config }) =>
  existsSync(join(__dirname, GOOGLE_SERVICES_FILE))
    ? { ...config, android: { ...config.android, googleServicesFile: GOOGLE_SERVICES_FILE } }
    : config;
