"use client";

import { useState, useTransition, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, GripVertical, Loader2, Plus, Trash2, X } from "lucide-react";
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

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import {
  archiveCheckpoint,
  createCheckpoint,
  reorderCheckpoints,
  updateCheckpoint,
} from "@/actions/timeframes.actions";
import type { CheckpointRichField } from "@/lib/validation/timeframes";
import type { CheckpointDTO } from "@/types/strategies";

const FIELDS: { key: CheckpointRichField; label: string; placeholder: string }[] = [
  { key: "description", label: "Description", placeholder: "What are you looking for here?" },
  { key: "notes", label: "Notes (optional)", placeholder: "Caveats, reminders, edge cases." },
];

export function CheckpointList({
  strategyId,
  timeframeId,
  initialCheckpoints,
}: {
  strategyId: string;
  timeframeId: string;
  initialCheckpoints: CheckpointDTO[];
}) {
  const router = useRouter();
  const [order, setOrder] = useState<string[] | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const checkpoints = order
    ? (order.map((id) => initialCheckpoints.find((c) => c.id === id)).filter(Boolean) as CheckpointDTO[])
    : initialCheckpoints;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = checkpoints.map((c) => c.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    startTransition(async () => {
      const result = await reorderCheckpoints(strategyId, { timeframeId, orderedIds: next });
      if (!result.success) toast.error(result.error);
      router.refresh();
      setOrder(null);
    });
  }

  function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    startTransition(async () => {
      const result = await createCheckpoint(strategyId, timeframeId, { title });
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
    <div className="space-y-2">
      {checkpoints.length === 0 && !isAdding ? (
        <p className="text-xs text-muted-foreground">
          No checkpoints yet — add what to look for on this timeframe.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={checkpoints.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {checkpoints.map((checkpoint) => (
                <SortableCheckpoint
                  key={checkpoint.id}
                  strategyId={strategyId}
                  checkpoint={checkpoint}
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
            placeholder="e.g. Determine trend"
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
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => setIsAdding(true)}
        >
          <Plus className="size-3.5" />
          Add checkpoint
        </Button>
      )}
    </div>
  );
}

function SortableCheckpoint({
  strategyId,
  checkpoint,
}: {
  strategyId: string;
  checkpoint: CheckpointDTO;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: checkpoint.id,
  });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <CheckpointCard
        strategyId={strategyId}
        checkpoint={checkpoint}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}

type Fields = Record<CheckpointRichField, unknown>;

function CheckpointCard({
  strategyId,
  checkpoint,
  dragHandleProps,
  isDragging,
}: {
  strategyId: string;
  checkpoint: CheckpointDTO;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(checkpoint.title);
  const [fields, setFields] = useState<Fields>(() => ({
    description: checkpoint.description,
    notes: checkpoint.notes,
  }));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const titleSave = useDebouncedAutosave({
    value: title,
    serialize: (v) => v.trim(),
    save: async (v) => {
      if (!v.trim()) return { success: false, error: "" };
      return updateCheckpoint(strategyId, checkpoint.id, { title: v });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  function saveField(key: CheckpointRichField) {
    return async (content: object) => {
      setFields((f) => ({ ...f, [key]: content }));
      return updateCheckpoint(strategyId, checkpoint.id, { [key]: content });
    };
  }

  function handleDelete() {
    startDelete(async () => {
      const result = await archiveCheckpoint(strategyId, checkpoint.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-background/40 p-2.5 transition-shadow",
        isDragging && "opacity-70 shadow-elevated",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...dragHandleProps}
        >
          <GripVertical className="size-4" />
        </button>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Checkpoint title"
          aria-label="Checkpoint title"
          className="h-7 flex-1 border-transparent bg-transparent px-1.5 text-sm shadow-none focus-visible:border-input focus-visible:bg-background/50"
        />
        <span className="w-5 shrink-0">
          {titleSave === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {titleSave === "saved" && <Check className="size-3.5 text-success" />}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? "Collapse checkpoint" : "Expand checkpoint"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete checkpoint"
          onClick={() => setConfirmOpen(true)}
          disabled={isDeleting}
        >
          <Trash2 />
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-4 border-t border-border pt-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <RichTextEditor
                initialContent={fields[f.key]}
                placeholder={f.placeholder}
                onSave={saveField(f.key)}
              />
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this checkpoint?"
        description={`"${title || "This checkpoint"}" will be removed. This can't be undone from here.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
