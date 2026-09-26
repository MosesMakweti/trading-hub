import { prisma } from "@/server/db";
import { WorkspaceScopeViolationError } from "@/server/workspace/prisma-scope";
import type { WorkspaceScope } from "@/server/workspace/scope";

function sameScope(a: WorkspaceScope, b: WorkspaceScope): boolean {
  if (a.environment !== b.environment) return false;
  if (a.environment === "BACKTEST" && b.environment === "BACKTEST") return a.backtestRunId === b.backtestRunId;
  return true;
}

/**
 * Fail-closed tripwire, called just inside every sanctioned scope entry
 * (actions, loaders, `runInBacktestRun`): the database client must see
 * exactly the scope that was entered — read through the client's own
 * extension closure, i.e. the same path its query hooks use. A mismatch means
 * the scope store has been split across module copies (the Stage 3 bug); the
 * work is refused rather than letting a BACKTEST write land as LIVE.
 */
export function assertDatabaseSeesScope(expected: WorkspaceScope): void {
  const seen = prisma.$workspaceScope();
  if (!sameScope(seen, expected)) {
    throw new WorkspaceScopeViolationError(
      `database client sees scope ${seen.environment} but ${expected.environment} was entered; refusing to run`,
    );
  }
}
