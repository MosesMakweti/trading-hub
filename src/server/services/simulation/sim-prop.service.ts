/**
 * Prop Firm Simulator (docs/SIMULATION_PLATFORM.md §Phase 5).
 *
 *   model (template or custom, versioned) → purchase (frozen snapshot, fee)
 *   → stage accounts (evaluation phases, then funded) → rule engine on every
 *   clock minute → pass (next stage) / fail / breach → payouts (ledger).
 *
 * The rule engine (domain/simulation/prop-rules.ts) runs inside the clock's
 * transaction through a registered hook, so a breach halts the replay AT the
 * breach minute and nothing after it is ever processed. A passed phase's
 * next account continues from the pass minute on LATER history — a challenge
 * never replays market data it has already seen.
 */
import type { Prisma, SimAccount, SimChallenge } from "@prisma/client";
import type { Decimal } from "decimal.js";

import { prisma, type TransactionClient } from "@/server/db";
import { dec } from "@/domain/execution/precision";
import { effectiveSpread, markPrice } from "@/domain/simulation/market";
import { grossPnl, pointsToPrice, commissionFor } from "@/domain/simulation/money";
import { tradingDayOf, type MinuteSnapshot, type StepResult } from "@/domain/simulation/engine";
import { currentFloors, evaluateMinute, evaluatePayout, initialRuleState, passConditions, type RuleState, type Verdict } from "@/domain/simulation/prop-rules";
import { FIRM_TEMPLATES, firmModelSchema, isFundedStage, stageCount, stageName, stageRules, type FirmModel, type FirmModelInput } from "@/domain/simulation/firm-model";
import { parseRules } from "@/domain/simulation/rules";
import { formatWallClock } from "@/domain/native-replay/wall-clock";
import { utcDateToKey } from "@/lib/date";
import { createSimAccount, lockAccount, requireSimAccount, SimError } from "./sim-account.service";
import { appendLedger, currentBalance } from "./sim-ledger";
import { accountFeeds, latestBars } from "./sim-market";
import { registerRuleHook } from "./sim-clock.service";

// ── Firm models ─────────────────────────────────────────────────────────────

export interface FirmModelOption {
  id: string;
  source: "TEMPLATE" | "CUSTOM";
  version: number;
  model: FirmModel;
}

export async function listFirmModels(userId: string): Promise<FirmModelOption[]> {
  const custom = await prisma.simFirmModel.findMany({ where: { userId, archivedAt: null }, orderBy: { updatedAt: "desc" } });
  return [
    ...custom.map((m) => ({ id: m.id, source: "CUSTOM" as const, version: m.version, model: firmModelSchema.parse(m.definition) })),
    ...FIRM_TEMPLATES.map((t) => ({ id: `template:${t.key}`, source: "TEMPLATE" as const, version: 1, model: t.model })),
  ];
}

export async function createFirmModel(userId: string, input: FirmModelInput) {
  const model = firmModelSchema.parse(input);
  return prisma.simFirmModel.create({ data: { userId, firmName: model.firmName, modelName: model.modelName, definition: model as unknown as Prisma.InputJsonValue } });
}

