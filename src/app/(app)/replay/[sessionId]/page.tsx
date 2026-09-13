import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getReplayReviewSession } from "@/server/services/replay-review.service";

/**
 * Stage 12.5 — resolves a Stage 12 session link to its Edge Review home
 * (`/edge?period=...&type=...&tab=replay[&strategy=...&assets=...]`), so an
 * old bookmark/link still opens the exact same review, just inside its new
 * parent module instead of a second standalone product.
 */
export default async function ReplaySessionRedirect({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const user = await requireUser();

  const session = await getReplayReviewSession(user.id, sessionId);
  if (!session) notFound();

  const search = new URLSearchParams({
    period: session.startDate,
    type: session.reviewType,
    tab: "replay",
  });
  if (session.strategyId) search.set("strategy", session.strategyId);
  if (session.assetSymbols.length > 0) search.set("assets", session.assetSymbols.join(","));

  redirect(`/edge?${search.toString()}`);
}
