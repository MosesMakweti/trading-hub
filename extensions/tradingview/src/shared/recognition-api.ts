/**
 * Traditorium TradingView Extension — Step 9, Part 1. Hand-typed mirror of
 * `src/domain/trade-plan/recognition-types.ts`'s `ScreenshotRecognitionOutcome`/
 * `RecognitionFieldResult` — the exact response shape
 * `POST /api/v1/media/:mediaAssetId/recognize-trade-plan` returns. Same
 * "no shared npm package, so no automatic drift protection beyond a
 * documented fixture" caveat as @shared/strategy.ts and @shared/trade-api.ts.
 */

export type RecognitionFieldType =
  | "SYMBOL"
  | "ASSET_CLASS"
  | "TIMEFRAME"
  | "DIRECTION"
  | "ENTRY"
  | "STOP_LOSS"
  | "TARGET"
  | "RISK_REWARD"
  | "STOP_DISTANCE"
  | "TARGET_DISTANCE"
  | "CHART_TIMESTAMP";

export interface RecognitionFieldResult {
  fieldType: RecognitionFieldType;
  targetOrder?: number;
  rawExtractedText?: string | null;
  detectedValue: string | null;
  confidence?: number | null;
  warning?: string | null;
}

export type ScreenshotRecognitionOutcome =
  | { status: "RECOGNITION_COMPLETE"; fields: RecognitionFieldResult[] }
  | { status: "RECOGNITION_FAILED"; error: string };

/**
 * The `POST /api/v1/media/:mediaAssetId/recognize-trade-plan` call's OWN
 * result — a layer above `ScreenshotRecognitionOutcome`. The route always
 * returns HTTP 200 for either outcome variant (recognition failure is a
 * normal response body, not an HTTP error — §2: "recognition failure must
 * never prevent manual Quick Add"), so `ok: true` here means "the REQUEST
 * succeeded" — the wrapped `outcome` is what says whether recognition
 * itself found anything. `ok: false` is reserved for request-level
 * problems: no/invalid token, unknown/cross-user id, network, or a genuine
 * server error.
 */
export type AnalyzeScreenshotResult =
  | { ok: true; outcome: ScreenshotRecognitionOutcome }
  | { ok: false; kind: "unauthorized" | "not_found" | "network" | "server"; message: string };
