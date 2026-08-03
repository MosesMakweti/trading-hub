import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, ListChecks, Plus } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getDailyNote } from "@/server/services/journal.service";
import { listTradesForDay } from "@/server/services/trades.service";
import { addDaysToKey, formatDateKeyLong, isValidDateKey, localDateToKey } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { DailyNoteEditor } from "@/components/journal/daily-note-editor";
import { TradeCard } from "@/components/journal/trade-card";
import { EmptyState } from "@/components/shared/empty-state";
import { FadeIn, StaggerList, StaggerItem } from "@/components/shared/motion";
import type { TradeListItemDTO } from "@/types/trades";

export default async function JournalDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date: dateKey } = await params;
  if (!isValidDateKey(dateKey)) notFound();

  const user = await requireUser();
  const [note, trades] = await Promise.all([
    getDailyNote(user.id, dateKey),
    listTradesForDay(user.id, dateKey),
  ]);

  const tradeDtos: TradeListItemDTO[] = trades.map((t) => ({
    id: t.id,
    assetSymbol: t.asset.symbol,
    executionMinutes: t.executionMinutes,
    direction: t.direction,
    higherTimeframeBias: t.higherTimeframeBias,
    biasConfidencePercent: t.biasConfidencePercent,
    expectedRR: t.expectedRR.toNumber(),
    actualRR: t.actualRR ? t.actualRR.toNumber() : null,
    hitTP1: t.hitTP1,
    hitTP2: t.hitTP2,
    hitTP3: t.hitTP3,
    hitFullTP: t.hitFullTP,
    accounts: t.allocations.map((a) => ({
      name: a.tradingAccount.name,
      riskInputType: a.riskInputType,
      riskValue: a.riskValue.toNumber(),
      closingPnlGross: a.closingPnlGross.toNumber(),
      closingPnlNet: a.closingPnlNet.toNumber(),
    })),
    entryModelNames: t.entryModels.map((m) => m.entryModel.name),
    strategyName: t.strategyNameSnapshot,
    strategyId: t.strategy && !t.strategy.deletedAt ? t.strategy.id : null,
    confluenceLabels: t.checklistSelections
      .filter((c) => c.checklistItem.type === "CONFLUENCE")
      .map((c) => c.checklistItem.label),
    executionLabels: t.checklistSelections
      .filter((c) => c.checklistItem.type === "EXECUTION_CONFIRMATION")
      .map((c) => c.checklistItem.label),
    psychology: t.psychology
      ? {
          rawScore: t.psychology.rawScore,
          percent: t.psychology.psychologyPercent,
          grade: t.psychology.grade,
        }
      : null,
  }));

  const isToday = dateKey === localDateToKey(new Date());
  const prevKey = addDaysToKey(dateKey, -1);
  const nextKey = addDaysToKey(dateKey, 1);

  return (
    <FadeIn className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous day"
            nativeButton={false}
            render={<Link href={`/journal/${prevKey}`} />}
          >
            <ChevronLeft />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {formatDateKeyLong(dateKey)}
            </h1>
            {isToday && <p className="text-xs text-primary">Today</p>}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next day"
            nativeButton={false}
            render={<Link href={`/journal/${nextKey}`} />}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/journal" />}>
          Back to calendar
        </Button>
      </div>

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Daily Notes</h2>
        <DailyNoteEditor dateKey={dateKey} initialContent={note?.content ?? null} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Trades</h2>
          <Button
            size="sm"
            className="gap-1.5"
            nativeButton={false}
            render={<Link href={`/journal/${dateKey}/trades/new`} />}
          >
            <Plus className="size-3.5" />
            Add Trade
          </Button>
        </div>
        {tradeDtos.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No trades logged yet"
            description="Log your first trade for this day — accounts, risk/PnL, checklists, and RR are all tracked per trade."
          />
        ) : (
          <StaggerList className="space-y-3">
            {tradeDtos.map((trade) => (
              <StaggerItem key={trade.id}>
                <TradeCard dateKey={dateKey} trade={trade} />
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </section>
    </FadeIn>
  );
}
