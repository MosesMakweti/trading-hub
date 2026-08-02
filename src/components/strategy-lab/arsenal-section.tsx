"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Boxes, Check, Plus, X } from "lucide-react";
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
import { ArsenalConceptCard } from "@/components/strategy-lab/arsenal-concept-card";
import { createArsenalConcept, reorderArsenalConcepts } from "@/actions/arsenal.actions";
import type { ArsenalConceptDTO } from "@/types/strategies";

export function ArsenalSection({
  strategyId,
  initialConcepts,
}: {
  strategyId: string;
  initialConcepts: ArsenalConceptDTO[];
}) {
  const router = useRouter();
  const [order, setOrder] = useState<string[] | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const concepts = order
    ? (order.map((id) => initialConcepts.find((c) => c.id === id)).filter(Boolean) as ArsenalConceptDTO[])
    : initialConcepts;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = concepts.map((c) => c.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    startTransition(async () => {
      const result = await reorderArsenalConcepts({ strategyId, orderedIds: next });
      if (!result.success) toast.error(result.error);
      router.refresh();
      setOrder(null);
    });
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createArsenalConcept(strategyId, { name });
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Your toolbox of concepts — the building blocks this strategy relies on.
          {concepts.length > 0 && (
            <span className="ml-1 text-muted-foreground/70">
              {concepts.length} concept{concepts.length === 1 ? "" : "s"}.
            </span>
          )}
        </p>
      </div>

      {concepts.length === 0 && !isAdding ? (
        <EmptyState
          icon={Boxes}
          title="No concepts yet"
          description="Add the concepts this strategy is built on — Fair Value Gaps, Liquidity, Order Blocks, Market Structure, anything."
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={concepts.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {concepts.map((concept) => (
                <SortableConcept key={concept.id} strategyId={strategyId} concept={concept} />
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
            placeholder="e.g. Fair Value Gap"
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
          Add concept
        </Button>
      )}
    </div>
  );
}

function SortableConcept({
  strategyId,
  concept,
}: {
  strategyId: string;
  concept: ArsenalConceptDTO;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: concept.id,
  });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <ArsenalConceptCard
        strategyId={strategyId}
        concept={concept}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}
