import { Prisma, type MediaOwnerType } from "@prisma/client";

import { prisma } from "@/server/db";
import { addDaysToKey, dateKeyToUtcDate, minutesToTimeString, utcDateToKey } from "@/lib/date";
import { canonicalTradeInclude, toCanonicalRow } from "@/server/services/analytics-canonical.service";
import { withLedgerProjections } from "@/server/services/ledger-projection.service";
import { currentSettlementBasis } from "@/server/services/settlement-basis";
import { getScheduleVersions } from "@/server/services/preparation.service";
import { getTimezoneVersions, getTraderTodayKey } from "@/server/services/trader-time.service";
import { deleteMediaAttachment, isUploadsEnabled } from "@/server/services/media.service";
import {
  continueCommitmentIntoAudit,
  listCarryForwardForWeek,
  setCommitmentStatus,
  syncSystemEvidenceForPeriod,
} from "@/server/services/edge-review-commitment.service";
import { isBacktestScope } from "@/server/workspace/scope";
import { effectiveTimezoneAt, startOfLocalDay } from "@/domain/time/trader-calendar";
import type { PreparationDayException } from "@/domain/discipline/preparation-schedule";
import { auditDays, auditScopeKey, auditWeekFor, defaultAuditWeekStart, inScope, isInWeek, normalizeAssets, type AuditWeek } from "@/domain/trade-audit/week";
import { detectAssessmentChanges, detectFinalizedDrift, tradeFingerprint, tradeLabel } from "@/domain/trade-audit/fingerprint";
import { buildWeeklySummary, type WeeklyAuditSummary } from "@/domain/trade-audit/summary";
import type {
  AnnotationMarker,
  AuditAssessmentText,
  AuditDayDTO,
  AuditImageDTO,
  AuditRatings,
  AuditTradeDTO,
  AuditWeaknessValue,
  DailyAuditStatusValue,
  ExpectedTradeDTO,
  ImageProvenance,
  LegacyReflectionDTO,
  LiveMissedOpportunityDTO,
  MissReasonValue,
  NoTradeReasonValue,
  TradeAssessmentDTO,
  TradeChangeDTO,
  TradeSystemFlag,
  WeeklyAuditDTO,
} from "@/types/trade-audit";

/**
 * Weekly Trade Audit (Edge Review redesign) — see docs/WEEKLY_TRADE_AUDIT.md.
 *
 * Invariants every function here keeps:
 *  - user-scoped: every query filters by userId; ids from the client are only
 *    ever looked up together with that userId;
 *  - the audit is resolved from (user, week, scope) — never from a client id;
 *  - actual trades are READ from Trade, never copied (no import step, so
 *    nothing can be imported twice);
 *  - a FINALIZED audit rejects every write (`assertMutable`).
 */

export class TradeAuditError extends Error {}

export interface AuditCommitmentDTO {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  periodStart: string;
}

export interface AuditScope {
  weekStart: string;
  strategyId: string | null;
  assetSymbols: string[];
}

function resolveScope(scope: AuditScope): { week: AuditWeek; strategyId: string | null; assetSymbols: string[]; scopeKey: string } {
  const week = auditWeekFor(scope.weekStart);
  if (week.weekStart !== scope.weekStart) throw new TradeAuditError("A weekly audit starts on a Monday.");
  const assetSymbols = normalizeAssets(scope.assetSymbols);
  return { week, strategyId: scope.strategyId, assetSymbols, scopeKey: auditScopeKey(scope.strategyId, assetSymbols) };
}

function assertLive() {
  if (isBacktestScope()) throw new TradeAuditError("Edge Review audits live trading only.");
}

async function findAudit(userId: string, scope: AuditScope) {
  const { week, scopeKey } = resolveScope(scope);
  return prisma.weeklyTradeAudit.findUnique({
    where: { userId_weekStart_scopeKey: { userId, weekStart: dateKeyToUtcDate(week.weekStart), scopeKey } },
  });
}

/** Idempotent: one audit per (user, week, scope), created on first write. */
async function getOrCreateAudit(userId: string, scope: AuditScope) {
  assertLive();
  const { week, strategyId, assetSymbols, scopeKey } = resolveScope(scope);
  if (strategyId) {
    const owns = await prisma.strategy.findFirst({ where: { id: strategyId, userId }, select: { id: true } });
    if (!owns) throw new TradeAuditError("Strategy not found.");
  }
  const weekStart = dateKeyToUtcDate(week.weekStart);
  return prisma.weeklyTradeAudit.upsert({
    where: { userId_weekStart_scopeKey: { userId, weekStart, scopeKey } },
    update: {},
    create: { userId, weekStart, weekEnd: dateKeyToUtcDate(week.weekEnd), strategyId, assetSymbols, scopeKey },
  });
}

function assertMutable(audit: { status: string }) {
  if (audit.status === "FINALIZED") throw new TradeAuditError("This week is finalized. Reopen it to make changes.");
}

async function mutableAudit(userId: string, scope: AuditScope) {
  const audit = await getOrCreateAudit(userId, scope);
  assertMutable(audit);
  return audit;
}

/** A day row exists from the first piece of work on that day (→ IN_PROGRESS). */
async function touchDay(userId: string, auditId: string, dateKey: string) {
  return prisma.dailyTradeAudit.upsert({
    where: { auditId_dateKey: { auditId, dateKey: dateKeyToUtcDate(dateKey) } },
    update: {},
    create: { userId, auditId, dateKey: dateKeyToUtcDate(dateKey) },
  });
}

