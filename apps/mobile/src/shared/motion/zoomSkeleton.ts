import type { SkImage } from "@shopify/react-native-skia";

/**
 * Build 11.2: what the zoom-open skeleton needs to draw a chat's shapes where they will be. The real
 * ColorOS header and composer record their measured sizes per chat (by chat id) each time they lay
 * out, and the skeleton reads them on the next open of that chat; the first open of a chat in a
 * session uses the defaults. Positions come from the header's and composer's own layout constants,
 * so the skeleton cannot drift from them.
 */
export type ZoomSkeletonRecord = {
  /** The name pill's width (it hugs the name). */
  pillWidth?: number;
  /** The agent's avatar colour, for the avatar dot. */
  avatarColor?: string;
  /** The composer capsule at rest (it hugs its placeholder). */
  composerWidth?: number;
  composerHeight?: number;
};

const records = new Map<string, ZoomSkeletonRecord>();
/** Bounded: one entry per chat opened this session is small, but never let it grow without end. */
const MAX_RECORDS = 200;

export function recordZoomSkeleton(key: string, values: ZoomSkeletonRecord): void {
  const current = records.get(key);
  if (
    current &&
    current.pillWidth === (values.pillWidth ?? current.pillWidth) &&
    current.avatarColor === (values.avatarColor ?? current.avatarColor) &&
    current.composerWidth === (values.composerWidth ?? current.composerWidth) &&
    current.composerHeight === (values.composerHeight ?? current.composerHeight)
  )
    return;
  if (!current && records.size >= MAX_RECORDS) {
    const oldest = records.keys().next().value;
    if (oldest !== undefined) records.delete(oldest);
  }
  records.set(key, { ...current, ...values });
}

export function zoomSkeletonFor(key: string | undefined): ZoomSkeletonRecord {
  return (key && records.get(key)) || {};
}

/**
 * Build 11.3 motion (open hand-off): the still of each chat as its last zoom-close showed it. The next
 * zoom-open of that chat grows this still instead of the skeleton, so the open is the close played
 * forwards and the live chat replaces a picture of itself. Used once (the open owns and disposes it);
 * a still from another window size or theme is dropped. A few chats only (a half-size still each).
 */
type ChatStill = { image: SkImage; width: number; height: number; theme: string };
const stills = new Map<string, ChatStill>();
const MAX_STILLS = 3;

/** Skia may still draw an image for the frame after its view unmounts: dispose a little later. */
export function disposeStillLater(image: SkImage | null | undefined): void {
  if (image) setTimeout(() => image.dispose(), 500);
}

export function keepChatStill(key: string, still: ChatStill): void {
  disposeStillLater(stills.get(key)?.image);
  stills.delete(key);
  stills.set(key, still);
  for (const [oldest, entry] of stills) {
    if (stills.size <= MAX_STILLS) break;
    stills.delete(oldest);
    disposeStillLater(entry.image);
  }
}

export function takeChatStill(key: string | undefined, width: number, height: number, theme: string): SkImage | null {
  const still = key ? stills.get(key) : undefined;
  if (!key || !still) return null;
  stills.delete(key);
  if (still.width === width && still.height === height && still.theme === theme) return still.image;
  disposeStillLater(still.image);
  return null;
}
