// Expo config plugin for modules/openbot-engine.
//
// The service and permissions are declared in the module's own AndroidManifest.xml and reach the
// app through manifest merging; this plugin repeats them on the app manifest (harmless duplicates
// are merged) so `expo prebuild` output is self-explanatory, and it changes what only the app can:
//   - expo.useLegacyPackaging=true + jniLibs.useLegacyPackaging (AGP then writes
//     android:extractNativeLibs="true" into the merged manifest), so the package manager
//     unpacks lib*.so (proot, its loader, libtalloc) to nativeLibraryDir, the only place an app on
//     targetSdk 29+ may exec binaries from;
//   - reactNativeArchitectures=arm64-v8a plus an abiFilters block, since only arm64 proot ships;
//   - keepDebugSymbols for the proot executables so AGP never strips them;
//   - noCompress "xz", so assets/engine/rootfs-arm64.tar.xz is stored and AssetManager.openFd works.
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withGradleProperties,
} = require("expo/config-plugins");

const PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
  "android.permission.WAKE_LOCK",
  "android.permission.POST_NOTIFICATIONS",
  // Android 16 Live Updates: lets the agent progress notification be promoted to the status bar chip
  // and lock screen (realme UI / ColorOS "Live Alerts"). A normal permission, granted at install.
  "android.permission.POST_PROMOTED_NOTIFICATIONS",
  "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
];

const SERVICE_NAME = "run.openbot.engine.EngineService";
const SPECIAL_USE_PROPERTY = "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE";
const GRADLE_MARKER = "// @openbot-engine";

function withEngineManifest(config, { specialUseDescription }) {
  config = AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    // AGP 8 rejects/warns on android:extractNativeLibs in a source manifest; useLegacyPackaging
    // (below) makes AGP set it in the merged manifest instead.
    delete app.$["android:extractNativeLibs"];

    app.service = (app.service ?? []).filter((s) => s.$["android:name"] !== SERVICE_NAME);
    app.service.push({
      $: {
        "android:name": SERVICE_NAME,
        "android:exported": "false",
        "android:stopWithTask": "false",
        "android:foregroundServiceType": "specialUse",
      },
      property: [{ $: { "android:name": SPECIAL_USE_PROPERTY, "android:value": specialUseDescription } }],
    });
    return mod;
  });
}

function withEngineGradleProperties(config) {
  return withGradleProperties(config, (mod) => {
    const set = (key, value) => {
      const existing = mod.modResults.find((item) => item.type === "property" && item.key === key);
      if (existing) existing.value = value;
      else mod.modResults.push({ type: "property", key, value });
    };
    // Read by Expo's app/build.gradle template: packagingOptions.jniLibs.useLegacyPackaging.
    set("expo.useLegacyPackaging", "true");
    set("reactNativeArchitectures", "arm64-v8a");
    return mod;
  });
}

function withEngineAppBuildGradle(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("openbot-engine: app/build.gradle must be Groovy");
    }
    if (mod.modResults.contents.includes(GRADLE_MARKER)) return mod;
    mod.modResults.contents += `
${GRADLE_MARKER}
android {
    defaultConfig {
        ndk {
            abiFilters "arm64-v8a"
        }
    }
    androidResources {
        noCompress += ["xz"]
    }
    packagingOptions {
        jniLibs {
            useLegacyPackaging true
            keepDebugSymbols += ['**/libproot.so', '**/libproot-loader.so', '**/libtalloc.so', '**/libandroid-shmem.so']
        }
    }
}
`;
    return mod;
  });
}

const withOpenBotEngine = (config, props = {}) => {
  const specialUseDescription =
    props.specialUseDescription ??
    "Runs the user's local OpenBot agent server (a Linux userland under proot) that the app connects to over localhost.";
  config = withEngineManifest(config, { specialUseDescription });
  config = withEngineGradleProperties(config);
  config = withEngineAppBuildGradle(config);
  return config;
};

module.exports = createRunOncePlugin(withOpenBotEngine, "openbot-engine", "1.0.0");
