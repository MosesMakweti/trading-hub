import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BookOpenText, FlaskConical, Sunrise, Wallet } from "lucide-react";

/**
 * Quick Actions — the Dashboard's launchpad. "Start today's session" is the one
 * primary; the rest jump to the workspaces. Kept to genuine launch targets (no
 * quick-create duplicates of the trade/note forms).
 */
export function QuickActions() {
  const actions: { label: string; href: string; icon: LucideIcon; primary?: boolean }[] = [
    { label: "Start today's session", href: "/today", icon: Sunrise, primary: true },
    { label: "Open journal", href: "/journal", icon: BookOpenText },
    { label: "Strategy Lab", href: "/strategy-lab", icon: FlaskConical },
    { label: "My accounts", href: "/accounts", icon: Wallet },
  ];

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Quick actions</h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="glass flex flex-col items-center gap-2 rounded-2xl p-4 text-center text-xs font-medium transition-all hover:-translate-y-px hover:shadow-elevated"
          >
            <span
              className={
                a.primary
                  ? "bg-primary grid size-9 place-items-center rounded-full text-primary-foreground shadow-glow"
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
