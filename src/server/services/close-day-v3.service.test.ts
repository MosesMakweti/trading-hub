import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { quickIdeaSchema, recordEntrySchema } from "@/lib/validation/today-v3";
import { missOutcomeSchema, opportunityCreateSchema } from "@/lib/validation/opportunity";
import { getOrCreateTradingDay, reopenDay, setDayAnalyzed } from "@/server/services/trading-day.service";
import { getOrCreateDayRoutine, setRoutineReady } from "@/server/services/today-routine.service";
import { createOrGetDailyAssetAnalysis, updateDailyAssetAnalysis } from "@/server/services/daily-asset-analysis.service";
import { savePlan } from "@/server/services/trade-plan.service";
import { upsertPartialExit } from "@/server/services/trade-partial-exit.service";
import { setReviewLifecycleStatus } from "@/server/services/trade-review.service";
import {
  createQuickIdea,
  getDayLimitState,
  listCarriedOpenTrades,
  recordFirstEntry,
} from "@/server/services/today-trade.service";
import {
  completeReview,
  getV3ReviewData,
  saveReviewPsychology,
  setReviewTradeIntent,
  updateReviewFields,
} from "@/server/services/trade-review-v3.service";
import {
  createOpportunity,
  deleteOpportunity,
  getMissReasonAggregate,
  getOpportunityInputs,
  OpportunityError,
  recordCancelledIdeaAsMissed,
  recordMissedSetup,
} from "@/server/services/opportunity.service";
import { closeTradingDay, getDayCloseSummary, saveDailyReflection } from "@/server/services/close-day.service";
import {
  closeTradingDayV3,
  DayAlreadyClosedError,
  getCloseDayV3,
  getLastSessionCarryForward,
} from "@/server/services/close-day-v3.service";
import { loadTradingWorkspace } from "@/server/services/trading-workspace.service";
import { loadJournalDay } from "@/server/services/journal-day-view.service";
import {
  completeReplayReviewSession,
  createReplayReviewSession,
  finalizeEdgeReview,
  startReplayReviewSession,
} from "@/server/services/replay-review.service";
import { buildTraderReviewEvidencePackage } from "@/server/services/ai-review-evidence.service";
import { tradeExecutionEditableGuard } from "@/actions/day-guard";

