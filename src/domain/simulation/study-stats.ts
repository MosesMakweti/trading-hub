/**
 * Strategy Lab statistics — pure. Used for setup variations, instruments,
 * timeframes, hours and whole backtests.
 *
 * Two populations are never mixed:
 *  - EXECUTED results: a simulated position's net R (after costs), from the
 *    ledger — these drive win rate, expectancy, profit factor and drawdown;
 *  - SELF-REPORTED results: what the trader says a setup they didn't trade
 *    would have done — reported separately and labelled as such.
 *
 * Sample size is explicit: a ratio over a handful of trades is shown with
 * its sample quality, never as if it were an edge.
 */

export type ObservationOutcome = "WIN" | "LOSS" | "BREAKEVEN" | "UNRESOLVED";

export interface StatRow {
  /** Executed (a simulated position) or observed without trading. */
  executed: boolean;
  /** Executed: net R of a CLOSED position (null while open or without a stop). Not executed: self-reported R or null. */
  r: number | null;
  outcome: ObservationOutcome;
  /** Ordering key (replay minute) for streaks and drawdown. */
  minute: number;
}

export type SampleQuality = "NONE" | "INSUFFICIENT" | "LOW" | "ADEQUATE";

/** Resolved executed trades needed before a ratio means something. */
export const SAMPLE_THRESHOLDS = { insufficientBelow: 10, lowBelow: 30 } as const;

export interface SetupStats {
  occurrences: number;
  executed: number;
  notExecuted: number;
  /** Executed trades with a result (closed, with a measurable R). */
  resolved: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  netR: number | null;
  averageR: number | null;
  /** Mean R per resolved trade — the same number as averageR, named for what it means. */
  expectancy: number | null;
  profitFactor: number | null;
  averageWinR: number | null;
  averageLossR: number | null;
  /** averageWinR / |averageLossR| */
  averageRewardRisk: number | null;
  /** Largest peak-to-trough decline of cumulative R (≤ 0). */
  maxDrawdownR: number | null;
  longestWinStreak: number;
  longestLossStreak: number;
  sample: SampleQuality;
  /** Not-traded observations with a self-reported result. */
  selfReported: { count: number; wins: number; losses: number; netR: number | null };
}

const R_EPSILON = 0.005;
const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

export function classifyR(r: number): "WIN" | "LOSS" | "BREAKEVEN" {
  if (r > R_EPSILON) return "WIN";
  if (r < -R_EPSILON) return "LOSS";
  return "BREAKEVEN";
}

export function sampleQuality(resolved: number): SampleQuality {
  if (resolved === 0) return "NONE";
  if (resolved < SAMPLE_THRESHOLDS.insufficientBelow) return "INSUFFICIENT";
  if (resolved < SAMPLE_THRESHOLDS.lowBelow) return "LOW";
  return "ADEQUATE";
}

export function computeSetupStats(rows: StatRow[]): SetupStats {
  const executed = rows.filter((r) => r.executed);
  const resolvedRows = executed.filter((r) => r.r != null).sort((a, b) => a.minute - b.minute);
  const rs = resolvedRows.map((r) => r.r!);
  const classes = rs.map(classifyR);
  const winsR = rs.filter((r) => classifyR(r) === "WIN");
  const lossesR = rs.filter((r) => classifyR(r) === "LOSS");
  const grossWin = sum(winsR);
  const grossLoss = Math.abs(sum(lossesR));

  let cumulative = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of rs) {
    cumulative += r;
    peak = Math.max(peak, cumulative);
    maxDd = Math.min(maxDd, cumulative - peak);
  }
  let winStreak = 0;
  let lossStreak = 0;
  let w = 0;
  let l = 0;
  for (const c of classes) {
    w = c === "WIN" ? w + 1 : 0;
    l = c === "LOSS" ? l + 1 : 0;
    winStreak = Math.max(winStreak, w);
    lossStreak = Math.max(lossStreak, l);
  }

  const avgWin = mean(winsR);
  const avgLoss = mean(lossesR);
  const decided = winsR.length + lossesR.length;
  const self = rows.filter((r) => !r.executed && r.outcome !== "UNRESOLVED");
  const selfR = self.map((r) => r.r).filter((r): r is number => r != null);

  return {
    occurrences: rows.length,
    executed: executed.length,
    notExecuted: rows.length - executed.length,
    resolved: rs.length,
    wins: winsR.length,
    losses: lossesR.length,
    breakevens: rs.length - decided,
    winRate: rs.length ? (winsR.length / rs.length) * 100 : null,
    netR: rs.length ? sum(rs) : null,
    averageR: mean(rs),
    expectancy: mean(rs),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    averageWinR: avgWin,
    averageLossR: avgLoss,
    averageRewardRisk: avgWin != null && avgLoss != null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    maxDrawdownR: rs.length ? maxDd : null,
    longestWinStreak: winStreak,
    longestLossStreak: lossStreak,
    sample: sampleQuality(rs.length),
    selfReported: {
      count: self.length,
      wins: self.filter((r) => r.outcome === "WIN").length,
      losses: self.filter((r) => r.outcome === "LOSS").length,
      netR: selfR.length ? sum(selfR) : null,
    },
  };
}

export interface GroupStats {
  key: string;
  label: string;
  stats: SetupStats;
}

/** Groups rows by a key and computes stats per group, largest groups first. */
export function groupStats<T extends StatRow>(rows: T[], keyOf: (row: T) => { key: string; label: string } | null): GroupStats[] {
  const groups = new Map<string, { label: string; rows: T[] }>();
  for (const row of rows) {
    const k = keyOf(row);
    if (!k) continue;
    const g = groups.get(k.key) ?? { label: k.label, rows: [] };
    g.rows.push(row);
    groups.set(k.key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, stats: computeSetupStats(g.rows) }))
    .sort((a, b) => b.stats.occurrences - a.stats.occurrences || a.label.localeCompare(b.label));
}

/** Server-clock hour bucket of a broker minute ("09:00–09:59"). */
export function hourBucketOf(minute: number): { key: string; label: string } {
  const h = Math.floor((((minute % 1440) + 1440) % 1440) / 60);
  const hh = String(h).padStart(2, "0");
  return { key: hh, label: `${hh}:00` };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Broker-clock weekday of a minute (minute 0 = Thu 1970-01-01). */
export function weekdayOf(minute: number): { key: string; label: string } {
  const day = Math.floor(minute / 1440);
  const idx = (((day + 4) % 7) + 7) % 7;
  return { key: String(idx), label: WEEKDAYS[idx] };
}
