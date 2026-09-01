import { Decimal } from "decimal.js";
import type { LedgerEventType, Prisma } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { postLedgerEntry, removeLedgerEntriesForSource } from "@/server/services/account-ledger.service";
import { postPayoutPaidLedgerEntry, resolveCurrentProfitSplitPercent } from "@/server/services/prop-firms.service";
import { detectPlatform, getAdapter } from "@/domain/prop-firms/import/adapter-registry";
import { buildBestGuessMapping } from "@/domain/prop-firms/import/adapters/generic-csv";
import { classifyTransaction, type TransactionClassification } from "@/domain/prop-firms/import/classify-transaction";
import { computePayoutSplit } from "@/domain/prop-firms/payout-math";
import {
  computeExecutionFingerprint,
  computeTransactionFingerprint,
  dedupeKeyForExecution,
  dedupeKeyForTransaction,
} from "@/domain/prop-firms/import/normalize";
import { reconstructTrades, splitReversalFills, type ExecutionForReconstruction } from "@/domain/prop-firms/import/reconstruct-trades";
import { readSource } from "@/domain/prop-firms/import/source/read-source";
import { rankTables, pickBestTableId, scoreTable } from "@/domain/prop-firms/import/source/pick-table";
import type { ImportFileFormat, SourceDocument, SourceTable } from "@/domain/prop-firms/import/source/types";
import type {
  AdapterDetectResult,
  ColumnMapping,
  ImportPlatform,
  NormalizedExecutionRow,
  NormalizedTransactionRow,
} from "@/domain/prop-firms/import/types";
import { MAX_IMPORT_FILE_SIZE_BYTES, MAX_IMPORT_ROWS, MAX_IMPORT_SHEETS } from "@/lib/validation/prop-firm-import";

export interface ImportRunInput {
  accountId: string;
  platform: ImportPlatform;
  fileName: string;
  /** The raw upload, base64-encoded (binary-safe for XLSX/XLS). */
  fileContentBase64: string;
  /** Browser-reported MIME type — a hint only; content signature decides. */
  mimeType?: string | null;
  /** Which sheet / statement section / HTML table to import. When omitted the
   *  best-scoring table is used. */
  tableId?: string;
  timezone: string;
  mapping?: ColumnMapping;
  /** dedupeKey -> user-picked classification, for rows the preview flagged `requiresReview`. */
  classificationOverrides?: Record<string, TransactionClassification>;
  /** Profit-split % (0–100) the user confirmed in the wizard when the account
   *  has no PROFIT_SPLIT rule configured. Snapshotted onto each payout it
   *  creates. When neither this nor an account rule is available, confirm
   *  refuses to import payouts. */
  profitSplitPercentOverride?: number | null;
}

interface DedupedExecution extends NormalizedExecutionRow {
  dedupeKey: string;
}
interface DedupedTransaction extends NormalizedTransactionRow {
  dedupeKey: string;
  classification: TransactionClassification;
  confidence: number;
  requiresReview: boolean;
}

/** Base64 -> bytes, with the raw-size guard (mirrors the validation module's
 *  encoded-length cap, but checked against the *decoded* length). */
function decodeUpload(fileContentBase64: string): Uint8Array {
  const buf = Buffer.from(fileContentBase64, "base64");
  if (buf.byteLength === 0) throw new Error("File is malformed or could not be read.");
  if (buf.byteLength > MAX_IMPORT_FILE_SIZE_BYTES) throw new Error("File exceeds the upload limit.");
  return new Uint8Array(buf);
}

async function readDocument(input: {
  fileContentBase64: string;
  fileName: string;
  mimeType?: string | null;
}): Promise<{ doc: SourceDocument; sizeBytes: number }> {
  const bytes = decodeUpload(input.fileContentBase64);
  const doc = await readSource(bytes, {
    fileName: input.fileName,
    mimeType: input.mimeType ?? null,
    maxTables: MAX_IMPORT_SHEETS,
  });
  return { doc, sizeBytes: bytes.byteLength };
}

function selectTable(doc: SourceDocument, tableId?: string): SourceTable {
  if (tableId) {
    const found = doc.tables.find((t) => t.id === tableId);
    if (found) return found;
  }
  const bestId = pickBestTableId(doc.tables);
  return doc.tables.find((t) => t.id === bestId) ?? doc.tables[0];
}

function assertRowCount(table: SourceTable): void {
  if (table.rows.length > MAX_IMPORT_ROWS) {
    throw new Error(
      `File has too many rows (${table.rows.length.toLocaleString()}, limit ${MAX_IMPORT_ROWS.toLocaleString()}).`,
    );
  }
}

