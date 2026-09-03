// Pure strategy-adherence analytics. Consumes per-trade adherence points (selected
// confluences by name + the frozen scores + win/loss outcome) and produces the
// aggregates the SOT spec wants: average confluence/execution/quality adherence,
// average confluence count on winners vs losers, and a per-confluence leaderboard
// (which confluences show up on winning trades). Framework-free + fully testable;
// the analytics service just maps trades into these points.

import type { SetupRating } from "@/domain/trades/setup-score";

export interface AdherenceTradePoint {
  // null = open / break-even → excluded from win/loss splits, still counted in averages.
  win: boolean | null;
  dateKey: string; // YYYY-MM-DD — for the over-time trend
  confluences: string[]; // selected confluence names
  confluencePercent: number | null;
  executionPercent: number | null;
  tradeQualityPercent: number | null;
  setupScore: number | null; // weighted probability score
  setupRating: SetupRating | null; // A+/A/B/C/LOW band
  // Trade direction — its scores were frozen against the direction-eligible
  // confluence set. null on trades logged before direction was recorded.
  direction?: "LONG" | "SHORT" | null;
}

// Long vs short discipline: are your setups sharper in one direction? Built from
// each trade's direction-aware frozen scores — no recomputation of history.
export interface AdherenceDirectionSplit {
  direction: "LONG" | "SHORT";
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgSetupScore: number | null;
  avgConfluenceAdherence: number | null;
}

export interface ConfluenceStat {
  name: string;
  trades: number; // trades where this confluence was selected
  wins: number;
  losses: number;
  winRate: number | null; // wins / (wins + losses), 0–100; null if no decided trades
}

export interface ConfluenceCombinationStat {
  confluences: string[]; // the exact set present on the trade, sorted
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

// Win rate + volume for one setup-quality band — validates "do higher-quality
// setups actually win more?", the payoff of the whole weighted-scoring system.
export interface SetupQualityBucket {
  rating: SetupRating;
  label: string; // "A+", "A", "B", "C", "Low"
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgScore: number | null;
}

// Average setup score per calendar month — the discipline trend over time.
export interface SetupQualityTrendPoint {
  month: string; // YYYY-MM
  avgScore: number | null;
  trades: number;
}

export interface AdherenceSummary {
  avgConfluenceAdherence: number | null;
  avgExecutionAdherence: number | null;
  avgTradeQuality: number | null;
  avgConfluencesOnWinners: number | null;
  avgConfluencesOnLosers: number | null;
  confluenceLeaderboard: ConfluenceStat[];
  confluenceCombinations: ConfluenceCombinationStat[];
  setupQualityBuckets: SetupQualityBucket[];
  setupQualityTrend: SetupQualityTrendPoint[];
  directionSplits: AdherenceDirectionSplit[];
}

const RATING_ORDER: SetupRating[] = ["A+", "A", "B", "C", "LOW"];
const RATING_LABEL: Record<SetupRating, string> = { "A+": "A+", A: "A", B: "B", C: "C", LOW: "Low" };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((s, v) => s + v, 0) / values.length);
}

/** Average of a nullable numeric field across the points that have it. */
function averageField(
  points: AdherenceTradePoint[],
  pick: (p: AdherenceTradePoint) => number | null,
): number | null {
  return average(points.map(pick).filter((v): v is number => v != null));
}

/** Per-confluence appearance + win/loss breakdown, ranked by win rate then volume. */
export function confluenceLeaderboard(points: AdherenceTradePoint[]): ConfluenceStat[] {
  const byName = new Map<string, { trades: number; wins: number; losses: number }>();
  for (const p of points) {
    // De-dupe within a trade so a repeated name can't double-count.
    const seen = new Set<string>();
    for (const raw of p.confluences) {
      const name = raw.trim();
      if (name === "") continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const stat = byName.get(name) ?? { trades: 0, wins: 0, losses: 0 };
      stat.trades += 1;
      if (p.win === true) stat.wins += 1;
      else if (p.win === false) stat.losses += 1;
      byName.set(name, stat);
    }
  }

  return [...byName.entries()]
    .map(([name, s]) => {
      const decided = s.wins + s.losses;
      return {
        name,
        trades: s.trades,
        wins: s.wins,
        losses: s.losses,
        winRate: decided > 0 ? round1((s.wins / decided) * 100) : null,
      };
    })
    .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.trades - a.trades || a.name.localeCompare(b.name));
}

