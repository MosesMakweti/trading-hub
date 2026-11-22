/**
 * Simulated execution at the account's current replay minute.
 *
 * The browser sends intentions only (side, type, levels, how to size). Every
 * price, quantity, conversion and money amount is derived here from the
 * account's own bars at its clock — never from the request. Each operation is
 * one transaction under the account's row lock; orders carry a browser
 * `clientRequestId` and other commands a `commandId`, so a retried request
 * returns instead of acting twice.
 */
import type { Decimal } from "decimal.js";
import type { Prisma, SimAccount, SimPosition } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { computeValuePerPriceUnit, dec, isMultipleOf, quantityForPercentOfRemaining, sizePosition, toSpecSnapshot } from "@/domain/execution";
import { effectiveSpread, markPrice, marketFillPrice, pendingPriceError, protectiveLevelError, type SimSide } from "@/domain/simulation/market";
import { commissionFor, grossPnl, pointsToPrice, priceToPoints, resolveConversion } from "@/domain/simulation/money";
import { resolveSpecForUser } from "@/server/services/instrument-spec.service";
import { accountRules, assertTradable, lockAccount, SimError } from "./sim-account.service";
import { appendLedger, currentBalance } from "./sim-ledger";
import { accountFeeds, latestBars, type SimFeed } from "./sim-market";
import { notePropTradingDay } from "./sim-prop.service";

export type SizingRequest =
  | { mode: "QUANTITY"; quantity: string }
  | { mode: "RISK_PERCENT"; riskPercent: number }
  | { mode: "RISK_AMOUNT"; amount: number };

export interface OrderRequest {
  symbol: string;
  side: SimSide;
  type: "MARKET" | "LIMIT" | "STOP";
  /** Pending orders only. */
  price?: string | null;
  stopLoss?: string | null;
  takeProfit?: string | null;
  sizing: SizingRequest;
  expiresMinute?: number | null;
  clientRequestId?: string | null;
  note?: string | null;
}

export interface OrderOutcome {
  orderId: string;
  positionId: string | null;
  status: "FILLED" | "PENDING";
  duplicate: boolean;
}

const RECENT_COMMANDS = 64;

/** Has this command id already been applied to the account? Records it if not. */
async function claimCommand(tx: TransactionClient, account: SimAccount, commandId: string | null | undefined): Promise<boolean> {
  if (!commandId) return false;
  const recent = (account.recentCommands as string[] | null) ?? [];
  if (recent.includes(commandId)) return true;
  await tx.simAccount.update({ where: { id: account.id }, data: { recentCommands: [...recent, commandId].slice(-RECENT_COMMANDS) } });
  return false;
}

interface Quote {
  feed: SimFeed;
  bid: number;
  ask: number;
  spread: number;
}

async function quoteFor(tx: TransactionClient, account: SimAccount, symbol: string): Promise<{ quote: Quote; prices: Map<string, Decimal> }> {
  const feeds = await accountFeeds(tx, account.id);
  const feed = feeds.find((f) => f.symbol === symbol);
  if (!feed) throw new SimError(`${symbol} isn't one of this account's instruments.`);
  const bars = await latestBars(tx, feeds, account.currentMinute!);
  const bar = bars.get(symbol);
  if (!bar) throw new SimError(`${symbol} has no price yet at this replay time.`);
  const rules = accountRules(account);
  const spread = effectiveSpread(bar, rules.costs.defaultSpreadPoints);
  const prices = new Map<string, Decimal>();
  for (const f of feeds) {
    const b = bars.get(f.symbol);
    if (b) prices.set(f.symbol, pointsToPrice(b.close, f.priceScale));
  }
  return { quote: { feed, bid: bar.close, ask: bar.close + spread, spread }, prices };
}

function toPoints(label: string, value: string | null | undefined, scale: number): number | null {
  if (value == null || value === "") return null;
  const points = priceToPoints(value, scale);
  if (points == null) throw new SimError(`${label} must be a positive price with at most ${scale} decimals.`);
  return points;
}

