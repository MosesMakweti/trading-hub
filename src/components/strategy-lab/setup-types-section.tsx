"use client";

import { useState, useTransition, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Layers, Plus, X } from "lucide-react";
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
import { SetupTypeCard } from "@/components/strategy-lab/setup-type-card";
import { createSetupType, reorderSetupTypes } from "@/actions/strategy-setup-types.actions";
import type { StrategyChecklistItemDTO } from "@/components/strategy-lab/sot/strategy-checklist-section";
import type { StrategySetupTypeDTO } from "@/types/strategies";

/**
 * Setup Types — a Strategy Lab section that lets a trader name recognizable
 * setup structures ("Type A", "Type B", …) and, for each, curate a Bullish and
 * a Bearish scenario from the strategy's OWN confluence/execution catalog
 * (never a copy — see setup-type-card.tsx). This is a lens on the existing
 * checklist, not a second Strategy Lab: a strategy with no Setup Types keeps
 * working exactly as it did before this section existed.
 */
export function SetupTypesSection({
  strategyId,
  initialSetupTypes,
  availableConditions,
}: {
  strategyId: string;
  initialSetupTypes: StrategySetupTypeDTO[];
  /** The strategy's full confluence + execution catalog — each scenario's
   *  "add condition" picker filters this down by direction eligibility and
   *  by what's not already in that scenario. */
  availableConditions: StrategyChecklistItemDTO[];
}) {
  const router = useRouter();
  const [order, setOrder] = useState<string[] | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const setupTypes = order
    ? (order.map((id) => initialSetupTypes.find((t) => t.id === id)).filter(Boolean) as StrategySetupTypeDTO[])
    : initialSetupTypes;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = setupTypes.map((t) => t.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    startTransition(async () => {
      const result = await reorderSetupTypes(strategyId, { orderedIds: next });
      if (!result.success) toast.error(result.error);
      router.refresh();
      setOrder(null);
    });
  }

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createSetupType(strategyId, { name });
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
        Name the setup structures you recognize — each with a Bullish and a Bearish scenario built
        from this strategy&apos;s own confluences and execution confirmations.
        {setupTypes.length > 0 && (
          <span className="ml-1 text-muted-foreground/70">
            {setupTypes.length} setup type{setupTypes.length === 1 ? "" : "s"}.
          </span>
        )}
      </p>

      {setupTypes.length === 0 && !isAdding ? (
        <EmptyState
          icon={Layers}
          title="No setup types yet"
          description="e.g. Type A: sell-side liquidity swept + bullish displacement + MSS + FVG. Optional — a strategy works fine without them."
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={setupTypes.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {setupTypes.map((setupType) => (
                <SortableSetupType
                  key={setupType.id}
                  strategyId={strategyId}
                  setupType={setupType}
                  availableConditions={availableConditions}
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
            placeholder="e.g. Type A"
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
          Add setup type
        </Button>
      )}
    </div>
  );
}

function SortableSetupType({
  strategyId,
  setupType,
  availableConditions,
}: {
  strategyId: string;
  setupType: StrategySetupTypeDTO;
  availableConditions: StrategyChecklistItemDTO[];
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: setupType.id,
  });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <SetupTypeCard
        strategyId={strategyId}
        setupType={setupType}
        availableConditions={availableConditions}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}
