import { readExecutionPlan, readScenarioContext } from "@/domain/strategies/scenario-playbook";
import { getStrategy, listStrategyVersions } from "@/server/services/strategies.service";
import { listArsenalConcepts } from "@/server/services/arsenal.service";
import { listFrameworkSteps } from "@/server/services/framework.service";
import { listTimeframes } from "@/server/services/timeframes.service";
import { listEntryModels } from "@/server/services/strategy-entry-models.service";
import { getTradeManagement } from "@/server/services/strategy-trade-management.service";
import { listStrategyChecklist, listStrategySessions } from "@/server/services/strategy-sot.service";
import { listSetupTypesWithScenarios } from "@/server/services/strategy-setup-types.service";
import type {
  ArsenalConceptDTO,
  EntryModelDTO,
  FrameworkStepDTO,
  StrategyDTO,
  StrategySetupTypeDTO,
  StrategyVersionDTO,
  TimeframeDTO,
  TradeManagementDTO,
} from "@/types/strategies";
import type { StrategyChecklistItemDTO } from "@/components/strategy-lab/sot/strategy-checklist-section";
import type { StrategySessionDTO } from "@/components/strategy-lab/sot/strategy-sessions-section";

/** Everything the strategy editors need, as serializable DTOs. */
export interface StrategyWorkspaceData {
  strategy: StrategyDTO;
  arsenalConcepts: ArsenalConceptDTO[];
  frameworkSteps: FrameworkStepDTO[];
  timeframes: TimeframeDTO[];
  entryModels: EntryModelDTO[];
  tradeManagement: TradeManagementDTO;
  versions: StrategyVersionDTO[];
  sessions: StrategySessionDTO[];
  confluences: StrategyChecklistItemDTO[];
  execution: StrategyChecklistItemDTO[];
  setupTypes: StrategySetupTypeDTO[];
}

/**
 * The ONE loader for a strategy's editable workspace — used by the Strategy
 * Lab page and by the Backtesting terminal's embedded Strategy Builder, so
 * both environments edit exactly the same data through the same services.
 * Read-only (opening never writes). Null if missing / not the user's.
 */
export async function loadStrategyWorkspace(userId: string, strategyId: string): Promise<StrategyWorkspaceData | null> {
  const strategy = await getStrategy(userId, strategyId);
  if (!strategy) return null;

  const [
    concepts,
    steps,
    timeframes,
    entryModels,
    tradeManagement,
    versions,
    sessionRows,
    confluenceRows,
    executionRows,
    setupTypeRows,
  ] = await Promise.all([
    listArsenalConcepts(userId, strategyId),
    listFrameworkSteps(userId, strategyId),
    listTimeframes(userId, strategyId),
    listEntryModels(userId, strategyId),
    getTradeManagement(userId, strategyId),
    listStrategyVersions(userId, strategyId),
    listStrategySessions(userId, strategyId),
    listStrategyChecklist(userId, strategyId, "CONFLUENCE"),
    listStrategyChecklist(userId, strategyId, "EXECUTION"),
    listSetupTypesWithScenarios(userId, strategyId),
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
      name: sc.name,
      direction: sc.direction,
      scenarioType: sc.scenarioType,
      customType: sc.customType,
      instruments: sc.instruments,
      timeframes: sc.timeframes,
      context: readScenarioContext(sc.context),
      executionPlan: readExecutionPlan(sc.executionPlan),
      sortOrder: sc.sortOrder,
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
        note: c.note,
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

  // No record yet = nothing saved; the first edit creates it server-side.
  const tradeManagementDto: TradeManagementDTO = tradeManagement
    ? {
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
      }
    : emptyTradeManagement();


  return {
    strategy: dto,
    arsenalConcepts,
    frameworkSteps,
    timeframes: timeframeDtos,
    entryModels: entryModelDtos,
    tradeManagement: tradeManagementDto,
    versions,
    sessions,
    confluences,
    execution,
    setupTypes,
  };
}

function emptyTradeManagement(): TradeManagementDTO {
  return {
    id: "",
    takeProfitPhilosophy: null,
    initialStopPlacement: null,
    breakEvenRules: null,
    trailingStopRules: null,
    scalingInRules: null,
    scalingOutRules: null,
    maxHoldingTime: null,
    maxRiskPercent: null,
    expectedWinRate: null,
    expectedAvgRr: null,
    expectedExpectancy: null,
    minExecutionScore: null,
    maxDailyRiskPercent: null,
    maxTradesPerDay: null,
    partialTakeProfits: [],
    customRules: [],
  };
}
