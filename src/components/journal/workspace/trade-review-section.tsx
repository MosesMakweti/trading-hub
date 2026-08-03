import { Badge } from "@/components/ui/badge";
import { GRADE_VARIANT } from "@/lib/grade-variant";
import {
  ComingSoon,
  NoteBlock,
  WorkspaceField,
} from "@/components/journal/workspace/workspace-ui";
import { StrategyAdherencePanel } from "@/components/journal/workspace/strategy-adherence-panel";
import type { TradeWorkspaceDTO } from "@/types/trades";

// Section 3 — Trade Review: reflection after the trade. Where learning happens.
export function TradeReviewSection({ trade }: { trade: TradeWorkspaceDTO }) {
  return (
    <div className="space-y-5">
      {/* Psychology (existing questionnaire result) */}
      <div>
        <div className="mb-1.5 text-xs text-muted-foreground">Psychology</div>
        {trade.psychology ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3">
            <Badge variant={GRADE_VARIANT[trade.psychology.grade]}>{trade.psychology.grade}</Badge>
            <div className="text-sm">
              <span className="font-semibold">{trade.psychology.percent.toFixed(1)}%</span>
              <span className="ml-1 text-muted-foreground">discipline</span>
            </div>
            <div className="ml-auto text-xs text-muted-foreground tabular-nums">
              Raw {trade.psychology.rawScore >= 0 ? "+" : ""}
              {trade.psychology.rawScore} / 8
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/40 italic">Not scored yet.</p>
        )}
      </div>

      <StrategyAdherencePanel />

      {/* Lessons learned (existing free-text review fields) */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground">Lessons learned</div>
        <NoteBlock label="General reflection" text={trade.postTradeReflection} />
        <NoteBlock label="Lessons learned" text={trade.lessonsLearned} />
        <NoteBlock label="What will I improve?" text={trade.whatToWorkOn} />

        {/* Additional review prompts arrive with new fields in a later phase. */}
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-dashed border-border p-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">More review prompts</span>
            <ComingSoon label="Phase 2+" />
          </div>
          <WorkspaceField label="What went well?" placeholder="—" />
          <WorkspaceField label="What went wrong?" placeholder="—" />
          <WorkspaceField label="What surprised me?" placeholder="—" />
          <WorkspaceField label="Would I take this trade again?" placeholder="—" />
        </div>
      </div>
    </div>
  );
}
