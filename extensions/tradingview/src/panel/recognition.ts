/**
 * Traditorium TradingView Extension — Step 9, Parts 1-3. Screenshot
 * recognition ("Analyze Chart") state machine — mirrors
 * `screenshot.ts`/`strategy-loader.ts`/`trade-submission.ts`'s shape
 * (injected async function, an `onChange` callback, no chrome.* calls, no
 * DOM) so the whole thing is unit-testable without a network call.
 *
 * `idle → analyzing → analyzed`, with an `error` branch. `analyzed` holds
 * the RAW `ScreenshotRecognitionOutcome` — translating it into a
 * displayable suggestion is `@shared/recognition-suggestions.ts::toPlanSuggestion`'s
 * job (a pure function panel.ts calls when rendering), not this
 * controller's — mirrors trade-submission.ts holding the raw
 * `CreateTradeResult` and trade-view.ts doing the translation.
 *
 * §3 — this controller never mutates the draft itself. "Apply Suggestions"
 * is a separate, explicit action in panel.ts that calls
 * `@shared/draft.ts::applyPlanSuggestion` only when the trader clicks it.
 */
import type { ScreenshotRecognitionOutcome } from "@shared/recognition-api";

export type RecognitionState =
  | { status: "idle" }
  | { status: "analyzing" }
  | { status: "analyzed"; outcome: ScreenshotRecognitionOutcome }
  | { status: "error"; message: string };

export type AnalyzeFn = (mediaAssetId: string) => Promise<{ ok: true; outcome: ScreenshotRecognitionOutcome } | { ok: false; message: string }>;

export interface RecognitionController {
  /** No-ops while a call is already in flight (mirrors screenshot.ts's/
   *  trade-submission.ts's own in-flight guards — no duplicate concurrent
   *  analysis requests). */
  analyze(mediaAssetId: string): void;
  /** "Dismiss" — discards the suggestion, back to idle, no server call. */
  dismiss(): void;
}

export function createRecognitionController(analyze: AnalyzeFn, onChange: (state: RecognitionState) => void): RecognitionController {
  let inFlight = false;

  return {
    analyze(mediaAssetId: string) {
      if (inFlight) return;
      inFlight = true;
      onChange({ status: "analyzing" });

      void analyze(mediaAssetId).then((result) => {
        inFlight = false;
        onChange(result.ok ? { status: "analyzed", outcome: result.outcome } : { status: "error", message: result.message });
      });
    },
    dismiss() {
      onChange({ status: "idle" });
    },
  };
}
