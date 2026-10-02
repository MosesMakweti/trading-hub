"use client";

import { Check, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PhaseKey, PhaseRailItem } from "@/domain/today/day-phase";

const LABEL: Record<PhaseKey, string> = {
  prepare: "Prepare",
  plan: "Plan",
  trade: "Trade",
  close: "Close",
};

/**
 * Today V3 — the day-level phase rail (Prepare · Plan · Trade · Close). Not
 * a wizard: every unlocked phase is one click away. Each segment shows what
 * is done (check), locked (lock + reason), or needs attention (dot), plus an
 * optional count (e.g. trades today).
 */
export function PhaseRail({
  items,
  active,
  onSelect,
  counts,
  lockReason,
}: {
  items: PhaseRailItem[];
  active: PhaseKey;
  onSelect: (key: PhaseKey) => void;
  counts?: Partial<Record<PhaseKey, number>>;
  lockReason: string;
}) {
  return (
    <nav aria-label="Day phases" className="overflow-x-auto">
      <ol className="flex min-w-max items-stretch rounded-xl border border-border bg-card p-1">
        {items.map((item, i) => {
          const isActive = item.key === active;
          const count = counts?.[item.key];
          return (
            <li key={item.key} className="flex items-center">
              {i > 0 && <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />}
              <button
                type="button"
                onClick={() => onSelect(item.key)}
                aria-current={isActive ? "step" : undefined}
                title={item.locked ? lockReason : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  isActive ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
                {LABEL[item.key]}
                {count != null && count > 0 && (
                  <span className="rounded bg-muted px-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>
                )}
                {item.locked ? (
                  <Lock className="size-3.5" aria-label="locked" />
                ) : item.done ? (
                  <Check className="size-3.5 text-success" aria-label="done" />
                ) : item.attention ? (
                  <span className="size-1.5 rounded-full bg-warning" aria-label="needs attention" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
