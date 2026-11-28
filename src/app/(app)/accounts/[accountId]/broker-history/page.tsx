import { notFound } from "next/navigation";

import { requireUser } from "@/server/guards";
import { getBrokerHistory } from "@/server/services/mt5-connector.service";
import { FadeIn } from "@/components/shared/motion";
import { BrokerHistoryView } from "@/components/broker-history/broker-history-view";

/**
 * MT5 Connector (Stage 1) — read-only Broker History for one account: the
 * raw deals synced from MT5 and the positions derived from them. Strictly
 * account-side: nothing here is (or creates) a journal Trade, and nothing
 * here feeds the account's balance, ledger or analytics.
 */
export default async function BrokerHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  const { accountId } = await params;
  const { page } = await searchParams;
  const history = await getBrokerHistory(user.id, accountId, Number(page ?? "1"));
  if (!history) notFound();

  return (
    <FadeIn className="mx-auto max-w-5xl">
      <BrokerHistoryView history={history} tradingAccountId={accountId} />
    </FadeIn>
  );
}
