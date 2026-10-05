import { Prisma } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import { currentWorkspaceScope, isBacktestScope, scopeBacktestRunId } from "@/server/workspace/scope";
import { dailyPercentsFromBalanceHistory } from "@/domain/performance/rr";
import { scorePsychology, type PsychologyAnswer } from "@/domain/psychology/scoring";
import { deriveStatus, nextClosedAt, nextReviewedAt } from "@/domain/trades/lifecycle";
import { syncLiveTradeLifecycle } from "@/server/services/trade-lifecycle-sync.service";
import { sanitizeAdherenceAnswers, scoreAdherence } from "@/domain/trades/adherence";
import type { TradeInput, TradeWorkspaceSectionInput } from "@/lib/validation/trades";
import {
  getAccountTrackRecord,
  getOrCreatePerformanceAccount,
  listTradingAccounts,
  PERFORMANCE_ACCOUNT_STARTING_BALANCE,
} from "@/server/services/accounts.service";
import { getStrategyReference, listStrategies } from "@/server/services/strategies.service";
import { scoreStrategyAdherence } from "@/domain/trades/strategy-adherence";
import { scoreSetup } from "@/domain/trades/setup-score";
import {
  buildSetupValidationSnapshot,
  type OverrideReasonValue,
  type TradeValidationStateValue,
} from "@/domain/trades/setup-validation";
import { getEffectiveScenario } from "@/server/services/strategy-setup-types.service";
import { getFinalBiasForAsset } from "@/server/services/daily-asset-analysis.service";
import { syncExecutionsWithinTx } from "@/server/services/trade-executions.service";
import { listActivePropFirmAccountsForSelector } from "@/server/services/prop-firms.service";
import { lockPlanIfConfirmedAndUnlocked } from "@/server/services/trade-plan.service";
import {
  getPerformanceConfig,
  lockPerformanceRiskSnapshot,
  settlePerformanceTrade,
} from "@/server/services/performance-account.service";

// Composes the reference data the trade form needs (accounts/assets/
// sessions/entry-models/checklists), reusing each feature's own service
// rather than re-querying Prisma directly.
export async function getTradeFormOptions(userId: string) {
  // SOT: a trade's strategy is the gateway — its markets, sessions, confluences,
  // execution AND entry models are loaded client-side from the selected strategy's
  // reference. The form only needs the account list and the strategy picker.
  const [accounts, strategies, propFirmAccounts] = await Promise.all([
    listTradingAccounts(userId),
    listStrategies(userId),
    listActivePropFirmAccountsForSelector(userId),
  ]);

  // Only offer non-archived strategies for a new selection; the edit page adds
  // back a currently-linked archived strategy so it stays visible.
  const selectableStrategies = strategies.filter((s) => s.status !== "ARCHIVED");

  return {
    accounts,
    strategies: selectableStrategies,
    propFirmAccounts,
  };
}

export const tradeInclude = {
  // Live reference for linking only. The nested include is NOT soft-delete
  // filtered (the extension only guards top-level queries), so `deletedAt` is
  // selected too — a soft-deleted strategy must not render a live link. The
  // *Snapshot columns on Trade preserve the strategy identity regardless.
  strategy: {
    select: {
      id: true,
      name: true,
      version: true,
      status: true,
      deletedAt: true,
      // Live benchmark for the per-trade Discrepancy Gap (D4).
      tradeManagement: { select: { expectedExpectancy: true } },
    },
  },
  allocations: { include: { tradingAccount: true } },
  psychology: true,
  // Planned TPs from the confirmed TradingView Trade Plan — the sole source
  // for the "which targets are planned" badges (Journal day view + Trade
  // Execution section); no separate manual TP-hit input exists anymore.
  plannedTargets: { orderBy: { targetOrder: "asc" } },
  // Existence-only — powers a "has a plan screenshot attached" flag (Dashboard
  // recent-trades table) without pulling the actual image data.
  planScreenshot: { select: { id: true } },
  // Today V2 Phase 2 (§5/§6/§10) — the frozen risk/initial-stop/realized-R
  // facts Trade Execution presents; null until an actual entry locks one.
  performanceRiskSnapshot: {
    select: { riskPercent: true, riskAmount: true, initialStop: true, realizedR: true, settledAt: true },
  },
} as const;

/** A Trade with all the relations the Trade Workspace DTO needs. Returned by
 *  getTrade / listTradesForDay / listRecentTrades; mapped by toTradeWorkspaceDTO. */
export type TradeWithWorkspaceRelations = Prisma.TradeGetPayload<{ include: typeof tradeInclude }>;

