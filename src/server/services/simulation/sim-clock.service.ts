/**
 * The continuous simulation clock (docs/SIMULATION_PLATFORM.md §2, §5).
 *
 * One world time per account, spanning its whole period: positions can be
 * held overnight and the clock crosses daily resets and weekends. It only
 * moves forward (service + DB trigger), and every move is one transaction
 * under the account's row lock that ALSO settles everything the move reveals:
 * pending orders that trigger, stops and targets that fill, swaps at the
 * daily rollover, order expiries. The browser can only ask the clock to move;
 * it never supplies a cutoff, and the account's market data is never read
 * past the clock.
 *
 * Rule hook: a prop-firm account supplies a per-minute evaluator (Phase 5)
 * that can HALT the step at a breach minute; Strategy Lab accounts have none.
 */
import { randomUUID } from "node:crypto";
import type { Decimal } from "decimal.js";
import type { SimAccount } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { dec } from "@/domain/execution/precision";
import { runStep, type EngineOrder, type EnginePosition, type MinuteSnapshot, type StepResult } from "@/domain/simulation/engine";
import { isReplayTimeframe } from "@/domain/native-replay/timeframes";
import { accountRules, lockAccount, SimError } from "./sim-account.service";
import { appendLedger, currentBalance } from "./sim-ledger";
import { accountFeeds, loadStepBars, MAX_STEP_BARS, periodMinutes, targetMinute, type ClockCommand } from "./sim-market";

/** Per-minute rule evaluation supplied by a product (prop firm). */
export interface StepRuleHook {
  onMinute: (snapshot: MinuteSnapshot) => "HALT" | void;
  /** Persists what the evaluation concluded (breach, pass, day stats) after the step's trading writes. */
  finalize: (tx: TransactionClient, result: StepResult) => Promise<void>;
}

type RuleHookFactory = (tx: TransactionClient, account: SimAccount, balance: Decimal) => Promise<StepRuleHook | null>;
const ruleHookFactories: RuleHookFactory[] = [];

/** Registers a product's rule hook factory (called once at module load by that product). */
export function registerRuleHook(factory: RuleHookFactory): void {
  ruleHookFactories.push(factory);
}

export interface AdvanceOutcome {
  moved: boolean;
  duplicate: boolean;
  fromMinute: number;
  toMinute: number;
  halted: boolean;
  filledOrders: number;
  closedPositions: number;
  atPeriodEnd: boolean;
}

function validate(command: ClockCommand): void {
  if (command.kind === "BARS" && (!Number.isInteger(command.count) || command.count < 1 || command.count > MAX_STEP_BARS)) {
    throw new SimError(`Step between 1 and ${MAX_STEP_BARS} bars.`);
  }
  if (command.kind === "CANDLE" && !isReplayTimeframe(command.timeframe)) throw new SimError("Unknown timeframe.");
  if (command.kind === "SEEK" && !Number.isInteger(command.to)) throw new SimError("Invalid time.");
}

