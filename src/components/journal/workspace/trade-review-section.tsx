import { NoteBlock } from "@/components/journal/workspace/workspace-ui";
import {
  WorkspaceDecisionField,
  WorkspaceIntentField,
  WorkspaceNoteField,
} from "@/components/journal/workspace/workspace-fields";
import { StrategyAdherencePanel } from "@/components/journal/workspace/strategy-adherence-panel";
import { PsychologyReviewPanel } from "@/components/journal/workspace/psychology-review-panel";
import { TradeImageBucket } from "@/components/journal/workspace/trade-image-bucket";
import { TradeLifecycleStatus } from "@/components/journal/workspace/trade-lifecycle-status";
import { TradeReviewComparisonPanel } from "@/components/journal/workspace/trade-review-comparison";
import { BehaviourLabelPicker } from "@/components/journal/workspace/behaviour-label-picker";
import type { TradeWorkspaceDTO } from "@/types/trades";

// Section 3 — Trade Review: reflection after the trade. Where learning happens.
// Stage 7 overhaul: answers "what happened / how did I manage it vs plan /
// what did I do well or poorly / what should Traditorium learn" in that order.
export function TradeReviewSection({ trade }: { trade: TradeWorkspaceDTO }) {
  return (
    <div className="space-y-5">
      {/* §1 — What's the current state of this trade? Asked first, on purpose. */}
      <TradeLifecycleStatus
        dateKey={trade.dateKey}
        tradeId={trade.id}
        initialStatus={trade.reviewLifecycleStatus}
        initialCancellationReason={trade.cancellationReason}
      />

      {/* §5/§13 — What actually happened, vs the plan and the Setup Validation
          Shield's frozen historical evidence. Skipped for a cancelled/never-
          triggered idea — there's no real execution to compare against. */}
      {trade.reviewLifecycleStatus !== "CANCELLED_NEVER_TRIGGERED" && (
        <TradeReviewComparisonPanel tradeId={trade.id} assetSymbol={trade.assetSymbol} />
      )}

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

      {/* §8/§9 — Behaviour Labels: fast, multi-select, pattern-recognition-ready. */}
      <div className="rounded-xl border border-border bg-background/30 p-3">
        <BehaviourLabelPicker dateKey={trade.dateKey} tradeId={trade.id} />
      </div>

      {/* Lessons learned (existing free-text review fields) */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground">Lessons learned</div>
        <NoteBlock label="General reflection" text={trade.postTradeReflection} />
        <NoteBlock label="Lessons learned" text={trade.lessonsLearned} />
        <NoteBlock label="What will I improve?" text={trade.whatToWorkOn} />

        {/* §7 — the three focused reflection prompts, plus the pre-existing
            decision/intent fields (Phase 2). */}
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-background/30 p-3 sm:grid-cols-2">
          <div className="text-xs font-medium text-muted-foreground sm:col-span-2">
            More review prompts
          </div>
          <WorkspaceNoteField
            dateKey={trade.dateKey}
            tradeId={trade.id}
            field="whatWentWell"
            label="What did I do right?"
            initialValue={trade.whatWentWell}
            rows={2}
          />
          <WorkspaceNoteField
            dateKey={trade.dateKey}
            tradeId={trade.id}
            field="whatWentWrong"
            label="What did I do wrong?"
            initialValue={trade.whatWentWrong}
            rows={2}
          />
          <WorkspaceNoteField
            dateKey={trade.dateKey}
            tradeId={trade.id}
            field="whatCouldImprove"
            label="What could I have done better?"
            initialValue={trade.whatCouldImprove}
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

      {/* §6 — After-Trade images: what actually happened, once it played out. */}
      <div className="space-y-2 rounded-xl border border-border bg-background/30 p-3">
        <TradeImageBucket tradeId={trade.id} category="AFTER" label="After-Trade Images" requireTimeframe />
      </div>
    </div>
  );
}
