import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { quickIdeaSchema, recordEntrySchema } from "@/lib/validation/today-v3";
import { missOutcomeSchema } from "@/lib/validation/opportunity";
import { tradeSchema } from "@/lib/validation/trades";
import { getOrCreateTradingDay } from "@/server/services/trading-day.service";
import { getOrCreateDayRoutine, setRoutineReady } from "@/server/services/today-routine.service";
import { createOrGetDailyAssetAnalysis, updateDailyAssetAnalysis } from "@/server/services/daily-asset-analysis.service";
import { savePlan } from "@/server/services/trade-plan.service";
import { upsertPartialExit } from "@/server/services/trade-partial-exit.service";
import { setReviewLifecycleStatus } from "@/server/services/trade-review.service";
import { archiveTrade, getTrade, updateTrade } from "@/server/services/trades.service";
import { tradeToFormValues } from "@/server/services/trade-input.mapper";
import { createQuickIdea, getDayLimitState, recordFirstEntry } from "@/server/services/today-trade.service";
import { completeReview, getV3ReviewData, setReviewTradeIntent, updateReviewFields } from "@/server/services/trade-review-v3.service";
import {
  getOpportunityInputs,
  listOpportunityDtosForDay,
  OpportunityError,
  recordCancelledIdeaAsMissed,
} from "@/server/services/opportunity.service";
import { getCanonicalAnalyticsDataset } from "@/server/services/analytics-canonical.service";
import { closeTradingDayV3, DayAlreadyClosedError, getCloseDayV3 } from "@/server/services/close-day-v3.service";
import { loadTradingWorkspace } from "@/server/services/trading-workspace.service";
import {
  completeReplayReviewSession,
  createReplayReviewSession,
  finalizeEdgeReview,
  startReplayReviewSession,
} from "@/server/services/replay-review.service";
import { createManualCommitment } from "@/server/services/edge-review-commitment.service";

/** Today V3 (Phase 5) — hardening regressions across the integrated flow. */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
const tick = () => new Promise((r) => setTimeout(r, 15));

async function readyUser(label: string, dateKey: string) {
  const user = await createTestUser(label);
  userIds.push(user.id);
  const section = await prisma.routineSection.create({ data: { userId: user.id, title: "Prep", sortOrder: 0 } });
  await prisma.routineItem.create({
    data: { userId: user.id, sectionId: section.id, label: "Optional", type: "CHECKBOX", isMandatory: false, sortOrder: 0 },
  });
  await runLive(async () => {
    const day = await getOrCreateTradingDay(user.id, dateKey);
    await getOrCreateDayRoutine(user.id, day);
    await setRoutineReady(user.id, dateKey, true);
  });
  return user;
}

const idea = (o: Record<string, unknown> = {}) =>
  quickIdeaSchema.parse({ assetSymbol: "XAUUSD", direction: "LONG", nowMinutes: 615, ...o });
const miss = () => missOutcomeSchema.parse({ missReason: "HESITATION", missedOutcome: "MISSED_UNDETERMINED" });

async function cancelledIdea(userId: string, dateKey: string) {
  const { tradeId } = await createQuickIdea(userId, dateKey, idea());
  await setReviewLifecycleStatus(userId, tradeId, { status: "CANCELLED_NEVER_TRIGGERED", cancellationReason: "No retest" });
  return tradeId;
}

describe("Journal full-form edit of a LIVE V3 trade", () => {
  it("preserves V3 data and never turns an interim review into REVIEWED", async () => {
    const dateKey = "2026-09-01";
    const user = await readyUser("p5-journal-edit", dateKey);
    await runLive(async () => {
      const a = await createOrGetDailyAssetAnalysis(user.id, dateKey, "XAUUSD");
      await updateDailyAssetAnalysis(user.id, a.id, { htfBias: "BULLISH", finalBias: "LONG" });
      await prisma.tradingDay.updateMany({ where: { userId: user.id }, data: { maxTradesPerDay: 0 } });
      const { tradeId } = await createQuickIdea(
        user.id,
        dateKey,
        idea({ preTradeMoodTags: ["CALM"], limitOverrideReason: "Planned exception" }),
      );
      await savePlan(user.id, tradeId, {
        direction: "LONG",
        timeframe: "15m",
        entry: 1900,
        stopLoss: 1890,
        targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1910, plannedClosePercent: 100 }],
      });
      await recordFirstEntry(user.id, dateKey, tradeId, recordEntrySchema.parse({ actualEntry: 1900, entryMinutes: 600 }));
      await setReviewTradeIntent(user.id, tradeId, "PLANNED");
      await updateReviewFields(user.id, tradeId, {
        adherenceAnswers: { followedStrategy: true, followedEntryModel: true, followedTradeManagement: true, remainedPatient: true },
        whatWentWell: "Patient entry",
      });
      expect((await completeReview(user.id, tradeId)).mode).toBe("INTERIM");
      await tick();
      await upsertPartialExit(user.id, tradeId, { exitOrder: 1, exitPrice: 1910, percentClosed: 100, exitedAt: new Date() });
      const before = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { planVersions: true } });
      expect(before.status).toBe("CLOSED");

      // The Journal edit form re-saves every field it knows about.
      const trade = await getTrade(user.id, tradeId);
      await updateTrade(user.id, tradeId, tradeSchema.parse({ ...tradeToFormValues(trade!), marketContext: "edited in Journal" }));

      const after = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { planVersions: true } });
      expect(after.status).toBe("CLOSED");
      expect((await getV3ReviewData(user.id, tradeId)).state).toBe("FINAL_REVIEW_REQUIRED");
      expect(after).toMatchObject({
        preTradeMoodTags: ["CALM"],
        tradeIntent: "PLANNED",
        dailyBiasSnapshot: before.dailyBiasSnapshot,
        limitOverrideReason: "Planned exception",
        reviewedAt: before.reviewedAt,
        whatWentWell: "Patient entry",
      });
      expect(after.limitOverrideContext).toEqual(before.limitOverrideContext);
      expect(after.adherenceAnswers).toEqual(before.adherenceAnswers);
      expect(after.planVersions.map((v) => [v.versionNumber, v.locked, String(v.entry)])).toEqual(
        before.planVersions.map((v) => [v.versionNumber, v.locked, String(v.entry)]),
      );
      expect(after.actualEntry?.toNumber()).toBe(1900);
    });
  });
});

