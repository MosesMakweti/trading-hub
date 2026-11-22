import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getSimAccountState } from "@/server/services/simulation/sim-state.service";
import { SimNotFoundError } from "@/server/services/simulation/sim-account.service";
import { listStudyOptions } from "@/server/services/simulation/sim-study.service";
import { SimTerminal } from "@/components/simulation/terminal/sim-terminal";

export const metadata: Metadata = { title: "Trading terminal · Backtesting" };

/**
 * The shared full-screen trading terminal for a simulation account. An
 * account that isn't the signed-in user's is a 404, like one that doesn't exist.
 */
export default async function SimTerminalPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const user = await requireUser();
  let state;
  try {
    state = await getSimAccountState(user.id, accountId);
  } catch (e) {
    if (e instanceof SimNotFoundError) notFound();
    throw e;
  }
  const lab = state.product === "STRATEGY_LAB";
  const studies = lab ? await listStudyOptions(user.id) : undefined;
  return (
    <SimTerminal
      initialState={state}
      backHref={lab ? "/backtesting/lab" : "/backtesting/prop"}
      studies={studies}
      resultsHref={lab ? `/backtesting/lab/results/${state.id}` : undefined}
    />
  );
}
