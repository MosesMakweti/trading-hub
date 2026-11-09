// Visual Playbook — a scenario's market context and execution plan, plus the
// rule that picks which scenario a trade is validated against. Pure and
// framework-free (zod only), so the same shapes serve the editor, the
// service, version snapshots and tests.
//
// The context does not impose a methodology: the named fields are common
// headings a trader MAY fill, and `custom` holds anything else as label/value
// rows ("Volume profile", "DXY", "Order flow" …). Every field is optional.

import { z } from "zod";

export type ScenarioDirectionValue = "BULLISH" | "BEARISH" | "NEUTRAL";
export type ScenarioTypeValue = "CONTINUATION" | "REVERSAL" | "BREAKOUT" | "CUSTOM";

const text = z.string().trim().max(2000);
const shortText = z.string().trim().max(120);

export const scenarioContextSchema = z.object({
  htfBias: text.optional(),
  marketStructure: text.optional(),
  liquidity: text.optional(),
  premiumDiscount: text.optional(),
  keyLevels: text.optional(),
  sessions: text.optional(),
  custom: z
    .array(z.object({ id: z.string().min(1).max(40), label: shortText.min(1), value: text }))
    .max(20)
    .optional(),
});
export type ScenarioContext = z.infer<typeof scenarioContextSchema>;

/** One rule of an execution plan; `mandatory: false` = an optional confirmation. */
export const planRuleSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(500),
  mandatory: z.boolean(),
});
export type PlanRule = z.infer<typeof planRuleSchema>;

const rules = z.array(planRuleSchema).max(25).optional();

export const scenarioExecutionPlanSchema = z.object({
  entry: rules,
  stopLoss: rules,
  takeProfit: rules,
  management: rules,
  invalidation: rules,
  noTrade: rules,
  /** Minimum reward-to-risk this scenario requires (e.g. 2 = 1:2). */
  minRiskReward: z.number().min(0).max(100).nullable().optional(),
});
export type ScenarioExecutionPlan = z.infer<typeof scenarioExecutionPlanSchema>;

export const PLAN_SECTIONS = [
  { key: "entry", title: "Entry conditions" },
  { key: "stopLoss", title: "Stop-loss logic" },
  { key: "takeProfit", title: "Take-profit logic" },
  { key: "management", title: "Position management" },
  { key: "invalidation", title: "Invalidation" },
  { key: "noTrade", title: "No-trade conditions" },
] as const;

/**
 * Reads a stored Json column into a context object. Anything malformed is
 * dropped field by field rather than failing the whole read, so a scenario
 * always opens.
 */
export function readScenarioContext(raw: unknown): ScenarioContext {
  const parsed = scenarioContextSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const out: ScenarioContext = {};
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(scenarioContextSchema.shape) as (keyof ScenarioContext)[]) {
      const field = scenarioContextSchema.shape[key].safeParse((raw as Record<string, unknown>)[key]);
      if (field.success && field.data !== undefined) (out as Record<string, unknown>)[key] = field.data;
    }
  }
  return out;
}

export function readExecutionPlan(raw: unknown): ScenarioExecutionPlan {
  const parsed = scenarioExecutionPlanSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const out: ScenarioExecutionPlan = {};
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(scenarioExecutionPlanSchema.shape) as (keyof ScenarioExecutionPlan)[]) {
      const field = scenarioExecutionPlanSchema.shape[key].safeParse((raw as Record<string, unknown>)[key]);
      if (field.success && field.data !== undefined) (out as Record<string, unknown>)[key] = field.data;
    }
  }
  return out;
}

/** Whether a scenario of this direction can be used for a trade in that direction. */
export function scenarioFitsTrade(scenarioDirection: ScenarioDirectionValue, tradeDirection: "LONG" | "SHORT"): boolean {
  if (scenarioDirection === "NEUTRAL") return true;
  return tradeDirection === "LONG" ? scenarioDirection === "BULLISH" : scenarioDirection === "BEARISH";
}

export interface PickableScenario {
  id: string;
  direction: ScenarioDirectionValue;
  sortOrder: number;
}

/**
 * Which scenario a trade is validated against:
 *   1. the one the trader explicitly chose, if it fits the trade's direction;
 *   2. otherwise the first (by order) scenario of the matching direction —
 *      exactly what every existing Setup Type resolves to (one Bullish, one
 *      Bearish), so existing behaviour is unchanged;
 *   3. otherwise the first NEUTRAL scenario.
 * Null when nothing fits (or an explicit choice doesn't fit — never silently
 * swapped for another scenario).
 */
export function pickScenarioForTrade<T extends PickableScenario>(
  scenarios: readonly T[],
  tradeDirection: "LONG" | "SHORT",
  explicitId?: string | null,
): T | null {
  if (explicitId) {
    const chosen = scenarios.find((s) => s.id === explicitId);
    return chosen && scenarioFitsTrade(chosen.direction, tradeDirection) ? chosen : null;
  }
  const ordered = [...scenarios].sort((a, b) => a.sortOrder - b.sortOrder);
  const exact = ordered.find((s) => s.direction !== "NEUTRAL" && scenarioFitsTrade(s.direction, tradeDirection));
  return exact ?? ordered.find((s) => s.direction === "NEUTRAL") ?? null;
}

export function scenarioDirectionLabel(d: ScenarioDirectionValue): string {
  return d === "BULLISH" ? "Bullish" : d === "BEARISH" ? "Bearish" : "Neutral";
}