/** Edits a custom model: a new version. Existing challenges keep their snapshot. */
export async function updateFirmModel(userId: string, modelId: string, input: FirmModelInput) {
  const existing = await prisma.simFirmModel.findFirst({ where: { id: modelId, userId } });
  if (!existing) throw new SimError("Firm model not found.");
  const model = firmModelSchema.parse(input);
  return prisma.simFirmModel.update({
    where: { id: existing.id },
    data: { firmName: model.firmName, modelName: model.modelName, definition: model as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
  });
}

async function resolveModel(userId: string, modelRef: string): Promise<{ model: FirmModel; version: number; firmModelId: string | null; templateKey: string | null }> {
  if (modelRef.startsWith("template:")) {
    const t = FIRM_TEMPLATES.find((x) => `template:${x.key}` === modelRef);
    if (!t) throw new SimError("That template doesn't exist.");
    return { model: t.model, version: 1, firmModelId: null, templateKey: t.key };
  }
  const m = await prisma.simFirmModel.findFirst({ where: { id: modelRef, userId, archivedAt: null } });
  if (!m) throw new SimError("Firm model not found.");
  return { model: firmModelSchema.parse(m.definition), version: m.version, firmModelId: m.id, templateKey: null };
}

// ── Purchase ────────────────────────────────────────────────────────────────

export interface PurchaseInput {
  modelRef: string;
  accountSize: number;
  datasets: { assetSymbol: string; datasetId: string }[];
  periodStart: string;
  periodEnd: string;
}

/** Buys a simulated challenge: no payment, the fee is recorded on the challenge and its timeline. */
export async function purchaseChallenge(userId: string, input: PurchaseInput): Promise<{ challenge: SimChallenge; account: SimAccount }> {
  const { model, version, firmModelId, templateKey } = await resolveModel(userId, input.modelRef);
  const size = model.sizes.find((s) => s.accountSize === input.accountSize);
  if (!size) throw new SimError("That account size isn't offered by this model.");
  if (model.instruments) {
    const outside = input.datasets.map((d) => d.assetSymbol.toUpperCase()).filter((s) => !model.instruments!.includes(s));
    if (outside.length) throw new SimError(`${outside.join(", ")} can't be traded on this model.`);
  }
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.simChallenge.create({
      data: {
        userId,
        firmModelId,
        templateKey,
        firmName: model.firmName,
        modelName: model.modelName,
        modelVersion: version,
        definitionSnapshot: model as unknown as Prisma.InputJsonValue,
        accountSize: size.accountSize,
        fee: size.fee,
        currency: model.currency,
        status: model.phases.length === 0 ? "FUNDED" : "IN_EVALUATION",
        fundedAt: model.phases.length === 0 ? new Date() : null,
        datasets: input.datasets as unknown as Prisma.InputJsonValue,
        periodStart: new Date(`${input.periodStart}T00:00:00Z`),
        periodEnd: new Date(`${input.periodEnd}T00:00:00Z`),
      },
    });
    const account = await createSimAccount(
      userId,
      {
        product: "PROP_FIRM",
        kind: isFundedStage(model, 0) ? "FUNDED" : "EVALUATION",
        name: `${model.modelName} · ${stageName(model, 0)}`,
        datasets: input.datasets,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        startingBalance: size.accountSize,
        currency: model.currency,
        rules: stageRules(model, 0),
        challengeId: challenge.id,
        phaseIndex: 0,
      },
      tx,
    );
    await tx.simEvent.create({
      data: { userId, accountId: account.id, type: "CHALLENGE_PURCHASED", data: { challengeId: challenge.id, fee: size.fee, accountSize: size.accountSize, model: `${model.firmName} · ${model.modelName} v${version}` } },
    });
    return { challenge, account };
  });
}

// ── Rule hook (runs inside the clock transaction) ──────────────────────────

const ruleStateOf = (account: SimAccount, rulesResetHour: number): RuleState =>
  (account.ruleState as RuleState | null) ?? initialRuleState(account.startingBalance.toString(), tradingDayOf(account.currentMinute!, rulesResetHour));

registerRuleHook(async (tx, account) => {
  if (account.product !== "PROP_FIRM" || account.status !== "ACTIVE") return null;
  const rules = parseRules(account.rules);
  const state = ruleStateOf(account, rules.dailyResetHour);
  let verdict: Verdict = { kind: "CONTINUE" };
  let prevOpen = await tx.simPosition.count({ where: { accountId: account.id, status: "OPEN" } });
  let last: MinuteSnapshot | null = null;
  return {
    onMinute: (snap) => {
      if (snap.openedThisMinute > 0 && !state.tradingDays.includes(snap.tradingDay)) state.tradingDays.push(snap.tradingDay);
      const heldAtReset = snap.tradingDay > state.day ? prevOpen : 0;
      verdict = evaluateMinute(rules, state, snap, heldAtReset);
      prevOpen = snap.openPositions;
      last = snap;
      return verdict.kind === "CONTINUE" ? undefined : "HALT";
    },
    finalize: async (ftx, result) => {
      await ftx.simAccount.update({ where: { id: account.id }, data: { ruleState: state as unknown as Prisma.InputJsonValue } });
      if (verdict.kind === "BREACH") await recordBreach(ftx, account, verdict, last!, result, state);
      else if (verdict.kind === "PASS") await passStage(ftx, account, verdict.minute);
      else if (verdict.kind === "FAIL") await failStage(ftx, account, verdict.minute, verdict.reason);
    },
  };
});

