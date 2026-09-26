import { Prisma, type BacktestRun } from "@prisma/client";

import { prisma } from "@/server/db";
import { deleteMediaFile } from "@/lib/media-storage";
import { collectMediaCandidates, deleteUnreferencedMediaAssets, removeOwnerAttachments } from "@/server/services/media.service";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import {
  computeRunProgress,
  isTradingDay,
  isWithinRun,
  resumeDateKey,
  type RunPeriod,
} from "@/domain/backtesting/run-calendar";
import { detectStrategyDrift } from "@/domain/backtesting/strategy-drift";
import { computeRGroupStats } from "@/domain/analytics/canonical-aggregations";
import type { CanonicalAnalyticsTradeRow } from "@/domain/analytics/canonical-dataset";
import { canonicalTradeInclude, toCanonicalRow } from "@/server/services/analytics-canonical.service";
import { captureStrategySnapshot } from "@/server/services/strategies.service";
import { backtestScope, runInWorkspaceScope } from "@/server/workspace/scope";
import { assertDatabaseSeesScope } from "@/server/workspace/scope-tripwire";
import type { CreateBacktestRunInput } from "@/lib/validation/backtesting";
import type { BacktestRunOverviewDTO, BacktestRunStatusValue } from "@/types/backtesting";

/**
 * Backtesting (Stage 1) — Backtest Run ownership and scope entry.
 *
 * A BacktestRun is itself NOT environment-scoped (it IS the environment), so
 * every query here scopes by `userId` explicitly. `runInBacktestRun` is the
 * one sanctioned way to enter a BACKTEST workspace scope: it verifies the run
 * belongs to the user first, so a forged run id can never scope a request into
 * someone else's (or a nonexistent) run.
 */

export class BacktestRunNotFoundError extends Error {
  constructor() {
    super("Backtest run not found.");
    this.name = "BacktestRunNotFoundError";
  }
}

/** A user-facing validation failure (safe to show verbatim). */
export class BacktestRunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestRunValidationError";
  }
}

export class BacktestDateOutOfRangeError extends Error {
  constructor(dateKey: string, period: Pick<RunPeriod, "startDateKey" | "endDateKey">) {
    super(`${dateKey} is outside this run's period (${period.startDateKey} → ${period.endDateKey}).`);
    this.name = "BacktestDateOutOfRangeError";
  }
}

export async function createBacktestRun(userId: string, input: CreateBacktestRunInput): Promise<BacktestRun> {
  // Strategy Lab stays the source of truth: link the live strategy and freeze
  // its current tree so the run remains interpretable after later edits.
  let strategyFields: Pick<
    Prisma.BacktestRunUncheckedCreateInput,
    "strategyId" | "strategyNameSnapshot" | "strategyVersionSnapshot" | "strategySnapshot"
  > = {};
  if (input.strategyId) {
    const captured = await captureStrategySnapshot(userId, input.strategyId);
    if (!captured) throw new BacktestRunValidationError("That strategy no longer exists in Strategy Lab.");
    // A strategy that declares its markets constrains what the run can test;
    // one with no declared markets accepts any asset.
    const allowed = captured.snapshot.applicableAssets.map((a) => a.toUpperCase());
    if (allowed.length > 0) {
      const outside = input.assets.filter((a) => !allowed.includes(a.toUpperCase()));
      if (outside.length > 0) {
        throw new BacktestRunValidationError(
          `${outside.join(", ")} ${outside.length === 1 ? "isn't" : "aren't"} among ${captured.name}'s markets (${allowed.join(", ")}).`,
        );
      }
    }
    strategyFields = {
      strategyId: input.strategyId,
      strategyNameSnapshot: captured.name,
      strategyVersionSnapshot: captured.version,
      strategySnapshot: captured.snapshot as unknown as Prisma.InputJsonValue,
    };
  }

  return prisma.backtestRun.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      ...strategyFields,
      assets: [...new Set(input.assets)],
      startDate: dateKeyToUtcDate(input.startDate),
      endDate: dateKeyToUtcDate(input.endDate),
      tradingWeekdays: [...new Set(input.tradingWeekdays)].sort(),
      startingBalance: input.startingBalance ?? null,
      riskPercentPerTrade: input.riskPercentPerTrade ?? null,
      currency: input.currency ?? null,
    },
  });
}

