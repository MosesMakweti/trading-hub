"use client";

import { useState, useTransition, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, GripVertical, Loader2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SetupTypeScenarioPanel } from "@/components/strategy-lab/setup-type-scenario-panel";
import { archiveSetupType, updateSetupType } from "@/actions/strategy-setup-types.actions";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import type { StrategyChecklistItemDTO } from "@/components/strategy-lab/sot/strategy-checklist-section";
import type { StrategySetupTypeDTO } from "@/types/strategies";

export function SetupTypeCard({
  strategyId,
  setupType,
  availableConditions,
  dragHandleProps,
  isDragging,
}: {
  strategyId: string;
  setupType: StrategySetupTypeDTO;
  availableConditions: StrategyChecklistItemDTO[];
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(setupType.name);
  const [description, setDescription] = useState(setupType.description ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const nameSave = useDebouncedAutosave({
    value: name,
    serialize: (v) => v.trim(),
    save: async (v) => {
      if (!v.trim()) return { success: false, error: "" };
      return updateSetupType(strategyId, setupType.id, { name: v });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  const descriptionSave = useDebouncedAutosave({
    value: description,
    serialize: (v) => v.trim(),
    save: (v) => updateSetupType(strategyId, setupType.id, { description: v.trim() || null }),
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  function handleDelete() {
    startDelete(async () => {
      const result = await archiveSetupType(strategyId, setupType.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  const bullish = setupType.scenarios.find((s) => s.direction === "BULLISH");
  const bearish = setupType.scenarios.find((s) => s.direction === "BEARISH");
  const conditionCount = setupType.scenarios.reduce((sum, s) => sum + s.conditions.length, 0);

  return (
    <div className={cn("glass rounded-2xl p-3 transition-shadow", isDragging && "opacity-70 shadow-elevated")}>
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Setup type name"
          aria-label="Setup type name"
          className="h-8 flex-1 border-transparent bg-transparent px-1.5 font-medium shadow-none focus-visible:border-input focus-visible:bg-background/50"
        />

        {conditionCount > 0 && !expanded && (
          <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
            {conditionCount} condition{conditionCount === 1 ? "" : "s"}
          </span>
        )}

        <span className="w-4 shrink-0">
          {nameSave === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {nameSave === "saved" && <Check className="size-3.5 text-success" />}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? "Collapse setup type" : "Expand setup type"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete setup type"
          onClick={() => setConfirmOpen(true)}
          disabled={isDeleting}
        >
          <Trash2 />
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Description</Label>
              {descriptionSave === "saving" && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
              {descriptionSave === "saved" && <Check className="size-3 text-success" />}
            </div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Briefly, what characterizes this setup? (optional)"
              className="h-8 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {bullish && (
              <SetupTypeScenarioPanel
                strategyId={strategyId}
                scenario={bullish}
                availableConditions={availableConditions}
              />
            )}
            {bearish && (
              <SetupTypeScenarioPanel
                strategyId={strategyId}
                scenario={bearish}
                availableConditions={availableConditions}
              />
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this setup type?"
        description="This removes the setup type and its scenarios. The underlying confluences/execution confirmations stay in the strategy, completely untouched."
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
