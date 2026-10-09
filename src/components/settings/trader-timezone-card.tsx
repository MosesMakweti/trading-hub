"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Globe } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setTraderTimezoneAction } from "@/actions/trader-time.actions";
import { allTimeZones } from "@/lib/timezones";
import type { TraderTimezoneState } from "@/server/services/trader-time.service";

function formatInstant(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * Trading timezone (Preparation Phase 0). Decides which local date "today"
 * is across Today, Journal and Dashboard. The browser's zone is only a
 * suggestion; nothing changes until the trader confirms, and a confirmed
 * change starts with the next local date.
 */
export function TraderTimezoneCard({ initial }: { initial: TraderTimezoneState }) {
  const [state, setState] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const zones = useMemo(() => allTimeZones(), []);
  // The device zone is read after mount (never during SSR, where it would be
  // the server's) and is only ever a suggestion.
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  const [choice, setChoice] = useState(state.pending?.timezone ?? state.timezone);
  useEffect(() => {
    let zone: string | null = null;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of a browser-only value after hydration
    setBrowserZone(zone);
    if (zone && !initial.configured && !initial.pending) setChoice(zone);
  }, [initial.configured, initial.pending]);
  const target = state.pending?.timezone ?? state.timezone;
  const unchanged = state.configured || state.pending ? choice === target : false;

  function confirm() {
    startTransition(async () => {
      const result = await setTraderTimezoneAction(choice);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setState(result.state);
      toast.success(result.state.pending ? "Timezone saved — it takes effect from your next local day." : "Timezone saved.");
    });
  }

  return (
    <div className="glass space-y-4 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/40 text-muted-foreground">
          <Globe className="size-4.5" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">Trading timezone</div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Decides which date &ldquo;today&rdquo; is in Today, the Journal and the Dashboard, and the zone of your
            Preparation Schedule. A change starts with your next local day — today and past days never move.
          </p>
        </div>
      </div>

      <div className="space-y-1 text-sm">
        <p>
          <span className="text-muted-foreground">In effect: </span>
          {state.configured ? state.timezone : "Not set — using UTC"}
          <span className="text-muted-foreground"> · today is {state.todayKey}</span>
        </p>
        {state.pending && (
          <p>
            <span className="text-muted-foreground">Scheduled: </span>
            {state.pending.timezone}
            <span className="text-muted-foreground"> from {formatInstant(state.pending.effectiveFrom, state.pending.timezone)}</span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Trading timezone"
          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
              {z === browserZone ? " (this device)" : ""}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={confirm} disabled={isPending || unchanged}>
          Confirm timezone
        </Button>
      </div>
      {!state.configured && !state.pending && browserZone && (
        <p className="text-xs text-muted-foreground">Suggested from this device: {browserZone}. Nothing changes until you confirm.</p>
      )}
    </div>
  );
}
