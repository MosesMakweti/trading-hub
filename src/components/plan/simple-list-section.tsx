"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SortableList } from "@/components/plan/sortable-list";

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
}) {
  const router = useRouter();
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

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

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await actions.archive(id);
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
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                {fields.map((f, i) => (
                  <span
                    key={f.key}
                    className={i === 0 ? "font-medium" : "truncate text-muted-foreground"}
                  >
                    {String((item as unknown as Record<string, unknown>)[f.key] ?? "")}
                  </span>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => startEdit(item)}
                  disabled={isPending}
                >
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDelete(item.id)}
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
        <Button type="submit" variant="ghost" size="icon-sm" disabled={isPending}>
          <Check />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onCancel} disabled={isPending}>
          <X />
        </Button>
      </div>
    </form>
  );
}