// ── Reading actual trades ───────────────────────────────────────────────────

const auditTradeInclude = {
  ...canonicalTradeInclude,
  allocations: { select: { riskInputType: true, riskValue: true } },
  propFirmExecutions: { where: { deletedAt: null }, select: { actualLotSize: true, actualContractQty: true } },
} as const;

type AuditTradeRecord = Prisma.TradeGetPayload<{ include: typeof auditTradeInclude }>;

const num = (d: { toNumber(): number } | null | undefined) => (d == null ? null : d.toNumber());

const BEHAVIOURAL_INTENT_LABEL: Record<string, string> = {
  FOMO: "Tagged FOMO",
  REVENGE: "Tagged revenge",
  BOREDOM: "Tagged boredom",
  IMPULSE: "Tagged impulse",
  MANUAL_OVERRIDE: "Tagged manual override",
};

function systemFlagsOf(t: AuditTradeRecord): TradeSystemFlag[] {
  const flags: TradeSystemFlag[] = [];
  if (t.validationState === "OVERRIDDEN") {
    flags.push({ key: "VALIDATION_OVERRIDDEN", label: `Setup validation overridden${t.overrideReason ? ` (${t.overrideReason.replaceAll("_", " ").toLowerCase()})` : ""}` });
  } else if (t.validationState === "NOT_VALIDATED") {
    flags.push({ key: "NOT_VALIDATED", label: "Setup conditions not all confirmed" });
  }
  if (t.setupValid === false) flags.push({ key: "INVALID_SETUP", label: "Missing a mandatory confluence" });
  if (t.limitOverrideReason) flags.push({ key: "LIMIT_OVERRIDE", label: "Taken over the daily trade/risk limit" });
  if (t.tradeIntent && BEHAVIOURAL_INTENT_LABEL[t.tradeIntent]) flags.push({ key: "BEHAVIOURAL_INTENT", label: BEHAVIOURAL_INTENT_LABEL[t.tradeIntent] });
  return flags;
}

function positionSizeOf(t: AuditTradeRecord): string | null {
  const lots = t.propFirmExecutions.map((e) => num(e.actualLotSize)).filter((n): n is number => n != null);
  if (lots.length > 0) return `${lots.reduce((s, n) => s + n, 0)} lots`;
  const contracts = t.propFirmExecutions.map((e) => num(e.actualContractQty)).filter((n): n is number => n != null);
  if (contracts.length > 0) return `${contracts.reduce((s, n) => s + n, 0)} contracts`;
  return null;
}

function riskOf(t: AuditTradeRecord): string | null {
  if (t.allocations.length === 0) return null;
  const percent = t.allocations.filter((a) => a.riskInputType === "PERCENT");
  if (percent.length === t.allocations.length) return `${percent.reduce((s, a) => s + a.riskValue.toNumber(), 0).toFixed(2)}%`;
  if (percent.length === 0) return t.allocations.reduce((s, a) => s + a.riskValue.toNumber(), 0).toFixed(2);
  return null; // mixed bases can't be summed honestly
}

/** Live, in-scope trades of the week, mapped to display DTOs (no images yet). */
async function loadWeekTrades(userId: string, week: AuditWeek, scope: { strategyId: string | null; assetSymbols: string[] }): Promise<AuditTradeDTO[]> {
  const records = await withLedgerProjections(
    await prisma.trade.findMany({
      where: { userId, tradeDate: { gte: dateKeyToUtcDate(week.weekStart), lte: dateKeyToUtcDate(week.weekEnd) } },
      include: auditTradeInclude,
      orderBy: [{ tradeDate: "asc" }, { executionMinutes: "asc" }, { createdAt: "asc" }],
    }),
  );
  const basis = currentSettlementBasis();
  return records
    .filter((t) => inScope(scope, t))
    .map((t) => {
      const row = toCanonicalRow(t, basis);
      const outcome = row.isCancelled
        ? "CANCELLED"
        : row.winLossClass === "WIN" || row.winLossClass === "LOSS" || row.winLossClass === "BREAKEVEN"
          ? row.winLossClass
          : "PENDING";
      return {
        id: t.id,
        tradeNumber: t.tradeNumber,
        dateKey: utcDateToKey(t.tradeDate),
        assetSymbol: t.assetSymbol,
        direction: t.direction,
        strategyId: t.strategyId,
        strategyName: t.strategyNameSnapshot,
        setupName: row.setupTypeName,
        session: t.selectedSession,
        timeframe: t.timeframe,
        entryTime: t.executionMinutes >= 0 && t.executionMinutes < 1440 ? minutesToTimeString(t.executionMinutes) : null,
        closedAt: t.closedAt?.toISOString() ?? null,
        plannedEntry: num(t.plannedEntry),
        plannedStopLoss: num(t.plannedStopLoss),
        plannedTarget: num(t.plannedTarget),
        actualEntry: num(t.actualEntry),
        actualStopLoss: num(t.actualStopLoss),
        actualExit: num(t.actualExit),
        positionSize: positionSizeOf(t),
        risk: riskOf(t),
        plannedR: row.plannedR,
        realizedR: row.realizedR,
        pnl: row.pnl,
        outcome,
        reasonForTrade: t.reasonForTrade,
        executionNotes: t.executionNotes,
        systemFlags: systemFlagsOf(t),
        images: [],
      } satisfies AuditTradeDTO;
    });
}

