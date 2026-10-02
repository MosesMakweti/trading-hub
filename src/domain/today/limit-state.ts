// Today V3 (Phase 1) — soft daily limits with accountability. Pure.
//
// Decision 2 (approved): daily risk and max trades are SOFT limits. Nothing
// here blocks; it classifies where the day stands so the status strip can
// warn now and the Phase 2 trade flow can require an override reason later
// (`overrideRequiredForNewTrade`).
//
// What counts (documented in the Phase 1 report, §I):
//  - A trade is "used" once it has an actual entry. Ideas that never
//    executed and cancelled/never-triggered ideas do not consume the count;
//    missed opportunities are not Trade rows at all.
//  - Risk used is the sum of each executed trade's FROZEN Performance risk
//    snapshot riskPercent (PerformanceRiskSnapshot, locked at first entry) —
//    the canonical Performance Account risk, never recomputed here.

export interface DayTradeFact {
  hasActualEntry: boolean;
  cancelled: boolean;
  /** PerformanceRiskSnapshot.riskPercent; null until the snapshot exists. */
  performanceRiskPercent: number | null;
}

export interface DayUsage {
  executedCount: number;
  /** Not yet executed and not cancelled. */
  pendingIdeaCount: number;
  riskUsedPercent: number;
  /** False when an executed trade has no risk snapshot to read — the
   *  risk figure is then a lower bound, never presented as exact. */
  riskComplete: boolean;
}

export function computeDayUsage(trades: DayTradeFact[]): DayUsage {
  let executedCount = 0;
  let pendingIdeaCount = 0;
  let riskUsedPercent = 0;
  let riskComplete = true;
  for (const t of trades) {
    if (t.hasActualEntry) {
      executedCount += 1;
      if (t.performanceRiskPercent == null) riskComplete = false;
      else riskUsedPercent += t.performanceRiskPercent;
    } else if (!t.cancelled) {
      pendingIdeaCount += 1;
    }
  }
  return { executedCount, pendingIdeaCount, riskUsedPercent: round4(riskUsedPercent), riskComplete };
}

export type LimitLevel = "NO_LIMIT" | "WITHIN" | "AT_LIMIT" | "OVER";

export interface LimitState {
  risk: LimitLevel;
  trades: LimitLevel;
  /** True once either limit is reached — a new trade would breach or match
   *  past it, so the future trade flow must ask for an override reason. */
  overrideRequiredForNewTrade: boolean;
}

export function evaluateLimitState(
  usage: Pick<DayUsage, "executedCount" | "riskUsedPercent">,
  limits: { riskLimitPercent: number | null; maxTrades: number | null },
): LimitState {
  const risk = level(usage.riskUsedPercent, limits.riskLimitPercent);
  const trades = level(usage.executedCount, limits.maxTrades);
  return {
    risk,
    trades,
    overrideRequiredForNewTrade: risk === "AT_LIMIT" || risk === "OVER" || trades === "AT_LIMIT" || trades === "OVER",
  };
}

// ── Taking a new trade against today's confirmed limits (Phase 2) ───────────

export type LimitOverrideKind = "MAX_TRADES" | "DAILY_RISK";

export interface NewTradeOverride {
  required: boolean;
  kinds: LimitOverrideKind[];
  messages: string[];
  /** Persisted as Trade.limitOverrideContext when the trader overrides. */
  context: {
    kinds: LimitOverrideKind[];
    maxTrades: number | null;
    executedCount: number;
    riskLimitPercent: number | null;
    riskUsedPercent: number;
    projectedRiskPercent: number | null;
  };
}

/**
 * Would TAKING one more trade exceed today's CONFIRMED limits? Soft limits:
 * this never blocks — it says whether an explicit override reason is
 * required. Rules:
 *  - MAX_TRADES: a confirmed max exists and executed + 1 > max.
 *  - DAILY_RISK: a confirmed risk limit exists, today's risk is reliably
 *    known (every executed trade has its frozen snapshot), the new trade's
 *    risk is known, and used + projected > limit.
 *  - An unconfirmed limit never requires an override.
 */
export function evaluateNewTradeOverride(
  usage: Pick<DayUsage, "executedCount" | "riskUsedPercent" | "riskComplete">,
  limits: { riskLimitPercent: number | null; maxTrades: number | null },
  projectedRiskPercent: number | null,
): NewTradeOverride {
  const kinds: LimitOverrideKind[] = [];
  const messages: string[] = [];
  if (limits.maxTrades != null && usage.executedCount + 1 > limits.maxTrades) {
    kinds.push("MAX_TRADES");
    messages.push(
      `This would be trade ${usage.executedCount + 1} of your confirmed maximum ${limits.maxTrades}.`,
    );
  }
  if (
    limits.riskLimitPercent != null &&
    usage.riskComplete &&
    projectedRiskPercent != null &&
    usage.riskUsedPercent + projectedRiskPercent > limits.riskLimitPercent + 1e-9
  ) {
    kinds.push("DAILY_RISK");
    const total = round4(usage.riskUsedPercent + projectedRiskPercent);
    messages.push(
      `This trade's ${projectedRiskPercent}% risk would take today to ${total}% against your confirmed ${limits.riskLimitPercent}% limit.`,
    );
  }
  return {
    required: kinds.length > 0,
    kinds,
    messages,
    context: {
      kinds,
      maxTrades: limits.maxTrades,
      executedCount: usage.executedCount,
      riskLimitPercent: limits.riskLimitPercent,
      riskUsedPercent: usage.riskUsedPercent,
      projectedRiskPercent,
    },
  };
}

function level(used: number, limit: number | null): LimitLevel {
  if (limit == null) return "NO_LIMIT";
  if (used > limit + 1e-9) return "OVER";
  if (Math.abs(used - limit) <= 1e-9) return "AT_LIMIT";
  return "WITHIN";
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
