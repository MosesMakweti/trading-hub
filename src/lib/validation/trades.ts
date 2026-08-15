import { z } from "zod";

import { psychologyAnswersSchema } from "@/lib/validation/psychology";
import { propFirmExecutionsSchema } from "@/lib/validation/prop-firms";

export const directionSchema = z.enum(["LONG", "SHORT"]);
export const biasSchema = z.enum(["BULLISH", "BEARISH"]);
export const riskInputTypeSchema = z.enum(["PERCENT", "AMOUNT"]);

// Participating (non-Performance) accounts only ever specify risk — their
// PnL is always auto-calculated from the Performance Account's entered PnL,
// scaled by relative risk% (see domain/performance/allocation.ts).
export const tradeAllocationSchema = z.object({
  tradingAccountId: z.string().min(1),
  riskInputType: riskInputTypeSchema,
  riskValue: z.coerce.number().min(0),
});

export const tradeSchema = z
  .object({
    // SOT: a trade is taken under a strategy, and its market + session come from
    // that strategy (never a global list). assetSymbol is the chosen market symbol
    // (the save layer bridges the legacy Asset FK from it until P9).
    strategyId: z.string().min(1, "Select a strategy."),
    assetSymbol: z.string().min(1, "Select an asset."),
    executionMinutes: z.coerce.number().int().min(0).max(1439),
    direction: directionSchema,
    higherTimeframeBias: biasSchema,
    biasConfidencePercent: z.coerce.number().int().min(0).max(100),
    selectedSession: z.string().nullable().default(null),
    expectedRR: z.coerce.number(),
    actualRR: z.coerce.number().nullable().default(null),
    // The one Closing PnL the trader manually enters — always the
    // Performance Account's real dollar result for this trade.
    performanceClosingPnlGross: z.coerce.number(),
    performanceClosingPnlNet: z.coerce.number(),
    hitTP1: z.boolean().default(false),
    hitTP2: z.boolean().default(false),
    hitTP3: z.boolean().default(false),
    hitFullTP: z.boolean().default(false),
    psychPreTradeMindset: z.string().trim().max(4000).nullable().default(null),
    psychPostTradeReflection: z.string().trim().max(4000).nullable().default(null),
    psychLessonsLearned: z.string().trim().max(4000).nullable().default(null),
    psychWhatToWorkOn: z.string().trim().max(4000).nullable().default(null),
    // Additional participating accounts beyond the Performance Account —
    // may be empty (a trade can affect only the Performance Account).
    allocations: z.array(tradeAllocationSchema).default([]),
    // Prop Firms module (System B) — sibling to `allocations` (System A),
    // never merged with it. Zero, one, or many independent account
    // executions of this same shared Trade Idea (spec §1).
    propFirmExecutions: propFirmExecutionsSchema,
    // SOT: confluences + execution confirmations selected from the chosen strategy,
    // by name. The save layer freezes the strategy's expected set and scores adherence.
    selectedConfluences: z.array(z.string()).default([]),
    selectedExecution: z.array(z.string()).default([]),
    // A single entry model chosen from the selected strategy's own Entry Models
    // (by name). Null when none is chosen or the strategy defines none.
    selectedEntryModel: z.string().nullable().default(null),
    psychologyAnswers: psychologyAnswersSchema,
  })
  .refine(
    (data) => new Set(data.allocations.map((a) => a.tradingAccountId)).size === data.allocations.length,
    { message: "Each account can only be selected once.", path: ["allocations"] },
  );

export type TradeInput = z.infer<typeof tradeSchema>;
export type TradeFormValues = z.input<typeof tradeSchema>;
export type TradeAllocationInput = z.infer<typeof tradeAllocationSchema>;
export type RiskInputType = z.infer<typeof riskInputTypeSchema>;

// --- Trade Workspace case-file fields (Phase 2) ---------------------------
// Edited inline in the workspace sections, one field at a time, via a small
// patch action — kept separate from the full tradeSchema so the /edit form
// and these narrative fields never fight over the same payload.

// Empty string -> null; otherwise trimmed, length-capped free text.
const workspaceNote = z
  .string()
  .trim()
  .max(4000)
  .transform((v) => (v === "" ? null : v))
  .nullable();

// Empty string -> null; otherwise a finite, non-negative price.
const workspacePrice = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "string" ? v.trim() : v))
  .transform((v) => (v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), {
    message: "Enter a valid non-negative price.",
  })
  .nullable();

// A patch of one-to-many workspace fields. Every key is optional; only the
// keys actually present are written, so a single field can autosave alone.
export const tradeWorkspaceSectionSchema = z
  .object({
    plannedEntry: workspacePrice,
    plannedStopLoss: workspacePrice,
    plannedTarget: workspacePrice,
    marketContext: workspaceNote,
    areasOfInterest: workspaceNote,
    reasonForTrade: workspaceNote,
    actualEntry: workspacePrice,
    actualExit: workspacePrice,
    executionNotes: workspaceNote,
    whatWentWell: workspaceNote,
    whatWentWrong: workspaceNote,
    whatSurprisedMe: workspaceNote,
    wouldTakeAgain: z.boolean().nullable(),
    // Behavioral intent tag for the Counterfactual (Discrepancy Gap) engine.
    tradeIntent: z
      .enum(["PLANNED", "FOMO", "REVENGE", "BOREDOM", "IMPULSE", "MANUAL_OVERRIDE"])
      .nullable(),
    // Strategy-adherence answers: a map of question key -> yes/no. Unknown keys
    // are dropped and the percent is recomputed server-side (service layer).
    adherenceAnswers: z.record(z.string(), z.boolean()),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export type TradeWorkspaceSectionInput = z.infer<typeof tradeWorkspaceSectionSchema>;
