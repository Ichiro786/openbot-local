// OpenBot Local: the on-device engine page, under Server settings → Local engine.
// It replaces the floating "Engine: …" pill and its hard-coded dark modal. It uses the settings
// components, so it follows the light and dark theme, the sheet header and the app's haptics.
import { type Href, router } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";

import {
  checkForUpdate,
  type ControlResponse,
  controlStatus,
  type EnginePhase,
  type EngineStatus,
  isEngineSupported,
  loginStart,
  loginVerify,
  logout,
  type UpdateCheck,
  useOpenBotEngine,
} from "../../../modules/openbot-engine";

/** "412 MB" for a release asset; null when the size is unknown. */
function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** System colours read well on both the light and the dark sheet. */
const PHASE_COLOR: Record<EnginePhase, string> = {
  idle: "#8E8E93",
  installing: "#FF9F0A",
  starting: "#FF9F0A",
  running: "#30D158",
  stopping: "#FF9F0A",
  stopped: "#8E8E93",
  crashed: "#FF453A",
  error: "#FF453A",
  unsupported: "#8E8E93",
};

const INSTALL_STEP_LABEL: Record<string, string> = {
  checking: "Checking",
  downloading: "Downloading",
  verifying: "Verifying",
  extracting: "Installing",
  migrating: "Updating",
};

const layout = LinearTransition.duration(220).reduceMotion(ReduceMotion.System);
const enter = FadeIn.duration(180).reduceMotion(ReduceMotion.System);
const leave = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function answerText(response: ControlResponse): string {
  const fields = Object.entries(response.fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("  ");
  return `${response.status}${fields ? `  ${fields}` : response.body ? `  ${response.body.trim()}` : ""}`;
}

const SIGNED_OUT = /^(|none|null|-|false|no|signed[-_ ]?out|anonymous)$/i;

/** The human label of a phase, such as "Installing 42%" or "Error". */
export function engineLabel(status: EngineStatus): string {
  switch (status.phase) {
    case "running":
      return "Running";
    case "starting":
      return "Starting…";
    case "stopping":
      return "Stopping…";
    case "installing": {
      const step = (status.installStep && INSTALL_STEP_LABEL[status.installStep]) || "Installing";
      return status.progress == null ? `${step}…` : `${step} ${Math.round(status.progress * 100)}%`;
    }
    case "stopped":
    case "idle":
      return "Stopped";
    case "crashed":
      return "Crashed";
    case "error":
      return "Error";
    case "unsupported":
      return "Not available";
  }
}

/** A dot in the phase colour. It breathes while the engine is busy, unless motion is reduced. */
function StatusDot({ phase }: { phase: EnginePhase }) {
  const reduced = useReducedMotion();
  const busy = phase === "installing" || phase === "starting" || phase === "stopping";
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (busy && !reduced) {
      pulse.set(
        withRepeat(
          withSequence(
            withTiming(0.35, { duration: 650, easing: Easing.inOut(Easing.quad) }),
            withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
          ),
          -1,
        ),
      );
    } else {
      cancelAnimation(pulse);
      pulse.set(withTiming(1, { duration: 150 }));
    }
    return () => cancelAnimation(pulse);
  }, [busy, reduced, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <Animated.View
      style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: PHASE_COLOR[phase] }, style]}
    />
  );
}

/** A thin bar for install progress. Its width animates on the UI thread. */
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
      <Animated.View style={[{ height: "100%", backgroundColor: PHASE_COLOR.installing }, style]} />
    </View>
  );
}

/** The Server settings row that opens this page. Shows only in the OpenBot Local build on Android. */
export function LocalEngineSettingsSection() {
  if (!isEngineSupported) return null;
  return <LocalEngineSettingsSectionInner />;
}

