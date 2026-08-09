"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, EyeOff, ImagePlus, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import type { TagColor } from "@prisma/client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tag } from "@/components/ui/tag";
import { ImageAttachments } from "@/components/media/image-attachments";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ColorPicker } from "@/components/strategy-lab/sot/color-picker";
import {
  createStrategyChecklistItem,
  deleteStrategyChecklistItem,
  updateStrategyChecklistItem,
} from "@/actions/strategy-sot.actions";

export interface StrategyChecklistItemDTO {
  id: string;
  name: string;
  color: TagColor;
  category: string | null;
  description: string | null;
  weight: number | null;
  mandatory: boolean;
  validationCriteria: string | null;
  enabled: boolean;
}

type Kind = "CONFLUENCE" | "EXECUTION";

interface Draft {
  name: string;
  color: TagColor;
  category: string;
  description: string;
  weight: string;
  mandatory: boolean;
  validationCriteria: string;
  enabled: boolean;
}
const emptyDraft: Draft = {
  name: "",
  color: "GRAY",
  category: "",
  description: "",
  weight: "",
  mandatory: false,
  validationCriteria: "",
  enabled: true,
};
const toDraft = (i: StrategyChecklistItemDTO): Draft => ({
  name: i.name,
  color: i.color,
  category: i.category ?? "",
  description: i.description ?? "",
  weight: i.weight == null ? "" : String(i.weight),
  mandatory: i.mandatory,
  validationCriteria: i.validationCriteria ?? "",
  enabled: i.enabled,
});

