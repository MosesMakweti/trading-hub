"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SortableList } from "@/components/plan/sortable-list";
import {
  archiveTradingSession,
  createTradingSession,
  reorderTradingSessions,
  updateTradingSession,
} from "@/actions/trading-sessions.actions";

type TradingSession = {
  id: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  maxDailyTradingMinutes: number | null;
  maxTradesPerDay: number | null;
};

interface Draft {
  name: string;
  startTime: string;
  endTime: string;
  maxDailyTradingMinutes: string;
  maxTradesPerDay: string;
}

const emptyDraft: Draft = {
  name: "",
  startTime: "08:00",
  endTime: "11:00",
  maxDailyTradingMinutes: "",
  maxTradesPerDay: "",
};

function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function TradingSessionsSection({ initialItems }: { initialItems: TradingSession[] }) {
  const router = useRouter();
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [isPending, startTransition] = useTransition();

  const items = localOrder
    ? (localOrder
        .map((id) => initialItems.find((i) => i.id === id))
        .filter(Boolean) as TradingSession[])
    : initialItems;

  function reset() {
    setDraft(emptyDraft);
    setIsAdding(false);
    setEditingId(null);
  }

  function startEdit(session: TradingSession) {
    setDraft({
      name: session.name,
      startTime: minutesToTime(session.startMinutes),
      endTime: minutesToTime(session.endMinutes),
      maxDailyTradingMinutes: session.maxDailyTradingMinutes?.toString() ?? "",
      maxTradesPerDay: session.maxTradesPerDay?.toString() ?? "",
    });
    setEditingId(session.id);
    setIsAdding(false);
  }

  function handleSubmit() {
    const payload = {
      name: draft.name,
      startMinutes: timeToMinutes(draft.startTime),
      endMinutes: timeToMinutes(draft.endTime),
      maxDailyTradingMinutes: draft.maxDailyTradingMinutes
        ? Number(draft.maxDailyTradingMinutes)
        : null,
      maxTradesPerDay: draft.maxTradesPerDay ? Number(draft.maxTradesPerDay) : null,
    };

    startTransition(async () => {
      const result = editingId
        ? await updateTradingSession(editingId, payload)
        : await createTradingSession(payload);

      if (!result.success) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      reset();
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await archiveTradingSession(id);
      if (!result.success) {
        toast.error(result.error ?? "Failed to remove.");
        return;
      }
      router.refresh();
    });
  }

  function handleReorder(orderedIds: string[]) {
    setLocalOrder(orderedIds);
    startTransition(async () => {
      const result = await reorderTradingSessions({ orderedIds });
      if (!result.success) toast.error(result.error ?? "Failed to reorder.");
      router.refresh();
      setLocalOrder(null);
    });
  }

  return (
    <div className="space-y-3">
      <SortableList
        items={items}
        onReorder={handleReorder}
        emptyMessage="No trading sessions defined yet."
        renderItem={(session) =>
          editingId === session.id ? (
            <SessionForm
              draft={draft}
              setDraft={setDraft}
              onSubmit={handleSubmit}
              onCancel={reset}
              isPending={isPending}
            />
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-medium">{session.name}</span>{" "}
                <span className="text-muted-foreground">
                  {minutesToTime(session.startMinutes)}–{minutesToTime(session.endMinutes)}
                  {session.maxTradesPerDay != null &&
                    ` · max ${session.maxTradesPerDay} trades/day`}
                  {session.maxDailyTradingMinutes != null &&
                    ` · max ${session.maxDailyTradingMinutes}min/day`}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => startEdit(session)}
                  disabled={isPending}
                >
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDelete(session.id)}
                  disabled={isPending}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          )
        }
      />

      {isAdding ? (
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <SessionForm
            draft={draft}
            setDraft={setDraft}
            onSubmit={handleSubmit}
            onCancel={reset}
            isPending={isPending}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setDraft(emptyDraft);
            setIsAdding(true);
            setEditingId(null);
          }}
        >
          <Plus className="size-3.5" />
          Add session
        </Button>
      )}
    </div>
  );
}

function SessionForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  isPending,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <form
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="col-span-2 space-y-1 sm:col-span-3">
        <Label className="text-xs">Session name</Label>
        <Input
          autoFocus
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. London Open"
          className="h-8"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Start time</Label>
        <Input
          type="time"
          value={draft.startTime}
          onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
          className="h-8"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">End time</Label>
        <Input
          type="time"
          value={draft.endTime}
          onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
          className="h-8"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Max trades/day</Label>
        <Input
          type="number"
          min={0}
          value={draft.maxTradesPerDay}
          onChange={(e) => setDraft({ ...draft, maxTradesPerDay: e.target.value })}
          className="h-8"
        />
      </div>
      <div className="col-span-2 space-y-1 sm:col-span-2">
        <Label className="text-xs">Max daily trading time (minutes)</Label>
        <Input
          type="number"
          min={0}
          value={draft.maxDailyTradingMinutes}
          onChange={(e) => setDraft({ ...draft, maxDailyTradingMinutes: e.target.value })}
          className="h-8"
        />
      </div>
      <div className="flex items-end gap-1">
        <Button type="submit" variant="ghost" size="icon-sm" disabled={isPending}>
          <Check />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onCancel} disabled={isPending}>
          <X />
        </Button>
      </div>
    </form>
  );
}
