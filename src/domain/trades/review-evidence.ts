// Today V3 (Phase 3) — evidence-assisted review judgements. Pure.
//
// DERIVE → SHOW EVIDENCE → ASK FOR JUDGEMENT. These functions turn canonical
// execution facts into (a) a list of plain facts to show and (b) at most a
// SUGGESTED yes/no for a questionnaire judgement — only when the facts are
// deterministic enough. A suggestion is never stored by itself: the trader
// confirms or flips it. Ambiguous evidence → `suggestion: null`.
//
// Outcome (R / PnL / win-loss) is deliberately NOT an input to anything
// here: a losing trade can be perfectly managed and a winner badly managed.

import type { LimitOverrideKind } from "@/domain/today/limit-state";

export type Suggestion = "yes" | "no" | null;

export interface EvidenceResult {
  suggestion: Suggestion;
  /** One line explaining the suggestion (or why there isn't one). */
  reason: string;
  facts: string[];
}

const EPS = 1e-9;

// ── Stop movement ────────────────────────────────────────────────────────────

/** True when the CURRENT stop sits further from entry than the frozen
 *  initial stop (i.e. risk was widened). Null when either is unknown. */
export function stopWidened(
  direction: "LONG" | "SHORT",
  initialStop: number | null,
  currentStop: number | null,
): boolean | null {
  if (initialStop == null || currentStop == null) return null;
  return direction === "LONG" ? currentStop < initialStop - EPS : currentStop > initialStop + EPS;
}

// ── Risk adherence ───────────────────────────────────────────────────────────

export interface LimitOverrideContext {
  kinds: LimitOverrideKind[];
  maxTrades: number | null;
  executedCount: number;
  riskLimitPercent: number | null;
  riskUsedPercent: number;
  projectedRiskPercent: number | null;
  at?: string;
}

export interface RiskEvidenceInput {
  direction: "LONG" | "SHORT";
  /** Frozen PerformanceRiskSnapshot.riskPercent; null = no snapshot. */
  riskPercent: number | null;
  /** The Performance Account's configured default risk % (current config). */
  defaultRiskPercent: number | null;
  initialStop: number | null;
  currentStop: number | null;
  /** Today's confirmed daily risk boundary for the trade's day. */
  dayRiskLimitPercent: number | null;
  limitOverride: { reason: string; context: LimitOverrideContext | null } | null;
}

export function riskAdherenceEvidence(i: RiskEvidenceInput): EvidenceResult {
  const facts: string[] = [];
  if (i.riskPercent != null) {
    facts.push(
      `Risk ${fmtPct(i.riskPercent)}${i.defaultRiskPercent != null ? ` · account default ${fmtPct(i.defaultRiskPercent)}` : ""}`,
    );
  }
  if (i.dayRiskLimitPercent != null) facts.push(`Confirmed daily risk limit ${fmtPct(i.dayRiskLimitPercent)}`);
  const widened = stopWidened(i.direction, i.initialStop, i.currentStop);
  if (i.initialStop != null) {
    facts.push(
      i.currentStop == null || Math.abs(i.currentStop - i.initialStop) < EPS
        ? `Stop unchanged from initial ${i.initialStop}`
        : `Stop moved ${widened ? "wider" : "tighter"}: ${i.initialStop} → ${i.currentStop}`,
    );
  }
  if (i.limitOverride) facts.push(`Daily limit overridden: "${i.limitOverride.reason}"`);

  if (i.riskPercent == null) {
    return { suggestion: null, reason: "No Performance risk snapshot — your judgement.", facts };
  }
  if (widened === true) {
    return { suggestion: "no", reason: "The stop was moved wider than the initial stop.", facts };
  }
  if (i.limitOverride?.context?.kinds.includes("DAILY_RISK")) {
    return {
      suggestion: null,
      reason: "You consciously overrode today's risk limit — whether that was per plan is your call.",
      facts,
    };
  }
  if (i.defaultRiskPercent == null) {
    return { suggestion: null, reason: "No account default risk to compare against.", facts };
  }
  if (i.riskPercent > i.defaultRiskPercent + EPS) {
    return {
      suggestion: null,
      reason: `Risk was set above the account default before entry — only you know if the plan called for it.`,
      facts,
    };
  }
  const withinLimit = i.dayRiskLimitPercent != null ? ", within the confirmed daily limit" : "";
  return {
    suggestion: "yes",
    reason: `${fmtPct(i.riskPercent)} risk, at or below the account default${withinLimit}; initial stop not widened.`,
    facts,
  };
}

// ── Exit-plan adherence ──────────────────────────────────────────────────────

export interface PlannedTargetFact {
  targetOrder: number;
  label: string;
  price: number;
  closePercent: number | null;
  managementInstruction: string | null;
  moveToBreakEven: boolean;
}