export async function advanceSimClock(userId: string, accountId: string, command: ClockCommand, commandId?: string | null): Promise<AdvanceOutcome> {
  validate(command);
  return prisma.$transaction(
    async (tx) => {
      const account = await lockAccount(tx, userId, accountId);
      const cur = account.currentMinute;
      if (cur == null) throw new SimError("Start the replay first.");
      const recent = (account.recentCommands as string[] | null) ?? [];
      if (commandId && recent.includes(commandId)) {
        return { moved: false, duplicate: true, fromMinute: cur, toMinute: cur, halted: false, filledOrders: 0, closedPositions: 0, atPeriodEnd: false };
      }
      if (account.status !== "ACTIVE") throw new SimError(`This account is ${account.status.toLowerCase()} — its replay can be viewed but not advanced.`);
      if (command.kind === "SEEK" && command.to < cur) throw new SimError("Replay only moves forward — scroll the chart back to review what's already revealed.");

      const rules = accountRules(account);
      const feeds = await accountFeeds(tx, account.id);
      const period = periodMinutes(account);
      const target = await targetMinute(tx, feeds, cur, command, period.to, rules.dailyResetHour);
      const noMove = { moved: false, duplicate: false, fromMinute: cur, toMinute: cur, halted: false, filledOrders: 0, closedPositions: 0 };
      if (target == null || target <= cur) return { ...noMove, atPeriodEnd: true };

      const { bars, timeline } = await loadStepBars(tx, feeds, cur, target);
      const [openPositions, pendingOrders, balance] = await Promise.all([
        tx.simPosition.findMany({ where: { accountId: account.id, status: "OPEN" } }),
        tx.simOrder.findMany({ where: { accountId: account.id, status: "PENDING" } }),
        currentBalance(tx, account.id, account.ledgerSequence),
      ]);
      const positions: EnginePosition[] = openPositions.map((p) => ({
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        quantity: p.remainingQuantity.toString(),
        entryPoints: p.entryPoints,
        stopLoss: p.stopLoss,
        takeProfit: p.takeProfit,
        valuePerPriceUnit: p.valuePerPriceUnit.toString(),
        priceScale: p.priceScale,
        openedMinute: p.openedMinute,
      }));
      const orders: EngineOrder[] = pendingOrders.map((o) => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type === "STOP" ? "STOP" : "LIMIT",
        pricePoints: o.pricePoints!,
        quantity: o.quantity.toString(),
        stopLoss: o.stopLoss,
        takeProfit: o.takeProfit,
        valuePerPriceUnit: o.valuePerPriceUnit.toString(),
        priceScale: o.priceScale,
        expiresMinute: o.expiresMinute,
      }));

      let hook: StepRuleHook | null = null;
      for (const factory of ruleHookFactories) hook = hook ?? (await factory(tx, account, balance));

      const result = runStep({
        fromMinute: cur,
        timeline,
        bars,
        positions,
        orders,
        balance,
        costs: rules.costs,
        dailyResetHour: rules.dailyResetHour,
        newPositionId: () => `sp_${randomUUID().replace(/-/g, "")}`,
        onMinute: hook?.onMinute,
      });

      await persistStep(tx, account, result, { pendingOrders, openPositions });
      if (hook) await hook.finalize(tx, result);

      await tx.simAccount.update({
        where: { id: account.id },
        data: {
          currentMinute: result.endMinute,
          clockVersion: { increment: 1 },
          ...(commandId ? { recentCommands: [...recent, commandId].slice(-64) } : {}),
        },
      });
      const filled = result.events.filter((e) => e.kind === "ORDER_FILLED").length;
      const closed = result.events.filter((e) => e.kind === "POSITION_CLOSED").length;
      return {
        moved: result.endMinute > cur,
        duplicate: false,
        fromMinute: cur,
        toMinute: result.endMinute,
        halted: result.halted,
        filledOrders: filled,
        closedPositions: closed,
        atPeriodEnd: result.endMinute >= period.to || (!result.halted && target >= period.to),
      };
    },
    { timeout: 60_000 },
  );
}

type PendingRow = Awaited<ReturnType<TransactionClient["simOrder"]["findMany"]>>[number];
type PositionRow = Awaited<ReturnType<TransactionClient["simPosition"]["findMany"]>>[number];

