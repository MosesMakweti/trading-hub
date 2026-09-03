"use client";

import { useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RULE_TEMPLATE_BY_KEY, ruleTemplatesForMarket, type MarketCategoryLike, type RuleKeyLike } from "@/domain/prop-firms/rule-templates";
import { newDraftRule } from "../draft";
import { RuleValueInput } from "../rule-value-input";
import type { DraftRule, DraftStage, RuleBreachActionLike } from "../types";

const BREACH_ACTION_LABELS: Record<RuleBreachActionLike, string> = {
  WARNING_ONLY: "Warning only",
  SOFT_BREACH: "Soft breach",
  HARD_BREACH_FAIL: "Hard breach — fail stage",
  HARD_BREACH_TERMINATE: "Hard breach — terminate account",
  CUSTOM: "Custom",
};

export function StepRules({
  stages,
  marketCategory,
  onChange,
}: {
  stages: DraftStage[];
  marketCategory: MarketCategoryLike;
  onChange: (stages: DraftStage[]) => void;
}) {
  const [activeStageId, setActiveStageId] = useState(stages[0]?.localId ?? "");
  const activeStage = stages.find((s) => s.localId === activeStageId) ?? stages[0];
  const templates = ruleTemplatesForMarket(marketCategory);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function updateStageRules(stageId: string, rules: DraftRule[]) {
    onChange(stages.map((s) => (s.localId === stageId ? { ...s, rules } : s)));
  }

  function addRule(stageId: string, ruleKey: RuleKeyLike) {
    const template = RULE_TEMPLATE_BY_KEY[ruleKey];
    const stage = stages.find((s) => s.localId === stageId);
    if (!stage) return;
    const rule = newDraftRule({ ruleKey, name: template.label, valueType: template.defaultValueType });
    updateStageRules(stageId, [...stage.rules, rule]);
  }

  function copyRulesFrom(targetStageId: string, sourceStageId: string) {
    const source = stages.find((s) => s.localId === sourceStageId);
    const target = stages.find((s) => s.localId === targetStageId);
    if (!source || !target || source.rules.length === 0) return;
    const copied = source.rules.map((r) => ({
      ...r,
      localId: typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36),
    }));
    updateStageRules(targetStageId, [...target.rules, ...copied]);
  }

  function handleDragEnd(stageId: string, rules: DraftRule[]) {
    return (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = rules.findIndex((r) => r.localId === active.id);
      const newIndex = rules.findIndex((r) => r.localId === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      updateStageRules(stageId, arrayMove(rules, oldIndex, newIndex));
    };
  }

  if (!activeStage) {
    return <p className="text-sm text-muted-foreground">Add at least one stage first.</p>;
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeStage.localId} onValueChange={setActiveStageId}>
        <TabsList className="flex-wrap">
          {stages.map((s) => (
            <TabsTrigger key={s.localId} value={s.localId}>
              {s.name || "Untitled stage"}
              {s.rules.length > 0 && <span className="ml-1 text-muted-foreground">({s.rules.length})</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={Object.fromEntries(templates.map((t) => [t.key, t.label]))}
          value=""
          onValueChange={(v) => v && addRule(activeStage.localId, v as RuleKeyLike)}
        >
          <SelectTrigger className="h-8 w-56">
            <SelectValue placeholder="Add a rule from template…" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {stages.length > 1 && (
          <Select
            items={Object.fromEntries(
              stages.filter((s) => s.localId !== activeStage.localId).map((s) => [s.localId, s.name]),
            )}
            value=""
            onValueChange={(v) => v && copyRulesFrom(activeStage.localId, v)}
          >
            <SelectTrigger className="h-8 w-48">
              <SelectValue placeholder="Copy rules from…" />
            </SelectTrigger>
            <SelectContent>
              {stages
                .filter((s) => s.localId !== activeStage.localId)
                .map((s) => (
                  <SelectItem key={s.localId} value={s.localId} disabled={s.rules.length === 0}>
                    {s.name} ({s.rules.length})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {activeStage.rules.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
          No rules on this stage yet. Add one from a template above, or copy from another stage.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd(activeStage.localId, activeStage.rules)}
        >
          <SortableContext items={activeStage.rules.map((r) => r.localId)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {activeStage.rules.map((rule) => (
                <SortableRuleCard
                  key={rule.localId}
                  rule={rule}
                  onUpdate={(patch) =>
                    updateStageRules(
                      activeStage.localId,
                      activeStage.rules.map((r) => (r.localId === rule.localId ? { ...r, ...patch } : r)),
                    )
                  }
                  onRemove={() =>
                    updateStageRules(activeStage.localId, activeStage.rules.filter((r) => r.localId !== rule.localId))
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableRuleCard({
  rule,
  onUpdate,
  onRemove,
}: {
  rule: DraftRule;
  onUpdate: (patch: Partial<DraftRule>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rule.localId });
  const template = RULE_TEMPLATE_BY_KEY[rule.ruleKey];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "space-y-2.5 rounded-lg border border-border bg-background/40 p-3",
        isDragging && "opacity-60",
        !rule.isEnabled && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label={`Drag to reorder ${rule.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <Input
          value={rule.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          aria-label="Rule name"
          className="h-7 flex-1 border-transparent bg-transparent px-1.5 text-sm font-medium shadow-none focus-visible:border-input focus-visible:bg-background/50"
        />
        <Switch
          checked={rule.isEnabled}
          onCheckedChange={(checked) => onUpdate({ isEnabled: checked })}
          aria-label={`${rule.name || "Rule"} enabled`}
        />
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${rule.name}`} onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 pl-6 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <label className="text-[10px] text-muted-foreground">Value</label>
          <RuleValueInput inputKind={template.inputKind} rule={rule} onChange={onUpdate} />
        </div>

        {template.basisOptions && (
          <div>
            <label className="text-[10px] text-muted-foreground">Basis</label>
            <Select
              items={Object.fromEntries(template.basisOptions.map((b) => [b, b]))}
              value={rule.measurementBasis}
              onValueChange={(v) => onUpdate({ measurementBasis: v ?? "" })}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue placeholder="Basis" />
              </SelectTrigger>
              <SelectContent>
                {template.basisOptions.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {template.periodOptions && (
          <div>
            <label className="text-[10px] text-muted-foreground">Period</label>
            <Select
              items={Object.fromEntries(template.periodOptions.map((p) => [p, p]))}
              value={rule.measurementPeriod}
              onValueChange={(v) => onUpdate({ measurementPeriod: v ?? "" })}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                {template.periodOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <label className="text-[10px] text-muted-foreground">Warning at</label>
          <Input
            type="number"
            value={rule.warningThreshold}
            onChange={(e) => onUpdate({ warningThreshold: e.target.value })}
            placeholder="Optional"
            className="h-8"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Breach at</label>
          <Input
            type="number"
            value={rule.breachThreshold}
            onChange={(e) => onUpdate({ breachThreshold: e.target.value })}
            placeholder="Optional"
            className="h-8"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-muted-foreground">On breach</label>
          <Select
            items={BREACH_ACTION_LABELS}
            value={rule.breachAction}
            onValueChange={(v) => onUpdate({ breachAction: (v as RuleBreachActionLike) ?? "" })}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(BREACH_ACTION_LABELS) as [RuleBreachActionLike, string][]).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