export interface ExitFact {
  price: number;
  /** Percent of the position this exit closed; null = unknown size. */
  percent: number | null;
  /** Explicit trader mapping to a planned target (PlannedTarget order). */
  targetOrder: number | null;
}

export type TargetOutcome =
  | "TAKEN" // an exit at this target with the planned size (or no planned size)
  | "TAKEN_DIFFERENT_SIZE" // exited at this target but not the planned %
  | "EXCEEDED_NOT_TAKEN" // an exit happened beyond this level, yet the planned partial wasn't taken here
  | "PASSED" // an exit happened beyond this level; no partial was planned here
  | "NOT_REACHED"; // no exit at or beyond it (price may or may not have got there)

export type OtherExitKind = "INITIAL_STOP" | "BREAKEVEN" | "MANUAL";

export interface ExitEvidenceInput {
  direction: "LONG" | "SHORT";
  closed: boolean;
  entry: number | null;
  initialStop: number | null;
  targets: PlannedTargetFact[];
  exits: ExitFact[];
}

export interface ExitEvidenceResult extends EvidenceResult {
  targets: { targetOrder: number; label: string; plannedPercent: number | null; outcome: TargetOutcome; takenPercent: number }[];
  otherExits: { kind: OtherExitKind; price: number; percent: number | null }[];
}

/** Price tolerance for "exited AT a level": 5% of the initial risk distance,
 *  falling back to 0.05% of price when the stop is unknown. */
export function levelTolerance(entry: number | null, initialStop: number | null, refPrice: number): number {
  if (entry != null && initialStop != null && Math.abs(entry - initialStop) > EPS) {
    return Math.abs(entry - initialStop) * 0.05;
  }
  return Math.abs(refPrice) * 0.0005;
}

function beyondOrAt(direction: "LONG" | "SHORT", price: number, level: number, tol: number): boolean {
  return direction === "LONG" ? price >= level - tol : price <= level + tol;
}

export function exitAdherenceEvidence(i: ExitEvidenceInput): ExitEvidenceResult {
  const base = { targets: [] as ExitEvidenceResult["targets"], otherExits: [] as ExitEvidenceResult["otherExits"] };
  if (i.targets.length === 0) {
    return { ...base, suggestion: null, reason: "No confirmed plan targets to compare against — your judgement.", facts: [] };
  }
  if (!i.closed) {
    return { ...base, suggestion: null, reason: "Position still open — judge the exit once it's closed.", facts: [] };
  }

  const ref = i.entry ?? i.targets[0].price;
  const tol = levelTolerance(i.entry, i.initialStop, ref);
  const targets = [...i.targets].sort((a, b) => a.targetOrder - b.targetOrder);
  const used = new Set<number>();

  // 1) Explicit trader mappings win; 2) otherwise match by price.
  const matched = new Map<number, number[]>();
  i.exits.forEach((e, idx) => {
    if (e.targetOrder != null && targets.some((t) => t.targetOrder === e.targetOrder)) {
      matched.set(e.targetOrder, [...(matched.get(e.targetOrder) ?? []), idx]);
      used.add(idx);
    }
  });
  i.exits.forEach((e, idx) => {
    if (used.has(idx)) return;
    const t = targets.find((x) => Math.abs(e.price - x.price) <= tol);
    if (t) {
      matched.set(t.targetOrder, [...(matched.get(t.targetOrder) ?? []), idx]);
      used.add(idx);
    }
  });

  const outTargets: ExitEvidenceResult["targets"] = targets.map((t) => {
    const idxs = matched.get(t.targetOrder) ?? [];
    const taken = idxs.reduce((s, k) => s + (i.exits[k].percent ?? 0), 0);
    let outcome: TargetOutcome;
    if (idxs.length > 0) {
      const unknownSize = idxs.some((k) => i.exits[k].percent == null);
      outcome =
        t.closePercent == null || unknownSize || Math.abs(taken - t.closePercent) <= 1 ? "TAKEN" : "TAKEN_DIFFERENT_SIZE";
    } else {
      const exceeded = i.exits.some((e) => beyondOrAt(i.direction, e.price, t.price, -tol));
      outcome = !exceeded ? "NOT_REACHED" : t.closePercent != null && t.closePercent > 0 ? "EXCEEDED_NOT_TAKEN" : "PASSED";
    }
    return { targetOrder: t.targetOrder, label: t.label, plannedPercent: t.closePercent, outcome, takenPercent: taken };
  });

  const otherExits: ExitEvidenceResult["otherExits"] = [];
  i.exits.forEach((e, idx) => {
    if (used.has(idx)) return;
    let kind: OtherExitKind = "MANUAL";
    if (i.initialStop != null && Math.abs(e.price - i.initialStop) <= tol) kind = "INITIAL_STOP";
    else if (i.entry != null && Math.abs(e.price - i.entry) <= tol) kind = "BREAKEVEN";
    otherExits.push({ kind, price: e.price, percent: e.percent });
  });

  const facts: string[] = [];
  for (const t of outTargets) {
    const planned = t.plannedPercent != null ? ` ${fmtNum(t.plannedPercent)}%` : "";
    if (t.outcome === "TAKEN") facts.push(`${t.label}${planned} ✓`);
    else if (t.outcome === "TAKEN_DIFFERENT_SIZE")
      facts.push(`${t.label}: closed ${fmtNum(t.takenPercent)}% (planned${planned})`);
    else if (t.outcome === "EXCEEDED_NOT_TAKEN") facts.push(`${t.label} level was exceeded by a later exit, planned${planned} not taken there`);
    else if (t.outcome === "PASSED") facts.push(`${t.label} level passed (no partial planned there)`);
    else facts.push(`${t.label}: not reached by any exit`);
  }
  for (const o of otherExits) {
    const pct = o.percent != null ? `${fmtNum(o.percent)}% ` : "";
    facts.push(
      o.kind === "INITIAL_STOP"
        ? `${pct}stopped at the initial stop`
        : o.kind === "BREAKEVEN"
          ? `${pct}closed at breakeven`
          : `${pct}closed manually at ${o.price}`,
    );
  }

  const deviated = outTargets.some((t) => t.outcome === "TAKEN_DIFFERENT_SIZE" || t.outcome === "EXCEEDED_NOT_TAKEN");
  if (deviated) {
    return { targets: outTargets, otherExits, facts, suggestion: "no", reason: "A target level was reached by your exits but the planned partial wasn't taken as planned." };
  }
  const beAllowed = targets.some((t) => t.moveToBreakEven) && outTargets.some((t) => t.outcome === "TAKEN");
  const manual = otherExits.some((o) => o.kind === "MANUAL" || (o.kind === "BREAKEVEN" && !beAllowed));
  if (manual) {
    return {
      targets: outTargets,
      otherExits,
      facts,
      suggestion: null,
      reason: "Part of the position was closed away from the planned levels — only you know if your management rules called for it.",
    };
  }
  if (i.exits.length === 0) {
    return { targets: outTargets, otherExits, facts, suggestion: null, reason: "No exits recorded to compare against." };
  }
  return {
    targets: outTargets,
    otherExits,
    facts,
    suggestion: "yes",
    reason: "Every exit was at a planned target with its planned size, or at the planned stop/breakeven rule.",
  };
}

