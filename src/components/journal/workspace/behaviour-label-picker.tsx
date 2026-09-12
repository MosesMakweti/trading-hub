"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TAG_STYLES } from "@/components/ui/tag";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import {
  createBehaviourLabelAction,
  listBehaviourLabelsAction,
  loadTradeBehaviourLabelsAction,
  setTradeBehaviourLabelsAction,
} from "@/actions/behaviour-labels.actions";
import type { TagColor } from "@prisma/client";

interface LabelRow {
  id: string;
  name: string;
  polarity: "POSITIVE" | "NEGATIVE";
  color: TagColor;
}

const NEW_LABEL_COLORS: TagColor[] = ["GREEN", "RED", "BLUE", "AMBER", "PURPLE", "TEAL", "YELLOW", "GRAY"];

/**
 * Trade Review overhaul (Stage 7 §8/§9) — fast multi-select tagging of trader
 * behaviour, plus creating a new label without leaving the review. Persists
 * by resubmitting the full selected set (setTradeBehaviourLabelsAction),
 * simpler and safer than one attach/detach round-trip per click.
 */
export function BehaviourLabelPicker({ dateKey, tradeId }: { dateKey: string; tradeId: string }) {
  const editable = useWorkspaceEditable();
  const router = useRouter();
  const [catalog, setCatalog] = useState<LabelRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [addingNew, setAddingNew] = useState<"POSITIVE" | "NEGATIVE" | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<TagColor>("GRAY");

  useEffect(() => {
    let active = true;
    void (async () => {
      const [all, attached] = await Promise.all([
        listBehaviourLabelsAction(),
        loadTradeBehaviourLabelsAction(tradeId),
      ]);
      if (!active) return;
      setCatalog(all);
      setSelected(new Set(attached.map((l) => l.id)));
    })();
    return () => {
      active = false;
    };
  }, [tradeId]);

  async function persist(nextSelected: Set<string>) {
    setSelected(nextSelected);
    setSaving(true);
    const result = await setTradeBehaviourLabelsAction(dateKey, tradeId, { labelIds: Array.from(nextSelected) });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void persist(next);
  }

  async function createLabel() {
    if (!addingNew || !newName.trim()) return;
    const result = await createBehaviourLabelAction({ name: newName.trim(), polarity: addingNew, color: newColor });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    const all = await listBehaviourLabelsAction();
    setCatalog(all);
    void persist(new Set([...selected, result.id]));
    setNewName("");
    setAddingNew(null);
  }

  if (catalog == null) {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  }

  const positive = catalog.filter((l) => l.polarity === "POSITIVE");
  const negative = catalog.filter((l) => l.polarity === "NEGATIVE");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">What behaviours were present?</span>
        {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>

      <LabelGroup
        title="Positive"
        labels={positive}
        selected={selected}
        editable={editable}
        onToggle={toggle}
        onAddNew={() => setAddingNew("POSITIVE")}
      />
      <LabelGroup
        title="Negative"
        labels={negative}
        selected={selected}
        editable={editable}
        onToggle={toggle}
        onAddNew={() => setAddingNew("NEGATIVE")}
      />

      {addingNew && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5">
          <span className="text-xs text-muted-foreground">
            New {addingNew === "POSITIVE" ? "positive" : "negative"} label:
          </span>
          <Input
            className="h-8 w-40 text-xs"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Label name"
            autoFocus
          />
          <Select
            items={NEW_LABEL_COLORS.map((c) => ({ value: c, label: c }))}
            value={newColor}
            onValueChange={(v) => setNewColor(v as TagColor)}
          >
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NEW_LABEL_COLORS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" onClick={createLabel}>
            Add
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddingNew(null)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function LabelGroup({
  title,
  labels,
  selected,
  editable,
  onToggle,
  onAddNew,
}: {
  title: string;
  labels: LabelRow[];
  selected: Set<string>;
  editable: boolean;
  onToggle: (id: string) => void;
  onAddNew: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {labels.map((l) => {
          const on = selected.has(l.id);
          const s = TAG_STYLES[l.color];
          return (
            <button
              key={l.id}
              type="button"
              disabled={!editable}
              onClick={() => onToggle(l.id)}
              aria-pressed={on}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                on ? s.chip : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", on ? s.dot : "bg-muted-foreground/40")} />
              {l.name}
            </button>
          );
        })}
        {editable && (
          <button
            type="button"
            onClick={onAddNew}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3" />
            New
          </button>
        )}
      </div>
    </div>
  );
}