/** The "detected column mapping" surfaced in the preview — the caller-supplied
 *  mapping for the Generic path, else a best-guess derived from the table's
 *  headers so the user can see how columns were understood. */
function columnMappingFor(platform: ImportPlatform, headers: string[], mapping?: ColumnMapping): Record<string, string> {
  const source = platform === "GENERIC_CSV" ? (mapping ?? {}) : buildBestGuessMapping(headers);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v) out[k] = v;
  return out;
}

export async function detectImportPlatform(
  fileContentBase64: string,
  fileName: string,
  mimeType?: string | null,
): Promise<AdapterDetectResult[]> {
  const { doc } = await readDocument({ fileContentBase64, fileName, mimeType });
  const table = selectTable(doc);
  return detectPlatform(table.headers, table.rows.slice(0, 20), fileName);
}

export interface InspectedTable {
  id: string;
  name: string;
  rowCount: number;
  looksLikeTrades: boolean;
  headers: string[];
  bestGuessMapping: ColumnMapping;
  detected: AdapterDetectResult[];
}

export interface ImportFileInspection {
  fileFormat: ImportFileFormat;
  /** Detection for the auto-selected table (kept top-level for the wizard's
   *  existing Platform step). */
  detected: AdapterDetectResult[];
  headers: string[];
  bestGuessMapping: ColumnMapping;
  rowCount: number;
  /** Every sheet / HTML table / statement section found, best-first. */
  tables: InspectedTable[];
  selectedTableId: string;
  warnings: string[];
}

/** One read-only pass over an uploaded file powering the wizard's Table +
 *  Platform + Mapping steps: the file format, every table found (with its own
 *  header list, platform detection, and column-mapping guess), and which table
 *  was auto-selected. Writes nothing. */
export async function inspectImportFile(
  fileContentBase64: string,
  fileName: string,
  mimeType?: string | null,
): Promise<ImportFileInspection> {
  const { doc } = await readDocument({ fileContentBase64, fileName, mimeType });

  const ranked = rankTables(doc.tables);
  const scoreById = new Map(ranked.map((s) => [s.id, s]));
  const selectedTableId = ranked[0]?.id ?? doc.tables[0]?.id ?? "";

  const tables: InspectedTable[] = doc.tables
    .map((t) => {
      const score = scoreById.get(t.id) ?? scoreTable(t);
      return {
        id: t.id,
        name: t.name,
        rowCount: t.rows.length,
        looksLikeTrades: score.looksLikeTrades,
        headers: t.headers,
        bestGuessMapping: buildBestGuessMapping(t.headers),
        detected: detectPlatform(t.headers, t.rows.slice(0, 20), fileName),
      };
    })
    .sort((a, b) => (scoreById.get(b.id)?.score ?? 0) - (scoreById.get(a.id)?.score ?? 0));

  const selected = tables.find((t) => t.id === selectedTableId) ?? tables[0];

  return {
    fileFormat: doc.format,
    detected: selected?.detected ?? [],
    headers: selected?.headers ?? [],
    bestGuessMapping: selected?.bestGuessMapping ?? {},
    rowCount: selected?.rowCount ?? 0,
    tables,
    selectedTableId,
    warnings: doc.warnings,
  };
}

export { resolveCurrentProfitSplitPercent } from "@/server/services/prop-firms.service";

function toReconstructionInput(
  id: string,
  e: {
    instrumentNormalized: string;
    direction: "LONG" | "SHORT";
    quantity: Prisma.Decimal | string;
    price: Prisma.Decimal | string;
    grossPnl: Prisma.Decimal | string | null;
    commission: Prisma.Decimal | string | null;
    swap: Prisma.Decimal | string | null;
    otherFees: Prisma.Decimal | string | null;
    executedAt: Date;
  },
): ExecutionForReconstruction {
  return {
    id,
    sourceExecutionId: id,
    instrumentNormalized: e.instrumentNormalized,
    direction: e.direction,
    quantity: new Decimal(e.quantity.toString()),
    price: new Decimal(e.price.toString()),
    grossPnl: new Decimal(e.grossPnl?.toString() ?? 0),
    commission: new Decimal(e.commission?.toString() ?? 0),
    swap: new Decimal(e.swap?.toString() ?? 0),
    otherFees: new Decimal(e.otherFees?.toString() ?? 0),
    executedAt: e.executedAt,
  };
}

