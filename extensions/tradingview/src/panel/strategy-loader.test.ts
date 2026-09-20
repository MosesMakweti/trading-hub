import { describe, expect, it, vi } from "vitest";

import type { StrategyReference, StrategyReferenceResult } from "@shared/strategy";
import { createStrategyLoader, type StrategyLoadState } from "./strategy-loader";

function strategy(id: string, name: string): StrategyReference {
  return { id, name, version: 1, applicableAssets: [], entryModels: [], frameworkSteps: [], sessions: [], confluences: [], execution: [], tradeManagement: null, setupTypes: [] };
}

/** A promise the test controls the resolution timing of, so it can make a
 *  request started EARLIER resolve LATER — the exact race §16 describes. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createStrategyLoader (§16 race protection)", () => {
  it("happy path: loading -> loaded, in order", async () => {
    const states: StrategyLoadState[] = [];
    const loader = createStrategyLoader(async (id) => ({ ok: true, strategy: strategy(id, "A") }), (s) => states.push(s));

    loader.request("strat_a");
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe("loaded"));

    expect(states.map((s) => s.status)).toEqual(["loading", "loaded"]);
  });

  it("§16's exact scenario: a slow Strategy A response arriving AFTER a fast Strategy B selection must NOT overwrite B", async () => {
    const a = deferred<StrategyReferenceResult>();
    const b = deferred<StrategyReferenceResult>();
    const states: StrategyLoadState[] = [];

    const fetchReference = vi.fn((id: string) => (id === "strat_a" ? a.promise : b.promise));
    const loader = createStrategyLoader(fetchReference, (s) => states.push(s));

    loader.request("strat_a"); // slow — resolves last
    loader.request("strat_b"); // fast — resolves first

    b.resolve({ ok: true, strategy: strategy("strat_b", "B") });
    await vi.waitFor(() => expect(states.some((s) => s.status === "loaded")).toBe(true));

    a.resolve({ ok: true, strategy: strategy("strat_a", "A") }); // arrives late
    await new Promise((r) => setTimeout(r, 0)); // let any (wrongly-fired) .then flush

    const loaded = states.filter((s): s is Extract<StrategyLoadState, { status: "loaded" }> => s.status === "loaded");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.strategy.id).toBe("strat_b"); // never overwritten by A's late response
  });

  it("a stale ERROR response is also discarded, not just a stale success", async () => {
    const a = deferred<StrategyReferenceResult>();
    const b = deferred<StrategyReferenceResult>();
    const states: StrategyLoadState[] = [];

    const loader = createStrategyLoader((id) => (id === "strat_a" ? a.promise : b.promise), (s) => states.push(s));
    loader.request("strat_a");
    loader.request("strat_b");

    b.resolve({ ok: true, strategy: strategy("strat_b", "B") });
    await vi.waitFor(() => expect(states.some((s) => s.status === "loaded")).toBe(true));

    a.resolve({ ok: false, reason: "server", message: "boom" }); // A's late failure must not clobber B's success
    await new Promise((r) => setTimeout(r, 0));

    expect(states.some((s) => s.status === "error")).toBe(false);
    expect(states.at(-1)?.status).toBe("loaded");
  });

  it("requesting null clears back to idle without calling fetchReference", () => {
    const fetchReference = vi.fn();
    const states: StrategyLoadState[] = [];
    const loader = createStrategyLoader(fetchReference, (s) => states.push(s));

    loader.request(null);
    expect(fetchReference).not.toHaveBeenCalled();
    expect(states).toEqual([{ status: "idle" }]);
  });

  it("re-requesting the SAME id a second time re-fetches (no caching decision is made here)", async () => {
    const fetchReference = vi.fn(async (id: string) => ({ ok: true as const, strategy: strategy(id, "A") }));
    const loader = createStrategyLoader(fetchReference, () => {});
    loader.request("strat_a");
    await vi.waitFor(() => expect(fetchReference).toHaveBeenCalledTimes(1));
    loader.request("strat_a");
    await vi.waitFor(() => expect(fetchReference).toHaveBeenCalledTimes(2));
  });
});
