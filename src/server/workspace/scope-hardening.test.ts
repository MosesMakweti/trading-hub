import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Scope-store hardening (Stage 5/6 §0). Exercises the REAL application path —
 * server action → workspace scope → service → Prisma extension → persisted
 * row — including the exact topology that caused the Stage 3 bug: a Prisma
 * client created (and cached on globalThis) by ONE module copy, driven by
 * actions/services from a DIFFERENT, freshly evaluated module copy.
 *
 * `requireUser` is resolved from a test-local AsyncLocalStorage so concurrent
 * calls can act as different users — the same way concurrent Next.js
 * requests each carry their own session.
 */
const USER_STORE = Symbol.for("test.scope-hardening.currentUser");
vi.mock("@/server/guards", () => ({
  requireUser: async () => {
    const store = (globalThis as unknown as Record<symbol, AsyncLocalStorage<{ id: string }>>)[Symbol.for("test.scope-hardening.currentUser")];
    const user = store?.getStore();
    if (!user) throw new Error("no test user in context");
    return user;
  },
}));
const currentUser = new AsyncLocalStorage<{ id: string }>();
(globalThis as unknown as Record<symbol, AsyncLocalStorage<{ id: string }>>)[USER_STORE] = currentUser;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Module copy A — creates and caches the Prisma client (and its extension closures).
import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun } from "@/server/services/backtest-run.service";
import { runUnscoped } from "@/server/workspace/scope";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

