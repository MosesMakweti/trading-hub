import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Backtesting Environment (Stage 1) — the ambient workspace scope.
 *
 * Today V2's services are keyed on `(userId, dateKey)` and are reused as-is by
 * the Backtesting Session. What differs between the two is WHICH rows those
 * services see and create: LIVE rows (`backtestRunId IS NULL`) or one Backtest
 * Run's rows. That choice is carried here, in AsyncLocalStorage, and enforced
 * for every Prisma query by the workspace-scope extension
 * (server/workspace/prisma-scope.ts) — so a shared service never has to thread
 * an environment parameter through, and can never forget to filter.
 *
 * Defaults are fail-safe: code running outside any scope is LIVE, which means
 * live pages behave exactly as before and backtest rows are invisible to them.
 * The only way to see or create backtest rows is to run inside an explicit
 * BACKTEST scope, established after the run's ownership has been verified
 * (see server/services/backtest-run.service.ts's `runInBacktestRun`).
 *
 * UNSCOPED disables the filter entirely. It exists for a small, named set of
 * internal needs — resolving which environment a record belongs to before
 * entering its scope, and whole-account data management — and always carries
 * a reason for auditability. Never use it for a user-facing read.
 */
export type WorkspaceScope =
  | { readonly environment: "LIVE" }
  | { readonly environment: "BACKTEST"; readonly backtestRunId: string }
  | { readonly environment: "UNSCOPED"; readonly reason: string };

export type TradingEnvironment = "LIVE" | "BACKTEST";

export const LIVE_SCOPE: WorkspaceScope = Object.freeze({ environment: "LIVE" as const });

/**
 * ONE store per process, pinned on globalThis. This is load-bearing: Next.js
 * can evaluate this module more than once (separate server bundle layers for
 * pages vs server actions, and dev HMR re-evaluation), while the Prisma client
 * — and with it the workspace-scope extension that READS this store — is
 * itself cached on globalThis (server/db.ts). A module-local store would let
 * the extension read a different, empty store than the one an action wrote
 * its scope into, silently falling back to LIVE. Found in Stage 3 browser QA;
 * see workspace-scope-singleton.test.ts.
 */
//
// Concurrency: only the STORE (the AsyncLocalStorage container) is global.
// Each request's scope VALUE lives in that request's own async context
// (`storage.run`), so concurrent requests — different users, different runs —
// can never see each other's scope. Nothing request-specific is ever written
// to a global. Keyed by a registry symbol (Symbol.for) so every module copy in
// the process resolves the same key and no string property can collide.
const SCOPE_STORE_KEY = Symbol.for("traditorium.workspaceScope.store");
const globalForScope = globalThis as unknown as Record<symbol, AsyncLocalStorage<WorkspaceScope> | undefined>;
const storage = (globalForScope[SCOPE_STORE_KEY] ??= new AsyncLocalStorage<WorkspaceScope>());

export function currentWorkspaceScope(): WorkspaceScope {
  return storage.getStore() ?? LIVE_SCOPE;
}

/**
 * Runs `fn` inside `scope`. Always async, and always AWAITS `fn`'s result
 * inside the scope: Prisma queries are lazy (a PrismaPromise only executes
 * when `.then` is called), so `storage.run(scope, () => prisma.x.findMany())`
 * would return an unexecuted query that later runs — unscoped — wherever the
 * caller awaits it. Awaiting here pins execution to the scope.
 */
export async function runInWorkspaceScope<T>(scope: WorkspaceScope, fn: () => T | PromiseLike<T>): Promise<T> {
  if (scope.environment === "BACKTEST" && !scope.backtestRunId) {
    throw new Error("A BACKTEST workspace scope requires a backtestRunId.");
  }
  return storage.run(scope, async () => await fn());
}

export function backtestScope(backtestRunId: string): WorkspaceScope {
  return Object.freeze({ environment: "BACKTEST" as const, backtestRunId });
}

/** Explicitly LIVE — used where code may already be nested inside a backtest
 *  scope but must act on live data (rare; e.g. tests). */
export function runLive<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  return runInWorkspaceScope(LIVE_SCOPE, fn);
}

export function runUnscoped<T>(reason: string, fn: () => T | PromiseLike<T>): Promise<T> {
  return runInWorkspaceScope(Object.freeze({ environment: "UNSCOPED" as const, reason }), fn);
}

/**
 * The `backtestRunId` value a scoped query must match: `null` for LIVE, the
 * run id for BACKTEST, or `undefined` for UNSCOPED (no filter).
 */
export function scopeBacktestRunId(scope: WorkspaceScope = currentWorkspaceScope()): string | null | undefined {
  switch (scope.environment) {
    case "LIVE":
      return null;
    case "BACKTEST":
      return scope.backtestRunId;
    case "UNSCOPED":
      return undefined;
  }
}

/** Environment of a persisted row, derived from its discriminator. */
export function environmentOf(row: { backtestRunId: string | null }): TradingEnvironment {
  return row.backtestRunId == null ? "LIVE" : "BACKTEST";
}

export function isBacktestScope(scope: WorkspaceScope = currentWorkspaceScope()): boolean {
  return scope.environment === "BACKTEST";
}