/** Closes every open position at the breach minute's market and records the breach report. */
async function recordBreach(tx: TransactionClient, account: SimAccount, v: Extract<Verdict, { kind: "BREACH" }>, snap: MinuteSnapshot, result: StepResult, state: RuleState) {
  const userId = account.userId;
  const fresh = await tx.simAccount.findUniqueOrThrow({ where: { id: account.id } });
  const rules = parseRules(account.rules);
  const open = await tx.simPosition.findMany({ where: { accountId: account.id, status: "OPEN" } });
  const feeds = await accountFeeds(tx, account.id);
  const marks = await latestBars(tx, feeds, v.minute);
  const contributors: { positionId: string; symbol: string; side: string; pnl: string; open: boolean }[] = [];
  for (const p of open) {
    const bar = marks.get(p.symbol);
    if (!bar) continue;
    const price = markPrice(p.side, bar, effectiveSpread(bar, rules.costs.defaultSpreadPoints));
    const qty = p.remainingQuantity.toString();
    const pnl = grossPnl({ side: p.side, entry: pointsToPrice(p.entryPoints, p.priceScale), exit: pointsToPrice(price, p.priceScale), quantity: qty, valuePerPriceUnit: p.valuePerPriceUnit.toString() });
    const commission = commissionFor(qty, rules.costs.commissionPerUnitPerSide);
    const seq = (await tx.simFill.count({ where: { positionId: p.id } })) + 1;
    await tx.simFill.create({ data: { userId, accountId: account.id, positionId: p.id, sequence: seq, kind: "CLOSE", reason: "LIQUIDATION", minute: v.minute, pricePoints: price, quantity: qty, grossPnl: pnl.toFixed(2), commission: commission.toFixed(2) } });
    await appendLedger(tx, fresh, [
      { type: "REALIZED_PNL", amount: pnl, idempotencyKey: `liquidation:${p.id}`, positionId: p.id, minute: v.minute },
      { type: "COMMISSION", amount: commission, idempotencyKey: `liquidation-commission:${p.id}`, positionId: p.id, minute: v.minute },
    ]);
    await tx.simPosition.update({
      where: { id: p.id },
      data: { status: "CLOSED", remainingQuantity: "0", closedMinute: v.minute, closeReason: "LIQUIDATION", realizedPnl: dec(p.realizedPnl.toString()).plus(pnl).toFixed(2), commissions: dec(p.commissions.toString()).plus(commission).toFixed(2) },
    });
    contributors.push({ positionId: p.id, symbol: p.symbol, side: p.side, pnl: pnl.toFixed(2), open: true });
  }
  // Trades closed earlier on the breach's trading day contributed too.
  const dayStart = state.day * 1440 + rules.dailyResetHour * 60;
  const closedToday = await tx.simPosition.findMany({ where: { accountId: account.id, status: "CLOSED", closedMinute: { gte: dayStart, lte: v.minute }, closeReason: { not: "LIQUIDATION" } } });
  for (const p of closedToday) contributors.push({ positionId: p.id, symbol: p.symbol, side: p.side, pnl: p.realizedPnl.toFixed(2), open: false });

  await tx.simBreach.create({
    data: {
      userId,
      accountId: account.id,
      rule: v.rule,
      minute: v.minute,
      balance: snap.balance.toFixed(2),
      equity: snap.equity.toFixed(2),
      measured: v.measured.toFixed(2),
      floor: v.floor?.toFixed(2) ?? null,
      basis: v.basis,
      detail: v.detail,
      contributors: contributors as unknown as Prisma.InputJsonValue,
      floatingInvolved: v.basis === "EQUITY" && snap.adverseEquity.lessThan(snap.balance),
    },
  });
  await tx.simOrder.updateMany({ where: { accountId: account.id, status: "PENDING" }, data: { status: "CANCELLED", resolvedMinute: v.minute } });
  await tx.simAccount.update({ where: { id: account.id }, data: { status: "BREACHED", statusReason: v.detail, endedAt: new Date() } });
  if (account.challengeId) await tx.simChallenge.update({ where: { id: account.challengeId }, data: { status: "BREACHED", endedAt: new Date() } });
  await tx.simEvent.create({ data: { userId, accountId: account.id, type: "BREACHED", minute: v.minute, data: { rule: v.rule, detail: v.detail, measured: v.measured.toFixed(2), floor: v.floor?.toFixed(2) ?? null } } });
}

