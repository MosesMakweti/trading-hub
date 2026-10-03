// Today V3 (Phase 2) — the ONE place a trade's presentation state is derived.
// Pure; no stored lifecycle enum. Every input is an existing canonical fact:
// actualEntry, confirmed/locked TradePlanVersion, actual partial exits /
// actualExit, the Performance snapshot's settledAt, reviewedAt, and the
// CANCELLED_NEVER_TRIGGERED review status. Phase 3: `reviewed` means the
// FINAL review is complete (domain/trades/review-state.ts), never merely that
// reviewedAt exists; Trade.reviewLifecycleStatus itself is kept in sync from
// execution facts by trade-lifecycle-sync.service.ts (LIVE).

import { deriveReviewState, type ReviewStateFacts, type ReviewStateResult } from "./review-state";

export type TradeDisplayState =
  | "IDEA"
  | "PLANNED"
  | "OPEN"
  | "PARTIALLY_CLOSED"
  | "REVIEW_NEEDED"
  | "REVIEWED"
  | "CANCELLED";

export type TradeStageKey = "idea" | "plan" | "execution" | "review";

export interface TradeLifecycleFacts {
  cancelled: boolean;
  /** At least one confirmed TradePlanVersion exists. */
  hasConfirmedPlan: boolean;
  /** The latest plan version is locked (first actual entry happened). */
  planLocked: boolean;
  hasActualEntry: boolean;
  /** Sum of recorded partial-exit percentages (0–100+), or 100 when only a
   *  single actualExit exists, null when nothing has been exited. */
  exitedPercent: number | null;
  /** A legacy/imported result with no actual entry (actualRR only). */
  hasLegacyResult: boolean;
  /** Performance snapshot settled (fully accounted, initial stop known). */
  settled: boolean;
  /** FINAL review complete (review-state.ts FINAL_REVIEW_COMPLETE). */
  reviewed: boolean;
  /** An interim review was saved while the position was open. */
  interimReviewed?: boolean;
  /** Closed, but an earlier (interim / legacy) review no longer counts. */
  earlierReviewOutdated?: boolean;
  /** Readiness confirmed for today — gates TAKING a trade, never managing one. */
  tradingReady: boolean;
}

export interface StageState {
  available: boolean;
  done: boolean;
  /** Why it isn't available yet (one line), when it isn't. */
  lockedReason: string | null;
}

export interface TradeLifecycle {
  state: TradeDisplayState;
  primaryStage: TradeStageKey;
  waitingFor: string;
  /** Percent of the position still open once entered (null before entry). */
  openPercent: number | null;
  closed: boolean;
  stages: Record<TradeStageKey, StageState>;
}

const EPS = 1e-6;

export function exitedPercentFrom(
  partials: { percentClosed: number | null }[],
  actualExit: number | null,
): number | null {
  const withPercent = partials.filter((p) => p.percentClosed != null);
  if (withPercent.length > 0) return withPercent.reduce((s, p) => s + (p.percentClosed ?? 0), 0);
  return actualExit != null ? 100 : null;
}