// ── Images & provenance ─────────────────────────────────────────────────────

type AttachmentRow = Prisma.MediaAttachmentGetPayload<{ include: { media: true } }>;

async function loadAttachments(userId: string, owners: { ownerType: MediaOwnerType; ids: string[] }[]): Promise<AttachmentRow[]> {
  const clauses = owners.filter((o) => o.ids.length > 0).map((o) => ({ ownerType: o.ownerType, ownerId: { in: o.ids } }));
  if (clauses.length === 0) return [];
  return prisma.mediaAttachment.findMany({
    where: { OR: clauses, media: { userId } },
    include: { media: true },
    // Chronological: what was captured first shows first (entry before exit).
    orderBy: [{ createdAt: "asc" }, { sortOrder: "asc" }],
  });
}

function toImage(a: AttachmentRow, provenance: ImageProvenance, annotations: Map<string, AnnotationMarker[]>): AuditImageDTO {
  return {
    attachmentId: a.id,
    url: a.media.url,
    fileName: a.media.fileName,
    caption: a.caption,
    category: a.category,
    provenance,
    annotation: annotations.get(a.id) ?? null,
    removable: provenance === "REVIEW",
  };
}

// ── Workspace read model ────────────────────────────────────────────────────

export interface AuditWorkspace {
  week: AuditWeek;
  scope: { strategyId: string | null; assetSymbols: string[] };
  audit: WeeklyAuditDTO | null;
  days: AuditDayDTO[];
  summary: WeeklyAuditSummary;
  /** Finalized audits only: the live trades no longer match the frozen week. */
  hasFinalizedDrift: boolean;
  /** In-progress audits only: assessed trades changed since assessment. */
  unacknowledgedChanges: number;
  legacyReflection: LegacyReflectionDTO | null;
  /** Commitments created from (or carried into) this week's review. */
  commitments: AuditCommitmentDTO[];
  /** Still-ACTIVE commitments from the previous finalized weekly review —
   *  the trader decides Continue / Done / Drop for each. */
  carryForward: AuditCommitmentDTO[];
  uploadsEnabled: boolean;
}

function toAuditDTO(a: Prisma.WeeklyTradeAuditGetPayload<object>): WeeklyAuditDTO {
  return {
    id: a.id,
    status: a.status,
    finalizedAt: a.finalizedAt?.toISOString() ?? null,
    reopenedAt: a.reopenedAt?.toISOString() ?? null,
    executionSummary: a.executionSummary,
    decisionSummary: a.decisionSummary,
    strongestArea: a.strongestArea,
    biggestWeakness: a.biggestWeakness,
    recurringPatterns: a.recurringPatterns,
    mainLesson: a.mainLesson,
    nextWeekPriority: a.nextWeekPriority,
    executionQualityRating: a.executionQualityRating,
    tradeSelectionRating: a.tradeSelectionRating,
    patienceRating: a.patienceRating,
    strategyAdherenceRating: a.strategyAdherenceRating,
    riskManagementRating: a.riskManagementRating,
    tradeManagementRating: a.tradeManagementRating,
  };
}

function isAuditTradeSnapshot(v: unknown): v is AuditTradeDTO {
  return v != null && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" && typeof (v as { dateKey?: unknown }).dateKey === "string";
}

