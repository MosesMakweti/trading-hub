/**
 * Traditorium TradingView Extension — Step 7. The ONE place a
 * `TradeDraftContext` becomes a `CreateTradeRequest` (§12/§14) — validation
 * and payload-building share this single pass so they can never disagree
 * about what's "resolvable."
 *
 * DELIBERATE DECISIONS, documented because they diverge from a literal
 * reading of the Step 7 brief:
 *
 * - `plan` is REQUIRED by this function (entry + stop + ≥1 target) even
 *   though `apiCreateTradeSchema.plan`/`confirmPlanSchema` are optional
 *   server-side. Step 7's whole point is a fully-planned trade idea (see
 *   the Definition of Done's own example) — a bare, plan-less trade isn't
 *   the workflow being built here.
 * - `strategyId` is NOT a hard blocker. `tradeSchema.strategyId` defaults to
 *   `""` (no strategy) — "a trader with none set up yet, or logging a
 *   one-off, can save a freeform trade" is the SCHEMA's own stated intent
 *   (src/lib/validation/trades.ts), not a gap. The Step 6 "Strategy
 *   required" UI hint remains purely informational; it does not block Save.
 * - `direction` IS a hard blocker — `tradeSchema.direction` has no default,
 *   it's the one Step 6 hint that maps to a genuine schema requirement.
 * - Geometry (stop on the correct side of entry) is a WARNING, never a
 *   blocker (§10) — the server itself doesn't hard-block on this either: a
 *   bad plan only produces a non-fatal warning in the trade's response
 *   (POST /api/v1/trades' route.ts wraps `savePlan` in try/catch and pushes
 *   a warning string; the trade is still created).
 */
import { isConfluenceEligible } from "./confluence-eligibility";
import { isAssetCompatible } from "./asset-compatibility";
import { localDateToKey } from "./date-key";
import type { TradeDraftContext } from "./draft";
import type { StrategyReference } from "./strategy";
import type { TradingViewChartContext } from "./chart-context";
import type { CreateTradePlannedTarget, CreateTradeRequest } from "./trade-api";

/** Matches the web app's own empty-form defaults for these three
 *  `tradeSchema`-required-but-Step-7-doesn't-collect-them fields
 *  (`components/journal/trade-form.tsx`'s `emptyDefaults`) — not invented
 *  values. 570 = 9:30am (minutes since midnight); the trader can edit any
 *  of these three later in Traditorium itself like any other trade field. */
export const DEFAULT_EXECUTION_MINUTES = 570;
export const DEFAULT_HIGHER_TIMEFRAME_BIAS = "BULLISH" as const;
export const DEFAULT_BIAS_CONFIDENCE_PERCENT = 50;

export type TradePayloadBlockReason =
  | "no_symbol"
  | "strategy_not_loaded"
  | "direction_required"
  | "asset_incompatible"
  | "unresolved_confluence"
  | "unresolved_execution"
  | "unresolved_session"
  | "unresolved_entry_model"
  | "entry_required"
  | "entry_invalid"
  | "stop_loss_required"
  | "stop_loss_invalid"
  | "targets_required"
  | "target_invalid";

export interface TradePayloadBlocker {
  reason: TradePayloadBlockReason;
  message: string;
}

export interface TradePayloadResult {
  payload: CreateTradeRequest | null;
  blockers: TradePayloadBlocker[];
  /** Non-blocking geometry hints only — see this module's doc comment. */
  warnings: string[];
}

type ParsedPrice = { status: "empty" } | { status: "invalid" } | { status: "ok"; value: number };

function parsePrice(raw: string): ParsedPrice {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { status: "empty" };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { status: "ok", value } : { status: "invalid" };
}

