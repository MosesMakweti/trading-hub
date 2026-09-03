import { normalizeSide, normalizeSymbol, parseLocaleNumber, parseMtDateTime } from "../normalize";
import type { ImportAdapter, NormalizedExecutionRow, NormalizedTransactionRow, ParseRejection, ParseResult, ParseWarning } from "../types";
import { buildHeaderResolver, headerMatchConfidence } from "./header-utils";

const NON_TRADE_TYPES = new Set(["balance", "credit", "deposit", "withdrawal"]);

const ALIASES: Record<string, string[]> = {
  time: ["time"],
  deal: ["deal"],
  symbol: ["symbol"],
  type: ["type"],
  volume: ["volume"],
  price: ["price"],
  order: ["order"],
  commission: ["commission"],
  fee: ["fee"],
  swap: ["swap"],
  profit: ["profit"],
};

const REQUIRED = ["time", "symbol", "type", "volume", "price"];

/**
 * MT5's "Deals" history export — one row per fill (unlike MT4's paired
 * round-trip rows), which already matches this pipeline's shared
 * reconstruction engine directly: no splitting needed. Entry vs. exit is
 * inferred by `reconstructTrades` from the running per-instrument position,
 * not from MT5's own (often-omitted, and in practice redundant) Direction
 * column. Non-trade deal types (balance/credit/deposit/withdrawal) become
 * transactions instead of executions.
 */
export const mt5CsvAdapter: ImportAdapter = {
  platform: "MT5",
  label: "MetaTrader 5",

  detect(headers): number {
    return headerMatchConfidence(headers, ALIASES, REQUIRED);
  },

  parse(rows, headers, opts): ParseResult {
    const resolver = buildHeaderResolver(headers, ALIASES);
    const executions: NormalizedExecutionRow[] = [];
    const transactions: NormalizedTransactionRow[] = [];
    const warnings: ParseWarning[] = [];
    const rejections: ParseRejection[] = [];

    rows.forEach((row, index) => {
      try {
        const type = resolver.get(row, "type");
        const timeRaw = resolver.get(row, "time");
        const dealId = resolver.get(row, "deal");

        if (!type || !timeRaw) {
          rejections.push({ rowIndex: index, message: "Missing type or time.", raw: row });
          return;
        }

        if (NON_TRADE_TYPES.has(type.toLowerCase())) {
          const profitRaw = resolver.get(row, "profit");
          if (!profitRaw) {
            rejections.push({ rowIndex: index, message: "Non-trade deal missing a profit/amount value.", raw: row });
            return;
          }
          transactions.push({
            kind: "TRANSACTION",
            platformTransactionId: dealId ?? null,
            rawType: type,
            amount: parseLocaleNumber(profitRaw),
            currency: null,
            occurredAt: parseMtDateTime(timeRaw, opts.timezone),
            rawRow: row,
            sourceRowIndex: index,
          });
          return;
        }

        const side = normalizeSide(type);
        const symbol = resolver.get(row, "symbol");
        const volumeRaw = resolver.get(row, "volume");
        const priceRaw = resolver.get(row, "price");

        if (!side || !symbol || !volumeRaw || !priceRaw) {
          rejections.push({ rowIndex: index, message: "Missing a required trade field.", raw: row });
          return;
        }

        const commissionRaw = resolver.get(row, "commission");
        const feeRaw = resolver.get(row, "fee");
        const swapRaw = resolver.get(row, "swap");
        const profitRaw = resolver.get(row, "profit");

        executions.push({
          kind: "EXECUTION",
          platformExecutionId: dealId ?? null,
          platformOrderId: resolver.get(row, "order") ?? null,
          platformDealId: dealId ?? null,
          instrumentRaw: symbol,
          instrumentNormalized: normalizeSymbol(symbol),
          direction: side,
          quantity: parseLocaleNumber(volumeRaw),
          price: parseLocaleNumber(priceRaw),
          grossPnl: profitRaw ? parseLocaleNumber(profitRaw) : null,
          commission: commissionRaw ? parseLocaleNumber(commissionRaw) : null,
          swap: swapRaw ? parseLocaleNumber(swapRaw) : null,
          otherFees: feeRaw ? parseLocaleNumber(feeRaw) : null,
          currency: null,
          executedAt: parseMtDateTime(timeRaw, opts.timezone),
          rawRow: row,
          sourceRowIndex: index,
        });
      } catch (error) {
        rejections.push({ rowIndex: index, message: error instanceof Error ? error.message : "Failed to parse row.", raw: row });
      }
    });

    if (warnings.length === 0 && executions.length === 0 && transactions.length === 0 && rejections.length === 0) {
      warnings.push({ rowIndex: null, message: "No rows were parsed." });
    }

    return { executions, transactions, warnings, rejections };
  },
};
