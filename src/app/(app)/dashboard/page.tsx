import Link from "next/link";
import { NotebookPen, Plus, Sparkles, Trophy } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getDashboardData } from "@/server/services/dashboard.service";
import { formatDateKeyLong } from "@/lib/date";
import { tiptapToPlainText } from "@/lib/tiptap-text";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/analytics/kpi-card";
import { EquityCurveChart } from "@/components/analytics/equity-curve-chart";
import { SessionCountdown } from "@/components/dashboard/session-countdown";
import { DailyNoteEditor } from "@/components/journal/daily-note-editor";
import { RecentTradesList, type RecentTradeSummary } from "@/components/dashboard/recent-trades-list";

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.id);

  const recentTrades: RecentTradeSummary[] = data.recentTrades.map((t) => {
    const performanceAllocation = t.allocations.find(
      (a) => a.tradingAccount.kind === "PERFORMANCE",
    );
    return {
      id: t.id,
      dateKey: t.tradeDate.toISOString().slice(0, 10),
      assetSymbol: t.asset.symbol,
      direction: t.direction,
      performancePnl: performanceAllocation ? performanceAllocation.closingPnlNet.toNumber() : 0,
      psychologyGrade: t.psychology?.grade ?? null,
    };
  });

  const recentReflections = data.recentTrades
    .filter((t) => t.psychPostTradeReflection || t.psychLessonsLearned)
    .slice(0, 3);

  const planExcerpt = tiptapToPlainText(data.plan.strategyFramework) || tiptapToPlainText(data.plan.dailyRoutineMorning);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back{user.name ? `, ${user.name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">{formatDateKeyLong(data.todayKey)}</p>
        </div>
        <div className="flex gap-2">
          <Button
            className="gap-1.5"
            nativeButton={false}
            render={<Link href={`/journal/${data.todayKey}/trades/new`} />}
          >
            <Plus className="size-3.5" />
            Quick Add Trade
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            nativeButton={false}
            render={<Link href={`/journal/${data.todayKey}#notes`} />}
          >
            <NotebookPen className="size-3.5" />
            Quick Add Note
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SessionCountdown sessions={data.sessions} />

        <div className="glass rounded-2xl p-4">
          <h3 className="text-xs text-muted-foreground">Today&apos;s Trading Plan</h3>
          <p className="mt-1 line-clamp-3 text-sm">
            {planExcerpt || "No strategy notes yet."}
          </p>
          <Link href="/settings/plan" className="mt-2 inline-block text-xs text-primary hover:underline">
            View full plan →
          </Link>
        </div>

        <div className="glass rounded-2xl p-4">
          <h3 className="text-xs text-muted-foreground">Today&apos;s Journal</h3>
          <p className="mt-1 text-sm">
            <span className="text-lg font-semibold">{data.todayTrades.length}</span> trade
            {data.todayTrades.length === 1 ? "" : "s"} logged today
          </p>
          <Link href={`/journal/${data.todayKey}`} className="mt-2 inline-block text-xs text-primary hover:underline">
            Open today&apos;s journal →
          </Link>
        </div>
      </div>

      <section id="notes" className="glass space-y-3 rounded-2xl p-4 scroll-mt-20">
        <h3 className="text-sm font-medium text-muted-foreground">Today&apos;s Notes</h3>
        <DailyNoteEditor dateKey={data.todayKey} initialContent={data.todayNote?.content ?? null} />
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Current Win Rate"
          value={data.winRate == null ? "—" : `${data.winRate.toFixed(1)}%`}
        />
        <KpiCard
          label="Best Performing Account"
          value={data.bestAccount?.name ?? "—"}
          sublabel={
            data.bestAccount
              ? `${data.bestAccount.returnPercent >= 0 ? "+" : ""}${data.bestAccount.returnPercent.toFixed(1)}%`
              : undefined
          }
          tone={data.bestAccount && data.bestAccount.returnPercent >= 0 ? "success" : "neutral"}
        />
        <KpiCard
          label="Best Performing Asset"
          value={data.bestAsset?.assetSymbol ?? "—"}
          sublabel={
            data.bestAsset
              ? `${data.bestAsset.totalReturnPercent >= 0 ? "+" : ""}${data.bestAsset.totalReturnPercent.toFixed(1)}%`
              : undefined
          }
          tone={data.bestAsset && data.bestAsset.totalReturnPercent >= 0 ? "success" : "neutral"}
        />
      </div>

      <EquityCurveChart data={data.equityCurve} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Trophy className="size-4" />
            Recent Trades
          </h2>
          <RecentTradesList trades={recentTrades} />
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Sparkles className="size-4" />
            Recent Psychology Notes
          </h2>
          {recentReflections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Reflections you write after trades will show up here.
            </p>
          ) : (
            <div className="space-y-2">
              {recentReflections.map((t) => (
                <Link
                  key={t.id}
                  href={`/journal/${t.tradeDate.toISOString().slice(0, 10)}`}
                  className="block rounded-lg border border-border bg-background/40 p-3 text-sm transition-colors hover:bg-accent"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{t.asset.symbol}</span>
                    <span>{t.tradeDate.toISOString().slice(0, 10)}</span>
                  </div>
                  <p className="line-clamp-2">
                    {t.psychPostTradeReflection || t.psychLessonsLearned}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