/** Finalises a passed phase and opens the next stage — once (unique challenge × phase). */
async function passStage(tx: TransactionClient, account: SimAccount, minute: number) {
  const challenge = await tx.simChallenge.findUniqueOrThrow({ where: { id: account.challengeId! } });
  const model = firmModelSchema.parse(challenge.definitionSnapshot);
  const next = account.phaseIndex! + 1;
  await tx.simAccount.update({ where: { id: account.id }, data: { status: "PASSED", statusReason: `${stageName(model, account.phaseIndex!)} passed.`, endedAt: new Date() } });
  await tx.simEvent.create({ data: { userId: account.userId, accountId: account.id, type: "PHASE_PASSED", minute } });
  if (next >= stageCount(model)) return;
  const existing = await tx.simAccount.findFirst({ where: { challengeId: challenge.id, phaseIndex: next } });
  if (existing) return;
  const funded = isFundedStage(model, next);
  const passDate = formatWallClock(minute).slice(0, 10);
  const nextAccount = await createSimAccount(
    account.userId,
    {
      product: "PROP_FIRM",
      kind: funded ? "FUNDED" : "EVALUATION",
      name: `${model.modelName} · ${stageName(model, next)}`,
      datasets: challenge.datasets as unknown as { assetSymbol: string; datasetId: string }[],
      periodStart: passDate,
      periodEnd: utcDateToKey(challenge.periodEnd),
      startingBalance: Number(challenge.accountSize.toString()),
      currency: challenge.currency,
      rules: stageRules(model, next),
      challengeId: challenge.id,
      phaseIndex: next,
    },
    tx,
  );
  // Continues seamlessly from the pass minute — never on history already seen.
  await tx.simAccount.update({ where: { id: nextAccount.id }, data: { currentMinute: minute, status: "ACTIVE", startedAt: new Date(), clockVersion: 1 } });
  await tx.simChallenge.update({ where: { id: challenge.id }, data: { currentPhaseIndex: next, ...(funded ? { status: "FUNDED", fundedAt: new Date() } : {}) } });
  await tx.simEvent.create({ data: { userId: account.userId, accountId: nextAccount.id, type: funded ? "FUNDED" : "PHASE_STARTED", minute, data: { fromAccountId: account.id } } });
}

async function failStage(tx: TransactionClient, account: SimAccount, minute: number, reason: string) {
  await tx.simAccount.update({ where: { id: account.id }, data: { status: "FAILED", statusReason: reason, endedAt: new Date() } });
  if (account.challengeId) await tx.simChallenge.update({ where: { id: account.challengeId }, data: { status: "FAILED", endedAt: new Date() } });
  await tx.simEvent.create({ data: { userId: account.userId, accountId: account.id, type: "PHASE_FAILED", minute, data: { reason } } });
}

// ── Status, payouts ─────────────────────────────────────────────────────────

