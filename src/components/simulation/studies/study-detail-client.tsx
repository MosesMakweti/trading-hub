"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addSetupAction, deleteObservationAction, setStudyStatusAction } from "@/actions/simulation-study.actions";
import type { ObservationDTO } from "@/server/services/simulation/sim-study.service";
import { fmtR, fmtWallClock, pnlTone } from "../format";

const STATUSES = ["PLANNED", "ACTIVE", "COMPLETED", "ARCHIVED"] as const;

export function StudyStatusSelect({ studyId, status }: { studyId: string; status: (typeof STATUSES)[number] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Status
      <select
        value={status}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const res = await setStudyStatusAction({ studyId, status: e.target.value });
            if (!res.success) toast.error(res.error);
            router.refresh();
          })
        }
        className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
      >
        {STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
      </select>
    </label>
  );
}

export function AddSetupForm({ studyId }: { studyId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await addSetupAction({ studyId, name });
          if (!res.success) return void toast.error(res.error);
          setName("");
          router.refresh();
        });
      }}
    >
      <input aria-label="New variation name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New variation" maxLength={80} className="h-8 w-48 rounded-md border border-border bg-background px-2 text-sm" />
      <Button type="submit" size="sm" variant="outline" disabled={pending || !name.trim()}>Add</Button>
    </form>
  );
}

const KIND: Record<ObservationDTO["kind"], string> = { TRADED: "Traded", NOT_TRADED: "Studied", MISSED: "Missed" };
const OUTCOME: Record<ObservationDTO["outcome"], { label: string; tone: string }> = {
  WIN: { label: "Win", tone: "text-emerald-500" },
  LOSS: { label: "Loss", tone: "text-red-400" },
  BREAKEVEN: { label: "Breakeven", tone: "text-muted-foreground" },
  UNRESOLVED: { label: "Unknown", tone: "text-muted-foreground" },
  OPEN: { label: "Open", tone: "text-sky-400" },
};

export function ObservationList({ studyId, observations }: { studyId: string; observations: ObservationDTO[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (observations.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
        No observations yet. Open a backtest in the terminal and use <span className="font-medium text-foreground">Record an observation</span> under the order ticket.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {observations.map((o) => (
        <li key={o.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-start sm:gap-4">
          <div className="font-mono text-xs tabular-nums text-muted-foreground">
            {fmtWallClock(o.time)}
            <div>{o.symbol}{o.timeframe ? ` · ${o.timeframe}` : ""}</div>
          </div>
          <div className="min-w-0 space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{KIND[o.kind]}</span>
              {o.setupName && <span className="font-medium">{o.setupName}</span>}
              <span className={cn("text-xs", OUTCOME[o.outcome].tone)}>{OUTCOME[o.outcome].label}</span>
              {o.r != null && <span className={cn("font-mono text-xs tabular-nums", pnlTone(o.r))}>{fmtR(o.r)}{o.rSelfReported ? " (self-reported)" : ""}</span>}
              {o.position && <span className="font-mono text-xs text-muted-foreground tabular-nums">{o.position.side === "BUY" ? "Buy" : "Sell"} @ {o.position.entry}</span>}
            </div>
            {o.explanation && <p className="whitespace-pre-line text-muted-foreground">{o.explanation}</p>}
            {o.lessons && <p className="whitespace-pre-line"><span className="text-xs font-medium">Lesson: </span>{o.lessons}</p>}
            {(o.setupTags.length > 0 || o.confirmationTags.length > 0) && (
              <p className="text-xs text-muted-foreground">{[...o.setupTags, ...o.confirmationTags].map((t) => `#${t}`).join("  ")}</p>
            )}
            {o.accountId && <Link href={`/backtesting/terminal/${o.accountId}`} className="text-xs text-primary underline-offset-4 hover:underline">Open the backtest</Link>}
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete observation"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteObservationAction(o.id, studyId);
                if (!res.success) return void toast.error(res.error);
                router.refresh();
              })
            }
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  );
}
