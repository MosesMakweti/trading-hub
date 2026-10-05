// Today V3 (Phase 4) — the Close phase's derived day summary. Pure; every
// figure comes from canonical per-trade facts the caller already resolved:
//  - review / settlement facts from the centralized V3 review derivation
//    (trade-review-v3.service.ts getTradeReviewFacts → review-state.ts), so
//    Close can never disagree with the Review stage about a final review;
//  - win/loss/breakeven from the canonical settledWinLossClass (an unsettled
//    trade is never classified, whatever its running PnL);
//  - Trades Used / risk used from computeDayUsage (the status-strip rule).
// Outcome and process are kept separate: nothing here scores a day "good" or
// "bad", and no warning is moral judgement — only facts that need attention.

import { settledWinLossClass } from "@/domain/analytics/canonical-dataset";
import { ADHERENCE_QUESTIONS } from "@/domain/trades/adherence";
import type { ReviewState } from "@/domain/trades/review-state";
import { computeDayUsage } from "@/domain/today/limit-state";

export interface CloseTradeFacts {
  id: string;
  tradeNumber: number | null;
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  /** Entered on an EARLIER day and listed today (open or awaiting its final
   *  review). Carried trades are never counted in today's performance — a
   *  trade belongs to its own trade date, as in Journal and Analytics. */
  carried: boolean;
  tradeDateKey: string;
  reviewState: ReviewState;
  hasEarlierReview: boolean;
  missingReviewCount: number;
  hasActualEntry: boolean;
  cancelled: boolean;
  closed: boolean;
  exitedPercent: number | null;
  settled: boolean;
  /** A PerformanceRiskSnapshot exists (Performance allocation at entry). */
  hasPerformanceSnapshot: boolean;
  resolvedInitialStop: number | null;
  settledRealizedR: number | null;
  settledPnl: number | null;
  /** Stored Trade.reviewLifecycleStatus (checked against the facts). */
  storedLifecycle: string | null;
  performanceRiskPercent: number | null;
  adherenceAnswers: Record<string, boolean>;
  tradeIntent: string | null;
  wouldTakeAgain: boolean | null;
  psychologyPercent: number | null;
  setupScore: number | null;
  setupValid: boolean | null;
  setupOverridden: boolean;
  executionPercent: number | null;
  tradeQualityPercent: number | null;
  hasLimitOverride: boolean;
}

export interface CloseMissedFacts {
  setupValid: boolean | null;
}

export interface ClosePerformance {
  /** Every Trade row of the day (ideas, executed, cancelled). */
  ideas: number;
  /** Actual entry, not cancelled — the status strip's Trades Used. */
  executed: number;
  settled: number;
  wins: number;
  losses: number;
  breakevens: number;
  /** wins / settled × 100 (the Analytics definition); null with nothing settled. */
  winRatePercent: number | null;
  /** Sum of SETTLED trades' realized R / Performance PnL only. */
  settledR: number;
  settledPnl: number;
  /** Executed today and not fully closed. */
  open: number;
  /** Fully exited but not yet settled by the Performance Account. */
  pendingSettlement: number;
  cancelled: number;
  missed: number;
  /** Missed setups scored valid (setupValid === true) — the Discrepancy Gap's set. */
  missedValid: number;
  riskUsedPercent: number;
  riskComplete: boolean;
}

export function deriveClosePerformance(trades: CloseTradeFacts[], missed: CloseMissedFacts[]): ClosePerformance {
  const today = trades.filter((t) => !t.carried);
  const usage = computeDayUsage(
    today.map((t) => ({ hasActualEntry: t.hasActualEntry, cancelled: t.cancelled, performanceRiskPercent: t.performanceRiskPercent })),
  );
  let settled = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let settledR = 0;
  let settledPnl = 0;
  let open = 0;
  let pendingSettlement = 0;
  let cancelled = 0;
  for (const t of today) {
    if (t.cancelled && !t.hasActualEntry) {
      cancelled++;
      continue;
    }
    if (!t.hasActualEntry) continue;
    if (!t.closed) open++;
    if (t.settled) {
      settled++;
      if (t.settledRealizedR != null) settledR += t.settledRealizedR;
      if (t.settledPnl != null) settledPnl += t.settledPnl;
    } else if (t.closed) {
      pendingSettlement++;
    }
    const cls = settledWinLossClass({ settled: t.settled, realizedRSoFar: t.settledRealizedR });
    if (cls === "WIN") wins++;
    else if (cls === "LOSS") losses++;
    else if (cls === "BREAKEVEN") breakevens++;
  }
  return {
    ideas: today.length,
    executed: usage.executedCount,
    settled,
    wins,
    losses,
    breakevens,
    winRatePercent: settled > 0 ? (wins / settled) * 100 : null,
    settledR,
    settledPnl,
    open,
    pendingSettlement,
    cancelled,
    missed: missed.length,
    missedValid: missed.filter((m) => m.setupValid === true).length,
    riskUsedPercent: usage.riskUsedPercent,
    riskComplete: usage.riskComplete,
  };
}

