import Link from "next/link";
import { ArrowRight, Database, ListChecks, SlidersHorizontal, type LucideIcon } from "lucide-react";

import { FadeIn, StaggerList, StaggerItem } from "@/components/shared/motion";

const AREAS: { href: string; icon: LucideIcon; title: string; description: string }[] = [
  {
    href: "/settings/routine",
    icon: ListChecks,
    title: "Pre-Session Routine",
    description:
      "Build your pre-market ritual — sections and checklist items you run through in Today before you trade.",
  },
  {
    href: "/settings/plan",
    icon: SlidersHorizontal,
    title: "Trade Setup",
    description: "The lists every trade draws from — your watchlist, sessions, and checklists.",
  },
  {
    href: "/settings/data",
    icon: Database,
    title: "Data",
    description: "Export your trade history, or restore it from a backup.",
  },
];

export default function PreferencesPage() {
  return (
    <FadeIn className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trading Preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize how you prepare, plan, and log your trading.
        </p>
      </div>

      <StaggerList className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {AREAS.map((area) => (
          <StaggerItem key={area.href}>
            <Link
              href={area.href}
              className="glass group flex h-full flex-col rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:shadow-elevated"
            >
              <span className="bg-brand-gradient mb-3 inline-flex size-10 items-center justify-center rounded-xl text-white shadow-glow">
                <area.icon className="size-5" />
              </span>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                {area.title}
                <ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{area.description}</p>
            </Link>
          </StaggerItem>
        ))}
      </StaggerList>
    </FadeIn>
  );
}
