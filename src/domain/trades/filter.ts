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
}

export const EMPTY_TRADE_FILTERS: TradeFilters = {
  search: "",
  direction: null,
  status: null,
  result: null,
  grade: null,
  asset: null,
  strategy: null,
};

export function hasActiveFilters(f: TradeFilters): boolean {
  return (
    f.search.trim() !== "" ||
    f.direction !== null ||
    f.status !== null ||
    f.result !== null ||
    f.grade !== null ||
    f.asset !== null ||
    f.strategy !== null
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
    if (terms.length) {
      const haystack = `${t.assetSymbol} ${t.strategyName ?? ""}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}
