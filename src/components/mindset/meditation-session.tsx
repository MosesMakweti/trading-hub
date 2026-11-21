"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, Pause, Play, Shrink, Volume2, VolumeX, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { endSessionAction } from "@/actions/mindset.actions";
import { currentMantraIndex, initialSession, sessionReducer, type SessionConfig } from "@/domain/mindset/session";
import { SOUNDS, type BreathingPattern, type EnvironmentId, type SoundId } from "@/domain/mindset/options";
import { ambientAudio } from "@/components/mindset/ambient-audio";
import { BreathingGuide } from "@/components/mindset/breathing-guide";
import { MantraSlideshow } from "@/components/mindset/mantra-slideshow";
import { ENV_THEME, EnvironmentBackdrop } from "@/components/mindset/environment-backdrop";

export interface SessionPlan {
  title: string | null;
  mantras: { id: string; text: string; category: string | null }[];
  durationSeconds: number;
  secondsPerMantra: number;
  order: "SEQUENTIAL" | "RANDOM";
  repeat: boolean;
  environment: EnvironmentId;
  audio: { enabled: boolean; sound: SoundId; volume: number };
  breathing: BreathingPattern | null;
  categories: string[];
  recommendationKey: string | null;
  /** The history row, created by the caller in the Begin click (so React's
   *  dev double-mount can never create two). Resolves to null if recording failed. */
  sessionId: Promise<string | null>;
  /** Shuffle seed, chosen at Begin (render must stay pure). */
  seed: number;
}

const TICK_MS = 100;

/** Sessions currently mounted (a repeat mounts the next before the last's
 *  deferred cleanup runs) — audio is only stopped when none remain. */
let mountedSessions = 0;
const CONTROLS_IDLE_MS = 3500;

function isTyping(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement);
}

/**
 * The immersive session: environment → (optional) breathing → mantra
 * slideshow → a gentle close. Orchestration only — timing lives in the pure
 * reducer (domain/mindset/session), visuals in the slideshow/breathing
 * components, sound in the shared ambient engine.
 *
 * Robustness: one interval drives everything and is cleared on unmount; the
 * session pauses when the tab is hidden; the audio stops when the session
 * component goes away; the history row is ended exactly once (completed, or
 * interrupted if the trader leaves early).
 */
