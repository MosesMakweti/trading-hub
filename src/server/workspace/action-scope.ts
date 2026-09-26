import { revalidatePath } from "next/cache";

import { prisma } from "@/server/db";
import { workspaceDayRefSchema } from "@/lib/validation/workspace";
import {
  assertDateWithinRun,
  BacktestDateOutOfRangeError,
  BacktestRunNotFoundError,
  requireBacktestRun,
} from "@/server/services/backtest-run.service";
import { backtestScope, LIVE_SCOPE, runInWorkspaceScope, runUnscoped, type WorkspaceScope } from "@/server/workspace/scope";
import { assertDatabaseSeesScope } from "@/server/workspace/scope-tripwire";
import { WorkspaceScopeViolationError } from "@/server/workspace/prisma-scope";

/**
 * Backtesting (Stage 3) — how server actions enter the right environment.
 *
 * Two sources, matching the Stage 3 audit of the Today workflow's actions:
 *
 *  - DAY-LEVEL actions (nothing exists yet to ask — create a trade, save the
 *    plan, close the day…) take an explicit `WorkspaceDayRef` from the client
 *    (`runInDayScope`). `runId: null` = LIVE; a run id is verified to be the
 *    user's and the date to lie inside the run before the BACKTEST scope is
 *    entered.
 *  - RECORD-TIED actions (anything addressing an existing trade, opportunity,
 *    asset analysis or evidence item) derive the environment from the record
 *    itself (`runInRecordScope`) — the client never has to (and can't) choose
 *    it. The record is found by `userId` only (UNSCOPED), so a request can't
 *    reach another user's record; if it isn't found the action still runs,
 *    in LIVE scope, and produces its normal "not found".
 *
 * Writes to a run that isn't ACTIVE (completed/archived) are refused — those
 * runs are read-only history. After a successful BACKTEST write the run's
 * pages are revalidated, alongside whatever live paths the action itself
 * already revalidates.
 */

export type ScopeMode = "read" | "write";
type Failure = { success: false; error: string };

export class WorkspaceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

async function backtestScopeFor(userId: string, runId: string, mode: ScopeMode, dateKey?: string): Promise<WorkspaceScope> {
  let run;
  try {
    run = await requireBacktestRun(userId, runId);
    if (dateKey) assertDateWithinRun(run, dateKey);
  } catch (e) {
    if (e instanceof BacktestRunNotFoundError || e instanceof BacktestDateOutOfRangeError) throw new WorkspaceAccessError(e.message);
    throw e;
  }
  if (mode === "write" && run.status !== "ACTIVE") {
    throw new WorkspaceAccessError(
      `This backtest run is ${run.status === "ARCHIVED" ? "archived" : "completed"} — reopen it to make changes.`,
    );
  }
  return backtestScope(run.id);
}

async function execute<R>(scope: WorkspaceScope, mode: ScopeMode, fn: () => Promise<R>): Promise<R> {
  const result = await runInWorkspaceScope(scope, () => {
    assertDatabaseSeesScope(scope);
    return fn();
  });
  if (mode === "write" && scope.environment === "BACKTEST") {
    revalidatePath(`/backtesting/${scope.backtestRunId}`, "layout");
    revalidatePath("/backtesting");
  }
  return result;
}

/** Validates a client-supplied day reference and runs `fn(dateKey)` in its
 *  environment. Access problems come back as `{ success: false, error }`. */
export async function runInDayScope<R>(
  userId: string,
  day: unknown,
  mode: ScopeMode,
  fn: (dateKey: string) => Promise<R>,
): Promise<R | Failure> {
  const parsed = workspaceDayRefSchema.safeParse(day);
  if (!parsed.success) return { success: false, error: "Invalid workspace day." };
  const { dateKey, runId } = parsed.data;
  try {
    const scope = runId == null ? LIVE_SCOPE : await backtestScopeFor(userId, runId, mode, dateKey);
    return await execute(scope, mode, () => fn(dateKey));
  } catch (e) {
    return toFailure(e);
  }
}

