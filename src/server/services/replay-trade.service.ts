import { Prisma, type ReplayTrade, type ReplayTradeExecutionEvent, type ReplayTradePartialExit, type ReplayTradePlannedTarget } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { buildSetupValidationSnapshot } from "@/domain/trades/setup-validation";
import { findHistoricalScenario, toReplayResolvedConditions } from "@/domain/replay/replay-validation";
import { resolveHistoricalStrategyVersion } from "@/server/services/replay-review.service";
import {
  cancelPendingOrder,
  closePartialManually,
  closeRemainingManually,
  moveStopLoss,
  placeOrder,
  processCandles,
  resolveAmbiguity,
  rMultipleAt,
} from "@/domain/replay-execution/engine";
import type { ExecutionEvent, PendingAmbiguity, ReplayPositionState } from "@/domain/replay-execution/types";
import type { Candle } from "@/domain/market-data/candle";
import type { CreateReplayDecisionInput } from "@/lib/validation/replay";
import type { ReplayExecutionEventDTO, ReplayTradeDTO, ReplayTradePartialExitDTO } from "@/types/replay";

/**
 * Replay simulated execution (Stage 12 foundation, Stage 14 §2-26 execution
 * engine persistence). ReplayTrade is a SIMULATED decision point that
 * belongs only to a ReplayReviewSession — it must never touch a real Trade,
 * TradingDay, Performance Account, or canonical Analytics; every function
 * here writes exclusively to ReplayTrade/ReplayTradePlannedTarget/
 * ReplayTradePartialExit/ReplayTradeExecutionEvent. Ownership is always
 * re-derived through the session/trade row (never trusted from the client).
 *
 * The pure engine in domain/replay-execution/engine.ts does all decision
 * logic; this file's only job is reconstructing `ReplayPositionState` from
 * persisted rows, calling the engine, and durably persisting the result
 * (§32 — a trade must resume correctly from DB state, not be recomputed from
 * scratch client-side).
 */

const tradeInclude = {
  plannedTargets: { orderBy: { targetOrder: "asc" as const } },
  partialExits: { orderBy: { createdAt: "asc" as const } },
  executionEvents: { orderBy: { historicalTimestamp: "asc" as const } },
};

type ReplayTradeFull = ReplayTrade & {
  plannedTargets: ReplayTradePlannedTarget[];
  partialExits: ReplayTradePartialExit[];
  executionEvents: ReplayTradeExecutionEvent[];
};

function toNum(v: Prisma.Decimal | null): number | null {
  return v == null ? null : v.toNumber();
}

function toReplayTradeDTO(row: ReplayTradeFull): ReplayTradeDTO {
  return {
    id: row.id,
    historicalTimestamp: row.historicalTimestamp.toISOString(),
    assetSymbol: row.assetSymbol,
    direction: row.direction,
    strategyId: row.strategyId,
    strategyNameSnapshot: row.strategyNameSnapshot,
    strategyVersionSnapshot: row.strategyVersionSnapshot,
    setupTypeNameSnapshot: row.setupTypeNameSnapshot,
    decisionType: row.decisionType,

    replayValidationSnapshot: row.replayValidationSnapshot,
    validationState: row.validationState,
    overrideReason: row.overrideReason,
    overrideNote: row.overrideNote,

    lifecycle: row.lifecycle,
    orderType: row.orderType,
    plannedEntry: toNum(row.plannedEntry),
    plannedStopLoss: toNum(row.plannedStopLoss),
    currentStopLoss: toNum(row.currentStopLoss),
    simulatedEntry: toNum(row.simulatedEntry),
    filledAt: row.filledAt?.toISOString() ?? null,
    simulatedExit: toNum(row.simulatedExit),
    closedAt: row.closedAt?.toISOString() ?? null,
    closeReason: row.closeReason,
    remainingPercent: row.remainingPercent.toNumber(),
    realizedReplayR: row.realizedReplayR.toNumber(),
    lastProcessedTime: row.lastProcessedTime?.toISOString() ?? null,
    pendingAmbiguity: row.pendingAmbiguity,

    notes: row.notes,
    targets: row.plannedTargets.map((t) => ({
      id: t.id,
      order: t.targetOrder,
      price: t.price.toNumber(),
      percentToClose: t.percentToClose.toNumber(),
      filledAt: t.filledAt?.toISOString() ?? null,
    })),
    partialExits: row.partialExits.map(toPartialExitDTO),
    executionEvents: row.executionEvents.map(toExecutionEventDTO),
  };
}

