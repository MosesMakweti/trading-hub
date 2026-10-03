import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { quickIdeaSchema, recordEntrySchema } from "@/lib/validation/today-v3";
import { tradeSchema } from "@/lib/validation/trades";
import { getOrCreateTradingDay, endDay } from "@/server/services/trading-day.service";
import { getOrCreateDayRoutine, setRoutineReady } from "@/server/services/today-routine.service";
import { createOrGetDailyAssetAnalysis, updateDailyAssetAnalysis } from "@/server/services/daily-asset-analysis.service";
import { createTrade, updateTradeSections } from "@/server/services/trades.service";
import { savePlan } from "@/server/services/trade-plan.service";
import { upsertPartialExit } from "@/server/services/trade-partial-exit.service";
import { setReviewLifecycleStatus } from "@/server/services/trade-review.service";
import { listBehaviourLabels, listTradeBehaviourLabels } from "@/server/services/behaviour-labels.service";
import { createQuickIdea, listCarriedOpenTrades, recordFirstEntry } from "@/server/services/today-trade.service";
import {
  ReviewIncompleteError,
  completeReview,
  getV3ReviewData,
  reviewWritableOnArchivedDay,
  saveReviewPsychology,
  setReviewTradeIntent,
  updateReviewFields,
} from "@/server/services/trade-review-v3.service";
import { tradeExecutionEditableGuard } from "@/actions/day-guard";
import { utcDateToKey } from "@/lib/date";

