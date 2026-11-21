"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AssetTagInput } from "@/components/strategy-lab/asset-tag-input";
import { addDaysToKey } from "@/lib/date";
import type { AuditWorkspace } from "@/server/services/trade-audit.service";
import { AuditProvider, dayLabel, fmtPnl, fmtR, toneOf } from "@/components/edge/audit/audit-context";
import { AuditDaySection, DAY_STATUS } from "@/components/edge/audit/audit-day-section";
import { WeeklyAssessmentSection } from "@/components/edge/audit/weekly-assessment-section";

const ALL = "__all__";

function Stat({ label, value, className, hint }: { label: string; value: string | number; className?: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border px-2.5 py-2" title={hint}>
      <p className="truncate text-[10px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", className)}>{value}</p>
    </div>
  );
}

/**
 * Edge Review — Weekly Trade Audit. One workspace for the whole week: header
 * (week, scope, metrics), a day strip, every trading day as its own section
 * with ACTUAL vs EXPECTED side by side, and the weekly assessment at the end.
 */
export function WeeklyAuditWorkspace({
  workspace,
  defaultWeekStart,
  todayKey,
  strategies,
  assets,
}: {
  workspace: AuditWorkspace;
  defaultWeekStart: string;
  todayKey: string;
  strategies: { id: string; name: string }[];
  assets: string[];
}) {
  const router = useRouter();
  const { week, scope, audit, days, summary } = workspace;
  const locked = audit?.status === "FINALIZED";

  function navigate(next: { week?: string; strategy?: string | null; assets?: string[] }) {
    const params = new URLSearchParams();
    params.set("week", next.week ?? week.weekStart);
    const strategy = next.strategy !== undefined ? next.strategy : scope.strategyId;
    if (strategy) params.set("strategy", strategy);
    const a = next.assets ?? scope.assetSymbols;
    if (a.length > 0) params.set("assets", a.join(","));
    router.push(`/edge?${params.toString()}`);
  }

  const start = dayLabel(week.weekStart);
  const end = dayLabel(week.weekEnd);
  const isFuture = week.weekStart > todayKey;
  const status = locked ? "Finalized" : audit ? "In progress" : "Not started";
  const t = summary.trades;

  return (
    <AuditProvider value={{ scope: { weekStart: week.weekStart, strategyId: scope.strategyId, assetSymbols: scope.assetSymbols }, locked, uploadsEnabled: workspace.uploadsEnabled }}>
      <div className="space-y-4">
        <div className="glass space-y-3 rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="bg-brand-gradient inline-flex size-8 items-center justify-center rounded-lg text-white shadow-glow">
                <ClipboardList className="size-4" />
              </span>
              <div>
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Edge Review — Weekly Trade Audit</h1>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {start.short} {start.date} – {end.short} {end.date} {week.weekEnd.slice(0, 4)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => navigate({ week: addDaysToKey(week.weekStart, -7) })}>
                <ChevronLeft />
              </Button>
              <label className="sr-only" htmlFor="audit-week-picker">
                Jump to week containing date
              </label>
              <input
                id="audit-week-picker"
                type="date"
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                value={week.weekStart}
                max={addDaysToKey(todayKey, 7)}
                onChange={(e) => e.target.value && navigate({ week: e.target.value })}
              />
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => navigate({ week: addDaysToKey(week.weekStart, 7) })}>
                <ChevronRight />
              </Button>
              {week.weekStart !== defaultWeekStart && (
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => navigate({ week: defaultWeekStart })}>
                  <CalendarDays className="size-3.5" /> Latest completed week
                </Button>
              )}
              <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium", locked ? "bg-success/15 text-success" : "bg-secondary text-secondary-foreground")}>
                {locked && <Lock className="size-3" />} {status}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              items={[{ value: ALL, label: "All strategies" }, ...strategies.map((s) => ({ value: s.id, label: s.name }))]}
              value={scope.strategyId ?? ALL}
              onValueChange={(v) => navigate({ strategy: v === ALL || v == null ? null : v })}
            >
              <SelectTrigger className={cn("h-8 text-xs", scope.strategyId && "border-primary/50")} aria-label="Strategy filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All strategies</SelectItem>
                {strategies.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="min-w-48 flex-1 sm:max-w-sm">
              <AssetTagInput value={scope.assetSymbols} onChange={(next) => navigate({ assets: next })} placeholder={assets.length > 0 ? `All instruments — e.g. ${assets[0]}` : "All instruments"} />
            </div>
            {(scope.strategyId || scope.assetSymbols.length > 0) && <span className="text-[11px] text-muted-foreground">Each filter combination is its own audit.</span>}
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
            <Stat label="Trades" value={t.executed} />
            <Stat label="Profitable" value={t.wins} className={t.wins > 0 ? "text-success" : undefined} />
            <Stat label="Losing" value={t.losses} className={t.losses > 0 ? "text-danger" : undefined} />
            <Stat label="Net R" value={fmtR(t.netR)} className={toneOf(t.netR)} />
            <Stat label="Net P&L" value={fmtPnl(t.netPnl)} className={toneOf(t.netPnl)} hint="Settled trades only" />
            <Stat label="Rule violations" value={summary.ruleViolations} className={summary.ruleViolations > 0 ? "text-danger" : undefined} hint="Trades you judged should not have been taken" />
            <Stat label="Missed setups" value={summary.missed.total} className={summary.missed.total > 0 ? "text-amber-600 dark:text-amber-300" : undefined} />
            <Stat label="Days reviewed" value={`${summary.days.completed}/${summary.days.total}`} />
            <Stat label="Review" value={status} className="text-sm" />
          </div>
        </div>

        {isFuture && <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">This week hasn&apos;t started yet.</p>}

        {/* Day strip — jump between days without leaving the workspace */}
        <nav aria-label="Days of the week" className="sticky top-2 z-10 flex gap-1.5 overflow-x-auto rounded-xl border border-border bg-background/90 p-1.5 backdrop-blur">
          {days.map((d) => {
            const s = DAY_STATUS[d.status];
            const Icon = s.icon;
            const l = dayLabel(d.dateKey);
            const n = d.trades.filter((x) => x.outcome !== "CANCELLED").length;
            return (
              <a key={d.dateKey} href={`#day-${d.dateKey}`} className="flex min-w-fit flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs whitespace-nowrap hover:bg-accent">
                <Icon className={cn("size-3.5 shrink-0", s.className)} aria-label={s.label} />
                <span className="font-medium">{l.short}</span>
                <span className="text-muted-foreground">{l.date}</span>
                <span className="ml-auto rounded bg-muted px-1 tabular-nums text-muted-foreground">{n}</span>
              </a>
            );
          })}
          <a href="#weekly-assessment" className="flex items-center rounded-lg px-2 py-1.5 text-xs font-medium whitespace-nowrap hover:bg-accent">
            Weekly assessment
          </a>
        </nav>

        {days.map((d) => (
          <AuditDaySection key={`${d.dateKey}-${locked}`} day={d} defaultOpen={d.status !== "COMPLETED"} />
        ))}

        {days.length === 0 && <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No trading days are scheduled this week and nothing was traded.</p>}

        <WeeklyAssessmentSection
          key={`${audit?.id ?? "new"}-${audit?.status ?? ""}`}
          audit={audit}
          summary={summary}
          unacknowledgedChanges={workspace.unacknowledgedChanges}
          commitments={workspace.commitments}
          carryForward={workspace.carryForward}
          legacyReflection={workspace.legacyReflection}
        />
      </div>
    </AuditProvider>
  );
}
