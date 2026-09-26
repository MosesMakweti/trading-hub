import { describe, expect, it, vi } from "vitest";

/**
 * Regression (Stage 3 browser QA): with a module-local AsyncLocalStorage, a
 * second evaluation of scope.ts (Next.js bundle layers / HMR) created a second
 * store, so the globally cached Prisma extension read an empty store and
 * treated BACKTEST writes as LIVE. Two independent module instances must see
 * the same scope.
 */
describe("workspace scope store is a process-wide singleton", () => {
  it("a scope entered through one module instance is visible through another", async () => {
    const first = await import("@/server/workspace/scope");
    vi.resetModules();
    const second = await import("@/server/workspace/scope");
    expect(second).not.toBe(first); // genuinely two module instances

    const seen = await first.runInWorkspaceScope(first.backtestScope("run_123"), async () => second.currentWorkspaceScope());
    expect(seen).toEqual({ environment: "BACKTEST", backtestRunId: "run_123" });
    expect(second.scopeBacktestRunId(seen)).toBe("run_123");
  });
});