export async function loadAuditWorkspace(userId: string, input: AuditScope): Promise<AuditWorkspace> {
  const { week, strategyId, assetSymbols } = resolveScope(input);
  const scope = { strategyId, assetSymbols };
  const weekRange = { gte: dateKeyToUtcDate(week.weekStart), lte: dateKeyToUtcDate(week.weekEnd) };

  const [audit, liveTrades, liveMissedRows, versions, exceptionRows, tzVersions, legacy] = await Promise.all([
    findAudit(userId, input),
    loadWeekTrades(userId, week, scope),
    prisma.tradeOpportunity.findMany({
      where: { userId, status: "MISSED", spottedAt: weekRange },
      orderBy: [{ spottedAt: "asc" }, { createdAt: "asc" }],
    }),
    getScheduleVersions(userId),
    prisma.preparationDayException.findMany({ where: { userId, date: weekRange } }),
    getTimezoneVersions(userId),
    prisma.weeklyReview.findFirst({ where: { userId, weekStart: dateKeyToUtcDate(week.weekStart), reviewType: "WEEKLY" } }),
  ]);

  const [dayRows, assessmentRows, expectedRows, annotationRows, commitmentRows] = audit
    ? await Promise.all([
        prisma.dailyTradeAudit.findMany({ where: { auditId: audit.id, userId } }),
        prisma.tradeAuditAssessment.findMany({ where: { auditId: audit.id, userId } }),
        prisma.auditExpectedTrade.findMany({ where: { auditId: audit.id, userId }, orderBy: { createdAt: "asc" } }),
        prisma.tradeAuditAnnotation.findMany({ where: { auditId: audit.id, userId } }),
        prisma.edgeReviewCommitment.findMany({ where: { weeklyTradeAuditId: audit.id, userId }, orderBy: { createdAt: "asc" } }),
      ])
    : [[], [], [], [], []];

  const finalized = audit?.status === "FINALIZED";
  const carryForward = finalized ? [] : await listCarryForwardForWeek(userId, week.weekStart, audit?.id ?? null);

  // Which trades this audit SHOWS: live trades while in progress; the frozen
  // snapshot once finalized (a later edit can never silently rewrite it).
  const snapshots: AuditTradeDTO[] = assessmentRows.flatMap((a) => (isAuditTradeSnapshot(a.tradeSnapshot) ? [a.tradeSnapshot] : []));
  const shownTrades: AuditTradeDTO[] = finalized ? snapshots.map((s) => ({ ...s, images: [] })) : liveTrades;
  const liveById = new Map(liveTrades.map((t) => [t.id, t]));

  const liveMissed = liveMissedRows.filter((o) => inScope(scope, o));

  // Images, one batched query for every owner on the page.
  const annotations = new Map(annotationRows.map((a) => [a.mediaAttachmentId, a.markers as unknown as AnnotationMarker[]]));
  const attachments = await loadAttachments(userId, [
    { ownerType: "TRADE", ids: shownTrades.map((t) => t.id) },
    { ownerType: "OPPORTUNITY", ids: liveMissed.map((o) => o.id) },
    { ownerType: "TRADE_AUDIT_ASSESSMENT", ids: assessmentRows.map((a) => a.id) },
    { ownerType: "TRADE_AUDIT_EXPECTED", ids: expectedRows.map((e) => e.id) },
    { ownerType: "TRADE_AUDIT_DAY", ids: dayRows.map((d) => d.id) },
  ]);
  const imagesByOwner = new Map<string, AttachmentRow[]>();
  for (const a of attachments) imagesByOwner.set(`${a.ownerType}:${a.ownerId}`, [...(imagesByOwner.get(`${a.ownerType}:${a.ownerId}`) ?? []), a]);

  // SESSION = attached before the trader's local day ended.
  const dayEnd = (dateKey: string) => {
    const tz = effectiveTimezoneAt(tzVersions, dateKeyToUtcDate(dateKey));
    return startOfLocalDay(addDaysToKey(dateKey, 1), tz).getTime();
  };
  const sessionImages = (ownerType: MediaOwnerType, ownerId: string, dateKey: string) =>
    (imagesByOwner.get(`${ownerType}:${ownerId}`) ?? []).map((a) =>
      toImage(a, a.createdAt.getTime() < dayEnd(dateKey) ? "SESSION" : "POST_SESSION", annotations),
    );
  const reviewImages = (ownerType: MediaOwnerType, ownerId: string) =>
    (imagesByOwner.get(`${ownerType}:${ownerId}`) ?? []).map((a) => toImage(a, "REVIEW", annotations));

  // Change detection (flag, never rewrite).
  const changesByDay = finalized
    ? detectFinalizedDrift(snapshots, liveTrades)
    : detectAssessmentChanges(
        assessmentRows.map((a) => ({
          tradeId: a.tradeId,
          dateKey: utcDateToKey(a.dateKey),
          tradeFingerprint: a.tradeFingerprint,
          snapshotLabel: isAuditTradeSnapshot(a.tradeSnapshot) ? tradeLabel(a.tradeSnapshot) : null,
        })),
        liveById,
      );

  const assessmentDTOs: TradeAssessmentDTO[] = assessmentRows.map((a) => ({
    id: a.id,
    tradeId: a.tradeId,
    dateKey: utcDateToKey(a.dateKey),
    verdict: a.verdict,
    invalidReasons: a.invalidReasons,
    executionIssues: a.executionIssues,
    executionQuality: a.executionQuality,
    mistake: a.mistake,
    weaknesses: a.weaknesses,
    underlyingWeakness: a.underlyingWeakness,
    improvement: a.improvement,
    assessedAt: a.assessedAt?.toISOString() ?? null,
    images: reviewImages("TRADE_AUDIT_ASSESSMENT", a.id),
  }));
  const assessmentByTrade = new Map(assessmentDTOs.filter((a) => a.tradeId).map((a) => [a.tradeId as string, a]));

  const expectedDTOs: ExpectedTradeDTO[] = expectedRows.map((e) => ({
    id: e.id,
    dateKey: utcDateToKey(e.dateKey),
    assetSymbol: e.assetSymbol,
    direction: e.direction,
    intendedEntry: num(e.intendedEntry),
    stopLoss: num(e.stopLoss),
    target: num(e.target),
    intendedRiskPercent: num(e.intendedRiskPercent),
    strategyId: e.strategyId,
    setupName: e.setupName,
    timeframe: e.timeframe,
    validityReason: e.validityReason,
    criteriaMet: e.criteriaMet,
    missReason: e.missReason as MissReasonValue | null,
    missNote: e.missNote,
    weaknesses: e.weaknesses as AuditWeaknessValue[],
    underlyingWeakness: e.underlyingWeakness,
    improvement: e.improvement,
    images: reviewImages("TRADE_AUDIT_EXPECTED", e.id),
  }));

  const liveMissedDTOs: LiveMissedOpportunityDTO[] = liveMissed.map((o) => {
    const dk = utcDateToKey(o.spottedAt);
    return {
      id: o.id,
      dateKey: dk,
      assetSymbol: o.assetSymbol,
      direction: o.direction,
      plannedEntry: num(o.plannedEntry),
      plannedStopLoss: num(o.plannedStopLoss),
      plannedTarget: num(o.plannedTarget),
      strategyName: o.strategyNameSnapshot,
      missReason: o.missReason as MissReasonValue | null,
      missNote: o.missNote,
      images: sessionImages("OPPORTUNITY", o.id, dk),
    };
  });

  const dayRowByKey = new Map(dayRows.map((d) => [utcDateToKey(d.dateKey), d]));
  const exceptions: PreparationDayException[] = exceptionRows.map((e) => ({ dateKey: utcDateToKey(e.date), kind: e.kind, createdAt: e.createdAt }));

  const activeDates = new Set<string>([
    ...shownTrades.map((t) => t.dateKey),
    ...liveTrades.map((t) => t.dateKey),
    ...expectedDTOs.map((e) => e.dateKey),
    ...liveMissedDTOs.map((o) => o.dateKey),
    ...dayRowByKey.keys(),
  ]);

  const days: AuditDayDTO[] = auditDays(week.weekStart, versions, exceptions, activeDates).map(({ dateKey, schedule }) => {
    const row = dayRowByKey.get(dateKey);
    const trades = shownTrades
      .filter((t) => t.dateKey === dateKey)
      .map((t) => ({ ...t, images: sessionImages("TRADE", t.id, t.dateKey) }));
    const assessments: Record<string, TradeAssessmentDTO> = {};
    for (const t of trades) {
      const a = assessmentByTrade.get(t.id);
      if (a) assessments[t.id] = a;
    }
    return {
      dateKey,
      schedule,
      status: (row?.status ?? "NOT_STARTED") as DailyAuditStatusValue,
      dailyAuditId: row?.id ?? null,
      noTradeReason: (row?.noTradeReason ?? null) as NoTradeReasonValue | null,
      wentWell: row?.wentWell ?? null,
      wentWrong: row?.wentWrong ?? null,
      couldDoBetter: row?.couldDoBetter ?? null,
      mainLesson: row?.mainLesson ?? null,
      trades,
      assessments,
      expectedTrades: expectedDTOs.filter((e) => e.dateKey === dateKey),
      liveMissed: liveMissedDTOs.filter((o) => o.dateKey === dateKey),
      dayImages: row ? reviewImages("TRADE_AUDIT_DAY", row.id) : [],
      changes: changesByDay.get(dateKey) ?? [],
    };
  });

  const summary =
    finalized && audit?.summarySnapshot
      ? (audit.summarySnapshot as unknown as WeeklyAuditSummary)
      : computeSummary(days);

  const allChanges = [...changesByDay.values()].flat();

  return {
    week,
    scope,
    audit: audit ? toAuditDTO(audit) : null,
    days,
    summary,
    hasFinalizedDrift: finalized && allChanges.length > 0,
    // A REMOVED trade can't be re-assessed; finalizing detaches it, so only
    // edits/moves of trades still in the week block finalization.
    unacknowledgedChanges: finalized ? 0 : allChanges.filter((c) => c.kind === "EDITED" || c.kind === "MOVED").length,
    legacyReflection:
      legacy && (legacy.wentWell != null || legacy.toImprove != null || legacy.focusNextWeek != null)
        ? { wentWell: legacy.wentWell, toImprove: legacy.toImprove, focusNextWeek: legacy.focusNextWeek }
        : null,
    commitments: commitmentRows.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      category: c.category,
      priority: c.priority,
      status: c.status,
      periodStart: utcDateToKey(c.periodStart),
    })),
    carryForward: carryForward.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      category: c.category,
      priority: c.priority,
      status: c.status,
      periodStart: c.periodStart,
    })),
    uploadsEnabled: isUploadsEnabled(),
  };
}

