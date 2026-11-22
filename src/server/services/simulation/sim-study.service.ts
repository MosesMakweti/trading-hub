/**
 * Strategy Lab knowledge base: studies, setup variations, observations, and
 * the statistics built from them (domain/simulation/study-stats.ts).
 *
 * Observations recorded in a simulation account take their replay time from
 * the account's clock (never from the browser); a linked position supplies
 * entry, exit and R on read, so the observation can't drift from what the
 * ledger booked.
 */
import type { Prisma, SimObservationKind, SimObservationOutcome, SimPosition, SimStudyStatus } from "@prisma/client";

import { prisma } from "@/server/db";
import { dec } from "@/domain/execution/precision";
import { pointsToPrice } from "@/domain/simulation/money";
import { classifyR, computeSetupStats, groupStats, hourBucketOf, weekdayOf, type GroupStats, type SetupStats, type StatRow } from "@/domain/simulation/study-stats";
import { formatWallClock } from "@/domain/native-replay/wall-clock";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { SimError, requireSimAccount } from "./sim-account.service";
import { periodMinutes } from "./sim-market";

export class SimStudyNotFoundError extends Error {
  constructor() {
    super("Study not found.");
    this.name = "SimStudyNotFoundError";
  }
}

export interface StudyInput {
  name: string;
  description?: string | null;
  hypothesis?: string | null;
  category?: string | null;
  tags?: string[];
  status?: SimStudyStatus;
  instruments?: string[];
  timeframes?: string[];
  periodStart?: string | null;
  periodEnd?: string | null;
  marketConditions?: string | null;
  setupCriteria?: string | null;
  confirmationCriteria?: string | null;
  entryRules?: string | null;
  exitRules?: string | null;
  strategyId?: string | null;
  /** Initial setup variations (create only). */
  setups?: string[];
}

const clean = (xs: string[] | undefined) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))];

function studyData(input: StudyInput) {
  return {
    name: input.name.trim(),
    description: input.description ?? null,
    hypothesis: input.hypothesis ?? null,
    category: input.category?.trim() || null,
    tags: clean(input.tags),
    instruments: clean(input.instruments).map((s) => s.toUpperCase()),
    timeframes: clean(input.timeframes),
    periodStart: input.periodStart ? dateKeyToUtcDate(input.periodStart) : null,
    periodEnd: input.periodEnd ? dateKeyToUtcDate(input.periodEnd) : null,
    marketConditions: input.marketConditions ?? null,
    setupCriteria: input.setupCriteria ?? null,
    confirmationCriteria: input.confirmationCriteria ?? null,
    entryRules: input.entryRules ?? null,
    exitRules: input.exitRules ?? null,
  };
}

async function requireStudy(userId: string, studyId: string) {
  const study = await prisma.simStudy.findFirst({ where: { id: studyId, userId } });
  if (!study) throw new SimStudyNotFoundError();
  return study;
}

export async function createStudy(userId: string, input: StudyInput) {
  if (input.strategyId && !(await prisma.strategy.findFirst({ where: { id: input.strategyId, userId } }))) throw new SimError("That strategy wasn't found.");
  return prisma.simStudy.create({
    data: {
      userId,
      ...studyData(input),
      status: input.status ?? "ACTIVE",
      strategyId: input.strategyId ?? null,
      setups: { create: clean(input.setups).map((name, i) => ({ userId, name, sortOrder: i })) },
    },
  });
}

export async function updateStudy(userId: string, studyId: string, input: StudyInput) {
  const study = await requireStudy(userId, studyId);
  return prisma.simStudy.update({ where: { id: study.id }, data: { ...studyData(input), ...(input.status ? { status: input.status } : {}) } });
}

export async function setStudyStatus(userId: string, studyId: string, status: SimStudyStatus) {
  const study = await requireStudy(userId, studyId);
  return prisma.simStudy.update({ where: { id: study.id }, data: { status } });
}

