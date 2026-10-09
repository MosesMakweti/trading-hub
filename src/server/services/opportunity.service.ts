// Trade Opportunity service — the write/read layer for the opportunity architecture.
// All functions are userId-scoped. This is where the two structural rules live:
//   • Validity is scored HERE at spot time (reusing the SAME setup-score model as
//     Trade — no duplicate scoring), then frozen.
//   • One opportunity → one outcome. A resolved opportunity (EXECUTED / MISSED /
//     INVALIDATED / EXPIRED) cannot be re-resolved; the @unique on Trade.opportunityId
//     is the DB backstop and these guards are the friendly gate.

import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { scoreSetup, type SetupRating } from "@/domain/trades/setup-score";
import { scoreStrategyAdherence } from "@/domain/trades/strategy-adherence";
import { getStrategyReference } from "@/server/services/strategies.service";
import { executionSnapshot, resolveSelectedTags } from "@/server/services/selected-tags";
import {
  toOpportunityInputs,
  type OpportunityRow,
} from "@/domain/analytics/opportunity-mapper";
import {
  aggregateMissReasons,
  type MissReasonKey,
  type MissReasonRow,
} from "@/domain/analytics/miss-reasons";
import type { OpportunityCreateInput, MissOutcomeInput } from "@/lib/validation/opportunity";
import { queueMissedOpportunityResetSafely } from "@/server/services/psychology-reset.service";
import type { MissReason, MissedOutcome, OpportunityListItemDTO } from "@/types/opportunity";

export class OpportunityError extends Error {}

const num = (d: Prisma.Decimal | null): number | null => (d == null ? null : d.toNumber());
const dec = (n: number | null): Prisma.Decimal | null =>
  n == null ? null : new Prisma.Decimal(n);

