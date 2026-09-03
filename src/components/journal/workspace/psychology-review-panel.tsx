"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GRADE_VARIANT } from "@/lib/grade-variant";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { updateTradeSection } from "@/actions/trades.actions";
import { PSYCHOLOGY_QUESTIONS } from "@/domain/psychology/questions";
import { scorePsychology } from "@/domain/psychology/scoring";
import type { SaveState } from "@/hooks/use-debounced-autosave";

type Answers = Record<string, string | number>;

/**
 * Post-trade Honest Questionnaire — filled here, in the Trade Review tab,
 * AFTER the trade played out (it's no longer part of logging the idea). Each
 * change autosaves the whole answer map via the section-patch action; the
 * server only persists a scored PsychologyQuestionnaireResponse once all 8 are
 * answered, so a partial pass is safe to leave and come back to.
 */
export function PsychologyReviewPanel({
  dateKey,
  tradeId,
  initialAnswers,
}: {
  dateKey: string;
  tradeId: string;
  initialAnswers: Answers;
}) {
  const editable = useWorkspaceEditable();
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const answeredCount = PSYCHOLOGY_QUESTIONS.filter((q) => answers[q.key] !== undefined).length;
  const complete = answeredCount === PSYCHOLOGY_QUESTIONS.length;

  let score: { grade: "A" | "B" | "C" | "D" | "F"; percent: number } | null = null;
  if (complete) {
    try {
      const r = scorePsychology(Object.entries(answers).map(([key, value]) => ({ key, value })));
      score = { grade: r.grade, percent: r.percent };
    } catch {
      score = null;
    }
  }

  async function commit(next: Answers) {
    setAnswers(next);
    setSaveState("saving");
    const result = await updateTradeSection(dateKey, tradeId, { psychologyAnswers: next });
    if (result.success) setSaveState("saved");
    else {
      setSaveState("error");
      toast.error(result.error);
    }
  }

  function setChoice(key: string, value: string) {
    const next = { ...answers };
    if (next[key] === value) delete next[key]; // click again = clear
    else next[key] = value;
    void commit(next);
  }

  function setScale(key: string, raw: string) {
    const next = { ...answers };
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n)) delete next[key];
    else next[key] = n;
    void commit(next);
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Post-trade Honest Questionnaire</span>
        <div className="flex items-center gap-2">
          {saveState === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {saveState === "saved" && <Check className="size-3.5 text-success" />}
          {score ? (
            <span className="flex items-center gap-2 text-xs">
              <Badge variant={GRADE_VARIANT[score.grade]}>{score.grade}</Badge>
              <span className="font-semibold tabular-nums">{score.percent.toFixed(1)}%</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground tabular-nums">
              {answeredCount}/{PSYCHOLOGY_QUESTIONS.length} answered
            </span>
          )}
        </div>
      </div>

      <ul className="divide-y divide-border/60">
        {PSYCHOLOGY_QUESTIONS.map((q) => {
          const current = answers[q.key];
          return (
            <li key={q.key} className="space-y-1.5 py-2.5">
              <span className={cn("block text-sm", current === undefined && "text-muted-foreground")}>
                {q.prompt}
              </span>
              {q.type === "choice" ? (
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((o) => (
                    <Button
                      key={o.value}
                      type="button"
                      size="xs"
                      variant={
                        current === o.value ? (o.points >= 1 ? "default" : "destructive") : "outline"
                      }
                      aria-pressed={current === o.value}
                      onClick={() => setChoice(q.key, o.value)}
                      disabled={!editable}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
              ) : (
                <Input
                  type="number"
                  min={q.min}
                  max={q.max}
                  value={current ?? ""}
                  onChange={(e) => setScale(q.key, e.target.value)}
                  disabled={!editable}
                  className="h-8 w-24 tabular-nums"
                  placeholder={`${q.min}–${q.max}`}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
