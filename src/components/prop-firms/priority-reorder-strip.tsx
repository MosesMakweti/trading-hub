"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, GripVertical, Star } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PropFirmLogo } from "@/components/prop-firms/prop-firm-logo";
import { reorderPriorityFirmsAction } from "@/actions/prop-firms.actions";
import type { UserPropFirmDTO } from "@/types/prop-firms";

/**
 * Drag-or-accessible reorder for priority firms. `listUserPropFirms`
 * already sorts priority firms first by `priorityOrder`, so this strip's
 * only job is to let the trader change that order — up/down buttons are the
 * primary, keyboard/screen-reader-operable path; the drag handle is a
 * pointer-only convenience on top of the same `move`/`persist` logic.
 */
export function PriorityReorderStrip({ firms }: { firms: UserPropFirmDTO[] }) {
  const router = useRouter();
  const [items, setItems] = useState(firms);
  const [syncedIdsKey, setSyncedIdsKey] = useState(() => firms.map((f) => f.id).join("|"));
  const [isPending, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const idsKey = firms.map((f) => f.id).join("|");
  if (idsKey !== syncedIdsKey) {
    setSyncedIdsKey(idsKey);
    setItems(firms);
  }

  if (items.length < 2) return null;

  function persist(ordered: UserPropFirmDTO[]) {
    setItems(ordered);
    startTransition(async () => {
      const result = await reorderPriorityFirmsAction({ orderedIds: ordered.map((f) => f.id) });
      if (!result.success) toast.error(result.error);
      router.refresh();
    });
  }

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    persist(reordered);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((f) => f.id === active.id);
    const newIndex = items.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    persist(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <div className="glass space-y-2 rounded-2xl p-3">
      <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        <Star className="size-3.5 fill-warning text-warning" />
        Priority order
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {items.map((firm, index) => (
              <Row
                key={firm.id}
                firm={firm}
                index={index}
                count={items.length}
                disabled={isPending}
                onMove={move}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function Row({
  firm,
  index,
  count,
  disabled,
  onMove,
}: {
  firm: UserPropFirmDTO;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: firm.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2.5 py-1.5",
        isDragging && "opacity-60",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={`Drag to reorder ${firm.companyName}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <PropFirmLogo name={firm.companyName} logoUrl={firm.logoUrl} accentColor={firm.accentColor} className="size-6" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{firm.companyName}</span>
      <span className="text-xs text-muted-foreground">{firm.marketCategory}</span>
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || index === 0}
          title="Move up"
          aria-label={`Move ${firm.companyName} up in priority`}
          onClick={() => onMove(index, -1)}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || index === count - 1}
          title="Move down"
          aria-label={`Move ${firm.companyName} down in priority`}
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown className="size-4" />
        </Button>
      </div>
    </div>
  );
}
