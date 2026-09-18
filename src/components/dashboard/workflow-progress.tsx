import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BarChart3, BookOpenCheck, ClipboardCheck, Lightbulb, ListChecks, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import type { WorkflowStepKey } from "@/domain/today/workflow";

export type WorkflowStepStatus = "done" | "current" | "upcoming";

export interface WorkflowStep {
  key: string;
  label: string;
  icon: LucideIcon;
  status: WorkflowStepStatus;
  href?: string;
}

/** The canonical ordered workflow — the Today V2 mental model (Today V2
 *  Final Phase §5): Pre-Session -> Today's Plan -> Trade Idea -> Execution
 *  -> Review -> Day Summary. Reused by the Dashboard and the Today
 *  workspace, both fed the same booleans derived from TradingDay/trade
 *  state (domain/today/workflow.ts) — never a second, independently
 *  tracked status. */
export const WORKFLOW_STEP_META: { key: WorkflowStepKey; label: string; icon: LucideIcon }[] = [
  { key: "preSession", label: "Pre-Session", icon: ListChecks },
  { key: "todaysPlan", label: "Today's Plan", icon: BarChart3 },
  { key: "tradeIdea", label: "Trade Idea", icon: Lightbulb },
  { key: "execution", label: "Execution", icon: Zap },
  { key: "review", label: "Review", icon: BookOpenCheck },
  { key: "daySummary", label: "Day Summary", icon: ClipboardCheck },
];

function StepNode({ step, isLast }: { step: WorkflowStep; isLast: boolean }) {
  const Icon = step.icon;
  const node = (
    <span
      className={cn(
        "grid size-9 place-items-center rounded-full transition-colors",
        step.status === "done" && "bg-brand-gradient text-white shadow-glow",
        step.status === "current" && "border-2 border-primary text-primary",
        step.status === "upcoming" && "border border-dashed border-border bg-background/40 text-muted-foreground",
      )}
    >
      <Icon className="size-4" />
    </span>
  );

  return (
    <li
      className="flex flex-1 flex-col items-center gap-1.5"
      aria-current={step.status === "current" ? "step" : undefined}
    >
      <div className="flex w-full items-center">
        <span className="h-px flex-1 bg-transparent" />
        {step.href ? (
          <Link href={step.href} aria-label={step.label} className="rounded-full">
            {node}
          </Link>
        ) : (
          node
        )}
        <span
          className={cn(
            "h-px flex-1",
            isLast ? "bg-transparent" : step.status === "done" ? "bg-primary/40" : "bg-border",
          )}
        />
      </div>
      <span
        className={cn(
          "text-center text-xs",
          step.status === "upcoming" ? "text-muted-foreground" : "font-medium",
        )}
      >
        {step.label}
      </span>
    </li>
  );
}

/**
 * Horizontal workflow stepper — the OS spine of a trading day
 * (Preparation → Plan → Trade → Review → Analyze). Presentational: the caller
 * supplies each step's status/href. On the Dashboard the state is best-effort
 * derived from today's data; the Today workspace (Phase 2) will drive it from the
 * TradingDay record.
 */
export function WorkflowProgress({
  steps,
  title = "Today's workflow",
  caption,
}: {
  steps: WorkflowStep[];
  title?: string;
  caption?: string;
}) {
  return (
    <section className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
      </div>
      <ol className="flex items-start gap-1 overflow-x-auto">
        {steps.map((step, i) => (
          <StepNode key={step.key} step={step} isLast={i === steps.length - 1} />
        ))}
      </ol>
    </section>
  );
}