function LocalEngineSettingsSectionInner() {
  const { status } = useOpenBotEngine({ watchLogs: false });
  return (
    <SettingsSection title="This phone">
      <SettingsRow
        leading={<StatusDot phase={status.phase} />}
        trailing={<TrailingValue value={engineLabel(status)} />}
        onPress={() => router.push("/server-settings/local-engine" as Href)}
      >
        <Typography.Paragraph>Local engine</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

export function LocalEngineScreen() {
  if (!isEngineSupported)
    return (
      <SettingsContent>
        <SettingsNote>The local engine runs only in OpenBot Local on Android.</SettingsNote>
      </SettingsContent>
    );
  return <LocalEngineScreenInner />;
}

function LocalEngineScreenInner() {
  const [showLog, setShowLog] = useState(false);
  const engine = useOpenBotEngine({ watchLogs: showLog, logLines: 80 });
  const { status, busy } = engine;
  const running = status.phase === "running";
  const stopped = status.phase === "stopped" || status.phase === "idle" || status.phase === "crashed" || status.phase === "error";

  const [account, setAccount] = useState<string | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const locked = useRef(false);

  const refreshAccount = useCallback(async () => {
    try {
      const answer = await controlStatus();
      const value = (answer.fields.account ?? "").trim();
      setAccount(SIGNED_OUT.test(value) ? null : value);
    } catch {
      setAccount(null);
    } finally {
      setAccountLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (running) void refreshAccount();
    else setAccountLoaded(false);
  }, [running, refreshAccount]);

  const act = useCallback(async (work: () => Promise<void>, success?: string) => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setNote(null);
    try {
      await work();
      if (success) setNote({ text: success, error: false });
      void haptics.notification("success");
    } catch (error) {
      setNote({ text: describe(error), error: true });
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setPending(false);
    }
  }, []);

  const toggle = () => void act(running || busy ? engine.stop : engine.start);
  const restart = () =>
    Alert.alert("Restart the local engine?", "Chats on this phone pause for a few seconds while it starts again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Restart", onPress: () => void act(engine.restart) },
    ]);

  const sendCode = () =>
    void act(async () => {
      const answer = await loginStart(email.trim());
      const next = answer.fields.challenge;
      if (!answer.ok || !next) throw new Error(`Sign-in did not start: ${answerText(answer)}`);
      setChallenge(next);
    }, "We sent a code to your email.");

  const verify = () =>
    void act(async () => {
      if (!challenge) return;
      const answer = await loginVerify(challenge, code.trim());
      if (!answer.ok) throw new Error(`Code not accepted: ${answerText(answer)}`);
      setChallenge(null);
      setCode("");
      await refreshAccount();
    }, "Signed in.");

  const signOut = () =>
    Alert.alert("Sign out of the local engine?", account ?? undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () =>
          void act(async () => {
            const answer = await logout();
            if (!answer.ok) throw new Error(answerText(answer));
            await refreshAccount();
          }),
      },
    ]);

  // Engine updates (Part H): the native side resolves the newest `engine-*` release of the fork,
  // downloads it, refuses it without a matching sha256, swaps it in with /root carried over, and
  // rolls back to the previous rootfs when the new engine does not reach ready.
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const checkedOnOpen = useRef(false);

  const runCheck = useCallback(async (quiet: boolean) => {
    setChecking(true);
    try {
      const answer = await checkForUpdate();
      setCheck(answer);
      if (!quiet) void haptics.notification(answer.error ? "error" : "success");
    } catch (error) {
      setCheck({ installedVersion: null, latestVersion: null, updateAvailable: false, error: describe(error) });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (checkedOnOpen.current) return;
    checkedOnOpen.current = true;
    void runCheck(true);
  }, [runCheck]);

  const latestVersion = check?.latestVersion ?? status.latestVersion;
  const latestBytes = check?.latestBytes ?? status.latestBytes;
  const updateAvailable = check ? check.updateAvailable : status.updateAvailable;
  const latestSize = formatBytes(latestBytes);
  const updating = status.phase === "installing" && status.installStep != null && status.installStep !== "checking";

  const installUpdate = () => {
    if (!latestVersion) return;
    if (check?.verifiable === false) {
      setNote({ text: `${latestVersion} has no sha256 to check it against, so it will not be installed.`, error: true });
      return;
    }
    Alert.alert(
      `Update the engine to ${latestVersion}?`,
      `${latestSize ? `Downloads ${latestSize}. ` : ""}The engine stops while the update installs. Your sign-in, settings and chats are kept, and a failed update goes back to ${status.installedVersion ?? "the current engine"}.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Update", onPress: () => void act(engine.update, "Updating the engine…") },
      ],
    );
  };

  const updateFooter =
    status.updateError ??
    (status.updatePendingConfirm
      ? "Checking that the new engine starts. If it does not, the previous one comes back."
      : (check?.error ??
        "Updates come from the OpenBot Local releases on GitHub and are checked with sha256 before they replace the engine."));

  const reason =
    status.phase === "error" || status.phase === "crashed"
      ? [status.message, status.lastExitCode != null ? `exit code ${status.lastExitCode}` : null].filter(Boolean).join(" · ")
      : (status.message ?? undefined);

  return (
    <SettingsContent>
      <Animated.View layout={layout}>
        <SettingsSection footer={reason || undefined}>
          <SettingsRow
            disclosure={false}
            leading={<StatusDot phase={status.phase} />}
            trailing={
              <Typography.Paragraph className="text-grouped-secondary">
                {status.installedVersion ?? "Not installed"}
              </Typography.Paragraph>
            }
          >
            <Typography.Paragraph>{engineLabel(status)}</Typography.Paragraph>
            {status.phase === "installing" && status.progress != null ? (
              <Animated.View entering={enter} exiting={leave} className="pt-1">
                <ProgressBar progress={status.progress} />
              </Animated.View>
            ) : null}
          </SettingsRow>
          {running ? (
            <SettingsRow
              disclosure={false}
              trailing={
                <Typography.Paragraph className="text-grouped-secondary" numberOfLines={1}>
                  {accountLoaded ? (account ?? "Not signed in") : "…"}
                </Typography.Paragraph>
              }
            >
              <Typography.Paragraph>Account</Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      </Animated.View>

      <Animated.View layout={layout}>
        <SettingsSection>
          <SettingsRow disclosure={false} disabled={pending || status.phase === "stopping"} onPress={toggle}>
            <Typography.Paragraph className={running || busy ? "text-danger-text" : "text-accent"}>
              {running || busy ? "Stop engine" : "Start engine"}
            </Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disclosure={false} disabled={pending || busy || stopped} onPress={restart}>
            <Typography.Paragraph className="text-accent">Restart</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      </Animated.View>

      <Animated.View layout={layout}>
        <SettingsSection title="Engine version" footer={updateFooter}>
          <SettingsRow
            disclosure={false}
            trailing={
              <Typography.Paragraph className="text-grouped-secondary" numberOfLines={1}>
                {status.installedVersion ?? "Not installed"}
              </Typography.Paragraph>
            }
          >
            <Typography.Paragraph>Installed</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disclosure={false}
            trailing={
              <Typography.Paragraph className="text-grouped-secondary" numberOfLines={1}>
                {latestVersion ? `${latestVersion}${latestSize ? ` · ${latestSize}` : ""}` : checking ? "Checking…" : "Unknown"}
              </Typography.Paragraph>
            }
          >
            <Typography.Paragraph>Latest</Typography.Paragraph>
          </SettingsRow>
          {updateAvailable && latestVersion ? (
            <SettingsRow disclosure={false} disabled={pending || busy || updating} onPress={installUpdate}>
              <Typography.Paragraph className="text-accent">
                {updating ? "Updating…" : `Update to ${latestVersion}`}
              </Typography.Paragraph>
            </SettingsRow>
          ) : (
            <SettingsRow disclosure={false} disabled={checking || updating} onPress={() => void runCheck(false)}>
              <Typography.Paragraph className="text-accent">
                {checking ? "Checking…" : latestVersion ? "Up to date · Check again" : "Check for updates"}
              </Typography.Paragraph>
            </SettingsRow>
          )}
        </SettingsSection>
      </Animated.View>

      {running && accountLoaded ? (
        <Animated.View layout={layout} entering={enter} exiting={leave} className="gap-3">
          {account ? (
            <SettingsSection>
              <SettingsRow disclosure={false} disabled={pending} onPress={signOut}>
                <Typography.Paragraph className="text-danger-text">Sign out</Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
          ) : challenge ? (
            <Animated.View key="code" entering={enter} className="gap-3">
              <SheetFormField
                label={`Code sent to ${email.trim()}`}
                value={code}
                onChangeText={setCode}
                inputMode="numeric"
                returnKeyType="done"
                autoFocus
                editable={!pending}
                onSubmitEditing={verify}
              />
              <SettingsSection>
                <SettingsRow disclosure={false} disabled={pending || !code.trim()} onPress={verify}>
                  <Typography.Paragraph className="text-accent">{pending ? "Checking…" : "Verify"}</Typography.Paragraph>
                </SettingsRow>
                <SettingsRow
                  disclosure={false}
                  disabled={pending}
                  onPress={() => {
                    setChallenge(null);
                    setCode("");
                    setNote(null);
                  }}
                >
                  <Typography.Paragraph className="text-accent">Use another email</Typography.Paragraph>
                </SettingsRow>
              </SettingsSection>
            </Animated.View>
          ) : (
            <Animated.View key="email" entering={enter} className="gap-3">
              <SheetFormField
                label="Sign in to the local engine"
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="email"
                returnKeyType="send"
                editable={!pending}
                onSubmitEditing={sendCode}
              />
              <SettingsSection>
                <SettingsRow disclosure={false} disabled={pending || !email.includes("@")} onPress={sendCode}>
                  <Typography.Paragraph className="text-accent">{pending ? "Sending…" : "Send code"}</Typography.Paragraph>
                </SettingsRow>
              </SettingsSection>
            </Animated.View>
          )}
        </Animated.View>
      ) : !running ? (
        <Animated.View layout={layout} entering={enter} exiting={leave}>
          <SettingsNote>Start the engine to sign in.</SettingsNote>
        </Animated.View>
      ) : null}

      {note ? (
        <Animated.View layout={layout} entering={enter} exiting={leave}>
          <Typography.Paragraph
            accessibilityRole={note.error ? "alert" : undefined}
            className={`px-4 ${note.error ? "text-danger-text" : "text-grouped-secondary"}`}
          >
            {note.text}
          </Typography.Paragraph>
        </Animated.View>
      ) : null}

      <Animated.View layout={layout}>
        <SettingsSection>
          <SettingsRow
            expanded={showLog}
            trailing={
              <Typography.Paragraph className="text-grouped-secondary">{showLog ? "Hide" : "Show"}</Typography.Paragraph>
            }
            onPress={() => setShowLog((value) => !value)}
          >
            <Typography.Paragraph>Engine log</Typography.Paragraph>
          </SettingsRow>
          {showLog ? (
            <Animated.View entering={enter} exiting={leave} className="px-4 py-3">
              <Text
                selectable
                className="text-grouped-secondary"
                style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 15 }}
              >
                {engine.logs.length ? engine.logs.slice(-60).join("\n") : "No log lines yet."}
              </Text>
            </Animated.View>
          ) : null}
        </SettingsSection>
      </Animated.View>
    </SettingsContent>
  );
}
