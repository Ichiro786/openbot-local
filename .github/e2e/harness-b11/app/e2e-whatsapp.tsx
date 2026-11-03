// E2E HARNESS (build11-review-ci): the real WhatsAppScreen (server settings › Connectors › WhatsApp)
// over a fake engine that speaks whatsapp-mobile-v1 like engine-0.60.0-2: overview, link start by
// pairing code, link state (code, then linked), cancel. `cap=0` is a host without the capability, which
// must show the unsupported note and nothing else. Every request is shown as "WA <route>" text.
import { useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { WhatsAppScreen } from "@/features/servers/screens/whatsapp-screen";
import { WorkspaceContexts } from "@/features/workspace/context/workspace-store";

const anything: any = new Proxy(function () {}, {
  get: (_t, key) => {
    if (key === Symbol.iterator) return function* () {};
    if (key === Symbol.toPrimitive) return () => "";
    if (key === "then") return undefined;
    if (key === "length") return 0;
    return anything;
  },
  apply: () => anything,
});
const server = { id: "e2e-server", name: "E2E", status: "online", online: true, connected: true, initialConnectionPending: false };
const NUMBER = "15551234567";
const connection = {
  workspaceId: NUMBER,
  platform: "whatsapp",
  enabled: true,
  state: "connected",
  workspaceName: "E2E phone",
  botUserId: null,
  missingScopes: [],
  retryAt: null,
  credentials: "saved",
  orchestratorAgentId: null,
};

export default function E2EWhatsApp() {
  "use no memo";
  const { cap } = useLocalSearchParams<{ cap?: string }>();
  const capable = cap !== "0";
  const engine = useRef({ linked: false, polls: 0, linking: false });
  const [log, setLog] = useState("none");
  const whatsappRequest = async (_serverId: string, route: string, body: any) => {
    const name = route.replace("/v1/admin/connectors/whatsapp/", "");
    setLog(`WA ${name} ${JSON.stringify(body ?? {})}`);
    const e = engine.current;
    const idle = { status: "idle", qr: null, code: null, workspaceId: null, error: null };
    switch (name) {
      case "overview":
        return e.linked
          ? { connections: [connection], accounts: [{ workspaceId: NUMBER, ownNumber: true, allowedSenders: [], pendingRequests: [] }] }
          : { connections: [], accounts: [] };
      case "link/start":
        e.linking = true;
        e.polls = 0;
        return { ...idle, status: "waiting" };
      case "link/state":
        if (!e.linking) return idle;
        e.polls += 1;
        if (e.polls >= 4) {
          e.linking = false;
          e.linked = true;
          return { ...idle, status: "linked", workspaceId: NUMBER };
        }
        return { ...idle, status: "waiting", code: "ABCD1234" };
      case "link/cancel":
        e.linking = false;
        return {};
      default:
        return {};
    }
  };
  const value: any = new Proxy(
    {},
    {
      get: (_t, key) =>
        ({ servers: [server], agents: [], activeServer: server, canManageWhatsApp: () => capable }) [key as string] ??
        anything,
    },
  );
  const actions: any = new Proxy({}, { get: (_t, key) => (key === "whatsappRequest" ? whatsappRequest : anything) });
  return (
    <View style={{ flex: 1, backgroundColor: "#101418" }}>
      <Text style={{ color: "#fff", marginTop: 40, marginHorizontal: 16 }}>{`E2E WHATSAPP OPEN cap=${capable ? 1 : 0}`}</Text>
      <Text style={{ color: "#fff", marginHorizontal: 16 }}>{log}</Text>
      <WorkspaceContexts value={value} actions={actions}>
        <WhatsAppScreen />
      </WorkspaceContexts>
    </View>
  );
}
