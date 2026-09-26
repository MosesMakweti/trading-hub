import { redirect } from "next/navigation";

import { loadOwnedRun } from "../load-run";
import {
  isBacktestDayComplete,
  listTradingDayKeys,
  nextTradingDayKey,
  normalizeSessionDateKey,
  previousTradingDayKey,
  type RunPeriod,
} from "@/domain/backtesting/run-calendar";
import { loadTradingWorkspace } from "@/server/services/trading-workspace.service";
import { FadeIn } from "@/components/shared/motion";
import { BacktestSessionShell, type SessionDayState } from "@/components/backtesting/backtest-session-shell";
import { TodayWorkspace } from "@/components/today/today-workspace";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceEditableProvider } from "@/components/journal/workspace/editable-context";

/**
 * Backtesting Session. Security + context order: authenticated user → owns
 * the run (loadOwnedRun, 404 otherwise) → the date is normalized into the
 * run's trading calendar (and the URL made canonical, so a refresh always
 * reopens the same run + date) → the SAME loader and workflow as /today run
 * inside the run's BACKTEST scope, with the simulation date as the effective
 * date.
 */
export default async function BacktestSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const { user, run } = await loadOwnedRun(runId);

  const period: RunPeriod = { startDateKey: run.startDateKey, endDateKey: run.endDateKey, tradingWeekdays: run.tradingWeekdays };
  const requested = typeof query.date === "string" ? query.date : null;
  const dateKey = normalizeSessionDateKey(period, requested, run.resumeDateKey);
  if (dateKey !== requested) redirect(`/backtesting/${run.id}/session?date=${dateKey}`);

  const data = await loadTradingWorkspace(user.id, dateKey, { environment: "BACKTEST", runId: run.id });
  const dayState: SessionDayState = isBacktestDayComplete(data.day)
    ? "COMPLETED"
    : data.stepStatuses.some((s) => s.status === "done") || data.trades.length > 0
      ? "IN_PROGRESS"
      : "NOT_STARTED";
  const tradingDays = listTradingDayKeys(period);

  return (
    <FadeIn>
      <BacktestSessionShell
        runId={run.id}
        runStatus={run.status}
        period={period}
        dateKey={dateKey}
        previousDateKey={previousTradingDayKey(period, dateKey)}
        nextDateKey={nextTradingDayKey(period, dateKey)}
        dayIndex={tradingDays.indexOf(dateKey) + 1}
        totalTradingDays={tradingDays.length}
        dayState={dayState}
      >
        <WorkspaceProvider value={{ environment: "BACKTEST", runId: run.id }}>
          <WorkspaceEditableProvider editable={run.status === "ACTIVE"}>
            {/* key = the simulated day: date navigation is client-side, and the
                workflow sections seed local state from props on mount — without
                a remount the previous date's state would carry over. */}
            <TodayWorkspace key={data.day.id} {...data} />
          </WorkspaceEditableProvider>
        </WorkspaceProvider>
      </BacktestSessionShell>
    </FadeIn>
  );
}
