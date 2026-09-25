import { z } from "zod";

/**
 * Edge Review Replay Data Source §8/§9 — the MT5 historical-CANDLE importer
 * (distinct from the MT4/MT5 trade/account-history importer under
 * `prop-firm-import.ts`, which has its own, separate size ceiling). MT5
 * "History Center -> Export" bar files are dense but regular (one short
 * line per bar) — a few years of M1 forex data is roughly 15-20MB. 60MB
 * covers a very long single-symbol M1 history while staying safely under
 * Vercel's 100MB request-body ceiling once base64-encoded (60MB * 4/3 ≈
 * 80MB) — see `mt5-parser.ts`'s own `MAX_MT5_IMPORT_ROWS` for the row-count
 * ceiling this pairs with.
 */
export const MAX_MT5_IMPORT_FILE_SIZE_BYTES = 60_000_000;
export const MAX_MT5_IMPORT_BASE64_LENGTH = Math.ceil((MAX_MT5_IMPORT_FILE_SIZE_BYTES * 4) / 3) + 1024;

const assetSymbolSchema = z.string().trim().min(1).max(20).transform((s) => s.toUpperCase());
const timeframeSchema = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1D"]);

const timeConventionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UTC") }),
  z.object({ kind: z.literal("FIXED_OFFSET"), offsetMinutes: z.number().int().min(-720).max(840), label: z.string().trim().max(60).optional() }),
  z.object({ kind: z.literal("IANA_ZONE"), zone: z.string().trim().min(1).max(100) }),
]);

/** Shared by preview and confirm — both need the same raw upload plus
 *  whatever metadata the trader has supplied so far (possibly none yet, on
 *  the first preview call). */
const mt5UploadFields = {
  fileName: z.string().trim().min(1).max(255),
  fileContentBase64: z.string().min(1).max(MAX_MT5_IMPORT_BASE64_LENGTH),
  sourceSymbol: z.string().trim().max(40).nullable().optional(),
  timeframeHint: z.string().trim().max(10).nullable().optional(),
  timeConvention: timeConventionSchema.nullable().optional(),
};

export const previewMt5ImportSchema = z.object(mt5UploadFields);

/** Confirm additionally needs the canonical symbol the trader confirmed (or
 *  that the preview already resolved) — kept explicit rather than
 *  re-derived, so confirm never silently persists a different symbol than
 *  what the trader was shown. */
export const confirmMt5ImportSchema = z.object({
  ...mt5UploadFields,
  canonicalSymbol: assetSymbolSchema,
  /** Stage §13 — overlap already exists and the trader explicitly chose to
   *  proceed anyway. Omitted/false: an overlapping import blocks with a
   *  warning instead of silently duplicating coverage. */
  allowOverlap: z.boolean().optional(),
});

export const listMt5DataSourceOptionsSchema = z.object({
  sessionId: z.string().min(1),
  canonicalSymbol: assetSymbolSchema,
  nativeTimeframe: timeframeSchema,
});

export const selectMt5DataSourceSchema = z.object({
  sessionId: z.string().min(1),
  canonicalSymbol: assetSymbolSchema,
  importId: z.string().min(1),
  nativeTimeframe: timeframeSchema,
});

export const resetMarketDataSourceSchema = z.object({
  sessionId: z.string().min(1),
  canonicalSymbol: assetSymbolSchema,
});

export type PreviewMt5ImportInput = z.infer<typeof previewMt5ImportSchema>;
export type ConfirmMt5ImportInput = z.infer<typeof confirmMt5ImportSchema>;
export type ListMt5DataSourceOptionsInput = z.infer<typeof listMt5DataSourceOptionsSchema>;
export type SelectMt5DataSourceInput = z.infer<typeof selectMt5DataSourceSchema>;
export type ResetMarketDataSourceInput = z.infer<typeof resetMarketDataSourceSchema>;
