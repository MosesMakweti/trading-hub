import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/guards", () => ({ requireUser: vi.fn() }));

import { requireUser } from "@/server/guards";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { createTrade } from "@/server/services/trades.service";
import type { TradeInput } from "@/lib/validation/trades";
import { GET } from "./route";

/** Backtesting V1 — export isolation and unambiguous provenance. */
const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

const input = (assetSymbol: string) =>
  ({
    strategyId: "", assetSymbol, executionMinutes: 600, direction: "LONG", higherTimeframeBias: "BULLISH", biasConfidencePercent: 70,
    selectedSession: null, expectedRR: 2, actualRR: null, performanceClosingPnlGross: 0, performanceClosingPnlNet: 0,
    psychPreTradeMindset: null, psychPostTradeReflection: null, psychLessonsLearned: null, psychWhatToWorkOn: null,
    allocations: [], propFirmExecutions: [], selectedConfluences: [], selectedExecution: [], selectedEntryModel: null,
    psychologyAnswers: {
      fomo: "no", riskManaged: "yes", followedExitPlan: "yes", alignedWithBias: "yes", influencedBySomeoneElseProfit: "no",
      influencedByOnlineOpinion: "no", outcomeWillInfluenceNext: "no", monitoringObsession: 10,
    },
  }) as unknown as TradeInput;

describe("trade export", () => {
  it("live export excludes backtests; ?runId exports only that owned run with its metadata; foreign run → 404", async () => {
    const owner = await createTestUser("export-owner");
    const other = await createTestUser("export-other");
    userIds.push(owner.id, other.id);
    const run = await createBacktestRun(owner.id, createBacktestRunSchema.parse({ name: "EURUSD V3", assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));
    await createTrade(owner.id, "2026-01-05", input("XAUUSD"));
    await runInBacktestRun(owner.id, run.id, () => createTrade(owner.id, "2024-05-14", input("EURUSD")));

    vi.mocked(requireUser).mockResolvedValue({ id: owner.id } as Awaited<ReturnType<typeof requireUser>>);
    const live = await (await GET(new Request("http://localhost/api/export/trades?format=json"))).json();
    expect(live.map((t: { assetSymbol: string }) => t.assetSymbol)).toEqual(["XAUUSD"]);

    const res = await GET(new Request(`http://localhost/api/export/trades?format=json&runId=${run.id}`));
    expect(res.headers.get("content-disposition")).toContain("backtest-eurusd-v3-trades.json");
    const bt = await res.json();
    expect(bt.environment).toBe("BACKTEST");
    expect(bt.run).toMatchObject({ id: run.id, name: "EURUSD V3", startDate: "2024-05-01", endDate: "2024-05-31" });
    expect(bt.trades.map((t: { assetSymbol: string; dateKey: string }) => [t.assetSymbol, t.dateKey])).toEqual([["EURUSD", "2024-05-14"]]);

    vi.mocked(requireUser).mockResolvedValue({ id: other.id } as Awaited<ReturnType<typeof requireUser>>);
    expect((await GET(new Request(`http://localhost/api/export/trades?format=csv&runId=${run.id}`))).status).toBe(404);
  });
});
