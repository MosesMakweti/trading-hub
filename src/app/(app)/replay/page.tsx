import { redirect } from "next/navigation";

/**
 * Replay is no longer part of Edge Review (now the Weekly Trade Audit — see
 * docs/WEEKLY_TRADE_AUDIT.md §7). Kept so old links still land somewhere.
 */
export default function ReplayLandingRedirect() {
  redirect("/edge");
}
