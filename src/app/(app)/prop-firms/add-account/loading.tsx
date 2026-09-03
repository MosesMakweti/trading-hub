import { Skeleton } from "@/components/ui/skeleton";

export default function AddAccountLoading() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="glass space-y-4 rounded-2xl p-6">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-1 flex-1 rounded-full" />
          ))}
        </div>
        <div className="min-h-72 space-y-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
