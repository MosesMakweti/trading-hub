/**
 * Native Replay — the authoritative replay clock.
 *
 * One position per Backtest Run × simulation date × asset
 * (BacktestReplayPosition): the open time of the latest REVEALED M1 bar.
 * Everything a replay chart may see is derived from it:
 *
 *   browser: "M30 candles, please"  →  server: position = 09:17 → M1 ≤ 09:17 → M30
 *
 * The browser never supplies a cutoff. It can only ask the clock to move —
 * forward, to real bars, inside the simulation date — and every move is one
 * locked transaction (no lost or doubled advances). The database backs this up
 * independently: positions only increase, always sit on an actual bar, and
 * never leave their date.
 *
 * Semantics (docs/NATIVE_REPLAY.md › Replay clock):
 * - initial position: the first M1 bar of the simulation date;
 * - +N bars: the N-th next actual bar (gaps are skipped, never filled);
 * - +1 displayed candle: to the last bar of the candle the next bar opens or
 *   continues — i.e. "finish the current candle", then one whole candle per press;
 * - seek: to the last bar at or before a wall-clock time later today;
 * - no rewind: the clock never moves back (the chart may pan over revealed history);
 * - the day's last bar is the end — the next day is an explicit Session move;
 * - read-only (completed/archived) runs keep their positions and candles; only
 *   movement is refused.
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

export interface ReplayRef {
  runId: string;
  dateKey: string;
  assetSymbol: string;
}

/** A refusal meant for the trader (message shown verbatim). */
export class ReplayError extends Error {}
/** Unknown run/asset/position for this user — indistinguishable from someone else's. */
export class ReplayNotFoundError extends Error {
  constructor() {
    super("Replay not found.");
  }
}

export type ReplayCommand =
  | { kind: "BARS"; count: number }
  | { kind: "CANDLE"; timeframe: ReplayTimeframe }
  | { kind: "SEEK"; to: WallClockMinute };

export type ReplayStatus = "NO_DATASET" | "NO_BARS_FOR_DATE" | "NOT_STARTED" | "ACTIVE";

export interface ReplayStateDTO {
  runId: string;
  dateKey: string;
  assetSymbol: string;
  readOnly: boolean;
  status: ReplayStatus;
  dataset: { id: string; symbol: string; sourceSymbol: string; priceScale: number; timeBasis: "BROKER_SERVER" } | null;
  day: { firstBar: string; lastBar: string; firstMinute: number; lastMinute: number; barCount: number } | null;
  position: { minute: number; time: string; version: number; atDayEnd: boolean; revealedBarsToday: number } | null;
}

export interface AdvanceResult {
  /** False when this command id was already applied (a retry) — nothing moved again. */
  applied: boolean;
  moved: boolean;
  fromMinute: number;
  toMinute: number;
  /** The M1 bars revealed by this command, ascending (for display animation). */
  revealed: CandleDTO[];
  state: ReplayStateDTO;
}

interface Context {
  run: BacktestRun;
  ref: ReplayRef;
  dayStart: WallClockMinute;
}

async function resolve(userId: string, ref: ReplayRef, mode: "read" | "write"): Promise<Context> {
  const run = await requireBacktestRun(userId, ref.runId);
  assertDateWithinRun(run, ref.dateKey);
  if (!run.assets.includes(ref.assetSymbol)) throw new ReplayNotFoundError();
  if (mode === "write" && run.status !== "ACTIVE") throw new ReplayError("This run is read-only — replay can be viewed but not advanced.");
  const dayStart = parseWallClock(`${ref.dateKey}T00:00`);
  if (dayStart == null) throw new ReplayNotFoundError();
  return { run, ref, dayStart };
}

function findPin(ctx: Context) {
  return prisma.backtestRunDataset.findUnique({
    where: { backtestRunId_assetSymbol: { backtestRunId: ctx.run.id, assetSymbol: ctx.ref.assetSymbol } },
    include: { dataset: true },
  });
}

function findPosition(userId: string, ctx: Context) {
  return prisma.backtestReplayPosition.findFirst({
    where: { userId, backtestRunId: ctx.run.id, assetSymbol: ctx.ref.assetSymbol, simulationDate: new Date(`${ctx.ref.dateKey}T00:00:00Z`) },
  });
}

async function dayBars(datasetSeq: number, dayStart: number): Promise<{ first: number; last: number; count: number } | null> {
  const [row] = await prisma.$queryRaw<{ first: number | null; last: number | null; count: number }[]>`
    SELECT min("minute") AS first, max("minute") AS last, count(*)::int AS count
    FROM "HistoricalBar" WHERE "datasetSeq" = ${datasetSeq} AND "minute" BETWEEN ${dayStart} AND ${dayStart + MINUTES_PER_DAY - 1}
  `;
  return row.first == null || row.last == null ? null : { first: row.first, last: row.last, count: row.count };
}

