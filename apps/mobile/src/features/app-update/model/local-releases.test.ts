import { describe, expect, it } from "vitest";
import {
  compareApkTags,
  isNewerLocalVersion,
  localReleaseNotes,
  newestLocalUpdate,
  parseApkTag,
  parseLocalReleases,
  releaseAppVersion,
} from "./local-releases";

const BASE = "https://github.com/Ichiro786/openbot-local/releases/download";

function release(tag: string, body: string, asset = `openbot-local-arm64-v8a-b657542-engine-0.69.0-2.apk`, extra = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: true,
    published_at: "2026-11-13T12:00:00Z",
    body,
    assets: [{ name: asset, browser_download_url: `${BASE}/${tag}/${asset}` }],
    ...extra,
  };
}

describe("apk tags", () => {
  it("parses only apk-YYYYMMDD-N", () => {
    expect(parseApkTag("apk-20261113-2")).toEqual({ date: 20261113, n: 2 });
    expect(parseApkTag("android-v1.4.9")).toBeNull();
    expect(parseApkTag("engine-0.69.0-1")).toBeNull();
  });
  it("orders by date, then number (10 after 9)", () => {
    expect(compareApkTags("apk-20261113-10", "apk-20261113-9")).toBeGreaterThan(0);
    expect(compareApkTags("apk-20261114-1", "apk-20261113-9")).toBeGreaterThan(0);
    expect(compareApkTags("apk-20261113-1", "apk-20261113-1")).toBe(0);
  });
});

describe("versions", () => {
  it("reads the version line", () => {
    expect(releaseAppVersion("- Version 1.4.9 (versionCode 10409)")).toEqual({ name: "1.4.9", code: 10409 });
    expect(releaseAppVersion("no version")).toBeNull();
  });
  it("compares versionCode first, then versionName", () => {
    expect(isNewerLocalVersion({ name: "1.4.9", code: 10410 }, { name: "1.4.9", code: 10409 })).toBe(true);
    expect(isNewerLocalVersion({ name: "1.4.9", code: 10409 }, { name: "1.4.9", code: 10409 })).toBe(false);
    expect(isNewerLocalVersion({ name: "1.5.0", code: 10409 }, { name: "1.4.9", code: 10409 })).toBe(true);
    expect(isNewerLocalVersion({ name: "2.0.0", code: 1 }, { name: "1.4.9", code: 10409 })).toBe(false);
  });
});

describe("releases", () => {
  const current = { name: "1.4.9", code: 10409 };
  it("offers the newest newer prerelease of our repo", () => {
    const list = parseLocalReleases([
      release("apk-20261113-1", "Version 1.4.9 (versionCode 10410)"),
      release("apk-20261114-1", "Version 1.4.10 (versionCode 10411)"),
      release("engine-0.69.0-2", "Version 9.9.9 (versionCode 99999)"),
    ]);
    expect(list.map((item) => item.tag)).toEqual(["apk-20261114-1", "apk-20261113-1"]);
    expect(newestLocalUpdate(list, current)?.tag).toBe("apk-20261114-1");
  });
  it("offers nothing for the running build or older ones", () => {
    const list = parseLocalReleases([release("apk-20261113-1", "Version 1.4.9 (versionCode 10409)")]);
    expect(newestLocalUpdate(list, current)).toBeNull();
  });
  it("never takes a release without a version line, a draft, a foreign asset or a foreign download", () => {
    const list = parseLocalReleases([
      release("apk-20261104-4", "old notes without a version"),
      release("apk-20261115-1", "Version 1.5.0 (versionCode 10500)", undefined, { draft: true }),
      release("apk-20261116-1", "Version 1.5.0 (versionCode 10500)", "openbot-1.4.9.apk"),
      {
        ...release("apk-20261117-1", "Version 1.5.0 (versionCode 10500)"),
        assets: [
          {
            name: "openbot-local-arm64-v8a-abcdef1-engine-0.69.0-2.apk",
            browser_download_url:
              "https://github.com/nightly-labs/openbot/releases/download/android-v1.4.9/openbot-local-arm64-v8a-abcdef1-engine-0.69.0-2.apk",
          },
        ],
      },
    ]);
    expect(list).toEqual([]);
  });
  it("turns the release body into What's new rows", () => {
    const [item] = parseLocalReleases([
      release(
        "apk-20261113-1",
        "Intro line\n\n- Version 1.4.9 (versionCode 10410)\n- `a.apk`: 330 MiB\n### Fixed\n- Back works",
      ),
    ]);
    if (!item) throw new Error("no release");
    expect(localReleaseNotes(item)).toEqual({
      version: "1.4.9 (apk-20261113-1)",
      date: "2026-11-13",
      groups: [
        { type: "changed", heading: "Changes", items: ["Intro line", "a.apk: 330 MiB"] },
        { type: "fixed", heading: "Fixed", items: ["Back works"] },
      ],
    });
  });
});
