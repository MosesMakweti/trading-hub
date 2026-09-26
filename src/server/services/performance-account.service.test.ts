import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTrade, updateTradeSections } from "@/server/services/trades.service";
import {
  getPerformanceRiskContext,
  settlePerformanceTrade,
  updatePerformanceRiskOverride,
} from "@/server/services/performance-account.service";
import { getAccountBalance } from "@/server/services/accounts.service";
import { tradeSchema, type TradeInput } from "@/lib/validation/trades";

/**
 * Real integration tests against the dev Postgres DB — same pattern as
 * trades.service.test.ts. Covers the Stage C settlement pipeline: a trade's
 * Performance Account allocation must be null ("not settled / not
 * calculable") until settlePerformanceTrade genuinely produces a result, and
 * must never be silently coalesced to a fake $0.00.
 *
 * Every trade here uses the account's default 1% risk on the default
 * $100,000 starting balance (riskAmount = $1,000) unless a test explicitly
 * overrides it — each test uses its own fresh user, so compounding from an
 * earlier trade never bleeds into another test's expected numbers.
 */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `perf-acct-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
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

async function performanceAllocation(tradeId: string) {
  return prisma.tradeAccountAllocation.findFirstOrThrow({
    where: { tradeId, tradingAccount: { kind: "PERFORMANCE" } },
  });
}

async function performanceSnapshot(tradeId: string) {
  return prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } });
}

describe("performance-account.service.ts — settlement pipeline (Stage C)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("1. a newly created trade's Performance allocation begins Pending (null), never $0", async () => {
    const user = await makeUser("new-pending");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-01", minimalTradeInput());
    const alloc = await performanceAllocation(trade.id);

    expect(alloc.closingPnlGross).toBeNull();
    expect(alloc.closingPnlNet).toBeNull();
  });

  it("2. a complete LONG winner settles to riskAmount x realizedR", async () => {
    const user = await makeUser("long-win");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-02", minimalTradeInput({ direction: "LONG" }));
    // Note: updateTradeSections' own return value is captured BEFORE it
    // calls settlePerformanceTrade internally, so it doesn't reflect the
    // just-written actualRR — re-fetch to see the post-settlement state.
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });
    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.actualRR?.toNumber()).toBeCloseTo(2, 6); // (120-100)/(100-90) = 2R

    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlNet?.toNumber()).toBeCloseTo(2000, 6); // $1,000 risk x 2R
    expect(alloc.closingPnlGross?.toNumber()).toBeCloseTo(2000, 6);
  });

  it("3. a complete LONG loser settles to a negative PnL", async () => {
    const user = await makeUser("long-loss");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-03", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 85 });

    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlNet?.toNumber()).toBeCloseTo(-1500, 6); // -1.5R x $1,000
  });

  it("4. a complete SHORT winner settles to a positive PnL", async () => {
    const user = await makeUser("short-win");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-04", minimalTradeInput({ direction: "SHORT" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 110, actualExit: 80 });

    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlNet?.toNumber()).toBeCloseTo(2000, 6); // (100-80)/(110-100) = 2R
  });

  it("5. a complete SHORT loser settles to a negative PnL", async () => {
    const user = await makeUser("short-loss");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-05", minimalTradeInput({ direction: "SHORT" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 110, actualExit: 115 });

    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlNet?.toNumber()).toBeCloseTo(-1500, 6); // (100-115)/(110-100) = -1.5R
  });

  it("6. a genuine breakeven settles to exactly $0 — a real number, not null", async () => {
    const user = await makeUser("breakeven");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-06", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 100 });

    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlNet).not.toBeNull();
    expect(alloc.closingPnlNet?.toNumber()).toBe(0);
  });

  it("7. missing an initial stop (no actualStopLoss, no locked plan) stays Pending, never $0", async () => {
    const user = await makeUser("missing-stop");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-07", minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualExit: 120 });

    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlGross).toBeNull();
    expect(alloc.closingPnlNet).toBeNull();
  });

  it("8. missing an exit (position still open) stays Pending, never $0", async () => {
    const user = await makeUser("missing-exit");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-08", minimalTradeInput());
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90 });

    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlGross).toBeNull();
    expect(alloc.closingPnlNet).toBeNull();
  });

  it("9. partial exits totaling exactly 100% settle to the proportion-weighted realized R", async () => {
    const user = await makeUser("partials-100");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-09", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90 });
    await prisma.tradeActualPartialExit.createMany({
      data: [
        { userId: user.id, tradeId: trade.id, exitOrder: 1, exitPrice: 110, percentClosed: 50, exitedAt: new Date() }, // R = 1
        { userId: user.id, tradeId: trade.id, exitOrder: 2, exitPrice: 120, percentClosed: 50, exitedAt: new Date() }, // R = 2
      ],
    });

    const result = await settlePerformanceTrade(user.id, trade.id);
    expect(result.status).toBe("SETTLED");
    if (result.status !== "SETTLED") throw new Error("unreachable");
    expect(result.realizedR.toNumber()).toBeCloseTo(1.5, 6); // 0.5x1 + 0.5x2

    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlNet?.toNumber()).toBeCloseTo(1500, 6);
  });

  it("10. partial exits totaling less than 100% do not falsely settle", async () => {
    const user = await makeUser("partials-partial");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-10", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90 });
    await prisma.tradeActualPartialExit.create({
      data: { userId: user.id, tradeId: trade.id, exitOrder: 1, exitPrice: 110, percentClosed: 50, exitedAt: new Date() },
    });

    const result = await settlePerformanceTrade(user.id, trade.id);
    expect(result.status).toBe("NOT_CALCULABLE");

    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlGross).toBeNull();
    expect(alloc.closingPnlNet).toBeNull();
  });

  it("11. Performance PnL = locked riskAmount x canonical realizedR, for a non-default risk%", async () => {
    const user = await makeUser("custom-risk");
    userIds.push(user.id);

    // $100,000 x 2% = $2,000 risk amount, locked at first actual entry.
    const trade = await createTrade(
      user.id,
      "2026-08-11",
      minimalTradeInput({ direction: "LONG", performanceRiskPercentOverride: 2 }),
    );
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.riskAmount.toNumber()).toBeCloseTo(2000, 6);
    expect(snapshot.realizedR?.toNumber()).toBeCloseTo(2, 6);

    const alloc = await performanceAllocation(trade.id);
    // riskAmount x realizedR = 2000 x 2 = 4000
    expect(alloc.closingPnlNet?.toNumber()).toBeCloseTo(4000, 6);
  });

  it("12. settlement writes realizedR/performancePnl/settledAt onto PerformanceRiskSnapshot", async () => {
    const user = await makeUser("snapshot-write");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-12", minimalTradeInput({ direction: "LONG" }));
    // No PerformanceRiskSnapshot row exists at all yet — it's only created
    // by lockPerformanceRiskSnapshot once actualEntry first appears.
    await expect(prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId: trade.id } })).rejects.toThrow();

    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    const after = await performanceSnapshot(trade.id);
    expect(after.realizedR?.toNumber()).toBeCloseTo(2, 6);
    expect(after.performancePnl?.toNumber()).toBeCloseTo(2000, 6);
    expect(after.settledAt).not.toBeNull();
  });

  it("13. settlement writes the same PnL onto the Performance TradeAccountAllocation row", async () => {
    const user = await makeUser("allocation-write");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-13", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    const snapshot = await performanceSnapshot(trade.id);
    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlGross?.toNumber()).toBeCloseTo(snapshot.performancePnl!.toNumber(), 6);
    expect(alloc.closingPnlNet?.toNumber()).toBeCloseTo(snapshot.performancePnl!.toNumber(), 6);
  });

  it("14. clearSettlement restores Pending (null), never a fake breakeven $0, when settlement becomes incomplete again", async () => {
    const user = await makeUser("clear-settlement");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-14", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });
    const settled = await performanceAllocation(trade.id);
    expect(settled.closingPnlNet?.toNumber()).toBeCloseTo(2000, 6);

    // Add a partial that only accounts for 50% of the position — exits now
    // come from partials (not actualExit) and total under 100%, so the
    // previously-settled result must be reversed to Pending, not left at
    // its old value and not flattened to 0.
    await prisma.tradeActualPartialExit.create({
      data: { userId: user.id, tradeId: trade.id, exitOrder: 1, exitPrice: 110, percentClosed: 50, exitedAt: new Date() },
    });
    const result = await settlePerformanceTrade(user.id, trade.id);
    expect(result.status).toBe("NOT_CALCULABLE");

    const cleared = await performanceAllocation(trade.id);
    expect(cleared.closingPnlGross).toBeNull();
    expect(cleared.closingPnlNet).toBeNull();

    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.realizedR).toBeNull();
    expect(snapshot.performancePnl).toBeNull();
    expect(snapshot.settledAt).toBeNull();
  });

  it("15. account balance aggregates settled trades only — a pending trade contributes 0 to the total without its own result becoming a fake breakeven", async () => {
    const user = await makeUser("aggregate-pending");
    userIds.push(user.id);

    const settledTrade = await createTrade(user.id, "2026-08-15", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, settledTrade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    const pendingTrade = await createTrade(user.id, "2026-08-16", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, pendingTrade.id, { actualEntry: 100, actualExit: 120 }); // no stop -> Pending

    const performanceAccount = await prisma.tradingAccount.findFirstOrThrow({
      where: { userId: user.id, kind: "PERFORMANCE" },
    });
    const balance = await getAccountBalance(user.id, performanceAccount.id);
    expect(balance).toBeCloseTo(100_000 + 2000, 6); // starting balance + ONLY the settled trade's PnL

    const pendingAlloc = await performanceAllocation(pendingTrade.id);
    expect(pendingAlloc.closingPnlNet).toBeNull(); // never coalesced to breakeven 0
  });

  it("16. re-settlement after an execution correction replaces the stale result with the corrected one", async () => {
    const user = await makeUser("re-settle");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-17", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });
    expect((await performanceAllocation(trade.id)).closingPnlNet?.toNumber()).toBeCloseTo(2000, 6);

    // Correct the exit price after the fact (e.g. a data-entry fix).
    await updateTradeSections(user.id, trade.id, { actualExit: 110 });

    const corrected = await performanceAllocation(trade.id);
    expect(corrected.closingPnlNet?.toNumber()).toBeCloseTo(1000, 6); // now 1R, not the stale 2R
  });

  it("17. Trade.actualRR matches PerformanceRiskSnapshot.realizedR exactly after canonical settlement", async () => {
    const user = await makeUser("actualrr-sync");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-08-18", minimalTradeInput({ direction: "SHORT" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 110, actualExit: 80 });

    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    const snapshot = await performanceSnapshot(trade.id);
    expect(reloaded.actualRR?.toNumber()).toBeCloseTo(snapshot.realizedR!.toNumber(), 6);
  });
});

describe("performance-account.service.ts — canonical initial stop (Stage C.1, Part 1)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  // PLANNED_FALLBACK exists for a Trade.plannedStopLoss that was never routed
  // through a confirmed/locked TradePlanVersion — legacy data, in practice
  // (Today V2 Phase 2 §1 removed the last live write path for this column
  // outside of trade-plan.service's savePlan). These tests write it directly
  // via Prisma to simulate exactly that legacy shape, rather than through
  // updateTradeSections (which no longer accepts it).

  it("1. inherits the simple planned stop as the initial stop when execution never overrides it", async () => {
    const user = await makeUser("inherit-planned");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-01", minimalTradeInput({ direction: "LONG" }));
    await prisma.trade.update({ where: { id: trade.id }, data: { plannedStopLoss: "90" } });
    // No actualStopLoss at all — only entry + exit.
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualExit: 120 });

    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.initialStop?.toNumber()).toBe(90);
    expect(snapshot.initialStopSource).toBe("PLANNED_FALLBACK");
    expect(snapshot.realizedR?.toNumber()).toBeCloseTo(2, 6); // (120-100)/(100-90)
  });

  it("2. an explicit actual execution stop overrides the planned stop", async () => {
    const user = await makeUser("actual-overrides-planned");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-02", minimalTradeInput({ direction: "LONG" }));
    await prisma.trade.update({ where: { id: trade.id }, data: { plannedStopLoss: "95" } }); // intended stop
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 }); // actual fill had a wider stop

    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.initialStop?.toNumber()).toBe(90); // the ACTUAL stop, not the planned 95
    expect(snapshot.initialStopSource).toBe("ACTUAL");
    expect(snapshot.realizedR?.toNumber()).toBeCloseTo(2, 6); // (120-100)/(100-90), not /(100-95)
  });

  it("3. moving the stop to break-even after entry does not change the frozen original risk", async () => {
    const user = await makeUser("move-to-be");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-03", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 2000, actualStopLoss: 1990 }); // locks initialStop = 1990
    await updateTradeSections(user.id, trade.id, { actualStopLoss: 2000 }); // trader moves SL to break-even
    await updateTradeSections(user.id, trade.id, { actualExit: 2020 });

    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.initialStop?.toNumber()).toBe(1990); // frozen at the ORIGINAL stop, not 2000
    expect(snapshot.realizedR?.toNumber()).toBeCloseTo(2, 6); // (2020-2000)/(2000-1990) = 2R, matches the spec example exactly
  });

  it("4. moving the stop further into profit after entry does not change the frozen original risk", async () => {
    const user = await makeUser("move-into-profit");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-04", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90 }); // locks initialStop = 90
    await updateTradeSections(user.id, trade.id, { actualStopLoss: 110 }); // trailed well past entry
    await updateTradeSections(user.id, trade.id, { actualExit: 130 });

    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.initialStop?.toNumber()).toBe(90); // still the original 90, never the trailed 110
    expect(snapshot.realizedR?.toNumber()).toBeCloseTo(3, 6); // (130-100)/(100-90) = 3R
  });

  it("5. editing the simple planned stop after the initial stop has been frozen never alters it", async () => {
    const user = await makeUser("edit-plan-after-freeze");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-05", minimalTradeInput({ direction: "LONG" }));
    await prisma.trade.update({ where: { id: trade.id }, data: { plannedStopLoss: "90" } });
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualExit: 120 }); // freezes initialStop = 90 via PLANNED_FALLBACK

    // Edit the plan's stop after the fact — must not retroactively change the frozen risk.
    await prisma.trade.update({ where: { id: trade.id }, data: { plannedStopLoss: "80" } });
    await settlePerformanceTrade(user.id, trade.id);

    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.initialStop?.toNumber()).toBe(90); // unchanged
    expect(snapshot.realizedR?.toNumber()).toBeCloseTo(2, 6); // still (120-100)/(100-90)
  });

  it("6. no trustworthy initial stop of any kind leaves the result NOT_CALCULABLE", async () => {
    const user = await makeUser("no-stop-anywhere");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-06", minimalTradeInput({ direction: "LONG" }));
    // No plannedStopLoss, no locked plan, no actualStopLoss.
    const result = await (async () => {
      await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualExit: 120 });
      return settlePerformanceTrade(user.id, trade.id);
    })();

    expect(result.status).toBe("NOT_CALCULABLE");
    const alloc = await performanceAllocation(trade.id);
    expect(alloc.closingPnlNet).toBeNull();
  });

  it("7. LONG realized R is measured against the original (not moved) risk unit", async () => {
    const user = await makeUser("long-original-risk");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-07", minimalTradeInput({ direction: "LONG" }));
    await prisma.trade.update({ where: { id: trade.id }, data: { plannedStopLoss: "1990" } });
    await updateTradeSections(user.id, trade.id, { actualEntry: 2000, actualExit: 2020 }); // PLANNED_FALLBACK freezes 1990

    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.realizedR?.toNumber()).toBeCloseTo(2, 6); // (2020-2000)/(2000-1990)
  });

  it("8. SHORT realized R is measured against the original (not moved) risk unit", async () => {
    const user = await makeUser("short-original-risk");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-08", minimalTradeInput({ direction: "SHORT" }));
    await prisma.trade.update({ where: { id: trade.id }, data: { plannedStopLoss: "2010" } });
    await updateTradeSections(user.id, trade.id, { actualEntry: 2000, actualExit: 1980 }); // PLANNED_FALLBACK freezes 2010

    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.realizedR?.toNumber()).toBeCloseTo(2, 6); // (2000-1980)/(2010-2000)
  });

  it("9. partial exits are all measured against the same frozen original risk unit, even if the stop later moves", async () => {
    const user = await makeUser("partials-same-risk");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-09", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90 }); // locks initialStop = 90
    await prisma.tradeActualPartialExit.create({
      data: { userId: user.id, tradeId: trade.id, exitOrder: 1, exitPrice: 110, percentClosed: 50, exitedAt: new Date() }, // R = 1 vs the original 90 stop
    });
    await updateTradeSections(user.id, trade.id, { actualStopLoss: 100 }); // moved to break-even between exits
    await prisma.tradeActualPartialExit.create({
      data: { userId: user.id, tradeId: trade.id, exitOrder: 2, exitPrice: 130, percentClosed: 50, exitedAt: new Date() }, // R = 3 vs the original 90 stop
    });

    const result = await settlePerformanceTrade(user.id, trade.id);
    expect(result.status).toBe("SETTLED");
    if (result.status !== "SETTLED") throw new Error("unreachable");
    expect(result.realizedR.toNumber()).toBeCloseTo(2, 6); // 0.5x1 + 0.5x3, both against the frozen 90 stop

    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.initialStop?.toNumber()).toBe(90);
  });
});

describe("getPerformanceRiskContext — Trade Idea presentation (Today V2 T3)", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("16/17/18. a new trade automatically participates at the default risk%, with a derived (never fake-zero) risk amount", async () => {
    const user = await makeUser("risk-context-default");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-20", minimalTradeInput());
    const context = await getPerformanceRiskContext(user.id, trade.id);

    expect(context.locked).toBe(false);
    expect(context.riskPercent).toBeCloseTo(1, 6); // account default
    expect(context.balanceBefore).toBeCloseTo(100_000, 6);
    expect(context.riskAmount).toBeCloseTo(1000, 6); // derived, never manually entered
  });

  it("17. the risk% override is editable through the canonical path before lock, and the derived amount updates with it", async () => {
    const user = await makeUser("risk-context-override");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-21", minimalTradeInput());
    await updatePerformanceRiskOverride(user.id, trade.id, 2);

    const context = await getPerformanceRiskContext(user.id, trade.id);
    expect(context.riskPercent).toBeCloseTo(2, 6);
    expect(context.riskAmount).toBeCloseTo(2000, 6); // 2% of $100,000, derived
  });

  it("locked: reads the frozen historical values, not a live recomputation", async () => {
    const user = await makeUser("risk-context-locked");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-09-22", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    const context = await getPerformanceRiskContext(user.id, trade.id);
    expect(context.locked).toBe(true);
    expect(context.riskPercent).toBeCloseTo(1, 6);
    expect(context.balanceBefore).toBeCloseTo(100_000, 6);
    expect(context.riskAmount).toBeCloseTo(1000, 6);

    // Overriding risk% is rejected once locked — the canonical guard already
    // enforced by updatePerformanceRiskOverride, not re-implemented here.
    await expect(updatePerformanceRiskOverride(user.id, trade.id, 5)).rejects.toThrow();
  });
});

// Today V2 Phase 2 — items not already covered by the Stage C/C.1 suites
// above: plan inheritance leaving the plan itself untouched (§5/§7/tests
// 7/8), and the canonical settlement result always winning over a stale or
// manually-supplied Trade.actualRR (§8/test 13).
describe("performance-account.service.ts — Today V2 Phase 2", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("7. an explicit actual entry override never mutates the trade's planned entry", async () => {
    const user = await makeUser("entry-override-preserves-plan");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-10-01", minimalTradeInput({ direction: "LONG" }));
    await prisma.trade.update({ where: { id: trade.id }, data: { plannedEntry: "2000" } });

    // Execution genuinely differed from the plan.
    await updateTradeSections(user.id, trade.id, { actualEntry: 2005, actualStopLoss: 1990, actualExit: 2020 });

    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.plannedEntry?.toNumber()).toBe(2000); // untouched
    expect(reloaded.actualEntry?.toNumber()).toBe(2005); // the real override, preserved separately
  });

  it("8. an explicit initial-stop override never mutates the trade's planned stop", async () => {
    const user = await makeUser("stop-override-preserves-plan");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-10-02", minimalTradeInput({ direction: "LONG" }));
    await prisma.trade.update({ where: { id: trade.id }, data: { plannedStopLoss: "95" } });

    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(reloaded.plannedStopLoss?.toNumber()).toBe(95); // untouched — the plan stays what was planned
    const snapshot = await performanceSnapshot(trade.id);
    expect(snapshot.initialStop?.toNumber()).toBe(90); // the ACTUAL override is what risk is measured against
  });

  it("13. a stale/manually-supplied Trade.actualRR is overwritten by the canonical settlement result on the next save", async () => {
    const user = await makeUser("actualrr-cannot-override-canonical");
    userIds.push(user.id);

    const trade = await createTrade(user.id, "2026-10-03", minimalTradeInput({ direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 100, actualStopLoss: 90, actualExit: 120 });

    const settled = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(settled.actualRR?.toNumber()).toBeCloseTo(2, 6); // the real, canonical result

    // Simulate a stale/malicious client submitting a fabricated actualRR
    // alongside an otherwise-unrelated field edit (Today V2 Phase 2 §8 —
    // the live form no longer exposes this input at all, but the service
    // itself must still be safe against a crafted payload).
    await updateTrade(user.id, trade.id, minimalTradeInput({ direction: "LONG", actualRR: 999 }));

    const reloaded = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    // The canonical settlement re-run (updateTrade's own .then()) wins —
    // never the manually-supplied 999.
    expect(reloaded.actualRR?.toNumber()).toBeCloseTo(2, 6);
  });
});
