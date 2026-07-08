import { Wallet } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";

export default function AccountsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">My Accounts</h1>
      <EmptyState
        icon={Wallet}
        title="Account tracking coming soon"
        description="Prop firm and personal brokerage account tracking, with ROI and return calculations, is built in the next phase."
      />
    </div>
  );
}
