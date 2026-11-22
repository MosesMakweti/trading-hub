import type { Metadata } from "next";

import { requireUser } from "@/server/guards";
import { FadeIn } from "@/components/shared/motion";
import { SimulationBadge } from "@/components/backtesting/simulation-badge";
import { SimulationNav } from "@/components/simulation/simulation-nav";
import { ScriptWorkbench } from "@/components/scripting/script-workbench";

export const metadata: Metadata = { title: "Scripts · Backtesting" };

/** The script library and editor. Running on candles happens in a simulation terminal. */
export default async function ScriptsPage() {
  await requireUser();
  return (
    <FadeIn className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-2">
        <SimulationBadge />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Scripts</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Write indicators and strategies in Traditorium Script — Pine Script®-style syntax, a documented subset of v6 (not TradingView&apos;s Pine Script). Every save is kept as a version. To run a script on candles, open a Strategy Lab or Prop Firm terminal: the <em>Scripts &amp; Strategy Tester</em> panel and the chart&apos;s Indicators menu use it there, on candles you have already replayed.
        </p>
      </div>
      <SimulationNav />
      <div className="h-[70vh] min-h-[28rem] overflow-hidden rounded-xl border border-border bg-card [contain:inline-size]">
        <ScriptWorkbench />
      </div>
    </FadeIn>
  );
}