function toPartialExitDTO(row: ReplayTradePartialExit): ReplayTradePartialExitDTO {
  return {
    id: row.id,
    plannedTargetId: row.plannedTargetId,
    source: row.source,
    exitPrice: row.exitPrice.toNumber(),
    percentClosed: toNum(row.percentClosed),
    realizedR: toNum(row.realizedR),
    executedAt: row.executedAt?.toISOString() ?? null,
  };
}

function toExecutionEventDTO(row: ReplayTradeExecutionEvent): ReplayExecutionEventDTO {
  return {
    id: row.id,
    eventType: row.eventType,
    historicalTimestamp: row.historicalTimestamp.toISOString(),
    data: row.data,
  };
}

/**
 * Creating OR managing a ReplayTrade requires the session to be
 * IN_PROGRESS — a DRAFT session may still have its scope/period adjusted,
 * and a COMPLETED one is a finished review (Stage 15.2 §26: once COMPLETED,
 * no new ReplayTrade, no execution mutation, no validation/target
 * mutation). Every mutation entry point below calls this — creation via
 * `assertSessionOpenForReplay` (kept as the original name other callers
 * already use), every management action via `assertSessionMutable` (same
 * check, named for its call sites). `ReplayComparisonLink` writes are
 * deliberately NOT gated by this — reviewing/annotating a comparison is the
 * point of a completed review, so manual matching and missed-opportunity
 * confirmation intentionally remain editable after COMPLETED (see
 * replay-comparison-link.service.ts).
 */
async function assertSessionOpenForReplay(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id: sessionId, userId },
    select: { status: true },
  });
  if (!session) throw new Error("Review session not found.");
  if (session.status !== "IN_PROGRESS") {
    throw new Error("Start the review before adding replay trades.");
  }
}

async function assertSessionMutable(sessionId: string): Promise<void> {
  const session = await prisma.replayReviewSession.findFirst({ where: { id: sessionId }, select: { status: true } });
  if (!session || session.status !== "IN_PROGRESS") {
    throw new Error("This review is completed — reopen it before making further Replay changes.");
  }
}

async function getOwnedTradeFull(userId: string, id: string): Promise<ReplayTradeFull> {
  const row = await prisma.replayTrade.findFirst({ where: { id, userId }, include: tradeInclude });
  if (!row) throw new Error("Replay trade not found.");
  return row;
}

/** Reconstructs the pure engine's state from a persisted row + its targets
 *  (Stage 14 §32 — resume from durable state, never recomputed from
 *  scratch). Throws if the trade never had an order placed (SKIPPED
 *  decisions, or a TAKEN decision that failed before placement). */
function toPositionState(row: ReplayTradeFull): ReplayPositionState {
  if (row.direction == null || row.plannedEntry == null || row.plannedStopLoss == null || row.currentStopLoss == null) {
    throw new Error("This replay decision has no simulated order placed.");
  }
  return {
    direction: row.direction,
    orderType: row.orderType,
    lifecycle: row.lifecycle,
    plannedEntry: row.plannedEntry.toNumber(),
    initialStopLoss: row.plannedStopLoss.toNumber(),
    currentStopLoss: row.currentStopLoss.toNumber(),
    targets: row.plannedTargets
      .slice()
      .sort((a, b) => a.targetOrder - b.targetOrder)
      .map((t) => ({
        id: t.id,
        order: t.targetOrder,
        price: t.price.toNumber(),
        percentToClose: t.percentToClose.toNumber(),
        filledAt: t.filledAt ? t.filledAt.getTime() : null,
      })),
    filledEntry: row.simulatedEntry ? row.simulatedEntry.toNumber() : null,
    filledAt: row.filledAt ? row.filledAt.getTime() : null,
    remainingPercent: row.remainingPercent.toNumber(),
    realizedR: row.realizedReplayR.toNumber(),
    closedAt: row.closedAt ? row.closedAt.getTime() : null,
    closeReason: row.closeReason,
    lastProcessedTime: row.lastProcessedTime
      ? row.lastProcessedTime.getTime()
      : (row.filledAt ?? row.historicalTimestamp).getTime(),
    pendingAmbiguity: row.pendingAmbiguity as unknown as PendingAmbiguity | null,
  };
}

