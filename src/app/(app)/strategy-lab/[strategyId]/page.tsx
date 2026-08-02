import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getStrategy } from "@/server/services/strategies.service";
import { listArsenalConcepts } from "@/server/services/arsenal.service";
import { listFrameworkSteps } from "@/server/services/framework.service";
import { FadeIn } from "@/components/shared/motion";
import { StrategyWorkspace } from "@/components/strategy-lab/strategy-workspace";
import type { ArsenalConceptDTO, FrameworkStepDTO, StrategyDTO } from "@/types/strategies";

export default async function StrategyWorkspacePage({
  params,
}: {
  params: Promise<{ strategyId: string }>;
}) {
  const { strategyId } = await params;
  const user = await requireUser();
  const strategy = await getStrategy(user.id, strategyId);
  if (!strategy) notFound();

  const [concepts, steps] = await Promise.all([
    listArsenalConcepts(user.id, strategyId),
    listFrameworkSteps(user.id, strategyId),
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

  return (
    <FadeIn>
      <StrategyWorkspace
        strategy={dto}
        arsenalConcepts={arsenalConcepts}
        frameworkSteps={frameworkSteps}
      />
    </FadeIn>
  );
}