export async function deleteStudy(userId: string, studyId: string) {
  const study = await requireStudy(userId, studyId);
  await prisma.simStudy.delete({ where: { id: study.id } });
}

export async function addSetup(userId: string, studyId: string, name: string, description?: string | null) {
  const study = await requireStudy(userId, studyId);
  const n = name.trim();
  if (!n) throw new SimError("Give the setup a name.");
  if (await prisma.simSetup.findFirst({ where: { studyId: study.id, name: n } })) throw new SimError(`This study already has a setup called "${n}".`);
  const count = await prisma.simSetup.count({ where: { studyId: study.id } });
  return prisma.simSetup.create({ data: { userId, studyId: study.id, name: n, description: description ?? null, sortOrder: count } });
}

export async function deleteSetup(userId: string, setupId: string) {
  const setup = await prisma.simSetup.findFirst({ where: { id: setupId, userId } });
  if (!setup) throw new SimError("Setup not found.");
  await prisma.simSetup.delete({ where: { id: setup.id } }); // observations keep their study, lose the variation (SET NULL)
}

export interface ObservationInput {
  studyId: string;
  setupId?: string | null;
  accountId?: string | null;
  positionId?: string | null;
  kind: SimObservationKind;
  symbol?: string | null;
  timeframe?: string | null;
  /** Outside an account only: when it happened (broker minute). */
  minute?: number | null;
  outcome?: SimObservationOutcome | null;
  selfReportedR?: number | null;
  setupTags?: string[];
  confirmationTags?: string[];
  explanation?: string | null;
  lessons?: string | null;
  notes?: string | null;
}

/** Records an observation. Inside an account the replay time comes from its clock. */
export async function recordObservation(userId: string, input: ObservationInput) {
  const study = await requireStudy(userId, input.studyId);
  if (input.setupId && !(await prisma.simSetup.findFirst({ where: { id: input.setupId, studyId: study.id } }))) throw new SimError("That setup isn't part of this study.");

  let minute = input.minute ?? null;
  let symbol = input.symbol?.trim().toUpperCase() || null;
  let position: SimPosition | null = null;
  if (input.accountId) {
    const account = await requireSimAccount(userId, input.accountId);
    if (account.currentMinute == null) throw new SimError("Start the replay before recording an observation.");
    minute = account.currentMinute;
    if (input.positionId) {
      position = await prisma.simPosition.findFirst({ where: { id: input.positionId, accountId: account.id } });
      if (!position) throw new SimError("That position isn't part of this account.");
      symbol = position.symbol;
    }
    symbol ??= account.assets[0];
  }
  if (input.kind === "TRADED" && !position) throw new SimError("Link the position this observation traded.");
  if (input.kind !== "TRADED" && position) throw new SimError("Only a traded observation links a position.");
  if (minute == null || !symbol) throw new SimError("An observation needs an instrument and a time.");

  return prisma.simObservation.create({
    data: {
      userId,
      studyId: study.id,
      setupId: input.setupId ?? null,
      accountId: input.accountId ?? null,
      positionId: position?.id ?? null,
      kind: input.kind,
      symbol,
      minute,
      timeframe: input.timeframe ?? null,
      outcome: input.kind === "TRADED" ? null : (input.outcome ?? "UNRESOLVED"),
      selfReportedR: input.kind === "TRADED" || input.selfReportedR == null ? null : input.selfReportedR,
      setupTags: clean(input.setupTags),
      confirmationTags: clean(input.confirmationTags),
      explanation: input.explanation ?? null,
      lessons: input.lessons ?? null,
      notes: input.notes ?? null,
    },
  });
}

