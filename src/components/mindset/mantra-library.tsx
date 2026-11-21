"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { createMantraAction, deleteMantraAction, renameCategoryAction, updateMantraAction } from "@/actions/mindset.actions";
import type { MantraDTO } from "@/server/services/mindset.service";
import type { EnvironmentId } from "@/domain/mindset/options";
import { ENV_THEME } from "@/components/mindset/environment-backdrop";
import { Panel, PanelTitle, Toggle } from "@/components/mindset/mindset-ui";

const inputClass = "w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-white/35";

function MantraRow({
  env,
  mantra,
  categories,
  selected,
  selecting,
  onToggleSelected,
}: {
  env: EnvironmentId;
  mantra: MantraDTO;
  categories: string[];
  selected: boolean;
  selecting: boolean;
  onToggleSelected: () => void;
}) {
  const t = ENV_THEME[env];
  const router = useRouter();
  const listId = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(mantra.text);
  const [category, setCategory] = useState(mantra.category);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.success) return void toast.error(r.error ?? "Something went wrong.");
      after?.();
      router.refresh();
    });

  if (editing) {
    return (
      <li className="space-y-2 rounded-xl border border-white/10 p-3">
        <textarea aria-label="Mantra" className={cn(inputClass, t.text)} rows={2} value={text} maxLength={280} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <input aria-label="Category" list={listId} className={cn(inputClass, "max-w-52", t.text)} value={category} maxLength={40} onChange={(e) => setCategory(e.target.value)} />
          <datalist id={listId}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button type="button" disabled={pending || !text.trim() || !category.trim()} onClick={() => run(() => updateMantraAction({ id: mantra.id, patch: { text, category } }), () => setEditing(false))} className={cn("inline-flex items-center gap-1 rounded-full border px-3 text-xs", t.button)}>
            <Check className="size-3.5" /> Save
          </button>
          <button type="button" onClick={() => (setEditing(false), setText(mantra.text), setCategory(mantra.category))} className={cn("inline-flex items-center gap-1 px-2 text-xs", t.muted)}>
            <X className="size-3.5" /> Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn("group flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.03]", !mantra.enabled && "opacity-50")}>
      {selecting && (
        <input type="checkbox" className="mt-1 size-4 accent-current" aria-label={`Include "${mantra.text}" in sessions`} checked={selected} disabled={!mantra.enabled} onChange={onToggleSelected} />
      )}
      <p className={cn("min-w-0 flex-1 font-serif text-[15px] leading-snug", t.text)}>{mantra.text}</p>
      <div className="flex shrink-0 items-center gap-1">
        <Toggle env={env} checked={mantra.enabled} onChange={(v) => run(() => updateMantraAction({ id: mantra.id, patch: { enabled: v } }))} label={mantra.enabled ? "On" : "Off"} />
        <button type="button" onClick={() => setEditing(true)} aria-label="Edit mantra" className={cn("rounded-full p-1.5 hover:bg-white/10", t.muted)}>
          <Pencil className="size-3.5" />
        </button>
        <button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete mantra" className={cn("rounded-full p-1.5 hover:bg-white/10", t.muted)}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this mantra?"
        description={mantra.defaultKey ? "This is one of the starter mantras. Once deleted it won't be added back." : "This removes it from your library."}
        confirmLabel="Delete"
        variant="destructive"
        isPending={pending}
        onConfirm={() => run(() => deleteMantraAction(mantra.id), () => setConfirmDelete(false))}
      />
    </li>
  );
}

