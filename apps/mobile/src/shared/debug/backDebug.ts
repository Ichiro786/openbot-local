import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * Build 11.3 diagnostic (Syed: Back still stuck on Android 17 after changing an agent's face): Settings ›
 * Animations › Back debug (ColorOS ON, default off) shows a pill with the live navigation state, the chat's
 * Back flags and the last Back events, and keeps a ring buffer of them for "Copy log".
 */
const key = "openbot.mobile.back-debug.v1";
const MAX = 300;

export const useBackDebug = create<{ enabled: boolean; ready: boolean }>(() => ({ enabled: false, ready: false }));

export async function loadBackDebug(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(key);
    useBackDebug.setState({ enabled: stored === "1" });
  } finally {
    useBackDebug.setState({ ready: true });
  }
}

export async function saveBackDebug(enabled: boolean): Promise<void> {
  useBackDebug.setState({ enabled });
  await SecureStore.setItemAsync(key, enabled ? "1" : "0");
}

export type BackEvent = { t: number; source: string; detail: string };
const events: BackEvent[] = [];

/** Records one Back-related event (no-op while Back debug is off). */
export function logBack(source: string, detail = ""): void {
  if (!useBackDebug.getState().enabled) return;
  events.push({ t: Date.now(), source, detail });
  if (events.length > MAX) events.splice(0, events.length - MAX);
}

export function backEvents(): readonly BackEvent[] {
  return events;
}

/** Live flags of the hooks that can hold Back (leave latch, zoom-close), read by the pill on each tick. */
const flagSources = new Map<string, () => Record<string, unknown>>();
export function registerBackFlags(name: string, read: () => Record<string, unknown>): () => void {
  flagSources.set(name, read);
  return () => {
    if (flagSources.get(name) === read) flagSources.delete(name);
  };
}

export function backFlags(): string {
  const parts: string[] = [];
  for (const [name, read] of flagSources) {
    try {
      parts.push(`${name} ${JSON.stringify(read())}`);
    } catch {
      parts.push(`${name} ?`);
    }
  }
  return parts.join("\n");
}

export function formatTime(t: number): string {
  const d = new Date(t);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
