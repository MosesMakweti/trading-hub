"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BookmarkPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { recordObservationAction } from "@/actions/simulation-study.actions";
import type { SimAccountStateDTO } from "@/types/simulation";

export interface StudyOption {
  id: string;
  name: string;
  setups: { id: string; name: string }[];
}

type Kind = "TRADED" | "NOT_TRADED" | "MISSED";
const KIND_LABEL: Record<Kind, string> = { TRADED: "Traded", NOT_TRADED: "Studied", MISSED: "Missed" };

/**
 * Quick capture: file what you're looking at under a study in two clicks.
 * Instrument, replay time and (for a traded one) the position — and with it
 * entry, exit, R and outcome — are taken from the account, not typed.
 */
export function QuickObservation({ state, studies, timeframe }: { state: SimAccountStateDTO; studies: StudyOption[]; timeframe?: string }) {
  const [studyId, setStudyId] = useState(studies[0]?.id ?? "");
  const [setupId, setSetupId] = useState("");
  const recentPositions = useMemo(
    () => [...state.positions.map((p) => ({ id: p.id, label: `${p.symbol} ${p.side === "BUY" ? "buy" : "sell"} ${p.remainingQuantity} · open` })), ...state.history.slice(0, 5).map((h) => ({ id: h.id, label: `${h.symbol} ${h.side === "BUY" ? "buy" : "sell"} ${h.quantity} · ${h.r ?? h.netPnl}` }))],
    [state.positions, state.history],
  );
  const [pickedKind, setKind] = useState<Kind | null>(null);
  const kind: Kind = pickedKind ?? (recentPositions.length ? "TRADED" : "NOT_TRADED");
  const [pickedPositionId, setPositionId] = useState("");
  // Follows the newest position until the trader picks one explicitly.
  const positionId = recentPositions.some((p) => p.id === pickedPositionId) ? pickedPositionId : (recentPositions[0]?.id ?? "");
  const [outcome, setOutcome] = useState<"WIN" | "LOSS" | "BREAKEVEN" | "UNRESOLVED">("UNRESOLVED");
  const [selfR, setSelfR] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const study = studies.find((s) => s.id === studyId);

  if (studies.length === 0) {
    return (
      <section aria-label="Record observation" className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <h2 className="text-xs font-medium text-foreground">Record an observation</h2>
        <p>Create a study to file setup occurrences while you replay.</p>
        <Link href="/backtesting/lab/studies" className="font-medium text-primary underline-offset-4 hover:underline">Open studies</Link>
      </section>
    );
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = selfR.trim() === "" ? null : Number(selfR);
    const res = await recordObservationAction({
      studyId,
      setupId: setupId || null,
      accountId: state.id,
      positionId: kind === "TRADED" ? positionId || null : null,
      kind,
      symbol: state.assets[0],
      timeframe: timeframe ?? null,
      outcome: kind === "TRADED" ? null : outcome,
      selfReportedR: kind === "TRADED" || r == null || !Number.isFinite(r) ? null : r,
      setupTags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      explanation: note || null,
    });
    setBusy(false);
    if (!res.success) return void toast.error(res.error);
    toast.success(`Saved to ${study?.name ?? "study"}`);
    setNote("");
    setTags("");
    setSelfR("");
  };

  const field = "h-7 w-full rounded-md border border-border bg-background px-1.5 text-xs";
  return (
    <form onSubmit={save} aria-label="Record observation" className="space-y-2 border-t border-border pt-3">
      <h2 className="flex items-center gap-1.5 text-xs font-medium"><BookmarkPlus className="size-3.5" /> Record an observation</h2>
      <select aria-label="Study" value={studyId} onChange={(e) => { setStudyId(e.target.value); setSetupId(""); }} className={field}>
        {studies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {study && study.setups.length > 0 && (
        <select aria-label="Setup variation" value={setupId} onChange={(e) => setSetupId(e.target.value)} className={field}>
          <option value="">No variation</option>
          {study.setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <div role="group" aria-label="What happened" className="grid grid-cols-3 rounded-md border border-border p-0.5">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} disabled={k === "TRADED" && recentPositions.length === 0} onClick={() => setKind(k)} className={cn("rounded-[5px] py-0.5 text-[11px] disabled:opacity-40", kind === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {kind === "TRADED" ? (
        <select aria-label="Position" value={positionId} onChange={(e) => setPositionId(e.target.value)} className={field}>
          {recentPositions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} className={field}>
            <option value="UNRESOLVED">Outcome unknown</option>
            <option value="WIN">Would have won</option>
            <option value="LOSS">Would have lost</option>
            <option value="BREAKEVEN">Breakeven</option>
          </select>
          <input aria-label="Self-reported R" inputMode="decimal" value={selfR} onChange={(e) => setSelfR(e.target.value)} placeholder="R (optional)" className={cn(field, "font-mono")} />
        </div>
      )}
      <input aria-label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags: asia low, displacement" className={field} />
      <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What you saw (optional)" className="w-full rounded-md border border-border bg-background px-1.5 py-1 text-xs" />
      <Button type="submit" size="sm" variant="secondary" className="w-full" disabled={busy || !studyId || (kind === "TRADED" && !positionId)}>
        {busy && <Loader2 className="animate-spin" />} Save observation
      </Button>
    </form>
  );
}