interface PipelineResult {
  fileFormat: ImportFileFormat;
  sheetOrTableName: string | null;
  sourceMimeType: string | null;
  fileSizeBytes: number;
  columnMappingUsed: Record<string, string>;
  headers: string[];
  detected: AdapterDetectResult[];
  newExecutions: DedupedExecution[];
  duplicateExecutionCount: number;
  newTransactions: DedupedTransaction[];
  duplicateTransactionCount: number;
  rejections: { rowIndex: number; message: string }[];
  warnings: { rowIndex: number | null; message: string }[];
}

/** The pure(ish) read-parse-normalize-dedupe-classify pipeline shared by
 *  preview and confirm — confirm re-runs this from the same raw inputs rather
 *  than trusting client-computed preview numbers. Read-only: never writes. */
async function runPipeline(accountId: string, input: ImportRunInput): Promise<PipelineResult> {
  const { doc, sizeBytes } = await readDocument(input);
  const table = selectTable(doc, input.tableId);
  assertRowCount(table);

  const headers = table.headers;
  const rows = table.rows;
  const detected = detectPlatform(headers, rows.slice(0, 20), input.fileName);
  const adapter = getAdapter(input.platform);
  const parsed = adapter.parse(rows, headers, { mapping: input.mapping, timezone: input.timezone });

  const [existingExecRows, existingTxnRows] = await Promise.all([
    prisma.propFirmImportedExecution.findMany({ where: { accountId }, select: { dedupeKey: true } }),
    prisma.propFirmTransaction.findMany({ where: { accountId }, select: { dedupeKey: true } }),
  ]);
  const existingExecKeys = new Set(existingExecRows.map((r) => r.dedupeKey));
  const existingTxnKeys = new Set(existingTxnRows.map((r) => r.dedupeKey));

  const seenExecKeys = new Set<string>();
  const newExecutions: DedupedExecution[] = [];
  let duplicateExecutionCount = 0;
  for (const e of parsed.executions) {
    const fingerprint = computeExecutionFingerprint({
      accountId,
      instrumentNormalized: e.instrumentNormalized,
      direction: e.direction,
      quantity: e.quantity,
      price: e.price,
      executedAt: e.executedAt,
      currency: e.currency,
    });
    const key = dedupeKeyForExecution({ executionId: e.platformExecutionId, orderId: e.platformOrderId, dealId: e.platformDealId }, fingerprint);
    if (existingExecKeys.has(key) || seenExecKeys.has(key)) {
      duplicateExecutionCount += 1;
      continue;
    }
    seenExecKeys.add(key);
    newExecutions.push({ ...e, dedupeKey: key });
  }

  const seenTxnKeys = new Set<string>();
  const newTransactions: DedupedTransaction[] = [];
  let duplicateTransactionCount = 0;
  for (const t of parsed.transactions) {
    const fingerprint = computeTransactionFingerprint({
      accountId,
      rawType: t.rawType,
      amount: t.amount,
      currency: t.currency,
      occurredAt: t.occurredAt,
    });
    const key = dedupeKeyForTransaction(t.platformTransactionId, fingerprint);
    if (existingTxnKeys.has(key) || seenTxnKeys.has(key)) {
      duplicateTransactionCount += 1;
      continue;
    }
    seenTxnKeys.add(key);
    const auto = classifyTransaction({ rawType: t.rawType, amount: t.amount });
    const override = input.classificationOverrides?.[key];
    newTransactions.push({
      ...t,
      dedupeKey: key,
      classification: override ?? auto.classification,
      confidence: override ? 1 : auto.confidence,
      requiresReview: override ? false : auto.requiresReview,
    });
  }

  return {
    fileFormat: doc.format,
    sheetOrTableName: table.meta?.sheetName ?? (doc.tables.length > 1 ? table.name : null),
    sourceMimeType: input.mimeType ?? null,
    fileSizeBytes: sizeBytes,
    columnMappingUsed: columnMappingFor(input.platform, headers, input.mapping),
    headers,
    detected,
    newExecutions,
    duplicateExecutionCount,
    newTransactions,
    duplicateTransactionCount,
    rejections: parsed.rejections,
    warnings: [...doc.warnings.map((message) => ({ rowIndex: null, message })), ...parsed.warnings],
  };
}

const PAYOUT_CANDIDATE_CLASSIFICATIONS: TransactionClassification[] = ["WITHDRAWAL_PAYOUT", "WITHDRAWAL_UNCLASSIFIED"];

