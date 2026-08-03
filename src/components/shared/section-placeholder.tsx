import type { LucideIcon } from "lucide-react";

/**
 * Documented placeholder for a workspace section a later phase will build. Keeps
 * a workspace shell complete and navigable now, and marks the exact insertion
 * point for future work — replace it with the real section component when its
 * phase lands; the surrounding wiring stays the same. Shared across modules
 * (Strategy Lab, the Today workspace, …).
 */
export function SectionPlaceholder({
  icon: Icon,
  title,
  description,
  phase,
  plannedFeatures,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phase: string;
  plannedFeatures: string[];
}) {
  return (
    <div className="glass flex flex-col items-center gap-4 rounded-2xl px-6 py-14 text-center">
      <div className="bg-brand-gradient flex size-12 items-center justify-center rounded-xl text-white shadow-glow">
        <Icon className="size-6" />
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      <span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
        Coming in {phase}
      </span>
      {plannedFeatures.length > 0 && (
        <ul className="mx-auto grid max-w-md gap-1.5 text-left text-xs text-muted-foreground">
          {plannedFeatures.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
