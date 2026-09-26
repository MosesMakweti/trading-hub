import { loadOwnedRun } from "../load-run";
import { runInBacktestRun } from "@/server/services/backtest-run.service";
import { listClosedDayKeys, listDailyPerformanceSummaries } from "@/server/services/close-day.service";
import { FadeIn } from "@/components/shared/motion";
import { listNoteDateKeys } from "@/server/services/journal.service";
import { BacktestJournalView } from "@/components/backtesting/backtest-journal-view";

/** Backtesting Journal — the run's days on the shared Journal calendar. Reads
 *  only inside the run's scope; viewing never creates a record. */
export default async function BacktestJournalPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { user, run } = await loadOwnedRun(runId);
  const { days, closed, noteDates } = await runInBacktestRun(user.id, run.id, async () => ({
    days: await listDailyPerformanceSummaries(user.id),
    closed: await listClosedDayKeys(user.id),
    noteDates: await listNoteDateKeys(user.id),
  }));

  return (
    <FadeIn>
      <BacktestJournalView
        days={days}
        noteDates={noteDates}
        run={{
          hrefBase: `/backtesting/${run.id}/journal`,
          startDateKey: run.startDateKey,
          endDateKey: run.endDateKey,
          tradingWeekdays: run.tradingWeekdays,
          closedDates: closed,
          initialDateKey: run.currentPositionDateKey ?? run.resumeDateKey,
        }}
      />
    </FadeIn>
  );
}
