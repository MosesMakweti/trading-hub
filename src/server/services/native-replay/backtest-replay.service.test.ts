import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createBacktestRunSchema } from "@/lib/validation/backtesting";
import { createBacktestRun, deleteBacktestRun, setBacktestRunStatus, BacktestRunNotFoundError } from "@/server/services/backtest-run.service";
import { deleteHistoricalDataset, HistoricalDatasetInUseError, HistoricalDatasetNotFoundError, importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { attachDatasetToRun, DatasetPinError, detachDatasetFromRun, listRunDatasetPins } from "@/server/services/native-replay/backtest-dataset-pin.service";
import {
  advanceReplay,
  getReplayCandles,
  getReplayState,
  initializeReplay,
  ReplayError,
  ReplayNotFoundError,
  type ReplayRef,
} from "@/server/services/native-replay/backtest-replay.service";
import { formatWallClock } from "@/domain/native-replay/wall-clock";
import { mt5Text, wc } from "@/domain/native-replay/testing/m1-fixtures";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
const enc = (s: string) => new TextEncoder().encode(s);

/**
 * Fixture (broker server time):
 *   14 May 08:00–15:59, EXCEPT 09:15–09:16 and the whole 12:00 hour (gaps);
 *          09:38 carries a planted spike (high 1.99999 / low 1.00001).
 *   15 May 08:12–10:00.
 * Prices walk deterministically from 1.07843 (points).
 */
function fixtureRows(): string[][] {
  const rows: string[][] = [];
  let price = 107843;
  const push = (day: string, h: number, m: number) => {
    const o = price;
    const c = o + (((h * 60 + m) * 7) % 11) - 5;
    price = c;
    let hi = Math.max(o, c) + 2;
    let lo = Math.min(o, c) - 2;
    if (day === "2024.05.14" && h === 9 && m === 38) {
      hi = 199999;
      lo = 100001;
    }
    const f = (x: number) => (x / 1e5).toFixed(5);
    rows.push([day, `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, f(o), f(hi), f(lo), f(c), "10"]);
  };
  for (let t = 8 * 60; t < 16 * 60; t += 1) {
    const h = Math.floor(t / 60), m = t % 60;
    if ((h === 9 && (m === 15 || m === 16)) || h === 12) continue;
    push("2024.05.14", h, m);
  }
  for (let t = 8 * 60 + 12; t <= 10 * 60; t += 1) push("2024.05.15", Math.floor(t / 60), t % 60);
  return rows;
}
const FIXTURE = mt5Text(fixtureRows());

async function setup(label: string, opts: { assets?: string[] } = {}) {
  const u = await createTestUser(`replay-${label}`);
  userIds.push(u.id);
  const run = await createBacktestRun(u.id, createBacktestRunSchema.parse({ name: `Run ${label}`, assets: opts.assets ?? ["EURUSD"], startDate: "2024-05-13", endDate: "2024-05-24" }));
  const ds = await importHistoricalDataset(u.id, { bytes: enc(FIXTURE), fileName: "EURUSD_M1_202405140800_202405151000.csv" });
  return { userId: u.id, run, ds };
}
const ref = (runId: string, dateKey = "2024-05-14", assetSymbol = "EURUSD"): ReplayRef => ({ runId, dateKey, assetSymbol });
const at = async (userId: string, r: ReplayRef) => (await getReplayState(userId, r)).position?.time;

describe("dataset pinning", () => {
  it("validates compatibility, freezes on first replay position, and protects the dataset", async () => {
    const { userId, run, ds } = await setup("pin", { assets: ["EURUSD", "XAUUSD"] });
    await expect(attachDatasetToRun(userId, { runId: run.id, assetSymbol: "XAUUSD", datasetId: ds.id })).rejects.toThrow(/This dataset is EURUSD, not XAUUSD/);
    await expect(attachDatasetToRun(userId, { runId: run.id, assetSymbol: "GBPUSD", datasetId: ds.id })).rejects.toThrow(/isn't one of this run's assets/);
    const outside = await createBacktestRun(userId, createBacktestRunSchema.parse({ name: "June", assets: ["EURUSD"], startDate: "2024-06-03", endDate: "2024-06-07" }));
    await expect(attachDatasetToRun(userId, { runId: outside.id, assetSymbol: "EURUSD", datasetId: ds.id })).rejects.toThrow(/no bars inside this run's period/);

    const pin = await attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id });
    expect(pin).toMatchObject({ assetSymbol: "EURUSD", datasetId: ds.id, frozen: false, coveredDays: 2 });

    // Replaceable before replay starts.
    const ds2 = await importHistoricalDataset(userId, { bytes: enc(FIXTURE), fileName: "EURUSD.a_M1_202405140800_202405151000.csv" });
    expect((await attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds2.id })).datasetId).toBe(ds2.id);

    // First replay position freezes it.
    await initializeReplay(userId, ref(run.id));
    expect((await listRunDatasetPins(userId, run.id))[0]).toMatchObject({ datasetId: ds2.id, frozen: true });
    await expect(attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id })).rejects.toThrow(/can't be swapped/);
    await expect(detachDatasetFromRun(userId, { runId: run.id, assetSymbol: "EURUSD" })).rejects.toBeInstanceOf(DatasetPinError);
    // …and the database refuses it too, even bypassing the service.
    await expect(prisma.backtestRunDataset.updateMany({ where: { backtestRunId: run.id }, data: { datasetId: ds.id } })).rejects.toThrow(/frozen/);
    await expect(prisma.backtestRunDataset.updateMany({ where: { backtestRunId: run.id }, data: { frozenAt: null } })).rejects.toThrow(/frozen/);
    await expect(prisma.backtestRunDataset.deleteMany({ where: { backtestRunId: run.id } })).rejects.toThrow(/frozen/);

    // A pinned dataset can't be deleted — with a useful message — and the FK backs it up.
    await expect(deleteHistoricalDataset(userId, ds2.id)).rejects.toThrow(/used by 1 Backtest Run \("Run pin"\)\. Remove those references or delete the runs first\./);
    await expect(deleteHistoricalDataset(userId, ds2.id)).rejects.toBeInstanceOf(HistoricalDatasetInUseError);
    await expect(prisma.historicalDataset.delete({ where: { id: ds2.id } })).rejects.toThrow();
    expect(await prisma.historicalBar.count({ where: { datasetSeq: (await prisma.historicalDataset.findUniqueOrThrow({ where: { id: ds2.id } })).seq } })).toBe(418 + 109); // bars intact

    // Deleting the run removes pins and positions, never the dataset.
    await deleteBacktestRun(userId, run.id);
    expect(await prisma.backtestRunDataset.count({ where: { backtestRunId: run.id } })).toBe(0);
    expect(await prisma.backtestReplayPosition.count({ where: { backtestRunId: run.id } })).toBe(0);
    expect(await prisma.historicalDataset.count({ where: { id: ds2.id } })).toBe(1);
    await deleteHistoricalDataset(userId, ds2.id); // now unused
  });

  it("an unfrozen pin can be detached; a user with pinned datasets can still be deleted", async () => {
    const { userId, run, ds } = await setup("detach");
    await attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id });
    await detachDatasetFromRun(userId, { runId: run.id, assetSymbol: "EURUSD" });
    expect(await listRunDatasetPins(userId, run.id)).toEqual([]);
    await attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id });
    await initializeReplay(userId, ref(run.id));
    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.historicalDataset.count({ where: { id: ds.id } })).toBe(0);
  });
});

describe("the replay clock", () => {
  let userId: string;
  let runId: string;
  beforeAll(async () => {
    const s = await setup("clock");
    userId = s.userId;
    runId = s.run.id;
    await attachDatasetToRun(userId, { runId, assetSymbol: "EURUSD", datasetId: s.ds.id });
  });

  it("starts at the first real bar of the simulation date (not 00:00, never the whole day)", async () => {
    expect((await getReplayState(userId, ref(runId))).status).toBe("NOT_STARTED");
    const s = await initializeReplay(userId, ref(runId));
    expect(s).toMatchObject({ status: "ACTIVE", day: { firstBar: "2024-05-14T08:00", lastBar: "2024-05-14T15:59", barCount: 418 } });
    expect(s.position).toMatchObject({ time: "2024-05-14T08:00", revealedBarsToday: 1, atDayEnd: false });
    // Idempotent.
    expect((await initializeReplay(userId, ref(runId))).position?.time).toBe("2024-05-14T08:00");
    // A date without bars.
    await expect(initializeReplay(userId, ref(runId, "2024-05-16"))).rejects.toThrow(/no bars on 2024-05-16/);
    expect((await getReplayState(userId, ref(runId, "2024-05-16"))).status).toBe("NO_BARS_FOR_DATE");
  });

  it("+1 moves to the next ACTUAL bar — straight over missing minutes", async () => {
    await advanceReplay(userId, ref(runId), { kind: "SEEK", to: wc("2024-05-14T09:14") });
    const r = await advanceReplay(userId, ref(runId), { kind: "BARS", count: 1 });
    expect([formatWallClock(r.fromMinute), formatWallClock(r.toMinute)]).toEqual(["2024-05-14T09:14", "2024-05-14T09:17"]);
    expect(r.revealed.map((c) => c.time)).toEqual(["2024-05-14T09:17"]); // no 09:15 / 09:16 invented
  });

  it("+N reveals the N-th next bar in one atomic step", async () => {
    const r = await advanceReplay(userId, ref(runId), { kind: "BARS", count: 5 });
    expect(formatWallClock(r.toMinute)).toBe("2024-05-14T09:22");
    expect(r.revealed.map((c) => c.time.slice(11))).toEqual(["09:18", "09:19", "09:20", "09:21", "09:22"]);
  });

  it("+1 displayed candle finishes the current candle, then one whole candle per press", async () => {
    expect(formatWallClock((await advanceReplay(userId, ref(runId), { kind: "CANDLE", timeframe: "M30" })).toMinute)).toBe("2024-05-14T09:29");
    expect(formatWallClock((await advanceReplay(userId, ref(runId), { kind: "CANDLE", timeframe: "M30" })).toMinute)).toBe("2024-05-14T09:59");
    // H4 08:00–11:59: the candle's last actual bar.
    expect(formatWallClock((await advanceReplay(userId, ref(runId), { kind: "CANDLE", timeframe: "H4" })).toMinute)).toBe("2024-05-14T11:59");
  });

  it("across the missing 12:00 hour, +1 goes 11:59 → 13:00 (no empty bars)", async () => {
    const r = await advanceReplay(userId, ref(runId), { kind: "BARS", count: 1 });
    expect(formatWallClock(r.toMinute)).toBe("2024-05-14T13:00");
    const h1 = await getReplayCandles(userId, ref(runId), { timeframe: "H1", limit: 10 });
    expect(h1.candles.map((c) => c.time.slice(11))).toEqual(["08:00", "09:00", "10:00", "11:00", "13:00"]);
  });

  it("seek: forward only, within the day, resolved to the last bar at or before the time", async () => {
    await expect(advanceReplay(userId, ref(runId), { kind: "SEEK", to: wc("2024-05-14T10:00") })).rejects.toThrow(/only moves forward/);
    await expect(advanceReplay(userId, ref(runId), { kind: "SEEK", to: wc("2024-05-15T09:00") })).rejects.toThrow(/within the current simulation day/);
    expect(formatWallClock((await advanceReplay(userId, ref(runId), { kind: "SEEK", to: wc("2024-05-14T14:30") })).toMinute)).toBe("2024-05-14T14:30");
    // A time after the last bar clamps to it; the day never spills into 15 May.
    expect(formatWallClock((await advanceReplay(userId, ref(runId), { kind: "SEEK", to: wc("2024-05-14T23:59") })).toMinute)).toBe("2024-05-14T15:59");
    const end = await advanceReplay(userId, ref(runId), { kind: "BARS", count: 100 });
    expect(end).toMatchObject({ moved: false, toMinute: wc("2024-05-14T15:59") });
    expect(end.state.position?.atDayEnd).toBe(true);
  });

  it("the database itself refuses rewinding, non-bar positions and leaving the date", async () => {
    const where = { backtestRunId: runId, assetSymbol: "EURUSD" };
    await expect(prisma.backtestReplayPosition.updateMany({ where, data: { currentMinute: wc("2024-05-14T09:00") } })).rejects.toThrow(/only moves forward/);
    await expect(prisma.backtestReplayPosition.updateMany({ where: { ...where, simulationDate: new Date("2024-05-14T00:00:00Z") }, data: { currentMinute: wc("2024-05-15T08:30") } })).rejects.toThrow();
  });
});

describe("multi-timeframe synchronization and forming candles", () => {
  let userId: string;
  let runId: string;
  beforeAll(async () => {
    const s = await setup("sync");
    userId = s.userId;
    runId = s.run.id;
    await attachDatasetToRun(userId, { runId, assetSymbol: "EURUSD", datasetId: s.ds.id });
    await initializeReplay(userId, ref(runId));
  });

  it("M30: every M1 step updates the same forming candle; COMPLETED at 09:29; a new one at 09:30", async () => {
    await advanceReplay(userId, ref(runId), { kind: "SEEK", to: wc("2024-05-14T08:59") });
    const seen: string[] = [];
    let previousHigh = 0;
    for (let i = 0; i < 30; i += 1) {
      const step = await advanceReplay(userId, ref(runId), { kind: "BARS", count: 1 });
      const { candles } = await getReplayCandles(userId, ref(runId), { timeframe: "M30", limit: 3 });
      const last = candles[candles.length - 1];
      expect(last.time).toBe(formatWallClock(step.toMinute) < "2024-05-14T09:30" ? "2024-05-14T09:00" : "2024-05-14T09:30");
      if (last.time === "2024-05-14T09:00") {
        expect(last.high).toBeGreaterThanOrEqual(previousHigh); // only grows as bars are revealed
        previousHigh = last.high;
        expect(last.close).toBe(step.revealed[0].close); // close = the bar just revealed
      }
      seen.push(`${formatWallClock(step.toMinute).slice(11)}:${last.time.slice(11)}:${last.state}`);
    }
    // 09:15 and 09:16 don't exist: 28 steps reach 09:29, the next two are 09:30 and 09:31.
    expect(seen.slice(0, 3)).toEqual(["09:00:09:00:FORMING", "09:01:09:00:FORMING", "09:02:09:00:FORMING"]);
    expect(seen).toContain("09:29:09:00:COMPLETED");
    expect(seen.slice(-2)).toEqual(["09:30:09:30:FORMING", "09:31:09:30:FORMING"]);
    const m30 = await getReplayCandles(userId, ref(runId), { timeframe: "M30", limit: 3 });
    expect(m30.candles.map((c) => [c.time.slice(11), c.state])).toEqual([["08:30", "COMPLETED"], ["09:00", "COMPLETED"], ["09:30", "FORMING"]]);
  });

  it("H4 is visible from 08:00 and still FORMING at 09:37, built only from revealed bars", async () => {
    await advanceReplay(userId, ref(runId), { kind: "SEEK", to: wc("2024-05-14T09:37") });
    const h4 = await getReplayCandles(userId, ref(runId), { timeframe: "H4" });
    const last = h4.candles[h4.candles.length - 1];
    // 08:00–09:37 is 98 minutes; 09:15 and 09:16 are missing.
    expect(last).toMatchObject({ time: "2024-05-14T08:00", state: "FORMING", barCount: 96 });
  });

  it("at 09:37, M1 … D1 all show 09:37 knowledge — the planted 09:38 spike appears nowhere", async () => {
    const before = (await getReplayState(userId, ref(runId))).position!;
    const m1 = await getReplayCandles(userId, ref(runId), { timeframe: "M1", limit: 1 });
    const close0937 = m1.candles[0].close;
    expect(m1.candles[0].time).toBe("2024-05-14T09:37");
    for (const timeframe of ["M1", "M5", "M15", "M30", "H1", "H4", "D1"] as const) {
      const res = await getReplayCandles(userId, ref(runId), { timeframe, limit: 500 });
      expect(res.position.time, timeframe).toBe("2024-05-14T09:37");
      expect(res.candles.at(-1)!.close, timeframe).toBe(close0937);
      expect(Math.max(...res.candles.map((c) => c.high)), timeframe).toBeLessThan(1.1);
      expect(Math.min(...res.candles.map((c) => c.low)), timeframe).toBeGreaterThan(1.07);
    }
    // Switching timeframe never moves the clock.
    const after = (await getReplayState(userId, ref(runId))).position!;
    expect([after.minute, after.version]).toEqual([before.minute, before.version]);
  });

  it("lookahead attacks return nothing after the stored position", async () => {
    // Asking for a range that ends in the future is clamped to the position.
    const future = await getReplayCandles(userId, ref(runId), { timeframe: "M1", to: wc("2024-05-15T10:00"), limit: 5000 });
    expect(future.candles.at(-1)!.time).toBe("2024-05-14T09:37");
    const h4 = await getReplayCandles(userId, ref(runId), { timeframe: "H4", to: wc("2024-05-14T15:59") });
    expect(h4.candles.at(-1)!.barCount).toBe(96);
    // No API accepts a cutoff; the next day is unreachable by seek.
    await expect(advanceReplay(userId, ref(runId), { kind: "SEEK", to: wc("2024-05-15T08:30") })).rejects.toThrow(/current simulation day/);
    // Unsupported timeframes and oversized steps are refused.
    await expect(getReplayCandles(userId, ref(runId), { timeframe: "M7" as never })).rejects.toBeInstanceOf(ReplayError);
    await expect(advanceReplay(userId, ref(runId), { kind: "BARS", count: 5000 })).rejects.toBeInstanceOf(ReplayError);
    await expect(advanceReplay(userId, ref(runId), { kind: "BARS", count: 0 })).rejects.toBeInstanceOf(ReplayError);
  });
});

describe("dates, assets and runs each have their own clock", () => {
  it("14 May, 15 May and GBPUSD keep independent positions", async () => {
    const { userId, run, ds } = await setup("independent", { assets: ["EURUSD", "GBPUSD"] });
    const gbpRows = fixtureRows().map((r) => [...r]);
    const gbp = await importHistoricalDataset(userId, { bytes: enc(mt5Text(gbpRows)), fileName: "GBPUSD_M1_202405140800_202405151000.csv" });
    await attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id });
    await attachDatasetToRun(userId, { runId: run.id, assetSymbol: "GBPUSD", datasetId: gbp.id });
    for (const [dateKey, asset] of [["2024-05-14", "EURUSD"], ["2024-05-15", "EURUSD"], ["2024-05-14", "GBPUSD"]] as const) await initializeReplay(userId, ref(run.id, dateKey, asset));

    await advanceReplay(userId, ref(run.id), { kind: "SEEK", to: wc("2024-05-14T09:37") });
    expect(await at(userId, ref(run.id, "2024-05-15"))).toBe("2024-05-15T08:12"); // its own first bar
    await advanceReplay(userId, ref(run.id, "2024-05-15"), { kind: "BARS", count: 10 });
    expect(await at(userId, ref(run.id, "2024-05-14"))).toBe("2024-05-14T09:37"); // untouched
    expect(await at(userId, ref(run.id, "2024-05-14", "GBPUSD"))).toBe("2024-05-14T08:00"); // other asset untouched
    expect(await at(userId, ref(run.id, "2024-05-15"))).toBe("2024-05-15T08:22");
  });
});

describe("concurrency and retries", () => {
  it("10 simultaneous +1 end exactly at the 10th next bar — none lost, none doubled", async () => {
    const { userId, run, ds } = await setup("concurrent");
    await attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id });
    await initializeReplay(userId, ref(run.id));
    await advanceReplay(userId, ref(run.id), { kind: "SEEK", to: wc("2024-05-14T09:10") });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => advanceReplay(userId, ref(run.id), { kind: "BARS", count: 1 }, `cmd-${i}`)));
    // The ten actual bars after 09:10: 09:11–09:14 and 09:17–09:22 (09:15/09:16 don't exist).
    expect(await at(userId, ref(run.id))).toBe("2024-05-14T09:22");
    const landed = results.map((r) => formatWallClock(r.toMinute).slice(11)).sort();
    expect(landed).toEqual(["09:11", "09:12", "09:13", "09:14", "09:17", "09:18", "09:19", "09:20", "09:21", "09:22"]);
    expect((await getReplayState(userId, ref(run.id))).position?.version).toBe(11); // seek + 10 steps
  });

  it("a retried command (same id) is applied once", async () => {
    const { userId, run, ds } = await setup("retry");
    await attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id });
    await initializeReplay(userId, ref(run.id));
    const first = await advanceReplay(userId, ref(run.id), { kind: "BARS", count: 3 }, "same-id");
    const retry = await advanceReplay(userId, ref(run.id), { kind: "BARS", count: 3 }, "same-id");
    const both = await Promise.all([1, 2].map(() => advanceReplay(userId, ref(run.id), { kind: "BARS", count: 1 }, "dup-id")));
    expect(first).toMatchObject({ applied: true, toMinute: wc("2024-05-14T08:03") });
    expect(retry).toMatchObject({ applied: false, toMinute: wc("2024-05-14T08:03") });
    expect(retry.revealed.map((c) => c.time)).toEqual(first.revealed.map((c) => c.time));
    expect(both.filter((r) => r.applied)).toHaveLength(1);
    expect(await at(userId, ref(run.id))).toBe("2024-05-14T08:04");
  });
});

describe("playback determinism", () => {
  it("manual +1, +2 (2x), +5 (5x) and +20 (20x) reveal the identical M1 sequence and end identically", async () => {
    const sequences: string[][] = [];
    const finals: string[] = [];
    for (const batch of [1, 2, 5, 20]) {
      const { userId, run, ds } = await setup(`determinism-${batch}`);
      await attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id });
      await initializeReplay(userId, ref(run.id));
      await advanceReplay(userId, ref(run.id), { kind: "SEEK", to: wc("2024-05-14T14:00") });
      const revealed: string[] = [];
      let moved = true;
      while (moved) {
        const r = await advanceReplay(userId, ref(run.id), { kind: "BARS", count: batch });
        moved = r.moved;
        revealed.push(...r.revealed.map((c) => `${c.time}|${c.open}|${c.high}|${c.low}|${c.close}`));
      }
      sequences.push(revealed);
      const m30 = await getReplayCandles(userId, ref(run.id), { timeframe: "M30", limit: 50 });
      finals.push(JSON.stringify([m30.position.time, m30.candles]));
    }
    expect(sequences[0]).toHaveLength(119); // every bar 14:01–15:59, once
    for (const s of sequences.slice(1)) expect(s).toEqual(sequences[0]);
    expect(new Set(finals).size).toBe(1);
  }, 60_000);
});

describe("ownership and run status", () => {
  it("another user can't attach, read or move anything — it all looks like it doesn't exist", async () => {
    const a = await setup("owner-a");
    const b = await setup("owner-b");
    await attachDatasetToRun(a.userId, { runId: a.run.id, assetSymbol: "EURUSD", datasetId: a.ds.id });
    await initializeReplay(a.userId, ref(a.run.id));
    await expect(attachDatasetToRun(b.userId, { runId: b.run.id, assetSymbol: "EURUSD", datasetId: a.ds.id })).rejects.toBeInstanceOf(HistoricalDatasetNotFoundError);
    await expect(attachDatasetToRun(b.userId, { runId: a.run.id, assetSymbol: "EURUSD", datasetId: b.ds.id })).rejects.toBeInstanceOf(BacktestRunNotFoundError);
    await expect(getReplayState(b.userId, ref(a.run.id))).rejects.toBeInstanceOf(BacktestRunNotFoundError);
    await expect(getReplayCandles(b.userId, ref(a.run.id), { timeframe: "M1" })).rejects.toBeInstanceOf(BacktestRunNotFoundError);
    await expect(advanceReplay(b.userId, ref(a.run.id), { kind: "BARS", count: 1 })).rejects.toBeInstanceOf(BacktestRunNotFoundError);
    await expect(initializeReplay(b.userId, ref(a.run.id))).rejects.toBeInstanceOf(BacktestRunNotFoundError);
    // An asset the run doesn't have is not found either.
    await expect(getReplayState(a.userId, ref(a.run.id, "2024-05-14", "GBPUSD"))).rejects.toBeInstanceOf(ReplayNotFoundError);
    // B's run can't reach A's position, and A is untouched.
    expect((await getReplayState(b.userId, ref(b.run.id))).status).toBe("NO_DATASET");
    expect(await at(a.userId, ref(a.run.id))).toBe("2024-05-14T08:00");
    // The database refuses a cross-user pin even if app code were bypassed.
    await expect(prisma.backtestRunDataset.create({ data: { userId: b.userId, backtestRunId: b.run.id, assetSymbol: "EURUSD", datasetId: a.ds.id } })).rejects.toThrow(/same user/);
  });

  it("completed / archived runs keep pin, position and candles, but replay can't move", async () => {
    const { userId, run, ds } = await setup("readonly");
    await attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id });
    await initializeReplay(userId, ref(run.id));
    await advanceReplay(userId, ref(run.id), { kind: "BARS", count: 30 });
    for (const status of ["COMPLETED", "ARCHIVED"] as const) {
      await setBacktestRunStatus(userId, run.id, status);
      const state = await getReplayState(userId, ref(run.id));
      expect(state).toMatchObject({ readOnly: true, status: "ACTIVE", position: { time: "2024-05-14T08:30" } });
      expect((await getReplayCandles(userId, ref(run.id), { timeframe: "M5" })).candles.length).toBeGreaterThan(0);
      await expect(advanceReplay(userId, ref(run.id), { kind: "BARS", count: 1 })).rejects.toThrow(/read-only/);
      await expect(attachDatasetToRun(userId, { runId: run.id, assetSymbol: "EURUSD", datasetId: ds.id })).rejects.toThrow(/read-only/);
    }
    await setBacktestRunStatus(userId, run.id, "ACTIVE");
    expect((await advanceReplay(userId, ref(run.id), { kind: "BARS", count: 1 })).moved).toBe(true);
  });
});
