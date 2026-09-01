import {
  normalizeSide,
  normalizeSymbol,
  parseGenericDateTime,
  parseLocaleNumber,
} from "../normalize";
import type { ColumnMapping, ImportAdapter, NormalizedExecutionRow, ParseRejection, ParseResult, ParseWarning } from "../types";

const NON_TRADE_TYPE_HINTS = ["balance", "deposit", "withdraw", "credit", "transfer", "fee", "commission", "correction"];

function getMapped(row: Record<string, string>, mapping: ColumnMapping, field: string): string | undefined {
  const header = mapping[field];
  if (!header) return undefined;
  const value = row[header];
  return value == null ? undefined : value.trim();
}

/**
 * The column-mapping fallback: every field comes from a caller-supplied
 * `ColumnMapping` (built manually in the wizard, or loaded from a saved
 * `PropFirmImportMappingTemplate`) rather than a fixed known header set.
 * Used whenever platform auto-detection is uncertain or a broker's CSV
 * doesn't match any dedicated adapter.
 */
export const genericCsvAdapter: ImportAdapter = {
  platform: "GENERIC_CSV",
  label: "Generic CSV (manual column mapping)",

  // Always the lowest-confidence match — every other adapter should win
  // when its own shape matches; this is the deliberate catch-all.
  detect(): number {
    return 0.1;
  },

  parse(rows, _headers, opts): ParseResult {
    const mapping = opts.mapping ?? {};
    const executions: NormalizedExecutionRow[] = [];
    const transactions: ParseResult["transactions"] = [];
    const warnings: ParseWarning[] = [];
    const rejections: ParseRejection[] = [];

    const hasTypeColumn = Boolean(mapping.transactionType);
    const hasSideColumn = Boolean(mapping.direction);

    rows.forEach((row, index) => {
      try {
        const rawType = getMapped(row, mapping, "transactionType");
        const sideRaw = getMapped(row, mapping, "direction");
        const side = sideRaw ? normalizeSide(sideRaw) : null;

        const isNonTradeRow =
          (hasTypeColumn && rawType != null && NON_TRADE_TYPE_HINTS.some((h) => rawType.toLowerCase().includes(h))) ||
          (hasSideColumn && sideRaw != null && side == null);

        if (isNonTradeRow || (!hasSideColumn && hasTypeColumn)) {
          const amountRaw = getMapped(row, mapping, "amount") ?? getMapped(row, mapping, "grossPnl");
          const dateRaw = getMapped(row, mapping, "executedAt") ?? getMapped(row, mapping, "occurredAt");
          if (!amountRaw || !dateRaw) {
            rejections.push({ rowIndex: index, message: "Missing amount/date for a non-trade row.", raw: row });
            return;
          }
          transactions.push({
            kind: "TRANSACTION",
            platformTransactionId: getMapped(row, mapping, "platformTransactionId") ?? null,
            rawType: rawType ?? "Unknown",
            amount: parseLocaleNumber(amountRaw),
            currency: getMapped(row, mapping, "currency") ?? null,
            occurredAt: parseGenericDateTime(dateRaw, opts.timezone),
            rawRow: row,
            sourceRowIndex: index,
          });
          return;
        }

        const instrumentRaw = getMapped(row, mapping, "instrument");
        const quantityRaw = getMapped(row, mapping, "quantity");
        const priceRaw = getMapped(row, mapping, "price");
        const dateRaw = getMapped(row, mapping, "executedAt");

        if (!instrumentRaw || !side || !quantityRaw || !priceRaw || !dateRaw) {
          rejections.push({
            rowIndex: index,
            message: "Missing a required execution field (instrument/direction/quantity/price/date).",
            raw: row,
          });
          return;
        }

        const commissionRaw = getMapped(row, mapping, "commission");
        const swapRaw = getMapped(row, mapping, "swap");
        const feesRaw = getMapped(row, mapping, "otherFees");
        const grossPnlRaw = getMapped(row, mapping, "grossPnl");

        executions.push({
          kind: "EXECUTION",
          platformExecutionId: getMapped(row, mapping, "platformExecutionId") ?? null,
          platformOrderId: getMapped(row, mapping, "platformOrderId") ?? null,
          platformDealId: getMapped(row, mapping, "platformDealId") ?? null,
          instrumentRaw,
          instrumentNormalized: normalizeSymbol(instrumentRaw),
          direction: side,
          quantity: parseLocaleNumber(quantityRaw),
          price: parseLocaleNumber(priceRaw),
          grossPnl: grossPnlRaw ? parseLocaleNumber(grossPnlRaw) : null,
          commission: commissionRaw ? parseLocaleNumber(commissionRaw) : null,
          swap: swapRaw ? parseLocaleNumber(swapRaw) : null,
          otherFees: feesRaw ? parseLocaleNumber(feesRaw) : null,
          currency: getMapped(row, mapping, "currency") ?? null,
          executedAt: parseGenericDateTime(dateRaw, opts.timezone),
          rawRow: row,
          sourceRowIndex: index,
        });
      } catch (error) {
        rejections.push({
          rowIndex: index,
          message: error instanceof Error ? error.message : "Failed to parse row.",
          raw: row,
        });
      }
    });

    if (executions.length === 0 && transactions.length === 0 && rejections.length === 0) {
      warnings.push({ rowIndex: null, message: "No rows were parsed — check the column mapping." });
    }

    return { executions, transactions, warnings, rejections };
  },
};

export function buildBestGuessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const guesses: Record<string, string[]> = {
    instrument: ["symbol", "instrument", "item", "market", "pair", "contract"],
    direction: ["type", "side", "direction", "buysell"],
    quantity: ["volume", "size", "lots", "quantity", "qty", "contracts"],
    price: ["price", "openprice", "entryprice", "fillprice"],
    grossPnl: ["profit", "pnl", "grosspnl", "netprofit"],
    commission: ["commission", "comm"],
    swap: ["swap", "rollover"],
    otherFees: ["fee", "fees", "otherfees"],
    currency: ["currency", "ccy"],
    executedAt: ["time", "opentime", "date", "datetime", "executiontime"],
    platformExecutionId: ["ticket", "dealid", "deal", "executionid", "id"],
    platformOrderId: ["order", "orderid"],
    platformDealId: ["deal", "dealid"],
    transactionType: ["type", "operation"],
    amount: ["amount", "profit", "value"],
    occurredAt: ["time", "date", "datetime"],
    platformTransactionId: ["ticket", "transactionid", "id"],
  };

  const normalizedHeaders = headers.map((h) => ({ raw: h, normalized: normalize(h) }));
  for (const [field, candidates] of Object.entries(guesses)) {
    const match = normalizedHeaders.find((h) => candidates.some((c) => h.normalized === normalize(c)));
    if (match) mapping[field] = match.raw;
  }
  return mapping;
}
