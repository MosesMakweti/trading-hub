import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { setReviewLifecycleStatus } from "@/server/services/trade-review.service";
import { createReplayReviewSession, startReplayReviewSession } from "@/server/services/replay-review.service";
import { createReplayDecision } from "@/server/services/replay-trade.service";
import { getReplayComparison } from "@/server/services/replay-comparison.service";
import { createManualComparisonLink, setMissedOpportunityClassification } from "@/server/services/replay-comparison-link.service";
import { completeReplayReviewSession } from "@/server/services/replay-review.service";
import type { TradeInput } from "@/lib/validation/trades";

/** Real integration test against the dev Postgres DB — confirms the service
 *  wires the frozen baseline + ReplayTrade list into the pure comparison
 *  builder correctly, and never touches real Trade/Performance data. */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `replay-comparison-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

function minimalTradeInput(overrides: Partial<TradeInput> = {}): TradeInput {
  return {
    strategyId: "",
    assetSymbol: "XAUUSD",
    executionMinutes: 570,
    direction: "LONG",
    higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 80,
    selectedSession: null,
    expectedRR: null,
    actualRR: null,
    performanceRiskPercentOverride: null,
    psychPreTradeMindset: null,
    psychPostTradeReflection: null,
    psychLessonsLearned: null,
    psychWhatToWorkOn: null,
    allocations: [],
    propFirmExecutions: [],
    selectedConfluences: [],
    selectedExecution: [],
    selectedEntryModel: null,
    psychologyAnswers: {},
    setupTypeId: null,
    selectedSetupConditions: [],
    setupOverrideReason: null,
    setupOverrideNote: null,
    preTradeMoodTags: [],
    preTradeMoodIntensity: null,
    preTradeMoodNote: null,
    ...overrides,
  } as TradeInput;
}

describe("getReplayComparison", () => {
  it("returns null when the review has never been started (no frozen baseline)", async () => {
    const user = await makeUser("not-started");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    expect(await getReplayComparison(user.id, session.id)).toBeNull();
  });

  it("compares the frozen Actual baseline against ReplayTrade data, isolated from each other", async () => {
    const user = await makeUser("compare");
    const winner = await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "XAUUSD", executionMinutes: 840 })); // 14:00 UTC — matches the Replay decision's historicalTimestamp below
    await updateTradeSections(user.id, winner.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, winner.id, { status: "FULLY_CLOSED" });

    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(user.id, session.id);

    await createReplayDecision(user.id, session.id, {
      historicalTimestamp: new Date("2026-08-04T14:00:00.000Z").getTime(),
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });

    const comparison = await getReplayComparison(user.id, session.id);
    expect(comparison).not.toBeNull();
    expect(comparison!.actual.metrics.executedTrades).toBe(1);
    expect(comparison!.actual.metrics.totalRealizedR).toBeCloseTo(2, 4);
    expect(comparison!.replay.metrics.executedTrades).toBe(1);
    expect(comparison!.matched).toHaveLength(1); // same day + asset — paired
    expect(comparison!.matched[0].outcome.actualR).toBeCloseTo(2, 4);
    // Enriched (Stage 15.1) evidence-scored match — same direction/entry/
    // stop/timing on both sides, so this should score HIGH, not the legacy
    // array-order fallback.
    expect(comparison!.matched[0].confidence).toBe("HIGH");
    expect(comparison!.matched[0].reason).toBe("EXACT_CONTEXT_MATCH");
    expect(comparison!.matched[0].actualSnapshot).not.toBeNull();
  });

  it("honors a manual EXCLUDED link end-to-end, overriding what would otherwise be a strong auto-match", async () => {
    const user = await makeUser("manual-exclude");
    const trade = await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "XAUUSD", direction: "LONG" }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });

    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(user.id, session.id);
    const replayTrade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: new Date("2026-08-04T14:00:00.000Z").getTime(),
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });

    const beforeExclusion = await getReplayComparison(user.id, session.id);
    expect(beforeExclusion!.matched).toHaveLength(1);

    await createManualComparisonLink(user.id, session.id, { actualTradeId: trade.id, replayTradeId: replayTrade.id, linkType: "EXCLUDED" });

    const afterExclusion = await getReplayComparison(user.id, session.id);
    expect(afterExclusion!.matched).toHaveLength(0);
    expect(afterExclusion!.opportunity.unmatchedActual).toHaveLength(1);
    expect(afterExclusion!.opportunity.unmatchedReplayTaken).toHaveLength(1);
  });

  it("rejects reading another user's session", async () => {
    const owner = await makeUser("cmp-owner");
    const attacker = await makeUser("cmp-attacker");
    const session = await createReplayReviewSession(owner.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(owner.id, session.id);

    expect(await getReplayComparison(attacker.id, session.id)).toBeNull();
  });

  it("an unconfirmed Replay TAKEN with no Actual match is a Potential Missed Opportunity, never auto-counted", async () => {
    const user = await makeUser("potential-missed");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(user.id, session.id);
    const replayTrade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: new Date("2026-08-04T14:00:00.000Z").getTime(),
      assetSymbol: "EURUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1.1,
      initialStopLoss: 1.09,
      targets: [{ price: 1.13, percentToClose: 100 }],
    });

    const before = await getReplayComparison(user.id, session.id);
    expect(before!.opportunity.unmatchedReplayTaken[0].missedOpportunityStatus).toBe("UNCONFIRMED");
    expect(before!.discrepancy.opportunityDiscrepancy.count).toBe(0); // never auto-counted

    await setMissedOpportunityClassification(user.id, session.id, replayTrade.id, "CONFIRMED_MISSED");

    const after = await getReplayComparison(user.id, session.id);
    expect(after!.opportunity.unmatchedReplayTaken[0].missedOpportunityStatus).toBe("CONFIRMED_MISSED");
    expect(after!.discrepancy.opportunityDiscrepancy.count).toBe(1);
    expect(after!.discrepancy.opportunityDiscrepancy.entries[0].replayTradeId).toBe(replayTrade.id);
  });

  it("rejecting a Potential Missed Opportunity ('Not a Missed Opportunity') keeps it out of Opportunity Discrepancy", async () => {
    const user = await makeUser("not-missed");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(user.id, session.id);
    const replayTrade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: new Date("2026-08-04T14:00:00.000Z").getTime(),
      assetSymbol: "EURUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1.1,
      initialStopLoss: 1.09,
      targets: [{ price: 1.13, percentToClose: 100 }],
    });

    await setMissedOpportunityClassification(user.id, session.id, replayTrade.id, "NOT_MISSED");
    const comparison = await getReplayComparison(user.id, session.id);
    expect(comparison!.discrepancy.opportunityDiscrepancy.count).toBe(0);
    expect(comparison!.opportunity.unmatchedReplayTaken[0].missedOpportunityStatus).toBe("NOT_MISSED");
  });

  it("marks the comparison provisional while IN_PROGRESS and final once COMPLETED", async () => {
    const user = await makeUser("provisional-status");
    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(user.id, session.id);

    const inProgress = await getReplayComparison(user.id, session.id);
    expect(inProgress!.sessionStatus).toBe("IN_PROGRESS");
    expect(inProgress!.isProvisional).toBe(true);

    await completeReplayReviewSession(user.id, session.id);
    const completed = await getReplayComparison(user.id, session.id);
    expect(completed!.sessionStatus).toBe("COMPLETED");
    expect(completed!.isProvisional).toBe(false);
  });

  it("manual matching and missed-opportunity confirmation never mutate Trade, canonical Analytics inputs, or ReplayTrade", async () => {
    const user = await makeUser("comparison-isolation");
    const trade = await createTrade(user.id, "2026-08-04", minimalTradeInput({ assetSymbol: "XAUUSD", executionMinutes: 840 }));
    await updateTradeSections(user.id, trade.id, { actualEntry: 1900, actualStopLoss: 1890, actualExit: 1920 });
    await setReviewLifecycleStatus(user.id, trade.id, { status: "FULLY_CLOSED" });

    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
    await startReplayReviewSession(user.id, session.id);
    const replayTrade = await createReplayDecision(user.id, session.id, {
      historicalTimestamp: new Date("2026-08-04T14:00:00.000Z").getTime(),
      assetSymbol: "XAUUSD",
      direction: "LONG",
      decisionType: "TAKEN",
      selectedConditionIds: [],
      orderType: "MARKET",
      entryPrice: 1900,
      initialStopLoss: 1890,
      targets: [{ price: 1920, percentToClose: 100 }],
    });

    const beforeTrade = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    const beforeReplay = await prisma.replayTrade.findUniqueOrThrow({ where: { id: replayTrade.id } });

    await createManualComparisonLink(user.id, session.id, { actualTradeId: trade.id, replayTradeId: replayTrade.id, linkType: "MATCHED" });
    await setMissedOpportunityClassification(user.id, session.id, replayTrade.id, "NOT_MISSED");
    await getReplayComparison(user.id, session.id);

    const afterTrade = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    const afterReplay = await prisma.replayTrade.findUniqueOrThrow({ where: { id: replayTrade.id } });
    expect(afterTrade.updatedAt.getTime()).toBe(beforeTrade.updatedAt.getTime());
    expect(afterReplay.updatedAt.getTime()).toBe(beforeReplay.updatedAt.getTime());
    expect(afterReplay.decisionType).toBe(beforeReplay.decisionType);
  });
});
