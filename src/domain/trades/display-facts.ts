// Today V3 (Phase 5) — how Journal/Album surfaces present a trade's bias and
// time without showing compatibility values as trader decisions. Pure.
//
// Trade.higherTimeframeBias / biasConfidencePercent are non-null columns the
// V3 Quick Idea, the TradingView extension and the legacy V2 form all fill
// with a neutral default (50%) when the trader didn't state a confidence.
// Trade.executionMinutes is PROVISIONAL (the clock time the idea was logged)
// until the first actual entry replaces it with the real Entry Time.

import { minutesToTimeString } from "@/lib/date";

export interface BiasDisplayInput {
  /** Frozen daily Final Bias for the asset (the canonical V3 decision). */
  dailyBiasSnapshot: "LONG" | "SHORT" | "NEUTRAL" | null;
  higherTimeframeBias: "BULLISH" | "BEARISH";
  biasConfidencePercent: number;
}

/** The schema-wide neutral confidence every compatibility path writes. */
export const COMPATIBILITY_CONFIDENCE = 50;

export interface BiasDisplay {
  label: string;
  /** null = nothing meaningful recorded → render the empty state. */
  value: string | null;
}

/**
 * 1. A frozen daily bias exists → "Today's bias · Long" (the trader's own
 *    Final Bias decision, frozen on the trade).
 * 2. Otherwise a legacy trade where the trader actually set a confidence
 *    (≠ the 50 default) → its recorded HTF bias, labelled as such.
 * 3. Otherwise nothing meaningful was decided → null ("—").
 * Stored values are never changed.
 */
export function tradeBiasDisplay(t: BiasDisplayInput): BiasDisplay {
  if (t.dailyBiasSnapshot) {
    const v = t.dailyBiasSnapshot === "LONG" ? "Long" : t.dailyBiasSnapshot === "SHORT" ? "Short" : "Neutral";
    return { label: "Today's bias", value: v };
  }
  if (t.biasConfidencePercent !== COMPATIBILITY_CONFIDENCE) {
    return {
      label: "HTF bias (recorded)",
      value: `${t.higherTimeframeBias === "BULLISH" ? "Bullish" : "Bearish"} · ${t.biasConfidencePercent}%`,
    };
  }
  return { label: "Today's bias", value: null };
}

export interface TimeDisplayInput {
  executionMinutes: number;
  hasActualEntry: boolean;
  /** Imported/legacy closed result with no actual entry price. */
  hasLegacyResult: boolean;
}

/**
 * Entered (or legacy result) → the canonical entry/execution time.
 * Not entered → the time is only when the idea was logged; never labelled
 * as an execution.
 */
export function tradeTimeDisplay(t: TimeDisplayInput): { label: string; time: string; executed: boolean } {
  const time = minutesToTimeString(t.executionMinutes);
  if (t.hasActualEntry) return { label: "Entry time", time, executed: true };
  if (t.hasLegacyResult) return { label: "Execution time", time, executed: true };
  return { label: "Idea logged", time, executed: false };
}
