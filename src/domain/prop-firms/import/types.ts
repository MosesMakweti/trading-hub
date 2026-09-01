export type ImportPlatform = "MT4" | "MT5" | "CTRADER" | "NINJATRADER" | "TRADOVATE" | "GENERIC_CSV";
export type ImportFileFormat = "CSV" | "HTML" | "XML";
export type ImportSide = "LONG" | "SHORT";

/** normalized field name -> the source file's actual header text. Only used
 *  by adapters that need caller-supplied mapping (Generic CSV); platform
 *  adapters (MT4/MT5) know their own fixed headers and ignore this. */
export type ColumnMapping = Record<string, string | undefined>;

export interface NormalizedExecutionRow {
  kind: "EXECUTION";
  platformExecutionId: string | null;
  platformOrderId: string | null;
  platformDealId: string | null;
  instrumentRaw: string;
  instrumentNormalized: string;
  direction: ImportSide;
  /** Decimal strings (dot separator) — never a JS number, to avoid float drift. */
  quantity: string;
  price: string;
  grossPnl: string | null;
  /** Signed, already normalized to "negative = cost" (MT4/MT5's own
   *  convention) — reconstruct-trades.ts sums these straight into netPnl
   *  with no further sign flip. Adapters must emit this sign, not the raw
   *  platform's (some report costs as positive magnitudes). */
  commission: string | null;
  swap: string | null;
  otherFees: string | null;
  currency: string | null;
  executedAt: Date;
  rawRow: Record<string, string>;
  sourceRowIndex: number;
}

export interface NormalizedTransactionRow {
  kind: "TRANSACTION";
  platformTransactionId: string | null;
  rawType: string;
  amount: string;
  currency: string | null;
  occurredAt: Date;
  rawRow: Record<string, string>;
  sourceRowIndex: number;
}

export interface ParseWarning {
  rowIndex: number | null;
  message: string;
}

export interface ParseRejection {
  rowIndex: number;
  message: string;
  raw: Record<string, string>;
}

export interface ParseResult {
  executions: NormalizedExecutionRow[];
  transactions: NormalizedTransactionRow[];
  warnings: ParseWarning[];
  rejections: ParseRejection[];
}

export interface ParseOptions {
  mapping?: ColumnMapping;
  timezone: string;
}

export interface AdapterDetectResult {
  platform: ImportPlatform;
  confidence: number;
  reason: string;
}

export interface ImportAdapter {
  platform: ImportPlatform;
  label: string;
  /** 0–1 confidence this file matches this platform's known export shape. */
  detect(headers: string[], sampleRows: Record<string, string>[], fileName: string): number;
  parse(rows: Record<string, string>[], headers: string[], opts: ParseOptions): ParseResult;
}

export const REQUIRED_GENERIC_EXECUTION_FIELDS = [
  "instrument",
  "direction",
  "quantity",
  "price",
  "executedAt",
] as const;

export const OPTIONAL_GENERIC_EXECUTION_FIELDS = [
  "platformExecutionId",
  "platformOrderId",
  "platformDealId",
  "grossPnl",
  "commission",
  "swap",
  "otherFees",
  "currency",
] as const;

export type GenericExecutionField =
  | (typeof REQUIRED_GENERIC_EXECUTION_FIELDS)[number]
  | (typeof OPTIONAL_GENERIC_EXECUTION_FIELDS)[number];
