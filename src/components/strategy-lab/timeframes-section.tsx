"use client";

import { useState, useTransition, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Clock, Plus, X } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { TimeframeCard } from "@/components/strategy-lab/timeframe-card";
import { createTimeframe, reorderTimeframes } from "@/actions/timeframes.actions";
import type { TimeframeDTO } from "@/types/strategies";

export function TimeframesSection({
  strategyId,
  initialTimeframes,
}: {
  strategyId: string;
  initialTimeframes: TimeframeDTO[];
}) {
  const router = useRouter();
  const [order, setOrder] = useState<string[] | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const timeframes = order
    ? (order.map((id) => initialTimeframes.find((t) => t.id === id)).filter(Boolean) as TimeframeDTO[])
    : initialTimeframes;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = timeframes.map((t) => t.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    startTransition(async () => {
      const result = await reorderTimeframes({ strategyId, orderedIds: next });
      if (!result.success) toast.error(result.error);
      router.refresh();
      setOrder(null);
    });
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createTimeframe(strategyId, { name });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setNewName("");
      setIsAdding(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        What you look for on each timeframe, from the top down.
        {timeframes.length > 0 && (
          <span className="ml-1 text-muted-foreground/70">
            {timeframes.length} timeframe{timeframes.length === 1 ? "" : "s"}.
          </span>
        )}
      </p>

      {timeframes.length === 0 && !isAdding ? (
        <EmptyState
          icon={Clock}
          title="No timeframes yet"
          description="Add the timeframes you analyze — Monthly, Weekly, Daily, H4, M15 — then list what to check on each."
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={timeframes.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {timeframes.map((timeframe) => (
                <SortableTimeframe
                  key={timeframe.id}
                  strategyId={strategyId}
                  timeframe={timeframe}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {isAdding ? (
        <form
          className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2 py-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
        >
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Daily"
            className="h-8 flex-1"
          />
          <Button type="submit" variant="ghost" size="icon-sm" aria-label="Add" disabled={isPending}>
            <Check />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel"
            onClick={() => {
              setIsAdding(false);
              setNewName("");
            }}
            disabled={isPending}
          >
            <X />
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setIsAdding(true)}
        >
          <Plus className="size-3.5" />
          Add timeframe
        </Button>
      )}
    </div>
  );
}

function SortableTimeframe({
  strategyId,
  timeframe,
}: {
  strategyId: string;
  timeframe: TimeframeDTO;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: timeframe.id,
  });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <TimeframeCard
        strategyId={strategyId}
        timeframe={timeframe}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}
