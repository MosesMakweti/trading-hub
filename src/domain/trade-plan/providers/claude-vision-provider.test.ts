import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

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

/**
 * Step 10, §5 — the Recognition Production Audit. Constructor injection
 * (see claude-vision-provider.ts's doc comment) mirrors
 * ClaudeTraderReviewAnalystProvider's already-established test pattern
 * (claude-analyst-provider.test.ts) — a fake `{ messages: { create } }`
 * client, never a real network call or a mocked SDK module.
 */
describe("ClaudeVisionRecognitionProvider.recognize", () => {
  const withApiKey = (fn: () => Promise<void>) => async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    try {
      await fn();
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  };

  function fakeClient(createImpl: (...args: unknown[]) => Promise<Anthropic.Message>): Anthropic {
    return { messages: { create: vi.fn(createImpl) } } as unknown as Anthropic;
  }

  function toolUseResponse(fields: unknown[]): Anthropic.Message {
    return {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 } as never,
      content: [{ type: "tool_use", id: "tool_1", name: "report_recognized_fields", input: { fields } }],
    } as unknown as Anthropic.Message;
  }

  const image = { imageBuffer: Buffer.from("fake-png"), mimeType: "image/png" } satisfies { imageBuffer: Buffer; mimeType: string };

  it(
    "provider unavailable: no ANTHROPIC_API_KEY, never calls the client",
    async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        const create = vi.fn();
        const provider = new ClaudeVisionRecognitionProvider({ messages: { create } } as unknown as Anthropic);
        const outcome = await provider.recognize(image);
        expect(outcome).toEqual({ status: "RECOGNITION_FAILED", error: "Recognition provider unavailable." });
        expect(create).not.toHaveBeenCalled();
      } finally {
        if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
      }
    },
  );

  it(
    "unsupported mime type: rejected before ever calling the client",
    withApiKey(async () => {
      const create = vi.fn();
      const provider = new ClaudeVisionRecognitionProvider({ messages: { create } } as unknown as Anthropic);
      const outcome = await provider.recognize({ imageBuffer: Buffer.from("x"), mimeType: "application/pdf" });
      expect(outcome).toEqual({ status: "RECOGNITION_FAILED", error: expect.stringContaining("Unsupported image type") });
      expect(create).not.toHaveBeenCalled();
    }),
  );

  it(
    "invalid/rejected credentials: AuthenticationError maps to a sanitized RECOGNITION_FAILED, never the raw error",
    withApiKey(async () => {
      const provider = new ClaudeVisionRecognitionProvider(
        fakeClient(async () => {
          throw new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", new Headers());
        }),
      );
      const outcome = await provider.recognize(image);
      expect(outcome.status).toBe("RECOGNITION_FAILED");
      if (outcome.status !== "RECOGNITION_FAILED") throw new Error("unreachable");
      expect(outcome.error).not.toContain("x-api-key");
      expect(outcome.error).toBe("Recognition provider rejected our credentials.");
    }),
  );

  it(
    "rate limited: RateLimitError maps to a friendly, sanitized message",
    withApiKey(async () => {
      const provider = new ClaudeVisionRecognitionProvider(
        fakeClient(async () => {
          throw new Anthropic.RateLimitError(429, {}, "rate limited", new Headers());
        }),
      );
      const outcome = await provider.recognize(image);
      expect(outcome).toEqual({ status: "RECOGNITION_FAILED", error: expect.stringContaining("rate-limited") });
    }),
  );

  it(
    "timeout: APIConnectionTimeoutError never throws out of recognize() — resolves to RECOGNITION_FAILED",
    withApiKey(async () => {
      const provider = new ClaudeVisionRecognitionProvider(
        fakeClient(async () => {
          throw new Anthropic.APIConnectionTimeoutError();
        }),
      );
      const outcome = await provider.recognize(image);
      expect(outcome.status).toBe("RECOGNITION_FAILED");
    }),
  );

  it(
    "generic API error (e.g. 500 from the provider): sanitized, never the raw status/body",
    withApiKey(async () => {
      const provider = new ClaudeVisionRecognitionProvider(
        fakeClient(async () => {
          throw new Anthropic.APIError(500, { type: "internal_error", message: "boom" }, "boom", new Headers());
        }),
      );
      const outcome = await provider.recognize(image);
      expect(outcome.status).toBe("RECOGNITION_FAILED");
      if (outcome.status !== "RECOGNITION_FAILED") throw new Error("unreachable");
      expect(outcome.error).not.toContain("boom");
    }),
  );

  it(
    "model refusal (stop_reason: refusal): a distinct, sanitized RECOGNITION_FAILED",
    withApiKey(async () => {
      const provider = new ClaudeVisionRecognitionProvider(
        fakeClient(
          async () =>
            ({
              id: "msg_2",
              type: "message",
              role: "assistant",
              model: "claude-opus-5",
              stop_reason: "refusal",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 } as never,
              content: [],
            }) as unknown as Anthropic.Message,
        ),
      );
      const outcome = await provider.recognize(image);
      expect(outcome).toEqual({ status: "RECOGNITION_FAILED", error: "Recognition provider declined to analyze this image." });
    }),
  );

  it(
    "malformed response: no tool_use block present (model answered in plain text) — never crashes, fails cleanly",
    withApiKey(async () => {
      const provider = new ClaudeVisionRecognitionProvider(
        fakeClient(
          async () =>
            ({
              id: "msg_3",
              type: "message",
              role: "assistant",
              model: "claude-opus-5",
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 } as never,
              content: [{ type: "text", text: "I see a chart but won't use the tool." }],
            }) as unknown as Anthropic.Message,
        ),
      );
      const outcome = await provider.recognize(image);
      expect(outcome).toEqual({ status: "RECOGNITION_FAILED", error: "Recognition provider did not return a structured result." });
    }),
  );

  it(
    "empty response: a well-formed tool call with zero fields is a COMPLETE outcome with an empty array, not a failure",
    withApiKey(async () => {
      const provider = new ClaudeVisionRecognitionProvider(fakeClient(async () => toolUseResponse([])));
      const outcome = await provider.recognize(image);
      expect(outcome).toEqual({ status: "RECOGNITION_COMPLETE", fields: [] });
    }),
  );

  it(
    "partial response: fields the model couldn't read (null detectedValue) are silently dropped, others kept",
    withApiKey(async () => {
      const provider = new ClaudeVisionRecognitionProvider(
        fakeClient(async () =>
          toolUseResponse([
            { fieldType: "ENTRY", targetOrder: null, rawExtractedText: "3640", detectedValue: "3640", confidence: 0.9, warning: null },
            { fieldType: "STOP_LOSS", targetOrder: null, rawExtractedText: null, detectedValue: null, confidence: null, warning: "not visible" },
          ]),
        ),
      );
      const outcome = await provider.recognize(image);
      expect(outcome.status).toBe("RECOGNITION_COMPLETE");
      if (outcome.status !== "RECOGNITION_COMPLETE") throw new Error("unreachable");
      expect(outcome.fields).toHaveLength(1);
      expect(outcome.fields[0]!.fieldType).toBe("ENTRY");
    }),
  );

  it(
    "full response: symbol/timeframe/direction/entry/stop/multiple targets all come through",
    withApiKey(async () => {
      const provider = new ClaudeVisionRecognitionProvider(
        fakeClient(async () =>
          toolUseResponse([
            { fieldType: "SYMBOL", targetOrder: null, rawExtractedText: "OANDA:XAUUSD", detectedValue: "OANDA:XAUUSD", confidence: 0.95, warning: null },
            { fieldType: "TIMEFRAME", targetOrder: null, rawExtractedText: "15m", detectedValue: "15m", confidence: 0.9, warning: null },
            { fieldType: "DIRECTION", targetOrder: null, rawExtractedText: "LONG", detectedValue: "LONG", confidence: 0.85, warning: null },
            { fieldType: "ENTRY", targetOrder: null, rawExtractedText: "3640", detectedValue: "3640", confidence: 0.9, warning: null },
            { fieldType: "STOP_LOSS", targetOrder: null, rawExtractedText: "3630", detectedValue: "3630", confidence: 0.9, warning: null },
            { fieldType: "TARGET", targetOrder: 1, rawExtractedText: "3660", detectedValue: "3660", confidence: 0.8, warning: null },
            { fieldType: "TARGET", targetOrder: 2, rawExtractedText: "3680", detectedValue: "3680", confidence: 0.6, warning: null },
          ]),
        ),
      );
      const outcome = await provider.recognize(image);
      expect(outcome.status).toBe("RECOGNITION_COMPLETE");
      if (outcome.status !== "RECOGNITION_COMPLETE") throw new Error("unreachable");
      expect(outcome.fields).toHaveLength(7);
      expect(outcome.fields.filter((f) => f.fieldType === "TARGET").map((f) => f.targetOrder)).toEqual([1, 2]);
    }),
  );

  it(
    "network failure (client throws something that isn't an Anthropic error class): still resolves, never throws out of recognize()",
    withApiKey(async () => {
      const provider = new ClaudeVisionRecognitionProvider(
        fakeClient(async () => {
          throw new TypeError("fetch failed");
        }),
      );
      const outcome = await provider.recognize(image);
      expect(outcome).toEqual({ status: "RECOGNITION_FAILED", error: "Could not reach the recognition provider." });
    }),
  );
});