// Score is always (re)computed server-side from the answers, never trusted
// from the client — this is what guarantees a persisted score/grade can
// never drift from what the pure scoring function would produce. Returns null
// when the questionnaire isn't fully/validly answered yet (a trade logged as
// an idea) — the caller then persists no PsychologyQuestionnaireResponse row.
function scorePsychologyAnswers(answers: TradeInput["psychologyAnswers"]) {
  const answerList: PsychologyAnswer[] = Object.entries(answers ?? {}).map(([key, value]) => ({
    key,
    value,
  }));
  try {
    const { rawScore, percent, grade } = scorePsychology(answerList);
    return { answers, rawScore, psychologyPercent: percent, grade };
  } catch {
    return null;
  }
}

// The free-text fields whose presence means "this trade has been reviewed":
// the /edit form's psychology reflections plus the workspace review prompts.
const REVIEW_TEXT_FIELDS = [
  "psychPostTradeReflection",
  "psychLessonsLearned",
  "psychWhatToWorkOn",
  "whatWentWell",
  "whatWentWrong",
  "whatSurprisedMe",
  "whatCouldImprove",
] as const;

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function tradeScalarData(data: TradeInput) {
  return {
    executionMinutes: data.executionMinutes,
    direction: data.direction,
    higherTimeframeBias: data.higherTimeframeBias,
    biasConfidencePercent: data.biasConfidencePercent,
    expectedRR: data.expectedRR,
    actualRR: data.actualRR,
    psychPreTradeMindset: data.psychPreTradeMindset,
    psychPostTradeReflection: data.psychPostTradeReflection,
    psychLessonsLearned: data.psychLessonsLearned,
    psychWhatToWorkOn: data.psychWhatToWorkOn,
    // Pre-Trade Mood Snapshot (Stage 5) — a plain mutable scalar, like the
    // psych* free text above: written fresh on every save, no freeze/history.
    preTradeMoodTags: data.preTradeMoodTags,
    preTradeMoodIntensity: data.preTradeMoodIntensity,
    preTradeMoodNote: data.preTradeMoodNote,
  };
}

// The market + session columns written on every trade. `assetSymbol` /
// `selectedSession` are the SOT source of truth (the global Asset/TradingSession
// FKs were dropped in P9).
function tradeMarketData(data: TradeInput) {
  return {
    assetSymbol: data.assetSymbol,
    selectedSession: data.selectedSession,
  };
}

/**
 * Builds every allocation row for a trade: the Performance Account's own
 * automatic allocation (spec §3/§4 — created every time, PnL starts NULL
 * ("not settled yet" — never a misleading 0) at save time; the ONLY writer
 * of its PnL going forward is performance-account.service.ts's
 * settlePerformanceTrade, driven by the trade's actual execution data, never
 * this form), plus one row per
 * additional REAL participating account, each with its own independently
 * entered risk% and PnL (spec §1/§17 — never derived/scaled from the
 * Performance Account's result).
 *
 * The Performance allocation's `riskValue` is the pre-execution risk%
 * override surface (spec §5): the trade's explicit override when given,
 * else the account's configured default. On an EDIT, once the risk
 * snapshot is already locked this incoming value is ignored — the locked
 * snapshot's own frozen riskPercent is what settlement actually uses, so a
 * later form re-save can never silently change historical risk.
 */
async function buildAllocations(userId: string, data: TradeInput, excludeTradeId?: string) {
  // Backtesting — a simulated trade never participates in the Performance
  // Account or any real account (also enforced by a DB trigger).
  if (isBacktestScope()) {
    if (data.allocations.length > 0) throw new Error("Backtest trades can't be allocated to trading accounts.");
    return [];
  }
  const performanceAccount = await getOrCreatePerformanceAccount(userId);
  const performanceConfig = await getPerformanceConfig(userId);
  const performanceRiskPercent = data.performanceRiskPercentOverride ?? performanceConfig.defaultRiskPercent.toNumber();

  const alreadyLocked = excludeTradeId
    ? await prisma.performanceRiskSnapshot.findUnique({ where: { tradeId: excludeTradeId }, select: { riskPercent: true } })
    : null;

  const participating = data.allocations.map((a) => ({
    tradingAccountId: a.tradingAccountId,
    riskInputType: a.riskInputType,
    riskValue: a.riskValue,
    closingPnlGross: a.closingPnlGross,
    closingPnlNet: a.closingPnlNet,
  }));

  return [
    {
      tradingAccountId: performanceAccount.id,
      riskInputType: "PERCENT" as const,
      riskValue: alreadyLocked ? alreadyLocked.riskPercent.toNumber() : performanceRiskPercent,
      // NULL = not settled yet — never written here as a fake 0. See the
      // doc comment above.
      closingPnlGross: null,
      closingPnlNet: null,
    },
    ...participating,
  ];
}

