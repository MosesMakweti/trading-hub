"use client";

import { Controller, type Control } from "react-hook-form";

import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { PRE_TRADE_MOOD_MAX_INTENSITY, PRE_TRADE_MOOD_MIN_INTENSITY, PRE_TRADE_MOOD_TAGS, PRE_TRADE_MOOD_TAG_LABELS } from "@/domain/psychology/pre-trade-mood";
import type { TradeFormValues } from "@/lib/validation/trades";

const INTENSITY_LEVELS = Array.from(
  { length: PRE_TRADE_MOOD_MAX_INTENSITY - PRE_TRADE_MOOD_MIN_INTENSITY + 1 },
  (_, i) => PRE_TRADE_MOOD_MIN_INTENSITY + i,
);

/**
 * Pre-Trade Mood Snapshot (Stage 5) — a fast, unscored, moment-in-time
 * emotional check-in. Deliberately not the deep Post-Trade Honest
 * Questionnaire (PsychologyQuestionnaire) — no scoring, no grade, just tags +
 * intensity + an optional note, fast enough to fill while a setup is live.
 */
export function PreTradeMood({ control }: { control: Control<TradeFormValues> }) {
  return (
    <section className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Pre-Trade Mood</h2>
        <span className="text-xs text-muted-foreground/60">What are you feeling/thinking right now?</span>
      </div>

      <Controller
        control={control}
        name="preTradeMoodTags"
        render={({ field }) => {
          const selected = new Set((field.value ?? []) as string[]);
          const toggle = (tag: string) => {
            const next = new Set(selected);
            if (next.has(tag)) next.delete(tag);
            else next.add(tag);
            field.onChange(Array.from(next));
          };
          return (
            <div className="flex flex-wrap gap-2">
              {PRE_TRADE_MOOD_TAGS.map((tag) => {
                const on = selected.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggle(tag)}
                    aria-pressed={on}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {PRE_TRADE_MOOD_TAG_LABELS[tag]}
                  </button>
                );
              })}
            </div>
          );
        }}
      />

      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">Intensity</span>
        <Controller
          control={control}
          name="preTradeMoodIntensity"
          render={({ field }) => (
            <div className="flex gap-1.5">
              {INTENSITY_LEVELS.map((level) => {
                const on = field.value === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => field.onChange(on ? null : level)}
                    aria-pressed={on}
                    aria-label={`Intensity ${level}`}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border text-sm font-medium transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
          )}
        />
      </div>

      <Controller
        control={control}
        name="preTradeMoodNote"
        render={({ field }) => (
          <Textarea
            rows={2}
            placeholder="What are you feeling/thinking right now? (optional)"
            value={field.value ?? ""}
            onChange={(e) => field.onChange(e.target.value)}
          />
        )}
      />
    </section>
  );
}
