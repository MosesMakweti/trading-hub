"use client";

import { useState, useTransition, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
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
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import {
  archivePartialTakeProfit,
  createPartialTakeProfit,
  reorderPartialTakeProfits,
  updatePartialTakeProfit,
} from "@/actions/strategy-trade-management.actions";
import type { PartialTakeProfitDTO } from "@/types/strategies";

export function PartialTpList({
  strategyId,
  tradeManagementId,
  initialLevels,
}: {
  strategyId: string;
  tradeManagementId: string;
  initialLevels: PartialTakeProfitDTO[];
}) {
  const router = useRouter();
  const [order, setOrder] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const levels = order
    ? (order.map((id) => initialLevels.find((l) => l.id === id)).filter(Boolean) as PartialTakeProfitDTO[])
    : initialLevels;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = levels.map((l) => l.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    startTransition(async () => {
      const result = await reorderPartialTakeProfits(strategyId, { tradeManagementId, orderedIds: next });
      if (!result.success) toast.error(result.error);
      router.refresh();
      setOrder(null);
    });
  }

  function handleAdd() {
    startTransition(async () => {
      const result = await createPartialTakeProfit(strategyId, tradeManagementId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {levels.length === 0 ? (
        <p className="text-xs text-muted-foreground">No partial take-profit levels yet.</p>
      ) : (
        <>
          <div className="hidden grid-cols-[1.5rem_1fr_7rem_1fr_2.75rem] gap-2 px-1 text-[11px] text-muted-foreground sm:grid">
            <span />
            <span>Trigger</span>
            <span>% to close</span>
            <span>Reason</span>
            <span />
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={levels.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {levels.map((level) => (
                  <SortableLevel key={level.id} strategyId={strategyId} level={level} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={handleAdd}
        disabled={isPending}
      >
        <Plus className="size-3.5" />
        Add level
      </Button>
    </div>
  );
}

function SortableLevel({
  strategyId,
  level,
}: {
  strategyId: string;
  level: PartialTakeProfitDTO;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: level.id,
  });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <PartialTpRow
        strategyId={strategyId}
        level={level}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}

function PartialTpRow({
  strategyId,
  level,
  dragHandleProps,
  isDragging,
}: {
  strategyId: string;
  level: PartialTakeProfitDTO;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}) {
  const router = useRouter();
  const [trigger, setTrigger] = useState(level.trigger ?? "");
  const [percent, setPercent] = useState(level.percentToClose?.toString() ?? "");
  const [reason, setReason] = useState(level.reason ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const saveState = useDebouncedAutosave({
    value: { trigger, percent, reason },
    serialize: (v) => JSON.stringify([v.trigger.trim(), v.percent.trim(), v.reason.trim()]),
    save: async (v) => {
      const pct = v.percent.trim();
      const num = pct === "" ? null : Number(pct);
      if (num !== null && (Number.isNaN(num) || num < 0 || num > 100)) {
        return { success: false, error: "% to close must be 0–100." };
      }
      return updatePartialTakeProfit(strategyId, level.id, {
        trigger: v.trigger.trim() === "" ? null : v.trigger.trim(),
        percentToClose: num,
        reason: v.reason.trim() === "" ? null : v.reason.trim(),
      });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  function handleDelete() {
    startDelete(async () => {
      const result = await archivePartialTakeProfit(strategyId, level.id);
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
        "rounded-xl border border-border bg-background/40 p-2 transition-shadow",
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
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem_1fr]">
          <Input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="e.g. at 2R"
            aria-label="Trigger"
            className="h-8 text-sm"
          />
          <Input
            type="number"
            min={0}
            max={100}
            step="1"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            placeholder="% to close"
            aria-label="Percent to close"
            className="h-8 text-sm"
          />
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            aria-label="Reason"
            className="h-8 text-sm"
          />
        </div>
        <span className="w-5 shrink-0">
          {saveState === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {saveState === "saved" && <Check className="size-3.5 text-success" />}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete level"
          onClick={() => setConfirmOpen(true)}
          disabled={isDeleting}
        >
          <Trash2 />
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this level?"
        description="This partial take-profit level will be removed. This can't be undone from here."
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
