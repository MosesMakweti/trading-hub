"use client";

import { useState, useTransition } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Award, X } from "lucide-react";

import { acknowledgeAchievementsAction } from "@/actions/discipline.actions";
import type { AchievementDTO } from "@/types/discipline";

/**
 * One quiet banner for achievements earned since the trader last looked.
 * Dismissing it marks them seen on the server (`seenAt`, written once), so
 * it never repeats — on any device.
 */
export function AchievementCelebration({ achievements }: { achievements: AchievementDTO[] }) {
  const fresh = achievements.filter((a) => a.isNew);
  const [hidden, setHidden] = useState(false);
  const [, start] = useTransition();
  const reduce = useReducedMotion();
  if (hidden || fresh.length === 0) return null;

  function dismiss() {
    setHidden(true);
    start(async () => {
      await acknowledgeAchievementsAction(fresh.map((a) => a.key));
    });
  }

  return (
    <motion.div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3"
      initial={{ opacity: 0, y: reduce ? 0 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <Award aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium">
          {fresh.length === 1 ? "Achievement unlocked" : `${fresh.length} achievements unlocked`}
        </div>
        <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
          {fresh.map((a) => (
            <li key={a.key}>
              <span className="font-medium text-foreground">{a.title}</span> — {a.description}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" />
      </button>
    </motion.div>
  );
}
