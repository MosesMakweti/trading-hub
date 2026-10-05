import type { LucideIcon } from "lucide-react";
import { BookOpenCheck, Flag, NotebookPen, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRR } from "@/components/journal/workspace/workspace-ui";
import type { TradeWorkspaceDTO } from "@/types/trades";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type Milestone = {
  key: string;
  label: string;
  description: string;
  at: string | null;
  reached: boolean;
  icon: LucideIcon;
};

/**
 * Trade Timeline (Phase 3) — the trade's lifecycle as a vertical, semantic
 * ordered list. Reached milestones show a gradient node + real timestamp;
 * milestones not yet reached show a muted, dashed "pending" node, so the
 * timeline doubles as a status tracker. Each event carries an icon *and* a text
 * label (identity never rests on colour alone), and times use <time> elements.
 */
export function TradeTimeline({ trade }: { trade: TradeWorkspaceDTO }) {
  const closedDescription =
    trade.actualRR != null ? `Result recorded · ${formatRR(trade.actualRR)}` : "Result recorded.";

  const milestones: Milestone[] = [
    {
      key: "executed",
      label: "Executed",
      description: "Entered the market.",
      at: trade.executedAt,
      reached: true,
      icon: Zap,
    },
    {
      key: "logged",
      label: "Logged",
      description: "Trade saved to your journal.",
      at: trade.createdAt,
      reached: true,
      icon: NotebookPen,
    },
    {
      key: "closed",
      label: "Closed",
      description: trade.closedAt ? closedDescription : "No result recorded yet.",
      at: trade.closedAt,
      reached: trade.closedAt != null,
      icon: Flag,
    },
    {
      key: "reviewed",
      label: "Review completed",
      // Today V3: reviewedAt is the latest explicit review completion (an
      // interim review counts here; final completeness is shown in Review).
      description: trade.reviewedAt ? "Latest review completion." : "Not reviewed yet.",
      at: trade.reviewedAt,
      reached: trade.reviewedAt != null,
      icon: BookOpenCheck,
    },
  ];

  return (
    <div className="space-y-4">
      <ol className="space-y-0">
        {milestones.map((m, i) => {
          const isLast = i === milestones.length - 1;
          const Icon = m.icon;
          return (
            <li key={m.key} className="relative flex gap-3 pb-5 last:pb-0">
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute top-8 bottom-0 left-4 w-px -translate-x-1/2 bg-border"
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full",
                  m.reached
                    ? "bg-brand-gradient text-primary-foreground shadow-glow"
                    : "border border-dashed border-border bg-background/40 text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
              <div className="pt-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      !m.reached && "text-muted-foreground",
                    )}
                  >
                    {m.label}
                  </span>
                  {m.at ? (
                    <time dateTime={m.at} className="text-xs text-muted-foreground tabular-nums">
                      {formatDateTime(m.at)}
                    </time>
                  ) : (
                    <span className="text-xs text-muted-foreground/60 italic">Pending</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{m.description}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        Last updated{" "}
        <time dateTime={trade.updatedAt} className="tabular-nums">
          {formatDateTime(trade.updatedAt)}
        </time>
      </p>
    </div>
  );
}
