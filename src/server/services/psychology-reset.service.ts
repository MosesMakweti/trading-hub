import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { isBacktestScope, runLive } from "@/server/workspace/scope";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { getTraderTodayKey } from "@/server/services/trader-time.service";
import { settledWinLossClass } from "@/domain/analytics/canonical-dataset";
import { computeDayUsage, evaluateLimitState } from "@/domain/today/limit-state";
import {
  assessReset,
  currentFlow,
  flowFor,
  isComplete,
  validateAnswer,
  type DayLimitContext,
  type ResetAnswer,
  type ResetAnswers,
  type ResetFlow,
} from "@/domain/psychology-reset";
import type { PsychologyResetSessionDTO, PsychologyResetStateDTO } from "@/types/psychology-reset";

/**
 * Trading Psychology Reset — the optional guided reflection after a settled
 * LOSING trade or a recorded MISSED opportunity.
 *
 *  • OFF by default; the user's own preference (User.psychologyResetEnabled)
 *    is the single source of truth for creating and auto-showing sessions.
 *  • Triggers OBSERVE existing saves and never fail them: the hooks catch
 *    and log (see queue*Safely). A trade or opportunity is never written,
 *    changed or rolled back here.
 *  • A losing trade is the canonical settled result (settledWinLossClass —
 *    the rule Analytics and the Journal share), never floating P/L.
 *  • At most one session per trade / opportunity (DB unique), LIVE only.
 *  • Turning the feature OFF never deletes sessions.
 */

export class PsychologyResetError extends Error {}

type Db = typeof prisma;

// ── Preference ──────────────────────────────────────────────────────────────

export async function getPsychologyResetPreference(userId: string): Promise<{ enabled: boolean; enabledAt: Date | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { psychologyResetEnabled: true, psychologyResetEnabledAt: true },
  });
  return { enabled: user?.psychologyResetEnabled ?? false, enabledAt: user?.psychologyResetEnabledAt ?? null };
}

/**
 * Turning it ON stamps `enabledAt` (only on an OFF → ON change), so events
 * that happened before — or while it was off — are never replayed.
 * Turning it OFF only stops future automatic prompts; nothing is deleted.
 */
export async function setPsychologyResetEnabled(userId: string, enabled: boolean, now: Date = new Date()) {
  await prisma.user.updateMany({
    where: { id: userId, psychologyResetEnabled: !enabled },
    data: enabled ? { psychologyResetEnabled: true, psychologyResetEnabledAt: now } : { psychologyResetEnabled: false },
  });
  return getPsychologyResetPreference(userId);
}

// ── Triggers ────────────────────────────────────────────────────────────────

/**
 * After a live trade's lifecycle sync: a session is created when the trade
 * is a SETTLED LOSS, closed at/after the feature was (last) turned on, and
 * none exists for it yet. Idempotent (unique tradeId + skipDuplicates):
 * retries, double submits and re-settlements never duplicate it.
 */
export async function queueLosingTradeReset(userId: string, tradeId: string): Promise<boolean> {
  if (isBacktestScope()) return false;
  const pref = await getPsychologyResetPreference(userId);
  if (!pref.enabled || !pref.enabledAt) return false;
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, userId, deletedAt: null, backtestRunId: null },
    select: { closedAt: true, performanceRiskSnapshot: { select: { settledAt: true, realizedR: true } } },
  });
  const snap = trade?.performanceRiskSnapshot;
  if (!trade || !snap) return false;
  const cls = settledWinLossClass({ settled: snap.settledAt != null, realizedRSoFar: snap.realizedR == null ? null : snap.realizedR.toNumber() });
  if (cls !== "LOSS") return false;
  const closedAt = trade.closedAt ?? snap.settledAt!;
  if (closedAt.getTime() < pref.enabledAt.getTime()) return false; // closed before it was turned on: never replayed
  const { count } = await prisma.psychologyResetSession.createMany({
    data: [{ userId, trigger: "LOSING_TRADE", tradeId, flowVersion: currentFlow("LOSING_TRADE").version }],
    skipDuplicates: true,
  });
  return count > 0;
}

/** After a live opportunity is recorded MISSED. No trade and no financial loss are created or implied. */
export async function queueMissedOpportunityReset(userId: string, opportunityId: string): Promise<boolean> {
  if (isBacktestScope()) return false;
  const pref = await getPsychologyResetPreference(userId);
  if (!pref.enabled) return false;
  const op = await prisma.tradeOpportunity.findFirst({
    where: { id: opportunityId, userId, status: "MISSED", deletedAt: null, backtestRunId: null },
    select: { id: true },
  });
  if (!op) return false;
  const { count } = await prisma.psychologyResetSession.createMany({
    data: [{ userId, trigger: "MISSED_OPPORTUNITY", opportunityId, flowVersion: currentFlow("MISSED_OPPORTUNITY").version }],
    skipDuplicates: true,
  });
  return count > 0;
}

