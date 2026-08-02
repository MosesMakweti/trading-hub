"use client";

import { useState, useTransition, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, GripVertical, ImageOff, Loader2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { archiveArsenalConcept, updateArsenalConcept } from "@/actions/arsenal.actions";
import type { ArsenalRichField } from "@/lib/validation/arsenal";
import type { ArsenalConceptDTO } from "@/types/strategies";

const FIELDS: { key: ArsenalRichField; label: string; placeholder: string }[] = [
  { key: "definition", label: "Definition", placeholder: "What is this concept, precisely?" },
  { key: "purpose", label: "Purpose", placeholder: "What job does it do in your strategy?" },
  { key: "howIIdentify", label: "How I identify it", placeholder: "How do you spot it on a chart?" },
  { key: "whyItMatters", label: "Why it matters", placeholder: "Why does it give you an edge?" },
  { key: "whenIUse", label: "When I use it", placeholder: "In what conditions is it valid?" },
  { key: "whenIIgnore", label: "When I ignore it", placeholder: "When is it a trap or irrelevant?" },
  { key: "examples", label: "Examples", placeholder: "Worked examples and annotations." },
  { key: "personalNotes", label: "Personal notes", placeholder: "Anything else worth remembering." },
];

type Fields = Record<ArsenalRichField, unknown>;

export function ArsenalConceptCard({
  strategyId,
  concept,
  dragHandleProps,
  isDragging,
}: {
  strategyId: string;
  concept: ArsenalConceptDTO;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  isDragging?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(concept.name);
  // Local copy of each rich field so a collapsed→expanded remount shows the
  // latest saved content (we don't refresh the page on per-field autosave).
  const [fields, setFields] = useState<Fields>(() => ({
    definition: concept.definition,
    purpose: concept.purpose,
    howIIdentify: concept.howIIdentify,
    whyItMatters: concept.whyItMatters,
    whenIUse: concept.whenIUse,
    whenIIgnore: concept.whenIIgnore,
    examples: concept.examples,
    personalNotes: concept.personalNotes,
  }));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const nameSave = useDebouncedAutosave({
    value: name,
    serialize: (v) => v.trim(),
    save: async (v) => {
      if (!v.trim()) return { success: false, error: "" };
      return updateArsenalConcept(strategyId, concept.id, { name: v });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  function saveField(key: ArsenalRichField) {
    return async (content: object) => {
      setFields((f) => ({ ...f, [key]: content }));
      return updateArsenalConcept(strategyId, concept.id, { [key]: content });
    };
  }

  function handleDelete() {
    startDelete(async () => {
      const result = await archiveArsenalConcept(strategyId, concept.id);
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
          placeholder="Concept name"
          aria-label="Concept name"
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
          aria-label={expanded ? "Collapse concept" : "Expand concept"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete concept"
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
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:col-span-2">
            <ImageOff className="size-3.5" />
            Charts &amp; image attachments arrive when image hosting is connected.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this concept?"
        description={`"${name || "This concept"}" will be removed from the Arsenal. This can't be undone from here.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
