/**
 * Provider-agnostic screenshot-recognition contract (spec §3). Anything that
 * can look at a chart image and return structured field guesses implements
 * `ScreenshotRecognitionProvider` — a real AI-vision provider is a single
 * new file implementing this interface, wired in
 * server/services/trade-plan-recognition.service.ts's `resolveProvider()`.
 * No provider is configured in this codebase yet (no vision/OCR service
 * existed before this feature, and no API credentials are hardcoded here
 * per instruction) — `NullRecognitionProvider` below is what runs today,
 * and recognition failure is a first-class, always-exercised path rather
 * than a rare edge case (spec §2: "recognition failure must not block the
 * trader").
 */

export type RecognitionFieldTypeLike =
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

export interface RecognitionBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One detected field — the structured shape spec §3 requires instead of
 *  unstructured text. Every field a provider can't confidently read is
 *  simply omitted from the result rather than guessed. */
export interface RecognitionFieldResult {
  fieldType: RecognitionFieldTypeLike;
  /** Disambiguates multiple TARGET fields (TP1, TP2, …). */
  targetOrder?: number;
  rawExtractedText?: string | null;
  /** Stored as text — a price, "LONG"/"SHORT", a symbol, a timeframe label, etc. */
  detectedValue: string | null;
  /** 0–1, when the provider reports one. */
  confidence?: number | null;
  boundingBox?: RecognitionBoundingBox | null;
  warning?: string | null;
}

export interface ScreenshotRecognitionInput {
  imageBuffer: Buffer;
  mimeType: string;
  width?: number | null;
  height?: number | null;
}

export interface ScreenshotRecognitionSuccess {
  status: "RECOGNITION_COMPLETE";
  fields: RecognitionFieldResult[];
}

export interface ScreenshotRecognitionFailure {
  status: "RECOGNITION_FAILED";
  /** Trader-facing — never a raw stack trace or provider internals. */
  error: string;
}

export type ScreenshotRecognitionOutcome = ScreenshotRecognitionSuccess | ScreenshotRecognitionFailure;

export interface ScreenshotRecognitionProvider {
  readonly name: string;
  readonly version: string;
  /** Cheap, synchronous — no network call. False when required config/credentials are absent. */
  isAvailable(): boolean;
  recognize(input: ScreenshotRecognitionInput): Promise<ScreenshotRecognitionOutcome>;
}

/** Always available, never actually recognizes anything — the trader falls
 *  straight through to manual annotation. This is the default and only
 *  provider until a real vision backend is configured; it's what makes
 *  "recognition unavailable" a real, tested state rather than untested code
 *  that only exists on paper. */
export class NullRecognitionProvider implements ScreenshotRecognitionProvider {
  readonly name = "none";
  readonly version = "1.0.0";

  isAvailable(): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature must match ScreenshotRecognitionProvider
  async recognize(_input: ScreenshotRecognitionInput): Promise<ScreenshotRecognitionOutcome> {
    return {
      status: "RECOGNITION_FAILED",
      error: "Automatic recognition isn't configured for this workspace yet. Enter the plan manually below.",
    };
  }
}
