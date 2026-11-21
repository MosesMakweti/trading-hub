"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, Sprout } from "lucide-react";

import { cn } from "@/lib/utils";
import { dismissRecommendationAction, savePreferencesAction, startSessionAction } from "@/actions/mindset.actions";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { BREATHING_PATTERNS, ENVIRONMENTS, SOUNDS, formatDuration, type MindsetPreferences } from "@/domain/mindset/options";
import { mantrasForRecommendation, type MindsetRecommendation } from "@/domain/mindset/recommendations";
import { selectSessionMantras } from "@/domain/mindset/selection";
import type { MindsetDashboard as DashboardData } from "@/server/services/mindset.service";
import { ambientAudio } from "@/components/mindset/ambient-audio";
import { ENV_THEME, EnvironmentBackdrop } from "@/components/mindset/environment-backdrop";
import { MantraLibrary } from "@/components/mindset/mantra-library";
import { MeditationSession, type SessionPlan } from "@/components/mindset/meditation-session";
import { RecommendationCard } from "@/components/mindset/recommendation-card";
import { SessionHistory } from "@/components/mindset/session-history";
import { SessionSetup } from "@/components/mindset/session-setup";

/**
 * Mindset dashboard — the calm landing page: one primary action (Begin),
 * an optional recommendation from Edge Review, then setup, library and a
 * plain history. Starting a session happens inside the click (so audio is
 * allowed to play) and mounts the full-screen MeditationSession over the app.
 */
