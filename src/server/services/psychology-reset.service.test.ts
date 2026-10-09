import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { runLive } from "@/server/workspace/scope";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { quickIdeaSchema, recordEntrySchema } from "@/lib/validation/today-v3";
import { missOutcomeSchema, opportunityCreateSchema } from "@/lib/validation/opportunity";
import { getOrCreateTradingDay } from "@/server/services/trading-day.service";
import { getOrCreateDayRoutine, setRoutineReady } from "@/server/services/today-routine.service";
import { createQuickIdea, recordFirstEntry } from "@/server/services/today-trade.service";
import { deletePartialExit, upsertPartialExit } from "@/server/services/trade-partial-exit.service";
import { createOpportunity, logMissedOutcome, recordMissedSetup } from "@/server/services/opportunity.service";
import { getTraderTodayKey } from "@/server/services/trader-time.service";
import { currentFlow } from "@/domain/psychology-reset";
import {
  PsychologyResetError,
  completeReset,
  getPsychologyResetPreference,
  getPsychologyResetState,
  queueLosingTradeReset,
  saveResetAnswer,
  setPsychologyResetEnabled,
  setResetDeferred,
  setResetStep,
} from "@/server/services/psychology-reset.service";

/**
 * Trading Psychology Reset — DB-backed. Losing trades are produced through
 * the REAL Today V3 save path (idea → first entry with a stop → exits), so
 * the trigger is exercised exactly as in the app: canonical settlement, then
 * the live lifecycle sync.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

const DATE = "2026-09-01";

async function readyUser(label: string, dateKey = DATE) {
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
  return user.id;
}

/** LONG XAUUSD entered at 1900 with the stop at 1890 (1R = 10). */
async function enteredTrade(userId: string, dateKey = DATE) {
  return runLive(async () => {
    const { tradeId } = await createQuickIdea(userId, dateKey, quickIdeaSchema.parse({ assetSymbol: "XAUUSD", direction: "LONG", nowMinutes: 615 }));
    await recordFirstEntry(userId, dateKey, tradeId, recordEntrySchema.parse({ actualEntry: 1900, entryMinutes: 600, actualStopLoss: 1890 }));
    return tradeId;
  });
}

const exitAll = (userId: string, tradeId: string, price: number) =>
  runLive(() => upsertPartialExit(userId, tradeId, { exitOrder: 1, exitPrice: price, percentClosed: 100, exitedAt: new Date() }));

/** Edits an existing exit's price (a re-save of the same trade). */
const editExit = (userId: string, tradeId: string, exitId: string, price: number) =>
  runLive(() => upsertPartialExit(userId, tradeId, { id: exitId, exitOrder: 1, exitPrice: price, percentClosed: 100, exitedAt: new Date() }));

const sessionsFor = (userId: string) => prisma.psychologyResetSession.findMany({ where: { userId } });

describe("preference", () => {
  it("defaults to OFF for a new user, persists, and turning it on stamps enabledAt only on OFF → ON", async () => {
    const id = await readyUser("pr-pref");
    expect(await getPsychologyResetPreference(id)).toEqual({ enabled: false, enabledAt: null });
    const on = await setPsychologyResetEnabled(id, true, new Date("2026-10-01T10:00:00Z"));
    expect(on).toEqual({ enabled: true, enabledAt: new Date("2026-10-01T10:00:00Z") });
    // Re-enabling while already on does not move enabledAt.
    await setPsychologyResetEnabled(id, true, new Date("2026-10-02T10:00:00Z"));
    expect((await getPsychologyResetPreference(id)).enabledAt).toEqual(new Date("2026-10-01T10:00:00Z"));
    // A fresh read (a new request / session / device) sees the stored value.
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).psychologyResetEnabled).toBe(true);
    expect((await setPsychologyResetEnabled(id, false)).enabled).toBe(false);
    expect(await getPsychologyResetState(id)).toEqual({ enabled: false, session: null });
  });
});

