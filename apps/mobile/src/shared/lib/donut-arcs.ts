// The pure geometry of DonutChart (shared/components/donut-chart.tsx), testable without React Native.
export interface DonutArc {
  key: string;
  color: string;
  /** 0..1 on the ring, clockwise from the top. An empty arc has start === end. */
  start: number;
  end: number;
}

export interface DonutSegment {
  key: string;
  color: string;
  value: number;
}

/**
 * Arcs for `segments` with `gap` (share of the ring) between non-empty neighbours. A segment of 0
 * keeps a zero-length arc at its place, so a later value can grow out of it instead of popping in.
 */
export function donutArcs(segments: readonly DonutSegment[], gap = 0.006): DonutArc[] {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const shown = segments.filter((segment) => segment.value > 0).length;
  if (total <= 0) return segments.map(({ key, color }) => ({ key, color, start: 0, end: 0 }));
  const gaps = shown > 1 ? gap : 0;
  const usable = Math.max(0, 1 - gaps * shown);
  let at = 0;
  return segments.map(({ key, color, value }) => {
    if (value <= 0) return { key, color, start: at, end: at };
    const start = at + gaps / 2;
    const end = start + (value / total) * usable;
    at = end + gaps / 2;
    return { key, color, start, end };
  });
}
