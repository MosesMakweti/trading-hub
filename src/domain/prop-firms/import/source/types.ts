/**
 * The source-reader layer sits in front of every platform adapter: it turns a
 * raw uploaded file (of any supported format) into one or more `SourceTable`s —
 * a plain `headers` + `rows` shape the existing CSV pipeline already consumes.
 * Adapters never learn which format a table came from.
 */

export type ImportFileFormat = "CSV" | "TSV" | "TXT" | "XLSX" | "XLS" | "HTML" | "XML";

/** A single rectangular block of data pulled out of an upload — one CSV file,
 *  one worksheet, one HTML `<table>` (or one section of an MT4/MT5 statement),
 *  or one repeated XML element set. */
export interface SourceTable {
  /** Stable within a single document — the wizard round-trips this as `tableId`
   *  so preview/confirm re-select the exact same block the user reviewed. */
  id: string;
  /** Human label for the wizard's table picker (sheet name, table caption,
   *  statement section, or a synthetic "Table 2"). */
  name: string;
  headers: string[];
  rows: Record<string, string>[];
  meta?: {
    /** e.g. worksheet name, HTML section label — surfaced for audit. */
    sheetName?: string;
    /** 1-based index of the header row within the raw sheet/table, for audit. */
    headerRowIndex?: number;
  };
}

export interface SourceDocument {
  format: ImportFileFormat;
  /** Original browser-reported MIME type (may be empty or generic). */
  mimeType: string | null;
  tables: SourceTable[];
  warnings: string[];
}

export interface SourceReadOptions {
  fileName: string;
  mimeType: string | null;
  /** Hard ceiling on worksheets/tables scanned — a guard against pathological
   *  workbooks. Matches `MAX_IMPORT_SHEETS` in the validation module. */
  maxTables: number;
}

/**
 * Every user-facing failure the reader can raise carries one of these exact
 * messages (the prompt's required error strings). Thrown as a plain `Error`;
 * the server action surfaces `error.message` verbatim.
 */
export const SOURCE_ERROR = {
  UNSUPPORTED: "Unsupported file format.",
  PASSWORD_PROTECTED: "Password-protected workbook.",
  NO_TRADING_TABLE: "No recognizable trading table found.",
  NO_USABLE_SHEETS: "Workbook contains no usable sheets.",
  MALFORMED: "File is malformed or could not be read.",
  TOO_LARGE: "File exceeds the upload limit.",
} as const;

export class SourceReadError extends Error {
  constructor(message: (typeof SOURCE_ERROR)[keyof typeof SOURCE_ERROR] | string) {
    super(message);
    this.name = "SourceReadError";
  }
}
