import { requireUser } from "@/server/guards";
import { listFirmModels } from "@/server/services/simulation/sim-prop.service";
import { listHistoricalDatasets } from "@/server/services/native-replay/historical-dataset.service";
import { FadeIn } from "@/components/shared/motion";
import { SimulationNav } from "@/components/simulation/simulation-nav";
import { PurchaseChallenge } from "@/components/simulation/prop/purchase-challenge";

export default async function NewChallengePage() {
  const user = await requireUser();
  const [models, datasets] = await Promise.all([listFirmModels(user.id), listHistoricalDatasets(user.id)]);
  return (
    <FadeIn className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">New challenge</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">Choose a firm model and size, review every rule, then pick the instruments and historical period to trade it on. This is a simulation: the fee is recorded, nothing is charged.</p>
      </div>
      <SimulationNav />
      <PurchaseChallenge
        models={models.map((m) => ({ id: m.id, source: m.source, version: m.version, model: m.model }))}
        datasets={datasets.filter((d) => d.status === "READY").map((d) => ({ id: d.id, symbol: d.symbol, firstBar: d.firstBar, lastBar: d.lastBar }))}
      />
    </FadeIn>
  );
}
