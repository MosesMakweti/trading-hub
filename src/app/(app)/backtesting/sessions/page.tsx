import { requireUser } from "@/server/guards";
import { listLibrary } from "@/server/services/simulation/session-library.service";
import { FadeIn } from "@/components/shared/motion";
import { SimulationNav } from "@/components/simulation/simulation-nav";
import { SimulationBadge } from "@/components/backtesting/simulation-badge";
import { SessionLibrary } from "@/components/simulation/session-library";

/** Every backtesting session the trader has: Strategy Lab, Prop Firm and legacy runs. */
export default async function SessionLibraryPage() {
  const user = await requireUser();
  const sessions = await listLibrary(user.id, { scope: "all" });
  return (
    <FadeIn className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <SimulationBadge />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sessions</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">All your backtests in one place. Rename, duplicate, archive or delete them. Archived sessions can be restored at any time.</p>
      </div>
      <SimulationNav />
      <SessionLibrary sessions={sessions} />
    </FadeIn>
  );
}
