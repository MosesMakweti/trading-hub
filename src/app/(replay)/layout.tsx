import { requireUser } from "@/server/guards";

/**
 * Full-screen workspaces (Native Replay). Same authentication as the app, but
 * none of its chrome — no sidebar, top bar or backdrop — so the chart gets the
 * whole viewport.
 */
export default async function ReplayLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <div className="h-dvh overflow-hidden">{children}</div>;
}