export async function getBacktestRun(userId: string, runId: string): Promise<BacktestRun | null> {
  return prisma.backtestRun.findFirst({ where: { id: runId, userId } });
}

export async function requireBacktestRun(userId: string, runId: string): Promise<BacktestRun> {
  const run = await getBacktestRun(userId, runId);
  if (!run) throw new BacktestRunNotFoundError();
  return run;
}

export function toRunPeriod(run: Pick<BacktestRun, "startDate" | "endDate" | "tradingWeekdays">): RunPeriod {
  return {
    startDateKey: utcDateToKey(run.startDate),
    endDateKey: utcDateToKey(run.endDate),
    tradingWeekdays: run.tradingWeekdays,
  };
}

/** Rejects a simulation date outside the run's configured period. */
export function assertDateWithinRun(run: BacktestRun, dateKey: string): void {
  const period = toRunPeriod(run);
  if (!isWithinRun(period, dateKey)) throw new BacktestDateOutOfRangeError(dateKey, period);
}

/**
 * Verifies ownership, then runs `fn` inside the run's BACKTEST workspace
 * scope — every shared Today/Journal/Analytics service called from `fn` then
 * reads and writes only this run's rows.
 */
export async function runInBacktestRun<T>(
  userId: string,
  runId: string,
  fn: (run: BacktestRun) => Promise<T>,
): Promise<T> {
  const run = await requireBacktestRun(userId, runId);
  const scope = backtestScope(run.id);
  return runInWorkspaceScope(scope, () => {
    assertDatabaseSeesScope(scope);
    return fn(run);
  });
}

/** Records the resume pointer (server-side, never only browser state). */
export async function touchBacktestRunSession(userId: string, runId: string, dateKey: string): Promise<void> {
  const run = await requireBacktestRun(userId, runId);
  assertDateWithinRun(run, dateKey);
  await prisma.backtestRun.update({
    where: { id: run.id },
    data: { lastSessionDate: dateKeyToUtcDate(dateKey), lastActiveAt: new Date() },
  });
}

/** Records the resume pointer only for a run that's still in progress —
 *  viewing a completed or archived run never moves its historical position. */
export async function recordBacktestPosition(userId: string, runId: string, dateKey: string): Promise<boolean> {
  const run = await requireBacktestRun(userId, runId);
  if (run.status !== "ACTIVE") return false;
  assertDateWithinRun(run, dateKey);
  if (!isTradingDay(toRunPeriod(run), dateKey)) return false;
  await prisma.backtestRun.update({
    where: { id: run.id },
    data: { lastSessionDate: dateKeyToUtcDate(dateKey), lastActiveAt: new Date() },
  });
  return true;
}

// ── Overview (Stage 2) ──────────────────────────────────────────────────────

/**
 * Builds overview DTOs for many runs with a fixed number of queries
 * regardless of run count: one for completed days, one grouped count each for
 * executed and missed trades, and one strategy snapshot capture per DISTINCT
 * live strategy (for the drift indicator). These queries name
 * `backtestRunId` explicitly, which is the deliberate cross-run override of
 * the workspace-scope extension; `groupBy` isn't covered by the soft-delete
 * extension, so `deletedAt: null` is explicit too.
 */
