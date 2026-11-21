"use client";

import { useState } from "react";
import { Headphones, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  BREATHING_PATTERNS,
  DURATION_PRESETS_SECONDS,
  ENVIRONMENTS,
  MANTRA_SECONDS_PRESETS,
  MAX_MANTRA_SECONDS,
  MAX_SESSION_SECONDS,
  MIN_MANTRA_SECONDS,
  MIN_SESSION_SECONDS,
  SOUNDS,
  formatDuration,
  type BreathingPatternId,
  type EnvironmentId,
  type MindsetPreferences,
  type SoundId,
} from "@/domain/mindset/options";
import { ambientAudio } from "@/components/mindset/ambient-audio";
import { ENV_THEME, EnvironmentBackdrop } from "@/components/mindset/environment-backdrop";
import { Chip, FieldLabel, Panel, PanelTitle, Toggle } from "@/components/mindset/mindset-ui";

function CustomNumber({ env, valueSeconds, unit, min, max, onChange }: { env: EnvironmentId; valueSeconds: number; unit: "min" | "s"; min: number; max: number; onChange: (seconds: number) => void }) {
  const factor = unit === "min" ? 60 : 1;
  const [draft, setDraft] = useState(String(Math.round(valueSeconds / factor)));
  const commit = () => {
    const n = Math.round(Number(draft) * factor);
    if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
    else setDraft(String(Math.round(valueSeconds / factor)));
  };
  return (
    <label className={cn("inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-xs", ENV_THEME[env].muted)}>
      Custom
      <input
        inputMode="numeric"
        aria-label={`Custom (${unit})`}
        className={cn("w-10 bg-transparent text-center outline-none", ENV_THEME[env].text)}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      {unit}
    </label>
  );
}

/**
 * Session configuration — every choice has a sensible default, so Begin works
 * without touching any of this. Changes are saved as the trader's defaults.
 */
