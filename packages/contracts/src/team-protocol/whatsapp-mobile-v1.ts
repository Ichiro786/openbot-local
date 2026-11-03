// OpenBot Local optional whatsapp-mobile-v1 wire contract (fork patch, not upstream).
//
// What it grants: an owner or admin of a server manages the WhatsApp numbers linked as devices of that
// host from another device, the same operations the host's own Connectors > WhatsApp page runs. On
// OpenBot Local the host is a headless engine on the user's phone, so the phone that links is the
// same one that runs it and cannot scan its own QR code: `linkStart` with `method: "code"` answers an
// 8-character pairing code to type in WhatsApp > Linked devices > Link with phone number. A QR link
// answers the QR text instead, which changes about every 20 seconds. The client reads `linkState`
// again (about every 2 seconds) while its link screen is open, as the host's own page does.
// A member cannot use any route; `requireAdmin` on the host is the only gate. No route carries a key.
import {
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const WHATSAPP_MOBILE_CAPABILITY = "whatsapp-mobile-v1";

export const WHATSAPP_MOBILE_ROUTES = {
  overview: "/v1/admin/connectors/whatsapp/overview",
  linkStart: "/v1/admin/connectors/whatsapp/link/start",
  linkState: "/v1/admin/connectors/whatsapp/link/state",
  linkCancel: "/v1/admin/connectors/whatsapp/link/cancel",
  disconnect: "/v1/admin/connectors/whatsapp/disconnect",
  reconnect: "/v1/admin/connectors/whatsapp/reconnect",
  enabled: "/v1/admin/connectors/whatsapp/enabled",
  orchestrator: "/v1/admin/connectors/whatsapp/orchestrator",
  groups: "/v1/admin/connectors/whatsapp/groups",
  senderAdd: "/v1/admin/connectors/whatsapp/senders/add",
  senderRemove: "/v1/admin/connectors/whatsapp/senders/remove",
  requestAnswer: "/v1/admin/connectors/whatsapp/requests/answer",
  ownNumber: "/v1/admin/connectors/whatsapp/own-number",
} as const;

const workspace = fields({ workspaceId: identifier });
const sender = fields({ id: string(64), kind: oneOf("contact", "group"), name: string(256) });
// `state` and `credentials` are text, so a later host state does not break an older client.
const connection = fields({
  workspaceId: identifier,
  platform: string(32),
  enabled: boolean,
  state: string(64),
  workspaceName: string(256),
  botUserId: nullable(string(256)),
  missingScopes: list(string(64), 32),
  retryAt: nullable(string(64)),
  credentials: string(64),
  orchestratorAgentId: nullable(identifier),
});
const account = fields({
  workspaceId: identifier,
  ownNumber: boolean,
  allowedSenders: list(sender, 200),
  pendingRequests: list(fields({ code: string(16), senderId: string(64), name: string(256), expiresAt: string(64) }), 3),
});
const overview = fields({ connections: list(connection, 64), accounts: list(account, 64) });
const linkState = fields({
  status: string(32),
  qr: nullable(string(1_024)),
  code: nullable(string(16)),
  workspaceId: nullable(identifier),
  error: nullable(string(32)),
});

export const WHATSAPP_MOBILE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WHATSAPP_MOBILE_ROUTES.overview, adminRoute(empty, overview)],
  [
    WHATSAPP_MOBILE_ROUTES.linkStart,
    adminRoute(
      fields({ method: oneOf("qr", "code"), phoneNumber: nullable(string(32)), ownNumber: boolean }),
      linkState,
    ),
  ],
  [WHATSAPP_MOBILE_ROUTES.linkState, adminRoute(empty, linkState)],
  [WHATSAPP_MOBILE_ROUTES.linkCancel, adminRoute(empty, empty)],
  [WHATSAPP_MOBILE_ROUTES.disconnect, adminRoute(workspace, empty)],
  [WHATSAPP_MOBILE_ROUTES.reconnect, adminRoute(workspace, empty)],
  [WHATSAPP_MOBILE_ROUTES.enabled, adminRoute(fields({ workspaceId: identifier, enabled: boolean }), empty)],
  [
    WHATSAPP_MOBILE_ROUTES.orchestrator,
    adminRoute(
      fields({}, { provider: string(128), model: string(256), reasoningEffort: string(32) }),
      fields({ agentId: identifier, sectionId: nullable(identifier) }),
    ),
  ],
  [
    WHATSAPP_MOBILE_ROUTES.groups,
    adminRoute(workspace, fields({ groups: list(fields({ id: string(80), name: string(256) }), 500) })),
  ],
  [WHATSAPP_MOBILE_ROUTES.senderAdd, adminRoute(fields({ workspaceId: identifier, sender }), empty)],
  [WHATSAPP_MOBILE_ROUTES.senderRemove, adminRoute(fields({ workspaceId: identifier, senderId: string(80) }), empty)],
  [
    WHATSAPP_MOBILE_ROUTES.requestAnswer,
    adminRoute(fields({ workspaceId: identifier, code: string(16), approve: boolean }), empty),
  ],
  [WHATSAPP_MOBILE_ROUTES.ownNumber, adminRoute(fields({ workspaceId: identifier, ownNumber: boolean }), empty)],
]);