/**
 * Today V3 (Phase 4) — Missed Opportunities, Close Day and Tomorrow's Focus,
 * against the test Postgres DB: the Close read model (performance / process /
 * needs attention from the centralized V3 review state), the close action's
 * writes, open positions carrying forward, cancelled → missed, the previous
 * LIVE session carry-forward through the real Today loader, reopen, and the
 * Journal / AI / Backtesting consumers.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

const tick = () => new Promise((r) => setTimeout(r, 15));

async function readyUser(label: string, dateKey: string) {
  const user = await createTestUser(label);
  userIds.push(user.id);
  await makeReady(user.id, dateKey);
  return user;
}

async function makeReady(userId: string, dateKey: string) {
  const existing = await prisma.routineSection.findFirst({ where: { userId } });
  if (!existing) {
    const section = await prisma.routineSection.create({ data: { userId, title: "Prep", sortOrder: 0 } });
    await prisma.routineItem.create({
      data: { userId, sectionId: section.id, label: "Optional only", type: "CHECKBOX", isMandatory: false, sortOrder: 0 },
    });
  }
  await runLive(async () => {
    const day = await getOrCreateTradingDay(userId, dateKey);
    await getOrCreateDayRoutine(userId, day);
    await setRoutineReady(userId, dateKey, true);
  });
}

const idea = (o: Record<string, unknown> = {}) =>
  quickIdeaSchema.parse({ assetSymbol: "XAUUSD", direction: "LONG", nowMinutes: 615, ...o });
const entry = (o: Record<string, unknown> = {}) => recordEntrySchema.parse({ actualEntry: 1900, entryMinutes: 600, ...o });
const miss = (o: Record<string, unknown> = {}) =>
  missOutcomeSchema.parse({ missReason: "HESITATION", missedOutcome: "MISSED_WIN", missedRealizedR: 2, ...o });

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
  await savePlan(userId, tradeId, {
    direction: "LONG",
    timeframe: "15m",
    entry: 1900,
    stopLoss: 1890,
    targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1910, plannedClosePercent: 100 }],
  });
  await recordFirstEntry(userId, dateKey, tradeId, entry());
  return tradeId;
}

async function fullFinalReview(userId: string, tradeId: string, adherence = PROCESS_ALL_YES) {
  await setReviewTradeIntent(userId, tradeId, "PLANNED");
  await updateReviewFields(userId, tradeId, { adherenceAnswers: adherence, wouldTakeAgain: true });
  await saveReviewPsychology(userId, tradeId, HUMAN);
  return completeReview(userId, tradeId);
}

async function strategyFor(userId: string) {
  return prisma.strategy.create({ data: { userId, name: "London Sweep", applicableAssets: ["XAUUSD", "EURUSD"] } });
}

// ── Normal completed day ────────────────────────────────────────────────────

describe("Close — a normal, completed day", () => {
  it("derives performance/process, saves reflection + focus, sets analyzedAt and archives in one close", async () => {
    const dateKey = "2026-08-03";
    const user = await readyUser("p4-normal", dateKey);
    await runLive(async () => {
      const analysis = await createOrGetDailyAssetAnalysis(user.id, dateKey, "XAUUSD");
      await updateDailyAssetAnalysis(user.id, analysis.id, { htfBias: "BULLISH", finalBias: "LONG" });
      const tradeId = await plannedEnteredTrade(user.id, dateKey);
      await upsertPartialExit(user.id, tradeId, { exitOrder: 1, exitPrice: 1910, percentClosed: 100, exitedAt: new Date() });
      await tick();
      expect((await fullFinalReview(user.id, tradeId)).mode).toBe("FINAL");

      const before = await getCloseDayV3(user.id, dateKey);
      expect(before.status).toBe("ACTIVE");
      expect(before.performance).toMatchObject({ ideas: 1, executed: 1, settled: 1, wins: 1, losses: 0, breakevens: 0, open: 0, cancelled: 0, missed: 0 });
      expect(before.performance.winRatePercent).toBe(100);
      expect(before.performance.settledR).toBeCloseTo(1, 5);
      expect(before.process.finalReviewsComplete).toBe(1);
      expect(before.process.finalReviewsRequired).toBe(0);
      expect(before.process.adherence.every((a) => a.yes === 1 && a.no === 0)).toBe(true);
      expect(before.process.averagePsychologyPercent).not.toBeNull();
      expect(before.needsAttention).toEqual([]);
      expect(before.reflectionPresent).toBe(false);

      // The status strip and Close agree on Trades Used / risk.
      const { usage } = await getDayLimitState(user.id, dateKey);
      expect(before.performance.executed).toBe(usage.executedCount);
      expect(before.performance.riskUsedPercent).toBe(usage.riskUsedPercent);

      // Autosave writes some of it; the close writes the rest in one update.
      await saveDailyReflection(user.id, dateKey, { dayWentWell: "Waited for the sweep" });
      await closeTradingDayV3(user.id, dateKey, {
        dayToImprove: "Size up only on A+",
        dayMainLesson: "Patience pays",
        dayCarryForward: "Only trade the London sweep",
      });

      const day = await prisma.tradingDay.findFirstOrThrow({ where: { userId: user.id, backtestRunId: null } });
      expect(day.status).toBe("ARCHIVED");
      expect(day.archivedAt).not.toBeNull();
      expect(day.analyzedAt).not.toBeNull();
      expect(day).toMatchObject({
        dayWentWell: "Waited for the sweep",
        dayToImprove: "Size up only on A+",
        dayMainLesson: "Patience pays",
        dayCarryForward: "Only trade the London sweep",
      });

      const after = await getCloseDayV3(user.id, dateKey);
      expect(after.status).toBe("ARCHIVED");
      expect(after.reflectionPresent).toBe(true);
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).status).toBe("REVIEWED");
      await expect(closeTradingDayV3(user.id, dateKey, {})).rejects.toBeInstanceOf(DayAlreadyClosedError);
    });
  });

  it("never rewrites an existing analyzedAt (historical stamp preserved)", async () => {
    const dateKey = "2026-08-04";
    const user = await readyUser("p4-analyzed", dateKey);
    await runLive(async () => {
      const marked = await setDayAnalyzed(user.id, dateKey, true);
      await tick();
      const closed = await closeTradingDayV3(user.id, dateKey, {});
      expect(closed.analyzedAt?.getTime()).toBe(marked.analyzedAt?.getTime());
    });
  });
});

// ── Missing final review / interim review / open position ────────────────────

describe("Close — incomplete final reviews and open positions never block, and are never resolved for the trader", () => {
  it("warns, closes anyway, leaves the interim-reviewed trade Final Review Required and the open position open", async () => {
    const dayA = "2026-08-05";
    const dayB = "2026-08-06";
    const user = await readyUser("p4-incomplete", dayA);
    await runLive(async () => {
      // t1: interim review while 50% open, then fully closed → final review required.
      const t1 = await plannedEnteredTrade(user.id, dayA);
      await upsertPartialExit(user.id, t1, { exitOrder: 1, exitPrice: 1910, percentClosed: 50, exitedAt: new Date() });
      await setReviewTradeIntent(user.id, t1, "PLANNED");
      await updateReviewFields(user.id, t1, { adherenceAnswers: PROCESS_ALL_YES, whatWentWell: "Took TP1" });
      expect((await completeReview(user.id, t1)).mode).toBe("INTERIM");
      await tick();
      await upsertPartialExit(user.id, t1, { exitOrder: 2, exitPrice: 1905, percentClosed: 50, exitedAt: new Date() });
      const reviewedAtBefore = (await prisma.trade.findUniqueOrThrow({ where: { id: t1 } })).reviewedAt;

      // t2: entered, still holding.
      const t2 = await plannedEnteredTrade(user.id, dayA, { limitOverrideReason: "unused" });

      const close = await getCloseDayV3(user.id, dayA);
      const review = close.needsAttention.filter((i) => i.kind === "FINAL_REVIEW_REQUIRED");
      expect(review.map((i) => i.tradeId)).toEqual([t1]);
      expect(review[0].detail).toMatch(/interim/i);
      expect(review[0].stage).toBe("review");
      expect(close.needsAttention.find((i) => i.kind === "OPEN_POSITION")?.tradeId).toBe(t2);
      expect(close.openPositions).toEqual([expect.objectContaining({ tradeId: t2, openPercent: 100, carried: false })]);
      expect(close.performance).toMatchObject({ executed: 2, settled: 1, open: 1 });
      // The open trade is never classified, whatever its running PnL.
      expect(close.performance.wins + close.performance.losses + close.performance.breakevens).toBe(1);

      // The shared Day Summary (Journal) uses the same final-review semantics in LIVE.
      const summary = await getDayCloseSummary(user.id, dayA);
      expect(summary.finalReviewRequiredCount).toBe(1);
      expect(summary.warnings).toContain("1 trade still requires a final review.");
      expect(summary.warnings.some((w) => /reflection notes/.test(w))).toBe(false);

      await closeTradingDayV3(user.id, dayA, { dayCarryForward: "Finish reviews first" });

      // Regression (Phase 4 fix): closing never turns an interim review into REVIEWED.
      const s1 = await prisma.trade.findUniqueOrThrow({ where: { id: t1 } });
      expect(s1.status).toBe("CLOSED");
      expect(s1.reviewedAt?.getTime()).toBe(reviewedAtBefore?.getTime());
      expect((await getV3ReviewData(user.id, t1)).state).toBe("FINAL_REVIEW_REQUIRED");

      const s2 = await prisma.trade.findUniqueOrThrow({ where: { id: t2 }, include: { performanceRiskSnapshot: true } });
      expect(s2.reviewLifecycleStatus).toBe("STILL_HOLDING");
      expect(s2.closedAt).toBeNull();
      expect(s2.status).toBe("OPEN");
      expect(s2.performanceRiskSnapshot?.settledAt ?? null).toBeNull();
      expect(s2.plannedEntry?.toNumber()).toBe(1900);

      // Next LIVE session: the open position is carried, manageable, and not
      // counted in that day's performance.
      await makeReady(user.id, dayB);
      expect((await listCarriedOpenTrades(user.id, dayB)).map((t) => t.id)).toContain(t2);
      expect(await tradeExecutionEditableGuard(user.id, dayA, t2)).toBeNull();
      const next = await getCloseDayV3(user.id, dayB);
      expect(next.openPositions).toEqual([expect.objectContaining({ tradeId: t2, carried: true, tradeDateKey: dayA })]);
      expect(next.performance.executed).toBe(0);
      await upsertPartialExit(user.id, t2, { exitOrder: 1, exitPrice: 1895, percentClosed: 100, exitedAt: new Date() });
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: t2 } })).reviewLifecycleStatus).toBe("FULLY_CLOSED");
    });
  });

  it("the shared V2 close path no longer marks an interim-only review REVIEWED either (LIVE)", async () => {
    const dateKey = "2026-08-12";
    const user = await readyUser("p4-v2-close", dateKey);
    await runLive(async () => {
      const t = await plannedEnteredTrade(user.id, dateKey);
      await setReviewTradeIntent(user.id, t, "PLANNED");
      expect((await completeReview(user.id, t)).mode).toBe("INTERIM");
      await tick();
      await upsertPartialExit(user.id, t, { exitOrder: 1, exitPrice: 1910, percentClosed: 100, exitedAt: new Date() });
      await closeTradingDay(user.id, dateKey, {});
      expect((await prisma.trade.findUniqueOrThrow({ where: { id: t } })).status).toBe("CLOSED");
      expect((await getV3ReviewData(user.id, t)).state).toBe("FINAL_REVIEW_REQUIRED");
    });
  });
});

// ── Missed opportunities ────────────────────────────────────────────────────

describe("Missed opportunities — recorded, shown in Close, never executed or risk", () => {
  it("records a missed setup in one step, excludes it from executed/risk, and keeps it for discrepancy/Edge consumers", async () => {
    const dateKey = "2026-08-11";
    const user = await readyUser("p4-missed", dateKey);
    await runLive(async () => {
      const strategy = await strategyFor(user.id);
      const op = await recordMissedSetup(
        user.id,
        dateKey,
        opportunityCreateSchema.parse({ strategyId: strategy.id, assetSymbol: "XAUUSD", direction: "LONG" }),
        miss({ missNote: "Was on a call" }),
      );
      expect(op).toMatchObject({ status: "MISSED", missReason: "HESITATION", strategyNameSnapshot: "London Sweep", originTradeId: null });
      expect(op.setupValid).toBe(true);

      expect(await prisma.trade.count({ where: { userId: user.id } })).toBe(0);
      const { usage } = await getDayLimitState(user.id, dateKey);
      expect(usage).toMatchObject({ executedCount: 0, riskUsedPercent: 0 });

      const close = await getCloseDayV3(user.id, dateKey);
      expect(close.performance).toMatchObject({ ideas: 0, executed: 0, missed: 1, missedValid: 1, riskUsedPercent: 0 });
      expect(close.missedOpportunities).toEqual([
        expect.objectContaining({ assetSymbol: "XAUUSD", strategyName: "London Sweep", missReason: "HESITATION", missedOutcome: "MISSED_WIN", missedRealizedR: 2, originTrade: null }),
      ]);
      expect((await getDayCloseSummary(user.id, dateKey)).missedValidOpportunityCount).toBe(1);

      // Discrepancy / Edge consumers still see it as a MISSED opportunity.
      const inputs = await getOpportunityInputs(user.id);
      expect(inputs.some((i) => "opportunityId" in i && i.opportunityId === op.id)).toBe(true);
      const reasons = await getMissReasonAggregate(user.id);
      expect(JSON.stringify(reasons)).toContain("HESITATION");
    });
  });

  it("Take: a spotted opportunity becomes exactly one canonical Trade via Quick Idea", async () => {
    const dateKey = "2026-08-13";
    const user = await readyUser("p4-take", dateKey);
    await runLive(async () => {
      const strategy = await strategyFor(user.id);
      const op = await createOpportunity(
        user.id,
        dateKey,
        opportunityCreateSchema.parse({ strategyId: strategy.id, assetSymbol: "EURUSD", direction: "SHORT" }),
      );
      const { tradeId } = await createQuickIdea(
        user.id,
        dateKey,
        idea({ assetSymbol: op.assetSymbol, direction: op.direction, strategyId: op.strategyId, opportunityId: op.id }),
      );
      const trades = await prisma.trade.findMany({ where: { userId: user.id } });
      expect(trades).toHaveLength(1);
      expect(trades[0]).toMatchObject({ id: tradeId, assetSymbol: "EURUSD", direction: "SHORT", opportunityId: op.id, actualEntry: null });
      expect((await prisma.tradeOpportunity.findUniqueOrThrow({ where: { id: op.id } })).status).toBe("EXECUTED");
    });
  });
});

// ── Cancelled idea → missed opportunity ─────────────────────────────────────

describe("Cancelled idea → Missed opportunity (explicit only)", () => {
  it("cancelling never creates an opportunity; Record as missed creates a separate, linked MISSED one", async () => {
    const dateKey = "2026-08-14";
    const user = await readyUser("p4-cancel", dateKey);
    await runLive(async () => {
      const strategy = await strategyFor(user.id);
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea({ strategyId: strategy.id }));
      await savePlan(user.id, tradeId, {
        direction: "LONG",
        timeframe: "15m",
        entry: 1900,
        stopLoss: 1890,
        targets: [{ targetOrder: 1, label: "TP1", targetPrice: 1920, plannedClosePercent: 100 }],
      });
      await setReviewLifecycleStatus(user.id, tradeId, { status: "CANCELLED_NEVER_TRIGGERED", cancellationReason: "Price ran without me" });

      expect(await prisma.tradeOpportunity.count({ where: { userId: user.id } })).toBe(0);
      let close = await getCloseDayV3(user.id, dateKey);
      expect(close.performance).toMatchObject({ ideas: 1, executed: 0, cancelled: 1, missed: 0 });
      expect(close.cancelledIdeas).toEqual([
        expect.objectContaining({ tradeId, cancellationReason: "Price ran without me", recordedAsMissed: false }),
      ]);

      const op = await recordCancelledIdeaAsMissed(user.id, tradeId, miss({ missReason: "LATE_CONFIRMATION" }));
      expect(op).toMatchObject({ status: "MISSED", originTradeId: tradeId, assetSymbol: "XAUUSD", strategyId: strategy.id, strategyNameSnapshot: "London Sweep" });
      expect(op.plannedEntry?.toNumber()).toBe(1900);
      expect(utcKey(op.spottedAt)).toBe(dateKey);

      // The Trade is still a cancelled Trade, unlinked as an execution.
      const trade = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
      expect(trade).toMatchObject({ reviewLifecycleStatus: "CANCELLED_NEVER_TRIGGERED", opportunityId: null, actualEntry: null });
      expect(await prisma.trade.count({ where: { userId: user.id } })).toBe(1);

      close = await getCloseDayV3(user.id, dateKey);
      expect(close.performance).toMatchObject({ ideas: 1, executed: 0, cancelled: 1, missed: 1 });
      expect(close.missedOpportunities[0].originTrade?.id).toBe(tradeId);
      expect(close.cancelledIdeas[0].recordedAsMissed).toBe(true);
      expect((await getV3ReviewData(user.id, tradeId)).recordedMissedOpportunity?.id).toBe(op.id);

      // Missed, not executed, for the discrepancy engine.
      const inputs = (await getOpportunityInputs(user.id)) as { opportunityId?: string; kind?: string }[];
      expect(inputs.find((i) => i.opportunityId === op.id)).toBeTruthy();
      expect(JSON.stringify(inputs.find((i) => i.opportunityId === op.id))).not.toContain(tradeId);

      // Phase 5: recording again is idempotent — the same opportunity, no second row.
      expect((await recordCancelledIdeaAsMissed(user.id, tradeId, miss())).id).toBe(op.id);
      expect(await prisma.tradeOpportunity.count({ where: { userId: user.id, originTradeId: tradeId } })).toBe(1);
      // Deleting the opportunity releases the link so it can be recorded again.
      await deleteOpportunity(user.id, op.id);
      const again = await recordCancelledIdeaAsMissed(user.id, tradeId, miss());
      expect(again.originTradeId).toBe(tradeId);
    });
  });

  it("refuses an entered trade or a live idea", async () => {
    const dateKey = "2026-08-17";
    const user = await readyUser("p4-cancel-guard", dateKey);
    await runLive(async () => {
      const entered = await plannedEnteredTrade(user.id, dateKey);
      await expect(recordCancelledIdeaAsMissed(user.id, entered, miss())).rejects.toBeInstanceOf(OpportunityError);
      const { tradeId: live } = await createQuickIdea(user.id, dateKey, idea());
      await expect(recordCancelledIdeaAsMissed(user.id, live, miss())).rejects.toBeInstanceOf(OpportunityError);
    });
  });
});

function utcKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ── Daily-limit override ────────────────────────────────────────────────────

describe("Close — daily-limit overrides come from the stored reason and frozen context", () => {
  it("surfaces the Phase 2 override verbatim and never recalculates it", async () => {
    const dateKey = "2026-08-18";
    const user = await readyUser("p4-override", dateKey);
    await runLive(async () => {
      await plannedEnteredTrade(user.id, dateKey);
      await prisma.tradingDay.updateMany({ where: { userId: user.id }, data: { maxTradesPerDay: 1 } });
      const { tradeId } = await createQuickIdea(user.id, dateKey, idea({ limitOverrideReason: "A+ news setup" }));
      const stored = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });

      await prisma.tradingDay.updateMany({ where: { userId: user.id }, data: { maxTradesPerDay: 5 } });
      const close = await getCloseDayV3(user.id, dateKey);
      expect(close.limitOverrides).toEqual([
        { tradeId, tradeNumber: stored.tradeNumber, assetSymbol: "XAUUSD", reason: "A+ news setup", context: stored.limitOverrideContext },
      ]);
      expect(close.limitOverrides[0].context).toMatchObject({ kinds: ["MAX_TRADES"], maxTrades: 1, executedCount: 1 });
      expect(close.process.limitOverrides).toBe(1);
      const exception = close.needsAttention.find((i) => i.kind === "PROCESS_EXCEPTION" && i.tradeId === tradeId);
      expect(exception?.detail).toContain("Daily-limit override");
    });
  });
});

// ── FROM YOUR LAST SESSION ──────────────────────────────────────────────────

describe("Previous LIVE session carry-forward (the query + the real Today loader)", () => {
  it("Friday → Monday, skipping empty days; backtest days never count; reopen edits flow through by reference", async () => {
    const friday = "2026-08-07";
    const sunday = "2026-08-09";
    const monday = "2026-08-10";
    const user = await readyUser("p4-carry", friday);

    await runLive(async () => {
      await closeTradingDayV3(user.id, friday, {
        dayToImprove: "Stop moving stops",
        dayMainLesson: "Wait for the close",
        dayCarryForward: "Trade only London",
      });
      // An empty LIVE row on Sunday (opened, nothing written) must not win.
      await getOrCreateTradingDay(user.id, sunday);
    });

    // A Backtesting simulated day AFTER Friday with its own reflection.
    const run = await createBacktestRun(
      user.id,
      createBacktestRunSchema.parse({ name: "Carry iso", assets: ["XAUUSD"], startDate: "2026-08-01", endDate: "2026-08-31" }),
    );
    await runInBacktestRun(user.id, run.id, async () => {
      await saveDailyReflection(user.id, "2026-08-08", { dayCarryForward: "BACKTEST focus", dayMainLesson: "BT lesson" });
      // Inside the run it is the previous session for later simulated days.
      expect((await getLastSessionCarryForward(user.id, "2026-08-10"))?.carryForward).toBe("BACKTEST focus");
    });

    const expected = { fromDateKey: friday, carryForward: "Trade only London", mainLesson: "Wait for the close", toImprove: "Stop moving stops" };
    await runLive(async () => {
      expect(await getLastSessionCarryForward(user.id, monday)).toEqual(expected);
    });
    // The adapter Prepare actually renders (LIVE Today loader).
    const data = await loadTradingWorkspace(user.id, monday, { environment: "LIVE" });
    expect(data.carryForward).toEqual(expected);
    // Edge Review commitments stay a separate channel (none were created).
    expect(data.reviewCommitments).toEqual({ weekly: [], monthly: [] });
    expect(await prisma.edgeReviewCommitment.count({ where: { userId: user.id } })).toBe(0);

    // Reopen Friday: everything preserved; an edited focus reaches Monday.
    await runLive(async () => {
      const reopened = await reopenDay(user.id, friday);
      expect(reopened).toMatchObject({ status: "ACTIVE", dayCarryForward: "Trade only London", dayMainLesson: "Wait for the close", dayToImprove: "Stop moving stops" });
      expect(reopened.analyzedAt).not.toBeNull();
      await saveDailyReflection(user.id, friday, { dayCarryForward: "Trade only London — max 2 trades" });
      expect((await getLastSessionCarryForward(user.id, monday))?.carryForward).toBe("Trade only London — max 2 trades");
      await closeTradingDayV3(user.id, friday, {});
    });
    const again = await loadTradingWorkspace(user.id, monday, { environment: "LIVE" });
    expect(again.carryForward?.carryForward).toBe("Trade only London — max 2 trades");
    expect(again.closeDay?.dateKey).toBe(monday);
  });
});

// ── Journal / AI / Backtesting ──────────────────────────────────────────────

describe("Downstream consumers read the same canonical closed day", () => {
  it("Journal shows the same counts, review state, missed setups and reflection; AI evidence gets improve/lesson/focus", async () => {
    const dateKey = "2026-08-19";
    const user = await readyUser("p4-journal", dateKey);
    await runLive(async () => {
      const strategy = await strategyFor(user.id);
      const t = await plannedEnteredTrade(user.id, dateKey);
      await upsertPartialExit(user.id, t, { exitOrder: 1, exitPrice: 1890, percentClosed: 100, exitedAt: new Date() });
      await recordMissedSetup(
        user.id,
        dateKey,
        opportunityCreateSchema.parse({ strategyId: strategy.id, assetSymbol: "EURUSD", direction: "SHORT" }),
        miss({ missedOutcome: "MISSED_UNDETERMINED", missedRealizedR: null }),
      );
      const close = await getCloseDayV3(user.id, dateKey);
      await closeTradingDayV3(user.id, dateKey, {
        dayWentWell: "Respected the stop",
        dayToImprove: "Entry timing",
        dayMainLesson: "Losses are fine when planned",
        dayCarryForward: "Wait for confirmation",
      });

      const journal = await loadJournalDay(user.id, dateKey, { historical: true });
      expect(journal.recap?.status).toBe("ARCHIVED");
      expect(journal.recap?.analyzeDone).toBe(true);
      expect(journal.daySummary).toMatchObject({
        dayStatus: "ARCHIVED",
        wins: close.performance.wins,
        losses: close.performance.losses,
        breakevens: close.performance.breakevens,
        settledCount: close.performance.settled,
        finalReviewRequiredCount: 1,
        reflection: {
          dayWentWell: "Respected the stop",
          dayToImprove: "Entry timing",
          dayMainLesson: "Losses are fine when planned",
          dayCarryForward: "Wait for confirmation",
        },
      });
      expect(journal.daySummary?.totalRealizedRSoFar).toBeCloseTo(close.performance.settledR, 5);
      expect(journal.daySummary?.totalPnl).toBeCloseTo(close.performance.settledPnl, 5);
      expect(journal.opportunities.filter((o) => o.status === "MISSED")).toHaveLength(1);
      expect(journal.trades).toHaveLength(1);
    });

    const session = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-17", endDate: "2026-08-23" });
    await startReplayReviewSession(user.id, session.id);
    await completeReplayReviewSession(user.id, session.id);
    await finalizeEdgeReview(user.id, session.id);
    const pkg = await buildTraderReviewEvidencePackage(user.id, session.id);
    expect(pkg.reflections.dailyReflections).toEqual([
      expect.objectContaining({
        dateKey,
        wentWell: "Respected the stop",
        toImprove: "Entry timing",
        lesson: "Losses are fine when planned",
        carryForward: "Wait for confirmation",
      }),
    ]);
  });

  it("Backtesting: the V3 close is refused inside a run, the V2 close keeps working, and a simulated missed setup stays in its run", async () => {
    const user = await createTestUser("p4-backtest");
    userIds.push(user.id);
    const strategy = await strategyFor(user.id);
    const run = await createBacktestRun(
      user.id,
      createBacktestRunSchema.parse({ name: "BT close", assets: ["XAUUSD"], startDate: "2026-07-01", endDate: "2026-07-31" }),
    );
    await runInBacktestRun(user.id, run.id, async () => {
      await expect(closeTradingDayV3(user.id, "2026-07-02", {})).rejects.toThrow(/Backtesting/);
      await recordMissedSetup(
        user.id,
        "2026-07-02",
        opportunityCreateSchema.parse({ strategyId: strategy.id, assetSymbol: "XAUUSD", direction: "LONG" }),
        miss(),
      );
      const closed = await closeTradingDay(user.id, "2026-07-02", { dayMainLesson: "Sim lesson" });
      expect(closed.status).toBe("ARCHIVED");
      expect(closed.analyzedAt).toBeNull(); // V2 semantics unchanged
      expect((await getDayCloseSummary(user.id, "2026-07-02")).finalReviewRequiredCount).toBeNull();
    });
    await runLive(async () => {
      expect(await prisma.tradeOpportunity.count({ where: { userId: user.id } })).toBe(0);
      expect(await getLastSessionCarryForward(user.id, "2026-07-03")).toBeNull();
    });
    // DB backstop: a live opportunity can't point at a simulated trade.
    const simTrade = await runInBacktestRun(user.id, run.id, () =>
      createQuickIdeaUnchecked(user.id, run.id),
    );
    await expect(
      prisma.tradeOpportunity.create({
        data: {
          userId: user.id,
          spottedAt: new Date("2026-07-02T00:00:00Z"),
          assetSymbol: "XAUUSD",
          direction: "LONG",
          status: "MISSED",
          originTradeId: simTrade,
        },
      }),
    ).rejects.toThrow(/BACKTEST_ISOLATION/);
  });
});

/** A bare simulated trade row (for the DB-trigger check only). */
async function createQuickIdeaUnchecked(userId: string, runId: string): Promise<string> {
  const t = await prisma.trade.create({
    data: {
      userId,
      backtestRunId: runId,
      tradeDate: new Date("2026-07-02T00:00:00Z"),
      executionMinutes: 600,
      direction: "LONG",
      higherTimeframeBias: "BULLISH",
      biasConfidencePercent: 50,
      assetSymbol: "XAUUSD",
      reviewLifecycleStatus: "CANCELLED_NEVER_TRIGGERED",
    },
  });
  return t.id;
}