async function buildOverviews(userId: string, runs: BacktestRun[]): Promise<BacktestRunOverviewDTO[]> {
  if (runs.length === 0) return [];
  const runIds = runs.map((r) => r.id);

  const [completedDays, tradeRecords, missed] = await Promise.all([
    prisma.tradingDay.findMany({
      where: { userId, backtestRunId: { in: runIds }, status: "ARCHIVED" },
      select: { backtestRunId: true, date: true },
    }),
    // One batched canonical load for every run (explicit backtestRunId = the
    // deliberate cross-run override), mapped through the SAME canonical row
    // builder + price-derived settlement as Backtesting Analytics.
    prisma.trade.findMany({
      where: { userId, backtestRunId: { in: runIds } },
      include: canonicalTradeInclude,
      orderBy: [{ tradeDate: "asc" }, { executionMinutes: "asc" }],
    }),
    prisma.tradeOpportunity.groupBy({
      by: ["backtestRunId"],
      where: { userId, backtestRunId: { in: runIds }, deletedAt: null, status: "MISSED" },
      _count: { _all: true },
    }),
  ]);

  const completedByRun = new Map<string, string[]>();
  for (const d of completedDays) {
    const list = completedByRun.get(d.backtestRunId!) ?? [];
    list.push(utcDateToKey(d.date));
    completedByRun.set(d.backtestRunId!, list);
  }
  const rowsByRun = new Map<string, CanonicalAnalyticsTradeRow[]>();
  for (const t of tradeRecords) {
    const list = rowsByRun.get(t.backtestRunId!) ?? [];
    list.push(toCanonicalRow(t, "PRICE_DERIVED"));
    rowsByRun.set(t.backtestRunId!, list);
  }
  const missedByRun = new Map(missed.map((g) => [g.backtestRunId!, g._count._all]));

  const strategyIds = [...new Set(runs.map((r) => r.strategyId).filter((id): id is string => id != null))];
  const currentSnapshots = new Map(
    await Promise.all(
      strategyIds.map(async (id) => [id, (await captureStrategySnapshot(userId, id))?.snapshot ?? null] as const),
    ),
  );

  return runs.map((run) => {
    const period = toRunPeriod(run);
    const completed = completedByRun.get(run.id) ?? [];
    const position = run.lastSessionDate ? utcDateToKey(run.lastSessionDate) : null;
    const hadStrategy = run.strategySnapshot != null;
    return {
      id: run.id,
      name: run.name,
      description: run.description,
      status: run.status,
      strategy: hadStrategy
        ? { id: run.strategyId, name: run.strategyNameSnapshot ?? "Strategy", version: run.strategyVersionSnapshot }
        : null,
      strategyDrift: detectStrategyDrift({
        hadStrategy,
        frozenSnapshot: run.strategySnapshot,
        currentSnapshot: run.strategyId ? (currentSnapshots.get(run.strategyId) ?? null) : null,
      }),
      assets: run.assets,
      startDateKey: period.startDateKey,
      endDateKey: period.endDateKey,
      tradingWeekdays: run.tradingWeekdays,
      progress: computeRunProgress(period, completed),
      currentPositionDateKey: position,
      resumeDateKey: resumeDateKey(period, position, position != null && completed.includes(position)),
      lastActiveAt: run.lastActiveAt?.toISOString() ?? null,
      stats: runStats(rowsByRun.get(run.id) ?? [], missedByRun.get(run.id) ?? 0),
      simulation: {
        startingBalance: run.startingBalance?.toNumber() ?? null,
        riskPercentPerTrade: run.riskPercentPerTrade?.toNumber() ?? null,
        currency: run.currency,
      },
      createdAt: run.createdAt.toISOString(),
      archivedAt: run.archivedAt?.toISOString() ?? null,
    };
  });
}

function runStats(rows: CanonicalAnalyticsTradeRow[], missedTrades: number): BacktestRunOverviewDTO["stats"] {
  const stats = computeRGroupStats("run", "Run", rows);
  const finalized = rows.filter((r) => r.isExecuted && r.finalizedR != null);
  return {
    executedTrades: stats.count,
    closedTrades: stats.finalizedCount,
    netR: finalized.length ? finalized.reduce((s, r) => s + r.finalizedR!, 0) : null,
    winRate: stats.winRate,
    missedTrades,
  };
}

/** Every run the user owns, most recently worked-on first. */
/** The most recently worked-on ACTIVE run — what the Backtesting nav links
 *  Session/Journal/Analytics to outside a run's own pages. */
export async function getCurrentActiveRunId(userId: string): Promise<string | null> {
  const run = await prisma.backtestRun.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: [{ lastActiveAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true },
  });
  return run?.id ?? null;
}

