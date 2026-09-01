import { normalizeSide, normalizeSymbol, parseGenericDateTime, parseLocaleNumber } from "../normalize";
import type {
  ImportAdapter,
  NormalizedExecutionRow,
  NormalizedTransactionRow,
  ParseRejection,
  ParseResult,
  ParseWarning,
} from "../types";
import { buildHeaderResolver, headerMatchConfidence } from "./header-utils";
import { emitRoundTrip } from "./roundtrip";

/**
 * cTrader "History" export. Two shapes are common:
 *
 *  - **Positions** — one row per completed position (open + close bundled, with
 *    a `Closing price` / `Closing Time`). Split into synthetic entry/exit
 *    executions like MT4.
 *  - **Deals** — one row per fill (`Deal ID`, single `Price` + `Time`). Passed
 *    straight through, one execution per row, like MT5.
 *
 * Non-trade rows (Deposit/Withdrawal/Bonus) become transactions.
 */

const ALIASES: Record<string, string[]> = {
  positionId: ["position id", "positionid", "position"],
  dealId: ["deal id", "dealid", "id"],
  orderId: ["order id", "orderid"],
  symbol: ["symbol", "instrument"],
  direction: ["direction", "side", "type", "direction (buy/sell)", "buy/sell"],
  volume: ["volume", "volume (lots)", "quantity", "amount (lots)", "closing quantity", "quantity (lots)"],
  entryPrice: ["entry price", "open price", "opening price", "price (open)"],
  closePrice: ["closing price", "close price", "price (close)"],
  price: ["price", "execution price"],
  openTime: ["opening time", "open time", "entry time"],
  closeTime: ["closing time", "close time", "exit time"],
  time: ["time", "execution time", "date/time"],
  commission: ["commission", "commissions", "total commission"],
  swap: ["swap", "swaps", "rollover"],
  netProfit: ["net usd", "net profit", "net", "pnl", "profit", "gross usd", "gross profit"],
  balance: ["balance", "balance after"],
};

const REQUIRED_POSITIONS = ["symbol", "direction", "volume", "entryPrice", "closePrice"];
const REQUIRED_DEALS = ["symbol", "direction", "volume", "price", "time"];

const NON_TRADE = /deposit|withdraw|bonus|credit|transfer|balance adjustment|commission rebate/i;

