"use client";

import { useState } from "react";
import { ArrowLeft, CircleCheck, Info, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateKeyShort } from "@/lib/date";
import { RECOMMENDATION_LABEL, REFLECTION_MAX, flowFor, type ResetFlow, type ResetOption } from "@/domain/psychology-reset";
import type { PsychologyResetSessionDTO } from "@/types/psychology-reset";

export const RESET_TITLE_ID = "psychology-reset-title";

export interface ResetFlowHandlers {
  onAnswer: (stepId: string, optionId: string, note: string | null) => void;
  onBack: () => void;
  onFinishLater: () => void;
  onComplete: () => void;
  onClose: () => void;
}

/**
 * The guided reset: one question per screen, progress, Back / Continue,
 * optional reflection, then a summary with the server's recommendation and
 * the trader's own choice. Presentational — the host persists every step.
 * Calm by design: no celebration, no red alarm styling, motion only from the
 * shared dialog (which respects reduced-motion).
 */
export function ResetFlowView({
  session,
  busy,
  error,
  handlers,
}: {
  session: PsychologyResetSessionDTO;
  busy: boolean;
  error: string | null;
  handlers: ResetFlowHandlers;
}) {
  const flow = flowFor(session.trigger, session.flowVersion);
  if (!flow) return <p className="text-sm text-muted-foreground">This reset uses a retired version of the questions.</p>;
  const total = flow.steps.length;
  const step = Math.min(session.currentStep, total);
  const contextLine = session.context
    ? `${session.trigger === "LOSING_TRADE" ? "After your" : "After a missed"} ${session.context.assetSymbol} ${session.context.direction === "LONG" ? "long" : "short"}${
        session.trigger === "MISSED_OPPORTUNITY" ? " setup" : ""
      } · ${formatDateKeyShort(session.context.dateKey)}`
    : null;

  return (
    <div className="flex max-h-[min(80vh,720px)] flex-col gap-4" data-testid="psychology-reset">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{flow.title}</p>
          <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {session.status === "COMPLETED" ? "Complete" : step < total ? `Step ${step + 1} of ${total}` : "Summary"}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Reset progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(step, total)}
          className="h-1 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary/70 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(Math.min(step, total) / total) * 100}%` }} />
        </div>
        {contextLine && step === 0 && session.status !== "COMPLETED" && (
          <p className="text-xs text-muted-foreground">
            {contextLine}. {flow.intro}
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {session.status === "COMPLETED" ? (
          <Completion session={session} flow={flow} />
        ) : step < total ? (
          <StepView key={flow.steps[step].id} flow={flow} session={session} index={step} busy={busy} handlers={handlers} />
        ) : (
          <Summary session={session} flow={flow} />
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        {session.status === "COMPLETED" ? (
          <Button type="button" className="ml-auto" onClick={handlers.onClose}>
            Close
          </Button>
        ) : (
          <>
            <div className="flex items-center gap-1">
              {step > 0 && (
                <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={handlers.onBack} disabled={busy}>
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Back
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={handlers.onFinishLater} disabled={busy}>
                Finish later
              </Button>
            </div>
            {step >= total && (
              <Button type="button" onClick={handlers.onComplete} disabled={busy} className="gap-1.5">
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Finish reset
              </Button>
            )}
            {/* Continue lives inside the step form (submit). */}
          </>
        )}
      </footer>
    </div>
  );
}

function StepView({
  flow,
  session,
  index,
  busy,
  handlers,
}: {
  flow: ResetFlow;
  session: PsychologyResetSessionDTO;
  index: number;
  busy: boolean;
  handlers: ResetFlowHandlers;
}) {
  const step = flow.steps[index];
  const saved = session.answers[step.id];
  const [optionId, setOptionId] = useState<string | null>(saved?.optionId ?? null);
  const [note, setNote] = useState(saved?.note ?? "");
  const option = step.options.find((o) => o.id === optionId) ?? null;
  const [noteOpen, setNoteOpen] = useState(Boolean(saved?.note));
  const showNote = noteOpen || Boolean(option?.reflectionPrompt);
  const formId = `reset-step-${step.id}`;

  return (
    <form
      id={formId}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (optionId) handlers.onAnswer(step.id, optionId, note.trim() ? note.trim() : null);
      }}
    >
      <h2 id={RESET_TITLE_ID} className="text-lg leading-snug font-semibold tracking-tight">
        {step.title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
        {step.message.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-foreground">{step.question}</legend>
        {step.options.map((o) => (
          <OptionRow key={o.id} name={formId} option={o} checked={o.id === optionId} onSelect={() => setOptionId(o.id)} />
        ))}
      </fieldset>
      <div aria-live="polite">
        {option?.feedback && (
          <p className="flex gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground/90" data-testid="reset-feedback">
            <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {option.feedback}
          </p>
        )}
      </div>
      {showNote ? (
        <div className="space-y-1">
          <label htmlFor={`${formId}-note`} className="text-xs text-muted-foreground">
            {option?.reflectionPrompt ?? "Reflection (optional)"}
          </label>
          <Textarea id={`${formId}-note`} value={note} maxLength={REFLECTION_MAX} rows={3} onChange={(e) => setNote(e.target.value)} className="resize-y" />
        </div>
      ) : (
        <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setNoteOpen(true)}>
          Add a note (optional)
        </button>
      )}
      {/* Sticky so Continue stays reachable on short screens while the step scrolls. */}
      <div className="sticky bottom-0 flex justify-end bg-popover/95 pt-2 pb-1 backdrop-blur-xs">
        <Button type="submit" disabled={!optionId || busy} className="gap-1.5">
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {index === flow.steps.length - 1 ? "Review summary" : "Continue"}
        </Button>
      </div>
    </form>
  );
}

function OptionRow({ name, option, checked, onSelect }: { name: string; option: ResetOption; checked: boolean; onSelect: () => void }) {
  const id = `${name}-${option.id}`;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
        checked ? "border-primary/60 bg-primary/5" : "border-border hover:bg-muted/50",
      )}
    >
      <input id={id} type="radio" name={name} value={option.id} checked={checked} onChange={onSelect} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span>{option.label}</span>
    </label>
  );
}

function AnswerList({ session, flow }: { session: PsychologyResetSessionDTO; flow: ResetFlow }) {
  return (
    <dl className="divide-y divide-border/60 rounded-lg border border-border">
      {flow.steps.map((s) => {
        const a = session.answers[s.id];
        const label = s.options.find((o) => o.id === a?.optionId)?.label ?? "—";
        return (
          <div key={s.id} className="space-y-0.5 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{s.question}</dt>
            <dd className="text-sm">{label}</dd>
            {a?.note && <dd className="text-xs text-muted-foreground italic">“{a.note}”</dd>}
          </div>
        );
      })}
    </dl>
  );
}

function Guidance({ session }: { session: PsychologyResetSessionDTO }) {
  const a = session.assessment;
  return (
    <div className="space-y-3">
      {a.limitPrecedence && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm" data-testid="reset-limit">
          <p className="font-medium">Today&apos;s limits still apply</p>
          {a.limitPrecedence.messages.map((m) => (
            <p key={m} className="text-muted-foreground">
              {m}
            </p>
          ))}
          <p className="text-muted-foreground">Nothing in this reflection changes or overrides them.</p>
        </div>
      )}
      <div className="rounded-lg border border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">Recommended next step</p>
        <p className="text-sm font-medium" data-testid="reset-recommendation">
          {RECOMMENDATION_LABEL[a.recommendation]}
        </p>
        {a.reasons.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {a.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
      {a.chosen && (
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">Your chosen next action</p>
          <p className="text-sm font-medium">{a.chosen.label}</p>
          {a.chosen.caution === 2 && <p className="text-xs text-muted-foreground">Confirmed: you are stopping for the rest of this session.</p>}
          {a.lessCautiousThanRecommended && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="reset-caution-note">
              Your answers point to a more cautious step than the one you chose. The decision is yours; consider giving it a little more time.
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        This reflection supports your decisions. It does not confirm that you are ready to trade, and it cannot make any trade certain.
      </p>
    </div>
  );
}

function Summary({ session, flow }: { session: PsychologyResetSessionDTO; flow: ResetFlow }) {
  return (
    <div className="space-y-4">
      <h2 id={RESET_TITLE_ID} className="text-lg font-semibold tracking-tight">
        Your reflection
      </h2>
      <AnswerList session={session} flow={flow} />
      <Guidance session={session} />
    </div>
  );
}

function Completion({ session, flow }: { session: PsychologyResetSessionDTO; flow: ResetFlow }) {
  return (
    <div className="space-y-4">
      <h2 id={RESET_TITLE_ID} className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <CircleCheck className="size-4.5 text-muted-foreground" aria-hidden />
        Reset complete
      </h2>
      <Guidance session={session} />
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Your answers</summary>
        <div className="mt-2">
          <AnswerList session={session} flow={flow} />
        </div>
      </details>
    </div>
  );
}
