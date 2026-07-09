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
    <div className={cn("glass rounded-2xl p-4", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight",
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
