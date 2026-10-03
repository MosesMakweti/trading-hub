// Today V3 (Phase 3) — the Review's derived RESULT and PLAN VS ACTUAL read
// models. Pure. No new R/PnL math: realized R / PnL / closed proportion come
// from computeTradeExecutionSummary (the shared execution summary used by
// Close Day and Trade Review) and the win/loss class from
// settledWinLossClass (canonical analytics) — an unsettled trade is never
// classified. Plan vs Actual shows FACTS (deltas), never verdicts.

import { settledWinLossClass } from "@/domain/analytics/canonical-dataset";
import { lookupInstrument } from "@/domain/trade-plan/instrument-catalog";
import type { BiasAlignment } from "@/domain/psychology/review-adapter";
import type { TradeExecutionSummaryResult } from "./trade-execution-summary";

// ── Result ──────────────────────────────────────────────────────────────────

export type ResultSettlement = "SETTLED" | "PENDING_SETTLEMENT" | "OPEN" | "CANCELLED";

export interface ReviewResult {
  realizedR: number | null;
  pnl: number | null;
  settlement: ResultSettlement;
  winLoss: "WIN" | "LOSS" | "BREAKEVEN" | null;
  remainingOpenPercent: number | null;
  positionLabel: "Fully closed" | "Partially closed" | "Open" | "Cancelled" | "Not entered";
}

export function deriveReviewResult(input: {
  cancelled: boolean;
  hasActualEntry: boolean;
  closed: boolean;
  exitedPercent: number | null;
  summary: TradeExecutionSummaryResult | null;
}): ReviewResult {
  if (input.cancelled && !input.hasActualEntry) {
    return { realizedR: null, pnl: null, settlement: "CANCELLED", winLoss: null, remainingOpenPercent: null, positionLabel: "Cancelled" };
  }
  if (!input.hasActualEntry || !input.summary) {
    return { realizedR: null, pnl: null, settlement: "OPEN", winLoss: null, remainingOpenPercent: null, positionLabel: "Not entered" };
  }
  const s = input.summary;
  const exited = Math.min(100, Math.max(0, input.exitedPercent ?? 0));
  const remaining = input.closed ? 0 : Math.round((100 - exited) * 100) / 100;
  return {
    realizedR: s.realizedRSoFar,
    pnl: s.pnl,
    settlement: s.settled ? "SETTLED" : input.closed ? "PENDING_SETTLEMENT" : "OPEN",
    winLoss: settledWinLossClass(s),
    remainingOpenPercent: remaining,
    positionLabel: input.closed ? "Fully closed" : exited > 0 ? "Partially closed" : "Open",
  };
}

// ── Price distances ─────────────────────────────────────────────────────────

/** Signed distance in the instrument's natural unit: pips for forex (the
 *  catalog only defines pipSize for FX), else a plain price difference at
 *  the instrument's precision. */
export function formatPriceDelta(delta: number, assetSymbol: string): string {
  const spec = lookupInstrument(assetSymbol);
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const abs = Math.abs(delta);
  if (spec?.pipSize) {
    const pips = abs / Number(spec.pipSize);
    return `${sign}${(Math.round(pips * 10) / 10).toFixed(1)} pips`;
  }
  const digits = spec?.decimalPrecision ?? (abs >= 1 ? 2 : 5);
  return `${sign}${abs.toFixed(digits)}`;
}

// ── Plan vs Actual ──────────────────────────────────────────────────────────

export type ComparisonTone = "match" | "differs" | "neutral" | "missing";

export interface ComparisonRow {
  key: string;
  label: string;
  value: string;
  tone: ComparisonTone;
}

export interface PlanVsActualInput {
  direction: "LONG" | "SHORT";
  assetSymbol: string;
  /** The plan as it was LOCKED at first entry; null = no confirmed plan
   *  before execution. */
  plan: {
    entry: number | null;
    stopLoss: number | null;
    managementInstructions: string[];
  } | null;
  /** A plan was confirmed only after entry (never locked) — a fact to show. */
  planConfirmedAfterEntry: boolean;
  actual: {
    entry: number | null;
    initialStop: number | null;
  };
  /** Pre-built exit facts (exitAdherenceEvidence().facts or a plain summary). */
  exitFacts: string[];
  risk: {
    riskPercent: number | null;
    defaultRiskPercent: number | null;
    dayRiskLimitPercent: number | null;
  };
  biasAlignment: BiasAlignment;
  dailyBiasSnapshot: string | null;
  setup: { valid: boolean | null; rating: string | null; validationState: string | null };
  confluencePercent: number | null;
  executionPercent: number | null;
}

export interface PlanVsActual {
  hasPlan: boolean;
  rows: ComparisonRow[];
}

