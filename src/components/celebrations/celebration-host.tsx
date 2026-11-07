"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AchievementBadge } from "@/components/achievements/achievement-badge";
import { ParticleBurst } from "@/components/celebrations/particle-burst";
import { dismissCelebrationsAction, getPendingCelebrationsAction } from "@/actions/celebrations.actions";
import { formatDateKeyLong } from "@/lib/date";
import type { CelebrationDTO, CelebrationPreferencesDTO } from "@/types/achievements";

/**
 * Shows queued celebrations (ProgressEvent rows) — one at a time, biggest
 * first, only while the tab is visible:
 *
 *   level 3  a centred overlay: badge reveal, title, what it means, a short
 *            particle burst
 *   level 2  an animated card in the corner, until dismissed
 *   level 1  a quiet toast (several at once are grouped into one)
 *
 * A celebration is marked seen on the server only when it is dismissed (or,
 * for a toast, once it has been shown), so a refresh or a closed tab never
 * loses one and nothing is ever shown twice. Animations follow the trader's
 * setting and `prefers-reduced-motion`; sound is off unless they turned it
 * on, and even then only plays after they have interacted with the page.
 */
export function CelebrationHost({ preferences }: { preferences: CelebrationPreferencesDTO }) {
  const pathname = usePathname();
  const router = useRouter();
  // Waiting celebrations live in a ref; only the one on screen is state.
  const waiting = useRef<CelebrationDTO[]>([]);
  const handled = useRef(new Set<string>());
  const [current, setCurrent] = useState<Moment | null>(null);
  const showing = useRef<Moment | null>(null);
  const reduce = useReducedMotion();
  const animate = preferences.animations && !reduce;

  /** Shows the next big celebration, or — once none are left — the small ones as toasts. */
  const pump = useCallback(() => {
    if (showing.current) return;
    const big = waiting.current.find((c) => c.level > 1);
    if (big) {
      // Everything waiting is ONE moment — whether earned the same day or
      // while the trader was away: the most important leads, the rest are
      // listed with it and dismissed together. Never a chain of popups.
      const together = [...waiting.current].sort(byImportance);
      const moment: Moment = { lead: together[0], also: together.slice(1) };
      showing.current = moment;
      setCurrent(moment);
      if (preferences.sound) playChime(moment.lead.level);
      return;
    }
    const small = waiting.current.filter((c) => c.level === 1);
    if (small.length === 0) return;
    waiting.current = waiting.current.filter((c) => c.level !== 1);
    for (const c of small) handled.current.add(c.id);
    if (small.length <= 2) {
      for (const c of small) toast.success(c.title, { description: c.description, icon: <AchievementBadge icon={c.icon} level={1} size="sm" />, duration: 6000 });
    } else {
      toast.success(`${small.length} achievements unlocked`, {
        description: small.map((c) => c.title).join(" · "),
        action: { label: "View", onClick: () => router.push("/achievements") },
        duration: 8000,
      });
    }
    // A toast that has been shown counts as seen.
    void dismissCelebrationsAction(small.map((c) => c.id)).catch(() => {});
  }, [preferences.sound, router]);

  const load = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const pending = await getPendingCelebrationsAction();
      const known = new Set(waiting.current.map((c) => c.id));
      const onScreen = new Set(showing.current ? [showing.current.lead.id, ...showing.current.also.map((c) => c.id)] : []);
      const fresh = pending.filter((c) => !handled.current.has(c.id) && !known.has(c.id) && !onScreen.has(c.id));
      if (fresh.length === 0) return;
      waiting.current = [...waiting.current, ...fresh].sort((a, b) => b.level - a.level);
      pump();
    } catch {
      // A celebration is never worth an error: it stays queued for next time.
    }
  }, [pump]);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const dismiss = useCallback(() => {
    const m = showing.current;
    if (!m) return;
    const ids = [m.lead.id, ...m.also.map((c) => c.id)];
    for (const id of ids) handled.current.add(id);
    waiting.current = waiting.current.filter((w) => !ids.includes(w.id));
    showing.current = null;
    setCurrent(null);
    void dismissCelebrationsAction(ids).catch(() => {});
    // Let the exit animation start before the next one arrives.
    window.setTimeout(pump, animate ? 350 : 0);
  }, [pump, animate]);

  return (
    <AnimatePresence>
      {current?.lead.level === 3 && <MajorCelebration key={current.lead.id} m={current} animate={animate} onDismiss={dismiss} />}
      {current?.lead.level === 2 && <MediumCelebration key={current.lead.id} m={current} animate={animate} onDismiss={dismiss} />}
    </AnimatePresence>
  );
}

interface Moment {
  lead: CelebrationDTO;
  also: CelebrationDTO[];
}