export interface PropAccountStatusDTO {
  accountId: string;
  challengeId: string;
  stage: string;
  kind: SimAccount["kind"];
  status: SimAccount["status"];
  startingBalance: string;
  balance: string;
  profitTarget: string | null;
  dailyLossFloor: string | null;
  maxLossFloor: string | null;
  dailyLossBasis: string | null;
  maxLossModel: string | null;
  tradingDays: number;
  minTradingDays: number | null;
  calendarDaysUsed: number;
  maxCalendarDays: number | null;
  passUnmet: string[];
  payout: { eligible: boolean; reasons: string[]; grossPayout: string; traderShare: string; firmShare: string; splitPercent: number } | null;
  notEnforced: string[];
}

async function payoutContext(tx: TransactionClient | typeof prisma, account: SimAccount, state: RuleState, balance: Decimal) {
  const rules = parseRules(account.rules);
  const terms = rules.payout!;
  const last = await tx.simPayout.findFirst({ where: { accountId: account.id }, orderBy: { sequence: "desc" } });
  const today = tradingDayOf(account.currentMinute!, rules.dailyResetHour);
  const lastDay = last ? tradingDayOf(last.minute, rules.dailyResetHour) : null;
  const open = await tx.simPosition.count({ where: { accountId: account.id, status: "OPEN" } });
  return {
    last,
    evaluation: evaluatePayout({
      startingBalance: account.startingBalance.toString(),
      balance,
      openPositions: open,
      terms,
      daysSinceFunded: today - state.firstDay,
      daysSinceLastPayout: lastDay == null ? null : today - lastDay,
      tradingDaysInCycle: state.tradingDays.filter((d) => lastDay == null || d > lastDay).length,
    }),
  };
}

export async function getPropAccountStatus(userId: string, accountId: string): Promise<PropAccountStatusDTO> {
  const account = await requireSimAccount(userId, accountId);
  if (account.product !== "PROP_FIRM" || !account.challengeId) throw new SimError("Not a prop firm account.");
  const challenge = await prisma.simChallenge.findUniqueOrThrow({ where: { id: account.challengeId } });
  const model = firmModelSchema.parse(challenge.definitionSnapshot);
  const rules = parseRules(account.rules);
  const balance = await prisma.$transaction((tx) => currentBalance(tx, account.id, account.ledgerSequence));
  const state = account.currentMinute == null ? initialRuleState(account.startingBalance.toString(), 0) : ruleStateOf(account, rules.dailyResetHour);
  const floors = currentFloors(rules, state);
  const open = await prisma.simPosition.count({ where: { accountId: account.id, status: "OPEN" } });
  const payout = account.kind === "FUNDED" && rules.payout && account.currentMinute != null ? (await payoutContext(prisma, account, state, balance)).evaluation : null;
  return {
    accountId: account.id,
    challengeId: challenge.id,
    stage: stageName(model, account.phaseIndex ?? 0),
    kind: account.kind,
    status: account.status,
    startingBalance: account.startingBalance.toFixed(2),
    balance: balance.toFixed(2),
    profitTarget: floors.profitTarget?.toFixed(2) ?? null,
    dailyLossFloor: floors.dailyLossFloor?.toFixed(2) ?? null,
    maxLossFloor: floors.maxLossFloor?.toFixed(2) ?? null,
    dailyLossBasis: rules.dailyLoss ? `${rules.dailyLoss.limitPercent}% · ${rules.dailyLoss.basis.toLowerCase()} · ${rules.dailyLoss.reference.toLowerCase().replaceAll("_", " ")}` : null,
    maxLossModel: rules.maxLoss ? `${rules.maxLoss.limitPercent}% · ${rules.maxLoss.model.toLowerCase().replaceAll("_", " ")} · ${rules.maxLoss.basis.toLowerCase()}${rules.maxLoss.trailingLockAtStart ? " · locks at start" : ""}` : null,
    tradingDays: state.tradingDays.length,
    minTradingDays: rules.objective.minTradingDays,
    calendarDaysUsed: account.currentMinute == null ? 0 : tradingDayOf(account.currentMinute, rules.dailyResetHour) - state.firstDay,
    maxCalendarDays: rules.objective.maxCalendarDays,
    passUnmet: rules.objective.profitTargetPercent == null ? [] : passConditions(rules, state, { balance, openPositions: open }).unmet,
    payout: payout && { eligible: payout.eligible, reasons: payout.reasons, grossPayout: payout.grossPayout.toFixed(2), traderShare: payout.traderShare.toFixed(2), firmShare: payout.firmShare.toFixed(2), splitPercent: rules.payout!.profitSplitPercent },
    notEnforced: rules.newsTradingRestricted ? ["News trading restriction (no economic-calendar data)"] : [],
  };
}

