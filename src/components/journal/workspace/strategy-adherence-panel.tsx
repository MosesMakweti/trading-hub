import { ComingSoon } from "@/components/journal/workspace/workspace-ui";
import { STRATEGY_ADHERENCE_QUESTIONS } from "@/types/trades";

/**
 * Read-only in Phase 1. The row structure (one prompt per line, a control slot on
 * the right) is deliberately scoring-ready: a later phase drops a yes/no toggle and
 * an adherence score into the right column without changing this layout.
 */
export function StrategyAdherencePanel() {
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Strategy adherence</span>
        <ComingSoon label="Scoring — Phase 4" />
      </div>
      <ul className="divide-y divide-border/60">
        {STRATEGY_ADHERENCE_QUESTIONS.map((q) => (
          <li key={q} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="text-muted-foreground">{q}</span>
            <span className="text-xs text-muted-foreground/40">—</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
