import { requireUser } from "@/server/guards";
import { loadTradingWorkspace } from "@/server/services/trading-workspace.service";
import { getTraderTodayKey } from "@/server/services/trader-time.service";
import { FadeIn } from "@/components/shared/motion";
import { TodayWorkspace } from "@/components/today/today-workspace";
import { TodayV3Workspace } from "@/components/today-v3/today-v3-workspace";
import { LIVE_WORKSPACE, WorkspaceProvider } from "@/components/workspace/workspace-context";

/** Today V3 is the LIVE Today shell. `TODAY_V3=off` is a deploy-time escape
 *  hatch back to the V2 workspace (same data, same actions). Backtesting and
 *  Replay never read this flag — they always mount the V2 TodayWorkspace. */
const useV3 = process.env.TODAY_V3 !== "off";

export default async function TodayPage() {
  const user = await requireUser();
  // LIVE: the effective date is the trader's local date (their configured
  // timezone; UTC until one is confirmed) — never the server's calendar.
  const todayKey = await getTraderTodayKey(user.id);
  const data = await loadTradingWorkspace(user.id, todayKey, { environment: "LIVE" });

  return (
    <FadeIn className={useV3 ? "mx-auto max-w-6xl" : "mx-auto max-w-5xl"}>
      <WorkspaceProvider value={LIVE_WORKSPACE}>
        {useV3 ? <TodayV3Workspace {...data} /> : <TodayWorkspace {...data} />}
      </WorkspaceProvider>
    </FadeIn>
  );
}
