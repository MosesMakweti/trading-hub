import { Skeleton } from "@/components/ui/skeleton";

export default function BacktestJournalLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading journal">
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-[28rem] rounded-2xl" />
    </div>
  );
}
