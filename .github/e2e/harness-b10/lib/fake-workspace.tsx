// E2E only: a stand-in workspace so real workspace-reading components (the chat header, the avatars,
// the agent page hero) render signed out. Unknown fields are a callable "anything" that returns itself.
import type { PropsWithChildren } from "react";
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
export const E2E_AGENT = {
  id: "e2e-agent",
  serverId: "e2e-server",
  name: "E2E Agent",
  title: "Review helper",
  avatarSeed: "e2e-seed",
  avatarHue: 270,
  avatarUrl: null,
  pinned: false,
};
const server = { id: "e2e-server", name: "E2E", status: "online", online: true, connected: true, initialConnectionPending: false };
const live = { get: () => ({ activityByServer: {} }), subscribe: () => () => undefined };
const known: Record<string, unknown> = {
  agents: [E2E_AGENT],
  servers: [server],
  activeServer: server,
  liveState: live,
  browserViewSupport: () => ({ view: true, control: true }),
};
const value: any = new Proxy({}, { get: (_t, key) => (typeof key === "string" && key in known ? known[key] : anything) });

export function FakeWorkspace({ children }: PropsWithChildren) {
  return (
    <WorkspaceContexts value={value} actions={anything}>
      {children}
    </WorkspaceContexts>
  );
}