function CategoryHeader({ env, name, count }: { env: EnvironmentId; name: string; count: number }) {
  const t = ENV_THEME[env];
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [pending, start] = useTransition();
  if (renaming) {
    return (
      <div className="flex items-center gap-2">
        <input aria-label="Category name" autoFocus className={cn(inputClass, "max-w-52 py-1", t.text)} value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} />
        <button
          type="button"
          disabled={pending || !draft.trim()}
          onClick={() =>
            start(async () => {
              const r = await renameCategoryAction({ from: name, to: draft });
              if (!r.success) return void toast.error(r.error);
              setRenaming(false);
              router.refresh();
            })
          }
          className={cn("rounded-full border px-3 py-1 text-xs", t.button)}
        >
          Rename
        </button>
        <button type="button" onClick={() => setRenaming(false)} className={cn("text-xs", t.muted)}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-2">
      <h3 className={cn("text-xs font-medium tracking-[0.18em] uppercase", t.accent)}>{name}</h3>
      <span className={cn("text-[11px]", t.muted)}>{count}</span>
      <button type="button" onClick={() => setRenaming(true)} className={cn("text-[11px] opacity-0 transition-opacity group-hover/cat:opacity-100 focus:opacity-100", t.muted)}>
        Rename
      </button>
    </div>
  );
}

/** The trader's personal library — grouped by category, fully editable. */
export function MantraLibrary({ env, mantras, selectedIds, onSelectedIdsChange }: { env: EnvironmentId; mantras: MantraDTO[]; selectedIds: string[]; onSelectedIdsChange: (ids: string[]) => void }) {
  const t = ENV_THEME[env];
  const router = useRouter();
  const listId = useId();
  const categories = [...new Set(mantras.map((m) => m.category))];
  const [text, setText] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "Discipline");
  const [selecting, setSelecting] = useState(selectedIds.length > 0);
  const [pending, start] = useTransition();

  function add() {
    start(async () => {
      const r = await createMantraAction({ text, category });
      if (!r.success) return void toast.error(r.error);
      setText("");
      router.refresh();
    });
  }

  return (
    <Panel env={env} aria-label="Mantra library">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <PanelTitle env={env} hint="Short, honest statements of how you intend to trade. Turn off any you don't want in sessions.">
          Your mantras
        </PanelTitle>
        <Toggle
          env={env}
          checked={selecting}
          onChange={(v) => {
            setSelecting(v);
            if (!v) onSelectedIdsChange([]);
          }}
          label="Choose individual mantras"
        />
      </div>

      <form
        className="mb-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && category.trim()) add();
        }}
      >
        <input aria-label="New mantra" className={cn(inputClass, t.text)} placeholder="e.g. I wait for my setup, then I execute without hesitation." value={text} maxLength={280} onChange={(e) => setText(e.target.value)} />
        <input aria-label="Category for new mantra" list={listId} className={cn(inputClass, "sm:max-w-44", t.text)} placeholder="Category" value={category} maxLength={40} onChange={(e) => setCategory(e.target.value)} />
        <datalist id={listId}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button type="submit" disabled={pending || !text.trim() || !category.trim()} className={cn("inline-flex shrink-0 items-center justify-center gap-1 rounded-full border px-4 py-2 text-sm disabled:opacity-40", t.button)}>
          <Plus className="size-4" /> Add
        </button>
      </form>

      {selecting && (
        <p className={cn("mb-3 text-[11px]", t.muted)}>
          {selectedIds.length > 0 ? `${selectedIds.length} chosen — sessions will use only these.` : "Tick the mantras you want; until you do, sessions use your category choice."}
        </p>
      )}

      {mantras.length === 0 ? (
        <p className={cn("py-6 text-center text-sm", t.muted)}>Your library is empty. Add a mantra above to begin.</p>
      ) : (
        <div className="space-y-5">
          {categories.map((c) => {
            const inCat = mantras.filter((m) => m.category === c);
            return (
              <div key={c} className="group/cat space-y-1">
                <CategoryHeader key={c} env={env} name={c} count={inCat.length} />
                <ul>
                  {inCat.map((m) => (
                    <MantraRow
                      key={`${m.id}-${m.text}-${m.category}`}
                      env={env}
                      mantra={m}
                      categories={categories}
                      selecting={selecting}
                      selected={selectedIds.includes(m.id)}
                      onToggleSelected={() => onSelectedIdsChange(selectedIds.includes(m.id) ? selectedIds.filter((x) => x !== m.id) : [...selectedIds, m.id])}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
