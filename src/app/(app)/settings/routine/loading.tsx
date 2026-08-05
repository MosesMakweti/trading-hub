import { Skeleton } from "@/components/ui/skeleton";

export default function RoutineSettingsLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-16">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
