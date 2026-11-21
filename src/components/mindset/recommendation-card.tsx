"use client";

import { Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDuration, type EnvironmentId } from "@/domain/mindset/options";
import type { MindsetRecommendation } from "@/domain/mindset/recommendations";
import { ENV_THEME } from "@/components/mindset/environment-backdrop";

/**
 * A personalized session suggested by recurring Edge Review findings. Always
 * optional: start it, adjust it in the setup, or dismiss it. It never edits
 * the trader's mantras.
 */
export function RecommendationCard({
  env,
  rec,
  mantraCount,
  usesFallback,
  onStart,
  onCustomize,
  onDismiss,
}: {
  env: EnvironmentId;
  rec: MindsetRecommendation;
  mantraCount: number;
  usesFallback: boolean;
  onStart: () => void;
  onCustomize: () => void;
  onDismiss: () => void;
}) {
  const t = ENV_THEME[env];
  return (
    <div className={cn("relative rounded-2xl border p-4 backdrop-blur-md", t.panel)} aria-label="Recommended session">
      <button type="button" onClick={onDismiss} aria-label="Dismiss recommendation" className={cn("absolute top-3 right-3 rounded-full p-1 hover:bg-white/10", t.muted)}>
        <X className="size-4" />
      </button>
      <p className={cn("flex items-center gap-1.5 text-[11px] tracking-[0.18em] uppercase", t.accent)}>
        <Sparkles className="size-3.5" /> From your Edge Reviews
      </p>
      <p className={cn("mt-2 pr-6 text-sm", t.text)}>Your recent reviews identified {rec.areaLabel} as an area for improvement.</p>
      <p className={cn("mt-1 font-serif text-xl", t.text)}>
        {rec.title} — {formatDuration(rec.durationSeconds)}
      </p>
      <p className={cn("mt-1 text-xs", t.muted)}>
        {rec.reason} {mantraCount} mantra{mantraCount === 1 ? "" : "s"}
        {usesFallback ? " (suggested for this session — your library has none in these categories)." : ` from your ${rec.categories.join(" & ")} mantras.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onStart} className={cn("rounded-full border px-4 py-1.5 text-sm font-medium", t.button)}>
          Start this session
        </button>
        <button type="button" onClick={onCustomize} className={cn("rounded-full px-3 py-1.5 text-sm", t.muted, "hover:bg-white/10")}>
          Adjust first
        </button>
      </div>
    </div>
  );
}
