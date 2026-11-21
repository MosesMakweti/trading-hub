import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getReplayReviewSession } from "@/server/services/replay-review.service";

/**
 * Legacy Replay session links. Replay is no longer part of Edge Review (see
 * docs/WEEKLY_TRADE_AUDIT.md §7); an old bookmark opens the Weekly Trade Audit
 * for the same week and scope instead. The session's data is kept.
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

  const search = new URLSearchParams({ week: session.startDate });
  if (session.strategyId) search.set("strategy", session.strategyId);
  if (session.assetSymbols.length > 0) search.set("assets", session.assetSymbols.join(","));

  redirect(`/edge?${search.toString()}`);
}
