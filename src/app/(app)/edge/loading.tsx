import { Skeleton } from "@/components/ui/skeleton";

export default function EdgeLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-10 rounded-xl" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-border p-4">
          <Skeleton className="h-6 w-56" />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
