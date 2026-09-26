import Link from "next/link";
import { Sparkles, Trophy } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getDashboardData } from "@/server/services/dashboard.service";
import { formatDateKeyLong } from "@/lib/date";
import { presetToRange, type DateRangePreset } from "@/lib/date-ranges";
import { CommandBar, type UnreviewedTradeSummary } from "@/components/dashboard/command-bar";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { CommandEquityCurve } from "@/components/dashboard/command-equity-curve";
import { TodayPanel } from "@/components/dashboard/today-panel";
import { MiniJournalCalendar } from "@/components/dashboard/mini-journal-calendar";
import { RecentTradesTable } from "@/components/dashboard/recent-trades-table";
import { PropFirmHealthCard } from "@/components/dashboard/prop-firm-health-card";
import { PerformanceAccountCard } from "@/components/dashboard/performance-account-card";
import { PrivacyModeProvider } from "@/components/dashboard/privacy-mode";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { DailyNoteEditor } from "@/components/journal/daily-note-editor";
import { LIVE_WORKSPACE, WorkspaceProvider } from "@/components/workspace/workspace-context";
import { EmptyState } from "@/components/shared/empty-state";
import { FadeIn } from "@/components/shared/motion";

const VALID_PRESETS: Exclude<DateRangePreset, "custom">[] = ["week", "month", "3months", "year"];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; account?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const preset: Exclude<DateRangePreset, "custom"> = VALID_PRESETS.includes(
    params.range as Exclude<DateRangePreset, "custom">,
  )
    ? (params.range as Exclude<DateRangePreset, "custom">)
    : "month";
  const { from, to } = presetToRange(preset);
  const accountId = params.account || undefined;

  const data = await getDashboardData(user.id, { from, to, accountId });
  const today = data.todayKey;

  const unreviewedTrades: UnreviewedTradeSummary[] = data.todayTrades
    .filter((t) => t.reviewedAt == null)
    .map((t) => ({ id: t.id, dateKey: today, assetSymbol: t.assetSymbol }));

  const recentReflections = data.recentTrades
    .filter((t) => t.psychPostTradeReflection || t.psychLessonsLearned)
    .slice(0, 3);

  const strategyName = data.todayTrades[0]?.strategyNameSnapshot ?? null;

  return (
    <PrivacyModeProvider>
      <FadeIn className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Welcome back
              {user.name ? <>, {user.name}</> : null}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{formatDateKeyLong(today)}</p>
          </div>
        </div>

        <CommandBar
          sessions={data.sessions}
          accounts={data.accounts}
          preset={preset}
          unreviewedTrades={unreviewedTrades}
        />

        <KpiRow analytics={data.analytics} previousAnalytics={data.previousAnalytics} />

        {/* Equity curve pairs with Today — both land around the same natural
            height, so this row doesn't leave a stretched, empty-looking gap
            on the shorter side (see [[dashboard-command-center]]). */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <CommandEquityCurve
              data={data.analytics.trading.equityCurve}
              startingBalance={data.analytics.trading.startingBalance}
              expectedVsActual={data.analytics.trading.expectedVsActualCurve}
            />
          </div>
          <div className="lg:col-span-4">
            <TodayPanel
              todayKey={today}
              prepCompletedAt={data.tradingDay?.prepCompletedAt ?? null}
              routineReadyAt={data.tradingDay?.routineReadyAt ?? null}
              strategyName={strategyName}
              risk={data.todayRisk}
            />
          </div>
        </div>

        {/* The month calendar is naturally tall (a 6-week grid) — paired with
            the Performance + Prop-Firm cards stacked on the other side, which
            grow with account count, so the two sides track each other rather
            than one dwarfing the other. */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <MiniJournalCalendar dailyPnl={data.dailyPnl} />
          </div>
          <div className="space-y-4 lg:col-span-8">
            <PerformanceAccountCard
              currentBalance={data.analytics.trading.currentBalance}
              netPnl={data.analytics.trading.netPnl}
              winRate={data.analytics.trading.winRate}
              profitFactor={data.analytics.trading.profitFactor}
            />
            {data.propFirmHealth.length === 0 ? (
              <div className="glass flex items-center rounded-lg p-3 text-xs text-muted-foreground">
                No active prop-firm accounts.{" "}
                <Link href="/prop-firms" className="ml-1 font-medium text-primary hover:underline">
                  Add one →
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {data.propFirmHealth.map((summary) => (
                  <PropFirmHealthCard key={summary.accountId} summary={summary} />
                ))}
              </div>
            )}
          </div>
        </div>

        <section className="glass space-y-3 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Trophy className="size-4" />
              Recent Trades
            </h2>
            <Link href="/trades-album" className="text-xs font-medium text-primary hover:underline">
              Full trade history →
            </Link>
          </div>
          <RecentTradesTable trades={data.recentTrades} />
        </section>

        <QuickActions />

        <section id="notes" className="glass space-y-3 rounded-xl p-4 scroll-mt-20">
          <h2 className="text-sm font-medium text-muted-foreground">Today&apos;s Notes</h2>
          {/* The Dashboard's quick note is the LIVE Journal's note for today. */}
          <WorkspaceProvider value={LIVE_WORKSPACE}>
            <DailyNoteEditor dateKey={today} initialContent={data.todayNote?.content ?? null} />
          </WorkspaceProvider>
        </section>

        {recentReflections.length > 0 && (
          <section className="space-y-3">
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Sparkles className="size-4" />
              Recent Psychology Notes
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {recentReflections.map((t) => (
                <Link
                  key={t.id}
                  href={`/journal/${t.tradeDate.toISOString().slice(0, 10)}`}
                  className="glass block rounded-lg p-3 text-sm transition-all hover:-translate-y-0.5 hover:shadow-elevated"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{t.assetSymbol}</span>
                    <span className="tabular-nums">{t.tradeDate.toISOString().slice(0, 10)}</span>
                  </div>
                  <p className="line-clamp-2">{t.psychPostTradeReflection || t.psychLessonsLearned}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {data.recentTrades.length === 0 && (
          <EmptyState
            icon={Sparkles}
            title="Nothing logged yet"
            description="Log your first trade to start seeing your command center come alive."
          />
        )}
      </FadeIn>
    </PrivacyModeProvider>
  );
}
