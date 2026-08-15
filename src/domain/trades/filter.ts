/**
 * Pure trade filtering for the Trade Gallery / Journal (Phase 9). Operates on a
 * minimal shape so it stays decoupled from the full workspace DTO and is easy to
 * unit-test. Every filter is optional (null / "" = no constraint); all active
 * filters must match (AND).
 */
export type TradeGrade = "A" | "B" | "C" | "D" | "F";

export interface FilterableTrade {
  assetSymbol: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED" | "REVIEWED";
  actualRR: number | null;
  strategyName: string | null;
  psychology: { grade: TradeGrade } | null;
  // Optional — only the Trades Album's session/adherence/date-range filters read
  // these; every other caller's shape (e.g. TradeWorkspaceDTO) already carries
  // them, so this stays a strict superset and existing callers are unaffected.
  sessionName?: string | null;
  adherencePercent?: number | null;
  dateKey?: string;
  // Prop Firms module (final phase) — one Trade Idea can have zero, one, or
  // many account executions; these summarize ALL of them so a filter matches
  // if ANY execution qualifies (never duplicating the idea into multiple rows).
  propFirmAccountIds?: string[];
  propFirmIds?: string[];
  marketCategories?: ("CFD" | "FUTURES")[];
  /** "FUNDED" if any execution's stage was a funded/master/payout-eligible
   *  type, "CHALLENGE" if any execution's stage was not, null if no executions. */
  fundedOrChallenge?: "FUNDED" | "CHALLENGE" | null;
}

/** `result` is by R sign: WIN = actualRR > 0, LOSS = actualRR < 0, OPEN = no result. */
export interface TradeFilters {
  search: string;
  direction: "LONG" | "SHORT" | null;
  status: "OPEN" | "CLOSED" | "REVIEWED" | null;
  result: "WIN" | "LOSS" | "OPEN" | null;
  grade: TradeGrade | null;
  asset: string | null;
  strategy: string | null;
  session: string | null;
  /** Minimum strategy-adherence self-score, 0-100. */
  minAdherence: number | null;
  /** Inclusive "YYYY-MM-DD" date-key bounds. */
  dateFrom: string | null;
  dateTo: string | null;
  propFirmAccountId: string | null;
  propFirmId: string | null;
  marketCategory: "CFD" | "FUTURES" | null;
  fundedOrChallenge: "FUNDED" | "CHALLENGE" | null;
}

export const EMPTY_TRADE_FILTERS: TradeFilters = {
  search: "",
  direction: null,
  status: null,
  result: null,
  grade: null,
  asset: null,
  strategy: null,
  session: null,
  minAdherence: null,
  dateFrom: null,
  dateTo: null,
  propFirmAccountId: null,
  propFirmId: null,
  marketCategory: null,
  fundedOrChallenge: null,
};

export function hasActiveFilters(f: TradeFilters): boolean {
  return (
    f.search.trim() !== "" ||
    f.direction !== null ||
    f.status !== null ||
    f.result !== null ||
    f.grade !== null ||
    f.asset !== null ||
    f.strategy !== null ||
    f.session !== null ||
    f.minAdherence !== null ||
    f.dateFrom !== null ||
    f.dateTo !== null ||
    f.propFirmAccountId !== null ||
    f.propFirmId !== null ||
    f.marketCategory !== null ||
    f.fundedOrChallenge !== null
  );
}

function matchesResult(actualRR: number | null, result: TradeFilters["result"]): boolean {
  if (result === "OPEN") return actualRR == null;
  if (result === "WIN") return actualRR != null && actualRR > 0;
  if (result === "LOSS") return actualRR != null && actualRR < 0;
  return true;
}

export function filterTrades<T extends FilterableTrade>(trades: T[], f: TradeFilters): T[] {
  const terms = f.search.toLowerCase().split(/\s+/).filter(Boolean);

  return trades.filter((t) => {
    if (f.direction && t.direction !== f.direction) return false;
    if (f.status && t.status !== f.status) return false;
    if (!matchesResult(t.actualRR, f.result)) return false;
    if (f.grade && t.psychology?.grade !== f.grade) return false;
    if (f.asset && t.assetSymbol !== f.asset) return false;
    if (f.strategy && t.strategyName !== f.strategy) return false;
    if (f.session && t.sessionName !== f.session) return false;
    if (f.minAdherence != null && (t.adherencePercent ?? -1) < f.minAdherence) return false;
    if (f.dateFrom && (!t.dateKey || t.dateKey < f.dateFrom)) return false;
    if (f.dateTo && (!t.dateKey || t.dateKey > f.dateTo)) return false;
    if (f.propFirmAccountId && !(t.propFirmAccountIds ?? []).includes(f.propFirmAccountId)) return false;
    if (f.propFirmId && !(t.propFirmIds ?? []).includes(f.propFirmId)) return false;
    if (f.marketCategory && !(t.marketCategories ?? []).includes(f.marketCategory)) return false;
    if (f.fundedOrChallenge && t.fundedOrChallenge !== f.fundedOrChallenge) return false;
    if (terms.length) {
      const haystack = `${t.assetSymbol} ${t.strategyName ?? ""}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}
