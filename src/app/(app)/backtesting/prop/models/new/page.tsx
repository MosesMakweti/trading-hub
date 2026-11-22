import { requireUser } from "@/server/guards";
import { FadeIn } from "@/components/shared/motion";
import { SimulationNav } from "@/components/simulation/simulation-nav";
import { FirmModelBuilder } from "@/components/simulation/prop/firm-model-builder";

export default async function NewFirmModelPage() {
  await requireUser();
  return (
    <FadeIn className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Custom firm model</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">Describe a firm&apos;s rules — phases, loss limits, drawdown model, funded terms. Each challenge freezes the version it was bought on, so later edits never change it.</p>
      </div>
      <SimulationNav />
      <FirmModelBuilder />
    </FadeIn>
  );
}