/**
 * Freezes the strategy reference + display snapshots at save time. The strategy
 * name/version come from the strategy's *current* state; the entry model is the
 * one chosen from the selected strategy's own Entry Models (validated + frozen by
 * name). All are stored on the Trade so a completed trade keeps showing the
 * strategy as it was when saved, even if the strategy is later versioned, renamed,
 * or deleted. A strategyId that doesn't belong to the user is dropped (treated as
 * no strategy).
 */
type StrategySnapshot = {
  strategyId: string | null;
  strategyNameSnapshot: string | null;
  strategyVersionSnapshot: number | null;
};

async function buildTradeSnapshots(
  userId: string,
  data: TradeInput,
  existing?: StrategySnapshot,
) {
  // SOT: the entry model must be one of the *selected strategy's* own Entry Models
  // — a selection from any other strategy (or a stale/forged name) is rejected. The
  // validated name is frozen on the trade so the record survives strategy edits.
  let selectedEntryModel: string | null = null;
  if (data.selectedEntryModel && data.strategyId) {
    const match = await prisma.strategyEntryModel.findFirst({
      where: {
        name: data.selectedEntryModel,
        deletedAt: null,
        strategy: { id: data.strategyId, userId },
      },
      select: { name: true },
    });
    selectedEntryModel = match?.name ?? null;
  }

  // The strategy snapshot is FROZEN once linked: while the selection is unchanged
  // it's kept exactly as-is — even if the strategy was since renamed, versioned,
  // or deleted — so a completed trade never loses the strategy it was taken under
  // (re-deriving here would wipe the snapshot the moment its strategy is gone).
  // Recompute only when the selection actually changes (or on create).
  if (existing && data.strategyId === existing.strategyId) {
    return { ...existing, selectedEntryModel };
  }

  let strategyId: string | null = null;
  let strategyNameSnapshot: string | null = null;
  let strategyVersionSnapshot: number | null = null;

  if (data.strategyId) {
    const strategy = await prisma.strategy.findFirst({
      where: { id: data.strategyId, userId },
      select: { id: true, name: true, version: true },
    });
    if (strategy) {
      strategyId = strategy.id;
      strategyNameSnapshot = strategy.name;
      strategyVersionSnapshot = strategy.version;
    }
  }

  return { strategyId, strategyNameSnapshot, strategyVersionSnapshot, selectedEntryModel };
}

interface FrozenExpected {
  sessions: { name: string; color: string }[];
  confluences: {
    id?: string;
    name: string;
    color: string;
    category: string | null;
    weight: number | null;
    mandatory?: boolean;
    // Frozen at trade time so a later strategy edit can't change which
    // confluences were eligible for THIS trade's direction. Absent on
    // pre-direction snapshots → treated as BOTH.
    directionApplicability?: "BULLISH" | "BEARISH" | "BOTH";
    pairId?: string | null;
  }[];
  execution: { name: string; color: string; category: string | null; weight: number | null }[];
}

/**
 * Strategy = single source of truth: freeze the strategy's expected confluences /
 * execution set at trade time, record what the trader selected (enriched with each
 * tag's color so the record is self-contained), and score adherence. Frozen on the
 * first save; kept on update while the strategy selection is unchanged.
 */
