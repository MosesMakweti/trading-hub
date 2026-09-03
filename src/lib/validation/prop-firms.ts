import { z } from "zod";

export const marketCategorySchema = z.enum(["CFD", "FUTURES"]);
export const propFirmIdentityKindSchema = z.enum(["DIRECTORY", "CUSTOM"]);
export const userPropFirmStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const propFirmAccountModelTypeSchema = z.enum([
  "ONE_PHASE",
  "TWO_PHASE",
  "THREE_PHASE",
  "INSTANT_FUNDED",
  "CUSTOM",
]);
export const propFirmAccountStatusSchema = z.enum([
  "ACTIVE",
  "PASSED",
  "FAILED",
  "BREACHED",
  "FUNDED",
  "ARCHIVED",
]);
export const accountStageTypeSchema = z.enum([
  "PHASE_1",
  "PHASE_2",
  "PHASE_3",
  "VERIFICATION",
  "MASTER_FUNDED",
  "PAYOUT_ELIGIBLE",
  "CUSTOM",
]);
export const stageCloseStatusSchema = z.enum(["PASSED", "FAILED", "BREACHED", "RESET", "ABANDONED"]);
export const ruleKeySchema = z.enum([
  "PROFIT_TARGET",
  "MAX_DAILY_LOSS",
  "MAX_TOTAL_LOSS",
  "STATIC_DRAWDOWN",
  "INTRADAY_TRAILING_DRAWDOWN",
  "EOD_TRAILING_DRAWDOWN",
  "DRAWDOWN_BALANCE_BASED",
  "DRAWDOWN_EQUITY_BASED",
  "MIN_TRADING_DAYS",
  "MAX_TRADING_DAYS",
  "CONSISTENCY_RULE",
  "MAX_RISK_PER_TRADE",
  "MAX_RISK_PER_DAY",
  "MAX_OPEN_POSITIONS",
  "MAX_LOT_SIZE",
  "MAX_CONTRACT_SIZE",
  "NEWS_TRADING_RESTRICTION",
  "WEEKEND_HOLDING_RESTRICTION",
  "OVERNIGHT_HOLDING_RESTRICTION",
  "COPY_TRADING_RESTRICTION",
  "EA_BOT_RESTRICTION",
  "INACTIVITY_LIMIT",
  "PAYOUT_WAITING_PERIOD",
  "PROFIT_SPLIT",
  "SCALING_REQUIREMENT",
  "CUSTOM",
]);
export const ruleValueTypeSchema = z.enum(["NUMERIC", "MONETARY", "PERCENTAGE", "BOOLEAN", "TEXT"]);
export const ruleBreachActionSchema = z.enum([
  "WARNING_ONLY",
  "SOFT_BREACH",
  "HARD_BREACH_FAIL",
  "HARD_BREACH_TERMINATE",
  "CUSTOM",
]);
export const milestoneTypeSchema = z.enum([
  "ACCOUNT_PURCHASED",
  "PHASE_PASSED",
  "PHASE_FAILED",
  "STAGE_RESET",
  "FUNDED_ACHIEVED",
  "PAYOUT_RECEIVED",
  "SCALING_MILESTONE",
  "ACCOUNT_BREACHED",
  "CUSTOM",
]);
export const payoutStatusSchema = z.enum([
  "AVAILABLE",
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "PAID",
  "REJECTED",
  "CANCELLED",
]);

const optionalNote = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v ? v : undefined));

export const createUserPropFirmSchema = z
  .object({
    identityKind: propFirmIdentityKindSchema,
    directoryEntryId: z.string().trim().min(1).optional(),
    customCompanyName: z.string().trim().max(80).optional(),
    customLogoUrl: z.string().trim().url().optional().or(z.literal("")),
    customWebsite: z.string().trim().url().optional().or(z.literal("")),
    customAccentColor: z.string().trim().max(20).optional(),
    marketCategory: marketCategorySchema,
    isPriority: z.boolean().optional(),
    priorityOrder: z.coerce.number().int().min(0).optional(),
    notes: optionalNote,
  })
  .refine((v) => (v.identityKind === "DIRECTORY" ? Boolean(v.directoryEntryId) : true), {
    message: "Choose a directory entry.",
    path: ["directoryEntryId"],
  })
  .refine((v) => (v.identityKind === "CUSTOM" ? Boolean(v.customCompanyName?.trim()) : true), {
    message: "Company name is required for a custom prop firm.",
    path: ["customCompanyName"],
  });

