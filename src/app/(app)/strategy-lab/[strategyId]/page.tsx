import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getStrategy, listStrategyVersions } from "@/server/services/strategies.service";
import { listArsenalConcepts } from "@/server/services/arsenal.service";
import { listFrameworkSteps } from "@/server/services/framework.service";
import { listTimeframes } from "@/server/services/timeframes.service";
import { listEntryModels } from "@/server/services/strategy-entry-models.service";
import { getOrCreateTradeManagement } from "@/server/services/strategy-trade-management.service";
import { getStrategyExpectancy, getStrategyPerformance } from "@/server/services/analytics.service";
import { listStrategyChecklist, listStrategySessions } from "@/server/services/strategy-sot.service";
import { listSetupTypesWithScenarios } from "@/server/services/strategy-setup-types.service";
import { FadeIn } from "@/components/shared/motion";
import { StrategyWorkspace } from "@/components/strategy-lab/strategy-workspace";
import type { StrategyChecklistItemDTO } from "@/components/strategy-lab/sot/strategy-checklist-section";
import type { StrategySessionDTO } from "@/components/strategy-lab/sot/strategy-sessions-section";
import type {
  ArsenalConceptDTO,
  EntryModelDTO,
  FrameworkStepDTO,
  StrategyDTO,
  StrategySetupTypeDTO,
  TimeframeDTO,
  TradeManagementDTO,
} from "@/types/strategies";