const SCOPE_FAILURE = "Something went wrong — nothing was saved. Please try again.";

/** Access problems come back verbatim (they're written for the trader); a
 *  fail-closed scope refusal is logged and shown as a generic error — the
 *  write was blocked, and internals never reach the UI. */
function toFailure(e: unknown): Failure {
  if (e instanceof WorkspaceAccessError) return { success: false, error: e.message };
  if (e instanceof WorkspaceScopeViolationError) {
    console.error("[workspace-scope]", e.message);
    return { success: false, error: SCOPE_FAILURE };
  }
  throw e;
}

export type RecordRef =
  | { trade: string }
  | { opportunity: string }
  | { analysis: string }
  | { evidence: string }
  | { note: string };

/** The run id (or null = LIVE) that owns a user's record; undefined when the
 *  record doesn't exist for this user. Soft-deleted records resolve too. */
async function environmentOfRecord(userId: string, ref: RecordRef): Promise<string | null | undefined> {
  return runUnscoped("resolve record environment", async () => {
    if ("trade" in ref) {
      const rows = await prisma.$queryRaw<{ backtestRunId: string | null }[]>`
        SELECT "backtestRunId" FROM "Trade" WHERE "id" = ${ref.trade} AND "userId" = ${userId}
      `;
      return rows.length ? rows[0].backtestRunId : undefined;
    }
    if ("opportunity" in ref) {
      const rows = await prisma.$queryRaw<{ backtestRunId: string | null }[]>`
        SELECT "backtestRunId" FROM "TradeOpportunity" WHERE "id" = ${ref.opportunity} AND "userId" = ${userId}
      `;
      return rows.length ? rows[0].backtestRunId : undefined;
    }
    if ("note" in ref) {
      const rows = await prisma.$queryRaw<{ backtestRunId: string | null }[]>`
        SELECT "backtestRunId" FROM "DailyNote" WHERE "id" = ${ref.note} AND "userId" = ${userId}
      `;
      return rows.length ? rows[0].backtestRunId : undefined;
    }
    if ("analysis" in ref) {
      const rows = await prisma.$queryRaw<{ backtestRunId: string | null }[]>`
        SELECT d."backtestRunId" FROM "DailyAssetAnalysis" a JOIN "TradingDay" d ON d."id" = a."tradingDayId"
        WHERE a."id" = ${ref.analysis} AND a."userId" = ${userId}
      `;
      return rows.length ? rows[0].backtestRunId : undefined;
    }
    const rows = await prisma.$queryRaw<{ backtestRunId: string | null }[]>`
      SELECT d."backtestRunId" FROM "DirectionalEvidenceItem" e
      JOIN "DailyAssetAnalysis" a ON a."id" = e."dailyAssetAnalysisId"
      JOIN "TradingDay" d ON d."id" = a."tradingDayId"
      WHERE e."id" = ${ref.evidence} AND e."userId" = ${userId}
    `;
    return rows.length ? rows[0].backtestRunId : undefined;
  });
}

/** Resolves the environment a record lives in, as a scope to run within. */
export async function resolveRecordScope(userId: string, ref: RecordRef, mode: ScopeMode): Promise<WorkspaceScope> {
  const runId = await environmentOfRecord(userId, ref);
  return runId == null ? LIVE_SCOPE : backtestScopeFor(userId, runId, mode);
}

/** Runs `fn` in the environment of the record it addresses. */
export async function runInRecordScope<R>(
  userId: string,
  ref: RecordRef,
  mode: ScopeMode,
  fn: () => Promise<R>,
): Promise<R | Failure> {
  try {
    const scope = await resolveRecordScope(userId, ref, mode);
    return await execute(scope, mode, fn);
  } catch (e) {
    return toFailure(e);
  }
}
