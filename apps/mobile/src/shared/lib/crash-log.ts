import * as Application from "expo-application";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import { native } from "../../../modules/openbot-engine/src/OpenBotEngineModule";

/**
 * Crash capture without adb. A JS error (global handler or the root error boundary) and a native
 * uncaught exception (OpenBotEngineModule) each leave a file in the app's files directory. The next
 * launch offers the text with a "Copy crash log" button. Writes are synchronous and never throw: they
 * run inside a crashing process.
 */
const JS_FILE = "openbot-crash-js.txt";
/** Written by `CrashCapture.kt`; `Paths.document` is Android `filesDir`. */
const NATIVE_FILE = "openbot-crash-native.txt";

let installed = false;

function header(kind: string): string {
  const version = Application.nativeApplicationVersion ?? "development";
  const build = Application.nativeBuildVersion ? ` (${Application.nativeBuildVersion})` : "";
  return [
    `OpenBot crash log (${kind})`,
    `Time: ${new Date().toISOString()}`,
    `App: ${version}${build}`,
    `System: ${Device.osName ?? "unknown"} ${Device.osVersion ?? ""}, ${Device.modelName ?? Device.modelId ?? "unknown"}`,
  ].join("\n");
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    return `${error.name}: ${error.message}\n${error.stack ?? "(no stack)"}${cause ? `\nCaused by: ${describe(cause)}` : ""}`;
  }
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Saves a JS error. `componentStack` comes from the error boundary. */
export function recordJsCrash(error: unknown, options: { fatal: boolean; componentStack?: string | null }): string {
  const text = [
    header(options.fatal ? "JavaScript, fatal" : "JavaScript"),
    "",
    describe(error),
    options.componentStack ? `\nComponent stack:${options.componentStack}` : "",
    "",
  ].join("\n");
  try {
    new File(Paths.document, JS_FILE).writeSync(text);
  } catch {
    // Nothing more can be done inside a crash.
  }
  return text;
}

/** Installs the global JS handler (once) and the native handler. Call before the app renders. */
export function installCrashCapture(): void {
  if (installed) return;
  installed = true;
  try {
    native?.installCrashHandler?.();
  } catch {
    // An older native module without the handler.
  }
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal) recordJsCrash(error, { fatal: true });
    previous(error, isFatal);
  });
}

/** The crash of an earlier launch, JS and native together, or null. */
export function readLastCrash(): string | null {
  const parts: string[] = [];
  for (const name of [NATIVE_FILE, JS_FILE]) {
    try {
      const file = new File(Paths.document, name);
      if (file.exists) {
        const text = file.textSync().trim();
        if (text) parts.push(text);
      }
    } catch {
      // Unreadable: skip it.
    }
  }
  return parts.length > 0 ? parts.join("\n\n----\n\n") : null;
}

export function clearLastCrash(): void {
  for (const name of [NATIVE_FILE, JS_FILE]) {
    try {
      const file = new File(Paths.document, name);
      if (file.exists) file.delete();
    } catch {
      // Leave it; the notice shows again next launch.
    }
  }
}