describe("losing-trade trigger", () => {
  it("OFF: a losing trade saves and settles exactly as before; no session", async () => {
    const id = await readyUser("pr-off");
    const tradeId = await enteredTrade(id);
    await exitAll(id, tradeId, 1890);
    const snap = await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } });
    expect([snap.settledAt != null, snap.realizedR?.toNumber()]).toEqual([true, -1]);
    expect(await sessionsFor(id)).toHaveLength(0);
  });

  it("ON: only once the trade is a SETTLED loss — never while open or partially closed at a loss", async () => {
    const id = await readyUser("pr-loss");
    await setPsychologyResetEnabled(id, true);
    const tradeId = await enteredTrade(id);
    await runLive(() => upsertPartialExit(id, tradeId, { exitOrder: 1, exitPrice: 1895, percentClosed: 50, exitedAt: new Date() }));
    expect(await sessionsFor(id)).toHaveLength(0); // open exposure: no outcome yet
    await runLive(() => upsertPartialExit(id, tradeId, { exitOrder: 2, exitPrice: 1890, percentClosed: 50, exitedAt: new Date() }));
    const sessions = await sessionsFor(id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ trigger: "LOSING_TRADE", tradeId, opportunityId: null, status: "IN_PROGRESS", currentStep: 0, flowVersion: currentFlow("LOSING_TRADE").version });
    // The trade itself is untouched by the reset (one trade, settled at −0.75R).
    expect(await prisma.trade.count({ where: { userId: id } })).toBe(1);
    expect((await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } })).realizedR?.toNumber()).toBe(-0.75);
  });

  it("profitable and break-even trades never trigger it", async () => {
    const id = await readyUser("pr-win-be");
    await setPsychologyResetEnabled(id, true);
    await exitAll(id, await enteredTrade(id), 1910); // +1R
    await exitAll(id, await enteredTrade(id), 1900); // 0R
    expect(await sessionsFor(id)).toHaveLength(0);
  });

  it("re-saves, re-settlements and concurrent triggers never duplicate the session", async () => {
    const id = await readyUser("pr-dup");
    await setPsychologyResetEnabled(id, true);
    const tradeId = await enteredTrade(id);
    const exit = await exitAll(id, tradeId, 1890);
    await editExit(id, tradeId, exit.id, 1885); // edit the exit: still a loss, re-settled
    await runLive(() => Promise.all([queueLosingTradeReset(id, tradeId), queueLosingTradeReset(id, tradeId), queueLosingTradeReset(id, tradeId)]));
    expect(await sessionsFor(id)).toHaveLength(1);
    expect(await prisma.trade.count({ where: { userId: id } })).toBe(1);
  });

  it("re-enabling never replays a loss that closed while the feature was off; OFF keeps history", async () => {
    const id = await readyUser("pr-replay");
    const old = await enteredTrade(id);
    const oldExit = await exitAll(id, old, 1890); // closed while OFF
    await setPsychologyResetEnabled(id, true);
    await editExit(id, old, oldExit.id, 1888); // a later edit of an old trade
    expect(await sessionsFor(id)).toHaveLength(0);

    const fresh = await enteredTrade(id);
    await exitAll(id, fresh, 1890);
    expect(await sessionsFor(id)).toHaveLength(1);
    await setPsychologyResetEnabled(id, false);
    expect(await sessionsFor(id)).toHaveLength(1); // turning it off deletes nothing
    await setPsychologyResetEnabled(id, true);
    expect(await sessionsFor(id)).toHaveLength(1); // and turning it on again replays nothing
  });

  it("a reset that fails to persist never fails, delays or rolls back the trade save", async () => {
    const id = await readyUser("pr-fail");
    await setPsychologyResetEnabled(id, true);
    const tradeId = await enteredTrade(id);
    const spy = vi.spyOn(prisma.psychologyResetSession, "createMany").mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(exitAll(id, tradeId, 1890)).resolves.toBeTruthy();
    } finally {
      spy.mockRestore();
      err.mockRestore();
    }
    expect((await prisma.performanceRiskSnapshot.findUniqueOrThrow({ where: { tradeId } })).settledAt).not.toBeNull();
    expect(await prisma.tradeActualPartialExit.count({ where: { tradeId } })).toBe(1);
    expect(await sessionsFor(id)).toHaveLength(0);
  });

  it("re-opening a settled loss (exit deleted) keeps its one session; a backtest never creates one", async () => {
    const id = await readyUser("pr-reopen");
    await setPsychologyResetEnabled(id, true);
    const tradeId = await enteredTrade(id);
    const exit = await exitAll(id, tradeId, 1895); // −0.5R, settled
    expect(await sessionsFor(id)).toHaveLength(1);
    await runLive(() => deletePartialExit(id, tradeId, exit.id));
    await exitAll(id, tradeId, 1890); // closed again
    expect(await sessionsFor(id)).toHaveLength(1);

    const run = await createBacktestRun(id, createBacktestRunSchema.parse({ name: "Reset iso", assets: ["XAUUSD"], startDate: "2024-01-01", endDate: "2024-01-31" }));
    await runInBacktestRun(id, run.id, async () => {
      expect(await queueLosingTradeReset(id, tradeId)).toBe(false);
    });
  });

});

