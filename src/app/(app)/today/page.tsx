import { requireUser } from "@/server/guards";
import { loadTradingWorkspace } from "@/server/services/trading-workspace.service";
import { localDateToKey } from "@/lib/date";
import { FadeIn } from "@/components/shared/motion";
import { TodayWorkspace } from "@/components/today/today-workspace";
import { LIVE_WORKSPACE, WorkspaceProvider } from "@/components/workspace/workspace-context";

export default async function TodayPage() {
  const user = await requireUser();
  // LIVE: the effective date is the real trading day.
  const todayKey = localDateToKey(new Date());
  const data = await loadTradingWorkspace(user.id, todayKey, { environment: "LIVE" });

  return (
    <FadeIn className="mx-auto max-w-5xl">
      <WorkspaceProvider value={LIVE_WORKSPACE}>
        <TodayWorkspace {...data} />
      </WorkspaceProvider>
    </FadeIn>
  );
}
