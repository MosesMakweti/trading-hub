import { requireUser } from "@/server/guards";
import { getOrCreateTradingDay, toTradingDayDTO } from "@/server/services/trading-day.service";
import { listTradesForDay } from "@/server/services/trades.service";
import { listChecklistItems } from "@/server/services/checklist-items.service";
import { localDateToKey } from "@/lib/date";
import { deriveWorkflowSteps, type WorkflowDoneState } from "@/domain/today/workflow";
import { FadeIn } from "@/components/shared/motion";
import { TodayWorkspace } from "@/components/today/today-workspace";
import type { MorningPrepDTO } from "@/types/today";

export default async function TodayPage() {
  const user = await requireUser();
  const todayKey = localDateToKey(new Date());

  const [day, trades, routineItems] = await Promise.all([
    getOrCreateTradingDay(user.id, todayKey),
    listTradesForDay(user.id, todayKey),
    listChecklistItems(user.id, "PRE_SESSION_ROUTINE"),
  ]);

  const morningPrep: MorningPrepDTO = {
    routineItems: routineItems.map((i) => ({ id: i.id, label: i.label })),
    completedIds: (day.routineCompletion as string[] | null) ?? [],
    marketContext: day.marketContext,
    readiness: day.readiness,
    prepComplete: day.prepCompletedAt != null,
  };

  // Prep/Plan/Analyze are owned by the TradingDay; Trade/Review are derived from
  // the day's trades. Feed both into the shared workflow state machine.
  const done: WorkflowDoneState = {
    prep: day.prepCompletedAt != null,
    plan: day.planCompletedAt != null,
    trade: trades.length > 0,
    review: trades.some((t) => t.reviewedAt != null),
    analyze: day.analyzedAt != null,
  };
  const stepStatuses = deriveWorkflowSteps(done);

  return (
    <FadeIn className="mx-auto max-w-5xl">
      <TodayWorkspace
        day={toTradingDayDTO(day)}
        stepStatuses={stepStatuses}
        morningPrep={morningPrep}
      />
    </FadeIn>
  );
}
