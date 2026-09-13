import { describe, expect, it } from "vitest";

import { toActualPeriodMetrics } from "@/domain/replay-comparison/actual-period-metrics";
import type { ActualTradeRefDTO, ReplayActualBaseline } from "@/types/replay";
import type { CanonicalAnalyticsSummary } from "@/server/services/analytics-canonical.service";

function makeBaseline(overrides: {
  overview?: Partial<CanonicalAnalyticsSummary["overview"]>;
  actualTrades?: ActualTradeRefDTO[];
  averageRealizedR?: number | null;
}): ReplayActualBaseline {
  const overview: CanonicalAnalyticsSummary["overview"] = {
    totalExecutedTrades: 10,
    finalizedTrades: 8,
    winningTrades: 5,
    losingTrades: 3,
    breakevenTrades: 0,
    totalRealizedR: 4,
    totalPnl: 400,
    winRate: 62.5,
    expectancy: 0.5,
    profitFactor: 1.8,
    averageWinnerR: 1.5,
    averageLoserR: -1,
    overrideCount: 2,
    overrideRate: 25,
    cancelledCount: 1,
    longestWinStreak: 3,
    longestLossStreak: 2,
    ...overrides.overview,
  };

  return {
    computedAt: "2026-08-04T00:00:00.000Z",
    range: { startDate: "2026-08-03", endDate: "2026-08-09" },
    scope: { strategyId: null, strategyName: null, assetSymbols: [] },
    canonical: { overview } as unknown as CanonicalAnalyticsSummary,
    averageRealizedR: overrides.averageRealizedR ?? 0.5,
    psychologyAdherence: { averagePsychologyPercent: null, averageAdherencePercent: null, sampleSize: 0 },
    opportunity: { hasData: false, summary: {} as never },
    actualTrades: overrides.actualTrades ?? [],
  };
}

function makeActual(overrides: Partial<ActualTradeRefDTO> = {}): ActualTradeRefDTO {
  return {
    tradeId: "t-1",
    dateKey: "2026-08-04",
    assetSymbol: "XAUUSD",
    direction: "LONG",
    strategyName: null,
    setupTypeName: null,
    validationState: "VALIDATED",
    reviewLifecycleStatus: "FULLY_CLOSED",
    isCancelled: false,
    winLossClass: "WIN",
    realizedR: 2,
    finalizedR: 2,
    pnl: 100,
    ...overrides,
  };
}

describe("toActualPeriodMetrics", () => {
  it("maps the frozen overview 1:1 without recomputation", () => {
    const baseline = makeBaseline({});
    const m = toActualPeriodMetrics(baseline);
    expect(m.executedTrades).toBe(10);
    expect(m.finalizedTrades).toBe(8);
    expect(m.wins).toBe(5);
    expect(m.losses).toBe(3);
    expect(m.winRate).toBe(62.5);
    expect(m.totalRealizedR).toBe(4);
    expect(m.expectancy).toBe(0.5);
    expect(m.profitFactor).toBe(1.8);
    expect(m.overrideCount).toBe(2);
  });

  it("uses the baseline's own averageRealizedR for Avg R / Trade — not a re-derived value", () => {
    const baseline = makeBaseline({ averageRealizedR: 1.234 });
    expect(toActualPeriodMetrics(baseline).averageRPerTrade).toBe(1.234);
  });

  it("counts VALIDATED and OVERRIDDEN trades as validated; NOT_VALIDATED and null are excluded", () => {
    const baseline = makeBaseline({
      actualTrades: [
        makeActual({ tradeId: "a", validationState: "VALIDATED" }),
        makeActual({ tradeId: "b", validationState: "OVERRIDDEN" }),
        makeActual({ tradeId: "c", validationState: "NOT_VALIDATED" }),
        makeActual({ tradeId: "d", validationState: null }),
      ],
    });
    expect(toActualPeriodMetrics(baseline).validatedTrades).toBe(2);
  });
});