export const ctraderAdapter: ImportAdapter = {
  platform: "CTRADER",
  label: "cTrader",

  detect(headers): number {
    const positions = headerMatchConfidence(headers, ALIASES, REQUIRED_POSITIONS);
    const deals = headerMatchConfidence(headers, ALIASES, REQUIRED_DEALS);
    const hasCtraderTell = headers.some((h) => /position id|deal id|net usd|gross usd/i.test(h)) ? 0.15 : 0;
    return Math.min(1, Math.max(positions, deals) + hasCtraderTell);
  },

  parse(rows, headers, opts): ParseResult {
    const r = buildHeaderResolver(headers, ALIASES);
    const executions: NormalizedExecutionRow[] = [];
    const transactions: NormalizedTransactionRow[] = [];
    const warnings: ParseWarning[] = [];
    const rejections: ParseRejection[] = [];

    const isPositions = r.hasField("closePrice") && (r.hasField("closeTime") || r.hasField("time"));

    rows.forEach((row, index) => {
      try {
        const dirRaw = r.get(row, "direction") ?? "";
        const symbol = r.get(row, "symbol");

        if (dirRaw && NON_TRADE.test(dirRaw)) {
          const amountRaw = r.get(row, "netProfit") ?? r.get(row, "balance");
          const dateRaw = r.get(row, "time") ?? r.get(row, "closeTime") ?? r.get(row, "openTime");
          if (!amountRaw || !dateRaw) {
            rejections.push({ rowIndex: index, message: "Non-trade row missing amount/date.", raw: row });
            return;
          }
          transactions.push({
            kind: "TRANSACTION",
            platformTransactionId: r.get(row, "dealId") ?? r.get(row, "positionId") ?? null,
            rawType: dirRaw,
            amount: parseLocaleNumber(amountRaw),
            currency: null,
            occurredAt: parseGenericDateTime(dateRaw, opts.timezone),
            rawRow: row,
            sourceRowIndex: index,
          });
          return;
        }

        const side = normalizeSide(dirRaw);
        const volumeRaw = r.get(row, "volume");
        if (!symbol || !side || !volumeRaw) {
          rejections.push({ rowIndex: index, message: "Missing symbol/direction/volume.", raw: row });
          return;
        }
        const quantity = parseLocaleNumber(volumeRaw);
        const instrumentNormalized = normalizeSymbol(symbol);

        if (isPositions) {
          const entryPriceRaw = r.get(row, "entryPrice") ?? r.get(row, "price");
          const closePriceRaw = r.get(row, "closePrice");
          const openTimeRaw = r.get(row, "openTime") ?? r.get(row, "time");
          const closeTimeRaw = r.get(row, "closeTime") ?? r.get(row, "time");
          if (!entryPriceRaw || !openTimeRaw) {
            rejections.push({ rowIndex: index, message: "Missing entry price/time.", raw: row });
            return;
          }
          const { executions: pair, openOnly } = emitRoundTrip({
            ticket: r.get(row, "positionId") ?? r.get(row, "dealId") ?? null,
            orderId: r.get(row, "orderId") ?? null,
            instrumentRaw: symbol,
            instrumentNormalized,
            side,
            quantity,
            entryPrice: parseLocaleNumber(entryPriceRaw),
            entryAt: parseGenericDateTime(openTimeRaw, opts.timezone),
            exitPrice: closePriceRaw ? parseLocaleNumber(closePriceRaw) : null,
            exitAt: closePriceRaw && closeTimeRaw ? parseGenericDateTime(closeTimeRaw, opts.timezone) : null,
            grossPnl: r.get(row, "netProfit") ?? null,
            commission: r.get(row, "commission") ?? null,
            swap: r.get(row, "swap") ?? null,
            currency: null,
            rawRow: row,
            sourceRowIndex: index,
          });
          executions.push(...pair);
          if (openOnly) warnings.push({ rowIndex: index, message: `Position ${r.get(row, "positionId") ?? "?"} has no close — treated as open.` });
          return;
        }

        // Deals shape — one fill per row.
        const priceRaw = r.get(row, "price") ?? r.get(row, "entryPrice");
        const timeRaw = r.get(row, "time") ?? r.get(row, "closeTime") ?? r.get(row, "openTime");
        if (!priceRaw || !timeRaw) {
          rejections.push({ rowIndex: index, message: "Missing price/time.", raw: row });
          return;
        }
        executions.push({
          kind: "EXECUTION",
          platformExecutionId: r.get(row, "dealId") ?? null,
          platformOrderId: r.get(row, "orderId") ?? null,
          platformDealId: r.get(row, "dealId") ?? null,
          instrumentRaw: symbol,
          instrumentNormalized,
          direction: side,
          quantity,
          price: parseLocaleNumber(priceRaw),
          grossPnl: r.get(row, "netProfit") ? parseLocaleNumber(r.get(row, "netProfit") as string) : null,
          commission: r.get(row, "commission") ? parseLocaleNumber(r.get(row, "commission") as string) : null,
          swap: r.get(row, "swap") ? parseLocaleNumber(r.get(row, "swap") as string) : null,
          otherFees: null,
          currency: null,
          executedAt: parseGenericDateTime(timeRaw, opts.timezone),
          rawRow: row,
          sourceRowIndex: index,
        });
      } catch (error) {
        rejections.push({ rowIndex: index, message: error instanceof Error ? error.message : "Failed to parse row.", raw: row });
      }
    });

    return { executions, transactions, warnings, rejections };
  },
};
