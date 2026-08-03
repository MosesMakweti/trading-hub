import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getStrategyVersion } from "@/server/services/strategies.service";
import { FadeIn } from "@/components/shared/motion";
import { StrategyVersionSnapshotView } from "@/components/strategy-lab/strategy-version-snapshot-view";

export default async function StrategyVersionPage({
  params,
}: {
  params: Promise<{ strategyId: string; version: string }>;
}) {
  const { strategyId, version } = await params;
  const versionNumber = Number(version);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) notFound();

  const user = await requireUser();
  const data = await getStrategyVersion(user.id, strategyId, versionNumber);
  if (!data) notFound();

  return (
    <FadeIn className="mx-auto max-w-4xl">
      <StrategyVersionSnapshotView
        strategyId={strategyId}
        version={data.version}
        note={data.note}
        createdAt={data.createdAt}
        snapshot={data.snapshot}
      />
    </FadeIn>
  );
}
