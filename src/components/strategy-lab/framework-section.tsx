"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ListOrdered, Plus, X } from "lucide-react";
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
import { FrameworkStepCard } from "@/components/strategy-lab/framework-step-card";
import { createFrameworkStep, reorderFrameworkSteps } from "@/actions/framework.actions";
import type { FrameworkStepDTO } from "@/types/strategies";

export function FrameworkSection({
  strategyId,
  initialSteps,
}: {
  strategyId: string;
  initialSteps: FrameworkStepDTO[];
}) {
  const router = useRouter();
  const [order, setOrder] = useState<string[] | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const steps = order
    ? (order.map((id) => initialSteps.find((s) => s.id === id)).filter(Boolean) as FrameworkStepDTO[])
    : initialSteps;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = steps.map((s) => s.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    startTransition(async () => {
      const result = await reorderFrameworkSteps({ strategyId, orderedIds: next });
      if (!result.success) toast.error(result.error);
      router.refresh();
      setOrder(null);
    });
  }

  function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    startTransition(async () => {
      const result = await createFrameworkStep(strategyId, { title });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setNewTitle("");
      setIsAdding(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Your decision process, in order — the steps you run through on every setup.
        {steps.length > 0 && (
          <span className="ml-1 text-muted-foreground/70">
            {steps.length} step{steps.length === 1 ? "" : "s"}.
          </span>
        )}
      </p>

      {steps.length === 0 && !isAdding ? (
        <EmptyState
          icon={ListOrdered}
          title="No steps yet"
          description="Lay out your process step by step — Determine HTF bias, Identify liquidity, Mark areas of interest, Wait for session, Confirm, Execute, Manage."
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {steps.map((step, index) => (
                <SortableStep
                  key={step.id}
                  strategyId={strategyId}
                  step={step}
                  stepNumber={index + 1}
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
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="e.g. Determine HTF bias"
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
              setNewTitle("");
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
          Add step
        </Button>
      )}
    </div>
  );
}

function SortableStep({
  strategyId,
  step,
  stepNumber,
}: {
  strategyId: string;
  step: FrameworkStepDTO;
  stepNumber: number;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: step.id,
  });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <FrameworkStepCard
        strategyId={strategyId}
        step={step}
        stepNumber={stepNumber}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}
