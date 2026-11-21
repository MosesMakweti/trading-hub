"use client";

import { cn } from "@/lib/utils";
import { BREATH_STEP_LABEL, breathAt } from "@/domain/mindset/breathing";
import type { BreathingPattern, EnvironmentId } from "@/domain/mindset/options";
import { ENV_THEME } from "@/components/mindset/environment-backdrop";

/**
 * The animated breathing circle. Size and label are derived from elapsed
 * time (domain/mindset/breathing) — no timers of its own, so it pauses and
 * resumes exactly with the session.
 */
export function BreathingGuide({ pattern, elapsedMs, environment, paused, onSkip }: { pattern: BreathingPattern; elapsedMs: number; environment: EnvironmentId; paused: boolean; onSkip: () => void }) {
  const theme = ENV_THEME[environment];
  const b = breathAt(pattern, elapsedMs);
  const size = 0.45 + 0.55 * b.scale; // never fully collapses
  const glow = environment === "NATURE" ? "rgba(166,207,159," : "rgba(134,203,214,";

  return (
    <div className="flex flex-col items-center gap-10 text-center">
      <div className="relative flex size-[min(70vw,22rem)] items-center justify-center" aria-hidden>
        <div className={cn("absolute inset-0 rounded-full border", theme.ring)} />
        <div
          className="absolute rounded-full transition-[width,height] duration-150 ease-linear"
          style={{
            width: `${size * 100}%`,
            height: `${size * 100}%`,
            background: `radial-gradient(circle, ${glow}0.32) 0%, ${glow}0.12) 60%, ${glow}0.02) 100%)`,
            boxShadow: `0 0 ${40 + 60 * b.scale}px ${glow}${0.12 + 0.18 * b.scale})`,
          }}
        />
      </div>
      <div className="space-y-2" aria-live="polite">
        <p className={cn("font-serif text-3xl tracking-wide sm:text-4xl", theme.text)}>{paused ? "Paused" : BREATH_STEP_LABEL[b.step]}</p>
        <p className={cn("text-sm", theme.muted)}>
          {b.secondsLeft > 0 && !paused ? `${b.secondsLeft}` : " "} · breath {Math.min(b.cycle, pattern.cycles)} of {pattern.cycles}
        </p>
      </div>
      <button type="button" onClick={onSkip} className={cn("rounded-full border px-4 py-1.5 text-sm transition-colors", theme.button)}>
        Skip to mantras
      </button>
      <p className={cn("max-w-sm text-xs", theme.muted)}>Breathe at a comfortable pace. If anything feels uncomfortable, simply breathe normally.</p>
    </div>
  );
}