/**
 * The signed account-ledger entry a non-payout imported transaction should
 * post, or null when it must not affect the balance (internal transfers,
 * still-unknown rows, and a leading "initial balance" deposit that merely
 * restates the opening capital ACCOUNT_INITIALIZED already carries).
 * Withdrawals classified as payouts go through the dedicated payout path and
 * are not handled here.
 */
function ledgerEntryForImportedTransaction(
  t: { classification: TransactionClassification; amount: string; rawType: string; occurredAt: Date },
  account: { startingBalance: { toString(): string } },
  earliestTxnAt: Date | null,
): { eventType: LedgerEventType; amount: string } | null {
  const amt = new Decimal(t.amount);
  const abs = amt.abs();
  switch (t.classification) {
    case "DEPOSIT":
    case "CREDIT": {
      const starting = new Decimal(account.startingBalance.toString());
      const restatesOpeningCapital =
        /initial/i.test(t.rawType) ||
        (earliestTxnAt != null &&
          t.occurredAt.getTime() <= earliestTxnAt.getTime() &&
          abs.minus(starting).abs().lessThanOrEqualTo(Decimal.max(1, starting.times(0.005))));
      if (restatesOpeningCapital) return null;
      return { eventType: t.classification === "CREDIT" ? "CREDIT" : "DEPOSIT", amount: abs.toString() };
    }
    case "REFUND":
      return { eventType: "REFUND", amount: abs.toString() };
    case "COMMISSION":
      return { eventType: "COMMISSION_FEE", amount: abs.negated().toString() };
    case "FEE":
      return { eventType: "OTHER_FEE", amount: abs.negated().toString() };
    case "ACCOUNT_RESET":
    case "BALANCE_CORRECTION":
      return { eventType: "BALANCE_CORRECTION", amount: amt.toString() };
    default:
      return null;
  }
}

function earliestOccurredAt(transactions: { occurredAt: Date }[]): Date | null {
  return transactions.reduce<Date | null>((min, t) => (min == null || t.occurredAt < min ? t.occurredAt : min), null);
}

export interface PreviewPayoutRow {
  dedupeKey: string;
  rawType: string;
  amount: string;
  occurredAt: string;
  classification: TransactionClassification;
  confidence: number;
  requiresReview: boolean;
  traderPayout: string | null;
  propFirmShare: string | null;
  profitSplitPercentUsed: number | null;
}

export interface PreviewTradeRow {
  instrument: string;
  direction: string;
  status: string;
  netPnl: string;
  entryCount: number;
  exitCount: number;
  isNew: boolean;
}

export interface PreviewSummary {
  platform: ImportPlatform;
  fileFormat: ImportFileFormat;
  sheetOrTableName: string | null;
  columnMappingUsed: Record<string, string>;
  detected: AdapterDetectResult[];
  headers: string[];
  newExecutionCount: number;
  duplicateExecutionCount: number;
  rejectedRowCount: number;
  invalidRows: { rowIndex: number; message: string }[];
  warnings: string[];
  trades: PreviewTradeRow[];
  newPayouts: PreviewPayoutRow[];
  ignoredTransactions: PreviewPayoutRow[];
  duplicateTransactionCount: number;
  feesAndCommissions: { commission: string; swap: string; otherFees: string };
  /** The profit-split % that will be snapshotted onto every payout this import
   *  creates — the account's PROFIT_SPLIT rule, or the wizard override. Null
   *  when neither is set. */
  profitSplitPercent: number | null;
  /** True when there are payout rows but no profit-split % is available. The
   *  wizard must collect one (and every payout row is flagged
   *  `requiresReview`) before confirm will run. */
  profitSplitRequired: boolean;
  /** What confirm will post to the account ledger: new reconstructed-trade
   *  P&L + confirmed payout withdrawals + every balance-affecting non-payout
   *  transaction (deposits, fees, commissions, credits, refunds, corrections).
   *  A leading "initial balance" deposit that only restates opening capital is
   *  excluded. Internal transfers and still-unknown rows post nothing. */
  expectedBalanceChange: string;
}

function toPreviewPayoutRow(
  t: DedupedTransaction,
  profitSplitPercent: number | null,
  splitRequired: boolean,
): PreviewPayoutRow {
  const split = profitSplitPercent != null ? computePayoutSplit(t.amount, profitSplitPercent) : null;
  return {
    dedupeKey: t.dedupeKey,
    rawType: t.rawType,
    amount: t.amount,
    occurredAt: t.occurredAt.toISOString(),
    classification: t.classification,
    confidence: t.confidence,
    // A payout with no profit split available always needs the user to act,
    // regardless of how confidently it was classified.
    requiresReview: t.requiresReview || splitRequired,
    traderPayout: split?.traderPayout ?? null,
    propFirmShare: split?.propFirmShare ?? null,
    profitSplitPercentUsed: profitSplitPercent,
  };
}

