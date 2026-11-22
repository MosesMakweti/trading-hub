/**
 * Prop-firm models — configurable, versioned definitions (no firm's rules are
 * hard-coded). A model has any number of evaluation phases and a funded
 * stage; each phase's rule snapshot (SimRules) is derived from it when the
 * phase account is created and frozen there. A challenge freezes the whole
 * definition at purchase, so editing a model never changes an existing
 * challenge.
 *
 * The built-in templates are GENERIC archetypes (decision D4) — not any real
 * firm's terms, which change over time. Traders create named custom models.
 */
import { z } from "zod";

import { costsSchema, dailyLossSchema, holdingSchema, limitsSchema, maxLossSchema, payoutTermsSchema, simRulesSchema, type SimRules } from "./rules";

const phaseSchema = z.object({
  name: z.string().trim().min(1).max(60),
  profitTargetPercent: z.number().gt(0).max(100),
  minTradingDays: z.number().int().min(0).max(365).nullable().default(null),
  maxCalendarDays: z.number().int().min(1).max(3650).nullable().default(null),
  consistencyMaxDayPercent: z.number().gt(0).max(100).nullable().default(null),
  dailyLoss: dailyLossSchema.nullable().default(null),
  maxLoss: maxLossSchema.nullable().default(null),
  limits: limitsSchema.prefault({}),
  holding: holdingSchema.prefault({}),
});

const fundedSchema = z.object({
  dailyLoss: dailyLossSchema.nullable().default(null),
  maxLoss: maxLossSchema.nullable().default(null),
  limits: limitsSchema.prefault({}),
  holding: holdingSchema.prefault({}),
  consistencyMaxDayPercent: z.number().gt(0).max(100).nullable().default(null),
  payout: payoutTermsSchema,
});

export const firmModelSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    firmName: z.string().trim().min(1).max(80),
    modelName: z.string().trim().min(1).max(80),
    description: z.string().trim().max(2000).nullable().default(null),
    challengeType: z.enum(["ONE_STEP", "TWO_STEP", "THREE_STEP", "INSTANT", "CUSTOM"]).default("CUSTOM"),
    currency: z.string().trim().toUpperCase().length(3).default("USD"),
    /** Purchasable sizes and their simulated fee. */
    sizes: z.array(z.object({ accountSize: z.number().gt(0).max(1e8), fee: z.number().min(0).max(1e7) })).min(1).max(12),
    /** Upper-case symbols allowed; null = any instrument with data. */
    instruments: z.array(z.string().trim().toUpperCase().min(1).max(20)).max(100).nullable().default(null),
    dailyResetHour: z.number().int().min(0).max(23).default(0),
    costs: costsSchema.prefault({}),
    newsTradingRestricted: z.boolean().default(false),
    phases: z.array(phaseSchema).max(5).default([]),
    funded: fundedSchema,
  })
  .refine((m) => m.challengeType !== "INSTANT" || m.phases.length === 0, { message: "An instant-funding model has no evaluation phases.", path: ["phases"] })
  .refine((m) => m.challengeType === "INSTANT" || m.challengeType === "CUSTOM" || m.phases.length > 0, { message: "Add at least one evaluation phase.", path: ["phases"] });

export type FirmModel = z.infer<typeof firmModelSchema>;
export type FirmModelInput = z.input<typeof firmModelSchema>;

/** Number of accounts a challenge goes through: its phases, then funded. */
export const stageCount = (m: FirmModel) => m.phases.length + 1;
export const isFundedStage = (m: FirmModel, phaseIndex: number) => phaseIndex >= m.phases.length;

/** The frozen rule snapshot for one stage (evaluation phase or funded). */
export function stageRules(m: FirmModel, phaseIndex: number): SimRules {
  const shared = { dailyResetHour: m.dailyResetHour, costs: m.costs, allowedSymbols: m.instruments, newsTradingRestricted: m.newsTradingRestricted };
  if (!isFundedStage(m, phaseIndex)) {
    const p = m.phases[phaseIndex];
    return simRulesSchema.parse({
      ...shared,
      objective: { profitTargetPercent: p.profitTargetPercent, minTradingDays: p.minTradingDays, maxCalendarDays: p.maxCalendarDays, consistencyMaxDayPercent: p.consistencyMaxDayPercent },
      dailyLoss: p.dailyLoss,
      maxLoss: p.maxLoss,
      limits: p.limits,
      holding: p.holding,
    });
  }
  const f = m.funded;
  return simRulesSchema.parse({ ...shared, objective: { consistencyMaxDayPercent: f.consistencyMaxDayPercent }, dailyLoss: f.dailyLoss, maxLoss: f.maxLoss, limits: f.limits, holding: f.holding, payout: f.payout });
}