describe("missed-opportunity trigger", () => {
  const miss = (o: Record<string, unknown> = {}) => missOutcomeSchema.parse({ missReason: "HESITATION", missedOutcome: "MISSED_WIN", missedRealizedR: 2, ...o });
  const setup = (strategyId: string) => opportunityCreateSchema.parse({ strategyId, assetSymbol: "XAUUSD", direction: "LONG" });

  it("ON: a recorded miss opens the missed flow — no trade, no loss figure; OFF: nothing", async () => {
    const id = await readyUser("pr-missed");
    const strategy = await prisma.strategy.create({ data: { userId: id, name: "London Sweep", applicableAssets: ["XAUUSD"] } });
    await runLive(() => recordMissedSetup(id, DATE, setup(strategy.id), miss()));
    expect(await sessionsFor(id)).toHaveLength(0);

    await setPsychologyResetEnabled(id, true);
    const op = await runLive(() => recordMissedSetup(id, DATE, setup(strategy.id), miss()));
    const pending = await runLive(() => createOpportunity(id, DATE, setup(strategy.id)));
    await runLive(() => logMissedOutcome(id, pending.id, miss({ missedOutcome: "MISSED_UNDETERMINED" })));
    const sessions = await sessionsFor(id);
    expect(sessions.map((s) => [s.trigger, s.tradeId])).toEqual([
      ["MISSED_OPPORTUNITY", null],
      ["MISSED_OPPORTUNITY", null],
    ]);
    expect(sessions.map((s) => s.opportunityId).sort()).toEqual([op.id, pending.id].sort());
    expect(await prisma.trade.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.performanceRiskSnapshot.count({ where: { userId: id } })).toBe(0);
  });
});

