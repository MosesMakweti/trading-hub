import { Decimal } from "decimal.js";

import { prisma } from "@/server/db";
import { evaluateRule, type RuleEvaluationResult } from "@/domain/prop-firms/rule-health";
import { computeTrackRecord, type TrackRecordSummary } from "@/domain/prop-firms/track-record";

/** Exact risk % of base for a persisted execution — plannedRiskAmount /
 *  riskBaseSnapshot, both frozen at allocation-confirm time (see schema
 *  comment on TradeAccountExecution.riskBaseSnapshot), so this is precise
 *  for every riskEntryMode/riskBasis combination, not an approximation. */
function deriveRiskPercentOfBase(execution: { riskBaseSnapshot: { toNumber(): number }; plannedRiskAmount: { toNumber(): number } }): number | null {
  const base = execution.riskBaseSnapshot.toNumber();
  if (base <= 0) return null;
  return (execution.plannedRiskAmount.toNumber() / base) * 100;
}

async function loadAccountForHealth(userId: string, accountId: string) {
  const account = await prisma.propFirmAccount.findFirst({
    where: { id: accountId, userId },
    include: { stages: { orderBy: { order: "asc" }, include: { rules: true } } },
  });
  if (!account) throw new Error("Account not found.");
  return account;
}

/** Live rule-health for every configured rule on one stage (spec §7) — the
 *  data source for rules-tab.tsx's badges and the "Target reached" banner. */
