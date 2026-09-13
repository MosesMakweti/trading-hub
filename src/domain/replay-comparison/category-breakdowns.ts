/**
 * Actual vs Replay breakdown by asset/strategy/setup type/direction (Stage
 * 15.2 §22) — Actual R/count reuses `ActualTradeRefDTO.realizedR` (the same
 * partial-aware realized R canonical Analytics already uses); Replay R/
 * count reuses `isReplayExecuted`/`realizedReplayR` (Stage 15 §5), never a
 * second definition of either.
 */
import { isReplayExecuted } from "@/domain/replay-comparison/replay-period-metrics";
import type { CategoryComparisonRow, ComparisonBreakdowns } from "@/domain/replay-comparison/types";
import type { ActualTradeRefDTO, ReplayTradeDTO } from "@/types/replay";

function mergeCategory(
  actualTrades: ActualTradeRefDTO[],
  replayTrades: ReplayTradeDTO[],
  actualKeyOf: (t: ActualTradeRefDTO) => string | null,
  replayKeyOf: (t: ReplayTradeDTO) => string | null,
  fixedKeys?: string[],
): CategoryComparisonRow[] {
  const rows = new Map<string, CategoryComparisonRow>();
  const get = (key: string): CategoryComparisonRow => {
    const existing = rows.get(key);
    if (existing) return existing;
    const created: CategoryComparisonRow = { key, label: key, actualR: 0, actualCount: 0, replayR: 0, replayTakenCount: 0 };
    rows.set(key, created);
    return created;
  };

  for (const t of actualTrades) {
    if (t.isCancelled) continue; // cancelled ideas excluded — never a real "executed" row
    const key = actualKeyOf(t);
    if (key == null) continue;
    const row = get(key);
    row.actualCount += 1;
    row.actualR += t.realizedR ?? 0;
  }
  for (const t of replayTrades.filter(isReplayExecuted)) {
    const key = replayKeyOf(t);
    if (key == null) continue;
    const row = get(key);
    row.replayTakenCount += 1;
    row.replayR += t.realizedReplayR;
  }

  if (fixedKeys) {
    for (const key of fixedKeys) get(key);
    return fixedKeys.map((key) => rows.get(key)!);
  }
  return Array.from(rows.values()).sort((a, b) => Math.abs(b.actualR) + Math.abs(b.replayR) - (Math.abs(a.actualR) + Math.abs(a.replayR)));
}

const NO_STRATEGY = "No strategy";
const NO_SETUP_TYPE = "No Setup Type";

export function buildComparisonBreakdowns(actualTrades: ActualTradeRefDTO[], replayTrades: ReplayTradeDTO[]): ComparisonBreakdowns {
  return {
    byAsset: mergeCategory(
      actualTrades,
      replayTrades,
      (t) => t.assetSymbol,
      (t) => t.assetSymbol,
    ),
    byStrategy: mergeCategory(
      actualTrades,
      replayTrades,
      (t) => t.strategyName ?? NO_STRATEGY,
      (t) => t.strategyNameSnapshot ?? NO_STRATEGY,
    ),
    bySetupType: mergeCategory(
      actualTrades,
      replayTrades,
      (t) => t.setupTypeName ?? NO_SETUP_TYPE,
      (t) => t.setupTypeNameSnapshot ?? NO_SETUP_TYPE,
    ),
    byDirection: mergeCategory(
      actualTrades,
      replayTrades,
      (t) => t.direction,
      (t) => t.direction,
      ["LONG", "SHORT"],
    ),
  };
}
