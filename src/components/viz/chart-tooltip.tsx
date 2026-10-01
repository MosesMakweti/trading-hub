"use client";

import type { ReactNode } from "react";
import type { TooltipContentProps } from "recharts";

import { cn } from "@/lib/utils";

export interface TooltipRow {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** Series colour for the key mark (a data colour; the text never wears it). */
  color?: string;
  /** line = a series line · dash = reference/benchmark · swatch = bar/area · none. */
  mark?: "line" | "dash" | "swatch" | "none";
  /** Signed values get polarity ink so +/− reads at a glance (sign stays in the text). */
  tone?: "profit" | "loss" | "muted";
  /** A divider above this row — separates the readout from derived context. */
  separated?: boolean;
}

export interface TooltipModel {
  title: ReactNode;
  subtitle?: ReactNode;
  rows: TooltipRow[];
  footer?: ReactNode;
}

/**
 * TooltipCard — the readout every chart shares. Values lead (strong, tabular),
 * labels follow (secondary); series are keyed with a short line, not a box.
 * Presentational, so non-Recharts marks (heatmap cells, bars) reuse it too.
 */
export function TooltipCard({ title, subtitle, rows, footer, className }: TooltipModel & { className?: string }) {
  return (
    <div
      className={cn(
        "min-w-44 max-w-72 rounded-lg border border-border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg",
        className,
      )}
    >
      <div className="text-xs font-medium">{title}</div>
      {subtitle && <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>}
      {rows.length > 0 && (
        <dl className="mt-2 space-y-1">
          {rows.map((row) => (
            <div
              key={row.key}
              className={cn("flex items-center justify-between gap-4", row.separated && "mt-1.5 border-t border-border pt-1.5")}
            >
              <dt className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <Mark color={row.color} mark={row.mark} />
                <span className="truncate">{row.label}</span>
              </dt>
              <dd
                className={cn(
                  "text-xs font-semibold tabular-nums",
                  row.tone === "profit" && "text-success",
                  row.tone === "loss" && "text-danger",
                  row.tone === "muted" && "font-medium text-muted-foreground",
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {footer && <div className="mt-2 border-t border-border pt-1.5 text-[11px] text-muted-foreground">{footer}</div>}
    </div>
  );
}

function Mark({ color, mark = "line" }: { color?: string; mark?: TooltipRow["mark"] }) {
  if (!color || mark === "none") return null;
  if (mark === "swatch") return <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />;
  return (
    <svg aria-hidden width="12" height="6" className="shrink-0">
      <line
        x1="0"
        y1="3"
        x2="12"
        y2="3"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={mark === "dash" ? "3 2" : undefined}
      />
    </svg>
  );
}

/**
 * Adapts a datum → TooltipModel builder to Recharts' `content` prop:
 *   <Tooltip content={rechartsTooltip<Row>((row) => ({ title, rows }))} />
 * The builder receives the hovered row's own data object (the `data` entry),
 * so tooltips can show any field — change, contribution, context — not just
 * the plotted values. Return null to suppress.
 */
export function rechartsTooltip<T>(build: (datum: T, label: string | number | undefined) => TooltipModel | null) {
  function RechartsTooltipContent(props: TooltipContentProps) {
    const { active, payload, label } = props;
    if (!active || !payload || payload.length === 0) return null;
    const datum = payload[0]?.payload as T | undefined;
    if (datum == null) return null;
    const model = build(datum, label);
    return model ? <TooltipCard {...model} /> : null;
  }
  return RechartsTooltipContent;
}
