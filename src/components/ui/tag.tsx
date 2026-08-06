import type { TagColor } from "@prisma/client";

import { cn } from "@/lib/utils";

// The shared Notion-style tag palette. Full static class strings (never templated)
// so Tailwind keeps them. Theme-aware via the `dark:` variant. Used everywhere a
// colored tag/chip appears — confluences, execution confirmations, sessions, etc.
export const TAG_STYLES: Record<TagColor, { chip: string; dot: string; label: string }> = {
  GRAY: { chip: "border-slate-400/25 bg-slate-400/10 text-slate-600 dark:text-slate-300", dot: "bg-slate-400", label: "Gray" },
  BLUE: { chip: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300", dot: "bg-blue-500", label: "Blue" },
  GREEN: { chip: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500", label: "Green" },
  AMBER: { chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", dot: "bg-amber-500", label: "Amber" },
  RED: { chip: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300", dot: "bg-rose-500", label: "Red" },
  PURPLE: { chip: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300", dot: "bg-violet-500", label: "Purple" },
  YELLOW: { chip: "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300", dot: "bg-yellow-500", label: "Yellow" },
  TEAL: { chip: "border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-300", dot: "bg-teal-500", label: "Teal" },
};

export const TAG_COLORS = Object.keys(TAG_STYLES) as TagColor[];

/** A colored pill: a dot + label. `muted` dims a disabled tag. */
export function Tag({
  color,
  children,
  muted = false,
  className,
}: {
  color: TagColor;
  children: React.ReactNode;
  muted?: boolean;
  className?: string;
}) {
  const s = TAG_STYLES[color];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        s.chip,
        muted && "opacity-45",
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
      {children}
    </span>
  );
}

/** Just the color swatch dot — for color pickers. */
export function TagDot({ color, className }: { color: TagColor; className?: string }) {
  return <span className={cn("size-3 rounded-full", TAG_STYLES[color].dot, className)} />;
}
