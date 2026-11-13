// Settings › Local engine › Storage: the pure part. The native scan (EngineStorage.kt) measures
// bytes per category; this file turns a scan into chart segments and the "not needed" findings.
// The native cleanups re-check every guard, so these rules only decide what the screen offers.
import type { StorageCategory, StorageCleanable, StorageScan } from "../../../modules/openbot-engine";

const MB = 1024 * 1024;
/** Package caches smaller than this are not worth a finding. */
export const CACHE_FINDING_BYTES = 50 * MB;
/** Logs above this are "oversized". */
export const LOG_FINDING_BYTES = 20 * MB;
export const APP_CACHE_FINDING_BYTES = 50 * MB;

/** The legend's order: what the user keeps first, then what can go. */
export const STORAGE_ORDER: readonly StorageCategory[] = [
  "engineSystem",
  "workspaces",
  "openbotData",
  "antigravity",
  "otherUserData",
  "packageCaches",
  "toolCaches",
  "otherCaches",
  "previous",
  "partial",
  "downloads",
  "logs",
  "appCache",
  "other",
];

export interface StorageSegment {
  category: StorageCategory;
  bytes: number;
  /** 0..1 of the scanned total. */
  share: number;
}

/** Non-empty categories in legend order, each with its share of the total. */
export function storageSegments(scan: StorageScan): StorageSegment[] {
  const total = STORAGE_ORDER.reduce((sum, key) => sum + Math.max(0, scan.sizes[key] ?? 0), 0);
  if (total <= 0) return [];
  return STORAGE_ORDER.flatMap((category) => {
    const bytes = Math.max(0, scan.sizes[category] ?? 0);
    return bytes > 0 ? [{ category, bytes, share: bytes / total }] : [];
  });
}

/** Each segment's [start, end) on 0..1, with a gap between neighbours (none for a single segment). */
export function segmentArcs(segments: readonly StorageSegment[], gap: number): { start: number; end: number }[] {
  if (segments.length === 0) return [];
  if (segments.length === 1) return [{ start: 0, end: 1 }];
  const usable = Math.max(0, 1 - gap * segments.length);
  let at = 0;
  return segments.map((segment) => {
    const length = segment.share * usable;
    const arc = { start: at + gap / 2, end: at + gap / 2 + length };
    at += length + gap;
    return arc;
  });
}

export type FindingKind =
  | "previousEngine"
  | "interruptedInstall"
  | "oldDownloads"
  | "bigCaches"
  | "bigLogs"
  | "appCache";

export interface StorageFinding {
  kind: FindingKind;
  category: StorageCleanable;
  bytes: number;
}

/**
 * What is stuck or not needed, biggest first. Leftovers of the engine's own install pipeline are
 * findings at any size; caches and logs only when they are big enough to matter.
 */
export function storageFindings(scan: StorageScan): StorageFinding[] {
  const size = (category: StorageCategory) => Math.max(0, scan.sizes[category] ?? 0);
  const findings: StorageFinding[] = [];
  // r.prev is the rollback target until the new engine has reached ready: never offered before.
  if (size("previous") > 0 && scan.previousRemovable && !scan.installing)
    findings.push({ kind: "previousEngine", category: "previous", bytes: size("previous") });
  if (!scan.installing) {
    if (size("partial") > 0) findings.push({ kind: "interruptedInstall", category: "partial", bytes: size("partial") });
    if (size("downloads") > 0) findings.push({ kind: "oldDownloads", category: "downloads", bytes: size("downloads") });
    if (scan.engineInstalled && size("packageCaches") >= CACHE_FINDING_BYTES)
      findings.push({ kind: "bigCaches", category: "packageCaches", bytes: size("packageCaches") });
  }
  if (size("logs") >= LOG_FINDING_BYTES) findings.push({ kind: "bigLogs", category: "logs", bytes: size("logs") });
  if (size("appCache") >= APP_CACHE_FINDING_BYTES)
    findings.push({ kind: "appCache", category: "appCache", bytes: size("appCache") });
  return findings.sort((a, b) => b.bytes - a.bytes);
}

export function reclaimableBytes(findings: readonly StorageFinding[]): number {
  return findings.reduce((sum, finding) => sum + finding.bytes, 0);
}

/**
 * Android's Data + Cache for this app (StorageStats.dataBytes already includes the cache; Settings
 * shows "Data" as the rest). The APK ("App") is not in the scan. Null when Android gave no figure.
 */
export function androidDataBytes(scan: StorageScan): number | null {
  return scan.android ? scan.android.dataBytes : null;
}
