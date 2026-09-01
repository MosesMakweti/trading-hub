import { ctraderAdapter } from "./adapters/ctrader";
import { genericCsvAdapter } from "./adapters/generic-csv";
import { mt4CsvAdapter } from "./adapters/mt4-csv";
import { mt5CsvAdapter } from "./adapters/mt5-csv";
import { ninjatraderAdapter } from "./adapters/ninjatrader";
import { tradovateAdapter } from "./adapters/tradovate";
import type { AdapterDetectResult, ImportAdapter } from "./types";

/** Registration order doesn't matter for detection (every adapter is scored
 *  independently) — new platforms are added here and nowhere else. The list is
 *  format-agnostic: each adapter runs against a normalized `headers` + `rows`
 *  table, whether it came from CSV, XLSX, an HTML statement, or XML. */
export const CSV_ADAPTERS: ImportAdapter[] = [
  mt4CsvAdapter,
  mt5CsvAdapter,
  ctraderAdapter,
  ninjatraderAdapter,
  tradovateAdapter,
  genericCsvAdapter,
];

const AUTO_SELECT_THRESHOLD = 0.6;

/** Scores every registered adapter and returns them best-first. The caller
 *  auto-selects the top result only when it clears AUTO_SELECT_THRESHOLD
 *  and isn't the Generic CSV catch-all — otherwise the wizard must ask the
 *  user to pick a platform manually. */
export function detectPlatform(headers: string[], sampleRows: Record<string, string>[], fileName: string): AdapterDetectResult[] {
  return CSV_ADAPTERS.map((adapter) => ({
    platform: adapter.platform,
    confidence: adapter.detect(headers, sampleRows, fileName),
    reason: adapter.label,
  })).sort((a, b) => b.confidence - a.confidence);
}

export function shouldAutoSelect(results: AdapterDetectResult[]): boolean {
  const top = results[0];
  return Boolean(top && top.confidence >= AUTO_SELECT_THRESHOLD && top.platform !== "GENERIC_CSV");
}

export function getAdapter(platform: ImportAdapter["platform"]): ImportAdapter {
  const adapter = CSV_ADAPTERS.find((a) => a.platform === platform);
  if (!adapter) throw new Error(`No import adapter registered for platform "${platform}".`);
  return adapter;
}
