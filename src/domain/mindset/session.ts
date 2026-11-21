/**
 * Mindset — the meditation session state machine (pure reducer).
 *
 * All timing is derived from `TICK { dt }` deltas the component feeds from a
 * single animation-frame loop, so pausing, tab switches and repeated clicks
 * can't double-advance or corrupt the session: every transition is a pure
 * function of (state, action). Ticks while paused or complete are ignored and
 * a single tick is clamped, so a throttled background tab can't fast-forward.
 */
import { breathingTotalMs } from "@/domain/mindset/breathing";
import type { BreathingPattern } from "@/domain/mindset/options";

export type SessionPhase = "breathing" | "mantras" | "complete";

export interface SessionConfig {
  durationMs: number;
  slideMs: number;
  mantraCount: number;
  order: "SEQUENTIAL" | "RANDOM";
  repeat: boolean;
  breathing: BreathingPattern | null;
  /** Seed for the randomized order (deterministic in tests). */
  seed: number;
}

export interface SessionState {
  phase: SessionPhase;
  paused: boolean;
  /** Active time spent (pauses excluded) — counts toward the duration. */
  activeMs: number;
  breathingMs: number;
  /** Order of mantra indices for the current pass. */
  playlist: number[];
  /** Position in the playlist. */
  position: number;
  slideMs: number;
  /** Completed passes through the playlist. */
  passes: number;
  rngState: number;
  endedEarly: boolean;
}

export type SessionAction =
  | { type: "TICK"; dt: number }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "TOGGLE_PAUSE" }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "SKIP_BREATHING" }
  | { type: "END" };

export const MAX_TICK_MS = 500;

/** Small, fast, seedable PRNG (mulberry32). Returns [value 0–1, next state]. */
export function nextRandom(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/**
 * The order for one pass. RANDOM is a Fisher–Yates shuffle that never starts
 * a new pass with the mantra that just ended the previous one.
 */
export function buildPlaylist(count: number, order: "SEQUENTIAL" | "RANDOM", rngState: number, avoidFirst?: number): [number[], number] {
  const list = Array.from({ length: count }, (_, i) => i);
  if (order === "SEQUENTIAL" || count < 2) return [list, rngState];
  let s = rngState;
  for (let i = count - 1; i > 0; i--) {
    const [r, n] = nextRandom(s);
    s = n;
    const j = Math.floor(r * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  if (avoidFirst !== undefined && list[0] === avoidFirst) [list[0], list[1]] = [list[1], list[0]];
  return [list, s];
}

/**
 * Breathing runs for its full pattern, but never more than half the session,
 * so a short session always reaches the mantras.
 */
export function breathingLimitMs(config: SessionConfig): number {
  return config.breathing ? Math.min(breathingTotalMs(config.breathing), Math.floor(config.durationMs / 2)) : 0;
}

export function initialSession(config: SessionConfig): SessionState {
  const [playlist, rngState] = buildPlaylist(config.mantraCount, config.order, config.seed);
  return {
    phase: config.breathing ? "breathing" : config.mantraCount > 0 ? "mantras" : "complete",
    paused: false,
    activeMs: 0,
    breathingMs: 0,
    playlist,
    position: 0,
    slideMs: 0,
    passes: 0,
    rngState,
    endedEarly: false,
  };
}

function complete(state: SessionState, early = false): SessionState {
  return { ...state, phase: "complete", paused: false, endedEarly: early };
}

/** Move to the next mantra; wraps into a new pass, or completes without repeat. */
function advance(state: SessionState, config: SessionConfig, manual: boolean): SessionState {
  const nextPos = state.position + 1;
  if (nextPos < state.playlist.length) return { ...state, position: nextPos, slideMs: 0 };
  if (!config.repeat) return manual ? state : complete(state);
  const last = state.playlist[state.playlist.length - 1];
  const [playlist, rngState] = buildPlaylist(config.mantraCount, config.order, state.rngState, last);
  return { ...state, playlist, rngState, position: 0, slideMs: 0, passes: state.passes + 1 };
}

function startMantras(state: SessionState, config: SessionConfig): SessionState {
  return config.mantraCount > 0 ? { ...state, phase: "mantras", slideMs: 0 } : complete(state);
}

export function sessionReducer(config: SessionConfig) {
  return (state: SessionState, action: SessionAction): SessionState => {
    if (state.phase === "complete") return state;
    switch (action.type) {
      case "PAUSE":
        return state.paused ? state : { ...state, paused: true };
      case "RESUME":
        return state.paused ? { ...state, paused: false } : state;
      case "TOGGLE_PAUSE":
        return { ...state, paused: !state.paused };
      case "END":
        return complete(state, true);
      case "SKIP_BREATHING":
        return state.phase === "breathing" ? startMantras(state, config) : state;
      case "PREV":
        return state.phase === "mantras" ? { ...state, position: Math.max(0, state.position - 1), slideMs: 0 } : state;
      case "NEXT":
        return state.phase === "mantras" ? advance(state, config, true) : state;
      case "TICK": {
        if (state.paused || !(action.dt > 0)) return state;
        const dt = Math.min(action.dt, MAX_TICK_MS);
        let next: SessionState = { ...state, activeMs: state.activeMs + dt };
        if (next.activeMs >= config.durationMs) return complete(next);
        if (next.phase === "breathing") {
          next = { ...next, breathingMs: next.breathingMs + dt };
          if (config.breathing && next.breathingMs >= breathingLimitMs(config)) next = startMantras(next, config);
          return next;
        }
        next = { ...next, slideMs: next.slideMs + dt };
        return next.slideMs >= config.slideMs ? advance(next, config, false) : next;
      }
    }
  };
}

/** The mantra index currently on screen. */
export const currentMantraIndex = (s: SessionState): number | null => (s.phase === "mantras" ? (s.playlist[s.position] ?? null) : null);
