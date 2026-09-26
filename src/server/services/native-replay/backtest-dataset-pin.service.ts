/**
 * Native Replay ↔ Backtesting — which historical dataset a run replays for
 * each of its assets (BacktestRunDataset).
 *
 * Pinning semantics: a pin can be replaced or removed freely until replay
 * starts on that asset. The first replay position created for the pin freezes
 * it (DB trigger sets `frozenAt`); from then on the run is permanently tied to
 * that dataset — the database refuses any change or direct removal. Only
 * deleting the run removes a frozen pin. Datasets themselves are never deleted
 * with a run.
 */
import type { BacktestRun, HistoricalDataset } from "@prisma/client";

import { prisma } from "@/server/db";
import { normalizeSymbol } from "@/domain/native-replay/import-analysis";
import { formatWallClock, MINUTES_PER_DAY, parseWallClock } from "@/domain/native-replay/wall-clock";
import { utcDateToKey } from "@/lib/date";
import { requireBacktestRun } from "@/server/services/backtest-run.service";
import { HistoricalDatasetNotFoundError } from "@/server/services/native-replay/historical-dataset.service";

/** A refusal meant for the trader (message shown verbatim). */
export class DatasetPinError extends Error {}

export interface DatasetPinDTO {
  id: string;
  runId: string;
  runName: string;
  runStatus: BacktestRun["status"];
  assetSymbol: string;
  datasetId: string;
  datasetSymbol: string;
  datasetRange: { firstBar: string | null; lastBar: string | null };
  frozen: boolean;
  frozenAt: string | null;
}

type PinRow = Awaited<ReturnType<typeof loadPins>>[number];