export function SessionSetup({ prefs, onChange, mantraCount, categories }: { prefs: MindsetPreferences; onChange: (patch: Partial<MindsetPreferences>) => void; mantraCount: number; categories: string[] }) {
  const env = prefs.environment;
  const t = ENV_THEME[env];
  const [previewing, setPreviewing] = useState<SoundId | null>(null);

  function preview(sound: SoundId) {
    if (previewing === sound) {
      ambientAudio.stop();
      setPreviewing(null);
      return;
    }
    if (ambientAudio.start(sound, prefs.volume / 100)) setPreviewing(sound);
  }

  return (
    <Panel env={env} aria-label="Session setup">
      <PanelTitle env={env} hint="Saved as your defaults. Everything already has a calm starting point.">
        Session setup
      </PanelTitle>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <FieldLabel env={env}>Environment</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(ENVIRONMENTS) as EnvironmentId[]).map((id) => (
                <button key={id} type="button" aria-pressed={env === id} onClick={() => onChange({ environment: id })} className={cn("overflow-hidden rounded-xl border text-left transition-colors", env === id ? t.ring : "border-white/10 hover:border-white/25")}>
                  <EnvironmentBackdrop environment={id} className="h-16" />
                  <span className="block px-3 py-2">
                    <span className={cn("block text-xs font-medium", t.text)}>{ENVIRONMENTS[id].label}</span>
                    <span className={cn("block text-[11px]", t.muted)}>{ENVIRONMENTS[id].description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel env={env}>Duration</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {DURATION_PRESETS_SECONDS.map((s) => (
                <Chip key={s} env={env} active={prefs.durationSeconds === s} onClick={() => onChange({ durationSeconds: s })}>
                  {formatDuration(s)}
                </Chip>
              ))}
              <CustomNumber key={`d-${prefs.durationSeconds}`} env={env} unit="min" valueSeconds={prefs.durationSeconds} min={MIN_SESSION_SECONDS} max={MAX_SESSION_SECONDS} onChange={(s) => onChange({ durationSeconds: s })} />
            </div>
          </div>

          <div>
            <FieldLabel env={env}>Mantras</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip env={env} active={prefs.selectedCategories.length === 0 && prefs.selectedMantraIds.length === 0} onClick={() => onChange({ selectedCategories: [], selectedMantraIds: [] })}>
                Entire collection
              </Chip>
              {categories.map((c) => {
                const on = prefs.selectedMantraIds.length === 0 && prefs.selectedCategories.includes(c);
                return (
                  <Chip
                    key={c}
                    env={env}
                    active={on}
                    onClick={() =>
                      onChange({
                        selectedMantraIds: [],
                        selectedCategories: on ? prefs.selectedCategories.filter((x) => x !== c) : [...prefs.selectedCategories, c],
                      })
                    }
                  >
                    {c}
                  </Chip>
                );
              })}
            </div>
            <p className={cn("mt-1.5 text-[11px]", t.muted)}>
              {prefs.selectedMantraIds.length > 0 ? `${prefs.selectedMantraIds.length} individually chosen in your library · ` : ""}
              {mantraCount} mantra{mantraCount === 1 ? "" : "s"} in this session
            </p>
          </div>

          <div>
            <FieldLabel env={env}>Slideshow</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip env={env} active={prefs.order === "SEQUENTIAL"} onClick={() => onChange({ order: "SEQUENTIAL" })}>
                In order
              </Chip>
              <Chip env={env} active={prefs.order === "RANDOM"} onClick={() => onChange({ order: "RANDOM" })}>
                Shuffled
              </Chip>
              <span className="mx-1 h-4 w-px bg-white/10" />
              {MANTRA_SECONDS_PRESETS.map((s) => (
                <Chip key={s} env={env} active={prefs.secondsPerMantra === s} onClick={() => onChange({ secondsPerMantra: s })}>
                  {s}s
                </Chip>
              ))}
              <CustomNumber key={`m-${prefs.secondsPerMantra}`} env={env} unit="s" valueSeconds={prefs.secondsPerMantra} min={MIN_MANTRA_SECONDS} max={MAX_MANTRA_SECONDS} onChange={(s) => onChange({ secondsPerMantra: s })} />
            </div>
            <div className="mt-2">
              <Toggle env={env} checked={prefs.repeat} onChange={(v) => onChange({ repeat: v })} label="Repeat the collection until the time is up" />
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <FieldLabel env={env}>Background sound</FieldLabel>
              <Toggle env={env} checked={prefs.audioEnabled} onChange={(v) => onChange({ audioEnabled: v })} label={prefs.audioEnabled ? "On" : "Off"} />
            </div>
            <div className={cn("grid grid-cols-2 gap-2", !prefs.audioEnabled && "opacity-50")}>
              {(Object.keys(SOUNDS) as SoundId[]).map((id) => (
                <div key={id} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2", prefs.sound === id ? t.ring : "border-white/10")}>
                  <button type="button" aria-pressed={prefs.sound === id} disabled={!prefs.audioEnabled} onClick={() => onChange({ sound: id })} className="min-w-0 flex-1 text-left">
                    <span className={cn("block text-xs font-medium", t.text)}>{SOUNDS[id].label}</span>
                    <span className={cn("block truncate text-[11px]", t.muted)}>{SOUNDS[id].description}</span>
                  </button>
                  <button type="button" disabled={!prefs.audioEnabled} onClick={() => preview(id)} aria-label={previewing === id ? `Stop preview of ${SOUNDS[id].label}` : `Preview ${SOUNDS[id].label}`} className={cn("rounded-full p-1.5", t.muted, "hover:bg-white/10")}>
                    {previewing === id ? <Square className="size-3.5" /> : <Headphones className="size-3.5" />}
                  </button>
                </div>
              ))}
            </div>
            <label className={cn("mt-2 flex items-center gap-3 text-xs", t.muted, !prefs.audioEnabled && "opacity-50")}>
              Volume
              <input
                type="range"
                min={0}
                max={100}
                value={prefs.volume}
                disabled={!prefs.audioEnabled}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onChange({ volume: v });
                  ambientAudio.setVolume(v / 100);
                }}
                className="h-1 flex-1"
                aria-label="Volume"
              />
              <span className="w-8 text-right tabular-nums">{prefs.volume}</span>
            </label>
            <p className={cn("mt-1 text-[11px]", t.muted)}>Generated softly in your browser — it starts only when you begin or preview.</p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <FieldLabel env={env}>Breathing first</FieldLabel>
              <Toggle env={env} checked={prefs.breathingEnabled} onChange={(v) => onChange({ breathingEnabled: v })} label={prefs.breathingEnabled ? "On" : "Off"} />
            </div>
            <div className={cn("flex flex-wrap gap-1.5", !prefs.breathingEnabled && "opacity-50")}>
              {(Object.keys(BREATHING_PATTERNS) as BreathingPatternId[]).map((id) => (
                <Chip key={id} env={env} active={prefs.breathingPattern === id} disabled={!prefs.breathingEnabled} onClick={() => onChange({ breathingPattern: id })} title={BREATHING_PATTERNS[id].description}>
                  {BREATHING_PATTERNS[id].label} <span className="opacity-60">· {BREATHING_PATTERNS[id].description}</span>
                </Chip>
              ))}
            </div>
            <p className={cn("mt-1.5 text-[11px]", t.muted)}>A minute or so of gentle breathing before the mantras. You can always skip it.</p>
          </div>
        </div>
      </div>
    </Panel>
  );
}