/** §24 — management actions may never act earlier than the trade's own fill
 *  time (a PLANNED/PENDING order has no fill yet, so nothing to check). */
function assertActionNotBeforeFill(row: ReplayTradeFull, timestamp: number): void {
  if (row.filledAt && timestamp < row.filledAt.getTime()) {
    throw new Error("A management action cannot be timestamped before the trade's fill time.");
  }
}

/**
 * Persists one engine `ProcessResult` (Stage 14 §18-21, §26): planned-target
 * fill watermarks, ReplayTradePartialExit rows for every PARTIAL_CLOSE
 * event, a ReplayTradeExecutionEvent row for every event (auditability,
 * §20), and the trade's own denormalized position fields. Always writes the
 * FULL current state (not a diff) — safe because the engine itself is
 * idempotent (§26), so re-applying the same state twice is a no-op.
 */
async function applyProcessResult(
  tx: TransactionClient,
  userId: string,
  tradeId: string,
  state: ReplayPositionState,
  events: ExecutionEvent[],
): Promise<void> {
  for (const target of state.targets) {
    if (target.filledAt != null) {
      await tx.replayTradePlannedTarget.updateMany({
        where: { id: target.id, replayTradeId: tradeId, filledAt: null },
        data: { filledAt: new Date(target.filledAt) },
      });
    }
  }

  let lastPrice: number | undefined;
  let simulatedExitPrice: number | undefined;

  for (const event of events) {
    const data = event.data as Record<string, unknown> | undefined;
    if (data && typeof data.price === "number") lastPrice = data.price;

    if (event.type === "PARTIAL_CLOSE") {
      const price = data?.price as number;
      const percent = data?.percent as number;
      const targetId = (data?.targetId as string | undefined) ?? null;
      await tx.replayTradePartialExit.create({
        data: {
          userId,
          replayTradeId: tradeId,
          plannedTargetId: targetId,
          source: targetId ? "TARGET_HIT" : "MANUAL",
          exitPrice: price,
          percentClosed: percent,
          realizedR: rMultipleAt(state, price) * (percent / 100),
          executedAt: new Date(event.timestamp),
        },
      });
    }

    if (event.type === "FULL_CLOSE") {
      simulatedExitPrice = (data?.price as number | undefined) ?? lastPrice ?? state.currentStopLoss;
    }
  }

  if (events.length > 0) {
    await tx.replayTradeExecutionEvent.createMany({
      data: events.map((event) => ({
        userId,
        replayTradeId: tradeId,
        eventType: event.type,
        historicalTimestamp: new Date(event.timestamp),
        data: event.data ? (event.data as Prisma.InputJsonValue) : Prisma.DbNull,
      })),
    });
  }

  const tradeUpdate: Prisma.ReplayTradeUpdateInput = {
    lifecycle: state.lifecycle,
    currentStopLoss: state.currentStopLoss,
    simulatedEntry: state.filledEntry,
    filledAt: state.filledAt != null ? new Date(state.filledAt) : null,
    closedAt: state.closedAt != null ? new Date(state.closedAt) : null,
    closeReason: state.closeReason,
    remainingPercent: state.remainingPercent,
    realizedReplayR: state.realizedR,
    lastProcessedTime: state.lastProcessedTime != null ? new Date(state.lastProcessedTime) : null,
    pendingAmbiguity: state.pendingAmbiguity ? (state.pendingAmbiguity as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };
  if (simulatedExitPrice !== undefined) tradeUpdate.simulatedExit = simulatedExitPrice;

  await tx.replayTrade.update({ where: { id: tradeId }, data: tradeUpdate });
}

/**
 * Creates a Replay decision (Stage 14 §2-7, §27) — SKIPPED just freezes the
 * context; TAKEN also places a simulated order via the pure engine. Setup
 * Validation is computed authoritatively HERE against the historically
 * resolved StrategyVersion (never the live Strategy Lab config, and never a
 * client-sent snapshot) — mirrors trades.service.ts's buildSetupValidation.
 */
export async function createReplayDecision(
  userId: string,
  sessionId: string,
  input: CreateReplayDecisionInput,
): Promise<ReplayTradeDTO> {
  await assertSessionOpenForReplay(userId, sessionId);

  let strategyNameSnapshot: string | null = null;
  let strategyVersionSnapshot: number | null = null;
  let replayValidationSnapshot: Prisma.InputJsonValue | null = null;
  let validationState: "NOT_VALIDATED" | "VALIDATED" | "OVERRIDDEN" | null = null;
  let overrideReason: CreateReplayDecisionInput["overrideReason"] | null = null;
  let overrideNote: string | null = null;

  if (input.strategyId) {
    const owned = await prisma.strategy.findFirst({ where: { id: input.strategyId, userId }, select: { id: true } });
    if (!owned) throw new Error("Strategy not found.");

    const historical = await resolveHistoricalStrategyVersion(userId, input.strategyId, input.historicalTimestamp);
    if (!historical) {
      throw new Error(
        "No historical Strategy version exists at this replay time — cannot resolve what the setup checklist looked like then.",
      );
    }
    strategyNameSnapshot = historical.strategyName;
    strategyVersionSnapshot = historical.version;

    if (input.setupTypeName) {
      const setupTypes = historical.snapshot.setupTypes ?? [];
      const found = findHistoricalScenario(setupTypes, input.setupTypeName, input.direction);
      if (!found) throw new Error("This Setup Type/scenario was not part of the historical Strategy version.");

      const built = buildSetupValidationSnapshot({
        strategyName: strategyNameSnapshot,
        strategyVersion: strategyVersionSnapshot,
        setupType: { id: found.setupType.name, name: found.setupType.name },
        scenario: { id: `${found.setupType.name}:${found.scenario.direction}`, direction: found.scenario.direction },
        conditions: toReplayResolvedConditions(found.scenario),
        selectedChecklistItemIds: input.selectedConditionIds,
        overrideReason: input.overrideReason ?? null,
        overrideNote: input.overrideNote ?? null,
      });
      replayValidationSnapshot = built.snapshot as unknown as Prisma.InputJsonValue;
      validationState = built.validationState;
      overrideReason = built.overrideReason;
      overrideNote = built.overrideNote;
    }
  }

  const last = await prisma.replayTrade.findFirst({ where: { sessionId }, orderBy: { sortOrder: "desc" } });
  const sortOrder = (last?.sortOrder ?? -1) + 1;

  const baseData = {
    userId,
    sessionId,
    historicalTimestamp: new Date(input.historicalTimestamp),
    assetSymbol: input.assetSymbol,
    direction: input.direction,
    strategyId: input.strategyId ?? null,
    strategyNameSnapshot,
    strategyVersionSnapshot,
    setupTypeNameSnapshot: input.setupTypeName ?? null,
    replayValidationSnapshot: replayValidationSnapshot ?? Prisma.JsonNull,
    validationState,
    overrideReason,
    overrideNote,
    notes: (input.notes as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    sortOrder,
  };

  if (input.decisionType === "SKIPPED") {
    const row = await prisma.replayTrade.create({
      data: { ...baseData, decisionType: "SKIPPED", lifecycle: "PLANNED" },
      include: tradeInclude,
    });
    return toReplayTradeDTO(row);
  }

  // TAKEN — place the simulated order via the pure engine, then persist its
  // resulting state + targets + placement events in one transaction.
  const placed = placeOrder({
    direction: input.direction,
    orderType: input.orderType!,
    entryPrice: input.entryPrice!,
    initialStopLoss: input.initialStopLoss!,
    targets: input.targets ?? [],
    timestamp: input.historicalTimestamp,
  });

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.replayTrade.create({
      data: {
        ...baseData,
        decisionType: "TAKEN",
        lifecycle: placed.state.lifecycle,
        orderType: placed.state.orderType,
        plannedEntry: placed.state.plannedEntry,
        plannedStopLoss: placed.state.initialStopLoss,
        currentStopLoss: placed.state.currentStopLoss,
        simulatedEntry: placed.state.filledEntry,
        filledAt: placed.state.filledAt != null ? new Date(placed.state.filledAt) : null,
        remainingPercent: placed.state.remainingPercent,
        realizedReplayR: placed.state.realizedR,
        lastProcessedTime: new Date(placed.state.lastProcessedTime),
        plannedTargets: {
          create: placed.state.targets.map((t) => ({
            userId,
            targetOrder: t.order,
            price: t.price,
            percentToClose: t.percentToClose,
          })),
        },
      },
    });

    if (placed.events.length > 0) {
      await tx.replayTradeExecutionEvent.createMany({
        data: placed.events.map((event) => ({
          userId,
          replayTradeId: created.id,
          eventType: event.type,
          historicalTimestamp: new Date(event.timestamp),
          data: event.data ? (event.data as Prisma.InputJsonValue) : Prisma.DbNull,
        })),
      });
    }

    return tx.replayTrade.findUniqueOrThrow({ where: { id: created.id }, include: tradeInclude });
  });

  return toReplayTradeDTO(row);
}

