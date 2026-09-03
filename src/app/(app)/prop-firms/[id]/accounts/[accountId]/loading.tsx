import { Skeleton } from "@/components/ui/skeleton";

export default function AccountWorkspaceLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
