import Link from "next/link";
import { CandlestickChart } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { formatReplayTime } from "@/domain/native-replay/chart-time";
import type { ReplayStateDTO } from "@/server/services/native-replay/backtest-replay.service";

/**
 * Native Replay's footprint on the Backtesting Session page: where the run's
 * replay stands for this date, and the way into the full-screen replay
 * workspace (which embeds this same Session workflow in a side panel).
 */
export function ReplayStatusCard({ state, runId }: { state: ReplayStateDTO; runId: string }) {
  const href = `/backtesting/${runId}/replay?date=${state.dateKey}`;
  const summary =
    state.status === "NO_DATASETS"
      ? "No historical data attached to this run yet."
      : state.status === "NO_BARS_FOR_DATE"
        ? "No market data in the attached datasets for this date."
        : state.status === "NOT_STARTED"
          ? `Ready · ${state.assets.filter((a) => a.day).map((a) => a.assetSymbol).join(", ")}`
          : `Replay at ${formatReplayTime(state.position!.minute)}${state.position!.atDayEnd ? " · end of day" : ""}`;
  return (
    <section aria-label="Native Replay" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
      <div className="flex items-center gap-3">
        <CandlestickChart className="size-4 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">Native Replay</p>
          <p className="text-xs text-muted-foreground tabular-nums">{summary}</p>
        </div>
      </div>
      {state.status === "NO_DATASETS" ? (
        <Link href="/backtesting/data" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Attach MT5 data
        </Link>
      ) : (
        <Link href={href} className={buttonVariants({ size: "sm" })}>
          Open Replay
        </Link>
      )}
    </section>
  );
}