export async function previewImport(userId: string, input: ImportRunInput): Promise<PreviewSummary> {
  const account = await prisma.propFirmAccount.findFirst({
    where: { id: input.accountId, userId },
    select: { id: true, startingBalance: true },
  });
  if (!account) throw new Error("Account not found.");

  const pipeline = await runPipeline(input.accountId, input);

  const existingExecRows = await prisma.propFirmImportedExecution.findMany({
    where: { accountId: input.accountId },
    select: {
      id: true,
      instrumentNormalized: true,
      direction: true,
      quantity: true,
      price: true,
      grossPnl: true,
      commission: true,
      swap: true,
      otherFees: true,
      executedAt: true,
    },
  });

  const combined: ExecutionForReconstruction[] = [
    ...existingExecRows.map((e) => toReconstructionInput(e.id, e)),
    ...pipeline.newExecutions.map((e, i) => toReconstructionInput(`new:${i}`, e)),
  ];
  const newExecIds = new Set(pipeline.newExecutions.map((_, i) => `new:${i}`));
  const trades = reconstructTrades(splitReversalFills(combined));
  // splitReversalFills renames overshooting fills to "<id>:open"/"<id>:close" —
  // match on the un-suffixed prefix too so a reversal built from a "new:N" id
  // still counts as touched.
  const touchedTrades = trades.filter((t) =>
    t.executionIds.some((id) => {
      const base = id.replace(/:(open|close)$/, "");
      return newExecIds.has(id) || newExecIds.has(base);
    }),
  );

  // Wizard override wins; else the account's configured PROFIT_SPLIT rule.
  const profitSplitPercent =
    input.profitSplitPercentOverride != null
      ? input.profitSplitPercentOverride
      : await resolveCurrentProfitSplitPercent(userId, input.accountId);

  const payoutClassified = pipeline.newTransactions.filter((t) => PAYOUT_CANDIDATE_CLASSIFICATIONS.includes(t.classification));
  const profitSplitRequired = payoutClassified.length > 0 && profitSplitPercent == null;

  const payoutRows: PreviewPayoutRow[] = [];
  const ignoredRows: PreviewPayoutRow[] = [];
  for (const t of pipeline.newTransactions) {
    const isPayout = PAYOUT_CANDIDATE_CLASSIFICATIONS.includes(t.classification);
    const row = toPreviewPayoutRow(t, profitSplitPercent, isPayout && profitSplitRequired);
    if (isPayout) payoutRows.push(row);
    else ignoredRows.push(row);
  }

  const feesTotal = (field: "commission" | "swap" | "otherFees") =>
    pipeline.newExecutions.reduce((sum, e) => sum.plus(e[field] ?? 0), new Decimal(0));

  const tradePnlChange = pipeline.newExecutions.reduce(
    (sum, e) => sum.plus(e.grossPnl ?? 0).plus(e.commission ?? 0).plus(e.swap ?? 0).plus(e.otherFees ?? 0),
    new Decimal(0),
  );
  // Mirror confirmImport exactly: every payout-candidate row (PAYOUT and
  // UNCLASSIFIED alike) posts a negative ledger entry of abs(amount).
  const payoutChange = payoutRows
    .filter((p) => PAYOUT_CANDIDATE_CLASSIFICATIONS.includes(p.classification))
    .reduce((sum, p) => sum.minus(new Decimal(p.amount).abs()), new Decimal(0));

  // …and every balance-affecting non-payout transaction (deposits, fees,
  // credits, refunds, corrections) posts its signed entry too.
  const earliestTxnAt = earliestOccurredAt(pipeline.newTransactions);
  const transactionChange = pipeline.newTransactions.reduce((sum, t) => {
    const effect = ledgerEntryForImportedTransaction(t, account, earliestTxnAt);
    return effect ? sum.plus(effect.amount) : sum;
  }, new Decimal(0));

  return {
    platform: input.platform,
    fileFormat: pipeline.fileFormat,
    sheetOrTableName: pipeline.sheetOrTableName,
    columnMappingUsed: pipeline.columnMappingUsed,
    detected: pipeline.detected,
    headers: pipeline.headers,
    newExecutionCount: pipeline.newExecutions.length,
    duplicateExecutionCount: pipeline.duplicateExecutionCount,
    rejectedRowCount: pipeline.rejections.length,
    invalidRows: pipeline.rejections,
    warnings: pipeline.warnings.map((w) => w.message),
    trades: touchedTrades.map((t) => ({
      instrument: t.instrument,
      direction: t.direction,
      status: t.status,
      netPnl: t.netPnl.toString(),
      entryCount: t.entryCount,
      exitCount: t.exitCount,
      isNew: true,
    })),
    newPayouts: payoutRows,
    ignoredTransactions: ignoredRows,
    duplicateTransactionCount: pipeline.duplicateTransactionCount,
    feesAndCommissions: {
      commission: feesTotal("commission").toString(),
      swap: feesTotal("swap").toString(),
      otherFees: feesTotal("otherFees").toString(),
    },
    profitSplitPercent,
    profitSplitRequired,
    expectedBalanceChange: tradePnlChange.plus(payoutChange).plus(transactionChange).toString(),
  };
}