export async function getStageRuleHealth(userId: string, stageId: string): Promise<RuleEvaluationResult[]> {
  const stage = await prisma.accountStage.findFirst({
    where: { id: stageId, account: { userId } },
    include: { rules: true, account: true },
  });
  if (!stage) throw new Error("Stage not found.");

  const [ledgerEntries, executions, latestLedgerEntry] = await Promise.all([
    prisma.accountLedgerEntry.findMany({ where: { stageId }, orderBy: { occurredAt: "asc" } }),
    prisma.tradeAccountExecution.findMany({ where: { accountStageId: stageId } }),
    prisma.accountLedgerEntry.findFirst({
      where: { accountId: stage.accountId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      select: { balanceAfter: true },
    }),
  ]);

  const currentBalance = latestLedgerEntry ? new Decimal(latestLedgerEntry.balanceAfter.toString()) : new Decimal(stage.account.startingBalance.toString());

  const ledgerCtx = ledgerEntries.map((e) => ({ amount: e.amount.toString(), balanceAfter: e.balanceAfter.toString(), eventType: e.eventType, occurredAt: e.occurredAt }));
  const executionCtx = executions.map((e) => ({
    netPnl: e.netPnl?.toString() ?? null,
    riskPercentOfBase: deriveRiskPercentOfBase(e),
    actualLotSize: e.actualLotSize?.toString() ?? null,
    actualContractQty: e.actualContractQty?.toString() ?? null,
    status: e.status,
    closedAt: e.closedAt,
    plannedAt: e.plannedAt,
  }));

  const minTradingDaysRule = stage.rules.find((r) => r.ruleKey === "MIN_TRADING_DAYS");
  let minTradingDaysMet: boolean | null = null;
  if (minTradingDaysRule) {
    const result = evaluateRule({
      rule: {
        id: minTradingDaysRule.id,
        ruleKey: "MIN_TRADING_DAYS",
        valueType: minTradingDaysRule.valueType,
        numericValue: minTradingDaysRule.numericValue?.toString() ?? null,
        measurementBasis: minTradingDaysRule.measurementBasis,
        warningThreshold: minTradingDaysRule.warningThreshold?.toString() ?? null,
        criticalThreshold: minTradingDaysRule.criticalThreshold?.toString() ?? null,
        breachThreshold: minTradingDaysRule.breachThreshold?.toString() ?? null,
      },
      account: { dailyResetTimezone: stage.account.dailyResetTimezone, dailyResetHour: stage.account.dailyResetHour ?? 0 },
      stage: { startingBalance: stage.startingBalance.toString(), startDate: stage.startDate, status: stage.status },
      ledgerEntries: ledgerCtx,
      executions: executionCtx,
      currentBalance,
      now: new Date(),
    });
    minTradingDaysMet = result.state === "TARGET_REACHED";
  }

  return stage.rules
    .filter((r) => r.isEnabled)
    .map((rule) =>
      evaluateRule({
        rule: {
          id: rule.id,
          ruleKey: rule.ruleKey,
          valueType: rule.valueType,
          numericValue: rule.numericValue?.toString() ?? null,
          measurementBasis: rule.measurementBasis,
          warningThreshold: rule.warningThreshold?.toString() ?? null,
          criticalThreshold: rule.criticalThreshold?.toString() ?? null,
          breachThreshold: rule.breachThreshold?.toString() ?? null,
        },
        account: { dailyResetTimezone: stage.account.dailyResetTimezone, dailyResetHour: stage.account.dailyResetHour ?? 0 },
        stage: { startingBalance: stage.startingBalance.toString(), startDate: stage.startDate, status: stage.status },
        ledgerEntries: ledgerCtx,
        executions: executionCtx,
        currentBalance,
        now: new Date(),
        minTradingDaysMet,
      }),
    );
}

/** The account's currently-active stage's rule health, or [] if the account
 *  has no active stage right now. */
export async function getCurrentStageRuleHealth(userId: string, accountId: string): Promise<RuleEvaluationResult[]> {
  const stage = await prisma.accountStage.findFirst({ where: { accountId, account: { userId }, status: "ACTIVE" }, orderBy: { order: "desc" } });
  if (!stage) return [];
  return getStageRuleHealth(userId, stage.id);
}

async function trackRecordExecutionRows(where: { accountStageId: string } | { propFirmAccountId: string }) {
  const executions = await prisma.tradeAccountExecution.findMany({ where });
  const rows = executions.map((e) => ({
    grossPnl: e.grossPnl?.toString() ?? null,
    netPnl: e.netPnl?.toString() ?? null,
    plannedRiskAmount: e.plannedRiskAmount.toString(),
    riskPercentOfBase: deriveRiskPercentOfBase(e),
    actualR: e.actualR?.toString() ?? null,
    status: e.status,
    closedAt: e.closedAt,
    dateKey: (e.closedAt ?? e.plannedAt).toISOString().slice(0, 10),
  }));

  // CSV-imported trades are account-lifetime, not stage-scoped, so they only
  // fold into the account-level track record. Their P&L already reached the
  // ledger via TRADE_PNL entries at confirm time (so balance/ROI/drawdown
  // already include them) — this adds them to the execution list purely so
  // win/loss/profit-factor/streak counts also reflect imports. computeTrackRecord
  // derives netPnl from executions (not the ledger), so there's no double count.
  if ("propFirmAccountId" in where) {
    const importedTrades = await prisma.propFirmImportedTrade.findMany({
      where: { accountId: where.propFirmAccountId },
    });
    for (const t of importedTrades) {
      rows.push({
        grossPnl: t.grossPnl.toString(),
        netPnl: t.netPnl.toString(),
        plannedRiskAmount: "0", // required by the type; unused by the math
        riskPercentOfBase: null,
        actualR: null,
        status: t.status === "CLOSED" ? "CLOSED" : t.status === "PARTIAL" ? "PARTIALLY_CLOSED" : "EXECUTED",
        closedAt: t.closedAt,
        dateKey: (t.closedAt ?? t.openedAt).toISOString().slice(0, 10),
      });
    }
  }

  return rows;
}

/** Account-level track record (spec §6) — computed from the WHOLE account's
 *  ledger + executions, distinct from a single stage's numbers. */
export async function getAccountTrackRecord(userId: string, accountId: string): Promise<TrackRecordSummary> {
  const account = await loadAccountForHealth(userId, accountId);
  const [ledgerEntries, executions] = await Promise.all([
    prisma.accountLedgerEntry.findMany({ where: { accountId }, orderBy: { occurredAt: "asc" } }),
    trackRecordExecutionRows({ propFirmAccountId: accountId }),
  ]);

  return computeTrackRecord(
    ledgerEntries.map((e) => ({ amount: e.amount.toString(), balanceAfter: e.balanceAfter.toString(), occurredAt: e.occurredAt, eventType: e.eventType })),
    executions,
    account.startingBalance.toString(),
  );
}

/** Stage-level track record — same math, filtered to one stage's own ledger
 *  entries/executions, kept genuinely distinct from the account-level view. */
export async function getStageTrackRecord(userId: string, stageId: string): Promise<TrackRecordSummary> {
  const stage = await prisma.accountStage.findFirst({ where: { id: stageId, account: { userId } }, include: { account: true } });
  if (!stage) throw new Error("Stage not found.");

  const [ledgerEntries, executions] = await Promise.all([
    prisma.accountLedgerEntry.findMany({ where: { stageId }, orderBy: { occurredAt: "asc" } }),
    trackRecordExecutionRows({ accountStageId: stageId }),
  ]);

  return computeTrackRecord(
    ledgerEntries.map((e) => ({ amount: e.amount.toString(), balanceAfter: e.balanceAfter.toString(), occurredAt: e.occurredAt, eventType: e.eventType })),
    executions,
    stage.startingBalance.toString(),
  );
}
