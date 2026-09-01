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
 * NinjaTrader grid exports. Two shapes:
 *
 *  - **Trades** (Trade Performance report) — one row per completed trade with
 *    `Entry price` / `Exit price` / `Entry time` / `Exit time` and a `Profit`.
 *    Split into synthetic entry/exit executions.
 *  - **Executions** — one row per fill (`Action` = Buy/Sell, single `Price` +
 *    `Time`). One execution per row.
 */

const ALIASES: Record<string, string[]> = {
  tradeNumber: ["trade number", "trade #", "trade id"],
  instrument: ["instrument", "symbol"],
  marketPos: ["market pos.", "market position", "market pos", "position"],
  action: ["action", "buy/sell", "side"],
  qty: ["qty", "quantity"],
  entryPrice: ["entry price", "avg. entry price", "entry"],
  exitPrice: ["exit price", "avg. exit price", "exit"],
  price: ["price", "fill price"],
  entryTime: ["entry time", "entered"],
  exitTime: ["exit time", "exited"],
  time: ["time", "date/time", "timestamp"],
  profit: ["profit", "net profit", "realized pnl", "pnl"],
  commission: ["commission", "comm.", "commission ($)"],
  account: ["account"],
};

const REQUIRED_TRADES = ["instrument", "marketPos", "qty", "entryPrice", "exitPrice"];
const REQUIRED_EXECUTIONS = ["instrument", "action", "qty", "price", "time"];

export const ninjatraderAdapter: ImportAdapter = {
  platform: "NINJATRADER",
  label: "NinjaTrader",

  detect(headers): number {
    const trades = headerMatchConfidence(headers, ALIASES, REQUIRED_TRADES);
    const execs = headerMatchConfidence(headers, ALIASES, REQUIRED_EXECUTIONS);
    const tell = headers.some((h) => /market pos\.?|trade number|cum\. net profit/i.test(h)) ? 0.2 : 0;
    return Math.min(1, Math.max(trades, execs) + tell);
  },

  parse(rows, headers, opts): ParseResult {
    const r = buildHeaderResolver(headers, ALIASES);
    const executions: NormalizedExecutionRow[] = [];
    const transactions: NormalizedTransactionRow[] = [];
    const warnings: ParseWarning[] = [];
    const rejections: ParseRejection[] = [];

    const isTrades = r.hasField("entryPrice") && r.hasField("exitPrice");

    rows.forEach((row, index) => {
      try {
        const instrument = r.get(row, "instrument");
        if (!instrument) {
          rejections.push({ rowIndex: index, message: "Missing instrument.", raw: row });
          return;
        }
        const instrumentNormalized = normalizeSymbol(instrument);

        if (isTrades) {
          const side = normalizeSide(r.get(row, "marketPos") ?? "");
          const qtyRaw = r.get(row, "qty");
          const entryPriceRaw = r.get(row, "entryPrice");
          const exitPriceRaw = r.get(row, "exitPrice");
          const entryTimeRaw = r.get(row, "entryTime") ?? r.get(row, "time");
          const exitTimeRaw = r.get(row, "exitTime");
          if (!side || !qtyRaw || !entryPriceRaw || !entryTimeRaw) {
            rejections.push({ rowIndex: index, message: "Missing a required trade field.", raw: row });
            return;
          }
          const { executions: pair, openOnly } = emitRoundTrip({
            ticket: r.get(row, "tradeNumber") ?? null,
            instrumentRaw: instrument,
            instrumentNormalized,
            side,
            quantity: parseLocaleNumber(qtyRaw),
            entryPrice: parseLocaleNumber(entryPriceRaw),
            entryAt: parseGenericDateTime(entryTimeRaw, opts.timezone),
            exitPrice: exitPriceRaw ? parseLocaleNumber(exitPriceRaw) : null,
            exitAt: exitPriceRaw && exitTimeRaw ? parseGenericDateTime(exitTimeRaw, opts.timezone) : null,
            grossPnl: r.get(row, "profit") ?? null,
            commission: r.get(row, "commission") ?? null,
            rawRow: row,
            sourceRowIndex: index,
          });
          executions.push(...pair);
          if (openOnly) warnings.push({ rowIndex: index, message: `Trade ${r.get(row, "tradeNumber") ?? "?"} has no exit — treated as open.` });
          return;
        }

        // Executions shape.
        const side = normalizeSide(r.get(row, "action") ?? "");
        const qtyRaw = r.get(row, "qty");
        const priceRaw = r.get(row, "price");
        const timeRaw = r.get(row, "time");
        if (!side || !qtyRaw || !priceRaw || !timeRaw) {
          rejections.push({ rowIndex: index, message: "Missing action/qty/price/time.", raw: row });
          return;
        }
        executions.push({
          kind: "EXECUTION",
          platformExecutionId: r.get(row, "tradeNumber") ?? null,
          platformOrderId: null,
          platformDealId: null,
          instrumentRaw: instrument,
          instrumentNormalized,
          direction: side,
          quantity: parseLocaleNumber(qtyRaw),
          price: parseLocaleNumber(priceRaw),
          grossPnl: r.get(row, "profit") ? parseLocaleNumber(r.get(row, "profit") as string) : null,
          commission: r.get(row, "commission") ? parseLocaleNumber(r.get(row, "commission") as string) : null,
          swap: null,
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
