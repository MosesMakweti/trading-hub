import { normalizeSide, normalizeSymbol, parseLocaleNumber, parseMtDateTime } from "../normalize";
import type { ImportAdapter, NormalizedExecutionRow, NormalizedTransactionRow, ParseRejection, ParseResult, ParseWarning } from "../types";
import { buildHeaderResolver, headerMatchConfidence } from "./header-utils";

const NON_TRADE_TYPES = new Set(["balance", "credit", "deposit", "withdrawal"]);

const ALIASES: Record<string, string[]> = {
  ticket: ["ticket", "order"],
  openTime: ["open time", "opening time"],
  type: ["type"],
  size: ["size", "volume", "lots"],
  item: ["item", "symbol"],
  openPrice: ["open price", "price"],
  closeTime: ["close time", "closing time"],
  // MT4's HTML statement repeats the literal header "Price" for the close
  // column; the source reader disambiguates it to "Price (2)" (see
  // dedupeHeaders), so accept that here too.
  closePrice: ["close price", "price (2)", "price.1"],
  commission: ["commission"],
  swap: ["swap"],
  profit: ["profit", "net profit"],
};

const REQUIRED = ["openTime", "type", "size", "item", "openPrice"];

/**
 * MT4's classic "Account History" report, exported to CSV: each trade row
 * already bundles the whole round trip (open + close in one row) rather
 * than separate fill rows. Split into a synthetic entry execution and — when
 * Close Time/Price are present — a synthetic exit execution, both carrying
 * the same platform ticket id (suffixed so they dedupe independently), so
 * the shared reconstruction engine can treat MT4 the same as any
 * fill-per-row platform. Non-trade rows (balance/credit/deposit/withdrawal)
 * become transactions instead.
 *
 * Known limitation: some raw MT4 exports repeat the literal header "Price"
 * for both the open and close columns; that ambiguous shape isn't reliably
 * distinguishable via header name and should go through Generic CSV's
 * manual column mapping (or, later, the HTML statement parser, which reads
 * table cells by position instead of by header).
 */
export const mt4CsvAdapter: ImportAdapter = {
  platform: "MT4",
  label: "MetaTrader 4",

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
        const ticket = resolver.get(row, "ticket");
        const openTimeRaw = resolver.get(row, "openTime");

        if (!type || !openTimeRaw) {
          rejections.push({ rowIndex: index, message: "Missing type or open time.", raw: row });
          return;
        }

        if (NON_TRADE_TYPES.has(type.toLowerCase())) {
          const profitRaw = resolver.get(row, "profit");
          if (!profitRaw) {
            rejections.push({ rowIndex: index, message: "Non-trade row missing a profit/amount value.", raw: row });
            return;
          }
          transactions.push({
            kind: "TRANSACTION",
            platformTransactionId: ticket ?? null,
            rawType: type,
            amount: parseLocaleNumber(profitRaw),
            currency: null,
            occurredAt: parseMtDateTime(openTimeRaw, opts.timezone),
            rawRow: row,
            sourceRowIndex: index,
          });
          return;
        }

        const side = normalizeSide(type);
        const item = resolver.get(row, "item");
        const sizeRaw = resolver.get(row, "size");
        const openPriceRaw = resolver.get(row, "openPrice");

        if (!side || !item || !sizeRaw || !openPriceRaw) {
          rejections.push({ rowIndex: index, message: "Missing a required trade field.", raw: row });
          return;
        }

        const commission = resolver.get(row, "commission");
        const swap = resolver.get(row, "swap");
        const profit = resolver.get(row, "profit");
        const instrumentNormalized = normalizeSymbol(item);
        const quantity = parseLocaleNumber(sizeRaw);

        executions.push({
          kind: "EXECUTION",
          platformExecutionId: ticket ? `${ticket}:open` : null,
          platformOrderId: ticket ?? null,
          platformDealId: null,
          instrumentRaw: item,
          instrumentNormalized,
          direction: side,
          quantity,
          price: parseLocaleNumber(openPriceRaw),
          grossPnl: null,
          commission: null,
          swap: null,
          otherFees: null,
          currency: null,
          executedAt: parseMtDateTime(openTimeRaw, opts.timezone),
          rawRow: row,
          sourceRowIndex: index,
        });

        const closeTimeRaw = resolver.get(row, "closeTime");
        const closePriceRaw = resolver.get(row, "closePrice");
        if (closeTimeRaw && closePriceRaw) {
          executions.push({
            kind: "EXECUTION",
            platformExecutionId: ticket ? `${ticket}:close` : null,
            platformOrderId: ticket ?? null,
            platformDealId: null,
            instrumentRaw: item,
            instrumentNormalized,
            direction: side === "LONG" ? "SHORT" : "LONG",
            quantity,
            price: parseLocaleNumber(closePriceRaw),
            grossPnl: profit ? parseLocaleNumber(profit) : "0",
            commission: commission ? parseLocaleNumber(commission) : null,
            swap: swap ? parseLocaleNumber(swap) : null,
            otherFees: null,
            currency: null,
            executedAt: parseMtDateTime(closeTimeRaw, opts.timezone),
            rawRow: row,
            sourceRowIndex: index,
          });
        } else {
          warnings.push({ rowIndex: index, message: `Ticket ${ticket ?? "?"} has no close time — treated as still open.` });
        }
      } catch (error) {
        rejections.push({ rowIndex: index, message: error instanceof Error ? error.message : "Failed to parse row.", raw: row });
      }
    });

    return { executions, transactions, warnings, rejections };
  },
};
