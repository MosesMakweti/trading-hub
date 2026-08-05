import Link from "next/link";
import { Sparkles, Trophy } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getDashboardData } from "@/server/services/dashboard.service";
import { formatDateKeyLong } from "@/lib/date";
import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";
import { SessionCountdown } from "@/components/dashboard/session-countdown";
import { WorkflowProgress, WORKFLOW_STEP_META, type WorkflowStep } from "@/components/dashboard/workflow-progress";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { PerformanceSnapshot } from "@/components/dashboard/performance-snapshot";
import { DailyNoteEditor } from "@/components/journal/daily-note-editor";
import { RecentTradesList, type RecentTradeSummary } from "@/components/dashboard/recent-trades-list";
import { EmptyState } from "@/components/shared/empty-state";
import { FadeIn } from "@/components/shared/motion";

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.id);
  const today = data.todayKey;

  const recentTrades: RecentTradeSummary[] = data.recentTrades.map((t) => {
    const performanceAllocation = t.allocations.find((a) => a.tradingAccount.kind === "PERFORMANCE");
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

  // Workflow state for today, from the same state machine the Today workspace
  // uses: Prep/Plan/Analyze from the TradingDay (null until the day is started in
  // /today), Trade/Review derived from the day's trades. Every step links into
  // the Today workspace — the hub where the workflow happens.
  const done: WorkflowDoneState = {
    prep: data.tradingDay?.prepCompletedAt != null,
    plan: data.tradingDay?.planCompletedAt != null,
    trade: data.todayTrades.length > 0,
    review: data.todayTrades.some((t) => t.reviewedAt != null),
    analyze: data.tradingDay?.analyzedAt != null,
  };
  const statusByKey = new Map(deriveWorkflowSteps(done).map((s) => [s.key, s.status]));
  const workflowSteps: WorkflowStep[] = WORKFLOW_STEP_META.map((m) => ({
    ...m,
    status: statusByKey.get(m.key) ?? "upcoming",
    href: "/today",
  }));

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Welcome back
          {user.name ? (
            <>
              , <span className="text-gradient">{user.name}</span>
            </>
          ) : null}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatDateKeyLong(today)}</p>
      </div>

      <WorkflowProgress steps={workflowSteps} caption="Continue in the Today workspace →" />

      <QuickActions todayKey={today} />

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Today at a glance</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SessionCountdown sessions={data.sessions} />

          <div className="glass flex flex-col rounded-2xl p-4">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Strategy Lab
            </h3>
            <p className="mt-1.5 line-clamp-3 flex-1 text-sm text-muted-foreground">
              Your strategies, entry models, and methodology — the playbook every trade follows.
            </p>
            <Link
              href="/strategy-lab"
              className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
            >
              Open Strategy Lab →
            </Link>
          </div>

          <div className="glass flex flex-col rounded-2xl p-4">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Today&apos;s Journal
            </h3>
            <p className="mt-1.5 flex-1">
              <span className="text-2xl font-semibold tabular-nums">{data.todayTrades.length}</span>
              <span className="ml-1.5 text-sm text-muted-foreground">
                trade{data.todayTrades.length === 1 ? "" : "s"} logged today
              </span>
            </p>
            <Link
              href={`/journal/${today}`}
              className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
            >
              Open today&apos;s journal →
            </Link>
          </div>
        </div>
      </section>

      <PerformanceSnapshot
        winRate={data.winRate}
        totalTrades={data.totalTrades}
        bestAccount={data.bestAccount}
        bestAsset={data.bestAsset}
        equityCurve={data.equityCurve}
      />

      <section id="notes" className="glass space-y-3 rounded-2xl p-4 scroll-mt-20">
        <h2 className="text-sm font-medium text-muted-foreground">Today&apos;s Notes</h2>
        <DailyNoteEditor dateKey={today} initialContent={data.todayNote?.content ?? null} />
      </section>

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
            <EmptyState
              icon={Sparkles}
              title="No reflections yet"
              description="Reflections you write after trades will show up here."
            />
          ) : (
            <div className="space-y-2">
              {recentReflections.map((t) => (
                <Link
                  key={t.id}
                  href={`/journal/${t.tradeDate.toISOString().slice(0, 10)}`}
                  className="glass block rounded-xl p-3 text-sm transition-all hover:-translate-y-0.5 hover:shadow-elevated"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{t.asset.symbol}</span>
                    <span className="tabular-nums">{t.tradeDate.toISOString().slice(0, 10)}</span>
                  </div>
                  <p className="line-clamp-2">{t.psychPostTradeReflection || t.psychLessonsLearned}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </FadeIn>
  );
}