const EPS = 1e-9;

export function buildPlanVsActual(i: PlanVsActualInput): PlanVsActual {
  const rows: ComparisonRow[] = [];
  const hasPlan = i.plan != null;

  if (!i.plan) {
    rows.push({
      key: "plan",
      label: "Plan",
      value: i.planConfirmedAfterEntry ? "No confirmed plan before entry (plan confirmed after)" : "No confirmed plan",
      tone: "neutral",
    });
  } else {
    // Entry
    if (i.plan.entry != null && i.actual.entry != null) {
      const d = i.actual.entry - i.plan.entry;
      rows.push({
        key: "entry",
        label: "Entry",
        value: Math.abs(d) < EPS ? "Same as plan" : `${formatPriceDelta(d, i.assetSymbol)} from plan`,
        tone: Math.abs(d) < EPS ? "match" : "differs",
      });
    } else {
      rows.push({ key: "entry", label: "Entry", value: i.actual.entry == null ? "Not entered" : "No planned entry", tone: "missing" });
    }
    // Initial stop
    if (i.plan.stopLoss != null && i.actual.initialStop != null) {
      const d = i.actual.initialStop - i.plan.stopLoss;
      rows.push({
        key: "stop",
        label: "Initial stop",
        value: Math.abs(d) < EPS ? "Same as plan" : `${formatPriceDelta(d, i.assetSymbol)} from plan`,
        tone: Math.abs(d) < EPS ? "match" : "differs",
      });
    } else {
      rows.push({ key: "stop", label: "Initial stop", value: i.actual.initialStop == null ? "Not recorded" : "No planned stop", tone: "missing" });
    }
    if (i.plan.managementInstructions.length > 0) {
      rows.push({ key: "management", label: "Management plan", value: i.plan.managementInstructions.join(" · "), tone: "neutral" });
    }
  }

  // Exits
  if (i.exitFacts.length > 0) {
    rows.push({ key: "exits", label: hasPlan ? "Targets / exits" : "Exits", value: i.exitFacts.join(" · "), tone: "neutral" });
  }

  // Risk
  if (i.risk.riskPercent != null) {
    const parts = [`${pct(i.risk.riskPercent)}`];
    if (i.risk.defaultRiskPercent != null) {
      parts.push(
        Math.abs(i.risk.riskPercent - i.risk.defaultRiskPercent) < EPS
          ? "account default"
          : `default ${pct(i.risk.defaultRiskPercent)}`,
      );
    }
    if (i.risk.dayRiskLimitPercent != null) parts.push(`daily limit ${pct(i.risk.dayRiskLimitPercent)}`);
    rows.push({ key: "risk", label: "Risk", value: parts.join(" · "), tone: "neutral" });
  } else {
    rows.push({ key: "risk", label: "Risk", value: "No Performance risk snapshot", tone: "missing" });
  }

  // Bias (today's Final Bias, frozen at entry — not an HTF read)
  rows.push({
    key: "bias",
    label: "Today's bias",
    value:
      i.biasAlignment === "ALIGNED"
        ? `Aligned (${i.dailyBiasSnapshot?.toLowerCase()})`
        : i.biasAlignment === "CONFLICT"
          ? `Against today's ${i.dailyBiasSnapshot?.toLowerCase()} bias`
          : i.dailyBiasSnapshot === "NEUTRAL"
            ? "Today's bias was neutral"
            : "No bias recorded for this asset",
    tone: i.biasAlignment === "ALIGNED" ? "match" : i.biasAlignment === "CONFLICT" ? "differs" : "missing",
  });

  // Setup
  const setupParts: string[] = [];
  if (i.setup.valid != null) setupParts.push(i.setup.valid ? "valid" : "invalid");
  if (i.setup.rating) setupParts.push(i.setup.rating);
  if (i.setup.validationState === "OVERRIDDEN") setupParts.push("validation overridden");
  rows.push({
    key: "setup",
    label: "Setup",
    value: setupParts.length ? setupParts.join(" · ") : "Not scored",
    tone: setupParts.length ? "neutral" : "missing",
  });
  rows.push({
    key: "confluences",
    label: "Confluences",
    value: i.confluencePercent != null ? pct(i.confluencePercent) : "Not scored",
    tone: i.confluencePercent != null ? "neutral" : "missing",
  });
  rows.push({
    key: "execution",
    label: "Execution",
    value: i.executionPercent != null ? pct(i.executionPercent) : "Not scored",
    tone: i.executionPercent != null ? "neutral" : "missing",
  });

  return { hasPlan, rows };
}

function pct(n: number): string {
  return `${Number.isInteger(n) ? n : Math.round(n * 100) / 100}%`;
}
