import { afterAll, describe, expect, it } from "vitest";

import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { mt5Text } from "@/domain/native-replay/testing/m1-fixtures";
import { createLabAccount } from "@/server/services/simulation/sim-account.service";
import {
  createScript,
  duplicateScript,
  getScript,
  getScriptSources,
  getWorkspace,
  instrumentPointValue,
  listScripts,
  restoreScriptVersion,
  saveScript,
  saveWorkspace,
  scriptKindOf,
  setScriptArchived,
} from "./charting.service";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

async function user(label: string) {
  const u = await createTestUser(`charting-${label}`);
  userIds.push(u.id);
  return u.id;
}

describe("chart workspace persistence", () => {
  it("returns defaults, then round-trips a saved workspace", async () => {
    const u = await user("ws");
    expect((await getWorkspace(u)).layout).toBe("1");
    await saveWorkspace(u, { layout: "2h", charts: [{ timeframe: "H1", studies: [{ uid: "a", kind: "indicator", id: "ema", inputs: { length: 50 } }] }, { timeframe: "M5" }] });
    const ws = await getWorkspace(u);
    expect(ws.layout).toBe("2h");
    expect(ws.charts.map((c) => c.timeframe)).toEqual(["H1", "M5"]);
    expect(ws.charts[0].studies[0]).toMatchObject({ id: "ema", inputs: { length: 50, source: "close" } });
  });

  it("drops script studies that reference another user's script", async () => {
    const a = await user("ws-a");
    const b = await user("ws-b");
    const theirs = await createScript(b, "Theirs", `indicator("x")\nplot(close)`);
    const mine = await createScript(a, "Mine", `indicator("x")\nplot(close)`);
    const ws = await saveWorkspace(a, {
      charts: [{ studies: [{ uid: "1", kind: "script", scriptId: theirs.id }, { uid: "2", kind: "script", scriptId: mine.id }] }],
    });
    expect(ws.charts[0].studies.map((s) => s.uid)).toEqual(["2"]);
  });
});

describe("script library", () => {
  it("detects kind from the declaration (text match only, never parsed on the server)", () => {
    expect(scriptKindOf(`//@version=6\nstrategy("s")`)).toBe("strategy");
    expect(scriptKindOf(`// strategy("no")\nindicator("i")`)).toBe("indicator");
  });

  it("versions every save, refuses stale saves, restores as a new version", async () => {
    const u = await user("scripts");
    const s = await createScript(u, "EMA", `indicator("e")\nplot(ta.ema(close, 9))`);
    expect(s).toMatchObject({ version: 1, kind: "indicator" });
    const v2 = await saveScript(u, s.id, `strategy("e")\nplot(ta.ema(close, 21))`, 1, "slower");
    expect(v2).toMatchObject({ version: 2, kind: "strategy" });
    await expect(saveScript(u, s.id, `indicator("x")`, 1)).rejects.toThrow(/saved elsewhere/);
    expect((await saveScript(u, s.id, `strategy("e")\nplot(ta.ema(close, 21))`, 2)).version).toBe(2); // unchanged → no new version
    const v3 = await restoreScriptVersion(u, s.id, 1);
    expect(v3.version).toBe(3);
    const detail = await getScript(u, s.id);
    expect(detail.source).toContain("ta.ema(close, 9)");
    expect(detail.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(detail.versions[0].note).toBe("Restored version 1");
  });

  it("isolates users, enforces size, archives and duplicates", async () => {
    const a = await user("iso-a");
    const b = await user("iso-b");
    const s = await createScript(a, "Private", `indicator("p")`);
    await expect(getScript(b, s.id)).rejects.toThrow(/not found/);
    await expect(saveScript(b, s.id, "x", 1)).rejects.toThrow(/not found/);
    expect(await getScriptSources(b, [s.id])).toEqual([]);
    await expect(createScript(a, "Big", "x".repeat(70 * 1024))).rejects.toThrow(/limited/);
    const copy = await duplicateScript(a, s.id);
    expect(copy.name).toBe("Private (copy)");
    await setScriptArchived(a, s.id, true);
    expect((await listScripts(a)).map((x) => x.id)).toEqual([copy.id]);
    await expect(saveScript(a, s.id, "y", 1)).rejects.toThrow(/archived/);
  });
});

describe("instrument point value (Strategy Tester money)", () => {
  it("reads the account's instrument spec and refuses other users / instruments", async () => {
    const u = await user("pv");
    const other = await user("pv-other");
    const rows = [["2024.05.14", "09:00", "1.08000", "1.08000", "1.08000", "1.08000", "10", "0", "0"]];
    const ds = await importHistoricalDataset(u, { bytes: new TextEncoder().encode(mt5Text(rows)), fileName: "EURUSD_M1_202405140900_202405140900.csv" });
    const acct = await createLabAccount(u, { name: "PV", datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }], periodStart: "2024-05-14", periodEnd: "2024-05-14", startingBalance: 10000, currency: "USD" });
    expect(await instrumentPointValue(u, acct.id, "EURUSD")).toEqual({ pointValue: 100000, currency: "USD", quantityUnit: "lot" });
    await expect(instrumentPointValue(u, acct.id, "GBPUSD")).rejects.toThrow(/isn't one of this account/);
    await expect(instrumentPointValue(other, acct.id, "EURUSD")).rejects.toThrow();
  });
});
