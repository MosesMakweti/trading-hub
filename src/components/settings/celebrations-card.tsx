"use client";

import { useId, useState, useTransition } from "react";
import { Award, Loader2 } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { setCelebrationPreferencesAction } from "@/actions/celebrations.actions";
import type { CelebrationPreferencesDTO } from "@/types/achievements";

/**
 * Settings → Celebrations. Each switch shows the PERSISTED value: while
 * saving it is disabled, and a failed save reverts it and says so.
 */
export function CelebrationsCard({ initial }: { initial: CelebrationPreferencesDTO }) {
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const animId = useId();
  const soundId = useId();

  function save(patch: Partial<CelebrationPreferencesDTO>) {
    setError(null);
    start(async () => {
      const r = await setCelebrationPreferencesAction(patch);
      if (r.success) setPrefs(r.data);
      else setError("Couldn't save — your previous setting is still in place. Try again.");
    });
  }

  return (
    <div className="glass space-y-3 rounded-2xl p-5" data-testid="celebrations-card">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/40 text-muted-foreground">
          <Award className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Celebrations</div>
            {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
          </div>
          <p className="-mt-2 text-sm text-muted-foreground">
            How milestones, achievements and completed goals are recognised. You can always see them later in Achievements.
          </p>
          <Row
            id={animId}
            label="Animations"
            description="Badge reveals and the particle effect for major milestones. Reduced-motion settings on your device are always respected."
            checked={prefs.animations}
            disabled={saving}
            onChange={(v) => save({ animations: v })}
          />
          <Row
            id={soundId}
            label="Sound"
            description="A soft chime with medium and major celebrations — only ever after you've interacted with the page."
            checked={prefs.sound}
            disabled={saving}
            onChange={(v) => save({ sound: v })}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v)} />
    </div>
  );
}
