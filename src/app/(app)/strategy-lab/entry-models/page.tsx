import Link from "next/link";
import { ChevronLeft, Layers } from "lucide-react";

import { requireUser } from "@/server/guards";
import { listEntryModels } from "@/server/services/entry-models.service";
import { Button } from "@/components/ui/button";
import { EntryModelsSection } from "@/components/plan/sections/entry-models-section";
import { FadeIn } from "@/components/shared/motion";

// Entry Models — the reusable, cross-strategy entry-model list, managed under
// Strategy Lab (methodology's home). Trades tag from this list; each strategy can
// still document its own detailed entry models in its workspace.
export default async function EntryModelsPage() {
  const user = await requireUser();
  const entryModels = await listEntryModels(user.id);

  return (
    <FadeIn className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to Strategy Lab"
          nativeButton={false}
          render={<Link href="/strategy-lab" />}
        >
          <ChevronLeft />
        </Button>
        <div className="flex items-center gap-2.5">
          <span className="bg-brand-gradient inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-glow">
            <Layers className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Entry Models</h1>
            <p className="text-sm text-muted-foreground">
              Your reusable entry models — e.g. Liquidity Sweep, SMT, Breaker, Order Block, FVG.
              Selectable on every trade.
            </p>
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-4">
        <EntryModelsSection initialItems={entryModels} />
      </div>
    </FadeIn>
  );
}
