"use client";

import { useId, useState, useTransition } from "react";
import { Brain, Loader2 } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { setPsychologyResetEnabledAction } from "@/actions/psychology-reset.actions";

/**
 * Settings → Trading Preferences → Trading Psychology Reset (optional; OFF
 * by default). The switch shows the PERSISTED value: while saving it is
 * disabled, and a failed save reverts it and says so — the UI never claims
 * a change that wasn't stored. Turning it off only stops future prompts;
 * nothing is deleted.
 */
export function PsychologyResetCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const labelId = useId();
  const descId = useId();
  const shown = pending ?? enabled;

  function toggle(next: boolean) {
    setError(null);
    setPending(next);
    startSave(async () => {
      try {
        const r = await setPsychologyResetEnabledAction({ enabled: next });
        if (!r.success) throw new Error(r.error);
        setEnabled(r.enabled);
      } catch {
        setError(`Couldn't save — Trading Psychology Reset is still ${enabled ? "on" : "off"}. Try again.`);
      } finally {
        setPending(null);
      }
    });
  }

  return (
    <div className="glass space-y-3 rounded-2xl p-5" data-testid="psychology-reset-card">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/40 text-muted-foreground">
          <Brain className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div id={labelId} className="text-sm font-medium">
              Trading Psychology Reset
            </div>
            <div className="flex items-center gap-2">
              {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
              <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase" aria-hidden>
                {shown ? "On" : "Off"}
              </span>
              <Switch
                checked={shown}
                disabled={saving}
                onCheckedChange={(v) => toggle(v)}
                aria-labelledby={labelId}
                aria-describedby={descId}
              />
            </div>
          </div>
          <p id={descId} className="mt-0.5 text-sm text-muted-foreground">
            Receive a guided psychological reset after losing trades and missed opportunities. Reinforce probabilistic thinking, recognize
            emotional triggers, and make more deliberate decisions before your next trade.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Off by default. Turning it off stops future prompts; your past reflections are kept.
          </p>
          <p className="sr-only" aria-live="polite">
            {saving ? "Saving…" : `Trading Psychology Reset is ${enabled ? "on" : "off"}.`}
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
