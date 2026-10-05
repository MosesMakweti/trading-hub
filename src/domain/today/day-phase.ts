// Today V3 (Phase 1) — day phase + phase-rail state + status-strip warnings.
// Pure; every value is derived from existing facts (no stored state).
//
// Decision 1 (approved): Plan is always reachable; readiness gates TRADING.

export type DayPhase = "PREPARING" | "PLANNING" | "TRADING" | "CLOSED";
export type PhaseKey = "prepare" | "plan" | "trade" | "close";

export interface DayPhaseFacts {
  archived: boolean;
  /** routineReadyAt != null AND every mandatory item still complete. */
  ready: boolean;
  planSet: boolean;
  tradeCount: number;
}

/** The phase the day is in right now — what the status strip names. */
export function deriveDayPhase(f: DayPhaseFacts): DayPhase {
  if (f.archived) return "CLOSED";
  if (!f.ready) return "PREPARING";
  if (!f.planSet && f.tradeCount === 0) return "PLANNING";
  return "TRADING";
}

export interface PhaseRailItem {
  key: PhaseKey;
  done: boolean;
  /** Trade is the only phase that can be locked (readiness gate). */
  locked: boolean;
  /** Something in this phase needs the trader (shown as a dot). */
  attention: boolean;
}

export function derivePhaseRail(
  f: DayPhaseFacts & { tradesNeedingAttention: number },
): PhaseRailItem[] {
  return [
    { key: "prepare", done: f.ready, locked: false, attention: !f.ready && !f.archived },
    { key: "plan", done: f.planSet, locked: false, attention: false },
    { key: "trade", done: false, locked: !f.ready && !f.archived, attention: f.tradesNeedingAttention > 0 },
    { key: "close", done: f.archived, locked: false, attention: false },
  ];
}

/** The phase to open by default: the first unfinished of Prepare/Plan, else Trade. */
export function defaultPhase(f: DayPhaseFacts): PhaseKey {
  if (f.archived) return "close";
  if (!f.ready && !f.planSet) return "plan";
  if (!f.ready) return "prepare";
  if (!f.planSet && f.tradeCount === 0) return "plan";
  return "trade";
}

// ── Status-strip warnings ────────────────────────────────────────────────────

export type StatusWarningCode =
  | "ROUTINE_INCOMPLETE"
  | "RISK_LIMIT_REACHED"
  | "RISK_LIMIT_EXCEEDED"
  | "MAX_TRADES_REACHED"
  | "MAX_TRADES_EXCEEDED"
  | "REVIEW_PENDING"
  | "LOGGED_BEFORE_READY"
  | "CARRIED_OPEN";

export interface StatusWarning {
  code: StatusWarningCode;
  severity: "info" | "warning" | "danger";
  message: string;
}

export interface StatusWarningFacts {
  archived: boolean;
  ready: boolean;
  mandatoryRemaining: number;
  risk: "NO_LIMIT" | "WITHIN" | "AT_LIMIT" | "OVER";
  trades: "NO_LIMIT" | "WITHIN" | "AT_LIMIT" | "OVER";
  /** Executed, Performance-settled trades with no review yet. */
  reviewPendingCount: number;
  loggedBeforeReadyCount: number;
  /** Open positions entered on earlier live days (Phase 2). */
  carriedOpenCount?: number;
}

/** One ordered list, most severe first. Archived days carry no warnings. */
export function buildStatusWarnings(f: StatusWarningFacts): StatusWarning[] {
  if (f.archived) return [];
  const out: StatusWarning[] = [];
  if (f.risk === "OVER") out.push({ code: "RISK_LIMIT_EXCEEDED", severity: "danger", message: "Daily risk limit exceeded" });
  else if (f.risk === "AT_LIMIT") out.push({ code: "RISK_LIMIT_REACHED", severity: "warning", message: "Daily risk limit reached" });
  if (f.trades === "OVER") out.push({ code: "MAX_TRADES_EXCEEDED", severity: "danger", message: "Max trades exceeded" });
  else if (f.trades === "AT_LIMIT") out.push({ code: "MAX_TRADES_REACHED", severity: "warning", message: "Max trades reached" });
  if (!f.ready) {
    out.push({
      code: "ROUTINE_INCOMPLETE",
      severity: "warning",
      message:
        f.mandatoryRemaining > 0
          ? `${f.mandatoryRemaining} mandatory routine item${f.mandatoryRemaining === 1 ? "" : "s"} left`
          : "Readiness not confirmed",
    });
  }
  if ((f.carriedOpenCount ?? 0) > 0) {
    const n = f.carriedOpenCount!;
    out.push({
      code: "CARRIED_OPEN",
      severity: "warning",
      message: `${n} open position${n === 1 ? "" : "s"} carried from an earlier day`,
    });
  }
  if (f.reviewPendingCount > 0) {
    out.push({
      code: "REVIEW_PENDING",
      severity: "info",
      message: `${f.reviewPendingCount} closed trade${f.reviewPendingCount === 1 ? "" : "s"} awaiting review`,
    });
  }
  if (f.loggedBeforeReadyCount > 0) {
    out.push({
      code: "LOGGED_BEFORE_READY",
      severity: "info",
      message: `${f.loggedBeforeReadyCount} trade${f.loggedBeforeReadyCount === 1 ? "" : "s"} logged before readiness was confirmed`,
    });
  }
  return out;
}

/**
 * A trade counts as "logged before readiness" when it was created while the
 * day had no readiness confirmation: either readiness is still unconfirmed,
 * or the trade's createdAt precedes routineReadyAt. Note: reopening the
 * routine clears routineReadyAt, after which every existing trade reads as
 * logged-before-ready until readiness is confirmed again (no history of
 * earlier confirmations is stored).
 */
export function loggedBeforeReadiness(tradeCreatedAtIso: string, routineReadyAtIso: string | null): boolean {
  if (routineReadyAtIso == null) return true;
  return new Date(tradeCreatedAtIso).getTime() < new Date(routineReadyAtIso).getTime();
}

/** Plan UX — where "Plan set" continues to: Trade once readiness is
 *  confirmed, otherwise Prepare (readiness gates trading, never planning). */
export function phaseAfterPlan(ready: boolean): PhaseKey {
  return ready ? "trade" : "prepare";
}
