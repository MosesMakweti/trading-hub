import { requireUser } from "@/server/guards";
import { listHistoricalDatasets } from "@/server/services/native-replay/historical-dataset.service";
import { listDatasetPinsForUser } from "@/server/services/native-replay/backtest-dataset-pin.service";
import { listBacktestRunOverviews } from "@/server/services/backtest-run.service";
import { normalizeSymbol } from "@/domain/native-replay/import-analysis";
import { FadeIn } from "@/components/shared/motion";
import { BacktestingNav } from "@/components/backtesting/backtesting-nav";
import { HistoricalDataPanel, type AttachOption } from "@/components/native-replay/historical-data-panel";

// The import server action runs in this page's function: a 2M-bar (≈120MB)
// file takes ~30s and ~0.8GB peak memory to validate and write (measured).
export const maxDuration = 300;

/**
 * Native Replay — dataset management (intentionally utilitarian): upload an
 * MT5 M1 export straight to storage, review the validation report, attach a
 * dataset to a Backtest Run asset, see which runs use it, delete when unused.
 */
export default async function HistoricalDataPage() {
  const user = await requireUser();
  const [datasets, pins, runs] = await Promise.all([listHistoricalDatasets(user.id), listDatasetPinsForUser(user.id), listBacktestRunOverviews(user.id)]);
  const currentRunId = runs.find((r) => r.status === "ACTIVE")?.id ?? null;

  // Where each READY dataset could be attached: active runs whose asset normalises to the dataset's symbol.
  const attachOptions: Record<string, AttachOption[]> = {};
  for (const d of datasets) {
    if (d.status !== "READY") continue;
    attachOptions[d.id] = runs
      .filter((r) => r.status === "ACTIVE")
      .flatMap((r) => r.assets.filter((a) => normalizeSymbol(a) === d.symbol).map((assetSymbol) => ({ runId: r.id, runName: r.name, assetSymbol, period: `${r.startDateKey} → ${r.endDateKey}` })))
      .filter((o) => !pins.some((p) => p.runId === o.runId && p.assetSymbol === o.assetSymbol && (p.frozen || p.datasetId === d.id)));
  }

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Historical data</h1>
        <p className="text-sm text-muted-foreground">
          MT5 M1 bar history for Native Replay. Import M1 once — every higher timeframe is built from it.
        </p>
      </div>
      <BacktestingNav runId={currentRunId} />
      <HistoricalDataPanel datasets={datasets} pins={pins} attachOptions={attachOptions} />
    </FadeIn>
  );
}