/** Hook wrappers: a reset can never delay, fail or roll back the save that triggered it. */
export async function queueLosingTradeResetSafely(userId: string, tradeId: string): Promise<void> {
  await queueLosingTradeReset(userId, tradeId).catch((e) => console.error("[psychology-reset] losing-trade trigger failed", e));
}
export async function queueMissedOpportunityResetSafely(userId: string, opportunityId: string): Promise<void> {
  await queueMissedOpportunityReset(userId, opportunityId).catch((e) => console.error("[psychology-reset] missed-opportunity trigger failed", e));
}

// ── Read model ──────────────────────────────────────────────────────────────

const sessionSelect = {
  id: true,
  trigger: true,
  flowVersion: true,
  status: true,
  currentStep: true,
  answers: true,
  nextAction: true,
  deferredAt: true,
  createdAt: true,
  completedAt: true,
  trade: { select: { assetSymbol: true, direction: true, tradeDate: true } },
  opportunity: { select: { assetSymbol: true, direction: true, spottedAt: true } },
} satisfies Prisma.PsychologyResetSessionSelect;

type SessionRow = Prisma.PsychologyResetSessionGetPayload<{ select: typeof sessionSelect }>;

function flowOf(row: { trigger: SessionRow["trigger"]; flowVersion: number }): ResetFlow {
  const flow = flowFor(row.trigger, row.flowVersion);
  if (!flow) throw new PsychologyResetError("This reset uses a retired version of the questions.");
  return flow;
}

function answersOf(row: { answers: Prisma.JsonValue }): ResetAnswers {
  const a = row.answers;
  return a && typeof a === "object" && !Array.isArray(a) ? (a as unknown as ResetAnswers) : {};
}

/** Today's existing (soft) day limits, read-only — the same usage/limit rule as Today. */
async function dayLimitContext(userId: string): Promise<DayLimitContext> {
  const todayKey = await getTraderTodayKey(userId);
  return runLive(async () => {
    const date = dateKeyToUtcDate(todayKey);
    const [day, trades] = await Promise.all([
      prisma.tradingDay.findFirst({ where: { userId, date }, select: { riskBudgetPercent: true, maxTradesPerDay: true } }),
      prisma.trade.findMany({
        where: { userId, tradeDate: date, deletedAt: null },
        select: { actualEntry: true, reviewLifecycleStatus: true, performanceRiskSnapshot: { select: { riskPercent: true } } },
      }),
    ]);
    const usage = computeDayUsage(
      trades.map((t) => ({
        hasActualEntry: t.actualEntry != null,
        cancelled: t.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED",
        performanceRiskPercent: t.performanceRiskSnapshot ? t.performanceRiskSnapshot.riskPercent.toNumber() : null,
      })),
    );
    const limits = { riskLimitPercent: day?.riskBudgetPercent ? day.riskBudgetPercent.toNumber() : null, maxTrades: day?.maxTradesPerDay ?? null };
    const state = evaluateLimitState(usage, limits);
    const messages: string[] = [];
    if (state.risk === "AT_LIMIT" || state.risk === "OVER") {
      messages.push(`Daily risk limit reached: ${usage.riskUsedPercent}% used of ${limits.riskLimitPercent}%.`);
    }
    if (state.trades === "AT_LIMIT" || state.trades === "OVER") {
      messages.push(`Maximum trades reached: ${usage.executedCount} of ${limits.maxTrades}.`);
    }
    return { reached: state.overrideRequiredForNewTrade, messages };
  });
}

function toSessionDTO(row: SessionRow, limits: DayLimitContext | null): PsychologyResetSessionDTO {
  const flow = flowOf(row);
  const answers = answersOf(row);
  const assessment = assessReset(flow, answers, limits);
  const context = row.trade
    ? { assetSymbol: row.trade.assetSymbol, direction: row.trade.direction, dateKey: utcDateToKey(row.trade.tradeDate) }
    : row.opportunity
      ? { assetSymbol: row.opportunity.assetSymbol, direction: row.opportunity.direction, dateKey: utcDateToKey(row.opportunity.spottedAt) }
      : null;
  return {
    id: row.id,
    trigger: row.trigger,
    flowVersion: row.flowVersion,
    status: row.status,
    currentStep: Math.min(Math.max(row.currentStep, 0), flow.steps.length),
    answers,
    nextAction: row.nextAction,
    deferred: row.deferredAt != null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    context,
    assessment,
  };
}

/**
 * What the app shell needs: the preference, and — only while it is ON — the
 * newest unfinished session (auto-opened unless the trader chose "Finish
 * later"). OFF → nothing is shown anywhere.
 */
