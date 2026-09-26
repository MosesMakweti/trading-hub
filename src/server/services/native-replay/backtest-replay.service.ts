/**
 * Native Replay — the authoritative replay clock.
 *
 * ONE clock per Backtest Run × simulation date (BacktestReplayPosition): the
 * run's shared simulated WORLD time. Every asset of the run is seen as of it —
 * its latest real bar at or before world time — so no asset can reveal
 * information later than any other (per-asset clocks allowed EURUSD at 10:00
 * to inform a GBPUSD decision at 09:20).
 *
 *   browser: "GBPUSD M30 candles"  →  server: world = 09:37 → GBPUSD M1 ≤ 09:37 → M30
 *
 * The browser never supplies a cutoff; it can only ask the clock to move —
 * forward, inside the date — and every move is one locked transaction. The
 * database backs this up: world time only increases, stays in its date, and is
 * always a minute at which one of the run's datasets has a real bar.
 *
 * THE TIMELINE is the union of the real M1 bar minutes of the run's pinned
 * datasets on that date. Semantics (docs/NATIVE_REPLAY.md › Replay clock):
 * - initial world time: the earliest bar of the date across the run's datasets;
 * - +N: the N-th next timeline minute (a minute any asset traded) — gaps are
 *   crossed, never filled; an asset without a bar at that minute simply keeps
 *   showing its latest earlier bar;
 * - +1 displayed candle: to the last timeline minute of the candle the next
 *   timeline minute belongs to ("finish the current candle", then one whole
 *   candle per press);
 * - seek: to the last timeline minute at or before a later wall-clock time today;
 * - no rewind; the date's last timeline minute is the end of the day;
 * - read-only (completed/archived) runs: readable, never moved.
 */
