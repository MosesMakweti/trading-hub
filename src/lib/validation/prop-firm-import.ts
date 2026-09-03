import { z } from "zod";

// Round-tripping the raw upload through the client (inspect -> preview ->
// confirm) needs hard caps so the pipeline never has to deal with an unbounded
// payload — see the "Preview is stateless" note in the CSV import plan. Binary
// formats (XLSX/XLS) travel as base64, which inflates ~33%, so the encoded cap
// is derived from the raw-byte cap.
export const MAX_IMPORT_FILE_SIZE_BYTES = 5_000_000; // 5MB decoded
export const MAX_IMPORT_BASE64_LENGTH = Math.ceil((MAX_IMPORT_FILE_SIZE_BYTES * 4) / 3) + 1024;
export const MAX_IMPORT_ROWS = 50_000;
export const MAX_IMPORT_SHEETS = 50;

export const importPlatformSchema = z.enum(["MT4", "MT5", "CTRADER", "NINJATRADER", "TRADOVATE", "GENERIC_CSV"]);

export const importFileFormatSchema = z.enum(["CSV", "TSV", "TXT", "XLSX", "XLS", "HTML", "XML"]);

export const columnMappingSchema = z.record(z.string(), z.string().optional());

export const transactionClassificationSchema = z.enum([
  "DEPOSIT",
  "WITHDRAWAL_PAYOUT",
  "WITHDRAWAL_UNCLASSIFIED",
  "INTERNAL_TRANSFER",
  "ACCOUNT_RESET",
  "FEE",
  "COMMISSION",
  "REFUND",
  "BALANCE_CORRECTION",
  "CREDIT",
  "UNKNOWN",
]);

const fileContentBase64 = z
  .string()
  .min(1)
  .max(MAX_IMPORT_BASE64_LENGTH, `File exceeds the upload limit.`)
  .regex(/^[A-Za-z0-9+/=\r\n]+$/, "File payload is not valid base64.");

const mimeType = z.string().max(255).optional();
const tableId = z.string().max(200).optional();

export const inspectImportFileSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileContentBase64,
  mimeType,
});

const baseImportRunSchema = z.object({
  accountId: z.string().min(1),
  platform: importPlatformSchema,
  fileName: z.string().min(1).max(255),
  fileContentBase64,
  mimeType,
  tableId,
  timezone: z.string().min(1).max(64),
  mapping: columnMappingSchema.optional(),
  profitSplitPercentOverride: z.coerce.number().min(0).max(100).optional(),
});

export const previewImportSchema = baseImportRunSchema;

export const confirmImportSchema = baseImportRunSchema.extend({
  classificationOverrides: z.record(z.string(), transactionClassificationSchema).optional(),
});

export const rollbackImportBatchSchema = z.object({
  batchId: z.string().min(1),
});

export const saveMappingTemplateSchema = z.object({
  name: z.string().min(1).max(120),
  platform: importPlatformSchema,
  mapping: columnMappingSchema,
});
