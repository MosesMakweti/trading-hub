import { describe, expect, it } from "vitest";

import {
  MAX_CHUNK_DAYS,
  computeNextHistoryChunk,
  findNextUncoveredChunk,
  mergeLoadedRange,
  type LoadedRange,
} from "@/domain/market-data/replay-prefetch-window";

const DAY_MS = 86_400_000;
const PERIOD_START = Date.UTC(2026, 7, 1);
const PERIOD_END = Date.UTC(2026, 7, 31) + DAY_MS - 1; // whole August, a MONTHLY-sized review

describe("computeNextHistoryChunk — read-only history re-fill, bounded to the client's OWN clock position (Prompt 5 §8/§26)", () => {
  it("returns a bounded (<= MAX_CHUNK_DAYS) chunk starting at periodStart when nothing is loaded", () => {
    const clockTime = PERIOD_START + 10 * DAY_MS;
    const chunk = computeNextHistoryChunk([], clockTime, PERIOD_START, PERIOD_END)!;
    expect(chunk.from).toBe(PERIOD_START);
    expect(chunk.to - chunk.from).toBeLessThanOrEqual(MAX_CHUNK_DAYS * DAY_MS - 1);
  });

  it("never sweeps beyond the caller's own current clock position, even though the review period extends further (the core Prompt 5 fix)", () => {
    const clockTime = PERIOD_START + 2 * DAY_MS;
    let loaded: LoadedRange[] = [];
    for (let i = 0; i < 20; i += 1) {
      const chunk = computeNextHistoryChunk(loaded, clockTime, PERIOD_START, PERIOD_END);
      if (!chunk) break;
      loaded = mergeLoadedRange(loaded, chunk);
    }
    // Fully covers up through the clock's own position...
    expect(loaded.some((r) => r.from <= PERIOD_START && r.to >= clockTime)).toBe(true);
    // ...and NEVER requests anything past it, even though PERIOD_END is
    // three weeks further out. This is the exact behavior that replaced
    // the old `PREFETCH_DAYS_AHEAD`/background-sweep-ahead mechanism.
    expect(loaded.every((r) => r.to <= clockTime)).toBe(true);
  });

  it("advances past already-loaded ranges to find the next gap", () => {
    const clockTime = PERIOD_END;
    const firstChunk = computeNextHistoryChunk([], clockTime, PERIOD_START, PERIOD_END)!;
    const loaded = mergeLoadedRange([], firstChunk);
    const secondChunk = computeNextHistoryChunk(loaded, clockTime, PERIOD_START, PERIOD_END)!;
    expect(secondChunk.from).toBeGreaterThan(firstChunk.to);
  });

  it("eventually covers the whole period when the clock has reached the end and repeatedly applied", () => {
    let loaded: LoadedRange[] = [];
    for (let i = 0; i < 20; i += 1) {
      const chunk = computeNextHistoryChunk(loaded, PERIOD_END, PERIOD_START, PERIOD_END);
      if (!chunk) break;
      loaded = mergeLoadedRange(loaded, chunk);
    }
    expect(computeNextHistoryChunk(loaded, PERIOD_END, PERIOD_START, PERIOD_END)).toBeNull();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual({ from: PERIOD_START, to: PERIOD_END });
  });

  it("returns null once the clock-bounded range is fully covered", () => {
    const clockTime = PERIOD_START + 10 * DAY_MS;
    const chunk = computeNextHistoryChunk([], clockTime, PERIOD_START, PERIOD_END);
    let loaded: LoadedRange[] = chunk ? mergeLoadedRange([], chunk) : [];
    while (true) {
      const next = computeNextHistoryChunk(loaded, clockTime, PERIOD_START, PERIOD_END);
      if (!next) break;
      loaded = mergeLoadedRange(loaded, next);
    }
    expect(computeNextHistoryChunk(loaded, clockTime, PERIOD_START, PERIOD_END)).toBeNull();
  });

  it("clamps to the review period when the clock is somehow past periodEnd", () => {
    const chunk = computeNextHistoryChunk([], PERIOD_END + 100 * DAY_MS, PERIOD_START, PERIOD_END)!;
    expect(chunk.to).toBeLessThanOrEqual(PERIOD_END);
  });
});

describe("findNextUncoveredChunk — shared primitive", () => {
  it("batches contiguous uncovered days into one chunk, capped at maxDays", () => {
    const chunk = findNextUncoveredChunk([], PERIOD_START, PERIOD_START + 30 * DAY_MS, 3);
    expect(chunk).toEqual({ from: PERIOD_START, to: PERIOD_START + 3 * DAY_MS - 1 });
  });

  it("skips a covered island in the middle and returns the next uncovered chunk", () => {
    const loaded: LoadedRange[] = [{ from: PERIOD_START + DAY_MS, to: PERIOD_START + 2 * DAY_MS - 1 }];
    const chunk = findNextUncoveredChunk(loaded, PERIOD_START, PERIOD_START + 5 * DAY_MS - 1, 10);
    expect(chunk).toEqual({ from: PERIOD_START, to: PERIOD_START + DAY_MS - 1 });
  });
});

describe("mergeLoadedRange", () => {
  it("coalesces adjacent ranges into one", () => {
    const merged = mergeLoadedRange([{ from: 0, to: DAY_MS - 1 }], { from: DAY_MS, to: 2 * DAY_MS - 1 });
    expect(merged).toEqual([{ from: 0, to: 2 * DAY_MS - 1 }]);
  });

  it("coalesces overlapping ranges", () => {
    const merged = mergeLoadedRange([{ from: 0, to: 5 * DAY_MS }], { from: 3 * DAY_MS, to: 8 * DAY_MS });
    expect(merged).toEqual([{ from: 0, to: 8 * DAY_MS }]);
  });

  it("keeps disjoint ranges separate", () => {
    const merged = mergeLoadedRange([{ from: 0, to: DAY_MS }], { from: 10 * DAY_MS, to: 11 * DAY_MS });
    expect(merged).toEqual([
      { from: 0, to: DAY_MS },
      { from: 10 * DAY_MS, to: 11 * DAY_MS },
    ]);
  });
});