describe("originTradeId — ownership, idempotency, deletion, counting", () => {
  it("is user-scoped server-side and at the database level", async () => {
    const dateKey = "2026-09-02";
    const owner = await readyUser("p5-origin-owner", dateKey);
    const other = await readyUser("p5-origin-other", dateKey);
    await runLive(async () => {
      const tradeId = await cancelledIdea(owner.id, dateKey);
      await expect(recordCancelledIdeaAsMissed(other.id, tradeId, miss())).rejects.toBeInstanceOf(OpportunityError);
      await expect(
        prisma.tradeOpportunity.create({
          data: { userId: other.id, spottedAt: new Date(`${dateKey}T00:00:00Z`), assetSymbol: "XAUUSD", direction: "LONG", status: "MISSED", originTradeId: tradeId },
        }),
      ).rejects.toThrow(/OWNERSHIP/);
      expect(await prisma.tradeOpportunity.count({ where: { userId: other.id } })).toBe(0);
    });
  });

  it("a double submit creates exactly one opportunity", async () => {
    const dateKey = "2026-09-03";
    const user = await readyUser("p5-origin-double", dateKey);
    await runLive(async () => {
      const tradeId = await cancelledIdea(user.id, dateKey);
      const [a, b] = await Promise.all([
        recordCancelledIdeaAsMissed(user.id, tradeId, miss()),
        recordCancelledIdeaAsMissed(user.id, tradeId, miss()),
      ]);
      expect(a.id).toBe(b.id);
      expect(await prisma.tradeOpportunity.count({ where: { userId: user.id } })).toBe(1);
    });
  });

  it("soft-deleting the origin trade keeps the opportunity intact and drops the provenance display", async () => {
    const dateKey = "2026-09-04";
    const user = await readyUser("p5-origin-delete", dateKey);
    await runLive(async () => {
      const tradeId = await cancelledIdea(user.id, dateKey);
      const op = await recordCancelledIdeaAsMissed(user.id, tradeId, miss());
      await archiveTrade(user.id, tradeId);

      const dtos = await listOpportunityDtosForDay(user.id, dateKey);
      expect(dtos).toEqual([expect.objectContaining({ id: op.id, status: "MISSED", originTrade: null })]);
      const close = await getCloseDayV3(user.id, dateKey);
      expect(close.performance).toMatchObject({ ideas: 0, cancelled: 0, missed: 1 });
      expect(close.cancelledIdeas).toEqual([]);
      expect(close.missedOpportunities[0].originTrade).toBeNull();
    });
  });

  it("one decision counts once: the cancelled trade is never executed, the missed opportunity is the only discrepancy input", async () => {
    const dateKey = "2026-09-07";
    const user = await readyUser("p5-origin-count", dateKey);
    await runLive(async () => {
      const tradeId = await cancelledIdea(user.id, dateKey);
      const op = await recordCancelledIdeaAsMissed(user.id, tradeId, miss());

      const rows = await getCanonicalAnalyticsDataset(user.id, { from: dateKey, to: dateKey });
      expect(rows.filter((r) => r.isExecuted)).toHaveLength(0);
      const inputs = (await getOpportunityInputs(user.id)) as unknown[];
      expect(inputs).toHaveLength(1);
      expect(JSON.stringify(inputs)).toContain(op.id);
      expect(JSON.stringify(inputs)).not.toContain(tradeId);
      expect((await getDayLimitState(user.id, dateKey)).usage).toMatchObject({ executedCount: 0, riskUsedPercent: 0 });
    });
  });
});

describe("Close — double submit and Edge Review separation", () => {
  it("two concurrent closes archive the day once; daily focus and an Edge commitment stay independent", async () => {
    const friday = "2026-09-11";
    const monday = "2026-09-14";
    const user = await readyUser("p5-close-edge", friday);

    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-09-07", endDate: "2026-09-13" });
    await startReplayReviewSession(user.id, session.id);
    await completeReplayReviewSession(user.id, session.id);
    await finalizeEdgeReview(user.id, session.id);
    const commitment = await createManualCommitment(user.id, session.id, { category: "EXECUTION", title: "Never widen a stop", description: null, priority: "HIGH" });

    const results = await runLive(() =>
      Promise.allSettled([
        closeTradingDayV3(user.id, friday, { dayCarryForward: "Max two trades" }),
        closeTradingDayV3(user.id, friday, { dayCarryForward: "Max two trades" }),
      ]),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(DayAlreadyClosedError);

    const after = await prisma.edgeReviewCommitment.findUniqueOrThrow({ where: { id: commitment.id } });
    expect(after.title).toBe("Never widen a stop");
    expect(await prisma.edgeReviewCommitment.count({ where: { userId: user.id } })).toBe(1);

    const data = await loadTradingWorkspace(user.id, monday, { environment: "LIVE" });
    expect(data.carryForward).toMatchObject({ fromDateKey: friday, carryForward: "Max two trades" });
    expect(data.carryForward?.carryForward).not.toContain("widen");
  });
});
