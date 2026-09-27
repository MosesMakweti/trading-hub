/**
 * Native Replay drawings — pure geometry and market calculations.
 *
 * Time ↔ chart position: the chart spaces candles by index (gaps compressed),
 * so a wall-clock minute maps to a FRACTIONAL logical index: the index of the
 * candle whose bucket contains it, plus how far into the bucket it is. Before
 * the first / after the last candle it extrapolates at one candle per
 * timeframe length — which is how drawings extend into empty future space
 * without any future candle existing.
 */
import type { Anchor, PositionData } from "./model";

// ── Time ↔ logical index ───────────────────────────────────────────────────

/** `times` = ascending candle bucket starts (wall-clock minutes); `tfMinutes` = nominal bucket length. */
export function timeToLogical(times: readonly number[], tfMinutes: number, t: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (t < times[0]) return (t - times[0]) / tfMinutes;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / tfMinutes;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  // Inside candle `lo` (or in a gap after it): position within its bucket, capped at the next candle.
  return lo + Math.min((t - times[lo]) / tfMinutes, 0.999);
}

export function logicalToTime(times: readonly number[], tfMinutes: number, logical: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (logical <= 0) return Math.round(times[0] + logical * tfMinutes);
  if (logical >= n - 1) return Math.round(times[n - 1] + (logical - (n - 1)) * tfMinutes);
  const i = Math.floor(logical);
  return Math.round(times[i] + (logical - i) * tfMinutes);
}

// ── Lines ─────────────────────────────────────────────────────────────────

export interface Pt {
  x: number;
  y: number;
}

/**
 * Screen segment for a line through a and b: the segment itself, a ray from a
 * through b to the viewport edge, or the full line across the viewport.
 * Computed geometrically every frame — never a fixed pixel length.
 */
export function lineSegment(a: Pt, b: Pt, mode: "segment" | "ray" | "extended", width: number, height: number): [Pt, Pt] {
  if (mode === "segment") return [a, b];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return [a, b];
  // Parametric line p(s) = a + s·(b − a); find s where it leaves the box [0,width]×[0,height].
  const reach = Math.max(width, height) * 4;
  const len = Math.hypot(dx, dy);
  const far = reach / len;
  const forward = { x: a.x + dx * far, y: a.y + dy * far };
  const backward = { x: a.x - dx * far, y: a.y - dy * far };
  return mode === "ray" ? [a, forward] : [backward, forward];
}

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Price on the market line through a and b at time t (linear in time). */
export function priceOnLine(a: Anchor, b: Anchor, t: number): number {
  if (b.time === a.time) return a.price;
  return a.price + ((b.price - a.price) * (t - a.time)) / (b.time - a.time);
}

/** Parallel channel: the main line A→B and a parallel line through C (same slope, offset in price). */
export function channelLines(a: Anchor, b: Anchor, c: Anchor): { main: [Anchor, Anchor]; parallel: [Anchor, Anchor] } {
  const offset = c.price - priceOnLine(a, b, c.time);
  return { main: [a, b], parallel: [{ time: a.time, price: a.price + offset }, { time: b.time, price: b.price + offset }] };
}

// ── Fibonacci ─────────────────────────────────────────────────────────────

/**
 * Retracement levels between A (swing start) and B (swing end): level 0 at B,
 * 1 at A, ratios in between measured back from B — the usual convention.
 * Prices come back at the instrument's precision.
 */
export function fibLevels(a: Anchor, b: Anchor, levels: readonly number[], priceScale: number): { level: number; price: number }[] {
  const s = 10 ** priceScale;
  const A = Math.round(a.price * s);
  const B = Math.round(b.price * s);
  return levels.map((level) => ({ level, price: Math.round(B + (A - B) * level) / s }));
}

// ── Measurement ───────────────────────────────────────────────────────────

export interface Measurement {
  priceChange: number;
  percentChange: number;
  /** MT5 points: price change in units of the dataset's last decimal. */
  points: number;
  /** Only when the instrument defines a pip; otherwise null (never guessed). */
  pips: number | null;
  minutes: number;
  bars: number | null;
}

export function measure(a: Anchor, b: Anchor, priceScale: number, options: { pipSize?: number | null; bars?: number | null } = {}): Measurement {
  const s = 10 ** priceScale;
  const points = Math.round(b.price * s) - Math.round(a.price * s);
  const priceChange = points / s;
  return {
    priceChange,
    percentChange: Math.round((priceChange / a.price) * 10000) / 100,
    points,
    pips: options.pipSize ? Math.round((priceChange / options.pipSize) * 10) / 10 : null,
    minutes: b.time - a.time,
    bars: options.bars ?? null,
  };
}

export function formatDuration(minutes: number): string {
  const m = Math.abs(minutes);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return [d ? `${d}d` : "", h ? `${h}h` : "", mm || (!d && !h) ? `${mm}m` : ""].filter(Boolean).join(" ");
}

// ── Position (Long / Short) ───────────────────────────────────────────────

export interface PositionTargetCalc {
  price: number;
  /** Reward in price units (positive when on the profitable side). */
  reward: number;
  points: number;
  pips: number | null;
  /** reward ÷ risk, rounded to 2 decimals (computed from exact integer points). */
  rr: number | null;
}

export interface PositionCalc {
  direction: "LONG" | "SHORT";
  risk: number;
  riskPoints: number;
  riskPips: number | null;
  targets: PositionTargetCalc[];
  valid: boolean;
  issues: string[];
}

/**
 * Entry / stop / targets → risk, per-target reward and R:R. Exact: every price
 * becomes integer points at the dataset precision first, so 2357.42 − 2350.10
 * is exactly 732 points, never 7.319999….
 */
export function computePosition(direction: "LONG" | "SHORT", p: PositionData, priceScale: number, pipSize?: number | null): PositionCalc {
  const s = 10 ** priceScale;
  const toPts = (x: number) => Math.round(x * s);
  const entry = toPts(p.entry);
  const stop = toPts(p.stop);
  const sign = direction === "LONG" ? 1 : -1;
  const riskPoints = (entry - stop) * sign; // positive when the stop is on the losing side
  const issues: string[] = [];
  if (riskPoints <= 0) issues.push(direction === "LONG" ? "Stop must be below entry for a long." : "Stop must be above entry for a short.");
  const targets = p.targets.map((t, i) => {
    const points = (toPts(t) - entry) * sign;
    if (points <= 0) issues.push(`TP${i + 1} must be ${direction === "LONG" ? "above" : "below"} entry.`);
    return {
      price: t,
      reward: points / s,
      points,
      pips: pipSize ? Math.round((points / s / pipSize) * 10) / 10 : null,
      rr: riskPoints > 0 ? Math.round((points * 100) / riskPoints) / 100 : null,
    };
  });
  return {
    direction,
    risk: Math.abs(riskPoints) / s,
    riskPoints: Math.abs(riskPoints),
    riskPips: pipSize ? Math.round((Math.abs(riskPoints) / s / pipSize) * 10) / 10 : null,
    targets,
    valid: issues.length === 0,
    issues,
  };
}

/** Default levels for a freshly placed position: stop one "risk unit" away, target at 2R. */
export function defaultPosition(direction: "LONG" | "SHORT", entry: number, riskUnit: number, priceScale: number): PositionData {
  const s = 10 ** priceScale;
  const round = (x: number) => Math.round(x * s) / s;
  const r = Math.max(riskUnit, 1 / s);
  return direction === "LONG"
    ? { entry: round(entry), stop: round(entry - r), targets: [round(entry + 2 * r)] }
    : { entry: round(entry), stop: round(entry + r), targets: [round(entry - 2 * r)] };
}
