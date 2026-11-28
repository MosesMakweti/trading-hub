import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getStrategyExpectancy, getStrategyPerformance } from "@/server/services/analytics.service";
import { loadStrategyWorkspace } from "@/server/services/strategy-workspace.service";
import { FadeIn } from "@/components/shared/motion";
import { StrategyWorkspace } from "@/components/strategy-lab/strategy-workspace";

export default async function StrategyWorkspacePage({
  params,
}: {
  params: Promise<{ strategyId: string }>;
}) {
  const { strategyId } = await params;
  const user = await requireUser();
  const [data, performance, liveExpectancy] = await Promise.all([
    loadStrategyWorkspace(user.id, strategyId),
    getStrategyPerformance(user.id, strategyId),
    getStrategyExpectancy(user.id, strategyId),
  ]);
  if (!data) notFound();

  return (
    <FadeIn>
      <StrategyWorkspace {...data} performance={performance} liveExpectancy={liveExpectancy} />
    </FadeIn>
  );
}
