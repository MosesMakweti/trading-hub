import { cn } from "@/lib/utils";
import { TAG_STYLES } from "@/components/ui/tag";
import { formatRR, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import type { DayCloseSummaryDTO } from "@/server/services/close-day.service";

/**
 * Shared presentational widgets for a day's compact performance summary —
 * used by both the Close Trading Day dialog (Today, live) and the Journal
 * day view (Stage 9, historical). One implementation, reused, per the "don't
 * rebuild the same calculations/UI independently" rule — both read the exact
 * same Stage 8 DayCloseSummaryDTO.
 */

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger" | "muted";
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function DaySummaryGrid({ summary }: { summary: DayCloseSummaryDTO }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-background/40 p-3 sm:grid-cols-4">
      <Stat label="Trades taken" value={String(summary.tradeCount)} />
      <Stat label="Fully closed" value={String(summary.fullyClosedCount)} />
      <Stat label="Open (partial/holding)" value={String(summary.partiallyClosedCount + summary.stillHoldingCount)} />
      <Stat label="Cancelled" value={String(summary.cancelledCount)} />
      <Stat
        label="Realized R"
        value={formatRR(summary.totalRealizedRSoFar)}
        tone={summary.totalRealizedRSoFar >= 0 ? "success" : "danger"}
      />
      <Stat label="PnL" value={formatSignedCurrency(summary.totalPnl)} tone={summary.totalPnl >= 0 ? "success" : "danger"} />
      <Stat label="W / L / BE" value={`${summary.wins} / ${summary.losses} / ${summary.breakevens}`} />
      <Stat label="Overrides" value={String(summary.overrideCount)} tone={summary.overrideCount > 0 ? "danger" : "muted"} />
    </div>
  );
}

export function DayBehaviourRecap({ summary }: { summary: DayCloseSummaryDTO }) {
  const positive = summary.behaviourLabels.filter((l) => l.polarity === "POSITIVE");
  const negative = summary.behaviourLabels.filter((l) => l.polarity === "NEGATIVE");
  if (positive.length === 0 && negative.length === 0) return null;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/40 p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Behaviour recap</span>
      {positive.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {positive.map((l) => (
            <span key={l.id} className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", TAG_STYLES[l.color].chip)}>
              {l.name} × {l.count}
            </span>
          ))}
        </div>
      )}
      {negative.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {negative.map((l) => (
            <span key={l.id} className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", TAG_STYLES[l.color].chip)}>
              {l.name} × {l.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
