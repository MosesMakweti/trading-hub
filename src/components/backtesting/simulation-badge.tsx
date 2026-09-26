import { History } from "lucide-react";

import { cn } from "@/lib/utils";

/** The persistent "you are in simulation" marker for every Backtesting surface.
 *  Deliberately calm (outline + mono caps), never a warning color. */
export function SimulationBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-foreground/20 bg-foreground/[0.04] px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.18em] text-foreground/80 uppercase",
        className,
      )}
    >
      <History className="size-3" aria-hidden />
      Backtest
    </span>
  );
}
