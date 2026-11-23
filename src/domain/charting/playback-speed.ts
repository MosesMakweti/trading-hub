/**
 * Playback speed and playback interval — two independent controls (pure).
 *
 * - Playback INTERVAL: how much market time one playback step reveals
 *   (M1 = one minute of data per step). Offered only where the data has that
 *   resolution: MT5 exports are 1-minute bars, so second intervals are listed
 *   but unavailable — never simulated.
 * - Playback SPEED: real time between two steps (500 ms/bar). It never moves
 *   the replay position, never loads data; it only paces the scheduler.
 *
 * The speed slider uses fixed stops on a roughly logarithmic scale: fine
 * control where it matters (100–1000 ms), coarse at the slow end.
 */
import { MAX_SPEED_MS, MIN_SPEED_MS, type PlaybackTimeframe } from "./workspace";

export const SPEED_STOPS_MS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10_000, 15_000, 20_000, 30_000, 60_000] as const;

export const clampSpeed = (ms: number) => Math.min(MAX_SPEED_MS, Math.max(MIN_SPEED_MS, Math.round(ms)));

/** Slider position (index into the stops) for a speed — the nearest stop on a log scale. */
export function speedToPosition(ms: number): number {
  const v = Math.log(clampSpeed(ms));
  let best = 0;
  for (let i = 1; i < SPEED_STOPS_MS.length; i++) if (Math.abs(Math.log(SPEED_STOPS_MS[i]) - v) < Math.abs(Math.log(SPEED_STOPS_MS[best]) - v)) best = i;
  return best;
}

export function positionToSpeed(position: number): number {
  const i = Math.min(SPEED_STOPS_MS.length - 1, Math.max(0, Math.round(position)));
  return SPEED_STOPS_MS[i];
}

/** "500 ms", "1 s", "1.5 s", "1 min". */
export function formatSpeed(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${+(ms / 1000).toFixed(2)} s`;
  return `${+(ms / 60_000).toFixed(2)} min`;
}

export interface PlaybackInterval {
  id: string;
  label: string;
  seconds: number;
  /** The replay timeframe that steps by this interval (null: finer than the data). */
  timeframe: PlaybackTimeframe | null;
}

export const PLAYBACK_INTERVALS: PlaybackInterval[] = [
  { id: "S1", label: "1s", seconds: 1, timeframe: null },
  { id: "S5", label: "5s", seconds: 5, timeframe: null },
  { id: "S15", label: "15s", seconds: 15, timeframe: null },
  { id: "S30", label: "30s", seconds: 30, timeframe: null },
  { id: "M1", label: "1m", seconds: 60, timeframe: "M1" },
  { id: "M2", label: "2m", seconds: 120, timeframe: "M2" },
  { id: "M3", label: "3m", seconds: 180, timeframe: "M3" },
  { id: "M5", label: "5m", seconds: 300, timeframe: "M5" },
  { id: "M10", label: "10m", seconds: 600, timeframe: "M10" },
  { id: "M15", label: "15m", seconds: 900, timeframe: "M15" },
  { id: "M30", label: "30m", seconds: 1800, timeframe: "M30" },
  { id: "H1", label: "1h", seconds: 3600, timeframe: "H1" },
];

/**
 * Whether an interval can be played from data of `dataResolutionSeconds`
 * (60 for MT5 M1 exports): it must be a whole multiple of the data's bar.
 */
export function intervalAvailable(i: PlaybackInterval, dataResolutionSeconds: number): boolean {
  return i.timeframe != null && i.seconds >= dataResolutionSeconds && i.seconds % dataResolutionSeconds === 0;
}

export const intervalLabel = (tf: PlaybackTimeframe) => PLAYBACK_INTERVALS.find((i) => i.timeframe === tf)?.label ?? tf;
