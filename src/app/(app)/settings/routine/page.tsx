import { ListChecks } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getOrCreateDefaultRoutine } from "@/server/services/routine.service";
import { getPreparationScheduleOverview } from "@/server/services/preparation.service";
import { getTraderTimezoneState } from "@/server/services/trader-time.service";
import { toPreparationSettingsDTO } from "@/server/services/preparation.mapper";
import { PreparationScheduleCard } from "@/components/settings/preparation-schedule-card";
import { FadeIn } from "@/components/shared/motion";
import { RoutineEditor, type RoutineSectionDTO } from "@/components/routine/routine-editor";

// Dedicated Settings area for the Pre-Session Routine template. Seeds a sensible
// default the first time. The trader customizes sections + items here; Today
// snapshots this template each day (P4).
export default async function RoutineSettingsPage() {
  const user = await requireUser();
  const [sections, overview, timezone] = await Promise.all([
    getOrCreateDefaultRoutine(user.id),
    getPreparationScheduleOverview(user.id),
    getTraderTimezoneState(user.id),
  ]);

  const dto: RoutineSectionDTO[] = sections.map((s) => ({
    id: s.id,
    title: s.title,
    collapsed: s.collapsed,
    items: s.items.map((i) => ({
      id: i.id,
      label: i.label,
      type: i.type,
      isMandatory: i.isMandatory,
    })),
  }));

  return (
    <FadeIn className="mx-auto max-w-3xl space-y-6 pb-16">
      <div className="flex items-start gap-3">
        <span className="bg-brand-gradient inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-glow">
          <ListChecks className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pre-Session Routine</h1>
          <p className="text-sm text-muted-foreground">
            Your pre-market ritual. Build it into sections and items — you&apos;ll run through it
            each day in Today before you trade.
          </p>
        </div>
      </div>

      <PreparationScheduleCard initial={toPreparationSettingsDTO(overview, timezone)} />

      <RoutineEditor sections={dto} />
    </FadeIn>
  );
}
