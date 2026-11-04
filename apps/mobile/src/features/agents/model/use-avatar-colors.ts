import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { AVATAR_COLOR_ROUTES } from "@openbot/contracts/team-protocol/avatar-color-v1";
import { useCallback, useEffect } from "react";
import { create } from "zustand";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { type AvatarTint, agentTint, isAvatarColor, type PresetHue } from "./avatar-color";

/*
 * OpenBot Local (build 11.2): the custom avatar colours of the agents (`avatar-color-v1`, engine
 * 0.60.0-3+). The frozen `/v1/agents` answer does not carry them, so the phone reads them beside it:
 * once per server, again whenever that server's agent list changes (the host sends `agents-changed`
 * after a colour is set), and from each set's own answer.
 */

type Colors = Readonly<Record<string, string>>;
const NO_COLORS: Colors = {};

export const useAvatarColorStore = create<{ byServer: Readonly<Record<string, Colors>> }>(() => ({ byServer: {} }));

/** The host's snapshot `{agents: [{agentId, color}]}`, or null when it is not one. */
function readSnapshot(value: unknown): Colors | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.agents)) return null;
  const colors: Record<string, string> = {};
  for (const entry of value.agents) {
    if (!isDynamicRecord(entry)) return null;
    const { agentId, color } = entry;
    if (typeof agentId !== "string" || !isAvatarColor(color)) return null;
    colors[agentId] = color;
  }
  return colors;
}

function store(serverId: string, colors: Colors) {
  useAvatarColorStore.setState((current) => ({ byServer: { ...current.byServer, [serverId]: colors } }));
}

/** The custom colour of one agent, if its host keeps one. */
export function useAgentAvatarColor(serverId: string, agentId: string): string | undefined {
  return useAvatarColorStore((state) => state.byServer[serverId]?.[agentId]);
}

/** What the agent's plush is tinted with: its custom colour, else its preset or automatic hue. */
export function useAgentTint(agent: { id: string; serverId: string; avatarHue: PresetHue | null }): AvatarTint {
  return agentTint(agent.avatarHue, useAgentAvatarColor(agent.serverId, agent.id));
}

/** Mounted once (home): keeps the active server's colours current. */
export function useAvatarColorsSync(): void {
  const serverId = useMobileWorkspaceSelector((current) => current.activeServer.id);
  const supported = useMobileWorkspaceSelector((current) => current.hasAvatarColors(current.activeServer.id));
  // A new list after `agents-changed` (a colour set elsewhere may or may not move the preset hue).
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const { avatarColorRequest } = useMobileWorkspaceActions();
  useEffect(() => {
    if (!supported || agents.length === 0) return;
    let current = true;
    // One read for a burst of list changes.
    const timer = setTimeout(() => {
      avatarColorRequest(serverId, AVATAR_COLOR_ROUTES.read, {}).then(
        (value) => {
          const colors = readSnapshot(value);
          if (current && colors) store(serverId, colors);
        },
        () => undefined, // The colours stay as they were; presets still draw.
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [agents, avatarColorRequest, serverId, supported]);
}

/** Sets (or clears, with null) an agent's custom colour on its host. Resolves false when the host refused. */
export function useSetAvatarColor(serverId: string): (agentId: string, color: string | null) => Promise<boolean> {
  const { avatarColorRequest } = useMobileWorkspaceActions();
  return useCallback(
    async (agentId: string, color: string | null): Promise<boolean> => {
      const before = useAvatarColorStore.getState().byServer[serverId] ?? NO_COLORS;
      // Optimistic, so every avatar of the agent follows at once.
      const next = { ...before };
      if (color === null) delete next[agentId];
      else next[agentId] = color;
      store(serverId, next);
      try {
        const colors = readSnapshot(await avatarColorRequest(serverId, AVATAR_COLOR_ROUTES.set, { agentId, color }));
        if (colors) store(serverId, colors);
        return true;
      } catch {
        store(serverId, before);
        return false;
      }
    },
    [avatarColorRequest, serverId],
  );
}