export const updateUserPropFirmSchema = z.object({
  isPriority: z.boolean().optional(),
  priorityOrder: z.coerce.number().int().min(0).nullable().optional(),
  status: userPropFirmStatusSchema.optional(),
  notes: optionalNote,
});

export const createStageRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ruleKey: ruleKeySchema,
  valueType: ruleValueTypeSchema,
  numericValue: z.coerce.number().optional(),
  booleanValue: z.boolean().optional(),
  textValue: z.string().trim().max(500).optional(),
  measurementBasis: z.string().trim().max(60).optional(),
  measurementPeriod: z.string().trim().max(60).optional(),
  warningThreshold: z.coerce.number().optional(),
  breachThreshold: z.coerce.number().optional(),
  breachAction: ruleBreachActionSchema.optional(),
  description: optionalNote,
  isEnabled: z.boolean().optional(),
});

export const createAccountStageDraftSchema = z.object({
  name: z.string().trim().min(1, "Stage name is required.").max(80),
  type: accountStageTypeSchema,
  rules: z.array(createStageRuleSchema).optional(),
});

export const createPropFirmAccountSchema = z.object({
  userPropFirmId: z.string().trim().min(1),
  displayName: z.string().trim().min(1, "Account name is required.").max(80),
  externalRef: z.string().trim().max(120).optional(),
  marketCategory: marketCategorySchema,
  modelName: z.string().trim().max(80).optional(),
  modelType: propFirmAccountModelTypeSchema,
  accountSize: z.coerce.number().positive("Account size must be greater than 0."),
  accountCurrency: z.string().trim().length(3).optional(),
  purchasePrice: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).optional(),
  resetFees: z.coerce.number().min(0).optional(),
  activationFees: z.coerce.number().min(0).optional(),
  otherCosts: z.coerce.number().min(0).optional(),
  purchaseDate: z.coerce.date().optional(),
  notes: optionalNote,
  stages: z.array(createAccountStageDraftSchema).min(1, "At least one stage is required.").optional(),
});

export const updatePropFirmAccountSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  externalRef: z.string().trim().max(120).optional(),
  modelName: z.string().trim().max(80).optional(),
  modelType: propFirmAccountModelTypeSchema.optional(),
  status: propFirmAccountStatusSchema.optional(),
  currentBalance: z.coerce.number().optional(),
  currentEquity: z.coerce.number().optional(),
  notes: optionalNote,
});

export const advanceStageSchema = z.object({
  closeStatus: stageCloseStatusSchema,
  completionNotes: optionalNote,
  finalBalance: z.coerce.number().optional(),
  nextStage: z
    .object({
      name: z.string().trim().min(1).max(80),
      type: accountStageTypeSchema,
      startingBalance: z.coerce.number().positive(),
    })
    .optional(),
});

export const reorderPriorityFirmsSchema = z.object({
  orderedIds: z.array(z.string().trim().min(1)).min(1),
});

export const reorderStageRulesSchema = z.object({
  orderedRuleIds: z.array(z.string().trim().min(1)).min(1),
});

export const copyStageRulesSchema = z.object({
  fromStageId: z.string().trim().min(1),
  toStageId: z.string().trim().min(1),
});

export const createMilestoneSchema = z.object({
  stageId: z.string().trim().min(1).optional(),
  type: milestoneTypeSchema,
  title: z.string().trim().max(120).optional(),
  description: optionalNote,
});

export const createPayoutSchema = z.object({
  stageId: z.string().trim().min(1).optional(),
  grossPayout: z.coerce.number().positive(),
  profitSplitPercent: z.coerce.number().min(0).max(100).optional(),
  netExpected: z.coerce.number().optional(),
  requestedDate: z.coerce.date().optional(),
  paymentMethod: z.string().trim().max(60).optional(),
  notes: optionalNote,
});

export const updatePayoutSchema = z.object({
  status: payoutStatusSchema.optional(),
  netReceived: z.coerce.number().optional(),
  approvedDate: z.coerce.date().optional(),
  paidDate: z.coerce.date().optional(),
  referenceId: z.string().trim().max(120).optional(),
  feesDeductions: z.coerce.number().optional(),
  notes: optionalNote,
});