export function buildCreateTradePayload(params: {
  draft: TradeDraftContext;
  chartContext: TradingViewChartContext | null;
  /** The loaded reference for `draft.strategyId`, or null if none is
   *  selected / it hasn't finished loading yet. */
  strategy: StrategyReference | null;
  now?: () => Date;
}): TradePayloadResult {
  const { draft, chartContext, strategy, now = () => new Date() } = params;
  const blockers: TradePayloadBlocker[] = [];
  const warnings: string[] = [];

  if (draft.direction == null) {
    blockers.push({ reason: "direction_required", message: "Direction required." });
  }

  // Step 9, Part 8 — a locked-in origin symbol (see @shared/draft.ts's
  // ensureOriginSymbol) is ALWAYS the authoritative source once set, even
  // if the live chart context has since changed or gone away entirely
  // (tab closed/navigated). This is what actually makes the "Chart
  // changed" warning's "Keep {origin} Draft" option meaningful — dismissing
  // that warning doesn't need to do anything special to the draft itself,
  // because submission was already protected the moment the origin locked.
  const displaySymbol = draft.originSymbol ?? chartContext?.symbol?.display ?? null;
  if (!displaySymbol) {
    blockers.push({ reason: "no_symbol", message: "No symbol detected on the chart." });
  }

  if (draft.strategyId != null && strategy == null) {
    blockers.push({ reason: "strategy_not_loaded", message: "Strategy reference is not loaded yet." });
  }

  if (displaySymbol && strategy && !isAssetCompatible(displaySymbol, strategy.applicableAssets)) {
    blockers.push({ reason: "asset_incompatible", message: `${displaySymbol} is not configured for this strategy.` });
  }

  // §12 — resolve confluence/execution IDS to canonical NAMES; the loaded
  // StrategyReference is the only source of truth for that mapping. ANY
  // unresolved id blocks submission outright (§12: "Never silently drop an
  // unresolved selected configuration item").
  const confluenceNames: string[] = [];
  if (draft.selectedConfluenceIds.length > 0) {
    if (!strategy) {
      blockers.push({ reason: "unresolved_confluence", message: "Selected confluences could not be verified — strategy not loaded." });
    } else {
      for (const id of draft.selectedConfluenceIds) {
        const match = strategy.confluences.find((c) => c.id === id);
        if (!match) {
          blockers.push({ reason: "unresolved_confluence", message: "A selected confluence no longer exists on this strategy." });
        } else if (!isConfluenceEligible(match.directionApplicability, draft.direction)) {
          // §14 — re-checked immediately before submission: a confluence
          // that WAS eligible when selected but no longer is (e.g. the
          // strategy reference was reloaded with different data) must not
          // be silently sent either.
          blockers.push({ reason: "unresolved_confluence", message: "A selected confluence is no longer eligible for the current direction." });
        } else {
          confluenceNames.push(match.name);
        }
      }
    }
  }

  const executionNames: string[] = [];
  if (draft.selectedExecutionIds.length > 0) {
    if (!strategy) {
      blockers.push({ reason: "unresolved_execution", message: "Selected execution confirmations could not be verified — strategy not loaded." });
    } else {
      for (const id of draft.selectedExecutionIds) {
        const match = strategy.execution.find((c) => c.id === id);
        if (!match) {
          blockers.push({ reason: "unresolved_execution", message: "A selected execution confirmation no longer exists on this strategy." });
        } else {
          executionNames.push(match.name);
        }
      }
    }
  }

  if (draft.selectedSession && strategy && !strategy.sessions.some((s) => s.name === draft.selectedSession)) {
    blockers.push({ reason: "unresolved_session", message: "Selected session no longer exists on this strategy." });
  }
  if (draft.selectedEntryModel && strategy && !strategy.entryModels.includes(draft.selectedEntryModel)) {
    blockers.push({ reason: "unresolved_entry_model", message: "Selected entry model no longer exists on this strategy." });
  }

  const entry = parsePrice(draft.plannedEntry);
  if (entry.status === "empty") blockers.push({ reason: "entry_required", message: "Planned entry required." });
  if (entry.status === "invalid") blockers.push({ reason: "entry_invalid", message: "Planned entry must be a valid number." });

  const stopLoss = parsePrice(draft.plannedStopLoss);
  if (stopLoss.status === "empty") blockers.push({ reason: "stop_loss_required", message: "Planned stop loss required." });
  if (stopLoss.status === "invalid") blockers.push({ reason: "stop_loss_invalid", message: "Planned stop loss must be a valid number." });

  const targets: CreateTradePlannedTarget[] = [];
  let anyTargetInvalid = false;
  let order = 1;
  for (const t of draft.plannedTargets) {
    const parsed = parsePrice(t.targetPrice);
    if (parsed.status === "empty") continue; // an unused row — silently excluded, not an error (§8)
    if (parsed.status === "invalid" || t.label.trim().length === 0) {
      anyTargetInvalid = true;
      continue;
    }
    targets.push({ targetOrder: order++, label: t.label.trim(), targetPrice: parsed.value });
  }
  if (anyTargetInvalid) blockers.push({ reason: "target_invalid", message: "One or more targets has an invalid price or label." });
  if (targets.length === 0) blockers.push({ reason: "targets_required", message: "At least one target is required." });

  // §10 — non-blocking. Mirrors the server's own risk-distance gate exactly
  // (domain/prop-firms/risk.ts::computePlannedR) but only as a hint.
  if (draft.direction != null && entry.status === "ok" && stopLoss.status === "ok") {
    const riskOk = draft.direction === "LONG" ? entry.value > stopLoss.value : stopLoss.value > entry.value;
    if (!riskOk) {
      warnings.push(
        draft.direction === "LONG" ? "Stop loss should be below entry for a LONG." : "Stop loss should be above entry for a SHORT.",
      );
    }
  }

  if (
    blockers.length > 0 ||
    !displaySymbol ||
    draft.direction == null ||
    entry.status !== "ok" ||
    stopLoss.status !== "ok" ||
    targets.length === 0
  ) {
    return { payload: null, blockers, warnings };
  }

  const trade: CreateTradeRequest["trade"] = {
    assetSymbol: displaySymbol,
    executionMinutes: DEFAULT_EXECUTION_MINUTES,
    direction: draft.direction,
    higherTimeframeBias: DEFAULT_HIGHER_TIMEFRAME_BIAS,
    biasConfidencePercent: DEFAULT_BIAS_CONFIDENCE_PERCENT,
  };
  if (draft.strategyId) trade.strategyId = draft.strategyId;
  if (draft.selectedSession) trade.selectedSession = draft.selectedSession;
  if (draft.selectedEntryModel) trade.selectedEntryModel = draft.selectedEntryModel;
  if (confluenceNames.length > 0) trade.selectedConfluences = confluenceNames;
  if (executionNames.length > 0) trade.selectedExecution = executionNames;

  const plan: CreateTradeRequest["plan"] = { entry: entry.value, stopLoss: stopLoss.value, targets };
  if (chartContext?.timeframe) plan.timeframe = chartContext.timeframe;

  const notes: NonNullable<CreateTradeRequest["notes"]> = {};
  if (draft.marketContext.trim()) notes.marketContext = draft.marketContext.trim();
  if (draft.areasOfInterest.trim()) notes.areasOfInterest = draft.areasOfInterest.trim();
  if (draft.reasonForTrade.trim()) notes.reasonForTrade = draft.reasonForTrade.trim();

  return {
    payload: {
      dateKey: localDateToKey(now()),
      trade,
      plan,
      notes: Object.keys(notes).length > 0 ? notes : undefined,
      // Step 8, §21 — omitted entirely (never sent as null/undefined-in-body)
      // when no screenshot was uploaded, matching `apiCreateTradeSchema`'s
      // own optional field exactly.
      ...(draft.mediaAssetId ? { mediaAssetId: draft.mediaAssetId } : {}),
    },
    blockers: [],
    warnings,
  };
}