/** Requests a payout at the current replay time: verified, split, booked as a ledger withdrawal. */
export async function requestPayout(userId: string, accountId: string) {
  return prisma.$transaction(async (tx) => {
    const account = await lockAccount(tx, userId, accountId);
    if (account.kind !== "FUNDED" || account.status !== "ACTIVE" || account.currentMinute == null) throw new SimError("Payouts are available on an active funded account.");
    const rules = parseRules(account.rules);
    if (!rules.payout) throw new SimError("This account has no payout terms.");
    const state = ruleStateOf(account, rules.dailyResetHour);
    const balance = await currentBalance(tx, account.id, account.ledgerSequence);
    const { last, evaluation } = await payoutContext(tx, account, state, balance);
    if (!evaluation.eligible) throw new SimError(evaluation.reasons[0]);
    const sequence = (last?.sequence ?? 0) + 1;
    await appendLedger(tx, account, [{ type: "PAYOUT_WITHDRAWAL", amount: evaluation.grossPayout.negated(), idempotencyKey: `payout:${sequence}`, minute: account.currentMinute, note: `Payout ${sequence}: trader ${evaluation.traderShare.toFixed(2)}, firm ${evaluation.firmShare.toFixed(2)}` }]);
    const payout = await tx.simPayout.create({
      data: {
        userId,
        accountId: account.id,
        sequence,
        minute: account.currentMinute,
        eligibleProfit: evaluation.eligibleProfit.toFixed(2),
        grossPayout: evaluation.grossPayout.toFixed(2),
        traderShare: evaluation.traderShare.toFixed(2),
        firmShare: evaluation.firmShare.toFixed(2),
        splitPercent: rules.payout.profitSplitPercent,
        balanceBefore: balance.toFixed(2),
        balanceAfter: evaluation.balanceAfter.toFixed(2),
      },
    });
    // A withdrawal lowers the account, so a trailing high-water moves down with it (otherwise the
    // payout itself would breach a trailing floor). Consistency restarts with the new cycle.
    const newHigh = dec(state.highWater).minus(evaluation.grossPayout);
    state.highWater = (newHigh.lessThan(state.phaseStartBalance) ? dec(state.phaseStartBalance) : newHigh).toFixed(2);
    state.lastBalance = evaluation.balanceAfter.toFixed(2);
    state.dayStartBalance = dec(state.dayStartBalance).minus(evaluation.grossPayout).toFixed(2);
    state.dayProfit = {};
    await tx.simAccount.update({ where: { id: account.id }, data: { ruleState: state as unknown as Prisma.InputJsonValue } });
    await tx.simEvent.create({ data: { userId, accountId: account.id, type: "PAYOUT", minute: account.currentMinute, data: { payoutId: payout.id, gross: evaluation.grossPayout.toFixed(2), trader: evaluation.traderShare.toFixed(2), firm: evaluation.firmShare.toFixed(2) } } });
    return payout;
  });
}

/** Records the trading day of a market-order fill on a prop account (pending fills are counted by the hook). */
export async function notePropTradingDay(tx: TransactionClient, account: SimAccount): Promise<void> {
  if (account.product !== "PROP_FIRM" || account.currentMinute == null) return;
  const rules = parseRules(account.rules);
  const state = ruleStateOf(account, rules.dailyResetHour);
  const day = tradingDayOf(account.currentMinute, rules.dailyResetHour);
  if (state.tradingDays.includes(day)) return;
  state.tradingDays.push(day);
  await tx.simAccount.update({ where: { id: account.id }, data: { ruleState: state as unknown as Prisma.InputJsonValue } });
}

