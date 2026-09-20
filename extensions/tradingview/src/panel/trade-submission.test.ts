import { describe, expect, it, vi } from "vitest";

import type { CreateTradeRequest, CreateTradeResult } from "@shared/trade-api";
import { createTradeSubmitter, type SubmissionState } from "./trade-submission";

function payload(): CreateTradeRequest {
  return {
    dateKey: "2026-01-15",
    trade: { assetSymbol: "XAUUSD", executionMinutes: 570, direction: "LONG", higherTimeframeBias: "BULLISH", biasConfidencePercent: 50 },
    plan: { entry: 100, stopLoss: 90, targets: [{ targetOrder: 1, label: "TP1", targetPrice: 120 }] },
  };
}

function successResult(): Extract<CreateTradeResult, { ok: true }> {
  return {
    ok: true,
    warnings: [],
    replayed: false,
    trade: {
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
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createTradeSubmitter", () => {
  it("generates a UUID key on the first submit and sends it to createTrade", async () => {
    const createTrade = vi.fn(async (_p: CreateTradeRequest, _k: string) => successResult());
    const submitter = createTradeSubmitter(createTrade, () => {});
    await submitter.submit(payload());
    const key = createTrade.mock.calls[0]![1];
    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("idle -> submitting -> success, in order", async () => {
    const states: SubmissionState[] = [];
    const submitter = createTradeSubmitter(async () => successResult(), (s) => states.push(s));
    await submitter.submit(payload());
    expect(states.map((s) => s.status)).toEqual(["submitting", "success"]);
  });

  it("§16 — a duplicate click while a submission is in flight is ignored, never firing a second request", async () => {
    const d = deferred<CreateTradeResult>();
    const createTrade = vi.fn(() => d.promise);
    const submitter = createTradeSubmitter(createTrade, () => {});

    const first = submitter.submit(payload());
    const second = submitter.submit(payload()); // fires while `first` is still pending
    d.resolve(successResult());
    await Promise.all([first, second]);

    expect(createTrade).toHaveBeenCalledTimes(1);
  });

  it("§17 — the SAME key is reused across a network-failure retry", async () => {
    const createTrade = vi
      .fn<CreateTradeFnLike>()
      .mockResolvedValueOnce({ ok: false, kind: "network", message: "Could not reach Traditorium." })
      .mockResolvedValueOnce(successResult());
    const submitter = createTradeSubmitter(createTrade, () => {});

    await submitter.submit(payload());
    await submitter.submit(payload()); // the trader clicks "retry"

    const [firstKey, secondKey] = createTrade.mock.calls.map((c) => c[1]);
    expect(firstKey).toBe(secondKey);
  });

  it("§17 — the SAME key is reused across a 500/server-failure retry", async () => {
    const createTrade = vi
      .fn<CreateTradeFnLike>()
      .mockResolvedValueOnce({ ok: false, kind: "server", message: "Traditorium returned an unexpected error." })
      .mockResolvedValueOnce(successResult());
    const submitter = createTradeSubmitter(createTrade, () => {});

    await submitter.submit(payload());
    await submitter.submit(payload());

    const [firstKey, secondKey] = createTrade.mock.calls.map((c) => c[1]);
    expect(firstKey).toBe(secondKey);
  });

  it("§17 — a 422 validation failure keeps the SAME key if the trader retries WITHOUT editing anything", async () => {
    const createTrade = vi
      .fn<CreateTradeFnLike>()
      .mockResolvedValueOnce({ ok: false, kind: "validation", message: "Validation failed.", issues: [] })
      .mockResolvedValueOnce(successResult());
    const submitter = createTradeSubmitter(createTrade, () => {});

    await submitter.submit(payload());
    await submitter.submit(payload()); // retried as-is, no edit in between

    const [firstKey, secondKey] = createTrade.mock.calls.map((c) => c[1]);
    expect(firstKey).toBe(secondKey);
  });

  it("§17 — a NEW key is used once the trader materially edits the draft after a 422", async () => {
    const createTrade = vi
      .fn<CreateTradeFnLike>()
      .mockResolvedValueOnce({ ok: false, kind: "validation", message: "Validation failed.", issues: [] })
      .mockResolvedValueOnce(successResult());
    const submitter = createTradeSubmitter(createTrade, () => {});

    await submitter.submit(payload());
    submitter.notifyDraftEdited(); // the trader fixed the offending field
    await submitter.submit(payload());

    const [firstKey, secondKey] = createTrade.mock.calls.map((c) => c[1]);
    expect(firstKey).not.toBe(secondKey);
  });

  it("§17 — a NEW key is used once the trader edits after a 401 (definitive)", async () => {
    const createTrade = vi
      .fn<CreateTradeFnLike>()
      .mockResolvedValueOnce({ ok: false, kind: "unauthorized", message: "The Traditorium token is invalid or has been revoked." })
      .mockResolvedValueOnce(successResult());
    const submitter = createTradeSubmitter(createTrade, () => {});

    await submitter.submit(payload());
    submitter.notifyDraftEdited();
    await submitter.submit(payload());

    const [firstKey, secondKey] = createTrade.mock.calls.map((c) => c[1]);
    expect(firstKey).not.toBe(secondKey);
  });

  it("§17 — a NEW key is used once the trader edits after a 409 (definitive)", async () => {
    const createTrade = vi
      .fn<CreateTradeFnLike>()
      .mockResolvedValueOnce({ ok: false, kind: "conflict", message: "This Idempotency-Key was already used with a different request body." })
      .mockResolvedValueOnce(successResult());
    const submitter = createTradeSubmitter(createTrade, () => {});

    await submitter.submit(payload());
    submitter.notifyDraftEdited();
    await submitter.submit(payload());

    const [firstKey, secondKey] = createTrade.mock.calls.map((c) => c[1]);
    expect(firstKey).not.toBe(secondKey);
  });

  it("notifyDraftEdited before any submission, or after a transient failure, has no effect on the next key", async () => {
    const createTrade = vi
      .fn<CreateTradeFnLike>()
      .mockResolvedValueOnce({ ok: false, kind: "network", message: "Could not reach Traditorium." })
      .mockResolvedValueOnce(successResult());
    const submitter = createTradeSubmitter(createTrade, () => {});

    await submitter.submit(payload());
    submitter.notifyDraftEdited(); // a network failure's key is NOT eligible for rotation via edit
    await submitter.submit(payload());

    const [firstKey, secondKey] = createTrade.mock.calls.map((c) => c[1]);
    expect(firstKey).toBe(secondKey);
  });

  it("a SUCCESS clears the key — the next submission (e.g. Add Another) gets a fresh one", async () => {
    const createTrade = vi.fn(async (_p: CreateTradeRequest, _k: string) => successResult());
    const submitter = createTradeSubmitter(createTrade, () => {});

    await submitter.submit(payload());
    await submitter.submit(payload()); // simulating a second, later, distinct logical save

    const [firstKey, secondKey] = createTrade.mock.calls.map((c) => c[1]);
    expect(firstKey).not.toBe(secondKey);
  });

  it("reset() forgets the pending key and returns to idle", async () => {
    const states: SubmissionState[] = [];
    const createTrade = vi.fn(async (_p: CreateTradeRequest, _k: string) => ({ ok: false, kind: "network", message: "x" }) as CreateTradeResult);
    const submitter = createTradeSubmitter(createTrade, (s) => states.push(s));

    await submitter.submit(payload());
    submitter.reset();
    await submitter.submit(payload());

    expect(states.at(-1)?.status).not.toBe("idle"); // the second submit moved past idle again
    const [firstKey, secondKey] = createTrade.mock.calls.map((c) => c[1]);
    expect(firstKey).not.toBe(secondKey);
  });
});

// A loosely-typed alias just for vi.fn<>() generic ergonomics in this file.
type CreateTradeFnLike = (payload: CreateTradeRequest, key: string) => Promise<CreateTradeResult>;
