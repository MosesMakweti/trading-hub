import Link from "next/link";
import { Clock, LineChart, Target } from "lucide-react";

import { requireUser } from "@/server/guards";
import { listAssets } from "@/server/services/assets.service";
import { listTradingSessions } from "@/server/services/trading-sessions.service";

import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { PlanSectionCard } from "@/components/plan/plan-section-card";
import { AssetsSection } from "@/components/plan/sections/assets-section";
import { TradingSessionsSection } from "@/components/plan/sections/trading-sessions-section";
import { FadeIn } from "@/components/shared/motion";

// Trade Setup — the shared watchlist + sessions the trade form draws from.
// Confluences and execution confirmations are now defined per strategy in
// Strategy Lab (SOT), so they no longer live here. Methodology (framework,
// profit-taking, risk, psychology) lives in Strategy Lab; the daily prep ritual
// lives in Today's Pre-Session Routine.
export default async function TradeSetupPage() {
  const user = await requireUser();

  const [assets, sessions] = await Promise.all([
    listAssets(user.id),
    listTradingSessions(user.id),
  ]);

  return (
    <FadeIn className="mx-auto max-w-3xl space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trade Setup</h1>
        <p className="text-sm text-muted-foreground">
          Your shared watchlist and trading sessions. Confluences and execution confirmations now
          live inside each strategy in Strategy Lab.
        </p>
      </div>

      <div className="glass flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <Target className="mt-0.5 size-4.5 shrink-0 text-primary" />
        <div className="text-sm">
          <span className="font-medium">Confluences &amp; execution moved to Strategy Lab.</span>{" "}
          <span className="text-muted-foreground">
            Each strategy defines its own — pick a strategy when adding a trade to load them.
          </span>
          <Link
            href="/strategy-lab"
            className="ml-1 font-medium text-primary underline-offset-4 hover:underline"
          >
            Open Strategy Lab
          </Link>
        </div>
      </div>

      <Accordion multiple className="space-y-0">
        <PlanSectionCard
          value="assets"
          icon={LineChart}
          title="Assets to Trade"
          description="Populates the asset dropdown in every journal entry."
        >
          <AssetsSection initialItems={assets} />
        </PlanSectionCard>

        <PlanSectionCard value="trading-session" icon={Clock} title="Trading Session">
          <TradingSessionsSection initialItems={sessions} />
        </PlanSectionCard>
      </Accordion>

      <div className="flex justify-center pt-4">
        <Button size="lg" className="gap-2" nativeButton={false} render={<Link href="/journal" />}>
          Open Trading Journal
        </Button>
      </div>
    </FadeIn>
  );
}
