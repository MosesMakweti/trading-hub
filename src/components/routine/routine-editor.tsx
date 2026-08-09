"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlignLeft,
  Check,
  ChevronDown,
  Pencil,
  Plus,
  SquareCheck,
  Trash2,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SortableList } from "@/components/plan/sortable-list";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { RoutineItemTypeValue } from "@/domain/today/default-routine";
import {
  createRoutineItem,
  createRoutineSection,
  deleteRoutineItem,
  deleteRoutineSection,
  renameRoutineSection,
  reorderRoutineItems,
  reorderRoutineSections,
  setRoutineSectionCollapsed,
  updateRoutineItem,
} from "@/actions/routine.actions";

export interface RoutineItemDTO {
  id: string;
  label: string;
  type: RoutineItemTypeValue;
  isMandatory: boolean;
}
export interface RoutineSectionDTO {
  id: string;
  title: string;
  collapsed: boolean;
  items: RoutineItemDTO[];
}

export const ROUTINE_TYPE_META: Record<
  RoutineItemTypeValue,
  { label: string; icon: LucideIcon }
> = {
  CHECKBOX: { label: "Checkbox", icon: SquareCheck },
  SHORT_TEXT: { label: "Short note", icon: Type },
  LONG_TEXT: { label: "Long note", icon: AlignLeft },
};

const TYPE_OPTIONS = (Object.keys(ROUTINE_TYPE_META) as RoutineItemTypeValue[]).map((value) => ({
  value,
  label: ROUTINE_TYPE_META[value].label,
}));

