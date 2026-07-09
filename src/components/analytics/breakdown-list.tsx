import { cn } from "@/lib/utils";
import type { TrendPoint } from "@/domain/psychology/analytics";

export function BreakdownList({ title, points }: { title: string; points: TrendPoint[] }) {
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {points.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No data in this range yet.</p>
      ) : (
        <div className="space-y-2">
          {points.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{p.key}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {p.count} trade{p.count === 1 ? "" : "s"}
                </span>
                <span
                  className={cn(
                    "w-14 text-right font-medium",
                    p.averagePercent >= 80 && "text-success",
                    p.averagePercent >= 60 && p.averagePercent < 80 && "text-warning",
                    p.averagePercent < 60 && "text-danger",
                  )}
                >
                  {p.averagePercent.toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
