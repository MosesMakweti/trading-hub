import { Skeleton } from "@/components/ui/skeleton";

export default function BacktestJournalDayLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading day">
      <Skeleton className="h-12 w-72" />
      <Skeleton className="h-16 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
    </div>
  );
}
