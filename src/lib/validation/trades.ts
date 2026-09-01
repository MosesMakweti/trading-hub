import { z } from "zod";

import { partialPsychologyAnswersSchema } from "@/lib/validation/psychology";
import { propFirmExecutionsSchema } from "@/lib/validation/prop-firms";

export const directionSchema = z.enum(["LONG", "SHORT"]);
export const biasSchema = z.enum(["BULLISH", "BEARISH"]);
export const riskInputTypeSchema = z.enum(["PERCENT", "AMOUNT"]);

// Participating REAL accounts (prop-firm/brokerage TradingAccounts, never
// the Performance benchmark) — independent of the Performance Account and
// of each other: their own risk% and their own manually-entered/imported
// PnL (spec: "real trading accounts must remain optional allocations with
// independent risk percentages, executions and PnL" — never derived by
// scaling the Performance Account's result).
export const tradeAllocationSchema = z.object({
  tradingAccountId: z.string().min(1),
  riskInputType: riskInputTypeSchema,
  riskValue: z.coerce.number().min(0),
  closingPnlGross: z.coerce.number().default(0),
  closingPnlNet: z.coerce.number().default(0),
});

export const tradeSchema = z
  .object({
    // A trade is normally taken under a strategy (its market + session come from
    // that strategy), but a strategy is NOT mandatory — a trader with none set
    // up yet, or logging a one-off, can save a freeform trade (empty string).
    // The save layer already treats a missing strategy as null throughout
    // (resolveStrategySnapshot / buildStrategyContext in trades.service.ts).
    strategyId: z.string().default(""),
    assetSymbol: z.string().trim().min(1, "Enter the asset / symbol you traded."),
    executionMinutes: z.coerce.number().int().min(0).max(1439),
    direction: directionSchema,
    higherTimeframeBias: biasSchema,
    biasConfidencePercent: z.coerce.number().int().min(0).max(100),
    selectedSession: z.string().nullable().default(null),
    // Not entered on the create/edit form — derived from the TradingView Trade
    // Plan's weighted planned R once that plan is confirmed (trade-plan.service.ts).
    expectedRR: z.coerce.number().nullable().default(null),
    actualRR: z.coerce.number().nullable().default(null),
    // Pre-execution override of the Performance Account's default risk% for
    // this trade only (spec §5) — null = use the account's configured
    // default. Locked once the trade has an actual entry; the save layer
    // rejects a change after that point (performance-account.service.ts).
    // Preprocessed so a blank/cleared form field means "no override" (null)
    // rather than coercing "" to 0 and failing .positive().
    performanceRiskPercentOverride: z.preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.coerce.number().positive().nullable(),
    ).default(null),
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
    // Optional at create — a trade is first logged as an idea; the post-trade
    // Honest Questionnaire is filled later in the Trade Review tab. When all 8
    // answers ARE present the service scores & persists them (trades.service.ts
    // scorePsychologyAnswers); a partial/empty set persists nothing.
    psychologyAnswers: partialPsychologyAnswersSchema.default({}),
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
    actualStopLoss: workspacePrice,
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
    // Post-trade Honest Questionnaire answers, filled in the Trade Review tab
    // after the trade. Persisted (with score) only once all 8 are answered.
    psychologyAnswers: partialPsychologyAnswersSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "Nothing to update." });

export type TradeWorkspaceSectionInput = z.infer<typeof tradeWorkspaceSectionSchema>;
