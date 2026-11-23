import { describe, expect, it } from "vitest";

import { pace, paceIdle, startPacer, type Pacer } from "./playback-scheduler";

/**
 * Simulates the consumer loop: steps become available at `arrivals` times
 * (one each); the loop sleeps as asked (min 1 ms). Returns when each was shown.
 */
function simulate(arrivals: number[], until: number, interval: (now: number) => number): number[] {
  let p: Pacer = startPacer();
  let now = 0;
  let ready = 0;
  const shown: number[] = [];
  while (now < until && shown.length < arrivals.length) {
    while (ready < arrivals.length && arrivals[ready] <= now) ready++;
    if (ready === shown.length) {
      p = paceIdle(p, now, interval(now));
      now += 1;
      continue;
    }
    const d = pace(p, now, interval(now));
    if (d.kind === "wait") {
      now += Math.max(1, Math.min(d.ms, 25)); // the loop re-checks at least every 25 ms
      continue;
    }
    p = d.pacer;
    shown.push(now);
  }
  return shown;
}

const allAt = (t: number, n: number) => Array.from({ length: n }, () => t);
const gaps = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);

describe("playback pacing", () => {
  it("shows a batch one step per interval — never several at once", () => {
    const shown = simulate(allAt(0, 20), 10_000, () => 500); // 20 steps arrive together
    expect(shown).toHaveLength(20);
    expect(gaps(shown).every((g) => g === 500)).toBe(true);
  });

  it("5 ms per step: 200 steps in a second, evenly", () => {
    const shown = simulate(allAt(0, 200), 2_000, () => 5);
    expect(shown[199]).toBe(995);
    expect(gaps(shown).every((g) => g === 5)).toBe(true);
  });

  it("waiting on the server doesn't cause a catch-up burst", () => {
    // 3 steps, then the next batch of 5 arrives 400 ms late.
    const shown = simulate([...allAt(0, 3), ...allAt(600, 5)], 10_000, () => 100);
    expect(shown.slice(0, 3)).toEqual([0, 100, 200]);
    expect(shown[3]).toBe(600); // first of the late batch at once…
    expect(gaps(shown.slice(3)).every((g) => g === 100)).toBe(true); // …then the normal pace
  });

  it("scenario D: 500 ms → 100 ms while playing — applies at once, every step exactly once", () => {
    const shown = simulate(allAt(0, 40), 20_000, (now) => (now < 2_100 ? 500 : 100));
    expect(shown).toHaveLength(40);
    expect(new Set(shown).size).toBe(40);
    const before = shown.filter((t) => t < 2_100);
    expect(before).toEqual([0, 500, 1000, 1500, 2000]);
    // The next step comes one NEW interval after the last one (2000 + 100), not after the old one.
    expect(shown[5]).toBe(2_100);
    expect(gaps(shown.slice(5)).every((g) => g === 100)).toBe(true);
  });

  it("falls behind gracefully: slows down instead of jumping ahead", () => {
    let p: Pacer = { last: 0 };
    const d = pace(p, 5_000, 10); // 5 s late at 10 ms/step
    expect(d.kind).toBe("show");
    p = (d as Extract<typeof d, { kind: "show" }>).pacer;
    expect(p.last).toBe(5_000); // re-anchored: the next is 10 ms from now, not 500 steps owed
    expect(pace(p, 5_001, 10)).toEqual({ kind: "wait", ms: 9 });
  });
});