export function RoutineEditor({ sections }: { sections: RoutineSectionDTO[] }) {
  const router = useRouter();
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  const ordered = localOrder
    ? (localOrder.map((id) => sections.find((s) => s.id === id)).filter(Boolean) as RoutineSectionDTO[])
    : sections;

  function handleReorderSections(orderedIds: string[]) {
    setLocalOrder(orderedIds);
    startTransition(async () => {
      const result = await reorderRoutineSections({ orderedIds });
      if (!result.success) toast.error(result.error);
      router.refresh();
      setLocalOrder(null);
    });
  }

  function addSection() {
    const title = newTitle.trim();
    if (!title) return;
    startTransition(async () => {
      const result = await createRoutineSection({ title });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setNewTitle("");
      setAddingSection(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <SortableList
        items={ordered}
        onReorder={handleReorderSections}
        emptyMessage="No sections yet — add one below to start your routine."
        renderItem={(section) => (
          <SectionCard section={section} isPending={isPending} startTransition={startTransition} />
        )}
      />

      {addingSection ? (
        <form
          className="flex items-center gap-2 rounded-xl border border-border bg-background/40 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            addSection();
          }}
        >
          <Input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Section title (e.g. Personal Readiness)"
            className="h-8 flex-1"
          />
          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save section" disabled={isPending}>
            <Check />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Cancel"
            onClick={() => {
              setAddingSection(false);
              setNewTitle("");
            }}
            disabled={isPending}
          >
            <X />
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full gap-1.5"
          onClick={() => setAddingSection(true)}
        >
          <Plus className="size-4" />
          Add section
        </Button>
      )}
    </div>
  );
}

function SectionCard({
  section,
  isPending,
  startTransition,
}: {
  section: RoutineSectionDTO;
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(section.collapsed);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(section.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [localItemOrder, setLocalItemOrder] = useState<string[] | null>(null);

  const items = localItemOrder
    ? (localItemOrder.map((id) => section.items.find((i) => i.id === id)).filter(Boolean) as RoutineItemDTO[])
    : section.items;

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    startTransition(async () => {
      await setRoutineSectionCollapsed(section.id, next);
      router.refresh();
    });
  }

  function saveTitle() {
    const title = titleDraft.trim();
    if (!title) return;
    startTransition(async () => {
      const result = await renameRoutineSection(section.id, { title });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setEditingTitle(false);
      router.refresh();
    });
  }

  function doDelete() {
    startTransition(async () => {
      const result = await deleteRoutineSection(section.id);
      setConfirmDelete(false);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleReorderItems(orderedIds: string[]) {
    setLocalItemOrder(orderedIds);
    startTransition(async () => {
      const result = await reorderRoutineItems({ orderedIds });
      if (!result.success) toast.error(result.error);
      router.refresh();
      setLocalItemOrder(null);
    });
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand section" : "Collapse section"}
          aria-expanded={!collapsed}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
        </button>

        {editingTitle ? (
          <form
            className="flex flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              saveTitle();
            }}
          >
            <Input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="h-7 flex-1 text-sm font-medium"
            />
            <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save title" disabled={isPending}>
              <Check />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Cancel"
              onClick={() => {
                setEditingTitle(false);
                setTitleDraft(section.title);
              }}
              disabled={isPending}
            >
              <X />
            </Button>
          </form>
        ) : (
          <>
            <span className="flex-1 text-sm font-semibold">{section.title}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {section.items.length}
            </span>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Rename section"
              onClick={() => setEditingTitle(true)}
              disabled={isPending}
            >
              <Pencil />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Delete section"
              onClick={() => setConfirmDelete(true)}
              disabled={isPending}
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="mt-2.5 space-y-2 pl-6">
          <SortableList
            items={items}
            onReorder={handleReorderItems}
            emptyMessage="No items yet."
            renderItem={(item) => <ItemRow item={item} isPending={isPending} startTransition={startTransition} />}
          />
          <AddItemForm sectionId={section.id} isPending={isPending} startTransition={startTransition} />
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this section?"
        description="The section and all its items will be removed from your routine. Past days keep their saved copy."
        confirmLabel="Delete"
        variant="destructive"
        isPending={isPending}
        onConfirm={doDelete}
      />
    </div>
  );
}

function ItemRow({
  item,
  isPending,
  startTransition,
}: {
  item: RoutineItemDTO;
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(item.label);
  const [typeDraft, setTypeDraft] = useState<RoutineItemTypeValue>(item.type);
  const [mandatoryDraft, setMandatoryDraft] = useState(item.isMandatory);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const TypeIcon = ROUTINE_TYPE_META[item.type].icon;

  function save() {
    const label = labelDraft.trim();
    if (!label) return;
    startTransition(async () => {
      const result = await updateRoutineItem(item.id, {
        label,
        type: typeDraft,
        isMandatory: mandatoryDraft,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function doDelete() {
    startTransition(async () => {
      const result = await deleteRoutineItem(item.id);
      setConfirmDelete(false);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (editing) {
    return (
      <form
        className="flex flex-1 flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Input
          autoFocus
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          className="h-7 min-w-40 flex-1 text-sm"
        />
        <TypePicker value={typeDraft} onChange={setTypeDraft} />
        <MandatoryToggle checked={mandatoryDraft} onChange={setMandatoryDraft} />
        <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save item" disabled={isPending}>
          <Check />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Cancel"
          onClick={() => {
            setEditing(false);
            setLabelDraft(item.label);
            setTypeDraft(item.type);
            setMandatoryDraft(item.isMandatory);
          }}
          disabled={isPending}
        >
          <X />
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{item.label}</span>
        {item.isMandatory && (
          <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-warning uppercase">
            Required
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Edit item"
          onClick={() => setEditing(true)}
          disabled={isPending}
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Delete item"
          onClick={() => setConfirmDelete(true)}
          disabled={isPending}
        >
          <Trash2 />
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this item?"
        description="It will be removed from your routine. Past days keep their saved copy."
        confirmLabel="Delete"
        variant="destructive"
        isPending={isPending}
        onConfirm={doDelete}
      />
    </div>
  );
}

function AddItemForm({
  sectionId,
  isPending,
  startTransition,
}: {
  sectionId: string;
  isPending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<RoutineItemTypeValue>("CHECKBOX");
  const [mandatory, setMandatory] = useState(false);

  function add() {
    const trimmed = label.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createRoutineItem({ sectionId, label: trimmed, type, isMandatory: mandatory });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setLabel("");
      setType("CHECKBOX");
      setMandatory(false);
      router.refresh();
    });
  }

  if (!adding) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => setAdding(true)}
      >
        <Plus className="size-3.5" />
        Add item
      </Button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background/40 px-2 py-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <Input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Item label"
        className="h-7 min-w-40 flex-1 text-sm"
      />
      <TypePicker value={type} onChange={setType} />
      <MandatoryToggle checked={mandatory} onChange={setMandatory} />
      <Button type="submit" size="icon-sm" variant="ghost" aria-label="Add item" disabled={isPending}>
        <Check />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Cancel"
        onClick={() => {
          setAdding(false);
          setLabel("");
        }}
        disabled={isPending}
      >
        <X />
      </Button>
    </form>
  );
}

function TypePicker({
  value,
  onChange,
}: {
  value: RoutineItemTypeValue;
  onChange: (v: RoutineItemTypeValue) => void;
}) {
  return (
    <Select
      items={TYPE_OPTIONS}
      value={value}
      onValueChange={(v) => v && onChange(v as RoutineItemTypeValue)}
    >
      <SelectTrigger className="h-7 w-32 text-xs" aria-label="Item type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TYPE_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Toggle that marks an item as required to start trading (gates Today's Plan). */
function MandatoryToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground select-none">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} aria-label="Required" />
      Required
    </label>
  );
}
