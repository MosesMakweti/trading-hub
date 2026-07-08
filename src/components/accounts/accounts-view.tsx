"use client";

import { Wallet, Landmark } from "lucide-react";

import { AccountCard } from "@/components/accounts/account-card";
import { PropFirmAccountDialog } from "@/components/accounts/prop-firm-account-dialog";
import { BrokerageAccountDialog } from "@/components/accounts/brokerage-account-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import type { TradingAccountDTO } from "@/types/accounts";

export function AccountsView({
  propFirmAccounts,
  brokerageAccounts,
}: {
  propFirmAccounts: TradingAccountDTO[];
  brokerageAccounts: TradingAccountDTO[];
}) {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Prop Firm Accounts</h2>
            <p className="text-sm text-muted-foreground">
              Funded and challenge accounts, with automatic ROI.
            </p>
          </div>
          <PropFirmAccountDialog mode="create" />
        </div>
        {propFirmAccounts.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="No prop firm accounts yet"
            description="Add your first challenge or funded account to start tracking ROI."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {propFirmAccounts.map((account) => (
              <AccountCard key={account.id} account={account} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Personal Brokerage Accounts</h2>
            <p className="text-sm text-muted-foreground">
              Your own live/demo accounts, with net profit and return.
            </p>
          </div>
          <BrokerageAccountDialog mode="create" />
        </div>
        {brokerageAccounts.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No brokerage accounts yet"
            description="Add a personal account to start tracking profit and return."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {brokerageAccounts.map((account) => (
              <AccountCard key={account.id} account={account} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
