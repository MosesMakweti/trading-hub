"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { WorkspaceDayRef } from "@/lib/validation/workspace";

/**
 * Backtesting (Stage 3) — which environment the shared Today workflow
 * components are rendering in. Provided explicitly by every page that renders
 * them (Today and the Journal pages: LIVE; the Backtesting Session: BACKTEST).
 * There is NO default: a workflow component rendered without a provider throws
 * rather than silently assuming LIVE.
 */
export type WorkspaceEnvironment =
  | { environment: "LIVE"; runId: null }
  | { environment: "BACKTEST"; runId: string };

const WorkspaceContext = createContext<WorkspaceEnvironment | null>(null);

export const LIVE_WORKSPACE: WorkspaceEnvironment = { environment: "LIVE", runId: null };

export function WorkspaceProvider({ value, children }: { value: WorkspaceEnvironment; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceEnvironment & { isBacktest: boolean } {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("Workflow component rendered without a <WorkspaceProvider> — its environment (LIVE/BACKTEST) is unknown.");
  }
  return { ...value, isBacktest: value.environment === "BACKTEST" };
}

/** The day reference a day-level action needs, for `dateKey` in this workspace. */
export function useDayRef(dateKey: string): WorkspaceDayRef {
  const { runId } = useWorkspace();
  return useMemo(() => ({ dateKey, runId }), [dateKey, runId]);
}

/**
 * Where Journal surfaces link to, per environment. LIVE: the live Journal.
 * BACKTEST: the run's own Journal, with the Session as the only place to
 * change a simulated day (the Backtesting Journal is review-only).
 */
export function useJournalLinks() {
  const { runId } = useWorkspace();
  return useMemo(() => {
    const base = runId ? `/backtesting/${runId}/journal` : "/journal";
    return {
      calendarHref: base,
      dayHref: (dateKey: string) => `${base}/${dateKey}`,
      tradeHref: (dateKey: string, tradeId: string) => `${base}/${dateKey}/trades/${tradeId}`,
      sessionHref: runId ? (dateKey: string) => `/backtesting/${runId}/session?date=${dateKey}` : null,
    };
  }, [runId]);
}
