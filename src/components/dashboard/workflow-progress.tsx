import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BarChart3, BookOpenCheck, CandlestickChart, ClipboardList, Sunrise } from "lucide-react";

import { cn } from "@/lib/utils";

export type WorkflowStepStatus = "done" | "current" | "upcoming";

export interface WorkflowStep {
  key: string;
  label: string;
  icon: LucideIcon;
  status: WorkflowStepStatus;
  href?: string;
}

/** The canonical ordered workflow. Reused by the Dashboard now and the Today
 *  workspace later (Phase 2+), which will feed it real TradingDay state. */
export const WORKFLOW_STEP_META: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "prep", label: "Preparation", icon: Sunrise },
  { key: "plan", label: "Plan", icon: ClipboardList },
  { key: "trade", label: "Trade", icon: CandlestickChart },
  { key: "review", label: "Review", icon: BookOpenCheck },
  { key: "analyze", label: "Analyze", icon: BarChart3 },
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
    <li className="flex flex-1 flex-col items-center gap-1.5">
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
