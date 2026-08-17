export interface TradeExportAllocation {
  accountName: string;
  riskInputType: "PERCENT" | "AMOUNT";
  riskValue: number;
  // Independent per-account PnL (spec: real accounts never derive PnL from
  // the Performance Account) — manually entered/imported for that account.
  closingPnlGross: number;
  closingPnlNet: number;
}

/**
 * The portable trade record used by both JSON export and import. References
 * are by human-readable name (asset symbol, account name, session name),
 * not internal IDs, so a round-tripped export can re-import cleanly even
 * though IDs are regenerated on create.
 */
export interface TradeExportRecord {
  dateKey: string;
  assetSymbol: string;
  executionMinutes: number;
  direction: "LONG" | "SHORT";
  higherTimeframeBias: "BULLISH" | "BEARISH";
  biasConfidencePercent: number;
  expectedRR: number | null;
  actualRR: number | null;
  // Read-only, informational — the Performance Account's system-calculated
  // PnL at export time (realized R × locked risk amount). Never written on
  // import: the Performance Account has no manual PnL input anymore, so a
  // re-imported trade's Performance PnL is 0 until real actual-execution
  // data (entry/stop/exit) is entered for it in the workspace.
  performanceClosingPnlGross: number;
  performanceClosingPnlNet: number;
  hitTP1: boolean;
  hitTP2: boolean;
  hitTP3: boolean;
  hitFullTP: boolean;
  psychPreTradeMindset: string | null;
  psychPostTradeReflection: string | null;
  psychLessonsLearned: string | null;
  psychWhatToWorkOn: string | null;
  psychologyAnswers: Record<string, string | number>;
  sessionName: string | null;
  allocations: TradeExportAllocation[];
  confluenceLabels: string[];
  executionLabels: string[];
  entryModelNames: string[];
}

export interface TradeExportRow {
  Date: string;
  Time: string;
  Asset: string;
  Direction: string;
  "Expected RR": string;
  "Actual RR": string;
  "Performance PnL (Net)": number;
  "Psychology Grade": string;
  "TP1 Hit": string;
  "TP2 Hit": string;
  "TP3 Hit": string;
  "Full TP Hit": string;
}

function minutesToTimeString(minutes: number): string {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** Flattens a portable trade record into a single human-readable row for CSV/Excel export. */
export function toExportRow(
  record: TradeExportRecord,
  psychologyGrade: string | null,
): TradeExportRow {
  return {
    Date: record.dateKey,
    Time: minutesToTimeString(record.executionMinutes),
    Asset: record.assetSymbol,
    Direction: record.direction === "LONG" ? "Long" : "Short",
    "Expected RR": record.expectedRR == null ? "" : String(record.expectedRR),
    "Actual RR": record.actualRR == null ? "" : String(record.actualRR),
    "Performance PnL (Net)": record.performanceClosingPnlNet,
    "Psychology Grade": psychologyGrade ?? "",
    "TP1 Hit": record.hitTP1 ? "Yes" : "No",
    "TP2 Hit": record.hitTP2 ? "Yes" : "No",
    "TP3 Hit": record.hitTP3 ? "Yes" : "No",
    "Full TP Hit": record.hitFullTP ? "Yes" : "No",
  };
}

/** The stable natural key used to detect an already-imported trade and skip re-creating it. */
export function tradeNaturalKey(record: {
  dateKey: string;
  assetSymbol: string;
  executionMinutes: number;
}): string {
  return `${record.dateKey}|${record.assetSymbol}|${record.executionMinutes}`;
}
