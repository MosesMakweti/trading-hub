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
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { ImageAttachments } from "@/components/media/image-attachments";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import {
  archiveEntryModel,
  updateEntryModel,
} from "@/actions/strategy-entry-models.actions";
import type { EntryModelRichField } from "@/lib/validation/strategy-entry-models";
import type { EntryModelDTO } from "@/types/strategies";

const FIELDS: { key: EntryModelRichField; label: string; placeholder: string }[] = [
  { key: "description", label: "Description", placeholder: "What is this entry, in a sentence?" },
  { key: "conditions", label: "Conditions", placeholder: "What must be true before you take it?" },
  { key: "confirmationChecklist", label: "Confirmation checklist", placeholder: "The triggers you wait for." },
  { key: "invalidation", label: "Invalidation", placeholder: "What kills the setup?" },
  { key: "stopPlacement", label: "Stop placement", placeholder: "Where does the stop go, and why?" },
  { key: "targetLogic", label: "Target logic", placeholder: "How do you choose targets?" },
  { key: "notes", label: "Notes", placeholder: "Anything else worth remembering." },
];

type Fields = Record<EntryModelRichField, unknown>;

export function EntryModelCard({
  strategyId,
  model,
  dragHandleProps,
  isDragging,
}: {
  strategyId: string;
  model: EntryModelDTO;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(model.name);
  const [fields, setFields] = useState<Fields>(() => ({
    description: model.description,
    conditions: model.conditions,
    confirmationChecklist: model.confirmationChecklist,
    invalidation: model.invalidation,
    stopPlacement: model.stopPlacement,
    targetLogic: model.targetLogic,
    notes: model.notes,
  }));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const nameSave = useDebouncedAutosave({
    value: name,
    serialize: (v) => v.trim(),
    save: async (v) => {
      if (!v.trim()) return { success: false, error: "" };
      return updateEntryModel(strategyId, model.id, { name: v });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  function saveField(key: EntryModelRichField) {
    return async (content: object) => {
      setFields((f) => ({ ...f, [key]: content }));
      return updateEntryModel(strategyId, model.id, { [key]: content });
    };
  }

  function handleDelete() {
    startDelete(async () => {
      const result = await archiveEntryModel(strategyId, model.id);
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

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Entry model name"
          aria-label="Entry model name"
          className="h-8 flex-1 border-transparent bg-transparent px-1.5 font-medium shadow-none focus-visible:border-input focus-visible:bg-background/50"
        />

        <span className="w-16 shrink-0 text-right">
          {nameSave === "saving" && <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" />}
          {nameSave === "saved" && <Check className="ml-auto size-3.5 text-success" />}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? "Collapse entry model" : "Expand entry model"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete entry model"
          onClick={() => setConfirmOpen(true)}
          disabled={isDeleting}
        >
          <Trash2 />
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
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
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Example images</Label>
            <ImageAttachments ownerType="STRATEGY_ENTRY_MODEL" ownerId={model.id} max={8} />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this entry model?"
        description={`"${name || "This entry model"}" will be removed. This can't be undone from here.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
