import { requireUser } from "@/server/guards";
import { listStrategies } from "@/server/services/strategies.service";
import { FadeIn } from "@/components/shared/motion";
import { StrategyLabView } from "@/components/strategy-lab/strategy-lab-view";
import type { StrategyDTO } from "@/types/strategies";

export default async function StrategyLabPage() {
  const user = await requireUser();
  const rows = await listStrategies(user.id);

  const strategies: StrategyDTO[] = rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    applicableAssets: s.applicableAssets,
    status: s.status,
    version: s.version,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));

  return (
    <FadeIn className="mx-auto max-w-6xl">
      <StrategyLabView strategies={strategies} />
    </FadeIn>
  );
}
