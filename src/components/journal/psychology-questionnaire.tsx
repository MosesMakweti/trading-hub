"use client";

import type { ReactNode } from "react";
import { Controller, type Control } from "react-hook-form";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PSYCHOLOGY_QUESTIONS } from "@/domain/psychology/questions";
import { scorePsychology, type PsychologyGrade } from "@/domain/psychology/scoring";
import type { TradeFormValues } from "@/lib/validation/trades";

const GRADE_VARIANT: Record<PsychologyGrade, "success" | "warning" | "danger"> = {
  A: "success",
  B: "success",
  C: "warning",
  D: "warning",
  F: "danger",
};

export function PsychologyQuestionnaire({ control }: { control: Control<TradeFormValues> }) {
  return (
    <Controller
      control={control}
      name="psychologyAnswers"
      render={({ field }) => {
        const answers = (field.value ?? {}) as Record<string, string | number>;

        function setAnswer(key: string, value: string | number) {
          field.onChange({ ...answers, [key]: value });
        }

        const allAnswered = PSYCHOLOGY_QUESTIONS.every((q) => answers[q.key] !== undefined);
        let scoreDisplay: ReactNode = (
          <span className="text-xs text-muted-foreground">
            Answer all questions to see your score.
          </span>
        );
        if (allAnswered) {
          try {
            const result = scorePsychology(
              Object.entries(answers).map(([key, value]) => ({ key, value })),
            );
            scoreDisplay = (
              <div className="flex items-center gap-2">
                <Badge variant={GRADE_VARIANT[result.grade]}>{result.grade}</Badge>
                <span className="text-sm font-medium">{result.percent.toFixed(1)}%</span>
                <span className="text-xs text-muted-foreground">
                  ({result.rawScore >= 0 ? "+" : ""}
                  {result.rawScore} / 8)
                </span>
              </div>
            );
          } catch {
            // Answers present but not yet all valid — keep the fallback message.
          }
        }

        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Mandatory — answer honestly, it only helps you.
              </p>
              {scoreDisplay}
            </div>
            <div className="space-y-3">
              {PSYCHOLOGY_QUESTIONS.map((q) => (
                <div key={q.key} className="space-y-1.5">
                  <p className="text-sm">{q.prompt}</p>
                  {q.type === "choice" ? (
                    <div className="flex flex-wrap gap-2">
                      {q.options.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setAnswer(q.key, opt.value)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs transition-colors",
                            answers[q.key] === opt.value
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Input
                      type="number"
                      min={q.min}
                      max={q.max}
                      className="w-28"
                      value={(answers[q.key] as number) ?? ""}
                      onChange={(e) => setAnswer(q.key, e.target.valueAsNumber)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      }}
    />
  );
}
