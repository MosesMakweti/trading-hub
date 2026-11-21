/** Mindset — session options and their sensible defaults (pure, client-safe). */

export const ENVIRONMENTS = {
  NATURE: { label: "Nature / Calm", description: "Forest greens and soft mist — for relaxing and decompressing." },
  FOCUS: { label: "Focus / Clarity", description: "Deep navy and quiet light — for concentration and intent." },
} as const;
export type EnvironmentId = keyof typeof ENVIRONMENTS;

export const DURATION_PRESETS_SECONDS = [180, 300, 600, 900] as const;
export const MANTRA_SECONDS_PRESETS = [5, 10, 15, 20] as const;
export const MIN_SESSION_SECONDS = 60;
export const MAX_SESSION_SECONDS = 60 * 60;
export const MIN_MANTRA_SECONDS = 3;
export const MAX_MANTRA_SECONDS = 120;

/**
 * Ambient sounds. All are generated in the browser with the Web Audio API
 * (components/mindset/ambient-audio.ts) — no audio files ship with the app,
 * so nothing can 404. A future licensed track can add a `src`.
 */
export const SOUNDS = {
  rain: { label: "Gentle rainfall", description: "Soft, steady rain." },
  stream: { label: "Flowing water", description: "A slow stream, rising and falling." },
  ambient: { label: "Ambient pad", description: "Warm, slowly shifting tones." },
  night: { label: "Night ambience", description: "A low pad over quiet air." },
} as const;
export type SoundId = keyof typeof SOUNDS;
export const isSoundId = (v: string): v is SoundId => v in SOUNDS;

/**
 * Breathing patterns, in seconds. Comfortable by default: no pattern forces a
 * long breath-hold (the optional pauses are short and easy). This is a calming
 * exercise, not a medical technique.
 */
export interface BreathingPattern {
  label: string;
  description: string;
  inhale: number;
  holdIn: number;
  exhale: number;
  holdOut: number;
  cycles: number;
}

export const BREATHING_PATTERNS = {
  calm: { label: "Calm", description: "In 4 · out 6", inhale: 4, holdIn: 0, exhale: 6, holdOut: 0, cycles: 6 },
  balanced: { label: "Balanced", description: "In 5 · out 5", inhale: 5, holdIn: 0, exhale: 5, holdOut: 0, cycles: 6 },
  settle: { label: "Settle", description: "In 4 · pause 2 · out 6", inhale: 4, holdIn: 2, exhale: 6, holdOut: 0, cycles: 5 },
  box: { label: "Gentle box", description: "In 4 · pause 2 · out 4 · pause 2", inhale: 4, holdIn: 2, exhale: 4, holdOut: 2, cycles: 5 },
} as const satisfies Record<string, BreathingPattern>;
export type BreathingPatternId = keyof typeof BREATHING_PATTERNS;
export const isBreathingPatternId = (v: string): v is BreathingPatternId => v in BREATHING_PATTERNS;

export interface MindsetPreferences {
  environment: EnvironmentId;
  durationSeconds: number;
  secondsPerMantra: number;
  order: "SEQUENTIAL" | "RANDOM";
  repeat: boolean;
  selectedCategories: string[];
  selectedMantraIds: string[];
  audioEnabled: boolean;
  sound: SoundId;
  volume: number;
  breathingEnabled: boolean;
  breathingPattern: BreathingPatternId;
}

export const DEFAULT_PREFERENCES: MindsetPreferences = {
  environment: "NATURE",
  durationSeconds: 300,
  secondsPerMantra: 10,
  order: "SEQUENTIAL",
  repeat: true,
  selectedCategories: [],
  selectedMantraIds: [],
  audioEnabled: true,
  sound: "rain",
  volume: 60,
  breathingEnabled: true,
  breathingPattern: "calm",
};

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, "0")}`;
}
