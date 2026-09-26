import { Skeleton } from "@/components/ui/skeleton";

export default function BacktestSessionLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
