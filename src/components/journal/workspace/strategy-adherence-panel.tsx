"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { updateTradeSection } from "@/actions/trades.actions";
import { ADHERENCE_QUESTIONS, scoreAdherence } from "@/domain/trades/adherence";
import type { SaveState } from "@/hooks/use-debounced-autosave";

/**
 * Strategy-adherence self-score (Phase 5). One Yes/No per question; clicking the
 * selected answer again clears it (unanswered). Each change persists the whole
 * answer map via the section-patch action, which rescores server-side. The
 * percent shown here is computed with the same pure scorer for instant feedback.
 */
export function StrategyAdherencePanel({
  dateKey,
  tradeId,
  initialAnswers,
}: {
  dateKey: string;
  tradeId: string;
  initialAnswers: Record<string, boolean>;
}) {
  const editable = useWorkspaceEditable();
  const [answers, setAnswers] = useState<Record<string, boolean>>(initialAnswers);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const score = scoreAdherence(answers);

  async function set(key: string, value: boolean) {
    const next = { ...answers };
    if (next[key] === value) delete next[key]; // toggle off -> unanswered
    else next[key] = value;

    setAnswers(next);
    setSaveState("saving");
    const result = await updateTradeSection(dateKey, tradeId, { adherenceAnswers: next });
    if (result.success) setSaveState("saved");
    else {
      setSaveState("error");
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Strategy adherence</span>
        <div className="flex items-center gap-2">
          {saveState === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {saveState === "saved" && <Check className="size-3.5 text-success" />}
          <span className="text-xs text-muted-foreground tabular-nums">
            {score.percent == null ? (
              <span className="text-muted-foreground/50 italic">Not scored</span>
            ) : (
              <>
                <span className="font-semibold text-foreground">{score.percent}%</span> ·{" "}
                {score.answeredCount}/{score.total} answered
              </>
            )}
          </span>
        </div>
      </div>
      <ul className="divide-y divide-border/60">
        {ADHERENCE_QUESTIONS.map((q) => {
          const answer = answers[q.key];
          return (
            <li key={q.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className={cn(answer === undefined && "text-muted-foreground")}>{q.prompt}</span>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant={answer === true ? "default" : "outline"}
                  aria-pressed={answer === true}
                  onClick={() => set(q.key, true)}
                  disabled={!editable}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={answer === false ? "destructive" : "outline"}
                  aria-pressed={answer === false}
                  onClick={() => set(q.key, false)}
                  disabled={!editable}
                >
                  No
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