function computeSummary(days: AuditDayDTO[]): WeeklyAuditSummary {
  const trades = days.flatMap((d) => d.trades);
  return buildWeeklySummary({
    trades: trades.map((t) => ({ id: t.id, outcome: t.outcome, realizedR: t.realizedR, pnl: t.pnl, systemFlagCount: t.systemFlags.length })),
    assessments: days.flatMap((d) =>
      Object.entries(d.assessments).map(([tradeId, a]) => ({
        tradeId,
        verdict: a.verdict,
        invalidReasons: a.invalidReasons,
        executionIssues: a.executionIssues,
        executionQuality: a.executionQuality,
        weaknesses: a.weaknesses,
      })),
    ),
    misses: [
      ...days.flatMap((d) => d.expectedTrades.map((e) => ({ missReason: e.missReason, weaknesses: e.weaknesses, retrospective: true }))),
      ...days.flatMap((d) => d.liveMissed.map((o) => ({ missReason: o.missReason, weaknesses: [] as AuditWeaknessValue[], retrospective: false }))),
    ],
    days: days.map((d) => ({ status: d.status })),
  });
}

/** The week Edge Review opens on: the most recently completed trading week
 *  in the trader's own calendar and schedule. */
export async function getDefaultAuditWeekStart(userId: string): Promise<{ weekStart: string; todayKey: string }> {
  const todayKey = await getTraderTodayKey(userId);
  const current = auditWeekFor(todayKey);
  const [versions, exceptionRows] = await Promise.all([
    getScheduleVersions(userId),
    prisma.preparationDayException.findMany({
      where: { userId, date: { gte: dateKeyToUtcDate(current.weekStart), lte: dateKeyToUtcDate(current.weekEnd) } },
    }),
  ]);
  const exceptions = exceptionRows.map((e) => ({ dateKey: utcDateToKey(e.date), kind: e.kind, createdAt: e.createdAt }));
  return { weekStart: defaultAuditWeekStart(todayKey, versions, exceptions), todayKey };
}

// ── Writes: days ────────────────────────────────────────────────────────────

