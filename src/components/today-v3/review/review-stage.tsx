"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedAutosave, type SaveState } from "@/hooks/use-debounced-autosave";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { BehaviourLabelPicker } from "@/components/journal/workspace/behaviour-label-picker";
import { TradeImageBucket } from "@/components/journal/workspace/trade-image-bucket";
import {
  completeReviewAction,
  loadV3ReviewAction,
  saveReviewPsychologyAction,
  setReviewIntentAction,
  updateReviewFieldsAction,
} from "@/actions/trade-review-v3.actions";
import { loadTradeBehaviourLabelsAction, setTradeBehaviourLabelsAction } from "@/actions/behaviour-labels.actions";
import { setReviewLifecycleStatusAction } from "@/actions/trade-review.actions";
import { ADHERENCE_QUESTIONS } from "@/domain/trades/adherence";
import { PSYCHOLOGY_QUESTIONS, type ChoiceQuestion } from "@/domain/psychology/questions";
import { HUMAN_KEYS } from "@/domain/psychology/review-adapter";
import { REVIEW_STATE_LABEL, type ReviewState } from "@/domain/trades/review-state";
import type { V3ReviewDTO } from "@/server/services/trade-review-v3.service";
import type { EvidenceResult } from "@/domain/trades/review-evidence";
import type { ComparisonTone } from "@/domain/trades/review-summary";

type Answers = Record<string, string | number>;
type Intent = NonNullable<V3ReviewDTO["tradeIntent"]>;

const INTENTS: { value: Intent; label: string }[] = [
  { value: "PLANNED", label: "Planned" },
  { value: "FOMO", label: "FOMO" },
  { value: "REVENGE", label: "Revenge" },
  { value: "BOREDOM", label: "Boredom" },
  { value: "IMPULSE", label: "Impulsive" },
  { value: "MANUAL_OVERRIDE", label: "Manual override" },
];

// V3 wording; storage keys and options are the canonical questionnaire's.
const PROMPT: Record<string, string> = {
  riskManaged: "Managed risk according to plan?",
  followedExitPlan: "Followed the planned exit?",
  alignedWithBias: "Was this trade aligned with the higher-timeframe trend or bias?",
  influencedBySomeoneElseProfit: "Influenced by seeing someone else profit?",
  influencedByOnlineOpinion: "Influenced by someone's opinion online?",
  outcomeWillInfluenceNext: "Will this outcome affect your next trade?",
  monitoringObsession: "How intensely did you monitor it? (1–100)",
};

const STATE_TONE: Record<ReviewState, string> = {
  NOT_AVAILABLE: "border-border text-muted-foreground",
  CANCELLED: "border-border text-muted-foreground",
  INTERIM_AVAILABLE: "border-warning/50 text-warning",
  INTERIM_REVIEWED: "border-primary/40 text-primary",
  FINAL_REVIEW_REQUIRED: "border-danger/50 text-danger",
  FINAL_REVIEW_COMPLETE: "border-success/50 text-success",
};

const ROW_TONE: Record<ComparisonTone, string> = {
  match: "text-success",
  differs: "text-foreground",
  neutral: "text-foreground",
  missing: "text-muted-foreground",
};

/**
 * Today V3 (Phase 3) — the Review stage: RESULT → PLAN VS ACTUAL → PROCESS →
 * MOTIVE → PSYCHOLOGY → BEHAVIOUR → REFLECTION → AFTER IMAGES → Complete.
 * Derived facts come from trade-review-v3.service (read-only here); each
 * concept is asked once and stored in its existing canonical column.
 */
