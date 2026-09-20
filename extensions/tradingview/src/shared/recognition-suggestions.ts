/**
 * Traditorium TradingView Extension — Step 9, Part 2. Translates the
 * server's `RecognitionFieldResult[]` into an extension-facing suggestion
 * model — a pure mapping, no business logic. Every field is `null` unless
 * the recognition system genuinely reported it (§2: "do not fabricate
 * missing values") — a target slot with no matching `TARGET` field is
 * simply absent from `targets`, never a fabricated empty/zero entry.
 */
import type { RecognitionFieldResult, ScreenshotRecognitionOutcome } from "./recognition-api";
import type { TradeDirection } from "./strategy";

export interface SuggestedTarget {
  order: number;
  price: string;
}

export interface PlanSuggestion {
  symbol: string | null;
  timeframe: string | null;
  direction: TradeDirection | null;
  entry: string | null;
  stopLoss: string | null;
  targets: SuggestedTarget[];
  /** True when there's genuinely nothing usable (every field came back
   *  null/absent) — lets the UI show "Nothing was detected" distinctly
   *  from "detected some fields." */
  isEmpty: boolean;
}

function findValue(fields: RecognitionFieldResult[], type: RecognitionFieldResult["fieldType"]): string | null {
  return fields.find((f) => f.fieldType === type)?.detectedValue ?? null;
}

function isTradeDirection(value: string | null): value is TradeDirection {
  return value === "LONG" || value === "SHORT";
}

/** Never throws — a RECOGNITION_FAILED outcome (or a genuinely empty
 *  success) both produce an all-null, `isEmpty: true` suggestion. Callers
 *  decide separately whether to show the failure's own `error` message. */
export function toPlanSuggestion(outcome: ScreenshotRecognitionOutcome): PlanSuggestion {
  if (outcome.status === "RECOGNITION_FAILED") {
    return { symbol: null, timeframe: null, direction: null, entry: null, stopLoss: null, targets: [], isEmpty: true };
  }

  const { fields } = outcome;
  const direction = findValue(fields, "DIRECTION");

  const targets = fields
    .filter((f) => f.fieldType === "TARGET" && f.detectedValue)
    .map((f) => ({ order: f.targetOrder ?? 1, price: f.detectedValue! }))
    .sort((a, b) => a.order - b.order);

  const suggestion: PlanSuggestion = {
    symbol: findValue(fields, "SYMBOL"),
    timeframe: findValue(fields, "TIMEFRAME"),
    direction: isTradeDirection(direction) ? direction : null,
    entry: findValue(fields, "ENTRY"),
    stopLoss: findValue(fields, "STOP_LOSS"),
    targets,
    isEmpty: false,
  };

  suggestion.isEmpty =
    suggestion.symbol == null &&
    suggestion.timeframe == null &&
    suggestion.direction == null &&
    suggestion.entry == null &&
    suggestion.stopLoss == null &&
    suggestion.targets.length === 0;

  return suggestion;
}
