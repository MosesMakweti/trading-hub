/**
 * Incremental series updates for lightweight-charts.
 *
 * A replay step changes a chart's data only at its end (the forming candle,
 * one or two new candles, and the matching indicator values — plus, rarely,
 * an older point such as Ichimoku's lagging span). Replacing the whole series
 * with setData on every step costs O(history) work inside the chart library;
 * this compares the new points with the ones the series already holds and
 * sends only the changed ones through `update` (with `historicalUpdate` for
 * an older point). Anything that isn't a small change at the same times — a
 * different first bar, removed bars, a long new tail — falls back to setData,
 * so the series always ends up holding exactly `next`.
 */

export interface SeriesLike<P> {
  setData(data: P[]): void;
  update(point: P, historicalUpdate?: boolean): void;
}

export type SyncResult = { kind: "set" } | { kind: "patch"; points: number } | { kind: "none" };

/** Changes larger than this are cheaper as one setData. */
export const MAX_PATCH_POINTS = 64;

const FIELDS = ["value", "open", "high", "low", "close", "color", "wickColor", "borderColor", "lineColor", "topColor", "bottomColor"] as const;

function samePoint(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a.time !== b.time) return false;
  for (const f of FIELDS) if (a[f] !== b[f]) return false;
  return true;
}

export function syncSeries<P extends { time: unknown }>(series: SeriesLike<P>, prev: readonly P[] | undefined, next: readonly P[]): SyncResult {
  const full = (): SyncResult => {
    series.setData(next as P[]);
    return { kind: "set" };
  };
  if (!prev || prev.length === 0 || next.length < prev.length || next.length - prev.length > MAX_PATCH_POINTS) return full();
  if (next.length && prev[0].time !== next[0].time) return full();
  const changed: number[] = [];
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i] as unknown as Record<string, unknown>;
    const b = next[i] as unknown as Record<string, unknown>;
    if (a.time !== b.time) return full(); // the time axis shifted: not an append
    if (!samePoint(a, b)) {
      changed.push(i);
      if (changed.length > MAX_PATCH_POINTS) return full();
    }
  }
  for (let i = prev.length; i < next.length; i++) changed.push(i);
  if (changed.length === 0) return { kind: "none" };
  if (changed.length > MAX_PATCH_POINTS) return full();
  const last = prev.length - 1;
  for (const i of changed) series.update(next[i], i < last);
  return { kind: "patch", points: changed.length };
}