export function ReviewStage({ tradeId, dateKey }: { tradeId: string; dateKey: string }) {
  const [data, setData] = useState<V3ReviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [psychDraft, setPsychDraft] = useState<Answers | null>(null);
  const router = useRouter();

  const reload = useCallback(async () => {
    const r = await loadV3ReviewAction(tradeId);
    if (r.success) {
      setData(r.data);
      setError(null);
    } else setError(r.error);
  }, [tradeId]);

  useEffect(() => {
    let active = true;
    void loadV3ReviewAction(tradeId).then((r) => {
      if (!active) return;
      if (r.success) setData(r.data);
      else setError(r.error);
    });
    return () => {
      active = false;
    };
  }, [tradeId]);

  const changed = useCallback(async () => {
    await reload();
    router.refresh();
  }, [reload, router]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  if (data.state === "CANCELLED") return <CancelledReview data={data} dateKey={dateKey} onChanged={changed} />;
  if (data.state === "NOT_AVAILABLE") {
    return <p className="text-sm text-muted-foreground">Review opens once the trade is entered.</p>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Trade review</span>
        <span className={cn("rounded-md border px-1.5 py-0.5 font-mono text-[11px] tracking-wide uppercase", STATE_TONE[data.state])}>
          {REVIEW_STATE_LABEL[data.state]}
        </span>
        {data.hasEarlierReview && (
          <span className="text-xs text-muted-foreground">An earlier review was saved before the trade fully closed — finish the final review.</span>
        )}
        {!data.closed && (
          <span className="text-xs text-muted-foreground">Position still open — this is an interim review.</span>
        )}
      </header>

      <ResultBlock data={data} />
      <PlanVsActualBlock data={data} />
      <OverridesBlock data={data} />
      <ProcessBlock data={data} dateKey={dateKey} onChanged={changed} />
      <MotiveBlock data={data} dateKey={dateKey} onChanged={changed} psychDraft={psychDraft} />
      <PsychologyBlock data={data} dateKey={dateKey} onChanged={changed} onDraft={setPsychDraft} />
      <BehaviourBlock data={data} dateKey={dateKey} onChanged={changed} />
      <ReflectionBlock data={data} dateKey={dateKey} onChanged={changed} />

      <Block title="After images">
        <TradeImageBucket tradeId={data.tradeId} category="AFTER" label="After-Trade Images" requireTimeframe />
      </Block>

      <CompleteBar data={data} dateKey={dateKey} onChanged={changed} />
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Block({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-background/30">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <h3 className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{title}</h3>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">{aside}</div>
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </section>
  );
}

function Saving({ state }: { state: SaveState }) {
  if (state === "saving") return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
  if (state === "saved") return <Check className="size-3.5 text-success" />;
  return null;
}

function YesNo({
  value,
  onChange,
  disabled,
  suggested,
  options = [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ],
}: {
  value: string | null;
  onChange: (v: string) => void;
  disabled: boolean;
  suggested?: string | null;
  options?: { value: string; label: string }[];
}) {
  return (
    <div className="flex shrink-0 gap-1">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          size="xs"
          variant={value === o.value ? "default" : "outline"}
          className={cn(value == null && suggested === o.value && "border-dashed border-primary text-primary")}
          aria-pressed={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function QuestionRow({ prompt, children, sub }: { prompt: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <p className="text-sm">{prompt}</p>
        {sub}
      </div>
      {children}
    </div>
  );
}

function fmtR(r: number | null) {
  if (r == null) return "—";
  return `${r > 0 ? "+" : ""}${r.toFixed(2)}R`;
}

function fmtMoney(n: number | null) {
  if (n == null) return null;
  const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : "+"}$${abs}`;
}

// ── RESULT ───────────────────────────────────────────────────────────────────

function ResultBlock({ data }: { data: V3ReviewDTO }) {
  const r = data.result;
  const settlement =
    r.settlement === "SETTLED"
      ? "Settled"
      : r.settlement === "PENDING_SETTLEMENT"
        ? "Pending settlement — initial stop needed"
        : "Open — not settled";
  return (
    <Block title="Result">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-sm">
        <span
          className={cn(
            "text-base font-semibold",
            r.realizedR == null ? "text-muted-foreground" : r.realizedR > 0 ? "text-success" : r.realizedR < 0 ? "text-danger" : "",
          )}
        >
          {fmtR(r.realizedR)}
        </span>
        {fmtMoney(r.pnl) && <span>{fmtMoney(r.pnl)}</span>}
        <span className="text-muted-foreground">· {settlement}</span>
        {r.winLoss && <span className="text-muted-foreground">· {r.winLoss.toLowerCase()}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {r.positionLabel}
        {r.remainingOpenPercent != null && r.remainingOpenPercent > 0 ? ` · ${r.remainingOpenPercent}% still open` : ""}
        {r.settlement !== "SETTLED" ? " · not classified win/loss until settled" : ""}
      </p>
    </Block>
  );
}

// ── PLAN VS ACTUAL ───────────────────────────────────────────────────────────

function PlanVsActualBlock({ data }: { data: V3ReviewDTO }) {
  return (
    <Block title="Plan vs actual" aside={data.planVsActual.hasPlan ? "Locked plan at entry" : "No confirmed plan"}>
      <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1 text-sm">
        {data.planVsActual.rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className={cn("font-mono text-[13px]", ROW_TONE[row.tone])}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </Block>
  );
}

function OverridesBlock({ data }: { data: V3ReviewDTO }) {
  const { limit, setupValidation, performanceRisk } = data.overrides;
  if (!limit && !setupValidation && !performanceRisk) return null;
  const ctx = limit?.context;
  return (
    <Block title="Overrides" aside="Facts — not verdicts">
      {limit && (
        <div className="space-y-1 rounded-lg border border-warning/30 bg-warning/5 p-2.5">
          <p className="text-sm font-medium">Daily limit override</p>
          <p className="text-sm">&ldquo;{limit.reason}&rdquo;</p>
          {ctx && (
            <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
              <li>At the time{ctx.at ? ` (${new Date(ctx.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : ""}:</li>
              {ctx.maxTrades != null && (
                <li>
                  trades {ctx.executedCount} / max {ctx.maxTrades}
                  {ctx.kinds.includes("MAX_TRADES") ? " — overridden" : ""}
                </li>
              )}
              {ctx.riskLimitPercent != null && (
                <li>
                  risk used {ctx.riskUsedPercent}%{ctx.projectedRiskPercent != null ? ` + ${ctx.projectedRiskPercent}%` : ""} / limit{" "}
                  {ctx.riskLimitPercent}%{ctx.kinds.includes("DAILY_RISK") ? " — overridden" : ""}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {setupValidation && (
        <div className="rounded-lg border border-border p-2.5 text-sm">
          <p className="font-medium">Setup validation override</p>
          <p className="text-muted-foreground">
            {[setupValidation.reason?.replaceAll("_", " ").toLowerCase(), setupValidation.note].filter(Boolean).join(" — ") || "No reason recorded"}
          </p>
        </div>
      )}
      {performanceRisk && (
        <div className="rounded-lg border border-border p-2.5 text-sm">
          <p className="font-medium">Performance risk override</p>
          <p className="text-muted-foreground">
            {performanceRisk.riskPercent}% risk vs account default {performanceRisk.defaultRiskPercent}% (set before entry)
          </p>
        </div>
      )}
    </Block>
  );
}

// ── PROCESS ──────────────────────────────────────────────────────────────────

function ProcessBlock({ data, dateKey, onChanged }: { data: V3ReviewDTO; dateKey: string; onChanged: () => Promise<void> }) {
  const editable = useWorkspaceEditable();
  const [answers, setAnswers] = useState<Record<string, boolean>>(data.adherenceAnswers);
  const [state, setState] = useState<SaveState>("idle");

  async function set(key: string, value: boolean) {
    const next = { ...answers };
    if (next[key] === value) delete next[key];
    else next[key] = value;
    setAnswers(next);
    setState("saving");
    const r = await updateReviewFieldsAction(dateKey, data.tradeId, { adherenceAnswers: next });
    if (!r.success) {
      setState("error");
      toast.error(r.error);
      return;
    }
    setState("saved");
    await onChanged();
  }

  return (
    <Block title="Process" aside={<Saving state={state} />}>
      <p className="text-xs text-muted-foreground">Judge the process, not the result.</p>
      {ADHERENCE_QUESTIONS.map((q) => (
        <QuestionRow key={q.key} prompt={q.prompt}>
          <YesNo
            value={q.key in answers ? (answers[q.key] ? "yes" : "no") : null}
            onChange={(v) => set(q.key, v === "yes")}
            disabled={!editable}
          />
        </QuestionRow>
      ))}
    </Block>
  );
}

// ── MOTIVE ───────────────────────────────────────────────────────────────────

function MotiveBlock({
  data,
  dateKey,
  onChanged,
  psychDraft,
}: {
  data: V3ReviewDTO;
  dateKey: string;
  onChanged: () => Promise<void>;
  /** Psychology answers not yet scored — FOMO comes from the motive, so a
   *  draft that was only waiting for it is scored as soon as it's chosen. */
  psychDraft: Answers | null;
}) {
  const editable = useWorkspaceEditable();
  const [value, setValue] = useState<Intent | null>(data.tradeIntent);
  const [pending, start] = useTransition();

  function choose(next: Intent) {
    const v = next === value ? null : next;
    setValue(v);
    start(async () => {
      const r = await setReviewIntentAction(dateKey, data.tradeId, { tradeIntent: v });
      if (!r.success) {
        toast.error(r.error);
        setValue(data.tradeIntent);
        return;
      }
      if (v != null && psychDraft && !data.psychology.complete) {
        await saveReviewPsychologyAction(dateKey, data.tradeId, { answers: psychDraft });
      }
      await onChanged();
    });
  }

  return (
    <Block title="Motive" aside={pending ? <Loader2 className="size-3.5 animate-spin" /> : value ? null : "Required"}>
      <p className="text-sm">What actually drove me to take this trade?</p>
      {data.reasonForTrade && (
        <p className="text-xs text-muted-foreground">
          Before the trade you wrote why it made sense: &ldquo;{data.reasonForTrade}&rdquo;
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {INTENTS.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="xs"
            variant={value === o.value ? (o.value === "PLANNED" ? "default" : "destructive") : "outline"}
            aria-pressed={value === o.value}
            disabled={!editable || pending}
            onClick={() => choose(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </Block>
  );
}

// ── PSYCHOLOGY (evidence-assisted + influence) ──────────────────────────────

function EvidenceSub({ evidence }: { evidence: EvidenceResult }) {
  return (
    <div className="mt-0.5 space-y-0.5">
      {evidence.facts.length > 0 && (
        <p className="font-mono text-[11px] text-muted-foreground">{evidence.facts.join(" · ")}</p>
      )}
      <p className="text-xs">
        {evidence.suggestion ? (
          <span className="text-primary">Suggested: {evidence.suggestion === "yes" ? "Yes" : "No"} — </span>
        ) : null}
        <span className="text-muted-foreground">{evidence.reason}</span>
      </p>
    </div>
  );
}

function PsychologyBlock({
  data,
  dateKey,
  onChanged,
  onDraft,
}: {
  data: V3ReviewDTO;
  dateKey: string;
  onChanged: () => Promise<void>;
  onDraft: (answers: Answers) => void;
}) {
  const editable = useWorkspaceEditable();
  const src = data.psychology.sources;
  const askedKeys = PSYCHOLOGY_QUESTIONS.map((q) => q.key).filter((k) => src[k] !== "DERIVED");
  const [answers, setAnswers] = useState<Answers>(() => {
    const seed: Answers = {};
    for (const k of askedKeys) if (data.psychology.stored[k] !== undefined) seed[k] = data.psychology.stored[k];
    return seed;
  });
  const [state, setState] = useState<SaveState>("idle");
  const [obsession, setObsession] = useState(
    typeof answers.monitoringObsession === "number" ? String(answers.monitoringObsession) : "",
  );

  const answered = askedKeys.filter((k) => answers[k] !== undefined).length;

  async function commit(next: Answers) {
    setAnswers(next);
    onDraft(next);
    if (askedKeys.some((k) => next[k] === undefined)) {
      setState("idle");
      return; // saved (and scored) once every asked question is answered
    }
    setState("saving");
    const r = await saveReviewPsychologyAction(dateKey, data.tradeId, { answers: next });
    if (!r.success) {
      setState("error");
      toast.error(r.error);
      return;
    }
    if (!r.complete) {
      setState("idle");
      if (r.missing.includes("fomo")) toast.message("Choose the motive above — FOMO is taken from it.");
      return;
    }
    setState("saved");
    await onChanged();
  }

  function setChoice(key: string, value: string) {
    const next = { ...answers };
    if (next[key] === value) delete next[key];
    else next[key] = value;
    void commit(next);
  }

  function commitObsession() {
    const n = Number(obsession);
    const next = { ...answers };
    if (obsession.trim() === "" || !Number.isFinite(n) || n < 1 || n > 100) delete next.monitoringObsession;
    else next.monitoringObsession = Math.round(n);
    if (next.monitoringObsession === answers.monitoringObsession) return;
    void commit(next);
  }

  const choice = (key: string) => PSYCHOLOGY_QUESTIONS.find((q) => q.key === key) as ChoiceQuestion;
  const opts = (key: string) => choice(key).options.map((o) => ({ value: o.value, label: o.label }));
  const val = (key: string) => (answers[key] === undefined ? null : String(answers[key]));

  return (
    <Block
      title="Psychology"
      aside={
        <>
          <Saving state={state} />
          {data.psychology.complete && data.psychology.percent != null ? (
            <span className="font-mono">
              {Math.round(data.psychology.percent)}% · {data.psychology.grade}
            </span>
          ) : (
            <span>
              {answered}/{askedKeys.length} answered{answered < askedKeys.length ? " · scored when complete" : ""}
            </span>
          )}
        </>
      }
    >
      <div className="space-y-0.5 rounded-lg bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
        <p>
          FOMO: <span className="font-medium text-foreground">{data.psychology.derived.fomo == null ? "— (choose the motive)" : data.psychology.derived.fomo === "yes" ? "Yes" : "No"}</span> · from your motive
        </p>
        {src.alignedWithBias === "DERIVED" && (
          <p>
            Aligned with today&apos;s bias:{" "}
            <span className="font-medium text-foreground">{data.psychology.derived.alignedWithBias === "yes" ? "Yes" : "No"}</span> · {data.direction.toLowerCase()} vs frozen{" "}
            {data.dailyBiasSnapshot?.toLowerCase()} bias
          </p>
        )}
      </div>

      <QuestionRow prompt={PROMPT.riskManaged} sub={<EvidenceSub evidence={data.risk} />}>
        <YesNo value={val("riskManaged")} suggested={data.risk.suggestion} onChange={(v) => setChoice("riskManaged", v)} disabled={!editable} />
      </QuestionRow>
      <QuestionRow prompt={PROMPT.followedExitPlan} sub={<EvidenceSub evidence={data.exit} />}>
        <YesNo value={val("followedExitPlan")} suggested={data.exit.suggestion} onChange={(v) => setChoice("followedExitPlan", v)} disabled={!editable} />
      </QuestionRow>
      {src.alignedWithBias === "HUMAN" && (
        <QuestionRow
          prompt={PROMPT.alignedWithBias}
          sub={
            <p className="text-xs text-muted-foreground">
              {data.dailyBiasSnapshot === "NEUTRAL" ? "Today's bias for this asset was neutral" : "No daily bias was recorded for this asset"} — your judgement.
            </p>
          }
        >
          <YesNo value={val("alignedWithBias")} onChange={(v) => setChoice("alignedWithBias", v)} disabled={!editable} options={opts("alignedWithBias")} />
        </QuestionRow>
      )}

      <p className="pt-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Influence</p>
      {HUMAN_KEYS.filter((k) => k !== "monitoringObsession").map((k) => (
        <QuestionRow key={k} prompt={PROMPT[k]}>
          <YesNo value={val(k)} onChange={(v) => setChoice(k, v)} disabled={!editable} options={opts(k)} />
        </QuestionRow>
      ))}
      <QuestionRow prompt={PROMPT.monitoringObsession}>
        <Input
          type="number"
          min={1}
          max={100}
          inputMode="numeric"
          className="h-7 w-20 font-mono text-xs"
          value={obsession}
          onChange={(e) => setObsession(e.target.value)}
          onBlur={commitObsession}
          onKeyDown={(e) => e.key === "Enter" && commitObsession()}
          disabled={!editable}
          aria-label={PROMPT.monitoringObsession}
        />
      </QuestionRow>
    </Block>
  );
}

// ── BEHAVIOUR ────────────────────────────────────────────────────────────────

function BehaviourBlock({ data, dateKey, onChanged }: { data: V3ReviewDTO; dateKey: string; onChanged: () => Promise<void> }) {
  const editable = useWorkspaceEditable();
  const [pickerKey, setPickerKey] = useState(0);
  const [pending, start] = useTransition();

  function add(labelId: string) {
    start(async () => {
      const attached = await loadTradeBehaviourLabelsAction(data.tradeId);
      const r = await setTradeBehaviourLabelsAction(dateKey, data.tradeId, {
        labelIds: Array.from(new Set([...attached.map((l) => l.id), labelId])),
      });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      setPickerKey((k) => k + 1);
      await onChanged();
    });
  }

  return (
    <Block title="Behaviour">
      {data.labelSuggestions.length > 0 && editable && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Suggested</span>
          {data.labelSuggestions.map((s) => (
            <button
              key={s.labelId}
              type="button"
              title={s.reason}
              disabled={pending}
              onClick={() => add(s.labelId)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/50 px-2.5 py-0.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              <Plus className="size-3" />
              {s.name}
            </button>
          ))}
        </div>
      )}
      <BehaviourLabelPicker key={pickerKey} dateKey={dateKey} tradeId={data.tradeId} />
    </Block>
  );
}

// ── REFLECTION ───────────────────────────────────────────────────────────────

function ReflectionField({
  data,
  dateKey,
  field,
  label,
  placeholder,
}: {
  data: V3ReviewDTO;
  dateKey: string;
  field: keyof V3ReviewDTO["reflection"];
  label: string;
  placeholder: string;
}) {
  const editable = useWorkspaceEditable();
  const [value, setValue] = useState(data.reflection[field] ?? "");
  const state = useDebouncedAutosave({
    value,
    serialize: (v) => v,
    save: (v) => updateReviewFieldsAction(dateKey, data.tradeId, { [field]: v }),
    onError: (m) => toast.error(m),
  });
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">{label}</label>
        <Saving state={state} />
      </div>
      <Textarea
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={editable ? placeholder : "Not captured."}
        disabled={!editable}
        aria-label={label}
        className="resize-y"
      />
    </div>
  );
}

function ReflectionBlock({ data, dateKey, onChanged }: { data: V3ReviewDTO; dateKey: string; onChanged: () => Promise<void> }) {
  const editable = useWorkspaceEditable();
  const [again, setAgain] = useState<boolean | null>(data.wouldTakeAgain);
  const [state, setState] = useState<SaveState>("idle");

  async function choose(v: boolean) {
    const next = again === v ? null : v;
    setAgain(next);
    setState("saving");
    const r = await updateReviewFieldsAction(dateKey, data.tradeId, { wouldTakeAgain: next });
    if (!r.success) {
      setState("error");
      toast.error(r.error);
      return;
    }
    setState("saved");
    await onChanged();
  }

  return (
    <Block title="Reflection" aside="Optional, except the last question">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ReflectionField data={data} dateKey={dateKey} field="whatWentWell" label="What did I do well?" placeholder="Process you'd repeat." />
        <ReflectionField data={data} dateKey={dateKey} field="whatCouldImprove" label="What needs improvement?" placeholder="One concrete thing." />
        <ReflectionField
          data={data}
          dateKey={dateKey}
          field="psychLessonsLearned"
          label="Key lesson"
          placeholder="The one takeaway."
        />
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Would I take this setup again?</span>
            <Saving state={state} />
          </div>
          <YesNo value={again == null ? null : again ? "yes" : "no"} onChange={(v) => choose(v === "yes")} disabled={!editable} />
        </div>
      </div>
      {data.legacyReflection.length > 0 && (
        <details className="group rounded-lg border border-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-xs select-none">
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
            More · legacy reflection ({data.legacyReflection.length})
          </summary>
          <dl className="space-y-2 border-t border-border p-2.5 text-sm">
            {data.legacyReflection.map((r) => (
              <div key={r.label}>
                <dt className="text-xs text-muted-foreground">{r.label}</dt>
                <dd className="whitespace-pre-wrap">{r.text}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </Block>
  );
}

// ── COMPLETE ─────────────────────────────────────────────────────────────────

function CompleteBar({ data, dateKey, onChanged }: { data: V3ReviewDTO; dateKey: string; onChanged: () => Promise<void> }) {
  const editable = useWorkspaceEditable();
  const [pending, start] = useTransition();
  const final = data.closed;
  const blocked = final && data.missing.length > 0;

  function complete() {
    start(async () => {
      const r = await completeReviewAction(dateKey, data.tradeId);
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      toast.success(r.mode === "FINAL" ? "Review complete." : "Interim review saved — the final review opens once the position closes.");
      await onChanged();
    });
  }

  if (!editable) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-muted-foreground">
        {data.state === "FINAL_REVIEW_COMPLETE" ? (
          <span className="text-success">Final review complete{data.reviewedAt ? ` · ${new Date(data.reviewedAt).toLocaleString()}` : ""}.</span>
        ) : final ? (
          blocked ? (
            <>
              <span className="font-medium text-foreground">Still needed: </span>
              {data.missing.map((m) => m.label).join(" · ")}
            </>
          ) : (
            "Everything required is answered. Reflection text is optional."
          )
        ) : (
          "Interim review — it won't count as the final review once the position fully closes."
        )}
      </div>
      {data.state !== "FINAL_REVIEW_COMPLETE" && (
        <Button type="button" size="sm" onClick={complete} disabled={pending || blocked} className="shrink-0 gap-1.5">
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {final ? "Complete review" : data.state === "INTERIM_REVIEWED" ? "Update interim review" : "Save interim review"}
        </Button>
      )}
    </div>
  );
}

// ── CANCELLED ────────────────────────────────────────────────────────────────

function CancelledReview({ data, dateKey, onChanged }: { data: V3ReviewDTO; dateKey: string; onChanged: () => Promise<void> }) {
  const editable = useWorkspaceEditable();
  const [reason, setReason] = useState(data.cancellationReason ?? "");
  const state = useDebouncedAutosave({
    value: reason,
    serialize: (v) => v,
    save: async (v) => {
      const r = await setReviewLifecycleStatusAction(dateKey, data.tradeId, {
        status: "CANCELLED_NEVER_TRIGGERED",
        cancellationReason: v.trim() || null,
      });
      if (r.success) void onChanged();
      return r;
    },
    onError: (m) => toast.error(m),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        This idea was cancelled before entry — there is no execution, risk or exit to review and no result is recorded.
      </p>
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">Why was it cancelled?</label>
          <Saving state={state} />
        </div>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!editable} />
      </div>
      <ReflectionField data={data} dateKey={dateKey} field="psychLessonsLearned" label="Key lesson (optional)" placeholder="What did this idea teach you?" />
    </div>
  );
}