// ── Overview & history ──────────────────────────────────────────────────────

export interface ChallengeSummaryDTO {
  id: string;
  firmName: string;
  modelName: string;
  modelVersion: number;
  accountSize: string;
  fee: string;
  currency: string;
  status: SimChallenge["status"];
  purchasedAt: string;
  stages: { accountId: string; name: string; kind: SimAccount["kind"]; status: SimAccount["status"]; startingBalance: string; balance: string; statusReason: string | null; clock: string | null }[];
  totalStages: number;
  payouts: { count: number; trader: string; firm: string };
  breach: { rule: string; time: string; detail: string; measured: string; floor: string | null; balance: string; equity: string; floatingInvolved: boolean; contributors: { symbol: string; side: string; pnl: string; open: boolean }[] } | null;
  daysToFund: number | null;
  fundedDays: number | null;
}

export interface PropOverviewDTO {
  challenges: ChallengeSummaryDTO[];
  totals: {
    purchased: number;
    funded: number;
    failed: number;
    breached: number;
    inEvaluation: number;
    passRate: number | null;
    phaseCompletionRate: number | null;
    fees: string;
    payoutsTrader: string;
    payoutsFirm: string;
    avgDaysToFund: number | null;
    avgFundedLifespanDays: number | null;
    netSimulated: string;
  };
  breachesByRule: { rule: string; count: number }[];
  byModel: { model: string; purchased: number; funded: number; passRate: number | null }[];
}