/**
 * Win rate per exact confluence combination — "which confluence combos produce the
 * highest win rate?" A trade's combination is its full set of present confluences
 * (deduped + sorted). Only combos seen on at least `minTrades` trades are returned,
 * ranked by win rate then volume.
 */
export function confluenceCombinations(
  points: AdherenceTradePoint[],
  minTrades = 2,
): ConfluenceCombinationStat[] {
  const byKey = new Map<string, { names: string[]; trades: number; wins: number; losses: number }>();
  for (const p of points) {
    const names = [...new Set(p.confluences.map((c) => c.trim()).filter((c) => c !== ""))].sort(
      (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    if (names.length === 0) continue;
    const key = names.map((n) => n.toLowerCase()).join(" + ");
    const entry = byKey.get(key) ?? { names, trades: 0, wins: 0, losses: 0 };
    entry.trades += 1;
    if (p.win === true) entry.wins += 1;
    else if (p.win === false) entry.losses += 1;
    byKey.set(key, entry);
  }

  return [...byKey.values()]
    .filter((e) => e.trades >= minTrades)
    .map((e) => {
      const decided = e.wins + e.losses;
      return {
        confluences: e.names,
        trades: e.trades,
        wins: e.wins,
        losses: e.losses,
        winRate: decided > 0 ? round1((e.wins / decided) * 100) : null,
      };
    })
    .sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.trades - a.trades);
}

/** Win rate + average score per setup-quality band, in quality order (empty bands dropped). */
export function setupQualityBuckets(points: AdherenceTradePoint[]): SetupQualityBucket[] {
  const byRating = new Map<SetupRating, AdherenceTradePoint[]>();
  for (const p of points) {
    if (p.setupRating == null) continue;
    const list = byRating.get(p.setupRating) ?? [];
    list.push(p);
    byRating.set(p.setupRating, list);
  }

  return RATING_ORDER.flatMap((rating) => {
    const group = byRating.get(rating);
    if (!group || group.length === 0) return [];
    const wins = group.filter((p) => p.win === true).length;
    const losses = group.filter((p) => p.win === false).length;
    const decided = wins + losses;
    return [
      {
        rating,
        label: RATING_LABEL[rating],
        trades: group.length,
        wins,
        losses,
        winRate: decided > 0 ? round1((wins / decided) * 100) : null,
        avgScore: average(group.map((p) => p.setupScore).filter((s): s is number => s != null)),
      },
    ];
  });
}

/** Average setup score per calendar month (chronological). */
export function setupQualityTrend(points: AdherenceTradePoint[]): SetupQualityTrendPoint[] {
  const byMonth = new Map<string, number[]>();
  for (const p of points) {
    if (p.setupScore == null || p.dateKey.length < 7) continue;
    const month = p.dateKey.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(p.setupScore);
    byMonth.set(month, list);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, scores]) => ({ month, avgScore: average(scores), trades: scores.length }));
}

/** Long vs short adherence split (directions with no trades are dropped). */
export function adherenceByDirection(points: AdherenceTradePoint[]): AdherenceDirectionSplit[] {
  return (["LONG", "SHORT"] as const).flatMap((direction) => {
    const group = points.filter((p) => p.direction === direction);
    if (group.length === 0) return [];
    const wins = group.filter((p) => p.win === true).length;
    const losses = group.filter((p) => p.win === false).length;
    const decided = wins + losses;
    return [
      {
        direction,
        trades: group.length,
        wins,
        losses,
        winRate: decided > 0 ? round1((wins / decided) * 100) : null,
        avgSetupScore: averageField(group, (p) => p.setupScore),
        avgConfluenceAdherence: averageField(group, (p) => p.confluencePercent),
      },
    ];
  });
}

export function summarizeAdherence(points: AdherenceTradePoint[]): AdherenceSummary {
  const winners = points.filter((p) => p.win === true);
  const losers = points.filter((p) => p.win === false);

  return {
    avgConfluenceAdherence: averageField(points, (p) => p.confluencePercent),
    avgExecutionAdherence: averageField(points, (p) => p.executionPercent),
    avgTradeQuality: averageField(points, (p) => p.tradeQualityPercent),
    avgConfluencesOnWinners: average(winners.map((p) => p.confluences.length)),
    avgConfluencesOnLosers: average(losers.map((p) => p.confluences.length)),
    confluenceLeaderboard: confluenceLeaderboard(points),
    confluenceCombinations: confluenceCombinations(points),
    setupQualityBuckets: setupQualityBuckets(points),
    setupQualityTrend: setupQualityTrend(points),
    directionSplits: adherenceByDirection(points),
  };
}