/**
 * Today V3 (Phase 3) — integration tests for the V3 Review against the test
 * Postgres DB: derived result / plan-vs-actual / evidence, the canonical
 * questionnaire adapter, explicit completion, interim → final, the LIVE
 * lifecycle sync, and Backtesting isolation.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

const tick = () => new Promise((r) => setTimeout(r, 15));

async function readyUser(label: string, dateKey: string) {
  const user = await createTestUser(label);
  userIds.push(user.id);
  const section = await prisma.routineSection.create({ data: { userId: user.id, title: "Prep", sortOrder: 0 } });
  await prisma.routineItem.create({
    data: { userId: user.id, sectionId: section.id, label: "Optional only", type: "CHECKBOX", isMandatory: false, sortOrder: 0 },
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
const entry = (o: Record<string, unknown> = {}) => recordEntrySchema.parse({ actualEntry: 1900, entryMinutes: 600, ...o });

async function confirmPlan(userId: string, tradeId: string) {
  await savePlan(userId, tradeId, {
    direction: "LONG",
    timeframe: "15m",
    entry: 1900,
    stopLoss: 1890,
    targets: [
      { targetOrder: 1, label: "TP1", targetPrice: 1910, plannedClosePercent: 50 },
      { targetOrder: 2, label: "TP2", targetPrice: 1920, plannedClosePercent: 50 },
    ],
  });
}

const HUMAN = {
  riskManaged: "yes",
  followedExitPlan: "yes",
  influencedBySomeoneElseProfit: "no",
  influencedByOnlineOpinion: "no",
  outcomeWillInfluenceNext: "no",
  monitoringObsession: 20,
};
const PROCESS_ALL_YES = { followedStrategy: true, followedEntryModel: true, followedTradeManagement: true, remainedPatient: true };

async function plannedEnteredTrade(userId: string, dateKey: string, ideaOverrides: Record<string, unknown> = {}) {
  const { tradeId } = await createQuickIdea(userId, dateKey, idea(ideaOverrides));
  await confirmPlan(userId, tradeId);
  await recordFirstEntry(userId, dateKey, tradeId, entry());
  return tradeId;
}

describe("V3 Review — normal planned trade, interim → final", () => {
  it("derives result/plan/evidence, keeps interim separate from final, and completes explicitly", async () => {
    const dateKey = "2026-08-03";
    const user = await readyUser("v3r-normal", dateKey);
    await runLive(async () => {
      const analysis = await createOrGetDailyAssetAnalysis(user.id, dateKey, "XAUUSD");
      await updateDailyAssetAnalysis(user.id, analysis.id, { htfBias: "BULLISH", finalBias: "LONG" });
      const tradeId = await plannedEnteredTrade(user.id, dateKey);

      // Open → interim available; lifecycle synced from facts, no trader question.
      let r = await getV3ReviewData(user.id, tradeId);
      expect(r.state).toBe("INTERIM_AVAILABLE");
      expect(r.result.positionLabel).toBe("Open");
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).reviewLifecycleStatus).toBe("STILL_HOLDING");

      await upsertPartialExit(user.id, tradeId, { exitOrder: 1, exitPrice: 1910, percentClosed: 50, exitedAt: new Date() });
      r = await getV3ReviewData(user.id, tradeId);
      expect(r.result).toMatchObject({ positionLabel: "Partially closed", remainingOpenPercent: 50, winLoss: null });
      let stored = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect(stored.reviewLifecycleStatus).toBe("PARTIALLY_CLOSED");
      expect(stored.closedAt).toBeNull();

      // Interim review while 50% is still open.
      await setReviewTradeIntent(user.id, tradeId, "PLANNED");
      await updateReviewFields(user.id, tradeId, { adherenceAnswers: PROCESS_ALL_YES, whatWentWell: "Waited for TP1" });
      expect((await completeReview(user.id, tradeId)).mode).toBe("INTERIM");
      r = await getV3ReviewData(user.id, tradeId);
      expect(r.state).toBe("INTERIM_REVIEWED");
      await tick();

      // Final exit → back to FINAL REVIEW REQUIRED.
      await upsertPartialExit(user.id, tradeId, { exitOrder: 2, exitPrice: 1920, percentClosed: 50, exitedAt: new Date() });
      stored = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect(stored.reviewLifecycleStatus).toBe("FULLY_CLOSED");
      expect(stored.closedAt).not.toBeNull();
      expect(stored.status).toBe("CLOSED");
      r = await getV3ReviewData(user.id, tradeId);
      expect(r.state).toBe("FINAL_REVIEW_REQUIRED");
      expect(r.hasEarlierReview).toBe(true);

      // Derived facts.
      expect(r.result).toMatchObject({ settlement: "SETTLED", winLoss: "WIN", positionLabel: "Fully closed", remainingOpenPercent: 0 });
      expect(r.result.realizedR).toBeCloseTo(1.5, 5);
      expect(r.planVsActual.hasPlan).toBe(true);
      const row = (k: string) => r.planVsActual.rows.find((x) => x.key === k)?.value;
      expect(row("entry")).toBe("Same as plan");
      expect(row("stop")).toBe("Same as plan");
      expect(row("bias")).toBe("Aligned (long)");
      expect(r.exit.suggestion).toBe("yes");
      expect(r.exit.facts).toEqual(["TP1 50% ✓", "TP2 50% ✓"]);
      expect(r.risk.suggestion).toBe("yes");
      expect(r.psychology.derived).toEqual({ fomo: "no", alignedWithBias: "yes" });
      expect(r.psychology.sources.alignedWithBias).toBe("DERIVED");

      // Suggestions are offered, never attached.
      expect(r.labelSuggestions.map((s) => s.name)).toEqual(expect.arrayContaining(["Correct risk", "Took planned partial"]));
      expect(await listTradeBehaviourLabels(user.id, tradeId)).toHaveLength(0);

      // Missing psychology + wouldTakeAgain → cannot complete.
      await expect(completeReview(user.id, tradeId)).rejects.toBeInstanceOf(ReviewIncompleteError);
      const psych = await saveReviewPsychology(user.id, tradeId, HUMAN);
      expect(psych.complete).toBe(true);
      await expect(completeReview(user.id, tradeId)).rejects.toThrow(/Would I take this setup again/);

      // Reflection text is optional — only wouldTakeAgain is still missing.
      await updateReviewFields(user.id, tradeId, { wouldTakeAgain: true });
      expect((await completeReview(user.id, tradeId)).mode).toBe("FINAL");
      r = await getV3ReviewData(user.id, tradeId);
      expect(r.state).toBe("FINAL_REVIEW_COMPLETE");
      const done = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { psychology: true } });
      expect(done.status).toBe("REVIEWED");
      expect(done.psychology?.answers).toEqual({ ...HUMAN, fomo: "no", alignedWithBias: "yes" });
      expect(done.psychology?.psychologyPercent).toBe(100);
    });
  });
});

describe("V3 Review — free text, FOMO, legacy", () => {
  it("reflection text alone never stamps reviewedAt or completes the final review", async () => {
    const dateKey = "2026-08-04";
    const user = await readyUser("v3r-text", dateKey);
    await runLive(async () => {
      const tradeId = await plannedEnteredTrade(user.id, dateKey);
      await upsertPartialExit(user.id, tradeId, { exitOrder: 1, exitPrice: 1890, percentClosed: 100, exitedAt: new Date() });
      await updateReviewFields(user.id, tradeId, { whatWentWell: "Respected the stop", psychLessonsLearned: "Patience" });
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).reviewedAt).toBeNull();

      // The legacy section path still stamps (historical behaviour) — but the
      // V3 state stays FINAL_REVIEW_REQUIRED without the structured answers.
      await updateTradeSections(user.id, tradeId, { whatCouldImprove: "Size" });
      const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect(t.reviewedAt).not.toBeNull();
      expect(t.status).toBe("CLOSED");
      const r = await getV3ReviewData(user.id, tradeId);
      expect(r.state).toBe("FINAL_REVIEW_REQUIRED");
      expect(r.hasEarlierReview).toBe(true);
      // A losing trade at the initial stop: the process evidence is not negative.
      expect(r.result.winLoss).toBe("LOSS");
      expect(r.exit.suggestion).toBe("yes");
      expect(r.risk.suggestion).toBe("yes");
    });
  });

  it("FOMO comes from the motive once; changing the motive re-derives it in the stored score", async () => {
    const dateKey = "2026-08-05";
    const user = await readyUser("v3r-fomo", dateKey);
    await runLive(async () => {
      const tradeId = await plannedEnteredTrade(user.id, dateKey);
      // No motive yet → the questionnaire can't be scored (fomo unknown).
      expect((await saveReviewPsychology(user.id, tradeId, { ...HUMAN, alignedWithBias: "yes" })).missing).toEqual(["fomo"]);
      expect(await prisma.psychologyQuestionnaireResponse.findUnique({ where: { tradeId } })).toBeNull();

      await setReviewTradeIntent(user.id, tradeId, "FOMO");
      await saveReviewPsychology(user.id, tradeId, { ...HUMAN, alignedWithBias: "yes", fomo: "no" });
      let row = await prisma.psychologyQuestionnaireResponse.findUniqueOrThrow({ where: { tradeId } });
      expect((row.answers as Record<string, unknown>).fomo).toBe("yes");
      expect(row.rawScore).toBe(6);

      await setReviewTradeIntent(user.id, tradeId, "PLANNED");
      row = await prisma.psychologyQuestionnaireResponse.findUniqueOrThrow({ where: { tradeId } });
      expect((row.answers as Record<string, unknown>).fomo).toBe("no");
      expect(row.rawScore).toBe(8);

      // No daily bias recorded → alignment is the trader's answer, kept as given.
      expect((row.answers as Record<string, unknown>).alignedWithBias).toBe("yes");
      const r = await getV3ReviewData(user.id, tradeId);
      expect(r.psychology.sources.alignedWithBias).toBe("HUMAN");
    });
  });

  it("a historical reviewed trade (legacy form path) still renders safely", async () => {
    const dateKey = "2026-08-06";
    const user = await createTestUser("v3r-legacy");
    userIds.push(user.id);
    await runLive(async () => {
      const t = await createTrade(
        user.id,
        dateKey,
        tradeSchema.parse({
          assetSymbol: "EURUSD",
          executionMinutes: 600,
          direction: "SHORT",
          higherTimeframeBias: "BULLISH",
          biasConfidencePercent: 50,
          actualRR: 1.2,
          psychLessonsLearned: "Old lesson",
          psychPostTradeReflection: "Old reflection",
        }),
      );
      const r = await getV3ReviewData(user.id, t.id);
      expect(r.state).toBe("FINAL_REVIEW_REQUIRED");
      expect(r.reflection.psychLessonsLearned).toBe("Old lesson");
      expect(r.legacyReflection).toEqual([{ label: "General reflection", text: "Old reflection" }]);
      expect(r.planVsActual.hasPlan).toBe(false);
      // Extension/compat defaults (HTF "BULLISH", 50%) are never used as bias evidence.
      expect(r.biasAlignment).toBe("UNKNOWN");
    });
  });
});

describe("V3 Review — overrides, planless, cancelled", () => {
  it("shows the daily-limit override exactly as frozen at the time", async () => {
    const dateKey = "2026-08-07";
    const user = await readyUser("v3r-override", dateKey);
    await runLive(async () => {
      const first = await createQuickIdea(user.id, dateKey, idea());
      await recordFirstEntry(user.id, dateKey, first.tradeId, entry({ actualStopLoss: 1890 }));
      await prisma.tradingDay.updateMany({ where: { userId: user.id }, data: { maxTradesPerDay: 1 } });
      const second = await createQuickIdea(user.id, dateKey, idea({ limitOverrideReason: "A+ setup after earlier scratch trade" }));
      await recordFirstEntry(user.id, dateKey, second.tradeId, entry({ actualStopLoss: 1890 }));

      // Today's limit changes later — the review keeps the historical snapshot.
      await prisma.tradingDay.updateMany({ where: { userId: user.id }, data: { maxTradesPerDay: 5 } });
      const r = await getV3ReviewData(user.id, second.tradeId);
      expect(r.overrides.limit?.reason).toBe("A+ setup after earlier scratch trade");
      expect(r.overrides.limit?.context).toMatchObject({ kinds: ["MAX_TRADES"], maxTrades: 1, executedCount: 1 });
      expect(r.overrides.setupValidation).toBeNull();
      expect(r.risk.facts.join(" ")).toContain("A+ setup after earlier scratch trade");
    });
  });

  it("planless trade: 'No confirmed plan', exits without targets, review still works", async () => {
    const dateKey = "2026-08-10";
    const user = await readyUser("v3r-planless", dateKey);
    await runLive(async () => {
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea());
      await recordFirstEntry(user.id, dateKey, tradeId, entry({ actualStopLoss: 1890 }));
      await upsertPartialExit(user.id, tradeId, { exitOrder: 1, exitPrice: 1905, percentClosed: 100, exitedAt: new Date() });
      const r = await getV3ReviewData(user.id, tradeId);
      expect(r.planVsActual.hasPlan).toBe(false);
      expect(r.planVsActual.rows[0]).toMatchObject({ key: "plan", value: "No confirmed plan" });
      expect(r.exit.suggestion).toBeNull();
      expect(r.state).toBe("FINAL_REVIEW_REQUIRED");
    });
  });

  it("cancelled idea: no execution review, no result, completion refused", async () => {
    const dateKey = "2026-08-11";
    const user = await readyUser("v3r-cancel", dateKey);
    await runLive(async () => {
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea());
      await setReviewLifecycleStatus(user.id, tradeId, { status: "CANCELLED_NEVER_TRIGGERED", cancellationReason: "News" });
      const r = await getV3ReviewData(user.id, tradeId);
      expect(r.state).toBe("CANCELLED");
      expect(r.result).toMatchObject({ settlement: "CANCELLED", realizedR: null, pnl: null });
      expect(r.labelSuggestions).toEqual([]);
      await expect(completeReview(user.id, tradeId)).rejects.toThrow(/cancelled idea/);
    });
  });
});

describe("V3 Review — carried positions", () => {
  it("a carried position closed after its day stays listed and reviewable until the final review", async () => {
    const now = new Date();
    const dayKey = (offset: number) => utcDateToKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)));
    const tradeDay = dayKey(-2);
    const today = dayKey(0);
    const user = await readyUser("v3r-carried", tradeDay);
    await runLive(async () => {
      const tradeId = await plannedEnteredTrade(user.id, tradeDay);
      await endDay(user.id, tradeDay);
      await upsertPartialExit(user.id, tradeId, { exitOrder: 1, exitPrice: 1910, percentClosed: 100, exitedAt: new Date() });

      const carried = await listCarriedOpenTrades(user.id, today);
      expect(carried.map((t) => t.id)).toContain(tradeId);
      // The day is archived and the position closed, but the final review is open.
      expect(await tradeExecutionEditableGuard(user.id, tradeDay, tradeId)).not.toBeNull();
      expect(await reviewWritableOnArchivedDay(user.id, tradeId)).toBe(true);

      await setReviewTradeIntent(user.id, tradeId, "PLANNED");
      await updateReviewFields(user.id, tradeId, { adherenceAnswers: PROCESS_ALL_YES, wouldTakeAgain: true });
      // No daily bias for this asset → alignment is asked, not derived.
      await saveReviewPsychology(user.id, tradeId, { ...HUMAN, alignedWithBias: "yes" });
      await completeReview(user.id, tradeId);

      expect((await listCarriedOpenTrades(user.id, today)).map((t) => t.id)).not.toContain(tradeId);
      expect(await reviewWritableOnArchivedDay(user.id, tradeId)).toBe(false);
    });
  });
});

describe("Backtesting isolation", () => {
  it("the LIVE lifecycle sync never touches Backtesting trades (V2 manual flow kept)", async () => {
    const user = await createTestUser("v3r-bt");
    userIds.push(user.id);
    const run = await createBacktestRun(
      user.id,
      createBacktestRunSchema.parse({ name: "Review iso", assets: ["XAUUSD"], startDate: "2026-07-01", endDate: "2026-07-31" }),
    );
    await runInBacktestRun(user.id, run.id, async () => {
      const t = await createTrade(
        user.id,
        "2026-07-02",
        tradeSchema.parse({ assetSymbol: "XAUUSD", executionMinutes: 600, direction: "LONG", higherTimeframeBias: "BULLISH", biasConfidencePercent: 50 }),
      );
      await updateTradeSections(user.id, t.id, { actualEntry: 1900, actualStopLoss: 1890 });
      await upsertPartialExit(user.id, t.id, { exitOrder: 1, exitPrice: 1910, percentClosed: 100, exitedAt: new Date() });
      const stored = await prisma.trade.findUniqueOrThrow({ where: { id: t.id } });
      expect(stored.reviewLifecycleStatus).toBeNull();
      expect(stored.closedAt).toBeNull();
      // The V2 manual status still works there.
      await setReviewLifecycleStatus(user.id, t.id, { status: "FULLY_CLOSED" });
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: t.id } })).reviewLifecycleStatus).toBe("FULLY_CLOSED");
    });
    // Seeded label catalog is per user; untouched by review suggestions.
    expect((await runLive(() => listBehaviourLabels(user.id))).length).toBeGreaterThan(0);
  });
});