export async function saveDayAudit(
  userId: string,
  scope: AuditScope,
  dateKey: string,
  patch: Partial<{ noTradeReason: NoTradeReasonValue | null; wentWell: string | null; wentWrong: string | null; couldDoBetter: string | null; mainLesson: string | null }>,
): Promise<void> {
  const audit = await mutableAudit(userId, scope);
  if (!isInWeek(auditWeekFor(scope.weekStart), dateKey)) throw new TradeAuditError("That day is not part of this week.");
  const day = await touchDay(userId, audit.id, dateKey);
  await prisma.dailyTradeAudit.update({ where: { id: day.id }, data: patch });
}

export async function setDayStatus(userId: string, scope: AuditScope, dateKey: string, status: "IN_PROGRESS" | "COMPLETED"): Promise<void> {
  const audit = await mutableAudit(userId, scope);
  if (!isInWeek(auditWeekFor(scope.weekStart), dateKey)) throw new TradeAuditError("That day is not part of this week.");
  const day = await touchDay(userId, audit.id, dateKey);
  await prisma.dailyTradeAudit.update({
    where: { id: day.id },
    data: { status, completedAt: status === "COMPLETED" ? new Date() : null },
  });
}

// ── Writes: trade assessments ───────────────────────────────────────────────

/** The live, in-scope trade for this audit — ownership + week + scope check. */
async function liveTradeForAudit(userId: string, scope: AuditScope, tradeId: string): Promise<AuditTradeDTO> {
  const { week, strategyId, assetSymbols } = resolveScope(scope);
  const trades = await loadWeekTrades(userId, week, { strategyId, assetSymbols });
  const trade = trades.find((t) => t.id === tradeId);
  if (!trade) throw new TradeAuditError("Trade not found in this week.");
  return trade;
}

/**
 * Upsert on (auditId, tradeId) — re-saving never duplicates. Every save
 * re-stamps the fingerprint against the LIVE trade, so saving an assessment
 * is also how the trader acknowledges an edit made to the trade since.
 */
export async function saveTradeAssessment(
  userId: string,
  scope: AuditScope,
  tradeId: string,
  patch: Partial<{
    verdict: "VALID" | "INVALID" | "UNSURE" | null;
    invalidReasons: TradeAssessmentDTO["invalidReasons"];
    executionIssues: TradeAssessmentDTO["executionIssues"];
    executionQuality: number | null;
    mistake: string | null;
    weaknesses: AuditWeaknessValue[];
    underlyingWeakness: string | null;
    improvement: string | null;
  }>,
): Promise<{ assessmentId: string }> {
  const audit = await mutableAudit(userId, scope);
  const trade = await liveTradeForAudit(userId, scope, tradeId);
  // A VALID verdict can't carry "why it was invalid" reasons.
  const data = { ...patch, ...(patch.verdict && patch.verdict !== "INVALID" ? { invalidReasons: [] } : {}) };
  const stamp = { tradeFingerprint: tradeFingerprint(trade), tradeSnapshot: trade as unknown as Prisma.InputJsonValue, dateKey: dateKeyToUtcDate(trade.dateKey), assessedAt: new Date() };
  const row = await prisma.tradeAuditAssessment.upsert({
    where: { auditId_tradeId: { auditId: audit.id, tradeId } },
    update: { ...data, ...stamp },
    create: { userId, auditId: audit.id, tradeId, ...data, ...stamp },
  });
  await touchDay(userId, audit.id, trade.dateKey);
  return { assessmentId: row.id };
}

// ── Writes: expected trades ─────────────────────────────────────────────────

type ExpectedData = {
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  intendedEntry?: number | null;
  stopLoss?: number | null;
  target?: number | null;
  intendedRiskPercent?: number | null;
  strategyId?: string | null;
  setupName?: string | null;
  timeframe?: string | null;
  validityReason: string;
  criteriaMet?: string[];
  missReason?: MissReasonValue | null;
  missNote?: string | null;
  weaknesses?: AuditWeaknessValue[];
  underlyingWeakness?: string | null;
  improvement?: string | null;
};

async function assertStrategyOwned(userId: string, strategyId: string | null | undefined) {
  if (!strategyId) return;
  const owns = await prisma.strategy.findFirst({ where: { id: strategyId, userId }, select: { id: true } });
  if (!owns) throw new TradeAuditError("Strategy not found.");
}

const dec = (n: number | null | undefined) => (n == null ? n : new Prisma.Decimal(n));

/** Idempotent on (auditId, clientKey): a double submit returns the first row. */
export async function createExpectedTrade(userId: string, scope: AuditScope, dateKey: string, clientKey: string, data: ExpectedData): Promise<{ id: string }> {
  const audit = await mutableAudit(userId, scope);
  if (!isInWeek(auditWeekFor(scope.weekStart), dateKey)) throw new TradeAuditError("That day is not part of this week.");
  await assertStrategyOwned(userId, data.strategyId);
  const row = await prisma.auditExpectedTrade.upsert({
    where: { auditId_clientKey: { auditId: audit.id, clientKey } },
    update: {},
    create: {
      userId,
      auditId: audit.id,
      dateKey: dateKeyToUtcDate(dateKey),
      clientKey,
      ...data,
      assetSymbol: data.assetSymbol.toUpperCase(),
      intendedEntry: dec(data.intendedEntry),
      stopLoss: dec(data.stopLoss),
      target: dec(data.target),
      intendedRiskPercent: dec(data.intendedRiskPercent),
    },
  });
  await touchDay(userId, audit.id, dateKey);
  return { id: row.id };
}

