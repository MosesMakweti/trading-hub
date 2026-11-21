"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, ClipboardCheck, Loader2, Lock, Plus, RotateCcw, Sparkles, Unlock, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  createCommitmentFromAuditAction,
  finalizeAuditAction,
  reopenAuditAction,
  resolveCarriedCommitmentAction,
  saveWeeklyAssessmentAction,
  setAuditCommitmentStatusAction,
} from "@/actions/trade-audit.actions";
import type { WeeklyAuditSummary } from "@/domain/trade-audit/summary";
import type { AuditCommitmentDTO } from "@/server/services/trade-audit.service";
import type { AuditAssessmentText, AuditRatings, LegacyReflectionDTO, WeeklyAuditDTO } from "@/types/trade-audit";
import { fmtR, toneOf, useAudit } from "@/components/edge/audit/audit-context";
import { AutosaveText, RatingInput } from "@/components/edge/audit/audit-fields";

type TextKey = keyof AuditAssessmentText;
type RatingKey = keyof AuditRatings;

const RATING_FOR_DIMENSION: Record<WeeklyAuditSummary["dimensions"][number]["key"], RatingKey> = {
  executionQuality: "executionQualityRating",
  tradeSelection: "tradeSelectionRating",
  patience: "patienceRating",
  strategyAdherence: "strategyAdherenceRating",
  riskManagement: "riskManagementRating",
  tradeManagement: "tradeManagementRating",
};

