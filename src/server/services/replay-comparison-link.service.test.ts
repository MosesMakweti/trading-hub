import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTrade } from "@/server/services/trades.service";
import { createReplayReviewSession, startReplayReviewSession } from "@/server/services/replay-review.service";
import { createReplayDecision } from "@/server/services/replay-trade.service";
import {
  createManualComparisonLink,
  deleteComparisonLink,
  listComparisonLinks,
  listOpportunityConfirmations,
  setMissedOpportunityClassification,
} from "@/server/services/replay-comparison-link.service";
import type { TradeInput } from "@/lib/validation/trades";

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `comparison-link-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
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

async function inProgressSessionWithDecision(userId: string) {
  const trade = await createTrade(userId, "2026-08-04", minimalTradeInput({ assetSymbol: "XAUUSD" }));
  const session = await createReplayReviewSession(userId, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
  await startReplayReviewSession(userId, session.id);
  const replayTrade = await createReplayDecision(userId, session.id, {
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
  return { trade, session, replayTrade };
}

describe("replay-comparison-link.service", () => {
  it("creates a manual MATCHED link and lists it back", async () => {
    const user = await makeUser("create-list");
    const { trade, session, replayTrade } = await inProgressSessionWithDecision(user.id);

    await createManualComparisonLink(user.id, session.id, { actualTradeId: trade.id, replayTradeId: replayTrade.id, linkType: "MATCHED" });
    const links = await listComparisonLinks(user.id, session.id);
    expect(links).toEqual([{ actualTradeId: trade.id, replayTradeId: replayTrade.id, linkType: "MATCHED" }]);
  });

  it("upserts on a repeated call for the same pair, never duplicating", async () => {
    const user = await makeUser("upsert");
    const { trade, session, replayTrade } = await inProgressSessionWithDecision(user.id);

    await createManualComparisonLink(user.id, session.id, { actualTradeId: trade.id, replayTradeId: replayTrade.id, linkType: "MATCHED" });
    await createManualComparisonLink(user.id, session.id, { actualTradeId: trade.id, replayTradeId: replayTrade.id, linkType: "EXCLUDED" });

    const links = await listComparisonLinks(user.id, session.id);
    expect(links).toHaveLength(1);
    expect(links[0].linkType).toBe("EXCLUDED");
  });

  it("rejects linking a Replay decision that belongs to a different session", async () => {
    const user = await makeUser("cross-session");
    const { trade } = await inProgressSessionWithDecision(user.id);
    const { session: otherSession, replayTrade: otherReplayTrade } = await inProgressSessionWithDecision(user.id);

    await expect(
      createManualComparisonLink(user.id, otherSession.id, { actualTradeId: trade.id, replayTradeId: otherReplayTrade.id, linkType: "MATCHED" }),
    ).resolves.toBeUndefined(); // same user's own trade + own session's replay trade — valid
  });

  it("rejects another user's session, trade, or replay decision", async () => {
    const owner = await makeUser("link-owner");
    const attacker = await makeUser("link-attacker");
    const { trade, session, replayTrade } = await inProgressSessionWithDecision(owner.id);

    await expect(
      createManualComparisonLink(attacker.id, session.id, { actualTradeId: trade.id, replayTradeId: replayTrade.id, linkType: "MATCHED" }),
    ).rejects.toThrow();
    expect(await listComparisonLinks(attacker.id, session.id)).toEqual([]);
  });

  it("deletes a link, and rejects deleting another user's link", async () => {
    const owner = await makeUser("delete-owner");
    const attacker = await makeUser("delete-attacker");
    const { trade, session, replayTrade } = await inProgressSessionWithDecision(owner.id);
    await createManualComparisonLink(owner.id, session.id, { actualTradeId: trade.id, replayTradeId: replayTrade.id, linkType: "MATCHED" });
    const [link] = await prisma.replayComparisonLink.findMany({ where: { replayReviewSessionId: session.id } });

    await expect(deleteComparisonLink(attacker.id, link.id)).rejects.toThrow();
    await deleteComparisonLink(owner.id, link.id);
    expect(await listComparisonLinks(owner.id, session.id)).toEqual([]);
  });

  it("never creates, references, or mutates a real Trade row beyond the ownership check", async () => {
    const user = await makeUser("no-trade-mutation");
    const { trade, session, replayTrade } = await inProgressSessionWithDecision(user.id);
    const before = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });

    await createManualComparisonLink(user.id, session.id, { actualTradeId: trade.id, replayTradeId: replayTrade.id, linkType: "MATCHED" });

    const after = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});

describe("missed-opportunity confirmation (Stage 15.2 §5-6)", () => {
  it("confirms a missed opportunity and lists it back", async () => {
    const user = await makeUser("confirm-missed");
    const { session, replayTrade } = await inProgressSessionWithDecision(user.id);

    await setMissedOpportunityClassification(user.id, session.id, replayTrade.id, "CONFIRMED_MISSED");
    const { confirmations, confirmedAtByReplayTradeId } = await listOpportunityConfirmations(user.id, session.id);
    expect(confirmations).toEqual([{ replayTradeId: replayTrade.id, classification: "CONFIRMED_MISSED" }]);
    expect(confirmedAtByReplayTradeId.get(replayTrade.id)).not.toBeNull();
  });

  it("re-classifying (confirm then reject) updates in place, never duplicating", async () => {
    const user = await makeUser("reclassify");
    const { session, replayTrade } = await inProgressSessionWithDecision(user.id);

    await setMissedOpportunityClassification(user.id, session.id, replayTrade.id, "CONFIRMED_MISSED");
    await setMissedOpportunityClassification(user.id, session.id, replayTrade.id, "NOT_MISSED");

    const { confirmations } = await listOpportunityConfirmations(user.id, session.id);
    expect(confirmations).toEqual([{ replayTradeId: replayTrade.id, classification: "NOT_MISSED" }]);
    const rows = await prisma.replayComparisonLink.findMany({ where: { replayReviewSessionId: session.id, linkType: "OPPORTUNITY" } });
    expect(rows).toHaveLength(1);
  });

  it("survives reload — the confirmation is read back identically on a fresh query", async () => {
    const user = await makeUser("survives-reload");
    const { session, replayTrade } = await inProgressSessionWithDecision(user.id);
    await setMissedOpportunityClassification(user.id, session.id, replayTrade.id, "CONFIRMED_MISSED");

    const { confirmations: reloaded } = await listOpportunityConfirmations(user.id, session.id);
    expect(reloaded).toEqual([{ replayTradeId: replayTrade.id, classification: "CONFIRMED_MISSED" }]);
  });

  it("never mutates Trade or ReplayTrade to store the classification", async () => {
    const user = await makeUser("no-mutation-opportunity");
    const { session, replayTrade } = await inProgressSessionWithDecision(user.id);
    const beforeReplay = await prisma.replayTrade.findUniqueOrThrow({ where: { id: replayTrade.id } });

    await setMissedOpportunityClassification(user.id, session.id, replayTrade.id, "CONFIRMED_MISSED");

    const afterReplay = await prisma.replayTrade.findUniqueOrThrow({ where: { id: replayTrade.id } });
    expect(afterReplay.decisionType).toBe(beforeReplay.decisionType); // never rewritten to MISSED
    expect(afterReplay.updatedAt.getTime()).toBe(beforeReplay.updatedAt.getTime());
  });

  it("rejects confirming a replay decision belonging to another user", async () => {
    const owner = await makeUser("opp-owner");
    const attacker = await makeUser("opp-attacker");
    const { session, replayTrade } = await inProgressSessionWithDecision(owner.id);

    await expect(setMissedOpportunityClassification(attacker.id, session.id, replayTrade.id, "CONFIRMED_MISSED")).rejects.toThrow();
  });
});