export async function getPsychologyResetState(userId: string): Promise<PsychologyResetStateDTO> {
  const pref = await getPsychologyResetPreference(userId);
  if (!pref.enabled) return { enabled: false, session: null };
  const row = await prisma.psychologyResetSession.findFirst({
    where: { userId, status: "IN_PROGRESS" },
    orderBy: { createdAt: "desc" },
    select: sessionSelect,
  });
  if (!row || !flowFor(row.trigger, row.flowVersion)) return { enabled: true, session: null };
  return { enabled: true, session: toSessionDTO(row, await dayLimitContext(userId)) };
}

async function requireSession(db: Db, userId: string, sessionId: string): Promise<SessionRow> {
  const row = await db.psychologyResetSession.findFirst({ where: { id: sessionId, userId }, select: sessionSelect });
  if (!row) throw new PsychologyResetError("Reset not found.");
  return row;
}

async function reload(userId: string, sessionId: string): Promise<PsychologyResetSessionDTO> {
  return toSessionDTO(await requireSession(prisma, userId, sessionId), await dayLimitContext(userId));
}

// ── Answering ───────────────────────────────────────────────────────────────

/**
 * Saves one answer (and its optional reflection) and moves to the next
 * step. Atomic per step (jsonb merge of ONE key), so retries and two open
 * tabs never lose another step's answer. Re-sending the same answer is a
 * no-op in effect. A completed session is read-only.
 */
export async function saveResetAnswer(
  userId: string,
  sessionId: string,
  input: { stepId: string; optionId: string; note?: string | null },
  now: Date = new Date(),
): Promise<PsychologyResetSessionDTO> {
  const row = await requireSession(prisma, userId, sessionId);
  if (row.status === "COMPLETED") throw new PsychologyResetError("This reset is already complete.");
  const flow = flowOf(row);
  const note = input.note?.trim() ? input.note.trim() : null;
  const error = validateAnswer(flow, input.stepId, input.optionId, note);
  if (error) throw new PsychologyResetError(error);
  const index = flow.steps.findIndex((s) => s.id === input.stepId);
  const answer: ResetAnswer = { optionId: input.optionId, answeredAt: now.toISOString(), ...(note ? { note } : {}) };
  const updated = await prisma.$executeRaw`
    UPDATE "PsychologyResetSession"
    SET "answers" = COALESCE("answers", '{}'::jsonb) || jsonb_build_object(${input.stepId}::text, ${JSON.stringify(answer)}::jsonb),
        "currentStep" = ${index + 1},
        "updatedAt" = ${now}
    WHERE "id" = ${row.id} AND "userId" = ${userId} AND "status" = 'IN_PROGRESS'
  `;
  if (updated === 0) throw new PsychologyResetError("This reset is already complete.");
  return reload(userId, sessionId);
}

/** Back / forward navigation without answering. Never beyond the first unanswered step. */
export async function setResetStep(userId: string, sessionId: string, step: number): Promise<PsychologyResetSessionDTO> {
  const row = await requireSession(prisma, userId, sessionId);
  const flow = flowOf(row);
  const answers = answersOf(row);
  const firstUnanswered = flow.steps.findIndex((s) => !answers[s.id]);
  const max = firstUnanswered === -1 ? flow.steps.length : firstUnanswered;
  const target = Math.min(Math.max(Math.trunc(step), 0), max);
  if (row.status === "IN_PROGRESS") {
    await prisma.psychologyResetSession.updateMany({ where: { id: row.id, userId, status: "IN_PROGRESS" }, data: { currentStep: target } });
  }
  return reload(userId, sessionId);
}

/** "Finish later" (deferred) stops the automatic prompt; "Resume" clears it. Answers are untouched. */
export async function setResetDeferred(userId: string, sessionId: string, deferred: boolean, now: Date = new Date()): Promise<PsychologyResetSessionDTO> {
  const row = await requireSession(prisma, userId, sessionId);
  if (row.status === "IN_PROGRESS") {
    await prisma.psychologyResetSession.updateMany({ where: { id: row.id, userId }, data: { deferredAt: deferred ? now : null } });
  }
  return reload(userId, sessionId);
}

/** Completes a fully answered session. Idempotent: completing twice returns the stored result. */
export async function completeReset(userId: string, sessionId: string, now: Date = new Date()): Promise<PsychologyResetSessionDTO> {
  const row = await requireSession(prisma, userId, sessionId);
  if (row.status === "COMPLETED") return reload(userId, sessionId);
  const flow = flowOf(row);
  const answers = answersOf(row);
  if (!isComplete(flow, answers)) throw new PsychologyResetError("Answer every question before finishing.");
  const nextAction = answers[flow.steps[flow.steps.length - 1].id].optionId;
  await prisma.psychologyResetSession.updateMany({
    where: { id: row.id, userId, status: "IN_PROGRESS" },
    data: { status: "COMPLETED", nextAction, completedAt: now, currentStep: flow.steps.length, deferredAt: null },
  });
  return reload(userId, sessionId);
}
