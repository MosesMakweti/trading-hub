import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, ListChecks, Plus } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getDailyNote, getJournalDayRecap } from "@/server/services/journal.service";
import { listTradesForDay } from "@/server/services/trades.service";
import { addDaysToKey, formatDateKeyLong, isValidDateKey, localDateToKey } from "@/lib/date";
import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DailyNoteEditor } from "@/components/journal/daily-note-editor";
import { JournalDayRecap } from "@/components/journal/journal-day-recap";
import { ReadOnlyDayBanner } from "@/components/journal/read-only-day-banner";
import { TradeCard } from "@/components/journal/trade-card";
import { WORKFLOW_STEP_META, type WorkflowStep } from "@/components/dashboard/workflow-progress";
import { EmptyState } from "@/components/shared/empty-state";
import { FadeIn, StaggerList, StaggerItem } from "@/components/shared/motion";
import { executionSnapshot, resolveSelectedTags } from "@/server/services/selected-tags";
import type { TradeListItemDTO } from "@/types/trades";

export default async function JournalDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date: dateKey } = await params;
  if (!isValidDateKey(dateKey)) notFound();

  const user = await requireUser();
  const [note, trades, recap] = await Promise.all([
    getDailyNote(user.id, dateKey),
    listTradesForDay(user.id, dateKey),
    getJournalDayRecap(user.id, dateKey),
  ]);

  // Workflow recap (only for days that were opened in the Today workspace).
  let recapSteps: WorkflowStep[] = [];
  if (recap) {
    const done: WorkflowDoneState = {
      prep: recap.prepDone,
      plan: recap.planDone,
      trade: trades.length > 0,
      review: trades.some((t) => t.reviewedAt != null),
      analyze: recap.analyzeDone,
    };
    const byKey = new Map(deriveWorkflowSteps(done).map((s) => [s.key, s.status]));
    recapSteps = WORKFLOW_STEP_META.map((m) => ({ ...m, status: byKey.get(m.key) ?? "upcoming" }));
  }

  const tradeDtos: TradeListItemDTO[] = trades.map((t) => ({
    id: t.id,
    assetSymbol: t.assetSymbol ?? t.asset.symbol,
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
    confluenceLabels: resolveSelectedTags(
      t.selectedConfluences,
      executionSnapshot(t.strategyExecutionSnapshot).confluences,
      t.checklistSelections
        .filter((c) => c.checklistItem.type === "CONFLUENCE")
        .map((c) => c.checklistItem.label),
    ),
    executionLabels: resolveSelectedTags(
      t.selectedExecution,
      executionSnapshot(t.strategyExecutionSnapshot).execution,
      t.checklistSelections
        .filter((c) => c.checklistItem.type === "EXECUTION_CONFIRMATION")
        .map((c) => c.checklistItem.label),
    ),
    tradeQualityPercent: t.tradeQualityPercent,
    setupScore: t.setupScore,
    setupRating: t.setupRating as TradeListItemDTO["setupRating"],
    setupValid: t.setupValid,
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
  // Archived days are read-only until reopened (null recap = never opened = editable).
  const editable = recap?.status !== "ARCHIVED";

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
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {formatDateKeyLong(dateKey)}
              </h1>
              {recap && (
                <Badge variant={recap.status === "ARCHIVED" ? "secondary" : "success"}>
                  {recap.status === "ARCHIVED" ? "Archived" : "Active"}
                </Badge>
              )}
            </div>
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

      {!editable && <ReadOnlyDayBanner dateKey={dateKey} />}

      {recap && <JournalDayRecap recap={recap} steps={recapSteps} />}

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Daily Notes</h2>
        <DailyNoteEditor
          dateKey={dateKey}
          initialContent={note?.content ?? null}
          editable={editable}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Trades</h2>
          {editable && (
            <Button
              size="sm"
              className="gap-1.5"
              nativeButton={false}
              render={<Link href={`/journal/${dateKey}/trades/new`} />}
            >
              <Plus className="size-3.5" />
              Add Trade
            </Button>
          )}
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
