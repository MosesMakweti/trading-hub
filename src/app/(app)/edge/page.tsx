import Link from "next/link";
import { ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getAnalyticsData } from "@/server/services/analytics.service";
import { getWeeklyReview } from "@/server/services/edge.service";
import {
  addDaysToKey,
  formatDateKeyShort,
  isValidDateKey,
  localDateToKey,
  weekStartKey,
} from "@/lib/date";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/analytics/kpi-card";
import { EquityCurveChart } from "@/components/analytics/equity-curve-chart";
import { WeeklyReflection } from "@/components/edge/weekly-reflection";
import { FadeIn } from "@/components/shared/motion";

const pct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const tone = (n: number | null): "success" | "danger" | undefined =>
  n == null ? undefined : n >= 0 ? "success" : "danger";

export default async function EdgePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requireUser();
  const { week } = await searchParams;

  const base = week && isValidDateKey(week) ? week : localDateToKey(new Date());
  const start = weekStartKey(base);
  const end = addDaysToKey(start, 6);

  const [analytics, review] = await Promise.all([
    getAnalyticsData(user.id, start, end),
    getWeeklyReview(user.id, start),
  ]);
  const t = analytics.trading;
  const best = t.statsByAsset[0] ?? null;
  const isCurrent = start === weekStartKey(localDateToKey(new Date()));

  return (
    <FadeIn className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="bg-brand-gradient inline-flex size-8 items-center justify-center rounded-lg text-white shadow-glow">
            <TrendingUp className="size-4" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Edge — Weekly Review</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDateKeyShort(start)} – {formatDateKeyShort(end)}
              {isCurrent && " · this week"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous week"
            nativeButton={false}
            render={<Link href={`/edge?week=${addDaysToKey(start, -7)}`} />}
          >
            <ChevronLeft />
          </Button>
          {!isCurrent && (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/edge" />}>
              This week
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next week"
            nativeButton={false}
            render={<Link href={`/edge?week=${addDaysToKey(start, 7)}`} />}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard label="Trades" value={String(t.totalTrades)} sublabel={`${t.winningTrades}W · ${t.losingTrades}L`} />
        <KpiCard label="Win rate" value={t.winRate == null ? "—" : `${t.winRate.toFixed(1)}%`} />
        <KpiCard label="Avg / trade" value={pct(t.averageRR)} tone={tone(t.averageRR)} />
        <KpiCard
          label="Profit factor"
          value={t.profitFactor == null ? "—" : t.profitFactor.toFixed(2)}
          tone={t.profitFactor == null ? undefined : t.profitFactor >= 1 ? "success" : "danger"}
        />
        <KpiCard label="Expectancy" value={pct(t.expectancy)} tone={tone(t.expectancy)} />
        <KpiCard
          label="Avg psychology"
          value={analytics.psychology.averagePercent == null ? "—" : `${analytics.psychology.averagePercent.toFixed(0)}%`}
        />
        <KpiCard
          label="Rule adherence"
          value={t.ruleAdherenceAverage == null ? "—" : `${t.ruleAdherenceAverage.toFixed(0)}%`}
        />
        <KpiCard
          label="Best asset"
          value={best?.assetSymbol ?? "—"}
          sublabel={best ? pct(best.totalReturnPercent) : undefined}
          tone={best ? tone(best.totalReturnPercent) : undefined}
        />
      </div>

      {t.totalTrades > 0 ? (
        <>
          <EquityCurveChart data={t.equityCurve} />

          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">By asset</h2>
            <div className="glass divide-y divide-border/60 rounded-2xl">
              {t.statsByAsset.map((a) => (
                <div
                  key={a.assetSymbol}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <span className="font-medium">{a.assetSymbol}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.totalTrades} trade{a.totalTrades === 1 ? "" : "s"} ·{" "}
                    {a.winRate == null ? "—" : `${a.winRate.toFixed(0)}% WR`}
                  </span>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      a.totalReturnPercent >= 0 ? "text-success" : "text-danger",
                    )}
                  >
                    {pct(a.totalReturnPercent)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <p className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
          No trades this week — a quiet week is still worth reflecting on.
        </p>
      )}

      <WeeklyReflection
        weekStartKey={start}
        initial={{
          wentWell: review?.wentWell ?? null,
          toImprove: review?.toImprove ?? null,
          focusNextWeek: review?.focusNextWeek ?? null,
        }}
      />
    </FadeIn>
  );
}
