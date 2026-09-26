import { LIVE_WORKSPACE, WorkspaceProvider } from "@/components/workspace/workspace-context";

/** The Journal is the LIVE record — every workflow component rendered under a
 *  journal day (opportunities, trade workspace, trade form) acts on live data.
 *  Stated explicitly; the workspace context has no implicit default. */
export default function JournalDayLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider value={LIVE_WORKSPACE}>{children}</WorkspaceProvider>;
}
