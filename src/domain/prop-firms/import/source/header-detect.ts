/**
 * Shared "find the real header row" logic for readers that get a raw grid of
 * cells (XLSX worksheets, HTML tables, broker TXT exports with a decorative
 * preamble). Delimited CSV with a clean first-line header skips this.
 */

function isBlankRow(row: string[]): boolean {
  return row.every((c) => c.trim() === "");
}

function looksNumeric(v: string): boolean {
  const s = v.trim().replace(/[\s,$%]/g, "");
  return s !== "" && /^-?\(?\d[\d.,-]*\)?$/.test(s);
}

/** Score a row on how header-like it is: many short, distinct, non-numeric
 *  labels, and a data-looking row right after it. */
function scoreHeaderRow(rows: string[][], index: number): number {
  const row = rows[index];
  const cells = row.map((c) => c.trim()).filter((c) => c !== "");
  if (cells.length < 2) return -1;

  let score = 0;
  score += cells.length; // more populated columns is better
  score += cells.filter((c) => !looksNumeric(c) && c.length <= 40).length * 2;
  score -= cells.filter((c) => looksNumeric(c)).length * 3; // numbers in a header = probably data

  const distinct = new Set(cells.map((c) => c.toLowerCase()));
  score -= (cells.length - distinct.size) * 2; // repeated labels are suspicious

  // A single wide "title" cell spanning the row is decorative, not a header.
  if (cells.length === 1) score -= 5;

  const next = rows[index + 1];
  if (next) {
    const nextFilled = next.filter((c) => c.trim() !== "").length;
    if (nextFilled >= Math.max(2, cells.length - 1)) score += 4;
    if (next.some((c) => looksNumeric(c))) score += 2; // data below
  } else {
    score -= 3; // nothing beneath it
  }

  return score;
}

export interface HeaderScan {
  headerRowIndex: number;
  headers: string[];
  /** Data rows (raw cell arrays) after the header. */
  bodyRows: string[][];
}

/**
 * Scans the first `lookahead` non-blank rows for the best header, then returns
 * everything after it as body rows. Returns `null` when nothing resembles a
 * header (caller decides whether that's an error).
 */
export function scanForHeader(rows: string[][], lookahead = 20): HeaderScan | null {
  const nonBlank = rows.map((r, i) => ({ r, i })).filter(({ r }) => !isBlankRow(r));
  if (nonBlank.length === 0) return null;

  let bestIdx = -1;
  let bestScore = 0;
  for (const { i } of nonBlank.slice(0, lookahead)) {
    const s = scoreHeaderRow(rows, i);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return null;

  const headers = dedupeHeaders(rows[bestIdx].map((c) => c.trim()));
  const bodyRows = rows.slice(bestIdx + 1).filter((r) => !isBlankRow(r));
  return { headerRowIndex: bestIdx, headers, bodyRows };
}

/** "Price", "", "Price" -> "Price", "Column 2", "Price (2)" — every header
 *  non-empty and unique so row objects don't lose columns. */
export function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = h.trim() || `Column ${i + 1}`;
    const key = name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count > 0) name = `${name} (${count + 1})`;
    return name;
  });
}

export function rowsToRecords(headers: string[], bodyRows: string[][]): Record<string, string>[] {
  return bodyRows.map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (cells[i] ?? "").toString();
    });
    return rec;
  });
}
