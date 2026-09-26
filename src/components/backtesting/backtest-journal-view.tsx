"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { summarizePeriod, type PeriodSummary } from "@/domain/journal/period-summary";
import { JournalCalendar, type JournalCalendarRunContext } from "@/components/journal/journal-calendar";
import { formatRR } from "@/components/journal/workspace/workspace-ui";
import type { DailyPerformanceSummaryDTO } from "@/server/services/close-day.service";

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

function keyToLocalDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function SummaryStrip({ title, summary }: { title: string; summary: PeriodSummary }) {
  const decided = summary.wins + summary.losses + summary.breakevens;
  const tone = summary.totalR > 0.001 ? "text-success" : summary.totalR < -0.001 ? "text-danger" : "text-muted-foreground";
  const items = [
    { label: "Net", value: summary.trades > 0 ? formatRR(summary.totalR) : "—", className: summary.trades > 0 ? tone : undefined },
    { label: "Trades", value: String(summary.trades) },
    { label: "Win rate", value: decided > 0 ? `${Math.round((summary.wins / decided) * 100)}%` : "—", hint: decided > 0 ? `${summary.wins}W · ${summary.losses}L` : undefined },
    { label: "Missed", value: String(summary.missed) },
  ];
  return (
    <div className="glass rounded-2xl p-4">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.label}>
            <dt className="text-xs text-muted-foreground">{i.label}</dt>
            <dd className={cn("text-lg font-semibold tabular-nums", i.className)}>{i.value}</dd>
            {i.hint && <p className="text-[11px] text-muted-foreground tabular-nums">{i.hint}</p>}
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Backtesting Journal (Stage 5) — the SAME Journal calendar as the live
 * Journal, fed only by this run's per-day summaries, plus run and visible-
 * month totals from the one pure period aggregation (summarizePeriod).
 */
export function BacktestJournalView({
  days,
  noteDates,
  run,
}: {
  days: DailyPerformanceSummaryDTO[];
  noteDates: string[];
  run: JournalCalendarRunContext;
}) {
  const [visible, setVisible] = useState(() => {
    const d = keyToLocalDate(run.initialDateKey);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const runTotals = useMemo(() => summarizePeriod(days), [days]);
  const monthPrefix = `${visible.getFullYear()}-${String(visible.getMonth() + 1).padStart(2, "0")}`;
  const monthTotals = useMemo(() => summarizePeriod(days, (key) => key.startsWith(monthPrefix)), [days, monthPrefix]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <SummaryStrip title={MONTH.format(visible)} summary={monthTotals} />
        <SummaryStrip title="Whole run" summary={runTotals} />
      </div>
      <JournalCalendar noteDates={noteDates} dailyPerformance={days} run={run} onVisibleMonthChange={setVisible} />
    </div>
  );
}