export async function listBacktestRunOverviews(userId: string): Promise<BacktestRunOverviewDTO[]> {
  const runs = await prisma.backtestRun.findMany({
    where: { userId },
    orderBy: [{ lastActiveAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return buildOverviews(userId, runs);
}

export async function getBacktestRunOverview(userId: string, runId: string): Promise<BacktestRunOverviewDTO | null> {
  const run = await getBacktestRun(userId, runId);
  if (!run) return null;
  const [overview] = await buildOverviews(userId, [run]);
  return overview;
}

// ── Status (Stage 2) ────────────────────────────────────────────────────────

/**
 * ACTIVE ⇄ COMPLETED ⇄ ARCHIVED, always an explicit trader decision — reaching
 * the last date never completes a run on its own. Archiving keeps every
 * simulated day, trade, screenshot and the strategy snapshot intact; it only
 * moves the run out of the active view.
 */
export async function setBacktestRunStatus(
  userId: string,
  runId: string,
  status: BacktestRunStatusValue,
): Promise<BacktestRun> {
  const run = await requireBacktestRun(userId, runId);
  return prisma.backtestRun.update({
    where: { id: run.id },
    data: { status, archivedAt: status === "ARCHIVED" ? (run.archivedAt ?? new Date()) : null },
  });
}

// ── Delete (Stage 2) ────────────────────────────────────────────────────────

export interface DeleteBacktestRunResult {
  deletedTrades: number;
  deletedMediaAssets: number;
  /** Storage objects whose removal failed after the DB commit. They are no
   *  longer referenced by any row (so never served), only left as bytes. */
  storageCleanupFailures: number;
}

/**
 * Permanently deletes a run and everything it owns.
 *
 * Media has no FK to its owner, so the run's screenshots are resolved first:
 * every MediaAttachment on the run's trades (TRADE), asset analyses
 * (DAILY_ASSET_ANALYSIS) and daily notes (DAILY_NOTE), plus the original/preview assets of its trades'
 * TradePlanScreenshots. Owner ids are read with raw SQL so SOFT-DELETED
 * trades/analyses are included — their screenshots would otherwise leak.
 *
 * One transaction then: removes those attachments, deletes the run (FK
 * cascades remove days, trades, opportunities, plan versions/screenshots,
 * targets, partial exits, labels, psychology, analyses, evidence), and
 * deletes each candidate MediaAsset ONLY if nothing references it anymore —
 * so an asset that is also attached to a live record or another run is kept.
 *
 * Storage objects are deleted only AFTER the commit, best-effort. If the
 * transaction fails nothing is touched; if a storage delete fails the DB is
 * already consistent and the object is simply unreferenced bytes in the
 * private bucket (reported, never served). Deleting storage first would risk
 * the opposite — rows pointing at missing files.
 */
export async function deleteBacktestRun(userId: string, runId: string): Promise<DeleteBacktestRunResult> {
  const run = await requireBacktestRun(userId, runId);

  const { storageKeys, deletedTrades } = await prisma.$transaction(async (tx) => {
    const tradeIds = (
      await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Trade" WHERE "backtestRunId" = ${run.id} AND "userId" = ${userId}
      `
    ).map((r) => r.id);
    const analysisIds = (
      await tx.$queryRaw<{ id: string }[]>`
        SELECT a."id" FROM "DailyAssetAnalysis" a
        JOIN "TradingDay" d ON d."id" = a."tradingDayId"
        WHERE d."backtestRunId" = ${run.id} AND d."userId" = ${userId}
      `
    ).map((r) => r.id);

    const noteIds = (
      await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "DailyNote" WHERE "backtestRunId" = ${run.id} AND "userId" = ${userId}
      `
    ).map((r) => r.id);

    const owners = [
      { ownerType: "TRADE" as const, ownerIds: tradeIds },
      { ownerType: "DAILY_ASSET_ANALYSIS" as const, ownerIds: analysisIds },
      { ownerType: "DAILY_NOTE" as const, ownerIds: noteIds },
    ];
    const candidateAssetIds = await collectMediaCandidates(tx, userId, owners, tradeIds);
    await removeOwnerAttachments(tx, userId, owners);
    await tx.backtestRun.delete({ where: { id: run.id } });
    const storageKeys = await deleteUnreferencedMediaAssets(tx, userId, candidateAssetIds);
    return { storageKeys, deletedTrades: tradeIds.length };
  });

  const results = await Promise.allSettled(storageKeys.map((key) => deleteMediaFile(key)));
  const failures = results.filter((r) => r.status === "rejected").length;
  if (failures > 0) {
    console.error(`[backtest-run] ${failures}/${storageKeys.length} storage objects could not be removed for deleted run ${run.id}`);
  }

  return { deletedTrades, deletedMediaAssets: storageKeys.length, storageCleanupFailures: failures };
}