async function ownedExpected(userId: string, id: string) {
  const row = await prisma.auditExpectedTrade.findFirst({ where: { id, userId }, include: { audit: { select: { status: true } } } });
  if (!row) throw new TradeAuditError("Expected trade not found.");
  assertMutable(row.audit);
  return row;
}

export async function updateExpectedTrade(userId: string, id: string, patch: Partial<ExpectedData>): Promise<void> {
  await ownedExpected(userId, id);
  await assertStrategyOwned(userId, patch.strategyId);
  const data: Prisma.AuditExpectedTradeUpdateInput = { ...patch };
  if (patch.assetSymbol) data.assetSymbol = patch.assetSymbol.toUpperCase();
  for (const k of ["intendedEntry", "stopLoss", "target", "intendedRiskPercent"] as const) {
    if (k in patch) data[k] = dec(patch[k]);
  }
  if ("strategyId" in patch) {
    delete (data as Record<string, unknown>).strategyId;
    data.strategy = patch.strategyId ? { connect: { id: patch.strategyId } } : { disconnect: true };
  }
  await prisma.auditExpectedTrade.update({ where: { id }, data });
}

/** Deletes the expected trade and its review screenshots (files included). */
export async function deleteExpectedTrade(userId: string, id: string): Promise<void> {
  await ownedExpected(userId, id);
  const attachments = await prisma.mediaAttachment.findMany({
    where: { ownerType: "TRADE_AUDIT_EXPECTED", ownerId: id, media: { userId } },
    select: { id: true },
  });
  for (const a of attachments) await deleteMediaAttachment(userId, a.id);
  await prisma.auditExpectedTrade.delete({ where: { id } });
}

// ── Upload owners ───────────────────────────────────────────────────────────

/**
 * Uploads need an owner row to attach to. Resolves (creating idempotently)
 * the assessment for a trade or the day row, and returns its id. The upload
 * route re-checks ownership and mutability itself (`assertAuditMediaOwner`).
 */
export async function ensureUploadOwner(
  userId: string,
  input: { kind: "ASSESSMENT"; scope: AuditScope; tradeId: string } | { kind: "DAY"; scope: AuditScope; dateKey: string },
): Promise<{ ownerType: MediaOwnerType; ownerId: string }> {
  const audit = await mutableAudit(userId, input.scope);
  if (input.kind === "DAY") {
    if (!isInWeek(auditWeekFor(input.scope.weekStart), input.dateKey)) throw new TradeAuditError("That day is not part of this week.");
    const day = await touchDay(userId, audit.id, input.dateKey);
    return { ownerType: "TRADE_AUDIT_DAY", ownerId: day.id };
  }
  const existing = await prisma.tradeAuditAssessment.findUnique({ where: { auditId_tradeId: { auditId: audit.id, tradeId: input.tradeId } } });
  if (existing) return { ownerType: "TRADE_AUDIT_ASSESSMENT", ownerId: existing.id };
  const { assessmentId } = await saveTradeAssessment(userId, input.scope, input.tradeId, {});
  return { ownerType: "TRADE_AUDIT_ASSESSMENT", ownerId: assessmentId };
}

// ── Annotations ─────────────────────────────────────────────────────────────

/**
 * Markers over a screenshot the trader can see in this audit (their own
 * media). Stored beside the image, never baked into it. An empty list removes
 * the annotation.
 */
export async function saveAnnotation(userId: string, scope: AuditScope, attachmentId: string, markers: AnnotationMarker[]): Promise<void> {
  const audit = await mutableAudit(userId, scope);
  const attachment = await prisma.mediaAttachment.findFirst({ where: { id: attachmentId, media: { userId } }, select: { id: true } });
  if (!attachment) throw new TradeAuditError("Screenshot not found.");
  if (markers.length === 0) {
    await prisma.tradeAuditAnnotation.deleteMany({ where: { auditId: audit.id, mediaAttachmentId: attachmentId, userId } });
    return;
  }
  const json = markers as unknown as Prisma.InputJsonValue;
  await prisma.tradeAuditAnnotation.upsert({
    where: { auditId_mediaAttachmentId: { auditId: audit.id, mediaAttachmentId: attachmentId } },
    update: { markers: json },
    create: { userId, auditId: audit.id, mediaAttachmentId: attachmentId, markers: json },
  });
}

// ── Weekly assessment, finalize, reopen ─────────────────────────────────────

export async function saveWeeklyAssessment(userId: string, scope: AuditScope, patch: Partial<AuditAssessmentText & AuditRatings>): Promise<void> {
  const audit = await mutableAudit(userId, scope);
  await prisma.weeklyTradeAudit.update({ where: { id: audit.id }, data: patch });
}

export class UnacknowledgedChangesError extends TradeAuditError {}

/**
 * Freezes the week: every in-scope trade gets an assessment row (created
 * empty if the trader never judged it) carrying the trade's display facts as
 * `tradeSnapshot` + fingerprint, and the weekly summary is frozen as
 * `summarySnapshot`. Refuses while an assessed trade has unacknowledged edits
 * — finalizing over them would freeze a judgment of facts that no longer hold.
 * Status-guarded, so a double click finalizes once.
 */