async function countBars(datasetSeq: number, from: number, to: number): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "HistoricalBar" WHERE "datasetSeq" = ${datasetSeq} AND "minute" BETWEEN ${from} AND ${to}
  `;
  return row.n;
}

async function buildState(userId: string, ctx: Context): Promise<ReplayStateDTO> {
  const base = { runId: ctx.run.id, dateKey: ctx.ref.dateKey, assetSymbol: ctx.ref.assetSymbol, readOnly: ctx.run.status !== "ACTIVE" };
  const pin = await findPin(ctx);
  if (!pin) return { ...base, status: "NO_DATASET", dataset: null, day: null, position: null };
  const ds = pin.dataset;
  const dataset = { id: ds.id, symbol: ds.symbol, sourceSymbol: ds.sourceSymbol, priceScale: ds.priceScale, timeBasis: ds.timeBasis };
  const bars = await dayBars(ds.seq, ctx.dayStart);
  if (!bars) return { ...base, status: "NO_BARS_FOR_DATE", dataset, day: null, position: null };
  const day = { firstBar: formatWallClock(bars.first), lastBar: formatWallClock(bars.last), firstMinute: bars.first, lastMinute: bars.last, barCount: bars.count };
  const pos = await findPosition(userId, ctx);
  if (!pos) return { ...base, status: "NOT_STARTED", dataset, day, position: null };
  return {
    ...base,
    status: "ACTIVE",
    dataset,
    day,
    position: {
      minute: pos.currentMinute,
      time: formatWallClock(pos.currentMinute),
      version: pos.version,
      atDayEnd: pos.currentMinute >= pos.dayLastMinute,
      revealedBarsToday: await countBars(ds.seq, pos.dayFirstMinute, pos.currentMinute),
    },
  };
}

export async function getReplayState(userId: string, ref: ReplayRef): Promise<ReplayStateDTO> {
  return buildState(userId, await resolve(userId, ref, "read"));
}

/** Replay state for every asset of the run on one date (the Session's status area). */
export async function getRunReplayStates(userId: string, runId: string, dateKey: string): Promise<ReplayStateDTO[]> {
  const run = await requireBacktestRun(userId, runId);
  return Promise.all(run.assets.map((assetSymbol) => getReplayState(userId, { runId, dateKey, assetSymbol })));
}

/**
 * Starts replay for run × date × asset at the date's first M1 bar. Idempotent:
 * an existing position is returned unchanged. Creating the first position on a
 * pin freezes the pin (DB trigger).
 */
export async function initializeReplay(userId: string, ref: ReplayRef): Promise<ReplayStateDTO> {
  const ctx = await resolve(userId, ref, "write");
  const pin = await findPin(ctx);
  if (!pin) throw new ReplayError(`No historical dataset is attached for ${ref.assetSymbol} — attach one on the Historical data page.`);
  if (pin.dataset.status !== "READY") throw new ReplayError("The attached dataset isn't ready.");
  const bars = await dayBars(pin.dataset.seq, ctx.dayStart);
  if (!bars) throw new ReplayError(`The ${pin.dataset.symbol} dataset has no bars on ${ref.dateKey}.`);
  try {
    await prisma.backtestReplayPosition.create({
      data: {
        userId,
        backtestRunId: ctx.run.id,
        pinId: pin.id,
        datasetId: pin.datasetId,
        assetSymbol: ref.assetSymbol,
        simulationDate: new Date(`${ref.dateKey}T00:00:00Z`),
        currentMinute: bars.first,
        dayFirstMinute: bars.first,
        dayLastMinute: bars.last,
      },
    });
  } catch (error) {
    // Already started (e.g. two tabs initialising at once) — keep the existing position.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
  return buildState(userId, ctx);
}

interface LockedPosition {
  id: string;
  currentMinute: number;
  dayFirstMinute: number;
  dayLastMinute: number;
  recentCommands: { id: string; from: number; to: number }[];
  seq: number;
}

/** The target bar for a command, or null to stay put. Pure SQL over immutable bars. */
async function targetMinute(tx: TransactionClient, pos: LockedPosition, command: ReplayCommand, dayStart: number): Promise<number | null> {
  const cur = pos.currentMinute;
  const last = pos.dayLastMinute;
  if (command.kind === "BARS") {
    const [row] = await tx.$queryRaw<{ m: number | null }[]>`
      SELECT max("minute") AS m FROM (
        SELECT "minute" FROM "HistoricalBar"
        WHERE "datasetSeq" = ${pos.seq} AND "minute" > ${cur} AND "minute" <= ${last}
        ORDER BY "minute" LIMIT ${command.count}
      ) s
    `;
    return row.m;
  }
  if (command.kind === "CANDLE") {
    const [next] = await tx.$queryRaw<{ m: number | null }[]>`
      SELECT min("minute") AS m FROM "HistoricalBar" WHERE "datasetSeq" = ${pos.seq} AND "minute" > ${cur} AND "minute" <= ${last}
    `;
    if (next.m == null) return null;
    const candleLast = Math.min(bucketEnd(bucketStart(next.m, command.timeframe), command.timeframe) - 1, last);
    const [row] = await tx.$queryRaw<{ m: number | null }[]>`
      SELECT max("minute") AS m FROM "HistoricalBar" WHERE "datasetSeq" = ${pos.seq} AND "minute" BETWEEN ${next.m} AND ${candleLast}
    `;
    return row.m;
  }
  // SEEK
  if (command.to < dayStart || command.to > dayStart + MINUTES_PER_DAY - 1) throw new ReplayError("You can only jump within the current simulation day.");
  if (command.to < cur) throw new ReplayError("Replay only moves forward — you can scroll back over what's already revealed on the chart.");
  const [row] = await tx.$queryRaw<{ m: number | null }[]>`
    SELECT max("minute") AS m FROM "HistoricalBar" WHERE "datasetSeq" = ${pos.seq} AND "minute" > ${cur} AND "minute" <= ${Math.min(command.to, last)}
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
 * Moves the clock. Atomic: the position row is locked for the whole
 * read-compute-write, so concurrent commands apply one after another. A
 * `commandId` makes a retried request safe — if that id was already applied,
 * the earlier result is returned and nothing moves again.
 */
