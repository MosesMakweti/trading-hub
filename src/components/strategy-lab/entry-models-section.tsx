"use client";

import { useState, useTransition, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Crosshair, Plus, X } from "lucide-react";
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
import { EntryModelCard } from "@/components/strategy-lab/entry-model-card";
import { createEntryModel, reorderEntryModels } from "@/actions/strategy-entry-models.actions";
import type { EntryModelDTO } from "@/types/strategies";

export function EntryModelsSection({
  strategyId,
  initialModels,
}: {
  strategyId: string;
  initialModels: EntryModelDTO[];
}) {
  const router = useRouter();
  const [order, setOrder] = useState<string[] | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const models = order
    ? (order.map((id) => initialModels.find((m) => m.id === id)).filter(Boolean) as EntryModelDTO[])
    : initialModels;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = models.map((m) => m.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    startTransition(async () => {
      const result = await reorderEntryModels({ strategyId, orderedIds: next });
      if (!result.success) toast.error(result.error);
      router.refresh();
      setOrder(null);
    });
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createEntryModel(strategyId, { name });
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
        The specific ways you enter — each with its own conditions and rules.
        {models.length > 0 && (
          <span className="ml-1 text-muted-foreground/70">
            {models.length} model{models.length === 1 ? "" : "s"}.
          </span>
        )}
      </p>

      {models.length === 0 && !isAdding ? (
        <EmptyState
          icon={Crosshair}
          title="No entry models yet"
          description="Document how you enter — 1-Minute Order Block, Liquidity Sweep, London Session Reversal, and so on."
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={models.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {models.map((model) => (
                <SortableEntryModel key={model.id} strategyId={strategyId} model={model} />
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
            placeholder="e.g. Liquidity Sweep Entry"
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
          Add entry model
        </Button>
      )}
    </div>
  );
}

function SortableEntryModel({
  strategyId,
  model,
}: {
  strategyId: string;
  model: EntryModelDTO;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: model.id,
  });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <EntryModelCard
        strategyId={strategyId}
        model={model}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}
