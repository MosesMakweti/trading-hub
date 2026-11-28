"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setMt5TimeConventionAction } from "@/actions/mt5-connector.actions";
import type { ServerTimeConvention } from "@/domain/mt5-account/server-time";

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

/** Lets the trader correct how MT5 server time maps to UTC. Re-normalizes
 *  stored UTC times only — raw broker records never change. */
export function TimeConventionForm({ connectionId, current }: { connectionId: string; current: ServerTimeConvention | null }) {
  const router = useRouter();
  const [kind, setKind] = useState<ServerTimeConvention["kind"]>(current?.kind ?? "FIXED_OFFSET");
  const [offsetHours, setOffsetHours] = useState(current?.kind === "FIXED_OFFSET" ? String(current.offsetMinutes / 60) : "2");
  const [zone, setZone] = useState(current?.kind === "IANA_ZONE" ? current.zone : "Europe/Athens");
  const [isPending, startTransition] = useTransition();

  function save() {
    const convention =
      kind === "FIXED_OFFSET"
        ? { kind, offsetMinutes: Math.round(Number(offsetHours) * 60) }
        : kind === "IANA_ZONE"
          ? { kind, zone: zone.trim() }
          : { kind };
    startTransition(async () => {
      const result = await setMt5TimeConventionAction(connectionId, convention);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Server-time setting saved. ${result.updatedDeals} deal time(s) re-normalized.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
        <span className="text-xs text-muted-foreground">Broker server clock</span>
        <select className={`${selectClass} w-full max-w-full sm:w-auto`} value={kind} onChange={(e) => setKind(e.target.value as ServerTimeConvention["kind"])}>
          <option value="NY_CLOSE">GMT+2 / +3 with US daylight saving (most FX brokers)</option>
          <option value="FIXED_OFFSET">Fixed offset, no daylight saving</option>
          <option value="IANA_ZONE">A specific time zone</option>
        </select>
      </label>
      {kind === "FIXED_OFFSET" && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">GMT offset (hours)</span>
          <input className={`${selectClass} w-24`} type="number" step="0.25" min="-14" max="14" value={offsetHours} onChange={(e) => setOffsetHours(e.target.value)} />
        </label>
      )}
      {kind === "IANA_ZONE" && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">IANA time zone</span>
          <input className={`${selectClass} w-48`} value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Europe/Athens" />
        </label>
      )}
      <Button type="button" size="sm" onClick={save} disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