export interface ConfirmResult {
  batchId: string;
  newExecutionsCount: number;
  newTradesCount: number;
  newPayoutsCount: number;
  skippedDuplicatesCount: number;
  rejectedRowsCount: number;
}

/** Deletes every ledger entry + trade row derived (even partly) from a given
 *  set of surviving execution ids, then rebuilds fresh trade rows from that
 *  same surviving set — the "rollback/confirm = delete-and-recompute"
 *  pattern (see plan). Used by both confirmImport (recompute after adding
 *  new executions) and rollbackImportBatch (recompute after removing a
 *  batch's executions). */
async function rebuildTradesForAccount(tx: TransactionClient, accountId: string): Promise<{ newTradesCount: number }> {
  const survivingExecRows = await tx.propFirmImportedExecution.findMany({
    where: { accountId },
    select: {
      id: true,
      instrumentNormalized: true,
      direction: true,
      quantity: true,
      price: true,
      grossPnl: true,
      commission: true,
      swap: true,
      otherFees: true,
      executedAt: true,
    },
  });

  const existingTradeIds = await tx.propFirmImportedTrade.findMany({ where: { accountId }, select: { id: true } });
  for (const { id } of existingTradeIds) {
    await removeLedgerEntriesForSource(tx, accountId, "TRADE_EXECUTION", id);
  }
  await tx.propFirmImportedTrade.deleteMany({ where: { accountId } });

  if (survivingExecRows.length === 0) return { newTradesCount: 0 };

  const forReconstruction = survivingExecRows.map((e) => toReconstructionInput(e.id, e));
  const groups = reconstructTrades(splitReversalFills(forReconstruction));

  const idToRealExecId = (id: string) => id.replace(/:(open|close)$/, "");

  for (const group of groups) {
    const trade = await tx.propFirmImportedTrade.create({
      data: {
        accountId,
        instrument: group.instrument,
        direction: group.direction,
        status: group.status,
        openedAt: group.openedAt,
        closedAt: group.closedAt,
        entryCount: group.entryCount,
        exitCount: group.exitCount,
        totalQuantity: group.totalQuantity.toString(),
        avgEntryPrice: group.avgEntryPrice.toString(),
        avgExitPrice: group.avgExitPrice?.toString() ?? null,
        grossPnl: group.grossPnl.toString(),
        commission: group.commission.toString(),
        swap: group.swap.toString(),
        otherFees: group.otherFees.toString(),
        netPnl: group.netPnl.toString(),
      },
    });

    const realExecIds = [...new Set(group.executionIds.map(idToRealExecId))];
    await tx.propFirmImportedExecution.updateMany({
      where: { id: { in: realExecIds } },
      data: { reconstructedTradeId: trade.id },
    });

    if (group.status === "CLOSED" || group.status === "PARTIAL") {
      await postLedgerEntry(tx, {
        accountId,
        eventType: "TRADE_PNL",
        amount: group.netPnl.toString(),
        occurredAt: group.closedAt ?? group.openedAt,
        sourceType: "TRADE_EXECUTION",
        sourceId: trade.id,
      });
    }
  }

  return { newTradesCount: groups.length };
}

/**
 * Re-runs the exact same pipeline `previewImport` used (never trusts
 * client-computed preview numbers), then writes everything inside one
 * transaction: the batch row, deduped executions/transactions, confirmed
 * payouts (+ their ledger posts), and a full trade rebuild for the account.
 * A thrown error anywhere rolls back the entire transaction — no partial
 * writes, per the CSV import plan's "failed/cancelled import" requirement.
 */
