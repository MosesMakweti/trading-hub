/**
 * Weekly Trade Audit — change detection between a review and the live trade
 * (pure). Policy (docs/WEEKLY_TRADE_AUDIT.md §6): an edit to a trade after it
 * was assessed is FLAGGED, never used to silently rewrite the assessment or a
 * finalized week.
 *
 * The fingerprint covers only decision-relevant facts (what the trader
 * judged); cosmetic edits such as notes or screenshots don't flag.
 */
import type { AuditTradeDTO, TradeChangeDTO } from "@/types/trade-audit";

const FIELDS: { key: keyof AuditTradeDTO; label: string }[] = [
  { key: "dateKey", label: "date" },
  { key: "assetSymbol", label: "instrument" },
  { key: "direction", label: "direction" },
  { key: "strategyId", label: "strategy" },
  { key: "plannedEntry", label: "planned entry" },
  { key: "plannedStopLoss", label: "planned stop" },
  { key: "plannedTarget", label: "planned target" },
  { key: "actualEntry", label: "entry" },
  { key: "actualStopLoss", label: "stop" },
  { key: "actualExit", label: "exit" },
  { key: "realizedR", label: "result (R)" },
  { key: "pnl", label: "P&L" },
  { key: "outcome", label: "outcome" },
];

type FingerprintFacts = Record<string, string | number | null>;

function facts(trade: AuditTradeDTO): FingerprintFacts {
  const out: FingerprintFacts = {};
  for (const f of FIELDS) {
    const v = trade[f.key];
    out[f.key] = typeof v === "number" ? Number(v.toFixed(8)) : (v as string | null) ?? null;
  }
  return out;
}

/** Stable JSON string of the decision-relevant facts. */
export function tradeFingerprint(trade: AuditTradeDTO): string {
  return JSON.stringify(facts(trade));
}

/** Labels of the fields that differ between a stored fingerprint and the live trade. */
export function changedFields(storedFingerprint: string, live: AuditTradeDTO): string[] {
  let stored: FingerprintFacts;
  try {
    stored = JSON.parse(storedFingerprint) as FingerprintFacts;
  } catch {
    return ["details"];
  }
  const now = facts(live);
  return FIELDS.filter((f) => (stored[f.key] ?? null) !== (now[f.key] ?? null)).map((f) => f.label);
}

function tradeLabel(t: Pick<AuditTradeDTO, "assetSymbol" | "direction" | "tradeNumber">): string {
  return `${t.tradeNumber != null ? `#${t.tradeNumber} ` : ""}${t.assetSymbol} ${t.direction === "LONG" ? "long" : "short"}`;
}

/**
 * IN-PROGRESS audit: which assessed trades changed since they were assessed.
 *  - EDITED: still on this day, decision-relevant facts differ
 *  - MOVED:  the live trade now sits on another date (shown on its new day)
 *  - REMOVED: the assessed trade no longer exists in scope (deleted / re-scoped)
 */
export function detectAssessmentChanges(
  assessments: { tradeId: string | null; dateKey: string; tradeFingerprint: string | null; snapshotLabel: string | null }[],
  liveById: Map<string, AuditTradeDTO>,
): Map<string, TradeChangeDTO[]> {
  const byDay = new Map<string, TradeChangeDTO[]>();
  const push = (dateKey: string, c: TradeChangeDTO) => byDay.set(dateKey, [...(byDay.get(dateKey) ?? []), c]);
  for (const a of assessments) {
    if (!a.tradeId || !a.tradeFingerprint) continue;
    const live = liveById.get(a.tradeId);
    if (!live) {
      push(a.dateKey, { tradeId: a.tradeId, label: a.snapshotLabel ?? "An assessed trade", kind: "REMOVED", fields: [] });
      continue;
    }
    const fields = changedFields(a.tradeFingerprint, live);
    if (fields.length === 0) continue;
    if (live.dateKey !== a.dateKey) {
      push(live.dateKey, { tradeId: live.id, label: tradeLabel(live), kind: "MOVED", fields });
    } else {
      push(a.dateKey, { tradeId: live.id, label: tradeLabel(live), kind: "EDITED", fields });
    }
  }
  return byDay;
}

/**
 * FINALIZED audit: differences between the frozen snapshot of the week and
 * the live trades now — edits, removals, and trades that appeared in the week
 * after it was finalized. The snapshot stays authoritative; this only explains
 * the drift.
 */
export function detectFinalizedDrift(snapshots: AuditTradeDTO[], live: AuditTradeDTO[]): Map<string, TradeChangeDTO[]> {
  const byDay = new Map<string, TradeChangeDTO[]>();
  const push = (dateKey: string, c: TradeChangeDTO) => byDay.set(dateKey, [...(byDay.get(dateKey) ?? []), c]);
  const liveById = new Map(live.map((t) => [t.id, t]));
  const snapIds = new Set(snapshots.map((s) => s.id));
  for (const s of snapshots) {
    const l = liveById.get(s.id);
    if (!l) {
      push(s.dateKey, { tradeId: s.id, label: tradeLabel(s), kind: "REMOVED", fields: [] });
      continue;
    }
    const fields = changedFields(tradeFingerprint(s), l);
    if (fields.length === 0) continue;
    push(s.dateKey, { tradeId: s.id, label: tradeLabel(s), kind: l.dateKey !== s.dateKey ? "MOVED" : "EDITED", fields });
  }
  for (const l of live) {
    if (!snapIds.has(l.id)) push(l.dateKey, { tradeId: l.id, label: tradeLabel(l), kind: "ADDED", fields: [] });
  }
  return byDay;
}

export { tradeLabel };
