import { redirect } from "next/navigation";

/**
 * Stage 12.5 — Replay is no longer a standalone top-level module; it's the
 * "Replay" stage inside Edge Review. This route is kept only so old links/
 * bookmarks from Stage 12 still land somewhere sensible.
 */
export default function ReplayLandingRedirect() {
  redirect("/edge");
}