export async function listReplayTrades(userId: string, sessionId: string): Promise<ReplayTradeDTO[]> {
  const owned = await prisma.replayReviewSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!owned) return [];
  const rows = await prisma.replayTrade.findMany({
    where: { sessionId },
    include: tradeInclude,
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(toReplayTradeDTO);
}

export async function getReplayTrade(userId: string, id: string): Promise<ReplayTradeDTO | null> {
  const row = await prisma.replayTrade.findFirst({ where: { id, userId }, include: tradeInclude });
  return row ? toReplayTradeDTO(row) : null;
}

/**
 * Stage 18 §21-22 — unrealized R for an OPEN/PARTIALLY_CLOSED position,
 * strictly at a caller-supplied price. Reuses the exact same
 * `rMultipleAt` domain function realized R is derived from elsewhere
 * (Stage 14) — no duplicate R math in the UI (§41). Returns `null` for any
 * lifecycle other than OPEN/PARTIALLY_CLOSED (flat/pending/closed trades
 * have no meaningful "unrealized" figure). The CALLER is responsible for
 * `atPrice` being derived strictly from the latest visible replay candle
 * (never a future one) — this function has no clock/visibility awareness
 * of its own, exactly like `advanceReplayTradeExecution` trusts its caller
 * for candle visibility.
 */
export async function getReplayTradeUnrealizedR(userId: string, id: string, atPrice: number): Promise<number | null> {
  const row = await getOwnedTradeFull(userId, id);
  if (row.lifecycle !== "OPEN" && row.lifecycle !== "PARTIALLY_CLOSED") return null;
  const state = toPositionState(row);
  return rMultipleAt(state, atPrice);
}

/**
 * Stage 18 §19 — lightweight reasoning notes, merged into `ReplayTrade`'s
 * existing `notes: Json?` field under a `reasoning` key so this never
 * clobbers `skipReason` (written by the decision-creation flow) or any
 * other key a future flow adds to the same JSON object. Deliberately no
 * new column/model — the smallest existing-compatible architecture, per
 * the stage's own instruction.
 */
export async function updateReplayTradeReasoningNote(userId: string, id: string, note: string): Promise<ReplayTradeDTO> {
  const row = await getOwnedTradeFull(userId, id);
  await assertSessionMutable(row.sessionId);
  const existingNotes = (row.notes as Record<string, unknown> | null) ?? {};
  const updated = await prisma.replayTrade.update({
    where: { id },
    data: { notes: { ...existingNotes, reasoning: note } as Prisma.InputJsonValue },
    include: tradeInclude,
  });
  return toReplayTradeDTO(updated);
}

export async function deleteReplayTrade(userId: string, id: string): Promise<void> {
  const row = await getOwnedTradeFull(userId, id);
  await assertSessionMutable(row.sessionId);
  const result = await prisma.replayTrade.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new Error("Replay trade not found.");
}

/**
 * Advances a TAKEN decision's simulated order/position through newly
 * revealed base candles (Stage 14 §25-26). A no-op (returns the trade
 * unchanged) for SKIPPED decisions or an already-CLOSED/CANCELLED trade —
 * callers can safely call this on every trade in a session as the Replay
 * Clock advances without checking lifecycle themselves first.
 */
export async function advanceReplayTradeExecution(userId: string, id: string, candles: Candle[]): Promise<ReplayTradeDTO> {
  const row = await getOwnedTradeFull(userId, id);
  if (row.decisionType !== "TAKEN" || row.lifecycle === "CLOSED" || row.lifecycle === "CANCELLED") {
    return toReplayTradeDTO(row);
  }
  await assertSessionMutable(row.sessionId);

  const state = toPositionState(row);
  const result = processCandles(state, candles);
  if (result.events.length === 0 && result.state === state) return toReplayTradeDTO(row);

  const updated = await prisma.$transaction(async (tx) => {
    await applyProcessResult(tx, userId, id, result.state, result.events);
    return tx.replayTrade.findUniqueOrThrow({ where: { id }, include: tradeInclude });
  });
  return toReplayTradeDTO(updated);
}

/** Manual resolution of an OHLC ambiguity (Stage 14 §12) — the trader's own
 *  call, never automatic. */
export async function resolveReplayTradeAmbiguity(
  userId: string,
  id: string,
  resolution: "SL_FIRST" | "TARGET_FIRST",
): Promise<ReplayTradeDTO> {
  const row = await getOwnedTradeFull(userId, id);
  await assertSessionMutable(row.sessionId);
  const state = toPositionState(row);
  if (!state.pendingAmbiguity) throw new Error("This trade has no ambiguous candle to resolve.");

  const result = resolveAmbiguity(state, resolution);
  const updated = await prisma.$transaction(async (tx) => {
    await applyProcessResult(tx, userId, id, result.state, result.events);
    return tx.replayTrade.findUniqueOrThrow({ where: { id }, include: tradeInclude });
  });
  return toReplayTradeDTO(updated);
}

export async function moveReplayTradeStopLoss(
  userId: string,
  id: string,
  newStopLoss: number,
  timestamp: number,
): Promise<ReplayTradeDTO> {
  const row = await getOwnedTradeFull(userId, id);
  await assertSessionMutable(row.sessionId);
  assertActionNotBeforeFill(row, timestamp);
  if (row.lifecycle !== "OPEN" && row.lifecycle !== "PARTIALLY_CLOSED") {
    throw new Error("The stop loss can only be moved on an open position.");
  }

  const state = toPositionState(row);
  const result = moveStopLoss(state, newStopLoss, timestamp);
  const updated = await prisma.$transaction(async (tx) => {
    await applyProcessResult(tx, userId, id, result.state, result.events);
    return tx.replayTrade.findUniqueOrThrow({ where: { id }, include: tradeInclude });
  });
  return toReplayTradeDTO(updated);
}

export async function closeReplayTradePartialManually(
  userId: string,
  id: string,
  percent: number,
  price: number,
  timestamp: number,
): Promise<ReplayTradeDTO> {
  const row = await getOwnedTradeFull(userId, id);
  await assertSessionMutable(row.sessionId);
  assertActionNotBeforeFill(row, timestamp);
  if (row.lifecycle !== "OPEN" && row.lifecycle !== "PARTIALLY_CLOSED") {
    throw new Error("Only an open position can be partially closed.");
  }

  const state = toPositionState(row);
  const result = closePartialManually(state, percent, price, timestamp);
  const updated = await prisma.$transaction(async (tx) => {
    await applyProcessResult(tx, userId, id, result.state, result.events);
    return tx.replayTrade.findUniqueOrThrow({ where: { id }, include: tradeInclude });
  });
  return toReplayTradeDTO(updated);
}

export async function closeReplayTradeRemainingManually(
  userId: string,
  id: string,
  price: number,
  timestamp: number,
): Promise<ReplayTradeDTO> {
  const row = await getOwnedTradeFull(userId, id);
  await assertSessionMutable(row.sessionId);
  assertActionNotBeforeFill(row, timestamp);
  if (row.lifecycle !== "OPEN" && row.lifecycle !== "PARTIALLY_CLOSED") {
    throw new Error("Only an open position can be closed.");
  }

  const state = toPositionState(row);
  const result = closeRemainingManually(state, price, timestamp);
  const updated = await prisma.$transaction(async (tx) => {
    await applyProcessResult(tx, userId, id, result.state, result.events);
    return tx.replayTrade.findUniqueOrThrow({ where: { id }, include: tradeInclude });
  });
  return toReplayTradeDTO(updated);
}

export async function cancelReplayTradePendingOrder(userId: string, id: string, timestamp: number): Promise<ReplayTradeDTO> {
  const row = await getOwnedTradeFull(userId, id);
  await assertSessionMutable(row.sessionId);
  if (row.lifecycle !== "PENDING") {
    throw new Error("Only a pending order can be cancelled.");
  }

  const state = toPositionState(row);
  const result = cancelPendingOrder(state, timestamp);
  const updated = await prisma.$transaction(async (tx) => {
    await applyProcessResult(tx, userId, id, result.state, result.events);
    return tx.replayTrade.findUniqueOrThrow({ where: { id }, include: tradeInclude });
  });
  return toReplayTradeDTO(updated);
}
