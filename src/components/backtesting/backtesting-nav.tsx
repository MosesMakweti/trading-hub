"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Backtesting's section navigation: Overview plus the run-scoped Session,
 * Journal and Analytics. On the Overview (no run in context) the run-scoped
 * items point at the most recently worked-on active run, and are disabled when
 * there's none — never a dead link.
 */
export function BacktestingNav({ runId }: { runId: string | null }) {
  const pathname = usePathname();
  const items = [
    { label: "Overview", href: "/backtesting", active: pathname === "/backtesting" },
    ...(["session", "journal", "analytics"] as const).map((segment) => ({
      label: segment[0].toUpperCase() + segment.slice(1),
      href: runId ? `/backtesting/${runId}/${segment}` : null,
      active: runId != null && pathname.startsWith(`/backtesting/${runId}/${segment}`),
    })),
  ];

  return (
    <nav aria-label="Backtesting" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 border-b border-border px-1">
        {items.map((item) => (
          <li key={item.label}>
            {item.href ? (
              <Link
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-9 items-center px-3 text-sm font-medium transition-colors",
                  item.active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-opacity",
                  item.active ? "after:bg-foreground after:opacity-100" : "after:opacity-0",
                )}
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                title="Create or continue a run first"
                className="inline-flex h-9 cursor-not-allowed items-center px-3 text-sm font-medium text-muted-foreground/50"
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
