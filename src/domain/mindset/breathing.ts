/** Mindset — breathing-guide timing (pure). Drives the animated circle. */
import type { BreathingPattern } from "@/domain/mindset/options";

export type BreathStep = "inhale" | "holdIn" | "exhale" | "holdOut";

export const BREATH_STEP_LABEL: Record<BreathStep, string> = {
  inhale: "Breathe in",
  holdIn: "Pause gently",
  exhale: "Breathe out",
  holdOut: "Rest",
};

export function breathingTotalMs(p: BreathingPattern): number {
  return (p.inhale + p.holdIn + p.exhale + p.holdOut) * p.cycles * 1000;
}

export interface BreathState {
  step: BreathStep;
  /** 0–1 progress through the current step. */
  stepProgress: number;
  /** Seconds left in the current step (rounded up, for the countdown). */
  secondsLeft: number;
  /** 0 (empty) – 1 (full) circle size. */
  scale: number;
  /** 1-based cycle number. */
  cycle: number;
  done: boolean;
}

/** Where in the pattern `ms` falls. Zero-length steps are skipped. */
export function breathAt(p: BreathingPattern, ms: number): BreathState {
  const steps: [BreathStep, number][] = (
    [
      ["inhale", p.inhale],
      ["holdIn", p.holdIn],
      ["exhale", p.exhale],
      ["holdOut", p.holdOut],
    ] as [BreathStep, number][]
  ).filter(([, s]) => s > 0);
  const cycleMs = steps.reduce((sum, [, s]) => sum + s * 1000, 0);
  if (ms >= breathingTotalMs(p) || cycleMs === 0) {
    return { step: "exhale", stepProgress: 1, secondsLeft: 0, scale: 0, cycle: p.cycles, done: true };
  }
  const cycle = Math.floor(ms / cycleMs) + 1;
  let t = ms % cycleMs;
  for (const [step, seconds] of steps) {
    const len = seconds * 1000;
    if (t < len) {
      const progress = t / len;
      // Ease in/out so the circle breathes rather than ticks.
      const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
      const scale = step === "inhale" ? eased : step === "exhale" ? 1 - eased : step === "holdIn" ? 1 : 0;
      return { step, stepProgress: progress, secondsLeft: Math.ceil((len - t) / 1000), scale, cycle, done: false };
    }
    t -= len;
  }
  return { step: "exhale", stepProgress: 1, secondsLeft: 0, scale: 0, cycle, done: false };
}