const KIND_ORDER: Record<CelebrationDTO["kind"], number> = { GOAL_COMPLETED: 0, MILESTONE: 1, ACHIEVEMENT: 2 };

/** Bigger first; at the same level a completed goal leads, then a milestone, then the most recent. */
function byImportance(a: CelebrationDTO, b: CelebrationDTO): number {
  return b.level - a.level || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.occurredOn.localeCompare(a.occurredOn);
}

function AlsoUnlocked({ also, className }: { also: CelebrationDTO[]; className?: string }) {
  if (also.length === 0) return null;
  const shown = also.slice(0, 6);
  return (
    <div className={className}>
      <div className="text-[11px] tracking-wider text-muted-foreground uppercase">Also unlocked</div>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {shown.map((c) => (
          <li key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
            <AchievementBadge icon={c.icon} level={c.level} size="sm" className="-ml-1 size-5" />
            {c.title}
          </li>
        ))}
        {also.length > shown.length && <li className="px-1 py-0.5 text-xs text-muted-foreground">+{also.length - shown.length} more</li>}
      </ul>
    </div>
  );
}

function subtitle(c: CelebrationDTO): string {
  if (c.kind === "MILESTONE") return `Milestone · ${c.goalName ?? "Goal"}`;
  if (c.kind === "GOAL_COMPLETED") return "Goal complete";
  return "Achievement unlocked";
}

function MajorCelebration({ m, animate, onDismiss }: { m: Moment; animate: boolean; onDismiss: () => void }) {
  const c = m.lead;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: animate ? 0.25 : 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`celebration-${c.id}`}
      aria-describedby={`celebration-${c.id}-desc`}
    >
      {animate && <ParticleBurst />}
      <motion.div
        className="glass-strong relative w-full max-w-sm rounded-2xl p-6 text-center"
        initial={animate ? { opacity: 0, y: 16, scale: 0.96 } : false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={animate ? { opacity: 0, y: 8 } : { opacity: 0 }}
        transition={{ duration: animate ? 0.45 : 0, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div
          className="mx-auto w-fit"
          initial={animate ? { scale: 0.6, rotate: -12, opacity: 0 } : false}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ delay: animate ? 0.12 : 0, duration: animate ? 0.6 : 0, ease: [0.16, 1, 0.3, 1] }}
        >
          <AchievementBadge icon={c.icon} level={3} size="xl" />
        </motion.div>
        <div className="mt-4 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{subtitle(c)}</div>
        <h2 id={`celebration-${c.id}`} className="mt-1 text-xl font-semibold tracking-tight text-balance">
          {c.title}
        </h2>
        <p id={`celebration-${c.id}-desc`} className="mt-2 text-sm text-muted-foreground">
          {c.description}
        </p>
        <p className="mt-3 text-xs tabular-nums text-muted-foreground">
          {c.days != null && c.kind !== "ACHIEVEMENT" ? `${c.days} consecutive trading days · ` : ""}
          {formatDateKeyLong(c.occurredOn)}
        </p>
        <AlsoUnlocked also={m.also} className="mt-4 text-left" />
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <Button variant="outline" nativeButton={false} render={<Link href="/achievements" onClick={onDismiss} />}>
            View achievements
          </Button>
          <Button ref={button} onClick={onDismiss}>
            Continue
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function MediumCelebration({ m, animate, onDismiss }: { m: Moment; animate: boolean; onDismiss: () => void }) {
  const c = m.lead;
  return (
    <motion.div
      role="status"
      aria-live="polite"
      className="glass-strong fixed right-4 bottom-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-4"
      initial={animate ? { opacity: 0, y: 24 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={animate ? { opacity: 0, y: 12 } : { opacity: 0 }}
      transition={{ duration: animate ? 0.35 : 0, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-start gap-3">
        <motion.div
          initial={animate ? { scale: 0.5, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: animate ? 0.1 : 0, duration: animate ? 0.45 : 0, ease: [0.16, 1, 0.3, 1] }}
        >
          <AchievementBadge icon={c.icon} level={2} size="lg" />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{subtitle(c)}</div>
          <div className="mt-0.5 font-medium">{c.title}</div>
          <p className="mt-0.5 text-sm text-muted-foreground">{c.description}</p>
          <AlsoUnlocked also={m.also} className="mt-2" />
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={onDismiss}>
              Nice
            </Button>
            <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/achievements" onClick={onDismiss} />}>
              View all
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** A soft two-note chime, only after the trader has interacted with the page. */
function playChime(level: number) {
  try {
    const active = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
    if (!active) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = level === 3 ? [659.25, 987.77] : [659.25, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.65);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    // Sound is optional.
  }
}
