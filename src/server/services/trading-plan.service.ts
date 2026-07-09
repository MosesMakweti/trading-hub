import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import type {
  DailyRoutineInput,
  ProfitTakingInput,
  RiskManagementInput,
  StopLossInput,
  StrategyFrameworkInput,
} from "@/lib/validation/trading-plan";

export async function getTradingPlan(userId: string) {
  // upsert (not find-then-create) because a brand-new user's first page load
  // often fires multiple concurrent requests that all need this row to exist.
  // Even upsert can lose a race under concurrent writers (Prisma doesn't
  // always compile it to a single atomic INSERT ... ON CONFLICT), so on a
  // unique-constraint conflict the row now exists — just re-fetch it.
  try {
    return await prisma.tradingPlan.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.tradingPlan.findUniqueOrThrow({ where: { userId } });
    }
    throw error;
  }
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
