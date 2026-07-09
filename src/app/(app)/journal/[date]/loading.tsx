import { Skeleton } from "@/components/ui/skeleton";

export default function JournalDayLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="size-8 rounded-md" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>

      <Skeleton className="h-32 rounded-2xl" />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    </div>
  );
}
