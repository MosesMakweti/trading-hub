import { z } from "zod";

import { isValidDateKey } from "@/lib/date";
import { directionSchema, biasSchema, riskInputTypeSchema } from "@/lib/validation/trades";

const allocationSchema = z.object({
  accountName: z.string().min(1),
  riskInputType: riskInputTypeSchema,
  riskValue: z.number().min(0),
  // Optional for backward compatibility with export files predating
  // independent real-account PnL — defaults to 0 (unset) when absent.
  closingPnlGross: z.number().default(0),
  closingPnlNet: z.number().default(0),
});

export const tradeExportRecordSchema = z.object({
  dateKey: z.string().refine(isValidDateKey, "Invalid date."),
  assetSymbol: z.string().min(1),
  executionMinutes: z.number().int().min(0).max(1439),
  direction: directionSchema,
  higherTimeframeBias: biasSchema,
  biasConfidencePercent: z.number().int().min(0).max(100),
  expectedRR: z.number().nullable(),
  actualRR: z.number().nullable(),
  performanceClosingPnlGross: z.number(),
  performanceClosingPnlNet: z.number(),
  hitTP1: z.boolean(),
  hitTP2: z.boolean(),
  hitTP3: z.boolean(),
  hitFullTP: z.boolean(),
  psychPreTradeMindset: z.string().nullable(),
  psychPostTradeReflection: z.string().nullable(),
  psychLessonsLearned: z.string().nullable(),
  psychWhatToWorkOn: z.string().nullable(),
  psychologyAnswers: z.record(z.string(), z.union([z.string(), z.number()])),
  sessionName: z.string().nullable(),
  allocations: z.array(allocationSchema),
  confluenceLabels: z.array(z.string()),
  executionLabels: z.array(z.string()),
  entryModelNames: z.array(z.string()),
});

export const tradeImportFileSchema = z.array(tradeExportRecordSchema);

export type TradeImportRecord = z.infer<typeof tradeExportRecordSchema>;
