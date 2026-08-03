"use client";

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpenCheck,
  ClipboardList,
  Lightbulb,
  Sunrise,
  Zap,
} from "lucide-react";

import { formatDateKeyLong } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionPlaceholder } from "@/components/shared/section-placeholder";
import { MorningPrepSection } from "@/components/today/morning-prep-section";
import {
  WorkflowProgress,
  WORKFLOW_STEP_META,
  type WorkflowStep,
} from "@/components/dashboard/workflow-progress";
import type { WorkflowStepKey, WorkflowStepStatus } from "@/domain/today/workflow";
import type { MorningPrepDTO, TradingDayDTO } from "@/types/today";

// The Today workflow sections. Placeholders in Phase 2; each section's real
// component slots into the same TabsContent when its phase lands (P3–P5).
const SECTIONS: {
  value: string;
  label: string;
  icon: LucideIcon;
  phase: string;
  description: string;
  plannedFeatures: string[];
}[] = [
  {
    value: "morning-prep",
    label: "Morning Prep",
    icon: Sunrise,
    phase: "Phase 3",
    description:
      "Get ready before the session — run your pre-session routine, note market context, and confirm you're in the right headspace.",
    plannedFeatures: [
      "Pre-session routine as a tickable checklist for today",
      "Market context & key-news notes",
      "Readiness / mindset check",
    ],
  },
  {
    value: "todays-plan",
    label: "Today's Plan",
    icon: ClipboardList,
    phase: "Phase 4",
    description: "Set your intentions for the day — bias, watchlist focus, key levels, and risk budget.",
    plannedFeatures: [
      "Higher-timeframe bias & conviction",
      "Watchlist focus drawn from your assets",
      "Key levels & risk budget from your trading plan",
    ],
  },
  {
    value: "trade-idea",
    label: "Trade Idea",
    icon: Lightbulb,
    phase: "Phase 5",
    description: "Capture the plan for each trade before you take it.",
    plannedFeatures: [
      "Reuses the existing Trade Workspace idea section",
      "Create / continue today's trades in-context",
    ],
  },
  {
    value: "trade-execution",
    label: "Trade Execution",
    icon: Zap,
    phase: "Phase 5",
    description: "Record what actually happened on each trade.",
    plannedFeatures: ["Reuses the existing execution section", "Entries / exits, PnL, and result"],
  },
  {
    value: "trade-review",
    label: "Trade Review",
    icon: BookOpenCheck,
    phase: "Phase 5",
    description: "Reflect and score adherence right after the trade.",
    plannedFeatures: ["Reuses the review + strategy-adherence sections"],
  },
  {
    value: "daily-analytics",
    label: "Daily Analytics",
    icon: BarChart3,
    phase: "Phase 5",
    description: "See how the day went — day-scoped metrics and psychology.",
    plannedFeatures: ["Day-scoped win rate, R, and PnL", "Reuses the analytics domain"],
  },
];

export function TodayWorkspace({
  day,
  stepStatuses,
  morningPrep,
}: {
  day: TradingDayDTO;
  // Only serializable data crosses the server→client boundary; the icon-bearing
  // steps are rebuilt here from WORKFLOW_STEP_META (imported client-side).
  stepStatuses: { key: WorkflowStepKey; status: WorkflowStepStatus }[];
  morningPrep: MorningPrepDTO;
}) {
  const statusByKey = new Map(stepStatuses.map((s) => [s.key, s.status]));
  const steps: WorkflowStep[] = WORKFLOW_STEP_META.map((m) => ({
    ...m,
    status: statusByKey.get(m.key) ?? "upcoming",
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDateKeyLong(day.dateKey)}</p>
        </div>
        <Badge variant={day.status === "ARCHIVED" ? "secondary" : "success"}>
          {day.status === "ARCHIVED" ? "Archived" : "Active"}
        </Badge>
      </div>

      <WorkflowProgress steps={steps} title="Workflow" />

      <Tabs defaultValue={SECTIONS[0].value}>
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            {SECTIONS.map((s) => (
              <TabsTrigger key={s.value} value={s.value} className="gap-1.5">
                <s.icon className="size-3.5" />
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {SECTIONS.map((s) => (
          <TabsContent key={s.value} value={s.value} className="mt-4">
            {s.value === "morning-prep" ? (
              <MorningPrepSection dateKey={day.dateKey} prep={morningPrep} />
            ) : (
              <SectionPlaceholder
                icon={s.icon}
                title={s.label}
                description={s.description}
                phase={s.phase}
                plannedFeatures={s.plannedFeatures}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
