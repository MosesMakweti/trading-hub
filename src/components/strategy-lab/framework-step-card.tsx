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
import { archiveFrameworkStep, updateFrameworkStep } from "@/actions/framework.actions";
import type { FrameworkRichField } from "@/lib/validation/framework";
import type { FrameworkStepDTO } from "@/types/strategies";

const FIELDS: { key: FrameworkRichField; label: string; placeholder: string }[] = [
  { key: "description", label: "Description", placeholder: "What exactly do you do at this step?" },
  { key: "notes", label: "Notes (optional)", placeholder: "Caveats, reminders, edge cases." },
];

type Fields = Record<FrameworkRichField, unknown>;

export function FrameworkStepCard({
  strategyId,
  step,
  stepNumber,
  dragHandleProps,
  isDragging,
}: {
  strategyId: string;
  step: FrameworkStepDTO;
  stepNumber: number;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(step.title);
  const [fields, setFields] = useState<Fields>(() => ({
    description: step.description,
    notes: step.notes,
  }));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const titleSave = useDebouncedAutosave({
    value: title,
    serialize: (v) => v.trim(),
    save: async (v) => {
      if (!v.trim()) return { success: false, error: "" };
      return updateFrameworkStep(strategyId, step.id, { title: v });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  function saveField(key: FrameworkRichField) {
    return async (content: object) => {
      setFields((f) => ({ ...f, [key]: content }));
      return updateFrameworkStep(strategyId, step.id, { [key]: content });
    };
  }

  function handleDelete() {
    startDelete(async () => {
      const result = await archiveFrameworkStep(strategyId, step.id);
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

        <span className="bg-brand-gradient flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white tabular-nums">
          {stepNumber}
        </span>

        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Step title"
          aria-label="Step title"
          className="h-8 flex-1 border-transparent bg-transparent px-1.5 font-medium shadow-none focus-visible:border-input focus-visible:bg-background/50"
        />

        <span className="w-6 shrink-0">
          {titleSave === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {titleSave === "saved" && <Check className="size-3.5 text-success" />}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? "Collapse step" : "Expand step"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete step"
          onClick={() => setConfirmOpen(true)}
          disabled={isDeleting}
        >
          <Trash2 />
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-4 border-t border-border pt-4">
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
          <div className="space-y-1.5">
            <Label className="text-xs">Images</Label>
            <ImageAttachments ownerType="STRATEGY_FRAMEWORK_STEP" ownerId={step.id} max={8} />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this step?"
        description={`"${title || "This step"}" will be removed from the framework. This can't be undone from here.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