function MatrixCell({ title, hint, cell, tone }: { title: string; hint: string; cell: { count: number; r: number }; tone: "good" | "ok" | "warn" | "bad" }) {
  const toneClass = { good: "border-success/40 bg-success/5", ok: "border-sky-500/40 bg-sky-500/5", warn: "border-warning/50 bg-warning/10", bad: "border-danger/40 bg-danger/5" }[tone];
  return (
    <div className={cn("rounded-lg border p-2.5", toneClass)}>
      <p className="text-xs font-medium">{title}</p>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{cell.count}</span>
        {cell.count > 0 && <span className={cn("font-mono text-xs", toneOf(cell.r))}>{fmtR(cell.r)}</span>}
      </p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Tallies({ title, items, empty }: { title: string; items: { key: string; label: string; count: number }[]; empty: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {items.slice(0, 5).map((i) => (
            <li key={i.key} className="flex items-center justify-between gap-2 text-xs">
              <span>{i.label}</span>
              <span className={cn("font-mono tabular-nums", i.count >= 2 && "font-semibold text-danger")}>×{i.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function plainText(value: unknown): string | null {
  // Legacy reflections were Tiptap JSON; show their text content read-only.
  if (value == null) return null;
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n && typeof n === "object") {
      const node = n as { text?: unknown; content?: unknown[]; type?: string };
      if (typeof node.text === "string") out.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
      if (node.type === "paragraph") out.push("\n");
    }
  };
  walk(value);
  const text = out.join("").trim();
  return text || null;
}

export function WeeklyAssessmentSection({
  audit,
  summary,
  unacknowledgedChanges,
  commitments,
  carryForward,
  legacyReflection,
}: {
  audit: WeeklyAuditDTO | null;
  summary: WeeklyAuditSummary;
  unacknowledgedChanges: number;
  commitments: AuditCommitmentDTO[];
  carryForward: AuditCommitmentDTO[];
  legacyReflection: LegacyReflectionDTO | null;
}) {
  const router = useRouter();
  const { scope, locked } = useAudit();
  const [ratings, setRatings] = useState<AuditRatings>({
    executionQualityRating: audit?.executionQualityRating ?? null,
    tradeSelectionRating: audit?.tradeSelectionRating ?? null,
    patienceRating: audit?.patienceRating ?? null,
    strategyAdherenceRating: audit?.strategyAdherenceRating ?? null,
    riskManagementRating: audit?.riskManagementRating ?? null,
    tradeManagementRating: audit?.tradeManagementRating ?? null,
  });
  // Bumped to remount the text fields after "use the generated draft".
  const [draftVersion, setDraftVersion] = useState(0);
  const [pending, startTransition] = useTransition();
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [newCommitment, setNewCommitment] = useState<string | null>(null);

  const saveText = (key: TextKey) => (value: string | null) => saveWeeklyAssessmentAction({ scope, patch: { [key]: value } });

  function fillDrafts() {
    const fields: TextKey[] = ["executionSummary", "decisionSummary", "strongestArea", "biggestWeakness", "recurringPatterns"];
    const patch: Partial<Record<TextKey, string>> = {};
    for (const f of fields) if (!audit?.[f]) patch[f] = summary.drafts[f as keyof WeeklyAuditSummary["drafts"]];
    if (Object.keys(patch).length === 0) {
      toast.info("Every summary field already has your own text.");
      return;
    }
    startTransition(async () => {
      const result = await saveWeeklyAssessmentAction({ scope, patch });
      if (!result.success) return void toast.error(result.error);
      setDraftVersion((v) => v + 1);
      router.refresh();
    });
  }

  function run(action: () => Promise<{ success: boolean; error?: string }>, ok?: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.success) return void toast.error(result.error ?? "Something went wrong.");
      if (ok) toast.success(ok);
      router.refresh();
    });
  }

  const m = summary.matrix;
  const textFields: { key: TextKey; label: string; hint?: string; draft?: string }[] = [
    { key: "executionSummary", label: "Trading execution", draft: summary.drafts.executionSummary },
    { key: "decisionSummary", label: "Decision-making", hint: "Selection, patience, adherence to your criteria.", draft: summary.drafts.decisionSummary },
    { key: "strongestArea", label: "Strongest area of performance", draft: summary.drafts.strongestArea },
    { key: "biggestWeakness", label: "Most significant weakness", draft: summary.drafts.biggestWeakness },
    { key: "recurringPatterns", label: "Recurring behavioural patterns", draft: summary.drafts.recurringPatterns },
    { key: "mainLesson", label: "Most important lesson" },
    { key: "nextWeekPriority", label: "Main priority for next week", hint: "One thing. Make it observable." },
  ];

  return (
    <section id="weekly-assessment" aria-labelledby="weekly-assessment-title" className="glass scroll-mt-20 space-y-5 rounded-2xl p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-2">
        <h2 id="weekly-assessment-title" className="text-lg font-semibold">
          Weekly assessment
        </h2>
        <span className="text-xs text-muted-foreground">Built from everything you recorded above — judged on decisions, not profit.</span>
      </header>

      {/* Decision quality: process × outcome */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Decision quality</h3>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MatrixCell title="Valid & won" hint="Good process, good outcome." cell={m.goodProcessGoodOutcome} tone="good" />
          <MatrixCell title="Valid & lost" hint="Good process — an acceptable loss." cell={m.goodProcessBadOutcome} tone="ok" />
          <MatrixCell title="Invalid & won" hint="Bad process rewarded — still a mistake." cell={m.badProcessGoodOutcome} tone="warn" />
          <MatrixCell title="Invalid & lost" hint="Bad process, bad outcome." cell={m.badProcessBadOutcome} tone="bad" />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {summary.judged.valid} valid · {summary.judged.invalid} invalid · {summary.judged.unsure} unsure · {summary.judged.unassessed} not yet judged · {summary.missed.total} missed valid setup
          {summary.missed.total === 1 ? "" : "s"} ({summary.missed.live} recorded live, {summary.missed.retrospective} in review)
          {summary.systemFlaggedTrades > 0 && ` · ${summary.systemFlaggedTrades} trade${summary.systemFlaggedTrades === 1 ? "" : "s"} flagged by Traditorium at the time`}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Tallies title="Why trades shouldn't have been taken" items={summary.invalidReasons} empty="No invalid trades recorded." />
        <Tallies title="Execution issues" items={summary.executionIssues} empty="No execution issues recorded." />
        <Tallies title="Underlying weaknesses" items={summary.weaknesses} empty="No weaknesses tagged yet." />
      </div>

      {/* Ratings, each next to its evidence */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Rate your week</h3>
        <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
          {summary.dimensions.map((d) => {
            const key = RATING_FOR_DIMENSION[d.key];
            return (
              <RatingInput
                key={d.key}
                label={d.label}
                evidence={d.evidence}
                value={ratings[key]}
                disabled={locked}
                onChange={(next) => {
                  setRatings((r) => ({ ...r, [key]: next }));
                  run(() => saveWeeklyAssessmentAction({ scope, patch: { [key]: next } }));
                }}
              />
            );
          })}
        </div>
      </div>

      {/* The written assessment */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Your assessment</h3>
          {!locked && (
            <Button type="button" variant="outline" size="xs" className="gap-1" disabled={pending} onClick={fillDrafts}>
              <Sparkles className="size-3" /> Fill empty fields from the summary
            </Button>
          )}
        </div>
        <div key={draftVersion} className="grid gap-3 md:grid-cols-2">
          {textFields.map((f) => (
            <AutosaveText key={f.key} label={f.label} hint={locked ? undefined : f.hint} initial={audit?.[f.key] ?? null} disabled={locked} showEmpty onSave={saveText(f.key)} placeholder={f.draft} rows={3} />
          ))}
        </div>
      </div>

      {legacyReflection && (
        <details className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Earlier reflection for this week (previous Edge Review, read-only)</summary>
          <dl className="mt-2 space-y-2 text-xs">
            {(
              [
                ["What went well", legacyReflection.wentWell],
                ["What to improve", legacyReflection.toImprove],
                ["Focus for next week", legacyReflection.focusNextWeek],
              ] as const
            ).map(([label, value]) => {
              const text = plainText(value);
              return text ? (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="whitespace-pre-wrap">{text}</dd>
                </div>
              ) : null;
            })}
          </dl>
        </details>
      )}

      {/* Optional follow-through */}
      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Follow-through (optional)</h3>
        <p className="text-[11px] text-muted-foreground">A commitment appears on Today next week once this week is finalized. Keep it to one or two.</p>

        {carryForward.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Still active from your last finalized review</p>
            {carryForward.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1">{c.title}</span>
                <Button type="button" size="xs" variant="outline" className="gap-1" disabled={pending || locked} onClick={() => run(() => resolveCarriedCommitmentAction({ scope, commitmentId: c.id, decision: "CONTINUE" }), "Carried into this week.")}>
                  <ArrowRight className="size-3" /> Continue
                </Button>
                <Button type="button" size="xs" variant="ghost" className="gap-1" disabled={pending || locked} onClick={() => run(() => resolveCarriedCommitmentAction({ scope, commitmentId: c.id, decision: "DONE" }), "Marked done.")}>
                  <Check className="size-3" /> Done
                </Button>
                <Button type="button" size="xs" variant="ghost" className="gap-1" disabled={pending || locked} onClick={() => run(() => resolveCarriedCommitmentAction({ scope, commitmentId: c.id, decision: "DROP" }), "Dropped.")}>
                  <X className="size-3" /> Drop
                </Button>
              </div>
            ))}
          </div>
        )}

        {commitments.length > 0 && (
          <ul className="space-y-1">
            {commitments.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-sm">
                <span className={cn("min-w-0 flex-1", c.status !== "ACTIVE" && "text-muted-foreground line-through")}>{c.title}</span>
                <span className="text-[11px] text-muted-foreground">{c.status === "ACTIVE" ? "Active" : c.status === "COMPLETED" ? "Done" : "Dropped"}</span>
                {c.status === "ACTIVE" && (
                  <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => run(() => setAuditCommitmentStatusAction({ scope, commitmentId: c.id, status: "RETIRED" }))}>
                    Drop
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {newCommitment == null ? (
          <Button type="button" size="sm" variant="outline" className="gap-1" disabled={pending} onClick={() => setNewCommitment(audit?.nextWeekPriority ?? "")}>
            <Plus className="size-3.5" /> Add a commitment
          </Button>
        ) : (
          <form
            className="flex flex-wrap gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const title = newCommitment.trim();
              if (!title) return;
              run(async () => {
                const r = await createCommitmentFromAuditAction({ scope, category: "BEHAVIOR", title: title.slice(0, 160), description: null, priority: "HIGH" });
                if (r.success) setNewCommitment(null);
                return r;
              }, "Commitment added.");
            }}
          >
            <Input aria-label="Commitment" className="min-w-60 flex-1" value={newCommitment} maxLength={160} onChange={(e) => setNewCommitment(e.target.value)} placeholder="e.g. Only enter after the 5m close confirms the break" autoFocus />
            <Button type="submit" size="sm" disabled={pending || !newCommitment.trim()}>
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setNewCommitment(null)}>
              Cancel
            </Button>
          </form>
        )}
      </div>

      {/* Finalize / reopen */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        {locked ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <Lock className="size-4" /> Week finalized{audit?.finalizedAt ? ` on ${new Date(audit.finalizedAt).toLocaleDateString()}` : ""}
            </span>
            <Button type="button" variant="outline" size="sm" className="ml-auto gap-1" disabled={pending} onClick={() => run(() => reopenAuditAction(scope), "Week reopened.")}>
              <Unlock className="size-3.5" /> Reopen week
            </Button>
          </>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              <p>
                {summary.days.completed} of {summary.days.total} days reviewed.
                {summary.judged.unassessed > 0 && ` ${summary.judged.unassessed} trade${summary.judged.unassessed === 1 ? "" : "s"} not yet judged.`}
              </p>
              <p>Finalizing freezes this week as you see it now. Later trade edits are flagged, never written into it.</p>
              {audit?.reopenedAt && (
                <p className="inline-flex items-center gap-1">
                  <RotateCcw className="size-3" /> Reopened {new Date(audit.reopenedAt).toLocaleDateString()}
                </p>
              )}
            </div>
            <Button type="button" className="ml-auto gap-1.5" disabled={pending || unacknowledgedChanges > 0} onClick={() => setConfirmFinalize(true)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />} Finalize week
            </Button>
            {unacknowledgedChanges > 0 && (
              <p className="w-full text-right text-xs text-warning-foreground dark:text-warning">
                {unacknowledgedChanges} trade{unacknowledgedChanges === 1 ? " was" : "s were"} edited after you assessed {unacknowledgedChanges === 1 ? "it" : "them"} — re-check before finalizing.
              </p>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmFinalize}
        onOpenChange={setConfirmFinalize}
        title="Finalize this week?"
        description={
          summary.days.completed < summary.days.total || summary.judged.unassessed > 0
            ? `Not everything is reviewed (${summary.days.completed}/${summary.days.total} days, ${summary.judged.unassessed} unjudged trades). You can still finalize; you can reopen the week later.`
            : "The week's trades and summary are frozen as they are now. You can reopen it later."
        }
        confirmLabel="Finalize"
        isPending={pending}
        onConfirm={() =>
          run(async () => {
            const r = await finalizeAuditAction(scope);
            setConfirmFinalize(false);
            return r;
          }, "Week finalized.")
        }
      />
    </section>
  );
}
