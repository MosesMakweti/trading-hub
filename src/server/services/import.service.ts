import { prisma } from "@/server/db";
import { utcDateToKey } from "@/lib/date";
import { tradeNaturalKey } from "@/domain/export/trade-export";
import { createTrade } from "@/server/services/trades.service";
import type { TradeImportRecord } from "@/lib/validation/trade-import";
import type { TradeInput } from "@/lib/validation/trades";

export interface ImportRowResult {
  index: number;
  status: "imported" | "skipped" | "error";
  message: string;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  errored: number;
  rows: ImportRowResult[];
}

/** Resolves/creates a simple by-name reference row (Asset/EntryModel/ChecklistItem), memoized within one import run. */
function makeResolver<T extends { id: string }>(
  find: (name: string) => Promise<T | null>,
  create: (name: string) => Promise<T>,
) {
  const cache = new Map<string, Promise<T>>();
  return (name: string): Promise<T> => {
    const key = name.trim().toUpperCase();
    let promise = cache.get(key);
    if (!promise) {
      promise = find(name).then((existing) => existing ?? create(name));
      cache.set(key, promise);
    }
    return promise;
  };
}

/**
 * Reuses `createTrade` (the exact same path the trade form goes through) for
 * every row, rather than re-implementing risk-scaling/psychology-scoring
 * here — that logic is already tested and shouldn't have a second,
 * potentially-diverging copy.
 */
export async function importTrades(
  userId: string,
  records: TradeImportRecord[],
): Promise<ImportSummary> {
  const existingTrades = await prisma.trade.findMany({
    where: { userId },
    select: { tradeDate: true, executionMinutes: true, asset: { select: { symbol: true } } },
  });
  const existingKeys = new Set(
    existingTrades.map((t) =>
      tradeNaturalKey({
        dateKey: utcDateToKey(t.tradeDate),
        assetSymbol: t.asset.symbol,
        executionMinutes: t.executionMinutes,
      }),
    ),
  );

  const [accounts, sessions] = await Promise.all([
    prisma.tradingAccount.findMany({ where: { userId } }),
    prisma.tradingSession.findMany({ where: { userId } }),
  ]);
  const accountByName = new Map(accounts.map((a) => [a.name.trim().toUpperCase(), a]));
  const sessionByName = new Map(sessions.map((s) => [s.name.trim().toUpperCase(), s]));

  const resolveAsset = makeResolver(
    (symbol) => prisma.asset.findFirst({ where: { userId, symbol } }),
    async (symbol) => {
      const last = await prisma.asset.findFirst({ where: { userId }, orderBy: { sortOrder: "desc" } });
      return prisma.asset.create({ data: { userId, symbol, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    },
  );
  const resolveEntryModel = makeResolver(
    (name) => prisma.entryModel.findFirst({ where: { userId, name } }),
    async (name) => {
      const last = await prisma.entryModel.findFirst({ where: { userId }, orderBy: { sortOrder: "desc" } });
      return prisma.entryModel.create({ data: { userId, name, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    },
  );
  // SOT: confluences / execution confirmations are now stored on the trade by
  // name (frozen from the strategy), so imports pass the CSV labels straight
  // through instead of resolving them into the (legacy) global checklist tables.

  const rows: ImportRowResult[] = [];

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const key = tradeNaturalKey(record);

    if (existingKeys.has(key)) {
      rows.push({ index, status: "skipped", message: "Already imported (matching date/asset/time)." });
      continue;
    }

    try {
      const [asset, entryModels] = await Promise.all([
        resolveAsset(record.assetSymbol),
        Promise.all(record.entryModelNames.map(resolveEntryModel)),
      ]);

      const session = record.sessionName
        ? sessionByName.get(record.sessionName.trim().toUpperCase())
        : undefined;

      const knownAllocations = record.allocations.filter((a) =>
        accountByName.has(a.accountName.trim().toUpperCase()),
      );
      const missingAccounts = record.allocations.filter(
        (a) => !accountByName.has(a.accountName.trim().toUpperCase()),
      );

      const tradeInput: TradeInput = {
        assetId: asset.id,
        executionMinutes: record.executionMinutes,
        direction: record.direction,
        higherTimeframeBias: record.higherTimeframeBias,
        biasConfidencePercent: record.biasConfidencePercent,
        sessionId: session?.id ?? null,
        strategyId: null,
        expectedRR: record.expectedRR,
        actualRR: record.actualRR,
        performanceClosingPnlGross: record.performanceClosingPnlGross,
        performanceClosingPnlNet: record.performanceClosingPnlNet,
        hitTP1: record.hitTP1,
        hitTP2: record.hitTP2,
        hitTP3: record.hitTP3,
        hitFullTP: record.hitFullTP,
        psychPreTradeMindset: record.psychPreTradeMindset,
        psychPostTradeReflection: record.psychPostTradeReflection,
        psychLessonsLearned: record.psychLessonsLearned,
        psychWhatToWorkOn: record.psychWhatToWorkOn,
        allocations: knownAllocations.map((a) => ({
          tradingAccountId: accountByName.get(a.accountName.trim().toUpperCase())!.id,
          riskInputType: a.riskInputType,
          riskValue: a.riskValue,
        })),
        selectedConfluences: record.confluenceLabels,
        selectedExecution: record.executionLabels,
        entryModelIds: entryModels.map((m) => m.id),
        psychologyAnswers: record.psychologyAnswers,
      };

      await createTrade(userId, record.dateKey, tradeInput);

      existingKeys.add(key);
      rows.push({
        index,
        status: "imported",
        message:
          missingAccounts.length > 0
            ? `Imported. Skipped unknown account(s): ${missingAccounts.map((a) => a.accountName).join(", ")}.`
            : "Imported.",
      });
    } catch (error) {
      rows.push({
        index,
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return {
    imported: rows.filter((r) => r.status === "imported").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    errored: rows.filter((r) => r.status === "error").length,
    rows,
  };
}
