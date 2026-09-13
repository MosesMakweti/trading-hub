"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Plus, RotateCcw, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  acceptSuggestedCommitment,
  createManualCommitment,
  setCommitmentStatus,
  updateCommitment,
} from "@/actions/edge-improvements.actions";
import type { CommitmentCategory, CommitmentPriority, SuggestedCommitment } from "@/domain/replay-improvements/types";
import type { EdgeReviewCommitmentDTO } from "@/types/edge-improvements";

const CATEGORIES: CommitmentCategory[] = ["EXECUTION", "BEHAVIOR", "PROCESS", "OPPORTUNITY", "STRATEGY", "RISK"];
const PRIORITIES: CommitmentPriority[] = ["HIGH", "MEDIUM", "LOW"];

const PRIORITY_CLASS: Record<CommitmentPriority, string> = {
  HIGH: "bg-danger/15 text-danger",
  MEDIUM: "bg-warning/15 text-warning",
  LOW: "bg-secondary text-secondary-foreground",
};

/**
 * Improvement Commitments (Stage 16 §6-14) — durable, trader-approved
 * commitments plus rule-based suggestions the trader must explicitly
 * Add/Edit/Dismiss (§9). Never auto-creates anything.
 */
export function EdgeCommitmentsPanel({
  sessionId,
  commitments,
  suggestions,
}: {
  sessionId: string;
  commitments: EdgeReviewCommitmentDTO[];
  suggestions: SuggestedCommitment[];
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const acceptedRuleKeys = new Set(commitments.filter((c) => c.sourceFindingType != null).map((c) => c.sourceFindingType));
  const visibleSuggestions = suggestions.filter((s) => !dismissed.has(s.ruleKey) && !acceptedRuleKeys.has(s.ruleKey));

  return (
    <div className="glass space-y-4 rounded-2xl p-4">
      <h3 className="text-sm font-semibold">Improvement Commitments</h3>

      {commitments.length > 0 && (
        <div className="space-y-2">
          {commitments.map((c) => (
            <CommitmentCard key={c.id} commitment={c} />
          ))}
        </div>
      )}

      {visibleSuggestions.length > 0 && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="text-xs font-medium text-muted-foreground uppercase">Suggested</p>
          {visibleSuggestions.map((s) => (
            <SuggestionCard key={s.ruleKey} sessionId={sessionId} suggestion={s} onDismiss={() => setDismissed((prev) => new Set(prev).add(s.ruleKey))} />
          ))}
        </div>
      )}

      <ManualCommitmentForm sessionId={sessionId} />
    </div>
  );
}

function CommitmentCard({ commitment }: { commitment: EdgeReviewCommitmentDTO }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(commitment.title);
  const [description, setDescription] = useState(commitment.description ?? "");

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
          <div className="flex flex-wrap gap-1 pt-1">
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 size-3" /> Edit
            </Button>
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
