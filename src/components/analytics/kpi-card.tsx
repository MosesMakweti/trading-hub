import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  sublabel,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "neutral" | "success" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass group relative overflow-hidden rounded-2xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevated",
        className,
      )}
    >
      {/* subtle brand sheen that lifts on hover */}
      <div className="bg-brand-gradient pointer-events-none absolute -top-8 -right-8 size-24 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-20" />
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 text-2xl font-semibold tracking-tight tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
      {sublabel && <div className="mt-0.5 text-xs text-muted-foreground">{sublabel}</div>}
    </div>
  );
}
