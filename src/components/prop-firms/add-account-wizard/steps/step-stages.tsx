"use client";

import { GripVertical, Plus, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StageTypeLike } from "@/domain/prop-firms/stage-templates";
import type { DraftStage } from "../types";

const STAGE_TYPE_LABELS: Record<StageTypeLike, string> = {
  PHASE_1: "Phase 1",
  PHASE_2: "Phase 2",
  PHASE_3: "Phase 3",
  VERIFICATION: "Verification",
  MASTER_FUNDED: "Master / Funded",
  PAYOUT_ELIGIBLE: "Payout-eligible",
  CUSTOM: "Custom",
};

export function StepStages({
  stages,
  onChange,
}: {
  stages: DraftStage[];
  onChange: (stages: DraftStage[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = stages.findIndex((s) => s.localId === active.id);
    const newIndex = stages.findIndex((s) => s.localId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(stages, oldIndex, newIndex));
  }

  function updateStage(localId: string, patch: Partial<DraftStage>) {
    onChange(stages.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));
  }

  function removeStage(localId: string) {
    onChange(stages.filter((s) => s.localId !== localId));
  }

  function addStage() {
    onChange([
      ...stages,
      {
        localId: typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36),
        name: `Stage ${stages.length + 1}`,
        type: "CUSTOM",
        rules: [],
      },
    ]);
  }

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={stages.map((s) => s.localId)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {stages.map((stage) => (
              <SortableStageRow
                key={stage.localId}
                stage={stage}
                canRemove={stages.length > 1}
                onUpdate={(patch) => updateStage(stage.localId, patch)}
                onRemove={() => removeStage(stage.localId)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addStage}>
        <Plus className="size-3.5" />
        Add stage
      </Button>
    </div>
  );
}

function SortableStageRow({
  stage,
  canRemove,
  onUpdate,
  onRemove,
}: {
  stage: DraftStage;
  canRemove: boolean;
  onUpdate: (patch: Partial<DraftStage>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.localId });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2.5 py-2",
        isDragging && "opacity-60",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={`Drag to reorder ${stage.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <Input
        value={stage.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
        aria-label="Stage name"
        className="h-8 flex-1"
      />
      <Select
        items={STAGE_TYPE_LABELS}
        value={stage.type}
        onValueChange={(v) => onUpdate({ type: v as StageTypeLike })}
      >
        <SelectTrigger className="h-8 w-44" aria-label="Stage type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(STAGE_TYPE_LABELS) as [StageTypeLike, string][]).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove ${stage.name}`}
        disabled={!canRemove}
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