export async function placeOrder(userId: string, accountId: string, req: OrderRequest): Promise<OrderOutcome> {
  return prisma.$transaction(async (tx) => {
    const account = await lockAccount(tx, userId, accountId);
    if (req.clientRequestId) {
      const existing = await tx.simOrder.findUnique({ where: { accountId_clientRequestId: { accountId: account.id, clientRequestId: req.clientRequestId } } });
      if (existing) return { orderId: existing.id, positionId: existing.positionId, status: existing.status === "FILLED" ? "FILLED" : "PENDING", duplicate: true };
    }
    assertTradable(account);
    const rules = accountRules(account);
    const symbol = req.symbol.trim().toUpperCase();
    const allowed = rules.allowedSymbols ?? account.assets;
    if (!allowed.includes(symbol)) throw new SimError(`${symbol} can't be traded on this account.`);

    const { quote, prices } = await quoteFor(tx, account, symbol);
    const scale = quote.feed.priceScale;
    const minute = account.currentMinute!;

    let entryRef: number;
    if (req.type === "MARKET") {
      entryRef = req.side === "BUY" ? quote.ask : quote.bid;
    } else {
      const p = toPoints("The order price", req.price, scale);
      if (p == null) throw new SimError("A pending order needs a price.");
      const err = pendingPriceError(req.side, req.type, p, quote.bid, quote.ask);
      if (err) throw new SimError(err);
      entryRef = p;
    }
    const stopLoss = toPoints("The stop loss", req.stopLoss, scale);
    const takeProfit = toPoints("The take profit", req.takeProfit, scale);
    const levelErr = protectiveLevelError(req.side, entryRef, stopLoss, takeProfit);
    if (levelErr) throw new SimError(levelErr);
    if (req.expiresMinute != null && (req.type === "MARKET" || req.expiresMinute <= minute)) throw new SimError("An expiry must be a later replay time on a pending order.");

    // Instrument economics + currency conversion (replay prices only, D8).
    const resolution = await resolveSpecForUser(userId, symbol, tx);
    if (resolution.status !== "RESOLVED") {
      throw new SimError(`${symbol}'s contract details are incomplete (${[...resolution.missing, ...resolution.invalid].join(", ")}). Add them under instrument settings.`);
    }
    const spec = resolution.spec;
    const conversion = resolveConversion({ symbol, quoteCurrency: spec.quoteCurrency, accountCurrency: account.currency, priceOf: (s) => prices.get(s) ?? null });
    if (conversion.status !== "OK") throw new SimError(conversion.reason);
    const value = computeValuePerPriceUnit(spec, account.currency, { from: spec.quoteCurrency, to: account.currency, rate: conversion.rate });
    if (value.status !== "OK") throw new SimError(value.reason);
    const vpu = value.accountValuePerPriceUnit;

    // Sizing.
    const balance = await currentBalance(tx, account.id, account.ledgerSequence);
    let quantity: Decimal;
    let intendedRisk: Decimal | null = null;
    let riskPercent: Decimal | null = null;
    if (req.sizing.mode === "QUANTITY") {
      quantity = dec(req.sizing.quantity);
      if (!quantity.isFinite() || !quantity.greaterThan(0)) throw new SimError("Enter a quantity greater than zero.");
      if (!isMultipleOf(quantity, spec.quantityStep)) throw new SimError(`Quantity must be a multiple of ${spec.quantityStep.toString()}.`);
      if (quantity.lessThan(spec.minQuantity)) throw new SimError(`The minimum quantity is ${spec.minQuantity.toString()}.`);
      if (spec.maxQuantity && quantity.greaterThan(spec.maxQuantity)) throw new SimError(`The maximum quantity is ${spec.maxQuantity.toString()}.`);
      if (stopLoss != null) {
        intendedRisk = pointsToPrice(Math.abs(entryRef - stopLoss), scale).times(quantity).times(vpu).toDecimalPlaces(2);
      }
    } else {
      if (stopLoss == null) throw new SimError("Sizing by risk needs a stop loss.");
      riskPercent =
        req.sizing.mode === "RISK_PERCENT" ? dec(req.sizing.riskPercent) : dec(req.sizing.amount).dividedBy(balance).times(100);
      const sized = sizePosition({
        direction: req.side === "BUY" ? "LONG" : "SHORT",
        balanceBasis: balance,
        riskPercent,
        entry: pointsToPrice(entryRef, scale),
        initialStop: pointsToPrice(stopLoss, scale),
        spec,
        accountValuePerPriceUnit: vpu,
      });
      if (sized.status === "INVALID") throw new SimError(sized.reason);
      if (sized.status === "CANNOT_SIZE_WITHIN_RISK") {
        throw new SimError(`That risk is too small for the minimum quantity (it would risk ${sized.riskAtMinQuantity.toFixed(2)} ${account.currency}).`);
      }
      quantity = sized.executableQuantity;
      intendedRisk = sized.intendedRiskAmount;
    }

    // Account limits (Prop Firm rule snapshot; null on lab accounts).
    if (rules.limits.maxQuantityPerPosition != null && quantity.greaterThan(rules.limits.maxQuantityPerPosition)) {
      throw new SimError(`This account allows at most ${rules.limits.maxQuantityPerPosition} per position.`);
    }
    if (rules.limits.maxOpenPositions != null) {
      const open = await tx.simPosition.count({ where: { accountId: account.id, status: "OPEN" } });
      const pending = await tx.simOrder.count({ where: { accountId: account.id, status: "PENDING" } });
      if (open + pending >= rules.limits.maxOpenPositions) throw new SimError(`This account allows at most ${rules.limits.maxOpenPositions} open positions and orders.`);
    }
    if (rules.limits.maxRiskPercentPerTrade != null) {
      if (stopLoss == null) throw new SimError("This account requires a stop loss on every position.");
      const riskPct = intendedRisk!.dividedBy(balance).times(100);
      if (riskPct.greaterThan(rules.limits.maxRiskPercentPerTrade)) {
        throw new SimError(`This position risks ${riskPct.toFixed(2)}% — the account allows ${rules.limits.maxRiskPercentPerTrade}% per trade.`);
      }
    }

    const specSnapshot = toSpecSnapshot(spec) as unknown as Prisma.InputJsonValue;
    const common = {
      userId,
      accountId: account.id,
      symbol,
      side: req.side,
      stopLoss,
      takeProfit,
      priceScale: scale,
      quantity: quantity.toFixed(),
      riskPercent: riskPercent?.toDecimalPlaces(3).toFixed() ?? null,
      intendedRisk: intendedRisk?.toFixed(2) ?? null,
      valuePerPriceUnit: vpu.toFixed(),
      conversionRate: conversion.rate.toDecimalPlaces(12).toFixed(),
      specSnapshot,
      placedMinute: minute,
      clientRequestId: req.clientRequestId ?? null,
      note: req.note ?? null,
    };

    if (req.type !== "MARKET") {
      const order = await tx.simOrder.create({ data: { ...common, type: req.type, status: "PENDING", pricePoints: entryRef, expiresMinute: req.expiresMinute ?? null } });
      await tx.simEvent.create({ data: { userId, accountId: account.id, type: "ORDER_PLACED", minute, data: { orderId: order.id, symbol, side: req.side, type: req.type } } });
      return { orderId: order.id, positionId: null, status: "PENDING", duplicate: false };
    }

    const fillPrice = marketFillPrice(req.side, { minute, open: quote.bid, high: quote.bid, low: quote.bid, close: quote.bid, spread: quote.spread }, quote.spread);
    const order = await tx.simOrder.create({ data: { ...common, type: "MARKET", status: "FILLED", pricePoints: fillPrice, resolvedMinute: minute } });
    const position = await tx.simPosition.create({
      data: {
        userId,
        accountId: account.id,
        orderId: order.id,
        symbol,
        side: req.side,
        quantity: quantity.toFixed(),
        remainingQuantity: quantity.toFixed(),
        priceScale: scale,
        entryPoints: fillPrice,
        stopLoss,
        takeProfit,
        initialStopLoss: stopLoss,
        intendedRisk: intendedRisk?.toFixed(2) ?? null,
        valuePerPriceUnit: vpu.toFixed(),
        conversionRate: conversion.rate.toDecimalPlaces(12).toFixed(),
        specSnapshot,
        openedMinute: minute,
        note: req.note ?? null,
      },
    });
    await tx.simOrder.update({ where: { id: order.id }, data: { positionId: position.id } });
    const commission = commissionFor(quantity, rules.costs.commissionPerUnitPerSide);
    await tx.simFill.create({
      data: { userId, accountId: account.id, positionId: position.id, sequence: 1, kind: "OPEN", reason: "MARKET", minute, pricePoints: fillPrice, quantity: quantity.toFixed(), commission: commission.toFixed(2) },
    });
    if (!commission.isZero()) {
      await appendLedger(tx, account, [{ type: "COMMISSION", amount: commission, idempotencyKey: `commission-open:${position.id}`, positionId: position.id, minute }]);
      await tx.simPosition.update({ where: { id: position.id }, data: { commissions: commission.toFixed(2) } });
    }
    await tx.simEvent.create({ data: { userId, accountId: account.id, type: "POSITION_OPENED", minute, data: { positionId: position.id, symbol, side: req.side, quantity: quantity.toFixed() } } });
    await notePropTradingDay(tx, account);
    return { orderId: order.id, positionId: position.id, status: "FILLED", duplicate: false };
  });
}

