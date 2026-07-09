import Link from "next/link";
import {
  Brain,
  CheckSquare,
  ClipboardCheck,
  Clock,
  Layers,
  LineChart,
  ShieldAlert,
  ShieldOff,
  Sparkles,
  Sunrise,
  Target,
} from "lucide-react";

import { requireUser } from "@/server/guards";
import { getTradingPlan } from "@/server/services/trading-plan.service";
import { listAssets } from "@/server/services/assets.service";
import { listEntryModels } from "@/server/services/entry-models.service";
import { listTradingSessions } from "@/server/services/trading-sessions.service";
import { listPsychAnchors } from "@/server/services/psych-anchors.service";
import { listChecklistItems } from "@/server/services/checklist-items.service";

import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { PlanSectionCard } from "@/components/plan/plan-section-card";
import { DailyRoutineSection } from "@/components/plan/sections/daily-routine-section";
import { AssetsSection } from "@/components/plan/sections/assets-section";
import { TradingSessionsSection } from "@/components/plan/sections/trading-sessions-section";
import { StrategyFrameworkSection } from "@/components/plan/sections/strategy-framework-section";
import { RiskManagementSection } from "@/components/plan/sections/risk-management-section";
import { EntryModelsSection } from "@/components/plan/sections/entry-models-section";
import { ProfitTakingSection } from "@/components/plan/sections/profit-taking-section";
import { StopLossSection } from "@/components/plan/sections/stop-loss-section";
import { PsychAnchorsSection } from "@/components/plan/sections/psych-anchors-section";
import { ChecklistSection } from "@/components/plan/sections/checklist-section";
import { FadeIn } from "@/components/shared/motion";

export default async function TradingPlanPage() {
  const user = await requireUser();

  const [plan, assets, entryModels, sessions, anchors, confluences, executionItems] =
    await Promise.all([
      getTradingPlan(user.id),
      listAssets(user.id),
      listEntryModels(user.id),
      listTradingSessions(user.id),
      listPsychAnchors(user.id),
      listChecklistItems(user.id, "CONFLUENCE"),
      listChecklistItems(user.id, "EXECUTION_CONFIRMATION"),
    ]);

  return (
    <FadeIn className="mx-auto max-w-3xl space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trading Plan</h1>
        <p className="text-sm text-muted-foreground">
          Your rules, watchlist, and reminders — everything the journal draws from.
        </p>
      </div>

      <Accordion multiple className="space-y-0">
        <PlanSectionCard value="daily-routine" icon={Sunrise} title="Daily Routine">
          <DailyRoutineSection plan={plan} />
        </PlanSectionCard>

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

        <PlanSectionCard value="strategy-framework" icon={Target} title="Strategy Framework">
          <StrategyFrameworkSection strategyFramework={plan.strategyFramework} />
        </PlanSectionCard>

        <PlanSectionCard value="risk-management" icon={ShieldAlert} title="Risk Management">
          <RiskManagementSection plan={plan} />
        </PlanSectionCard>

        <PlanSectionCard
          value="entry-models"
          icon={Layers}
          title="Entry Models"
          description="e.g. Liquidity Sweep, SMT, Breaker, Order Block, FVG."
        >
          <EntryModelsSection initialItems={entryModels} />
        </PlanSectionCard>

        <PlanSectionCard value="profit-taking" icon={Sparkles} title="Profit Taking Rules">
          <ProfitTakingSection profitTakingRules={plan.profitTakingRules} />
        </PlanSectionCard>

        <PlanSectionCard value="stop-loss" icon={ShieldOff} title="Stop Loss Placement">
          <StopLossSection stopLossPlacement={plan.stopLossPlacement} />
        </PlanSectionCard>

        <PlanSectionCard
          value="psych-anchors"
          icon={Brain}
          title="Psychological Anchors"
          description="Reminders shown to keep you disciplined."
        >
          <PsychAnchorsSection initialItems={anchors} />
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
