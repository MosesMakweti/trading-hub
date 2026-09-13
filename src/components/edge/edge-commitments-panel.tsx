"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2, Pencil, Plus, RotateCcw, TrendingDown, TrendingUp, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CommitmentHistorySheet } from "@/components/edge/commitment-history-sheet";
import {
  acceptSuggestedCommitment,
  continueCommitment,
  createManualCommitment,
  getCommitmentLineage,
  refineCommitment,
  setCommitmentStatus,
  updateCommitment,
} from "@/actions/edge-improvements.actions";
import type { CommitmentCategory, CommitmentPriority, SuggestedCommitment } from "@/domain/replay-improvements/types";
import type { AdherenceTrend, CommitmentLineageDTO, EdgeReviewCommitmentDTO } from "@/types/edge-improvements";

const CATEGORIES: CommitmentCategory[] = ["EXECUTION", "BEHAVIOR", "PROCESS", "OPPORTUNITY", "STRATEGY", "RISK"];
const PRIORITIES: CommitmentPriority[] = ["HIGH", "MEDIUM", "LOW"];

const PRIORITY_CLASS: Record<CommitmentPriority, string> = {
  HIGH: "bg-danger/15 text-danger",
  MEDIUM: "bg-warning/15 text-warning",
  LOW: "bg-secondary text-secondary-foreground",
};

const TREND_ICON: Partial<Record<AdherenceTrend, { Icon: typeof TrendingUp; className: string }>> = {
  IMPROVING: { Icon: TrendingUp, className: "text-success" },
  DECLINING: { Icon: TrendingDown, className: "text-danger" },
};

/**
 * Improvement Commitments (Stage 16 §6-14, upgraded Stage 19) — four
 * sections answering "I said I would improve this. Did I actually do it?":
 * New Findings (deterministic suggestions, unchanged from Stage 16),
 * Active Commitments (this session's own, now with adherence/trend and a
 * resolution suggestion once thresholds are met — never auto-resolved),
 * Next-Period Commitments (still-ACTIVE commitments carried forward from
 * the last finalized review of this same type — Continue/Refine/Resolve/
 * Dismiss all target THIS session as the new period), and Commitment
 * Results (this session's own COMPLETED/RETIRED history). Nothing here is
 * AI-generated — every adherence number traces back to
 * `domain/improvements/commitment-adherence`'s pure functions.
 */
