"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { formatRR } from "@/components/journal/workspace/workspace-ui";
import {
  deletePartialExitAction,
  listPartialExitsAction,
  upsertPartialExitAction,
  type PartialExitRowDTO,
} from "@/actions/trade-review.actions";
import { useWorkspace } from "@/components/workspace/workspace-context";

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface DraftRow {
  exitPrice: string;
  percentClosed: string;
  exitedAt: string; // datetime-local value
  notes: string;
}

/** New exit rows default to "now" — except in a backtest, where the real
 *  clock is meaningless: the simulation date, at the current time of day. */
function emptyDraft(dateKey: string, isBacktest: boolean): DraftRow {
  const now = isoToDatetimeLocal(new Date().toISOString());
  return { exitPrice: "", percentClosed: "", exitedAt: isBacktest ? `${dateKey}${now.slice(10)}` : now, notes: "" };
}

/**
 * Trade Review overhaul (Stage 7 §2) — the first UI for the pre-existing
 * TradeActualPartialExit architecture (trade-partial-exit.service.ts had no
 * UI at all before this). Every save triggers settlePerformanceTrade
 * server-side (see the service), so realized R / Performance PnL recompute
 * automatically — never entered manually here.
 */
export function PartialExitsEditor({
  dateKey,
  tradeId,
  quickFills,
  title = "Actual partial exits",
  emptyHint = "No partial exits recorded — a single Actual exit above is treated as one 100% exit.",
}: {
  dateKey: string;
  tradeId: string;
  /** Today V3: one-click DRAFT prefills from the plan's targets ("Hit TP1").
   *  They only fill the draft — nothing is recorded until "Save exit". */
  quickFills?: { label: string; price: number; percent: number | null }[];
  title?: string;
  emptyHint?: string;
}) {
  const editable = useWorkspaceEditable();
  const { isBacktest } = useWorkspace();
  const router = useRouter();
  const [exits, setExits] = useState<PartialExitRowDTO[] | null>(null);
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const rows = await listPartialExitsAction(tradeId);
      if (active) setExits(rows);
    })();
    return () => {
      active = false;
    };
  }, [tradeId]);

  async function save() {
    if (!draft) return;
    const price = Number(draft.exitPrice);
    if (!draft.exitPrice.trim() || Number.isNaN(price)) {
      toast.error("Enter a valid exit price.");
      return;
    }
    const percent = draft.percentClosed.trim() === "" ? null : Number(draft.percentClosed);
    if (percent != null && (Number.isNaN(percent) || percent <= 0 || percent > 100)) {
      toast.error("Percent closed must be between 0 and 100.");
      return;
    }
    const nextOrder = ((exits ?? []).reduce((max, e) => Math.max(max, e.exitOrder), 0) || 0) + 1;
    setSaving(true);
    const result = await upsertPartialExitAction(dateKey, tradeId, {
      exitOrder: nextOrder,
      exitPrice: price,
      percentClosed: percent,
      exitedAt: new Date(draft.exitedAt).toISOString(),
      notes: draft.notes.trim() || null,
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setDraft(null);
    setExits(await listPartialExitsAction(tradeId));
    router.refresh();
  }

  async function remove(id: string) {
    setSaving(true);
    const result = await deletePartialExitAction(dateKey, tradeId, id);
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setExits(await listPartialExitsAction(tradeId));
    router.refresh();
  }

  if (exits == null) {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  }

  const totalPercent = exits.reduce((sum, e) => sum + (e.percentClosed ?? 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span className="text-xs text-muted-foreground/70 tabular-nums">{totalPercent.toFixed(0)}% closed</span>
      </div>

      {exits.length === 0 && draft == null && (
        <p className="text-xs text-muted-foreground/60 italic">{emptyHint}</p>
      )}

      <div className="space-y-1.5">
        {exits.map((e) => (
          <div
            key={e.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 px-2.5 py-1.5 text-sm"
          >
            <span className="font-medium tabular-nums">#{e.exitOrder}</span>
            <span className="tabular-nums">{e.exitPrice}</span>
            {e.percentClosed != null && (
              <span className="text-xs text-muted-foreground tabular-nums">{e.percentClosed}%</span>
            )}
            {e.realizedR != null && (
              <span className="text-xs font-medium text-muted-foreground">{formatRR(e.realizedR)}</span>
            )}
            <span className="text-xs text-muted-foreground/70">
              {new Date(e.exitedAt).toLocaleString()}
            </span>
            {editable && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="ml-auto"
                aria-label={`Remove exit #${e.exitOrder}`}
                disabled={saving}
                onClick={() => remove(e.id)}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
      </div>

      {editable && draft == null && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setDraft(emptyDraft(dateKey, isBacktest))}>
            <Plus className="size-3.5" />
            Add exit
          </Button>
          {quickFills?.map((q) => (
            <Button
              key={q.label}
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                setDraft({
                  ...emptyDraft(dateKey, isBacktest),
                  exitPrice: String(q.price),
                  percentClosed: q.percent != null ? String(q.percent) : "",
                })
              }
            >
              Hit {q.label}
            </Button>
          ))}
          {quickFills && totalPercent > 0 && totalPercent < 100 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                setDraft({ ...emptyDraft(dateKey, isBacktest), percentClosed: String(Math.round((100 - totalPercent) * 100) / 100) })
              }
            >
              Close remaining {Math.round((100 - totalPercent) * 100) / 100}%
            </Button>
          )}
        </div>
      )}

      {editable && draft != null && (
        <div className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Input
              type="number"
              step="any"
              placeholder="Exit price"
              aria-label="Partial exit price"
              value={draft.exitPrice}
              onChange={(e) => setDraft({ ...draft, exitPrice: e.target.value })}
            />
            <Input
              type="number"
              step="any"
              placeholder="% closed"
              aria-label="Percent closed"
              value={draft.percentClosed}
              onChange={(e) => setDraft({ ...draft, percentClosed: e.target.value })}
            />
            <Input
              type="datetime-local"
              aria-label="Exited at"
              className="col-span-2"
              value={draft.exitedAt}
              onChange={(e) => setDraft({ ...draft, exitedAt: e.target.value })}
            />
          </div>
          <Input
            placeholder="Notes (optional)"
            aria-label="Partial exit notes"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save exit"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
