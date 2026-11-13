import { describe, expect, it } from "vitest";
import type { StorageScan } from "../../../modules/openbot-engine";
import {
  androidDataBytes,
  CACHE_FINDING_BYTES,
  LOG_FINDING_BYTES,
  reclaimableBytes,
  segmentArcs,
  storageFindings,
  storageSegments,
} from "./storage-model";

const MB = 1024 * 1024;

function scan(overrides: Partial<StorageScan> = {}): StorageScan {
  return {
    sizes: {},
    total: 0,
    android: null,
    deviceFree: -1,
    deviceTotal: -1,
    complete: true,
    files: 0,
    durationMs: 0,
    scannedAtMs: 0,
    installing: false,
    engineInstalled: true,
    engineRunning: true,
    updatePendingConfirm: false,
    previousRemovable: true,
    previousOrphan: false,
    downloadFiles: 0,
    ...overrides,
  };
}

describe("storageSegments", () => {
  it("keeps non-empty categories in legend order with shares of the total", () => {
    const segments = storageSegments(scan({ sizes: { other: 100, engineSystem: 300, logs: 0, workspaces: 600 } }));
    expect(segments.map((s) => s.category)).toEqual(["engineSystem", "workspaces", "other"]);
    expect(segments.map((s) => s.share)).toEqual([0.3, 0.6, 0.1]);
  });

  it("ignores nodeModules (it is inside workspaces) and negative sizes", () => {
    const segments = storageSegments(scan({ sizes: { workspaces: 10, nodeModules: 8, logs: -5 } }));
    expect(segments).toEqual([{ category: "workspaces", bytes: 10, share: 1 }]);
  });

  it("is empty for an empty scan", () => {
    expect(storageSegments(scan())).toEqual([]);
  });
});

describe("segmentArcs", () => {
  it("fills the ring with one segment", () => {
    expect(segmentArcs([{ category: "other", bytes: 1, share: 1 }], 0.01)).toEqual([{ start: 0, end: 1 }]);
  });

  it("leaves equal gaps and never passes 1", () => {
    const arcs = segmentArcs(
      [
        { category: "engineSystem", bytes: 1, share: 0.5 },
        { category: "workspaces", bytes: 1, share: 0.5 },
      ],
      0.02,
    );
    expect(arcs[0]?.start).toBeCloseTo(0.01);
    expect(arcs[0]?.end).toBeCloseTo(0.49);
    expect(arcs[1]?.start).toBeCloseTo(0.51);
    expect(arcs[1]?.end).toBeCloseTo(0.99);
  });
});

describe("storageFindings", () => {
  it("offers the previous engine only once the current one is confirmed", () => {
    const sizes = { previous: 900 * MB };
    expect(storageFindings(scan({ sizes })).map((f) => f.kind)).toEqual(["previousEngine"]);
    expect(storageFindings(scan({ sizes, previousRemovable: false }))).toEqual([]);
    expect(storageFindings(scan({ sizes, installing: true }))).toEqual([]);
  });

  it("offers interrupted installs and downloads at any size, but never while installing", () => {
    const sizes = { partial: 1, downloads: 2 };
    expect(storageFindings(scan({ sizes })).map((f) => f.category)).toEqual(["downloads", "partial"]);
    expect(storageFindings(scan({ sizes, installing: true }))).toEqual([]);
  });

  it("offers caches and logs only when they are big", () => {
    expect(
      storageFindings(scan({ sizes: { packageCaches: CACHE_FINDING_BYTES - 1, logs: LOG_FINDING_BYTES - 1 } })),
    ).toEqual([]);
    const big = storageFindings(scan({ sizes: { packageCaches: CACHE_FINDING_BYTES, logs: LOG_FINDING_BYTES } }));
    expect(big.map((f) => f.kind)).toEqual(["bigCaches", "bigLogs"]);
  });

  it("does not offer package caches without an installed engine (they are cleaned inside it)", () => {
    expect(storageFindings(scan({ engineInstalled: false, sizes: { packageCaches: 500 * MB } }))).toEqual([]);
  });

  it("never offers what the user keeps", () => {
    const keep = {
      engineSystem: 3000 * MB,
      workspaces: 2000 * MB,
      openbotData: 900 * MB,
      antigravity: 400 * MB,
      toolCaches: 300 * MB,
      otherCaches: 300 * MB,
      otherUserData: 100 * MB,
      other: 50 * MB,
    };
    expect(storageFindings(scan({ sizes: keep }))).toEqual([]);
  });

  it("sorts by size and sums what can be freed", () => {
    const findings = storageFindings(scan({ sizes: { previous: 10, partial: 30, downloads: 20, appCache: 60 * MB } }));
    expect(findings.map((f) => f.category)).toEqual(["appCache", "partial", "downloads", "previous"]);
    expect(reclaimableBytes(findings)).toBe(60 * MB + 60);
  });
});

describe("androidDataBytes", () => {
  it("is Android's data figure, which already includes the cache", () => {
    expect(androidDataBytes(scan({ android: { appBytes: 430, dataBytes: 7000, cacheBytes: 2 } }))).toBe(7000);
    expect(androidDataBytes(scan())).toBeNull();
  });
});
