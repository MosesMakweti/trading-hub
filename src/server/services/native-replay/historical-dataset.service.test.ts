import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import {
  deleteHistoricalDataset,
  getHistoricalDataset,
  HistoricalDatasetNotFoundError,
  HistoricalImportRejectedError,
  importHistoricalDataset,
  listHistoricalDatasets,
  previewHistoricalImport,
} from "@/server/services/native-replay/historical-dataset.service";
import { getHistoricalCandles } from "@/server/services/native-replay/historical-candles.service";
import { aggregateCandles } from "@/domain/native-replay/candle-engine";
import { analyzeMt5M1Import } from "@/domain/native-replay/import-analysis";
import { REPLAY_TIMEFRAMES } from "@/domain/native-replay/timeframes";
import { mt5Text, syntheticMt5Export, wc } from "@/domain/native-replay/testing/m1-fixtures";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

async function user(label: string) {
  const u = await createTestUser(`nr-${label}`);
  userIds.push(u.id);
  return u.id;
}

const enc = (s: string) => new TextEncoder().encode(s);
const WEEK = syntheticMt5Export({ startDay: "2024-05-13", days: 5 }); // Mon–Fri, 7,200 bars
const WEEK_FILE = "EURUSD_M1_202405130000_202405172359.csv";

describe("historical dataset import", () => {
  it("preview persists nothing; import stores every bar and becomes READY", async () => {
    const userId = await user("import");
    const preview = await previewHistoricalImport(userId, { bytes: enc(WEEK.text), fileName: WEEK_FILE });
    expect(preview.state).toBe("VALID");
    expect(await prisma.historicalDataset.count({ where: { userId } })).toBe(0);

    const ds = await importHistoricalDataset(userId, { bytes: enc(WEEK.text), fileName: WEEK_FILE });
    expect(ds).toMatchObject({
      status: "READY",
      symbol: "EURUSD",
      sourceSymbol: "EURUSD",
      baseTimeframe: "M1",
      timeBasis: "BROKER_SERVER",
      utcOffsetMinutes: null,
      priceScale: 5,
      barCount: 7200,
      firstBar: "2024-05-13T00:00",
      lastBar: "2024-05-17T23:59",
      hasTickVolume: true,
      hasRealVolume: false,
      hasSpread: true,
    });
    const seq = (await prisma.historicalDataset.findUniqueOrThrow({ where: { id: ds.id } })).seq;
    expect(await prisma.historicalBar.count({ where: { datasetSeq: seq } })).toBe(7200);
    // Sample value survives byte-for-byte: the first bar's open is the fixture's 1.07843.
    const firstBar = await prisma.historicalBar.findFirstOrThrow({ where: { datasetSeq: seq }, orderBy: { minute: "asc" } });
    expect(firstBar).toMatchObject({ minute: wc("2024-05-13T00:00"), open: 107843 });

    // Re-importing the same file is allowed but flagged.
    const again = await previewHistoricalImport(userId, { bytes: enc(WEEK.text), fileName: WEEK_FILE });
    expect(again.warnings.join(" ")).toMatch(/already imported this exact file/);
  });

  it("an INVALID file is refused with its report and writes nothing", async () => {
    const userId = await user("invalid");
    const bad = mt5Text([["2024.05.14", "09:00", "1.1", "1.0", "1.2", "1.1"]]);
    const err = await importHistoricalDataset(userId, { bytes: enc(bad), fileName: WEEK_FILE }).catch((e) => e);
    expect(err).toBeInstanceOf(HistoricalImportRejectedError);
    expect((err as HistoricalImportRejectedError).report.counts.invalidOhlc).toBe(1);
    await expect(importHistoricalDataset(userId, { bytes: new Uint8Array(), fileName: WEEK_FILE })).rejects.toThrow(/empty/);
    expect(await prisma.historicalDataset.count({ where: { userId } })).toBe(0);
  });

  it("a failure while writing bars leaves no usable dataset (FAILED, bars removed)", async () => {
    const userId = await user("atomic");
    const big = syntheticMt5Export({ startDay: "2024-05-13", days: 40 }); // > one insert batch
    const original = prisma.$executeRaw.bind(prisma);
    let calls = 0;
    const spy = vi.spyOn(prisma, "$executeRaw").mockImplementation(((...args: Parameters<typeof prisma.$executeRaw>) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error("connection lost"));
      return original(...args);
    }) as typeof prisma.$executeRaw);
    try {
      await expect(importHistoricalDataset(userId, { bytes: enc(big.text), fileName: WEEK_FILE })).rejects.toThrow(/connection lost/);
    } finally {
      spy.mockRestore();
    }
    const [ds] = await listHistoricalDatasets(userId);
    expect(ds).toMatchObject({ status: "FAILED", barCount: 0, failureReason: "connection lost" });
    const seq = (await prisma.historicalDataset.findUniqueOrThrow({ where: { id: ds.id } })).seq;
    expect(await prisma.historicalBar.count({ where: { datasetSeq: seq } })).toBe(0);
    await expect(getHistoricalCandles(userId, { datasetId: ds.id, timeframe: "M1" })).rejects.toBeInstanceOf(HistoricalDatasetNotFoundError);
  });

  it("an import abandoned mid-way (crash) is swept to FAILED and never served", async () => {
    const userId = await user("stale");
    const d = await prisma.historicalDataset.create({
      data: { userId, source: "MT5", sourceSymbol: "EURUSD", symbol: "EURUSD", priceScale: 5, sourceFormat: {}, validationReport: {}, status: "IMPORTING", createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await prisma.historicalBar.create({ data: { datasetSeq: d.seq, minute: 100, open: 1, high: 1, low: 1, close: 1 } });
    await expect(getHistoricalCandles(userId, { datasetId: d.id, timeframe: "M1" })).rejects.toBeInstanceOf(HistoricalDatasetNotFoundError);
    const [listed] = await listHistoricalDatasets(userId);
    expect(listed.status).toBe("FAILED");
    expect(await prisma.historicalBar.count({ where: { datasetSeq: d.seq } })).toBe(0);
  });

  it("delete removes the dataset and all of its bars", async () => {
    const userId = await user("delete");
    const ds = await importHistoricalDataset(userId, { bytes: enc(WEEK.text), fileName: WEEK_FILE });
    const seq = (await prisma.historicalDataset.findUniqueOrThrow({ where: { id: ds.id } })).seq;
    await deleteHistoricalDataset(userId, ds.id);
    expect(await prisma.historicalDataset.count({ where: { id: ds.id } })).toBe(0);
    expect(await prisma.historicalBar.count({ where: { datasetSeq: seq } })).toBe(0);
  });
});

describe("database integrity backstops", () => {
  it("one bar per dataset minute; invalid OHLC and READY-without-bars are impossible", async () => {
    const userId = await user("integrity");
    const d = await prisma.historicalDataset.create({ data: { userId, source: "MT5", sourceSymbol: "X", symbol: "X", priceScale: 5, sourceFormat: {}, validationReport: {} } });
    await prisma.historicalBar.create({ data: { datasetSeq: d.seq, minute: 10, open: 5, high: 6, low: 4, close: 5 } });
    await expect(prisma.historicalBar.create({ data: { datasetSeq: d.seq, minute: 10, open: 5, high: 6, low: 4, close: 5 } })).rejects.toThrow();
    await expect(prisma.historicalBar.create({ data: { datasetSeq: d.seq, minute: 11, open: 5, high: 4, low: 3, close: 5 } })).rejects.toThrow(/HistoricalBar_ohlc_valid/);
    await expect(prisma.historicalBar.create({ data: { datasetSeq: d.seq, minute: 12, open: 0, high: 1, low: 0, close: 1 } })).rejects.toThrow(/HistoricalBar_ohlc_valid/);
    await expect(prisma.historicalDataset.update({ where: { id: d.id }, data: { status: "READY" } })).rejects.toThrow(/HistoricalDataset_ready_is_complete/);
    await expect(prisma.historicalDataset.update({ where: { id: d.id }, data: { priceScale: 9 } })).rejects.toThrow(/HistoricalDataset_price_scale_range/);
  });

  it("bars need an existing IMPORTING dataset, never change, and go with their dataset or user", async () => {
    const userId = await user("bar-guards");
    await expect(prisma.historicalBar.create({ data: { datasetSeq: 2_000_000_000, minute: 1, open: 1, high: 1, low: 1, close: 1 } })).rejects.toThrow(/NATIVE_REPLAY_INTEGRITY/);
    const ds = await importHistoricalDataset(userId, { bytes: enc(WEEK.text), fileName: WEEK_FILE });
    const seq = (await prisma.historicalDataset.findUniqueOrThrow({ where: { id: ds.id } })).seq;
    // READY data is immutable: no new bars, no edits.
    await expect(prisma.historicalBar.create({ data: { datasetSeq: seq, minute: 1, open: 1, high: 1, low: 1, close: 1 } })).rejects.toThrow(/importing/);
    await expect(prisma.historicalBar.updateMany({ where: { datasetSeq: seq }, data: { close: 1 } })).rejects.toThrow(/immutable/);
    await expect(prisma.historicalDataset.update({ where: { id: ds.id }, data: { seq: seq + 100_000 } })).rejects.toThrow(/immutable/);
    // Deleting the user removes datasets and (via the dataset trigger) their bars.
    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.historicalBar.count({ where: { datasetSeq: seq } })).toBe(0);
  });
});