async function buildStrategyExecution(
  userId: string,
  data: TradeInput,
  existing?: { strategyId: string | null; strategyExecutionSnapshot: Prisma.JsonValue | null },
) {
  let expected: FrozenExpected | null = null;
  if (existing && data.strategyId === existing.strategyId && existing.strategyExecutionSnapshot) {
    expected = existing.strategyExecutionSnapshot as unknown as FrozenExpected;
  } else if (data.strategyId) {
    const ref = await getStrategyReference(userId, data.strategyId);
    expected = ref ? { sessions: ref.sessions, confluences: ref.confluences, execution: ref.execution } : null;
  }

  const scores = scoreStrategyAdherence(
    expected,
    data.selectedConfluences,
    data.selectedExecution,
    data.direction,
  );

  // Weighted confluence "setup score" — the probability/quality engine. Frozen
  // from the expected confluences' weights + mandatory flags vs what was present.
  // Direction-aware: bullish-only weight never enters a short trade's denominator
  // (and vice-versa). `directionApplicability` comes from the frozen snapshot, so
  // a later strategy edit can't rewrite this trade's score.
  const setup = scoreSetup(
    (expected?.confluences ?? []).map((c) => ({
      id: c.id ?? c.name,
      name: c.name,
      weight: c.weight,
      mandatory: c.mandatory ?? false,
      directionApplicability: c.directionApplicability ?? "BOTH",
    })),
    data.selectedConfluences,
    { direction: data.direction },
  );

  // selected* are stored as plain name arrays; each name's color is resolved at
  // render time from the frozen `strategyExecutionSnapshot` (the expected set),
  // so the record stays compact and a single source carries the colors.
  return {
    strategyExecutionSnapshot: (expected ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    selectedConfluences: data.selectedConfluences as unknown as Prisma.InputJsonValue,
    selectedExecution: data.selectedExecution as unknown as Prisma.InputJsonValue,
    confluencePercent: scores.confluencePercent,
    executionPercent: scores.executionPercent,
    tradeQualityPercent: scores.tradeQualityPercent,
    // Weighted setup scoring (null score when the strategy defined no weights).
    setupScore: setup.setupScore,
    setupRating: expected ? setup.setupRating : null,
    setupValid: expected ? setup.setupValid : null,
    missingConfluences: (expected
      ? setup.missingConfluences
      : []) as unknown as Prisma.InputJsonValue,
  };
}

// ── Trade Idea Validation Shield (Stage 4) ───────────────────────────────────

interface SetupValidationResult {
  setupTypeId: string | null;
  setupScenarioId: string | null;
  selectedSetupConditions: Prisma.InputJsonValue | typeof Prisma.DbNull;
  setupValidationSnapshot: Prisma.InputJsonValue | typeof Prisma.DbNull;
  validationState: TradeValidationStateValue | null;
  overrideReason: OverrideReasonValue | null;
  overrideNote: string | null;
}

const emptySetupValidation: SetupValidationResult = {
  setupTypeId: null,
  setupScenarioId: null,
  selectedSetupConditions: Prisma.DbNull,
  setupValidationSnapshot: Prisma.DbNull,
  validationState: null,
  overrideReason: null,
  overrideNote: null,
};

interface ExistingSetupValidation {
  setupTypeId: string | null;
  setupScenarioId: string | null;
  selectedSetupConditions: Prisma.JsonValue | null;
  setupValidationSnapshot: Prisma.JsonValue | null;
  validationState: TradeValidationStateValue | null;
  overrideReason: OverrideReasonValue | null;
  overrideNote: string | null;
  actualEntry: Prisma.Decimal | null;
}

/**
 * Resolves setupTypeId -> the live effective scenario for (setupTypeId,
 * direction), scores what the trader checked, and freezes the result —
 * mirroring buildStrategyExecution's own freeze/recompute split. Entirely
 * additive: a trade with no setupTypeId gets the all-null result and the
 * legacy flat-confluence flow (selectedConfluences/setupScore above) is
 * completely unaffected either way.
 *
 * Once the trade has an actualEntry it's historically frozen — like
 * performanceRiskPercentOverride, ANY resubmitted setup-validation fields are
 * ignored from that point on, so an unrelated later edit (or a live Strategy
 * Lab change to the Setup Type) can never alter a trade's historical setup
 * evidence. Before that point every save recomputes fresh against the LIVE
 * scenario, so the trader can keep checking boxes — and switch strategy /
 * direction / Setup Type — right up until execution.
 */
async function buildSetupValidation(
  userId: string,
  data: TradeInput,
  strategySnapshot: { strategyNameSnapshot: string | null; strategyVersionSnapshot: number | null },
  existing?: ExistingSetupValidation,
): Promise<SetupValidationResult> {
  if (existing && existing.actualEntry != null) {
    return {
      setupTypeId: existing.setupTypeId,
      setupScenarioId: existing.setupScenarioId,
      selectedSetupConditions: (existing.selectedSetupConditions ?? Prisma.DbNull) as Prisma.InputJsonValue,
      setupValidationSnapshot: (existing.setupValidationSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue,
      validationState: existing.validationState,
      overrideReason: existing.overrideReason,
      overrideNote: existing.overrideNote,
    };
  }

  if (!data.setupTypeId) return emptySetupValidation;

  // A Setup Type always belongs to a specific strategy — a freeform trade (no
  // strategy) or a setupTypeId from a DIFFERENT strategy than the one
  // selected is an invalid combination, rejected rather than silently ignored.
  if (!data.strategyId) {
    throw new Error("A strategy must be selected to use a Setup Type.");
  }
  const owns = await prisma.strategySetupType.findFirst({
    where: { id: data.setupTypeId, userId, strategyId: data.strategyId },
    select: { id: true },
  });
  if (!owns) throw new Error("Setup type not found for the selected strategy.");

  // LONG -> BULLISH, SHORT -> BEARISH. The trader never picks the scenario
  // side directly (spec §1) — getEffectiveScenario is also the userId-scoped
  // read path, so a cross-user setupTypeId resolves to null here.
  const scenarioDirection = data.direction === "LONG" ? "BULLISH" : "BEARISH";
  const effective = await getEffectiveScenario(userId, data.setupTypeId, scenarioDirection);
  if (!effective) throw new Error("Setup type scenario not found.");

  const { snapshot, validationState, overrideReason, overrideNote } = buildSetupValidationSnapshot({
    strategyName: strategySnapshot.strategyNameSnapshot,
    strategyVersion: strategySnapshot.strategyVersionSnapshot,
    setupType: effective.setupType,
    scenario: { id: effective.scenario.id, direction: effective.scenario.direction },
    conditions: effective.conditions,
    selectedChecklistItemIds: data.selectedSetupConditions,
    overrideReason: data.setupOverrideReason,
    overrideNote: data.setupOverrideNote,
  });

  return {
    setupTypeId: effective.setupType.id,
    setupScenarioId: effective.scenario.id,
    selectedSetupConditions: data.selectedSetupConditions as unknown as Prisma.InputJsonValue,
    setupValidationSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    validationState,
    overrideReason,
    overrideNote,
  };
}

export async function listTradesForDay(userId: string, dateKey: string) {
  return prisma.trade.findMany({
    where: { userId, tradeDate: dateKeyToUtcDate(dateKey) },
    include: tradeInclude,
    orderBy: { executionMinutes: "asc" },
  });
}

/** Every trade across all days, newest first — backs the Trade Gallery (P8). */
export async function listAllTrades(userId: string) {
  return prisma.trade.findMany({
    where: { userId },
    include: tradeInclude,
    orderBy: [{ tradeDate: "desc" }, { executionMinutes: "desc" }],
  });
}

/** Most recent trades across all days — backs the dashboard's recent-trades list. */
export async function listRecentTrades(userId: string, limit: number) {
  return prisma.trade.findMany({
    where: { userId },
    include: tradeInclude,
    orderBy: [{ tradeDate: "desc" }, { executionMinutes: "desc" }],
    take: limit,
  });
}

export async function getTrade(userId: string, tradeId: string) {
  return prisma.trade.findFirst({
    where: { id: tradeId, userId },
    include: tradeInclude,
  });
}

/**
 * A stable-ish "Trade #N" for the workspace header: this trade's position in the
 * user's creation-ordered history. Derived (not persisted) so Phase 1 needs no
 * schema change — a real monotonic trade number is a suggested later DB addition.
 */
export async function getTradeOrdinal(userId: string, createdAt: Date) {
  return prisma.trade.count({
    where: { userId, createdAt: { lte: createdAt } },
  });
}

/**
 * The next per-user trade number: MAX(tradeNumber)+1 including soft-deleted rows
 * (raw query bypasses the soft-delete filter) so numbers are stable and never
 * reused. The @@unique([userId, tradeNumber]) guards against a rare concurrent
 * collision — the second create would fail and can be retried.
 */
// Raw SQL (includes soft-deleted rows so a number is never reused) — so it
// bypasses the workspace-scope extension and must scope itself: LIVE trades
// number per user (backtestRunId IS NULL), backtest trades number per run.
//
// Must run inside the creating transaction: a transaction-scoped advisory lock
// keyed by (user, environment) serializes concurrent creates in the SAME
// environment (MAX+1 would otherwise hand two of them the same number), while
// different users/runs never wait on each other. Released at commit/rollback.
async function nextTradeNumber(tx: TransactionClient, userId: string): Promise<number> {
  const runId = scopeBacktestRunId();
  if (runId === undefined) {
    throw new Error(`nextTradeNumber requires a LIVE or BACKTEST scope (got ${currentWorkspaceScope().environment}).`);
  }
  const lockKey = `trade-number:${userId}:${runId ?? "live"}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  const rows =
    runId === null
      ? await tx.$queryRaw<{ max: number }[]>`
          SELECT COALESCE(MAX("tradeNumber"), 0)::int AS max FROM "Trade"
          WHERE "userId" = ${userId} AND "backtestRunId" IS NULL
        `
      : await tx.$queryRaw<{ max: number }[]>`
          SELECT COALESCE(MAX("tradeNumber"), 0)::int AS max FROM "Trade"
          WHERE "userId" = ${userId} AND "backtestRunId" = ${runId}
        `;
  return (rows[0]?.max ?? 0) + 1;
}

export async function createTrade(userId: string, dateKey: string, data: TradeInput) {
  const psychology = scorePsychologyAnswers(data.psychologyAnswers);
  const allocations = await buildAllocations(userId, data);
  const snapshots = await buildTradeSnapshots(userId, data);
  const strategyExec = await buildStrategyExecution(userId, data);
  const setupValidation = await buildSetupValidation(userId, data, snapshots);
  const dailyBiasSnapshot = await getFinalBiasForAsset(userId, dateKey, data.assetSymbol);
  const assetLink = tradeMarketData(data);
  if (isBacktestScope() && data.propFirmExecutions.length > 0) {
    throw new Error("Backtest trades can't be executed on Prop Firm accounts.");
  }

  const now = new Date();
  const hasReview = hasText(data.psychPostTradeReflection) ||
    hasText(data.psychLessonsLearned) ||
    hasText(data.psychWhatToWorkOn);
  const closedAt = nextClosedAt(null, data.actualRR != null, now);
  const reviewedAt = nextReviewedAt(null, hasReview, now);

  return prisma.$transaction(async (tx) => {
    const tradeNumber = await nextTradeNumber(tx, userId);
    const trade = await tx.trade.create({
      data: {
        userId,
        tradeDate: dateKeyToUtcDate(dateKey),
        ...tradeScalarData(data),
        ...assetLink,
        ...snapshots,
        tradeNumber,
        closedAt,
        reviewedAt,
        status: deriveStatus(closedAt, reviewedAt),
        ...strategyExec,
        ...setupValidation,
        dailyBiasSnapshot,
        ...(allocations.length > 0 ? { allocations: { create: allocations } } : {}),
        ...(psychology ? { psychology: { create: psychology } } : {}),
      },
      include: tradeInclude,
    });

    // Prop Firms module (System B) — sibling to `allocations` above, never
    // merged with System A. Zero, one, or many independent account
    // executions of this same shared idea.
    if (data.propFirmExecutions.length > 0) {
      await syncExecutionsWithinTx(tx, userId, trade.id, data.propFirmExecutions);
    }

    return trade;
  });
}

export async function updateTrade(userId: string, tradeId: string, data: TradeInput) {
  const psychology = scorePsychologyAnswers(data.psychologyAnswers);
  const allocations = await buildAllocations(userId, data, tradeId);
  const assetLink = tradeMarketData(data);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.trade.findFirst({ where: { id: tradeId, userId } });
    if (!existing) throw new Error("Trade not found.");

    // Pass the existing snapshot so an unchanged strategy selection stays frozen.
    const snapshots = await buildTradeSnapshots(userId, data, {
      strategyId: existing.strategyId,
      strategyNameSnapshot: existing.strategyNameSnapshot,
      strategyVersionSnapshot: existing.strategyVersionSnapshot,
    });
    const strategyExec = await buildStrategyExecution(userId, data, {
      strategyId: existing.strategyId,
      strategyExecutionSnapshot: existing.strategyExecutionSnapshot,
    });
    const setupValidation = await buildSetupValidation(userId, data, snapshots, {
      setupTypeId: existing.setupTypeId,
      setupScenarioId: existing.setupScenarioId,
      selectedSetupConditions: existing.selectedSetupConditions,
      setupValidationSnapshot: existing.setupValidationSnapshot,
      validationState: existing.validationState,
      overrideReason: existing.overrideReason,
      overrideNote: existing.overrideNote,
      actualEntry: existing.actualEntry,
    });
    // Contextual daily-bias snapshot (Stage 4 §10) — frozen the same way as
    // the setup validation above: recomputed while the idea is still in
    // flight, then locked once the trade has an actual entry.
    const dailyBiasSnapshot =
      existing.actualEntry != null
        ? existing.dailyBiasSnapshot
        : await getFinalBiasForAsset(userId, utcDateToKey(existing.tradeDate), data.assetSymbol);

    await tx.tradeAccountAllocation.deleteMany({ where: { tradeId } });
    // Prop Firms module (System B) — diffed (upsert-or-remove per account),
    // never delete-and-recreate, so an edit preserves each execution's
    // ledger idempotency (see trade-executions.service.ts). Guarded the same
    // way as createTrade: the Edit Trade form (trade-form.tsx) has no field
    // for propFirmExecutions at all, so it always submits `[]` — calling
    // syncExecutionsWithinTx unconditionally would treat that as "the trader
    // removed every account allocation" and silently delete each execution
    // (reversing its ledger PnL) on every unrelated edit. Account
    // allocations are managed exclusively through their own dedicated
    // actions (upsertExecutionAction/removeExecutionAction in
    // trade-executions.actions.ts), never through this form, so an empty
    // list here means "not provided," not "clear them all."
    if (data.propFirmExecutions.length > 0) {
      await syncExecutionsWithinTx(tx, userId, tradeId, data.propFirmExecutions);
    }

    const now = new Date();
    // The form owns the psychology reflections; the workspace review prompts
    // (whatWent*) are only on the existing row, so merge both.
    const hasReview =
      hasText(data.psychPostTradeReflection) ||
      hasText(data.psychLessonsLearned) ||
      hasText(data.psychWhatToWorkOn) ||
      hasText(existing.whatWentWell) ||
      hasText(existing.whatWentWrong) ||
      hasText(existing.whatSurprisedMe);

    const closedAt = nextClosedAt(existing.closedAt, data.actualRR != null, now);
    const reviewedAt = nextReviewedAt(existing.reviewedAt, hasReview, now);

    return tx.trade.update({
      where: { id: tradeId },
      data: {
        ...tradeScalarData(data),
        ...assetLink,
        ...snapshots,
        closedAt,
        reviewedAt,
        status: deriveStatus(closedAt, reviewedAt),
        ...strategyExec,
        ...setupValidation,
        dailyBiasSnapshot,
        ...(allocations.length > 0 ? { allocations: { create: allocations } } : {}),
        // Only (re)write the questionnaire when it's fully answered; an
        // incomplete set leaves any existing score untouched.
        ...(psychology ? { psychology: { upsert: { create: psychology, update: psychology } } } : {}),
      },
      include: tradeInclude,
    });
  }).then(async () => {
    // The allocation rebuild above always re-creates the Performance row at
    // 0/0 (see buildAllocations) — if this trade's risk was already locked,
    // restore its calculated PnL immediately so an unrelated edit (e.g.
    // changing the asset) never blanks out a settled result. A no-op when
    // the trade isn't locked yet. Re-fetched fresh so the returned trade
    // reflects the corrected allocation, not the pre-settlement 0/0 write.
    await settlePerformanceTrade(userId, tradeId);
    // Today V3 (Phase 5) — the full edit form recomputes `status` with the
    // legacy closed+reviewedAt rule, which marked a LIVE trade with only an
    // interim review REVIEWED. Re-derive the LIVE lifecycle columns from the
    // facts, exactly as section saves do (no-op in Backtesting).
    await syncLiveTradeLifecycle(userId, tradeId);
    return prisma.trade.findFirstOrThrow({ where: { id: tradeId, userId }, include: tradeInclude });
  });
}

/**
 * Patches only the Trade Workspace case-file scalar columns (planned/actual
 * prices, market context, reasons, review prompts). userId-scoped via an
 * explicit ownership check first, then a keyed update — allocations,
 * psychology, checklists and the /edit form's fields are never touched, so a
 * section can autosave in isolation. Only the keys present in `patch` are
 * written (an absent key leaves the column as-is; an explicit null clears it).
 */
export async function updateTradeSections(
  userId: string,
  tradeId: string,
  patch: TradeWorkspaceSectionInput,
  options: {
    /** Today V3 (Phase 3): the V3 Review completes explicitly, so its writes
     *  pass false — free text must never stamp reviewedAt there. Legacy
     *  callers keep the historical "first reflection = reviewed" stamp. */
    stampReviewedAtFromText?: boolean;
  } = {},
) {
  const existing = await prisma.trade.findFirst({ where: { id: tradeId, userId } });
  if (!existing) throw new Error("Trade not found.");

  // Editing a review prompt inline can be the moment a trade first becomes
  // "reviewed" — stamp reviewedAt from the merged (patch over existing) view.
  const patchRecord = patch as Record<string, unknown>;
  const existingRecord = existing as unknown as Record<string, unknown>;
  const hasReview = REVIEW_TEXT_FIELDS.some((field) =>
    hasText(field in patchRecord ? patchRecord[field] : existingRecord[field]),
  );
  const reviewedAt =
    options.stampReviewedAtFromText === false
      ? existing.reviewedAt
      : nextReviewedAt(existing.reviewedAt, hasReview, new Date());

  // Adherence answers, when present, are sanitized to known keys and rescored
  // server-side so the denormalized percent can never drift from the answers.
  const adherence =
    "adherenceAnswers" in patchRecord
      ? (() => {
          const answers = sanitizeAdherenceAnswers(patchRecord.adherenceAnswers);
          return { adherenceAnswers: answers, adherencePercent: scoreAdherence(answers).percent };
        })()
      : {};

  // Post-trade Honest Questionnaire, filled in the Trade Review tab. The
  // PsychologyQuestionnaireResponse row is written only once all 8 answers are
  // valid; a partial set is a no-op (kept in the panel's local state until
  // complete). `psychologyAnswers` itself is not a Trade column — strip it.
  const { psychologyAnswers: patchedPsychAnswers, ...patchColumns } = patch;
  const psychology =
    patchedPsychAnswers !== undefined
      ? scorePsychologyAnswers(patchedPsychAnswers as TradeInput["psychologyAnswers"])
      : null;

  const updated = await prisma.trade.update({
    where: { id: tradeId },
    data: {
      ...patchColumns,
      ...adherence,
      ...(psychology ? { psychology: { upsert: { create: psychology, update: psychology } } } : {}),
      reviewedAt,
      status: deriveStatus(existing.closedAt, reviewedAt),
    },
    include: tradeInclude,
  });

  // TradingView Screenshot Trade Plan (spec §13): the first time an actual
  // entry is recorded, whatever plan is currently confirmed gets locked —
  // later edits become revisions with a required reason, never silent
  // rewrites of what the trader actually planned before executing.
  const firstActualEntry = "actualEntry" in patchRecord && patch.actualEntry != null && existing.actualEntry == null;
  if (firstActualEntry) {
    await lockPlanIfConfirmedAndUnlocked(userId, tradeId);
  }

  // Performance Account automatic benchmark: lock the immutable risk
  // snapshot the moment actualEntry first appears (spec §4), then recompute
  // realized R / PnL whenever any of the canonical actual-execution fields
  // change (spec §13) — a no-op until the trade is fully closed.
  if (firstActualEntry) {
    await lockPerformanceRiskSnapshot(userId, tradeId);
  }
  if ("actualEntry" in patchRecord || "actualStopLoss" in patchRecord || "actualExit" in patchRecord) {
    await settlePerformanceTrade(userId, tradeId);
  }
  // Today V3 (Phase 3) — LIVE lifecycle columns follow execution facts
  // (no-op in Backtesting). Also run after V3 review writes (status).
  await syncLiveTradeLifecycle(userId, tradeId);

  return updated;
}

export async function archiveTrade(userId: string, tradeId: string) {
  return prisma.$transaction(async (tx) => {
    // If this trade resolved an opportunity, deleting the execution un-resolves it:
    // unlink and return the opportunity to PENDING so it stays consistent (nested
    // includes aren't soft-delete filtered, and analytics must not count a ghost
    // trade as an executed opportunity). The opportunity can then be re-resolved.
    const trade = await tx.trade.findFirst({
      where: { id: tradeId, userId },
      select: { opportunityId: true },
    });
    if (trade?.opportunityId) {
      await tx.tradeOpportunity.updateMany({
        where: { id: trade.opportunityId, userId },
        data: { status: "PENDING" },
      });
    }
    return tx.trade.update({
      where: { id: tradeId, userId },
      data: { deletedAt: new Date(), opportunityId: null },
    });
  });
}

export interface DailyPnlEntry {
  dateKey: string;
  percent: number;
  pnl: number;
  tradeCount: number;
  wins: number;
  losses: number;
}

/**
 * Backs the journal calendar (day badges, weekly totals, the year-view
 * activity map) — derived entirely from the Performance Account's real
 * dollar track record (the single source of truth for all analytics), not
 * from any self-reported RR. `wins`/`losses` are per-trade `pnl` sign, so a
 * day's totals stay consistent with Analytics/Dashboard/Equity Curve.
 */
export async function listDailyPnl(userId: string): Promise<DailyPnlEntry[]> {
  const performanceAccount = await getOrCreatePerformanceAccount(userId);
  const { entries } = await getAccountTrackRecord(userId, performanceAccount.id);

  const byDay = new Map<string, { pnl: number; count: number; wins: number; losses: number }>();
  for (const e of entries) {
    const existing = byDay.get(e.dateKey) ?? { pnl: 0, count: 0, wins: 0, losses: 0 };
    // Stage C: e.pnl is null when not settled / not calculable yet — counts
    // toward the day's trade count (it happened), but contributes 0 to PnL
    // and is neither a win nor a loss (never infer one without real data).
    existing.pnl += e.pnl ?? 0;
    existing.count += 1;
    if (e.pnl != null && e.pnl > 0) existing.wins += 1;
    else if (e.pnl != null && e.pnl < 0) existing.losses += 1;
    byDay.set(e.dateKey, existing);
  }

  const dailyPercents = dailyPercentsFromBalanceHistory(
    PERFORMANCE_ACCOUNT_STARTING_BALANCE,
    Array.from(byDay.entries()).map(([dateKey, { pnl }]) => ({ dateKey, pnl })),
  );
  const percentByDay = new Map(dailyPercents.map((d) => [d.dateKey, d.percent]));

  return Array.from(byDay.entries()).map(([dateKey, { pnl, count, wins, losses }]) => ({
    dateKey,
    percent: percentByDay.get(dateKey) ?? 0,
    pnl,
    tradeCount: count,
    wins,
    losses,
  }));
}
