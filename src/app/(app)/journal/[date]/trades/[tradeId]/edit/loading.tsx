import { Skeleton } from "@/components/ui/skeleton";

export default function EditTradeLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-56 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-32 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
