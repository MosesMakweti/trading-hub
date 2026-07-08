import { requireUser } from "@/server/guards";
import { listTradingAccounts } from "@/server/services/accounts.service";
import { AccountsView } from "@/components/accounts/accounts-view";
import type { TradingAccountDTO } from "@/types/accounts";

function toNumber(value: { toNumber(): number } | null): number | null {
  return value ? value.toNumber() : null;
}

export default async function AccountsPage() {
  const user = await requireUser();
  const rows = await listTradingAccounts(user.id);

  const accounts: TradingAccountDTO[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    currentBalance: row.currentBalance.toNumber(),
    propFirmName: row.propFirmName,
    accountSize: toNumber(row.accountSize),
    phase: row.phase,
    purchaseCost: toNumber(row.purchaseCost),
    totalPayouts: toNumber(row.totalPayouts),
    brokerName: row.brokerName,
    startingBalance: toNumber(row.startingBalance),
    totalWithdrawals: toNumber(row.totalWithdrawals),
    totalDeposits: toNumber(row.totalDeposits),
  }));

  const propFirmAccounts = accounts.filter((a) => a.kind === "PROP_FIRM");
  const brokerageAccounts = accounts.filter((a) => a.kind === "PERSONAL_BROKERAGE");

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">My Accounts</h1>
      <AccountsView propFirmAccounts={propFirmAccounts} brokerageAccounts={brokerageAccounts} />
    </div>
  );
}