export async function getPropOverview(userId: string): Promise<PropOverviewDTO> {
  const challenges = await prisma.simChallenge.findMany({
    where: { userId },
    include: { accounts: { orderBy: { phaseIndex: "asc" }, include: { breach: true, payouts: true } } },
    orderBy: { purchasedAt: "desc" },
  });
  const accountIds = challenges.flatMap((c) => c.accounts.map((a) => a.id));
  const balances = accountIds.length
    ? await prisma.$queryRaw<{ accountId: string; balance: string }[]>`
        SELECT DISTINCT ON ("accountId") "accountId", "balanceAfter"::text AS balance FROM "SimLedgerEntry"
        WHERE "accountId" = ANY(${accountIds}::text[]) AND "userId" = ${userId} ORDER BY "accountId", "sequence" DESC`
    : [];
  const balanceOf = new Map(balances.map((b) => [b.accountId, b.balance]));
  const dayOf = (m: number | null) => (m == null ? null : Math.floor(m / 1440));

  const summaries: ChallengeSummaryDTO[] = challenges.map((c) => {
    const model = firmModelSchema.parse(c.definitionSnapshot);
    const breached = c.accounts.find((a) => a.breach);
    const funded = c.accounts.find((a) => a.kind === "FUNDED");
    const first = c.accounts[0];
    const firstDay = first ? dayOf(first.ruleState ? (first.ruleState as unknown as RuleState).firstDay * 1440 : first.currentMinute) : null;
    const fundedDay = funded ? dayOf(funded.periodStart.getTime() / 60000) : null;
    const payouts = c.accounts.flatMap((a) => a.payouts);
    const b = breached?.breach ?? null;
    return {
      id: c.id,
      firmName: c.firmName,
      modelName: c.modelName,
      modelVersion: c.modelVersion,
      accountSize: c.accountSize.toFixed(2),
      fee: c.fee.toFixed(2),
      currency: c.currency,
      status: c.status,
      purchasedAt: c.purchasedAt.toISOString(),
      stages: c.accounts.map((a) => ({
        accountId: a.id,
        name: stageName(model, a.phaseIndex ?? 0),
        kind: a.kind,
        status: a.status,
        startingBalance: a.startingBalance.toFixed(2),
        balance: balanceOf.get(a.id) ?? a.startingBalance.toFixed(2),
        statusReason: a.statusReason,
        clock: a.currentMinute == null ? null : formatWallClock(a.currentMinute),
      })),
      totalStages: stageCount(model),
      payouts: {
        count: payouts.length,
        trader: payouts.reduce((s, p) => s.plus(p.traderShare.toString()), dec(0)).toFixed(2),
        firm: payouts.reduce((s, p) => s.plus(p.firmShare.toString()), dec(0)).toFixed(2),
      },
      breach: b && {
        rule: b.rule,
        time: formatWallClock(b.minute),
        detail: b.detail,
        measured: b.measured.toFixed(2),
        floor: b.floor?.toFixed(2) ?? null,
        balance: b.balance.toFixed(2),
        equity: b.equity.toFixed(2),
        floatingInvolved: b.floatingInvolved,
        contributors: (b.contributors as { symbol: string; side: string; pnl: string; open: boolean }[]) ?? [],
      },
      daysToFund: funded && model.phases.length > 0 && firstDay != null && fundedDay != null ? Math.max(0, fundedDay - firstDay) : null,
      fundedDays: funded && funded.currentMinute != null && fundedDay != null ? Math.max(0, dayOf(funded.currentMinute)! - fundedDay) : null,
    };
  });

  const decided = summaries.filter((s) => s.status !== "IN_EVALUATION");
  const fundedCount = summaries.filter((s) => s.status === "FUNDED" || s.stages.some((x) => x.kind === "FUNDED")).length;
  const phaseAttempts = summaries.flatMap((s) => s.stages.filter((x) => x.kind === "EVALUATION"));
  const phaseDone = phaseAttempts.filter((x) => x.status !== "ACTIVE" && x.status !== "CREATED");
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const fees = summaries.reduce((s, c) => s.plus(c.fee), dec(0));
  const trader = summaries.reduce((s, c) => s.plus(c.payouts.trader), dec(0));
  const firm = summaries.reduce((s, c) => s.plus(c.payouts.firm), dec(0));
  const rules = new Map<string, number>();
  for (const s of summaries) if (s.breach) rules.set(s.breach.rule, (rules.get(s.breach.rule) ?? 0) + 1);
  const models = new Map<string, { purchased: number; funded: number; decided: number }>();
  for (const s of summaries) {
    const k = `${s.firmName} · ${s.modelName}`;
    const m = models.get(k) ?? { purchased: 0, funded: 0, decided: 0 };
    m.purchased += 1;
    if (s.stages.some((x) => x.kind === "FUNDED")) m.funded += 1;
    if (s.status !== "IN_EVALUATION") m.decided += 1;
    models.set(k, m);
  }
  return {
    challenges: summaries,
    totals: {
      purchased: summaries.length,
      funded: fundedCount,
      failed: summaries.filter((s) => s.status === "FAILED").length,
      breached: summaries.filter((s) => s.status === "BREACHED").length,
      inEvaluation: summaries.filter((s) => s.status === "IN_EVALUATION").length,
      passRate: decided.length ? (decided.filter((s) => s.stages.some((x) => x.kind === "FUNDED")).length / decided.length) * 100 : null,
      phaseCompletionRate: phaseDone.length ? (phaseDone.filter((x) => x.status === "PASSED").length / phaseDone.length) * 100 : null,
      fees: fees.toFixed(2),
      payoutsTrader: trader.toFixed(2),
      payoutsFirm: firm.toFixed(2),
      avgDaysToFund: mean(summaries.map((s) => s.daysToFund).filter((x): x is number => x != null)),
      avgFundedLifespanDays: mean(summaries.map((s) => s.fundedDays).filter((x): x is number => x != null)),
      netSimulated: trader.minus(fees).toFixed(2),
    },
    breachesByRule: [...rules.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
    byModel: [...models.entries()].map(([model, m]) => ({ model, purchased: m.purchased, funded: m.funded, passRate: m.decided ? (m.funded / m.decided) * 100 : null })),
  };
}