/** The frozen "expected set" (mirrors Trade.strategyExecutionSnapshot). */
interface FrozenExpected {
  sessions: { name: string; color: string }[];
  confluences: {
    id?: string;
    name: string;
    color: string;
    category: string | null;
    weight: number | null;
    mandatory?: boolean;
    // Frozen at spot time — a later strategy edit can't change this
    // opportunity's eligible set. Absent on pre-direction snapshots → BOTH.
    directionApplicability?: "BULLISH" | "BEARISH" | "BOTH";
    pairId?: string | null;
  }[];
  execution: { name: string; color: string; category: string | null; weight: number | null }[];
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createOpportunity(
  userId: string,
  dateKey: string,
  data: OpportunityCreateInput,
) {
  return prisma.tradeOpportunity.create({ data: await buildSpottedOpportunityData(userId, dateKey, data) });
}

/** The scored, frozen create payload for a setup spotted directly (status
 *  PENDING) — shared by createOpportunity and recordMissedSetup so both use
 *  the one scoring path. */
async function buildSpottedOpportunityData(
  userId: string,
  dateKey: string,
  data: OpportunityCreateInput,
): Promise<Prisma.TradeOpportunityUncheckedCreateInput> {
  // Freeze the strategy's expected set + benchmark at spot time (self-contained;
  // survives later strategy edits/deletes).
  const ref = await getStrategyReference(userId, data.strategyId);
  if (!ref) throw new OpportunityError("Strategy not found.");

  const tm = await prisma.strategyTradeManagement.findFirst({
    where: { strategy: { id: data.strategyId, userId } },
    select: { expectedExpectancy: true },
  });

  const expected: FrozenExpected = {
    sessions: ref.sessions,
    confluences: ref.confluences,
    execution: ref.execution,
  };

  // Same validity + weighted setup score used for trades — one scoring engine.
  // Direction-aware: only confluences eligible for this opportunity's direction
  // are scored / required.
  const setup = scoreSetup(
    expected.confluences.map((c) => ({
      id: c.id ?? c.name,
      name: c.name,
      weight: c.weight,
      mandatory: c.mandatory ?? false,
      directionApplicability: c.directionApplicability ?? "BOTH",
    })),
    data.selectedConfluences,
    { direction: data.direction },
  );
  const scores = scoreStrategyAdherence(
    expected,
    data.selectedConfluences,
    data.selectedExecution,
    data.direction,
  );

  return {
    userId,
    spottedAt: dateKeyToUtcDate(dateKey),
    assetSymbol: data.assetSymbol,
    direction: data.direction,
    timeframe: data.timeframe,
    strategyId: ref.id,
    strategyNameSnapshot: ref.name,
    strategyVersionSnapshot: ref.version,
    strategyExecutionSnapshot: expected as unknown as Prisma.InputJsonValue,
    selectedConfluences: data.selectedConfluences as unknown as Prisma.InputJsonValue,
    selectedExecution: data.selectedExecution as unknown as Prisma.InputJsonValue,
    missingConfluences: setup.missingConfluences as unknown as Prisma.InputJsonValue,
    confluencePercent: scores.confluencePercent,
    executionPercent: scores.executionPercent,
    setupScore: setup.setupScore,
    setupRating: setup.setupRating,
    setupValid: setup.setupValid,
    plannedEntry: dec(data.plannedEntry),
    plannedStopLoss: dec(data.plannedStopLoss),
    plannedTarget: dec(data.plannedTarget),
    plannedRR: dec(data.plannedRR),
    expectedExpectancyR: dec(tm?.expectedExpectancy ?? null),
    status: "PENDING",
  };
}

const missedFields = (data: MissOutcomeInput) => ({
  status: "MISSED" as const,
  missReason: data.missReason,
  missNote: data.missNote,
  missedOutcome: data.missedOutcome,
  missedRealizedR: dec(data.missedRealizedR),
});

// ── Today V3 (Phase 4): record a missed setup in one step ────────────────────

/**
 * "+ Setup missed" — the compact V3 flow: the setup is scored and frozen
 * exactly as createOpportunity does, and resolved MISSED in the same insert
 * (no intermediate PENDING row). Never creates a Trade, so it can never count
 * as executed or use Performance risk.
 */
export async function recordMissedSetup(
  userId: string,
  dateKey: string,
  setup: OpportunityCreateInput,
  miss: MissOutcomeInput,
) {
  const base = await buildSpottedOpportunityData(userId, dateKey, setup);
  const op = await prisma.tradeOpportunity.create({ data: { ...base, ...missedFields(miss) } });
  await queueMissedOpportunityResetSafely(userId, op.id); // optional Psychology Reset; never fails the record
  return op;
}

/**
 * "Record as missed opportunity" on a cancelled idea — ONLY on the trader's
 * explicit request; cancelling never does this. The cancelled Trade is left
 * untouched (it stays a cancelled Trade); a separate MISSED opportunity is
 * created from the idea's FROZEN evidence (strategy snapshot, selections,
 * setup score/validity, planned prices — never re-scored against live
 * Strategy Lab) and linked back through originTradeId (provenance only;
 * Trade.opportunityId — "the executed trade" — is not used). One per trade.
 */
export async function recordCancelledIdeaAsMissed(userId: string, tradeId: string, miss: MissOutcomeInput) {
  const op = await recordCancelledIdeaAsMissedOnce(userId, tradeId, miss);
  await queueMissedOpportunityResetSafely(userId, op.id); // idempotent per opportunity
  return op;
}

async function recordCancelledIdeaAsMissedOnce(userId: string, tradeId: string, miss: MissOutcomeInput) {
  try {
    return await createFromCancelledIdea(userId, tradeId, miss);
  } catch (e) {
    // Idempotent under a double submit: the @unique on originTradeId lets
    // only one concurrent insert win; the loser returns the winner's row.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.tradeOpportunity.findFirst({ where: { originTradeId: tradeId, userId } });
      if (winner) return winner;
    }
    throw e;
  }
}

