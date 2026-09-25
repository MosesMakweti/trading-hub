import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { getDashboardData } from "@/server/services/dashboard.service";
import { tradeSchema, type TradeInput } from "@/lib/validation/trades";

/**
 * Real integration tests against the dev Postgres DB — same pattern as
 * analytics.service.test.ts. Covers the Analytics V2 correctness pass:
 * Dashboard's Win Rate/Profit Factor/Expectancy must come from the SAME
 * canonical (genuine R-multiple) dataset Analytics uses, not the legacy
 * %-of-account-equity numbers `getAnalyticsData` still computes internally
 * for its own $ accounting fields.
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `dashboard-svc-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

function minimalTradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return tradeSchema.parse({
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    ...overrides,
  });
}

describe("dashboard.service.ts — R metrics use the canonical dataset, not the legacy contribution-% pipeline", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("Win Rate/Profit Factor/Expectancy match genuine R-multiple stats even when risk % varies per trade", async () => {
    const user = await makeUser("canonical-r");
    userIds.push(user.id);

    // Two trades with DIFFERENT risk% so the two calculation paths would
    // genuinely diverge if Dashboard were still reading the legacy pipeline.
    // True R: +2R then -1R -> profit factor 2.0, expectancy +0.5R. The old
    // %-of-account-equity contribution figures would instead show profit
    // factor ~1.0 and expectancy ~0 for this exact scenario, because that
    // path is risk-size-weighted rather than R-weighted (see the audit).
    const win = await createTrade(
      user.id,
      "2026-12-01",
      minimalTradeInput({ direction: "LONG", performanceRiskPercentOverride: 1 }),
    );
    await updateTradeSections(user.id, win.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 }); // +2R

    const loss = await createTrade(
      user.id,
      "2026-12-02",
      minimalTradeInput({ direction: "LONG", performanceRiskPercentOverride: 2 }),
    );
    await updateTradeSections(user.id, loss.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 90 }); // -1R

    const data = await getDashboardData(user.id, { from: "2026-12-01", to: "2026-12-31" });

    expect(data.analytics.trading.winRate).toBe(50);
    expect(data.analytics.trading.profitFactor).toBeCloseTo(2, 6); // genuine R: 2R win / 1R loss
    expect(data.analytics.trading.expectancy).toBeCloseTo(0.5, 6); // genuine R: (2 + -1) / 2
    expect(data.analytics.trading.winRateSeries).toEqual([100, 50]);

    // The previous-period comparison object goes through the identical fix.
    expect(data.previousAnalytics.trading.winRate).toBeNull(); // no trades in the prior window
  });

  it("an account filter narrows the canonical R metrics the same way it narrows the legacy $ metrics", async () => {
    const user = await makeUser("account-filter");
    userIds.push(user.id);

    const account = await prisma.tradingAccount.create({
      data: { userId: user.id, name: "Broker A", kind: "PERSONAL_BROKERAGE" },
    });

    // A winner allocated to the extra account, and a loser that is not.
    const win = await createTrade(user.id, "2026-12-10", minimalTradeInput({ direction: "LONG" }));
    await prisma.tradeAccountAllocation.create({
      data: { tradeId: win.id, tradingAccountId: account.id, riskInputType: "PERCENT", riskValue: 1 },
    });
    await updateTradeSections(user.id, win.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 }); // +2R

    const loss = await createTrade(user.id, "2026-12-11", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, loss.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 90 }); // -1R, no extra allocation

    const filtered = await getDashboardData(user.id, { from: "2026-12-01", to: "2026-12-31", accountId: account.id });
    expect(filtered.analytics.trading.winRate).toBe(100); // only the win is allocated to this account

    const unfiltered = await getDashboardData(user.id, { from: "2026-12-01", to: "2026-12-31" });
    expect(unfiltered.analytics.trading.winRate).toBe(50); // both trades count with no filter
  });
});
