import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutosaveQueue, type SaveResult } from "@/lib/autosave-queue";

/** A save whose completion the test controls, to simulate slow requests. */
function controllableSaves() {
  const calls: { value: string; resolve: (r: SaveResult) => void }[] = [];
  const persisted: string[] = [];
  const save = (value: string) =>
    new Promise<SaveResult>((resolve) => {
      calls.push({
        value,
        resolve: (r) => {
          if (r.success) persisted.push(value);
          resolve(r);
        },
      });
    });
  return { calls, persisted, save };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe("AutosaveQueue", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("debounces: only the newest value inside the delay is saved", async () => {
    const { calls, save } = controllableSaves();
    const q = new AutosaveQueue<string>("a");
    for (const v of ["b", "c", "d"]) {
      q.update(v, v, { save });
      q.schedule(v, v, 800);
    }
    vi.advanceTimersByTime(800);
    vi.useRealTimers();
    await flushMicrotasks();
    expect(calls.map((c) => c.value)).toEqual(["d"]);
  });

  it("never lets an older, slower save land after a newer one", async () => {
    const { calls, persisted, save } = controllableSaves();
    const q = new AutosaveQueue<string>("a");
    q.update("old", "old", { save });
    q.schedule("old", "old", 10);
    vi.advanceTimersByTime(10);
    q.update("new", "new", { save });
    q.schedule("new", "new", 10);
    vi.advanceTimersByTime(10);

    // "new" must not even start until "old" settles.
    vi.useRealTimers();
    await flushMicrotasks();
    expect(calls.map((c) => c.value)).toEqual(["old"]);
    calls[0].resolve({ success: true });
    await flushMicrotasks();
    expect(calls.map((c) => c.value)).toEqual(["old", "new"]);
    calls[1].resolve({ success: true });
    await flushMicrotasks();
    expect(persisted).toEqual(["old", "new"]); // last write wins = newest content
  });

  it("flush saves a not-yet-fired debounce immediately and reports success", async () => {
    vi.useRealTimers();
    const saves: string[] = [];
    const q = new AutosaveQueue<string>("a");
    q.update("b", "b", { save: async (v) => (saves.push(v), { success: true }) });
    q.schedule("b", "b", 60_000);
    expect(await q.flush()).toBe(true);
    expect(saves).toEqual(["b"]);
    expect(q.isDirty).toBe(false);
  });

  it("flush reports false when the save fails, and the content can be retried", async () => {
    vi.useRealTimers();
    let fail = true;
    const errors: string[] = [];
    const q = new AutosaveQueue<string>("a");
    q.update("b", "b", {
      save: async () => (fail ? { success: false, error: "nope" } : { success: true }),
      onError: (m) => errors.push(m),
    });
    expect(await q.flush()).toBe(false);
    expect(errors).toEqual(["nope"]);
    fail = false;
    expect(await q.flush()).toBe(true);
  });
});
