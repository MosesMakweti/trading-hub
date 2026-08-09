import { AlertTriangle, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SetupRating } from "@/domain/trades/setup-score";

// Semantic quality bands via reserved tokens (no hardcoded hues): A+/A/B read as
// good (success), C as marginal (warning), Low as poor (danger). The letter badge
// carries the finer A↔B↔C distinction; color stays a restrained accent.
const RATING_TONE: Record<SetupRating, { text: string; bar: string; ring: string; label: string }> = {
  "A+": { text: "text-success", bar: "bg-success", ring: "border-success/30 bg-success/10", label: "A+" },
  A: { text: "text-success", bar: "bg-success", ring: "border-success/30 bg-success/10", label: "A" },
  B: { text: "text-success", bar: "bg-success", ring: "border-success/30 bg-success/10", label: "B" },
  C: { text: "text-warning", bar: "bg-warning", ring: "border-warning/30 bg-warning/10", label: "C" },
  LOW: { text: "text-danger", bar: "bg-danger", ring: "border-danger/30 bg-danger/10", label: "Low quality" },
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
          "rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm",
          className,
        )}
      >
        <div className="flex items-center gap-2 font-medium text-danger">
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