/** Writes one step's outcome: orders, positions, fills, ledger, events. */
async function persistStep(
  tx: TransactionClient,
  account: SimAccount,
  result: StepResult,
  before: { pendingOrders: PendingRow[]; openPositions: PositionRow[] },
): Promise<void> {
  const userId = account.userId;
  const orderById = new Map(before.pendingOrders.map((o) => [o.id, o]));
  const positionById = new Map(before.openPositions.map((p) => [p.id, p]));
  const ledgerByPosition = new Map<string, { commission: Decimal; swap: Decimal }>();
  for (const l of result.ledger) {
    if (!l.positionId) continue;
    const agg = ledgerByPosition.get(l.positionId) ?? { commission: dec(0), swap: dec(0) };
    if (l.type === "COMMISSION") agg.commission = agg.commission.plus(l.amount);
    if (l.type === "SWAP") agg.swap = agg.swap.plus(l.amount);
    ledgerByPosition.set(l.positionId, agg);
  }

  // 1 · pending orders that filled → positions + OPEN fills (in event order).
  for (const e of result.events) {
    if (e.kind === "ORDER_FILLED") {
      const o = orderById.get(e.orderId)!;
      await tx.simPosition.create({
        data: {
          id: e.positionId,
          userId,
          accountId: account.id,
          orderId: o.id,
          symbol: o.symbol,
          side: o.side,
          quantity: o.quantity.toString(),
          remainingQuantity: o.quantity.toString(),
          priceScale: o.priceScale,
          entryPoints: e.price,
          stopLoss: o.stopLoss,
          takeProfit: o.takeProfit,
          initialStopLoss: o.stopLoss,
          intendedRisk: o.intendedRisk?.toString() ?? null,
          valuePerPriceUnit: o.valuePerPriceUnit.toString(),
          conversionRate: o.conversionRate.toString(),
          specSnapshot: o.specSnapshot ?? {},
          openedMinute: e.minute,
          note: o.note,
        },
      });
      await tx.simOrder.update({ where: { id: o.id }, data: { status: "FILLED", resolvedMinute: e.minute, positionId: e.positionId } });
      const openCommission = result.ledger.find((l) => l.idempotencyKey === `commission-open:${e.positionId}`)?.amount ?? dec(0);
      await tx.simFill.create({
        data: {
          userId, accountId: account.id, positionId: e.positionId, sequence: 1, kind: "OPEN", reason: "PENDING_TRIGGERED",
          minute: e.minute, pricePoints: e.price, quantity: o.quantity.toString(), commission: openCommission.toFixed(2), gapped: e.gapped,
        },
      });
      await tx.simEvent.create({ data: { userId, accountId: account.id, type: "ORDER_FILLED", minute: e.minute, data: { orderId: o.id, positionId: e.positionId, price: e.price, gapped: e.gapped } } });
    } else if (e.kind === "ORDER_EXPIRED") {
      await tx.simOrder.update({ where: { id: e.orderId }, data: { status: "EXPIRED", resolvedMinute: e.minute } });
      await tx.simEvent.create({ data: { userId, accountId: account.id, type: "ORDER_EXPIRED", minute: e.minute, data: { orderId: e.orderId } } });
    }
  }

  // 2 · exits → CLOSE fills + position projections.
  for (const e of result.events) {
    if (e.kind !== "POSITION_CLOSED") continue;
    const existing = positionById.get(e.positionId);
    const priorFills = existing ? await tx.simFill.count({ where: { positionId: e.positionId } }) : 1;
    const qty = existing ? existing.remainingQuantity.toString() : (await tx.simPosition.findUniqueOrThrow({ where: { id: e.positionId } })).remainingQuantity.toString();
    await tx.simFill.create({
      data: {
        userId, accountId: account.id, positionId: e.positionId, sequence: priorFills + 1, kind: "CLOSE", reason: e.reason,
        minute: e.minute, pricePoints: e.price, quantity: qty, grossPnl: e.grossPnl.toFixed(2), commission: e.commission.toFixed(2),
        gapped: e.gapped, ambiguous: e.ambiguous,
      },
    });
    const prev = existing ?? (await tx.simPosition.findUniqueOrThrow({ where: { id: e.positionId } }));
    const agg = ledgerByPosition.get(e.positionId);
    await tx.simPosition.update({
      where: { id: e.positionId },
      data: {
        status: "CLOSED",
        remainingQuantity: "0",
        closedMinute: e.minute,
        closeReason: e.reason,
        ambiguousExit: e.ambiguous,
        realizedPnl: dec(prev.realizedPnl.toString()).plus(e.grossPnl).toFixed(2),
        commissions: dec(prev.commissions.toString()).plus(agg?.commission ?? 0).toFixed(2),
        swaps: dec(prev.swaps.toString()).plus(agg?.swap ?? 0).toFixed(2),
      },
    });
    ledgerByPosition.delete(e.positionId);
    await tx.simEvent.create({
      data: { userId, accountId: account.id, type: "POSITION_CLOSED", minute: e.minute, data: { positionId: e.positionId, reason: e.reason, price: e.price, pnl: e.grossPnl.toFixed(2), ambiguous: e.ambiguous } },
    });
  }

  // 3 · swaps on positions still open (and commissions on fills that stayed open).
  for (const [positionId, agg] of ledgerByPosition) {
    const p = await tx.simPosition.findUnique({ where: { id: positionId } });
    if (!p) continue;
    await tx.simPosition.update({
      where: { id: positionId },
      data: { swaps: dec(p.swaps.toString()).plus(agg.swap).toFixed(2), commissions: dec(p.commissions.toString()).plus(agg.commission).toFixed(2) },
    });
  }

  // 4 · money, in the engine's order.
  const minuteByKey = new Map<string, number>();
  for (const e of result.events) {
    if (e.kind === "POSITION_CLOSED") minuteByKey.set(`close:${e.positionId}`, e.minute);
    if (e.kind === "ORDER_FILLED") minuteByKey.set(`commission-open:${e.positionId}`, e.minute);
  }
  const rolloverMinuteByDay = new Map<number, number>();
  for (const e of result.events) if (e.kind === "DAY_ROLLOVER") rolloverMinuteByDay.set(e.toDay, e.minute);
  for (const l of result.ledger) {
    const m = /^swap:.+:(-?\d+)$/.exec(l.idempotencyKey);
    if (m) minuteByKey.set(l.idempotencyKey, rolloverMinuteByDay.get(Number(m[1])) ?? result.endMinute);
  }
  await appendLedger(
    tx,
    account,
    result.ledger.map((l) => ({
      type: l.type,
      amount: l.amount,
      idempotencyKey: l.idempotencyKey,
      positionId: l.positionId,
      minute: minuteByKey.get(l.idempotencyKey) ?? minuteByKey.get(l.idempotencyKey.replace("commission-close:", "close:")) ?? result.endMinute,
    })),
  );

  const rollovers = result.events.filter((e) => e.kind === "DAY_ROLLOVER");
  if (rollovers.length > 0) {
    await tx.simEvent.createMany({ data: rollovers.map((e) => ({ userId, accountId: account.id, type: "DAY_ROLLOVER", minute: e.minute, data: { day: e.kind === "DAY_ROLLOVER" ? e.toDay : null } })) });
  }
}
