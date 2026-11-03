import {
  isWhatsAppGroupList,
  isWhatsAppLinkState,
  isWhatsAppOverview,
  type WhatsAppGroupList,
  type WhatsAppLinkState,
  type WhatsAppOverview,
} from "@openbot/contracts/ipc";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { WHATSAPP_MOBILE_ROUTES } from "@openbot/contracts/team-protocol/whatsapp-mobile-v1";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { currentText } from "@/shared/lib/text";

/** How often the page reads the numbers while it shows (the host sends no event, as on the desktop). */
const OVERVIEW_POLL_MS = 4_000;
/** How often a running link is read again: the pairing code arrives a few seconds after the start. */
export const LINK_POLL_MS = 2_000;

/** Digits only, as the host stores a number. */
export function whatsappDigits(value: string): string {
  return value.replace(/[\s+()-]/gu, "");
}

/** A number the host accepts: 5–20 digits once spaces, +, brackets and dashes are gone. */
export function isWhatsAppNumber(value: string): boolean {
  return /^[0-9]{5,20}$/u.test(whatsappDigits(value));
}

/** "ABCD1234" → "ABCD-1234", as WhatsApp shows the code. */
export function formatPairingCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function invalid(): Error {
  return new Error(currentText().t("mobile.server.connectors.readFailed"));
}

/**
 * OpenBot Local (build 11): WhatsApp of a joined server over `whatsapp-mobile-v1` (engine 0.60.0-2+),
 * for an owner or admin. Every answer is checked with the contract's own type guards.
 */
export function useWhatsApp(serverId: string, poll = true) {
  const { canManageWhatsApp } = useMobileWorkspace();
  const { whatsappRequest } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const focused = useIsFocused();
  const available = canManageWhatsApp(serverId);
  const call = (route: string, body: TeamProtocolV2Json = {}) => whatsappRequest(serverId, route, body);
  const overview = useQuery({
    queryKey: queryKeys.serverConnector(queryScope, serverId, "whatsapp"),
    enabled: available,
    retry: false,
    refetchInterval: focused && poll ? OVERVIEW_POLL_MS : false,
    queryFn: async (): Promise<WhatsAppOverview> => {
      const value = await call(WHATSAPP_MOBILE_ROUTES.overview);
      if (!isWhatsAppOverview(value)) throw invalid();
      return value;
    },
  });
  const linkState = async (): Promise<WhatsAppLinkState> => {
    const value = await call(WHATSAPP_MOBILE_ROUTES.linkState);
    if (!isWhatsAppLinkState(value)) throw invalid();
    return value;
  };
  return {
    available,
    overview,
    linkStart: async (phoneNumber: string, ownNumber: boolean): Promise<WhatsAppLinkState> => {
      const value = await call(WHATSAPP_MOBILE_ROUTES.linkStart, { method: "code", phoneNumber, ownNumber });
      if (!isWhatsAppLinkState(value)) throw invalid();
      return value;
    },
    linkState,
    linkCancel: () => call(WHATSAPP_MOBILE_ROUTES.linkCancel),
    disconnect: (workspaceId: string) => call(WHATSAPP_MOBILE_ROUTES.disconnect, { workspaceId }),
    reconnect: (workspaceId: string) => call(WHATSAPP_MOBILE_ROUTES.reconnect, { workspaceId }),
    setEnabled: (workspaceId: string, enabled: boolean) =>
      call(WHATSAPP_MOBILE_ROUTES.enabled, { workspaceId, enabled }),
    setOwnNumber: (workspaceId: string, ownNumber: boolean) =>
      call(WHATSAPP_MOBILE_ROUTES.ownNumber, { workspaceId, ownNumber }),
    addOrchestrator: () => call(WHATSAPP_MOBILE_ROUTES.orchestrator),
    groups: async (workspaceId: string): Promise<WhatsAppGroupList> => {
      const value = await call(WHATSAPP_MOBILE_ROUTES.groups, { workspaceId });
      if (!isWhatsAppGroupList(value)) throw invalid();
      return value;
    },
    addSender: (workspaceId: string, sender: { id: string; kind: "contact" | "group"; name: string }) =>
      call(WHATSAPP_MOBILE_ROUTES.senderAdd, { workspaceId, sender }),
    removeSender: (workspaceId: string, senderId: string) =>
      call(WHATSAPP_MOBILE_ROUTES.senderRemove, { workspaceId, senderId }),
    answerRequest: (workspaceId: string, code: string, approve: boolean) =>
      call(WHATSAPP_MOBILE_ROUTES.requestAnswer, { workspaceId, code, approve }),
  };
}