export function MindsetDashboard({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<MindsetPreferences>(data.preferences);
  const [plan, setPlan] = useState<(SessionPlan & { nonce: number; rec: MindsetRecommendation | null }) | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const setupRef = useRef<HTMLDivElement>(null);
  const env = prefs.environment;
  const t = ENV_THEME[env];

  // Settings persist quietly as the trader's defaults.
  useDebouncedAutosave({
    value: prefs,
    serialize: (p) => JSON.stringify(p),
    save: (p) => savePreferencesAction(p),
    onError: (m) => toast.error(m),
  });
  const update = (patch: Partial<MindsetPreferences>) => setPrefs((p) => ({ ...p, ...patch }));

  const categories = useMemo(() => [...new Set(data.mantras.map((m) => m.category))], [data.mantras]);
  const sessionMantras = useMemo(() => selectSessionMantras(data.mantras, { mantraIds: prefs.selectedMantraIds, categories: prefs.selectedCategories }), [data.mantras, prefs.selectedMantraIds, prefs.selectedCategories]);
  const recommendation = data.recommendations.find((r) => !dismissed.includes(r.key)) ?? null;
  const recMantras = recommendation ? mantrasForRecommendation(recommendation, data.mantras) : [];

  // Nothing behind the session should scroll; stray audio stops when leaving Mindset.
  useEffect(() => {
    if (!plan) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [plan]);
  useEffect(() => () => ambientAudio.stop(), []);

  function begin(rec: MindsetRecommendation | null) {
    const mantras = rec
      ? recMantras.length > 0
        ? recMantras.map((m) => ({ id: m.id, text: m.text, category: m.category }))
        : rec.fallbackMantras.map((text, i) => ({ id: `suggested-${i}`, text, category: rec.title }))
      : sessionMantras.map((m) => ({ id: m.id, text: m.text, category: m.category }));
    if (mantras.length === 0) {
      toast.error("Turn on at least one mantra (or choose a different selection) to begin.");
      return;
    }
    // Inside the click: browsers allow audio to start now.
    const audioStarted = prefs.audioEnabled ? ambientAudio.start(prefs.sound, prefs.volume / 100) : false;
    const durationSeconds = rec ? rec.durationSeconds : prefs.durationSeconds;
    const categoriesUsed = rec ? rec.categories : [...new Set(mantras.map((m) => m.category ?? ""))].filter(Boolean);
    const sessionId = startSessionAction({
      plannedSeconds: durationSeconds,
      environment: prefs.environment,
      sound: audioStarted ? prefs.sound : null,
      categories: categoriesUsed,
      mantraCount: mantras.length,
      recommendationKey: rec?.key ?? null,
    }).then((r) => (r.success ? r.id : null));
    setPlan({
      nonce: Date.now(),
      rec,
      title: rec ? rec.title : null,
      mantras,
      durationSeconds,
      secondsPerMantra: prefs.secondsPerMantra,
      order: prefs.order,
      repeat: prefs.repeat,
      environment: prefs.environment,
      audio: { enabled: audioStarted, sound: prefs.sound, volume: prefs.volume },
      breathing: prefs.breathingEnabled ? BREATHING_PATTERNS[prefs.breathingPattern] : null,
      categories: categoriesUsed,
      recommendationKey: rec?.key ?? null,
      sessionId,
      seed: Math.floor(Math.random() * 2 ** 31),
    });
  }

  function dismiss(rec: MindsetRecommendation) {
    setDismissed((d) => [...d, rec.key]);
    void dismissRecommendationAction({ key: rec.key }).then((r) => !r.success && toast.error(r.error));
  }

  function customize(rec: MindsetRecommendation) {
    update({ selectedMantraIds: [], selectedCategories: rec.categories.filter((c) => categories.includes(c)), durationSeconds: rec.durationSeconds });
    setupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const summary = [
    formatDuration(prefs.durationSeconds),
    ENVIRONMENTS[env].label,
    prefs.audioEnabled ? SOUNDS[prefs.sound].label : "No sound",
    prefs.breathingEnabled ? `${BREATHING_PATTERNS[prefs.breathingPattern].label} breathing` : "No breathing",
    `${sessionMantras.length} mantra${sessionMantras.length === 1 ? "" : "s"}`,
  ];

  return (
    <>
      <EnvironmentBackdrop environment={env} className="-m-6 min-h-[calc(100dvh-3.5rem)] p-4 sm:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Welcome + the one primary action */}
          <header className="flex flex-col items-center gap-5 pt-6 pb-2 text-center sm:pt-10">
            <span className={cn("inline-flex size-11 items-center justify-center rounded-full border", t.ring, t.accentSoft)}>
              <Sprout className={cn("size-5", t.accent)} />
            </span>
            <div className="space-y-2">
              <h1 className={cn("font-serif text-4xl tracking-wide sm:text-5xl", t.text)}>Mindset</h1>
              <p className={cn("mx-auto max-w-xl text-sm sm:text-base", t.muted)}>Step away from the charts for a few minutes. Settle your breathing, and remind yourself how you intend to trade today.</p>
            </div>
            <button type="button" onClick={() => begin(null)} className={cn("inline-flex items-center gap-2 rounded-full border px-7 py-3 text-base font-medium shadow-lg transition-colors", t.button)}>
              <Play className="size-4" /> Begin session
            </button>
            <p className={cn("text-xs", t.muted)}>{summary.join(" · ")}</p>
          </header>

          {recommendation && (
            <RecommendationCard
              env={env}
              rec={recommendation}
              mantraCount={recMantras.length > 0 ? recMantras.length : recommendation.fallbackMantras.length}
              usesFallback={recMantras.length === 0}
              onStart={() => begin(recommendation)}
              onCustomize={() => customize(recommendation)}
              onDismiss={() => dismiss(recommendation)}
            />
          )}

          <div ref={setupRef} className="scroll-mt-6">
            <SessionSetup prefs={prefs} onChange={update} mantraCount={sessionMantras.length} categories={categories} />
          </div>

          <MantraLibrary env={env} mantras={data.mantras} selectedIds={prefs.selectedMantraIds} onSelectedIdsChange={(ids) => update({ selectedMantraIds: ids })} />

          <SessionHistory env={env} sessions={data.sessions} />
        </div>
      </EnvironmentBackdrop>

      {plan && (
        <MeditationSession
          key={plan.nonce}
          plan={plan}
          onReturn={() => {
            setPlan(null);
            router.refresh();
          }}
          onRepeat={() => begin(plan.rec)}
          onFinish={() => {
            setPlan(null);
            router.push("/today");
          }}
        />
      )}
    </>
  );
}
