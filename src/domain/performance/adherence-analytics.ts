// Pure strategy-adherence analytics. Consumes per-trade adherence points (selected
// confluences by name + the frozen scores + win/loss outcome) and produces the
// aggregates the SOT spec wants: average confluence/execution/quality adherence,
// average confluence count on winners vs losers, and a per-confluence leaderboard
// (which confluences show up on winning trades). Framework-free + fully testable;
// the analytics service just maps trades into these points.

export interface AdherenceTradePoint {
  // null = open / break-even → excluded from win/loss splits, still counted in averages.
  win: boolean | null;
  confluences: string[]; // selected confluence names
  confluencePercent: number | null;
  executionPercent: number | null;
  tradeQualityPercent: number | null;
}

export interface ConfluenceStat {
  name: string;
  trades: number; // trades where this confluence was selected
  wins: number;
  losses: number;
  winRate: number | null; // wins / (wins + losses), 0–100; null if no decided trades
}

export interface AdherenceSummary {
  avgConfluenceAdherence: number | null;
  avgExecutionAdherence: number | null;
  avgTradeQuality: number | null;
  avgConfluencesOnWinners: number | null;
  avgConfluencesOnLosers: number | null;
  confluenceLeaderboard: ConfluenceStat[];
}

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
  };
}
