// OpenBot Local: a small status pill for the on-device engine (modules/openbot-engine). Tapping it
// opens a panel with the engine status, Start/Stop, and the email-code sign-in that runs over the
// engine's control socket (login/start, then login/verify).
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  type ControlResponse,
  controlStatus,
  type EnginePhase,
  isEngineSupported,
  loginStart,
  loginVerify,
  logout,
  useOpenBotEngine,
} from "../../../modules/openbot-engine";

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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function answerText(response: ControlResponse): string {
  const fields = Object.entries(response.fields)
    .map(([key, value]) => `${key}=${value}`)
    .join("  ");
  return `${response.status}${fields ? `  ${fields}` : response.body ? `  ${response.body.trim()}` : ""}`;
}

export function LocalEngineBanner() {
  if (!isEngineSupported) return null;
  return <LocalEngineBannerInner />;
}

function LocalEngineBannerInner() {
  const insets = useSafeAreaInsets();
  const engine = useOpenBotEngine({ watchLogs: false });
  const [open, setOpen] = useState(false);
  const { status } = engine;
  const progress = status.progress == null ? "" : ` ${Math.round(status.progress * 100)}%`;
  const label = status.phase === "installing" ? `${status.installStep ?? "installing"}${progress}` : status.phase;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Local engine ${label}. Open engine panel`}
        onPress={() => setOpen(true)}
        style={[styles.pill, { top: insets.top + 6 }]}
      >
        <View style={[styles.dot, { backgroundColor: PHASE_COLOR[status.phase] }]} />
        <Text style={styles.pillText}>Engine: {label}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <EnginePanel engine={engine} onClose={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

function EnginePanel({ engine, onClose }: { engine: ReturnType<typeof useOpenBotEngine>; onClose: () => void }) {
  const { status, busy } = engine;
  const running = status.phase === "running";
  const [account, setAccount] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refreshAccount = useCallback(async () => {
    try {
      const answer = await controlStatus();
      const fields = answer.fields;
      setAccount([fields.account, fields.server && `server ${fields.server}`].filter(Boolean).join(", ") || answerText(answer));
    } catch (error) {
      setAccount(null);
      setNote(describe(error));
    }
  }, []);

  useEffect(() => {
    if (running) void refreshAccount();
  }, [running, refreshAccount]);

  const act = useCallback(async (work: () => Promise<void>) => {
    setPending(true);
    setNote(null);
    try {
      await work();
    } catch (error) {
      setNote(describe(error));
    } finally {
      setPending(false);
    }
  }, []);

  const sendCode = () =>
    act(async () => {
      const answer = await loginStart(email.trim());
      const next = answer.fields.challenge;
      if (!answer.ok || !next) throw new Error(`Sign-in did not start: ${answerText(answer)}`);
      setChallenge(next);
      setNote("Check your email for the code.");
    });

  const verify = () =>
    act(async () => {
      if (!challenge) return;
      const answer = await loginVerify(challenge, code.trim());
      if (!answer.ok) throw new Error(`Code not accepted: ${answerText(answer)}`);
      setChallenge(null);
      setCode("");
      setNote("Signed in.");
      await refreshAccount();
    });

  const signOut = () =>
    act(async () => {
      const answer = await logout();
      if (!answer.ok) throw new Error(answerText(answer));
      await refreshAccount();
    });

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <View style={styles.row}>
        <Text style={styles.title}>Local engine</Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
          <Text style={styles.link}>Close</Text>
        </Pressable>
      </View>
      <Text style={styles.body}>
        Status: {status.phase}
        {status.installStep ? ` (${status.installStep})` : ""}
        {status.progress == null ? "" : ` ${Math.round(status.progress * 100)}%`}
      </Text>
      {status.message ? <Text style={styles.muted}>{status.message}</Text> : null}
      <Text style={styles.muted}>Version: {status.installedVersion ?? "not installed"}</Text>
      {status.lastExitCode != null ? <Text style={styles.muted}>Last exit code: {status.lastExitCode}</Text> : null}

      <View style={styles.buttons}>
        <Button label="Start" disabled={busy || running} onPress={() => void act(engine.start)} />
        <Button label="Stop" disabled={status.phase === "stopped" || status.phase === "idle"} onPress={() => void act(engine.stop)} />
        <Button label="Restart" disabled={busy} onPress={() => void act(engine.restart)} />
      </View>

      <Text style={styles.section}>Account</Text>
      {running ? (
        <>
          <Text style={styles.body}>{account ?? "Unknown"}</Text>
          {challenge ? (
            <>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="Code from the email"
                placeholderTextColor="#8E8E93"
                keyboardType="number-pad"
                autoComplete="one-time-code"
              />
              <View style={styles.buttons}>
                <Button label="Verify" disabled={pending || !code.trim()} onPress={() => void verify()} />
                <Button label="Back" disabled={pending} onPress={() => setChallenge(null)} />
              </View>
            </>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor="#8E8E93"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
              />
              <View style={styles.buttons}>
                <Button label="Sign in" disabled={pending || !email.includes("@")} onPress={() => void sendCode()} />
                <Button label="Sign out" disabled={pending} onPress={() => void signOut()} />
                <Button label="Refresh" disabled={pending} onPress={() => void refreshAccount()} />
              </View>
            </>
          )}
        </>
      ) : (
        <Text style={styles.muted}>Start the engine to sign in.</Text>
      )}
      {pending ? <ActivityIndicator style={styles.spinner} /> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </ScrollView>
  );
}

function Button({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled ? styles.buttonDisabled : null]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    right: 12,
    zIndex: 1000,
    elevation: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(28,28,30,0.85)",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    maxHeight: "85%",
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: "#1C1C1E",
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  section: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", marginTop: 20, marginBottom: 6 },
  body: { color: "#FFFFFF", fontSize: 15, marginBottom: 4 },
  muted: { color: "#AEAEB2", fontSize: 13, marginBottom: 4 },
  note: { color: "#FFD60A", fontSize: 13, marginTop: 10 },
  link: { color: "#0A84FF", fontSize: 16 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  button: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#0A84FF" },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  input: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    color: "#FFFFFF",
    backgroundColor: "#2C2C2E",
    fontSize: 15,
  },
  spinner: { marginTop: 10 },
});
