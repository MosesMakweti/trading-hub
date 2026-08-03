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
}: {
  params: Promise<{ date: string }>;
}) {
  const { date: dateKey } = await params;
  if (!isValidDateKey(dateKey)) notFound();

  const user = await requireUser();
  const { accounts, assets, sessions, entryModels, confluenceItems, executionItems, strategies } =
    await getTradeFormOptions(user.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href={`/journal/${dateKey}`} />}
        >
          <ChevronLeft />
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">
          Add Trade — {formatDateKeyLong(dateKey)}
        </h1>
      </div>

      <TradeForm
        dateKey={dateKey}
        mode="create"
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind }))}
        assets={assets.map((a) => ({ id: a.id, symbol: a.symbol, label: a.label }))}
        sessions={sessions.map((s) => ({ id: s.id, name: s.name }))}
        entryModels={entryModels.map((m) => ({ id: m.id, name: m.name }))}
        confluenceItems={confluenceItems.map((c) => ({ id: c.id, label: c.label }))}
        executionItems={executionItems.map((c) => ({ id: c.id, label: c.label }))}
        strategies={strategies.map((s) => ({ id: s.id, name: s.name, version: s.version }))}
      />
    </div>
  );
}