export async function confirmImport(userId: string, input: ImportRunInput): Promise<ConfirmResult> {
  const account = await prisma.propFirmAccount.findFirst({
    where: { id: input.accountId, userId },
    select: { id: true, startingBalance: true },
  });
  if (!account) throw new Error("Account not found.");

  const pipeline = await runPipeline(input.accountId, input);
  const profitSplitPercent =
    input.profitSplitPercentOverride != null
      ? input.profitSplitPercentOverride
      : await resolveCurrentProfitSplitPercent(userId, input.accountId);

  // Never silently record a payout at gross: if the file has withdrawals and
  // no profit split is configured or confirmed, refuse the whole import.
  const hasPayouts = pipeline.newTransactions.some((t) => PAYOUT_CANDIDATE_CLASSIFICATIONS.includes(t.classification));
  if (hasPayouts && profitSplitPercent == null) {
    throw new Error(
      "This account has no profit split configured. Set or confirm the profit-split percentage before importing its payouts.",
    );
  }

  const earliestTxnAt = earliestOccurredAt(pipeline.newTransactions);

  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.propFirmImportBatch.create({
        data: {
          userId,
          accountId: input.accountId,
          platform: input.platform,
          fileFormat: pipeline.fileFormat,
          fileName: input.fileName,
          fileSizeBytes: pipeline.fileSizeBytes,
          sourceMimeType: pipeline.sourceMimeType,
          sheetOrTableName: pipeline.sheetOrTableName,
          timezone: input.timezone,
          status: "CONFIRMED",
          dateRangeFrom: earliestOf(pipeline.newExecutions.map((e) => e.executedAt), pipeline.newTransactions.map((t) => t.occurredAt)),
          dateRangeTo: latestOf(pipeline.newExecutions.map((e) => e.executedAt), pipeline.newTransactions.map((t) => t.occurredAt)),
          newExecutionsCount: pipeline.newExecutions.length,
          skippedDuplicatesCount: pipeline.duplicateExecutionCount + pipeline.duplicateTransactionCount,
          rejectedRowsCount: pipeline.rejections.length,
          warnings: pipeline.warnings.length > 0 ? pipeline.warnings : undefined,
        },
      });

      for (const e of pipeline.newExecutions) {
        await tx.propFirmImportedExecution.create({
          data: {
            accountId: input.accountId,
            importBatchId: batch.id,
            platform: input.platform,
            platformExecutionId: e.platformExecutionId,
            platformOrderId: e.platformOrderId,
            platformDealId: e.platformDealId,
            instrumentRaw: e.instrumentRaw,
            instrumentNormalized: e.instrumentNormalized,
            direction: e.direction,
            quantity: e.quantity,
            price: e.price,
            grossPnl: e.grossPnl,
            commission: e.commission,
            swap: e.swap,
            otherFees: e.otherFees,
            currency: e.currency,
            executedAt: e.executedAt,
            dedupeKey: e.dedupeKey,
            rawRow: e.rawRow,
          },
        });
      }

      let newPayoutsCount = 0;
      for (const t of pipeline.newTransactions) {
        const txnRow = await tx.propFirmTransaction.create({
          data: {
            accountId: input.accountId,
            importBatchId: batch.id,
            platform: input.platform,
            platformTransactionId: t.platformTransactionId,
            rawType: t.rawType,
            classification: t.classification,
            amount: t.amount,
            currency: t.currency,
            occurredAt: t.occurredAt,
            dedupeKey: t.dedupeKey,
            rawRow: t.rawRow,
            requiresReview: t.requiresReview,
            reviewedAt: t.requiresReview ? null : new Date(),
          },
        });

        // Balance-affecting non-payout transactions (deposits, fees,
        // commissions, credits, refunds, corrections) each post one signed,
        // idempotent ledger entry keyed to this transaction row.
        const balanceEffect = ledgerEntryForImportedTransaction(t, account, earliestTxnAt);
        if (balanceEffect) {
          await postLedgerEntry(tx, {
            accountId: input.accountId,
            eventType: balanceEffect.eventType,
            amount: balanceEffect.amount,
            occurredAt: t.occurredAt,
            sourceType: "IMPORTED_TRANSACTION",
            sourceId: txnRow.id,
          });
        }

        if (t.classification !== "WITHDRAWAL_PAYOUT" && t.classification !== "WITHDRAWAL_UNCLASSIFIED") continue;

        const grossWithdrawal = new Decimal(t.amount).abs();
        const split = profitSplitPercent != null ? computePayoutSplit(grossWithdrawal, profitSplitPercent) : null;

        const payout = await tx.payout.create({
          data: {
            accountId: input.accountId,
            grossPayout: grossWithdrawal.toString(),
            profitSplitPercent: profitSplitPercent,
            netReceived: split?.traderPayout ?? null,
            paidDate: t.occurredAt,
            status: "PAID",
            importBatchId: batch.id,
            platformTransactionId: t.platformTransactionId,
            sourceTransactionId: txnRow.id,
            notes: `Imported from ${input.fileName} (${input.platform}).`,
          },
        });

        await postPayoutPaidLedgerEntry(tx, payout, t.occurredAt, grossWithdrawal);
        newPayoutsCount += 1;
      }

      const { newTradesCount } = await rebuildTradesForAccount(tx, input.accountId);

      await tx.propFirmImportBatch.update({
        where: { id: batch.id },
        data: { newTradesCount, newPayoutsCount },
      });

      return {
        batchId: batch.id,
        newExecutionsCount: pipeline.newExecutions.length,
        newTradesCount,
        newPayoutsCount,
        skippedDuplicatesCount: pipeline.duplicateExecutionCount + pipeline.duplicateTransactionCount,
        rejectedRowsCount: pipeline.rejections.length,
      };
    },
    { timeout: 30_000 },
  );
}

