import { parseLocaleNumber } from "../normalize";
import type { ImportSide, NormalizedExecutionRow } from "../types";

/**
 * Turns a broker "one row = one completed trade" record (open + close bundled)
 * into the synthetic entry + exit executions the shared reconstruction engine
 * expects — the same shape `mt4CsvAdapter` builds inline. Both carry the same
 * ticket id, suffixed `:open` / `:close` so they dedupe independently.
 */
export function emitRoundTrip(input: {
  ticket: string | null;
  orderId?: string | null;
  instrumentRaw: string;
  instrumentNormalized: string;
  side: ImportSide;
  quantity: string;
  entryPrice: string;
  entryAt: Date;
  exitPrice?: string | null;
  exitAt?: Date | null;
  grossPnl?: string | null;
  commission?: string | null;
  swap?: string | null;
  otherFees?: string | null;
  currency?: string | null;
  rawRow: Record<string, string>;
  sourceRowIndex: number;
}): { executions: NormalizedExecutionRow[]; openOnly: boolean } {
  const { ticket } = input;
  const entry: NormalizedExecutionRow = {
    kind: "EXECUTION",
    platformExecutionId: ticket ? `${ticket}:open` : null,
    platformOrderId: input.orderId ?? ticket ?? null,
    platformDealId: null,
    instrumentRaw: input.instrumentRaw,
    instrumentNormalized: input.instrumentNormalized,
    direction: input.side,
    quantity: input.quantity,
    price: input.entryPrice,
    grossPnl: null,
    commission: null,
    swap: null,
    otherFees: null,
    currency: input.currency ?? null,
    executedAt: input.entryAt,
    rawRow: input.rawRow,
    sourceRowIndex: input.sourceRowIndex,
  };

  const hasExit = input.exitPrice != null && input.exitPrice !== "" && input.exitAt != null;
  if (!hasExit) return { executions: [entry], openOnly: true };

  const exit: NormalizedExecutionRow = {
    kind: "EXECUTION",
    platformExecutionId: ticket ? `${ticket}:close` : null,
    platformOrderId: input.orderId ?? ticket ?? null,
    platformDealId: null,
    instrumentRaw: input.instrumentRaw,
    instrumentNormalized: input.instrumentNormalized,
    direction: input.side === "LONG" ? "SHORT" : "LONG",
    quantity: input.quantity,
    price: input.exitPrice as string,
    grossPnl: input.grossPnl != null && input.grossPnl !== "" ? parseLocaleNumber(input.grossPnl) : "0",
    commission: input.commission != null && input.commission !== "" ? parseLocaleNumber(input.commission) : null,
    swap: input.swap != null && input.swap !== "" ? parseLocaleNumber(input.swap) : null,
    otherFees: input.otherFees != null && input.otherFees !== "" ? parseLocaleNumber(input.otherFees) : null,
    currency: input.currency ?? null,
    executedAt: input.exitAt as Date,
    rawRow: input.rawRow,
    sourceRowIndex: input.sourceRowIndex,
  };

  return { executions: [entry, exit], openOnly: false };
}
