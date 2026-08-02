import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getStrategy } from "@/server/services/strategies.service";
import { listArsenalConcepts } from "@/server/services/arsenal.service";
import { listFrameworkSteps } from "@/server/services/framework.service";
import { listTimeframes } from "@/server/services/timeframes.service";
import { listEntryModels } from "@/server/services/strategy-entry-models.service";
import { FadeIn } from "@/components/shared/motion";
import { StrategyWorkspace } from "@/components/strategy-lab/strategy-workspace";
import type {
  ArsenalConceptDTO,
  EntryModelDTO,
  FrameworkStepDTO,
  StrategyDTO,
  TimeframeDTO,
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

  const [concepts, steps, timeframes, entryModels] = await Promise.all([
    listArsenalConcepts(user.id, strategyId),
    listFrameworkSteps(user.id, strategyId),
    listTimeframes(user.id, strategyId),
    listEntryModels(user.id, strategyId),
  ]);

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

  return (
    <FadeIn>
      <StrategyWorkspace
        strategy={dto}
        arsenalConcepts={arsenalConcepts}
        frameworkSteps={frameworkSteps}
        timeframes={timeframeDtos}
        entryModels={entryModelDtos}
      />
    </FadeIn>
  );
}
