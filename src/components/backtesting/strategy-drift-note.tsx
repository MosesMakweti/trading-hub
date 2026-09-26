import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StrategyDriftState } from "@/domain/backtesting/strategy-drift";

const COPY: Partial<Record<StrategyDriftState, { label: string; detail: string }>> = {
  CHANGED: {
    label: "Strategy updated since this run started",
    detail: "This run keeps the strategy exactly as it was when the run was created.",
  },
  STRATEGY_REMOVED: {
    label: "Strategy no longer in Strategy Lab",
    detail: "This run keeps its own copy of the strategy as it was when the run was created.",
  },
};

/** Informational only — the run keeps using its frozen snapshot either way. */
export function StrategyDriftNote({ drift, className }: { drift: StrategyDriftState; className?: string }) {
  const copy = COPY[drift];
  if (!copy) return null;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)} title={copy.detail}>
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        {copy.label}
        <span className="sr-only">. {copy.detail}</span>
      </span>
    </p>
  );
}