export default async function StrategyWorkspacePage({
  params,
}: {
  params: Promise<{ strategyId: string }>;
}) {
  const { strategyId } = await params;
  const user = await requireUser();
  const strategy = await getStrategy(user.id, strategyId);
  if (!strategy) notFound();

  const [
    concepts,
    steps,
    timeframes,
    entryModels,
    tradeManagement,
    performance,
    liveExpectancy,
    versions,
    sessionRows,
    confluenceRows,
    executionRows,
    setupTypeRows,
  ] = await Promise.all([
    listArsenalConcepts(user.id, strategyId),
    listFrameworkSteps(user.id, strategyId),
    listTimeframes(user.id, strategyId),
    listEntryModels(user.id, strategyId),
    getOrCreateTradeManagement(user.id, strategyId),
    getStrategyPerformance(user.id, strategyId),
    getStrategyExpectancy(user.id, strategyId),
    listStrategyVersions(user.id, strategyId),
    listStrategySessions(user.id, strategyId),
    listStrategyChecklist(user.id, strategyId, "CONFLUENCE"),
    listStrategyChecklist(user.id, strategyId, "EXECUTION"),
    listSetupTypesWithScenarios(user.id, strategyId),
  ]);

  const sessions: StrategySessionDTO[] = sessionRows.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    startMinutes: s.startMinutes,
    endMinutes: s.endMinutes,
    enabled: s.enabled,
  }));
  const toChecklistDto = (r: (typeof confluenceRows)[number]): StrategyChecklistItemDTO => ({
    id: r.id,
    name: r.name,
    color: r.color,
    category: r.category,
    description: r.description,
    weight: r.weight,
    mandatory: r.mandatory,
    directionApplicability: r.directionApplicability,
    pairId: r.pairId,
    validationCriteria: r.validationCriteria,
    enabled: r.enabled,
  });
  const confluences = confluenceRows.map(toChecklistDto);
  const execution = executionRows.map(toChecklistDto);

  const setupTypes: StrategySetupTypeDTO[] = setupTypeRows.map((st) => ({
    id: st.id,
    name: st.name,
    description: st.description,
    sortOrder: st.sortOrder,
    scenarios: st.scenarios.map((sc) => ({
      id: sc.id,
      direction: sc.direction,
      description: sc.description,
      conditions: sc.conditions.map((c) => ({
        id: c.id,
        checklistItemId: c.checklistItemId,
        name: c.checklistItem.name,
        color: c.checklistItem.color,
        kind: c.checklistItem.kind,
        directionApplicability: c.checklistItem.directionApplicability,
        baseWeight: c.checklistItem.weight,
        baseMandatory: c.checklistItem.mandatory,
        weightOverride: c.weightOverride,
        mandatoryOverride: c.mandatoryOverride,
        effectiveWeight: c.weightOverride ?? c.checklistItem.weight,
        effectiveMandatory: c.mandatoryOverride ?? c.checklistItem.mandatory,
        sortOrder: c.sortOrder,
      })),
    })),
  }));

  const dto: StrategyDTO = {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    applicableAssets: strategy.applicableAssets,
    status: strategy.status,
    version: strategy.version,
    createdAt: strategy.createdAt.toISOString(),
    updatedAt: strategy.updatedAt.toISOString(),
  };

  const arsenalConcepts: ArsenalConceptDTO[] = concepts.map((c) => ({
    id: c.id,
    name: c.name,
    definition: c.definition,
    purpose: c.purpose,
    howIIdentify: c.howIIdentify,
    whyItMatters: c.whyItMatters,
    whenIUse: c.whenIUse,
    whenIIgnore: c.whenIIgnore,
    examples: c.examples,
    personalNotes: c.personalNotes,
  }));

  const frameworkSteps: FrameworkStepDTO[] = steps.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    notes: s.notes,
  }));

  const timeframeDtos: TimeframeDTO[] = timeframes.map((t) => ({
    id: t.id,
    name: t.name,
    checkpoints: t.checkpoints.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      notes: c.notes,
    })),
  }));

  const entryModelDtos: EntryModelDTO[] = entryModels.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    conditions: m.conditions,
    confirmationChecklist: m.confirmationChecklist,
    invalidation: m.invalidation,
    stopPlacement: m.stopPlacement,
    targetLogic: m.targetLogic,
    notes: m.notes,
  }));

  const tradeManagementDto: TradeManagementDTO = {
    id: tradeManagement.id,
    takeProfitPhilosophy: tradeManagement.takeProfitPhilosophy,
    initialStopPlacement: tradeManagement.initialStopPlacement,
    breakEvenRules: tradeManagement.breakEvenRules,
    trailingStopRules: tradeManagement.trailingStopRules,
    scalingInRules: tradeManagement.scalingInRules,
    scalingOutRules: tradeManagement.scalingOutRules,
    maxHoldingTime: tradeManagement.maxHoldingTime,
    maxRiskPercent: tradeManagement.maxRiskPercent ? tradeManagement.maxRiskPercent.toNumber() : null,
    expectedWinRate: tradeManagement.expectedWinRate,
    expectedAvgRr: tradeManagement.expectedAvgRr,
    expectedExpectancy: tradeManagement.expectedExpectancy,
    minExecutionScore: tradeManagement.minExecutionScore,
    maxDailyRiskPercent: tradeManagement.maxDailyRiskPercent,
    maxTradesPerDay: tradeManagement.maxTradesPerDay,
    partialTakeProfits: tradeManagement.partialTakeProfits.map((p) => ({
      id: p.id,
      trigger: p.trigger,
      percentToClose: p.percentToClose ? p.percentToClose.toNumber() : null,
      reason: p.reason,
    })),
    customRules: tradeManagement.customRules.map((r) => ({ id: r.id, text: r.text })),
  };

  return (
    <FadeIn>
      <StrategyWorkspace
        strategy={dto}
        arsenalConcepts={arsenalConcepts}
        frameworkSteps={frameworkSteps}
        timeframes={timeframeDtos}
        entryModels={entryModelDtos}
        tradeManagement={tradeManagementDto}
        performance={performance}
        liveExpectancy={liveExpectancy}
        versions={versions}
        sessions={sessions}
        confluences={confluences}
        execution={execution}
        setupTypes={setupTypes}
      />
    </FadeIn>
  );
}