export function deriveTradeLifecycle(f: TradeLifecycleFacts): TradeLifecycle {
  const exited = f.exitedPercent ?? 0;
  const closed = f.hasActualEntry ? exited >= 100 - EPS || f.settled : f.hasLegacyResult;
  const openPercent = f.hasActualEntry ? Math.max(0, Math.round((100 - Math.min(exited, 100)) * 100) / 100) : null;

  let state: TradeDisplayState;
  if (f.cancelled && !f.hasActualEntry) state = "CANCELLED";
  else if (closed) state = f.reviewed ? "REVIEWED" : "REVIEW_NEEDED";
  else if (f.hasActualEntry) state = exited > EPS ? "PARTIALLY_CLOSED" : "OPEN";
  else state = f.hasConfirmedPlan ? "PLANNED" : "IDEA";

  const entered = f.hasActualEntry || f.hasLegacyResult;
  const stages: Record<TradeStageKey, StageState> = {
    idea: { available: true, done: true, lockedReason: null },
    plan: {
      available: state !== "CANCELLED",
      done: f.hasConfirmedPlan,
      lockedReason: state === "CANCELLED" ? "Idea cancelled" : null,
    },
    execution: {
      available: state !== "CANCELLED" && (entered || f.tradingReady),
      done: closed,
      lockedReason:
        state === "CANCELLED"
          ? "Idea cancelled"
          : !entered && !f.tradingReady
            ? "Confirm readiness in Prepare to take this trade"
            : null,
    },
    review: {
      available: entered || state === "CANCELLED",
      done: f.reviewed,
      lockedReason: entered || state === "CANCELLED" ? null : "Available once the trade is entered",
    },
  };

  const primaryStage: TradeStageKey =
    state === "CANCELLED"
      ? "idea"
      : state === "IDEA"
        ? "plan"
        : state === "PLANNED"
          ? f.tradingReady
            ? "execution"
            : "plan"
          : state === "OPEN" || state === "PARTIALLY_CLOSED"
            ? "execution"
            : "review";

  const waitingFor = (() => {
    switch (state) {
      case "CANCELLED":
        return "Cancelled — never triggered";
      case "IDEA":
        return f.tradingReady ? "Waiting for plan" : "Waiting for plan · taking it needs readiness";
      case "PLANNED":
        return f.tradingReady
          ? "Waiting for entry — recording it locks the plan"
          : "Waiting for readiness before entry";
      case "OPEN":
        return `Position open — waiting for exit${f.interimReviewed ? " · interim review saved" : ""}`;
      case "PARTIALLY_CLOSED":
        return `${openPercent}% still open — waiting for exit${f.interimReviewed ? " · interim review saved" : ""}`;
      case "REVIEW_NEEDED":
        return f.hasActualEntry && !f.settled
          ? "Closed — initial stop needed before Performance can settle"
          : f.earlierReviewOutdated
            ? "Trade closed — final review required (earlier review was interim)"
            : "Trade closed — review required";
      case "REVIEWED":
        return "Reviewed";
    }
  })();

  return { state, primaryStage, waitingFor, openPercent, closed, stages };
}

export const STATE_LABEL: Record<TradeDisplayState, string> = {
  IDEA: "Idea",
  PLANNED: "Planned",
  OPEN: "Open",
  PARTIALLY_CLOSED: "Partially closed",
  REVIEW_NEEDED: "Review needed",
  REVIEWED: "Reviewed",
  CANCELLED: "Cancelled",
};

export type TradeListGroup = "ACTIVE" | "IDEAS" | "CARRIED" | "DONE";

/** Which list section a trade belongs to: carried positions first-class,
 *  then today's entered trades, then unexecuted ideas, then finished ones. */
export function listGroupFor(state: TradeDisplayState, carried: boolean): TradeListGroup {
  if (carried) return "CARRIED";
  if (state === "IDEA" || state === "PLANNED") return "IDEAS";
  if (state === "REVIEWED" || state === "CANCELLED") return "DONE";
  return "ACTIVE";
}

/** Needs-action first within a group. */
export const STATE_SORT: Record<TradeDisplayState, number> = {
  REVIEW_NEEDED: 0,
  PARTIALLY_CLOSED: 1,
  OPEN: 2,
  PLANNED: 3,
  IDEA: 4,
  REVIEWED: 5,
  CANCELLED: 6,
};

/**
 * Phase 3 — display lifecycle + review state in one derivation: `closed`
 * comes from the lifecycle facts, and REVIEWED requires the FINAL review
 * (review-state.ts), so an interim or text-only review never shows as done.
 */
export function deriveLifecycleWithReview(
  base: Omit<TradeLifecycleFacts, "reviewed" | "interimReviewed" | "earlierReviewOutdated">,
  review: Pick<ReviewStateFacts, "closedMoment" | "reviewedAt" | "answers">,
): { lifecycle: TradeLifecycle; review: ReviewStateResult } {
  const pre = deriveTradeLifecycle({ ...base, reviewed: false });
  const r = deriveReviewState({
    cancelled: base.cancelled,
    hasActualEntry: base.hasActualEntry,
    hasLegacyResult: base.hasLegacyResult,
    closed: pre.closed,
    ...review,
  });
  const lifecycle = deriveTradeLifecycle({
    ...base,
    reviewed: r.state === "FINAL_REVIEW_COMPLETE",
    interimReviewed: r.state === "INTERIM_REVIEWED",
    earlierReviewOutdated: r.hasEarlierReview,
  });
  return { lifecycle, review: r };
}
