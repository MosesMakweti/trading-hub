import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { applyWorkspaceScope } from "@/server/workspace/prisma-scope";
import { currentWorkspaceScope } from "@/server/workspace/scope";

const SOFT_DELETE_MODELS = new Set([
  "EntryModel",
  "RoutineSection",
  "RoutineItem",
  "TradingAccount",
  "DailyNote",
  "Trade",
  "Strategy",
  "ArsenalConcept",
  "StrategyFrameworkStep",
  "StrategyTimeframe",
  "StrategyCheckpoint",
  "StrategyEntryModel",
  "StrategyTradeManagement",
  "PartialTakeProfit",
  "TradeManagementRule",
  "TradeOpportunity",
  "DailyAssetAnalysis",
  "StrategySetupType",
  "UserPropFirm",
  "PropFirmAccount",
  "TradeAccountExecution",
  "BehaviourLabel",
]);

function withSoftDelete(client: PrismaClient) {
  return client.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async findFirst({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async count({ model, args, query }) {
          if (SOFT_DELETE_MODELS.has(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
      },
    },
  });
}

// Backtesting Environment (Stage 1) — LIVE vs BACKTEST row isolation, driven
// by the ambient workspace scope. See server/workspace/prisma-scope.ts.
function withWorkspaceScope<C extends ReturnType<typeof withSoftDelete>>(client: C) {
  return client.$extends({
    client: {
      /** The workspace scope exactly as THIS client's query hooks see it —
       *  read through the same module instance the hooks close over. Used by
       *  server/workspace/action-scope.ts as a fail-closed tripwire: if a
       *  future change ever split the scope store again (the Stage 3 bug), an
       *  action would refuse to run instead of silently writing LIVE rows. */
      $workspaceScope() {
        return currentWorkspaceScope();
      },
    },
    query: {
      $allModels: {
        async $allOperations(params) {
          return applyWorkspaceScope(params as unknown as Parameters<typeof applyWorkspaceScope>[0]);
        },
      },
    },
  });
}

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return withWorkspaceScope(withSoftDelete(new PrismaClient({ adapter })));
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

// A client cached by an earlier module evaluation (dev HMR) that predates the
// current extension shape is replaced rather than reused.
const cachedPrisma = globalForPrisma.prisma;
export const prisma = cachedPrisma && "$workspaceScope" in cachedPrisma ? cachedPrisma : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** The exact `tx` type prisma.$transaction(async (tx) => ...) infers on THIS
 *  extended client — not the plain `Prisma.TransactionClient`, which doesn't
 *  know about the soft-delete extension and is therefore a structurally
 *  different (incompatible) type. Use this whenever a `tx` param needs to be
 *  threaded across a function boundary (e.g. account-ledger.service.ts). */
export type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
