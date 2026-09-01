import { NoteBlock } from "@/components/journal/workspace/workspace-ui";
import {
  WorkspaceDecisionField,
  WorkspaceIntentField,
  WorkspaceNoteField,
} from "@/components/journal/workspace/workspace-fields";
import { StrategyAdherencePanel } from "@/components/journal/workspace/strategy-adherence-panel";
import { PsychologyReviewPanel } from "@/components/journal/workspace/psychology-review-panel";
import type { TradeWorkspaceDTO } from "@/types/trades";

// Section 3 — Trade Review: reflection after the trade. Where learning happens.
export function TradeReviewSection({ trade }: { trade: TradeWorkspaceDTO }) {
  return (
    <div className="space-y-5">
      {/* Post-trade Honest Questionnaire — answered here, after the trade. */}
      <PsychologyReviewPanel
        dateKey={trade.dateKey}
        tradeId={trade.id}
        initialAnswers={trade.psychologyAnswers}
      />

      <StrategyAdherencePanel
        dateKey={trade.dateKey}
        tradeId={trade.id}
        initialAnswers={trade.adherenceAnswers}
      />

      {/* Lessons learned (existing free-text review fields) */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground">Lessons learned</div>
        <NoteBlock label="General reflection" text={trade.postTradeReflection} />
        <NoteBlock label="Lessons learned" text={trade.lessonsLearned} />
        <NoteBlock label="What will I improve?" text={trade.whatToWorkOn} />

        {/* Additional review prompts — editable inline (Phase 2). */}
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-background/30 p-3 sm:grid-cols-2">
          <div className="text-xs font-medium text-muted-foreground sm:col-span-2">
            More review prompts
          </div>
          <WorkspaceNoteField
            dateKey={trade.dateKey}
            tradeId={trade.id}
            field="whatWentWell"
            label="What went well?"
            initialValue={trade.whatWentWell}
            rows={2}
          />
          <WorkspaceNoteField
            dateKey={trade.dateKey}
            tradeId={trade.id}
            field="whatWentWrong"
            label="What went wrong?"
            initialValue={trade.whatWentWrong}
            rows={2}
          />
          <WorkspaceNoteField
            dateKey={trade.dateKey}
            tradeId={trade.id}
            field="whatSurprisedMe"
            label="What surprised me?"
            initialValue={trade.whatSurprisedMe}
            rows={2}
          />
          <WorkspaceDecisionField
            dateKey={trade.dateKey}
            tradeId={trade.id}
            label="Would I take this trade again?"
            initialValue={trade.wouldTakeAgain}
          />
          <WorkspaceIntentField
            dateKey={trade.dateKey}
            tradeId={trade.id}
            label="Trade intent (behavioral)"
            initialValue={trade.tradeIntent}
          />
        </div>
      </div>
    </div>
  );
}
