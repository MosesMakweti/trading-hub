import { CornerDownRight } from "lucide-react";

import { formatSimDate } from "@/components/backtesting/format";
import type { CarryForwardDTO } from "@/server/services/trading-workspace.service";

/**
 * Refinement inside a Backtest Run — what the trader carried forward when
 * they closed their previous simulated day (always an EARLIER date in this
 * run, never the real next trading day and never a future simulated day).
 */
export function CarryForwardCard({ carryForward }: { carryForward: CarryForwardDTO | null }) {
  if (!carryForward) return null;
  const lines = [
    { label: "Focus", value: carryForward.carryForward },
    { label: "Main lesson", value: carryForward.mainLesson },
    { label: "To improve", value: carryForward.toImprove },
  ].filter((l) => l.value && l.value.trim() !== "");
  if (lines.length === 0) return null;

  return (
    <section aria-label="Carried forward" className="glass rounded-2xl p-4">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <CornerDownRight className="size-3.5" aria-hidden />
        Carried forward from {formatSimDate(carryForward.fromDateKey)}
      </h2>
      <dl className="mt-2 space-y-1.5 text-sm">
        {lines.map((l) => (
          <div key={l.label} className="grid gap-x-3 sm:grid-cols-[7rem_1fr]">
            <dt className="text-muted-foreground">{l.label}</dt>
            <dd className="whitespace-pre-wrap">{l.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
