import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

import { rowsToRecords, scanForHeader } from "./header-detect";
import { SOURCE_ERROR, SourceReadError, type SourceTable } from "./types";

/**
 * Workbook reader. `.xlsx` goes through ExcelJS; legacy binary `.xls` (and the
 * OLE2 wrapper an encrypted `.xlsx` also uses) goes through SheetJS. Both paths:
 *
 *  - read **cached values only** — a formula cell yields its stored result, and
 *    nothing is ever evaluated (`cellFormula: false`);
 *  - never load macros / VBA (`bookVBA: false`) or follow external workbook
 *    links;
 *  - flatten every worksheet to a raw grid, then split on blank rows and run the
 *    shared header scan, so decorative title rows and multiple stacked tables on
 *    one sheet are handled.
 */
export async function readXlsx(bytes: Uint8Array, isLegacyXls: boolean): Promise<SourceTable[]> {
  const sheets = isLegacyXls ? readWithSheetJs(bytes) : await readWithExcelJs(bytes);

  if (sheets.length === 0) throw new SourceReadError(SOURCE_ERROR.NO_USABLE_SHEETS);

  const tables: SourceTable[] = [];
  for (const sheet of sheets) {
    const blocks = splitOnBlankRows(sheet.grid);
    let blockNo = 0;
    for (const block of blocks) {
      const scan = scanForHeader(block);
      if (!scan || scan.bodyRows.length === 0) continue;
      blockNo += 1;
      tables.push({
        id: `s${tables.length}`,
        name: blockNo > 1 ? `${sheet.name} — table ${blockNo}` : sheet.name,
        headers: scan.headers,
        rows: rowsToRecords(scan.headers, scan.bodyRows),
        meta: { sheetName: sheet.name, headerRowIndex: scan.headerRowIndex + 1 },
      });
    }
  }

  if (tables.length === 0) throw new SourceReadError(SOURCE_ERROR.NO_USABLE_SHEETS);
  return tables;
}

interface RawSheet {
  name: string;
  grid: string[][];
}

async function readWithExcelJs(bytes: Uint8Array): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook();
  try {
    // `.load` accepts an ArrayBuffer/Buffer. Copy into a fresh ArrayBuffer so a
    // Uint8Array view with a byteOffset doesn't confuse the zip reader.
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await wb.xlsx.load(ab as ArrayBuffer);
  } catch (err) {
    throw classifyWorkbookError(err);
  }

  const sheets: RawSheet[] = [];
  wb.eachSheet((ws) => {
    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[]; // 1-indexed; [0] is undefined
      const cells: string[] = [];
      for (let c = 1; c < values.length; c += 1) {
        cells.push(excelCellToString(values[c]));
      }
      grid.push(cells);
    });
    if (grid.length > 0) sheets.push({ name: ws.name, grid });
  });
  return sheets;
}

function readWithSheetJs(bytes: Uint8Array): RawSheet[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellFormula: false, // never parse formulas
      cellNF: false,
      cellText: true, // keep the cached formatted text (`.w`)
      bookVBA: false, // never load macros
      dense: false,
    });
  } catch (err) {
    throw classifyWorkbookError(err);
  }

  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false, // formatted strings, from cached values
      defval: "",
      blankrows: true,
    });
    const grid = aoa.map((row) => (Array.isArray(row) ? row.map((c) => sheetJsCellToString(c)) : []));
    return { name, grid };
  }).filter((s) => s.grid.length > 0);
}

function classifyWorkbookError(err: unknown): SourceReadError {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("password") || msg.includes("encrypt")) {
    return new SourceReadError(SOURCE_ERROR.PASSWORD_PROTECTED);
  }
  return new SourceReadError(SOURCE_ERROR.MALFORMED);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A Date with no timezone context (Excel serial dates carry none) — emit
 *  wall-clock components so the pipeline can apply the user-picked timezone,
 *  exactly as it does for a text timestamp. */
function dateToWallClock(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}:${pad(d.getUTCSeconds())}`;
}

function excelCellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return dateToWallClock(value);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("result" in v) return excelCellToString(v.result); // formula → cached result only
    if ("text" in v && typeof v.text === "string") return v.text; // hyperlink cell
    if ("richText" in v && Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    }
    if ("error" in v) return "";
    if ("hyperlink" in v && typeof v.hyperlink === "string") return v.hyperlink;
    return "";
  }
  return String(value).trim();
}

function sheetJsCellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return dateToWallClock(value);
  return String(value).trim();
}

function isBlank(row: string[]): boolean {
  return row.every((c) => c.trim() === "");
}

/** Split a sheet grid into contiguous non-blank blocks (a run of blank rows is
 *  the separator). Lets one sheet hold several stacked tables. */
function splitOnBlankRows(grid: string[][]): string[][][] {
  const blocks: string[][][] = [];
  let current: string[][] = [];
  for (const row of grid) {
    if (isBlank(row)) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
    } else {
      current.push(row);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks.length > 0 ? blocks : [grid];
}
