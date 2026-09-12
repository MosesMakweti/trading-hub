"use client";

import { useState, useTransition, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical, Plus, X } from "lucide-react";
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
import { Tag } from "@/components/ui/tag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfluenceDirectionBadge } from "@/components/shared/confluence-direction-badge";
import { isEligibleForScenario } from "@/domain/strategies/setup-type-scoring";
import {
  addScenarioCondition,
  removeScenarioCondition,
  reorderScenarioConditions,
  updateScenarioCondition,
  updateScenarioDescription,
} from "@/actions/strategy-setup-types.actions";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { SaveDot } from "@/components/today/today-ui";
import type { StrategyChecklistItemDTO } from "@/components/strategy-lab/sot/strategy-checklist-section";
import type { StrategySetupConditionDTO, StrategySetupScenarioDTO } from "@/types/strategies";

const DIRECTION_LABEL = { BULLISH: "Bullish", BEARISH: "Bearish" } as const;

export function SetupTypeScenarioPanel({
  strategyId,
  scenario,
  availableConditions,
}: {
  strategyId: string;
  scenario: StrategySetupScenarioDTO;
  availableConditions: StrategyChecklistItemDTO[];
}) {
  const router = useRouter();
  const [description, setDescription] = useState(scenario.description ?? "");
  const [order, setOrder] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const descriptionSave = useDebouncedAutosave({
    value: description,
    serialize: (v) => v.trim(),
    save: (v) => updateScenarioDescription(strategyId, scenario.id, { description: v.trim() || null }),
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  const conditions = order
    ? (order.map((id) => scenario.conditions.find((c) => c.id === id)).filter(Boolean) as StrategySetupConditionDTO[])
    : scenario.conditions;

  const addedItemIds = new Set(conditions.map((c) => c.checklistItemId));
  const pickable = availableConditions.filter(
    (item) => !addedItemIds.has(item.id) && isEligibleForScenario(item.directionApplicability, scenario.direction),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = conditions.map((c) => c.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    startTransition(async () => {
      const result = await reorderScenarioConditions(strategyId, scenario.id, { orderedIds: next });
      if (!result.success) toast.error(result.error);
      router.refresh();
      setOrder(null);
    });
  }

  function handleAdd(checklistItemId: string | null) {
    if (!checklistItemId) return;
    startTransition(async () => {
      const result = await addScenarioCondition(strategyId, scenario.id, { checklistItemId });
      if (!result.success) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "space-y-2.5 rounded-xl border p-3",
        scenario.direction === "BULLISH" ? "border-success/25 bg-success/[0.03]" : "border-danger/25 bg-danger/[0.03]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-xs font-semibold uppercase tracking-wide",
            scenario.direction === "BULLISH" ? "text-success" : "text-danger",
          )}
        >
          {DIRECTION_LABEL[scenario.direction]} scenario
        </span>
        <SaveDot state={descriptionSave} />
      </div>

      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Optional short notes for this scenario…"
        className="h-8 bg-background/50 text-xs"
      />

      {conditions.length === 0 ? (
        <p className="text-xs text-muted-foreground/70 italic">
          No conditions yet — intentionally empty is fine if you don&apos;t trade this side.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={conditions.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {conditions.map((condition) => (
                <SortableConditionRow
                  key={condition.id}
                  strategyId={strategyId}
                  condition={condition}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {pickable.length > 0 && (
        <Select value="" onValueChange={handleAdd} disabled={isPending}>
          <SelectTrigger className="h-8 text-xs" aria-label={`Add condition to ${scenario.direction} scenario`}>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Plus className="size-3" />
              <SelectValue placeholder="Add a confluence or execution confirmation…" />
            </span>
          </SelectTrigger>
          <SelectContent>
            {pickable.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function SortableConditionRow({
  strategyId,
  condition,
}: {
  strategyId: string;
  condition: StrategySetupConditionDTO;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: condition.id,
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <ConditionRow
        strategyId={strategyId}
        condition={condition}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners } as HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}

function ConditionRow({
  strategyId,
  condition,
  isDragging,
  dragHandleProps,
}: {
  strategyId: string;
  condition: StrategySetupConditionDTO;
  isDragging?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
}) {
  const router = useRouter();
  const [weightDraft, setWeightDraft] = useState(
    condition.weightOverride == null ? "" : String(condition.weightOverride),
  );
  const [removing, setRemoving] = useState(false);
  const [savingMandatory, setSavingMandatory] = useState(false);

  const weightSave = useDebouncedAutosave({
    value: weightDraft,
    serialize: (v) => v.trim(),
    save: async (v) => {
      const t = v.trim();
      const num = t === "" ? null : Number(t);
      if (num !== null && (Number.isNaN(num) || num < 0 || num > 100)) {
        return { success: false, error: "Weight must be 0–100." };
      }
      const result = await updateScenarioCondition(strategyId, condition.id, { weightOverride: num });
      if (result.success) router.refresh();
      return result;
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  async function setMandatoryOverride(value: boolean | null) {
    setSavingMandatory(true);
    const result = await updateScenarioCondition(strategyId, condition.id, { mandatoryOverride: value });
    setSavingMandatory(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function remove() {
    setRemoving(true);
    const result = await removeScenarioCondition(strategyId, condition.id);
    setRemoving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 px-2 py-1.5 transition-shadow",
        isDragging && "opacity-70 shadow-elevated",
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...dragHandleProps}
      >
        <GripVertical className="size-3.5" />
      </button>

      <Tag color={condition.color}>{condition.name}</Tag>
      {condition.kind === "EXECUTION" && (
        <span className="text-[10px] text-muted-foreground">exec</span>
      )}
      <ConfluenceDirectionBadge direction={condition.directionApplicability} withIcon={false} />

      <div className="ml-auto flex items-center gap-1.5">
        <div className="flex overflow-hidden rounded-md border border-border text-[10px]">
          <button
            type="button"
            disabled={savingMandatory}
            onClick={() => setMandatoryOverride(null)}
            title={`Inherit (${condition.baseMandatory ? "mandatory" : "optional"})`}
            className={cn(
              "px-1.5 py-1 font-medium transition-colors",
              condition.mandatoryOverride == null
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            Inherit
          </button>
          <button
            type="button"
            disabled={savingMandatory}
            onClick={() => setMandatoryOverride(true)}
            className={cn(
              "border-l border-border px-1.5 py-1 font-medium transition-colors",
              condition.mandatoryOverride === true
                ? "bg-warning/15 text-warning"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            Mandatory
          </button>
          <button
            type="button"
            disabled={savingMandatory}
            onClick={() => setMandatoryOverride(false)}
            className={cn(
              "border-l border-border px-1.5 py-1 font-medium transition-colors",
              condition.mandatoryOverride === false
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            Optional
          </button>
        </div>

        <Input
          value={weightDraft}
          onChange={(e) => setWeightDraft(e.target.value)}
          inputMode="numeric"
          placeholder={`w${condition.baseWeight ?? 0}`}
          aria-label={`Weight override (base ${condition.baseWeight ?? 0})`}
          className="h-7 w-16 text-xs tabular-nums"
        />
        <SaveDot state={weightSave} />

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${condition.name} from this scenario`}
          disabled={removing}
          onClick={remove}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