export function stageName(m: FirmModel, phaseIndex: number): string {
  return isFundedStage(m, phaseIndex) ? "Funded" : m.phases[phaseIndex].name;
}

const payout = { profitSplitPercent: 80, firstPayoutAfterDays: 14, cycleDays: 14, minPayoutAmount: 100, maxPayoutAmount: null, profitBufferPercent: 0, minTradingDaysPerCycle: 0 };

/** Built-in, clearly generic archetypes. */
export const FIRM_TEMPLATES: { key: string; model: FirmModel }[] = [
  {
    key: "classic-two-step",
    model: firmModelSchema.parse({
      firmName: "Template",
      modelName: "Classic two-step",
      description: "Two evaluation phases with a static maximum loss and a daily loss measured from the day's starting balance.",
      challengeType: "TWO_STEP",
      sizes: [{ accountSize: 10_000, fee: 99 }, { accountSize: 25_000, fee: 199 }, { accountSize: 50_000, fee: 299 }, { accountSize: 100_000, fee: 499 }],
      costs: { commissionPerUnitPerSide: 3.5 },
      phases: [
        { name: "Phase 1", profitTargetPercent: 8, minTradingDays: 4, dailyLoss: { limitPercent: 5, basis: "EQUITY", reference: "INITIAL_BALANCE" }, maxLoss: { limitPercent: 10, model: "STATIC" } },
        { name: "Phase 2", profitTargetPercent: 5, minTradingDays: 4, dailyLoss: { limitPercent: 5, basis: "EQUITY", reference: "INITIAL_BALANCE" }, maxLoss: { limitPercent: 10, model: "STATIC" } },
      ],
      funded: { dailyLoss: { limitPercent: 5, basis: "EQUITY", reference: "INITIAL_BALANCE" }, maxLoss: { limitPercent: 10, model: "STATIC" }, payout },
    }),
  },
  {
    key: "one-step-trailing",
    model: firmModelSchema.parse({
      firmName: "Template",
      modelName: "One-step, trailing",
      description: "One phase with an end-of-day trailing maximum loss that locks at the starting balance, and a 50% consistency rule.",
      challengeType: "ONE_STEP",
      sizes: [{ accountSize: 25_000, fee: 159 }, { accountSize: 50_000, fee: 259 }, { accountSize: 100_000, fee: 459 }],
      costs: { commissionPerUnitPerSide: 3.5 },
      phases: [{ name: "Evaluation", profitTargetPercent: 10, minTradingDays: 3, consistencyMaxDayPercent: 50, dailyLoss: { limitPercent: 4, basis: "EQUITY", reference: "DAY_START_HIGHER" }, maxLoss: { limitPercent: 6, model: "EOD_TRAILING", trailingLockAtStart: true } }],
      funded: { dailyLoss: { limitPercent: 4, basis: "EQUITY", reference: "DAY_START_HIGHER" }, maxLoss: { limitPercent: 6, model: "EOD_TRAILING", trailingLockAtStart: true }, consistencyMaxDayPercent: 50, payout: { ...payout, profitSplitPercent: 90, profitBufferPercent: 1 } },
    }),
  },
  {
    key: "intraday-trailing",
    model: firmModelSchema.parse({
      firmName: "Template",
      modelName: "Intraday trailing, no overnight",
      description: "One phase, an intraday trailing drawdown on equity, and no positions held through the daily reset.",
      challengeType: "ONE_STEP",
      sizes: [{ accountSize: 50_000, fee: 175 }, { accountSize: 100_000, fee: 325 }],
      dailyResetHour: 0,
      phases: [{ name: "Evaluation", profitTargetPercent: 6, minTradingDays: 2, maxLoss: { limitPercent: 4, model: "INTRADAY_TRAILING", trailingLockAtStart: true }, holding: { allowOvernight: false, allowWeekend: false } }],
      funded: { maxLoss: { limitPercent: 4, model: "INTRADAY_TRAILING", trailingLockAtStart: true }, holding: { allowOvernight: false, allowWeekend: false }, payout: { ...payout, profitSplitPercent: 90, cycleDays: 7, firstPayoutAfterDays: 7 } },
    }),
  },
  {
    key: "instant-funding",
    model: firmModelSchema.parse({
      firmName: "Template",
      modelName: "Instant funding",
      description: "No evaluation: a funded account from day one with a tight static loss limit and a higher fee.",
      challengeType: "INSTANT",
      sizes: [{ accountSize: 10_000, fee: 399 }, { accountSize: 25_000, fee: 899 }],
      costs: { commissionPerUnitPerSide: 3.5 },
      phases: [],
      funded: { dailyLoss: { limitPercent: 3, basis: "EQUITY", reference: "DAY_START_BALANCE" }, maxLoss: { limitPercent: 6, model: "STATIC" }, payout: { ...payout, profitSplitPercent: 70 } },
    }),
  },
];