// ── Process ──────────────────────────────────────────────────────────────────

export interface AdherenceTally {
  key: string;
  prompt: string;
  yes: number;
  no: number;
  unanswered: number;
}

export interface CloseProcess {
  /** Today's executed trades the process figures are taken over. */
  executed: number;
  finalReviewsComplete: number;
  finalReviewsRequired: number;
  adherence: AdherenceTally[];
  /** Trades by recorded motive (Trade.tradeIntent). */
  motives: Record<string, number>;
  averagePsychologyPercent: number | null;
  psychologyCount: number;
  averageSetupScore: number | null;
  setupInvalidCount: number;
  averageExecutionPercent: number | null;
  averageTradeQualityPercent: number | null;
  wouldNotTakeAgain: number;
  limitOverrides: number;
  setupOverrides: number;
}

const avg = (values: (number | null)[]): number | null => {
  const v = values.filter((x): x is number => x != null);
  return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

/** Process is read from the trades' own reviews and frozen facts — never a
 *  second day-level score the trader is asked for. */
export function deriveCloseProcess(trades: CloseTradeFacts[]): CloseProcess {
  const today = trades.filter((t) => !t.carried);
  const executed = today.filter((t) => t.hasActualEntry && !t.cancelled);
  const motives: Record<string, number> = {};
  for (const t of executed) if (t.tradeIntent) motives[t.tradeIntent] = (motives[t.tradeIntent] ?? 0) + 1;
  return {
    executed: executed.length,
    finalReviewsComplete: trades.filter((t) => t.reviewState === "FINAL_REVIEW_COMPLETE").length,
    finalReviewsRequired: trades.filter((t) => t.reviewState === "FINAL_REVIEW_REQUIRED").length,
    adherence: ADHERENCE_QUESTIONS.map((q) => {
      let yes = 0;
      let no = 0;
      for (const t of executed) {
        const a = t.adherenceAnswers[q.key];
        if (a === true) yes++;
        else if (a === false) no++;
      }
      return { key: q.key, prompt: q.prompt, yes, no, unanswered: executed.length - yes - no };
    }),
    motives,
    averagePsychologyPercent: avg(executed.map((t) => t.psychologyPercent)),
    psychologyCount: executed.filter((t) => t.psychologyPercent != null).length,
    averageSetupScore: avg(executed.map((t) => t.setupScore)),
    setupInvalidCount: executed.filter((t) => t.setupValid === false).length,
    averageExecutionPercent: avg(executed.map((t) => t.executionPercent)),
    averageTradeQualityPercent: avg(executed.map((t) => t.tradeQualityPercent)),
    wouldNotTakeAgain: executed.filter((t) => t.wouldTakeAgain === false).length,
    limitOverrides: today.filter((t) => t.hasLimitOverride).length,
    setupOverrides: today.filter((t) => t.setupOverridden).length,
  };
}

// ── Needs Attention ──────────────────────────────────────────────────────────

export type AttentionKind =
  | "FINAL_REVIEW_REQUIRED"
  | "OPEN_POSITION"
  | "MISSING_EXECUTION_FACTS"
  | "PERFORMANCE_PENDING"
  | "CONTRADICTORY_STATE"
  | "PROCESS_EXCEPTION";

export interface AttentionItem {
  kind: AttentionKind;
  tradeId: string;
  tradeNumber: number | null;
  assetSymbol: string;
  carried: boolean;
  title: string;
  detail: string;
  /** Which trade stage resolves it. */
  stage: "review" | "execution";
}

const ADHERENCE_EXCEPTION_LABEL: Record<string, string> = {
  followedStrategy: "Strategy not followed",
  followedEntryModel: "Entry model not followed",
  followedTradeManagement: "Management rules not followed",
  remainedPatient: "Patience: no",
};

const KIND_ORDER: AttentionKind[] = [
  "FINAL_REVIEW_REQUIRED",
  "OPEN_POSITION",
  "MISSING_EXECUTION_FACTS",
  "PERFORMANCE_PENDING",
  "CONTRADICTORY_STATE",
  "PROCESS_EXCEPTION",
];

/** Every rule reads a stored/derived fact; nothing is inferred from PnL. */
export function deriveNeedsAttention(trades: CloseTradeFacts[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const t of trades) {
    const base = { tradeId: t.id, tradeNumber: t.tradeNumber, assetSymbol: t.assetSymbol, carried: t.carried };
    const entered = t.hasActualEntry;

    if (t.reviewState === "FINAL_REVIEW_REQUIRED") {
      items.push({
        ...base,
        kind: "FINAL_REVIEW_REQUIRED",
        title: "Final review required",
        detail: t.hasEarlierReview
          ? "The trade closed after an earlier (interim) review — the final review is still outstanding."
          : `${t.missingReviewCount} review answer${t.missingReviewCount === 1 ? "" : "s"} still missing.`,
        stage: "review",
      });
    }
    if (entered && !t.cancelled && !t.closed) {
      const openPct = t.exitedPercent == null ? 100 : Math.max(0, Math.round((100 - t.exitedPercent) * 100) / 100);
      items.push({
        ...base,
        kind: "OPEN_POSITION",
        title: "Open position",
        detail: `${openPct}% still open — it stays open and carries into your next session.`,
        stage: "execution",
      });
    }
    if (entered && !t.cancelled && t.hasPerformanceSnapshot && t.resolvedInitialStop == null && !t.settled) {
      items.push({
        ...base,
        kind: "MISSING_EXECUTION_FACTS",
        title: "Missing execution facts",
        detail: "No initial stop is recorded, so the Performance Account can't size 1R or settle this trade.",
        stage: "execution",
      });
    } else if (entered && !t.cancelled && t.closed && !t.settled) {
      items.push({
        ...base,
        kind: "PERFORMANCE_PENDING",
        title: "Performance pending",
        detail: t.hasPerformanceSnapshot
          ? "Fully exited, but the Performance Account hasn't settled a result yet."
          : "Fully exited, but there is no Performance Account risk snapshot, so no settled result exists.",
        stage: "execution",
      });
    }
    if (entered && t.storedLifecycle === "CANCELLED_NEVER_TRIGGERED") {
      items.push({
        ...base,
        kind: "CONTRADICTORY_STATE",
        title: "Contradictory execution state",
        detail: "Marked cancelled before entry, but an actual entry is recorded.",
        stage: "execution",
      });
    } else if (entered && t.storedLifecycle === "FULLY_CLOSED" && !t.closed) {
      items.push({
        ...base,
        kind: "CONTRADICTORY_STATE",
        title: "Contradictory execution state",
        detail: "Marked fully closed, but the recorded exits don't close the position and it isn't settled.",
        stage: "execution",
      });
    }

    const exceptions: string[] = [];
    if (t.setupOverridden) exceptions.push("Setup validation overridden");
    if (t.hasLimitOverride) exceptions.push("Daily-limit override");
    for (const q of ADHERENCE_QUESTIONS) {
      if (t.adherenceAnswers[q.key] === false) exceptions.push(ADHERENCE_EXCEPTION_LABEL[q.key] ?? q.prompt);
    }
    if (exceptions.length > 0) {
      items.push({ ...base, kind: "PROCESS_EXCEPTION", title: "Process exception", detail: exceptions.join(" · "), stage: "review" });
    }
  }
  return items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

// ── Reflection ───────────────────────────────────────────────────────────────

export interface DayReflection {
  dayWentWell: string | null;
  dayToImprove: string | null;
  dayMainLesson: string | null;
  dayCarryForward: string | null;
}

/** "Reflection present" = at least one of the four V3 day-reflection fields
 *  has text. Never derived from trade-level free text. */
export function hasDayReflection(r: DayReflection): boolean {
  return [r.dayWentWell, r.dayToImprove, r.dayMainLesson, r.dayCarryForward].some((v) => v != null && v.trim() !== "");
}
