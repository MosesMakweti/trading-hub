/**
 * Real vision-recognition backend for the TradingView Screenshot Trade Plan
 * feature (spec §3) — implements `ScreenshotRecognitionProvider` against the
 * Claude API (`@anthropic-ai/sdk`). Reads the chart screenshot as an image
 * content block and forces a single tool call so the model's output matches
 * `RecognitionFieldResult[]` exactly, instead of parsing free-form text.
 *
 * Gated on `ANTHROPIC_API_KEY` — never hardcoded (see
 * server/services/trade-plan.service.ts's `resolveRecognitionProvider`).
 */
import Anthropic from "@anthropic-ai/sdk";

import type {
  RecognitionFieldResult,
  RecognitionFieldTypeLike,
  ScreenshotRecognitionInput,
  ScreenshotRecognitionOutcome,
  ScreenshotRecognitionProvider,
} from "@/domain/trade-plan/recognition-types";

const FIELD_TYPES: RecognitionFieldTypeLike[] = [
  "SYMBOL",
  "ASSET_CLASS",
  "TIMEFRAME",
  "DIRECTION",
  "ENTRY",
  "STOP_LOSS",
  "TARGET",
  "RISK_REWARD",
  "STOP_DISTANCE",
  "TARGET_DISTANCE",
  "CHART_TIMESTAMP",
];

/** Anthropic vision accepts these four image types — anything else is
 *  rejected up front rather than sent and failed remotely. */
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const TOOL_NAME = "report_recognized_fields";

const SYSTEM_PROMPT = `You read TradingView chart screenshots for a trading journal and extract the trade plan drawn on the chart (entry/stop/target lines, position tool annotations, the symbol/timeframe watermark).

Report only what is actually visible and legible — never guess or infer a value that isn't shown on the chart. Omit a field (call it with detectedValue: null and a short warning) if you're not confident.

Field-specific rules:
- SYMBOL: the exact ticker text as shown (include an exchange/broker prefix like "OANDA:" or "BINANCE:" if visible), not a normalized/looked-up symbol.
- ASSET_CLASS: one of FOREX, METALS, INDEX, FUTURES, CRYPTO, STOCK, OTHER — your best classification of the SYMBOL.
- TIMEFRAME: the chart's timeframe label exactly as shown (e.g. "15m", "1H", "4H", "1D").
- DIRECTION: exactly "LONG" or "SHORT" — read from the position tool's color/direction or explicit long/short markers, never inferred from price action alone.
- ENTRY, STOP_LOSS: a single plain numeric string (e.g. "1.09234"), no currency symbols, thousands separators, or units.
- TARGET: a plain numeric string like ENTRY/STOP_LOSS. If multiple targets are drawn (TP1, TP2, ...), report one TARGET field per target and set targetOrder to 1, 2, 3... in the order shown; omit targetOrder for a single target.
- RISK_REWARD: the R:R ratio as shown on the chart's position tool, as a plain number string (e.g. "2.5"), only if the tool displays it directly — do not compute it yourself.
- STOP_DISTANCE, TARGET_DISTANCE: the distance value shown by the position tool (e.g. pips/points/ticks), as a plain number string, only if directly displayed.
- CHART_TIMESTAMP: the visible date/time on the chart (axis or watermark), as shown.

For every field you report, set rawExtractedText to the literal text you read off the chart before any cleanup, and confidence to your calibrated 0-1 confidence.`;

const reportFieldsTool: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Report the structured trade-plan fields detected on the chart screenshot.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fieldType: { type: "string", enum: FIELD_TYPES },
            targetOrder: { type: ["integer", "null"], description: "1-based order, TARGET fields only." },
            rawExtractedText: { type: ["string", "null"] },
            detectedValue: { type: ["string", "null"] },
            confidence: { type: ["number", "null"] },
            warning: { type: ["string", "null"] },
          },
          required: ["fieldType", "targetOrder", "rawExtractedText", "detectedValue", "confidence", "warning"],
          additionalProperties: false,
        },
      },
    },
    required: ["fields"],
    additionalProperties: false,
  },
};

interface RawToolField {
  fieldType: string;
  targetOrder: number | null;
  rawExtractedText: string | null;
  detectedValue: string | null;
  confidence: number | null;
  warning: string | null;
}

function isRecognitionFieldType(value: string): value is RecognitionFieldTypeLike {
  return (FIELD_TYPES as string[]).includes(value);
}

/** Pure mapping from the tool call's raw input to our domain shape — drops
 *  anything with an unrecognized fieldType or a null/blank detectedValue
 *  (a field the model reported but couldn't actually read). Exported for
 *  unit testing without a network call. */
export function mapToolFieldsToRecognitionResults(rawFields: RawToolField[]): RecognitionFieldResult[] {
  const results: RecognitionFieldResult[] = [];
  for (const raw of rawFields) {
    if (!isRecognitionFieldType(raw.fieldType)) continue;
    if (!raw.detectedValue || !raw.detectedValue.trim()) continue;
    results.push({
      fieldType: raw.fieldType,
      targetOrder: raw.targetOrder ?? undefined,
      rawExtractedText: raw.rawExtractedText,
      detectedValue: raw.detectedValue.trim(),
      confidence: raw.confidence,
      warning: raw.warning,
    });
  }
  return results;
}

export class ClaudeVisionRecognitionProvider implements ScreenshotRecognitionProvider {
  readonly name = "claude-vision";
  readonly version = "1.0.0";

  isAvailable(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async recognize(input: ScreenshotRecognitionInput): Promise<ScreenshotRecognitionOutcome> {
    if (!this.isAvailable()) {
      return { status: "RECOGNITION_FAILED", error: "Recognition provider unavailable." };
    }
    if (!SUPPORTED_MIME_TYPES.has(input.mimeType)) {
      return { status: "RECOGNITION_FAILED", error: `Unsupported image type for recognition: ${input.mimeType}.` };
    }

    const client = new Anthropic();

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [reportFieldsTool],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: input.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                  data: input.imageBuffer.toString("base64"),
                },
              },
              { type: "text", text: "Extract the trade plan drawn on this chart screenshot." },
            ],
          },
        ],
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        console.error("[claude-vision-provider] authentication error", error);
        return { status: "RECOGNITION_FAILED", error: "Recognition provider rejected our credentials." };
      }
      if (error instanceof Anthropic.RateLimitError) {
        console.error("[claude-vision-provider] rate limited", error);
        return { status: "RECOGNITION_FAILED", error: "Recognition provider is rate-limited — try again shortly." };
      }
      if (error instanceof Anthropic.APIError) {
        console.error("[claude-vision-provider] API error", error.status, error.message);
        return { status: "RECOGNITION_FAILED", error: "Recognition provider returned an error." };
      }
      console.error("[claude-vision-provider] unreachable", error);
      return { status: "RECOGNITION_FAILED", error: "Could not reach the recognition provider." };
    }

    if (response.stop_reason === "refusal") {
      return { status: "RECOGNITION_FAILED", error: "Recognition provider declined to analyze this image." };
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
    );
    if (!toolUse) {
      return { status: "RECOGNITION_FAILED", error: "Recognition provider did not return a structured result." };
    }

    const rawFields = (toolUse.input as { fields?: RawToolField[] }).fields ?? [];
    const fields = mapToolFieldsToRecognitionResults(rawFields);

    return { status: "RECOGNITION_COMPLETE", fields };
  }
}
