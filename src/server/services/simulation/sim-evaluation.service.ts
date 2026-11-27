import type { Prisma, SimAccount } from "@prisma/client";

import type { TransactionClient } from "@/server/db";
import { dataMinuteToUtc, offsetMinutes } from "@/domain/charting/sessions";
import { evaluateStrategyDecision, type StrategyEvaluation } from "@/domain/strategies/strategy-evaluation";
import { getWorkspace } from "@/server/services/charting/charting.service";
import { getTraderTimezoneState } from "@/server/services/trader-time.service";
import type { Decimal } from "decimal.js";
import { dec } from "@/domain/execution";
import type { StrategyVersionSnapshot } from "@/types/strategies";

const MINUTES_PER_DAY = 1440;

export interface StrategyCheckRequest {
  setupTypeName?: string | null;
  checkedNames: string[];
}

/** Replay minute (broker wall clock) → minutes after midnight in the trader's zone. */
async function localMinuteOfDay(userId: string, minute: number): Promise<{ minute: number | null; label: string }> {
  try {
    const [workspace, trader] = await Promise.all([getWorkspace(userId), getTraderTimezoneState(userId)]);
    const utc = dataMinuteToUtc(minute, workspace.sessions.dataTimeZone);
    const local = Math.floor(utc / 60_000) + offsetMinutes(trader.timezone, utc);
    return { minute: ((local % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY, label: trader.timezone };
  } catch {
    return { minute: null, label: "" };
  }
}

/**
 * Evaluates a trade decision against the session's FROZEN strategy snapshot,
 * using only server-side state at the account's clock: the clock minute and
 * the positions already opened. Never reads a bar, so it can't look ahead.
 * Returns null when the session has no strategy or the trader sent no check.
 */
export async function evaluateOrderDecision(
  tx: TransactionClient,
  account: SimAccount,
  input: { side: "BUY" | "SELL"; check: StrategyCheckRequest | null | undefined; intendedRisk: Decimal | null; balance: Decimal },
): Promise<StrategyEvaluation | null> {
  const snapshot = account.strategySnapshot as unknown as StrategyVersionSnapshot | null;
  if (!snapshot || !input.check || account.currentMinute == null) return null;
  const minute = account.currentMinute;
  const dayStart = Math.floor(minute / MINUTES_PER_DAY) * MINUTES_PER_DAY;

  const today = await tx.simPosition.findMany({
    where: { accountId: account.id, openedMinute: { gte: dayStart, lte: minute } },
    select: { intendedRisk: true },
  });
  const balance = input.balance.greaterThan(0) ? input.balance : null;
  const dayRisk = today.reduce((sum, p) => sum.plus(p.intendedRisk?.toString() ?? 0), dec(0));
  const local = await localMinuteOfDay(account.userId, minute);

  return evaluateStrategyDecision({
    snapshot,
    direction: input.side === "BUY" ? "LONG" : "SHORT",
    setupTypeName: input.check.setupTypeName ?? null,
    checkedNames: input.check.checkedNames,
    context: {
      localMinuteOfDay: local.minute,
      timezoneLabel: local.label,
      tradesTodayBefore: today.length,
      riskPercent: balance && input.intendedRisk ? input.intendedRisk.dividedBy(balance).times(100).toNumber() : null,
      dayRiskPercentBefore: balance ? dayRisk.dividedBy(balance).times(100).toNumber() : 0,
    },
  });
}

/** Columns written on a position from its (order's) evaluation. */
export function evaluationColumns(e: StrategyEvaluation | null | undefined) {
  if (!e) return {};
  return {
    strategyEvaluation: e as unknown as Prisma.InputJsonValue,
    setupTypeName: e.setupType?.name ?? null,
    strategySessionName: e.session,
    executionScore: e.score,
    followedRules: e.followedRules,
  };
}
