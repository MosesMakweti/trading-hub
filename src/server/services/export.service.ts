import { prisma } from "@/server/db";
import { utcDateToKey } from "@/lib/date";
import type { TradeExportRecord } from "@/domain/export/trade-export";

export async function listTradeExportRecords(
  userId: string,
): Promise<{ record: TradeExportRecord; psychologyGrade: string | null }[]> {
  const trades = await prisma.trade.findMany({
    where: { userId },
    include: {
      allocations: { include: { tradingAccount: true } },
      entryModels: { include: { entryModel: true } },
      psychology: true,
    },
    orderBy: [{ tradeDate: "asc" }, { executionMinutes: "asc" }],
  });

  return trades.map((t) => {
    const performanceAllocation = t.allocations.find(
      (a) => a.tradingAccount.kind === "PERFORMANCE",
    );
    const otherAllocations = t.allocations.filter(
      (a) => a.tradingAccount.kind !== "PERFORMANCE",
    );

    const record: TradeExportRecord = {
      dateKey: utcDateToKey(t.tradeDate),
      assetSymbol: t.assetSymbol,
      executionMinutes: t.executionMinutes,
      direction: t.direction,
      higherTimeframeBias: t.higherTimeframeBias,
      biasConfidencePercent: t.biasConfidencePercent,
      expectedRR: t.expectedRR.toNumber(),
      actualRR: t.actualRR ? t.actualRR.toNumber() : null,
      performanceClosingPnlGross: performanceAllocation
        ? performanceAllocation.closingPnlGross.toNumber()
        : 0,
      performanceClosingPnlNet: performanceAllocation
        ? performanceAllocation.closingPnlNet.toNumber()
        : 0,
      hitTP1: t.hitTP1,
      hitTP2: t.hitTP2,
      hitTP3: t.hitTP3,
      hitFullTP: t.hitFullTP,
      psychPreTradeMindset: t.psychPreTradeMindset,
      psychPostTradeReflection: t.psychPostTradeReflection,
      psychLessonsLearned: t.psychLessonsLearned,
      psychWhatToWorkOn: t.psychWhatToWorkOn,
      psychologyAnswers: (t.psychology?.answers as Record<string, string | number>) ?? {},
      sessionName: t.selectedSession ?? null,
      allocations: otherAllocations.map((a) => ({
        accountName: a.tradingAccount.name,
        riskInputType: a.riskInputType,
        riskValue: a.riskValue.toNumber(),
      })),
      // SOT: the by-name selections frozen on the trade (pre-SOT trades backfilled in P9).
      confluenceLabels: (t.selectedConfluences as string[] | null) ?? [],
      executionLabels: (t.selectedExecution as string[] | null) ?? [],
      entryModelNames: t.entryModels.map((m) => m.entryModel.name),
    };

    return { record, psychologyGrade: t.psychology?.grade ?? null };
  });
}
