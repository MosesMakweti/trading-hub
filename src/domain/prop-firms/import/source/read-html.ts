import { parse, type HTMLElement } from "node-html-parser";

import { decodeText } from "./decode-bytes";
import { rowsToRecords, scanForHeader } from "./header-detect";
import { SOURCE_ERROR, SourceReadError, type SourceTable } from "./types";

/** MT4/MT5 statements are one giant `<table>` whose sections are announced by a
 *  single-cell row. We start a fresh segment at each of these. `results` /
 *  `summary` end the trade rows so the summary-statistics block doesn't get
 *  appended to the Deals table. */
const SECTION_LABELS = [
  "closed transactions",
  "open trades",
  "working orders",
  "deals",
  "positions",
  "orders",
  "closed positions",
  "closed p/l",
  "account history",
  "trade history",
  "cash operations",
  "balance",
  "results",
  "summary",
  "total",
];

/** A colspan/rowspan value from an MT-style layout table, clamped so a
 *  `colspan="9999"` can't blow up a row. */
function clampSpan(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 64);
}

/**
 * HTML statement reader. Uses a pure string-to-DOM parser (`node-html-parser`)
 * — it never executes scripts, never renders, never fetches external resources.
 * We strip `<script>/<style>/<link>/<img>/<iframe>/<object>` up front for
 * belt-and-braces, then read `<table>` elements only. MT4/MT5 reports (one big
 * table with section-label rows) are split into per-section tables; ordinary
 * pages with several independent `<table>`s yield one table each.
 */
export function readHtml(bytes: Uint8Array): SourceTable[] {
  const html = decodeText(bytes);
  if (html.trim() === "") throw new SourceReadError(SOURCE_ERROR.MALFORMED);

  let root: HTMLElement;
  try {
    root = parse(html, {
      comment: false,
      blockTextElements: { script: false, style: false, pre: true, code: true },
    });
  } catch {
    throw new SourceReadError(SOURCE_ERROR.MALFORMED);
  }

  for (const el of root.querySelectorAll("script, style, link, img, iframe, object, embed, noscript")) {
    el.remove();
  }

  const tableEls = root.querySelectorAll("table");
  if (tableEls.length === 0) throw new SourceReadError(SOURCE_ERROR.NO_TRADING_TABLE);

  const tables: SourceTable[] = [];
  tableEls.forEach((tableEl, tIdx) => {
    const grid = tableToGrid(tableEl);
    if (grid.length === 0) return;

    const segments = splitIntoSections(grid);
    segments.forEach((seg, sIdx) => {
      const scan = scanForHeader(seg.rows);
      if (!scan || scan.bodyRows.length === 0) return;
      // Drop an unlabelled fragment that's just the account-metadata block
      // (2 columns, a handful of rows) — a real trade table is wider.
      if (!seg.label && scan.headers.length < 3) return;
      tables.push({
        id: `h${tables.length}`,
        name: seg.label ?? (tableEls.length > 1 ? `Table ${tIdx + 1}` : sIdx > 0 ? `Table ${tIdx + 1}.${sIdx + 1}` : "Statement table"),
        headers: scan.headers,
        rows: rowsToRecords(scan.headers, scan.bodyRows),
        meta: { sheetName: seg.label ?? undefined, headerRowIndex: scan.headerRowIndex + 1 },
      });
    });
  });

  if (tables.length === 0) throw new SourceReadError(SOURCE_ERROR.NO_TRADING_TABLE);
  return tables;
}

function normText(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Flattens a `<table>` to a grid, **expanding `colspan`** so a MetaTrader layout
 * table — where a data row may carry `<td colspan="8">` fillers and the
 * column-header row uses `colspan="2"` on Profit/State — keeps its columns
 * aligned with the header. Hidden cells (`class="hidden"`, MT5's "Cost" column)
 * are kept, not dropped, precisely because they hold a column position.
 */
function tableToGrid(tableEl: HTMLElement): string[][] {
  const rows: string[][] = [];
  for (const tr of tableEl.querySelectorAll("tr")) {
    // Only direct-ish cells — nested tables inside a cell would double-count,
    // so skip a <tr> that belongs to a nested table (its closest table isn't ours).
    if (tr.closest("table") !== tableEl) continue;
    const cells: string[] = [];
    for (const c of tr.querySelectorAll("td, th")) {
      const text = normText(c.text);
      const span = clampSpan(c.getAttribute("colspan"));
      for (let i = 0; i < span; i += 1) cells.push(i === 0 ? text : "");
      if (cells.length > 512) break; // pathological row guard
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

interface Section {
  label: string | null;
  rows: string[][];
}

/** Split a grid at single-cell rows whose text matches a known statement
 *  section heading. Everything before the first heading is its own segment. */
function splitIntoSections(grid: string[][]): Section[] {
  const sections: Section[] = [];
  let current: Section = { label: null, rows: [] };

  for (const row of grid) {
    const nonEmpty = row.filter((c) => c !== "");
    const single = nonEmpty.length === 1 ? nonEmpty[0].toLowerCase().replace(/:$/, "").trim() : null;
    const isHeading = single != null && SECTION_LABELS.some((s) => single === s || single.startsWith(s));
    if (isHeading) {
      if (current.rows.length > 0) sections.push(current);
      current = { label: capitalize(single as string), rows: [] };
      continue;
    }
    current.rows.push(row);
  }
  if (current.rows.length > 0) sections.push(current);
  return sections.length > 0 ? sections : [{ label: null, rows: grid }];
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
