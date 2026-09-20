import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreateTradeRequest } from "@shared/trade-api";
import { analyzeScreenshot, createTrade, deleteMedia, getMe, getStrategies, uploadMedia } from "./api-client";

function payload(): CreateTradeRequest {
  return {
    dateKey: "2026-01-15",
    trade: { assetSymbol: "XAUUSD", executionMinutes: 570, direction: "LONG", higherTimeframeBias: "BULLISH", biasConfidencePercent: 50 },
    plan: { entry: 100, stopLoss: 90, targets: [{ targetOrder: 1, label: "TP1", targetPrice: 120 }] },
  };
}

function apiTrade(overrides: Record<string, unknown> = {}) {
  return {
    id: "trade_1",
    tradeNumber: 1,
    dateKey: "2026-01-15",
    assetSymbol: "XAUUSD",
    direction: "LONG",
    timeframe: "5m",
    selectedSession: null,
    strategyId: null,
    strategyName: null,
    selectedEntryModel: null,
    selectedConfluences: [],
    selectedExecution: [],
    plannedEntry: 100,
    plannedStopLoss: 90,
    plannedTargets: [],
    expectedRR: null,
    setupScore: null,
    setupRating: null,
    setupValid: null,
    confluencePercent: null,
    executionPercent: null,
    hasPlanScreenshot: false,
    createdAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("api-client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the bearer token and calls the correct URL", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ user: { id: "u1", name: "Jane" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMe("td_live_abc123");
    expect(result).toEqual({ ok: true, data: { user: { id: "u1", name: "Jane" } } });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/api/v1/me");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer td_live_abc123" });
  });

  it("classifies a 401 as unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })));
    const result = await getMe("bad-token");
    expect(result).toEqual({ ok: false, reason: "unauthorized", message: expect.any(String) });
  });

  it("classifies a network failure (fetch throws) as network, never leaking the raw error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch: some internal detail with a token=secret in it");
      }),
    );
    const result = await getMe("token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network");
      expect(result.message).not.toContain("secret");
      expect(result.message).not.toContain("token=");
    }
  });

  it("classifies a non-401 non-2xx response as a server error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const result = await getMe("token");
    expect(result).toEqual({ ok: false, reason: "server", message: expect.any(String) });
  });

  it("classifies an unparsable body as malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    const result = await getMe("token");
    expect(result).toEqual({ ok: false, reason: "malformed", message: expect.any(String) });
  });

  it("getStrategies hits the strategies endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ strategies: [{ id: "s1", name: "A", version: 1, status: "ACTIVE" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getStrategies("token");
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:3000/api/v1/strategies");
  });

  describe("createTrade (Step 7)", () => {
    it("POSTs JSON with the bearer token AND the Idempotency-Key header", async () => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ trade: apiTrade() }), { status: 201 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await createTrade("td_live_abc", payload(), "key-123");

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://localhost:3000/api/v1/trades");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer td_live_abc",
        "Idempotency-Key": "key-123",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(init!.body as string)).toEqual(payload());
    });

    it("a 201 is a success, using the actual returned trade DTO", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ trade: apiTrade({ id: "trade_42" }) }), { status: 201 })));
      const result = await createTrade("token", payload(), "key-1");
      expect(result).toEqual({ ok: true, trade: apiTrade({ id: "trade_42" }), warnings: [], replayed: false });
    });

    it("a 201 with warnings surfaces them", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ trade: apiTrade(), warnings: ["plan: Could not save the planned targets."] }), { status: 201 })),
      );
      const result = await createTrade("token", payload(), "key-1");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.warnings).toEqual(["plan: Could not save the planned targets."]);
    });

    it("a 200 replay is ALSO a success, with replayed: true", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ trade: apiTrade(), replayed: true }), { status: 200 })));
      const result = await createTrade("token", payload(), "key-1");
      expect(result).toEqual({ ok: true, trade: apiTrade(), warnings: [], replayed: true });
    });

    it("classifies a 401 as unauthorized", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })));
      const result = await createTrade("token", payload(), "key-1");
      expect(result).toEqual({ ok: false, kind: "unauthorized", message: expect.any(String) });
    });

    it("classifies a 409 as conflict, surfacing the server's own message", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ error: "This Idempotency-Key was already used with a different request body." }), { status: 409 })),
      );
      const result = await createTrade("token", payload(), "key-1");
      expect(result).toEqual({ ok: false, kind: "conflict", message: "This Idempotency-Key was already used with a different request body." });
    });

    it("classifies a 422 as validation, carrying the structured issues array", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: "Validation failed.", issues: [{ path: "trade.direction", message: "Required" }] }), { status: 422 }),
        ),
      );
      const result = await createTrade("token", payload(), "key-1");
      expect(result).toEqual({ ok: false, kind: "validation", message: "Validation failed.", issues: [{ path: "trade.direction", message: "Required" }] });
    });

    it("a 422 with no issues array (e.g. a day-editable-guard or strategy-not-found error) still classifies as validation with an empty issues list", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "strategyId not found." }), { status: 422 })));
      const result = await createTrade("token", payload(), "key-1");
      expect(result).toEqual({ ok: false, kind: "validation", message: "strategyId not found.", issues: [] });
    });

    it("classifies a 500 as server, never exposing a stack trace", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Internal Server Error", stack: "at foo.ts:42" }), { status: 500 })));
      const result = await createTrade("token", payload(), "key-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("server");
        expect(result.message).not.toContain("foo.ts");
      }
    });

    it("classifies a network failure (fetch throws) as network, never leaking the raw error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch: some internal detail with a token=secret in it");
        }),
      );
      const result = await createTrade("token", payload(), "key-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("network");
        expect(result.message).not.toContain("secret");
      }
    });

    it("an unparsable success body classifies as server, not a crash", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 201 })));
      const result = await createTrade("token", payload(), "key-1");
      expect(result).toEqual({ ok: false, kind: "server", message: expect.any(String) });
    });
  });

  describe("uploadMedia (Step 8)", () => {
    it("POSTs multipart with the bearer token, and no manual Content-Type (fetch sets the boundary itself)", async () => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "media_1", url: "/api/media/media_1", mimeType: "image/png", fileSize: 42 }), { status: 201 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await uploadMedia("td_live_abc", new Uint8Array([1, 2, 3]), "image/png", "chart.png");

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://localhost:3000/api/v1/media");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ Authorization: "Bearer td_live_abc" });
      const form = init!.body as FormData;
      const file = form.get("file") as File;
      expect(file.name).toBe("chart.png");
      expect(file.type).toBe("image/png");
    });

    it("a 201 is a success, using the actual returned media DTO", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "media_1", url: "/api/media/media_1", mimeType: "image/png", fileSize: 42 }), { status: 201 })));
      const result = await uploadMedia("token", new Uint8Array([1]), "image/png", "chart.png");
      expect(result).toEqual({ ok: true, media: { id: "media_1", url: "/api/media/media_1", mimeType: "image/png", fileSize: 42 } });
    });

    it("classifies a 401 as unauthorized", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })));
      const result = await uploadMedia("token", new Uint8Array([1]), "image/png", "chart.png");
      expect(result).toEqual({ ok: false, kind: "unauthorized", message: expect.any(String) });
    });

    it("classifies a 415 as unsupported_type", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unsupported file type: image/tiff." }), { status: 415 })));
      const result = await uploadMedia("token", new Uint8Array([1]), "image/tiff", "chart.tiff");
      expect(result).toEqual({ ok: false, kind: "unsupported_type", message: "Unsupported file type: image/tiff." });
    });

    it("classifies a 413 as too_large", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Image is larger than the 8MB limit." }), { status: 413 })));
      const result = await uploadMedia("token", new Uint8Array([1]), "image/png", "chart.png");
      expect(result).toEqual({ ok: false, kind: "too_large", message: "Image is larger than the 8MB limit." });
    });

    it("classifies a 400/422 as validation", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "No file provided." }), { status: 400 })));
      const result = await uploadMedia("token", new Uint8Array([1]), "image/png", "chart.png");
      expect(result).toEqual({ ok: false, kind: "validation", message: "No file provided." });
    });

    it("classifies a network failure as network, never leaking the raw error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch: some internal detail with a token=secret in it");
        }),
      );
      const result = await uploadMedia("token", new Uint8Array([1]), "image/png", "chart.png");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("network");
        expect(result.message).not.toContain("secret");
      }
    });

    it("classifies a 500 as server", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 })));
      const result = await uploadMedia("token", new Uint8Array([1]), "image/png", "chart.png");
      expect(result).toEqual({ ok: false, kind: "server", message: expect.any(String) });
    });
  });

  describe("analyzeScreenshot (Step 9, Part 1)", () => {
    it("POSTs to the right URL with the bearer token", async () => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ status: "RECOGNITION_FAILED", error: "Recognition provider unavailable." }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await analyzeScreenshot("td_live_abc", "media_1");

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://localhost:3000/api/v1/media/media_1/recognize-trade-plan");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer td_live_abc" });
    });

    it("a 200 is ok:true even when the WRAPPED outcome is RECOGNITION_FAILED", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "RECOGNITION_FAILED", error: "Not configured." }), { status: 200 })));
      const result = await analyzeScreenshot("token", "media_1");
      expect(result).toEqual({ ok: true, outcome: { status: "RECOGNITION_FAILED", error: "Not configured." } });
    });

    it("a 200 is ok:true with the full outcome when recognition succeeds", async () => {
      const outcome = { status: "RECOGNITION_COMPLETE", fields: [{ fieldType: "ENTRY", detectedValue: "3640" }] };
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(outcome), { status: 200 })));
      const result = await analyzeScreenshot("token", "media_1");
      expect(result).toEqual({ ok: true, outcome });
    });

    it("classifies a 401 as unauthorized", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })));
      const result = await analyzeScreenshot("token", "media_1");
      expect(result).toEqual({ ok: false, kind: "unauthorized", message: expect.any(String) });
    });

    it("classifies a 404 as not_found", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 })));
      const result = await analyzeScreenshot("token", "does-not-exist");
      expect(result).toEqual({ ok: false, kind: "not_found", message: expect.any(String) });
    });

    it("classifies a network failure as network, never leaking the raw error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch: token=secret");
        }),
      );
      const result = await analyzeScreenshot("token", "media_1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("network");
        expect(result.message).not.toContain("secret");
      }
    });

    it("classifies a 500 as server", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 })));
      const result = await analyzeScreenshot("token", "media_1");
      expect(result).toEqual({ ok: false, kind: "server", message: expect.any(String) });
    });
  });

  describe("deleteMedia (Step 10)", () => {
    it("DELETEs the right URL with the bearer token", async () => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetchMock);

      await deleteMedia("td_live_abc", "media_1");

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://localhost:3000/api/v1/media/media_1");
      expect(init?.method).toBe("DELETE");
      expect(init?.headers).toEqual({ Authorization: "Bearer td_live_abc" });
    });

    it("a 204 (no body) is a success", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
      const result = await deleteMedia("token", "media_1");
      expect(result).toEqual({ ok: true });
    });

    it("classifies a 401 as unauthorized", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })));
      const result = await deleteMedia("token", "media_1");
      expect(result).toEqual({ ok: false, kind: "unauthorized", message: expect.any(String) });
    });

    it("classifies a 404 as not_found", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 })));
      const result = await deleteMedia("token", "does-not-exist");
      expect(result).toEqual({ ok: false, kind: "not_found", message: expect.any(String) });
    });

    it("classifies a 409 as protected, surfacing the server's own message — never treated as a failure by any caller", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ error: "This image is already attached to a trade and can't be deleted here." }), { status: 409 })),
      );
      const result = await deleteMedia("token", "media_1");
      expect(result).toEqual({ ok: false, kind: "protected", message: "This image is already attached to a trade and can't be deleted here." });
    });

    it("classifies a network failure as network, never leaking the raw error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch: token=secret");
        }),
      );
      const result = await deleteMedia("token", "media_1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("network");
        expect(result.message).not.toContain("secret");
      }
    });

    it("classifies a 500 as server", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 })));
      const result = await deleteMedia("token", "media_1");
      expect(result).toEqual({ ok: false, kind: "server", message: expect.any(String) });
    });
  });
});
