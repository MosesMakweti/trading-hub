import Link from "next/link";

import { cn } from "@/lib/utils";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";
import { formatDateKeyShort } from "@/lib/date";
import { EmptyState } from "@/components/shared/empty-state";
import { BarChart3 } from "lucide-react";
import type { ReplayActualBaseline } from "@/types/replay";

const rr = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`);

const VALIDATION_LABEL: Record<string, string> = {
  VALIDATED: "Validated",
  OVERRIDDEN: "Overridden",
  NOT_VALIDATED: "Not validated",
};

const LIFECYCLE_LABEL: Record<string, string> = {
  FULLY_CLOSED: "Closed",
  PARTIALLY_CLOSED: "Partial",
  STILL_HOLDING: "Holding",
  CANCELLED_NEVER_TRIGGERED: "Cancelled",
};

/**
 * "What Actually Happened" — Stage 12 §6/§15. Read-only, sourced entirely
 * from the frozen `actualBaselineSnapshot` (never recomputed here). Cancelled
 * ideas render visibly distinct from executed losses. Drill-down reuses the
 * existing Journal trade page rather than a second historical renderer.
 */
export function ReplayActualPeriodPanel({ baseline }: { baseline: ReplayActualBaseline | null }) {
  if (!baseline) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Not started yet"
        description="Start the review to compute the actual baseline for this period — what really happened, frozen at that moment."
      />
    );
  }

  const { overview } = baseline.canonical;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Realized R" value={rr(overview.totalRealizedR)} tone={overview.totalRealizedR >= 0 ? "success" : "danger"} />
        <Stat label="Win Rate" value={overview.winRate != null ? `${overview.winRate.toFixed(0)}%` : "—"} sub={`n=${overview.finalizedTrades}`} />
        <Stat label="Executed Trades" value={String(overview.totalExecutedTrades)} sub={`${overview.cancelledCount} cancelled`} />
        <Stat label="Expectancy" value={rr(overview.expectancy)} />
      </div>

      {baseline.opportunity.hasData && (
        <p className="text-xs text-muted-foreground">
          {baseline.opportunity.summary.missed} missed opportunity{baseline.opportunity.summary.missed === 1 ? "" : "ies"} in this
          period (date-range only — not narrowed by scope).
        </p>
      )}

      {baseline.actualTrades.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No trades in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-normal">Date</th>
                <th className="px-3 py-2 font-normal">Asset</th>
                <th className="px-3 py-2 font-normal">Dir</th>
                <th className="px-3 py-2 font-normal">Strategy</th>
                <th className="px-3 py-2 font-normal">Setup Type</th>
                <th className="px-3 py-2 font-normal">Validation</th>
                <th className="px-3 py-2 font-normal">Lifecycle</th>
                <th className="px-3 py-2 text-right font-normal">Realized R</th>
              </tr>
            </thead>
            <tbody>
              {baseline.actualTrades.map((t) => {
                const symbolStyle = TAG_STYLES[colorForName(t.assetSymbol)];
                return (
                  <tr key={t.tradeId} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={`/journal/${t.dateKey}/trades/${t.tradeId}`} className="hover:underline">
                        {formatDateKeyShort(t.dateKey)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs", symbolStyle.chip)}>
                        {t.assetSymbol}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{t.direction}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{t.strategyName ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{t.setupTypeName ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {t.validationState ? VALIDATION_LABEL[t.validationState] : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className={cn(t.isCancelled && "text-muted-foreground italic")}>
                        {t.reviewLifecycleStatus ? LIFECYCLE_LABEL[t.reviewLifecycleStatus] : "—"}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-medium tabular-nums",
                        t.isCancelled
                          ? "text-muted-foreground"
                          : (t.realizedR ?? 0) > 0
                            ? "text-success"
                            : (t.realizedR ?? 0) < 0
                              ? "text-danger"
                              : "text-muted-foreground",
                      )}
                    >
                      {t.isCancelled ? "cancelled" : rr(t.realizedR)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "success" | "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-base font-semibold tabular-nums", tone === "success" && "text-success", tone === "danger" && "text-danger")}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
