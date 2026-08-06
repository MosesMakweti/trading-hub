"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Clock, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import type { TagColor } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tag } from "@/components/ui/tag";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ColorPicker } from "@/components/strategy-lab/sot/color-picker";
import {
  createStrategySession,
  deleteStrategySession,
  updateStrategySession,
} from "@/actions/strategy-sot.actions";

export interface StrategySessionDTO {
  id: string;
  name: string;
  color: TagColor;
  startMinutes: number | null;
  endMinutes: number | null;
  enabled: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toTime = (m: number | null) => (m == null ? "" : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
const fromTime = (s: string): number | null => {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const rangeLabel = (s: StrategySessionDTO) =>
  s.startMinutes == null && s.endMinutes == null ? null : `${toTime(s.startMinutes) || "—"}–${toTime(s.endMinutes) || "—"}`;

interface Draft {
  name: string;
  color: TagColor;
  start: string;
  end: string;
  enabled: boolean;
}
const empty: Draft = { name: "", color: "GRAY", start: "", end: "", enabled: true };

export function StrategySessionsSection({
  strategyId,
  initialSessions,
}: {
  strategyId: string;
  initialSessions: StrategySessionDTO[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function reset() {
    setEditingId(null);
    setAdding(false);
    setDraft(empty);
  }

  function submit() {
    const name = draft.name.trim();
    if (!name) return;
    const payload = {
      name,
      color: draft.color,
      startMinutes: fromTime(draft.start),
      endMinutes: fromTime(draft.end),
      enabled: draft.enabled,
    };
    start(async () => {
      const result = editingId
        ? await updateStrategySession(editingId, strategyId, payload)
        : await createStrategySession(strategyId, payload);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  function doDelete() {
    if (!confirmId) return;
    start(async () => {
      const result = await deleteStrategySession(confirmId, strategyId);
      setConfirmId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2.5">
      {initialSessions.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          No sessions defined yet. Add the windows you trade this strategy in.
        </p>
      )}

      {initialSessions.map((s) =>
        editingId === s.id ? (
          <SessionForm key={s.id} draft={draft} setDraft={setDraft} onSave={submit} onCancel={reset} isPending={isPending} />
        ) : (
          <div key={s.id} className="glass flex items-center gap-3 rounded-xl px-3 py-2.5">
            <Tag color={s.color} muted={!s.enabled}>
              {s.name}
            </Tag>
            {rangeLabel(s) && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <Clock className="size-3" /> {rangeLabel(s)}
              </span>
            )}
            {!s.enabled && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <EyeOff className="size-3" /> disabled
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit session" disabled={isPending} onClick={() => { setEditingId(s.id); setAdding(false); setDraft({ name: s.name, color: s.color, start: toTime(s.startMinutes), end: toTime(s.endMinutes), enabled: s.enabled }); }}>
                <Pencil />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete session" disabled={isPending} onClick={() => setConfirmId(s.id)}>
                <Trash2 />
              </Button>
            </div>
          </div>
        ),
      )}

      {adding ? (
        <SessionForm draft={draft} setDraft={setDraft} onSave={submit} onCancel={reset} isPending={isPending} />
      ) : (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={isPending} onClick={() => { setAdding(true); setEditingId(null); setDraft(empty); }}>
          <Plus className="size-3.5" />
          Add session
        </Button>
      )}

      <ConfirmDialog
        open={confirmId != null}
        onOpenChange={(o) => !o && setConfirmId(null)}
        title="Delete this session?"
        description="It's removed from the strategy. Past trades keep their recorded copy."
        confirmLabel="Delete"
        variant="destructive"
        isPending={isPending}
        onConfirm={doDelete}
      />
    </div>
  );
}

function SessionForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  isPending,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <form className="glass space-y-2.5 rounded-xl p-3" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <div className="flex flex-wrap items-center gap-2">
        <Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. London Open" className="h-8 min-w-40 flex-1" />
        <ColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>From</span>
        <Input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className="h-8 w-32 tabular-nums" aria-label="Session start" />
        <span>to</span>
        <Input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className="h-8 w-32 tabular-nums" aria-label="Session end" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={draft.enabled} onCheckedChange={(c) => setDraft({ ...draft, enabled: c === true })} />
          Enabled
        </label>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
            <X className="size-3.5" /> Cancel
          </Button>
          <Button type="submit" size="sm" className="gap-1.5" disabled={isPending}>
            <Check className="size-3.5" /> Save
          </Button>
        </div>
      </div>
    </form>
  );
}