export function StrategyChecklistSection({
  strategyId,
  kind,
  initialItems,
}: {
  strategyId: string;
  kind: Kind;
  initialItems: StrategyChecklistItemDTO[];
}) {
  const router = useRouter();
  const noun = kind === "CONFLUENCE" ? "confluence" : "execution confirmation";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [imagesFor, setImagesFor] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function reset() {
    setEditingId(null);
    setAdding(false);
    setDraft(emptyDraft);
  }

  function submit() {
    const name = draft.name.trim();
    if (!name) return;
    const payload = {
      name,
      color: draft.color,
      category: draft.category.trim() || null,
      description: draft.description.trim() || null,
      weight: draft.weight.trim() === "" ? null : Number(draft.weight),
      mandatory: kind === "CONFLUENCE" ? draft.mandatory : false,
      validationCriteria: draft.validationCriteria.trim() || null,
      enabled: draft.enabled,
    };
    start(async () => {
      const result = editingId
        ? await updateStrategyChecklistItem(editingId, strategyId, payload)
        : await createStrategyChecklistItem(strategyId, kind, payload);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  function doDelete() {
    if (!confirmId) return;
    start(async () => {
      const result = await deleteStrategyChecklistItem(confirmId, strategyId);
      setConfirmId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  const enabledItems = initialItems.filter((i) => i.enabled);
  const totalWeight = enabledItems.reduce((sum, i) => sum + (i.weight ?? 0), 0);
  const mandatoryCount = enabledItems.filter((i) => i.mandatory).length;

  return (
    <div className="space-y-2.5">
      {kind === "CONFLUENCE" && enabledItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Total weight{" "}
            <span
              className={cn(
                "font-semibold tabular-nums",
                totalWeight === 100 ? "text-success" : "text-foreground",
              )}
            >
              {totalWeight}
            </span>
          </span>
          <span className="text-muted-foreground">
            <span className="font-semibold tabular-nums text-warning">
              {mandatoryCount}
            </span>{" "}
            mandatory
          </span>
          {totalWeight !== 100 && (
            <span className="text-muted-foreground/60">
              Tip: weights totalling 100 make the probability score read as a clean percentage.
            </span>
          )}
        </div>
      )}

      {initialItems.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          No {noun}s defined yet. Add the ones this strategy relies on.
        </p>
      )}

      {initialItems.map((item) =>
        editingId === item.id ? (
          <ItemForm key={item.id} draft={draft} setDraft={setDraft} onSave={submit} onCancel={reset} isPending={isPending} kind={kind} />
        ) : (
          <div key={item.id} className="space-y-2">
          <div
            className="glass flex items-center gap-3 rounded-xl px-3 py-2.5"
          >
            <Tag color={item.color} muted={!item.enabled}>
              {item.name}
            </Tag>
            {item.mandatory && (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                <Lock className="size-2.5" /> Core
              </span>
            )}
            {item.category && (
              <span className="text-xs text-muted-foreground">{item.category}</span>
            )}
            {item.weight != null && (
              <span className="text-xs text-muted-foreground tabular-nums">w{item.weight}</span>
            )}
            {!item.enabled && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <EyeOff className="size-3" /> disabled
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Images for ${noun}`}
                aria-pressed={imagesFor === item.id}
                className={cn(imagesFor === item.id && "text-primary")}
                onClick={() => setImagesFor((cur) => (cur === item.id ? null : item.id))}
              >
                <ImagePlus />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${noun}`}
                disabled={isPending}
                onClick={() => {
                  setEditingId(item.id);
                  setAdding(false);
                  setDraft(toDraft(item));
                }}
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${noun}`}
                disabled={isPending}
                onClick={() => setConfirmId(item.id)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          {imagesFor === item.id && (
            <div className="glass rounded-xl p-3">
              <ImageAttachments ownerType="STRATEGY_CHECKLIST_ITEM" ownerId={item.id} max={6} />
            </div>
          )}
          </div>
        ),
      )}

      {adding ? (
        <ItemForm draft={draft} setDraft={setDraft} onSave={submit} onCancel={reset} isPending={isPending} kind={kind} />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={isPending}
          onClick={() => {
            setAdding(true);
            setEditingId(null);
            setDraft(emptyDraft);
          }}
        >
          <Plus className="size-3.5" />
          Add {noun}
        </Button>
      )}

      <ConfirmDialog
        open={confirmId != null}
        onOpenChange={(o) => !o && setConfirmId(null)}
        title={`Delete this ${noun}?`}
        description="It's removed from the strategy. Past trades keep their recorded copy."
        confirmLabel="Delete"
        variant="destructive"
        isPending={isPending}
        onConfirm={doDelete}
      />
    </div>
  );
}

function ItemForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  isPending,
  kind,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
  kind: Kind;
}) {
  return (
    <form
      className="glass space-y-2.5 rounded-xl p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder={kind === "CONFLUENCE" ? "e.g. Liquidity Sweep" : "e.g. Candle Close"}
          className="h-8 min-w-44 flex-1"
        />
        <ColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          placeholder="Category (optional)"
          className="h-8 min-w-40 flex-1"
        />
        <Input
          value={draft.weight}
          onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
          inputMode="numeric"
          placeholder="Weight 0–100"
          className="h-8 w-32 tabular-nums"
          aria-label="Weight (0-100)"
        />
      </div>

      {kind === "CONFLUENCE" && (
        <div className="flex overflow-hidden rounded-lg border border-border text-xs">
          <button
            type="button"
            onClick={() => setDraft({ ...draft, mandatory: true })}
            className={cn(
              "flex-1 px-3 py-1.5 font-medium transition-colors",
              draft.mandatory
                ? "bg-warning/15 text-warning"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            Mandatory (core requirement)
          </button>
          <button
            type="button"
            onClick={() => setDraft({ ...draft, mandatory: false })}
            className={cn(
              "flex-1 border-l border-border px-3 py-1.5 font-medium transition-colors",
              !draft.mandatory
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            Optional (adds to score)
          </button>
        </div>
      )}

      <Textarea
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        placeholder="Notes / how to identify it (optional)"
        rows={2}
        className="resize-y"
      />
      <Textarea
        value={draft.validationCriteria}
        onChange={(e) => setDraft({ ...draft, validationCriteria: e.target.value })}
        placeholder={
          kind === "CONFLUENCE"
            ? "Validation criteria — the objective test for 'is this confluence present?' (optional)"
            : "Validation criteria (optional)"
        }
        rows={2}
        className="resize-y"
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={draft.enabled}
            onCheckedChange={(c) => setDraft({ ...draft, enabled: c === true })}
          />
          Enabled
        </label>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
            <X className="size-3.5" /> Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending} className={cn("gap-1.5")}>
            <Check className="size-3.5" /> Save
          </Button>
        </div>
      </div>
    </form>
  );
}
