import { describe, expect, it, vi } from "vitest";

import { createRecognitionController, type RecognitionState } from "./recognition";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createRecognitionController", () => {
  it("idle -> analyzing -> analyzed, in order", async () => {
    const states: RecognitionState[] = [];
    const controller = createRecognitionController(
      async () => ({ ok: true, outcome: { status: "RECOGNITION_COMPLETE", fields: [] } }),
      (s) => states.push(s),
    );
    controller.analyze("media_1");
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("analyzed"));
    expect(states.map((s) => s.status)).toEqual(["analyzing", "analyzed"]);
  });

  it("passes the given mediaAssetId through to the analyze function", async () => {
    const analyze = vi.fn(async () => ({ ok: true as const, outcome: { status: "RECOGNITION_COMPLETE" as const, fields: [] } }));
    const controller = createRecognitionController(analyze, () => {});
    controller.analyze("media_42");
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledWith("media_42"));
  });

  it("a RECOGNITION_FAILED outcome still lands in 'analyzed', not 'error' — recognition failure is a normal result, not a request failure", async () => {
    const states: RecognitionState[] = [];
    const controller = createRecognitionController(
      async () => ({ ok: true, outcome: { status: "RECOGNITION_FAILED", error: "Not configured." } }),
      (s) => states.push(s),
    );
    controller.analyze("media_1");
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("analyzed"));
    expect(states.at(-1)).toEqual({ status: "analyzed", outcome: { status: "RECOGNITION_FAILED", error: "Not configured." } });
  });

  it("a request-level failure (401/404/network) lands in 'error'", async () => {
    const states: RecognitionState[] = [];
    const controller = createRecognitionController(async () => ({ ok: false, message: "Not connected to Traditorium." }), (s) => states.push(s));
    controller.analyze("media_1");
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("error"));
    expect(states.at(-1)).toEqual({ status: "error", message: "Not connected to Traditorium." });
  });

  it("a second analyze() click while one is already in flight is ignored, never firing twice", async () => {
    const d = deferred<{ ok: true; outcome: { status: "RECOGNITION_COMPLETE"; fields: never[] } }>();
    const analyze = vi.fn(() => d.promise);
    const controller = createRecognitionController(analyze, () => {});

    controller.analyze("media_1");
    controller.analyze("media_1");
    d.resolve({ ok: true, outcome: { status: "RECOGNITION_COMPLETE", fields: [] } });
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
  });

  it("dismiss() returns to idle without any call", () => {
    const states: RecognitionState[] = [];
    const controller = createRecognitionController(vi.fn(), (s) => states.push(s));
    controller.dismiss();
    expect(states).toEqual([{ status: "idle" }]);
  });

  it("analyze() works again after a prior call has resolved (not permanently locked by the in-flight guard)", async () => {
    const analyze = vi.fn(async () => ({ ok: true as const, outcome: { status: "RECOGNITION_COMPLETE" as const, fields: [] } }));
    const controller = createRecognitionController(analyze, () => {});
    controller.analyze("media_1");
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
    controller.analyze("media_1");
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
  });
});
