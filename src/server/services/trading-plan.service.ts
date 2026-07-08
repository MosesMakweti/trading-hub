import type { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import type {
  DailyRoutineInput,
  ProfitTakingInput,
  RiskManagementInput,
  StopLossInput,
  StrategyFrameworkInput,
} from "@/lib/validation/trading-plan";

export async function getTradingPlan(userId: string) {
  const plan = await prisma.tradingPlan.findUnique({ where: { userId } });
  if (plan) return plan;

  return prisma.tradingPlan.create({ data: { userId } });
}

type PlanFieldUpdate =
  | DailyRoutineInput
  | ProfitTakingInput
  | RiskManagementInput
  | StopLossInput
  | StrategyFrameworkInput;

function upsertPlan(userId: string, data: PlanFieldUpdate) {
  const jsonSafeData = data as Prisma.TradingPlanUncheckedUpdateInput;
  return prisma.tradingPlan.upsert({
    where: { userId },
    create: { userId, ...jsonSafeData } as Prisma.TradingPlanUncheckedCreateInput,
    update: jsonSafeData,
  });
}

export async function updateDailyRoutine(userId: string, data: DailyRoutineInput) {
  return upsertPlan(userId, data);
}

export async function updateStrategyFramework(userId: string, data: StrategyFrameworkInput) {
  return upsertPlan(userId, data);
}

export async function updateProfitTakingRules(userId: string, data: ProfitTakingInput) {
  return upsertPlan(userId, data);
}

export async function updateStopLossPlacement(userId: string, data: StopLossInput) {
  return upsertPlan(userId, data);
}

export async function updateRiskManagement(userId: string, data: RiskManagementInput) {
  return upsertPlan(userId, data);
}
