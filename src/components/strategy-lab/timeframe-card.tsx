"use client";

import { useState, useTransition, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, GripVertical, Loader2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagDot, colorForName } from "@/components/ui/tag";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CheckpointList } from "@/components/strategy-lab/checkpoint-list";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { archiveTimeframe, renameTimeframe } from "@/actions/timeframes.actions";
import type { TimeframeDTO } from "@/types/strategies";

export function TimeframeCard({
  strategyId,
  timeframe,
  dragHandleProps,
  isDragging,
}: {
  strategyId: string;
  timeframe: TimeframeDTO;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);
  const [name, setName] = useState(timeframe.name);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const nameSave = useDebouncedAutosave({
    value: name,
    serialize: (v) => v.trim(),
    save: async (v) => {
      if (!v.trim()) return { success: false, error: "" };
      return renameTimeframe(strategyId, timeframe.id, { name: v });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  function handleDelete() {
    startDelete(async () => {
      const result = await archiveTimeframe(strategyId, timeframe.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  const count = timeframe.checkpoints.length;

  return (
    <div
      className={cn(
        "glass rounded-2xl p-3 transition-shadow",
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

        <TagDot color={colorForName(name || "timeframe")} className="shrink-0" />

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Timeframe (e.g. Daily)"
          aria-label="Timeframe name"
          className="h-8 flex-1 border-transparent bg-transparent px-1.5 font-semibold shadow-none focus-visible:border-input focus-visible:bg-background/50"
        />

        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {count} checkpoint{count === 1 ? "" : "s"}
        </span>
        <span className="w-5 shrink-0">
          {nameSave === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {nameSave === "saved" && <Check className="size-3.5 text-success" />}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? "Collapse timeframe" : "Expand timeframe"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete timeframe"
          onClick={() => setConfirmOpen(true)}
          disabled={isDeleting}
        >
          <Trash2 />
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-border pt-3 pl-6">
          <CheckpointList
            strategyId={strategyId}
            timeframeId={timeframe.id}
            initialCheckpoints={timeframe.checkpoints}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this timeframe?"
        description={`"${name || "This timeframe"}" and its ${count} checkpoint${count === 1 ? "" : "s"} will be removed. This can't be undone from here.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
