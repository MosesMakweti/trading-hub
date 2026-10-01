// Pure series transforms for charts. Presentation-only: they DERIVE display
// annotations (change since the previous point, running peak, distance from
// peak, the max-drawdown span) from a series the services already computed —
// they never recompute a metric the app reports elsewhere.
// Plain module so it's unit-testable in the node test environment.

export interface SeriesPoint {
  /** dateKey (YYYY-MM-DD) or any category label. */
  x: string;
  value: number;
}

export interface AnnotatedPoint extends SeriesPoint {
  index: number;
  /** value − previous value (vs `baseline` for the first point). */
  change: number;
  /** Running maximum up to and including this point (baseline counts as the opening level). */
  peak: number;
  /** peak − value, ≥ 0. Zero at a new high. */
  fromPeak: number;
  /** True when this point sets a new running high. */
  isNewHigh: boolean;
}

export interface SeriesSummary {
  start: number;
  end: number;
  /** end − start. */
  change: number;
  high: { index: number; value: number };
  low: { index: number; value: number };
  /** Largest peak-to-trough decline, as a positive amount; null with no decline.
   *  `peakIndex` is −1 when the peak was the opening baseline itself. */
  maxDrawdown: { peakIndex: number; troughIndex: number; amount: number } | null;
  /** Points that moved up / down vs the previous point (flat excluded). */
  ups: number;
  downs: number;
}

/**
 * Annotates a series for display. `baseline` is the level the series starts
 * from (0 for cumulative R / %, the opening balance for $): the first point's
 * `change` is measured from it and it seeds the running peak, so an account
 * that opens with a loss shows that loss as distance from its starting level.
 */
export function annotateSeries(points: SeriesPoint[], baseline = 0): { points: AnnotatedPoint[]; summary: SeriesSummary | null } {
  if (points.length === 0) return { points: [], summary: null };

  let peak = baseline;
  let prev = baseline;
  let peakIndex = -1;
  let best: SeriesSummary["maxDrawdown"] = null;
  let high = { index: 0, value: points[0].value };
  let low = { index: 0, value: points[0].value };
  let ups = 0;
  let downs = 0;

  const out = points.map((p, index) => {
    const change = p.value - prev;
    if (change > 0) ups++;
    else if (change < 0) downs++;
    const isNewHigh = p.value > peak;
    if (p.value >= peak) {
      peak = p.value;
      peakIndex = index;
    }
    const fromPeak = Math.max(0, peak - p.value);
    if (fromPeak > 0 && (best == null || fromPeak > best.amount)) {
      best = { peakIndex, troughIndex: index, amount: fromPeak };
    }
    if (p.value > high.value) high = { index, value: p.value };
    if (p.value < low.value) low = { index, value: p.value };
    prev = p.value;
    return { ...p, index, change, peak, fromPeak, isNewHigh };
  });

  return {
    points: out,
    summary: {
      start: baseline,
      end: points[points.length - 1].value,
      change: points[points.length - 1].value - baseline,
      high,
      low,
      maxDrawdown: best,
      ups,
      downs,
    },
  };
}

/**
 * Where a horizontal `baseline` falls inside a [min, max] value domain, as a
 * 0–1 offset from the TOP — the stop position for an SVG gradient that colours
 * a line/area above the baseline one way and below it another. Clamped, so a
 * series entirely above (or below) the baseline gets one colour.
 */
export function baselineOffset(min: number, max: number, baseline: number): number {
  if (!(max > min)) return baseline <= min ? 1 : 0;
  return Math.max(0, Math.min(1, (max - baseline) / (max - min)));
}

/** Min/max of a series' values, optionally widened to include `include` (e.g. a baseline). */
export function extent(values: number[], include?: number): [number, number] {
  let min = include ?? Infinity;
  let max = include ?? -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return [0, 0];
  return [min, max];
}

/** A padded domain so lines never touch the plot's top/bottom edge. */
export function paddedDomain(values: number[], { include, pad = 0.08 }: { include?: number; pad?: number } = {}): [number, number] {
  const [min, max] = extent(values, include);
  const span = max - min || Math.abs(max) || 1;
  return [min - span * pad, max + span * pad];
}

/** Largest absolute value — for symmetric diverging scales around zero. */
export function maxAbs(values: number[]): number {
  let m = 0;
  for (const v of values) if (Number.isFinite(v) && Math.abs(v) > m) m = Math.abs(v);
  return m;
}

/** Share of each part in a whole (0–100), ignoring negatives; parts sum to ~100. */
export function shares(values: number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  return values.map((v) => (total > 0 ? (Math.max(0, v) / total) * 100 : 0));
}

/**
 * "Nice" axis ticks covering [min, max] — steps of 1/2/2.5/5 × 10ⁿ — so axes
 * read 0 / 2R / 4R / 6R instead of 1.5R / 3.5R / 5.5R. Returns the rounded
 * domain plus the ticks; always includes the endpoints of the domain.
 */
export function niceTicks(min: number, max: number, target = 5): { domain: [number, number]; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { domain: [0, 1], ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad / 2;
    max += pad / 2;
  }
  const raw = (max - min) / Math.max(1, target - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

/**
 * Indices to place time ticks on, for an index-based x axis over dateKeys:
 * the first point of each calendar week (short spans), month, or year (long
 * spans), thinned evenly to at most `max`. Calendar-boundary ticks never
 * repeat a label the way evenly-spaced ticks do ("Sep, Sep").
 */
export function timeTickIndices(dateKeys: string[], max = 7): number[] {
  if (dateKeys.length === 0) return [];
  const first = Date.parse(`${dateKeys[0]}T00:00:00Z`);
  const last = Date.parse(`${dateKeys[dateKeys.length - 1]}T00:00:00Z`);
  const span = (last - first) / 86_400_000;
  const bucket = (k: string) => {
    if (span <= 50) {
      const d = new Date(`${k}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
      return d.toISOString().slice(0, 10);
    }
    return span <= 800 ? k.slice(0, 7) : k.slice(0, 4);
  };
  const idx: number[] = [];
  let prev = "";
  dateKeys.forEach((k, i) => {
    const b = bucket(k);
    if (b !== prev) idx.push(i);
    prev = b;
  });
  if (idx.length <= max) return idx;
  const stride = Math.ceil(idx.length / max);
  return idx.filter((_, i) => i % stride === 0);
}
