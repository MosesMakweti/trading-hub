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
 * Tradovate exports. Two shapes:
 *
 *  - **Fills / Orders** — one row per fill (`Timestamp`, `B/S`, `Contract`,
 *    `Price`/`avgPrice`, `Qty`/`filledQty`). One execution per row.
 *  - **Performance** — one row per completed trade (`buyPrice`, `sellPrice`,
 *    `boughtTimestamp`, `soldTimestamp`, `pnl`, `qty`). Split into entry/exit.
 */

const ALIASES: Record<string, string[]> = {
  fillId: ["fill id", "fillid", "id"],
  orderId: ["order id", "orderid"],
  timestamp: ["timestamp", "fill time", "date", "time", "date/time"],
  side: ["b/s", "buy/sell", "side", "action"],
  contract: ["contract", "symbol", "product", "instrument"],
  price: ["price", "avgprice", "avg price", "fill price"],
  qty: ["qty", "filledqty", "filled qty", "quantity", "fillqty"],
  commission: ["commission", "fee", "fees", "total fees"],
  pnl: ["pnl", "p/l", "realized pnl", "net pnl", "profit"],
  buyPrice: ["buyprice", "buy price"],
  sellPrice: ["sellprice", "sell price"],
  boughtTimestamp: ["boughttimestamp", "bought timestamp", "buy time"],
  soldTimestamp: ["soldtimestamp", "sold timestamp", "sell time"],
};

const REQUIRED_FILLS = ["timestamp", "side", "contract", "price", "qty"];
const REQUIRED_PERF = ["contract", "buyPrice", "sellPrice", "qty"];

const NON_TRADE = /deposit|withdraw|funding|payout|transfer|adjustment/i;

export const tradovateAdapter: ImportAdapter = {
  platform: "TRADOVATE",
  label: "Tradovate",

  detect(headers): number {
    const fills = headerMatchConfidence(headers, ALIASES, REQUIRED_FILLS);
    const perf = headerMatchConfidence(headers, ALIASES, REQUIRED_PERF);
    const tellCount = headers.filter((h) => /filledqty|avgprice|boughttimestamp|soldtimestamp|_priceformat|\bb\/s\b/i.test(h)).length;
    const tell = Math.min(0.35, tellCount * 0.2);
    return Math.min(1, Math.max(fills, perf) + tell);
  },

  parse(rows, headers, opts): ParseResult {
    const r = buildHeaderResolver(headers, ALIASES);
    const executions: NormalizedExecutionRow[] = [];
    const transactions: NormalizedTransactionRow[] = [];
    const warnings: ParseWarning[] = [];
    const rejections: ParseRejection[] = [];

    const isPerf = r.hasField("buyPrice") && r.hasField("sellPrice");

    rows.forEach((row, index) => {
      try {
        const contract = r.get(row, "contract");
        if (!contract) {
          rejections.push({ rowIndex: index, message: "Missing contract/symbol.", raw: row });
          return;
        }
        const instrumentNormalized = normalizeSymbol(contract);
        const qtyRaw = r.get(row, "qty");

        if (isPerf) {
          const buyPriceRaw = r.get(row, "buyPrice");
          const sellPriceRaw = r.get(row, "sellPrice");
          const boughtRaw = r.get(row, "boughtTimestamp");
          const soldRaw = r.get(row, "soldTimestamp");
          if (!qtyRaw || !buyPriceRaw || !sellPriceRaw || !boughtRaw || !soldRaw) {
            rejections.push({ rowIndex: index, message: "Missing a required performance field.", raw: row });
            return;
          }
          const boughtAt = parseGenericDateTime(boughtRaw, opts.timezone);
          const soldAt = parseGenericDateTime(soldRaw, opts.timezone);
          const longFirst = boughtAt.getTime() <= soldAt.getTime();
          const { executions: pair } = emitRoundTrip({
            ticket: r.get(row, "fillId") ?? r.get(row, "orderId") ?? null,
            instrumentRaw: contract,
            instrumentNormalized,
            side: longFirst ? "LONG" : "SHORT",
            quantity: parseLocaleNumber(qtyRaw),
            entryPrice: parseLocaleNumber(longFirst ? buyPriceRaw : sellPriceRaw),
            entryAt: longFirst ? boughtAt : soldAt,
            exitPrice: parseLocaleNumber(longFirst ? sellPriceRaw : buyPriceRaw),
            exitAt: longFirst ? soldAt : boughtAt,
            grossPnl: r.get(row, "pnl") ?? null,
            commission: r.get(row, "commission") ?? null,
            rawRow: row,
            sourceRowIndex: index,
          });
          executions.push(...pair);
          return;
        }

        const sideRaw = r.get(row, "side") ?? "";
        if (NON_TRADE.test(sideRaw)) {
          const amountRaw = r.get(row, "pnl") ?? r.get(row, "price");
          const dateRaw = r.get(row, "timestamp");
          if (!amountRaw || !dateRaw) {
            rejections.push({ rowIndex: index, message: "Non-trade row missing amount/date.", raw: row });
            return;
          }
          transactions.push({
            kind: "TRANSACTION",
            platformTransactionId: r.get(row, "fillId") ?? r.get(row, "orderId") ?? null,
            rawType: sideRaw,
            amount: parseLocaleNumber(amountRaw),
            currency: null,
            occurredAt: parseGenericDateTime(dateRaw, opts.timezone),
            rawRow: row,
            sourceRowIndex: index,
          });
          return;
        }

        const side = normalizeSide(sideRaw);
        const priceRaw = r.get(row, "price");
        const timeRaw = r.get(row, "timestamp");
        if (!side || !qtyRaw || !priceRaw || !timeRaw) {
          rejections.push({ rowIndex: index, message: "Missing side/qty/price/timestamp.", raw: row });
          return;
        }
        executions.push({
          kind: "EXECUTION",
          platformExecutionId: r.get(row, "fillId") ?? null,
          platformOrderId: r.get(row, "orderId") ?? null,
          platformDealId: null,
          instrumentRaw: contract,
          instrumentNormalized,
          direction: side,
          quantity: parseLocaleNumber(qtyRaw),
          price: parseLocaleNumber(priceRaw),
          grossPnl: r.get(row, "pnl") ? parseLocaleNumber(r.get(row, "pnl") as string) : null,
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
