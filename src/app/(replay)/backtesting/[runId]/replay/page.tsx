import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { loadOwnedRun } from "@/app/(app)/backtesting/[runId]/load-run";
import { listTradingDayKeys, nextTradingDayKey, normalizeSessionDateKey, previousTradingDayKey, type RunPeriod } from "@/domain/backtesting/run-calendar";
import { loadTradingWorkspace } from "@/server/services/trading-workspace.service";
import { getReplayState } from "@/server/services/native-replay/backtest-replay.service";
import { ReplayWorkspace } from "@/components/native-replay/replay-workspace";
import { TodayWorkspace } from "@/components/today/today-workspace";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceEditableProvider } from "@/components/journal/workspace/editable-context";

export const metadata: Metadata = { title: "Replay" };

/**
 * Native Replay workspace for a Backtest Run: /backtesting/[runId]/replay?date=
 *
 * Same ownership and calendar rules as the Session page (loadOwnedRun → 404
 * for anyone else's run; the date normalised into the run's trading calendar
 * and the URL made canonical). The page provides the run's replay state for
 * the date (server truth) and the existing Session workflow for the side
 * panel — rendered by the same loader and components as the Session page,
 * in the run's BACKTEST scope. Asset and timeframe are client view state.
 */
export default async function ReplayPage({
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
  if (dateKey !== requested) redirect(`/backtesting/${run.id}/replay?date=${dateKey}`);

  const [state, data] = await Promise.all([
    getReplayState(user.id, { runId: run.id, dateKey }),
    loadTradingWorkspace(user.id, dateKey, { environment: "BACKTEST", runId: run.id }),
  ]);
  const tradingDays = listTradingDayKeys(period);

  return (
    <ReplayWorkspace
      key={dateKey}
      run={{ id: run.id, name: run.name, status: run.status, assets: run.assets }}
      dateKey={dateKey}
      previousDateKey={previousTradingDayKey(period, dateKey)}
      nextDateKey={nextTradingDayKey(period, dateKey)}
      dayIndex={tradingDays.indexOf(dateKey) + 1}
      totalTradingDays={tradingDays.length}
      initialState={state}
      tradeForm={{
        accounts: data.tradeFormAccounts,
        strategies: data.tradeFormStrategies,
        activeSessions: data.todaysPlan.activeSessions,
        sessionWindows: data.sessionWindows,
      }}
      sessionPanel={
        <WorkspaceProvider value={{ environment: "BACKTEST", runId: run.id }}>
          <WorkspaceEditableProvider editable={run.status === "ACTIVE"}>
            <TodayWorkspace key={data.day.id} {...data} />
          </WorkspaceEditableProvider>
        </WorkspaceProvider>
      }
    />
  );
}
