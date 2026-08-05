import Link from "next/link";
import { CheckSquare, ClipboardCheck, Clock, LineChart } from "lucide-react";

import { requireUser } from "@/server/guards";
import { listAssets } from "@/server/services/assets.service";
import { listTradingSessions } from "@/server/services/trading-sessions.service";
import { listChecklistItems } from "@/server/services/checklist-items.service";

import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { PlanSectionCard } from "@/components/plan/plan-section-card";
import { AssetsSection } from "@/components/plan/sections/assets-section";
import { TradingSessionsSection } from "@/components/plan/sections/trading-sessions-section";
import { ChecklistSection } from "@/components/plan/sections/checklist-section";
import { FadeIn } from "@/components/shared/motion";

// Trade Setup — the operational lists the trade form draws from. The trading
// *methodology* (framework, profit-taking, stop-loss, risk, psychology) now lives
// in Strategy Lab; the daily prep ritual lives in Today's Pre-Session Routine.
export default async function TradeSetupPage() {
  const user = await requireUser();

  const [assets, sessions, confluences, executionItems] = await Promise.all([
    listAssets(user.id),
    listTradingSessions(user.id),
    listChecklistItems(user.id, "CONFLUENCE"),
    listChecklistItems(user.id, "EXECUTION_CONFIRMATION"),
  ]);

  return (
    <FadeIn className="mx-auto max-w-3xl space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trade Setup</h1>
        <p className="text-sm text-muted-foreground">
          The lists every trade draws from — your watchlist, sessions, and checklists. Your
          strategy, methodology, and entry models live in Strategy Lab.
        </p>
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

        <PlanSectionCard
          value="confluences"
          icon={CheckSquare}
          title="Confluences Checklist"
          description="Selectable per trade — e.g. FVG, SMT, MSS, Liquidity Sweep."
        >
          <ChecklistSection type="CONFLUENCE" initialItems={confluences} />
        </PlanSectionCard>

        <PlanSectionCard
          value="execution-confirmation"
          icon={ClipboardCheck}
          title="Execution Confirmation"
          description="A separate checklist confirming clean execution."
        >
          <ChecklistSection type="EXECUTION_CONFIRMATION" initialItems={executionItems} />
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
