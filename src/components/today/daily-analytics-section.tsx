"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, LineChart, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/analytics/kpi-card";
import { formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { setDayAnalyzed } from "@/actions/today.actions";
import type { DailyAnalyticsDTO } from "@/types/today";

const pct = (n: number | null, signed = false) =>
  n == null ? "—" : `${signed && n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const tone = (n: number | null): "success" | "danger" | undefined =>
  n == null ? undefined : n >= 0 ? "success" : "danger";

export function DailyAnalyticsSection({
  dateKey,
  analytics,
}: {
  dateKey: string;
  analytics: DailyAnalyticsDTO;
}) {
  const a = analytics;
  const router = useRouter();
  const [reviewed, setReviewed] = useState(a.analyzed);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !reviewed;
    startTransition(async () => {
      const result = await setDayAnalyzed(dateKey, next);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setReviewed(next);
      toast.success(next ? "Day reviewed." : "Review reopened.");
      router.refresh(); // advance the workflow stepper
    });
  }

  if (a.totalTrades === 0) {
    return (
      <EmptyState
        icon={LineChart}
        title="No trades logged today yet"
        description="Once you log today's trades, your day's win rate, R, PnL, psychology, and adherence appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        How today went across{" "}
        <span className="font-medium text-foreground">{a.totalTrades}</span> trade
        {a.totalTrades === 1 ? "" : "s"}. Returns are each trade&apos;s contribution to the
        Performance Account.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard label="Trades" value={String(a.totalTrades)} sublabel={`${a.winningTrades}W · ${a.losingTrades}L`} />
        <KpiCard label="Win rate" value={pct(a.winRate)} />
        <KpiCard label="Net PnL" value={formatSignedCurrency(a.netPnl)} tone={tone(a.netPnl)} />
        <KpiCard label="Total return" value={pct(a.totalRR, true)} tone={tone(a.totalRR)} />
        <KpiCard label="Avg / trade" value={pct(a.averageRR, true)} tone={tone(a.averageRR)} />
        <KpiCard
          label="Profit factor"
          value={a.profitFactor == null ? "—" : a.profitFactor.toFixed(2)}
          tone={a.profitFactor == null ? undefined : a.profitFactor >= 1 ? "success" : "danger"}
        />
        <KpiCard
          label="Avg psychology"
          value={a.averagePsychologyPercent == null ? "—" : `${a.averagePsychologyPercent.toFixed(0)}%`}
        />
        <KpiCard
          label="Avg adherence"
          value={a.averageAdherencePercent == null ? "—" : `${a.averageAdherencePercent.toFixed(0)}%`}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        {reviewed && (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <CircleCheck className="size-4" />
            Day reviewed
          </span>
        )}
        <Button
          type="button"
          variant={reviewed ? "outline" : "default"}
          onClick={toggle}
          disabled={pending}
          className="gap-1.5"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {reviewed ? "Reopen review" : "Mark day reviewed"}
        </Button>
      </div>
    </div>
  );
}