export function EdgeCommitmentsPanel({
  sessionId,
  commitments,
  carryForwardCandidates,
  suggestions,
}: {
  sessionId: string;
  commitments: EdgeReviewCommitmentDTO[];
  carryForwardCandidates: EdgeReviewCommitmentDTO[];
  suggestions: SuggestedCommitment[];
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const acceptedRuleKeys = new Set(commitments.filter((c) => c.sourceFindingType != null).map((c) => c.sourceFindingType));
  const visibleSuggestions = suggestions.filter((s) => !dismissed.has(s.ruleKey) && !acceptedRuleKeys.has(s.ruleKey));

  const activeCommitments = commitments.filter((c) => c.status === "ACTIVE");
  const resultCommitments = commitments.filter((c) => c.status !== "ACTIVE");

  return (
    <div className="glass space-y-4 rounded-2xl p-4">
      <h3 className="text-sm font-semibold">Improvement Commitments</h3>

      {carryForwardCandidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase">Next-Period Commitments</p>
          <p className="text-[11px] text-muted-foreground/70">
            Still active from your last finished review. Continue unchanged, refine the wording, or resolve/dismiss it before moving on.
          </p>
          {carryForwardCandidates.map((c) => (
            <CarryForwardCard key={c.id} commitment={c} sessionId={sessionId} />
          ))}
        </div>
      )}

      {activeCommitments.length > 0 && (
        <div className="space-y-2">
          {carryForwardCandidates.length > 0 && <p className="text-xs font-medium text-muted-foreground uppercase">Active Commitments</p>}
          {activeCommitments.map((c) => (
            <CommitmentCard key={c.id} commitment={c} />
          ))}
        </div>
      )}

      {visibleSuggestions.length > 0 && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase">New Findings</p>
          {visibleSuggestions.map((s) => (
            <SuggestionCard key={s.ruleKey} sessionId={sessionId} suggestion={s} onDismiss={() => setDismissed((prev) => new Set(prev).add(s.ruleKey))} />
          ))}
        </div>
      )}

      <ManualCommitmentForm sessionId={sessionId} />

      {resultCommitments.length > 0 && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase">Commitment Results</p>
          {resultCommitments.map((c) => (
            <CommitmentCard key={c.id} commitment={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function useLineage(commitmentId: string) {
  const [lineage, setLineage] = useState<CommitmentLineageDTO | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getCommitmentLineage(commitmentId).then((result) => {
      if (!cancelled && result.success) setLineage(result.lineage);
    });
    return () => {
      cancelled = true;
    };
  }, [commitmentId]);
  return lineage;
}

function AdherenceLine({ lineage }: { lineage: CommitmentLineageDTO | null }) {
  if (!lineage || lineage.current.adherencePercent == null) {
    return <span className="text-[10px] text-muted-foreground/50 italic">no observations yet</span>;
  }
  const trend = TREND_ICON[lineage.trend];
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {lineage.current.adherencePercent}% adherence
      {trend && <trend.Icon className={cn("size-3", trend.className)} />}
      <span className="text-muted-foreground/50">
        ({lineage.current.followed}/{lineage.current.applicableObservations})
      </span>
      {lineage.segments.length > 1 && (
        <span className="flex items-center gap-0.5 text-muted-foreground/50">
          <ChevronRight className="size-2.5" /> {lineage.segments.length} periods
        </span>
      )}
    </span>
  );
}

function CommitmentCard({ commitment }: { commitment: EdgeReviewCommitmentDTO }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(commitment.title);
  const [description, setDescription] = useState(commitment.description ?? "");
  const lineage = useLineage(commitment.id);

  function save() {
    startTransition(async () => {
      const result = await updateCommitment(commitment.id, { title, description: description || null });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setEditing(false);
    });
  }

  function changeStatus(status: "ACTIVE" | "COMPLETED" | "RETIRED") {
    startTransition(async () => {
      const result = await setCommitmentStatus(commitment.id, { status });
      if (!result.success) toast.error(result.error);
    });
  }

  return (
    <div
      className={cn(
        "space-y-1.5 rounded-lg border border-border/60 bg-background/40 p-2.5 text-xs",
        commitment.status !== "ACTIVE" && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">{commitment.category}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", PRIORITY_CLASS[commitment.priority])}>{commitment.priority}</span>
          {commitment.source === "SUGGESTED" && <span className="text-[10px] text-muted-foreground/70">Suggested</span>}
        </div>
        <span className="text-[10px] text-muted-foreground">{commitment.status}</span>
      </div>

      {editing ? (
        <div className="space-y-1.5">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-7 text-xs" />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-xs" />
          <div className="flex gap-1.5">
            <Button size="sm" className="h-7" disabled={pending} onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="font-medium">{commitment.title}</p>
          {commitment.description && <p className="text-muted-foreground">{commitment.description}</p>}
          {commitment.evidenceSnapshot && commitment.evidenceSnapshot.length > 0 && (
            <ul className="list-inside list-disc text-[11px] text-muted-foreground/70">
              {commitment.evidenceSnapshot.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <AdherenceLine lineage={lineage} />
          {commitment.status === "ACTIVE" && lineage?.resolutionEligible && (
            <p className="rounded border border-success/30 bg-success/5 px-1.5 py-1 text-[10px] text-success">
              Adherence has stayed high across multiple periods — consider marking this resolved.
            </p>
          )}
          <div className="flex flex-wrap gap-1 pt-1">
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 size-3" /> Edit
            </Button>
            <CommitmentHistorySheet commitmentId={commitment.id} title={commitment.title} />
            {commitment.status !== "COMPLETED" && (
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={pending} onClick={() => changeStatus("COMPLETED")}>
                <Check className="mr-1 size-3" /> Mark Completed
              </Button>
            )}
            {commitment.status !== "RETIRED" && (
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={pending} onClick={() => changeStatus("RETIRED")}>
                <X className="mr-1 size-3" /> Retire
              </Button>
            )}
            {commitment.status !== "ACTIVE" && (
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={pending} onClick={() => changeStatus("ACTIVE")}>
                <RotateCcw className="mr-1 size-3" /> Reactivate
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CarryForwardCard({ commitment, sessionId }: { commitment: EdgeReviewCommitmentDTO; sessionId: string }) {
  const [pending, startTransition] = useTransition();
  const [refining, setRefining] = useState(false);
  const [title, setTitle] = useState(commitment.title);
  const [description, setDescription] = useState(commitment.description ?? "");
  const [category, setCategory] = useState<CommitmentCategory>(commitment.category);
  const [priority, setPriority] = useState<CommitmentPriority>(commitment.priority);
  const lineage = useLineage(commitment.id);
  const [resolved, setResolved] = useState(false);

  if (resolved) return null;

  function doContinue() {
    startTransition(async () => {
      const result = await continueCommitment({ previousCommitmentId: commitment.id, sessionId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Carried forward unchanged.");
      setResolved(true);
    });
  }

  function doRefine() {
    startTransition(async () => {
      const result = await refineCommitment({
        previousCommitmentId: commitment.id,
        sessionId,
        category,
        title,
        description: description || null,
        priority,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Refined and carried forward.");
      setResolved(true);
    });
  }

  function resolve() {
    startTransition(async () => {
      const result = await setCommitmentStatus(commitment.id, { status: "COMPLETED" });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Marked resolved.");
      setResolved(true);
    });
  }

  function dismiss() {
    startTransition(async () => {
      const result = await setCommitmentStatus(commitment.id, { status: "RETIRED" });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setResolved(true);
    });
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">{commitment.category}</span>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", PRIORITY_CLASS[commitment.priority])}>{commitment.priority}</span>
      </div>

      {refining ? (
        <div className="space-y-1.5">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-7 text-xs" />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-xs" />
          <div className="flex gap-1.5">
            <Select items={CATEGORIES.map((c) => ({ value: c, label: c }))} value={category} onValueChange={(v) => v && setCategory(v as CommitmentCategory)}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select items={PRIORITIES.map((p) => ({ value: p, label: p }))} value={priority} onValueChange={(v) => v && setPriority(v as CommitmentPriority)}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <>
          <p className="font-medium">{commitment.title}</p>
          {commitment.description && <p className="text-muted-foreground">{commitment.description}</p>}
        </>
      )}

      <AdherenceLine lineage={lineage} />
      {lineage?.resolutionEligible && (
        <p className="rounded border border-success/30 bg-success/5 px-1.5 py-1 text-[10px] text-success">
          Adherence has stayed high across multiple periods — consider resolving instead of carrying forward.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {refining ? (
          <>
            <Button size="sm" className="h-7" disabled={pending || !title.trim()} onClick={doRefine}>
              {pending && <Loader2 className="mr-1 size-3 animate-spin" />} Save & Continue
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setRefining(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" className="h-7" disabled={pending} onClick={doContinue}>
              {pending && <Loader2 className="mr-1 size-3 animate-spin" />} Continue
            </Button>
            <Button size="sm" variant="outline" className="h-7" disabled={pending} onClick={() => setRefining(true)}>
              Refine
            </Button>
            <Button size="sm" variant="outline" className="h-7" disabled={pending} onClick={resolve}>
              Resolve
            </Button>
            <Button size="sm" variant="ghost" className="h-7" disabled={pending} onClick={dismiss}>
              Dismiss
            </Button>
            <CommitmentHistorySheet commitmentId={commitment.id} title={commitment.title} />
          </>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  sessionId,
  suggestion,
  onDismiss,
}: {
  sessionId: string;
  suggestion: SuggestedCommitment;
  onDismiss: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(suggestion.title);
  const [description, setDescription] = useState(suggestion.description);
  const [category, setCategory] = useState<CommitmentCategory>(suggestion.category);
  const [priority, setPriority] = useState<CommitmentPriority>(suggestion.priority);

  function add() {
    startTransition(async () => {
      const result = await acceptSuggestedCommitment(sessionId, {
        category,
        title,
        description: description || null,
        priority,
        ruleKey: suggestion.ruleKey,
        evidence: suggestion.evidence,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Commitment added.");
    });
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">{suggestion.category}</span>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", PRIORITY_CLASS[suggestion.priority])}>{suggestion.priority}</span>
        <span className="text-[10px] text-primary">Suggested commitment</span>
      </div>

      {editing ? (
        <div className="space-y-1.5">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-7 text-xs" />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-xs" />
          <div className="flex gap-1.5">
            <Select items={CATEGORIES.map((c) => ({ value: c, label: c }))} value={category} onValueChange={(v) => v && setCategory(v as CommitmentCategory)}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select items={PRIORITIES.map((p) => ({ value: p, label: p }))} value={priority} onValueChange={(v) => v && setPriority(v as CommitmentPriority)}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <>
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground">{description}</p>
        </>
      )}

      <div>
        <p className="text-[10px] font-medium uppercase text-muted-foreground/70">Evidence</p>
        <ul className="list-inside list-disc text-[11px] text-muted-foreground/80">
          {suggestion.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button size="sm" className="h-7" disabled={pending} onClick={add}>
          {pending && <Loader2 className="mr-1 size-3 animate-spin" />} Add
        </Button>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Edit"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function ManualCommitmentForm({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<CommitmentCategory>("PROCESS");
  const [priority, setPriority] = useState<CommitmentPriority>("MEDIUM");

  function submit() {
    if (!title.trim()) return;
    startTransition(async () => {
      const result = await createManualCommitment(sessionId, { category, title, description: description || null, priority });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setTitle("");
      setDescription("");
      setOpen(false);
      toast.success("Commitment added.");
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> Add Commitment
      </Button>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 p-2.5">
      <Input placeholder="Title — e.g. 'No SL widening'" value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-xs" />
      <Textarea placeholder="Short description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-xs" />
      <div className="flex gap-1.5">
        <Select items={CATEGORIES.map((c) => ({ value: c, label: c }))} value={category} onValueChange={(v) => v && setCategory(v as CommitmentCategory)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={PRIORITIES.map((p) => ({ value: p, label: p }))} value={priority} onValueChange={(v) => v && setPriority(v as CommitmentPriority)}>
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" disabled={pending || !title.trim()} onClick={submit}>
          {pending && <Loader2 className="mr-1 size-3 animate-spin" />} Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
