import Papa from "papaparse";

import { decodeText } from "./decode-bytes";
import { rowsToRecords, scanForHeader } from "./header-detect";
import { SOURCE_ERROR, SourceReadError, type ImportFileFormat, type SourceTable } from "./types";

/**
 * CSV / TSV / delimited-TXT reader. Parses to raw rows with the sniffed
 * delimiter, then runs the shared header scan so a broker export with a
 * decorative preamble ("Account: 12345", blank line, then the real header)
 * still lands on the right row. Produces exactly one `SourceTable`.
 */
export function readDelimited(
  bytes: Uint8Array,
  opts: { format: ImportFileFormat; delimiter?: string },
): SourceTable {
  const text = decodeText(bytes);
  if (text.trim() === "") throw new SourceReadError(SOURCE_ERROR.MALFORMED);

  const parsed = Papa.parse<string[]>(text, {
    delimiter: opts.delimiter ?? "",
    newline: "\n",
    skipEmptyLines: "greedy",
    // No `header` — we do our own header-row detection.
  });

  const grid = (parsed.data as string[][]).map((row) => row.map((c) => (c ?? "").toString()));
  if (grid.length === 0) throw new SourceReadError(SOURCE_ERROR.MALFORMED);

  const scan = scanForHeader(grid);
  if (!scan) throw new SourceReadError(SOURCE_ERROR.NO_TRADING_TABLE);

  return {
    id: "t0",
    name: opts.format === "TSV" ? "Delimited file" : "CSV file",
    headers: scan.headers,
    rows: rowsToRecords(scan.headers, scan.bodyRows),
    meta: { headerRowIndex: scan.headerRowIndex + 1 },
  };
}
