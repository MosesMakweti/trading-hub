import { afterAll, describe, expect, it } from "vitest";

import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { getOrCreateTradingDay, getTradingDay } from "@/server/services/trading-day.service";
import { getOrCreateDayRoutine, setRoutineResponse } from "@/server/services/today-routine.service";
import type { RoutineSnapshot } from "@/domain/today/routine-snapshot";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

/** Regression: rapid ticks send concurrent saves; the old read-modify-write of
 *  the whole snapshot JSON lost updates. Every tick must survive, in both
 *  environments, and only in its own environment's day. */
describe("routine responses under concurrent saves", () => {
  it("keeps every concurrent tick (LIVE and BACKTEST) without crossing environments", async () => {
    const u = await createTestUser("routine-concurrent");
    userIds.push(u.id);
    const run = await createBacktestRun(u.id, createBacktestRunSchema.parse({ name: "R", assets: ["EURUSD"], startDate: "2024-05-01", endDate: "2024-05-31" }));

    const tickAll = async () => {
      const day = await getOrCreateTradingDay(u.id, "2024-05-14");
      const routine = await getOrCreateDayRoutine(u.id, day);
      const items = (routine.snapshot as RoutineSnapshot).sections.flatMap((s) => s.items);
      await Promise.all(items.map((i) => setRoutineResponse(u.id, "2024-05-14", i.id, i.type === "CHECKBOX" ? { checked: true } : { text: "ok" })));
      const after = (await getTradingDay(u.id, "2024-05-14"))!.routineSnapshot as unknown as RoutineSnapshot;
      return { items: items.length, saved: Object.keys(after.responses).length };
    };

    const live = await tickAll();
    expect(live.items).toBeGreaterThan(10);
    expect(live.saved).toBe(live.items);

    const bt = await runInBacktestRun(u.id, run.id, tickAll);
    expect(bt.saved).toBe(bt.items);
    // The backtest ticks didn't touch the live day, and vice versa.
    const liveAfter = (await getTradingDay(u.id, "2024-05-14"))!;
    const btDay = await runInBacktestRun(u.id, run.id, () => getTradingDay(u.id, "2024-05-14"));
    expect(liveAfter.id).not.toBe(btDay!.id);
  });

  it("render-time loads with a stale day never clobber ticks saved in between", async () => {
    const u = await createTestUser("routine-render-race");
    userIds.push(u.id);
    const staleDay = await getOrCreateTradingDay(u.id, "2024-05-15");
    const routine = await getOrCreateDayRoutine(u.id, staleDay);
    const items = routine.snapshot.sections.flatMap((s) => s.items);

    // Each tick's action revalidates, so the page re-renders and loads the
    // routine again — from a `day` read BEFORE the other ticks landed.
    await Promise.all(
      items.flatMap((i) => [
        setRoutineResponse(u.id, "2024-05-15", i.id, i.type === "CHECKBOX" ? { checked: true } : { text: "ok" }),
        getOrCreateDayRoutine(u.id, staleDay),
      ]),
    );
    // And once more after all ticks, still with the stale (empty-responses) day.
    await getOrCreateDayRoutine(u.id, staleDay);

    const after = (await getTradingDay(u.id, "2024-05-15"))!;
    expect(Object.keys((after.routineSnapshot as unknown as RoutineSnapshot).responses)).toHaveLength(items.length);
    // An unchanged structure is not a write at all (jsonb key order is ignored).
    const before = after.updatedAt.getTime();
    await getOrCreateDayRoutine(u.id, after);
    expect((await getTradingDay(u.id, "2024-05-15"))!.updatedAt.getTime()).toBe(before);
  });
});