export interface RollbackPreview {
  batchId: string;
  fileName: string;
  executionsToRemove: number;
  transactionsToRemove: number;
  payoutsToRemove: number;
}

export async function previewRollback(userId: string, batchId: string): Promise<RollbackPreview> {
  const batch = await prisma.propFirmImportBatch.findFirst({
    where: { id: batchId, userId },
    include: {
      _count: { select: { executions: true, transactions: true, payouts: true } },
    },
  });
  if (!batch) throw new Error("Import batch not found.");
  return {
    batchId: batch.id,
    fileName: batch.fileName,
    executionsToRemove: batch._count.executions,
    transactionsToRemove: batch._count.transactions,
    payoutsToRemove: batch._count.payouts,
  };
}

/**
 * Removes only what this batch created — its executions, transactions, and
 * any confirmed payouts — then rebuilds trades from whatever executions
 * survive from OTHER batches. Never touches another batch's rows, manually
 * entered payouts (they carry no importBatchId), the Journal, or the
 * Performance Account.
 */
export async function rollbackImportBatch(userId: string, batchId: string): Promise<{ accountId: string }> {
  const batch = await prisma.propFirmImportBatch.findFirst({ where: { id: batchId, userId } });
  if (!batch) throw new Error("Import batch not found.");
  if (batch.status === "ROLLED_BACK") throw new Error("This import has already been rolled back.");

  await prisma.$transaction(
    async (tx) => {
      const payouts = await tx.payout.findMany({ where: { importBatchId: batchId }, select: { id: true, accountId: true, stageId: true } });
      for (const payout of payouts) {
        await removeLedgerEntriesForSource(tx, payout.accountId, "PAYOUT", payout.id);
        await tx.payout.delete({ where: { id: payout.id } });
      }

      const txns = await tx.propFirmTransaction.findMany({
        where: { importBatchId: batchId },
        select: { id: true, accountId: true },
      });
      for (const t of txns) {
        await removeLedgerEntriesForSource(tx, t.accountId, "IMPORTED_TRANSACTION", t.id);
      }

      await tx.propFirmImportedExecution.deleteMany({ where: { importBatchId: batchId } });
      await tx.propFirmTransaction.deleteMany({ where: { importBatchId: batchId } });

      await rebuildTradesForAccount(tx, batch.accountId);

      await tx.propFirmImportBatch.update({ where: { id: batchId }, data: { status: "ROLLED_BACK", rolledBackAt: new Date() } });
    },
    { timeout: 30_000 },
  );

  return { accountId: batch.accountId };
}

export async function listImportBatches(userId: string, accountId: string) {
  const owned = await prisma.propFirmAccount.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!owned) throw new Error("Account not found.");
  return prisma.propFirmImportBatch.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
  });
}

function earliestOf(...lists: Date[][]): Date | null {
  const all = lists.flat();
  return all.length === 0 ? null : new Date(Math.min(...all.map((d) => d.getTime())));
}
function latestOf(...lists: Date[][]): Date | null {
  const all = lists.flat();
  return all.length === 0 ? null : new Date(Math.max(...all.map((d) => d.getTime())));
}
