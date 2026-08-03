import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { TradeStatus } from "@/types/trades";

/**
 * A workspace section on a timeline rail: a gradient step dot + a connecting line
 * down to the next section, with the section's card body on the right. Shared by
 * every Trade Workspace section so they read as one continuous case file.
 */
export function WorkspaceSection({
  icon: Icon,
  title,
  description,
  action,
  isLast,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  isLast?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="relative pl-9 sm:pl-12">
      <div className="absolute top-0 left-0 flex h-full flex-col items-center">
        <span className="bg-brand-gradient z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-white shadow-glow sm:size-8">
          <Icon className="size-3.5 sm:size-4" />
        </span>
        {!isLast && <span className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className={cn(!isLast && "pb-6")}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold tracking-tight">{title}</h2>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
        <div className="glass rounded-2xl p-4">{children}</div>
      </div>
    </section>
  );
}

/** A labelled value; renders a muted placeholder when empty. */
export function WorkspaceField({
  label,
  value,
  placeholder = "—",
  className,
}: {
  label: string;
  value?: ReactNode;
  placeholder?: string;
  className?: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={cn("space-y-0.5", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-sm", empty && "text-muted-foreground/40 italic")}>
        {empty ? placeholder : value}
      </div>
    </div>
  );
}

/** A free-text note block (multi-line), with an italic placeholder when empty. */
export function NoteBlock({
  label,
  text,
  placeholder = "Not captured yet.",
}: {
  label: string;
  text?: string | null;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {text ? (
        <p className="text-sm whitespace-pre-wrap text-foreground">{text}</p>
      ) : (
        <p className="text-sm text-muted-foreground/40 italic">{placeholder}</p>
      )}
    </div>
  );
}

/** Marks a field/area that a later phase will make real (new DB columns, uploads). */
export function ComingSoon({ label = "Later phase" }: { label?: string }) {
  return (
    <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

const STATUS_META: Record<TradeStatus, { label: string; variant: "secondary" | "default" | "success" }> = {
  OPEN: { label: "Open", variant: "secondary" },
  CLOSED: { label: "Closed", variant: "default" },
  REVIEWED: { label: "Reviewed", variant: "success" },
};

export function TradeStatusBadge({ status }: { status: TradeStatus }) {
  const meta = STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

// ── formatters ───────────────────────────────────────────────────────────────
export function formatRR(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function formatCurrency(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function formatSignedCurrency(n: number) {
  return `${n >= 0 ? "+" : ""}${formatCurrency(n)}`;
}
