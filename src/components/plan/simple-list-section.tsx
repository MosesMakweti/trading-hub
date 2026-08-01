"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SortableList } from "@/components/plan/sortable-list";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

type ActionResult = { success: boolean; error?: string };

interface FieldConfig {
  key: string;
  placeholder: string;
}

interface ListItem {
  id: string;
}

export function SimpleListSection<T extends ListItem>({
  initialItems,
  fields,
  actions,
  emptyMessage,
  addLabel,
  itemLabel = "item",
  checkable = false,
}: {
  initialItems: T[];
  fields: FieldConfig[];
  actions: {
    create: (values: Record<string, string>) => Promise<ActionResult>;
    update: (id: string, values: Record<string, string>) => Promise<ActionResult>;
    archive: (id: string) => Promise<ActionResult>;
    reorder: (orderedIds: string[]) => Promise<ActionResult>;
  };
  emptyMessage: string;
  addLabel: string;
  itemLabel?: string;
  /**
   * When true, each row shows a leading checkbox for ticking the item off.
   * The checked state is intentionally local/ephemeral — it's a "run through
   * this before every session" affordance, not persisted plan data, so it
   * resets on reload (a fresh checklist each session).
   */
  checkable?: boolean;
}) {
  const router = useRouter();
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function toggleChecked(id: string, checked: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const items = localOrder
    ? (localOrder
        .map((id) => initialItems.find((item) => item.id === id))
        .filter(Boolean) as T[])
    : initialItems;

  function resetDraft() {
    setDraft({});
    setIsAdding(false);
    setEditingId(null);
  }

  function startAdd() {
    setDraft(Object.fromEntries(fields.map((f) => [f.key, ""])));
    setIsAdding(true);
    setEditingId(null);
  }

  function startEdit(item: T) {
    const record = item as unknown as Record<string, unknown>;
    setDraft(Object.fromEntries(fields.map((f) => [f.key, String(record[f.key] ?? "")])));
    setEditingId(item.id);
    setIsAdding(false);
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = editingId
        ? await actions.update(editingId, draft)
        : await actions.create(draft);

      if (!result.success) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      resetDraft();
      router.refresh();
    });
  }

  function confirmDelete() {
    const id = deleteTargetId;
    if (!id) return;
    startTransition(async () => {
      const result = await actions.archive(id);
      setDeleteTargetId(null);
      if (!result.success) {
        toast.error(result.error ?? "Failed to remove.");
        return;
      }
      router.refresh();
    });
  }

  function handleReorder(orderedIds: string[]) {
    setLocalOrder(orderedIds);
    startTransition(async () => {
      const result = await actions.reorder(orderedIds);
      if (!result.success) toast.error(result.error ?? "Failed to reorder.");
      router.refresh();
      setLocalOrder(null);
    });
  }

  return (
    <div className="space-y-3">
      <SortableList
        items={items}
        onReorder={handleReorder}
        emptyMessage={emptyMessage}
        renderItem={(item) =>
          editingId === item.id ? (
            <InlineForm
              fields={fields}
              draft={draft}
              setDraft={setDraft}
              onSubmit={handleSubmit}
              onCancel={resetDraft}
              isPending={isPending}
            />
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {checkable && (
                  <Checkbox
                    checked={checkedIds.has(item.id)}
                    onCheckedChange={(checked) => toggleChecked(item.id, checked === true)}
                    aria-label={`Mark ${itemLabel} done`}
                  />
                )}
                <div
                  className={cn(
                    "flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm",
                    checkable && checkedIds.has(item.id) && "text-muted-foreground line-through",
                  )}
                >
                  {fields.map((f, i) => (
                    <span
                      key={f.key}
                      className={i === 0 ? "font-medium" : "truncate text-muted-foreground"}
                    >
                      {String((item as unknown as Record<string, unknown>)[f.key] ?? "")}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${itemLabel}`}
                  onClick={() => startEdit(item)}
                  disabled={isPending}
                >
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${itemLabel}`}
                  onClick={() => setDeleteTargetId(item.id)}
                  disabled={isPending}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          )
        }
      />

      {isAdding ? (
        <div className="rounded-lg border border-border bg-background/40 px-2 py-1.5">
          <InlineForm
            fields={fields}
            draft={draft}
            setDraft={setDraft}
            onSubmit={handleSubmit}
            onCancel={resetDraft}
            isPending={isPending}
          />
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={startAdd} className="gap-1.5">
          <Plus className="size-3.5" />
          {addLabel}
        </Button>
      )}

      <ConfirmDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
        title={`Delete this ${itemLabel}?`}
        description="This can't be undone."
        confirmLabel="Delete"
        variant="destructive"
        isPending={isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function InlineForm({
  fields,
  draft,
  setDraft,
  onSubmit,
  onCancel,
  isPending,
}: {
  fields: FieldConfig[];
  draft: Record<string, string>;
  setDraft: (value: Record<string, string>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <form
      className="flex flex-1 flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {fields.map((f) => (
        <Input
          key={f.key}
          autoFocus={f === fields[0]}
          placeholder={f.placeholder}
          value={draft[f.key] ?? ""}
          onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
          className="h-7 flex-1 text-sm"
        />
      ))}
      <div className="flex shrink-0 items-center gap-1">
        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Save" disabled={isPending}>
          <Check />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Cancel"
          onClick={onCancel}
          disabled={isPending}
        >
          <X />
        </Button>
      </div>
    </form>
  );
}
