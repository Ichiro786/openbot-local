// OpenBot Local: Server settings → Local engine → "Antigravity (Gemini)".
//
// Google's Antigravity ACP server (the Gemini provider) aborts in TCMalloc on 39-bit Android kernels
// (antigravity-cli#64). The engine ships CPython 3.14 and the hybrid scripts (engine/agy-hybrid/);
// this row runs `agy-hybrid.sh prepare` inside the rootfs, which downloads Google's official zip from
// dl.google.com, checks its sha256 against the ACP registry and builds the runtime on the phone.
// openbot-start.sh points OpenBot at it once it is ready, so the engine needs one restart after setup.
// The sign-in link the server opens is recorded by a BROWSER stand-in that never writes to the ACP
// stdout; "Open Google sign-in" hands it to the phone's browser.
import { Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Linking, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";

import { type CommandHandle, runCommand, startCommand } from "../../../modules/openbot-engine";

const TOOL = "/opt/agy-hybrid/tools/agy-hybrid.sh";
/** A sign-in link older than this has expired on Google's side (the loopback listener is gone too). */
const SIGNIN_MAX_AGE_S = 15 * 60;

const layout = LinearTransition.duration(220).reduceMotion(ReduceMotion.System);
const enter = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const leave = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
const PROGRESS_COLOR = "#FF9F0A";

const STAGE_LABEL: Record<string, string> = {
  registry: "Checking the release",
  download: "Downloading",
  verify: "Verifying",
  extract: "Unpacking",
  install: "Installing",
  smoke: "Testing",
  done: "Done",
};
/** Share of the whole job each stage covers, so one bar runs 0 → 100 % across all of them. */
const STAGE_SPAN: Record<string, [number, number]> = {
  registry: [0, 0.02],
  download: [0.02, 0.5],
  verify: [0.5, 0.55],
  extract: [0.55, 0.7],
  install: [0.7, 0.92],
  smoke: [0.92, 0.99],
  done: [1, 1],
};

function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// -------------------------------------------------------------------------------------------------
// The prepare job outlives the screen: it keeps running (and reporting) when the user goes back.
// -------------------------------------------------------------------------------------------------

interface Job {
  running: boolean;
  stage: string | null;
  /** 0..1 over the whole job; null when unknown. */
  progress: number | null;
  /** Last meaningful line of output, shown on failure. */
  lastLine: string | null;
  result: "ok" | "failed" | "cancelled" | null;
  finishedAt: number | null;
}

let job: Job = { running: false, stage: null, progress: null, lastLine: null, result: null, finishedAt: null };
let handle: CommandHandle | null = null;
const listeners = new Set<() => void>();

function setJob(next: Partial<Job>) {
  job = { ...job, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function startPrepare(onDone: (ok: boolean) => void) {
  if (job.running) return;
  setJob({ running: true, stage: "registry", progress: 0, lastLine: null, result: null, finishedAt: null });
  let buffer = "";
  const onLine = (line: string) => {
    const text = line.trim();
    if (!text) return;
    const m = /\[agy-hybrid\] STAGE (\w+)(?: (\d+))?/.exec(text);
    if (m) {
      const stage = m[1] ?? "";
      const pct = m[2];
      const span = STAGE_SPAN[stage] ?? [job.progress ?? 0, job.progress ?? 0];
      const inner = pct == null ? 0 : Math.min(100, Number(pct)) / 100;
      setJob({ stage, progress: span[0] + (span[1] - span[0]) * inner });
    } else {
      setJob({ lastLine: text.replace(/^\[agy-hybrid\]\s*/, "").slice(0, 300) });
    }
  };
  handle = startCommand(`sh ${TOOL} prepare`, {
    onOutput: (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    },
  });
  handle.result
    .then((result) => {
      if (buffer) onLine(buffer);
      const ok = result.exitCode === 0;
      setJob({
        running: false,
        result: result.cancelled ? "cancelled" : ok ? "ok" : "failed",
        progress: ok ? 1 : job.progress,
        finishedAt: Date.now(),
      });
      onDone(ok);
    })
    .catch((error) => {
      setJob({ running: false, result: "failed", lastLine: describe(error), finishedAt: Date.now() });
      onDone(false);
    })
    .finally(() => {
      handle = null;
    });
}

function cancelPrepare() {
  handle?.cancel();
}

// -------------------------------------------------------------------------------------------------

function ProgressBar({ progress }: { progress: number }) {
  const width = useSharedValue(progress);
  useEffect(() => {
    width.set(withTiming(progress, { duration: 250, reduceMotion: ReduceMotion.System }));
  }, [progress, width]);
  const style = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, width.get())) * 100}%` as `${number}%`,
  }));
  return (
    <View className="h-1 overflow-hidden rounded-full bg-grouped-border">
      <Animated.View style={[{ height: "100%", backgroundColor: PROGRESS_COLOR }, style]} />
    </View>
  );
}

interface Info {
  ready: boolean;
  installed: string | null;
  python: boolean;
  vaBits: number | null;
  freeMib: number | null;
}

/**
 * The Antigravity (Gemini) setup rows. `engineInstalled` = the rootfs is installed (commands can run);
 * `onRestart` restarts the engine so OpenBot picks the runtime up.
 */
export function AntigravityRuntimeSection({
  engineInstalled,
  engineRunning,
  onRestart,
}: {
  engineInstalled: boolean;
  engineRunning: boolean;
  onRestart: () => Promise<void>;
}) {
  const current = useSyncExternalStore(subscribe, () => job);
  const [info, setInfo] = useState<Info | null>(null);
  /** The engine on this phone predates the hybrid tools (no CPython / no agy-hybrid.sh). */
  const [unsupported, setUnsupported] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [signinUrl, setSigninUrl] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const autoUpdated = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await runCommand(`[ -x ${TOOL} ] && sh ${TOOL} status || echo missing=1`, { timeoutMs: 20_000 });
      const kv = parseKv(status.output);
      if (kv.missing === "1" || kv.python === "0") {
        setUnsupported(true);
        setInfo(null);
        return;
      }
      setUnsupported(false);
      setInfo({
        ready: kv.ready === "1",
        installed: kv.installed || null,
        python: kv.python === "1",
        vaBits: kv.va_bits ? Number(kv.va_bits) : null,
        freeMib: kv.free_mib ? Number(kv.free_mib) : null,
      });
    } catch (error) {
      setNote({ text: describe(error), error: true });
    }
  }, []);

  const refreshSignin = useCallback(async () => {
    try {
      const url = await runCommand(`sh ${TOOL} signin-url`, { timeoutMs: 10_000 });
      const [at, link] = url.output.trim().split(/\s+/, 2);
      const fresh = !!link && link.startsWith("https://") && Date.now() / 1000 - Number(at) < SIGNIN_MAX_AGE_S;
      setSigninUrl(fresh && link ? link : null);
    } catch {
      setSigninUrl(null);
    }
  }, []);

  const check = useCallback(async () => {
    try {
      const answer = await runCommand(`sh ${TOOL} check`, { timeoutMs: 60_000 });
      const kv = parseKv(answer.output);
      setLatest(kv.latest || null);
      setCheckError(kv.error || null);
    } catch (error) {
      setCheckError(describe(error));
    }
  }, []);

  useEffect(() => {
    if (!engineInstalled) return;
    void refresh().then(check);
  }, [engineInstalled, refresh, check]);

  // While this page is open, look for a sign-in link the server asked to open (it waits on a
  // 127.0.0.1 loopback for Google's redirect, so the link only works for a few minutes).
  useEffect(() => {
    if (!engineRunning || !info?.ready) return;
    void refreshSignin();
    const timer = setInterval(() => void refreshSignin(), 8000);
    return () => clearInterval(timer);
  }, [engineRunning, info?.ready, refreshSignin]);

  const prepare = useCallback(() => {
    setNote(null);
    startPrepare((ok) => {
      void haptics.notification(ok ? "success" : "error");
      if (ok) setNeedsRestart(true);
      void refresh().then(check);
    });
  }, [refresh, check]);

  // A new server version in the ACP registry: prepare it in the background. The current runtime
  // keeps working until the new one passed its own test, and `current` only moves then.
  const updateAvailable = !!(info?.ready && latest && info.installed && latest !== info.installed);
  useEffect(() => {
    if (!updateAvailable || current.running || !latest || autoUpdated.current === latest) return;
    autoUpdated.current = latest;
    prepare();
  }, [updateAvailable, current.running, latest, prepare]);

  const confirmSetup = () => {
    const lowVa = info?.vaBits != null && info.vaBits < 48;
    Alert.alert(
      "Set up Antigravity (Gemini)?",
      `Downloads Google's official Antigravity server (about 310 MB) from dl.google.com, checks it against the published sha256 and prepares it on this phone. Needs about 2.5 GB free while it works and 340 MB after.${
        lowVa ? " This phone's kernel needs it for Gemini to start." : ""
      }`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Set up", onPress: prepare },
      ],
    );
  };

  const confirmRemove = () =>
    Alert.alert(
      "Remove the Antigravity runtime?",
      "Gemini falls back to OpenBot's own copy after the next engine restart. Your Google sign-in stays in the engine.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            void (async () => {
              setBusy(true);
              try {
                await runCommand(`sh ${TOOL} remove`, { timeoutMs: 120_000 });
                setNeedsRestart(true);
                void haptics.notification("success");
              } catch (error) {
                setNote({ text: describe(error), error: true });
                void haptics.notification("error");
              } finally {
                setBusy(false);
                void refresh();
              }
            })(),
        },
      ],
    );

  const restart = () =>
    void (async () => {
      setBusy(true);
      try {
        await onRestart();
        setNeedsRestart(false);
      } catch (error) {
        setNote({ text: describe(error), error: true });
      } finally {
        setBusy(false);
      }
    })();

  const openSignin = () => {
    if (!signinUrl) return;
    void Linking.openURL(signinUrl).catch((error) => setNote({ text: describe(error), error: true }));
  };

  if (!engineInstalled) return null;

  const ready = info?.ready ?? false;
  const stageLabel = current.stage ? (STAGE_LABEL[current.stage] ?? current.stage) : "Preparing";
  const trailing = current.running
    ? `${stageLabel}${current.progress != null ? ` ${Math.round(current.progress * 100)}%` : "…"}`
    : unsupported
      ? "Needs an engine update"
      : info == null
        ? "…"
        : ready
          ? `Ready · ${info.installed}`
          : "Not set up";

  const failed = !current.running && current.result === "failed";
  const footer = unsupported
    ? "This engine has no Antigravity tools yet. Update the engine above, then set it up here."
    : failed
      ? `Setup failed${current.lastLine ? `: ${current.lastLine}` : "."} The previous runtime, if any, is still in use.`
      : needsRestart
        ? "Restart the engine so Gemini uses the new runtime."
        : ready
          ? `Runs Google's Antigravity server on this phone's Python, without the memory allocator that fails on ${
              info?.vaBits ?? 39
            }-bit kernels. New server versions are prepared automatically.${checkError ? ` Last check failed: ${checkError}` : ""}`
          : "Google's Gemini server cannot start on most phone kernels. Setup downloads it from Google, checks it and prepares a version that runs here. Nothing from Google ships in this app.";

  return (
    <Animated.View layout={layout} className="gap-3">
      <SettingsSection title="Antigravity (Gemini)" footer={footer}>
        <SettingsRow
          disclosure={false}
          trailing={
            <Typography.Paragraph className="text-grouped-secondary" numberOfLines={1}>
              {trailing}
            </Typography.Paragraph>
          }
        >
          <Typography.Paragraph>Runtime</Typography.Paragraph>
          {current.running && current.progress != null ? (
            <Animated.View entering={enter} exiting={leave} className="pt-1">
              <ProgressBar progress={current.progress} />
            </Animated.View>
          ) : null}
        </SettingsRow>
        {unsupported ? null : current.running ? (
          <SettingsRow disclosure={false} onPress={cancelPrepare}>
            <Typography.Paragraph className="text-danger-text">Cancel setup</Typography.Paragraph>
          </SettingsRow>
        ) : !ready ? (
          <SettingsRow disclosure={false} disabled={busy || info == null} onPress={confirmSetup}>
            <Typography.Paragraph className="text-accent">{failed ? "Try again" : "Set up"}</Typography.Paragraph>
          </SettingsRow>
        ) : updateAvailable ? (
          <SettingsRow disclosure={false} disabled={busy} onPress={prepare}>
            <Typography.Paragraph className="text-accent">{`Update to ${latest}`}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {needsRestart && !current.running ? (
          <Animated.View entering={enter} exiting={leave}>
            <SettingsRow disclosure={false} disabled={busy} onPress={restart}>
              <Typography.Paragraph className="text-accent">Restart engine</Typography.Paragraph>
            </SettingsRow>
          </Animated.View>
        ) : null}
        {ready && signinUrl && !current.running ? (
          <Animated.View entering={enter} exiting={leave}>
            <SettingsRow disclosure={false} onPress={openSignin}>
              <Typography.Paragraph className="text-accent">Open Google sign-in</Typography.Paragraph>
            </SettingsRow>
          </Animated.View>
        ) : null}
        {ready && !current.running ? (
          <SettingsRow disclosure={false} disabled={busy} onPress={confirmRemove}>
            <Typography.Paragraph className="text-danger-text">Remove</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {note ? (
        <Animated.View entering={enter} exiting={leave}>
          <Typography.Paragraph
            accessibilityRole={note.error ? "alert" : undefined}
            className={`px-4 ${note.error ? "text-danger-text" : "text-grouped-secondary"}`}
          >
            {note.text}
          </Typography.Paragraph>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
