import type { MobileReleaseNotes } from "@openbot/contracts/mobile-features";
import { useQuery } from "@tanstack/react-query";
import * as Application from "expo-application";
import * as SecureStore from "expo-secure-store";
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { AppState, Linking } from "react-native";
import { create } from "zustand";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { supportLog } from "@/features/support/model/support-log";
import { refreshMobileFeatures } from "@/shared/lib/mobile-features";
import {
  LOCAL_RELEASES_API,
  LOCAL_RELEASES_PAGE,
  type LocalAppVersion,
  type LocalRelease,
  localReleaseNotes,
  newestLocalUpdate,
  parseLocalReleases,
} from "./local-releases";

export type AppUpdate =
  | { kind: "ready"; id: string }
  | { kind: "store"; id: string; version: string; apkUrl: string; pageUrl: string };

export const MOBILE_CHANGELOG_URL = LOCAL_RELEASES_PAGE;
const RELEASES_TIMEOUT_MS = 10_000;
const RELEASES_STALE_MS = 15 * 60_000;

function runningLocalVersion(): LocalAppVersion | null {
  const name = Application.nativeApplicationVersion;
  const code = Number(Application.nativeBuildVersion);
  return name && Number.isFinite(code) ? { name, code } : null;
}

async function fetchLocalReleases(signal: AbortSignal): Promise<LocalRelease[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  const timeout = setTimeout(abort, RELEASES_TIMEOUT_MS);
  try {
    const response = await fetch(LOCAL_RELEASES_API, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`The releases answered ${response.status}.`);
    return parseLocalReleases(await response.json());
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

function useLocalReleases(enabled = true) {
  return useQuery<LocalRelease[]>({
    queryKey: ["openbot-local-releases"],
    enabled,
    retry: false,
    staleTime: RELEASES_STALE_MS,
    refetchOnWindowFocus: true,
    queryFn: ({ signal }) => fetchLocalReleases(signal),
  });
}

const key = "openbot.mobile.appUpdate.dismissed.v1";

const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000;
let lastUpdateCheck = Date.now();
let updateCheckRuns = false;

async function checkForDownloadableUpdate(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled || updateCheckRuns) return;
  if (Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
  lastUpdateCheck = Date.now();
  updateCheckRuns = true;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable || result.isRollBackToEmbedded) await Updates.fetchUpdateAsync();
  } catch (error) {
    supportLog.add("warn", "app", `The update check failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    updateCheckRuns = false;
  }
}

const useDismissedAppUpdate = create<{ dismissed: string | null; ready: boolean }>(() => ({
  dismissed: null,
  ready: false,
}));

async function loadDismissedAppUpdate(): Promise<void> {
  if (useDismissedAppUpdate.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (!useDismissedAppUpdate.getState().ready) useDismissedAppUpdate.setState({ dismissed: stored });
  } finally {
    useDismissedAppUpdate.setState({ ready: true });
  }
}

export async function dismissAppUpdate(update: AppUpdate): Promise<void> {
  useDismissedAppUpdate.setState({ dismissed: update.id, ready: true });
  await SecureStore.setItemAsync(key, update.id);
}

let rollbackFetched = false;

async function fetchRollback(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled || Updates.isEmbeddedLaunch || rollbackFetched) return;
  rollbackFetched = true;
  try {
    await Updates.fetchUpdateAsync();
  } catch (error) {
    supportLog.add(
      "warn",
      "app",
      `The rollback fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function downloadedUpdateId(update: Updates.UpdateInfo): string {
  return update.type === Updates.UpdateInfoType.NEW
    ? `ota:${update.updateId}`
    : `ota:rollback:${update.createdAt.toISOString()}`;
}

export function useAppUpdate(): AppUpdate | null {
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  const releases = useLocalReleases();
  const { isUpdatePending, downloadedUpdate, availableUpdate } = Updates.useUpdates();
  const rollbackWaits = availableUpdate?.type === Updates.UpdateInfoType.ROLLBACK && !isUpdatePending;
  const dismissed = useDismissedAppUpdate((state) => (state.ready ? state.dismissed : undefined));

  useEffect(() => {
    void loadDismissedAppUpdate();
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkForDownloadableUpdate();
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (rollbackWaits) void fetchRollback();
  }, [rollbackWaits]);
  useEffect(() => {
    if (!apiUrl) return;
    void refreshMobileFeatures(apiUrl);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshMobileFeatures(apiUrl);
    });
    return () => subscription.remove();
  }, [apiUrl]);
  const refetchReleases = releases.refetch;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetchReleases();
    });
    return () => subscription.remove();
  }, [refetchReleases]);

  if (dismissed === undefined) return null;
  const current = runningLocalVersion();
  const newer = current && releases.data ? newestLocalUpdate(releases.data, current) : null;
  const update: AppUpdate | null =
    isUpdatePending && downloadedUpdate
      ? { kind: "ready", id: downloadedUpdateId(downloadedUpdate) }
      : newer
        ? {
            kind: "store",
            id: `local:${newer.tag}`,
            version: newer.version.name,
            apkUrl: newer.apkUrl,
            pageUrl: newer.pageUrl,
          }
        : null;
  return update && update.id !== dismissed ? update : null;
}

export async function installAppUpdate(update: AppUpdate, reloadColor: string): Promise<void> {
  if (update.kind === "ready") {
    await Updates.reloadAsync({
      reloadScreenOptions: { backgroundColor: reloadColor, fade: true, spinner: { enabled: false } },
    });
    return;
  }
  // OpenBot Local: the APK of our release downloads in the browser; its release page is the fallback.
  await Linking.openURL(update.apkUrl).catch(() => Linking.openURL(update.pageUrl));
}

export async function openStorePage(_options: { review?: boolean } = {}): Promise<void> {
  await Linking.openURL(LOCAL_RELEASES_PAGE);
}

export function useAppUpdateNotes(enabled: boolean) {
  return useQuery<LocalRelease[], Error, MobileReleaseNotes[]>({
    queryKey: ["openbot-local-releases"],
    enabled,
    retry: false,
    staleTime: RELEASES_STALE_MS,
    queryFn: ({ signal }) => fetchLocalReleases(signal),
    select: (releases) => {
      const current = runningLocalVersion();
      return releases
        .filter((release) => current === null || newestLocalUpdate([release], current) !== null)
        .map(localReleaseNotes);
    },
  });
}