async function requireOpenPosition(tx: TransactionClient, account: SimAccount, positionId: string): Promise<SimPosition> {
  const position = await tx.simPosition.findFirst({ where: { id: positionId, accountId: account.id } });
  if (!position) throw new SimError("Position not found.");
  if (position.status !== "OPEN") throw new SimError("That position is already closed.");
  return position;
}

/**
 * Closes all or part of a position at the current market (bid for longs, ask
 * for shorts). `percent` is of the REMAINING quantity, quantized down to the
 * instrument step; a residual below the minimum is absorbed into the close.
 */
export async function closePosition(
  userId: string,
  accountId: string,
  positionId: string,
  request: { percent?: number | null; commandId?: string | null },
): Promise<{ closedQuantity: string; remainingQuantity: string; realizedPnl: string; duplicate: boolean }> {
  return prisma.$transaction(async (tx) => {
    const account = await lockAccount(tx, userId, accountId);
    if (await claimCommand(tx, account, request.commandId)) {
      const p = await tx.simPosition.findFirstOrThrow({ where: { id: positionId, accountId: account.id } });
      return { closedQuantity: "0", remainingQuantity: p.remainingQuantity.toString(), realizedPnl: p.realizedPnl.toString(), duplicate: true };
    }
    assertTradable(account);
    const position = await requireOpenPosition(tx, account, positionId);
    const rules = accountRules(account);
    const { quote } = await quoteFor(tx, account, position.symbol);
    const remaining = dec(position.remainingQuantity.toString());
    const spec = position.specSnapshot as { quantityStep: string; minQuantity: string };
    let closeQty = remaining;
    if (request.percent != null && request.percent < 100) {
      const plan = quantityForPercentOfRemaining({ remainingQuantity: remaining, percentOfRemaining: request.percent, quantityStep: spec.quantityStep, minQuantity: spec.minQuantity });
      if (plan.status !== "OK") throw new SimError(plan.reason);
      closeQty = plan.closeQuantity;
    }
    const minute = account.currentMinute!;
    const price = markPrice(position.side, { minute, open: quote.bid, high: quote.bid, low: quote.bid, close: quote.bid, spread: quote.spread }, quote.spread);
    const pnl = grossPnl({
      side: position.side,
      entry: pointsToPrice(position.entryPoints, position.priceScale),
      exit: pointsToPrice(price, position.priceScale),
      quantity: closeQty,
      valuePerPriceUnit: position.valuePerPriceUnit.toString(),
    });
    const commission = commissionFor(closeQty, rules.costs.commissionPerUnitPerSide);
    const after = remaining.minus(closeQty);
    const sequence = (await tx.simFill.count({ where: { positionId: position.id } })) + 1;
    const reason = after.isZero() ? "MANUAL" : "PARTIAL";
    await tx.simFill.create({
      data: { userId, accountId: account.id, positionId: position.id, sequence, kind: "CLOSE", reason, minute, pricePoints: price, quantity: closeQty.toFixed(), grossPnl: pnl.toFixed(2), commission: commission.toFixed(2) },
    });
    await appendLedger(tx, account, [
      { type: "REALIZED_PNL", amount: pnl, idempotencyKey: `close:${position.id}:${sequence}`, positionId: position.id, minute },
      { type: "COMMISSION", amount: commission, idempotencyKey: `commission-close:${position.id}:${sequence}`, positionId: position.id, minute },
    ]);
    const realized = dec(position.realizedPnl.toString()).plus(pnl);
    await tx.simPosition.update({
      where: { id: position.id },
      data: {
        remainingQuantity: after.toFixed(),
        realizedPnl: realized.toFixed(2),
        commissions: dec(position.commissions.toString()).plus(commission).toFixed(2),
        ...(after.isZero() ? { status: "CLOSED", closedMinute: minute, closeReason: "MANUAL" } : {}),
      },
    });
    await tx.simEvent.create({
      data: { userId, accountId: account.id, type: after.isZero() ? "POSITION_CLOSED" : "POSITION_REDUCED", minute, data: { positionId: position.id, quantity: closeQty.toFixed(), pnl: pnl.toFixed(2) } },
    });
    return { closedQuantity: closeQty.toFixed(), remainingQuantity: after.toFixed(), realizedPnl: realized.toFixed(2), duplicate: false };
  });
}