describe("answers, navigation, resume, completion", () => {
  async function lossSession(label: string) {
    const id = await readyUser(label);
    await setPsychologyResetEnabled(id, true);
    await exitAll(id, await enteredTrade(id), 1890);
    const s = (await getPsychologyResetState(id)).session!;
    return { id, sessionId: s.id };
  }

  it("persists answers step by step, back/forward keeps them, and a reload resumes at the same step", async () => {
    const { id, sessionId } = await lossSession("pr-answers");
    let s = await saveResetAnswer(id, sessionId, { stepId: "uncertainty", optionId: "violated_rules", note: "  Moved my stop  " });
    expect([s.currentStep, s.answers.uncertainty.optionId, s.answers.uncertainty.note]).toEqual([1, "violated_rules", "Moved my stop"]);
    s = await saveResetAnswer(id, sessionId, { stepId: "probability", optionId: "compelled_recover" });
    s = await setResetStep(id, sessionId, 0); // back
    expect([s.currentStep, s.answers.probability.optionId]).toEqual([0, "compelled_recover"]);
    s = await setResetStep(id, sessionId, 5); // can't skip past the first unanswered step
    expect(s.currentStep).toBe(2);
    // "Refresh": a fresh read resumes the same session at the same step, no new record.
    const again = await getPsychologyResetState(id);
    expect([again.session?.id, again.session?.currentStep]).toEqual([sessionId, 2]);
    expect(await sessionsFor(id)).toHaveLength(1);
  });

  it("concurrent answers to different steps both survive (atomic per-step merge); invalid answers are refused", async () => {
    const { id, sessionId } = await lossSession("pr-atomic");
    await Promise.all([
      saveResetAnswer(id, sessionId, { stepId: "uncertainty", optionId: "valid_followed" }),
      saveResetAnswer(id, sessionId, { stepId: "probability", optionId: "accept" }),
    ]);
    const row = await prisma.psychologyResetSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(Object.keys(row.answers as object).sort()).toEqual(["probability", "uncertainty"]);
    await expect(saveResetAnswer(id, sessionId, { stepId: "uncertainty", optionId: "made_up" })).rejects.toThrow(/Choose one/);
    await expect(saveResetAnswer(id, sessionId, { stepId: "nope", optionId: "accept" })).rejects.toThrow(/Unknown question/);
  });

  it("completion needs every answer, records the next action, is idempotent, and makes the session read-only", async () => {
    const { id, sessionId } = await lossSession("pr-complete");
    await expect(completeReset(id, sessionId)).rejects.toBeInstanceOf(PsychologyResetError);
    for (const [stepId, optionId] of [
      ["uncertainty", "violated_rules"],
      ["probability", "compelled_recover"],
      ["separate", "recover_prove"],
      ["objectivity", "reacting"],
      ["next_action", "resume_if_valid"],
    ]) {
      await saveResetAnswer(id, sessionId, { stepId, optionId });
    }
    const done = await completeReset(id, sessionId);
    expect(done).toMatchObject({ status: "COMPLETED", nextAction: "resume_if_valid", currentStep: 5 });
    // Rule break + recovery urge → stop recommended; the choice is shown as less cautious, never enforced.
    expect(done.assessment).toMatchObject({ recommendation: "STOP_SESSION", lessCautiousThanRecommended: true });
    const twice = await completeReset(id, sessionId);
    expect(twice.completedAt).toBe(done.completedAt);
    await expect(saveResetAnswer(id, sessionId, { stepId: "uncertainty", optionId: "valid_followed" })).rejects.toThrow(/already complete/);
    expect((await getPsychologyResetState(id)).session).toBeNull();
  });

  it("'Finish later' keeps the session (resumable, not auto-opened); turning the feature off hides it without deleting answers", async () => {
    const { id, sessionId } = await lossSession("pr-defer");
    await saveResetAnswer(id, sessionId, { stepId: "uncertainty", optionId: "valid_followed" });
    expect((await setResetDeferred(id, sessionId, true)).deferred).toBe(true);
    expect((await getPsychologyResetState(id)).session).toMatchObject({ id: sessionId, deferred: true });
    await setPsychologyResetEnabled(id, false);
    expect((await getPsychologyResetState(id)).session).toBeNull();
    await setPsychologyResetEnabled(id, true);
    const resumed = await setResetDeferred(id, sessionId, false);
    expect([resumed.deferred, resumed.answers.uncertainty.optionId]).toEqual([false, "valid_followed"]);
  });

  it("another user can neither read nor write a session", async () => {
    const { sessionId } = await lossSession("pr-owner");
    const other = await readyUser("pr-intruder");
    await setPsychologyResetEnabled(other, true);
    expect((await getPsychologyResetState(other)).session).toBeNull();
    await expect(saveResetAnswer(other, sessionId, { stepId: "uncertainty", optionId: "valid_followed" })).rejects.toThrow(/not found/);
    await expect(setResetStep(other, sessionId, 0)).rejects.toThrow(/not found/);
    await expect(setResetDeferred(other, sessionId, true)).rejects.toThrow(/not found/);
    await expect(completeReset(other, sessionId)).rejects.toThrow(/not found/);
  });
});

describe("existing day limits take precedence", () => {
  it("a reached max-trades limit is reported and drives a stop recommendation — the limit itself is untouched", async () => {
    const user = await createTestUser("pr-limit");
    userIds.push(user.id);
    const today = await getTraderTodayKey(user.id);
    const section = await prisma.routineSection.create({ data: { userId: user.id, title: "Prep", sortOrder: 0 } });
    await prisma.routineItem.create({ data: { userId: user.id, sectionId: section.id, label: "x", type: "CHECKBOX", isMandatory: false, sortOrder: 0 } });
    await runLive(async () => {
      const day = await getOrCreateTradingDay(user.id, today);
      await getOrCreateDayRoutine(user.id, day);
      await setRoutineReady(user.id, today, true);
    });
    await setPsychologyResetEnabled(user.id, true);
    await exitAll(user.id, await enteredTrade(user.id, today), 1890);
    await prisma.tradingDay.updateMany({ where: { userId: user.id }, data: { maxTradesPerDay: 1 } });
    const s = (await getPsychologyResetState(user.id)).session!;
    expect(s.assessment.limitPrecedence?.messages).toEqual(["Maximum trades reached: 1 of 1."]);
    expect(s.assessment.recommendation).toBe("STOP_SESSION");
    expect((await prisma.tradingDay.findFirstOrThrow({ where: { userId: user.id } })).maxTradesPerDay).toBe(1);
  });
});
