import { describe, expect, it } from "vitest";

import { changeSpeed, planPlayback, startPlayback, type PlaybackClock } from "./playback-scheduler";

/** Simulates the player loop: a step takes `cost(i)` ms; waits are exact. Returns bars per step. */
function simulate(c: PlaybackClock, until: number, cost: (i: number) => number, maxBatch = 120) {
  let now = c.start;
  let lastStepAt = now;
  const steps: number[] = [];
  while (now < until) {
    const p = planPlayback(c, now, maxBatch);
    if (p.kind === "wait") {
      now += p.ms;
      continue;
    }
    steps.push(p.count);
    lastStepAt = now;
    c = p.clock;
    now += cost(steps.length);
  }
  return { steps, clock: c, lastStepAt };
}

describe("playback scheduler", () => {
  it("first bar immediately, then exactly one bar per interval with no drift", () => {
    const { steps } = simulate(startPlayback(0, 500), 10_000, () => 37); // 37 ms per step
    expect(steps.every((n) => n === 1)).toBe(true);
    expect(steps.length).toBe(20); // bars at 0, 500, …, 9500
  });

  it("a slow server is caught up by batching — total bars still match elapsed time (nothing skipped)", () => {
    const { steps, lastStepAt } = simulate(startPlayback(0, 100), 10_000, () => 230); // each step 230 ms at 100 ms/bar
    const total = steps.reduce((a, b) => a + b, 0);
    expect(Math.max(...steps)).toBeGreaterThan(1);
    expect(total).toBe(Math.floor(lastStepAt / 100) + 1); // exactly every bar due by the last request
  });

  it("drops the backlog instead of jumping when hopelessly behind", () => {
    const { steps } = simulate(startPlayback(0, 10), 5_000, (i) => (i === 3 ? 3_000 : 5), 50);
    expect(Math.max(...steps)).toBe(50);
    const after = steps.slice(steps.indexOf(50) + 1);
    expect(after.every((n) => n <= 2)).toBe(true); // back to steady pacing
  });

  it("changing speed mid-playback: next bar one new interval later, no burst", () => {
    let c = startPlayback(0, 1000);
    let p = planPlayback(c, 0);
    expect(p).toMatchObject({ kind: "step", count: 1 });
    c = (p as Extract<typeof p, { kind: "step" }>).clock;
    c = changeSpeed(c, 400, 100);
    expect(planPlayback(c, 450)).toEqual({ kind: "wait", ms: 50 });
    p = planPlayback(c, 500);
    expect(p).toMatchObject({ kind: "step", count: 1 });
  });
});
