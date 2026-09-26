"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, LineChart, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/analytics/kpi-card";
import { SaveDot } from "@/components/today/today-ui";
import { formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { DayBehaviourRecap, DaySummaryGrid } from "@/components/journal/day-summary-widgets";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { setDayAnalyzed } from "@/actions/today.actions";
import { loadDayCloseSummaryAction, saveDailyReflectionAction } from "@/actions/close-day.actions";
import type { DayCloseSummaryDTO } from "@/server/services/close-day.service";
import type { DailyReflectionInput } from "@/lib/validation/close-day";
import type { DailyAnalyticsDTO } from "@/types/today";
import { useDayRef, useWorkspace } from "@/components/workspace/workspace-context";

const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(0)}%`);
const rr = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`);
const tone = (n: number | null): "success" | "danger" | undefined =>
  n == null ? undefined : n >= 0 ? "success" : "danger";

/**
 * Today V2 Final Phase §8/§9 — Day Summary: the final step of the daily
 * workflow, built entirely from facts Traditorium already knows. Reuses,
 * never re-derives:
 *   - DailyAnalyticsDTO (this file's original KPI cards — win rate, profit
 *     factor, average R) — the existing Analytics pipeline's own summary.
 *   - DayCloseSummaryDTO (close-day.service.ts) — the same derived
 *     grid/behaviour-recap/reflection fields the Close Trading Day dialog
 *     uses, so this tab is a standing, always-visible preview of exactly
 *     what closing the day will show — not a second summary system.
 * "Mark day reviewed" is this step's own completion signal for the workflow
 * stepper (TradingDay.analyzedAt) — the trader closes the day itself from
 * the header's "Close Trading Day" action once ready.
 */
export function DailyAnalyticsSection({
  dateKey,
  analytics,
}: {
  dateKey: string;
  analytics: DailyAnalyticsDTO;
}) {
  const dayRef = useDayRef(dateKey);
  const { isBacktest } = useWorkspace();
  const a = analytics;
  const router = useRouter();
  const [reviewed, setReviewed] = useState(a.analyzed);
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<DayCloseSummaryDTO | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await loadDayCloseSummaryAction(dayRef);
      if (active && result.success) setSummary(result.data);
    })();
    return () => {
      active = false;
    };
  }, [dayRef]);

  function toggle() {
    const next = !reviewed;
    startTransition(async () => {
      const result = await setDayAnalyzed(dayRef, next);
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
        description="Once you log today's trades, your day's derived summary — win rate, R, PnL, psychology, and adherence — appears here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        How today went across{" "}
        <span className="font-medium text-foreground">{a.totalTrades}</span> trade
        {a.totalTrades === 1 ? "" : "s"}. R is each trade&apos;s realized R-multiple — PnL is secondary.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard label="Trades" value={String(a.totalTrades)} sublabel={`${a.winningTrades}W · ${a.losingTrades}L`} />
        <KpiCard label="Win rate" value={pct(a.winRate)} />
        <KpiCard label="Net PnL" value={formatSignedCurrency(a.netPnl)} tone={tone(a.netPnl)} />
        <KpiCard label="Total realized R" value={rr(a.totalRR)} tone={tone(a.totalRR)} />
        <KpiCard label="Avg R / trade" value={rr(a.averageRR)} tone={tone(a.averageRR)} />
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

      {summary ? (
        <>
          <DaySummaryGrid summary={summary} showPnl={!isBacktest} />
          <DayBehaviourRecap summary={summary} />

          <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-background/30 p-3 sm:grid-cols-2">
            <div className="text-xs font-medium text-muted-foreground sm:col-span-2">Reflection</div>
            <ReflectionField
              dateKey={dateKey}
              field="dayWentWell"
              label="What went well today?"
              initialValue={summary.reflection.dayWentWell}
            />
            <ReflectionField
              dateKey={dateKey}
              field="dayToImprove"
              label="What needs improvement?"
              initialValue={summary.reflection.dayToImprove}
            />
            <ReflectionField
              dateKey={dateKey}
              field="dayCarryForward"
              label="Focus for next session"
              initialValue={summary.reflection.dayCarryForward}
              className="sm:col-span-2"
            />
          </div>
        </>
      ) : (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      )}

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

function ReflectionField({
  dateKey,
  field,
  label,
  initialValue,
  className,
}: {
  dateKey: string;
  field: keyof DailyReflectionInput;
  label: string;
  initialValue: string | null;
  className?: string;
}) {
  const dayRef = useDayRef(dateKey);
  const [value, setValue] = useState(initialValue ?? "");
  const state = useDebouncedAutosave({
    value,
    serialize: (v) => v.trim(),
    save: (v) => saveDailyReflectionAction(dayRef, { [field]: v.trim() } as DailyReflectionInput),
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">{label}</label>
        <SaveDot state={state} />
      </div>
      <Textarea rows={2} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Optional…" />
    </div>
  );
}
