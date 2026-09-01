import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getTradeFormOptions } from "@/server/services/trades.service";
import { isValidDateKey, formatDateKeyLong } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { TradeForm } from "@/components/journal/trade-form";

export default async function NewTradePage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ opportunityId?: string }>;
}) {
  const { date: dateKey } = await params;
  const { opportunityId } = await searchParams;
  if (!isValidDateKey(dateKey)) notFound();

  const user = await requireUser();
  const { accounts, strategies } = await getTradeFormOptions(user.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 gap-1.5 text-muted-foreground"
          nativeButton={false}
          render={<Link href={`/journal/${dateKey}`} />}
        >
          <ChevronLeft className="size-3.5" />
          Back to {formatDateKeyLong(dateKey)}
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">
          Add Trade — {formatDateKeyLong(dateKey)}
        </h1>
      </div>

      {opportunityId && (
        <p className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          This trade will be linked to your spotted opportunity and mark it as executed on save.
        </p>
      )}

      <TradeForm
        dateKey={dateKey}
        mode="create"
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind }))}
        strategies={strategies.map((s) => ({ id: s.id, name: s.name, version: s.version }))}
        opportunityId={opportunityId}
      />
    </div>
  );
}