export function MeditationSession({ plan, onReturn, onRepeat, onFinish }: { plan: SessionPlan; onReturn: () => void; onRepeat: () => void; onFinish: () => void }) {
  const config: SessionConfig = useMemo(
    () => ({
      durationMs: plan.durationSeconds * 1000,
      slideMs: plan.secondsPerMantra * 1000,
      mantraCount: plan.mantras.length,
      order: plan.order,
      repeat: plan.repeat,
      breathing: plan.breathing,
      seed: plan.seed,
    }),
    [plan],
  );
  const reducer = useMemo(() => sessionReducer(config), [config]);
  const [state, dispatch] = useReducer(reducer, config, initialSession);
  const theme = ENV_THEME[plan.environment];

  const [audioOn, setAudioOn] = useState(plan.audio.enabled);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(plan.audio.volume);
  const [awayPaused, setAwayPaused] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── The single clock ─────────────────────────────────────────────────────
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      dispatch({ type: "TICK", dt: now - last });
      last = now;
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // ── Tab visibility: pause while away (and quiet the audio) ───────────────
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        dispatch({ type: "PAUSE" });
        setAwayPaused(true);
        ambientAudio.pause();
      } else if (audioOn) {
        ambientAudio.resume();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [audioOn]);

  // ── Session history: one row, ended exactly once ─────────────────────────
  const ended = useRef(false);
  const activeMsRef = useRef(0);
  useEffect(() => {
    activeMsRef.current = state.activeMs;
  }, [state.activeMs]);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    mountedSessions += 1;
    return () => {
      alive.current = false;
      mountedSessions -= 1;
      // Deferred so React's dev double-mount (unmount → immediate remount)
      // isn't mistaken for the trader leaving.
      window.setTimeout(() => {
        if (alive.current) return;
        if (!ended.current) {
          ended.current = true;
          const activeSeconds = activeMsRef.current / 1000;
          void plan.sessionId.then((id) => (id ? endSessionAction({ id, status: "INTERRUPTED", activeSeconds }) : null));
        }
        if (mountedSessions === 0) ambientAudio.stop();
      }, 0);
    };
  }, [plan]);

  useEffect(() => {
    if (state.phase !== "complete" || ended.current) return;
    ended.current = true;
    const status = state.endedEarly ? "INTERRUPTED" : "COMPLETED";
    const activeSeconds = state.activeMs / 1000;
    void plan.sessionId.then((id) => (id ? endSessionAction({ id, status, activeSeconds }) : null));
    // End gently: let the ambience soften rather than cut.
    if (audioOn) ambientAudio.setVolume((volume / 100) * 0.45);
  }, [state.phase, state.endedEarly, state.activeMs, audioOn, volume, plan.sessionId]);

  // ── Audio controls (the engine is shared; this component only steers it) ─
  const toggleAudio = useCallback(() => {
    if (audioOn) {
      ambientAudio.stop();
      setAudioOn(false);
    } else {
      setAudioOn(ambientAudio.start(plan.audio.sound, volume / 100));
    }
  }, [audioOn, plan.audio.sound, volume]);
  const toggleMute = useCallback(() => {
    ambientAudio.setMuted(!muted);
    setMuted(!muted);
  }, [muted]);
  useEffect(() => () => ambientAudio.setMuted(false), []);

  // ── Controls auto-hide (only the mantra stays in view) ───────────────────
  const idleTimer = useRef<number | null>(null);
  const wake = useCallback(() => {
    setControlsVisible(true);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
  }, []);
  useEffect(() => {
    // Controls start visible; hide them once the trader settles in.
    idleTimer.current = window.setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);
  const showControls = controlsVisible || state.paused || state.phase === "complete";

  // ── Full screen (optional) ───────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    else void rootRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const togglePause = useCallback(() => {
    setAwayPaused(false);
    dispatch({ type: "TOGGLE_PAUSE" });
  }, []);

  // ── Keyboard: Space pause · ←/→ mantras · M mute · Esc end ──────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      wake();
      if (state.phase === "complete") return;
      if (e.key === " ") togglePause();
      else if (e.key === "ArrowRight") dispatch({ type: "NEXT" });
      else if (e.key === "ArrowLeft") dispatch({ type: "PREV" });
      else if (e.key === "m" || e.key === "M") toggleMute();
      else if (e.key === "Escape" && !document.fullscreenElement) dispatch({ type: "END" });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.phase, togglePause, toggleMute, wake]);

  const index = currentMantraIndex(state);
  const mantra = index != null ? plan.mantras[index] : null;
  const remaining = Math.max(0, Math.ceil((config.durationMs - state.activeMs) / 1000));
  const progress = Math.min(1, state.activeMs / config.durationMs);
  const iconBtn = cn("inline-flex size-10 items-center justify-center rounded-full border transition-colors disabled:opacity-40", theme.button);

  return (
    <div ref={rootRef} className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Meditation session" onPointerMove={wake} onPointerDown={wake}>
      <EnvironmentBackdrop environment={plan.environment} className="flex h-full w-full flex-col">
        {/* Session progress — a hairline, nothing louder */}
        <div className="h-0.5 w-full bg-white/5">
          <div className={cn("h-full transition-[width] duration-200 ease-linear", plan.environment === "NATURE" ? "bg-[#a6cf9f]/60" : "bg-[#86cbd6]/60")} style={{ width: `${progress * 100}%` }} />
        </div>

        <div className={cn("flex items-center justify-between px-5 py-3 text-xs transition-opacity duration-700", theme.muted, showControls ? "opacity-100" : "opacity-0")}>
          <span>{plan.title ?? "Mindset session"}</span>
          {state.phase !== "complete" && (
            <span className="tabular-nums">
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} remaining
            </span>
          )}
        </div>

        <main className="flex min-h-0 flex-1 items-center justify-center px-4">
          {state.phase === "breathing" && plan.breathing && (
            <BreathingGuide pattern={plan.breathing} elapsedMs={state.breathingMs} environment={plan.environment} paused={state.paused} onSkip={() => dispatch({ type: "SKIP_BREATHING" })} />
          )}
          {state.phase === "mantras" && mantra && (
            <MantraSlideshow
              text={mantra.text}
              category={mantra.category}
              slideKey={`${state.passes}-${state.position}`}
              slideMs={state.slideMs}
              slideDurationMs={config.slideMs}
              position={state.position}
              total={plan.mantras.length}
              environment={plan.environment}
            />
          )}
          {state.phase === "complete" && (
            <div className="mindset-fade-in flex max-w-2xl flex-col items-center gap-6 text-center">
              <p className={cn("font-serif text-4xl tracking-wide sm:text-5xl", theme.text)}>Take a breath. Your session is complete.</p>
              <p className={cn("text-lg leading-relaxed", theme.muted)}>Approach the market with patience. Follow your plan. Respect your risk.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={onFinish} className={cn("rounded-full border px-5 py-2 text-sm font-medium", theme.button)}>
                  Finish session
                </button>
                <button type="button" onClick={onRepeat} className={cn("rounded-full border px-5 py-2 text-sm", theme.button)}>
                  Repeat session
                </button>
                <button type="button" onClick={onReturn} className={cn("rounded-full border px-5 py-2 text-sm", theme.button)}>
                  Return to Mindset
                </button>
              </div>
            </div>
          )}
        </main>

        {state.phase !== "complete" && (
          <footer className={cn("flex flex-col items-center gap-3 px-4 pb-6 transition-opacity duration-700", showControls ? "opacity-100" : "pointer-events-none opacity-0")}>
            {awayPaused && state.paused && <p className={cn("text-xs", theme.muted)}>Paused while you were away — resume when you&apos;re ready.</p>}
            <div className="flex items-center gap-2">
              <button type="button" className={iconBtn} aria-label="Previous mantra (←)" onClick={() => dispatch({ type: "PREV" })} disabled={state.phase !== "mantras"}>
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" className={cn(iconBtn, "size-12")} aria-label={state.paused ? "Resume (Space)" : "Pause (Space)"} onClick={togglePause}>
                {state.paused ? <Play className="size-5" /> : <Pause className="size-5" />}
              </button>
              <button type="button" className={iconBtn} aria-label="Next mantra (→)" onClick={() => dispatch({ type: "NEXT" })} disabled={state.phase !== "mantras"}>
                <ChevronRight className="size-4" />
              </button>
            </div>
            <div className={cn("flex flex-wrap items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs backdrop-blur", theme.panel, theme.muted)}>
              <button type="button" onClick={toggleAudio} className="rounded-full px-2 py-0.5 hover:opacity-80" aria-pressed={audioOn}>
                {audioOn ? `${SOUNDS[plan.audio.sound].label} · on` : "Sound off"}
              </button>
              {audioOn && (
                <>
                  <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute (M)" : "Mute (M)"} className="hover:opacity-80">
                    {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    aria-label="Volume"
                    className="h-1 w-24 accent-current"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      ambientAudio.setVolume(v / 100);
                    }}
                  />
                </>
              )}
              <span className="mx-1 h-4 w-px bg-white/15" />
              <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit full screen" : "Full screen"} className="hover:opacity-80">
                {fullscreen ? <Shrink className="size-4" /> : <Expand className="size-4" />}
              </button>
              <button type="button" onClick={() => dispatch({ type: "END" })} aria-label="End session (Esc)" className="inline-flex items-center gap-1 hover:opacity-80">
                <X className="size-4" /> End
              </button>
            </div>
          </footer>
        )}
      </EnvironmentBackdrop>
    </div>
  );
}