// ── Behaviour-label suggestions ─────────────────────────────────────────────

export interface LabelSuggestionInput {
  tradeIntent: string | null;
  risk: EvidenceResult;
  exit: ExitEvidenceResult;
  stopWidened: boolean | null;
}

/**
 * Candidate label NAMES from known facts only (never outcome). The caller
 * keeps those that exist in the trader's own catalog and aren't attached
 * yet — suggestions are never attached automatically.
 */
export function suggestBehaviourLabelNames(i: LabelSuggestionInput): { name: string; reason: string }[] {
  const out: { name: string; reason: string }[] = [];
  if (i.tradeIntent === "FOMO") out.push({ name: "FOMO trade", reason: "Motive: FOMO" });
  if (i.tradeIntent === "REVENGE") out.push({ name: "Revenge trade", reason: "Motive: revenge" });
  if (i.risk.suggestion === "yes") out.push({ name: "Correct risk", reason: i.risk.reason });
  if (i.stopWidened === true) out.push({ name: "Moved SL wider", reason: "Current stop is wider than the initial stop" });
  if (i.exit.targets.some((t) => t.outcome === "TAKEN" && t.plannedPercent != null && t.plannedPercent > 0)) {
    out.push({ name: "Took planned partial", reason: "A planned partial was taken at its target" });
  }
  if (i.exit.targets.some((t) => t.outcome === "EXCEEDED_NOT_TAKEN")) {
    out.push({ name: "Failed planned partial", reason: "A target was exceeded without its planned partial" });
  }
  if (i.exit.suggestion === "yes") out.push({ name: "Followed exit plan", reason: i.exit.reason });
  return out;
}

export function filterSuggestionsToCatalog<T extends { name: string }>(
  suggestions: T[],
  catalog: { id: string; name: string }[],
  attachedIds: string[],
): (T & { labelId: string })[] {
  const attached = new Set(attachedIds);
  const out: (T & { labelId: string })[] = [];
  for (const s of suggestions) {
    const hit = catalog.find((c) => c.name.trim().toLowerCase() === s.name.toLowerCase());
    if (hit && !attached.has(hit.id) && !out.some((o) => o.labelId === hit.id)) out.push({ ...s, labelId: hit.id });
  }
  return out;
}

function fmtPct(n: number): string {
  return `${fmtNum(n)}%`;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