import { Prisma, type BacktestRun } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { bucketEnd, bucketStart, isReplayTimeframe, type ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { formatWallClock, MINUTES_PER_DAY, parseWallClock, type WallClockMinute } from "@/domain/native-replay/wall-clock";
import { assertDateWithinRun, requireBacktestRun } from "@/server/services/backtest-run.service";
import { getHistoricalCandles, type CandleDTO, type CandlesResult } from "@/server/services/native-replay/historical-candles.service";

/** Largest single +N step: one full day of M1. */
export const MAX_STEP_BARS = 1440;
const RECENT_COMMANDS = 32;

/** The clock: one per run × simulation date. */
export interface ReplayClockRef {
  runId: string;
  dateKey: string;
}

/** A view of one asset at the clock's world time. */
export interface ReplayRef extends ReplayClockRef {
  assetSymbol: string;
}

/** A refusal meant for the trader (message shown verbatim). */
export class ReplayError extends Error {}
/** Unknown run/asset for this user — indistinguishable from someone else's. */
export class ReplayNotFoundError extends Error {
  constructor() {
    super("Replay not found.");
  }
}

export type ReplayCommand =
  | { kind: "BARS"; count: number }
  | { kind: "CANDLE"; timeframe: ReplayTimeframe }
  | { kind: "SEEK"; to: WallClockMinute };

export type ReplayStatus = "NO_DATASETS" | "NO_BARS_FOR_DATE" | "NOT_STARTED" | "ACTIVE";

export interface ReplayAssetDTO {
  assetSymbol: string;
  dataset: { id: string; symbol: string; sourceSymbol: string; priceScale: number; timeBasis: "BROKER_SERVER"; frozen: boolean } | null;
  /** This asset's bars on the date (null: no dataset, or no bars that day). */
  day: { firstBar: string; lastBar: string; barCount: number } | null;
  /** Its latest real bar at or before world time (null before its first bar of the day). */
  latestBar: string | null;
}

export interface ReplayStateDTO {
  runId: string;
  dateKey: string;
  readOnly: boolean;
  status: ReplayStatus;
  assets: ReplayAssetDTO[];
  /** The date's timeline across all of the run's datasets. */
  day: { firstBar: string; lastBar: string; firstMinute: number; lastMinute: number; minutes: number } | null;
  position: { minute: number; time: string; version: number; atDayEnd: boolean; revealedMinutes: number } | null;
}

export interface AdvanceResult {
  /** False when this command id was already applied (a retry) — nothing moved again. */
  applied: boolean;
  moved: boolean;
  fromMinute: number;
  toMinute: number;
  /** The viewed asset's M1 bars revealed by this command, ascending (for incremental chart updates). */
  revealed: CandleDTO[];
  state: ReplayStateDTO;
}

interface Context {
  run: BacktestRun;
  ref: ReplayClockRef;
  dayStart: WallClockMinute;
  dayEnd: WallClockMinute;
}

async function resolve(userId: string, ref: ReplayClockRef, mode: "read" | "write"): Promise<Context> {
  const run = await requireBacktestRun(userId, ref.runId);
  assertDateWithinRun(run, ref.dateKey);
  if (mode === "write" && run.status !== "ACTIVE") throw new ReplayError("This run is read-only — replay can be viewed but not advanced.");
  const dayStart = parseWallClock(`${ref.dateKey}T00:00`);
  if (dayStart == null) throw new ReplayNotFoundError();
  return { run, ref, dayStart, dayEnd: dayStart + MINUTES_PER_DAY - 1 };
}

function loadPins(ctx: Context) {
  return prisma.backtestRunDataset.findMany({ where: { backtestRunId: ctx.run.id }, include: { dataset: true } });
}

/** Dataset keys (HistoricalDataset.seq) of the run's READY pinned datasets — the timeline's sources. */
async function timelineSeqs(tx: TransactionClient | typeof prisma, runId: string): Promise<number[]> {
  const rows = await tx.$queryRaw<{ seq: number }[]>`
    SELECT d."seq" FROM "BacktestRunDataset" p JOIN "HistoricalDataset" d ON d."id" = p."datasetId"
    WHERE p."backtestRunId" = ${runId} AND d."status" = 'READY'
  `;
  return rows.map((r) => r.seq);
}

function findPosition(userId: string, ctx: Context) {
  return prisma.backtestReplayPosition.findFirst({
    where: { userId, backtestRunId: ctx.run.id, simulationDate: new Date(`${ctx.ref.dateKey}T00:00:00Z`) },
  });
}

async function buildState(userId: string, ctx: Context): Promise<ReplayStateDTO> {
  const base = { runId: ctx.run.id, dateKey: ctx.ref.dateKey, readOnly: ctx.run.status !== "ACTIVE" };
  const [pins, pos] = await Promise.all([loadPins(ctx), findPosition(userId, ctx)]);
  const world = pos?.currentMinute ?? null;
  const readyPins = pins.filter((p) => p.dataset.status === "READY");
  const perSeq = readyPins.length
    ? await prisma.$queryRaw<{ seq: number; first: number; last: number; count: number; latest: number | null }[]>`
        SELECT "datasetSeq" AS seq, min("minute") AS first, max("minute") AS last, count(*)::int AS count,
               max("minute") FILTER (WHERE "minute" <= ${world ?? -1}) AS latest
        FROM "HistoricalBar"
        WHERE "datasetSeq" = ANY(${readyPins.map((p) => p.dataset.seq)}::int4[]) AND "minute" BETWEEN ${ctx.dayStart} AND ${ctx.dayEnd}
        GROUP BY "datasetSeq"
      `
    : [];
  const bySeq = new Map(perSeq.map((r) => [r.seq, r]));

  const assets: ReplayAssetDTO[] = ctx.run.assets.map((assetSymbol) => {
    const pin = pins.find((p) => p.assetSymbol === assetSymbol);
    if (!pin) return { assetSymbol, dataset: null, day: null, latestBar: null };
    const ds = pin.dataset;
    const d = bySeq.get(ds.seq);
    return {
      assetSymbol,
      dataset: { id: ds.id, symbol: ds.symbol, sourceSymbol: ds.sourceSymbol, priceScale: ds.priceScale, timeBasis: ds.timeBasis, frozen: pin.frozenAt != null },
      day: d ? { firstBar: formatWallClock(d.first), lastBar: formatWallClock(d.last), barCount: d.count } : null,
      latestBar: d?.latest != null ? formatWallClock(d.latest) : null,
    };
  });

  if (readyPins.length === 0) return { ...base, status: "NO_DATASETS", assets, day: null, position: null };
  if (perSeq.length === 0) return { ...base, status: "NO_BARS_FOR_DATE", assets, day: null, position: null };
  const [timeline] = await prisma.$queryRaw<{ minutes: number; revealed: number }[]>`
    SELECT count(DISTINCT "minute")::int AS minutes, count(DISTINCT "minute") FILTER (WHERE "minute" <= ${world ?? -1})::int AS revealed
    FROM "HistoricalBar"
    WHERE "datasetSeq" = ANY(${readyPins.map((p) => p.dataset.seq)}::int4[]) AND "minute" BETWEEN ${ctx.dayStart} AND ${ctx.dayEnd}
  `;
  const firstMinute = Math.min(...perSeq.map((r) => r.first));
  const lastMinute = Math.max(...perSeq.map((r) => r.last));
  const day = { firstBar: formatWallClock(firstMinute), lastBar: formatWallClock(lastMinute), firstMinute, lastMinute, minutes: timeline.minutes };
  if (!pos) return { ...base, status: "NOT_STARTED", assets, day, position: null };
  return {
    ...base,
    status: "ACTIVE",
    assets,
    day,
    position: { minute: pos.currentMinute, time: formatWallClock(pos.currentMinute), version: pos.version, atDayEnd: pos.currentMinute >= lastMinute, revealedMinutes: timeline.revealed },
  };
}

export async function getReplayState(userId: string, ref: ReplayClockRef): Promise<ReplayStateDTO> {
  return buildState(userId, await resolve(userId, ref, "read"));
}

/**
 * Starts the run's clock for a date at the earliest bar of that date across
 * its datasets. Idempotent. The run's first position freezes all its pins.
 */
export async function initializeReplay(userId: string, ref: ReplayClockRef): Promise<ReplayStateDTO> {
  const ctx = await resolve(userId, ref, "write");
  const seqs = await timelineSeqs(prisma, ctx.run.id);
  if (seqs.length === 0) throw new ReplayError("No historical dataset is attached to this run — attach MT5 M1 data on the Historical data page.");
  const [row] = await prisma.$queryRaw<{ first: number | null }[]>`
    SELECT min("minute") AS first FROM "HistoricalBar" WHERE "datasetSeq" = ANY(${seqs}::int4[]) AND "minute" BETWEEN ${ctx.dayStart} AND ${ctx.dayEnd}
  `;
  if (row.first == null) throw new ReplayError(`None of this run's datasets has market data on ${ref.dateKey}.`);
  try {
    await prisma.backtestReplayPosition.create({
      data: { userId, backtestRunId: ctx.run.id, simulationDate: new Date(`${ref.dateKey}T00:00:00Z`), currentMinute: row.first },
    });
  } catch (error) {
    // Already started (e.g. two tabs at once) — keep the existing position.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
  return buildState(userId, ctx);
}

interface LockedPosition {
  id: string;
  currentMinute: number;
  recentCommands: { id: string; from: number; to: number }[];
}

/** The target world minute for a command, or null to stay put. Pure SQL over immutable bars. */
async function targetMinute(tx: TransactionClient, seqs: number[], cur: number, command: ReplayCommand, ctx: Context): Promise<number | null> {
  const { dayStart, dayEnd } = ctx;
  if (command.kind === "BARS") {
    const [row] = await tx.$queryRaw<{ m: number | null }[]>`
      SELECT max(m) AS m FROM (
        SELECT DISTINCT "minute" AS m FROM "HistoricalBar"
        WHERE "datasetSeq" = ANY(${seqs}::int4[]) AND "minute" > ${cur} AND "minute" <= ${dayEnd}
        ORDER BY m LIMIT ${command.count}
      ) s
    `;
    return row.m;
  }
  if (command.kind === "CANDLE") {
    const [next] = await tx.$queryRaw<{ m: number | null }[]>`
      SELECT min("minute") AS m FROM "HistoricalBar" WHERE "datasetSeq" = ANY(${seqs}::int4[]) AND "minute" > ${cur} AND "minute" <= ${dayEnd}
    `;
    if (next.m == null) return null;
    const candleLast = Math.min(bucketEnd(bucketStart(next.m, command.timeframe), command.timeframe) - 1, dayEnd);
    const [row] = await tx.$queryRaw<{ m: number | null }[]>`
      SELECT max("minute") AS m FROM "HistoricalBar" WHERE "datasetSeq" = ANY(${seqs}::int4[]) AND "minute" BETWEEN ${next.m} AND ${candleLast}
    `;
    return row.m;
  }
  // SEEK
  if (command.to < dayStart || command.to > dayEnd) throw new ReplayError("You can only jump within the current simulation day.");
  if (command.to < cur) throw new ReplayError("Replay only moves forward — you can scroll back over what's already revealed on the chart.");
  const [row] = await tx.$queryRaw<{ m: number | null }[]>`
    SELECT max("minute") AS m FROM "HistoricalBar" WHERE "datasetSeq" = ANY(${seqs}::int4[]) AND "minute" > ${cur} AND "minute" <= ${command.to}
  `;
  return row.m;
}

function validateCommand(command: ReplayCommand): void {
  if (command.kind === "BARS" && (!Number.isInteger(command.count) || command.count < 1 || command.count > MAX_STEP_BARS)) {
    throw new ReplayError(`Step between 1 and ${MAX_STEP_BARS} bars.`);
  }
  if (command.kind === "CANDLE" && !isReplayTimeframe(command.timeframe)) throw new ReplayError("Unknown timeframe.");
  if (command.kind === "SEEK" && !Number.isInteger(command.to)) throw new ReplayError("Invalid time.");
}

/**
 * Moves the run's world clock. Atomic: the position row is locked for the
 * whole read-compute-write, so concurrent commands apply one after another. A
 * `commandId` makes a retried request safe — if that id was already applied,
 * the earlier result is returned and nothing moves again. `viewAsset` (one of
 * the run's assets) selects whose newly revealed M1 bars come back.
 */
export async function advanceReplay(
  userId: string,
  ref: ReplayClockRef,
  command: ReplayCommand,
  commandId?: string | null,
  viewAsset?: string | null,
): Promise<AdvanceResult> {
  validateCommand(command);
  const ctx = await resolve(userId, ref, "write");
  if (viewAsset != null && !ctx.run.assets.includes(viewAsset)) throw new ReplayNotFoundError();
  const outcome = await prisma.$transaction(async (tx) => {
    const [pos] = await tx.$queryRaw<LockedPosition[]>`
      SELECT "id", "currentMinute", "recentCommands" FROM "BacktestReplayPosition"
      WHERE "userId" = ${userId} AND "backtestRunId" = ${ctx.run.id} AND "simulationDate" = ${ref.dateKey}::date
      FOR UPDATE
    `;
    if (!pos) throw new ReplayError("Replay hasn't started for this day yet.");
    const seen = commandId ? pos.recentCommands.find((c) => c.id === commandId) : undefined;
    if (seen) return { applied: false, from: seen.from, to: seen.to };

    const seqs = await timelineSeqs(tx, ctx.run.id);
    const target = seqs.length ? await targetMinute(tx, seqs, pos.currentMinute, command, ctx) : null;
    const to = target != null && target > pos.currentMinute ? target : pos.currentMinute;
    const recent = commandId ? [...pos.recentCommands, { id: commandId, from: pos.currentMinute, to }].slice(-RECENT_COMMANDS) : pos.recentCommands;
    if (to !== pos.currentMinute || commandId) {
      await tx.$executeRaw`
        UPDATE "BacktestReplayPosition"
        SET "currentMinute" = ${to},
            "version" = "version" + ${to !== pos.currentMinute ? 1 : 0},
            "recentCommands" = ${JSON.stringify(recent)}::jsonb,
            "updatedAt" = NOW()
        WHERE "id" = ${pos.id}
      `;
    }
    return { applied: true, from: pos.currentMinute, to };
  });

  const state = await buildState(userId, ctx);
  let revealed: CandleDTO[] = [];
  const viewed = viewAsset ? state.assets.find((a) => a.assetSymbol === viewAsset)?.dataset : null;
  if (viewed && outcome.to > outcome.from) {
    revealed = (await getHistoricalCandles(userId, { datasetId: viewed.id, timeframe: "M1", cutoff: outcome.to, from: outcome.from + 1, to: outcome.to, limit: MAX_STEP_BARS })).candles;
  }
  return { applied: outcome.applied, moved: outcome.to > outcome.from, fromMinute: outcome.from, toMinute: outcome.to, revealed, state };
}

export interface ReplayCandlesResult extends CandlesResult {
  assetSymbol: string;
  position: { minute: number; time: string; version: number };
}

/**
 * One asset's candles as of the run's STORED world time. The caller chooses
 * the asset, timeframe, how many candles and (to pan back over revealed
 * history) an earlier `to` — never the cutoff: nothing after world time is
 * reachable, for any asset.
 */
export async function getReplayCandles(
  userId: string,
  ref: ReplayRef,
  query: { timeframe: ReplayTimeframe; limit?: number | null; to?: WallClockMinute | null },
): Promise<ReplayCandlesResult> {
  if (!isReplayTimeframe(query.timeframe)) throw new ReplayError("Unknown timeframe.");
  const ctx = await resolve(userId, ref, "read");
  if (!ctx.run.assets.includes(ref.assetSymbol)) throw new ReplayNotFoundError();
  const [pos, pin] = await Promise.all([
    findPosition(userId, ctx),
    prisma.backtestRunDataset.findUnique({ where: { backtestRunId_assetSymbol: { backtestRunId: ctx.run.id, assetSymbol: ref.assetSymbol } } }),
  ]);
  if (!pos) throw new ReplayError("Replay hasn't started for this day yet.");
  if (!pin) throw new ReplayError(`No historical dataset is attached to ${ref.assetSymbol}.`);
  const cutoff = pos.currentMinute;
  const result = await getHistoricalCandles(userId, {
    datasetId: pin.datasetId,
    timeframe: query.timeframe,
    cutoff,
    to: query.to == null ? null : Math.min(query.to, cutoff),
    limit: query.limit ?? null,
  });
  return { ...result, assetSymbol: ref.assetSymbol, position: { minute: cutoff, time: formatWallClock(cutoff), version: pos.version } };
}
