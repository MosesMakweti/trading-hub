import { cache } from "react";
import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getBacktestRunDetail } from "@/server/services/backtest-run.service";

/**
 * The run-route security gate, shared by the run layout and every run page:
 * authenticated user → owns this BacktestRun → otherwise 404 (the same
 * not-found behaviour the app uses for any record that isn't yours, so a
 * foreign run id is indistinguishable from a nonexistent one). Memoized per
 * request so layout + page verify once. Loads the run DETAIL only — never
 * the run's trades — so navigating between run pages stays cheap however
 * many trades the run holds.
 */
export const loadOwnedRun = cache(async (runId: string) => {
  const user = await requireUser();
  const run = await getBacktestRunDetail(user.id, runId);
  if (!run) notFound();
  return { user, run };
});
