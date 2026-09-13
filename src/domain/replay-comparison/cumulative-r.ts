/**
 * "Actual vs Replay — Cumulative R" (Stage 15.2 §8). Both series start at 0
 * and only ever advance from legitimately realized results — mirrors
 * `domain/analytics/canonical-aggregations.ts`'s `buildCumulativeRealizedRCurve`
 * exactly on the Actual side (reused directly, not re-derived) and applies
 * the equivalent definition to Replay: chronological, only Replay TAKEN
 * decisions that reached a final (CLOSED) result contribute a point.
 */
import { isReplayFinalized } from "@/domain/replay-comparison/replay-period-metrics";
import type { CumulativeRComparison, CumulativeRPoint } from "@/domain/replay-comparison/types";
import type { ReplayActualBaseline, ReplayTradeDTO } from "@/types/replay";

export function buildReplayCumulativeRCurve(trades: ReplayTradeDTO[]): CumulativeRPoint[] {
  const finalized = trades
    .filter(isReplayFinalized)
    .slice()
    .sort((a, b) => {
      const timeA = a.closedAt ?? a.historicalTimestamp;
      const timeB = b.closedAt ?? b.historicalTimestamp;
      return timeA.localeCompare(timeB);
    });

  let cumulative = 0;
  return finalized.map((t) => {
    cumulative += t.realizedReplayR;
    const at = t.closedAt ?? t.historicalTimestamp;
    return { dateKey: at.slice(0, 10), id: t.id, r: t.realizedReplayR, cumulativeR: cumulative };
  });
}

export function buildCumulativeRComparison(baseline: ReplayActualBaseline, replayTrades: ReplayTradeDTO[]): CumulativeRComparison {
  const actual: CumulativeRPoint[] = baseline.canonical.cumulativeRCurve.map((p) => ({
    dateKey: p.dateKey,
    id: p.tradeId,
    r: p.r,
    cumulativeR: p.cumulativeR,
  }));
  return { actual, replay: buildReplayCumulativeRCurve(replayTrades) };
}