function loadPins(where: { userId: string; backtestRunId?: string; datasetId?: string; id?: string }) {
  return prisma.backtestRunDataset.findMany({
    where,
    include: {
      backtestRun: { select: { id: true, name: true, status: true } },
      dataset: { select: { id: true, symbol: true, firstBarMinute: true, lastBarMinute: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

function toDTO(p: PinRow): DatasetPinDTO {
  return {
    id: p.id,
    runId: p.backtestRun.id,
    runName: p.backtestRun.name,
    runStatus: p.backtestRun.status,
    assetSymbol: p.assetSymbol,
    datasetId: p.dataset.id,
    datasetSymbol: p.dataset.symbol,
    datasetRange: {
      firstBar: p.dataset.firstBarMinute == null ? null : formatWallClock(p.dataset.firstBarMinute),
      lastBar: p.dataset.lastBarMinute == null ? null : formatWallClock(p.dataset.lastBarMinute),
    },
    frozen: p.frozenAt != null,
    frozenAt: p.frozenAt?.toISOString() ?? null,
  };
}

export async function listRunDatasetPins(userId: string, runId: string): Promise<DatasetPinDTO[]> {
  const run = await requireBacktestRun(userId, runId);
  return (await loadPins({ userId, backtestRunId: run.id })).map(toDTO);
}

export async function listDatasetPinsForUser(userId: string): Promise<DatasetPinDTO[]> {
  return (await loadPins({ userId })).map(toDTO);
}

function runPeriodMinutes(run: BacktestRun): { from: number; to: number } {
  return {
    from: parseWallClock(`${utcDateToKey(run.startDate)}T00:00`)!,
    to: parseWallClock(`${utcDateToKey(run.endDate)}T00:00`)! + MINUTES_PER_DAY - 1,
  };
}

export interface CompatibilityResult {
  ok: boolean;
  reason: string | null;
  /** Days of the run period (on the dataset clock) that have at least one bar. */
  coveredDays: number;
}

/** Can `dataset` serve `assetSymbol` of `run`? Symbol, readiness and date overlap. */
export async function checkDatasetCompatibility(run: BacktestRun, assetSymbol: string, dataset: HistoricalDataset): Promise<CompatibilityResult> {
  if (dataset.status !== "READY") return { ok: false, reason: "Only a fully imported (READY) dataset can be attached.", coveredDays: 0 };
  if (dataset.baseTimeframe !== "M1") return { ok: false, reason: "Only M1 datasets can be replayed.", coveredDays: 0 };
  const wanted = normalizeSymbol(assetSymbol);
  if (dataset.symbol !== wanted) {
    return { ok: false, reason: `This dataset is ${dataset.symbol}${dataset.sourceSymbol !== dataset.symbol ? ` (${dataset.sourceSymbol})` : ""}, not ${wanted}.`, coveredDays: 0 };
  }
  const period = runPeriodMinutes(run);
  const [{ days }] = await prisma.$queryRaw<{ days: number }[]>`
    SELECT count(DISTINCT "minute" / 1440)::int AS days
    FROM "HistoricalBar" WHERE "datasetSeq" = ${dataset.seq} AND "minute" BETWEEN ${period.from} AND ${period.to}
  `;
  if (days === 0) {
    return {
      ok: false,
      reason: `The dataset (${formatWallClock(dataset.firstBarMinute!).slice(0, 10)} → ${formatWallClock(dataset.lastBarMinute!).slice(0, 10)}) has no bars inside this run's period.`,
      coveredDays: 0,
    };
  }
  return { ok: true, reason: null, coveredDays: days };
}

/**
 * Attaches (or, before replay starts, replaces) the dataset for one of the
 * run's assets. Refused for read-only runs and frozen pins.
 */
export async function attachDatasetToRun(
  userId: string,
  input: { runId: string; assetSymbol: string; datasetId: string },
): Promise<DatasetPinDTO & { coveredDays: number }> {
  const run = await requireBacktestRun(userId, input.runId);
  if (run.status !== "ACTIVE") throw new DatasetPinError("This run is read-only — reopen or restore it first.");
  if (!run.assets.includes(input.assetSymbol)) throw new DatasetPinError(`${input.assetSymbol} isn't one of this run's assets.`);
  const dataset = await prisma.historicalDataset.findFirst({ where: { id: input.datasetId, userId } });
  if (!dataset) throw new HistoricalDatasetNotFoundError();

  const compat = await checkDatasetCompatibility(run, input.assetSymbol, dataset);
  if (!compat.ok) throw new DatasetPinError(compat.reason!);

  const existing = await prisma.backtestRunDataset.findUnique({ where: { backtestRunId_assetSymbol: { backtestRunId: run.id, assetSymbol: input.assetSymbol } } });
  if (existing?.frozenAt) {
    if (existing.datasetId === dataset.id) return { ...(await pinDTO(userId, existing.id)), coveredDays: compat.coveredDays };
    throw new DatasetPinError(`Replay has already started on ${input.assetSymbol} with another dataset — its history can't be swapped. Create a new run to use a different dataset.`);
  }
  const pin = existing
    ? await prisma.backtestRunDataset.update({ where: { id: existing.id }, data: { datasetId: dataset.id } })
    : await prisma.backtestRunDataset.create({ data: { userId, backtestRunId: run.id, assetSymbol: input.assetSymbol, datasetId: dataset.id } });
  return { ...(await pinDTO(userId, pin.id)), coveredDays: compat.coveredDays };
}

async function pinDTO(userId: string, pinId: string): Promise<DatasetPinDTO> {
  const [row] = await loadPins({ userId, id: pinId });
  return toDTO(row);
}

/** Removes a pin that replay hasn't started on. */
export async function detachDatasetFromRun(userId: string, input: { runId: string; assetSymbol: string }): Promise<void> {
  const run = await requireBacktestRun(userId, input.runId);
  if (run.status !== "ACTIVE") throw new DatasetPinError("This run is read-only — reopen or restore it first.");
  const pin = await prisma.backtestRunDataset.findUnique({ where: { backtestRunId_assetSymbol: { backtestRunId: run.id, assetSymbol: input.assetSymbol } } });
  if (!pin) return;
  if (pin.frozenAt) throw new DatasetPinError(`Replay has already started on ${input.assetSymbol} — its dataset stays attached for reproducibility.`);
  await prisma.backtestRunDataset.delete({ where: { id: pin.id } });
}
