import type { MobileReleaseNoteGroup, MobileReleaseNotes } from "@openbot/contracts/mobile-features";
import { isNewerMobileVersion } from "@openbot/contracts/mobile-features";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

/**
 * OpenBot Local: the app updates only from the releases of its own repository, never from the
 * official OpenBot app. A build is an `apk-YYYYMMDD-N` prerelease with one
 * `openbot-local-arm64-v8a-<sha>-engine-<version>.apk`, and its notes name the app version as
 * `Version 1.4.9 (versionCode 10409)` (apk-release.yml writes that line).
 */
export const LOCAL_RELEASES_REPO = "Ichiro786/openbot-local";
export const LOCAL_RELEASES_API = `https://api.github.com/repos/${LOCAL_RELEASES_REPO}/releases?per_page=30`;
export const LOCAL_RELEASES_PAGE = `https://github.com/${LOCAL_RELEASES_REPO}/releases`;

const TAG = /^apk-(\d{8})-(\d+)$/;
const ASSET = /^openbot-local-arm64-v8a-[0-9a-f]{7,40}-engine-[0-9A-Za-z.-]+\.apk$/;
const VERSION_LINE = /Version (\d+\.\d+\.\d+) \(versionCode (\d+)\)/;
const DOWNLOAD_PREFIX = `https://github.com/${LOCAL_RELEASES_REPO}/releases/download/`;

export interface LocalAppVersion {
  name: string;
  code: number;
}

export interface LocalRelease {
  tag: string;
  version: LocalAppVersion;
  /** The APK download on github.com, in this repository only. */
  apkUrl: string;
  pageUrl: string;
  /** `YYYY-MM-DD` of publication. */
  date: string;
  body: string;
}

/** The date and number of an `apk-YYYYMMDD-N` tag, or null for any other tag. */
export function parseApkTag(tag: string): { date: number; n: number } | null {
  const match = TAG.exec(tag);
  return match ? { date: Number(match[1]), n: Number(match[2]) } : null;
}

/** Positive when tag `a` is newer than tag `b`. Tags that are not `apk-…` sort last. */
export function compareApkTags(a: string, b: string): number {
  const left = parseApkTag(a);
  const right = parseApkTag(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  return left.date - right.date || left.n - right.n;
}

/** The app version that the notes of a release name, or null when they name none. */
export function releaseAppVersion(body: string): LocalAppVersion | null {
  const match = VERSION_LINE.exec(body);
  return match?.[1] && match[2] ? { name: match[1], code: Number(match[2]) } : null;
}

/** True when `candidate` is a newer build than `current`: a higher versionCode, or the same code and a newer name. */
export function isNewerLocalVersion(candidate: LocalAppVersion, current: LocalAppVersion): boolean {
  if (candidate.code !== current.code) return candidate.code > current.code;
  return isNewerMobileVersion(candidate.name, current.name);
}

/** The OpenBot Local releases of a GitHub `releases` answer, newest tag first. Anything else is left out. */
export function parseLocalReleases(value: unknown): LocalRelease[] {
  if (!Array.isArray(value)) return [];
  const releases = value.flatMap((item): LocalRelease[] => {
    if (!isDynamicRecord(item) || item.draft === true) return [];
    const release = item;
    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    const body = typeof release.body === "string" ? release.body : "";
    const version = releaseAppVersion(body);
    if (!parseApkTag(tag) || !version) return [];
    const asset = (Array.isArray(release.assets) ? release.assets : [])
      .filter(isDynamicRecord)
      .find((entry) => typeof entry.name === "string" && ASSET.test(entry.name));
    const apkUrl = typeof asset?.browser_download_url === "string" ? asset.browser_download_url : "";
    if (!apkUrl.startsWith(`${DOWNLOAD_PREFIX}${tag}/`)) return [];
    const published = typeof release.published_at === "string" ? release.published_at : "";
    return [
      {
        tag,
        version,
        apkUrl,
        pageUrl: `${LOCAL_RELEASES_PAGE}/tag/${tag}`,
        date: published.slice(0, 10),
        body,
      },
    ];
  });
  return releases.sort((a, b) => compareApkTags(b.tag, a.tag));
}

/** The newest release that is a newer build than the running one, or null. */
export function newestLocalUpdate(releases: readonly LocalRelease[], current: LocalAppVersion): LocalRelease | null {
  return releases.find((release) => isNewerLocalVersion(release.version, current)) ?? null;
}

/** A release's notes as the What's new rows read them: `### Heading` starts a group, other lines are items. */
export function localReleaseNotes(release: LocalRelease): MobileReleaseNotes {
  const groups: MobileReleaseNoteGroup[] = [];
  let group: MobileReleaseNoteGroup | null = null;
  for (const raw of release.body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || VERSION_LINE.test(line)) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line)?.[1];
    if (heading) {
      group = { type: heading.toLowerCase(), heading, items: [] };
      groups.push(group);
      continue;
    }
    const target: MobileReleaseNoteGroup = group ?? { type: "changed", heading: "Changes", items: [] };
    if (!group) groups.push(target);
    group = target;
    target.items.push(line.replace(/^[-*]\s+/, "").replaceAll("`", ""));
  }
  return {
    version: `${release.version.name} (${release.tag})`,
    date: release.date,
    groups: groups.filter((item) => item.items.length > 0),
  };
}
