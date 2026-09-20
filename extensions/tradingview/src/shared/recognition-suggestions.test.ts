import { describe, expect, it } from "vitest";

import type { ScreenshotRecognitionOutcome } from "./recognition-api";
import { toPlanSuggestion } from "./recognition-suggestions";

describe("toPlanSuggestion", () => {
  it("maps a full result — entry, stop, multiple targets, direction, symbol, timeframe", () => {
    const outcome: ScreenshotRecognitionOutcome = {
      status: "RECOGNITION_COMPLETE",
      fields: [
        { fieldType: "SYMBOL", detectedValue: "OANDA:XAUUSD" },
        { fieldType: "TIMEFRAME", detectedValue: "15m" },
        { fieldType: "DIRECTION", detectedValue: "LONG" },
        { fieldType: "ENTRY", detectedValue: "3640" },
        { fieldType: "STOP_LOSS", detectedValue: "3630" },
        { fieldType: "TARGET", detectedValue: "3660", targetOrder: 1 },
        { fieldType: "TARGET", detectedValue: "3680", targetOrder: 2 },
      ],
    };
    expect(toPlanSuggestion(outcome)).toEqual({
      symbol: "OANDA:XAUUSD",
      timeframe: "15m",
      direction: "LONG",
      entry: "3640",
      stopLoss: "3630",
      targets: [
        { order: 1, price: "3660" },
        { order: 2, price: "3680" },
      ],
      isEmpty: false,
    });
  });

  it("§2 — never fabricates a field the provider didn't report; a partial result leaves the rest null", () => {
    const outcome: ScreenshotRecognitionOutcome = {
      status: "RECOGNITION_COMPLETE",
      fields: [{ fieldType: "ENTRY", detectedValue: "3640" }, { fieldType: "STOP_LOSS", detectedValue: "3630" }, { fieldType: "TARGET", detectedValue: "3660" }],
    };
    const suggestion = toPlanSuggestion(outcome);
    expect(suggestion.entry).toBe("3640");
    expect(suggestion.stopLoss).toBe("3630");
    expect(suggestion.targets).toEqual([{ order: 1, price: "3660" }]); // targetOrder omitted -> defaults to 1
    expect(suggestion.symbol).toBeNull();
    expect(suggestion.direction).toBeNull();
    expect(suggestion.isEmpty).toBe(false);
  });

  it("targets are sorted by targetOrder regardless of the order fields arrived in", () => {
    const outcome: ScreenshotRecognitionOutcome = {
      status: "RECOGNITION_COMPLETE",
      fields: [
        { fieldType: "TARGET", detectedValue: "3680", targetOrder: 2 },
        { fieldType: "TARGET", detectedValue: "3660", targetOrder: 1 },
      ],
    };
    expect(toPlanSuggestion(outcome).targets.map((t) => t.price)).toEqual(["3660", "3680"]);
  });

  it("a field with a null detectedValue is treated as not detected", () => {
    const outcome: ScreenshotRecognitionOutcome = {
      status: "RECOGNITION_COMPLETE",
      fields: [{ fieldType: "ENTRY", detectedValue: null, warning: "Not legible" }],
    };
    expect(toPlanSuggestion(outcome).entry).toBeNull();
  });

  it("an unrecognized DIRECTION value (neither LONG nor SHORT) is treated as not detected, never guessed", () => {
    const outcome: ScreenshotRecognitionOutcome = { status: "RECOGNITION_COMPLETE", fields: [{ fieldType: "DIRECTION", detectedValue: "sideways" }] };
    expect(toPlanSuggestion(outcome).direction).toBeNull();
  });

  it("isEmpty is true when recognition succeeded but found literally nothing", () => {
    const outcome: ScreenshotRecognitionOutcome = { status: "RECOGNITION_COMPLETE", fields: [] };
    expect(toPlanSuggestion(outcome).isEmpty).toBe(true);
  });

  it("a RECOGNITION_FAILED outcome produces an all-null, isEmpty suggestion — never throws", () => {
    const outcome: ScreenshotRecognitionOutcome = { status: "RECOGNITION_FAILED", error: "Recognition provider unavailable." };
    expect(toPlanSuggestion(outcome)).toEqual({ symbol: null, timeframe: null, direction: null, entry: null, stopLoss: null, targets: [], isEmpty: true });
  });
});
