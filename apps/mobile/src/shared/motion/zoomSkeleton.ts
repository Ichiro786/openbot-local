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
