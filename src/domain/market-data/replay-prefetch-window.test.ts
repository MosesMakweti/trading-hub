import { describe, expect, it } from "vitest";

import {
  MAX_CHUNK_DAYS,
  computeNextBackgroundChunk,
  computeNextFetchWindow,
  findNextUncoveredChunk,
  mergeLoadedRange,
  type LoadedRange,
} from "@/domain/market-data/replay-prefetch-window";

const DAY_MS = 86_400_000;
const PERIOD_START = Date.UTC(2026, 7, 1);
const PERIOD_END = Date.UTC(2026, 7, 31) + DAY_MS - 1; // whole August, a MONTHLY-sized review

describe("computeNextFetchWindow — rolling priority window around the Clock (§23-24)", () => {
  it("requests a window covering PREFETCH_DAYS_BEHIND/AHEAD around the clock when nothing is loaded yet", () => {
    const clockTime = PERIOD_START + 10 * DAY_MS;
    const window = computeNextFetchWindow([], clockTime, PERIOD_START, PERIOD_END);
    expect(window).not.toBeNull();
    expect(window!.from).toBeLessThanOrEqual(clockTime);
    expect(window!.to).toBeGreaterThanOrEqual(clockTime);
    // Never larger than the review period.
    expect(window!.from).toBeGreaterThanOrEqual(PERIOD_START);
    expect(window!.to).toBeLessThanOrEqual(PERIOD_END);
  });

  it("clamps the window at the review period's boundaries (clock near the very start)", () => {
    const window = computeNextFetchWindow([], PERIOD_START, PERIOD_START, PERIOD_END);
    expect(window!.from).toBe(PERIOD_START);
  });

  it("returns null once the rolling window is fully covered", () => {
    const clockTime = PERIOD_START + 10 * DAY_MS;
    const window = computeNextFetchWindow([], clockTime, PERIOD_START, PERIOD_END)!;
    const loaded: LoadedRange[] = [window];
    expect(computeNextFetchWindow(loaded, clockTime, PERIOD_START, PERIOD_END)).toBeNull();
  });

  it("never returns a range wider than the review period even for a huge period", () => {
    const hugeEnd = PERIOD_START + 400 * DAY_MS;
    const window = computeNextFetchWindow([], PERIOD_START + 200 * DAY_MS, PERIOD_START, hugeEnd)!;
    expect(window.to - window.from).toBeLessThan(10 * DAY_MS);
  });
});

describe("computeNextBackgroundChunk — low-priority whole-period sweep (§23-24)", () => {
  it("returns a bounded (<= MAX_CHUNK_DAYS) chunk starting at periodStart when nothing is loaded", () => {
    const chunk = computeNextBackgroundChunk([], PERIOD_START, PERIOD_END)!;
    expect(chunk.from).toBe(PERIOD_START);
    expect(chunk.to - chunk.from).toBeLessThanOrEqual(MAX_CHUNK_DAYS * DAY_MS - 1);
  });

  it("advances past already-loaded ranges to find the next gap", () => {
    const firstChunk = computeNextBackgroundChunk([], PERIOD_START, PERIOD_END)!;
    const loaded = mergeLoadedRange([], firstChunk);
    const secondChunk = computeNextBackgroundChunk(loaded, PERIOD_START, PERIOD_END)!;
    expect(secondChunk.from).toBeGreaterThan(firstChunk.to);
  });

  it("eventually covers the whole period when repeatedly applied", () => {
    let loaded: LoadedRange[] = [];
    for (let i = 0; i < 20; i += 1) {
      const chunk = computeNextBackgroundChunk(loaded, PERIOD_START, PERIOD_END);
      if (!chunk) break;
      loaded = mergeLoadedRange(loaded, chunk);
    }
    expect(computeNextBackgroundChunk(loaded, PERIOD_START, PERIOD_END)).toBeNull();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual({ from: PERIOD_START, to: PERIOD_END });
  });

  it("returns null for an inverted range", () => {
    expect(computeNextBackgroundChunk([], PERIOD_END, PERIOD_START)).toBeNull();
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