/** Moves a position's stop loss and/or take profit (null removes one). The 1R basis never changes. */
export async function modifyPosition(
  userId: string,
  accountId: string,
  positionId: string,
  request: { stopLoss: string | null; takeProfit: string | null; commandId?: string | null },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const account = await lockAccount(tx, userId, accountId);
    if (await claimCommand(tx, account, request.commandId)) return;
    assertTradable(account);
    const position = await requireOpenPosition(tx, account, positionId);
    const { quote } = await quoteFor(tx, account, position.symbol);
    const stopLoss = toPoints("The stop loss", request.stopLoss, position.priceScale);
    const takeProfit = toPoints("The take profit", request.takeProfit, position.priceScale);
    // Levels are checked against where the position would close now (a stop can't be through the market).
    const mark = position.side === "BUY" ? quote.bid : quote.ask;
    const err = protectiveLevelError(position.side, mark, stopLoss, takeProfit);
    if (err) throw new SimError(err.replace("entry price", "current price"));
    await tx.simPosition.update({ where: { id: position.id }, data: { stopLoss, takeProfit } });
    await tx.simEvent.create({ data: { userId, accountId: account.id, type: "POSITION_MODIFIED", minute: account.currentMinute, data: { positionId: position.id, stopLoss, takeProfit } } });
  });
}

export async function cancelOrder(userId: string, accountId: string, orderId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const account = await lockAccount(tx, userId, accountId);
    const order = await tx.simOrder.findFirst({ where: { id: orderId, accountId: account.id } });
    if (!order) throw new SimError("Order not found.");
    if (order.status !== "PENDING") return; // already filled/cancelled — nothing to do
    await tx.simOrder.update({ where: { id: order.id }, data: { status: "CANCELLED", resolvedMinute: account.currentMinute } });
    await tx.simEvent.create({ data: { userId, accountId: account.id, type: "ORDER_CANCELLED", minute: account.currentMinute, data: { orderId: order.id } } });
  });
}
