import { AlertTriangle, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SetupRating } from "@/domain/trades/setup-score";

const RATING_TONE: Record<SetupRating, { text: string; bar: string; ring: string; label: string }> = {
  "A+": { text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", ring: "border-emerald-500/30 bg-emerald-500/10", label: "A+" },
  A: { text: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", ring: "border-emerald-500/30 bg-emerald-500/10", label: "A" },
  B: { text: "text-teal-600 dark:text-teal-400", bar: "bg-teal-500", ring: "border-teal-500/30 bg-teal-500/10", label: "B" },
  C: { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500", ring: "border-amber-500/30 bg-amber-500/10", label: "C" },
  LOW: { text: "text-rose-600 dark:text-rose-400", bar: "bg-rose-500", ring: "border-rose-500/30 bg-rose-500/10", label: "Low quality" },
};

/** Compact setup-quality rating pill (A+/A/B/C/Low). */
export function RatingBadge({ rating, className }: { rating: SetupRating; className?: string }) {
  const t = RATING_TONE[rating];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        t.ring,
        t.text,
        className,
      )}
    >
      {t.label}
    </span>
  );
}

/**
 * Setup Quality card — the weighted confluence probability score + rating, or the
 * "Invalid Setup" state when a mandatory (core) confluence is missing. A discipline
 * / setup-quality measure, NOT a market-direction prediction.
 */
export function SetupScoreCard({
  score,
  rating,
  valid,
  missingMandatory,
  className,
}: {
  score: number | null;
  rating: SetupRating | null;
  valid: boolean | null;
  missingMandatory: string[];
  className?: string;
}) {
  if (valid === false) {
    return (
      <div
        className={cn(
          "rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm",
          className,
        )}
      >
        <div className="flex items-center gap-2 font-medium text-rose-600 dark:text-rose-400">
          <AlertTriangle className="size-4" />
          Invalid Setup — Missing Core Requirement
        </div>
        {missingMandatory.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Missing mandatory: {missingMandatory.join(", ")}
          </p>
        )}
      </div>
    );
  }

  if (score == null) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        Add weights to this strategy&apos;s confluences to score setup quality.
      </p>
    );
  }

  const tone = rating ? RATING_TONE[rating] : RATING_TONE.LOW;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Setup quality
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-lg font-semibold tabular-nums", tone.text)}>{score}%</span>
          {rating && <RatingBadge rating={rating} />}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", tone.bar)}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}
