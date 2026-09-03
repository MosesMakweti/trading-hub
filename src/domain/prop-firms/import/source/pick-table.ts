import type { SourceTable } from "./types";

/**
 * Ranks the tables in a `SourceDocument` by how likely each is to be the
 * trade-history block, so the wizard can pre-select one (the user can always
 * override). Pure heuristic over header names, row count, and sheet/section
 * name — never decisive on its own.
 */

const TRADE_HEADER_HINTS = [
  "symbol",
  "instrument",
  "ticker",
  "item",
  "market",
  "contract",
  "side",
  "direction",
  "type",
  "buy/sell",
  "action",
  "volume",
  "size",
  "lots",
  "qty",
  "quantity",
  "contracts",
  "price",
  "open price",
  "close price",
  "entry price",
  "fill price",
  "avg price",
  "profit",
  "pnl",
  "p/l",
  "net",
  "commission",
  "swap",
  "time",
  "date",
  "open time",
  "close time",
  "opening time",
  "closing time",
  "ticket",
  "deal",
  "order",
  "position id",
];

const NAME_BONUS = /deals?|positions?|closed transactions?|trade history|trades?|executions?|orders?|fills?|account history/i;
const NAME_PENALTY = /summary|chart|overview|settings?|config|metadata|totals?|statistics?|ratios?/i;

export interface TableScore {
  id: string;
  name: string;
  rowCount: number;
  score: number;
  looksLikeTrades: boolean;
}

export function scoreTable(table: SourceTable): TableScore {
  const headersLower = table.headers.map((h) => h.toLowerCase());
  const hits = TRADE_HEADER_HINTS.filter((hint) => headersLower.some((h) => h === hint || h.includes(hint))).length;

  let score = hits * 3;
  score += Math.min(table.rows.length, 200) / 10;
  if (NAME_BONUS.test(table.name)) score += 8;
  if (NAME_PENALTY.test(table.name)) score -= 10;
  if (table.rows.length === 0) score -= 20;

  // MT5 HTML report: the "Deals" section is the one to import (fill-per-row,
  // carries Deal IDs, Direction in/out, and the Balance column with
  // deposits/payouts) — its columns beat the sibling Positions/Orders sections.
  if (headersLower.includes("deal") && headersLower.some((h) => h.includes("balance")) && headersLower.includes("direction")) {
    score += 18;
  }

  return {
    id: table.id,
    name: table.name,
    rowCount: table.rows.length,
    score: Math.round(score * 10) / 10,
    looksLikeTrades: hits >= 3 && table.rows.length > 0,
  };
}

export function rankTables(tables: SourceTable[]): TableScore[] {
  return tables.map(scoreTable).sort((a, b) => b.score - a.score);
}

export function pickBestTableId(tables: SourceTable[]): string {
  const ranked = rankTables(tables);
  return ranked[0]?.id ?? tables[0]?.id ?? "";
}
