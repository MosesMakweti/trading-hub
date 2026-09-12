import { cn } from "@/lib/utils";
import { PRE_TRADE_MOOD_TAG_LABELS, type PreTradeMoodTagValue } from "@/domain/psychology/pre-trade-mood";

/**
 * Read-only recap of the Stage 5 Pre-Trade Mood Snapshot — used both in the
 * Trade Idea workspace section and the Journal's compact trade rows (Stage 9
 * §10). Deliberately concise: tags + intensity + a one-line note, no editing.
 */
export function PreTradeMoodRecap({
  tags,
  intensity,
  note,
  compact = false,
}: {
  tags: string[];
  intensity: number | null;
  note: string | null;
  compact?: boolean;
}) {
  if (tags.length === 0 && intensity == null && !note) return null;

  return (
    <div className={cn("space-y-1.5", compact && "space-y-1")}>
      {!compact && <span className="text-xs font-medium text-muted-foreground">Pre-trade mood</span>}
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-xs font-medium text-muted-foreground"
          >
            {PRE_TRADE_MOOD_TAG_LABELS[tag as PreTradeMoodTagValue] ?? tag}
          </span>
        ))}
        {intensity != null && (
          <span className="text-xs text-muted-foreground/70">Intensity {intensity}/5</span>
        )}
      </div>
      {!compact && note && <p className="text-sm text-muted-foreground italic">&ldquo;{note}&rdquo;</p>}
    </div>
  );
}
