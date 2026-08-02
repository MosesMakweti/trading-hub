import { Skeleton } from "@/components/ui/skeleton";

export default function StrategyWorkspaceLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-md" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-52" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-9 w-full max-w-xl rounded-lg" />
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}