describe("ownership — another user's dataset does not exist for them", () => {
  it("metadata, bars/candles and deletion are all refused, with no leakage", async () => {
    const a = await user("owner-a");
    const b = await user("owner-b");
    const ds = await importHistoricalDataset(a, { bytes: enc(WEEK.text), fileName: WEEK_FILE });

    expect((await getHistoricalDataset(a, ds.id)).id).toBe(ds.id);
    await expect(getHistoricalDataset(b, ds.id)).rejects.toBeInstanceOf(HistoricalDatasetNotFoundError);
    await expect(getHistoricalCandles(b, { datasetId: ds.id, timeframe: "H1" })).rejects.toBeInstanceOf(HistoricalDatasetNotFoundError);
    await expect(deleteHistoricalDataset(b, ds.id)).rejects.toBeInstanceOf(HistoricalDatasetNotFoundError);
    expect(await listHistoricalDatasets(b)).toEqual([]);
    // Same error for a dataset that doesn't exist at all.
    const missing = await getHistoricalDataset(b, "does-not-exist").catch((e: Error) => e.message);
    const foreign = await getHistoricalDataset(b, ds.id).catch((e: Error) => e.message);
    expect(foreign).toBe(missing);
    // Still intact for its owner.
    expect((await getHistoricalCandles(a, { datasetId: ds.id, timeframe: "D1" })).candles).toHaveLength(5);
  });
});