export async function advanceReplay(userId: string, ref: ReplayRef, command: ReplayCommand, commandId?: string | null): Promise<AdvanceResult> {
  validateCommand(command);
  const ctx = await resolve(userId, ref, "write");
  const outcome = await prisma.$transaction(async (tx) => {
    const [pos] = await tx.$queryRaw<LockedPosition[]>`
      SELECT p."id", p."currentMinute", p."dayFirstMinute", p."dayLastMinute", p."recentCommands", d."seq"
      FROM "BacktestReplayPosition" p
      JOIN "HistoricalDataset" d ON d."id" = p."datasetId"
      WHERE p."userId" = ${userId} AND p."backtestRunId" = ${ctx.run.id} AND p."assetSymbol" = ${ref.assetSymbol}
        AND p."simulationDate" = ${ref.dateKey}::date
      FOR UPDATE OF p
    `;
    if (!pos) throw new ReplayError("Replay hasn't started for this day yet.");
    const seen = commandId ? pos.recentCommands.find((c) => c.id === commandId) : undefined;
    if (seen) return { applied: false, from: seen.from, to: seen.to };

    const target = await targetMinute(tx, pos, command, ctx.dayStart);
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
  const revealed =
    outcome.to > outcome.from && state.dataset
      ? (await getHistoricalCandles(userId, { datasetId: state.dataset.id, timeframe: "M1", cutoff: outcome.to, from: outcome.from + 1, to: outcome.to, limit: MAX_STEP_BARS })).candles
      : [];
  return { applied: outcome.applied, moved: outcome.to > outcome.from, fromMinute: outcome.from, toMinute: outcome.to, revealed, state };
}

export interface ReplayCandlesResult extends CandlesResult {
  position: { minute: number; time: string; version: number };
}

/**
 * Candles for the replay chart, as of the STORED position. The caller chooses
 * the timeframe, how many candles, and (to pan back over revealed history) an
 * earlier `to` — never the cutoff: anything after the position is unreachable.
 */
export async function getReplayCandles(
  userId: string,
  ref: ReplayRef,
  query: { timeframe: ReplayTimeframe; limit?: number | null; to?: WallClockMinute | null },
): Promise<ReplayCandlesResult> {
  if (!isReplayTimeframe(query.timeframe)) throw new ReplayError("Unknown timeframe.");
  const ctx = await resolve(userId, ref, "read");
  const pos = await findPosition(userId, ctx);
  if (!pos) throw new ReplayError("Replay hasn't started for this day yet.");
  const cutoff = pos.currentMinute;
  const result = await getHistoricalCandles(userId, {
    datasetId: pos.datasetId,
    timeframe: query.timeframe,
    cutoff,
    to: query.to == null ? null : Math.min(query.to, cutoff),
    limit: query.limit ?? null,
  });
  return { ...result, position: { minute: cutoff, time: formatWallClock(cutoff), version: pos.version } };
}
