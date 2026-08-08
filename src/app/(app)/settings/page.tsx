import Link from "next/link";
import { ChevronRight, Database, ListChecks, Trash2, type LucideIcon } from "lucide-react";

import { FadeIn } from "@/components/shared/motion";

const AREAS: { href: string; icon: LucideIcon; title: string; description: string }[] = [
  {
    href: "/settings/routine",
    icon: ListChecks,
    title: "Pre-Session Routine",
    description:
      "Build your pre-market ritual — sections and checklist items you run through in Today before you trade.",
  },
  {
    href: "/settings/data",
    icon: Database,
    title: "Data",
    description: "Export your trade history, or restore it from a backup.",
  },
  {
    href: "/settings/data-management",
    icon: Trash2,
    title: "Data Management",
    description: "Control and permanently remove your TradeOS data — by section, or a full reset.",
  },
];

export default function PreferencesPage() {
  return (
    <FadeIn className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trading Preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize how you prepare, plan, and log your trading.
        </p>
      </div>

      <div className="glass divide-y divide-border overflow-hidden rounded-2xl">
        {AREAS.map((area) => (
          <Link
            key={area.href}
            href={area.href}
            className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/60"
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/40 text-muted-foreground transition-colors group-hover:text-foreground">
              <area.icon className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{area.title}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">{area.description}</div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </FadeIn>
  );
}
