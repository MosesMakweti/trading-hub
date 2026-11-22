"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Backtesting's own navigation — independent of the live Today/Journal
 * areas. Products appear here only once they exist (never a dead link).
 */
const ITEMS: { label: string; href: string; match: (p: string) => boolean }[] = [
  { label: "Home", href: "/backtesting", match: (p) => p === "/backtesting" },
  { label: "Strategy Lab", href: "/backtesting/lab", match: (p) => p.startsWith("/backtesting/lab") && !p.startsWith("/backtesting/lab/studies") },
  { label: "Studies", href: "/backtesting/lab/studies", match: (p) => p.startsWith("/backtesting/lab/studies") },
  { label: "Historical data", href: "/backtesting/data", match: (p) => p.startsWith("/backtesting/data") },
  { label: "Legacy runs", href: "/backtesting/legacy", match: (p) => p.startsWith("/backtesting/legacy") },
];

export function SimulationNav({ extra = [] }: { extra?: { label: string; href: string }[] }) {
  const pathname = usePathname();
  const items = [...ITEMS.slice(0, 3), ...extra.map((e) => ({ ...e, match: (p: string) => p.startsWith(e.href) })), ...ITEMS.slice(3)];
  return (
    <nav aria-label="Backtesting" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 border-b border-border px-1">
        {items.map((item) => {
          const active = item.match(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-9 items-center px-3 text-sm font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full",
                  active ? "after:bg-primary" : "after:bg-transparent",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
