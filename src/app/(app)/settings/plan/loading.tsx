import { Skeleton } from "@/components/ui/skeleton";

export default function TradingPlanLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-16">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