export async function updateObservationNotes(
  userId: string,
  observationId: string,
  patch: Pick<ObservationInput, "setupId" | "outcome" | "selfReportedR" | "setupTags" | "confirmationTags" | "explanation" | "lessons" | "notes">,
) {
  const obs = await prisma.simObservation.findFirst({ where: { id: observationId, userId } });
  if (!obs) throw new SimError("Observation not found.");
  if (patch.setupId && !(await prisma.simSetup.findFirst({ where: { id: patch.setupId, studyId: obs.studyId } }))) throw new SimError("That setup isn't part of this study.");
  const data: Prisma.SimObservationUncheckedUpdateInput = {
    ...(patch.setupId !== undefined ? { setupId: patch.setupId } : {}),
    ...(patch.setupTags ? { setupTags: clean(patch.setupTags) } : {}),
    ...(patch.confirmationTags ? { confirmationTags: clean(patch.confirmationTags) } : {}),
    ...(patch.explanation !== undefined ? { explanation: patch.explanation } : {}),
    ...(patch.lessons !== undefined ? { lessons: patch.lessons } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(obs.kind !== "TRADED" && patch.outcome !== undefined ? { outcome: patch.outcome } : {}),
    ...(obs.kind !== "TRADED" && patch.selfReportedR !== undefined ? { selfReportedR: patch.selfReportedR } : {}),
  };
  return prisma.simObservation.update({ where: { id: obs.id }, data });
}

export async function deleteObservation(userId: string, observationId: string) {
  const obs = await prisma.simObservation.findFirst({ where: { id: observationId, userId } });
  if (!obs) throw new SimError("Observation not found.");
  await prisma.simObservation.delete({ where: { id: obs.id } });
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Net R of a closed position after costs; null while open or without a stop-based risk. */
export function positionNetR(p: Pick<SimPosition, "status" | "realizedPnl" | "commissions" | "swaps" | "intendedRisk">): number | null {
  if (p.status !== "CLOSED" || p.intendedRisk == null || dec(p.intendedRisk.toString()).isZero()) return null;
  return dec(p.realizedPnl.toString()).plus(p.commissions.toString()).plus(p.swaps.toString()).dividedBy(p.intendedRisk.toString()).toNumber();
}

export interface ObservationDTO {
  id: string;
  kind: SimObservationKind;
  setupId: string | null;
  setupName: string | null;
  accountId: string | null;
  symbol: string;
  time: string;
  timeframe: string | null;
  outcome: "WIN" | "LOSS" | "BREAKEVEN" | "UNRESOLVED" | "OPEN";
  r: number | null;
  rSelfReported: boolean;
  position: { side: string; entry: string; status: string; netPnl: string } | null;
  setupTags: string[];
  confirmationTags: string[];
  explanation: string | null;
  lessons: string | null;
  notes: string | null;
}

type ObservationRow = Prisma.SimObservationGetPayload<{ include: { setup: true; position: true } }>;

function toObservationDTO(o: ObservationRow): ObservationDTO & { statRow: StatRow & { setupKey: string; timeframeKey: string } } {
  const p = o.position;
  const r = p ? positionNetR(p) : o.selfReportedR == null ? null : Number(o.selfReportedR.toString());
  const outcome: ObservationDTO["outcome"] = p ? (p.status === "OPEN" ? "OPEN" : r == null ? "UNRESOLVED" : classifyR(r)) : (o.outcome ?? "UNRESOLVED");
  return {
    id: o.id,
    kind: o.kind,
    setupId: o.setupId,
    setupName: o.setup?.name ?? null,
    accountId: o.accountId,
    symbol: o.symbol,
    time: formatWallClock(o.minute),
    timeframe: o.timeframe,
    outcome,
    r,
    rSelfReported: !p && r != null,
    position: p
      ? {
          side: p.side,
          entry: pointsToPrice(p.entryPoints, p.priceScale).toFixed(p.priceScale),
          status: p.status,
          netPnl: dec(p.realizedPnl.toString()).plus(p.commissions.toString()).plus(p.swaps.toString()).toFixed(2),
        }
      : null,
    setupTags: o.setupTags,
    confirmationTags: o.confirmationTags,
    explanation: o.explanation,
    lessons: o.lessons,
    notes: o.notes,
    statRow: {
      executed: o.kind === "TRADED" && p != null,
      r: p ? (p.status === "CLOSED" ? r : null) : r,
      outcome: outcome === "OPEN" ? "UNRESOLVED" : outcome,
      minute: o.minute,
      setupKey: o.setupId ?? "",
      timeframeKey: o.timeframe ?? "",
    },
  };
}

export interface StudyDetailDTO {
  study: {
    id: string;
    name: string;
    description: string | null;
    hypothesis: string | null;
    category: string | null;
    tags: string[];
    status: SimStudyStatus;
    instruments: string[];
    timeframes: string[];
    periodStart: string | null;
    periodEnd: string | null;
    marketConditions: string | null;
    setupCriteria: string | null;
    confirmationCriteria: string | null;
    entryRules: string | null;
    exitRules: string | null;
    strategyName: string | null;
  };
  setups: { id: string; name: string; description: string | null }[];
  observations: ObservationDTO[];
  overall: SetupStats;
  bySetup: GroupStats[];
  byInstrument: GroupStats[];
  byTimeframe: GroupStats[];
  byHour: GroupStats[];
  byWeekday: GroupStats[];
}

export async function getStudyDetail(userId: string, studyId: string): Promise<StudyDetailDTO> {
  const study = await prisma.simStudy.findFirst({
    where: { id: studyId, userId },
    include: { setups: { orderBy: { sortOrder: "asc" } }, strategy: { select: { name: true } } },
  });
  if (!study) throw new SimStudyNotFoundError();
  const rows = await prisma.simObservation.findMany({ where: { studyId: study.id, userId }, include: { setup: true, position: true }, orderBy: { minute: "desc" } });
  const dtos = rows.map(toObservationDTO);
  const statRows = dtos.map((d) => ({ ...d.statRow, symbol: d.symbol, setupName: d.setupName }));
  return {
    study: {
      id: study.id,
      name: study.name,
      description: study.description,
      hypothesis: study.hypothesis,
      category: study.category,
      tags: study.tags,
      status: study.status,
      instruments: study.instruments,
      timeframes: study.timeframes,
      periodStart: study.periodStart ? utcDateToKey(study.periodStart) : null,
      periodEnd: study.periodEnd ? utcDateToKey(study.periodEnd) : null,
      marketConditions: study.marketConditions,
      setupCriteria: study.setupCriteria,
      confirmationCriteria: study.confirmationCriteria,
      entryRules: study.entryRules,
      exitRules: study.exitRules,
      strategyName: study.strategy?.name ?? null,
    },
    setups: study.setups.map((s) => ({ id: s.id, name: s.name, description: s.description })),
    observations: dtos.map((d) => {
      const dto: Partial<typeof d> = { ...d };
      delete dto.statRow;
      return dto as ObservationDTO;
    }),
    overall: computeSetupStats(statRows),
    bySetup: groupStats(statRows, (r) => ({ key: r.setupKey || "none", label: r.setupName ?? "No variation" })),
    byInstrument: groupStats(statRows, (r) => ({ key: r.symbol, label: r.symbol })),
    byTimeframe: groupStats(statRows, (r) => (r.timeframeKey ? { key: r.timeframeKey, label: r.timeframeKey } : null)),
    byHour: groupStats(statRows, (r) => hourBucketOf(r.minute)),
    byWeekday: groupStats(statRows, (r) => weekdayOf(r.minute)),
  };
}

export interface StudySummaryDTO {
  id: string;
  name: string;
  category: string | null;
  tags: string[];
  status: SimStudyStatus;
  instruments: string[];
  setups: number;
  observations: number;
  stats: SetupStats;
  updatedAt: string;
}

/** The study library: every study with its headline stats (fixed number of queries). */
export async function listStudies(userId: string): Promise<StudySummaryDTO[]> {
  const studies = await prisma.simStudy.findMany({ where: { userId }, include: { _count: { select: { setups: true } } }, orderBy: { updatedAt: "desc" } });
  if (studies.length === 0) return [];
  const obs = await prisma.simObservation.findMany({ where: { userId, studyId: { in: studies.map((s) => s.id) } }, include: { setup: true, position: true } });
  const byStudy = new Map<string, StatRow[]>();
  for (const o of obs) {
    const list = byStudy.get(o.studyId) ?? [];
    list.push(toObservationDTO(o).statRow);
    byStudy.set(o.studyId, list);
  }
  return studies.map((s) => {
    const rows = byStudy.get(s.id) ?? [];
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      tags: s.tags,
      status: s.status,
      instruments: s.instruments,
      setups: s._count.setups,
      observations: rows.length,
      stats: computeSetupStats(rows),
      updatedAt: s.updatedAt.toISOString(),
    };
  });
}

/** Studies + setups an account's quick-capture panel can file an observation under. */
export async function listStudyOptions(userId: string) {
  const studies = await prisma.simStudy.findMany({
    where: { userId, status: { in: ["PLANNED", "ACTIVE"] } },
    include: { setups: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return studies.map((s) => ({ id: s.id, name: s.name, setups: s.setups }));
}

export interface BacktestResultsDTO {
  accountId: string;
  name: string;
  currency: string;
  startingBalance: string;
  overall: SetupStats;
  bySymbol: GroupStats[];
  bySide: GroupStats[];
  byHour: GroupStats[];
  byWeekday: GroupStats[];
  /** Balance after each closed trade, in replay order (money, net of costs). */
  equityCurve: { time: string; balance: number }[];
  money: { netPnl: string; commissions: string; swaps: string; tradesWithoutRisk: number };
}

/** A whole backtest's results: every closed position of the account, net of costs. */
export async function getBacktestResults(userId: string, accountId: string): Promise<BacktestResultsDTO> {
  const account = await requireSimAccount(userId, accountId);
  const closed = await prisma.simPosition.findMany({ where: { accountId: account.id, status: "CLOSED" }, orderBy: { closedMinute: "asc" } });
  const rows = closed.map((p) => ({ executed: true, r: positionNetR(p), outcome: "UNRESOLVED" as const, minute: p.closedMinute ?? p.openedMinute, symbol: p.symbol, side: p.side, openedMinute: p.openedMinute }));
  let balance = Number(account.startingBalance.toString());
  let commissions = dec(0);
  let swaps = dec(0);
  const curve = [{ time: formatWallClock(periodMinutes(account).from), balance }];
  for (const p of closed) {
    const net = dec(p.realizedPnl.toString()).plus(p.commissions.toString()).plus(p.swaps.toString());
    balance = dec(balance).plus(net).toNumber();
    commissions = commissions.plus(p.commissions.toString());
    swaps = swaps.plus(p.swaps.toString());
    curve.push({ time: formatWallClock(p.closedMinute ?? p.openedMinute), balance });
  }
  return {
    accountId: account.id,
    name: account.name,
    currency: account.currency,
    startingBalance: account.startingBalance.toString(),
    overall: computeSetupStats(rows),
    bySymbol: groupStats(rows, (r) => ({ key: r.symbol, label: r.symbol })),
    bySide: groupStats(rows, (r) => ({ key: r.side, label: r.side === "BUY" ? "Long" : "Short" })),
    byHour: groupStats(rows, (r) => hourBucketOf(r.openedMinute)),
    byWeekday: groupStats(rows, (r) => weekdayOf(r.openedMinute)),
    equityCurve: curve,
    money: {
      netPnl: dec(balance).minus(account.startingBalance.toString()).toFixed(2),
      commissions: commissions.toFixed(2),
      swaps: swaps.toFixed(2),
      tradesWithoutRisk: rows.filter((r) => r.r == null).length,
    },
  };
}