describe("candle access", () => {
  it("matches the pure engine exactly, for every timeframe", async () => {
    const userId = await user("candles");
    const ds = await importHistoricalDataset(userId, { bytes: enc(WEEK.text), fileName: WEEK_FILE });
    const bars = analyzeMt5M1Import({ text: WEEK.text, fileName: WEEK_FILE }).bars!;
    const cutoff = wc("2024-05-16T14:37");
    for (const timeframe of REPLAY_TIMEFRAMES) {
      const res = await getHistoricalCandles(userId, { datasetId: ds.id, timeframe, cutoff, limit: 5000 });
      const expected = aggregateCandles(bars, { timeframe, cutoff });
      expect(res.candles.map((c) => [c.minute, Math.round(c.open * 1e5), Math.round(c.high * 1e5), Math.round(c.low * 1e5), Math.round(c.close * 1e5), c.tickVolume, c.spread, c.state]), timeframe).toEqual(
        expected.slice(-5000).map((c) => [c.time, c.open, c.high, c.low, c.close, c.tickVolume, c.spread, c.state]),
      );
      expect(res.cutoff).toBe("2024-05-16T14:37");
    }
  });

  it("a cutoff hides every later bar; the last candle is FORMING at a mid-bucket cutoff", async () => {
    const userId = await user("cutoff");
    const rows: string[][] = [];
    for (let m = 0; m < 30; m += 1) rows.push(["2024.05.14", `09:${String(m).padStart(2, "0")}`, "1.10000", "1.10010", "1.09990", "1.10005", "10"]);
    rows[18] = ["2024.05.14", "09:18", "1.10000", "1.99999", "1.00001", "1.50000", "999999"]; // the future spike
    const ds = await importHistoricalDataset(userId, { bytes: enc(mt5Text(rows)), fileName: "EURUSD_M1_202405140900_202405140929.csv" });

    for (const timeframe of ["M1", "M5", "M15", "M30", "H1", "H4"] as const) {
      const res = await getHistoricalCandles(userId, { datasetId: ds.id, timeframe, cutoff: wc("2024-05-14T09:17") });
      const last = res.candles[res.candles.length - 1];
      expect(Math.max(...res.candles.map((c) => c.high)), timeframe).toBe(1.1001);
      expect(Math.min(...res.candles.map((c) => c.low)), timeframe).toBe(1.0999);
      expect(last.close, timeframe).toBe(1.10005);
      expect(res.candles.reduce((s, c) => s + (c.tickVolume ?? 0), 0), timeframe).toBe(180);
      expect(last.state, timeframe).toBe(timeframe === "M1" ? "COMPLETED" : "FORMING");
    }
    const m30 = await getHistoricalCandles(userId, { datasetId: ds.id, timeframe: "M30" });
    expect(m30.candles).toEqual([expect.objectContaining({ time: "2024-05-14T09:00", high: 1.99999, low: 1.00001, close: 1.10005, barCount: 30, state: "COMPLETED" })]);
  });

  it("limit returns the most recent N candles, spans weekend gaps, and reports older data", async () => {
    const userId = await user("limit");
    const twoWeeks = syntheticMt5Export({ startDay: "2024-05-13", days: 12 });
    const ds = await importHistoricalDataset(userId, { bytes: enc(twoWeeks.text), fileName: WEEK_FILE });
    const h1 = await getHistoricalCandles(userId, { datasetId: ds.id, timeframe: "H1", limit: 150 });
    expect(h1.candles).toHaveLength(150); // 150 hours back crosses the weekend
    expect(h1.candles[149].time).toBe("2024-05-24T23:00");
    expect(h1.hasMoreBefore).toBe(true);
    const all = await getHistoricalCandles(userId, { datasetId: ds.id, timeframe: "D1", limit: 500 });
    expect(all.candles.map((c) => c.time.slice(0, 10))).toEqual(["2024-05-13", "2024-05-14", "2024-05-15", "2024-05-16", "2024-05-17", "2024-05-20", "2024-05-21", "2024-05-22", "2024-05-23", "2024-05-24"]);
    expect(all.hasMoreBefore).toBe(false);
    const ranged = await getHistoricalCandles(userId, { datasetId: ds.id, timeframe: "M15", from: wc("2024-05-15T09:00"), to: wc("2024-05-15T09:59") });
    expect(ranged.candles.map((c) => c.time)).toEqual(["2024-05-15T09:00", "2024-05-15T09:15", "2024-05-15T09:30", "2024-05-15T09:45"]);
    const beforeData = await getHistoricalCandles(userId, { datasetId: ds.id, timeframe: "M1", cutoff: wc("2024-01-01T00:00") });
    expect(beforeData.candles).toEqual([]);
  });
});