async function createFromCancelledIdea(userId: string, tradeId: string, miss: MissOutcomeInput) {
  return prisma.$transaction(async (tx) => {
    const trade = await tx.trade.findFirst({ where: { id: tradeId, userId, deletedAt: null } });
    if (!trade) throw new OpportunityError("Trade not found.");
    if (trade.reviewLifecycleStatus !== "CANCELLED_NEVER_TRIGGERED" || trade.actualEntry != null) {
      throw new OpportunityError("Only a cancelled idea that was never entered can be recorded as a missed opportunity.");
    }
    // Idempotent: recording the same cancelled idea again returns the
    // existing missed opportunity instead of creating a second one.
    const existing = await tx.tradeOpportunity.findFirst({ where: { originTradeId: trade.id, userId, deletedAt: null } });
    if (existing) return existing;

    const tm = trade.strategyId
      ? await tx.strategyTradeManagement.findFirst({
          where: { strategy: { id: trade.strategyId, userId } },
          select: { expectedExpectancy: true },
        })
      : null;

    return tx.tradeOpportunity.create({
      data: {
        userId,
        spottedAt: trade.tradeDate,
        assetSymbol: trade.assetSymbol,
        direction: trade.direction,
        timeframe: trade.timeframe,
        strategyId: trade.strategyId,
        strategyNameSnapshot: trade.strategyNameSnapshot,
        strategyVersionSnapshot: trade.strategyVersionSnapshot,
        strategyExecutionSnapshot: trade.strategyExecutionSnapshot ?? Prisma.DbNull,
        selectedConfluences: trade.selectedConfluences ?? Prisma.DbNull,
        selectedExecution: trade.selectedExecution ?? Prisma.DbNull,
        missingConfluences: trade.missingConfluences ?? Prisma.DbNull,
        confluencePercent: trade.confluencePercent,
        executionPercent: trade.executionPercent,
        setupScore: trade.setupScore,
        setupRating: trade.setupRating,
        setupValid: trade.setupValid,
        plannedEntry: trade.plannedEntry,
        plannedStopLoss: trade.plannedStopLoss,
        plannedTarget: trade.plannedTarget,
        plannedRR: trade.expectedRR,
        expectedExpectancyR: dec(tm?.expectedExpectancy ?? null),
        originTradeId: trade.id,
        ...missedFields(miss),
      },
    });
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function listOpportunitiesForDay(userId: string, dateKey: string) {
  return prisma.tradeOpportunity.findMany({
    where: { userId, spottedAt: dateKeyToUtcDate(dateKey) },
    include: {
      executedTrade: { select: { id: true, tradeNumber: true, actualRR: true } },
      originTrade: { select: { id: true, tradeNumber: true, deletedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** The day's opportunities as view DTOs — tag colors resolved from the frozen
 *  snapshot (same as trades), and missingMandatory re-derived from that snapshot so
 *  the Invalid-Setup state names the exact core requirements that were absent. */
export async function listOpportunityDtosForDay(
  userId: string,
  dateKey: string,
): Promise<OpportunityListItemDTO[]> {
  const rows = await listOpportunitiesForDay(userId, dateKey);
  return rows.map((o) => {
    const snap = executionSnapshot(o.strategyExecutionSnapshot);
    const missingMandatory = scoreSetup(
      (snap.confluences ?? []).map((c) => ({
        id: c.id ?? c.name,
        name: c.name,
        weight: null,
        mandatory: c.mandatory ?? false,
        directionApplicability: c.directionApplicability ?? "BOTH",
      })),
      (o.selectedConfluences as string[] | null) ?? [],
      { direction: o.direction },
    ).missingMandatory;

    return {
      id: o.id,
      status: o.status,
      assetSymbol: o.assetSymbol,
      direction: o.direction,
      timeframe: o.timeframe,
      strategyId: o.strategyId,
      strategyName: o.strategyNameSnapshot,
      setupScore: o.setupScore,
      setupRating: o.setupRating as SetupRating | null,
      setupValid: o.setupValid,
      missingMandatory,
      confluenceLabels: resolveSelectedTags(o.selectedConfluences, snap.confluences, []),
      executionLabels: resolveSelectedTags(o.selectedExecution, snap.execution, []),
      plannedEntry: num(o.plannedEntry),
      plannedStopLoss: num(o.plannedStopLoss),
      plannedTarget: num(o.plannedTarget),
      plannedRR: num(o.plannedRR),
      expectedExpectancyR: num(o.expectedExpectancyR),
      missReason: o.missReason as MissReason | null,
      missNote: o.missNote,
      missedOutcome: o.missedOutcome as MissedOutcome | null,
      missedRealizedR: num(o.missedRealizedR),
      executedTrade: o.executedTrade
        ? {
            id: o.executedTrade.id,
            tradeNumber: o.executedTrade.tradeNumber,
            actualRR: num(o.executedTrade.actualRR),
          }
        : null,
      // Nested includes aren't soft-delete filtered: a deleted origin trade
      // is no longer shown as provenance (the opportunity itself stays).
      originTrade:
        o.originTrade && o.originTrade.deletedAt == null ? { id: o.originTrade.id, tradeNumber: o.originTrade.tradeNumber } : null,
    } satisfies OpportunityListItemDTO;
  });
}

async function requireOpportunity(userId: string, id: string) {
  const op = await prisma.tradeOpportunity.findFirst({ where: { id, userId } });
  if (!op) throw new OpportunityError("Opportunity not found.");
  return op;
}

/** Guards a resolve action: an opportunity can only move OUT of PENDING once. */
function assertPending(status: string) {
  if (status !== "PENDING") {
    throw new OpportunityError("This opportunity already has an outcome.");
  }
}

// ── Resolve: MISSED ──────────────────────────────────────────────────────────

export async function logMissedOutcome(userId: string, id: string, data: MissOutcomeInput) {
  const op = await requireOpportunity(userId, id);
  assertPending(op.status);
  const updated = await prisma.tradeOpportunity.update({
    where: { id: op.id },
    data: missedFields(data),
  });
  await queueMissedOpportunityResetSafely(userId, updated.id); // optional Psychology Reset; never fails the record
  return updated;
}

// ── Resolve: INVALIDATED / EXPIRED (not real misses; excluded from the gap) ────

export async function invalidateOpportunity(userId: string, id: string) {
  const op = await requireOpportunity(userId, id);
  assertPending(op.status);
  return prisma.tradeOpportunity.update({ where: { id: op.id }, data: { status: "INVALIDATED" } });
}

export async function expireOpportunity(userId: string, id: string) {
  const op = await requireOpportunity(userId, id);
  assertPending(op.status);
  return prisma.tradeOpportunity.update({ where: { id: op.id }, data: { status: "EXPIRED" } });
}

// ── Resolve: EXECUTED (link an existing trade) ────────────────────────────────

export async function linkExecutedTrade(userId: string, opportunityId: string, tradeId: string) {
  return prisma.$transaction(async (tx) => {
    const op = await tx.tradeOpportunity.findFirst({ where: { id: opportunityId, userId, deletedAt: null } });
    if (!op) throw new OpportunityError("Opportunity not found.");
    assertPending(op.status);

    const trade = await tx.trade.findFirst({ where: { id: tradeId, userId, deletedAt: null } });
    if (!trade) throw new OpportunityError("Trade not found.");
    if (trade.opportunityId) throw new OpportunityError("That trade is already linked to an opportunity.");

    await tx.trade.update({ where: { id: trade.id }, data: { opportunityId: op.id } });
    return tx.tradeOpportunity.update({ where: { id: op.id }, data: { status: "EXECUTED" } });
  });
}

/** Break an executed link and return the opportunity to PENDING (e.g. mis-link fix). */
export async function unlinkExecutedTrade(userId: string, opportunityId: string) {
  return prisma.$transaction(async (tx) => {
    const op = await tx.tradeOpportunity.findFirst({
      where: { id: opportunityId, userId, deletedAt: null },
      include: { executedTrade: { select: { id: true } } },
    });
    if (!op) throw new OpportunityError("Opportunity not found.");
    if (op.executedTrade) {
      await tx.trade.update({ where: { id: op.executedTrade.id }, data: { opportunityId: null } });
    }
    return tx.tradeOpportunity.update({ where: { id: op.id }, data: { status: "PENDING" } });
  });
}

// ── Delete (soft) ─────────────────────────────────────────────────────────────

export async function deleteOpportunity(userId: string, id: string) {
  const op = await requireOpportunity(userId, id);
  // Detach any linked trade first so the trade survives (it's a real executed record).
  await prisma.trade.updateMany({ where: { opportunityId: op.id, userId }, data: { opportunityId: null } });
  // Releasing the provenance link lets the cancelled idea be recorded again.
  await prisma.tradeOpportunity.update({ where: { id: op.id }, data: { deletedAt: new Date(), originTradeId: null } });
}

// ── Engine feed ───────────────────────────────────────────────────────────────

/** Resolved opportunities across a date range → Opportunity Engine inputs. Backs
 *  the opportunity-aware Discrepancy Gap on the Dashboard / Analytics (P4). */
export async function getOpportunityInputs(userId: string, from?: Date, to?: Date) {
  const where: Prisma.TradeOpportunityWhereInput = {
    userId,
    status: { in: ["EXECUTED", "MISSED"] },
  };
  if (from || to) {
    where.spottedAt = {};
    if (from) (where.spottedAt as Prisma.DateTimeFilter).gte = from;
    if (to) (where.spottedAt as Prisma.DateTimeFilter).lte = to;
  }

  const rows = await prisma.tradeOpportunity.findMany({
    where,
    select: {
      id: true,
      status: true,
      spottedAt: true,
      createdAt: true,
      setupValid: true,
      expectedExpectancyR: true,
      missedRealizedR: true,
      executedTrade: {
        select: {
          actualRR: true,
          tradeQualityPercent: true,
          setupScore: true,
          confluencePercent: true,
        },
      },
    },
  });

  const mapped: OpportunityRow[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    spottedAtKey: utcDateToKey(r.spottedAt),
    createdAtMs: r.createdAt.getTime(),
    setupValid: r.setupValid,
    expectedExpectancyR: num(r.expectedExpectancyR),
    missedRealizedR: num(r.missedRealizedR),
    executedTrade: r.executedTrade
      ? {
          actualR: num(r.executedTrade.actualRR),
          tradeQualityPercent: r.executedTrade.tradeQualityPercent,
          setupScore: r.executedTrade.setupScore,
          confluencePercent: r.executedTrade.confluencePercent,
        }
      : null,
  }));

  return toOpportunityInputs(mapped);
}

/** Behavioral breakdown of WHY valid setups were missed, in range — feeds the
 *  Psychology / Opportunity analytics (which lapse costs the most forgone R). */
export async function getMissReasonAggregate(userId: string, from?: Date, to?: Date) {
  const where: Prisma.TradeOpportunityWhereInput = { userId, status: "MISSED" };
  if (from || to) {
    where.spottedAt = {};
    if (from) (where.spottedAt as Prisma.DateTimeFilter).gte = from;
    if (to) (where.spottedAt as Prisma.DateTimeFilter).lte = to;
  }

  const rows = await prisma.tradeOpportunity.findMany({
    where,
    select: { missReason: true, missedRealizedR: true },
  });

  const mapped: MissReasonRow[] = rows.map((r) => ({
    reason: (r.missReason as MissReasonKey | null) ?? null,
    missedRealizedR: num(r.missedRealizedR),
  }));

  return aggregateMissReasons(mapped);
}
