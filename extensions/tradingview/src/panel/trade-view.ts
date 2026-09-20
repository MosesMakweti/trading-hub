/**
 * Traditorium TradingView Extension — Step 7. Pure view-model derivation
 * for the Trade Plan / Notes / Save section — mirrors view.ts's and
 * strategy-view.ts's separation (state in, plain render instructions out,
 * no DOM/chrome.*), so the whole readiness/preview/success/error mapping
 * is unit-testable without a DOM (see trade-view.test.ts).
 */
import { buildCreateTradePayload } from "@shared/trade-payload";
import { previewPlannedR } from "@shared/planned-r";
import type { TradeDraftContext } from "@shared/draft";
import type { StrategyReference } from "@shared/strategy";
import type { TradingViewChartContext } from "@shared/chart-context";
import type { CreateTradeValidationIssue } from "@shared/trade-api";
import type { SubmissionState } from "./trade-submission";

export interface TargetRowViewModel {
  id: string;
  label: string;
  targetPrice: string;
  /** Non-authoritative preview only — see @shared/planned-r.ts. Null
   *  whenever it can't be computed yet (missing/invalid entry, stop, or
   *  this target's own price, or an invalid risk distance) — never a
   *  fabricated number. */
  rPreviewText: string | null;
}

export type SubmissionViewModel =
  | { status: "idle" }
  | { status: "submitting" }
  | {
      status: "success";
      /** Every field here comes from the ACTUAL returned trade DTO, never
       *  the draft (§18: "do not fabricate persisted values from the
       *  draft"). */
      assetSymbol: string;
      direction: string;
      strategyName: string | null;
      targetCount: number;
      /** Step 9, Part 15 — from the actual returned DTO, so a replayed
       *  (already-existed) trade correctly reports its true attachment
       *  state rather than assuming "yes" just because a screenshot was
       *  uploaded in THIS session. */
      hasPlanScreenshot: boolean;
      warnings: string[];
      /** A real, existing route (`/journal/[date]/trades/[tradeId]`) built
       *  from the trade's own returned id/dateKey — never a guessed URL
       *  (§19). */
      viewUrl: string;
    }
  | { status: "error"; message: string; issues: CreateTradeValidationIssue[] };

export interface TradeSectionViewModel {
  plannedEntry: string;
  plannedStopLoss: string;
  targets: TargetRowViewModel[];
  marketContext: string;
  areasOfInterest: string;
  reasonForTrade: string;
  /** Disabled while submitting or while buildCreateTradePayload reports any
   *  blocker (§15: "disable it while obviously incomplete"). */
  canSave: boolean;
  blockerMessages: string[];
  /** Non-blocking geometry hints (§10) — shown, never gate `canSave`. */
  warningMessages: string[];
  submission: SubmissionViewModel;
}

function toSubmissionViewModel(submission: SubmissionState, webAppBaseUrl: string): SubmissionViewModel {
  switch (submission.status) {
    case "idle":
      return { status: "idle" };
    case "submitting":
      return { status: "submitting" };
    case "success": {
      const trade = submission.result.trade;
      return {
        status: "success",
        assetSymbol: trade.assetSymbol,
        direction: trade.direction,
        strategyName: trade.strategyName,
        targetCount: trade.plannedTargets.length,
        hasPlanScreenshot: trade.hasPlanScreenshot,
        warnings: submission.result.warnings,
        viewUrl: `${webAppBaseUrl}/journal/${trade.dateKey}/trades/${trade.id}`,
      };
    }
    case "error": {
      const { result } = submission;
      return { status: "error", message: result.message, issues: result.kind === "validation" ? result.issues : [] };
    }
  }
}

export function toTradeViewModel(params: {
  draft: TradeDraftContext;
  chartContext: TradingViewChartContext | null;
  strategy: StrategyReference | null;
  submission: SubmissionState;
  webAppBaseUrl: string;
}): TradeSectionViewModel {
  const { draft, chartContext, strategy, submission, webAppBaseUrl } = params;
  const payloadResult = buildCreateTradePayload({ draft, chartContext, strategy });

  const entryNum = Number(draft.plannedEntry.trim());
  const stopNum = Number(draft.plannedStopLoss.trim());
  const canPreviewR =
    draft.direction != null &&
    draft.plannedEntry.trim().length > 0 &&
    draft.plannedStopLoss.trim().length > 0 &&
    Number.isFinite(entryNum) &&
    Number.isFinite(stopNum);

  const targets: TargetRowViewModel[] = draft.plannedTargets.map((t) => {
    let rPreviewText: string | null = null;
    const targetNum = Number(t.targetPrice.trim());
    if (canPreviewR && draft.direction && t.targetPrice.trim().length > 0 && Number.isFinite(targetNum)) {
      const preview = previewPlannedR(draft.direction, entryNum, stopNum, targetNum);
      if (preview.r != null) rPreviewText = `${preview.r.toFixed(1)}R`;
    }
    return { id: t.id, label: t.label, targetPrice: t.targetPrice, rPreviewText };
  });

  return {
    plannedEntry: draft.plannedEntry,
    plannedStopLoss: draft.plannedStopLoss,
    targets,
    marketContext: draft.marketContext,
    areasOfInterest: draft.areasOfInterest,
    reasonForTrade: draft.reasonForTrade,
    canSave: payloadResult.payload != null && submission.status !== "submitting",
    blockerMessages: payloadResult.blockers.map((b) => b.message),
    warningMessages: payloadResult.warnings,
    submission: toSubmissionViewModel(submission, webAppBaseUrl),
  };
}
