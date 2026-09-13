import { describe, expect, it } from "vitest";

import {
  advanceToNextCandle,
  changeAsset,
  changeTimeframe,
  jumpToStart,
  pause,
  play,
  retreatToPreviousCandle,
  setSpeed,
  toResumePoint,
  type ReplayClockState,
} from "@/domain/market-data/replay-clock";

const MIN = 60_000;
const START = Date.UTC(2026, 7, 3, 0, 0, 0); // Monday 2026-08-03 00:00 UTC
const END = Date.UTC(2026, 7, 9, 23, 59, 0); // Sunday 2026-08-09 23:59 UTC

function baseState(overrides: Partial<ReplayClockState> = {}): ReplayClockState {
  return {
    periodStart: START,
    periodEnd: END,
    currentTime: START,
    asset: "XAUUSD",
    timeframe: "5m",
    playback: "PAUSED",
    speed: 1,
    ...overrides,
  };
}

describe("jumpToStart — period start behavior (§24)", () => {
  it("positions at the review period start when a candle exists exactly there", () => {
    const state = baseState({ currentTime: START + 999 * MIN });
    const result = jumpToStart(state, [START, START + 5 * MIN]);
    expect(result.currentTime).toBe(START);
    expect(result.playback).toBe("PAUSED");
  });

  it("advances to the first AVAILABLE candle when the period opens on a market-closed boundary", () => {
    // No candle at periodStart itself (e.g. a weekend) — the first real
    // candle is 2 days later. Never fabricates one at periodStart.
    const firstReal = START + 2 * 24 * 60 * MIN;
    const state = baseState();
    const result = jumpToStart(state, [firstReal, firstReal + 5 * MIN]);
    expect(result.currentTime).toBe(firstReal);
  });

  it("falls back to periodStart itself if literally no candle exists in range (never throws)", () => {
    const result = jumpToStart(baseState(), []);
    expect(result.currentTime).toBe(START);
  });
});

describe("advanceToNextCandle / retreatToPreviousCandle", () => {
  const timestamps = [START, START + 5 * MIN, START + 10 * MIN];

  it("moves to the next available candle", () => {
    const result = advanceToNextCandle(baseState({ currentTime: START }), timestamps);
    expect(result.currentTime).toBe(START + 5 * MIN);
  });

  it("skips a gap — advancing never fabricates an intermediate candle", () => {
    // Available candles jump straight from START to START+1h (a gap in between).
    const gappy = [START, START + 60 * MIN];
    const result = advanceToNextCandle(baseState({ currentTime: START }), gappy);
    expect(result.currentTime).toBe(START + 60 * MIN);
  });

  it("period end stops playback — FINISHED, never advances past periodEnd", () => {
    const state = baseState({ currentTime: START + 10 * MIN, periodEnd: START + 10 * MIN });
    const result = advanceToNextCandle(state, timestamps);
    expect(result.playback).toBe("FINISHED");
    expect(result.currentTime).toBe(START + 10 * MIN); // did not move
  });

  it("moves back to the previous available candle", () => {
    const result = retreatToPreviousCandle(baseState({ currentTime: START + 10 * MIN }), timestamps);
    expect(result.currentTime).toBe(START + 5 * MIN);
  });

  it("retreating from the very first candle is a no-op", () => {
    const result = retreatToPreviousCandle(baseState({ currentTime: START }), timestamps);
    expect(result.currentTime).toBe(START);
  });

  it("retreating from FINISHED un-finishes playback back to PAUSED", () => {
    const state = baseState({ currentTime: START + 10 * MIN, playback: "FINISHED" });
    const result = retreatToPreviousCandle(state, timestamps);
    expect(result.playback).toBe("PAUSED");
  });
});

describe("play / pause / speed", () => {
  it("play sets PLAYING", () => {
    expect(play(baseState()).playback).toBe("PLAYING");
  });

  it("play is a no-op once FINISHED — never resumes fabricated playback", () => {
    const state = baseState({ playback: "FINISHED" });
    expect(play(state).playback).toBe("FINISHED");
  });

  it("pause sets PAUSED from any state", () => {
    expect(pause(baseState({ playback: "PLAYING" })).playback).toBe("PAUSED");
  });

  it("setSpeed only changes speed", () => {
    const result = setSpeed(baseState(), 5);
    expect(result.speed).toBe(5);
    expect(result.currentTime).toBe(baseState().currentTime);
  });
});

describe("changeAsset — preserves historical time (§15/§28)", () => {
  it("snaps to the nearest available candle at or before currentTime for the new asset", () => {
    const state = baseState({ asset: "XAUUSD", currentTime: START + 12 * MIN });
    const result = changeAsset(state, "EURUSD", [START, START + 5 * MIN, START + 10 * MIN, START + 15 * MIN]);
    expect(result.asset).toBe("EURUSD");
    expect(result.currentTime).toBe(START + 10 * MIN); // nearest at-or-before, never the 15m one (that would be forward)
  });

  it("never snaps forward past currentTime, even if that means picking an earlier candle", () => {
    const state = baseState({ currentTime: START + 1 * MIN });
    const result = changeAsset(state, "EURUSD", [START, START + 5 * MIN]);
    expect(result.currentTime).toBe(START); // not START+5min
  });

  it("falls forward to the new asset's first candle only when nothing exists at or before currentTime", () => {
    const state = baseState({ currentTime: START });
    const result = changeAsset(state, "EURUSD", [START + 100 * MIN, START + 105 * MIN]);
    expect(result.currentTime).toBe(START + 100 * MIN);
  });

  it("pauses on asset switch", () => {
    const state = baseState({ playback: "PLAYING" });
    const result = changeAsset(state, "EURUSD", [START]);
    expect(result.playback).toBe("PAUSED");
  });
});

describe("changeTimeframe — preserves historical time (§16)", () => {
  it("changes only the timeframe field; currentTime is untouched", () => {
    const state = baseState({ currentTime: START + 42 * MIN, timeframe: "15m" });
    const result = changeTimeframe(state, "1h");
    expect(result.timeframe).toBe("1h");
    expect(result.currentTime).toBe(START + 42 * MIN);
  });
});

describe("toResumePoint", () => {
  it("extracts only the durable-worthy fields — never playback/speed", () => {
    const state = baseState({ currentTime: START + 5 * MIN, asset: "NQ", timeframe: "1h", playback: "PLAYING", speed: 10 });
    expect(toResumePoint(state)).toEqual({ currentTime: START + 5 * MIN, asset: "NQ", timeframe: "1h" });
  });
});
