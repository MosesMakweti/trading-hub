import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BookOpenText, FlaskConical, NotebookPen, Plus, Sunrise, Wallet } from "lucide-react";

/**
 * Quick Actions — the Dashboard's launchpad into the workflow. Presentational;
 * links target today where relevant. In Phase 2 "Start today's session" repoints
 * to the /today workspace.
 */
export function QuickActions({ todayKey }: { todayKey: string }) {
  const actions: { label: string; href: string; icon: LucideIcon; primary?: boolean }[] = [
    { label: "Start today's session", href: "/today", icon: Sunrise, primary: true },
    { label: "Add trade", href: `/journal/${todayKey}/trades/new`, icon: Plus },
    { label: "Add note", href: `/journal/${todayKey}#notes`, icon: NotebookPen },
    { label: "Open journal", href: "/journal", icon: BookOpenText },
    { label: "Strategy Lab", href: "/strategy-lab", icon: FlaskConical },
    { label: "My accounts", href: "/accounts", icon: Wallet },
  ];

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Quick actions</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="glass flex flex-col items-center gap-2 rounded-2xl p-4 text-center text-xs font-medium transition-all hover:-translate-y-px hover:shadow-elevated"
          >
            <span
              className={
                a.primary
                  ? "bg-brand-gradient grid size-9 place-items-center rounded-full text-white shadow-glow"
                  : "grid size-9 place-items-center rounded-full border border-border bg-background/40 text-muted-foreground"
              }
            >
              <a.icon className="size-4" />
            </span>
            {a.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
