import { describe, expect, it } from "vitest";

import { ClaudeVisionRecognitionProvider, mapToolFieldsToRecognitionResults } from "@/domain/trade-plan/providers/claude-vision-provider";

describe("mapToolFieldsToRecognitionResults", () => {
  it("keeps a well-formed field and trims detectedValue", () => {
    const results = mapToolFieldsToRecognitionResults([
      { fieldType: "SYMBOL", targetOrder: null, rawExtractedText: "OANDA:EURUSD", detectedValue: " OANDA:EURUSD ", confidence: 0.97, warning: null },
    ]);
    expect(results).toEqual([
      { fieldType: "SYMBOL", targetOrder: undefined, rawExtractedText: "OANDA:EURUSD", detectedValue: "OANDA:EURUSD", confidence: 0.97, warning: null },
    ]);
  });

  it("preserves targetOrder for multiple TARGET fields", () => {
    const results = mapToolFieldsToRecognitionResults([
      { fieldType: "TARGET", targetOrder: 1, rawExtractedText: "1.0950", detectedValue: "1.0950", confidence: 0.8, warning: null },
      { fieldType: "TARGET", targetOrder: 2, rawExtractedText: "1.1000", detectedValue: "1.1000", confidence: 0.6, warning: null },
    ]);
    expect(results.map((f) => f.targetOrder)).toEqual([1, 2]);
  });

  it("drops fields the model reported but couldn't read (null/blank detectedValue)", () => {
    const results = mapToolFieldsToRecognitionResults([
      { fieldType: "RISK_REWARD", targetOrder: null, rawExtractedText: null, detectedValue: null, confidence: null, warning: "not shown on chart" },
      { fieldType: "STOP_LOSS", targetOrder: null, rawExtractedText: "", detectedValue: "   ", confidence: null, warning: null },
    ]);
    expect(results).toEqual([]);
  });

  it("drops a field with an unrecognized fieldType rather than throwing", () => {
    const results = mapToolFieldsToRecognitionResults([
      { fieldType: "NOT_A_REAL_TYPE", targetOrder: null, rawExtractedText: "x", detectedValue: "x", confidence: 1, warning: null },
    ]);
    expect(results).toEqual([]);
  });
});

describe("ClaudeVisionRecognitionProvider.isAvailable", () => {
  it("is false when ANTHROPIC_API_KEY is unset", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(new ClaudeVisionRecognitionProvider().isAvailable()).toBe(false);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("is true when ANTHROPIC_API_KEY is set", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    try {
      expect(new ClaudeVisionRecognitionProvider().isAvailable()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
