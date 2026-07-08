import { LayoutDashboard } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Dashboard</h1>
      <EmptyState
        icon={LayoutDashboard}
        title="Your desk is being built"
        description="The home dashboard summary (today's plan, recent trades, equity curve, quick actions) lands in a later phase, once the Trading Plan, Accounts, and Journal are in place."
      />
    </div>
  );
}