// ── Trade Idea Account Allocation / Execution (final phase) ─────────────────

export const riskEntryModeSchema = z.enum(["PERCENT", "AMOUNT", "FIXED_SIZE"]);
export const riskBasisSchema = z.enum(["CURRENT_BALANCE", "CURRENT_EQUITY", "STAGE_STARTING_BALANCE"]);
export const executionStatusSchema = z.enum([
  "PLANNED",
  "ALLOCATED",
  "EXECUTED",
  "PARTIALLY_CLOSED",
  "CLOSED",
  "CANCELLED",
  "MISSED",
  "NOT_TAKEN",
]);

export const instrumentSizingSchema = z.object({
  stopDistance: z.coerce.number().positive().optional(),
  pipOrTickValue: z.coerce.number().positive().optional(),
  conversionRate: z.coerce.number().positive().optional(),
  stopDistanceTicks: z.coerce.number().positive().optional(),
  tickValue: z.coerce.number().positive().optional(),
});

// One Account Allocation row on the Trade Idea form — a sibling to
// tradeAllocationSchema (System A), never merged with it. PnL/actuals are
// entered here directly (unlike System A, where PnL is always derived from
// the Performance Account) — spec §4: independent per-account actuals.
export const executionAllocationSchema = z.object({
  propFirmAccountId: z.string().trim().min(1),
  riskEntryMode: riskEntryModeSchema,
  riskBasis: riskBasisSchema,
  riskInputValue: z.coerce.number().min(0),
  plannedEntryOverride: z.coerce.number().nullable().optional(),
  plannedStopLossOverride: z.coerce.number().nullable().optional(),
  plannedTargetOverride: z.coerce.number().nullable().optional(),
  actualEntry: z.coerce.number().nullable().optional(),
  actualExit: z.coerce.number().nullable().optional(),
  actualLotSize: z.coerce.number().nullable().optional(),
  actualContractQty: z.coerce.number().nullable().optional(),
  grossPnl: z.coerce.number().nullable().optional(),
  commission: z.coerce.number().nullable().optional(),
  swapFinancing: z.coerce.number().nullable().optional(),
  otherFees: z.coerce.number().nullable().optional(),
  actualR: z.coerce.number().nullable().optional(),
  status: executionStatusSchema.optional(),
  executionNotes: z.string().trim().max(2000).nullable().optional(),
  instrumentSizing: instrumentSizingSchema.optional(),
});

export const propFirmExecutionsSchema = z
  .array(executionAllocationSchema)
  .default([])
  .refine((v) => new Set(v.map((e) => e.propFirmAccountId)).size === v.length, {
    message: "Each account can only be selected once.",
  });

export const manualLedgerAdjustmentSchema = z.object({
  amount: z.coerce.number(),
  reason: z.string().trim().min(1, "A reason is required."),
  eventType: z.enum(["MANUAL_ADJUSTMENT", "CUSTOM_ADJUSTMENT"]),
  stageId: z.string().trim().min(1).optional(),
});

// z.coerce.number() (priorityOrder / accountSize / …) has a wider input type
// (unknown) than output type (number) — react-hook-form's useForm generic
// must be the INPUT type (what the form fields actually hold) while the
// resolved submit handler receives the OUTPUT type. Same split as
// lib/validation/accounts.ts.
export type CreateUserPropFirmValues = z.infer<typeof createUserPropFirmSchema>;
export type CreateUserPropFirmFormValues = z.input<typeof createUserPropFirmSchema>;
export type CreatePropFirmAccountValues = z.infer<typeof createPropFirmAccountSchema>;
export type CreatePropFirmAccountFormValues = z.input<typeof createPropFirmAccountSchema>;
export type CreateAccountStageDraftValues = z.infer<typeof createAccountStageDraftSchema>;
export type CreateStageRuleValues = z.infer<typeof createStageRuleSchema>;
export type ExecutionAllocationInput = z.infer<typeof executionAllocationSchema>;
export type ManualLedgerAdjustmentInput = z.infer<typeof manualLedgerAdjustmentSchema>;
