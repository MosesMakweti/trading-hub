import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { getAnalyticsData } from "@/server/services/analytics.service";
import { tradeSchema, type TradeInput } from "@/lib/validation/trades";

/**
 * Real integration tests against the dev Postgres DB — same pattern as
 * performance-account.service.test.ts. Covers Stage C.1 Part 2: a pending
 * (not-yet-settled) trade must never masquerade as a $0/0R closed trade
 * anywhere in getAnalyticsData's output — win rate, loss count, breakeven
 * classification, average R, equity curve, and discrepancy must all treat
 * it as genuinely absent from outcome-based stats while still counting it
 * as a recorded trade.
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `analytics-svc-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
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

describe("analytics.service.ts — pending-aware analytics (Stage C.1, Part 2)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("10/11/12/13. a pending trade counts as recorded but is excluded from win/loss/breakeven classification", async () => {
    const user = await makeUser("counts-but-excluded");
    userIds.push(user.id);

    // One genuine settled winner...
    const win = await createTrade(user.id, "2026-10-01", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, win.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 }); // +2R

    // ...and one trade that never settles (missing initial stop entirely).
    const pending = await createTrade(user.id, "2026-10-02", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, pending.id, { actualEntry: 100, actualExit: 120 });

    const data = await getAnalyticsData(user.id, "2026-10-01", "2026-10-31");

    expect(data.trading.totalTrades).toBe(2); // #10: both trades are recorded
    expect(data.trading.closedTrades).toBe(1); // only the settled one backs the outcome stats
    expect(data.trading.winningTrades).toBe(1); // #11 (implicitly): pending never inflates the win count
    expect(data.trading.losingTrades).toBe(0); // #12: nor the loss count
    expect(data.trading.breakevenTrades).toBe(0); // #13: nor breakeven — it's not a $0 trade, it's unresolved
    expect(data.trading.winRate).toBe(100); // 1 of 1 SETTLED trades, not 1 of 2
  });

  it("14. a pending trade is excluded from average R / expectancy", async () => {
    const user = await makeUser("excluded-from-avg-r");
    userIds.push(user.id);

    const win = await createTrade(user.id, "2026-10-03", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, win.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 110 }); // +1R exactly

    const pending = await createTrade(user.id, "2026-10-04", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, pending.id, { actualEntry: 100, actualExit: 120 }); // no stop -> pending

    const data = await getAnalyticsData(user.id, "2026-10-01", "2026-10-31");
    // The one settled trade risks 1% of the $100k starting balance and
    // realizes +1R -> a +1.0 contribution %. If the pending trade were
    // incorrectly averaged in as a 0 contribution, this would be pulled
    // down to 0.5 instead of staying exactly 1.0.
    expect(data.trading.averageRR).toBeCloseTo(1.0, 6);
    expect(data.trading.closedTrades).toBe(1);
  });

  it("15. a pending trade does not add a fake $0 point to the equity curve", async () => {
    const user = await makeUser("no-fake-equity-point");
    userIds.push(user.id);

    const win = await createTrade(user.id, "2026-10-05", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, win.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 }); // +2R, +$2000

    const pending = await createTrade(user.id, "2026-10-06", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, pending.id, { actualEntry: 100, actualExit: 120 });

    const data = await getAnalyticsData(user.id, "2026-10-01", "2026-10-31");
    // The dollar equity curve must reflect ONLY the one real $2000 move —
    // a pending trade never contributes its own point/step to it.
    expect(data.trading.netPnl).toBeCloseTo(2000, 6);
    expect(data.trading.currentBalance).toBeCloseTo(100_000 + 2000, 6);
  });

  it("16/17. a genuine 0R breakeven IS a settled result, distinguishable from pending", async () => {
    const user = await makeUser("breakeven-vs-pending");
    userIds.push(user.id);

    const breakeven = await createTrade(user.id, "2026-10-07", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, breakeven.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 100 }); // exactly 0R

    const pending = await createTrade(user.id, "2026-10-08", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, pending.id, { actualEntry: 100, actualExit: 120 });

    const data = await getAnalyticsData(user.id, "2026-10-01", "2026-10-31");
    expect(data.trading.totalTrades).toBe(2);
    expect(data.trading.closedTrades).toBe(1); // the breakeven IS settled -> counted
    expect(data.trading.breakevenTrades).toBe(1); // genuinely $0, correctly classified
    expect(data.trading.winningTrades).toBe(0);
    expect(data.trading.losingTrades).toBe(0);
  });

  it("18. a pending trade with a real measurable entry deviation does not generate an artificial discrepancy", async () => {
    const user = await makeUser("no-fake-discrepancy");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-10-09", minimalTradeInput({ direction: "LONG" }));
    // A real, measurable deviation (chased the entry higher than planned) —
    // written directly since plannedEntry/plannedStopLoss are no longer
    // patchable via updateTradeSections (Today V2 Phase 2 §1: TradePlanVersion
    // is the sole canonical writer); a direct write stands in for a
    // already-confirmed plan for this analytics-only test.
    await prisma.trade.update({ where: { id: trade.id }, data: { plannedEntry: "100", plannedStopLoss: "90" } });
    // ...but the position is still open (no actualExit) -> never settles.
    await updateTradeSections(user.id, trade.id, { actualEntry: 105 });

    const data = await getAnalyticsData(user.id, "2026-10-01", "2026-10-31");
    const event = data.trading.counterfactual.curve.find((c) => c.eventId === trade.id);
    // The event may or may not appear depending on hasData gating, but if it
    // does, it must be a true no-op — no fabricated avoidable gap from the
    // real entry-slip deviation while the trade's outcome is still unknown.
    if (event) {
      expect(event.stepAvoidableR).toBe(0);
      expect(event.stepUnearnedR).toBe(0);
    }
    expect(data.trading.counterfactual.summary.totalAvoidableGapR).toBe(0);
  });

  it("19. psychology data is stored for a pending trade, but outcome correlations exclude it", async () => {
    const user = await makeUser("psychology-pending");
    userIds.push(user.id);

    const win = await createTrade(
      user.id,
      "2026-10-10",
      minimalTradeInput({
        direction: "LONG",
        psychologyAnswers: {
          fomo: "no",
          riskManaged: "yes",
          followedExitPlan: "yes",
          alignedWithBias: "yes",
          influencedBySomeoneElseProfit: "no",
          influencedByOnlineOpinion: "no",
          outcomeWillInfluenceNext: "no",
          monitoringObsession: 10,
        },
      }),
    );
    await updateTradeSections(user.id, win.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    const pending = await createTrade(
      user.id,
      "2026-10-11",
      minimalTradeInput({
        direction: "LONG",
        psychologyAnswers: {
          fomo: "no",
          riskManaged: "yes",
          followedExitPlan: "yes",
          alignedWithBias: "yes",
          influencedBySomeoneElseProfit: "no",
          influencedByOnlineOpinion: "no",
          outcomeWillInfluenceNext: "no",
          monitoringObsession: 20,
        },
      }),
    );
    await updateTradeSections(user.id, pending.id, { actualEntry: 100, actualExit: 120 }); // no stop -> pending

    const data = await getAnalyticsData(user.id, "2026-10-01", "2026-10-31");
    // Both psychology records are kept (dataPoints includes the pending trade)...
    expect(data.psychology.dataPoints.length).toBe(2);
    // ...but the pending one's actualRR is null, so the profitability
    // correlation (which filters `actualRR !== null` internally) is built
    // from the one settled trade only, not corrupted by a fake 0.
    const pendingPoint = data.psychology.dataPoints.find((p) => p.dateKey === "2026-10-11");
    expect(pendingPoint?.actualRR).toBeNull();
  });

  it("20. once a pending trade settles, analytics begin including it correctly", async () => {
    const user = await makeUser("settles-later");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-10-12", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualExit: 120 }); // no stop yet -> pending

    const before = await getAnalyticsData(user.id, "2026-10-01", "2026-10-31");
    expect(before.trading.totalTrades).toBe(1);
    expect(before.trading.closedTrades).toBe(0);
    expect(before.trading.netPnl).toBe(0);

    await updateTradeSections(user.id, trade.id, { actualStopLoss: 90 }); // now resolvable -> settles to +2R

    const after = await getAnalyticsData(user.id, "2026-10-01", "2026-10-31");
    expect(after.trading.totalTrades).toBe(1);
    expect(after.trading.closedTrades).toBe(1);
    expect(after.trading.winningTrades).toBe(1);
    expect(after.trading.netPnl).toBeCloseTo(2000, 6);
  });
});

describe("analytics.service.ts — Analytics V2 (drawdown curve, execution quality)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("drawdownCurve is zipped with real dates and current drawdown reflects the last settled trade", async () => {
    const user = await makeUser("drawdown-curve");
    userIds.push(user.id);

    // Trade 1: +2R win (balance up). Trade 2: -1R loss (balance down from peak).
    const t1 = await createTrade(user.id, "2026-11-01", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, t1.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });
    const t2 = await createTrade(user.id, "2026-11-02", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, t2.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 90 });

    const data = await getAnalyticsData(user.id, "2026-11-01", "2026-11-30");
    expect(data.trading.drawdownCurve.length).toBe(3); // starting point + 2 settled trades
    expect(data.trading.drawdownCurve[0].dateKey).toBe("2026-11-01"); // the range start, not a trade date
    expect(data.trading.drawdownCurve[1].dateKey).toBe("2026-11-01");
    expect(data.trading.drawdownCurve[2].dateKey).toBe("2026-11-02");
    // Peaked after the win (102,000), then declined after the loss (-1% of
    // 102,000 = -1,020) -> current drawdown > 0.
    expect(data.trading.currentDrawdownAmount).toBeCloseTo(1020, 6);
    expect(data.trading.currentDrawdownPercent).toBeGreaterThan(0);
    expect(data.trading.maxDrawdownAmount).toBeCloseTo(data.trading.currentDrawdownAmount, 6);
  });

  it("current drawdown is zero when the series ends at a new peak", async () => {
    const user = await makeUser("drawdown-at-peak");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-11-03", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    const data = await getAnalyticsData(user.id, "2026-11-01", "2026-11-30");
    expect(data.trading.currentDrawdownAmount).toBe(0);
    expect(data.trading.currentDrawdownPercent).toBe(0);
  });

  it("executionQuality only counts trades with a confirmed plan, and reports zero deviations as a clean plan-follow rate", async () => {
    const user = await makeUser("execution-quality-clean");
    userIds.push(user.id);

    // A freeform trade with no plan at all — excluded from the denominator entirely.
    const freeform = await createTrade(user.id, "2026-11-04", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, freeform.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    // A planned trade executed exactly to plan — zero deviations.
    const planned = await createTrade(user.id, "2026-11-05", minimalTradeInput({ direction: "LONG" }));
    await prisma.trade.update({ where: { id: planned.id }, data: { plannedEntry: "100", plannedStopLoss: "90", plannedTarget: "120" } });
    await updateTradeSections(user.id, planned.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    const data = await getAnalyticsData(user.id, "2026-11-01", "2026-11-30");
    expect(data.trading.executionQuality.sampleSize).toBe(1); // only the planned trade
    expect(data.trading.executionQuality.planFollowRatePercent).toBe(100);
    expect(data.trading.executionQuality.byCause).toHaveLength(0);
  });

  it("executionQuality reports a late-entry deviation without treating it as a discrepancy verdict", async () => {
    const user = await makeUser("execution-quality-deviation");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-11-06", minimalTradeInput({ direction: "LONG" }));
    await prisma.trade.update({ where: { id: trade.id }, data: { plannedEntry: "100", plannedStopLoss: "90", plannedTarget: "120" } });
    // Chased the entry 5 points higher than planned (0.5R late-entry deviation).
    await updateTradeSections(user.id, trade.id, { actualEntry: 105, actualStopLoss: 90, actualExit: 120 });

    const data = await getAnalyticsData(user.id, "2026-11-01", "2026-11-30");
    expect(data.trading.executionQuality.sampleSize).toBe(1);
    expect(data.trading.executionQuality.planFollowRatePercent).toBe(0);
    expect(data.trading.executionQuality.byCause).toHaveLength(1);
    expect(data.trading.executionQuality.byCause[0].cause).toBe("late-entry");
  });
});
