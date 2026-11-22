import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { mt5Text } from "@/domain/native-replay/testing/m1-fixtures";
import { createLabAccount, deleteSimAccount, startSimClock } from "./sim-account.service";
import { advanceSimClock } from "./sim-clock.service";
import { placeOrder } from "./sim-execution.service";
import { addSetup, createStudy, getBacktestResults, getStudyDetail, listStudies, recordObservation } from "./sim-study.service";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

/** EURUSD, no spread: 09:00 1.08000 → 09:01 dips to 1.07900 → 09:02 rallies to 1.08200. */
function fixture(): string {
  const rows = [
    ["2024.05.14", "09:00", "1.08000", "1.08000", "1.08000", "1.08000"],
    ["2024.05.14", "09:01", "1.08000", "1.08000", "1.07900", "1.07950"],
    ["2024.05.14", "09:02", "1.07950", "1.08200", "1.07950", "1.08150"],
    ["2024.05.14", "09:03", "1.08150", "1.08150", "1.08150", "1.08150"],
  ].map((r) => [...r, "10", "0", "0"]);
  return mt5Text(rows);
}

async function setup(label: string) {
  const u = await createTestUser(`study-${label}`);
  userIds.push(u.id);
  const ds = await importHistoricalDataset(u.id, { bytes: new TextEncoder().encode(fixture()), fileName: "EURUSD_M1_202405140900_202405140903.csv" });
  const account = await createLabAccount(u.id, { name: "Lab", datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }], periodStart: "2024-05-14", periodEnd: "2024-05-14", startingBalance: 10000, currency: "USD" });
  await startSimClock(u.id, account.id);
  const study = await createStudy(u.id, { name: "London liquidity sweep", hypothesis: "Sweeps of Asia low reverse", instruments: ["eurusd"], setups: ["With displacement", "Without displacement"] });
  return { userId: u.id, accountId: account.id, studyId: study.id };
}

describe("Strategy Lab studies", () => {
  it("records traded and not-traded observations; R comes from the position, self-reported R stays separate", async () => {
    const { userId, accountId, studyId } = await setup("obs");
    const detail0 = await getStudyDetail(userId, studyId);
    const [withDisp, withoutDisp] = detail0.setups;
    expect(detail0.study.instruments).toEqual(["EURUSD"]);

    // Buy 1 lot at 1.08000, stop 1.07900 (risk $100), target 1.08200 (+$200).
    const { positionId } = await placeOrder(userId, accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", stopLoss: "1.07900", takeProfit: "1.08200", sizing: { mode: "QUANTITY", quantity: "1" } });
    const traded = await recordObservation(userId, { studyId, setupId: withDisp.id, accountId, positionId, kind: "TRADED", timeframe: "M5", setupTags: ["asia low"], explanation: "Swept and displaced" });
    expect(traded.minute).toBeGreaterThan(0); // from the account clock, not the request
    await recordObservation(userId, { studyId, setupId: withoutDisp.id, accountId, kind: "NOT_TRADED", outcome: "LOSS", selfReportedR: -1, timeframe: "M5" });
    await expect(recordObservation(userId, { studyId, accountId, kind: "TRADED" })).rejects.toThrow(/Link the position/);

    let detail = await getStudyDetail(userId, studyId);
    expect(detail.observations.find((o) => o.kind === "TRADED")).toMatchObject({ outcome: "OPEN", r: null, position: { side: "BUY", entry: "1.08000", status: "OPEN" } });

    // 09:01 low 1.07900 = stop → stopped out (the 09:02 target comes after).
    await advanceSimClock(userId, accountId, { kind: "BARS", count: 3 });
    detail = await getStudyDetail(userId, studyId);
    expect(detail.observations.find((o) => o.kind === "TRADED")).toMatchObject({ outcome: "LOSS", r: -1, rSelfReported: false });
    expect(detail.overall).toMatchObject({ occurrences: 2, executed: 1, resolved: 1, losses: 1, netR: -1, sample: "INSUFFICIENT", selfReported: { count: 1, losses: 1, netR: -1 } });
    expect(detail.bySetup.map((g) => [g.label, g.stats.occurrences, g.stats.executed])).toEqual([
      ["With displacement", 1, 1],
      ["Without displacement", 1, 0],
    ]);
    expect(detail.byHour.map((g) => g.label)).toEqual(["09:00"]);

    const library = await listStudies(userId);
    expect(library[0]).toMatchObject({ name: "London liquidity sweep", setups: 2, observations: 2, stats: { executed: 1 } });

    const results = await getBacktestResults(userId, accountId);
    expect(results.overall).toMatchObject({ executed: 1, resolved: 1, netR: -1 });
    expect(results.equityCurve.map((p) => p.balance)).toEqual([10000, 9900]);
  });

  it("keeps observations when their account is deleted, and refuses cross-user links", async () => {
    const a = await setup("own-a");
    const b = await setup("own-b");
    const { positionId } = await placeOrder(a.userId, a.accountId, { symbol: "EURUSD", side: "BUY", type: "MARKET", sizing: { mode: "QUANTITY", quantity: "1" } });
    await expect(recordObservation(b.userId, { studyId: a.studyId, kind: "NOT_TRADED", symbol: "EURUSD", minute: 1 })).rejects.toThrow(/Study not found/);
    await expect(recordObservation(b.userId, { studyId: b.studyId, accountId: a.accountId, kind: "NOT_TRADED" })).rejects.toThrow(/not found/);
    await expect(recordObservation(b.userId, { studyId: b.studyId, accountId: b.accountId, positionId, kind: "TRADED" })).rejects.toThrow(/isn't part of this account/);
    await expect(addSetup(b.userId, a.studyId, "x")).rejects.toThrow(/Study not found/);
    // The database refuses a forged cross-user link too.
    const bStudy = await prisma.simStudy.findUniqueOrThrow({ where: { id: b.studyId } });
    await expect(prisma.simObservation.create({ data: { userId: b.userId, studyId: bStudy.id, kind: "TRADED", symbol: "EURUSD", minute: 1, accountId: a.accountId, positionId } })).rejects.toThrow(/SIM_OWNERSHIP/);

    await recordObservation(a.userId, { studyId: a.studyId, accountId: a.accountId, positionId, kind: "TRADED" });
    await deleteSimAccount(a.userId, a.accountId);
    const detail = await getStudyDetail(a.userId, a.studyId);
    expect(detail.observations).toHaveLength(1);
    expect(detail.observations[0]).toMatchObject({ accountId: null, position: null });
  });
});
