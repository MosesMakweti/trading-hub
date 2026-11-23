"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createTradingSessionAction, deleteTradingSessionAction, updateTradingSessionAction } from "@/actions/charting.actions";
import { isValidTimeZone, type SessionDef } from "@/domain/charting/sessions";
import { daysLabel } from "./session-navigator";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ZONES = ["Europe/London", "America/New_York", "Asia/Tokyo", "Australia/Sydney", "Europe/Frankfurt", "Asia/Hong_Kong", "UTC"];

type Draft = Omit<SessionDef, "id" | "builtIn" | "intersect"> & { id?: string };
const blank: Draft = { name: "", start: "08:00", end: "11:00", timeZone: "America/New_York", days: [1, 2, 3, 4, 5], color: "#8ab4f8", description: "", enabled: true };

/** Create, edit, duplicate, enable/disable and delete the trader's own sessions. Built-ins can be duplicated. */
export function SessionEditor({ open, onOpenChange, sessions, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; sessions: SessionDef[]; onChanged: (custom: SessionDef[]) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const custom = sessions.filter((s) => !s.builtIn);

  const save = async () => {
    if (!draft) return;
    if (!isValidTimeZone(draft.timeZone)) return void toast.error(`"${draft.timeZone}" isn't a recognised time zone.`);
    setBusy(true);
    const body = { name: draft.name, start: draft.start, end: draft.end, timeZone: draft.timeZone, days: draft.days, color: draft.color, description: draft.description || null, enabled: draft.enabled };
    const res = draft.id ? await updateTradingSessionAction({ id: draft.id, session: body }) : await createTradingSessionAction(body);
    setBusy(false);
    if (!res.success) return void toast.error(res.error);
    onChanged(draft.id ? custom.map((s) => (s.id === draft.id ? res.session : s)) : [...custom, res.session]);
    setDraft(null);
  };

  const remove = async (s: SessionDef) => {
    if (!confirm(`Delete the session “${s.name}”?`)) return;
    const res = await deleteTradingSessionAction({ id: s.id });
    if (!res.success) return void toast.error(res.error);
    onChanged(custom.filter((x) => x.id !== s.id));
  };

  const toggle = async (s: SessionDef) => {
    const res = await updateTradingSessionAction({ id: s.id, session: { name: s.name, start: s.start, end: s.end, timeZone: s.timeZone, days: s.days, color: s.color, description: s.description ?? null, enabled: !s.enabled } });
    if (!res.success) return void toast.error(res.error);
    onChanged(custom.map((x) => (x.id === s.id ? res.session : x)));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), !o && setDraft(null))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sessions</DialogTitle>
          <DialogDescription>Times are in each session&apos;s own time zone, so daylight saving follows that place&apos;s calendar.</DialogDescription>
        </DialogHeader>
        {draft ? (
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Row label="Name">
              <input required maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="London Killzone" className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" />
            </Row>
            <Row label="Time">
              <div className="flex items-center gap-1.5">
                <input type="time" required value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className="h-8 rounded-md border border-border bg-background px-1.5 text-sm" aria-label="Start" />
                <span className="text-muted-foreground">→</span>
                <input type="time" required value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className="h-8 rounded-md border border-border bg-background px-1.5 text-sm" aria-label="End" />
                {draft.end <= draft.start && <span className="text-[11px] text-muted-foreground">overnight (ends next day)</span>}
              </div>
            </Row>
            <Row label="Time zone">
              <input list="session-zones" required value={draft.timeZone} onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })} className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" aria-label="Time zone" />
              <datalist id="session-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
            </Row>
            <Row label="Days">
              <div className="flex flex-wrap gap-1">
                {DAY.map((d, i) => {
                  const on = draft.days.includes(i);
                  return (
                    <button key={d} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, days: on ? draft.days.filter((x) => x !== i) : [...draft.days, i].sort() })} className={cn("h-7 w-10 rounded-md border text-xs", on ? "border-foreground/40 bg-muted" : "border-border text-muted-foreground")}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </Row>
            <Row label="Colour">
              <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent" aria-label="Colour" />
            </Row>
            <Row label="Notes">
              <input maxLength={280} value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" aria-label="Description" />
            </Row>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              <Button type="submit" disabled={busy || !draft.days.length}>{draft.id ? "Save" : "Create session"}</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
              {sessions.map((s) => (
                <li key={s.id} className={cn("flex items-center gap-2 px-2.5 py-2", !s.enabled && "opacity-60")}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {s.name} {s.builtIn && <span className="text-[10px] font-normal uppercase text-muted-foreground">built-in</span>}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{s.intersect ? "London ∩ New York" : `${s.start}–${s.end} ${s.timeZone} · ${daysLabel(s.days)}`}</span>
                  </span>
                  {!s.builtIn && (
                    <>
                      <input type="checkbox" checked={s.enabled} onChange={() => void toggle(s)} aria-label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`} className="size-3.5" />
                      <button type="button" onClick={() => setDraft({ ...s })} className="rounded p-1 hover:bg-muted" aria-label={`Edit ${s.name}`}><Pencil className="size-3.5" /></button>
                    </>
                  )}
                  {!s.intersect && (
                    <button type="button" onClick={() => setDraft({ name: `${s.name} (copy)`, start: s.start, end: s.end, timeZone: s.timeZone, days: s.days, color: s.color, description: s.description ?? "", enabled: true })} className="rounded p-1 hover:bg-muted" aria-label={`Duplicate ${s.name}`}><Copy className="size-3.5" /></button>
                  )}
                  {!s.builtIn && (
                    <button type="button" onClick={() => void remove(s)} className="rounded p-1 hover:bg-muted hover:text-red-400" aria-label={`Delete ${s.name}`}><Trash2 className="size-3.5" /></button>
                  )}
                </li>
              ))}
            </ul>
            <Button size="sm" onClick={() => setDraft({ ...blank })}>
              <Plus /> New session
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
