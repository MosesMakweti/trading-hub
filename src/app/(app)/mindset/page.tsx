import { requireUser } from "@/server/guards";
import { loadMindsetDashboard } from "@/server/services/mindset.service";
import { MindsetDashboard } from "@/components/mindset/mindset-dashboard";

/**
 * Mindset — pre-trading meditation and mental conditioning. A calm space with
 * its own visual identity: personal mantras as a slow slideshow over gentle
 * generated ambience, an optional breathing guide, and (when Edge Review has
 * enough evidence) a session suggested by recurring review findings.
 */
export default async function MindsetPage() {
  const user = await requireUser();
  const data = await loadMindsetDashboard(user.id);
  return <MindsetDashboard data={data} />;
}
