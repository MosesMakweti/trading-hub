/**
 * Traditorium TradingView Extension — Step 6. Pure view-model derivation for
 * the strategy-aware trade context UI — mirrors view.ts's separation
 * (state/draft/loader in, plain render instructions out, no DOM/chrome.*).
 */
import { validateDraft, type DraftValidation, type TradeDraftContext } from "@shared/draft";
import { isConfluenceEligible } from "@shared/confluence-eligibility";
import type { StrategyConfluence, StrategySummary, StrategyTradeManagement } from "@shared/strategy";
import type { StrategyLoadState } from "./strategy-loader";

export interface ConfluenceRowViewModel {
  id: string;
  name: string;
  category: string | null;
  weight: number | null;
  mandatory: boolean;
  checked: boolean;
}

export interface StrategyRulesViewModel {
  show: boolean;
  frameworkStepCount: number;
  frameworkSteps: string[];
  tradeManagement: StrategyTradeManagement | null;
}

export interface StrategyContextViewModel {
  /** §13 — only once connected; there is no strategy to pick before then. */
  show: boolean;
  strategies: StrategySummary[];
  selectedStrategyId: string | null;
  strategyName: string | null;
  loading: boolean;
  /** Set on a failed GET_STRATEGY_REFERENCE — never fabricates a strategy
   *  while this is set (§17). */
  loadErrorMessage: string | null;
  direction: TradeDraftContext["direction"];
  sessionNames: string[];
  selectedSession: string | null;
  entryModels: string[];
  selectedEntryModel: string | null;
  /** Already direction-filtered (§6) — never render an ineligible
   *  confluence at all, not even disabled. */
  confluences: ConfluenceRowViewModel[];
  /** Never direction-filtered (§6/§11 — execution confirmations apply
   *  regardless of direction, matching the server). */
  execution: ConfluenceRowViewModel[];
  rules: StrategyRulesViewModel;
  validation: DraftValidation;
}

function toRow(confluence: StrategyConfluence, selectedIds: readonly string[]): ConfluenceRowViewModel {
  return {
    id: confluence.id,
    name: confluence.name,
    category: confluence.category,
    weight: confluence.weight,
    mandatory: confluence.mandatory,
    checked: selectedIds.includes(confluence.id),
  };
}

export function toStrategyContextViewModel(params: {
  connected: boolean;
  strategies: StrategySummary[];
  draft: TradeDraftContext;
  loader: StrategyLoadState;
}): StrategyContextViewModel {
  const { connected, strategies, draft, loader } = params;

  const strategy = loader.status === "loaded" ? loader.strategy : null;
  // §6 — only CONFLUENCES are direction-filtered; a strategy reference that
  // hasn't loaded yet (or failed to) simply shows nothing yet, never a
  // guessed/cached set from a different strategy.
  const eligibleConfluences = (strategy?.confluences ?? []).filter((c) =>
    isConfluenceEligible(c.directionApplicability, draft.direction),
  );

  return {
    show: connected,
    strategies,
    selectedStrategyId: draft.strategyId,
    strategyName: strategy?.name ?? null,
    loading: loader.status === "loading",
    loadErrorMessage: loader.status === "error" ? loader.message : null,
    direction: draft.direction,
    sessionNames: strategy?.sessions.map((s) => s.name) ?? [],
    selectedSession: draft.selectedSession,
    entryModels: strategy?.entryModels ?? [],
    selectedEntryModel: draft.selectedEntryModel,
    confluences: eligibleConfluences.map((c) => toRow(c, draft.selectedConfluenceIds)),
    execution: (strategy?.execution ?? []).map((c) => toRow(c, draft.selectedExecutionIds)),
    rules: {
      show: strategy != null && (strategy.frameworkSteps.length > 0 || strategy.tradeManagement != null),
      frameworkStepCount: strategy?.frameworkSteps.length ?? 0,
      frameworkSteps: strategy?.frameworkSteps ?? [],
      tradeManagement: strategy?.tradeManagement ?? null,
    },
    validation: validateDraft(draft, strategy?.confluences ?? [], strategy?.entryModels ?? []),
  };
}