async function user(label: string) {
  const u = await createTestUser(`scope-hard-${label}`);
  userIds.push(u.id);
  return u.id;
}
const run = (userId: string, name: string) =>
  createBacktestRun(userId, createBacktestRunSchema.parse({ name, assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));

function tradeValues(marker: string) {
  return {
    strategyId: "", assetSymbol: "EURUSD", executionMinutes: 600, direction: "LONG", higherTimeframeBias: "BULLISH",
    biasConfidencePercent: 70, selectedSession: null, expectedRR: 2, actualRR: null, performanceClosingPnlGross: 0,
    performanceClosingPnlNet: 0, psychPreTradeMindset: marker, psychPostTradeReflection: null, psychLessonsLearned: null,
    psychWhatToWorkOn: null, allocations: [], propFirmExecutions: [], selectedConfluences: [], selectedExecution: [],
    selectedEntryModel: null,
    psychologyAnswers: {
      fomo: "no", riskManaged: "yes", followedExitPlan: "yes", alignedWithBias: "yes", influencedBySomeoneElseProfit: "no",
      influencedByOnlineOpinion: "no", outcomeWillInfluenceNext: "no", monitoringObsession: 10,
    },
  };
}

/** Module copy B — actions (and their scope/service/db imports) freshly
 *  evaluated. db.ts in copy B reuses copy A's cached client. */
async function freshActions() {
  vi.resetModules();
  const trades = await import("@/actions/trades.actions");
  const today = await import("@/actions/today.actions");
  const dbB = await import("@/server/db");
  return { ...trades, ...today, prismaB: dbB.prisma };
}

async function rowsFor(userId: string) {
  return runUnscoped("test", async () => ({
    trades: await prisma.trade.findMany({ where: { userId }, select: { backtestRunId: true, psychPreTradeMindset: true } }),
    days: await prisma.tradingDay.findMany({ where: { userId }, select: { backtestRunId: true, maxTradesPerDay: true } }),
  }));
}

describe("real path under module duplication", () => {
  it("LIVE action → backtestRunId NULL; BACKTEST action → the run, even across module copies", async () => {
    const userId = await user("dup");
    const runA = await run(userId, "A");
    const b = await freshActions();
    expect(b.prismaB).toBe(prisma); // copy B really is driving copy A's cached client

    await currentUser.run({ id: userId }, async () => {
      expect((await b.createTrade({ dateKey: "2024-05-14", runId: runA.id }, tradeValues("bt"))).success).toBe(true);
      expect((await b.createTrade({ dateKey: "2024-05-14", runId: null }, tradeValues("live"))).success).toBe(true);
      expect(await b.updateTodaysPlan({ dateKey: "2024-05-15", runId: runA.id }, { maxTradesPerDay: 4 })).toEqual({ success: true });
      expect(await b.updateTodaysPlan({ dateKey: "2024-05-15", runId: null }, { maxTradesPerDay: 9 })).toEqual({ success: true });
    });

    const { trades, days } = await rowsFor(userId);
    expect(trades.find((t) => t.psychPreTradeMindset === "bt")?.backtestRunId).toBe(runA.id);
    expect(trades.find((t) => t.psychPreTradeMindset === "live")?.backtestRunId).toBeNull();
    expect(days.find((d) => d.maxTradesPerDay === 4)?.backtestRunId).toBe(runA.id);
    expect(days.find((d) => d.maxTradesPerDay === 9)?.backtestRunId).toBeNull();
  });

  it("fails closed: if the database client ever saw a different scope, a BACKTEST action refuses instead of writing LIVE", async () => {
    const userId = await user("tripwire");
    const runA = await run(userId, "A");
    const { createTrade } = await import("@/actions/trades.actions");
    const { prisma: client } = await import("@/server/db");
    const spy = vi.spyOn(client, "$workspaceScope").mockReturnValue({ environment: "LIVE" });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await currentUser.run({ id: userId }, () => createTrade({ dateKey: "2024-05-14", runId: runA.id }, tradeValues("x")));
    // Refused, logged server-side with the isolation detail, shown to the trader as a normal error.
    expect(result).toEqual({ success: false, error: "Something went wrong — nothing was saved. Please try again." });
    expect(errorSpy.mock.calls.some((c) => String(c[1] ?? c[0]).includes("BACKTEST_ISOLATION"))).toBe(true);
    errorSpy.mockRestore();
    spy.mockRestore();
    expect((await rowsFor(userId)).trades).toHaveLength(0);
  });

  it("Run A can never become Run B (database trigger)", async () => {
    const userId = await user("a-to-b");
    const [runA, runB] = [await run(userId, "A"), await run(userId, "B")];
    const { createTrade } = await import("@/actions/trades.actions");
    const created = await currentUser.run({ id: userId }, () => createTrade({ dateKey: "2024-05-14", runId: runA.id }, tradeValues("a")));
    const tradeId = (created as { tradeId: string }).tradeId;
    await expect(
      runUnscoped("test", () => prisma.trade.update({ where: { id: tradeId }, data: { backtestRunId: runB.id } })),
    ).rejects.toThrow(/BACKTEST_ISOLATION/);
  });
});

describe("concurrency — request-local scope, process-wide store", () => {
  it("interleaved requests (two users, LIVE + three runs) each land in exactly their own environment", async () => {
    const userA = await user("conc-a");
    const userB = await user("conc-b");
    const [runA, runB, runC] = [await run(userA, "A"), await run(userA, "B"), await run(userB, "C")];
    const { createTrade } = await freshActions(); // also across a module copy

    const lanes = [
      { user: userA, runId: null, marker: "A-live" },
      { user: userA, runId: runA.id, marker: "A-runA" },
      { user: userA, runId: runB.id, marker: "A-runB" },
      { user: userB, runId: runC.id, marker: "B-runC" },
    ];
    const ROUNDS = 8;
    const results = await Promise.all(
      Array.from({ length: ROUNDS }).flatMap((_, round) =>
        lanes.map((lane) =>
          currentUser.run({ id: lane.user }, () =>
            createTrade({ dateKey: `2024-05-${String(1 + round).padStart(2, "0")}`, runId: lane.runId }, tradeValues(lane.marker)),
          ),
        ),
      ),
    );
    expect(results.every((r) => r.success)).toBe(true);

    const all = [...(await rowsFor(userA)).trades, ...(await rowsFor(userB)).trades];
    for (const lane of lanes) {
      const rows = all.filter((t) => t.psychPreTradeMindset === lane.marker);
      expect(rows).toHaveLength(ROUNDS);
      expect(new Set(rows.map((r) => r.backtestRunId))).toEqual(new Set([lane.runId]));
    }
    // Per-environment trade numbering stayed consistent under concurrency.
    const numbers = await runUnscoped("test", () =>
      prisma.trade.findMany({ where: { userId: userA, backtestRunId: runA.id }, select: { tradeNumber: true } }),
    );
    expect(new Set(numbers.map((n) => n.tradeNumber)).size).toBe(ROUNDS);
  });

  it("four action types across User A (LIVE, Run A, Run B) and User B (LIVE, Run C), interleaved, all land correctly", async () => {
    const userA = await user("conc2-a");
    const userB = await user("conc2-b");
    const [runA, runB, runC] = [await run(userA, "A"), await run(userA, "B"), await run(userB, "C")];
    const strategies = {
      [userA]: (await import("@/server/services/strategies.service")).createStrategy(userA, { name: "SA", description: undefined }),
      [userB]: (await import("@/server/services/strategies.service")).createStrategy(userB, { name: "SB", description: undefined }),
    };
    const strategyIds = { [userA]: (await strategies[userA]).id, [userB]: (await strategies[userB]).id };
    const acts = await freshActions();
    const { createOpportunity } = await import("@/actions/opportunity.actions");
    const { setReviewLifecycleStatusAction } = await import("@/actions/trade-review.actions");

    const lanes = [
      { user: userA, runId: null, tag: "A-live", day: 5 },
      { user: userA, runId: runA.id, tag: "A-runA", day: 6 },
      { user: userA, runId: runB.id, tag: "A-runB", day: 7 },
      { user: userB, runId: null, tag: "B-live", day: 8 },
      { user: userB, runId: runC.id, tag: "B-runC", day: 9 },
    ];
    const ROUNDS = 4;
    await Promise.all(
      lanes.flatMap((lane) =>
        Array.from({ length: ROUNDS }, (_, r) =>
          currentUser.run({ id: lane.user }, async () => {
            const day = { dateKey: `2024-05-${String(lane.day + r * 7).padStart(2, "0")}`, runId: lane.runId };
            expect(await acts.updateTodaysPlan(day, { maxTradesPerDay: lane.day })).toEqual({ success: true });
            const t = await acts.createTrade(day, tradeValues(lane.tag));
            expect(t.success).toBe(true);
            const opp = await createOpportunity(day, {
              strategyId: strategyIds[lane.user], assetSymbol: "EURUSD", direction: "LONG", timeframe: lane.tag,
              selectedConfluences: [], selectedExecution: [], plannedEntry: null, plannedStopLoss: null, plannedTarget: null, plannedRR: null,
            });
            expect(opp.success).toBe(true);
            const review = await setReviewLifecycleStatusAction(day.dateKey, (t as { tradeId: string }).tradeId, { status: "CANCELLED_NEVER_TRIGGERED" });
            expect(review).toMatchObject({ success: true });
          }),
        ),
      ),
    );

    for (const lane of lanes) {
      const rows = await runUnscoped("test", async () => ({
        days: await prisma.tradingDay.findMany({ where: { userId: lane.user, maxTradesPerDay: lane.day }, select: { backtestRunId: true } }),
        trades: await prisma.trade.findMany({ where: { userId: lane.user, psychPreTradeMindset: lane.tag }, select: { backtestRunId: true, reviewLifecycleStatus: true } }),
        opps: await prisma.tradeOpportunity.findMany({ where: { userId: lane.user, timeframe: lane.tag }, select: { backtestRunId: true } }),
      }));
      expect(rows.days).toHaveLength(ROUNDS);
      expect(rows.trades).toHaveLength(ROUNDS);
      expect(rows.opps).toHaveLength(ROUNDS);
      for (const r of [...rows.days, ...rows.trades, ...rows.opps]) expect(r.backtestRunId).toBe(lane.runId);
      expect(rows.trades.every((t) => t.reviewLifecycleStatus === "CANCELLED_NEVER_TRIGGERED")).toBe(true);
    }
  });
});