export async function finalizeAudit(userId: string, scope: AuditScope): Promise<void> {
  const audit = await mutableAudit(userId, scope);
  const workspace = await loadAuditWorkspace(userId, scope);
  if (workspace.unacknowledgedChanges > 0) {
    throw new UnacknowledgedChangesError("Some trades changed after you assessed them. Re-check them before finalizing.");
  }
  const trades = workspace.days.flatMap((d) => d.trades);

  await prisma.$transaction(async (tx) => {
    for (const t of trades) {
      const snapshot = { ...t, images: [] } as unknown as Prisma.InputJsonValue;
      const stamp = { tradeSnapshot: snapshot, tradeFingerprint: tradeFingerprint(t), dateKey: dateKeyToUtcDate(t.dateKey) };
      await tx.tradeAuditAssessment.upsert({
        where: { auditId_tradeId: { auditId: audit.id, tradeId: t.id } },
        update: stamp,
        create: { userId, auditId: audit.id, tradeId: t.id, ...stamp },
      });
    }
    // Assessments for trades that left the week/scope before finalizing are
    // detached from the frozen week (kept, but not shown as part of it).
    await tx.tradeAuditAssessment.updateMany({
      where: { auditId: audit.id, userId, tradeId: { notIn: trades.map((t) => t.id) } },
      data: { tradeSnapshot: Prisma.DbNull },
    });
    const result = await tx.weeklyTradeAudit.updateMany({
      where: { id: audit.id, userId, status: "IN_PROGRESS" },
      data: { status: "FINALIZED", finalizedAt: new Date(), summarySnapshot: workspace.summary as unknown as Prisma.InputJsonValue },
    });
    if (result.count === 0) throw new TradeAuditError("This week is already finalized.");
  });

  // Commitment follow-through (optional): automatic evidence for this week.
  await syncSystemEvidenceForPeriod(userId, { reviewType: "WEEKLY", startDate: workspace.week.weekStart, endDate: workspace.week.weekEnd }).catch(() => undefined);
}

/** Explicit, recorded reopening — the only way a finalized week changes. */
export async function reopenAudit(userId: string, scope: AuditScope): Promise<void> {
  const audit = await findAudit(userId, scope);
  if (!audit || audit.userId !== userId) throw new TradeAuditError("Audit not found.");
  if (audit.status !== "FINALIZED") return;
  await prisma.weeklyTradeAudit.update({
    where: { id: audit.id },
    data: { status: "IN_PROGRESS", reopenedAt: new Date(), summarySnapshot: Prisma.DbNull },
  });
}

/** Optional follow-through: one commitment from this week's review. */
export async function createCommitmentFromAudit(
  userId: string,
  scope: AuditScope,
  input: { category: "EXECUTION" | "BEHAVIOR" | "PROCESS" | "OPPORTUNITY" | "STRATEGY" | "RISK"; title: string; description: string | null; priority: "HIGH" | "MEDIUM" | "LOW" },
): Promise<{ id: string }> {
  const audit = await getOrCreateAudit(userId, scope);
  const week = auditWeekFor(scope.weekStart);
  const row = await prisma.edgeReviewCommitment.create({
    data: {
      userId,
      weeklyTradeAuditId: audit.id,
      reviewType: "WEEKLY",
      periodStart: dateKeyToUtcDate(week.weekStart),
      effectiveFrom: dateKeyToUtcDate(addDaysToKey(week.weekEnd, 1)),
      category: input.category,
      title: input.title,
      description: input.description,
      priority: input.priority,
      source: "MANUAL",
    },
  });
  return { id: row.id };
}

/**
 * Carry a previous week's still-active commitment into this week: Continue
 * (same lineage into this audit), mark it Done, or Drop it. The candidate
 * must actually be one the workspace offers for this week.
 */
export async function resolveCarriedCommitment(
  userId: string,
  scope: AuditScope,
  commitmentId: string,
  decision: "CONTINUE" | "DONE" | "DROP",
): Promise<void> {
  const current = await findAudit(userId, scope);
  if (current?.status === "FINALIZED") throw new TradeAuditError("This week is finalized. Reopen it to make changes.");
  const candidates = await listCarryForwardForWeek(userId, auditWeekFor(scope.weekStart).weekStart, current?.id ?? null);
  if (!candidates.some((c) => c.id === commitmentId)) throw new TradeAuditError("That commitment isn't open for carrying forward from this week.");
  if (decision === "CONTINUE") {
    const audit = await mutableAudit(userId, scope);
    await continueCommitmentIntoAudit(userId, commitmentId, { id: audit.id, weekStart: audit.weekStart, weekEnd: audit.weekEnd });
    return;
  }
  await setCommitmentStatus(userId, commitmentId, decision === "DONE" ? "COMPLETED" : "RETIRED");
}

/** Mark a commitment created in this audit as done / dropped / active again. */
export async function setAuditCommitmentStatus(userId: string, scope: AuditScope, commitmentId: string, status: "ACTIVE" | "COMPLETED" | "RETIRED"): Promise<void> {
  const audit = await findAudit(userId, scope);
  if (!audit) throw new TradeAuditError("Audit not found.");
  const owned = await prisma.edgeReviewCommitment.findFirst({ where: { id: commitmentId, userId, weeklyTradeAuditId: audit.id }, select: { id: true } });
  if (!owned) throw new TradeAuditError("Commitment not found.");
  await setCommitmentStatus(userId, commitmentId, status);
}

export type { TradeChangeDTO };
