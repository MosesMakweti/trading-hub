/**
 * The Replay Clock (Stage 13 §9-10) — pure state + transitions. This is
 * intentionally NOT a React hook or a class: every function here is
 * `(state, ...) => newState`, so it's trivially unit-testable and framework-
 * agnostic (a future non-React surface could reuse it unchanged).
 *
 * DURABLE vs TRANSIENT split (§9-10): only `currentTime`/`asset`/`timeframe`
 * are ever worth persisting as a resume point (see
 * ReplayReviewSession.replayCurrent* columns) — `playback`/`speed` are
 * per-session UI state that always starts PAUSED/1x on reload, never
 * written to Prisma. Persistence happens via explicit checkpoints (pause,
 * asset/timeframe switch, navigating away) — never on every animation frame.
 *
 * GAP SAFETY (§21/§28): every transition here operates over an
 * `availableTimestamps` array — the real close-times of candles that exist
 * for the current asset/base-timeframe — never continuous arithmetic like
 * "+1 minute". A weekend, holiday, or provider gap is therefore simply
 * absent from that array, so the clock naturally skips to the next candle
 * that actually exists. Nothing here ever fabricates a timestamp.
 */
import type { Timeframe } from "@/domain/market-data/timeframe";

export type PlaybackState = "PAUSED" | "PLAYING" | "FINISHED";
export const PLAYBACK_SPEEDS = [1, 2, 5, 10] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface ReplayClockState {
  /** The review period's boundaries (UTC ms, inclusive) — the clock never
   *  moves outside this range regardless of how much market data exists. */
  periodStart: number;
  periodEnd: number;
  /** UTC ms — the current historical replay instant (a closed-candle time). */
  currentTime: number;
  asset: string;
  timeframe: Timeframe;
  playback: PlaybackState;
  speed: PlaybackSpeed;
}

function firstAvailableFrom(timestamps: number[], from: number, to: number): number | null {
  const candidates = timestamps.filter((t) => t >= from && t <= to).sort((a, b) => a - b);
  return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Replay session start behavior (§24): position at the FIRST available
 * candle at or after the period start — never at "the first actual trade,"
 * and never fabricated if the period opens on a market-closed boundary
 * (weekend/holiday) — it advances to whatever real data exists next.
 */
export function jumpToStart(state: ReplayClockState, availableTimestamps: number[]): ReplayClockState {
  const first = firstAvailableFrom(availableTimestamps, state.periodStart, state.periodEnd);
  return { ...state, currentTime: first ?? state.periodStart, playback: "PAUSED" };
}

export function advanceToNextCandle(state: ReplayClockState, availableTimestamps: number[]): ReplayClockState {
  const next = firstAvailableFrom(availableTimestamps, state.currentTime + 1, state.periodEnd);
  if (next == null) return { ...state, playback: "FINISHED" };
  return { ...state, currentTime: next };
}

export function retreatToPreviousCandle(state: ReplayClockState, availableTimestamps: number[]): ReplayClockState {
  const candidates = availableTimestamps.filter((t) => t < state.currentTime).sort((a, b) => a - b);
  if (candidates.length === 0) return state;
  const prev = candidates[candidates.length - 1];
  return { ...state, currentTime: prev, playback: state.playback === "FINISHED" ? "PAUSED" : state.playback };
}

/** No-op once FINISHED — there's nothing left to play without fabricating data. */
export function play(state: ReplayClockState): ReplayClockState {
  return state.playback === "FINISHED" ? state : { ...state, playback: "PLAYING" };
}

export function pause(state: ReplayClockState): ReplayClockState {
  return { ...state, playback: "PAUSED" };
}

export function setSpeed(state: ReplayClockState, speed: PlaybackSpeed): ReplayClockState {
  return { ...state, speed };
}

/**
 * Asset switch (§15/§28) — `currentTime` is an absolute instant, independent
 * of which asset is selected, so it never needs to change on its own. What
 * DOES need resolving is which of the new asset's candles to treat as "the
 * current one," since different assets can have different available
 * timestamps (different hours, different gaps). Snaps to the nearest
 * available candle AT OR BEFORE `currentTime` — never forward, which would
 * silently reveal that asset's future relative to the trader's actual
 * position. Only falls forward (to the new asset's very first candle) when
 * NOTHING exists at or before `currentTime` — an explicit, narrow fallback
 * so the clock is never left pointing at a asset/time with no data at all.
 */
export function changeAsset(state: ReplayClockState, asset: string, availableTimestampsForAsset: number[]): ReplayClockState {
  const atOrBefore = availableTimestampsForAsset.filter((t) => t <= state.currentTime).sort((a, b) => b - a);
  const resolved = atOrBefore[0] ?? availableTimestampsForAsset.slice().sort((a, b) => a - b)[0] ?? state.currentTime;
  return { ...state, asset, currentTime: resolved, playback: "PAUSED" };
}

/** Timeframe switch (§16) — a pure display/aggregation concern; `currentTime`
 *  never moves, so the new timeframe's chart reveals exactly the same
 *  historical instant, just bucketed differently (see visible-candles.ts's
 *  `buildHigherTimeframeView` for the higher-timeframe safety rule this
 *  depends on). */
export function changeTimeframe(state: ReplayClockState, timeframe: Timeframe): ReplayClockState {
  return { ...state, timeframe };
}

/** The durable resume-point subset of a clock state (§10). */
export interface ReplayResumePoint {
  currentTime: number;
  asset: string;
  timeframe: Timeframe;
}

export function toResumePoint(state: ReplayClockState): ReplayResumePoint {
  return { currentTime: state.currentTime, asset: state.asset, timeframe: state.timeframe };
}
